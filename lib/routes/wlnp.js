'use strict';

/**
 * Number Porting — Wireless (WLNP) proxy.
 *
 * WLNP is part of the public IristelX API (https://api.iristelx.com, paths
 * under /workflow; reference https://iristel-x.readme.io/reference/portin-submit).
 * This router republishes it under /api/wlnp/* so callers only ever see the
 * gateway's base URL, and the upstream key stays on the server.
 *
 *   gateway path            upstream path
 *   /api/wlnp/workflow/...  /workflow/...       port in / out, cancel service
 *   /api/wlnp/api/...       /workflow/api/...   port selection, details, ICP/SOA errors
 *   /api/wlnp/api/health    /_healthcheck       IristelX health (WLNP has none of its own)
 *
 * Only the method + path pairs in the WLNP catalog are forwarded, as in
 * lib/routes/ix.js, so an approved caller can't reach other IristelX
 * endpoints with the key.
 *
 * Every call uses Iristel's one key, so partners are scoped here: the gateway
 * records the port requests each partner submits (wlnp_requests) and a
 * partner only sees and changes those. Iristel staff and the internal key see
 * everything. For partners:
 *   health                               allowed
 *   port selection                       only their own rows (homeSpid ignored)
 *   port details, ICP/SOA errors         only their own requestNumber
 *   port in / cancel service request     allowed; the new reqNo is recorded
 *   port in modify / due date / cancel   only their own reqNo
 *   port out, port out response,         Iristel staff only (they act on
 *   cancel service response              other carriers' requests)
 *
 * Configure with:
 *   WLNP_BASE_URL   upstream origin (default https://api.iristelx.com)
 *   WLNP_API_KEY    sent as x-api-key; never reaches the client
 */

const express = require('express');
const axios = require('axios');
const { templateRegex } = require('../paths');
const db = require('../db');
const WLNP = require('../catalogs/lnp-wireless');

const DEFAULT_BASE = 'https://api.iristelx.com';
const P = '/api/wlnp';

// Partner rules, by catalog key ("METHOD /path").
const STAFF_ONLY = new Set([
  `POST ${P}/workflow/portout/submit`,
  `POST ${P}/workflow/portout/response/submit`,
  `POST ${P}/workflow/cancel-svc/response/submit`,
]);
const RECORDS = {
  [`POST ${P}/workflow/portin/submit`]: 'port-in',
  [`POST ${P}/workflow/cancel-svc/request/submit`]: 'cancel-service',
};
const OWN_BODY_REQ = new Set([
  `POST ${P}/workflow/portin/modify/submit`,
  `POST ${P}/workflow/portin/change-due-date/submit`,
  `POST ${P}/workflow/portin/cancel/submit`,
]);
const OWN_QUERY_REQ = new Set([`GET ${P}/api/port-details`, `GET ${P}/api/icp-soa-errors`]);
const SELECTION = `GET ${P}/api/port-selection`;

const qOwned = db.prepare('SELECT 1 FROM wlnp_requests WHERE req_no = ? AND email = ?');
const qMine = db.prepare('SELECT req_no FROM wlnp_requests WHERE email = ?');
const qRecord = db.prepare(`INSERT OR IGNORE INTO wlnp_requests (req_no, email, kind, created_at)
  VALUES (?, ?, ?, ?)`);

function upstreamPath(p) {
  if (p === '/api/health') return '/_healthcheck';
  if (p.startsWith('/api/')) return '/workflow' + p;
  return p;
}

const notYours = (res, reqNo) => res.status(404).json({
  error: 'not_found',
  message: `No port request ${String(reqNo || '').slice(0, 40) || '(none given)'} on your account. You can only use requests you submitted through the marketplace.`,
});

// A body with two keys that differ only in letter case (reqNo / ReqNo) could
// be read differently here and upstream, so partners can't send one.
function hasCaseDuplicateKeys(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return new Set(keys.map((k) => k.toLowerCase())).size !== keys.length;
}

module.exports = function wlnpRoutes() {
  const router = express.Router();
  const base = (process.env.WLNP_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const allowed = WLNP.map((e) => ({ key: `${e.method.toUpperCase()} ${e.path}`, method: e.method.toUpperCase(), re: templateRegex(e.path) }));

  router.use(async (req, res) => {
    const gatewayPath = P + req.path;
    const ep = allowed.find((r) => r.method === req.method && r.re.test(gatewayPath));
    if (!ep) {
      return res.status(404).json({ error: 'not_found', message: `${req.method} ${gatewayPath} is not part of Number Porting — Wireless` });
    }
    const m = req.marketplace || {};
    const everything = !!(m.internal || m.staff);
    if (!everything && m.product !== 'lnp-wireless') {
      return res.status(403).json({ error: 'forbidden', message: 'Your marketplace access does not include lnp-wireless.' });
    }
    const key = process.env.WLNP_API_KEY;
    if (!key) return res.status(503).json({ error: 'unavailable', message: 'WLNP_API_KEY is not configured on this gateway' });

    // Partner scoping, before anything is sent upstream.
    let qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    if (!everything) {
      if (STAFF_ONLY.has(ep.key)) {
        return res.status(403).json({ error: 'forbidden', message: 'Port-out and cancel-service responses act on other carriers\' requests, so Iristel staff handle them. Contact Iristel support.' });
      }
      const one = (v) => (Array.isArray(v) ? v[0] : v);
      if (OWN_QUERY_REQ.has(ep.key)) {
        const rn = String(one(req.query.requestNumber) || '');
        if (!rn || !qOwned.get(rn, m.email)) return notYours(res, rn);
        qs = '?requestNumber=' + encodeURIComponent(rn);      // nothing else rides along
      } else if (ep.key === SELECTION) {
        const keep = new URLSearchParams();
        for (const name of ['requestNumber', 'portedTn']) {
          const v = one(req.query[name]);
          if (v != null && v !== '') keep.set(name, String(v));
        }
        qs = keep.toString() ? '?' + keep.toString() : '';
      } else {
        qs = '';
      }
      if (hasCaseDuplicateKeys(req.body)) {
        return res.status(400).json({ error: 'bad_request', message: 'The body has field names that differ only in letter case.' });
      }
      if (OWN_BODY_REQ.has(ep.key)) {
        const rn = req.body && typeof req.body.reqNo === 'string' ? req.body.reqNo : '';
        if (!rn || !qOwned.get(rn, m.email)) return notYours(res, rn);
      }
    }

    const headers = { 'x-api-key': key, accept: req.get('accept') || 'application/json' };
    let data;
    if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length) {
      data = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
    }

    let upstream;
    try {
      upstream = await axios({
        method: req.method,
        url: base + upstreamPath(req.path) + qs,
        headers,
        data,
        timeout: 30000,
        responseType: 'text',
        transformResponse: (x) => x,
        validateStatus: () => true,
        maxRedirects: 0,
      });
    } catch (e) {
      // Async throws inside router.use are not caught by Express 4, so the
      // error is turned into a response here rather than rethrown.
      console.warn('[wlnp] upstream failed:', e.message);
      return res.status(504).json({ error: 'upstream_unreachable', message: 'The WLNP API did not respond. Try again in a moment.' });
    }

    const ok = upstream.status >= 200 && upstream.status < 300;
    let body = upstream.data;
    const parse = () => { try { return JSON.parse(body); } catch { return undefined; } };

    if (!everything && ok && ep.key === SELECTION) {
      // Only the caller's own requests, never the whole grid.
      const grid = parse();
      if (!grid || !Array.isArray(grid.items)) {
        return res.status(502).json({ error: 'bad_gateway', message: 'The WLNP API answered in an unexpected format.' });
      }
      const mine = new Set(qMine.all(m.email).map((r) => r.req_no));
      const items = grid.items.filter((it) => it && mine.has(String(it.requestNumber)));
      body = JSON.stringify({ total: items.length, items, homeSpid: grid.homeSpid, portFilter: grid.portFilter });
      res.set('content-type', 'application/json; charset=utf-8');
      return res.status(upstream.status).send(body);
    }

    if (ok && RECORDS[ep.key] && m.email) {
      // Remember who submitted the request so they (and only they) can use it.
      const d = parse();
      const reqNo = d && (d.reqNo || d.requestNumber || (d.data && (d.data.reqNo || d.data.requestNumber)));
      if (reqNo) qRecord.run(String(reqNo), m.email, RECORDS[ep.key], new Date().toISOString());
      else console.warn('[wlnp] submit answered 2xx without a reqNo; ownership not recorded');
    }

    const ct = upstream.headers['content-type'];
    if (ct) res.set('content-type', ct);
    res.status(upstream.status).send(body);
  });

  return router;
};
