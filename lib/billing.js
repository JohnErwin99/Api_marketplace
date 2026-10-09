'use strict';

/**
 * Usage billing: card on file, the partner's billing summary, and the
 * monthly charge run. Modelled on the OnlineOrdering project, which is the
 * proven way to do this against MIND:
 *
 *   Save a card   PATCH https://api.iristelx.com/billing/{account}/credit-card
 *                 header iristelx-api-key: the MIND key of the account's
 *                 business unit — MIND_API_KEY, or MIND_RESELL_KEY for
 *                 accounts created by a reseller sign-up (lib/portal.js).
 *                 A key can't see accounts outside its unit (404).
 *                 body {CVV, cardType, expMonth "MM", expYear "YYYY", holder, number}
 *                 -> { token }
 *   Charge it     POST  https://api.iristelx.com/bot/{account}/payment
 *                 header x-api-key: PAYMENT_API_KEY
 *                 body {amount "x.xx", currency CAD, remark, creditCard:{code,
 *                 number <masked>, token, expDate{expMonth,expYear}, holder,
 *                 adapterId 3 (Moneris), issuer 'SBI', externalRefId}}
 *
 * Card data rule: the card number and CVV pass through this gateway to MIND
 * once, over TLS, and are never stored or logged. Only the token, masked
 * number, card type, expiry and holder are kept (lib/db.js).
 *
 * Monthly flow (lib/invoices.js): the invoice for last month goes out on the
 * 1st; on the 5th its total, tax included, is charged with the saved token.
 * A month is only charged once its invoice has been emailed.
 *
 * Charge outcomes follow OnlineOrdering: JSON + 2xx = paid; JSON + 4xx =
 * declined (retried by Run charges, and right away when the partner saves a
 * new card); anything else = unknown — the card may have been charged, so
 * only staff retry it, one partner at a time, after checking MIND.
 */

const db = require('./db');
const { sessionEmail, isAdmin, tooMany } = require('./session');
const { lookupAuthorization, sendMail } = require('./onboarding');
const { render, PORTAL_URL } = require('./email-template');
const { SANDBOX_CALLS } = require('./entitlements');
const security = require('./security');
const invoices = require('./invoices');

const IX_BASE = 'https://api.iristelx.com';
const month = (d = new Date()) => d.toISOString().slice(0, 7);
const money = (cents) => '$' + (cents / 100).toFixed(2);

// ---- card helpers ---------------------------------------------------------
const digits = (s) => String(s || '').replace(/\D/g, '');
function luhnOk(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = +num[num.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return num.length >= 12 && sum % 10 === 0;
}
function cardType(num) {
  if (/^4/.test(num)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(num)) return 'mastercard';
  if (/^3[47]/.test(num)) return 'amex';
  if (/^(6011|65|64[4-9])/.test(num)) return 'discover';
  return null;
}
const maskCard = (num) => num.slice(0, 6) + '******' + num.slice(-4);   // as OnlineOrdering sends it

// ---- statements -----------------------------------------------------------
const q = {
  profile: db.prepare('SELECT * FROM billing_profiles WHERE email = ?'),
  upsertCard: db.prepare(`INSERT INTO billing_profiles
      (email, mind_account, token, card_code, masked, exp_month, exp_year, holder, key_name, updated_at)
    VALUES (@email, @mind_account, @token, @card_code, @masked, @exp_month, @exp_year, @holder, @key_name, @updated_at)
    ON CONFLICT(email) DO UPDATE SET mind_account=excluded.mind_account, token=excluded.token,
      card_code=excluded.card_code, masked=excluded.masked, exp_month=excluded.exp_month,
      exp_year=excluded.exp_year, holder=excluded.holder, key_name=excluded.key_name,
      updated_at=excluded.updated_at`),
  clearCard: db.prepare(`UPDATE billing_profiles SET token=NULL, card_code=NULL, masked=NULL,
      exp_month=NULL, exp_year=NULL, holder=NULL, updated_at=? WHERE email=?`),
  setAccount: db.prepare(`INSERT INTO billing_profiles (email, mind_account, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET mind_account=excluded.mind_account, updated_at=excluded.updated_at`),
  setPastDue: db.prepare('UPDATE billing_profiles SET past_due=?, updated_at=? WHERE email=?'),
  usageByProduct: db.prepare(`SELECT product, COUNT(*) AS calls, SUM(billable) AS billable_calls,
      SUM(price_cents) AS cents FROM usage WHERE email=? AND month=? GROUP BY product ORDER BY product`),
  myCharges: db.prepare(`SELECT month, amount_cents, status, reference, created_at FROM charges
      WHERE email=? ORDER BY month DESC LIMIT 12`),
  monthTotals: db.prepare(`SELECT email, MAX(mind_account) AS mind_account, COUNT(*) AS calls,
      SUM(billable) AS billable_calls, SUM(price_cents) AS cents
      FROM usage WHERE month=? AND email IS NOT NULL GROUP BY email ORDER BY cents DESC`),
  charge: db.prepare('SELECT * FROM charges WHERE email=? AND month=?'),
  monthCharges: db.prepare('SELECT * FROM charges WHERE month=?'),
  claim: db.prepare(`INSERT INTO charges (email, mind_account, month, amount_cents, status, reference, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)`),
  finish: db.prepare('UPDATE charges SET status=?, gateway_response=? WHERE email=? AND month=?'),
  drop: db.prepare('DELETE FROM charges WHERE email=? AND month=?'),
  declined: db.prepare(`SELECT * FROM charges WHERE email=? AND status='declined' ORDER BY month`),
  sandboxUsed: db.prepare(`SELECT COUNT(*) AS n FROM usage WHERE email=? AND mode='sandbox'`),
  owing: db.prepare(`SELECT 1 FROM charges WHERE email=? AND status IN ('declined','unknown') LIMIT 1`),
};

// MIND account to bill: a staff-set override wins, else the CRM account's.
async function mindAccountFor(email, auth) {
  const p = q.profile.get(email);
  if (p && p.mind_account) return p.mind_account;
  const a = auth || await lookupAuthorization(email);
  return a.mindAccount || null;
}

// One auth header per call, exactly as OnlineOrdering sends them:
// iristelx-api-key for /billing, x-api-key for /bot/.../payment.
async function ixCall(method, path, { header, key }, body) {
  const r = await fetch(IX_BASE + path, {
    method,
    headers: { [header]: key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: r.status, ok: r.ok, json, text };
}
const mindMessage = (json) => (json && (json.message || (json.errors && json.errors[0] && json.errors[0].message))) || '';
// What MIND answered, for logs and the audit trail. Never includes our
// request body (the card number and CVV are only in the request).
const mindReply = (r) => `HTTP ${r.status} ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 300)}`;

// MIND keys only see accounts in their own business unit, and reseller
// sign-ups create the account with MIND_RESELL_KEY. Try the main key first,
// then the reseller key when the main one can't see the account.
const MIND_KEYS = ['MIND_API_KEY', 'MIND_RESELL_KEY'];
async function mindBilling(method, path, body, keyName) {
  const names = keyName ? [keyName] : MIND_KEYS.filter((n) => process.env[n]);
  if (!names.length) throw Object.assign(new Error('no MIND key'), { code: 'no_key' });
  let r;
  for (const name of names) {
    r = await ixCall(method, path, { header: 'iristelx-api-key', key: process.env[name] }, body);
    r.keyName = name;
    if (![401, 403, 404].includes(r.status)) break;
  }
  return r;
}

// Charge one partner for one month. Returns the final charge row. An
// unknown charge is retried only when staff pass retryUnknown.
async function chargeMonth(email, mon, cents, mindAccount, { retryUnknown = false, reference: ref } = {}) {
  const existing = q.charge.get(email, mon);
  const done = retryUnknown ? ['paid', 'pending'] : ['paid', 'pending', 'unknown'];
  if (existing && done.includes(existing.status)) return existing;
  if (existing) q.drop.run(email, mon);                  // declined / no_card (/ unknown): try again
  const profile = q.profile.get(email);
  const now = new Date().toISOString();
  const reference = ref || `MKT-${mindAccount || 'NA'}-${mon.replace('-', '')}`;
  q.claim.run(email, mindAccount, mon, cents, reference, now);

  if (!mindAccount || !profile || !profile.token) {
    q.finish.run(mindAccount ? 'no_card' : 'no_account', null, email, mon);
    return q.charge.get(email, mon);
  }
  const key = process.env.PAYMENT_API_KEY;
  if (!key) { q.drop.run(email, mon); throw new Error('PAYMENT_API_KEY is not configured'); }

  let r;
  try {
    r = await ixCall('POST', `/bot/${encodeURIComponent(mindAccount)}/payment`, { header: 'x-api-key', key }, {
      amount: (cents / 100).toFixed(2),
      currency: 'CAD',
      remark: `API Marketplace usage ${mon}`,
      creditCard: {
        code: profile.card_code, number: profile.masked, token: profile.token,
        expDate: { expMonth: profile.exp_month, expYear: profile.exp_year },
        holder: profile.holder, adapterId: 3, issuer: 'SBI', externalRefId: reference,
      },
    });
  } catch (err) {
    r = { status: 0, json: null, text: 'network error: ' + err.message };
  }
  const status = r.json && r.status >= 200 && r.status < 300 ? 'paid'
    : r.json && r.status >= 400 && r.status < 500 ? 'declined' : 'unknown';
  q.finish.run(status, String(r.text || '').slice(0, 4000), email, mon);
  // Past due while any month is still declined or unconfirmed.
  q.setPastDue.run(q.owing.get(email) ? 1 : 0, new Date().toISOString(), email);
  if (status !== 'paid') console.warn(`[billing] charge ${reference} ${status}: ${mindReply(r)}`);
  notify(email, mon, cents, status, reference).catch(() => {});
  return q.charge.get(email, mon);
}

// Charge the emailed invoices of a month. newOnly (the scheduler): only
// invoices never charged, so a declined card isn't retried every hour —
// declined months are retried when the partner saves a new card, or by staff.
async function chargeInvoices(mon, { newOnly = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const inv of invoices.forMonth(mon)) {
    if (!inv.sent_at || !inv.total_cents) continue;
    if (newOnly && (inv.due_on > today || q.charge.get(inv.email, mon))) continue;
    try {
      const mindAccount = (q.profile.get(inv.email) || {}).mind_account || inv.mind_account;
      const c = await chargeMonth(inv.email, mon, inv.total_cents, mindAccount, { reference: inv.number });
      results.push({ email: inv.email, number: inv.number, cents: inv.total_cents, status: c.status });
    } catch (err) {
      results.push({ email: inv.email, number: inv.number, cents: inv.total_cents, status: 'error', error: err.message });
    }
  }
  return results;
}

async function notify(email, mon, cents, status, reference) {
  const title = {
    paid: `Your API Marketplace receipt for ${mon}`,
    unknown: `We're confirming your API Marketplace payment for ${mon}`,
  }[status] || `We couldn't process your API Marketplace payment for ${mon}`;
  const paragraphs = {
    paid: [`We charged <strong>${money(cents)} CAD</strong> to your card on file for your API Marketplace usage in ${mon} (invoice ${reference}).`,
      'You can see your usage and past charges in the API console under <strong>Billing &amp; usage</strong>.'],
    unknown: [`Your API Marketplace usage for ${mon} comes to <strong>${money(cents)} CAD</strong>. The billing system didn't confirm whether the payment went through.`,
      'API calls are paused while our team checks it — no action is needed from you, and you won\'t be charged twice. We\'ll be in touch shortly.'],
  }[status] || [`Your API Marketplace usage for ${mon} comes to <strong>${money(cents)} CAD</strong>, but the payment didn't go through.`,
    'API calls are paused until this is resolved. Update your card in the API console under <strong>Billing &amp; usage</strong> — we retry the payment as soon as you save it.'];
  await sendMail(email, title, paragraphs.join('\n').replace(/<[^>]+>/g, ''),
    render({ title, paragraphs, ctaLabel: 'Open the Partner Portal', ctaUrl: PORTAL_URL }));
}

// ---- routes ---------------------------------------------------------------
function register(app) {
  const partner = (req, res) => {
    const email = sessionEmail(req);
    if (!email) { res.status(401).json({ error: 'login_required' }); return null; }
    return email;
  };
  const staff = (req, res) => {
    const email = sessionEmail(req);
    if (!email) { res.status(401).json({ error: 'login_required' }); return null; }
    if (!isAdmin(email)) { res.status(403).json({ error: 'staff_only' }); return null; }
    return email;
  };

  // The partner's own billing page: card, this month's usage, past charges.
  app.get('/marketplace/billing', async (req, res) => {
    const email = partner(req, res); if (!email) return;
    let mindAccount = null, isAgent = false, environment = 'sandbox';
    try {
      const auth = await lookupAuthorization(email);
      isAgent = !!(auth.isAgent || auth.isInternal);
      environment = auth.environment || 'sandbox';
      mindAccount = await mindAccountFor(email, auth);
    } catch { /* CRM down: show what we have */ }
    const p = q.profile.get(email) || {};
    // Same rule as lib/entitlements.js: the card on file is the switch.
    const exempt = isAgent || isAdmin(email);
    const sandboxCallsUsed = q.sandboxUsed.get(email).n;
    const mode = exempt ? 'exempt' : p.past_due ? 'past_due' : p.token ? 'production'
      : environment === 'production' ? 'card_required' : 'sandbox';
    const mon = month();
    const usage = q.usageByProduct.all(email, mon).map((u) => ({
      product: u.product, calls: u.calls, billableCalls: u.billable_calls || 0, cents: u.cents || 0,
    }));
    res.json({
      email, mindAccount, month: mon, isAgent, mode, environment,
      sandboxCallsUsed, sandboxCallsLimit: SANDBOX_CALLS,
      card: p.token ? { masked: p.masked, type: p.card_code, expMonth: p.exp_month, expYear: p.exp_year, holder: p.holder } : null,
      pastDue: !!p.past_due,
      usage, estimatedCents: usage.reduce((s, u) => s + u.cents, 0),
      charges: q.myCharges.all(email).map((c) => ({ month: c.month, cents: c.amount_cents, status: c.status, reference: c.reference })),
      invoices: invoices.forPartner(email),
    });
  });

  // Save or replace the card on file. The card number and CVV are sent to
  // MIND and then dropped — never stored, never logged.
  app.put('/marketplace/billing/card', async (req, res) => {
    const email = partner(req, res); if (!email) return;
    if (tooMany('card:' + email, 5) || tooMany('card-ip:' + security.clientIp(req), 10))
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const b = req.body || {};
    const number = digits(b.number);
    const cvv = digits(b.cvv);
    const expMonth = String(b.expMonth || '').padStart(2, '0');
    const expYear = String(b.expYear || '').length === 2 ? '20' + b.expYear : String(b.expYear || '');
    const holder = String(b.holder || '').trim().slice(0, 80);
    const type = cardType(number);
    const now = new Date();
    const expired = +expYear < now.getUTCFullYear() || (+expYear === now.getUTCFullYear() && +expMonth < now.getUTCMonth() + 1);
    if (!holder) return res.status(400).json({ error: 'Enter the name on the card.' });
    if (!luhnOk(number) || !type) return res.status(400).json({ error: 'That card number isn\'t valid.' });
    if (!/^(0[1-9]|1[0-2])$/.test(expMonth) || !/^\d{4}$/.test(expYear) || expired)
      return res.status(400).json({ error: 'Check the expiry date.' });
    if (!/^\d{3,4}$/.test(cvv)) return res.status(400).json({ error: 'Check the security code (CVV).' });

    if (!MIND_KEYS.some((n) => process.env[n])) return res.status(503).json({ error: 'Billing is not configured on this gateway.' });
    let mindAccount;
    try {
      const auth = await lookupAuthorization(email);
      if (auth.isAgent || auth.isInternal) return res.status(403).json({ error: 'Agent and internal accounts aren\'t billed for API usage, so no card is needed.' });
      mindAccount = await mindAccountFor(email, auth);
    } catch { return res.status(503).json({ error: 'Account lookup is unavailable, try again shortly.' }); }
    if (!mindAccount)
      return res.status(409).json({ error: 'Your billing account isn\'t set up yet. Contact Iristel support and we\'ll link it.' });

    let r;
    try {
      r = await mindBilling('PATCH', `/billing/${encodeURIComponent(mindAccount)}/credit-card`,
        { CVV: cvv, cardType: type, expMonth, expYear, holder, number });
    } catch (err) {
      console.warn('[billing] save card: MIND unreachable');
      return res.status(502).json({ error: 'The billing system didn\'t respond. Try again shortly.' });
    }
    const token = r.json && (r.json.token || (r.json.data && r.json.data.token));
    if (!r.ok || !token) {
      console.warn(`[billing] save card for ${mindAccount} (${r.keyName}): ${mindReply(r)}`);
      security.audit(req, 'billing.card_saved', { email, outcome: 'declined', detail: `MIND ${mindAccount} (${r.keyName}): ${mindReply(r)}` });
      return res.status(402).json({ error: 'The card was not accepted. Check the details or try another card.' });
    }
    q.upsertCard.run({
      email, mind_account: mindAccount, token, card_code: type.toUpperCase(), masked: maskCard(number),
      exp_month: expMonth, exp_year: expYear, holder, key_name: r.keyName, updated_at: now.toISOString(),
    });
    // A new card settles what's owed: retry every declined month now. The
    // partner is unblocked only if nothing is left declined or unconfirmed.
    const retried = [];
    for (const c of q.declined.all(email)) {
      try {
        const r = await chargeMonth(email, c.month, c.amount_cents, mindAccount, { reference: c.reference });
        retried.push({ month: c.month, cents: c.amount_cents, status: r.status });
      } catch (err) {
        retried.push({ month: c.month, cents: c.amount_cents, status: 'error' });
      }
    }
    const owing = !!q.owing.get(email);
    if (!owing) q.setPastDue.run(0, now.toISOString(), email);
    security.audit(req, 'billing.card_saved', { email, outcome: 'ok', detail: `${type.toUpperCase()} ${maskCard(number)} on MIND ${mindAccount}` });
    res.json({ ok: true, card: { masked: maskCard(number), type: type.toUpperCase(), expMonth, expYear, holder },
      retried, pastDue: !!owing });
  });

  app.delete('/marketplace/billing/card', async (req, res) => {
    const email = partner(req, res); if (!email) return;
    const p = q.profile.get(email);
    if (!p || !p.token) return res.json({ ok: true });
    if (p.mind_account) {
      try {
        const r = await mindBilling('DELETE', `/billing/${encodeURIComponent(p.mind_account)}/credit-card`, null, p.key_name || null);
        if (!r.ok) console.warn(`[billing] remove card for ${p.mind_account}: ${mindReply(r)}`);
      } catch { console.warn('[billing] remove card: MIND unreachable'); }
    }
    q.clearCard.run(new Date().toISOString(), email);
    security.audit(req, 'billing.card_removed', { email, outcome: 'ok' });
    res.json({ ok: true });
  });

  // ---- staff ----------------------------------------------------------------
  // One month: every partner's usage total, card status and charge status.
  app.get('/marketplace/admin/billing', (req, res) => {
    if (!staff(req, res)) return;
    const mon = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : month();
    const charges = Object.fromEntries(q.monthCharges.all(mon).map((c) => [c.email, c]));
    const rows = q.monthTotals.all(mon).map((u) => {
      const p = q.profile.get(u.email) || {};
      const c = charges[u.email];
      const inv = invoices.get(u.email, mon);
      return {
        email: u.email, mindAccount: p.mind_account || u.mind_account || null,
        calls: u.calls, billableCalls: u.billable_calls || 0, cents: u.cents || 0,
        card: p.token ? p.masked : null, pastDue: !!p.past_due,
        charge: c ? { status: c.status, cents: c.amount_cents, reference: c.reference, at: c.created_at } : null,
        invoice: inv ? { number: inv.number, cents: inv.total_cents, sent: !!inv.sent_at, taxReview: !!inv.tax_review, dueOn: inv.due_on } : null,
      };
    });
    res.json({ month: mon, rows, totalCents: rows.reduce((s, r) => s + r.cents, 0) });
  });

  // Charge every emailed invoice of the month (total incl. tax). Safe to run
  // again: paid and unknown charges are never repeated; declined ones retry.
  app.post('/marketplace/admin/billing/run', async (req, res) => {
    const by = staff(req, res); if (!by) return;
    const mon = String((req.body || {}).month || '');
    if (!/^\d{4}-\d{2}$/.test(mon)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    if (mon > month()) return res.status(400).json({ error: 'That month hasn\'t started yet.' });
    const results = await chargeInvoices(mon);
    // Usage with no emailed invoice yet isn't charged — send invoices first.
    for (const u of q.monthTotals.all(mon)) {
      const inv = invoices.get(u.email, mon);
      if (u.cents && (!inv || !inv.sent_at)) results.push({ email: u.email, cents: u.cents, status: 'no_invoice' });
    }
    security.audit(req, 'admin.charges_run', { email: by, outcome: 'ok', detail: `${mon}: ${results.length} charge(s)` });
    res.json({ month: mon, results });
  });

  // Retry one partner's charge, including an unknown one. Staff check MIND
  // first that the earlier attempt really didn't go through.
  app.post('/marketplace/admin/billing/retry', async (req, res) => {
    const by = staff(req, res); if (!by) return;
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const mon = String((req.body || {}).month || '');
    const c = q.charge.get(email, mon);
    if (!c) return res.status(404).json({ error: 'No charge for that partner and month.' });
    if (c.status === 'paid') return res.status(409).json({ error: 'Already paid.' });
    try {
      const mindAccount = (q.profile.get(email) || {}).mind_account || c.mind_account;
      const r = await chargeMonth(email, mon, c.amount_cents, mindAccount, { retryUnknown: true, reference: c.reference });
      security.audit(req, 'admin.charge_retried', { email: by, outcome: r.status, detail: `${email} ${mon}` });
      res.json({ email, month: mon, cents: r.amount_cents, status: r.status });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Staff confirmed in MIND that an unknown charge did go through.
  app.post('/marketplace/admin/billing/mark-paid', (req, res) => {
    const by = staff(req, res); if (!by) return;
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const mon = String((req.body || {}).month || '');
    const c = q.charge.get(email, mon);
    if (!c || c.status !== 'unknown') return res.status(409).json({ error: 'Only an unknown charge can be marked paid.' });
    q.finish.run('paid', (c.gateway_response || '') + '\n[marked paid by staff]', email, mon);
    if (!q.owing.get(email)) q.setPastDue.run(0, new Date().toISOString(), email);
    security.audit(req, 'admin.charge_marked_paid', { email: by, outcome: 'ok', detail: `${email} ${mon}` });
    res.json({ ok: true });
  });

  // Staff can set the MIND account a partner is billed to.
  app.post('/marketplace/admin/billing/account', (req, res) => {
    const by = staff(req, res); if (!by) return;
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const mindAccount = String((req.body || {}).mindAccount || '').trim();
    if (!email || !/^[A-Za-z0-9-]{1,40}$/.test(mindAccount))
      return res.status(400).json({ error: 'email and a valid MIND account number are required' });
    q.setAccount.run(email, mindAccount, new Date().toISOString());
    security.audit(req, 'admin.billing_account_set', { email: by, outcome: 'ok', detail: `${email} -> MIND ${mindAccount}` });
    res.json({ ok: true });
  });
}

module.exports = { register, chargeInvoices, luhnOk, cardType, maskCard };
