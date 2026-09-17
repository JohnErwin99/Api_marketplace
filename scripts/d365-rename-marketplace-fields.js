'use strict';
/**
 * Rename the two marketplace fields on Account to the org's cr57d_ publisher
 * prefix (Dataverse cannot rename a schema name in place):
 *   iristel_apimarketplaceaccess      -> cr57d_apimarketplaceaccess
 *   iristel_apimarketplacerequestname -> cr57d_apimarketplacerequestname
 *
 * Creates the new columns, copies existing values, repoints the
 * Api-marketplace-request form, publishes, then deletes the old columns.
 * Idempotent: safe to re-run.
 */
const { api } = require('./d365');

const lbl = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: 1033 }] });
const PAIRS = [
  { old: 'iristel_apimarketplaceaccess', neu: 'cr57d_apimarketplaceaccess', label: 'API Marketplace Access', max: 400,
    desc: 'Comma-separated API product ids this account is authorized for (read by the partner portal at login).' },
  { old: 'iristel_apimarketplacerequestname', neu: 'cr57d_apimarketplacerequestname', label: 'API Marketplace Request Name', max: 200,
    desc: 'Application name from the API Marketplace access-request form.' },
];

async function attrs() {
  const r = await api('GET', "/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName");
  return new Set((r.json.value || []).map((a) => a.LogicalName));
}

(async () => {
  const who = await api('GET', '/WhoAmI');
  if (!who.ok) throw new Error('WhoAmI ' + who.status);
  console.log('Connected.');

  // 1. create the cr57d_ columns
  let have = await attrs();
  for (const p of PAIRS) {
    if (have.has(p.neu)) { console.log(`= ${p.neu} exists`); continue; }
    const r = await api('POST', "/EntityDefinitions(LogicalName='account')/Attributes", {
      '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
      SchemaName: p.neu, MaxLength: p.max, RequiredLevel: { Value: 'None' },
      FormatName: { Value: 'Text' }, DisplayName: lbl(p.label), Description: lbl(p.desc),
    });
    if (r.status === 204 || r.status === 201) console.log(`+ created ${p.neu}`);
    else throw new Error(`create ${p.neu}: ${r.status} ${r.text.slice(0, 300)}`);
  }

  // 2. copy values from the old columns (only where the old ones still exist)
  have = await attrs();
  const liveOld = PAIRS.filter((p) => have.has(p.old));
  if (liveOld.length) {
    const sel = ['accountid', ...liveOld.map((p) => p.old)].join(',');
    const filter = liveOld.map((p) => `${p.old} ne null`).join(' or ');
    const rows = await api('GET', `/accounts?$select=${sel}&$filter=${filter}`);
    for (const a of (rows.json.value || [])) {
      const patch = {};
      liveOld.forEach((p) => { if (a[p.old]) patch[p.neu] = a[p.old]; });
      if (!Object.keys(patch).length) continue;
      const u = await api('PATCH', `/accounts(${a.accountid})`, patch);
      console.log(`  copied values on ${a.accountid}: ${u.ok || u.status === 204 ? 'ok' : u.status}`);
    }
  }

  // 3. repoint the form
  const forms = await api('GET', "/systemforms?$select=formid,name,formxml&$filter=objecttypecode eq 'account' and type eq 2");
  for (const f of (forms.json.value || [])) {
    if (!f.formxml.includes('iristel_apimarketplace')) continue;
    let xml = f.formxml;
    PAIRS.forEach((p) => { xml = xml.split(p.old).join(p.neu); });
    const r = await api('PATCH', `/systemforms(${f.formid})`, { formxml: xml });
    console.log(r.ok || r.status === 204 ? `+ form "${f.name}" repointed to cr57d_` : `! form "${f.name}": ${r.status}`);
  }
  let pub = await api('POST', '/PublishXml', { ParameterXml: '<importexportxml><entities><entity>account</entity></entities></importexportxml>' });
  console.log(pub.ok || pub.status === 204 ? '+ published (form update)' : `! publish ${pub.status}`);

  // 4. delete the old columns
  for (const p of PAIRS) {
    if (!have.has(p.old)) { console.log(`= ${p.old} already gone`); continue; }
    const r = await api('DELETE', `/EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${p.old}')`);
    console.log(r.ok || r.status === 204 ? `- deleted ${p.old}` : `! delete ${p.old}: ${r.status} ${r.text.slice(0, 200)}`);
  }
  pub = await api('POST', '/PublishXml', { ParameterXml: '<importexportxml><entities><entity>account</entity></entities></importexportxml>' });
  console.log(pub.ok || pub.status === 204 ? '+ published' : `! publish ${pub.status}`);
  console.log('Done.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
