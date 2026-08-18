'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const soap = require('./lib/soap');
const { AppError, call, str, requestItems, orderRequestArray } = soap;

const app = express();
// CORS: set ALLOWED_ORIGINS="https://portal.example.com,https://www.example.com" in prod.
// If unset, any origin is allowed (dev convenience).
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
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
const CATALOG = [
  {
    method: 'GET', path: '/api/ping', soap: 'testConnection',
    summary: 'Health & auth check',
    description: 'Confirms the gateway is up and your Espresso credentials are accepted. Use this first when setting up.',
    params: [{ name: 'name', in: 'query', required: false, description: 'Any label; echoed back in the response.' }],
    returns: 'The greeting string from Espresso and the authenticated username.',
    errors: [{ code: 1, when: 'No credentials sent.' }, { code: 2, when: 'Wrong username / password.' }],
  },
  {
    method: 'GET', path: '/api/catalog', soap: 'didGetProductCatalog',
    summary: 'List available rate centers / NPAs',
    description: 'Returns every rate center + NPA (area code) pair you are allowed to order DIDs from. Use these exact values when creating an order — a mismatch is rejected (595 / 596).',
    returns: 'Array of { ratecenter, npa } entries.',
    errors: [{ code: 431, when: 'Product catalog is empty for your account.' }],
  },
  {
    method: 'GET', path: '/api/routing-profiles', soap: 'didGetRoutingProfiles',
    summary: 'List routing profiles',
    description: 'Returns your routing profiles. When you place an order you must pass the profile name in the EXACT form returned here.',
    returns: 'Array of profile identifiers/names.',
    errors: [{ code: 451, when: 'No routing profiles assigned to your account.' }],
  },
  {
    method: 'GET', path: '/api/routing-profiles/full', soap: 'didGetRoutingProfilesDetailsFull',
    summary: 'List routing profiles (full detail)',
    description: 'Like /routing-profiles but each profile also includes tech_prefix and format (E164 or National). These replace the deprecated prefix / country_prefix request fields.',
    returns: 'Array of profiles with tech_prefix and format.',
  },
  {
    method: 'GET', path: '/api/routing-profiles/:profile', soap: 'didGetRoutingProfileDetails',
    summary: 'Get one routing profile',
    description: 'Full details for a single profile. URL-encode the value (e.g. "Profile 2542" -> "Profile%202542"). The profile must match the form from /routing-profiles.',
    params: [{ name: 'profile', in: 'path', required: true, description: 'Profile name/number, exactly as returned by /routing-profiles.' }],
    errors: [{ code: 472, when: 'Profile does not exist or is not yours.' }],
  },
  {
    method: 'POST', path: '/api/orders', soap: 'didOrderDids',
    summary: 'Create a DID order',
    description: 'Places a new order. Requests are grouped by routing profile. Each request asks for a quantity of DIDs in a given rate center + NPA. prefix / country_prefix are deprecated and ignored — safe to omit.',
    body: {
      profiles: [{
        profile: 'Profile 2542',
        requests: [{ ratecenter: 'TORONTO', npa: '647', quantity: 1 }],
      }],
    },
    fields: [
      { name: 'profiles[].profile', required: true, description: 'Profile name, exact form from /routing-profiles.' },
      { name: 'requests[].ratecenter', required: true, description: 'Rate center from /catalog.' },
      { name: 'requests[].npa', required: true, description: 'NPA (area code) valid for that rate center.' },
      { name: 'requests[].quantity', required: true, description: 'How many DIDs (integer > 0).' },
    ],
    returns: 'The created order (order number + initial status). Poll /status afterward.',
    errors: [
      { code: 594, when: 'Quantity must be greater than 0.' },
      { code: 595, when: 'Rate center is not valid (see /catalog).' },
      { code: 596, when: 'NPA not valid for that rate center.' },
      { code: 592, when: 'Requested DIDs exceed your daily quota.' },
    ],
  },
  {
    method: 'GET', path: '/api/orders', soap: 'didGetOrders',
    summary: 'List orders in a date range',
    description: 'All orders your company created between two timestamps.',
    params: [
      { name: 'from', in: 'query', required: true, description: 'Start datetime, format "Y-m-d H:i:s" e.g. 2026-08-01 00:00:00.' },
      { name: 'to', in: 'query', required: true, description: 'End datetime, same format.' },
    ],
    returns: 'Array of orders with their statuses.',
  },
  {
    method: 'GET', path: '/api/orders/:id', soap: 'didGetOrderInfo',
    summary: 'Get order info',
    description: 'The profile + requests that make up an order. The shape changes after you edit an order or discard rejected requests.',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number, e.g. DID1205280200006.' }],
    errors: [{ code: 511, when: 'Order id does not exist.' }],
  },
  {
    method: 'GET', path: '/api/orders/:id/status', soap: 'didGetOrderStatus',
    summary: 'Get order status',
    description: 'Current status. Poll this after creating or editing an order.',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number.' }],
    returns: 'One of: Processing, Approved, Completed, Rejected. Pending Update, Rejected, Canceled.',
  },
  {
    method: 'GET', path: '/api/orders/:id/details', soap: 'didGetOrderDetails',
    summary: 'List provisioned DIDs',
    description: 'The actual DID numbers assigned to the order.',
    precondition: 'Order status must be "Completed".',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number.' }],
    errors: [{ code: 531, when: 'Order is not "Completed" (409). Check /status.' }],
  },
  {
    method: 'GET', path: '/api/orders/:id/problems', soap: 'didGetOrderProblems',
    summary: 'List rejected requests',
    description: 'The rejected requests in an order and why each was rejected.',
    precondition: 'Order status must be "Rejected. Pending Update".',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number.' }],
    errors: [{ code: 551, when: 'Order is not "Rejected. Pending Update" (409).' }],
  },
  {
    method: 'POST', path: '/api/orders/:id/requests', soap: 'didOrderEdit',
    summary: 'Append requests to an order',
    description: 'Adds more DID requests to an order that was partly rejected. Requests are APPENDED to the accepted ones — this does not replace anything.',
    precondition: 'Order status must be "Rejected. Pending Update".',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number.' }],
    body: { requests: [{ ratecenter: 'PARRY SOUND', npa: '705', quantity: 3 }] },
    fields: [
      { name: 'requests[].ratecenter', required: true, description: 'Rate center from /catalog.' },
      { name: 'requests[].npa', required: true, description: 'NPA valid for that rate center.' },
      { name: 'requests[].quantity', required: true, description: 'How many DIDs (integer > 0).' },
    ],
    errors: [{ code: 551, when: 'Order is not "Rejected. Pending Update" (409).' }],
  },
  {
    method: 'POST', path: '/api/orders/:id/discard-rejected', soap: 'didOrderDiscardRejected',
    summary: 'Discard rejected requests',
    description: 'Drops all rejected requests, keeping only the accepted ones, so the order can proceed.',
    precondition: 'Status "Rejected. Pending Update" AND at least one accepted request must remain.',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number.' }],
    errors: [{ code: 551, when: 'Order is not in the right state, or nothing accepted remains (409).' }],
  },
  {
    method: 'POST', path: '/api/orders/:id/cancel', soap: 'didOrderCancel',
    summary: 'Cancel an order',
    description: 'Cancels the whole order.',
    precondition: 'Order status must be "Rejected. Pending Update".',
    params: [{ name: 'id', in: 'path', required: true, description: 'Order number.' }],
    errors: [{ code: 551, when: 'Order is not "Rejected. Pending Update" (409).' }],
  },
];

app.get('/', (req, res) => {
  res.json({
    service: 'espresso-rest-gateway',
    upstream: soap.ENDPOINTS,
    default_env: (process.env.EDID_ENV || 'test'),
    endpoints: CATALOG,
  });
});

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