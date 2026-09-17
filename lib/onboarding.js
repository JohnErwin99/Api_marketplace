'use strict';

/**
 * Marketplace onboarding: access-request intake + authorization lookup.
 *
 * Flow: landing form -> POST /marketplace/access-request -> auto-authorize
 * when every requested product is one we already run (and partner-safe by
 * classification) -> persist locally + forward to Dynamics 365 -> email the
 * requester to log in to the partner portal -> the portal login sets the
 * `marketplaceAccess` cookie from GET /marketplace/authorizations.
 *
 * Dynamics 365 contract (fields created CRM-side, not here):
 *   - iristel_apimarketplacerequestname : the application name requested
 *   - iristel_apimarketplaceaccess     : comma-separated authorized product
 *     ids on the Contact/Account. The portal (or this lookup endpoint, once
 *     pointed at Dataverse) reads it at login.
 * Set DYNAMICS_WEBHOOK_URL to the Power Automate / form-handler URL from the
 * existing Dynamics form to forward every request; without it requests are
 * only stored locally in data/access-requests.json.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE = path.join(DATA_DIR, 'access-requests.json');
const EXPOSABLE = new Set(['public', 'customer-confidential']);

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return []; }
}
function writeStore(rows) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(rows, null, 2));
}

function evaluate(products, requested, dataClassification) {
  const reasons = [];
  if (!requested.length) reasons.push('no products requested');
  if (String(dataClassification || '').toLowerCase() === 'restricted')
    reasons.push('restricted data classification needs manual review');
  for (const id of requested) {
    const p = products.find((x) => x.id === id);
    if (!p) reasons.push(`"${id}" is not an available API — manual review`);
    else if (!EXPOSABLE.has(p.classification))
      reasons.push(`"${id}" is ${p.classification} — manual review`);
  }
  return { autoAuthorized: reasons.length === 0, reasons };
}

// Direct Dataverse upsert: find the Account by primary contact email (or
// name), else create it; write the marketplace fields either way.
async function upsertD365Account(record) {
  const { api } = require('../scripts/d365');
  // Option-set values mirrored from the Lead "Api-marketplace-request" form.
  const ENV = { 'sandbox-only': 649950000, sandbox: 649950001, production: 649950002 };
  const CLASS = { public: 649950000, internal: 649950001, 'customer-confidential': 649950002, restricted: 649950003 };
  const fields = {
    iristel_apimarketplacerequestname: record.applicationName,
    iristel_apimarketplaceaccess: record.status === 'auto-authorized' ? record.products.join(',') : '',
    cr57d_applicationname: record.applicationName,
    cr57d_businessowner: record.businessOwner || null,
    cr57d_technicalowner: record.technicalOwner || null,
    cr57d_businesspurpose: record.businessPurpose || null,
    cr57d_environment: ENV[record.environment] ?? null,
    cr57d_dataclassification: CLASS[record.dataClassification] ?? null,
    cr57d_requestedscopes: record.products.join(','),
    cr57d_leadsourcedetail: 'API Marketplace landing page',
    cr57d_topicofinterest: record.products.join(', '),
    cr57d_formanswers: JSON.stringify(record),
    cr57d_capturedon: record.receivedAt,
  };
  const esc = (s) => String(s).replace(/'/g, "''");
  const q = await api('GET', `/accounts?$select=accountid,name&$filter=emailaddress1 eq '${esc(record.email)}' or name eq '${esc(record.organization)}'&$top=1`);
  const hit = q.json && q.json.value && q.json.value[0];
  if (hit) {
    const r = await api('PATCH', `/accounts(${hit.accountid})`, fields);
    return { forwarded: r.ok || r.status === 204, accountId: hit.accountid, created: false };
  }
  const r = await api('POST', '/accounts', {
    name: record.organization,
    emailaddress1: record.email, // primary contact email
    description: `API Marketplace request ${record.id}: ${record.businessPurpose || record.applicationName}`,
    ...fields,
  }, { Prefer: 'return=representation' });
  return { forwarded: r.ok, accountId: r.json && r.json.accountid, created: true };
}

async function forwardToCrm(record) {
  if (process.env.D365_URL && process.env.D365_CLIENT_ID) {
    try {
      const out = await upsertD365Account(record);
      console.log(`[onboarding] D365 account ${out.created ? 'created' : 'updated'}: ${out.accountId}`);
      return out;
    } catch (err) {
      console.warn('[onboarding] D365 upsert failed, falling back to webhook:', err.message);
    }
  }
  const url = process.env.DYNAMICS_WEBHOOK_URL;
  if (!url) {
    console.log('[onboarding] no D365 config — request stored locally only:', record.id);
    return { forwarded: false };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        iristel_apimarketplacerequestname: record.applicationName,
        iristel_apimarketplaceaccess: record.status === 'auto-authorized' ? record.products.join(',') : '',
        // Primary contact email for the Account/Contact record created in 365
        // (maps to emailaddress1 on the contact).
        email: record.email,
        primaryContactEmail: record.email,
        emailaddress1: record.email,
        organization: record.organization,
        businessOwner: record.businessOwner,
        technicalOwner: record.technicalOwner,
        businessPurpose: record.businessPurpose,
        environment: record.environment,
        dataClassification: record.dataClassification,
        existingCustomer: record.existingCustomer,
        requestedProducts: record.products,
        status: record.status,
      }),
    });
    return { forwarded: r.ok, httpStatus: r.status };
  } catch (err) {
    console.warn('[onboarding] CRM forward failed:', err.message);
    return { forwarded: false, error: err.message };
  }
}

function register(app, PRODUCTS) {
  app.post('/marketplace/access-request', async (req, res) => {
    const b = req.body || {};
    const requested = Array.isArray(b.products) ? b.products.map(String) : [];
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: 'A valid contact email is required.' });
    if (!String(b.organization || '').trim())
      return res.status(400).json({ error: 'Organization is required.' });
    if (!String(b.applicationName || '').trim())
      return res.status(400).json({ error: 'Application name is required.' });
    if (!requested.length)
      return res.status(400).json({ error: 'Select at least one API product.' });

    const { autoAuthorized, reasons } = evaluate(PRODUCTS, requested, b.dataClassification);
    const record = {
      id: 'REQ-' + Date.now().toString(36).toUpperCase(),
      receivedAt: new Date().toISOString(),
      email,
      organization: String(b.organization).trim(),
      applicationName: String(b.applicationName).trim(),
      businessOwner: String(b.businessOwner || '').trim(),
      technicalOwner: String(b.technicalOwner || '').trim(),
      businessPurpose: String(b.businessPurpose || '').trim(),
      environment: String(b.environment || 'sandbox').trim(),
      dataClassification: String(b.dataClassification || 'customer-confidential').trim(),
      existingCustomer: !!b.existingCustomer,
      products: requested,
      status: autoAuthorized ? 'auto-authorized' : 'pending-review',
      reasons,
    };

    const rows = readStore();
    rows.push(record);
    writeStore(rows);
    const crm = await forwardToCrm(record);

    // Email step is simulated until SMTP / Power Automate handles it — the
    // message below is what the requester would receive.
    const emailMessage = autoAuthorized
      ? `You're approved for ${requested.join(', ')}. Log in to the Iristel Partner Portal with ${email} to access the API Marketplace.`
      : 'Your API Marketplace request is under review. We will email you once it has been evaluated.';
    console.log(`[onboarding] ${record.id} ${record.status} — email to ${email}: ${emailMessage}`);

    res.status(201).json({
      id: record.id, status: record.status, reasons,
      crmForwarded: !!crm.forwarded, emailMessage,
    });
  });

  // Interim source of truth for the portal login: which product ids is this
  // email authorized for? Once the Dynamics field exists this endpoint reads
  // iristel_apimarketplaceaccess from Dataverse instead — same shape.
  app.get('/marketplace/authorizations', (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email query parameter is required' });
    const products = new Set();
    for (const r of readStore()) {
      if (r.email === email && (r.status === 'auto-authorized' || r.status === 'approved'))
        r.products.forEach((p) => products.add(p));
    }
    res.json({ email, products: [...products] });
  });
}

module.exports = { register, evaluate };
