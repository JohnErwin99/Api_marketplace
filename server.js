'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const soap = require('./lib/soap');
const { AppError } = soap;

const app = express();
// Render sits behind Cloudflare; the visitor's own address comes from
// security.clientIp() (CF-Connecting-IP), not req.ip.
app.set('trust proxy', 1);
// Paths are matched with their letter case. Express mounts are case-blind by
// default, but the entitlement check classifies a path by its exact text, so
// /api/WLNP/... must not reach the Wireless LNP router as some other product.
app.set('case sensitive routing', true);
// CORS: set ALLOWED_ORIGINS="https://portal.example.com,https://www.example.com" in prod.
// If unset, any origin is allowed (dev convenience).
const envOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Iristel sites that embed marketplace pages are always allowed: the partner
// portal and the public site (its landing page loads /catalog.json).
const PORTAL_ORIGINS = [
  'https://iristelpartnerportal.com',
  'https://www.iristelpartnerportal.com',
  'https://iristel-portal.webflow.io',
  'https://partner.iristel.com',
  'https://iristel.webflow.io',
  'https://iristel.com',
  'https://www.iristel.com',
];
const allowed = [...new Set([...envOrigins, ...(envOrigins.length ? PORTAL_ORIGINS : [])])];
// The console reads the caller's mode, the call's rate and the sandbox calls left from these.
const exposedHeaders = ['X-Marketplace-Mode', 'X-Marketplace-Price', 'X-Sandbox-Calls-Remaining', 'X-Marketplace-Sample'];
app.use(cors(allowed.length ? { origin: allowed, exposedHeaders } : { exposedHeaders }));
// 8 MB: the access-request form sends the business-registration document
// as base64 JSON (~5 MB file cap plus encoding overhead).
app.use(express.json({ limit: '8mb' }));

// Every /api/* call must come from an approved caller: a console session or
// a partner API key, checked against the CRM approval for the product the
// path belongs to (lib/entitlements.js). GATEWAY_API_KEY stays as an
// internal override for Iristel's own services.
app.use('/api', require('./lib/entitlements').requireEntitlement());

// Health check for Render. Also shows whether the ledger survives deploys:
// ledgerCalls should keep its value across a redeploy (no emails exposed).
const STARTED_AT = new Date().toISOString();
const qLedgerCalls = require('./lib/db').prepare('SELECT COUNT(*) AS n FROM usage');
app.get('/healthz', (req, res) => res.json({
  ok: true, startedAt: STARTED_AT,
  persistentDisk: require('./lib/db').storage.persistent,
  ledgerCalls: qLedgerCalls.get().n,
}));

// Test console (single static page) at /console
const path = require('path');
app.get('/console', (req, res) => res.sendFile(path.join(__dirname, 'public', 'console.html')));
// Shared design tokens (light/dark) used by the landing page and the console.
// Social icons referenced by the branded email footer (lib/email-template.js).
app.use('/email', express.static(path.join(__dirname, 'public', 'email')));
app.get('/theme.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'theme.css')));
// Staff dashboard: who has marketplace access, to what, and usage.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
// Public landing page: no access-request form, sign-up CTA instead.
app.get('/public', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index-public.html')));
// Marketplace-access cookie reader — also embedded standalone in Webflow.
app.get('/marketplace-access.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'marketplace-access.js')));
// The console's card form, on the gateway origin so the page hosting the
// console never sees card data. Only the gateway and the partner portal may
// frame it (local hosts too when the gateway runs locally).
app.get('/billing-card', (req, res) => {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('host') || '');
  const ancestors = ["'self'", 'https://iristelpartnerportal.com', 'https://www.iristelpartnerportal.com',
    'https://iristel-portal.webflow.io', 'https://partner.iristel.com',
    ...(local ? ['http://localhost:*', 'http://127.0.0.1:*'] : [])];
  res.set('Content-Security-Policy', `frame-ancestors ${ancestors.join(' ')}`);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'billing-card.html'));
});
// The console itself, as a script that mounts in a shadow root on any page
// (console.html here, and the partner portal's /console page).
app.get('/console-app.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'console-app.js'),
  { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } }));
// Iris guide panel for the console (loaded by console-app.js once it is mounted).
app.get('/iris-console.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'iris-console.js'),
  { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } },
  (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'not_found', message: 'No route GET /iris-console.js' }); }));
// The marketplace page's script (the page and its Webflow copy load it from here).
app.get('/marketplace-page.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'marketplace-page.js')));
// v2: the console in the Iristel portal brand, light by default, theme taken
// from the page that hosts it (public/v2/). New paths only: the routes above
// keep serving today's console unchanged. Same headers as their v1 routes.
app.get('/v2/console', (req, res) => res.sendFile(path.join(__dirname, 'public', 'v2', 'console.html')));
app.get('/v2/billing-card', (req, res) => {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('host') || '');
  const ancestors = ["'self'", 'https://iristelpartnerportal.com', 'https://www.iristelpartnerportal.com',
    'https://iristel-portal.webflow.io', 'https://partner.iristel.com',
    ...(local ? ['http://localhost:*', 'http://127.0.0.1:*'] : [])];
  res.set('Content-Security-Policy', `frame-ancestors ${ancestors.join(' ')}`);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'v2', 'billing-card.html'));
});
app.get('/v2/console-app.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'v2', 'console-app.js'),
  { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } }));
app.get('/v2/iris-console.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'v2', 'iris-console.js'),
  { headers: { 'Content-Type': 'application/javascript; charset=UTF-8' } },
  (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'not_found', message: 'No route GET /v2/iris-console.js' }); }));

// ---------------------------------------------------------------------------
// Credentials resolution
// Priority: per-request headers/basic-auth  ->  .env defaults (EDID_USER /
// EDID_PASS, the same login on Espresso's test and production systems).
// Partners always use Espresso's production system; only staff and internal
// callers may pick the test system with X-EDID-Env (see lib/entitlements.js
// edidEnv).
// ---------------------------------------------------------------------------
const { edidEnv } = require('./lib/entitlements');
function resolveContext(req) {
  let username = req.get('X-EDID-Username');
  let password = req.get('X-EDID-Password');

  const auth = req.get('Authorization');
  if ((!username || !password) && auth && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx !== -1) {
      username = username || decoded.slice(0, idx);
      password = password || decoded.slice(idx + 1);
    }
  }

  const env = edidEnv(req);
  if (!username || !password) {
    username = username || process.env.EDID_USER;
    password = password || process.env.EDID_PASS;
  }

  return { creds: { username, password }, env };
}

// async route wrapper -> consistent JSON errors
const h = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err instanceof AppError) {
      return res.status(err.status).json(err.toJSON());
    }
    console.error(err);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  });
};

// ---------------------------------------------------------------------------
// Index — machine-readable endpoint catalog (handy for the console UI)
// ---------------------------------------------------------------------------
const { PRODUCTS, CLASSIFICATIONS } = require('./lib/catalogs');
const UI_HINTS = require('./lib/catalogs/ui-hints');

// Every ':name' in a path gets a path param, so the console and Iris show a
// field for it: some IristelX catalog entries list none, and the console then
// sent the literal ':accountId'. New arrays, so shared param objects aren't
// edited.
for (const p of PRODUCTS) {
  for (const e of p.endpoints || []) {
    const have = new Set((e.params || []).filter((x) => x.in === 'path').map((x) => x.name));
    const missing = [...e.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]).filter((n) => !have.has(n));
    if (missing.length) e.params = [...missing.map((name) => ({ name, in: 'path', required: true })), ...(e.params || [])];
  }
}

// Attach UI hints once at startup: per-endpoint `ui` object + per-product `ui`.
// A hint's description, returns and field help also fill the catalog's own
// text where it is empty, so console search and Iris see them. Param objects
// can be shared between endpoints, so they are copied, never edited.
for (const p of PRODUCTS) {
  const hints = UI_HINTS[p.id];
  if (!hints) continue;
  if (hints.product) p.ui = hints.product;
  for (const e of p.endpoints || []) {
    const h = hints[`${e.method} ${e.path}`];
    if (!h) continue;
    e.ui = h;
    if (!e.description && h.description) e.description = h.description;
    if (!e.returns && h.returns) e.returns = h.returns;
    const help = (name) => h.fields && h.fields[name] && h.fields[name].help;
    for (const k of ['params', 'fields']) {
      if (!Array.isArray(e[k])) continue;
      e[k] = e[k].map((f) => (!f.description && help(f.name) ? { ...f, description: help(f.name) } : f));
    }
  }
}

// Rate class per endpoint (lib/catalogs/rate-card.json): free, standard,
// advanced or service. An operation missing from the rate card is never
// charged; pricing.init() below reports it.
const { rateFor, publicRateCard } = require('./lib/catalogs/pricing');
for (const p of PRODUCTS) {
  for (const e of p.endpoints || []) {
    const r = rateFor(p.id, `${e.method} ${e.path}`);
    e.rateClass = r ? r.id : null;
    e.priceCents = r ? r.priceCents : 0;
  }
}

// Bundles: curated use-case packages. Validate references at startup and drop
// any step that points at a missing product or one classified internal /
// restricted — bundles must only expose partner-safe products.
const { AUDIENCES, CATEGORIES, ACCOUNT_TYPES, BUNDLES } = require('./lib/catalogs/bundles');
const EXPOSABLE = new Set(['public', 'customer-confidential']);
for (const b of BUNDLES) {
  b.steps = b.steps.filter((s) => {
    const p = PRODUCTS.find((x) => x.id === s.product);
    if (!p) {
      console.warn(`bundle ${b.id}: unknown product "${s.product}" — step dropped`);
      return false;
    }
    if (!EXPOSABLE.has(p.classification)) {
      console.warn(`bundle ${b.id}: product "${s.product}" is ${p.classification} — step dropped`);
      return false;
    }
    if (!(p.endpoints || []).some((e) => `${e.method} ${e.path}` === s.endpoint)) {
      console.warn(`bundle ${b.id}: endpoint "${s.endpoint}" not found in "${s.product}" — kept, check catalog`);
    }
    return true;
  });
  // What one run of the bundle costs in API events (service orders and reads
  // are free of API fees; the services themselves are billed separately).
  b.apiCents = b.steps.reduce((sum, s) => sum + ((rateFor(s.product, s.endpoint) || {}).priceCents || 0), 0);
  b.serviceSteps = b.steps.filter((s) => (rateFor(s.product, s.endpoint) || {}).id === 'service').length;
}

// Onboarding: access-request intake + authorization lookup for the portal.
require('./lib/onboarding').register(app, PRODUCTS);
// Signed login sessions (staff dashboard).
require('./lib/session').register(app);
// Portal login / sign-up helpers (keep the IristelX keys server-side).
require('./lib/portal').register(app);
// Usage beacon from the console + the staff access/usage dashboard.
require('./lib/usage').register(app);
require('./lib/admin').register(app, PRODUCTS);

function catalogPayload() {
  return {
    service: 'iristel-api-marketplace',
    upstream: soap.ENDPOINTS_V4,
    default_env: (process.env.EDID_ENV || 'test'),
    classifications: CLASSIFICATIONS,
    products: PRODUCTS.map((p) => ({
      id: p.id, name: p.name, summary: p.summary,
      classification: p.classification, status: p.status, endpoints: p.endpoints,
      flow: p.flow, images: p.images, ui: p.ui,
    })),
    audiences: AUDIENCES,
    categories: CATEGORIES,
    accountTypes: ACCOUNT_TYPES,
    bundles: BUNDLES,
    // Per-event pricing (proposed): rate classes, sandbox allowance, telecom
    // service rates. Each endpoint carries its `rateClass` and `priceCents`;
    // each bundle its `apiCents` per run.
    pricing: publicRateCard(),
    pricingNote: publicRateCard().pricingNote,
  };
}

// Canonical catalog URL (the console fetches this).
app.get('/catalog.json', (req, res) => res.json(catalogPayload()));

// Root: browsers get the marketplace landing page; API clients that ask for
// JSON (Accept: application/json) keep getting the catalog (backward compat).
app.get('/', (req, res) => {
  if (req.accepts(['html', 'json']) === 'json') return res.json(catalogPayload());
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// IristelX-backed products (provisioning, 911, accounts, SIM, commissions,
// mobile): proxied so the upstream keys never leave the server.
app.use('/api/ix', require('./lib/routes/ix')(PRODUCTS));
// Per-event prices (lib/catalogs/pricing.js), usage billing / card on file,
// and monthly invoices.
require('./lib/catalogs/pricing').init(PRODUCTS);
require('./lib/billing').register(app);
// Iris in the console: account summary + signed ElevenLabs session.
require('./lib/iris').register(app);
require('./lib/invoices').register(app, PRODUCTS);

// Monthly billing, checked hourly (every step is idempotent): last month's
// invoices go out from the 1st, and are charged from the 5th. Set
// BILLING_SCHEDULER=off to run the invoices and charges by hand from the
// dashboard instead.
if (process.env.BILLING_SCHEDULER !== 'off') {
  const invoices = require('./lib/invoices');
  const { chargeInvoices } = require('./lib/billing');
  const billingTick = async () => {
    try {
      const mon = invoices.prevMonth();
      const sent = (await invoices.runInvoices(mon)).filter((r) => r.status === 'sent');
      if (sent.length) console.log(`[billing] ${mon}: emailed ${sent.length} invoice(s)`);
      if (new Date().getUTCDate() >= invoices.CHARGE_DAY) {
        const charged = await chargeInvoices(mon, { newOnly: true });
        if (charged.length) console.log(`[billing] ${mon}: charged ${charged.map((c) => `${c.number} ${c.status}`).join(', ')}`);
      }
    } catch (err) { console.warn('[billing] scheduler:', err.message); }
  };
  setTimeout(billingTick, 60 * 1000).unref();
  setInterval(billingTick, 60 * 60 * 1000).unref();
}

// Number Porting — Enterprise (LNP, Espresso v4)
app.use('/api/lnp', require('./lib/routes/lnp')(resolveContext, h));

// Number Porting — Wireless (WLNP) proxy: republishes the private Workflow API
// under this gateway's own origin (localhost in dev, Render in prod).
app.use('/api/wlnp', require('./lib/routes/wlnp')());

// Espresso's REST API (lib/espresso-rest.js): DID ordering with per-partner
// ownership, and LRN lookups. Both answer 503 not_enabled until its login is
// configured.
app.use('/api/did-orders', require('./lib/routes/did-orders')(h));
app.use('/api/lrn', require('./lib/routes/lrn')(h));
// Cisco BroadWorks over OCI-P (lib/broadworks.js); 503 not_enabled until
// BROADWORKS_OCI_URL / _USER / _PASS are set. Each partner reaches only the
// enterprise staff linked to their CRM account.
app.use('/api/broadworks', require('./lib/routes/broadworks')(h));

// 404
app.use((req, res) => res.status(404).json({ error: 'not_found', message: `No route ${req.method} ${req.path}` }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`espresso-rest-gateway listening on http://localhost:${PORT}`);
  console.log(`Upstream env: ${process.env.EDID_ENV || "test"}  |  console: http://localhost:${PORT}/console  |  GET / for JSON catalog`);
});
