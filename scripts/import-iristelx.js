'use strict';

/**
 * Imports the IristelX API reference (https://iristel-x.readme.io) into
 * marketplace catalogs.
 *
 * Every readme.io reference page has a .md version embedding a complete
 * OpenAPI 3.1 fragment. This script fetches the llms.txt index, pulls each
 * page, parses the fragment, and regenerates lib/catalogs/iristelx/*.json
 * grouped by domain. Re-run whenever Iristel updates the docs:
 *
 *   node scripts/import-iristelx.js
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const INDEX = 'https://iristel-x.readme.io/llms.txt';
const OUT_DIR = path.join(__dirname, '..', 'lib', 'catalogs', 'iristelx');
const CONCURRENCY = 5;

const EXCLUDE_ID = '_excluded';

/**
 * Buckets, in priority order. The first five match on the API path prefix,
 * which is how the service is actually organised (/uboss-robot, /mobile, /bot,
 * /commission, .../add-on) and mirrors the sections published in the docs.
 * The remainder fall back to keyword matching on slug + path.
 *
 * Anything unmatched goes to _excluded.json, which is written for reference
 * but deliberately NOT registered in lib/catalogs/index.js.
 */
const DOMAINS = [
  // Dropped on purpose: billing/payments, webhooks and admin are not published
  // in the marketplace. Matched first so /billing/{accountId}/... cannot be
  // pulled into Accounts by the "account" keyword below.
  { id: EXCLUDE_ID, path: /^\/(billing|invoice-payments|clover)\//, drop: true },
  { id: EXCLUDE_ID, path: /\/agent-payments(\/|$)/, drop: true },
  { id: EXCLUDE_ID, path: /siptrunk/i, drop: true },
  { id: EXCLUDE_ID, path: /^\/(telephone-numbers|porting|providers|release-numbers|product\/catalog)(\/|$)/, drop: true },

  { id: 'uboss',      path: /^\/uboss-robot\// },
  { id: 'bot',        path: /^\/bot\// },
  { id: 'commission', path: /\/(agent-)?commissions?(\/|$)/ },
  { id: 'addon',      path: /\/add-on(\/|$)/ },
  { id: 'mobile',     path: /^\/mobile\// },

  { id: 'sim',        match: /sim-card|sim\b|esim|imei|book-sim|reserve-sim|unreserve|iccid/ },
  { id: 'accounts',   match: /account|service|plan|address|usage|journal|sms|voicemail|call-forwarding|pin|bundle/ },
];

const SKIP = /911/; // covered by the existing e911 product

/**
 * Iristel's published spec contains two malformed paths that would otherwise
 * become broken catalog entries. Both are fixed here rather than by hand, so a
 * re-import cannot reintroduce them.
 *   /commission/{agentId}/{startDate/{endDate}  -> unclosed brace
 *   /mobile/service-now/ tickets/{id}/images    -> stray space
 */
function normalizePath(p) {
  return p
    .replace(/\s+/g, '')
    .replace(/\{([^{}\/]+)\}?/g, ':$1')
    .replace(/:+/g, ':');
}

const get = (url) => axios.get(url, { timeout: 30000, responseType: 'text', transformResponse: (x) => x });

async function fetchPage(url, attempt = 0) {
  try { return (await get(url)).data; }
  catch (e) {
    if (attempt < 1) return fetchPage(url, attempt + 1);
    throw e;
  }
}

/** Build an example value from an OpenAPI schema node. */
function example(schema, name = '', depth = 0) {
  if (!schema || depth > 6) return '';
  if (schema.example !== undefined) return schema.example;
  if (schema['x-default'] !== undefined && schema['x-default'] !== '') return schema['x-default'];
  if (schema.default !== undefined && schema.default !== '') return schema.default;
  if (schema.enum && schema.enum.length) return schema.enum[0];
  const t = schema.type || (schema.properties ? 'object' : undefined);
  if (t === 'object' || schema.properties) {
    const o = {};
    for (const [k, v] of Object.entries(schema.properties || {})) o[k] = example(v, k, depth + 1);
    return o;
  }
  if (t === 'array') return [example(schema.items, name, depth + 1)];
  if (t === 'integer' || t === 'number') return 0;
  if (t === 'boolean') return true;
  return name ? name.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : 'STRING';
}

/** Flatten body schema into field docs. */
function fieldDocs(schema, prefix = '', depth = 0, out = []) {
  if (!schema || depth > 5) return out;
  const req = new Set(schema.required || []);
  for (const [k, v] of Object.entries(schema.properties || {})) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (v && (v.type === 'object' || v.properties)) {
      fieldDocs(v, name, depth + 1, out);
    } else if (v && v.type === 'array' && v.items && (v.items.properties || v.items.type === 'object')) {
      fieldDocs(v.items, name + '[]', depth + 1, out);
    } else {
      out.push({
        name,
        required: req.has(k),
        description: (v && v.description) || '',
      });
    }
  }
  return out;
}

function classify(slug, apiPath) {
  for (const d of DOMAINS) if (d.path && d.path.test(apiPath)) return d.id;
  const hay = slug + ' ' + apiPath;
  for (const d of DOMAINS) if (d.match && d.match.test(hay)) return d.id;
  return EXCLUDE_ID;
}

async function main() {
  const index = (await get(INDEX)).data;
  const urls = [...new Set(
    [...index.matchAll(/https:\/\/iristel-x\.readme\.io\/reference\/[a-z0-9-]+\.md/g)].map((m) => m[0])
  )];
  console.log(`index: ${urls.length} reference pages`);

  const catalogs = {}; // domain -> endpoints
  const seen = new Set(); // method+path dedupe across pages
  const failures = [];
  let skipped911 = 0, noSpec = 0;

  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      const slug = url.match(/reference\/([a-z0-9-]+)\.md/)[1];
      let md;
      try { md = await fetchPage(url); }
      catch (e) { failures.push(`${slug}: ${e.message}`); continue; }

      const title = (md.match(/^# (?!OpenAPI)(.+)$/m) || [])[1] || slug;
      const desc = (md.split(/^# OpenAPI definition/m)[0].split(/^# /m).slice(2).join(' ') || '')
        .replace(/^.+$/m, (l) => l) // keep text
        .replace(/\n+/g, ' ').trim();
      // free text between the title line and the OpenAPI heading:
      const body = md.split('# OpenAPI definition')[0];
      const afterTitle = body.slice(body.indexOf('# ' + title) + ('# ' + title).length).replace(/\n+/g, ' ').trim();

      const jsonBlock = md.match(/```json\s*([\s\S]*?)```/);
      if (!jsonBlock) { noSpec++; continue; }
      let spec;
      try { spec = JSON.parse(jsonBlock[1]); }
      catch (e) { failures.push(`${slug}: bad JSON (${e.message})`); continue; }

      for (const [apiPath, ops] of Object.entries(spec.paths || {})) {
        for (const [method, op] of Object.entries(ops)) {
          if (!/^(get|post|put|patch|delete)$/.test(method)) continue;
          if (SKIP.test(slug) || SKIP.test(apiPath)) { skipped911++; continue; }
          const cleanPath = normalizePath(apiPath);
          // Dedupe on the normalized path so a malformed duplicate page (e.g.
          // the unclosed-brace commission route) collapses into the good one.
          const key = method.toUpperCase() + ' ' + cleanPath;
          if (seen.has(key)) continue;
          seen.add(key);

          const params = (op.parameters || [])
            .filter((p) => p.in === 'path' || p.in === 'query')
            .map((p) => ({
              name: p.name, in: p.in, required: !!p.required || p.in === 'path',
              description: p.description || '',
            }));

          const ep = {
            method: method.toUpperCase(),
            path: cleanPath,
            soap: op.operationId || slug,
            summary: op.summary || title,
            description: (op.description || afterTitle || desc || '').slice(0, 600),
          };
          if (params.length) ep.params = params;

          const bodySchema = op.requestBody && op.requestBody.content &&
            (op.requestBody.content['application/json'] || {}).schema;
          const formSchema = op.requestBody && op.requestBody.content &&
            (op.requestBody.content['multipart/form-data'] || {}).schema;
          if (bodySchema) {
            ep.body = example(bodySchema);
            const f = fieldDocs(bodySchema);
            if (f.length) ep.fields = f;
          } else if (formSchema) {
            const fileField = Object.keys(formSchema.properties || {})[0] || 'file';
            ep.upload = { field: fileField, accept: '.csv' };
          }

          const ok = op.responses && (op.responses['200'] || op.responses['201']);
          if (ok && ok.description && ok.description !== 'OK' && ok.description !== '200') {
            ep.returns = ok.description;
          }

          const domain = classify(slug, cleanPath);
          (catalogs[domain] ||= []).push(ep);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Stale files from the previous classification scheme.
  for (const gone of ['admin.json', 'billing.json', 'events.json', 'numbers.json', 'siptrunk.json']) {
    const p = path.join(OUT_DIR, gone);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`  removed stale ${gone}`); }
  }

  const write = (id) => {
    const eps = (catalogs[id] || []).sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
    );
    fs.writeFileSync(path.join(OUT_DIR, id + '.json'), JSON.stringify(eps, null, 2) + '\n');
    return eps.length;
  };

  let total = 0;
  for (const id of [...new Set(DOMAINS.filter((d) => !d.drop).map((d) => d.id))]) {
    const n = write(id);
    console.log(`  ${id.padEnd(11)} ${n} endpoints`);
    total += n;
  }
  const excluded = write(EXCLUDE_ID);
  console.log(`  ${EXCLUDE_ID.padEnd(11)} ${excluded} endpoints (written for reference, NOT registered)`);
  console.log(`published ${total} endpoints | skipped 911: ${skipped911} | pages without spec: ${noSpec}`);
  if (failures.length) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log('  ' + f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
