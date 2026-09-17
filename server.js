'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const soap = require('./lib/soap');
const { AppError, call, str, requestItems, orderRequestArray } = soap;

const app = express();
// CORS: set ALLOWED_ORIGINS="https://portal.example.com,https://www.example.com" in prod.
// If unset, any origin is allowed (dev convenience).
const envOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
// The partner portal is always allowed — its embedded pages call the gateway.
const PORTAL_ORIGIN = 'https://iristel-portal.webflow.io';
const allowed = [...new Set([...envOrigins, ...(envOrigins.length ? [PORTAL_ORIGIN] : [])])];
app.use(cors(allowed.length ? { origin: allowed } : {}));
app.use(express.json());

// API-key gate for /api/*. Set GATEWAY_API_KEY in Render's env; clients send
// X-API-Key: <key>. If GATEWAY_API_KEY is unset the gate is off (local dev).
app.use('/api', (req, res, next) => {
  const required = process.env.GATEWAY_API_KEY;
  if (!required) return next();
  const got = req.get('X-API-Key') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (got && got === required) return next();
  return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid X-API-Key' });
});

// Health check for Render
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Test console (single static page) at /console
const path = require('path');
app.get('/console', (req, res) => res.sendFile(path.join(__dirname, 'public', 'console.html')));
// Shared design tokens (light/dark) used by the landing page and the console.
app.get('/theme.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'theme.css')));
// Marketplace-access cookie reader — also embedded standalone in Webflow.
app.get('/marketplace-access.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'marketplace-access.js')));

// ---------------------------------------------------------------------------
// Credentials resolution
// Priority: per-request headers/basic-auth  ->  .env defaults
// This lets the marketplace console pass a customer's own Espresso creds,
// while falling back to server defaults for quick testing.
// ---------------------------------------------------------------------------
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

  username = username || process.env.EDID_USER;
  password = password || process.env.EDID_PASS;

  const env =
    (req.get('X-EDID-Env') || req.query.env || process.env.EDID_ENV || 'test')
      .toLowerCase() === 'production'
      ? 'production'
      : 'test';

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
const CATALOG = PRODUCTS.find((p) => p.id === 'dids').endpoints;

// Attach UI hints once at startup: per-endpoint `ui` object + per-product `ui`.
for (const p of PRODUCTS) {
  const hints = UI_HINTS[p.id];
  if (!hints) continue;
  if (hints.product) p.ui = hints.product;
  for (const e of p.endpoints || []) {
    const h = hints[`${e.method} ${e.path}`];
    if (h) e.ui = h;
  }
}

// Bundles: curated use-case packages. Validate references at startup and drop
// any step that points at a missing product or one classified internal /
// restricted — bundles must only expose partner-safe products.
const { AUDIENCES, BUNDLES } = require('./lib/catalogs/bundles');
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
}

// Onboarding: access-request intake + authorization lookup for the portal.
require('./lib/onboarding').register(app, PRODUCTS);

function catalogPayload() {
  return {
    service: 'iristel-api-marketplace',
    upstream: soap.ENDPOINTS,
    default_env: (process.env.EDID_ENV || 'test'),
    classifications: CLASSIFICATIONS,
    products: PRODUCTS.map((p) => ({
      id: p.id, name: p.name, summary: p.summary,
      classification: p.classification, status: p.status, endpoints: p.endpoints,
      flow: p.flow, images: p.images, ui: p.ui,
    })),
    audiences: AUDIENCES,
    bundles: BUNDLES,
    // Kept for older clients that read the flat DID list.
    endpoints: CATALOG,
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

// Number Porting — Enterprise (LNP, Espresso v4)
app.use('/api/lnp', require('./lib/routes/lnp')(resolveContext, h));

// Number Porting — Wireless (WLNP) proxy: republishes the private Workflow API
// under this gateway's own origin (localhost in dev, Render in prod).
app.use('/api/wlnp', require('./lib/routes/wlnp')());

// ---------------------------------------------------------------------------
// Routes  (one REST endpoint per PDF method)
// ---------------------------------------------------------------------------

// testConnection
app.get('/api/ping', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const name = req.query.name || 'ping';
  const out = await call('testConnection', str('name', name), creds, env);
  res.json({ result: out });
}));

// didGetProductCatalog
app.get('/api/catalog', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  res.json({ items: await call('didGetProductCatalog', '', creds, env) });
}));

// didGetRoutingProfiles
app.get('/api/routing-profiles', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  res.json({ items: await call('didGetRoutingProfiles', '', creds, env) });
}));

// didGetRoutingProfilesDetailsFull  (declare BEFORE :profile so "full" isn't captured)
app.get('/api/routing-profiles/full', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  res.json({ items: await call('didGetRoutingProfilesDetailsFull', '', creds, env) });
}));

// didGetRoutingProfileDetails
app.get('/api/routing-profiles/:profile', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('profile', decodeURIComponent(req.params.profile));
  res.json({ profile: await call('didGetRoutingProfileDetails', inner, creds, env) });
}));

// didOrderDids
app.post('/api/orders', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const profiles = req.body && req.body.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new AppError(400, 'validation_error', 'Body must include a non-empty "profiles" array');
  }
  const inner = orderRequestArray(profiles);
  const out = await call('didOrderDids', inner, creds, env);
  res.status(201).json({ result: out });
}));

// didGetOrders
app.get('/api/orders', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const { from, to } = req.query;
  if (!from || !to) {
    throw new AppError(400, 'validation_error', 'Query params "from" and "to" are required (Y-m-d H:i:s)');
  }
  const inner = str('startDate', from) + str('endDate', to);
  res.json({ items: await call('didGetOrders', inner, creds, env) });
}));

// didGetOrderInfo
app.get('/api/orders/:id', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('didOrderId', req.params.id);
  res.json({ order: await call('didGetOrderInfo', inner, creds, env) });
}));

// didGetOrderStatus
app.get('/api/orders/:id/status', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('didOrderId', req.params.id);
  res.json({ order_number: req.params.id, status: await call('didGetOrderStatus', inner, creds, env) });
}));

// didGetOrderDetails
app.get('/api/orders/:id/details', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('didOrderId', req.params.id);
  res.json({ order_number: req.params.id, dids: await call('didGetOrderDetails', inner, creds, env) });
}));

// didGetOrderProblems
app.get('/api/orders/:id/problems', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('didOrderId', req.params.id);
  res.json({ order_number: req.params.id, problems: await call('didGetOrderProblems', inner, creds, env) });
}));

// didOrderEdit  (append requests)
app.post('/api/orders/:id/requests', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const requests = req.body && req.body.requests;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new AppError(400, 'validation_error', 'Body must include a non-empty "requests" array');
  }
  const inner = str('didOrderId', req.params.id) + `<requestArray>${requestItems(requests)}</requestArray>`;
  res.json({ result: await call('didOrderEdit', inner, creds, env) });
}));

// didOrderDiscardRejected
app.post('/api/orders/:id/discard-rejected', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('didOrderId', req.params.id);
  res.json({ result: await call('didOrderDiscardRejected', inner, creds, env) });
}));

// didOrderCancel
app.post('/api/orders/:id/cancel', h(async (req, res) => {
  const { creds, env } = resolveContext(req);
  const inner = str('didOrderId', req.params.id);
  res.json({ result: await call('didOrderCancel', inner, creds, env) });
}));

// 404
app.use((req, res) => res.status(404).json({ error: 'not_found', message: `No route ${req.method} ${req.path}` }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`espresso-rest-gateway listening on http://localhost:${PORT}`);
  console.log(`Upstream env: ${process.env.EDID_ENV || "test"}  |  console: http://localhost:${PORT}/console  |  GET / for JSON catalog`);
});
