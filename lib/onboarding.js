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
 * only stored locally in $DATA_DIR/access-requests.json.
 */

const fs = require('fs');
const { sessionEmail, signApiKey, isAdmin, tooMany } = require('./session');
const security = require('./security');
const path = require('path');

// Same folder as the SQLite ledger: DATA_DIR, the Render persistent disk.
const { DATA_DIR, REQUESTS_FILE: STORE } = require('./db');
const EXPOSABLE = new Set(['public', 'customer-confidential']);

// Products an approved Account is granted: the individually picked APIs
// (cr57d_apimarketplaceaccess) plus the APIs of every requested bundle
// (cr57d_apimarketplacebundles, "Name[api1,api2]; Other[text]"). Accounts
// from before bundles were split out only have cr57d_requestedscopes.
function grantedProducts(a) {
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const fromBundles = String(a.cr57d_apimarketplacebundles || '').split(';')
    .map((x) => x.trim().match(/^(.*?)\[(.*)\]$/))
    .filter((m) => m && m[1].trim() !== 'Other')
    .flatMap((m) => split(m[2]));
  const list = [...split(a.cr57d_apimarketplaceaccess), ...fromBundles];
  return list.length ? list : split(a.cr57d_requestedscopes);
}

// Which products is this email approved for? Source of truth is the CRM:
// the Yes/No switch cr57d_apimarketplaceapproved on the Account is the gate,
// the product fields only say which products. Staff are approved for every
// exposable product. Cached briefly because /api/* checks it on every call;
// a revoke in CRM takes effect within CACHE_MS. Throws when the CRM is
// unreachable, so callers fail closed.
const CACHE_MS = 60 * 1000;
// cr57d_environment option-set values, mirrored from the Lead
// "Api-marketplace-request" form. 'sandbox-only' is legacy (no longer offered)
// and is treated like 'sandbox'.
const ENV_CHOICES = { 'sandbox-only': 649950000, sandbox: 649950001, production: 649950002 };

// Is this email an Iristel agent? Agents have an agent record (GET /agents)
// and no MIND billing account of their own, so they are never billed for API
// usage and have no card on file. A failed lookup counts as "not an agent".
async function isAgentEmail(email) {
  const key = process.env.MIND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch(`${IX_BASE}/agents?email=${encodeURIComponent(email)}`, {
      headers: { 'x-api-key': key, 'iristelx-api-key': key },
    });
    if (!r.ok) return false;
    const d = await r.json();
    return (d.data || []).some((a) => String(a.EMAIL || '').trim().toLowerCase() === email);
  } catch { return false; }
}
const authCache = new Map();
async function lookupAuthorization(email) {
  email = String(email || '').trim().toLowerCase();
  const all = () => PRODUCTS_REF.filter((p) => EXPOSABLE.has(p.classification)).map((p) => p.id);
  if (isAdmin(email)) return { approved: true, products: all() };
  const hit = authCache.get(email);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  if (!process.env.D365_URL || !process.env.D365_CLIENT_ID) throw new Error('Dynamics is not configured');
  const { api } = require('../scripts/d365');
  const esc = (s) => String(s).replace(/'/g, "''");
  const r = await api('GET',
    `/accounts?$select=cr57d_apimarketplaceapproved,cr57d_apimarketplaceaccess,cr57d_apimarketplacebundles,cr57d_requestedscopes,cr57d_mindaccountnumber,cr57d_environment,name,address1_stateorprovince,address1_country` +
    `&$filter=emailaddress1 eq '${esc(email)}'`);
  if (!r.ok) throw new Error('CRM lookup HTTP ' + r.status);
  // MIND billing account usage is billed to: an approved account's first,
  // else any account's (sign-up records it as cr57d_mindaccountnumber).
  const rows = r.json.value || [];
  const pick = (list) => (list.find((a) => a.cr57d_mindaccountnumber) || {}).cr57d_mindaccountnumber;
  const mindAccount = pick(rows.filter((a) => a.cr57d_apimarketplaceapproved === true)) || pick(rows) || null;
  // The same email can sit on several accounts — approved if ANY of them
  // is, with their product lists merged.
  const approvedAccounts = (r.json.value || []).filter((a) => a.cr57d_apimarketplaceapproved === true);
  let value;
  if (!approvedAccounts.length) {
    value = { approved: false, products: [], mindAccount };
  } else {
    const list = [...new Set(approvedAccounts.flatMap(grantedProducts))];
    // Approved with no list recorded = approved for everything exposable.
    value = { approved: true, products: list.length ? list : all(), mindAccount };
  }
  // Request-form choice: "Production" (card before the first call) or
  // "Sandbox -> Production" (free sandbox calls until a card is added).
  value.environment = (approvedAccounts.length ? approvedAccounts : rows)
    .some((a) => a.cr57d_environment === ENV_CHOICES.production) ? 'production' : 'sandbox';
  // Billing address of the account we bill (invoice name and sales tax).
  const billed = rows.find((a) => mindAccount && a.cr57d_mindaccountnumber === mindAccount) || rows[0] || {};
  value.organization = billed.name || null;
  value.billingRegion = { country: billed.address1_country || null, province: billed.address1_stateorprovince || null };
  value.isAgent = await isAgentEmail(email);
  authCache.set(email, { at: Date.now(), value });
  return value;
}
let PRODUCTS_REF = [];

// Account type -> the CRM choice column cr57d_dataclassification, whose
// options were renamed in Dynamics from data classifications to account
// types (Business customer, Reseller, Agent, White-label partner, Consumer).
const ACCOUNT_TYPE_CRM = {
  customer: 649950000, reseller: 649950001, agent: 649950002, 'white-label': 649950003, consumer: 649950004,
};
const accountTypeOf = (v) => {
  const t = String(v || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ACCOUNT_TYPE_CRM, t) ? t : null;
};

// Account create/update. If Dynamics rejects the account-type choice (its
// options not renamed/added yet), save everything else rather than lose the
// request, and log it so staff can fix the column.
async function crmAccountWrite(method, pathname, body, headers) {
  const { api } = require('../scripts/d365');
  const r = await api(method, pathname, body, headers);
  if (r.status === 400 && body && body.cr57d_dataclassification != null && /dataclassification/i.test(r.text)) {
    console.warn('[onboarding] CRM rejected account type', body.cr57d_dataclassification, '— saved without it. Add the option in Dynamics.');
    const { cr57d_dataclassification, ...rest } = body;
    return api(method, pathname, rest, headers);
  }
  return r;
}

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
const IX_KEY = process.env.IRISTELX_API_KEY;

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

function evaluate(products, requested) {
  const reasons = [];
  if (!requested.length) reasons.push('no products requested');
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
  // Bundles are stored as "Bundle Name[api1,api2]; Other[free text]".
  // The synthetic "Custom" pseudo-bundle (individually picked APIs) is NOT
  // listed here — those APIs go in cr57d_apimarketplaceaccess instead.
  const bundlesText = [
    ...(record.bundles || []).filter((x) => x.id !== 'custom')
      .map((x) => `${x.name}[${x.products.join(',')}]`),
    ...(record.other ? [`Other[${record.other}]`] : []),
  ].join('; ');
  const individual = (record.individualProducts || []).map(String).filter(Boolean);
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
    cr57d_environment: ENV_CHOICES[record.environment] ?? null,
    cr57d_dataclassification: ACCOUNT_TYPE_CRM[record.accountType] ?? null,
    cr57d_requestedscopes: record.products.join(','),
    // Individually selected APIs. Access is still gated by the approved
    // switch — the authorization lookup ignores this until staff approve.
    cr57d_apimarketplaceaccess: individual.length ? individual.join(',') : null,
    cr57d_leadsourcedetail: 'API Marketplace landing page',
    cr57d_topicofinterest: record.products.join(', '),
    cr57d_formanswers: JSON.stringify(record),
    cr57d_capturedon: record.receivedAt,
  };
  const esc = (s) => String(s).replace(/'/g, "''");
  const q = await api('GET',
    `/accounts?$select=accountid,name,cr57d_apimarketplaceapproved,cr57d_apimarketplaceaccess,cr57d_requestedscopes` +
    `&$filter=emailaddress1 eq '${esc(record.email)}'&$top=1`);
  const hit = q.json && q.json.value && q.json.value[0];
  // Match on email only: matching on the typed organization name would let
  // anyone update another company's account. A same-name account is only
  // flagged for staff on the new one.
  let sameName = null;
  if (!hit) {
    const n = await api('GET', `/accounts?$select=accountid,name&$filter=name eq '${esc(record.organization)}'&$top=1`);
    sameName = n.json && n.json.value && n.json.value[0];
  }
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
    fields.cr57d_apimarketplaceaccess = merge(hit.cr57d_apimarketplaceaccess, individual) || null;
    // Grants and the approved switch are never touched by intake.
    const r = await crmAccountWrite('PATCH', `/accounts(${hit.accountid})`, fields);
    if (!(r.ok || r.status === 204)) return { forwarded: false };
    accountId = hit.accountid; created = false;
  } else {
    const r = await crmAccountWrite('POST', '/accounts', {
      name: record.organization,
      emailaddress1: record.email, // primary contact email
      description: `API Marketplace request ${record.id}: ${record.businessPurpose || record.applicationName}` +
        (sameName ? `\nREVIEW: an account named "${sameName.name}" already exists (${sameName.accountid}) with a different email.` : ''),
      ...fields,
    }, { Prefer: 'return=representation' });
    if (!r.ok) return { forwarded: false };
    accountId = r.json && r.json.accountid; created = true;
  }
  const contactId = await upsertD365Contact(record, accountId).catch((err) => {
    console.error('[onboarding] contact upsert failed:', err.message);
    return null;
  });
  return { forwarded: true, accountId, contactId, created };
}

// Ensure the requester exists as a Contact linked to the account and set as
// its primary contact.
async function upsertD365Contact(record, accountId) {
  // Contact name: the business owner from the form, else the email local part.
  const fullName = (record.businessOwner || record.technicalOwner || record.email.split('@')[0]).trim();
  const parts = fullName.split(/\s+/);
  const firstname = parts[0];
  const lastname = parts.slice(1).join(' ') || record.organization;

  return linkContact(record.email, accountId, {
    firstname, lastname,
    jobtitle: record.businessOwner === fullName ? 'Business owner' : (record.technicalOwner === fullName ? 'Technical owner' : undefined),
    description: `API Marketplace requester (${record.id}) — ${record.applicationName}`,
  });
}

// Find the Contact by email, else create it; link it to the account (parent
// customer) and make it the account's primary contact. Every write is
// checked: a failure throws with Dynamics' own error text.
// `fields` with an empty value are dropped, so existing CRM data is never
// overwritten with blanks (same rule as the SIP online order sync).
async function linkContact(email, accountId, fields) {
  const { api } = require('../scripts/d365');
  const esc = (s) => String(s).replace(/'/g, "''");
  const body = { emailaddress1: email, 'parentcustomerid_account@odata.bind': `/accounts(${accountId})` };
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== '') body[k] = v;

  const q = await api('GET', `/contacts?$select=contactid&$filter=emailaddress1 eq '${esc(email)}'&$top=1`);
  if (!q.ok) throw new Error(`contact lookup: ${q.status} ${q.text.slice(0, 300)}`);
  const hit = q.json.value && q.json.value[0];
  let contactId;
  if (hit) {
    contactId = hit.contactid;
    delete body.description; // keep whatever staff wrote
    const u = await api('PATCH', `/contacts(${contactId})`, body);
    if (!u.ok) throw new Error(`contact update: ${u.status} ${u.text.slice(0, 300)}`);
    console.log(`[onboarding] contact updated + linked: ${contactId}`);
  } else {
    if (!body.lastname) body.lastname = email; // required by Dataverse
    const c = await api('POST', '/contacts', body, { Prefer: 'return=representation' });
    if (!c.ok) throw new Error(`contact create: ${c.status} ${c.text.slice(0, 300)}`);
    contactId = c.json.contactid;
    console.log(`[onboarding] contact created + linked: ${contactId}`);
  }
  const p = await crmAccountWrite('PATCH', `/accounts(${accountId})`, {
    'primarycontactid@odata.bind': `/contacts(${contactId})`,
  });
  if (!p.ok) throw new Error(`primary contact: ${p.status} ${p.text.slice(0, 300)}`);
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
        accountType: record.accountType,
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
  PRODUCTS_REF = PRODUCTS;
  app.post('/marketplace/access-request', async (req, res) => {
    if (tooMany('intake:' + security.clientIp(req), 20, 60 * 60 * 1000))
      return res.status(429).json({ error: 'Too many submissions. Try again later.' });
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
    const { reasons } = evaluate(PRODUCTS, requested);
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
    // APIs picked individually (outside any bundle). Written to CRM's
    // cr57d_apimarketplaceaccess; kept locally as a "Custom" pseudo-bundle
    // so the admin UI and stored record still show them grouped.
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
      environment: String(b.environment || '').trim() === 'production' ? 'production' : 'sandbox',
      accountType: accountTypeOf(b.accountType),
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
    // Consumers are individuals: no business registration to give.
    if (!record.businessRegNumber && record.accountType !== 'consumer')
      return res.status(400).json({ error: 'Business registration number is required.' });

    const rows = readStore();
    rows.push(record);
    writeStore(rows);
    const crm = await forwardToCrm(record, b.registrationDocument);

    const { render: renderEmail, PORTAL_URL } = require('./email-template');
    const emailMessage = 'Thank you for your request — our team will evaluate it and get back to you. '
      + 'Partner Portal: ' + PORTAL_URL;
    const emailSent = await sendMail(
      email,
      'We received your Iristel API Marketplace request',
      emailMessage,
      renderEmail({
        title: 'We received your request',
        paragraphs: [
          `Thank you for your interest in the Iristel API Marketplace, and for telling us about <strong>${escHtml(record.applicationName)}</strong>.`,
          'Our team will evaluate your request and get back to you shortly. Once approved, the API console appears in your Iristel Partner Portal automatically.',
          `Partner Portal: <a href="${PORTAL_URL}" style="color:#D1155A;">${PORTAL_URL.replace('https://', '')}</a>`,
        ],
        ctaLabel: 'Open the Partner Portal',
        ctaUrl: PORTAL_URL,
      })
    );
    console.log(`[onboarding] ${record.id} pending-review — email to ${email} (sent: ${emailSent})`);
    security.audit(req, 'access.requested', { email, outcome: 'pending-review', detail: `${record.id}: ${requested.join(',')}` });

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
    if (tooMany('intake:' + security.clientIp(req), 20, 60 * 60 * 1000))
      return res.status(429).json({ error: 'Too many submissions. Try again later.' });
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: 'A valid email is required.' });
    if (tooMany('signup:crm:ip:' + security.clientIp(req), 5, 60 * 60 * 1000) || tooMany('signup:crm:email:' + email, 3, 24 * 60 * 60 * 1000)) {
      security.audit(req, 'signup.rate_limited', { email, outcome: 'denied', detail: '/marketplace/signup' });
      return res.status(429).json({ error: 'Too many sign-up attempts. Try again later or contact support.' });
    }
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
        cr57d_dataclassification: ACCOUNT_TYPE_CRM[accountTypeOf(b.accountType)] ?? null,
        description: `Created by API Marketplace sign-up (${accountTypeOf(b.accountType) || 'customer'})`,
      };
      const q = await api('GET', `/accounts?$select=accountid&$filter=emailaddress1 eq '${esc(email)}'&$top=1`);
      const hit = q.json && q.json.value && q.json.value[0];
      let accountId;
      if (hit) {
        accountId = hit.accountid;
        await crmAccountWrite('PATCH', `/accounts(${accountId})`, fields);
      } else {
        const c = await crmAccountWrite('POST', '/accounts', { name, ...fields }, { Prefer: 'return=representation' });
        if (!c.ok) return res.status(502).json({ error: 'CRM account create failed (HTTP ' + c.status + ')' });
        accountId = c.json.accountid;
      }
      // The person who signed up, linked to the account — same fields as the
      // SIP online order sync. Sign-up never fails over it; the error is
      // returned so it shows in the browser console and the Render log.
      let contactId = null, contactError;
      try {
        const mind = str(b.mindAccountId, 40);
        contactId = await linkContact(email, accountId, {
          firstname: str(b.fname, 60),
          lastname: str(b.lname, 60),
          telephone1: str(b.phone, 40),
          address1_line1: str(b.address1, 120),
          address1_city: str(b.city, 80),
          address1_stateorprovince: str(b.province, 40),
          address1_postalcode: str(b.postalCode, 20),
          address1_country: str(b.country, 40),
          description: `Portal sign-up — account "${name}"` + (mind ? ` (MIND ${mind})` : ''),
        });
      } catch (err) {
        contactError = err.message;
        console.error(`[signup] contact upsert failed for ${email}:`, err.message);
      }
      const documentAttached = await attachRegistrationDocument(accountId, b.registrationDocument, {
        organization: name, id: 'SIGNUP-' + Date.now().toString(36).toUpperCase(),
        businessRegNumber: str(b.businessRegNumber, 60),
      }).catch((err) => { console.warn('[signup] document attach failed:', err.message); return false; });
      console.log(`[signup] CRM account ${hit ? 'updated' : 'created'} for ${email}: ${accountId}`);
      security.audit(req, 'signup.crm', { email, outcome: contactError ? 'partial' : 'ok',
        detail: `account ${accountId}${contactId ? ', contact ' + contactId : ''}${contactError ? ' — contact failed: ' + contactError : ''}` });
      res.status(201).json({ ok: true, accountId, contactId, contactError, documentAttached, created: !hit });
    } catch (err) {
      res.status(502).json({ error: 'CRM sign-up failed: ' + err.message });
    }
  });

  // Which product ids is this email authorized for? Source of truth is the
  // CRM: the Yes/No switch cr57d_apimarketplaceapproved on the Account is
  // the gate — the product list only says which products. Falls back to the
  // local request store when Dynamics is unconfigured/unreachable.
  // A partner's own API key for calling /api/* from their application.
  // Needs a logged-in session; only approved accounts get one. The key is
  // derived from the email, so asking again returns a working key and
  // revoking the account in CRM disables it.
  app.post('/marketplace/api-key', async (req, res) => {
    const email = sessionEmail(req);
    if (!email) return res.status(401).json({ error: 'login_required' });
    try {
      const auth = await lookupAuthorization(email);
      if (!auth.approved) return res.status(403).json({ error: 'not_approved', message: 'Your marketplace access has not been approved yet.' });
      security.audit(req, 'apikey.issued', { email, outcome: 'ok', detail: auth.products.join(',') });
      res.json({ key: signApiKey(email), products: auth.products });
    } catch (err) {
      console.warn('[onboarding] api-key lookup failed:', err.message);
      res.status(503).json({ error: 'Access lookup is unavailable, try again shortly' });
    }
  });

  app.get('/marketplace/authorizations', async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email query parameter is required' });
    // Only the logged-in owner of the email (or staff) may see its access.
    const who = sessionEmail(req);
    if (!who || (who !== email && !isAdmin(who)))
      return res.status(401).json({ error: 'login_required' });

    try {
      res.json({ email, ...(await lookupAuthorization(email)) });
    } catch (err) {
      console.warn('[onboarding] authorization lookup failed:', err.message);
      res.status(503).json({ error: 'Access lookup is unavailable, try again shortly' });
    }
  });
}

module.exports = { register, evaluate, sendMail, isKnownPortalIdentity, ACCOUNT_TYPE_CRM, grantedProducts, lookupAuthorization, resetAuthorizationCache: () => authCache.clear() };
