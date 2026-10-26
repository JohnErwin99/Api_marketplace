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
const { rateFor, CLASSES, PRICING_NOTE, SANDBOX_CALLS, RATE_CARD, cents } = require('../lib/catalogs/pricing');

const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--'))
  || path.join(__dirname, '..', '..', 'iris-ai', 'console-agent', 'kb', 'products.md'));
const BASE_URL = 'https://api-marketplace-1im9.onrender.com';
// Mirrors lib/entitlements.js (ESPRESSO). Not required from there because
// that module opens the usage database.
const ESPRESSO = new Set(['lnp-enterprise', 'did-orders', 'lrn']);
// Espresso products whose sandbox needs its own REST login (not set yet:
// sandbox calls answer 503 sandbox_unavailable until it is).
const ESPRESSO_REST = new Set(['did-orders', 'lrn']);
const rateLabel = (r) => (!r ? 'not priced yet' : r.id === 'service' ? 'service order, no API fee'
  : r.priceCents ? `${r.name}, ${cents(r.priceCents)} per successful call` : 'Free');

// Gateway path for a catalog endpoint: Espresso and WLNP catalogs already
// carry the full /api/... path; IristelX-backed products (provisioning, 911,
// accounts, SIM, commissions, mobile) are proxied at /api/ix/<product>.
const gatewayPrefix = (p, e) => (e.path.startsWith('/api/') ? '' : '/api/ix/' + p.id);

// eps: the endpoints the KB lists (staff-only ones left out).
function modeRules(p, eps) {
  const count = (id) => eps.filter((e) => (rateFor(p.id, `${e.method} ${e.path}`) || {}).id === id).length;
  const split = CLASSES.map((c) => `${count(c.id)} ${c.name}`).join(', ');
  const sandbox = p.id === 'lnp-enterprise'
    ? 'Sandbox: runs on Espresso\'s test system (no real ports), changes included.'
    : ESPRESSO_REST.has(p.id)
      ? 'Sandbox: answers with sample data until Iristel switches on Espresso\'s test system for it; nothing reaches a live system.'
      : 'Sandbox: answers with sample data (header X-Marketplace-Sample: true); nothing reaches a live system. Required fields are still checked.';
  return [
    `Rates: ${split} operation(s); each operation's rate is shown below. Live calls${ESPRESSO.has(p.id) ? ' use Espresso\'s production system' : ''}.`,
    sandbox,
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
    lines.push('- **Status: switching on soon.** The docs and forms are published, and live calls answer `503 not_enabled` until Iristel switches it on. In the sandbox it can be tried now: it answers with sample data. Highlight Send for it only when the sandbox is on.');
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
    flags.push(rateLabel(rateFor(p.id, `${e.method} ${e.path}`)));
    if (e.upload) flags.push('file upload');
    else if (e.fields && e.fields.some((f) => /[.\[]/.test(f.name))) flags.push('raw JSON body');
    lines.push(`- \`${e.method} ${prefix}${e.path}\`${label ? ` — ${label}` : ''}${flags.length ? ` _(${flags.join('; ')})_` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function pricingSection() {
  const lines = ['## Pricing (proposed rates)', '', `${PRICING_NOTE} ${RATE_CARD.note}`, ''];
  for (const c of CLASSES) {
    lines.push(`- **${c.name}** (${c.priceCents ? `${cents(c.priceCents)} CAD per successful event` : c.billingUnit}): ${c.whatsIn} Examples: ${c.examples.join(', ')}.`);
  }
  lines.push('',
    'How it works:',
    '- There are no packages, subscriptions or platform fees. Every approved API can be called; the rate depends on the operation.',
    '- Only successful (2xx) live calls are billed. Failed calls, rejected calls, sandbox calls and a repeated Idempotency-Key (within 24 hours) are not billed.',
    '- Free reads and service orders need no card. Standard and Advanced live calls need a card under **Billing & usage** in the console; without one they answer 402 card_required (try the sandbox instead).',
    `- Sandbox: ${SANDBOX_CALLS.toLocaleString('en-CA')} calls per account per calendar month, shared by everyone on the account and never billed; Iristel can grant an extension. Turn on "Sandbox" in the console or send the header X-Marketplace-Mode: sandbox. Nothing in the sandbox reaches a live system: Enterprise LNP uses Espresso's test system, every other API answers with sample data. Past the allowance: 429 sandbox_limit until the 1st.`,
    '- A payment that failed (past due) pauses everything except free reads until the card is updated.',
    '- Charges are invoiced on the 1st for the month before (Standard and Advanced events by class, each line rounded to the cent, plus sales tax) and charged to the card on the 5th.',
    '- Service orders (numbers, ports, trunks, SIM/eSIM activation) are billed under Iristel\'s published tariff, separately from the API.',
    '- Iristel staff and internal employees are never billed.',
    '- These rates are proposed and need approval; the effective date is to be announced.',
    '');
  return lines.join('\n');
}

function bundlesSection() {
  const lines = ['## Bundles (guided multi-step use cases)', ''];
  for (const b of BUNDLES) {
    const apiCents = b.steps.reduce((t, s) => t + ((rateFor(s.product, s.endpoint) || {}).priceCents || 0), 0);
    const svc = b.steps.filter((s) => (rateFor(s.product, s.endpoint) || {}).id === 'service').length;
    lines.push(`- \`${b.id}\` — **${b.name}** (API cost per run: ${apiCents ? cents(apiCents) : 'free'}${svc ? `, plus service charges for ${svc} service order step(s)` : ''}): ${b.summary}`);
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
  'Pricing is per successful event, by rate class (Free, Standard 1¢, Advanced 2.5¢, service orders with no API fee; see "Pricing" below), with a free monthly sandbox. The rates are proposed and subject to approval.',
  '',
  ...PRODUCTS.map(productSection),
  pricingSection(),
  bundlesSection(),
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);
console.log(`Wrote ${OUT} — ${PRODUCTS.length} products, ${PRODUCTS.reduce((n, p) => n + (p.endpoints || []).filter((e) => !staffOnly(p, e)).length, 0)} endpoints (staff-only reporting endpoints left out)`);
const soon = PRODUCTS.filter((p) => p.status === 'preview').map((p) => p.id);
console.log(`Statuses from ${source}; coming soon: ${soon.length ? soon.join(', ') : 'none'}`);
})();
