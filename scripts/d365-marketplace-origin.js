'use strict';
/**
 * Mark every account that has requested or holds API Marketplace access as a
 * marketplace customer (cr57d_leadsourcedetail = "API Marketplace landing
 * page"), so the portal shows them only the marketplace (Oct 2026 decision:
 * everyone already using the marketplace gets the marketplace-only view).
 *
 * Skips Iristel staff (the admin list) and Internal employee accounts, and
 * accounts already marked with a marketplace origin.
 *
 * Run: node scripts/d365-marketplace-origin.js            (applies)
 *      node scripts/d365-marketplace-origin.js --dry-run  (only lists)
 */
require('dotenv').config();
const { api } = require('./d365');
const { isAdmin } = require('../lib/session');
const { accountTypeFromCrm } = require('../lib/onboarding');

const ORIGINS = new Set(['API Marketplace landing page', 'API Marketplace sign-up']);
const MARK = 'API Marketplace landing page';
const dryRun = process.argv.includes('--dry-run');

(async () => {
  const sel = 'accountid,name,emailaddress1,cr57d_leadsourcedetail,cr57d_dataclassification';
  const r = await api('GET', `/accounts?$select=${sel}&$filter=cr57d_requestedscopes ne null or cr57d_apimarketplaceapproved ne null`);
  if (!r.ok) throw new Error('CRM query HTTP ' + r.status);
  for (const a of r.json.value || []) {
    const who = `${a.emailaddress1 || '(no email)'} — ${a.name}`;
    const type = accountTypeFromCrm(a.cr57d_dataclassification);
    if (a.emailaddress1 && isAdmin(a.emailaddress1)) { console.log(`skip  ${who}: Iristel staff`); continue; }
    if (type === 'internal') { console.log(`skip  ${who}: internal employee`); continue; }
    if (ORIGINS.has(a.cr57d_leadsourcedetail)) { console.log(`ok    ${who}: already "${a.cr57d_leadsourcedetail}"`); continue; }
    if (dryRun) { console.log(`would ${who}: "${a.cr57d_leadsourcedetail || ''}" -> "${MARK}"`); continue; }
    const u = await api('PATCH', `/accounts(${a.accountid})`, { cr57d_leadsourcedetail: MARK });
    console.log(`${u.ok ? 'set  ' : 'FAIL '} ${who}: "${a.cr57d_leadsourcedetail || ''}" -> "${MARK}"${u.ok ? '' : ' HTTP ' + u.status}`);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
