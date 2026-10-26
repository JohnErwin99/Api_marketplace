'use strict';

/**
 * API Marketplace pricing — what a partner pays, in CAD.
 *
 * From the "Pricing Implementation & Proposal Model" (Product, Finance,
 * Engineering, 25 Oct 2026). These are PROPOSED rates: they need Product,
 * Finance and Legal/Regulatory sign-off before they are final, and every
 * page that shows them says so (RATE_CARD.status).
 *
 * There is no subscription and no platform fee. Every catalog operation has a
 * rate class, from the versioned rate card (rate-card.json, built by
 * scripts/build-rate-card.js):
 *
 *   free      view, list, get, search, status and poll; never charged
 *   standard  a standalone admin or configuration change: 1¢ per
 *             successful event
 *   advanced  a bulk or orchestration request: 2.5¢ per successful event
 *             (one request = one event, however many items it carries)
 *   service   a request that orders telecom service (numbers, ports, trunks,
 *             SIM/eSIM activation...): no API fee; the service itself is
 *             billed under Iristel's tariff, never twice
 *
 * An operation missing from the rate card is never charged (it is logged for
 * review). Only successful (2xx) live calls are billable; lib/entitlements.js
 * meters them and lib/invoices.js bills them monthly.
 *
 * The developer sandbox: SANDBOX_CALLS non-production calls per account per
 * calendar month, never billed. Calls past the allowance are refused, not
 * charged.
 */

const { templateRegex } = require('../paths');

const RATE_CARD = require('./rate-card.json');

// Shown on the marketplace pages and in the console, in this order.
// priceCents may be fractional (2.5); invoices round each line to the cent.
const CLASSES = [
  {
    id: 'free', name: 'Free', priceCents: 0, billingUnit: 'No charge',
    whatsIn: 'Basic reads and status: view, list, get, search and status requests, including routine tracking and polling. Commission reports. Single 911 listing updates.',
    examples: ['Port status', 'List SIM cards', 'Search available numbers', 'Update a 911 listing'],
  },
  {
    id: 'standard', name: 'Standard', priceCents: 1, billingUnit: 'Per successful event',
    whatsIn: 'Standalone administrative or configuration changes: account, plan and service updates, voicemail and forwarding, SIM reservations, PON corrections.',
    examples: ['Update voicemail', 'Change a due date', 'Reserve a SIM', 'Basic LRN lookup'],
  },
  {
    id: 'advanced', name: 'Advanced', priceCents: 2.5, billingUnit: 'Per successful event',
    whatsIn: 'Bulk or orchestration requests, priced per completed request rather than per item inside it.',
    examples: ['Bulk LRN lookup (50 numbers)', 'LRN with porting history', 'Bulk 911 upload'],
  },
  {
    id: 'service', name: 'Service order', priceCents: 0, billingUnit: 'No API fee',
    whatsIn: 'Requests that order telecom service: phone numbers, port-ins, SIP trunks, SIM and eSIM activation. The service is billed under the published tariff; the API call itself adds nothing.',
    examples: ['Order phone numbers', 'Submit a port', 'Provision a SIP trunk', 'Assign an eSIM'],
  },
];
const BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
const classOf = (id) => (Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null);

// Free monthly sandbox allowance per account.
const SANDBOX_CALLS = 1000;

// Proposed public telecom service rates (proposal §4), shown on the public
// page below the API rates. Proposed, not approved; taxes extra.
const TELECOM_RATES = [
  { service: 'Local phone number', rate: '$1.00 / number / month', note: 'Recurring on active assigned numbers.' },
  { service: 'Local numbers, 1,000+', rate: '$0.75 / number / month', note: 'Eligible active number inventory.' },
  { service: 'Toll-free number', rate: '$1.50 / number / month', note: 'Recurring on active assigned numbers.' },
  { service: 'Wireline or wireless port-in', rate: '$0', note: 'The port request is free; separately ordered service is billed.' },
  { service: '911 / E911 listing', rate: '$1.00 / number / month', note: 'No setup charge.' },
  { service: 'SIP trunk setup', rate: '$0', note: 'No setup fee.' },
  { service: 'SIP outbound', rate: 'From $0.0100 / minute', note: 'Eligible routes.' },
  { service: 'SIP inbound', rate: 'From $0.0085 / minute', note: 'Eligible routes and numbers.' },
  { service: 'SIM / eSIM activation', rate: '$0 with an eligible line', note: 'The mobile plan applies.' },
  { service: 'Active mobile line', rate: 'Iristel plan rate', note: 'Per the approved plan.' },
  { service: 'Commission reporting', rate: '$0', note: 'Free reports and lookups.' },
  { service: 'Partner / enterprise', rate: 'Contracted pricing', note: 'Credit terms and contracted rates override public rates.' },
];

const cents = (c) => (c < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`);
// One line for pages, the console and Iris.
const PRICING_NOTE = 'No subscription or platform fee. Basic reads and status are free; '
  + `Standard changes are ${cents(BY_ID.standard.priceCents)} and Advanced bulk requests ${cents(BY_ID.advanced.priceCents)} CAD per successful event; `
  + 'service orders add no API fee (the service is billed under the tariff). '
  + `Free developer sandbox: ${SANDBOX_CALLS.toLocaleString('en-CA')} non-production calls a month per account.`;

// The rate class of one catalog endpoint ("METHOD /path"), or null when the
// rate card doesn't list it (never charged).
// Own properties only: a product id comes from the request path, and
// "constructor" or "__proto__" must not reach Object.prototype.
const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
function rateFor(product, endpointKey) {
  const id = endpointKey && own(own(RATE_CARD.operations, product), endpointKey);
  return own(BY_ID, id) || null;
}

// Catalog endpoints per product, compiled once: [{ key, method, re }].
let COMPILED = new Map();
function init(PRODUCTS) {
  COMPILED = new Map();
  const missing = [];
  for (const p of PRODUCTS) {
    COMPILED.set(p.id, (p.endpoints || []).map((e) => {
      const key = `${e.method.toUpperCase()} ${e.path}`;
      if (!rateFor(p.id, key)) missing.push(`${p.id} ${key}`);
      return { key, method: e.method.toUpperCase(), re: templateRegex(e.path), e };
    }));
  }
  if (missing.length) {
    console.warn(`[pricing] ${missing.length} operation(s) missing from the rate card (never charged; run scripts/build-rate-card.js): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);
  }
}

// The catalog endpoint a request hit, as "METHOD /template", or null.
// `endpointPath` is the path the catalog uses: the full /api/... path for
// Espresso, WLNP and BroadWorks products, and the upstream path for IristelX
// products (the part after /api/ix/<product>).
function matchEndpoint(product, method, endpointPath) {
  const m = String(method).toUpperCase();
  const hit = (COMPILED.get(product) || []).find((e) => e.method === m && e.re.test(endpointPath));
  return hit ? hit.key : null;
}

// The catalog endpoint object for a "METHOD /template" key, or null.
function endpointOf(product, endpointKey) {
  const hit = (COMPILED.get(product) || []).find((c) => c.key === endpointKey);
  return hit ? hit.e : null;
}

// Path parameters of a request, by template name: "/accounts/:accountId"
// and "/accounts/A1" -> { accountId: 'A1' } (decoded). {} when it doesn't match.
function paramsFor(endpointKey, endpointPath) {
  const template = String(endpointKey).replace(/^\S+\s+/, '');
  const names = [];
  const re = new RegExp('^' + template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z0-9_]+)/g, (m, n) => { names.push(n); return '([^/]+)'; }) + '$');
  const m = String(endpointPath).match(re);
  if (!m) return {};
  const out = {};
  names.forEach((n, i) => { try { out[n] = decodeURIComponent(m[i + 1]); } catch { out[n] = m[i + 1]; } });
  return out;
}

// What the public catalog and console show about pricing.
const publicRateCard = () => ({
  version: RATE_CARD.version, status: RATE_CARD.status, effective: RATE_CARD.effective,
  currency: RATE_CARD.currency, note: RATE_CARD.note,
  classes: CLASSES, sandboxCalls: SANDBOX_CALLS, telecomRates: TELECOM_RATES, pricingNote: PRICING_NOTE,
});

module.exports = {
  CLASSES, RATE_CARD, SANDBOX_CALLS, TELECOM_RATES, PRICING_NOTE,
  classOf, rateFor, init, matchEndpoint, endpointOf, paramsFor, publicRateCard, cents,
};
