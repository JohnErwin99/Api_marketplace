'use strict';

/**
 * Exports the marketplace catalog as a Markdown knowledge-base page for the
 * "Iris Console" ElevenLabs agent, so what Iris knows about each product
 * comes from the same catalog the console renders and doesn't go stale.
 *
 * Reads lib/catalogs (products, endpoints, flows) and lib/catalogs/ui-hints.js
 * (blurbs, friendly titles) the same way server.js does — no server, network
 * or database needed. Re-run whenever a catalog or hint changes, then upload
 * the file to the agent's knowledge base:
 *
 *   node scripts/export-iris-kb.js [out.md]
 *
 * Default output: ../iris-ai/console-agent/kb/products.md (next to this repo).
 * Product statuses (live / coming soon) come from the deployed gateway's
 * /catalog.json; pass --local to use this machine's settings instead.
 */

const fs = require('fs');
const path = require('path');
const { PRODUCTS } = require('../lib/catalogs');
const UI_HINTS = require('../lib/catalogs/ui-hints');
const { BUNDLES } = require('../lib/catalogs/bundles');
const { tierFor, PACKAGES, PRICING_NOTE, higherPackage } = require('../lib/catalogs/pricing');
const PACKAGE_NAME = Object.fromEntries(PACKAGES.map((t) => [t.id, t.name]));

const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--'))
  || path.join(__dirname, '..', '..', 'iris-ai', 'console-agent', 'kb', 'products.md'));
const BASE_URL = 'https://api-marketplace-1im9.onrender.com';
// Mirrors lib/entitlements.js (ESPRESSO). Not required from there because
// that module opens the usage database.
const ESPRESSO = new Set(['lnp-enterprise', 'did-orders', 'lrn']);

// Gateway path for a catalog endpoint: Espresso and WLNP catalogs already
// carry the full /api/... path; IristelX-backed products (provisioning, 911,
// accounts, SIM, commissions, mobile) are proxied at /api/ix/<product>.
const gatewayPrefix = (p, e) => (e.path.startsWith('/api/') ? '' : '/api/ix/' + p.id);

// eps: the endpoints the KB lists (staff-only ones left out).
function modeRules(p, eps) {
  const count = (id) => eps.filter((e) => tierFor(p.id, `${e.method} ${e.path}`) === id).length;
  const split = PACKAGES.map((t) => `${count(t.id)} ${t.name}`).join(', ');
  return [
    `Packages: ${split} operation(s). Each operation's package is shown below; a caller's package must include it (Premium includes Standard, which includes Free), otherwise the call answers 403 upgrade_required.`,
    `Every partner call is **live**${ESPRESSO.has(p.id) ? ' (Espresso production system)' : ''}: there is no sandbox. No per-call charges.`,
  ];
}

// The knowledge base is read by every user, partners included, so the
// staff-only reporting endpoints stay out of it (same list as STAFF_ONLY in
// public/console.html; the console hides them from non-staff too).
const STAFF_ONLY = { 'iristelx-commission': ['GET /commission/agents', 'GET /agent-commissions'] };
const staffOnly = (p, e) => (STAFF_ONLY[p.id] || []).includes(`${e.method} ${e.path}`);

function productSection(p) {
  const hints = UI_HINTS[p.id] || {};
  const blurb = (hints.product && hints.product.blurb) || p.summary || '';
  const eps = (p.endpoints || []).filter((e) => !staffOnly(p, e));
  const prefix = eps.length ? gatewayPrefix(p, eps[0]) : '';
  const lines = [];
  lines.push(`## ${p.name}`, '');
  lines.push(`- **Product id:** \`${p.id}\``);
  lines.push(`- **What it does:** ${blurb}`);
  if (p.status === 'preview') {
    lines.push('- **Status: switching on soon.** The docs and forms are published, but every call answers `503 not_enabled` until Iristel switches it on. Explain how it works, but don\'t highlight Send for it.');
  }
  if (prefix) lines.push(`- **Gateway prefix:** \`${prefix}\` — IristelX-backed; the gateway adds the upstream key, so you only send your marketplace credentials.`);
  lines.push('- **Auth:** in the console, your portal login session (automatic); from your own backend, your marketplace key as `Authorization: Bearer mk_…` or `X-Marketplace-Key: mk_…`.');
  for (const r of modeRules(p, eps)) lines.push(`- ${r}`);
  // Step titles only: the console's flow text is longer and is returned per
  // endpoint by the get_endpoint_docs tool.
  const steps = p.flow ? (p.flow.steps || []).map((s) => s.title).filter(Boolean).join(' → ') : '';
  if (steps) lines.push(`- **Typical flow — ${p.flow.title}:** ${steps}.`);
  lines.push('', `### Endpoints (${eps.length})`, '');
  for (const e of eps) {
    const h = hints[`${e.method} ${e.path}`] || {};
    const label = h.title || e.summary || '';
    const flags = [];
    const tier = tierFor(p.id, `${e.method} ${e.path}`);
    if (tier) flags.push(`${PACKAGE_NAME[tier]} package`);
    if (e.upload) flags.push('file upload');
    else if (e.fields && e.fields.some((f) => /[.\[]/.test(f.name))) flags.push('raw JSON body');
    lines.push(`- \`${e.method} ${prefix}${e.path}\`${label ? ` — ${label}` : ''}${flags.length ? ` _(${flags.join('; ')})_` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

const price = (t) => (t.priceCents ? `${t.priceCents}¢ CAD a month` : 'free');
function packagesSection() {
  const lines = ['## Packages and pricing', '', `${PRICING_NOTE} Every operation belongs to the lowest package that includes it, shown on each endpoint above and on its card in the console.`, ''];
  for (const t of PACKAGES) {
    lines.push(`- **${t.name}** (${price(t)}): ${t.whatsIn} Examples: ${t.examples.join(', ')}.`);
  }
  lines.push('',
    'How it works:',
    '- The partner picks a package on the access request (API Marketplace page); Iristel staff approve it. To change package, the partner asks from the API Marketplace page (a new request) and staff apply it.',
    '- Free needs no card. Standard and Premium need a card under **Billing & usage** in the console before the first call; until then every call answers 402.',
    '- A call outside the partner\'s package answers **403 upgrade_required**, with the package that includes it (requiredPackage).',
    '- The monthly fee is invoiced on the 1st for the month before and charged to the card on the 5th, with sales tax. There are no per-call charges, and calls are still counted under Billing & usage.',
    '- There is no sandbox and there are no free test calls: every partner call is live. Iristel staff and internal employees are never billed.',
    '');
  return lines.join('\n');
}

function bundlesSection() {
  const lines = ['## Bundles (guided multi-step use cases)', ''];
  for (const b of BUNDLES) {
    const pkg = b.steps.reduce((acc, s) => higherPackage(acc, tierFor(s.product, s.endpoint) || 'premium'), 'free');
    lines.push(`- \`${b.id}\` — **${b.name}** (needs ${PACKAGE_NAME[pkg]}): ${b.summary}`);
  }
  lines.push('');
  return lines.join('\n');
}

// A product's status (live, or 'preview' until its upstream is configured)
// depends on the deployed gateway's settings, not this machine's, so it is
// read from the live catalog. --local keeps the statuses computed here.
async function applyDeployedStatuses() {
  if (process.argv.includes('--local')) return 'local settings (--local)';
  try {
    const r = await fetch(`${BASE_URL}/catalog.json`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const live = Object.fromEntries(((await r.json()).products || []).map((p) => [p.id, p.status]));
    for (const p of PRODUCTS) if (live[p.id]) p.status = live[p.id];
    return `${BASE_URL}/catalog.json`;
  } catch (err) {
    console.warn(`Could not read ${BASE_URL}/catalog.json (${err.message}); using local settings.`);
    return 'local settings (deployed catalog unreachable)';
  }
}

(async () => {
const source = await applyDeployedStatuses();
const md = [
  '<!-- Generated by api-marketplace/scripts/export-iris-kb.js from the marketplace catalog — do not edit by hand. Regenerate with: node scripts/export-iris-kb.js [out.md] -->',
  '',
  '# API Marketplace products',
  '',
  `Every product is called through the gateway at \`${BASE_URL}\`. A caller only reaches the products their account is approved for (others return 403). Endpoint paths below are the full gateway paths; \`:name\` segments are path parameters.`,
  '',
  'Pricing is by package (Free, Standard, Premium; see "Packages and pricing" below). There is no sandbox: every partner call is live, and there are no per-call charges.',
  '',
  ...PRODUCTS.map(productSection),
  packagesSection(),
  bundlesSection(),
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);
console.log(`Wrote ${OUT} — ${PRODUCTS.length} products, ${PRODUCTS.reduce((n, p) => n + (p.endpoints || []).filter((e) => !staffOnly(p, e)).length, 0)} endpoints (staff-only reporting endpoints left out)`);
const soon = PRODUCTS.filter((p) => p.status === 'preview').map((p) => p.id);
console.log(`Statuses from ${source}; coming soon: ${soon.length ? soon.join(', ') : 'none'}`);
})();
