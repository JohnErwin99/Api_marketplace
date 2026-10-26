'use strict';

/**
 * Server-side entitlement check and usage metering for /api/*.
 *
 * Every call must identify its caller — a console session or a partner API
 * key (see lib/session.js) — and the product the path belongs to must be one
 * the caller's CRM account is approved for. Staff may call everything.
 *
 * Pricing is per event (lib/catalogs/pricing.js): each catalog operation has
 * a rate class. Iristel staff and internal employees (and the internal key)
 * are never billed. A partner call runs in one of two modes:
 *
 *   live     the default. Free reads and service orders need no card;
 *            Standard (1¢) and Advanced (2.5¢) events need a card on file,
 *            else 402. Only successful (2xx) calls are billable, and a
 *            repeated Idempotency-Key is billed once.
 *   sandbox  asked for with "X-Marketplace-Mode: sandbox". SANDBOX_CALLS
 *            calls per CRM account per calendar month (plus any staff
 *            extension, lib/sandbox.js), never billed; past the allowance,
 *            429. Non-production only: Enterprise LNP runs on Espresso's
 *            test system (DID Orders and LRN too once their sandbox login
 *            is set); every other product, coming-soon ones included, is
 *            answered by the gateway with sample data
 *            (lib/catalogs/samples.js, X-Marketplace-Sample: true) and
 *            never reaches a live system.
 *
 * The mode, the call's rate and the sandbox calls left come back on every
 * answer as X-Marketplace-Mode, X-Marketplace-Price and
 * X-Sandbox-Calls-Remaining.
 *
 * GATEWAY_API_KEY, when set, still works as an internal override for
 * Iristel's own server-to-server callers (X-API-Key header).
 */

const { callerEmail, isAdmin } = require('./session');
const { lookupAuthorization } = require('./onboarding');
const { matchEndpoint, rateFor, endpointOf, paramsFor, SANDBOX_CALLS, cents } = require('./catalogs/pricing');
const sandbox = require('./sandbox');
const db = require('./db');
const { clientIp } = require('./security');
const crypto = require('crypto');

// Which marketplace product a /api path belongs to. Paths are relative to
// the /api mount. Classified in lower case so a path's letter case can't
// change its product (routing is case-sensitive too, see server.js).
function productForPath(path) {
  const p = String(path).toLowerCase();
  if (p.startsWith('/lnp/') || p === '/lnp') return 'lnp-enterprise';
  if (p.startsWith('/wlnp/') || p === '/wlnp') return 'lnp-wireless';
  if (p.startsWith('/did-orders/') || p === '/did-orders') return 'did-orders';
  if (p.startsWith('/lrn/') || p === '/lrn') return 'lrn';
  if (p.startsWith('/broadworks/') || p === '/broadworks') return 'broadworks';
  const ix = p.match(/^\/ix\/([^/]+)/);
  if (ix) return ix[1];
  return null;   // no product (the old SOAP DIDs paths were retired)
}

// Products served by Espresso (SOAP or REST), which has separate test and
// production systems. Everything else only has a live system.
const ESPRESSO = new Set(['lnp-enterprise', 'did-orders', 'lrn']);

// Products published ahead of their upstream ('preview' in lib/catalogs):
// calls are refused before they are metered.
const { PRODUCTS } = require('./catalogs');
const PREVIEW = new Set(PRODUCTS.filter((p) => p.status === 'preview').map((p) => p.id));
// "Create Account (IristelX · Accounts & Services)" for an endpoint key, in messages.
const OP_NAMES = new Map(PRODUCTS.flatMap((p) => (p.endpoints || []).map((e) =>
  [`${p.id} ${e.method.toUpperCase()} ${e.path}`, `${e.summary || `${e.method.toUpperCase()} ${e.path}`} (${p.name})`])));
// Espresso REST products also need the caller's own system (sandbox or
// production) configured; one that isn't is refused the same way.
const espressoRest = require('./espresso-rest');
const ESPRESSO_REST = new Set(['did-orders', 'lrn']);
const restOff = (product, env) => ESPRESSO_REST.has(product) && !espressoRest.configured(env);
// Espresso system for a call. Partners always get production; staff and
// internal callers may still pick with X-EDID-Env (test default).
function edidEnv(req) {
  const forced = req.marketplace && req.marketplace.edidEnv;
  if (forced) return forced;
  return String(req.get('X-EDID-Env') || req.query.env || process.env.EDID_ENV || 'test').toLowerCase() === 'production'
    ? 'production' : 'test';
}

// The path the catalog uses for this request (see pricing.matchEndpoint).
function endpointPathFor(req, product) {
  const ix = req.path.match(/^\/ix\/[^/]+(\/.*)?$/);
  if (ix) return ix[1] || '/';
  return '/api' + req.path;
}

const insertUsage = db.prepare(`INSERT INTO usage
  (at, month, email, mind_account, product, method, path, status, ms, billable, price_cents, mode, ip, user_agent, rate_class, idem_key, sandbox_key)
  VALUES (@at, @month, @email, @mind_account, @product, @method, @path, @status, @ms, @billable, @price_cents, @mode, @ip, @user_agent, @rate_class, @idem_key, @sandbox_key)`);
const getProfile = db.prepare('SELECT token, past_due FROM billing_profiles WHERE email = ?');
// A billable call already made with this Idempotency-Key in the last day.
const billedBefore = db.prepare(`SELECT 1 FROM usage WHERE email = ? AND idem_key = ? AND billable = 1 AND at >= ? LIMIT 1`);
// Sandbox calls still running (metered when they answer), by sandbox key,
// so parallel calls can't overrun the allowance.
const sandboxInFlight = new Map();
const IDEM_WINDOW_MS = 24 * 60 * 60 * 1000;

// The Idempotency-Key as stored: the caller's key plus a fingerprint of the
// request (method, path, query, body), so a key only waives billing for a
// true retry of the same request, never for a different one. Ignored on
// GET: a repeated read is a new lookup.
function idemKeyFor(req) {
  const key = String(req.get('Idempotency-Key') || '').trim().slice(0, 200);
  if (!key || req.method === 'GET' || req.method === 'HEAD') return null;
  const print = crypto.createHash('sha256')
    .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body === undefined ? null : req.body)}`)
    .digest('base64url').slice(0, 22);
  return `${key}#${print}`;
}

// mode: 'live' | 'sandbox' for paying partners, null for exempt callers.
// rate: the call's rate class (or null: not in the rate card, never charged).
// Only successful live calls at a non-zero rate are billable.
// The call is recorded when the handler answers (res.end), not when the
// answer reaches the client: a caller who hangs up early has still had the
// work done, and is billed for it. onDone runs once, after recording.
function meter(req, res, { email, mindAccount, product, endpointKey, rate, mode, sandboxKey }, onDone) {
  const started = Date.now();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    try {
      const at = new Date().toISOString();
      const key = idemKeyFor(req);
      let billable = !!(rate && rate.priceCents) && mode === 'live' && res.statusCode >= 200 && res.statusCode < 300;
      // A retry of the same request already billed (within a day) is free.
      if (billable && key && billedBefore.get(email, key, new Date(Date.now() - IDEM_WINDOW_MS).toISOString())) billable = false;
      insertUsage.run({
        at, month: at.slice(0, 7), email: email || null, mind_account: mindAccount || null,
        product, method: req.method, path: endpointKey || endpointPathFor(req, product),
        status: res.statusCode, ms: Date.now() - started, billable: billable ? 1 : 0, price_cents: billable ? rate.priceCents : 0,
        mode: mode || null,
        ip: clientIp(req),
        user_agent: String(req.get('User-Agent') || '').slice(0, 300) || null,
        rate_class: rate ? rate.id : null,
        idem_key: key,
        sandbox_key: mode === 'sandbox' ? sandboxKey || null : null,
      });
    } catch (err) {
      console.warn('[usage] could not record call:', err.message);
    } finally {
      if (onDone) onDone();
    }
  };
  const end = res.end;
  res.end = function (...args) { record(); return end.apply(this, args); };
}

// A sandbox call to a product with no test system: answered here with sample
// data, never sent upstream. Required query and body fields are still
// checked, as the live API would.
let SAMPLES;
const samples = () => (SAMPLES || (SAMPLES = require('./catalogs/samples')));
function sendSample(req, res, product, endpointKey) {
  res.set('X-Marketplace-Sample', 'true');
  const e = endpointOf(product, endpointKey) || {};
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const empty = (v) => v == null || v === '';
  const missing = [
    ...(e.params || []).filter((p) => p.in === 'query' && p.required && empty(req.query[p.name])).map((p) => p.name),
    ...(!e.upload && Array.isArray(e.fields) ? e.fields.filter((f) => f.required && !/[.[]/.test(f.name) && empty(body[f.name])).map((f) => f.name) : []),
  ];
  if (missing.length) {
    return res.status(400).json({ error: 'validation_error', message: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` });
  }
  let s = null;
  try {
    s = samples().sampleFor(product, endpointKey, { params: paramsFor(endpointKey, endpointPathFor(req, product)), query: req.query, body: req.body });
  } catch (err) {
    console.warn(`[sandbox] sample for ${product} ${endpointKey} failed:`, err.message);
  }
  if (!s) s = { status: 200, body: { ok: true, message: 'Sandbox: this operation has no sample data yet. Nothing was sent to a live system.' } };
  if (s.body == null) return res.status(s.status || 204).end();
  // Not JSON (the welcome-letter PDF): sent as bytes, so Express adds no charset.
  if (s.contentType) {
    return res.status(s.status || 200).type(s.contentType).send(Buffer.isBuffer(s.body) ? s.body : Buffer.from(String(s.body)));
  }
  return res.status(s.status || 200).json(s.body);
}
// Staff-only operations (port-out, commission reporting...) stay staff only
// in the sandbox too.
const sampleStaffOnly = (product, endpointKey) => {
  try { return samples().STAFF_ONLY.has(`${product} ${endpointKey}`); } catch { return false; }
};

// A path whose meaning changes once resolved: encoded slash or backslash, a
// literal backslash, or a '.' / '..' segment (plain or percent-encoded). A
// double-encoded slash, backslash or dot (%252f) is refused too, in case an
// upstream decodes twice.
const unsafePath = (p) => /%2f|%5c|\\|%25(2e|2f|5c)/i.test(p) || /(^|\/)(\.|%2e){1,2}(\/|$)/i.test(p);

function requireEntitlement() {
  return (req, res, next) => check(req, res, next).catch((err) => {
    // Never let one bad request take the process down (Express 4 doesn't
    // catch async middleware errors).
    console.warn('[entitlements] check failed:', err && err.message);
    if (!res.headersSent) res.status(500).json({ error: 'internal', message: 'The access check failed; try again.' });
  });
}

// The check itself, for requireEntitlement().
async function check(req, res, next) {
    // Encoded slashes, backslashes and dot segments ('..', '%2e%2e') would let
    // a path be checked as one operation and resolved upstream (fetch's URL
    // parser) as another.
    if (unsafePath(req.path)) return res.status(400).json({ error: 'bad_request', message: 'Encoded slashes, backslashes and dot segments are not allowed in the path.' });
    const product = productForPath(req.path);
    if (!product) return res.status(404).json({ error: 'not_found', message: `No route ${req.method} /api${req.path}` });
    const endpointKey = matchEndpoint(product, req.method, endpointPathFor(req, product));
    const notYet = () => res.status(503).json({
      error: 'not_enabled',
      message: 'This API isn\'t switched on yet; it will work once Iristel switches it on. Meanwhile you can try it in the sandbox (header X-Marketplace-Mode: sandbox), which answers with sample data.',
    });

    const internal = process.env.GATEWAY_API_KEY;
    if (internal && req.get('X-API-Key') === internal) {
      if (PREVIEW.has(product) || restOff(product, edidEnv(req))) return notYet();
      req.marketplace = { email: null, internal: true };
      meter(req, res, { product, endpointKey, rate: null, mode: null });
      return next();
    }
    const email = callerEmail(req);
    if (!email) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Send your marketplace API key as "Authorization: Bearer mk_..." — get it from the API console.',
      });
    }
    let auth;
    try {
      auth = await lookupAuthorization(email);
    } catch (err) {
      console.warn('[entitlements] lookup failed:', err.message);
      return res.status(503).json({ error: 'unavailable', message: 'Access check is unavailable, try again shortly.' });
    }
    if (!auth.approved || !auth.products.includes(product)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `Your marketplace access does not include ${product}. Request it from the API Marketplace page.`,
      });
    }
    // Only Iristel staff and internal employees are never billed. Agents,
    // partners and business customers all pay.
    const staff = isAdmin(email);
    if (staff || auth.isInternal) {
      if (PREVIEW.has(product) || restOff(product, edidEnv(req))) return notYet();
      // admin: a marketplace admin (lib/session.js), as opposed to any approved
      // internal employee; BroadWorks limits cross-enterprise access to admins.
      req.marketplace = { email, product, internal: false, staff: true, admin: staff, accountIds: auth.accountIds || [] };
      meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, rate: null, mode: null });
      return next();
    }

    // Partners only reach catalog operations, matched exactly (method, letter
    // case, no trailing slash): a variant the routers would still serve
    // (HEAD, /path/, /PATH) must not slip past the price.
    if (!endpointKey) return res.status(404).json({ error: 'not_found', message: `No route ${req.method} /api${req.path}` });
    const rate = rateFor(product, endpointKey);
    if (!rate) console.warn(`[pricing] ${product} ${endpointKey} is not in the rate card; not charged`);
    const priced = !!(rate && rate.priceCents);
    const mode = String(req.get('X-Marketplace-Mode') || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
    res.set('X-Marketplace-Mode', mode);
    res.set('X-Marketplace-Price', rate ? `${rate.id} ${rate.priceCents}` : 'unclassified 0');
    const opName = OP_NAMES.get(`${product} ${endpointKey}`) || endpointKey;
    let edid = 'production';

    let sbKey = null, sampled = false;
    if (mode === 'sandbox') {
      sbKey = sandbox.keyFor(email, auth);
      const st = sandbox.stateFor(sbKey);
      const left = Math.max(0, st.limit - st.used - (sandboxInFlight.get(sbKey) || 0));
      res.set('X-Sandbox-Calls-Remaining', String(left));
      if (!left) {
        return res.status(429).json({ error: 'sandbox_limit', message: `Your account has used this month's ${st.limit.toLocaleString('en-CA')} sandbox calls. They reset on the 1st (UTC); Iristel can grant an extension if you need more. Live calls aren't affected.` });
      }
      // A real test system where there is one; sample data everywhere else.
      if (product === 'lnp-enterprise' || (ESPRESSO_REST.has(product) && !restOff(product, 'test'))) {
        edid = 'test';
      } else {
        if (sampleStaffOnly(product, endpointKey)) {
          return res.status(403).json({ error: 'staff_only', message: `${opName} is an Iristel staff operation.` });
        }
        sampled = true;
      }
      res.set('X-Sandbox-Calls-Remaining', String(left - 1));   // after this call
      // Counted as in flight until the call is recorded (when it answers),
      // so a caller who hangs up early still uses the allowance.
      sandboxInFlight.set(sbKey, (sandboxInFlight.get(sbKey) || 0) + 1);
    } else {
      if (PREVIEW.has(product)) return notYet();
      const profile = getProfile.get(email);
      // Past due: only free reads keep working.
      if (profile && profile.past_due && !(rate && rate.id === 'free')) {
        return res.status(402).json({ error: 'payment_required', message: 'Your last payment did not go through. Update your card in the console under Billing & usage; free reads keep working meanwhile.' });
      }
      // Standard and Advanced events are charged to a card.
      if (priced && !(profile && profile.token)) {
        return res.status(402).json({
          error: 'card_required', rateClass: rate.id, priceCents: rate.priceCents,
          message: `${opName} is a ${rate.name} event (${cents(rate.priceCents)} CAD). Add a card in the console under Billing & usage, or try it in the sandbox (X-Marketplace-Mode: sandbox).`,
        });
      }
      if (restOff(product, 'production')) return notYet();
    }

    req.marketplace = { email, product, internal: false, mode, rate: rate ? rate.id : null, edidEnv: edid, accountIds: auth.accountIds || [] };
    meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, rate, mode, sandboxKey: sbKey }, mode === 'sandbox' ? () => {
      const n = (sandboxInFlight.get(sbKey) || 1) - 1;
      if (n > 0) sandboxInFlight.set(sbKey, n); else sandboxInFlight.delete(sbKey);
    } : null);
    if (sampled) return sendSample(req, res, product, endpointKey);
    next();
}

module.exports = { requireEntitlement, productForPath, edidEnv, unsafePath, ESPRESSO, SANDBOX_CALLS };
