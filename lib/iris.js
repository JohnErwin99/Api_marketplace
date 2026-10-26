'use strict';

/**
 * Iris in the API console: who the caller is, as the console guide sees it,
 * and a signed ElevenLabs conversation URL for the "Iris Console" agent.
 *
 *   GET /marketplace/me            account summary (no email; firstName) + irisEnabled
 *   GET /marketplace/iris/session  { signedUrl, conversationId, userId, context }
 *
 * Both need a console session (Authorization: Bearer <session>); partner API
 * keys (mk_...) are refused. Nothing here is under /api/*, so none of it is
 * metered or billed. Pilot gate: Iris is on for everyone when
 * IRIS_CONSOLE_ENABLED=on, else only for the emails in IRIS_CONSOLE_EMAILS
 * (comma-separated). /marketplace/me reports it as `irisEnabled` (no side
 * effects), and the console shows the launcher only when it is true; the
 * session route still answers 404 to anyone outside the gate.
 *
 * Env: ELEVENLABS_API_KEY (an agents-only key) and IRIS_CONSOLE_AGENT_ID.
 * Neither the key nor the signed URL is ever logged or audited.
 */

const crypto = require('crypto');
const db = require('./db');
const { sessionEmail, isAdmin } = require('./session');
const { lookupAuthorization, agentRecordsFor } = require('./onboarding');
const { accountState } = require('./billing');
const security = require('./security');

const SIGNED_URL = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url';
const IX_BASE = 'https://api.iristelx.com';
const TIMEOUT_MS = 8000;
const NAME_TIMEOUT_MS = 4000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---- first name, so Iris can greet the caller ------------------------------
// Looked up here from records the gateway trusts, never taken from the
// browser: the CRM contact (every marketplace sign-up / access request makes
// one), else the agent record's name, else the Iristel employees directory
// (admins never reach the CRM). Cached per email; '' when nothing usable.
const NAME_CACHE_MS = 10 * 60 * 1000;
const nameCache = new Map();

// One clean first name, or ''. The portal falls back to the email's local
// part as a "name", and records can hold business names or junk, so keep only
// a plausible first word: letters (accents too), - and ', at most 30 chars.
function cleanFirstName(raw, email) {
  const word = String(raw || '').trim().split(/\s+/)[0] || '';
  if (!word || word.length > 30 || !/^[\p{L}][\p{L}'’-]*$/u.test(word)) return '';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (word.toLowerCase() === local) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAME_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    return r.ok ? await r.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

async function crmFirstName(email) {
  if (!process.env.D365_URL || !process.env.D365_CLIENT_ID) return '';
  const { api } = require('../scripts/d365');
  const esc = (s) => String(s).replace(/'/g, "''");
  const r = await api('GET', `/contacts?$select=firstname&$filter=emailaddress1 eq '${esc(email)}'&$top=1`);
  return r.ok ? ((r.json.value || [])[0] || {}).firstname || '' : '';
}

async function employeeFirstName(email) {
  const key = process.env.IRISTELX_API_KEY;
  if (!key) return '';
  const d = await fetchJson(`${IX_BASE}/employees?email=${encodeURIComponent(email)}`, { 'x-api-key': key });
  return ((d && d.data) || [])[0] ? d.data[0].firstName || '' : '';
}

async function firstNameFor(email, { isStaff, agents } = {}) {
  const hit = nameCache.get(email);
  if (hit && Date.now() - hit.at < NAME_CACHE_MS) return hit.value;
  const sources = [
    () => (isAdmin(email) ? '' : crmFirstName(email)),
    () => (agents && agents[0] ? agents[0].name : ''),
    () => (isStaff ? employeeFirstName(email) : ''),
  ];
  let value = '';
  for (const source of sources) {
    try {
      value = cleanFirstName(await source(), email);
    } catch (err) {
      console.warn('[iris] first-name lookup failed:', err.message);
      value = '';
    }
    if (value) break;
  }
  nameCache.set(email, { at: Date.now(), value });
  return value;
}

// The account summary Iris works from. Throws an error carrying
// { status, error } when the caller isn't approved or the CRM is
// unreachable. Admins get the short authorization object (every exposable
// product, no CRM fields), so everything here tolerates missing fields.
async function accountContext(email) {
  let auth;
  try {
    auth = await lookupAuthorization(email);
  } catch (err) {
    console.warn('[iris] account lookup failed:', err.message);
    throw Object.assign(new Error('account lookup failed'), { status: 503, error: 'unavailable' });
  }
  if (!auth || !auth.approved) throw Object.assign(new Error('not approved'), { status: 403, error: 'not_approved' });
  // Same list the console and /api/* use, so Iris never offers a product
  // the caller can't call.
  const granted = new Set(auth.products || []);
  const products = require('./catalogs').PRODUCTS.filter((p) => granted.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));
  const agents = await agentRecordsFor(email);
  const s = await accountState(email);
  const isStaff = isAdmin(email) || !!auth.isInternal;
  return {
    firstName: await firstNameFor(email, { isStaff, agents }),
    accountType: auth.accountType || null,
    isStaff,
    isAgent: agents.length > 0,
    agents,
    products,
    // live (card on file) | card_required (Standard and Advanced events need
    // a card, or the sandbox) | past_due | exempt
    mode: s.mode,
    sandbox: s.sandbox,
  };
}

// Pilot gate: everyone once IRIS_CONSOLE_ENABLED=on, else the listed emails.
function enabledFor(email) {
  if (process.env.IRIS_CONSOLE_ENABLED === 'on') return true;
  return (process.env.IRIS_CONSOLE_EMAILS || '').split(',')
    .map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email);
}

// Seconds until a limiter key is back under `max` (security.rateLimit counts
// every attempt, refused ones included, in a sliding window).
const qHits = db.prepare('SELECT at FROM rate_hits WHERE key = ? ORDER BY at');
function retryAfter(key, max, windowMs) {
  const hits = qHits.all(key);
  const oldest = hits[Math.max(0, hits.length - max)];
  const at = oldest ? oldest.at : Date.now();
  return Math.max(1, Math.ceil((at + windowMs - Date.now()) / 1000));
}

// A one-time signed WebSocket URL for the agent. The key stays here.
async function signedConversation() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${SIGNED_URL}?agent_id=${encodeURIComponent(process.env.IRIS_CONSOLE_AGENT_ID)}&include_conversation_id=true`;
    const r = await fetch(url, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, signal: ctrl.signal });
    if (!r.ok) throw new Error('ElevenLabs HTTP ' + r.status);
    const d = await r.json();
    if (!d || typeof d.signed_url !== 'string' || !d.signed_url) throw new Error('ElevenLabs reply has no signed_url');
    // The documented reply is { signed_url } only, so the conversation id may
    // ride in the signed URL's query string instead of the body.
    let cid = d.conversation_id;
    if (!cid) {
      try { cid = new URL(d.signed_url).searchParams.get('conversation_id'); } catch (_) { cid = null; }
    }
    return { signedUrl: d.signed_url, conversationId: cid ? String(cid) : null };
  } finally {
    clearTimeout(timer);
  }
}

function register(app) {
  app.get('/marketplace/me', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const email = sessionEmail(req);
    if (!email) return res.status(401).json({ error: 'login_required' });
    try {
      res.json({ ...(await accountContext(email)), irisEnabled: enabledFor(email) });
    } catch (err) {
      if (err && err.status) return res.status(err.status).json({ error: err.error });
      console.warn('[iris] /marketplace/me failed:', err && err.message);
      res.status(503).json({ error: 'unavailable' });
    }
  });

  app.get('/marketplace/iris/session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const email = sessionEmail(req);
    // Not audited: without a session there is nothing to protect, and a row
    // per anonymous request would let anyone grow audit_log on the disk.
    if (!email) return res.status(401).json({ error: 'login_required' });
    const done = (outcome, detail) => security.audit(req, 'iris.session', { email, outcome, detail });
    if (!enabledFor(email)) {
      done('disabled');
      return res.status(404).json({ error: 'not_enabled' });
    }
    const limits = [
      ['iris:h:' + email, 20, HOUR],
      ['iris:d:' + email, 60, DAY],
      ['iris:ip:' + (security.clientIp(req) || 'unknown'), 60, HOUR],
    ];
    const over = limits.find(([key, max, windowMs]) => security.rateLimit(key, max, windowMs));
    if (over) {
      const retryAfterSeconds = retryAfter(...over);
      done('rate_limited', over[0].split(':')[1]);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'rate_limited', retryAfterSeconds });
    }

    let context;
    try {
      context = await accountContext(email);
    } catch (err) {
      const status = (err && err.status) || 503;
      const error = (err && err.error) || 'unavailable';
      done(error === 'not_approved' ? 'not_approved' : 'unavailable', 'account lookup');
      return res.status(status).json(status === 503
        ? { error: 'unavailable', message: 'Account lookup is unavailable, try again shortly.' }
        : { error });
    }
    if (!process.env.ELEVENLABS_API_KEY || !process.env.IRIS_CONSOLE_AGENT_ID) {
      done('unavailable', 'not configured');
      return res.status(503).json({ error: 'unavailable', message: 'Iris is not configured on this gateway.' });
    }
    let conv;
    try {
      conv = await signedConversation();
    } catch (err) {
      const why = err && err.name === 'AbortError' ? 'timeout' : String((err && err.message) || err);
      console.warn('[iris] signed URL failed:', why);
      done('unavailable', why);
      return res.status(503).json({ error: 'unavailable', message: 'Iris is unavailable right now, try again shortly.' });
    }
    done('ok', conv.conversationId ? 'conversation ' + conv.conversationId : null);
    res.json({
      signedUrl: conv.signedUrl,
      conversationId: conv.conversationId,
      userId: crypto.createHash('sha256').update(email).digest('hex').slice(0, 16),
      context,
    });
  });
}

module.exports = { register, accountContext, cleanFirstName, firstNameFor };
