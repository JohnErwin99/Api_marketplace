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

// ---- sign-up data checks --------------------------------------------------
// MIND's POST /accounts rejects bad address data with a 400, so everything it
// validates is checked (and normalized) here first:
//   country     2-letter code ("Canada" -> CA, "USA" -> US)
//   province    2-letter code for CA/US ("Quebec" -> QC)
//   postalCode  Canadian "A1A 1A1"
//   phone       an object { mobile }, never a string
const COUNTRIES = { CANADA: 'CA', CAN: 'CA', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', USA: 'US' };
const PROVINCES = {
  ALBERTA: 'AB', 'BRITISH COLUMBIA': 'BC', MANITOBA: 'MB', 'NEW BRUNSWICK': 'NB',
  'NEWFOUNDLAND AND LABRADOR': 'NL', NEWFOUNDLAND: 'NL', 'NOVA SCOTIA': 'NS', ONTARIO: 'ON',
  'PRINCE EDWARD ISLAND': 'PE', QUEBEC: 'QC', 'QUÉBEC': 'QC', SASKATCHEWAN: 'SK',
  'NORTHWEST TERRITORIES': 'NT', NUNAVUT: 'NU', YUKON: 'YT',
};
function normalizeContact(input) {
  const c = { ...(input || {}) };
  const up = (v) => String(v || '').trim().toUpperCase();
  for (const f of ['fname', 'lname', 'address1', 'city']) {
    if (!String(c[f] || '').trim()) return { error: 'Fill in first name, last name, address and city.' };
  }
  c.country = COUNTRIES[up(c.country)] || up(c.country);
  if (!/^[A-Z]{2}$/.test(c.country)) return { error: 'Choose a country.' };
  c.province = PROVINCES[up(c.province)] || up(c.province);
  if ((c.country === 'CA' || c.country === 'US') && !/^[A-Z]{2}$/.test(c.province))
    return { error: 'Province should be a 2-letter code, e.g. ON or QC.' };
  if (c.country === 'CA') {
    const pc = up(c.postalCode).replace(/\s+/g, '');
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(pc)) return { error: 'Postal code should look like A1A 1A1.' };
    c.postalCode = pc.slice(0, 3) + ' ' + pc.slice(3);
  } else if (!String(c.postalCode || '').trim()) {
    return { error: 'Fill in the postal code.' };
  }
  if (typeof c.phone === 'string') {
    if (c.phone.trim()) c.phone = { mobile: c.phone.trim() };
    else delete c.phone;
  }
  return { contact: c };
}

// MIND's validation message ("Invalid postalCode format…"), for the page.
const mindReason = (d) => (d && ((d.errors && d.errors[0] && d.errors[0].message) || d.message)) || '';
const createKeyName = (accountType) =>
  ['reseller', 'white-label'].includes(accountType) ? 'MIND_RESELL_KEY' : 'MIND_API_KEY';
async function ixJson(path, { method = 'GET', key, body }) {
  const r = await fetch(IX_BASE + path, {
    method,
    headers: { 'x-api-key': key, 'iristelx-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: r.status, ok: r.ok, json };
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
  // Complete sign-up in the safe order. Everything is validated first; then
  // the MIND billing account is created (the step most likely to reject
  // data); only when that succeeds is the login created. So a data problem
  // never leaves a login without a billing account.
  //   400 { error }                 bad data or MIND rejected it — nothing created
  //   409 { error: 'exists' | 'employee', name }
  //   200 { accountId, id, providerCode, loginCreated | loginExists }
  //   502 { error, accountId }       billing account created, login failed
  app.post('/portal/signup', async (req, res) => {
    const b = req.body || {};
    const email = lower(b.email);
    const password = String(b.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!b.account || typeof b.account !== 'object') return res.status(400).json({ error: 'Account details are missing.' });
    if (/@(iristel|telehop)\.com$/i.test(email))
      return res.status(400).json({ error: 'Iristel / Telehop staff don\'t sign up here — use the login page.' });
    const checked = normalizeContact(b.account.contact);
    if (checked.error) return res.status(400).json({ error: checked.error });
    if (limited(req, res, 'signup', 10)) return;

    const loginKey = need(res, 'IRISTELX_API_KEY'); if (!loginKey) return;
    const searchKey = need(res, 'MIND_SEARCH_KEY'); if (!searchKey) return;
    const createKey = need(res, createKeyName(b.accountType)); if (!createKey) return;

    let out = null;   // set once the billing account exists
    try {
      // Already staff, or already a MIND account holder (exact email only —
      // the MIND search also matches other people's service lines)?
      const emp = await ixJson('/employees?email=' + encodeURIComponent(email), { key: loginKey });
      if (emp.ok && emp.json && (emp.json.data || []).length) return res.status(409).json({ error: 'employee' });
      const found = await ixJson('/?email=' + encodeURIComponent(email), { key: searchKey });
      let body = found.json && found.json.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      const mine = ((body && body.accounts) || []).find((a) => lower(a.email) === email);
      if (mine) return res.status(409).json({ error: 'exists', name: mine.name || '', accountId: mine.accountId || '' });

      // 1. Billing account. A rejection here means nothing was created.
      const created = await ixJson('/accounts', {
        method: 'POST', key: createKey,
        body: { ...b.account, contact: { ...checked.contact, emailAddress: email } },
      });
      if (!created.ok) {
        console.warn(`[portal] signup: MIND rejected account for ${email}: HTTP ${created.status} ${mindReason(created.json)}`);
        return res.status(400).json({ error: mindReason(created.json) || 'Your details were not accepted. Check them and try again.' });
      }
      const cb = (created.json && created.json.body) || created.json || {};
      const acct = (cb.accounts && cb.accounts[0]) || cb.account || cb;
      out = {
        accountId: acct.accountId || acct.account_code || acct.code || '',
        id: acct.id || '', providerCode: acct.providerCode || '',
      };

      // 2. Login, only now that the billing account exists.
      const login = await ixJson('/unified/sign-up', { method: 'POST', key: loginKey, body: { email, password } });
      if (login.status === 409) return res.json({ ...out, loginExists: true });
      if (!login.ok) {
        console.warn(`[portal] signup: account ${out.accountId} created but login failed for ${email}: HTTP ${login.status}`);
        return res.status(502).json({ ...out, error: 'Your billing account was created, but your login could not be. Contact support to finish activation.' });
      }
      res.json({ ...out, loginCreated: true });
    } catch (err) {
      console.warn('[portal] signup failed:', err.message);
      if (out) return res.status(502).json({ ...out, error: 'Your billing account was created, but your login could not be. Contact support to finish activation.' });
      res.status(502).json({ error: 'Sign-up service unavailable. Nothing was created — try again shortly.' });
    }
  });

  app.post('/portal/accounts', async (req, res) => {
    const b = req.body || {};
    const email = lower(b.email);
    if (!email || !b.password || !b.account) return res.status(400).json({ error: 'email, password and account are required' });
    if (limited(req, res, 'create', 10)) return;
    const checked = normalizeContact(b.account.contact);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const loginKey = need(res, 'IRISTELX_API_KEY'); if (!loginKey) return;
    // Resellers and white-label partners bill their own customers (RESELL
    // provider); business customers, agents and consumers use the agent-side
    // provider.
    const keyName = createKeyName(b.accountType);
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
    const account = { ...b.account, contact: { ...checked.contact, emailAddress: email } };
    relay(res, '/accounts', { method: 'POST', key, body: account });
  });
}

module.exports = { register, normalizeContact };
