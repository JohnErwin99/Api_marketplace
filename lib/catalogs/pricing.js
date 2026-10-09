'use strict';

/**
 * API usage prices — charged per SUCCESSFUL call (HTTP 2xx), in CAD cents.
 *
 * Every product is CALL_CENTS (1 cent) per successful live call for now. To
 * price something differently, set the product's `default` (applies to all
 * its endpoints) and/or a specific endpoint by its catalog key
 * "METHOD /path/:param", e.g.
 *
 *   dids: { default: 0, 'POST /api/orders': 200 },   // $2.00 per order
 *
 * Only live calls are billed: Espresso test-environment calls (DIDs/LNP in
 * the console) and calls by Iristel staff and internal employees are never
 * billable — see lib/entitlements.js.
 */

const { templateRegex } = require('../paths');

const CALL_CENTS = 1;

const PRICES = {
  provisioning:          { default: CALL_CENTS },
  dids:                  { default: CALL_CENTS },
  'lnp-enterprise':      { default: CALL_CENTS },
  'lnp-wireless':        { default: CALL_CENTS },
  'iristelx-accounts':   { default: CALL_CENTS },
  'iristelx-sim':        { default: CALL_CENTS },
  'iristelx-commission': { default: CALL_CENTS },
  'iristelx-mobile':     { default: CALL_CENTS },
  e911:                  { default: CALL_CENTS },
};

// Catalog endpoints per product, compiled once: [{ key, method, re }].
let COMPILED = {};
function init(PRODUCTS) {
  COMPILED = {};
  for (const p of PRODUCTS) {
    COMPILED[p.id] = (p.endpoints || []).map((e) => ({
      key: `${e.method.toUpperCase()} ${e.path}`, method: e.method.toUpperCase(), re: templateRegex(e.path),
    }));
  }
}

// The catalog endpoint a request hit, as "METHOD /template", or null.
// `endpointPath` is the path the catalog uses: the full /api/... path for
// Espresso and WLNP products, and the upstream path for IristelX products
// (the part after /api/ix/<product>).
function matchEndpoint(product, method, endpointPath) {
  const m = String(method).toUpperCase();
  const hit = (COMPILED[product] || []).find((e) => e.method === m && e.re.test(endpointPath));
  return hit ? hit.key : null;
}

// Price in cents for one successful call to that endpoint.
function priceFor(product, endpointKey) {
  const p = PRICES[product];
  if (!p) return 0;
  if (endpointKey && Object.prototype.hasOwnProperty.call(p, endpointKey)) return p[endpointKey];
  return p.default || 0;
}

module.exports = { PRICES, init, matchEndpoint, priceFor };
