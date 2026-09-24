'use strict';

/**
 * Admin dashboard API — who has marketplace access, to which APIs, and how
 * much they use them.
 *
 * Authorization follows the partner portal: the page sends the logged-in
 * `userEmail`, and this module checks it against the same Iristel staff list
 * the portal nav uses. No admin keys — if you can log in to the portal as
 * staff, you can read the dashboard.
 *
 * Durability: CRM-derived panels (access list, grants) are permanent;
 * requests and usage live on Render's ephemeral disk and reset on deploy.
 * The response says which is which so the UI can be honest about it.
 */

const fs = require('fs');
const path = require('path');
const { readUsage } = require('./usage');

const STORE = path.join(__dirname, '..', 'data', 'access-requests.json');

// Same list the partner portal nav script uses; override with ADMIN_EMAILS.
const DEFAULT_ADMINS = [
  'jerwin@iristel.com', 'jayoub@iristel.com', 'fdalberto@iristel.com',
  'jtamo@iristel.com', 'storozyan@iristel.com', 'nlajeunesse@iristel.com',
  'tkhei@iristel.com', 'sarmanious@iristel.com', 'tcui@iristel.com',
];
const admins = () => {
  const env = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(env.length ? env : DEFAULT_ADMINS);
};
const isAdmin = (email) => admins().has(String(email || '').trim().toLowerCase());

function readRequests() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return []; }
}

// ---- date helpers ---------------------------------------------------------
const day = (iso) => String(iso || '').slice(0, 10);
const daysBetween = (from, to) => {
  const out = [];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
function range(q) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : new Date().toISOString().slice(0, 10);
  let from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null;
  if (!from) {
    const d = new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 29);
    from = d.toISOString().slice(0, 10);
  }
  // Previous window of the same length, for the comparison numbers.
  const span = daysBetween(from, to).length;
  const pEnd = new Date(from + 'T00:00:00Z'); pEnd.setUTCDate(pEnd.getUTCDate() - 1);
  const pStart = new Date(pEnd); pStart.setUTCDate(pStart.getUTCDate() - (span - 1));
  return { from, to, span, prevFrom: pStart.toISOString().slice(0, 10), prevTo: pEnd.toISOString().slice(0, 10) };
}
const inRange = (iso, from, to) => { const d = day(iso); return d >= from && d <= to; };

// ---- CRM ------------------------------------------------------------------
// Every account that has been through the marketplace flow, approved or not.
async function crmGrants() {
  if (!process.env.D365_URL || !process.env.D365_CLIENT_ID) return { rows: [], available: false };
  const { api } = require('../scripts/d365');
  const sel = ['accountid', 'name', 'emailaddress1', 'cr57d_apimarketplaceapproved',
    'cr57d_apimarketplaceaccess', 'cr57d_requestedscopes', 'cr57d_apimarketplacerequestname',
    'cr57d_capturedon', 'cr57d_dataclassification'].join(',');
  const r = await api('GET', `/accounts?$select=${sel}&$filter=cr57d_apimarketplaceapproved ne null or cr57d_requestedscopes ne null`);
  if (!r.ok) throw new Error('CRM query failed: ' + r.status);
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const rows = (r.json.value || []).map((a) => ({
    accountId: a.accountid,
    organization: a.name || '',
    email: (a.emailaddress1 || '').toLowerCase(),
    approved: a.cr57d_apimarketplaceapproved === true,
    products: split(a.cr57d_apimarketplaceaccess),
    requested: split(a.cr57d_requestedscopes),
    application: a.cr57d_apimarketplacerequestname || '',
    capturedOn: a.cr57d_capturedon || null,
  }));
  return { rows, available: true };
}

const delta = (now, prev) => ({ value: now, prev, change: now - prev });

function register(app, PRODUCTS) {
  const productName = (id) => {
    const p = (PRODUCTS || []).find((x) => x.id === id);
    return p ? p.name : id;
  };

  const gate = (req, res) => {
    const email = String(req.query.email || req.get('X-Marketplace-Email') || '').trim().toLowerCase();
    if (!email || !isAdmin(email)) {
      res.status(403).json({
        error: 'staff_only',
        message: 'This dashboard is for Iristel staff. Log in to the partner portal with your Iristel account.',
      });
      return null;
    }
    return email;
  };

  app.get('/marketplace/admin/summary', async (req, res) => {
    if (!gate(req, res)) return;
    const { from, to, prevFrom, prevTo } = range(req.query);
    const productFilter = String(req.query.product || '').trim();

    let grants = [], crmAvailable = false, crmError = null;
    try { const g = await crmGrants(); grants = g.rows; crmAvailable = g.available; }
    catch (err) { crmError = err.message; }

    let requests = readRequests();
    let usage = readUsage();
    if (productFilter) {
      grants = grants.filter((g) => g.products.includes(productFilter) || g.requested.includes(productFilter));
      requests = requests.filter((r) => (r.products || []).includes(productFilter));
      usage = usage.filter((u) => u.product === productFilter);
    }

    const reqIn = requests.filter((r) => inRange(r.receivedAt, from, to));
    const reqPrev = requests.filter((r) => inRange(r.receivedAt, prevFrom, prevTo));
    const useIn = usage.filter((u) => inRange(u.at, from, to));
    const usePrev = usage.filter((u) => inRange(u.at, prevFrom, prevTo));

    const approved = grants.filter((g) => g.approved);
    const grantedProducts = new Set(approved.flatMap((g) => g.products));
    const activeUsers = new Set(useIn.map((u) => u.email).filter(Boolean));
    const activePrev = new Set(usePrev.map((u) => u.email).filter(Boolean));

    // Daily series for the trend charts.
    const days = daysBetween(from, to);
    const countBy = (rows, key) => {
      const m = Object.create(null);
      rows.forEach((r) => { const d = day(r[key]); m[d] = (m[d] || 0) + 1; });
      return days.map((d) => m[d] || 0);
    };

    // Per-product rollup: how many accounts hold it, how many calls it saw.
    const perProduct = {};
    const touch = (id) => (perProduct[id] = perProduct[id] || { id, name: productName(id), accounts: 0, calls: 0, errors: 0 });
    approved.forEach((g) => g.products.forEach((id) => { touch(id).accounts += 1; }));
    useIn.forEach((u) => {
      if (!u.product) return;
      const p = touch(u.product);
      p.calls += 1;
      if (u.status != null && (u.status >= 400 || u.status === 0)) p.errors += 1;
    });

    res.json({
      range: { from, to, prevFrom, prevTo },
      sources: {
        crm: { available: crmAvailable, error: crmError, durable: true },
        // Requests and usage live on Render's ephemeral disk.
        local: { durable: false, note: 'Requests and usage reset when the gateway redeploys.' },
      },
      kpis: {
        approvedAccounts: delta(approved.length, approved.length), // snapshot, no prior window
        productsGranted: delta(grantedProducts.size, grantedProducts.size),
        pendingRequests: delta(requests.filter((r) => r.status === 'pending-review').length,
          requests.filter((r) => r.status === 'pending-review').length),
        requests: delta(reqIn.length, reqPrev.length),
        calls: delta(useIn.length, usePrev.length),
        activeUsers: delta(activeUsers.size, activePrev.size),
      },
      series: {
        days,
        requests: countBy(reqIn, 'receivedAt'),
        calls: countBy(useIn, 'at'),
      },
      byProduct: Object.values(perProduct).sort((a, b) => b.calls - a.calls || b.accounts - a.accounts),
      byStatus: ['auto-authorized', 'pending-review', 'approved'].map((s) => ({
        status: s, count: requests.filter((r) => r.status === s).length,
      })),
      grants: grants.sort((a, b) => Number(b.approved) - Number(a.approved)
        || String(a.organization).localeCompare(String(b.organization))),
      requests: reqIn.slice().reverse().slice(0, 300),
      usage: useIn.slice().reverse().slice(0, 500),
      products: (PRODUCTS || []).map((p) => ({ id: p.id, name: p.name })),
    });
  });

  // Flip the access switch on a CRM account. The change propagates on its
  // own: the authorization lookup reads the switch live, the console
  // re-validates on every load, and the Dataverse flow (Flow 2) sends the
  // granted/removed email when the field changes.
  app.post('/marketplace/admin/access', async (req, res) => {
    const admin = gate(req, res);
    if (!admin) return;
    const { accountId, approved } = req.body || {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(accountId || '')))
      return res.status(400).json({ error: 'accountId must be an account GUID' });
    if (typeof approved !== 'boolean')
      return res.status(400).json({ error: 'approved must be true or false' });
    if (!process.env.D365_URL || !process.env.D365_CLIENT_ID)
      return res.status(503).json({ error: 'Dynamics is not configured on this gateway' });
    try {
      const { api } = require('../scripts/d365');
      const r = await api('PATCH', `/accounts(${accountId})`, { cr57d_apimarketplaceapproved: approved });
      if (!(r.ok || r.status === 204))
        return res.status(502).json({ error: `CRM update failed (HTTP ${r.status})` });
      console.log(`[admin] ${admin} set approved=${approved} on account ${accountId}`);
      res.json({ ok: true, accountId, approved });
    } catch (err) {
      res.status(502).json({ error: 'CRM update failed: ' + err.message });
    }
  });

  // CSV for the three tables, same filters as the dashboard.
  app.get('/marketplace/admin/export.csv', async (req, res) => {
    if (!gate(req, res)) return;
    const { from, to } = range(req.query);
    const view = String(req.query.view || 'grants');
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const send = (name, header, rows) => {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.send([header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n'));
    };

    if (view === 'requests') {
      const rows = readRequests().filter((r) => inRange(r.receivedAt, from, to))
        .map((r) => [r.id, r.receivedAt, r.organization, r.email, r.applicationName,
          (r.products || []).join(' '), r.status, (r.reasons || []).join('; ')]);
      return send(`marketplace-requests-${from}_${to}.csv`,
        ['Id', 'Received', 'Organization', 'Email', 'Application', 'Products', 'Status', 'Reasons'], rows);
    }
    if (view === 'usage') {
      const rows = readUsage().filter((u) => inRange(u.at, from, to))
        .map((u) => [u.at, u.email, u.product, u.method, u.endpoint, u.status, u.ms]);
      return send(`marketplace-usage-${from}_${to}.csv`,
        ['At', 'Email', 'Product', 'Method', 'Endpoint', 'Status', 'Ms'], rows);
    }
    let grants = [];
    try { grants = (await crmGrants()).rows; } catch { /* export what we can */ }
    const rows = grants.map((g) => [g.organization, g.email, g.approved ? 'Yes' : 'No',
      g.products.join(' '), g.requested.join(' '), g.application, g.capturedOn]);
    return send('marketplace-access.csv',
      ['Organization', 'Email', 'Approved', 'Granted products', 'Requested', 'Application', 'Captured on'], rows);
  });
}

module.exports = { register, isAdmin };
