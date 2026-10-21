'use strict';

/**
 * DID Orders routes: ordering phone numbers on Espresso's REST API
 * (catalog: lib/catalogs/did-orders.js).
 *
 *   gateway                                       Espresso (/ws/v1)
 *   GET  /api/did-orders/health                   login, company, routing profiles, order list
 *   GET  /api/did-orders/routing-profiles         GET  /network/routing_profiles   (DID profiles only)
 *   GET  /api/did-orders/available                POST /dids/inventory/search      (available, Iristel's OCN)
 *   POST /api/did-orders/orders                   POST /dids/orders
 *   GET  /api/did-orders/orders                   GET  /dids/orders (staff) / the caller's own orders
 *   GET  /api/did-orders/orders/:orderId          GET  /dids/orders/{id}
 *   POST /api/did-orders/orders/:orderId/complete POST /dids/orders/{id}/complete
 *   POST /api/did-orders/orders/:orderId/cancel   POST /dids/orders/{id}/cancel
 *
 * Every order is placed on Iristel's Espresso company, so partners are
 * scoped here, as for WLNP: the gateway records who placed each order
 * (did_orders) and a partner sees and acts on only those. Iristel staff and
 * the internal key see every order of the company. The gateway sets the
 * company, country (1) and OCN (ESPRESSO_OCN, default 154E) on new orders;
 * vanity numbers are not offered.
 *
 * Each create carries a reference unique to that request ("mp-<hex>", then
 * the partner's own reference). If Espresso's answer is lost, the order is
 * found again by that exact reference; until it is, the create is kept in
 * did_order_pending and settled when the partner next lists their orders.
 *
 * Optional: ESPRESSO_ROUTING_PROFILE_ID (production) and
 * ESPRESSO_SANDBOX_ROUTING_PROFILE_ID (sandbox) name the profile used when
 * an order names none; without one, that system's only active DID profile
 * is used.
 */

const crypto = require('crypto');
const express = require('express');
const { AppError } = require('../soap');
const { edidEnv } = require('../entitlements');
const espresso = require('../espresso-rest');
const db = require('../db');

const OCN = () => process.env.ESPRESSO_OCN || '154E';
const PROFILE_TTL_MS = 60 * 60 * 1000;
const PENDING_MAX_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NO = /^ORD-\d{6}-[0-9A-F]{12}$/i;
const CREATE_FIELDS = new Set(['routingProfileId', 'acquisitionType', 'selectDids', 'reference', 'numberRequests']);
const TAG_BYTES = 8;                                     // "mp-" + 16 hex
const MAX_PARTNER_REF = 255 - (3 + TAG_BYTES * 2) - 1;   // Espresso allows 255 bytes in all

const qRecord = db.prepare(`INSERT OR IGNORE INTO did_orders (order_id, email, env, order_number, reference, created_at)
  VALUES (?, ?, ?, ?, ?, ?)`);
const qOwner = db.prepare('SELECT email FROM did_orders WHERE order_id = ?');
const qByNumber = db.prepare('SELECT order_id, email FROM did_orders WHERE order_number = ? AND env = ?');
const qMine = db.prepare('SELECT order_id FROM did_orders WHERE email = ? AND env = ? ORDER BY created_at DESC LIMIT ? OFFSET ?');
const qMineCount = db.prepare('SELECT COUNT(*) AS n FROM did_orders WHERE email = ? AND env = ?');
const qPendingAdd = db.prepare('INSERT OR IGNORE INTO did_order_pending (reference, email, env, created_at) VALUES (?, ?, ?, ?)');
const qPendingDel = db.prepare('DELETE FROM did_order_pending WHERE reference = ?');
const qPendingMine = db.prepare('SELECT reference, created_at FROM did_order_pending WHERE email = ? AND env = ? ORDER BY created_at');

const envLabel = (env) => (env === 'test' ? 'sandbox' : 'production');
const intIn = (v, min, max, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
// Text cut to at most n UTF-8 bytes, on a character boundary.
function cutBytes(s, n) {
  const buf = Buffer.from(String(s), 'utf8');
  return buf.length <= n ? String(s) : buf.subarray(0, n).toString('utf8').replace(/�+$/, '');
}
const notYours = (id) => new AppError(404, 'not_found',
  `No DID order ${String(id || '').slice(0, 40) || '(none given)'} on your account. You can only use orders you placed through the marketplace.`);
// An order summary: the order without its number lists.
const summary = (o) => { const { numberRequests, numbers, ...rest } = o || {}; return rest; };

// The company's active DID routing profiles, cached per system.
const profileCache = {};
async function didProfiles(env) {
  const hit = profileCache[env];
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.list;
  const company = await espresso.companyId(env);
  const { data } = await espresso.request(env, 'GET', '/network/routing_profiles', {
    query: { from: 0, size: 1000, company_id: company },
  });
  const list = (Array.isArray(data) ? data : (data && data.data) || [])
    .filter((p) => p && p.id && p.type === 'did' && p.active !== false);
  profileCache[env] = { list, at: Date.now() };
  return list;
}

async function defaultProfile(env) {
  // Profile ids are records of one system, so neither borrows the other's.
  const set = env === 'test' ? process.env.ESPRESSO_SANDBOX_ROUTING_PROFILE_ID : process.env.ESPRESSO_ROUTING_PROFILE_ID;
  if (set) return set;
  const list = await didProfiles(env);
  if (list.length === 1) return list[0].id;
  throw new AppError(400, 'validation_error',
    'Send routingProfileId: pick one from GET /api/did-orders/routing-profiles.');
}

// The company's most recently updated orders (Espresso's page size is at most 100).
async function recentOrders(env) {
  const { data } = await espresso.request(env, 'GET', '/dids/orders', {
    query: { accountId: await espresso.companyId(env), page: 1, size: 100 },
  });
  return (data && Array.isArray(data.data) ? data.data : []).filter((o) => o && o.id);
}

module.exports = function didOrderRoutes(h) {
  const router = express.Router();

  const everything = (req) => { const m = req.marketplace || {}; return !!(m.internal || m.staff); };

  // The Espresso order id behind :orderId, checking the caller may use it.
  // Accepts the UUID or the ORD-… order number.
  function orderIdFor(req) {
    const raw = String(req.params.orderId || '');
    const env = edidEnv(req);
    const m = req.marketplace || {};
    if (ORDER_NO.test(raw)) {
      const row = qByNumber.get(raw.toUpperCase(), env);
      if (row && (everything(req) || row.email === m.email)) return row.order_id;
      if (everything(req)) {
        throw new AppError(400, 'validation_error', 'The gateway has no record of that order number; use the order id (UUID).');
      }
      throw notYours(raw);
    }
    if (!UUID.test(raw)) {
      throw new AppError(400, 'validation_error', 'orderId must be the order id (a UUID) or its order number (ORD-…).');
    }
    if (!everything(req)) {
      const row = qOwner.get(raw.toLowerCase());
      if (!row || row.email !== m.email) throw notYours(raw);
    }
    return raw.toLowerCase();
  }

  // Records the caller as the order's owner and clears its pending create.
  // True when the caller owns it (now or already).
  function own(email, env, order, reference) {
    if (reference) qPendingDel.run(reference);
    if (!email || !order || !order.id) return !email;
    const id = String(order.id).toLowerCase();
    const r = qRecord.run(id, email, env, order.orderNumber ? String(order.orderNumber).toUpperCase() : null,
      order.reference || reference || null, new Date().toISOString());
    if (r.changes === 1) return true;
    const row = qOwner.get(id);
    return !!row && row.email === email;
  }

  // Pending creates of this caller that Espresso has since confirmed become
  // their orders; ones still missing after a day are dropped. Best effort.
  async function settlePending(email, env) {
    const rows = qPendingMine.all(email, env);
    if (!rows.length) return [];
    let recent;
    try { recent = await recentOrders(env); } catch { return rows; }
    const byRef = new Map(recent.filter((o) => o.reference).map((o) => [o.reference, o]));
    const left = [];
    for (const p of rows) {
      const o = byRef.get(p.reference);
      if (o && !qOwner.get(String(o.id).toLowerCase())) own(email, env, o, p.reference);
      else if (o || Date.now() - Date.parse(p.created_at) > PENDING_MAX_MS) qPendingDel.run(p.reference);
      else left.push(p);
    }
    return left;
  }

  router.get('/health', h(async (req, res) => {
    const env = edidEnv(req);
    await espresso.companyId(env);
    await didProfiles(env);
    // The order list also proves orders reach Espresso's API (see ROUTED in lib/espresso-rest.js).
    await espresso.request(env, 'GET', '/dids/orders', { query: { accountId: await espresso.companyId(env), page: 1, size: 1 } });
    res.json({ ok: true, environment: envLabel(env) });
  }));

  router.get('/routing-profiles', h(async (req, res) => {
    const list = await didProfiles(edidEnv(req));
    // Partners get what they need to choose a profile, not its routing (IPs).
    const data = everything(req) ? list
      : list.map((p) => ({ id: p.id, label: p.label, format: p.format, active: p.active !== false }));
    res.json({ data, total: data.length });
  }));

  router.get('/available', h(async (req, res) => {
    const env = edidEnv(req);
    const limit = intIn(req.query.limit, 1, 100, 20);
    const offset = intIn(req.query.offset, 0, 1e9, 0);
    const f = (name, value) => ({ category_name: name, category_operator: 'and', category_eq: '=', category_value: String(value) });
    const filter = [f('status', 'available'), f('provider_code', OCN())];
    const one = (v) => (Array.isArray(v) ? v[0] : v);
    const prefix = String(one(req.query.prefix) || '').replace(/\D/g, '').slice(0, 16);
    if (prefix) filter.push(f('prefix', prefix.startsWith('1') ? prefix : '1' + prefix));
    const rc = String(one(req.query.ratecenter) || '').trim();
    if (rc) filter.push(f('ratecenter', cutBytes(rc, 255)));
    const region = String(one(req.query.region) || '').trim();
    if (region) filter.push(f('province', cutBytes(region, 255)));
    const { data } = await espresso.request(env, 'POST', '/dids/inventory/search', {
      body: { limit, offset, order_by: ['number asc'], filter },
    });
    const rows = Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : data && data.number ? [data] : [];
    // Only numbers that can be sold: available, on no account, not vanity.
    const sellable = rows.filter((r) => r && r.number && String(r.status || '').toLowerCase() === 'available' && !r.account && r.vanity !== true);
    res.json({ data: sellable.map((r) => ({ number: String(r.number) })), limit, offset });
  }));

  router.post('/orders', h(async (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const unknown = Object.keys(b).filter((k) => !CREATE_FIELDS.has(k));
    if (unknown.length) {
      throw new AppError(400, 'validation_error',
        `Unknown field(s): ${unknown.join(', ')}. Send ${[...CREATE_FIELDS].join(', ')}; the gateway sets the company, country and OCN.`);
    }
    if (!Array.isArray(b.numberRequests) || !b.numberRequests.length) {
      throw new AppError(400, 'validation_error', 'Body must include a non-empty "numberRequests" array of { quantity, filters }.');
    }
    const acquisitionType = String(b.acquisitionType || 'BUY').toUpperCase();
    if (!['BUY', 'LEASE'].includes(acquisitionType)) {
      throw new AppError(400, 'validation_error', 'acquisitionType must be BUY or LEASE.');
    }
    if (b.selectDids !== undefined && typeof b.selectDids !== 'boolean') {
      throw new AppError(400, 'validation_error', 'selectDids must be true or false.');
    }
    if (b.reference !== undefined && (typeof b.reference !== 'string' || Buffer.byteLength(b.reference) > MAX_PARTNER_REF)) {
      throw new AppError(400, 'validation_error', `reference must be text of at most ${MAX_PARTNER_REF} bytes.`);
    }
    const env = edidEnv(req);
    const email = (req.marketplace || {}).email || null;
    // Unique to this request, so a lost answer can only lead back to this order.
    const tag = 'mp-' + crypto.randomBytes(TAG_BYTES).toString('hex');
    const reference = b.reference ? `${tag} ${b.reference}` : tag;
    const body = {
      accountId: await espresso.companyId(env),
      countryId: '1',
      ocn: OCN(),
      vanity: false,
      selectDids: b.selectDids === true,
      acquisitionType,
      routingProfileId: b.routingProfileId || await defaultProfile(env),
      reference,
      numberRequests: b.numberRequests,
    };
    if (email) qPendingAdd.run(reference, email, env, new Date().toISOString());
    try {
      const { status, data } = await espresso.request(env, 'POST', '/dids/orders', { body });
      own(email, env, data, reference);
      return res.status(status).json(data);
    } catch (err) {
      // No answer, or a server error: the order may exist anyway.
      const ambiguous = err instanceof AppError && !err.meta.misrouted
        && (err.status === 504 || (err.status >= 500 && err.meta.code !== 'ACCOUNT_MAPPING_UNAVAILABLE'));
      if (!ambiguous) { qPendingDel.run(reference); throw err; }
      const found = await recentOrders(env).then((list) => list.find((o) => o.reference === reference)).catch(() => null);
      if (found && own(email, env, found, reference)) {
        const full = await espresso.request(env, 'GET', `/dids/orders/${encodeURIComponent(found.id)}`)
          .then((r) => r.data).catch(() => found);
        return res.status(202).json(full);
      }
      throw new AppError(503, 'order_unconfirmed',
        'Espresso didn\'t confirm this order, but it may have been placed. Don\'t order again yet: check List your orders in a few minutes, where it appears once Espresso confirms it.',
        { reference });
    }
  }));

  router.get('/orders', h(async (req, res) => {
    const env = edidEnv(req);
    const page = intIn(req.query.page, 1, 1e6, 1);
    if (everything(req)) {
      const size = intIn(req.query.size, 1, 100, 20);
      const { data } = await espresso.request(env, 'GET', '/dids/orders', {
        query: { accountId: await espresso.companyId(env), page, size },
      });
      return res.json(data);
    }
    // Partners: their own orders, newest first, read fresh from Espresso.
    const size = intIn(req.query.size, 1, 50, 20);
    const m = req.marketplace || {};
    const unconfirmed = await settlePending(m.email, env);
    const ids = qMine.all(m.email, env, size, (page - 1) * size).map((r) => r.order_id);
    const results = await Promise.all(ids.map((id) => espresso.request(env, 'GET', `/dids/orders/${encodeURIComponent(id)}`)
      .then((r) => ({ order: summary(r.data) }), (err) => ({ id, err }))));
    // Nothing could be read: say why rather than answer (and bill) an empty 200.
    if (results.length && results.every((r) => r.err)) throw results[0].err;
    const out = {
      data: results.map((r) => (r.err ? { id: r.id, status: null, error: r.err.message } : r.order)),
      total: qMineCount.get(m.email, env).n, page, size,
    };
    if (unconfirmed.length) out.unconfirmed = unconfirmed.map((p) => ({ reference: p.reference, sentAt: p.created_at }));
    res.json(out);
  }));

  router.get('/orders/:orderId', h(async (req, res) => {
    const id = orderIdFor(req);
    const { data } = await espresso.request(edidEnv(req), 'GET', `/dids/orders/${encodeURIComponent(id)}`);
    res.json(data);
  }));

  router.post('/orders/:orderId/complete', h(async (req, res) => {
    const id = orderIdFor(req);
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const unknown = Object.keys(b).filter((k) => k !== 'numbers');
    if (unknown.length) throw new AppError(400, 'validation_error', `Unknown field(s): ${unknown.join(', ')}. Send only "numbers", or {}.`);
    if (b.numbers !== undefined && (!Array.isArray(b.numbers) || !b.numbers.length)) {
      throw new AppError(400, 'validation_error', '"numbers" must be a non-empty list of reserved numbers; send {} to keep them all.');
    }
    const { status, data } = await espresso.request(edidEnv(req), 'POST', `/dids/orders/${encodeURIComponent(id)}/complete`,
      { body: b.numbers ? { numbers: b.numbers.map(String) } : undefined });
    res.status(status).json(data);
  }));

  router.post('/orders/:orderId/cancel', h(async (req, res) => {
    const id = orderIdFor(req);
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const unknown = Object.keys(b).filter((k) => k !== 'reason');
    if (unknown.length) throw new AppError(400, 'validation_error', `Unknown field(s): ${unknown.join(', ')}. Send only "reason", or {}.`);
    const { status, data } = await espresso.request(edidEnv(req), 'POST', `/dids/orders/${encodeURIComponent(id)}/cancel`,
      { body: b.reason ? { reason: cutBytes(b.reason, 1000) } : undefined });
    res.status(status).json(data);
  }));

  return router;
};
