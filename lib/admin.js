'use strict';

/**
 * Admin dashboard API — who has marketplace access, to which APIs, and how
 * much they use them.
 *
 * Authorization follows the partner portal: the page sends the logged-in
 * `userEmail`, and this module checks it against the one admin list
 * (lib/admins.js, managed on this dashboard). No admin keys — if you can log
 * in to the portal as an admin, you can read the dashboard.
 *
 * Durability: CRM-derived panels (access list, grants) are permanent;
 * usage lives in the SQLite ledger (lib/db.js, persistent disk); requests
 * still live on Render's ephemeral disk and reset on deploy.
 * The response says which is which so the UI can be honest about it.
 */

const fs = require('fs');
const path = require('path');
const { readUsage } = require('./usage');
const { grantedProducts, resetAuthorizationCache, accountTypeFromCrm } = require('./onboarding');
const { ACCOUNT_TYPES } = require('./catalogs/bundles');

// Account type id / CRM choice value -> label ("Business customer", ...).
const typeLabel = (id) => ((ACCOUNT_TYPES.find((t) => t.id === id) || {}).label) || '';
const typeLabelFromCrm = (code) => typeLabel(accountTypeFromCrm(code));
const { sessionEmail, isAdmin } = require('./session');
const db = require('./db');
const security = require('./security');
const { classOf } = require('./catalogs/pricing');
const sandbox = require('./sandbox');
const admins = require('./admins');

// Where a partner stands this month: card on file (needed for Standard and
// Advanced events), past due, sandbox calls used, and billed events.
const qPlanProfile = db.prepare('SELECT token, past_due FROM billing_profiles WHERE email = ?');
const qPlanUsage = db.prepare(`SELECT rate_class, mode, COUNT(*) AS calls, SUM(billable) AS billed, SUM(price_cents) AS cents
  FROM usage WHERE email = ? AND month = ? GROUP BY rate_class, mode`);
function planFor(email, accountId) {
  const p = qPlanProfile.get(email) || {};
  const rows = email ? qPlanUsage.all(email, new Date().toISOString().slice(0, 7)) : [];
  const billed = (id) => rows.filter((r) => r.rate_class === id && r.mode === 'live').reduce((n, r) => n + (r.billed || 0), 0);
  const cents = rows.filter((r) => r.mode === 'live' && classOf(r.rate_class))
    .reduce((m, r) => m.set(r.rate_class, (m.get(r.rate_class) || 0) + (r.cents || 0)), new Map());
  // The sandbox allowance is the account's (every login on it shares it).
  const sb = accountId ? sandbox.stateFor(sandbox.accountKey(accountId)) : null;
  return {
    cardOnFile: !!p.token, pastDue: !!p.past_due,
    sandboxCalls: sb ? sb.used : rows.filter((r) => r.mode === 'sandbox').reduce((n, r) => n + r.calls, 0),
    sandboxLimit: sb ? sb.limit : null, sandboxExtra: sb ? sb.extra : 0,
    standardEvents: billed('standard'), advancedEvents: billed('advanced'),
    cents: [...cents.values()].reduce((t, c) => t + Math.round(c), 0),
  };
}

// The BroadWorks enterprise linked to a CRM account (lib/broadworks.js),
// or null while that product isn't installed.
function broadworksLinks() {
  try { return new Map(require('./broadworks').listLinks().map((l) => [String(l.account_id || l.accountId).toLowerCase(), l.enterprise_id || l.enterpriseId])); }
  catch { return new Map(); }
}

const STORE = db.REQUESTS_FILE;


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

// ---- audit log -------------------------------------------------------------
const qAuditKpi = db.prepare('SELECT event, COUNT(*) AS n FROM audit_log WHERE at >= ? GROUP BY event');
const qAuditEvents = db.prepare('SELECT DISTINCT event FROM audit_log ORDER BY event');
// Filters: from/to (YYYY-MM-DD, inclusive), email / ip (substring), event
// (exact, or a prefix ending in "." such as "login.").
function auditWhere(q) {
  const where = ['at >= @from', 'at < @toNext'];
  const toNext = new Date(Date.parse(q.to + 'T00:00:00Z') + 24 * 60 * 60 * 1000).toISOString();
  const params = { from: q.from + 'T00:00:00.000Z', toNext };
  if (q.email) { where.push('email LIKE @email'); params.email = '%' + String(q.email).toLowerCase() + '%'; }
  if (q.ip) { where.push('ip LIKE @ip'); params.ip = '%' + String(q.ip) + '%'; }
  if (q.event) {
    const ev = String(q.event);
    if (ev.endsWith('.')) { where.push('event LIKE @event'); params.event = ev + '%'; }
    else { where.push('event = @event'); params.event = ev; }
  }
  return { sql: where.join(' AND '), params };
}
function auditRows(q, limit, offset = 0) {
  const w = auditWhere(q);
  return db.prepare(`SELECT at, event, email, ip, user_agent, outcome, detail FROM audit_log
    WHERE ${w.sql} ORDER BY at DESC LIMIT @limit OFFSET @offset`).all({ ...w.params, limit, offset });
}
// How many events match the same filters (the panel's "20 of N").
function auditCount(q) {
  const w = auditWhere(q);
  return db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE ${w.sql}`).get(w.params).n;
}

// ---- CRM ------------------------------------------------------------------
// Accounts that requested marketplace APIs or hold access (approved or not).
async function crmGrants() {
  if (!process.env.D365_URL || !process.env.D365_CLIENT_ID) return { rows: [], available: false };
  const { api } = require('../scripts/d365');
  const sel = ['accountid', 'name', 'emailaddress1', 'cr57d_apimarketplaceapproved',
    'cr57d_apimarketplaceaccess', 'cr57d_requestedscopes', 'cr57d_apimarketplacerequestname',
    'cr57d_apimarketplacebundles', 'cr57d_businessregnumber',
    'cr57d_capturedon', 'cr57d_dataclassification', 'cr57d_department', 'cr57d_regcheck'].join(',');
  // Accounts that asked for APIs or hold access. Not "approved ne null": the
  // CRM fills that switch with No on every new account (converted leads,
  // test accounts), which put people who never asked on the access list.
  const filter = '&$filter=cr57d_apimarketplaceapproved eq true'
    + ' or cr57d_requestedscopes ne null or cr57d_apimarketplacebundles ne null or cr57d_apimarketplaceaccess ne null';
  const r = await api('GET', `/accounts?$select=${sel}${filter}`);
  if (!r.ok) throw new Error('CRM query failed: ' + r.status);
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  // "Bundle Name[api1,api2]; Other[text]" -> [{name, apis}]
  const parseBundles = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean)
    .map((x) => {
      const m = x.match(/^(.*?)\[(.*)\]$/);
      return m ? { name: m[1].trim(), apis: m[2].split(',').map((y) => y.trim()).filter(Boolean) }
               : { name: x, apis: [] };
    });
  const links = broadworksLinks();
  const rows = (r.json.value || []).map((a) => ({
    accountId: a.accountid,
    organization: a.name || '',
    email: (a.emailaddress1 || '').toLowerCase(),
    approved: a.cr57d_apimarketplaceapproved === true,
    products: grantedProducts(a),
    requested: split(a.cr57d_requestedscopes),
    bundles: parseBundles(a.cr57d_apimarketplacebundles),
    businessRegNumber: a.cr57d_businessregnumber || '',
    regCheck: a.cr57d_regcheck || '',
    department: a.cr57d_department || '',
    application: a.cr57d_apimarketplacerequestname || '',
    capturedOn: a.cr57d_capturedon || null,
    accountType: typeLabelFromCrm(a.cr57d_dataclassification),
    plan: planFor((a.emailaddress1 || '').toLowerCase(), a.accountid),
    broadworksEnterprise: links.get(String(a.accountid || '').toLowerCase()) || null,
  }))
    // fields can hold an empty string rather than null
    .filter((g) => g.approved || g.products.length || g.requested.length || g.bundles.length);
  return { rows, available: true };
}

const delta = (now, prev) => ({ value: now, prev, change: now - prev });

function register(app, PRODUCTS) {
  const productName = (id) => {
    const p = (PRODUCTS || []).find((x) => x.id === id);
    return p ? p.name : id;
  };

  // Staff-only: the email comes from a signed session token (issued after a
  // real password check, see lib/session.js), never from the query string.
  const gate = (req, res) => {
    const email = sessionEmail(req);
    if (!email) {
      res.status(401).json({
        error: 'login_required',
        message: 'Your session is missing or has expired. Log in to the partner portal again.',
      });
      return null;
    }
    if (!isAdmin(email)) {
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
    // Request status is derived live from CRM: the stored record is always
    // "pending-review" (intake never auto-approves) and the local file is
    // ephemeral, so the approved switch on the matching account is the truth.
    const approvedEmails = new Set(grants.filter((g) => g.approved).map((g) => g.email));
    requests = requests.map((r) => ({
      ...r,
      accountType: typeLabel(r.accountType),
      ...(approvedEmails.has(String(r.email || '').toLowerCase()) ? { status: 'approved' } : {}),
    }));
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
        // Requests, usage, cards and charges live in DATA_DIR (lib/db.js).
        local: { durable: db.storage.persistent, fromEnv: db.storage.fromEnv, dataDir: db.storage.dataDir },
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

  // Access requests still waiting for staff, for the red badge on the portal
  // nav's Dashboards menu. Same rule as the summary's pendingRequests: a
  // stored request whose email has no approved CRM account. One entry per
  // email (the latest request), newest first. Cached briefly: the nav asks
  // on every page load and the CRM read is the slow part.
  let pendingCache = null;   // { at, body }
  let pendingGen = 0;        // bumped on every approval change
  app.get('/marketplace/admin/pending', async (req, res) => {
    if (!gate(req, res)) return;
    if (pendingCache && Date.now() - pendingCache.at < 60 * 1000) return res.json(pendingCache.body);
    const gen = pendingGen;
    let approved = new Set(), crmError = null;
    try { approved = new Set((await crmGrants()).rows.filter((g) => g.approved).map((g) => g.email)); }
    catch (err) { crmError = err.message; }
    const latest = new Map();
    for (const r of readRequests()) {
      const email = String(r.email || '').toLowerCase();
      if (!email || r.status !== 'pending-review' || approved.has(email)) continue;
      const prev = latest.get(email);
      if (!prev || String(r.receivedAt) > String(prev.receivedAt)) latest.set(email, r);
    }
    const items = [...latest.values()]
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
      .map((r) => ({ organization: r.organization || '', email: String(r.email).toLowerCase(), receivedAt: r.receivedAt || null, products: r.products || [] }));
    const body = { count: items.length, items: items.slice(0, 20), crmError };
    // A CRM outage would count approved partners as waiting: don't cache it.
    // Nor an answer read before an approval made meanwhile.
    if (!crmError && gen === pendingGen) pendingCache = { at: Date.now(), body };
    res.json(body);
  });

  // Flip the access switch on a CRM account, and/or link it to its BroadWorks
  // enterprise (the only enterprise its users can reach through the BroadWorks
  // API; empty unlinks). The access change propagates on its own: the
  // authorization lookup reads it live, the console re-validates on every
  // load, and the Dataverse flow (Flow 2) sends the granted/removed email
  // when the switch changes.
  app.post('/marketplace/admin/access', async (req, res) => {
    const admin = gate(req, res);
    if (!admin) return;
    const { approved } = req.body || {};
    const bw = (req.body || {}).broadworksEnterprise;
    // Dataverse returns account ids in lower case; links are matched exactly.
    const accountId = String((req.body || {}).accountId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId))
      return res.status(400).json({ error: 'accountId must be an account GUID' });
    if (approved !== undefined && typeof approved !== 'boolean')
      return res.status(400).json({ error: 'approved must be true or false' });
    if (bw !== undefined && bw !== null && typeof bw !== 'string')
      return res.status(400).json({ error: 'broadworksEnterprise must be a string (empty or null unlinks)' });
    const enterprise = bw == null ? '' : bw.trim();
    if (enterprise) {
      try { require('./broadworks').checkId('enterprise', enterprise, 'broadworksEnterprise'); }
      catch (err) { return res.status(400).json({ error: err.message }); }
    }
    if (approved === undefined && bw === undefined)
      return res.status(400).json({ error: 'send approved and/or broadworksEnterprise' });
    const done = [];
    const audit = (what, outcome) => security.audit(req, 'admin.access_changed', { email: admin, outcome, detail: `account ${accountId} ${what}` });
    // The CRM switch first: a failed approval leaves nothing half-changed.
    if (approved !== undefined) {
      if (!process.env.D365_URL || !process.env.D365_CLIENT_ID)
        return res.status(503).json({ error: 'Dynamics is not configured on this gateway' });
      try {
        const { api } = require('../scripts/d365');
        const r = await api('PATCH', `/accounts(${accountId})`, { cr57d_apimarketplaceapproved: approved });
        resetAuthorizationCache();
        pendingCache = null; pendingGen++;   // the nav badge reflects an approval at once
        if (!(r.ok || r.status === 204)) {
          audit(`approved=${approved}`, 'failed');
          return res.status(502).json({ error: `CRM update failed (HTTP ${r.status})` });
        }
      } catch (err) {
        audit(`approved=${approved}`, 'failed');
        return res.status(502).json({ error: 'CRM update failed: ' + err.message });
      }
      done.push(`approved=${approved}`);
    }
    if (bw !== undefined) {
      try { require('./broadworks').setLink(accountId, enterprise || null, admin); }
      catch (err) {
        if (done.length) audit(done.join(' '), 'ok');
        return res.status(err.status === 400 ? 400 : 500).json({ error: 'Could not save the BroadWorks link: ' + err.message, saved: done });
      }
      done.push(`broadworks=${enterprise || '(none)'}`);
    }
    // The same enterprise linked to another account is allowed (one company,
    // several CRM accounts) but usually a typo: say so.
    let warning = null;
    if (enterprise) {
      try {
        const others = (require('./broadworks').linkedElsewhere || (() => []))(enterprise, accountId) || [];
        if (others.length) warning = `BroadWorks enterprise ${enterprise} is also linked to ${others.length} other account(s): ${others.slice(0, 5).join(', ')}. Check it's the same organisation.`;
      } catch { /* informational only */ }
    }
    console.log(`[admin] ${admin} set ${done.join(' ')} on account ${accountId}`);
    audit(done.join(' '), 'ok');
    res.json({ ok: true, accountId, ...(approved !== undefined ? { approved } : {}), ...(bw !== undefined ? { broadworksEnterprise: enterprise || null } : {}), ...(warning ? { warning } : {}) });
  });

  // Approved sandbox extension (pricing proposal §6): extra sandbox calls for
  // one CRM account, this month or next. Grants add up; they can't be taken
  // back, only not repeated.
  app.post('/marketplace/admin/sandbox-extension', (req, res) => {
    const admin = gate(req, res);
    if (!admin) return;
    const b = req.body || {};
    const accountId = String(b.accountId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId))
      return res.status(400).json({ error: 'accountId must be an account GUID' });
    const extra = Number(b.extraCalls);
    if (!Number.isInteger(extra) || extra < 1 || extra > 100000)
      return res.status(400).json({ error: 'extraCalls must be a whole number from 1 to 100,000' });
    const now = sandbox.month();
    const next = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    const mon = b.month == null || b.month === '' ? now : String(b.month);
    if (mon !== now && mon !== next) return res.status(400).json({ error: `month must be ${now} or ${next}` });
    const note = b.note == null ? '' : String(b.note).slice(0, 300);
    const state = sandbox.grant(accountId, mon, extra, admin, note);
    security.audit(req, 'admin.sandbox_extension', { email: admin, outcome: 'ok', detail: `account ${accountId} ${mon} +${extra}${note ? ` (${note})` : ''}` });
    res.json({ ok: true, accountId, month: mon, ...state });
  });

  // ---- security & audit --------------------------------------------------
  // Audit trail (logins with IP, sign-ups, keys, staff actions), the KPIs
  // for the panel, and the accounts locked right now.
  app.get('/marketplace/admin/audit', (req, res) => {
    if (!gate(req, res)) return;
    const { from, to } = range(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const rows = auditRows({ ...req.query, from, to }, limit, offset);
    const total = auditCount({ ...req.query, from, to });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const kpi = Object.fromEntries(qAuditKpi.all(since).map((r) => [r.event, r.n]));
    res.json({
      from, to, offset, limit, total, rows,
      kpis: {
        logins24h: (kpi['login.success'] || 0) + (kpi['session.created'] || 0),
        failed24h: kpi['login.fail'] || 0,
        lockedNow: security.listLocked().length,
        signups24h: kpi['signup.success'] || 0,
        rateLimited24h: (kpi['signup.rate_limited'] || 0) + (kpi['login.rate_limited'] || 0),
      },
      events: qAuditEvents.all().map((r) => r.event),
    });
  });

  app.get('/marketplace/admin/locked', (req, res) => {
    if (!gate(req, res)) return;
    res.json({ rows: security.listLocked().map((r) => ({
      email: r.email, failures: r.count, lastIp: r.last_ip, lockedUntil: r.locked_until,
    })) });
  });

  app.post('/marketplace/admin/unlock', (req, res) => {
    const admin = gate(req, res);
    if (!admin) return;
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });
    const wasLocked = security.unlock(req, email, admin);
    console.log(`[admin] ${admin} unlocked ${email} (was locked: ${wasLocked})`);
    res.json({ ok: true, email, wasLocked });
  });

  // ---- admins ------------------------------------------------------------------
  // The one admin list for the portal and the marketplace (lib/admins.js).
  app.get('/marketplace/admin/admins', (req, res) => {
    if (!gate(req, res)) return;
    res.json({ rows: admins.list() });
  });

  app.post('/marketplace/admin/admins', (req, res) => {
    const admin = gate(req, res);
    if (!admin) return;
    const r = admins.add((req.body || {}).email, admin);
    if (r.error) return res.status(r.status).json({ error: r.error });
    security.audit(req, 'admin.admin_added', { email: admin, outcome: 'ok', detail: r.email });
    res.json({ ok: true, email: r.email, rows: admins.list() });
  });

  app.delete('/marketplace/admin/admins/:email', (req, res) => {
    const admin = gate(req, res);
    if (!admin) return;
    const r = admins.remove(req.params.email);
    if (r.error) return res.status(r.status).json({ error: r.error });
    security.audit(req, 'admin.admin_removed', { email: admin, outcome: 'ok', detail: r.email });
    res.json({ ok: true, email: r.email, rows: admins.list() });
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
    if (view === 'audit') {
      const rows = auditRows({ ...req.query, from, to }, 100000)
        .map((a) => [a.at, a.event, a.email, a.ip, a.outcome, a.detail, a.user_agent]);
      return send(`marketplace-audit-${from}_${to}.csv`,
        ['At', 'Event', 'Email', 'IP', 'Outcome', 'Detail', 'User agent'], rows);
    }
    if (view === 'usage') {
      const rows = readUsage().filter((u) => inRange(u.at, from, to))
        .map((u) => [u.at, u.email, u.mindAccount, u.product, u.method, u.endpoint, u.status, u.ms,
          u.billable ? 'Yes' : 'No', String(u.priceCents || 0), u.ip, u.userAgent]);
      // Price in cents as stored (an Advanced event is 2.5); invoices round
      // each class's monthly total to the cent.
      return send(`marketplace-usage-${from}_${to}.csv`,
        ['At', 'Email', 'MIND account', 'Product', 'Method', 'Endpoint', 'Status', 'Ms', 'Billable', 'Price (CAD cents)', 'IP', 'User agent'], rows);
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
