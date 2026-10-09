'use strict';
/**
 * Dynamics 365: the four marketplace account types (Oct 2026) on Account.
 *
 * - cr57d_dataclassification options: relabel to Business / Iristel partner
 *   / agent / Consumer, mark the old Agent and White-label options as legacy
 *   (existing records keep them), and add 649950005 "Internal employee".
 * - New text columns: cr57d_department (internal employees) and
 *   cr57d_regcheck (result of the business-registration check).
 * - Publishes.
 *
 * Run: node scripts/d365-account-types.js   (idempotent)
 */
const { api } = require('./d365');

const ENTITY = 'account';
const ATTR = 'cr57d_dataclassification';
const lbl = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: 1033 }] });

// Same values as ACCOUNT_TYPE_CRM in lib/onboarding.js.
const OPTIONS = [
  [649950000, 'Business'],
  [649950001, 'Iristel partner / agent'],
  [649950002, 'Agent (legacy)'],
  [649950003, 'White-label partner (legacy)'],
  [649950004, 'Consumer'],
  [649950005, 'Internal employee'],
];
const COLUMNS = [
  ['cr57d_department', 'Department', 100],
  ['cr57d_regcheck', 'Registration Check', 250],
];

async function ensureOptions() {
  const r = await api('GET', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='${ATTR}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`);
  if (!r.ok) throw new Error(`read options: ${r.status}`);
  const have = new Map(r.json.OptionSet.Options.map((o) => [o.Value, o.Label.UserLocalizedLabel && o.Label.UserLocalizedLabel.Label]));
  for (const [value, label] of OPTIONS) {
    if (have.get(value) === label) { console.log(`= ${value} ${label}`); continue; }
    const action = have.has(value) ? 'UpdateOptionValue' : 'InsertOptionValue';
    const body = { EntityLogicalName: ENTITY, AttributeLogicalName: ATTR, Value: value, Label: lbl(label), MergeLabels: false };
    if (action === 'InsertOptionValue') delete body.MergeLabels;
    const u = await api('POST', `/${action}`, body);
    if (!u.ok) throw new Error(`${action} ${value}: ${u.status} ${u.text.slice(0, 300)}`);
    console.log(`${action === 'InsertOptionValue' ? '+' : '~'} ${value} ${label}`);
  }
}

async function ensureColumns() {
  const r = await api('GET', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes?$select=LogicalName`);
  const have = new Set((r.json.value || []).map((a) => a.LogicalName));
  for (const [schema, label, max] of COLUMNS) {
    if (have.has(schema)) { console.log(`= ${schema} exists`); continue; }
    const c = await api('POST', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes`, {
      '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
      SchemaName: schema, MaxLength: max, FormatName: { Value: 'Text' },
      RequiredLevel: { Value: 'None' }, DisplayName: lbl(label), Description: lbl(label),
    });
    if (c.status !== 204 && c.status !== 201) throw new Error(`create ${schema}: ${c.status} ${c.text.slice(0, 300)}`);
    console.log(`+ created ${schema}`);
  }
}

(async () => {
  const who = await api('GET', '/WhoAmI');
  if (!who.ok) throw new Error('WhoAmI ' + who.status);
  await ensureOptions();
  await ensureColumns();
  const pub = await api('POST', '/PublishXml', { ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>` });
  console.log('publish:', pub.status);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
