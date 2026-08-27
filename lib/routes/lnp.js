'use strict';

/**
 * Number Porting — Enterprise (LNP) routes.
 *
 * Thin REST surface over the Espresso v4 SOAP LNP methods. Credentials and
 * environment resolution are shared with the DID product; the only difference
 * is that every call targets the v4 endpoint.
 */

const express = require('express');
const soap = require('../soap');
const { AppError, call, str, ponStructure, routingStructure } = soap;

/** @param {(req) => {creds, env}} resolveContext @param {(fn) => Function} h */
module.exports = function lnpRoutes(resolveContext, h) {
  const router = express.Router();

  // Every LNP method lives on v4.
  const lnp = (method, inner, req) => {
    const { creds, env } = resolveContext(req);
    return call(method, inner, creds, env, 'v4');
  };

  const requireBody = (req, key) => {
    const v = req.body && req.body[key];
    if (!v || typeof v !== 'object') {
      throw new AppError(400, 'validation_error', `Body must include "${key}"`);
    }
    return v;
  };

  // lnpCheckNpaNxxPortability
  router.get('/portability/:npanxx', h(async (req, res) => {
    const npanxx = String(req.params.npanxx);
    if (!/^\d{6}$/.test(npanxx)) {
      throw new AppError(400, 'validation_error', 'npanxx must be exactly 6 digits (NPA + NXX)');
    }
    const out = await lnp('lnpCheckNpaNxxPortability', str('npanxx', npanxx), req);
    const code = Number(out);
    const meaning = code === 1 ? 'portable'
      : code === 0 ? 'supported_not_yet_open'
      : 'not_portable';
    res.json({ npanxx, portable: code, meaning });
  }));

  // lnpGetRoutingProfiles
  router.get('/routing-profiles', h(async (req, res) => {
    res.json({ items: await lnp('lnpGetRoutingProfiles', '', req) });
  }));

  // lnpGetApplicationErrorDictionary
  router.get('/error-dictionary', h(async (req, res) => {
    res.json({ items: await lnp('lnpGetApplicationErrorDictionary', '', req) });
  }));

  // lnpGetReport
  router.get('/report', h(async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) {
      throw new AppError(400, 'validation_error', 'Query params "from" and "to" are required (Y-m-d H:i:s)');
    }
    const inner = str('startDate', from) + str('endDate', to);
    res.json({ items: await lnp('lnpGetReport', inner, req) });
  }));

  // lnpPonsStatusFromDate  (declared before /pons/:pon so "updated" is not captured)
  router.get('/pons/updated', h(async (req, res) => {
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'validation_error', 'Query param "date" is required (Y-m-d H:i:s)');
    }
    res.json({ items: await lnp('lnpPonsStatusFromDate', str('date', date), req) });
  }));

  // lnpPonsByStatus
  router.get('/pons', h(async (req, res) => {
    const { status } = req.query;
    if (!status) {
      throw new AppError(400, 'validation_error', 'Query param "status" is required');
    }
    res.json({ items: await lnp('lnpPonsByStatus', str('status', status), req) });
  }));

  // lnpCreatePons
  router.post('/pons', h(async (req, res) => {
    const ponData = requireBody(req, 'pon_data');
    const routing = (req.body && req.body.routing) || {};
    const inner = `<data xsi:type="ns1:lnpCreatePonRequest">` +
      ponStructure(ponData) + routingStructure(routing) + `</data>`;
    const out = await lnp('lnpCreatePons', inner, req);
    res.status(201).json({ pons: out });
  }));

  // lnpPonLastStatus
  router.get('/pons/:pon', h(async (req, res) => {
    const inner = str('pon', req.params.pon);
    res.json({ pon: req.params.pon, details: await lnp('lnpPonLastStatus', inner, req) });
  }));

  // lnpEditPon
  router.post('/pons/:pon/edit', h(async (req, res) => {
    const ponData = requireBody(req, 'pon_data');
    const inner = `<data xsi:type="ns1:lnpEditPonRequest">` +
      str('pon', req.params.pon) + ponStructure(ponData) + `</data>`;
    res.json({ result: await lnp('lnpEditPon', inner, req) });
  }));

  // lnpEditPonRouting
  router.post('/pons/:pon/routing', h(async (req, res) => {
    const routing = requireBody(req, 'routing');
    const inner = `<data xsi:type="ns1:lnpEditPonRoutingRequest">` +
      str('pon', req.params.pon) + routingStructure(routing) + `</data>`;
    res.json({ result: await lnp('lnpEditPonRouting', inner, req) });
  }));

  // lnpEditDDD
  router.post('/pons/:pon/due-date', h(async (req, res) => {
    const { desired_due_date, auth_date } = req.body || {};
    if (!desired_due_date || !auth_date) {
      throw new AppError(400, 'validation_error', 'Body must include "desired_due_date" and "auth_date"');
    }
    const inner = str('pon', req.params.pon) +
      str('desired_due_date', desired_due_date) + str('auth_date', auth_date);
    res.json({ result: await lnp('lnpEditDDD', inner, req) });
  }));

  // lnpCancelPon
  router.post('/pons/:pon/cancel', h(async (req, res) => {
    const inner = str('pon', req.params.pon);
    res.json({ result: await lnp('lnpCancelPon', inner, req) });
  }));

  // lnpActivatePon
  router.post('/pons/:pon/activate', h(async (req, res) => {
    const inner = str('pon', req.params.pon);
    res.json({ pon: req.params.pon, activated: await lnp('lnpActivatePon', inner, req) });
  }));

  // lnpPonChangeStatus  (sandbox only, per the v4 manual)
  router.post('/pons/:pon/status', h(async (req, res) => {
    const { status } = req.body || {};
    if (!status) {
      throw new AppError(400, 'validation_error', 'Body must include "status"');
    }
    const { env } = resolveContext(req);
    if (env !== 'test') {
      throw new AppError(409, 'sandbox_only', 'lnpPonChangeStatus is available on the test environment only');
    }
    const inner = str('pon', req.params.pon) + str('status', status);
    res.json({ result: await lnp('lnpPonChangeStatus', inner, req) });
  }));

  // lnpPonInfoForTelNumber
  router.get('/numbers/:number/pons', h(async (req, res) => {
    const inner = str('number', req.params.number);
    res.json({ number: req.params.number, items: await lnp('lnpPonInfoForTelNumber', inner, req) });
  }));

  return router;
};
