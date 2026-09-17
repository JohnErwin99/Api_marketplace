'use strict';
/**
 * Dynamics 365 setup for the API Marketplace on the ACCOUNT table.
 *
 * - Mirrors the 12 cr57d_* fields from the Lead "Api-marketplace-request"
 *   form onto Account (same names, types, picklist options).
 * - Creates a dedicated Account MAIN FORM named "Api-marketplace-request"
 *   (shows in the form-selector dropdown) combining those fields with
 *   iristel_apimarketplacerequestname + iristel_apimarketplaceaccess.
 * - Removes the "API Marketplace" tab previously injected into the default
 *   Account form.
 * - Publishes.
 *
 * Run: node scripts/d365-setup-marketplace.js   (idempotent)
 */
const { api } = require('./d365');

const ENTITY = 'account';
const lbl = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: 1033 }] });

const STR = (schema, label, max) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
  SchemaName: schema, MaxLength: max, FormatName: { Value: 'Text' },
  RequiredLevel: { Value: 'None' }, DisplayName: lbl(label), Description: lbl(label),
});
const MEMO = (schema, label) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.MemoAttributeMetadata',
  SchemaName: schema, MaxLength: 4000,
  RequiredLevel: { Value: 'None' }, DisplayName: lbl(label), Description: lbl(label),
});
const DATE = (schema, label) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
  SchemaName: schema, Format: 'DateAndTime',
  RequiredLevel: { Value: 'None' }, DisplayName: lbl(label), Description: lbl(label),
});
const PICK = (schema, label, options) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
  SchemaName: schema, RequiredLevel: { Value: 'None' },
  DisplayName: lbl(label), Description: lbl(label),
  OptionSet: {
    '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata',
    IsGlobal: false, OptionSetType: 'Picklist',
    Options: options.map(([v, t]) => ({ Value: v, Label: lbl(t) })),
  },
});

// Mirrored from the Lead table (types/lengths/options read from the live org).
const FIELDS = [
  STR('cr57d_applicationname', 'Application Name', 150),
  STR('cr57d_businessowner', 'Business Owner', 150),
  STR('cr57d_technicalowner', 'Technical Owner', 150),
  MEMO('cr57d_businesspurpose', 'Business Purpose'),
  PICK('cr57d_environment', 'Environment', [[649950000, 'Sandbox'], [649950001, 'Sandbox → Production'], [649950002, 'Production']]),
  PICK('cr57d_dataclassification', 'Data Classification', [[649950000, 'Public'], [649950001, 'Internal'], [649950002, 'Customer confidential'], [649950003, 'Restricted']]),
  STR('cr57d_requestedscopes', 'Requested Scopes', 500),
  STR('cr57d_leadsourcedetail', 'Lead Source Detail', 100),
  STR('cr57d_topicofinterest', 'Topic of Interest', 250),
  STR('cr57d_conversationid', 'Conversation ID', 100),
  MEMO('cr57d_formanswers', 'Form Answers'),
  DATE('cr57d_capturedon', 'Captured On'),
];

const FORM_NAME = 'Api-marketplace-request';
// Field order on the new form: the lead form's fields + the iristel pair.
const FORM_FIELDS = [
  ['cr57d_applicationname', 'Application Name'],
  ['iristel_apimarketplacerequestname', 'API Marketplace Request Name'],
  ['iristel_apimarketplaceaccess', 'API Marketplace Access'],
  ['cr57d_businessowner', 'Business Owner'],
  ['cr57d_technicalowner', 'Technical Owner'],
  ['cr57d_businesspurpose', 'Business Purpose'],
  ['cr57d_environment', 'Environment'],
  ['cr57d_dataclassification', 'Data Classification'],
  ['cr57d_requestedscopes', 'Requested Scopes'],
  ['cr57d_leadsourcedetail', 'Lead Source Detail'],
  ['cr57d_topicofinterest', 'Topic of Interest'],
  ['cr57d_conversationid', 'Conversation ID'],
  ['cr57d_formanswers', 'Form Answers'],
  ['cr57d_capturedon', 'Captured On'],
];

const uid = () => require('crypto').randomUUID();
// Source form to clone: Lead "Api-marketplace-request".
const LEAD_FORM_ID = 'c2f1b61c-d3ab-f111-aaac-7ced8d068950';

async function existingAttrs() {
  const r = await api('GET', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes?$select=LogicalName`);
  return new Set((r.json.value || []).map((a) => a.LogicalName));
}

async function ensureFields() {
  const have = await existingAttrs();
  for (const f of FIELDS) {
    if (have.has(f.SchemaName.toLowerCase())) { console.log(`= ${f.SchemaName} exists`); continue; }
    const r = await api('POST', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes`, f);
    if (r.status === 204 || r.status === 201) console.log(`+ created ${f.SchemaName} on account`);
    else throw new Error(`create ${f.SchemaName}: ${r.status} ${r.text.slice(0, 300)}`);
  }
}

// Clone the Lead form's XML (guaranteed schema-valid), give every id a fresh
// GUID so it is a distinct form, and append the two iristel_* rows.
async function buildFormXml() {
  const src = await api('GET', `/systemforms(${LEAD_FORM_ID})?$select=formxml`);
  if (!src.ok) throw new Error('read lead form: ' + src.status);
  let xml = src.json.formxml.replace(/id="\{[0-9a-fA-F-]{36}\}"/g, () => `id="{${uid()}}"`);
  const TEXT = '{4273EDBD-AC1D-40D3-9FB2-095C621B552D}';
  const row = ([logical, label]) =>
    `<row><cell id="{${uid()}}" locklevel="0" colspan="1" rowspan="1">` +
    `<labels><label description="${label}" languagecode="1033" /></labels>` +
    `<control id="${logical}" classid="${TEXT}" datafieldname="${logical}" disabled="false" /></cell></row>`;
  const extra = [
    ['iristel_apimarketplacerequestname', 'API Marketplace Request Name'],
    ['iristel_apimarketplaceaccess', 'API Marketplace Access'],
  ].map(row).join('');
  return xml.replace('<rows>', '<rows>' + extra);
}

async function ensureForm() {
  const q = await api('GET', `/systemforms?$select=formid,name&$filter=objecttypecode eq '${ENTITY}' and type eq 2 and name eq '${FORM_NAME}'`);
  if (q.json.value && q.json.value.length) { console.log(`= form "${FORM_NAME}" exists (${q.json.value[0].formid})`); return q.json.value[0].formid; }
  const r = await api('POST', '/systemforms', {
    objecttypecode: ENTITY, type: 2, name: FORM_NAME,
    description: 'API Marketplace access request — combined lead-form fields + authorization fields.',
    formxml: await buildFormXml(),
  }, { Prefer: 'return=representation' });
  if (!r.ok) throw new Error(`create form: ${r.status} ${r.text.slice(0, 400)}`);
  console.log(`+ created account main form "${FORM_NAME}" (${r.json.formid})`);
  return r.json.formid;
}

async function removeInjectedTab() {
  const forms = await api('GET', `/systemforms?$select=formid,name,formxml&$filter=objecttypecode eq '${ENTITY}' and type eq 2`);
  for (const f of forms.json.value || []) {
    if (f.name === FORM_NAME) continue;
    if (!f.formxml.includes('name="apimarketplace"')) continue;
    const cleaned = f.formxml.replace(/<tab name="apimarketplace".*?<\/tab>/s, '');
    const r = await api('PATCH', `/systemforms(${f.formid})`, { formxml: cleaned });
    console.log(r.ok || r.status === 204 ? `+ removed API Marketplace tab from form "${f.name}"` : `! tab removal on "${f.name}": ${r.status} ${r.text.slice(0, 200)}`);
  }
}

(async () => {
  const who = await api('GET', '/WhoAmI');
  if (!who.ok) throw new Error('WhoAmI: ' + who.status);
  console.log('Connected. UserId:', who.json.UserId);
  await ensureFields();
  await ensureForm();
  await removeInjectedTab();
  const pub = await api('POST', '/PublishXml', { ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>` });
  console.log(pub.ok || pub.status === 204 ? '+ published' : `! publish ${pub.status}: ${pub.text.slice(0, 300)}`);
  console.log('Done.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
