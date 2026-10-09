'use strict';

/**
 * Monthly API Marketplace invoices.
 *
 *   1st of the month  an invoice for last month's billable usage (calls per
 *                     API x price, plus Canadian sales tax from
 *                     lib/catalogs/tax.js) is issued and emailed.
 *   5th of the month  the invoice total is charged to the card on file
 *                     (lib/billing.js chargeInvoices).
 *
 * Both steps run from the scheduler in server.js and are safe to repeat:
 * one invoice per partner per month, and an invoice is emailed once.
 * Staff can also run them, and preview any month, from the dashboard.
 *
 * The emailed "View invoice" link carries a random per-invoice key, so the
 * partner can open the printable invoice without logging in.
 */

const crypto = require('crypto');
const db = require('./db');
const { taxesFor } = require('./catalogs/tax');
const { lookupAuthorization, sendMail } = require('./onboarding');
const { render } = require('./email-template');
const { sessionEmail, isAdmin } = require('./session');

const GATEWAY_URL = process.env.PUBLIC_GATEWAY_URL || 'https://api-marketplace-1im9.onrender.com';
const CHARGE_DAY = 5;
const money = (cents) => '$' + (cents / 100).toFixed(2);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const month = (d = new Date()) => d.toISOString().slice(0, 7);
const prevMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
// The 5th of the month after `mon`.
const dueOn = (mon) => {
  const [y, m] = mon.split('-').map(Number);
  return new Date(Date.UTC(y, m, CHARGE_DAY)).toISOString().slice(0, 10);
};
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const sameKey = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const monthLabel = (mon) => new Date(mon + '-01T00:00:00Z').toLocaleString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

let productName = (id) => id;

const q = {
  partners: db.prepare(`SELECT email, SUM(price_cents) AS cents FROM usage
      WHERE month=? AND email IS NOT NULL GROUP BY email HAVING SUM(price_cents) > 0 ORDER BY email`),
  lines: db.prepare(`SELECT product, COUNT(*) AS calls, SUM(billable) AS billable_calls, SUM(price_cents) AS cents
      FROM usage WHERE email=? AND month=? GROUP BY product HAVING SUM(price_cents) > 0 ORDER BY product`),
  profile: db.prepare('SELECT mind_account FROM billing_profiles WHERE email=?'),
  get: db.prepare('SELECT * FROM invoices WHERE email=? AND month=?'),
  byNumber: db.prepare('SELECT * FROM invoices WHERE number=?'),
  insert: db.prepare(`INSERT INTO invoices (number, email, mind_account, month, bill_to, lines, subtotal_cents,
      taxes, total_cents, tax_review, issued_at, due_on, view_key)
    VALUES (@number, @email, @mind_account, @month, @bill_to, @lines, @subtotal_cents,
      @taxes, @total_cents, @tax_review, @issued_at, @due_on, @view_key)`),
  markSent: db.prepare('UPDATE invoices SET sent_at=? WHERE id=?'),
  forMonth: db.prepare('SELECT * FROM invoices WHERE month=? ORDER BY email'),
  mine: db.prepare('SELECT * FROM invoices WHERE email=? ORDER BY month DESC LIMIT 12'),
};

// Work out an invoice from the usage ledger without saving it.
async function draft(email, mon) {
  const lines = q.lines.all(email, mon).map((l) => ({
    product: l.product, name: productName(l.product), calls: l.billable_calls || 0,
    unitCents: l.billable_calls ? l.cents / l.billable_calls : 0, cents: l.cents,
  }));
  const subtotal = lines.reduce((s, l) => s + l.cents, 0);
  if (!subtotal) return null;
  const auth = await lookupAuthorization(email);          // throws if the CRM is down
  const mindAccount = (q.profile.get(email) || {}).mind_account || auth.mindAccount || null;
  const tax = taxesFor(auth.billingRegion, subtotal);
  return {
    email, month: mon, mindAccount,
    billTo: { name: auth.organization || '', email, mindAccount, region: tax.region },
    lines, subtotal, taxes: tax.lines, taxReview: tax.review,
    total: subtotal + tax.lines.reduce((s, t) => s + t.cents, 0),
    dueOn: dueOn(mon),
  };
}

// Issue (save) the invoice for one partner and month, once.
async function issue(email, mon) {
  const existing = q.get.get(email, mon);
  if (existing) return existing;
  const d = await draft(email, mon);
  if (!d) return null;
  let number = `MKT-${d.mindAccount || 'NA'}-${mon.replace('-', '')}`;
  for (let n = 2; q.byNumber.get(number); n++) number = `MKT-${d.mindAccount || 'NA'}-${mon.replace('-', '')}-${n}`;
  q.insert.run({
    number, email, mind_account: d.mindAccount, month: mon, bill_to: JSON.stringify(d.billTo),
    lines: JSON.stringify(d.lines), subtotal_cents: d.subtotal, taxes: JSON.stringify(d.taxes),
    total_cents: d.total, tax_review: d.taxReview ? 1 : 0, issued_at: new Date().toISOString(),
    due_on: d.dueOn, view_key: crypto.randomBytes(18).toString('base64url'),
  });
  return q.get.get(email, mon);
}

const parse = (row) => row && {
  ...row,
  billTo: JSON.parse(row.bill_to || '{}'), lines: JSON.parse(row.lines || '[]'), taxes: JSON.parse(row.taxes || '[]'),
};
const viewUrl = (row) => `${GATEWAY_URL}/marketplace/invoices/${encodeURIComponent(row.number)}?k=${row.view_key}`;

async function send(row) {
  const inv = parse(row);
  const title = `Your API Marketplace invoice for ${monthLabel(inv.month)}`;
  const cell = 'padding:6px 8px;border-bottom:1px solid #eeeeee;font-size:13px;';
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px;">`
    + `<tr><th align="left" style="${cell}">API</th><th align="right" style="${cell}">Calls</th><th align="right" style="${cell}">Amount</th></tr>`
    + inv.lines.map((l) => `<tr><td style="${cell}">${esc(l.name)}</td><td align="right" style="${cell}">${l.calls}</td><td align="right" style="${cell}">${money(l.cents)}</td></tr>`).join('')
    + `<tr><td style="${cell}">Subtotal</td><td></td><td align="right" style="${cell}">${money(inv.subtotal_cents)}</td></tr>`
    + inv.taxes.map((t) => `<tr><td style="${cell}">${esc(t.label)} (${t.rate}%)</td><td></td><td align="right" style="${cell}">${money(t.cents)}</td></tr>`).join('')
    + `<tr><td style="${cell}"><strong>Total (CAD)</strong></td><td></td><td align="right" style="${cell}"><strong>${money(inv.total_cents)}</strong></td></tr></table>`;
  const paragraphs = [
    `Here is your invoice <strong>${esc(inv.number)}</strong> for your API Marketplace usage in ${monthLabel(inv.month)}.`,
    `We'll charge <strong>${money(inv.total_cents)} CAD</strong> to your card on file on <strong>${inv.due_on}</strong>. If anything looks wrong, reply to this email before then.`,
  ];
  const text = `Invoice ${inv.number} for ${monthLabel(inv.month)}: ${money(inv.total_cents)} CAD, charged to your card on file on ${inv.due_on}. View it: ${viewUrl(row)}`;
  await sendMail(inv.email, title, text,
    render({ title, paragraphs, html: table, ctaLabel: 'View invoice', ctaUrl: viewUrl(row) }));
  q.markSent.run(new Date().toISOString(), row.id);
}

// Issue and email every invoice for a finished month. Safe to repeat.
async function runInvoices(mon) {
  const results = [];
  for (const p of q.partners.all(mon)) {
    try {
      const row = await issue(p.email, mon);
      if (!row) continue;
      if (!row.sent_at) { await send(row); results.push({ email: p.email, number: row.number, cents: row.total_cents, status: 'sent' }); }
      else results.push({ email: p.email, number: row.number, cents: row.total_cents, status: 'already_sent' });
    } catch (err) {
      console.warn(`[invoices] ${p.email} ${mon}: ${err.message}`);
      results.push({ email: p.email, status: 'error', error: err.message });
    }
  }
  return results;
}

// ---- printable invoice ------------------------------------------------------
function invoiceHtml(inv, { draft: isDraft = false } = {}) {
  const gst = process.env.IRISTEL_GST_NUMBER;
  const row = (a, b, c, strong) => `<tr${strong ? ' class="total"' : ''}><td>${a}</td><td class="num">${b}</td><td class="num">${c}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(inv.number)}</title>
<style>
  :root{--ink:#14202b;--muted:#5d6b78;--line:#dfe4ea;--accent:#D1155A}
  body{margin:0;background:#f4f5f7;color:var(--ink);font:14px/1.5 Arial,Helvetica,sans-serif}
  .page{max-width:760px;margin:24px auto;background:#fff;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:20px}
  header img{width:150px}
  h1{margin:0;font-size:24px;letter-spacing:.02em}
  .meta{text-align:right;color:var(--muted)} .meta b{color:var(--ink)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:24px 0}
  .cols h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 6px}
  table{width:100%;border-collapse:collapse} th,td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:left}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)} .num{text-align:right;font-variant-numeric:tabular-nums}
  tr.total td{font-weight:700;border-top:2px solid var(--ink);border-bottom:0;font-size:15px}
  .note{margin-top:24px;color:var(--muted);font-size:12.5px}
  .draft{background:#fff4d6;border:1px solid #f0d58a;padding:8px 12px;margin-bottom:16px}
  .print{margin:0 auto 24px;display:block;padding:10px 18px;border:0;background:var(--accent);color:#fff;border-radius:4px;cursor:pointer}
  @media (max-width:600px){.page{padding:20px;margin:0}.cols{grid-template-columns:1fr}header{flex-direction:column}.meta{text-align:left}}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.print{display:none}}
</style></head><body>
<div class="page">
  ${isDraft ? '<div class="draft"><b>Preview</b> — not issued. Usage for an unfinished month can still change.</div>' : ''}
  <header>
    <div><img src="https://cdn.prod.website-files.com/67ae3dc9346b175361116c60/693b2919992dfa59c54be930_Untitled%20design.png" alt="Iristel"><br>
      <span style="color:var(--muted)">675 Cochrane Drive, East Tower, 6th Floor<br>Markham, ON L3R 0B8, Canada${gst ? '<br>GST/HST No. ' + esc(gst) : ''}</span></div>
    <div class="meta"><h1>INVOICE</h1><b>${esc(inv.number)}</b><br>
      Issued ${esc(String(inv.issued_at || new Date().toISOString()).slice(0, 10))}<br>
      Usage period: ${esc(monthLabel(inv.month))}<br>Charged on ${esc(inv.due_on)}</div>
  </header>
  <div class="cols">
    <div><h2>Bill to</h2>${esc(inv.billTo.name || inv.email)}<br>${esc(inv.email)}<br>
      ${inv.billTo.mindAccount ? 'Billing account ' + esc(inv.billTo.mindAccount) : ''}</div>
    <div><h2>Payment</h2>Card on file, charged automatically on ${esc(inv.due_on)}.<br>All amounts in CAD.</div>
  </div>
  <table>
    <tr><th>API</th><th class="num">Billed calls</th><th class="num">Amount</th></tr>
    ${inv.lines.map((l) => row(esc(l.name) + (l.unitCents ? ` <span style="color:var(--muted)">@ ${(l.unitCents).toFixed(l.unitCents % 1 ? 2 : 0)}¢</span>` : ''), l.calls, money(l.cents))).join('')}
    ${row('Subtotal', '', money(inv.subtotal_cents))}
    ${inv.taxes.map((t) => row(`${esc(t.label)} (${t.rate}%)`, '', money(t.cents))).join('')}
    ${row('Total (CAD)', '', money(inv.total_cents), true)}
  </table>
  <p class="note">Only successful (2xx) production calls are billed. Sandbox calls are free. Questions about this invoice: reply to the invoice email or call 1-833-IRISTEL.</p>
</div>
<button class="print" onclick="print()">Print / save as PDF</button>
</body></html>`;
}

function register(app, PRODUCTS) {
  productName = (id) => ((PRODUCTS || []).find((p) => p.id === id) || {}).name || id;

  // Printable invoice: the emailed link's key, the partner's own session, or staff.
  app.get('/marketplace/invoices/:number', (req, res) => {
    const row = q.byNumber.get(req.params.number);
    const who = sessionEmail(req);
    const ok = row && ((req.query.k && sameKey(req.query.k, row.view_key))
      || (who && (who === row.email || isAdmin(who))));
    if (!ok) return res.status(404).send('Invoice not found.');
    res.set('Cache-Control', 'private, no-store').type('html').send(invoiceHtml(parse(row)));
  });

  // Staff: preview any partner's invoice for any month without issuing it.
  app.get('/marketplace/admin/invoices/preview', async (req, res) => {
    const by = sessionEmail(req);
    if (!by || !isAdmin(by)) return res.status(by ? 403 : 401).send('Staff only.');
    const email = String(req.query.email || '').trim().toLowerCase();
    const mon = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : month();
    try {
      const d = await draft(email, mon);
      if (!d) return res.status(404).send('No billable usage for that partner and month.');
      res.type('html').send(invoiceHtml({
        number: 'PREVIEW', email, month: mon, billTo: d.billTo, lines: d.lines, subtotal_cents: d.subtotal,
        taxes: d.taxes, total_cents: d.total, due_on: d.dueOn,
      }, { draft: true }));
    } catch (err) { res.status(502).send(esc(err.message)); }
  });

  // Staff: issue and email the invoices for a finished month now.
  app.post('/marketplace/admin/billing/invoices', async (req, res) => {
    const by = sessionEmail(req);
    if (!by) return res.status(401).json({ error: 'login_required' });
    if (!isAdmin(by)) return res.status(403).json({ error: 'staff_only' });
    const mon = String((req.body || {}).month || '');
    if (!/^\d{4}-\d{2}$/.test(mon)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    if (mon >= month()) return res.status(400).json({ error: 'Invoices go out once the month is over.' });
    const results = await runInvoices(mon);
    require('./security').audit(req, 'admin.invoices_sent', { email: by, outcome: 'ok', detail: `${mon}: ${results.length} invoice(s)` });
    res.json({ month: mon, results });
  });
}

const forPartner = (email) => q.mine.all(email).map((r) => ({
  number: r.number, month: r.month, cents: r.total_cents, dueOn: r.due_on, sent: !!r.sent_at, url: viewUrl(r),
}));

module.exports = {
  register, runInvoices, issue, forMonth: (mon) => q.forMonth.all(mon), get: (email, mon) => q.get.get(email, mon),
  forPartner, prevMonth, dueOn, CHARGE_DAY,
};
