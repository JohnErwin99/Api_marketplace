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
 *
 * Pricing tiers. Every operation also has a tier (tiers.json, imported from
 * the api-tier-map.xlsx workbook by scripts/import-tier-map.py): Free,
 * Standard, Premium or Service transaction. Tiers are published in the
 * catalog and shown in the console and on the marketplace pages, but they
 * don't change billing yet: tier prices aren't set (priceCents null =
 * "coming soon"), so every successful live call is still CALL_CENTS. When
 * prices are decided, set them in TIERS and have priceFor() use the tier.
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

const TIER_MAP = require('./tiers.json');

// Shown on the marketplace pages and in the console, in this order.
const TIERS = [
  {
    id: 'free', name: 'Free', billingUnit: 'No charge', priceCents: null,
    whatsIn: 'Health checks, reference data (rate centres, routing profiles, plan lists, error codes) and status reads, so checking on an order or port won\'t cost you once tier prices start.',
    examples: ['Health check', 'Rate centres', 'Order status', 'LNP error codes'],
  },
  {
    id: 'standard', name: 'Standard', billingUnit: 'Per call', priceCents: null,
    whatsIn: 'Everyday reads and changes on accounts, services, SIM inventory, plans, tickets, notifications and reports.',
    examples: ['Get an account', 'Update voicemail', 'List SIM cards', 'List orders'],
  },
  {
    id: 'premium', name: 'Premium', billingUnit: 'Per call', priceCents: null,
    whatsIn: 'High-value data and regulated work: portability checks, porting changes, E911 listings, number lookups with history and usage data.',
    examples: ['Portability check', 'Edit a port request', 'Add a 911 listing', 'Service usage'],
  },
  {
    id: 'transaction', name: 'Service transaction', billingUnit: 'Per transaction', priceCents: null,
    whatsIn: 'Calls that create a real service event: number orders, port submissions, trunk provisioning, account and service creation, SIM swaps and eSIM activation.',
    examples: ['Order numbers', 'Submit a port', 'Provision a SIP trunk', 'Assign an eSIM'],
  },
];
const TIER_IDS = new Set(TIERS.map((t) => t.id));

// The tier of one catalog endpoint ("METHOD /path"), or null if it has none.
function tierFor(product, endpointKey) {
  const t = endpointKey && (TIER_MAP[product] || {})[endpointKey];
  return TIER_IDS.has(t) ? t : null;
}

// What partners pay today, shown wherever tiers are.
const PRICING_NOTE = `Today every successful live call is ${CALL_CENTS}¢ CAD, whatever its tier; sandbox calls are free. Tier prices are coming soon.`;

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

module.exports = { PRICES, CALL_CENTS, TIERS, PRICING_NOTE, init, matchEndpoint, priceFor, tierFor };
