'use strict';

/**
 * API Marketplace packages — what a partner pays, in CAD cents.
 *
 * There are no per-call charges. A partner is on one package, chosen on the
 * access-request form and confirmed by staff (CRM column
 * cr57d_apimarketplacepackage, see lib/onboarding.js):
 *
 *   free      no charge, no card needed — Free endpoints only
 *   standard  monthly fee — Free + Standard endpoints
 *   premium   monthly fee — everything (Standard + Premium endpoints)
 *
 * Every catalog operation has a tier (tiers.json, imported from the
 * api-tier-map.xlsx workbook by scripts/import-tier-map.py): free, standard or
 * premium. A package includes an operation when its rank is at least the
 * operation's tier rank; lib/entitlements.js refuses the rest with
 * 403 upgrade_required. The workbook's old "Service transaction" tier is part
 * of Premium.
 *
 * The monthly fee is invoiced for every month a paid package was active with
 * a card on file (lib/invoices.js). Calls by Iristel staff and internal
 * employees are never billed.
 */

const { templateRegex } = require('../paths');

const TIER_MAP = require('./tiers.json');

// Shown on the marketplace pages and in the console, in this order.
// priceCents is per month; rank orders them (each includes the ones below).
const PACKAGES = [
  {
    id: 'free', name: 'Free', rank: 0, priceCents: 0, billingUnit: 'No charge',
    includes: null,
    whatsIn: 'Health checks, reference data (routing profiles, plan lists, error codes) and status reads. No card needed.',
    examples: ['Health check', 'Routing profiles', 'Port status', 'LNP error codes'],
  },
  {
    id: 'standard', name: 'Standard', rank: 1, priceCents: 1, billingUnit: 'Per month',
    includes: 'free',
    whatsIn: 'Everything in Free, plus everyday reads and changes on accounts, services, SIM inventory, plans, tickets, notifications and reports.',
    examples: ['Get an account', 'Update voicemail', 'List SIM cards', 'List port requests'],
  },
  {
    id: 'premium', name: 'Premium', rank: 2, priceCents: 1, billingUnit: 'Per month',
    includes: 'standard',
    whatsIn: 'Everything in Standard, plus the calls that create or change real service: number orders, port submissions and changes, trunk provisioning, account and service creation, SIM swaps, eSIM activation, E911 listings, portability checks, LRN history and usage data.',
    examples: ['Submit a port', 'Provision a SIP trunk', 'Assign an eSIM', 'Add a 911 listing'],
  },
];
const BY_ID = Object.fromEntries(PACKAGES.map((p) => [p.id, p]));
const PACKAGE_IDS = PACKAGES.map((p) => p.id);
const packageOf = (id) => BY_ID[id] || null;

// The tier of one catalog endpoint ("METHOD /path"), or null if it has none.
function tierFor(product, endpointKey) {
  const t = endpointKey && (TIER_MAP[product] || {})[endpointKey];
  return BY_ID[t] ? t : null;
}

// Does this package include an endpoint of this tier? An endpoint with no
// tier counts as Premium, so a gap in tiers.json fails closed.
function packageAllows(pkg, tier) {
  const p = BY_ID[pkg];
  return !!p && p.rank >= (BY_ID[tier] || BY_ID.premium).rank;
}

// The higher of two packages (either may be null).
const higherPackage = (a, b) => (!BY_ID[a] ? (BY_ID[b] ? b : null) : !BY_ID[b] ? a : BY_ID[a].rank >= BY_ID[b].rank ? a : b);

const cents = (c) => (c < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`);
// What partners pay, shown wherever packages are.
const PRICING_NOTE = `Three packages: ${PACKAGES.map((p) => `${p.name} (${p.priceCents ? `${cents(p.priceCents)} CAD a month` : 'no charge'})`).join(', ')}. `
  + 'Each package includes the one before it. There are no per-call charges.';

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

module.exports = {
  PACKAGES, PACKAGE_IDS, PRICING_NOTE, packageOf, packageAllows, higherPackage,
  init, matchEndpoint, tierFor,
};
