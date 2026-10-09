'use strict';

/**
 * Server-side entitlement check and usage metering for /api/*.
 *
 * Every call must identify its caller — a console session or a partner API
 * key (see lib/session.js) — and the product the path belongs to must be one
 * the caller's CRM account is approved for. Staff may call everything.
 *
 * Each call is then written to the usage ledger (lib/db.js) and priced from
 * lib/catalogs/pricing.js. Everyone pays except Iristel staff and internal
 * employees (and the internal key). Paying callers run in one of two modes,
 * and the card on file is the switch:
 *
 *   sandbox     no card yet, and the partner chose "Sandbox -> Production" on
 *               the request form. SANDBOX_CALLS free calls in total, never
 *               billed. Espresso (DIDs/LNP) runs on its test system; products
 *               with no test system are read-only (GET).
 *   production  a card on file. Every call runs live and is billable. A
 *               partner who chose "Production" needs a card before the first
 *               call (402 otherwise).
 *
 * The mode is returned on every call as X-Marketplace-Mode, and sandbox calls
 * left as X-Sandbox-Calls-Remaining.
 *
 * GATEWAY_API_KEY, when set, still works as an internal override for
 * Iristel's own server-to-server callers (X-API-Key header).
 */

const { callerEmail, isAdmin } = require('./session');
const { lookupAuthorization } = require('./onboarding');
const { matchEndpoint, priceFor } = require('./catalogs/pricing');
const db = require('./db');
const { clientIp } = require('./security');

// Which marketplace product a /api path belongs to. Paths are relative to
// the /api mount.
function productForPath(p) {
  if (p.startsWith('/lnp/') || p === '/lnp') return 'lnp-enterprise';
  if (p.startsWith('/wlnp/') || p === '/wlnp') return 'lnp-wireless';
  const ix = p.match(/^\/ix\/([^/]+)/);
  if (ix) return ix[1];
  return 'dids';
}

// Products served by Espresso, which has separate test and production
// systems. Everything else only has a live system.
const ESPRESSO = new Set(['dids', 'lnp-enterprise']);
const SANDBOX_CALLS = 30;
const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

// Espresso system for a call. Partners get the one their mode dictates;
// staff and internal callers may still pick with X-EDID-Env (test default).
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
  (at, month, email, mind_account, product, method, path, status, ms, billable, price_cents, mode, ip, user_agent)
  VALUES (@at, @month, @email, @mind_account, @product, @method, @path, @status, @ms, @billable, @price_cents, @mode, @ip, @user_agent)`);
const getProfile = db.prepare('SELECT token, past_due FROM billing_profiles WHERE email = ?');
const sandboxUsed = db.prepare(`SELECT COUNT(*) AS n FROM usage WHERE email = ? AND mode = 'sandbox'`);
// Sandbox calls still running (metered on finish), so parallel calls can't
// slip past the limit.
const sandboxInFlight = new Map();

// mode: 'sandbox' | 'production' for paying partners, null for exempt callers.
// Only successful production calls are billable.
function meter(req, res, { email, mindAccount, product, endpointKey, price, mode }) {
  const started = Date.now();
  res.on('finish', () => {
    try {
      const at = new Date().toISOString();
      const billable = mode === 'production' && res.statusCode >= 200 && res.statusCode < 300;
      insertUsage.run({
        at, month: at.slice(0, 7), email: email || null, mind_account: mindAccount || null,
        product, method: req.method, path: endpointKey || endpointPathFor(req, product),
        status: res.statusCode, ms: Date.now() - started, billable: billable ? 1 : 0, price_cents: billable ? price : 0,
        mode: mode || null,
        ip: clientIp(req),
        user_agent: String(req.get('User-Agent') || '').slice(0, 300) || null,
      });
    } catch (err) {
      console.warn('[usage] could not record call:', err.message);
    }
  });
}

function requireEntitlement() {
  return async (req, res, next) => {
    const product = productForPath(req.path);
    const endpointKey = matchEndpoint(product, req.method, endpointPathFor(req, product));

    const internal = process.env.GATEWAY_API_KEY;
    if (internal && req.get('X-API-Key') === internal) {
      req.marketplace = { email: null, internal: true };
      meter(req, res, { product, endpointKey, price: 0, mode: null });
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
      req.marketplace = { email, product, internal: false };
      meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, price: 0, mode: null });
      return next();
    }

    const pay = (message) => res.status(402).json({ error: 'payment_required', message });
    const profile = getProfile.get(email);
    if (profile && profile.past_due)
      return pay('Your last payment did not go through. Update your card in the console under Billing & usage.');

    let mode, edid = null;
    if (profile && profile.token) {
      mode = 'production';
      edid = 'production';
    } else if (auth.environment === 'production') {
      return pay('Add a card in the console under Billing & usage to start calling.');
    } else {
      mode = 'sandbox';
      res.set('X-Marketplace-Mode', mode);
      const used = sandboxUsed.get(email).n + (sandboxInFlight.get(email) || 0);
      const left = Math.max(0, SANDBOX_CALLS - used);
      res.set('X-Sandbox-Calls-Remaining', String(left));
      if (!left)
        return pay(`You've used your ${SANDBOX_CALLS} sandbox calls. Add a card in the console under Billing & usage to go live.`);
      if (ESPRESSO.has(product)) edid = 'test';
      else if (!READ_ONLY.has(req.method))
        return pay('In sandbox this API is read-only (it has no test system). Add a card in the console under Billing & usage to make changes.');
      res.set('X-Sandbox-Calls-Remaining', String(left - 1));   // after this call
    }
    res.set('X-Marketplace-Mode', mode);
    if (mode === 'sandbox') {
      sandboxInFlight.set(email, (sandboxInFlight.get(email) || 0) + 1);
      res.on('close', () => {
        const n = (sandboxInFlight.get(email) || 1) - 1;
        if (n > 0) sandboxInFlight.set(email, n); else sandboxInFlight.delete(email);
      });
    }

    req.marketplace = { email, product, internal: false, mode, edidEnv: edid };
    meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, price: priceFor(product, endpointKey), mode });
    next();
  };
}

module.exports = { requireEntitlement, productForPath, edidEnv, SANDBOX_CALLS, ESPRESSO };
