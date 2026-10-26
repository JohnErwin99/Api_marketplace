'use strict';

/**
 * Builds lib/catalogs/rate-card.json, the versioned rate card the gateway
 * prices calls from (lib/catalogs/pricing.js), from the catalog and the
 * classification rules of the Oct 25 2026 pricing proposal:
 *
 *   - view, list, get, search, status and poll (GET) are free;
 *   - a change (POST, PUT, PATCH, DELETE) is a standard event;
 *   - OVERRIDES below: lookups sent as POST, bulk and orchestration requests
 *     (advanced), requests that order telecom service (service: no API fee,
 *     no double charge), 911 listing updates (free: essential emergency-
 *     address updates aren't gated behind paid automation), support tickets
 *     (free), and paid data lookups sent as GET (LRN).
 *
 * The classification is provisional until Product, Engineering and
 * Legal/Regulatory sign it off (proposal §7); every operation is listed with
 * its basis in the --rows output for that review (api-rate-card.xlsx).
 *
 *   node scripts/build-rate-card.js            write rate-card.json
 *   node scripts/build-rate-card.js --check    exit 1 if it would change
 *   node scripts/build-rate-card.js --rows out also write the review rows (JSON)
 */

const fs = require('fs');
const path = require('path');

// Loading the catalogs must not touch the real ledger; any temp folder made
// for that is removed on exit.
if (!process.env.DATA_DIR) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ratecard-'));
  process.env.DATA_DIR = tmp;
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
}
const { PRODUCTS } = require('../lib/catalogs');

const OUT = path.join(__dirname, '..', 'lib', 'catalogs', 'rate-card.json');

const META = {
  version: '2026-10-25-proposal',
  status: 'proposed',
  effective: null,               // set once the rates are approved
  currency: 'CAD',
  source: 'Iristel Direct API Marketplace — Pricing Implementation & Proposal Model, 25 October 2026',
  note: 'Proposed rates, subject to Product, Finance and Legal/Regulatory approval. Taxes extra.',
};

// [class, why] per "METHOD /path".
const OVERRIDES = {
  provisioning: {
    'POST /uboss-robot/trunk-provisioning': ['service', 'Provisions a SIP trunk (billed under the tariff)'],
  },
  'did-orders': {
    'POST /api/did-orders/orders': ['service', 'Orders phone numbers (number rental under the tariff)'],
    'POST /api/did-orders/orders/:orderId/complete': ['service', 'Completes a number order'],
  },
  'lnp-enterprise': {
    'POST /api/lnp/pons': ['service', 'Submits a port-in (the port request is free; service billed separately)'],
    'POST /api/lnp/pons/:pon/activate': ['service', 'Activates a port'],
    'POST /api/lnp/pons/:pon/status': ['free', 'Test-system tool, Iristel staff only'],
  },
  'lnp-wireless': {
    'POST /api/wlnp/workflow/portin/submit': ['service', 'Submits a wireless port-in'],
    'POST /api/wlnp/workflow/portout/submit': ['service', 'Submits a wireless port-out (Iristel staff only)'],
  },
  lrn: {
    'GET /api/lrn/basic/:number': ['standard', 'Paid data lookup (an LRN dip), not a read of your own data'],
    'GET /api/lrn/history/:number': ['advanced', 'LRN dip with porting history'],
    'POST /api/lrn/history': ['advanced', 'Bulk LRN lookup, up to 50 numbers: one event per request'],
  },
  'iristelx-accounts': {
    'POST /accounts/:accountId/services': ['service', 'Adds a service to an account (plan/service charges apply)'],
    'POST /accounts/authenticatePin/:accountId': ['free', 'Verifies a PIN; changes nothing'],
  },
  'iristelx-sim': {
    'PUT /esim-cards/:iccid/assign': ['service', 'Assigns (activates) an eSIM'],
  },
  'iristelx-mobile': {
    'POST /mobile/port-in': ['service', 'Submits a mobile port-in'],
    'POST /mobile/app-user-notification-read': ['free', 'Marks a notification read'],
    'POST /mobile/service-now/tickets': ['free', 'Support request'],
    'POST /mobile/service-now/tickets/:id/comments': ['free', 'Support request'],
    'POST /mobile/service-now/tickets/:id/images': ['free', 'Support request'],
  },
  e911: {
    'POST /911-info': ['free', 'Emergency-address update: not gated behind paid automation'],
    'PUT /911-info': ['free', 'Emergency-address update: not gated behind paid automation'],
    'DELETE /911-info': ['free', 'Emergency-address update: not gated behind paid automation'],
    'POST /911-info/upload': ['advanced', 'Bulk listing automation (provisional: review against the safety note)'],
  },
  broadworks: {
    'POST /api/broadworks/groups/:groupId/users': ['service', 'Adds a BroadWorks user (seat billed under the tariff)'],
    'POST /api/broadworks/users/:userId/services/assign': ['service', 'Assigns BroadWorks services or a service pack'],
    'POST /api/broadworks/groups/:groupId/dns/assign': ['advanced', 'Assigns a list of numbers to a group'],
    'POST /api/broadworks/groups/:groupId/dns/unassign': ['advanced', 'Removes a list of numbers from a group'],
    'POST /api/broadworks/groups/:groupId/dns/activate': ['advanced', 'Activates a list of numbers'],
  },
};

const rule = (method) => (method === 'GET'
  ? ['free', 'Read: view, list, get, search or status']
  : ['standard', 'Standalone administrative or configuration change']);

const operations = {};
const rows = [];
const usedOverrides = new Set();
for (const p of PRODUCTS) {
  operations[p.id] = {};
  for (const e of p.endpoints || []) {
    const key = `${e.method.toUpperCase()} ${e.path}`;
    const o = (OVERRIDES[p.id] || {})[key];
    if (o) usedOverrides.add(`${p.id} ${key}`);
    const [cls, why] = o || rule(e.method.toUpperCase());
    operations[p.id][key] = cls;
    rows.push({ family: p.name, product: p.id, operation: key, summary: e.summary || '', class: cls, basis: o ? 'override' : 'rule', why });
  }
}
const stale = Object.entries(OVERRIDES).flatMap(([pid, ops]) => Object.keys(ops).map((k) => `${pid} ${k}`))
  .filter((k) => !usedOverrides.has(k));

const json = JSON.stringify({ ...META, operations }, null, 2) + '\n';
const count = (c) => rows.filter((r) => r.class === c).length;
console.log(`${rows.length} operations: ${count('free')} free, ${count('standard')} standard, ${count('advanced')} advanced, ${count('service')} service`);
if (stale.length) console.log(`Overrides with no catalog operation (product not built yet, or a renamed path): ${stale.join(', ')}`);

const args = process.argv.slice(2);
if (args.includes('--check')) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (now !== json) { console.log('rate-card.json is out of date'); process.exit(1); }
  console.log('rate-card.json is up to date');
} else {
  fs.writeFileSync(OUT, json);
  console.log(`Wrote ${OUT}`);
}
const rowsAt = args.indexOf('--rows');
if (rowsAt !== -1 && args[rowsAt + 1]) {
  fs.writeFileSync(args[rowsAt + 1], JSON.stringify(rows, null, 2));
  console.log(`Wrote review rows to ${args[rowsAt + 1]}`);
}
