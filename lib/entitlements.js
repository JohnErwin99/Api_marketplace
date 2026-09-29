'use strict';

/**
 * Server-side entitlement check and usage metering for /api/*.
 *
 * Every call must identify its caller — a console session or a partner API
 * key (see lib/session.js) — and the product the path belongs to must be one
 * the caller's CRM account is approved for. Staff may call everything.
 *
 * Each call is then written to the usage ledger (lib/db.js) and priced from
 * lib/catalogs/pricing.js. A call is billable when it succeeded (2xx), was
 * made by a partner (not staff, not an internal key) and hit a live system —
 * Espresso test-environment calls (DIDs/LNP, as the console uses) are free.
 * Calls with a price need a card on file (402 otherwise).
 *
 * GATEWAY_API_KEY, when set, still works as an internal override for
 * Iristel's own server-to-server callers (X-API-Key header).
 */

const { callerEmail, isAdmin } = require('./session');
const { lookupAuthorization } = require('./onboarding');
const { matchEndpoint, priceFor } = require('./catalogs/pricing');
const db = require('./db');

// Which marketplace product a /api path belongs to. Paths are relative to
// the /api mount.
function productForPath(p) {
  if (p.startsWith('/lnp/') || p === '/lnp') return 'lnp-enterprise';
  if (p.startsWith('/wlnp/') || p === '/wlnp') return 'lnp-wireless';
  const ix = p.match(/^\/ix\/([^/]+)/);
  if (ix) return ix[1];
  return 'dids';
}

// Products served by Espresso, which has separate test and production systems.
const ESPRESSO = new Set(['dids', 'lnp-enterprise']);
const espressoEnv = (req) =>
  String(req.get('X-EDID-Env') || req.query.env || process.env.EDID_ENV || 'test').toLowerCase() === 'production'
    ? 'production' : 'test';

// The path the catalog uses for this request (see pricing.matchEndpoint).
function endpointPathFor(req, product) {
  const ix = req.path.match(/^\/ix\/[^/]+(\/.*)?$/);
  if (ix) return ix[1] || '/';
  return '/api' + req.path;
}

const insertUsage = db.prepare(`INSERT INTO usage
  (at, month, email, mind_account, product, method, path, status, ms, billable, price_cents)
  VALUES (@at, @month, @email, @mind_account, @product, @method, @path, @status, @ms, @billable, @price_cents)`);
const getProfile = db.prepare('SELECT token, past_due FROM billing_profiles WHERE email = ?');

function meter(req, res, { email, mindAccount, product, endpointKey, price, partner }) {
  const started = Date.now();
  res.on('finish', () => {
    try {
      const at = new Date().toISOString();
      const live = !(ESPRESSO.has(product) && espressoEnv(req) === 'test');
      const billable = partner && live && res.statusCode >= 200 && res.statusCode < 300;
      insertUsage.run({
        at, month: at.slice(0, 7), email: email || null, mind_account: mindAccount || null,
        product, method: req.method, path: endpointKey || endpointPathFor(req, product),
        status: res.statusCode, ms: Date.now() - started, billable: billable ? 1 : 0, price_cents: billable ? price : 0,
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
      meter(req, res, { product, endpointKey, price: 0, partner: false });
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

    const staff = isAdmin(email);
    const price = priceFor(product, endpointKey);
    if (price > 0 && !staff) {
      const profile = getProfile.get(email);
      if (!profile || !profile.token || profile.past_due) {
        return res.status(402).json({
          error: 'payment_required',
          message: profile && profile.past_due
            ? 'Your last payment did not go through. Update your card in the console under Billing & usage.'
            : 'This call is billed. Add a card in the console under Billing & usage.',
        });
      }
    }

    req.marketplace = { email, product, internal: false };
    meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, price, partner: !staff });
    next();
  };
}

module.exports = { requireEntitlement, productForPath };
