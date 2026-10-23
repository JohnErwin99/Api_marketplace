'use strict';
/**
 * Dynamics 365: the API Marketplace package (Oct 2026) on Account.
 *
 * - New choice column cr57d_apimarketplacepackage: Free, Standard, Premium
 *   (lib/catalogs/pricing.js). The access-request form writes the partner's
 *   choice while the account isn't approved yet; staff confirm or change it on
 *   the staff dashboard or here in CRM. Empty reads as Free.
 * - Publishes.
 *
 * Run: node scripts/d365-marketplace-package.js   (idempotent)
 */
const { api } = require('./d365');

const ENTITY = 'account';
const ATTR = 'cr57d_apimarketplacepackage';
const lbl = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: 1033 }] });

// Same values as PACKAGE_CRM in lib/onboarding.js.
const OPTIONS = [
  [649950000, 'Free'],
  [649950001, 'Standard'],
  [649950002, 'Premium'],
];

(async () => {
  const who = await api('GET', '/WhoAmI');
  if (!who.ok) throw new Error('WhoAmI ' + who.status);
  const r = await api('GET', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes?$select=LogicalName&$filter=LogicalName eq '${ATTR}'`);
  if (!r.ok) throw new Error(`read attributes: ${r.status}`);
  if ((r.json.value || []).length) {
    console.log(`= ${ATTR} exists`);
  } else {
    const c = await api('POST', `/EntityDefinitions(LogicalName='${ENTITY}')/Attributes`, {
      '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
      SchemaName: ATTR, RequiredLevel: { Value: 'None' },
      DisplayName: lbl('API Marketplace Package'),
      Description: lbl('Free, Standard or Premium. Chosen on the access request; staff confirm it. Empty = Free.'),
      OptionSet: {
        '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata',
        IsGlobal: false, OptionSetType: 'Picklist',
        Options: OPTIONS.map(([v, t]) => ({ Value: v, Label: lbl(t) })),
      },
    });
    if (c.status !== 204 && c.status !== 201) throw new Error(`create ${ATTR}: ${c.status} ${c.text.slice(0, 300)}`);
    console.log(`+ created ${ATTR}`);
  }
  const pub = await api('POST', '/PublishXml', { ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>` });
  console.log('publish:', pub.status);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
