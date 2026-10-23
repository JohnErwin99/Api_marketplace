'use strict';

/**
 * Server-side entitlement check and usage metering for /api/*.
 *
 * Every call must identify its caller — a console session or a partner API
 * key (see lib/session.js) — and the product the path belongs to must be one
 * the caller's CRM account is approved for. Staff may call everything.
 *
 * Then the caller's package (lib/catalogs/pricing.js; Free, Standard or
 * Premium, from the CRM) must include the endpoint's tier, else 403
 * upgrade_required. Everyone pays except Iristel staff and internal employees
 * (and the internal key), and there are no per-call charges:
 *
 *   free        the Free package: Free endpoints only, no card needed, never
 *               billed.
 *   production  Standard or Premium with a card on file. The package's
 *               monthly fee is invoiced for every month it was active
 *               (package_months, lib/invoices.js). Without a card: 402.
 *
 * Partners always run on the live systems (Espresso production). Every call
 * is still written to the usage ledger (lib/db.js) for the dashboards, at
 * price 0. The mode and package are returned on every call as
 * X-Marketplace-Mode and X-Marketplace-Package.
 *
 * GATEWAY_API_KEY, when set, still works as an internal override for
 * Iristel's own server-to-server callers (X-API-Key header).
 */

const { callerEmail, isAdmin } = require('./session');
const { lookupAuthorization } = require('./onboarding');
const { matchEndpoint, tierFor, packageAllows, packageOf, PACKAGES, higherPackage } = require('./catalogs/pricing');
const db = require('./db');
const { clientIp } = require('./security');

// Which marketplace product a /api path belongs to. Paths are relative to
// the /api mount. Classified in lower case so a path's letter case can't
// change its product (routing is case-sensitive too, see server.js).
function productForPath(path) {
  const p = String(path).toLowerCase();
  if (p.startsWith('/lnp/') || p === '/lnp') return 'lnp-enterprise';
  if (p.startsWith('/wlnp/') || p === '/wlnp') return 'lnp-wireless';
  if (p.startsWith('/did-orders/') || p === '/did-orders') return 'did-orders';
  if (p.startsWith('/lrn/') || p === '/lrn') return 'lrn';
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
  (at, month, email, mind_account, product, method, path, status, ms, billable, price_cents, mode, ip, user_agent)
  VALUES (@at, @month, @email, @mind_account, @product, @method, @path, @status, @ms, @billable, @price_cents, @mode, @ip, @user_agent)`);
const getProfile = db.prepare('SELECT token, past_due FROM billing_profiles WHERE email = ?');
const getPackageMonth = db.prepare('SELECT package FROM package_months WHERE email = ? AND month = ?');
const putPackageMonth = db.prepare(`INSERT INTO package_months (email, month, package, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(email, month) DO UPDATE SET package=excluded.package, updated_at=excluded.updated_at`);

// A paid package (with a card on file) was active this month: record it for
// the month's invoice, keeping the higher package if it changed mid-month.
function notePackageMonth(email, pkg, at = new Date()) {
  const p = packageOf(pkg);
  if (!email || !p || !p.priceCents) return;
  const mon = at.toISOString().slice(0, 7);
  const had = getPackageMonth.get(email, mon);
  const keep = higherPackage(had && had.package, pkg);
  if (had && had.package === keep) return;
  putPackageMonth.run(email, mon, keep, at.toISOString());
}

// mode: 'free' | 'production' for paying partners, null for exempt callers.
// Calls carry no price: the package's monthly fee is the charge.
function meter(req, res, { email, mindAccount, product, endpointKey, price, mode }) {
  const started = Date.now();
  res.on('finish', () => {
    try {
      const at = new Date().toISOString();
      const billable = !!price && mode === 'production' && res.statusCode >= 200 && res.statusCode < 300;
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

// A path whose meaning changes once resolved: encoded slash or backslash, a
// literal backslash, or a '.' / '..' segment (plain or percent-encoded). A
// double-encoded slash, backslash or dot (%252f) is refused too, in case an
// upstream decodes twice.
const unsafePath = (p) => /%2f|%5c|\\|%25(2e|2f|5c)/i.test(p) || /(^|\/)(\.|%2e){1,2}(\/|$)/i.test(p);

function requireEntitlement() {
  return async (req, res, next) => {
    // Encoded slashes, backslashes and dot segments ('..', '%2e%2e') would let
    // a path be checked as one operation and resolved upstream (fetch's URL
    // parser) as another.
    if (unsafePath(req.path)) return res.status(400).json({ error: 'bad_request', message: 'Encoded slashes, backslashes and dot segments are not allowed in the path.' });
    const product = productForPath(req.path);
    if (!product) return res.status(404).json({ error: 'not_found', message: `No route ${req.method} /api${req.path}` });
    const endpointKey = matchEndpoint(product, req.method, endpointPathFor(req, product));
    const notYet = () => res.status(503).json({
      error: 'not_enabled',
      message: 'This API isn\'t switched on yet. Iristel is finishing the connection to Espresso\'s new API; try again once it is live.',
    });

    const internal = process.env.GATEWAY_API_KEY;
    if (internal && req.get('X-API-Key') === internal) {
      if (PREVIEW.has(product) || restOff(product, edidEnv(req))) return notYet();
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
    if (PREVIEW.has(product)) return notYet();

    // Only Iristel staff and internal employees are never billed. Agents,
    // partners and business customers all pay.
    const staff = isAdmin(email);
    if (staff || auth.isInternal) {
      if (restOff(product, edidEnv(req))) return notYet();
      req.marketplace = { email, product, internal: false, staff: true };
      meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, price: 0, mode: null });
      return next();
    }

    const pay = (message) => res.status(402).json({ error: 'payment_required', message });
    const pkg = packageOf(auth.package) || PACKAGES[0];
    const profile = getProfile.get(email);
    // Mode and package on every answer, refusals included, so the console's
    // mode bar stays right after a mid-session change.
    res.set('X-Marketplace-Package', pkg.id);
    res.set('X-Marketplace-Mode', profile && profile.past_due ? 'past_due'
      : !pkg.priceCents ? 'free' : profile && profile.token ? 'production' : 'card_required');
    // Partners only reach catalog operations, matched exactly (method, letter
    // case, no trailing slash): a variant the routers would still serve
    // (HEAD, /path/, /PATH) must not slip past the package check.
    if (!endpointKey) return res.status(404).json({ error: 'not_found', message: `No route ${req.method} /api${req.path}` });
    // The package must include this operation (Premium includes Standard,
    // which includes Free).
    const tier = tierFor(product, endpointKey);
    if (!packageAllows(pkg.id, tier)) {
      const needs = packageOf(tier) || packageOf('premium');
      return res.status(403).json({
        error: 'upgrade_required', package: pkg.id, requiredPackage: needs.id,
        message: `${OP_NAMES.get(`${product} ${endpointKey}`) || endpointKey} is in the ${needs.name} package; your package is ${pkg.name}. `
          + 'Ask for an upgrade from the API Marketplace page.',
      });
    }
    if (profile && profile.past_due)
      return pay('Your last payment did not go through. Update your card in the console under Billing & usage.');
    if (restOff(product, 'production')) return notYet();

    let mode;
    if (!pkg.priceCents) {
      mode = 'free';
    } else if (profile && profile.token) {
      mode = 'production';
      notePackageMonth(email, pkg.id);
    } else {
      return pay(`Add a card in the console under Billing & usage to start your ${pkg.name} package.`);
    }
    res.set('X-Marketplace-Mode', mode);

    req.marketplace = { email, product, internal: false, mode, package: pkg.id, edidEnv: 'production' };
    meter(req, res, { email, mindAccount: auth.mindAccount, product, endpointKey, price: 0, mode });
    next();
  };
}

module.exports = { requireEntitlement, productForPath, edidEnv, notePackageMonth, unsafePath, ESPRESSO };
