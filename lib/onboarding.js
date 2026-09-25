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
 *   - cr57d_apimarketplacerequestname : the application name requested
 *   - cr57d_apimarketplaceaccess     : comma-separated authorized product
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

// ---------------------------------------------------------------------------
// Portal identity check — an approval is only usable if the email can log in
// to the partner portal. Same lookups the portal login page uses:
// employees directory, then unified/log-in (which returns the agent/master/
// contact record even when the password is wrong).
// ---------------------------------------------------------------------------
const IX_BASE = 'https://api.iristelx.com';
const IX_KEY = process.env.IRISTELX_API_KEY || 'b1582d78d369685683e090ad37489937';

async function isKnownPortalIdentity(email) {
  try {
    const emp = await fetch(`${IX_BASE}/employees?email=${encodeURIComponent(email)}`, {
      headers: { 'x-api-key': IX_KEY },
    });
    if (emp.ok) {
      const d = await emp.json();
      if (d.data && d.data.length) return true;
    }
    const r = await fetch(`${IX_BASE}/unified/log-in`, {
      method: 'POST',
      headers: { 'x-api-key': IX_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'identity-probe-only' }),
    });
    if (!r.ok) return 'error';
    const d = await r.json();
    const agent = d.agent && (d.agent.id != null || d.agent.email != null);
    const master = d.masterDetails && (d.masterDetails.id != null || d.masterDetails.email != null);
    const contact = Array.isArray(d.accountContact) && d.accountContact.length > 0;
    // userType CUSTOMER comes back even for unknown emails — proves nothing.
    const realType = d.userType && String(d.userType).toUpperCase() !== 'CUSTOMER';
    return !!(agent || master || contact || realType);
  } catch (err) {
    console.warn('[onboarding] portal identity lookup failed:', err.message);
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Approval email — sent through a Power Automate flow (same pattern as
// OnlineOrdering's SNAG mail): trigger "When an HTTP request is received"
// -> "Send an email (V2)". Fire-and-forget; never blocks the request.
// Setup: docs/power-automate-email.md. Env: MAIL_WEBHOOK_URL.
// ---------------------------------------------------------------------------
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendMail(to, subject, bodyText, html) {
  const url = process.env.MAIL_WEBHOOK_URL;
  if (!url) {
    console.log(`[onboarding] MAIL_WEBHOOK_URL not set — simulated email to ${to}: "${subject}" — ${bodyText}`);
    return false;
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to, subject,
        body: html || `<p>${bodyText.replace(/\n/g, '</p><p>')}</p>`,
        bodyText,
      }),
    });
    if (r.ok || r.status === 202) { console.log('[onboarding] mail webhook accepted for', to); return true; }
    console.warn('[onboarding] mail webhook failed (HTTP ' + r.status + ')');
    return false;
  } catch (err) {
    console.warn('[onboarding] mail webhook failed -', err.message);
    return false;
  }
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
  // Bundles are stored as "Bundle Name[api1,api2]; Other[free text]".
  const bundlesText = [
    ...(record.bundles || []).map((x) => `${x.name}[${x.products.join(',')}]`),
    ...(record.other ? [`Other[${record.other}]`] : []),
  ].join('; ');
  const fields = {
    // NOTE: the intake NEVER sets cr57d_apimarketplaceapproved — every
    // request is reviewed and approved by staff, in CRM or on /admin.
    cr57d_apimarketplacerequestname: record.applicationName,
    cr57d_apimarketplacebundles: bundlesText || null,
    cr57d_businessregnumber: record.businessRegNumber || null,
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
  const q = await api('GET',
    `/accounts?$select=accountid,name,cr57d_apimarketplaceapproved,cr57d_apimarketplaceaccess,cr57d_requestedscopes` +
    `&$filter=emailaddress1 eq '${esc(record.email)}' or name eq '${esc(record.organization)}'&$top=1`);
  const hit = q.json && q.json.value && q.json.value[0];
  let accountId, created;
  if (hit) {
    // Existing account: APPEND scopes, never replace, and never flip the
    // approved switch back off — a manual revoke in CRM must not be undone
    // and an earlier grant must not shrink because of a smaller new request.
    const merge = (prev, extra) => [...new Set([
      ...String(prev || '').split(',').map((s) => s.trim()).filter(Boolean),
      ...extra,
    ])].join(',');
    fields.cr57d_requestedscopes = merge(hit.cr57d_requestedscopes, record.products);
    // Grants and the approved switch are never touched by intake.
    const r = await api('PATCH', `/accounts(${hit.accountid})`, fields);
    if (!(r.ok || r.status === 204)) return { forwarded: false };
    accountId = hit.accountid; created = false;
  } else {
    const r = await api('POST', '/accounts', {
      name: record.organization,
      emailaddress1: record.email, // primary contact email
      description: `API Marketplace request ${record.id}: ${record.businessPurpose || record.applicationName}`,
      ...fields,
    }, { Prefer: 'return=representation' });
    if (!r.ok) return { forwarded: false };
    accountId = r.json && r.json.accountid; created = true;
  }
  const contactId = await upsertD365Contact(record, accountId).catch((err) => {
    console.warn('[onboarding] contact upsert failed:', err.message);
    return null;
  });
  return { forwarded: true, accountId, contactId, created };
}

// Ensure the requester exists as a Contact: find by email, else create it;
// attach it to the account (parent customer) and set it as the account's
// primary contact.
async function upsertD365Contact(record, accountId) {
  const { api } = require('../scripts/d365');
  const esc = (s) => String(s).replace(/'/g, "''");
  // Contact name: the business owner from the form, else the email local part.
  const fullName = (record.businessOwner || record.technicalOwner || record.email.split('@')[0]).trim();
  const parts = fullName.split(/\s+/);
  const firstname = parts[0];
  const lastname = parts.slice(1).join(' ') || record.organization;

  const q = await api('GET', `/contacts?$select=contactid,fullname&$filter=emailaddress1 eq '${esc(record.email)}'&$top=1`);
  const hit = q.json && q.json.value && q.json.value[0];
  let contactId;
  if (hit) {
    contactId = hit.contactid;
    const u = await api('PATCH', `/contacts(${contactId})`, {
      'parentcustomerid_account@odata.bind': `/accounts(${accountId})`,
      jobtitle: record.businessOwner === fullName ? 'Business owner' : (record.technicalOwner === fullName ? 'Technical owner' : undefined),
    });
    console.log(`[onboarding] contact updated + linked: ${contactId} (${u.status})`);
  } else {
    const c = await api('POST', '/contacts', {
      firstname, lastname,
      emailaddress1: record.email,
      'parentcustomerid_account@odata.bind': `/accounts(${accountId})`,
      description: `API Marketplace requester (${record.id}) — ${record.applicationName}`,
    }, { Prefer: 'return=representation' });
    if (!c.ok) throw new Error(`contact create: ${c.status} ${c.text.slice(0, 200)}`);
    contactId = c.json.contactid;
    console.log(`[onboarding] contact created + linked: ${contactId}`);
  }
  // Make it the account's primary contact.
  await api('PATCH', `/accounts(${accountId})`, {
    'primarycontactid@odata.bind': `/contacts(${contactId})`,
  });
  return contactId;
}

// Attach the business-registration document to the account as a Dataverse
// note (annotation) with the file embedded — same place a manually uploaded
// attachment lands in the CRM UI.
async function attachRegistrationDocument(accountId, doc, record) {
  if (!doc || !doc.dataB64) return false;
  const { api } = require('../scripts/d365');
  const name = str(doc.name, 120) || 'business-registration';
  if (String(doc.dataB64).length > 7 * 1024 * 1024) throw new Error('document too large');
  const r = await api('POST', '/annotations', {
    subject: `Business registration — ${record.organization} (${record.id})`,
    notetext: `Uploaded with API Marketplace request ${record.id}. Registration number: ${record.businessRegNumber}`,
    filename: name,
    mimetype: str(doc.type, 100) || 'application/octet-stream',
    documentbody: doc.dataB64,
    'objectid_account@odata.bind': `/accounts(${accountId})`,
  });
  if (!(r.ok || r.status === 204)) throw new Error('annotation create failed: HTTP ' + r.status);
  console.log(`[onboarding] registration document attached to ${accountId} (${name})`);
  return true;
}

async function forwardToCrm(record, registrationDocument) {
  if (process.env.D365_URL && process.env.D365_CLIENT_ID) {
    try {
      const out = await upsertD365Account(record);
      console.log(`[onboarding] D365 account ${out.created ? 'created' : 'updated'}: ${out.accountId}`);
      out.documentAttached = await attachRegistrationDocument(out.accountId, registrationDocument, record)
        .catch((err) => { console.warn('[onboarding] document attach failed:', err.message); return false; });
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
        cr57d_apimarketplacerequestname: record.applicationName,
        cr57d_apimarketplacebundles: [
          ...(record.bundles || []).map((x) => `${x.name}[${x.products.join(',')}]`),
          ...(record.other ? [`Other[${record.other}]`] : []),
        ].join('; '),
        cr57d_businessregnumber: record.businessRegNumber,
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
        portalIdentity: record.portalIdentity,
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

    // Every request is reviewed by staff — there is no auto-authorization.
    // evaluate()'s findings and the portal-identity check are kept as review
    // notes so the reviewer sees anything unusual at a glance.
    const { reasons } = evaluate(PRODUCTS, requested, b.dataClassification);
    const portalIdentity = await isKnownPortalIdentity(email);
    if (portalIdentity !== true) {
      reasons.push(portalIdentity === 'error'
        ? 'portal identity could not be verified'
        : 'no partner portal identity for this email yet');
    }
    // Bundles: [{id,name,products:[...]}] from the form, plus free-text Other.
    const bundles = (Array.isArray(b.bundles) ? b.bundles : [])
      .map((x) => ({
        id: str(x.id, 60), name: str(x.name, 100),
        products: (Array.isArray(x.products) ? x.products : []).map((p) => str(p, 60)).filter(Boolean),
      })).filter((x) => x.name);
    // APIs picked individually (outside any bundle). Recorded in CRM as a
    // pseudo-bundle "Custom[api1,api2]" so no extra Dynamics field is needed.
    const validIds = new Set(PRODUCTS.map((p) => p.id));
    const individualProducts = (Array.isArray(b.individualProducts) ? b.individualProducts : [])
      .map((p) => str(p, 60)).filter((p) => validIds.has(p));
    if (individualProducts.length)
      bundles.push({ id: 'custom', name: 'Custom', products: individualProducts });
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
      bundles,
      individualProducts,
      other: str(b.other, 500),
      businessRegNumber: str(b.businessRegNumber, 60),
      portalIdentity,
      status: 'pending-review',
      reasons,
    };
    if (!record.businessPurpose)
      return res.status(400).json({ error: 'Business purpose is required.' });
    if (!record.businessRegNumber)
      return res.status(400).json({ error: 'Business registration number is required.' });

    const rows = readStore();
    rows.push(record);
    writeStore(rows);
    const crm = await forwardToCrm(record, b.registrationDocument);

    const emailMessage = 'Thank you for your request — our team will evaluate it and get back to you.';
    const emailSent = await sendMail(
      email,
      'We received your Iristel API Marketplace request',
      emailMessage,
      require('./email-template').render({
        title: 'We received your request',
        paragraphs: [
          `Thank you for your interest in the Iristel API Marketplace, and for telling us about <strong>${escHtml(record.applicationName)}</strong>.`,
          'Our team will evaluate your request and get back to you shortly. Once approved, the API console appears in your Iristel Partner Portal automatically.',
        ],
        ctaLabel: 'Visit the Partner Portal',
        ctaUrl: 'https://www.iristelpartnerportal.com',
      })
    );
    console.log(`[onboarding] ${record.id} pending-review — email to ${email} (sent: ${emailSent})`);

    res.status(201).json({
      id: record.id, status: record.status, reasons,
      crmForwarded: !!crm.forwarded, emailSent, emailMessage,
    });
  });

  // Portal sign-up completed: mirror the new customer into Dynamics so the
  // relationship is on record from day one (account + primary contact + MIND
  // account code). Never sets any marketplace approval field. Fire-and-forget
  // from the sign-up page; failures only log.
  app.post('/marketplace/signup', async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: 'A valid email is required.' });
    if (!process.env.D365_URL || !process.env.D365_CLIENT_ID)
      return res.status(503).json({ error: 'Dynamics is not configured on this gateway' });
    try {
      const { api } = require('../scripts/d365');
      const esc = (s) => String(s).replace(/'/g, "''");
      const name = str(b.businessName, 160) || [str(b.fname, 60), str(b.lname, 60)].filter(Boolean).join(' ') || email;
      const fields = {
        emailaddress1: email,
        telephone1: str(b.phone, 40) || null,
        address1_line1: str(b.address1, 120) || null,
        address1_city: str(b.city, 80) || null,
        address1_stateorprovince: str(b.province, 40) || null,
        address1_postalcode: str(b.postalCode, 20) || null,
        address1_country: str(b.country, 40) || null,
        cr57d_mindaccountnumber: str(b.mindAccountId, 40) || null,
        cr57d_businessregnumber: str(b.businessRegNumber, 60) || null,
        description: `Created by API Marketplace sign-up (${str(b.accountType, 20) || 'customer'})`,
      };
      const q = await api('GET', `/accounts?$select=accountid&$filter=emailaddress1 eq '${esc(email)}'&$top=1`);
      const hit = q.json && q.json.value && q.json.value[0];
      let accountId;
      if (hit) {
        accountId = hit.accountid;
        await api('PATCH', `/accounts(${accountId})`, fields);
      } else {
        const c = await api('POST', '/accounts', { name, ...fields }, { Prefer: 'return=representation' });
        if (!c.ok) return res.status(502).json({ error: 'CRM account create failed (HTTP ' + c.status + ')' });
        accountId = c.json.accountid;
      }
      const contactId = await upsertD365Contact({
        email, organization: name, id: 'SIGNUP',
        applicationName: 'Portal sign-up',
        businessOwner: [str(b.fname, 60), str(b.lname, 60)].filter(Boolean).join(' '),
        technicalOwner: '',
      }, accountId).catch((err) => { console.warn('[signup] contact upsert failed:', err.message); return null; });
      const documentAttached = await attachRegistrationDocument(accountId, b.registrationDocument, {
        organization: name, id: 'SIGNUP-' + Date.now().toString(36).toUpperCase(),
        businessRegNumber: str(b.businessRegNumber, 60),
      }).catch((err) => { console.warn('[signup] document attach failed:', err.message); return false; });
      console.log(`[signup] CRM account ${hit ? 'updated' : 'created'} for ${email}: ${accountId}`);
      res.status(201).json({ ok: true, accountId, contactId, documentAttached, created: !hit });
    } catch (err) {
      res.status(502).json({ error: 'CRM sign-up failed: ' + err.message });
    }
  });

  // Which product ids is this email authorized for? Source of truth is the
  // CRM: the Yes/No switch cr57d_apimarketplaceapproved on the Account is
  // the gate — the product list only says which products. Falls back to the
  // local request store when Dynamics is unconfigured/unreachable.
  app.get('/marketplace/authorizations', async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email query parameter is required' });

    if (process.env.D365_URL && process.env.D365_CLIENT_ID) {
      try {
        const { api } = require('../scripts/d365');
        const esc = (s) => String(s).replace(/'/g, "''");
        const r = await api('GET',
          `/accounts?$select=cr57d_apimarketplaceapproved,cr57d_apimarketplaceaccess,cr57d_requestedscopes` +
          `&$filter=emailaddress1 eq '${esc(email)}'`);
        if (r.ok) {
          // The same email can sit on several accounts — approved if ANY of
          // them is, with their product lists merged.
          const approvedAccounts = (r.json.value || []).filter((a) => a.cr57d_apimarketplaceapproved === true);
          if (!approvedAccounts.length)
            return res.json({ email, approved: false, products: [] });
          const list = [...new Set(approvedAccounts.flatMap((a) =>
            String(a.cr57d_apimarketplaceaccess || a.cr57d_requestedscopes || '')
              .split(',').map((s) => s.trim()).filter(Boolean)))];
          // Approved with no list recorded = approved for everything exposable.
          const products = list.length ? list
            : PRODUCTS.filter((p) => EXPOSABLE.has(p.classification)).map((p) => p.id);
          return res.json({ email, approved: true, products });
        }
        console.warn('[onboarding] authorization CRM lookup HTTP', r.status, '— falling back to local store');
      } catch (err) {
        console.warn('[onboarding] authorization CRM lookup failed:', err.message, '— falling back to local store');
      }
    }

    const products = new Set();
    for (const r of readStore()) {
      if (r.email === email && (r.status === 'auto-authorized' || r.status === 'approved'))
        r.products.forEach((p) => products.add(p));
    }
    res.json({ email, approved: products.size > 0, products: [...products] });
  });
}

module.exports = { register, evaluate };
