'use strict';

/**
 * Espresso REST API client (https://api.espressodid.com/ws/v1/...).
 *
 * Espresso's new API replaces the SOAP methods in lib/soap.js. It serves the
 * DID Orders product (lib/routes/did-orders.js) and LRN Lookup
 * (lib/routes/lrn.js). As with SOAP there are two separate systems, sandbox
 * and production: partners always use production, staff and internal callers
 * may pick (edidEnv in lib/entitlements.js: 'test' = sandbox). They
 * share no data, so company and routing-profile ids are set per system.
 *
 * Login is OAuth2 (password grant) at /ws/v1/auth/token. Espresso keeps at
 * most 5 live tokens per login and revokes the oldest when a sixth is made,
 * so each system's token is cached here and renewed with its refresh token.
 * OnlineOrdering logs in with the same kind of login; with one shared login,
 * each service holds its own token and they don't revoke each other.
 *
 * Configure with:
 *   ESPRESSO_CLIENT_ID / ESPRESSO_CLIENT_SECRET     OAuth client (both systems)
 *   ESPRESSO_REST_USER / ESPRESSO_REST_PASS         login (default EDID_USER / EDID_PASS)
 *   ESPRESSO_COMPANY_ID                             production company (default: the login's only active company)
 *   ESPRESSO_SANDBOX_COMPANY_ID                     sandbox company (same default, looked up on the sandbox)
 *   ESPRESSO_SANDBOX_CLIENT_ID, _CLIENT_SECRET, _REST_USER, _REST_PASS
 *                                                   only when the sandbox login differs
 *   ESPRESSO_REST_URL / ESPRESSO_SANDBOX_REST_URL   host overrides (tests)
 * The products are published as 'preview' (503 not_enabled) until the
 * production system has a client id, secret and login (lib/catalogs).
 */

const axios = require('axios');
const { AppError } = require('./soap');

const HOSTS = { test: 'https://api-sandbox.espressodid.com', production: 'https://api.espressodid.com' };
const COMPANY_TTL_MS = 60 * 60 * 1000;

// Paths that Espresso's web server doesn't route to the API as published.
// /ws/v1/dids/orders is answered by nginx with a 301 to /ws/v1/dids/orders/,
// a static Swagger docs folder (GET 200 HTML, POST 405), so creating and
// listing orders never reach the app. The app's front controller does
// answer at /index.php/ws/v1/dids/orders (seen 2026-10-21 on both hosts).
// Single orders (/dids/orders/{id}...) and every other path work as published.
const ROUTED = { '/dids/orders': '/index.php/ws/v1/dids/orders' };

function settings(env) {
  const sb = env === 'test';
  const cred = (name) => (sb && process.env[`ESPRESSO_SANDBOX_${name}`]) || process.env[`ESPRESSO_${name}`] || '';
  return {
    base: String((sb ? process.env.ESPRESSO_SANDBOX_REST_URL : process.env.ESPRESSO_REST_URL) || HOSTS[sb ? 'test' : 'production']).replace(/\/+$/, ''),
    clientId: cred('CLIENT_ID'),
    clientSecret: cred('CLIENT_SECRET'),
    username: cred('REST_USER') || process.env.EDID_USER || '',
    password: cred('REST_PASS') || process.env.EDID_PASS || '',
    // A record of one system: never borrowed from the other.
    companyId: (sb ? process.env.ESPRESSO_SANDBOX_COMPANY_ID : process.env.ESPRESSO_COMPANY_ID) || '',
  };
}

// Is this system ready to call? With no env: is either one?
function configured(env) {
  if (!env) return configured('production') || configured('test');
  const s = settings(env);
  return !!(s.clientId && s.clientSecret && s.username && s.password);
}

const notEnabled = () => new AppError(503, 'not_enabled',
  'This API isn\'t switched on yet. Iristel is finishing the connection to Espresso\'s new API; try again once it is live.');

// The error Espresso sent, as an AppError with the same HTTP status.
// Espresso errors look like { errors: [{ type, code, message, path }] }.
function upstreamError(status, data, raw) {
  const errs = data && Array.isArray(data.errors) ? data.errors : [];
  const text = String(raw || '').trim();
  const message = errs.map((e) => e && e.message).filter(Boolean).join(' ')
    || (data && (data.detail || data.title)) || (text && !text.startsWith('<') ? text.slice(0, 200) : '')
    || `Espresso answered HTTP ${status}.`;
  const meta = { espressoStatus: status };
  if (errs[0] && errs[0].code != null) meta.code = errs[0].code;
  if (errs.length) meta.errors = errs.slice(0, 10);
  return new AppError(status, 'espresso_error', message, meta);
}

// One HTTP call. Redirects are not followed: Espresso's API answers in place,
// and a redirect means the request was sent to something that isn't the API.
async function send(method, url, { headers = {}, data, form } = {}) {
  let body = data;
  const h = { accept: 'application/json', ...headers };
  if (form) {
    body = new URLSearchParams(form).toString();
    h['content-type'] = 'application/x-www-form-urlencoded';
  } else if (data !== undefined) {
    body = JSON.stringify(data);
    h['content-type'] = 'application/json';
  }
  let r;
  try {
    r = await axios({
      method, url, headers: h, data: body,
      timeout: 30000, responseType: 'text', transformResponse: (x) => x,
      validateStatus: () => true, maxRedirects: 0,
    });
  } catch (err) {
    console.warn('[espresso-rest] no answer:', method, url.replace(/\?.*/, ''), err.message);
    throw new AppError(504, 'upstream_unreachable', 'Espresso did not respond. Try again in a moment.');
  }
  if (r.status >= 300 && r.status < 400) {
    const path = new URL(url).pathname;
    console.warn('[espresso-rest] redirected:', method, path, '->', r.headers && r.headers.location);
    throw new AppError(502, 'bad_gateway', 'Espresso sent this request somewhere other than its API. Contact Iristel support.',
      { misrouted: true });
  }
  let json;
  try { json = r.data === '' || r.data == null ? {} : JSON.parse(r.data); } catch { json = undefined; }
  return { status: r.status, data: json, raw: r.data };
}

// ---- login ---------------------------------------------------------------
const tokens = {};    // env -> { access, refresh, expiresAt }
const pending = {};   // env -> in-flight login, shared by concurrent callers

async function requestToken(env, grant) {
  const s = settings(env);
  const r = await send('POST', `${s.base}/ws/v1/auth/token`, {
    form: { client_id: s.clientId, client_secret: s.clientSecret, ...grant },
  });
  if (r.status !== 200 || !r.data || !r.data.access_token) {
    const why = (r.data && (r.data.error_description || r.data.error)) || `HTTP ${r.status}`;
    console.warn(`[espresso-rest] ${env} login failed:`, why);
    throw new AppError(401, 'espresso_auth', `The gateway could not sign in to Espresso (${why}). Your key and login are fine; contact Iristel support.`);
  }
  return {
    access: r.data.access_token,
    refresh: r.data.refresh_token || null,
    expiresAt: Date.now() + (Number(r.data.expires_in) || 3600) * 1000,
  };
}

async function token(env) {
  const t = tokens[env];
  if (t && t.expiresAt - 60 * 1000 > Date.now()) return t.access;
  if (!pending[env]) {
    pending[env] = (async () => {
      const s = settings(env);
      if (t && t.refresh) {
        try { return await requestToken(env, { grant_type: 'refresh_token', refresh_token: t.refresh }); }
        catch { /* refresh token expired or revoked: log in again */ }
      }
      return requestToken(env, { grant_type: 'password', username: s.username, password: s.password });
    })().then((fresh) => { tokens[env] = fresh; return fresh.access; })
      .finally(() => { delete pending[env]; });
  }
  return pending[env];
}

/**
 * Calls Espresso and returns { status, data } for a 2xx answer; any other
 * answer throws an AppError with Espresso's status and message. `path` is
 * under /ws/v1, e.g. '/dids/orders'. A 401 (token revoked) logs in again
 * and retries once.
 */
async function request(env, method, path, { query, body } = {}) {
  if (!configured(env)) throw notEnabled();
  const s = settings(env);
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  const url = `${s.base}${ROUTED[path] || `/ws/v1${path}`}${qs ? `?${qs}` : ''}`;
  for (let attempt = 0; ; attempt++) {
    const used = await token(env);
    const r = await send(method, url, { headers: { authorization: `Bearer ${used}` }, data: body });
    if (r.status === 401 && attempt === 0) {
      // Drop the token only if nobody has replaced it meanwhile, so a burst
      // of 401s on one revoked token makes one new login, not one each.
      if (tokens[env] && tokens[env].access === used) delete tokens[env];
      continue;
    }
    if (r.status >= 200 && r.status < 300) {
      if (r.data === undefined) throw new AppError(502, 'bad_gateway', 'Espresso answered in an unexpected format.');
      return { status: r.status, data: r.data };
    }
    if (r.status === 401) {
      throw new AppError(401, 'espresso_auth', 'Espresso refused the gateway\'s login. Your key and login are fine; contact Iristel support.');
    }
    throw upstreamError(r.status, r.data, r.raw);
  }
}

// ---- Iristel's company --------------------------------------------------
// Every Espresso call names the company (Iristel's). Set it per system, or
// the login's only active company on that system is used.
const companies = {};   // env -> { id, at }
async function companyId(env) {
  const set = settings(env).companyId;
  if (set) return set;
  const hit = companies[env];
  if (hit && Date.now() - hit.at < COMPANY_TTL_MS) return hit.id;
  const { data } = await request(env, 'GET', '/general/companies');
  const list = (Array.isArray(data) ? data : (data && data.data) || []).filter((c) => c && c.id && c.active !== false);
  if (list.length !== 1) {
    const name = env === 'test' ? 'ESPRESSO_SANDBOX_COMPANY_ID' : 'ESPRESSO_COMPANY_ID';
    throw new AppError(503, 'not_ready', `The Espresso login has ${list.length} active companies, so the gateway can't tell which one is Iristel's. Set ${name}.`);
  }
  companies[env] = { id: list[0].id, at: Date.now() };
  return list[0].id;
}

module.exports = { configured, request, companyId, notEnabled, HOSTS };
