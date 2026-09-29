'use strict';

/**
 * Partner portal login / sign-up helpers. The Webflow login and sign-up
 * pages used to call IristelX directly with keys embedded in the page; they
 * call these routes instead and the keys stay on the server. Responses are
 * the upstream JSON unchanged, so the pages parse them exactly as before.
 *
 * Keys (Render env):
 *   IRISTELX_API_KEY  unified log-in / sign-up / forgot-password, employees
 *   MIND_SEARCH_KEY   Get Account By Email (read-only)
 *   MIND_API_KEY      create a customer billing account (agent-side provider)
 *   MIND_RESELL_KEY   create a reseller billing account (RESELL provider)
 */

const { tooMany } = require('./session');

const IX_BASE = 'https://api.iristelx.com';
const lower = (v) => String(v || '').trim().toLowerCase();

function need(res, name) {
  if (process.env[name]) return process.env[name];
  res.status(503).json({ error: `${name} is not configured on this gateway` });
  return null;
}

// Forward to IristelX and relay status + body as-is.
async function relay(res, path, { method = 'GET', key, body }) {
  try {
    const r = await fetch(IX_BASE + path, {
      method,
      headers: { 'x-api-key': key, 'iristelx-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    console.warn('[portal] upstream failed:', path, err.message);
    res.status(502).json({ error: 'Login service unavailable' });
  }
}

// These run before anyone is logged in, so each is rate-limited per IP (and
// per email for password checks) to slow down guessing and enumeration.
function limited(req, res, bucket, max) {
  if (tooMany(`portal:${bucket}:${req.ip}`, max)) {
    res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    return true;
  }
  return false;
}

function register(app) {
  app.post('/portal/login', async (req, res) => {
    const email = lower(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (limited(req, res, 'login', 30)) return;
    if (tooMany('portal:login:' + email, 15)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const key = need(res, 'IRISTELX_API_KEY'); if (!key) return;
    relay(res, '/unified/log-in', { method: 'POST', key, body: { email, password: String(req.body.password || '') } });
  });

  app.post('/portal/sign-up', async (req, res) => {
    const email = lower(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (limited(req, res, 'signup', 30)) return;
    const key = need(res, 'IRISTELX_API_KEY'); if (!key) return;
    relay(res, '/unified/sign-up', { method: 'POST', key, body: { email, password: String(req.body.password || '') } });
  });

  app.post('/portal/forgot-password', async (req, res) => {
    const email = lower(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (limited(req, res, 'forgot', 10)) return;
    const key = need(res, 'IRISTELX_API_KEY'); if (!key) return;
    relay(res, '/unified/forgot-password', { method: 'POST', key, body: { email } });
  });

  app.get('/portal/employee', async (req, res) => {
    const email = lower(req.query.email);
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (limited(req, res, 'lookup', 60)) return;
    const key = need(res, 'IRISTELX_API_KEY'); if (!key) return;
    relay(res, '/employees?email=' + encodeURIComponent(email), { key });
  });

  // Get Account By Email lives on the API root (GET /?email=).
  app.get('/portal/account', async (req, res) => {
    const email = lower(req.query.email);
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (limited(req, res, 'lookup', 60)) return;
    const key = need(res, 'MIND_SEARCH_KEY'); if (!key) return;
    relay(res, '/?email=' + encodeURIComponent(email), { key });
  });

  // Create the MIND billing account at sign-up. The caller must prove the
  // login they just created (email + password), and the account's contact
  // email is forced to that login, so nobody can create accounts in someone
  // else's name. The key decides the providerCode (customer vs reseller).
  app.post('/portal/accounts', async (req, res) => {
    const b = req.body || {};
    const email = lower(b.email);
    if (!email || !b.password || !b.account) return res.status(400).json({ error: 'email, password and account are required' });
    if (limited(req, res, 'create', 10)) return;
    // MIND only accepts Canadian postal codes as "A1A 1A1" / "A1A1A1". Check
    // (and normalize) before anything reaches MIND.
    const c = b.account.contact || {};
    if (String(c.country || '').trim().toUpperCase() === 'CANADA') c.country = 'CA';
    if (String(c.country || '').trim().toUpperCase() === 'CA') {
      const pc = String(c.postalCode || '').toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(pc)) return res.status(400).json({ error: 'Postal code should look like A1A 1A1.' });
      c.postalCode = pc.slice(0, 3) + ' ' + pc.slice(3);
    }
    const loginKey = need(res, 'IRISTELX_API_KEY'); if (!loginKey) return;
    // Resellers and white-label partners bill their own customers (RESELL
    // provider); business customers, agents and consumers use the agent-side
    // provider.
    const keyName = ['reseller', 'white-label'].includes(b.accountType) ? 'MIND_RESELL_KEY' : 'MIND_API_KEY';
    const key = need(res, keyName); if (!key) return;
    try {
      const r = await fetch(IX_BASE + '/unified/log-in', {
        method: 'POST',
        headers: { 'x-api-key': loginKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: String(b.password) }),
      });
      const d = r.ok ? await r.json() : null;
      if (!d || d.auth0Error) return res.status(401).json({ error: 'Wrong email or password' });
    } catch (err) {
      return res.status(502).json({ error: 'Login service unavailable' });
    }
    const contact = { ...(b.account.contact || {}), emailAddress: email };
    // MIND wants the phone as an object ({ mobile }), not a string — older
    // sign-up pages sent a string, which MIND rejects with a 400.
    if (typeof contact.phone === 'string') {
      if (contact.phone.trim()) contact.phone = { mobile: contact.phone.trim() };
      else delete contact.phone;
    }
    const account = { ...b.account, contact };
    relay(res, '/accounts', { method: 'POST', key, body: account });
  });
}

module.exports = { register };
