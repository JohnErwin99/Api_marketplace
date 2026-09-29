'use strict';

/**
 * IristelX proxy: /api/ix/<product>/<path> -> https://api.iristelx.com/<path>
 *
 * Covers the products whose upstream is the IristelX API (provisioning, 911,
 * accounts, SIM, commissions, mobile). The upstream keys stay on the server
 * and are injected here, so they never reach a browser or a partner app.
 * Only the method + path pairs listed in that product's catalog are
 * forwarded — an approved caller can't reach other IristelX endpoints with
 * the key. The entitlement middleware has already checked the caller is
 * approved for <product>.
 *
 * Keys (Render env):
 *   IRISTELX_API_KEY  provisioning (uBoss) and 911
 *   MIND_API_KEY      iristelx-accounts, -sim, -commission, -mobile
 */

const express = require('express');

const IX_BASE = 'https://api.iristelx.com';
const KEY_ENV = {
  provisioning: 'IRISTELX_API_KEY',
  e911: 'IRISTELX_API_KEY',
  'iristelx-accounts': 'MIND_API_KEY',
  'iristelx-sim': 'MIND_API_KEY',
  'iristelx-commission': 'MIND_API_KEY',
  'iristelx-mobile': 'MIND_API_KEY',
};

const { templateRegex: toRegex } = require('../paths');

// Response headers worth passing back to the caller.
const PASS = ['content-type', 'content-disposition', 'cache-control'];

module.exports = function ixRoutes(PRODUCTS) {
  const allowed = {};
  for (const p of PRODUCTS) {
    if (!KEY_ENV[p.id]) continue;
    allowed[p.id] = (p.endpoints || []).map((e) => ({ method: e.method.toUpperCase(), re: toRegex(e.path) }));
  }

  const router = express.Router();
  // JSON bodies are parsed globally; the 911 CSV upload arrives as multipart
  // and is forwarded byte for byte.
  router.use(express.raw({ type: 'multipart/form-data', limit: '10mb' }));

  router.all('/:product/*', async (req, res) => {
    const { product } = req.params;
    const upstreamPath = '/' + req.params[0];
    const rules = allowed[product];
    if (!rules) return res.status(404).json({ error: 'not_found', message: `Unknown product ${product}` });
    if (!rules.some((r) => r.method === req.method && r.re.test(upstreamPath))) {
      return res.status(404).json({ error: 'not_found', message: `${req.method} ${upstreamPath} is not part of ${product}` });
    }
    const key = process.env[KEY_ENV[product]];
    if (!key) return res.status(503).json({ error: 'unavailable', message: `${KEY_ENV[product]} is not configured on this gateway` });

    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    // IristelX's docs name the header iristelx-api-key but the live API only
    // accepts x-api-key; send both.
    const headers = { 'x-api-key': key, 'iristelx-api-key': key, accept: req.get('accept') || '*/*' };
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (Buffer.isBuffer(req.body)) {
        body = req.body;
        headers['content-type'] = req.get('content-type');
      } else if (req.body && Object.keys(req.body).length) {
        body = JSON.stringify(req.body);
        headers['content-type'] = 'application/json';
      }
    }

    try {
      const r = await fetch(IX_BASE + upstreamPath + qs, { method: req.method, headers, body, redirect: 'manual' });
      res.status(r.status);
      for (const h of PASS) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.warn('[ix] upstream failed:', err.message);
      res.status(502).json({ error: 'bad_gateway', message: 'IristelX did not respond' });
    }
  });

  return router;
};
