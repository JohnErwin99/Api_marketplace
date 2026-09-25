'use strict';
/**
 * One-time cleanup: remove the API Marketplace TEST accounts from the
 * iris-sandbox CRM so the marketplace starts fresh (user request, Sept 24).
 *
 * Deletes only the four accounts created during marketplace testing
 * (Sept 17–23, 2026) — identified by GUID, listed explicitly below — plus
 * any Contact the marketplace intake created (description marker).
 * No other CRM records are touched.
 *
 * Run: node scripts/d365-cleanup-test-accounts.js
 */
const { api } = require('./d365');

const TEST_ACCOUNTS = [
  // Sept 25 test requests (IRistel request row lived only on Render's disk;
  // its CRM account merged into this one by the org-name match):
  ['c499e342-e5b8-f111-aaad-6045bdccfb22', 'Erwin Test / IRistel (Sept 25 tests)'],
  ['1e21724f-b3b2-f111-aaab-6045bdccfb22', 'Void Co (REQ-MU5QGV2K test)'],
  ['190bf3b8-b6b2-f111-aaab-6045bdccfb22', 'Void (REQ-MU5RC6LB test)'],
  ['30f49f09-55b7-f111-aaad-6045bdccfb22', 'Erwin Test Corp (sign-up test)'],
  ['4a85460b-99b2-f111-aaac-7ced8d068950', 'Northstar Test Wireless (REQ-MU5JQYLH test)'],
];

(async () => {
  const who = await api('GET', '/WhoAmI');
  if (!who.ok) throw new Error('WhoAmI ' + who.status);

  for (const [id, label] of TEST_ACCOUNTS) {
    const r = await api('DELETE', `/accounts(${id})`);
    console.log(`delete account ${label}: ${r.status === 204 ? 'done' : 'HTTP ' + r.status}`);
  }

  // Contacts the marketplace intake created (it stamps this description).
  const c = await api('GET', "/contacts?$select=contactid,fullname&$filter=contains(description,'API Marketplace')");
  for (const x of (c.json.value || [])) {
    const r = await api('DELETE', `/contacts(${x.contactid})`);
    console.log(`delete contact ${x.fullname}: ${r.status === 204 ? 'done' : 'HTTP ' + r.status}`);
  }

  const check = await api('GET', '/accounts?$select=accountid&$filter=cr57d_apimarketplaceapproved ne null or cr57d_requestedscopes ne null or cr57d_apimarketplaceaccess ne null');
  console.log('remaining marketplace accounts:', (check.json.value || []).length);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
