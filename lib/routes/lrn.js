'use strict';

/**
 * LRN Lookup routes: Espresso REST number dipping for Canada and the US
 * (catalog: lib/catalogs/lrn.js).
 *
 *   gateway                         Espresso (/ws/v1)
 *   GET  /api/lrn/basic/:number     GET  /dip/caus/basicdip/{company}/{number}
 *   GET  /api/lrn/history/:number   GET  /dipping/caus/history/basicdip/{company}/{number}
 *   POST /api/lrn/history           POST /dipping/caus/history/basicdip/{company}   (1–50 numbers)
 *
 * Numbers are taken as 10 digits or 11 starting with 1 and sent as 11.
 * Partners reach Espresso's production system; staff and internal callers
 * may pick its sandbox (edidEnv). Lookups change nothing, so there is no
 * ownership to track.
 */

const express = require('express');
const { AppError } = require('../soap');
const { edidEnv } = require('../entitlements');
const espresso = require('../espresso-rest');

const MAX_BULK = 50;

// "(416) 800-4747" / "4168004747" / "+14168004747" -> "14168004747", or null.
function e164(n) {
  if (typeof n !== 'string' && typeof n !== 'number') return null;
  const d = String(n).slice(0, 40).replace(/[\s().+-]/g, '');
  if (/^\d{10}$/.test(d)) return '1' + d;
  if (/^1\d{10}$/.test(d)) return d;
  return null;
}
const badNumber = (n) => new AppError(400, 'validation_error',
  `"${String(n).slice(0, 30)}" is not a phone number: use 10 digits, or 11 starting with 1.`);

module.exports = function lrnRoutes(h) {
  // Exact paths only (letter case, trailing slash), like the entitlement
  // check that classified the request (lib/entitlements.js).
  const router = express.Router({ caseSensitive: true, strict: true });

  router.get('/basic/:number', h(async (req, res) => {
    const number = e164(req.params.number);
    if (!number) throw badNumber(req.params.number);
    const env = edidEnv(req);
    const company = encodeURIComponent(await espresso.companyId(env));
    const { data } = await espresso.request(env, 'GET', `/dip/caus/basicdip/${company}/${number}`);
    res.json(data);
  }));

  router.get('/history/:number', h(async (req, res) => {
    const number = e164(req.params.number);
    if (!number) throw badNumber(req.params.number);
    const env = edidEnv(req);
    const company = encodeURIComponent(await espresso.companyId(env));
    const { data } = await espresso.request(env, 'GET', `/dipping/caus/history/basicdip/${company}/${number}`);
    res.json(data);
  }));

  router.post('/history', h(async (req, res) => {
    const list = req.body && req.body.numbers;
    // The size is checked before any work per number, so a huge list costs nothing.
    if (!Array.isArray(list) || !list.length || list.length > MAX_BULK) {
      throw new AppError(400, 'validation_error', `Body must be { "numbers": [ ... ] } with 1 to ${MAX_BULK} phone numbers.`);
    }
    const seen = new Set();
    for (const n of list) {
      const d = e164(n);
      if (!d) throw badNumber(n);
      seen.add(d);
    }
    const numbers = [...seen];
    const env = edidEnv(req);
    const company = encodeURIComponent(await espresso.companyId(env));
    const { data } = await espresso.request(env, 'POST', `/dipping/caus/history/basicdip/${company}`, { body: numbers });
    res.json(data);
  }));

  return router;
};

module.exports.e164 = e164;
