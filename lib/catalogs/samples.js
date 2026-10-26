'use strict';

/**
 * Sandbox sample responses.
 *
 * The developer sandbox is "non-production only… no actual telecom
 * fulfillment" (pricing proposal). Enterprise LNP keeps using Espresso's
 * test system; every other product has no test system, so a sandbox call to
 * it is answered by the gateway (lib/entitlements.js) with
 *
 *   sampleFor(product, endpointKey, { params, query, body })
 *     -> { status, body } | null
 *
 * and never reaches a live system. endpointKey is the catalog key
 * ("GET /accounts/:accountId"); params are the decoded path parameters by
 * name. body null means "no content". A body that isn't JSON (the
 * welcome-letter PDF) also carries contentType, to be sent as is.
 *
 * STAFF_ONLY lists the operations ("product METHOD /path") partners may not
 * call, which the sandbox refuses with 403 like the live gateway.
 *
 * Shapes. IristelX products (provisioning, e911, iristelx-*) are proxied as
 * they are (lib/routes/ix.js), so their samples follow the upstream API: the
 * saved Postman examples where there are some (uBoss, 911), the
 * iristel-x.readme.io examples (accounts, services, plans, SIMs), the Iris
 * KB (commissions). DID Orders, LRN, WLNP and BroadWorks follow what their
 * routers in lib/routes/ send (Espresso's order schema, the OCI tables as the
 * BroadWorks router shapes them, …). Marked "best guess" where no example of
 * the real answer was found.
 *
 * Everything is fictional and deterministic (nothing random): numbers in
 * 555-0100…0199, example.com / example.net, "Sample …" names, 123 Sample St,
 * sample ICCIDs / IMEIs, UUIDs 00000000-0000-4000-8000-0000000000NN, dates in
 * the current month. Variety comes from the request (ids, body, paging).
 */

// ---- helpers -------------------------------------------------------------------

const pad = (n, w) => String(n).padStart(w, '0');
const one = (v) => (Array.isArray(v) ? v[0] : v);
const text = (v) => (v == null ? '' : String(one(v)).trim());
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
const bodyOf = (ctx) => (isObj(ctx.body) ? ctx.body : {});
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const intIn = (v, min, max, dflt) => {
  const n = Number.parseInt(one(v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
// FNV-1a: stable variety from request values.
function hash(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const ok = (body, status = 200) => ({ status, body });
const bad = (message) => ({ status: 400, body: { error: 'validation_error', message } });
const page = (list, offset, limit) => list.slice(offset, offset + limit);

// Dates: today (capped at the 28th) and days around it, in the current month.
// A time later today is scaled into the part of today already gone, so
// nothing that has happened is dated in the future (due dates may be).
const today = () => Math.min(28, new Date().getUTCDate());
const ago = (k) => Math.max(1, today() - k);
const ahead = (k) => Math.min(28, today() + k);
function at(day, hour = 10, min = 0, monthOffset = 0) {
  const d = new Date();
  const now = d.getTime();
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, day, hour, min);
  if (t > now && t < start + 86400000) t = start + Math.floor(((hour * 60 + min) / 1440) * (now - start) / 1000) * 1000;
  return new Date(t).toISOString();
}
const ymd = (day, monthOffset = 0) => at(day, 12, 0, monthOffset).slice(0, 10);
const plusMin = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();
// A follow-on event (updated, completed…): min after iso, but never after now.
const later = (iso, min) => new Date(Math.min(Date.parse(iso) + min * 60000, Math.floor(Date.now() / 1000) * 1000)).toISOString();
const nowIso = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);
// uBoss writes microseconds and +00:00.
const uTime = (iso) => (iso ? iso.replace(/\.(\d{3})Z$/, '.$1000+00:00') : null);

// Phone numbers: always 555-0100…0199.
const tn = (n, npa = '613') => `${npa}55501${pad(((n % 100) + 100) % 100, 2)}`;
const dashed = (n, npa) => `+1-${tn(n, npa)}`;                       // uBoss / BroadWorks: +1-6135550142
const wl = (n, npa) => tn(n, npa).replace(/^(\d{3})(\d{3})/, '$1-$2-');  // WLNP: 613-555-0142

const uuid = (n) => `00000000-0000-4000-8000-${pad(n, 12)}`;
const hex = (n, w) => pad((n >>> 0).toString(16), w);

// Luhn check digit, so sample ICCIDs and IMEIs look valid.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return digits + ((10 - (sum % 10)) % 10);
}
const iccid = (n) => luhn(`891230000000000${pad(n, 4)}`);   // 20 digits
const imsi = (n) => `302990000000${pad(n, 3)}`;             // MCC 302, MNC 99
const imei = (n) => luhn(`35000000000${pad(n, 3)}`);        // 15 digits

// ---- shared fixtures ------------------------------------------------------------

const PEOPLE = [['Alex', 'Sample'], ['Jordan', 'Example'], ['Sam', 'Placeholder'], ['Taylor', 'Demo'], ['Morgan', 'Test']];
const BUSINESSES = ['Sample Dental Inc.', 'Example Bakery Ltd.', 'Placeholder Plumbing Co.', 'Demo Design Studio', 'Test Kitchen Corp.'];
const CITIES = [
  { city: 'Ottawa', province: 'ON', npa: '613', postal: 'K1A 1A1' },
  { city: 'Toronto', province: 'ON', npa: '416', postal: 'M5V 1A1' },
  { city: 'Montreal', province: 'QC', npa: '514', postal: 'H2X 1A1' },
  { city: 'Vancouver', province: 'BC', npa: '604', postal: 'V6B 1A1' },
  { city: 'Calgary', province: 'AB', npa: '403', postal: 'T2P 1A1' },
];
const STREET = '123 Sample St';
const emailOf = (i) => `${PEOPLE[i][0]}.${PEOPLE[i][1]}@example.com`.toLowerCase();
const fullName = (i) => `${PEOPLE[i][0]} ${PEOPLE[i][1]}`;
// Stands in for credentials the real API returns (uBoss SIP password).
const SAMPLE_PASSWORD = 'sandbox-sample-not-a-real-password';

// ---- IristelX: accounts, services, plans, SIMs ------------------------------------

const ACCOUNT_IDS = ['9000101', '9000102', '9000103', '9000104', '9000105'];
const SERVICE_IDS = ['9100101', '9100102', '9100103', '9100104', '9100105'];
const ACCOUNT_STATUS = ['ACTIVE', 'ACTIVE', 'NEW', 'ACTIVE', 'CLOSED'];
const indexOf = (list, id) => { const i = list.indexOf(String(id)); return i >= 0 ? i : hash(id) % list.length; };
const noAgent = () => ({ agentId: null, commissionCode: null });

const PLANS = [
  { planCode: 'ICENP_SAMPLE49', planType: 'Mobile Voice SMS Data', planName: 'Sample Talk, Text & 10 GB', billingType: 'prepaid', recurringCharge: 49 },
  { planCode: 'ICENP_SAMPLE99', planType: 'Mobile Voice SMS Data', planName: 'Sample Unlimited 50 GB', billingType: 'postpaid', recurringCharge: 99 },
  { planCode: 'ICENP_SAMPLEDATA', planType: 'Data', planName: 'Sample Data Only 15 GB', billingType: 'postpaid', recurringCharge: 40 },
];
const planFor = (code) => PLANS.find((p) => p.planCode === code) || PLANS[hash(code) % PLANS.length];
const planBrief = (p) => ({ planCode: p.planCode, planType: p.planType, recurringCharge: p.recurringCharge, billingCycle: 'Monthly', billingType: p.billingType });
// GET /plans rows.
const planRow = (p) => ({
  planCode: p.planCode, planType: p.planType, planName: p.planName, flatRateTariff: `${p.planCode}_FR`,
  billingType: p.billingType, billable: true, billingTypeLabel: p.billingType.toUpperCase(), billingCycle: 'Monthly',
  recurringCharge: p.recurringCharge, allotment: null, features: null, active: true,
});
// GET /plans/:planCode.
const planFull = (p, code = p.planCode) => ({
  planCode: code, planType: p.planType, planName: p.planName, active: true, flatRateTariff: `${code}_FR`,
  billingType: p.billingType, billable: true, billingTypeLabel: p.billingType.toUpperCase(), billingCycle: 'Monthly',
  recurringCharge: p.recurringCharge, broadsoft: null, ipswitch: null, huawei: null, nextologies: null,
  allotment: null, features: null, updatedOn: at(ago(20)), netnumber: null,
});

const contactFull = (i) => ({
  fname: PEOPLE[i][0], lname: PEOPLE[i][1], address1: STREET, address2: `Suite ${101 + i}`, address3: '',
  city: CITIES[i].city, province: CITIES[i].province, postalCode: CITIES[i].postal, country: 'CA',
  emailAddress: emailOf(i), phone: { home: '', business: '1' + tn(10 + i, CITIES[i].npa), mobile: '' },
});
const contactShort = (i) => ({ fname: PEOPLE[i][0], lname: PEOPLE[i][1], city: CITIES[i].city, province: CITIES[i].province, emailAddress: emailOf(i) });

// A service's SIM, IMEI and number: services 0-1 have SIMs 101-102, services
// 3-4 eSIMs 201-202; service 2 is still NEW and has none yet.
const simOfService = (i) => (i < 2 ? 101 + i : i > 2 ? 198 + i : null);
function line(i) {
  const n = simOfService(i);
  return {
    sim: n ? iccid(n) : null, imsi: n ? imsi(n) : null,
    imei: n ? imei(101 + i) : null, telephoneNumber: n ? '1' + tn(20 + i, CITIES[i].npa) : null,
  };
}

// Service rows of GET /accounts/:id/services and GET /accounts/services.
function serviceRow(i, accountId = ACCOUNT_IDS[i], serviceId = SERVICE_IDS[i]) {
  const p = PLANS[i % PLANS.length];
  const l = line(i);
  return {
    name: fullName(i), serviceId, accountId, createdOn: at(ago(9 - i), 15), updatedOn: at(ago(2), 9),
    contact: contactShort(i), agent: noAgent(),
    provisioning: {
      planCode: p.planCode, SIM: l.sim, sim: l.sim, telephoneNumber: l.telephoneNumber,
      IMSI: l.imsi, imsi: l.imsi, IMEI: l.imei, imei: l.imei, plan: planBrief(p),
    },
    legacy: false, sim: l.sim, imei: l.imei, telephoneNumber: l.telephoneNumber, planCode: p.planCode,
    status: i === 2 ? 'NEW' : 'ACTIVE', provider: 'ICENP',
    billing: { billParentAccount: true, billingType: p.billingType },
  };
}

// Services as GET /accounts lists them inside each account.
function accountService(i, accountId = ACCOUNT_IDS[i]) {
  const p = PLANS[i % PLANS.length];
  const l = line(i);
  return {
    sim: l.sim, city: CITIES[i].city, code: SERVICE_IDS[i], imei: l.imei, imsi: l.imsi, name: fullName(i),
    email: emailOf(i), legacy: false, status: i === 2 ? 'NEW' : 'ACTIVE', billable: true, lastName: PEOPLE[i][1],
    planCode: p.planCode, province: CITIES[i].province, firstName: PEOPLE[i][0], serviceId: SERVICE_IDS[i],
    billingType: p.billingType, telephoneNumber: l.telephoneNumber, accountId, provider: 'ICENP',
    contact: contactShort(i), agent: noAgent(),
    provisioning: { sim: l.sim, imei: l.imei, telephoneNumber: l.telephoneNumber, planCode: p.planCode, imsi: l.imsi, plan: planBrief(p) },
    billing: { billParentAccount: true, billingType: p.billingType },
  };
}

// GET /accounts rows.
const accountRow = (i, accountId = ACCOUNT_IDS[i]) => ({
  accountId, createdOn: at(ago(10 - i), 14), updatedOn: at(ago(3), 9), name: BUSINESSES[i],
  contact: contactFull(i), agent: noAgent(), language: 'EN', status: ACCOUNT_STATUS[i], provider: 'ICENP',
  services: [accountService(i, accountId)],
});

const memberSince = (i) => ymd(ago(10 - i)).replace(/-/g, '');
const autoPayment = () => {
  const off = () => ({ enabled: false, trigger: null, amount: null });
  return {
    enabled: false, paymentType: null, onDeclineSuspend: false,
    creditCard: { cardType: '', last4digits: '', holder: '', expMonth: '', expYear: '' },
    onDaysAvailable: off(), onDayOfMonth: off(), onBalanceBelow: off(),
  };
};
const udf = () => ({ iristelx: 'true', flatRateThrottlingUDF: '', throttleOverrideProfile: '' });

// GET /accounts/:accountId (the real answer carries no accountId of its own).
const accountDetail = (i, accountId) => ({
  status: ACCOUNT_STATUS[i], memberSince: memberSince(i), contact: contactFull(i), name: BUSINESSES[i], provider: 'ICENP',
  agent: noAgent(), creditLimit: { limitedCreditType: null }, debit: { expirationDate: null, paidUntilDate: null },
  automaticPayment: autoPayment(), language: 'EN', services: [accountService(i, accountId)], sipTrunks: [],
});

// GET /accounts/:accountId/services/:serviceId (no ids in the real answer either).
function serviceDetail(i) {
  const p = PLANS[i % PLANS.length];
  const l = line(i);
  return {
    status: i === 2 ? 'NEW' : 'ACTIVE', memberSince: memberSince(i), contact: contactFull(i), name: fullName(i), provider: 'ICENP',
    agent: noAgent(),
    billing: { billParentAccount: true, recurringCharge: p.recurringCharge, expirationDate: null, paidUntilDate: null, billingType: p.billingType },
    creditLimit: { limitedCreditType: null }, debit: { expirationDate: null, paidUntilDate: null },
    provisioning: {
      planCode: p.planCode, sharingEnabled: false, SIM: l.sim, sim: l.sim, telephoneNumber: l.telephoneNumber,
      IMSI: l.imsi, imsi: l.imsi, IMEI: l.imei, imei: l.imei, plan: planBrief(p),
    },
    udf: udf(), automaticPayment: autoPayment(), contract: { startDate: ymd(ago(9 - i)), length: 24 },
    legacy: false, porting: [], callForwarding: {}, voicemail: { voicemailToEmail: { enabled: true }, autoLogin: {} },
  };
}

// Account and service journals (best guess beyond operation, previousValue,
// newValue and creationDate, which iristelwireless reads).
function journal(seed, q) {
  const rows = [
    { category: 'ACCOUNT', subCategory: 'CREATE', operation: 'Create', field: null, previousValue: null, newValue: null, description: 'Created through the API.', creationDate: at(ago(9), 14) },
    { category: 'ACCOUNT', subCategory: 'STATUS', operation: 'Update', field: 'status', previousValue: 'NEW', newValue: 'ACTIVE', description: 'Status changed.', creationDate: at(ago(8), 9) },
    {
      category: 'PACKAGE', subCategory: 'PLAN', operation: 'Update', field: 'planCode',
      previousValue: PLANS[0].planCode, newValue: PLANS[1].planCode, description: 'Plan changed.', creationDate: at(ago(2), 11),
    },
  ].map((r, k) => ({ journalId: String(800000 + (hash(seed) % 1000) * 10 + k), ...r, user: 'api@example.com' }));
  const cat = text(q.category).toUpperCase();
  const sub = text(q.subCategory).toUpperCase();
  return rows.filter((r) => (!cat || r.category === cat) && (!sub || r.subCategory === sub));
}

const USAGE_TYPES = {
  GPRS: ['Home data', 'MB', 'MB'], RGPRS: ['Roaming data', 'MB', 'MB'],
  MOBILEINC: ['Incoming calls', 'MIN'], MOBILEOUT: ['Outgoing calls', 'MIN'], RMOBILEINC: ['Roaming incoming calls', 'MIN'], RMOBILEOUT: ['Roaming outgoing calls', 'MIN'],
  SMSINC: ['Text messages received', 'SMS'], SMSOUT: ['Text messages sent', 'SMS'], RSMSINC: ['Roaming texts received', 'SMS'], RSMSOUT: ['Roaming texts sent', 'SMS'],
};
// GET …/usage: totals plus one row per day (data[].usage.actual / .billable).
function usage(type) {
  const t = has(USAGE_TYPES, text(type).toUpperCase()) ? text(type).toUpperCase() : 'GPRS';
  const [desc, units] = USAGE_TYPES[t];
  const per = units === 'MB' ? [512, 1310, 248] : units === 'MIN' ? [14, 32, 7] : [21, 9, 15];
  const data = per.map((n, k) => ({ startDate: at(ago(3 - k), 0), callTypeDescription: desc, units, usage: { actual: n, billable: 0 } }));
  const total = per.reduce((a, b) => a + b, 0);
  return { totalCharges: 0, actualUsage: total, billableUsage: 0, allottedUsage: units === 'MB' ? '10240' : 'UNLIMITED', units, data };
}

// SIM inventory 101-105 (101-102 on services) and eSIMs 201-203 (201-202 on services).
function simCard(n, over = {}) {
  const k = SERVICE_IDS.findIndex((_, i) => simOfService(i) === n);
  return {
    iccid: iccid(n), imsi: imsi(n), puk: null, puk2: '', ki: '', admi: '', udf1: null, udf2: null, udf3: null,
    serviceId: k >= 0 ? SERVICE_IDS[k] : null, accountId: k >= 0 ? ACCOUNT_IDS[k] : null, ...over,
  };
}
const SIM_NS = [101, 102, 103, 104, 105];
const ESIM_NS = [201, 202, 203];
// A SIM by ICCID: a fixture when it is one, otherwise a free one with that ICCID.
function simByIccid(id, list) {
  const n = list.find((x) => iccid(x) === id);
  return n ? simCard(n) : simCard(list[hash(id) % list.length], { iccid: id, serviceId: null, accountId: null });
}
function simFilter(q, list) {
  let rows = list.map((n) => simCard(n));
  for (const k of ['iccid', 'imsi', 'puk', 'udf1', 'udf2', 'udf3']) {
    const v = text(q[k]);
    if (v) rows = rows.filter((r) => String(r[k] || '').includes(v));
  }
  // serviceId= / accountId= sent empty: free cards only (as iristelwireless asks).
  if (has(q, 'serviceId')) rows = rows.filter((r) => (text(q.serviceId) ? r.serviceId === text(q.serviceId) : r.serviceId === null));
  if (has(q, 'accountId')) rows = rows.filter((r) => (text(q.accountId) ? r.accountId === text(q.accountId) : r.accountId === null));
  return rows.slice(0, intIn(q.pageLimit, 1, 1000, 1000));
}
// SIM list bodies: { simcards: [...] }, { simcards: { simcards: [...] } }, strings or { iccid }.
function simList(b) {
  let v = b.simcards;
  if (isObj(v)) v = v.simcards;
  const list = (Array.isArray(v) ? v : [])
    .map((x) => (isObj(x) ? text(x.iccid) : text(x)))
    .filter((x) => x && !/^[A-Z_]+$/.test(x));       // skip the docs' "SIMCARDS" placeholder
  return list.length ? list.slice(0, 1000) : [iccid(104)];
}

// ---- uBoss provisioning -----------------------------------------------------------

const UBOSS_STEPS = [
  'Login', 'Init: Search URLs', 'Step 01: Add phone number to number pool', 'Step 02: Create the customer group',
  'Step 03: Create the SIP trunk', 'Step 04: Assign the numbers to the trunk', 'Step 05: Send the welcome letter',
];
const UBOSS_FIX = [
  { status: 'Completed', numbers: 1, steps: 7, day: 6 },
  { status: 'Running', numbers: 3, steps: 4, day: 1 },
  { status: 'Pending', numbers: 1, steps: 0, day: 0 },
  { status: 'Failed', numbers: 1, steps: 3, day: 4, error: 'Sample failure: a number is already in the number pool.' },
];
const UBOSS_IDS = UBOSS_FIX.map((_, i) => uuid(301 + i));
// Unknown ids answer as a completed one-number job.
function ubossJob(id) {
  const i = UBOSS_IDS.indexOf(String(id).toLowerCase());
  const f = i >= 0 ? UBOSS_FIX[i] : { status: 'Completed', numbers: 1, steps: 7, day: 2 };
  const k = i >= 0 ? i : 4 + (hash(id) % 5);
  const created = at(ago(f.day), 13, 5);
  const started = f.status === 'Pending' ? null : later(created, 1);
  const done = ['Completed', 'Failed'].includes(f.status) ? later(created, 6) : null;
  const nums = Array.from({ length: f.numbers }, (_, n) => dashed(40 + k * 5 + n, CITIES[k % 5].npa));
  const params = f.numbers > 1 ? { phoneNumbers: nums } : { phoneNumber: nums[0] };
  const steps = UBOSS_STEPS.slice(0, f.steps).map((stepName, n) => {
    const last = n === f.steps - 1;
    const status = last && f.status === 'Failed' ? 'Failed' : last && f.status === 'Running' ? 'Running' : 'Completed';
    return {
      id: 9000 + k * 10 + n, jobId: String(id), stepNumber: n + 1, stepName, status,
      errorMessage: status === 'Failed' ? f.error : null,
      startedAt: uTime(later(created, 1 + n * 0.5)), completedAt: status === 'Running' ? null : uTime(later(created, 1.5 + n * 0.5)),
    };
  });
  return {
    id: String(id),
    parameters: {
      ...params, resellerName: 'Sample Reseller', address: STREET, city: CITIES[k % 5].city, postcode: CITIES[k % 5].postal,
      notificationEmail: emailOf(k % 5), invoiceEmail: 'billing@example.com', accountRef: `SAMPLE-ACCT-${pad(k + 1, 4)}`,
      businessName: BUSINESSES[k % 5], channelCount: 10, sendWelcomeLetterToNotificationEmail: true,
      sipAuthenticationPassword: SAMPLE_PASSWORD,
    },
    status: f.status, createdAt: uTime(created), startedAt: uTime(started), completedAt: uTime(done),
    errorMessage: f.error || null, steps,
  };
}
function ubossStatus(id) {
  const j = ubossJob(id);
  const current = j.steps.length && j.status !== 'Completed' ? j.steps[j.steps.length - 1].stepName : null;
  return { id: j.id, status: j.status, currentStep: current, errorMessage: j.errorMessage, createdAt: j.createdAt, startedAt: j.startedAt, completedAt: j.completedAt };
}
function welcomeRecord(id, recipient) {
  const j = ubossJob(id);
  const nums = j.parameters.phoneNumbers || [j.parameters.phoneNumber];
  return {
    jobId: j.id, businessName: j.parameters.businessName, recipientEmail: recipient || j.parameters.notificationEmail,
    pilotNumber: nums[0], phoneNumbers: nums, channelCount: j.parameters.channelCount, status: j.status,
    createdAt: j.createdAt, completedAt: j.completedAt,
  };
}

// A one-page PDF, built with correct xref offsets.
function samplePdf(title, lines) {
  const esc = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => '\\' + c);
  const content = ['BT', '/F1 18 Tf', '72 720 Td', `(${esc(title)}) Tj`, '/F1 11 Tf',
    ...lines.flatMap((l) => ['0 -22 Td', `(${esc(l)}) Tj`]), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, n) => { const at0 = out.length; out += `${n + 1} 0 obj\n${o}\nendobj\n`; return at0; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${pad(o, 10)} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

// ---- commissions ----------------------------------------------------------------------

const COMMISSION_LINES = [
  ['Business Internet 100', '120.00', '10'], ['SIP Trunk - 10 Channels', '250.00', '12.5'], ['Hosted PBX Seat', '35.00', '10'],
  ['Mobile Unlimited 50 GB', '99.00', '8'], ['Toll-Free Number', '15.00', '10'],
];
const AGENTS = [['SAMPLE01', 'Sample Agency'], ['SAMPLE02', 'Example Partners'], ['SAMPLE03', 'Placeholder Telecom Advisors']];
// The invoice date: the 1st of this month when it is in the range asked for, else the range's start.
function invDate(start, end) {
  const first = ymd(1);
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!okDate(start) || !okDate(end) || (first >= start && first <= end)) return first;
  return start;
}
const commissionRow = (i, inv, agentName = 'Sample Agency') => ({
  LINE_DESC: COMMISSION_LINES[i][0], ACCOUNT_CODE: ACCOUNT_IDS[i], ACCOUNTNAME: BUSINESSES[i], AGENT_NAME: agentName,
  BASE_AMOUNT: COMMISSION_LINES[i][1], PERCENTAGE: COMMISSION_LINES[i][2], SYMBOL: '$', COMMISSIONSYMBOL: '%', PRECISION: 2,
  AS_FIRSTACTDATE: `${ymd(3 + i, -1)}T00:00:00`, INV_DATE: `${inv}T00:00:00`,
});

// ---- 911 listings ------------------------------------------------------------------------

const DEFAULT_TN = tn(42);
function listing(id, b = {}, { created = at(ago(5), 8, 14), modified } = {}) {
  const num = /^\d{10}$/.test(String(id)) ? Number(id) : Number(DEFAULT_TN);
  const pick = (k, d) => (b[k] !== undefined && b[k] !== '' ? b[k] : d);
  return {
    id: num, modified_on: modified || created, activated_datetime: created,
    first_name: pick('first_name', 'Alex'), last_name: pick('last_name', 'Sample'), language: pick('language', 'EN'),
    street_address: pick('street_address', STREET), city: pick('city', 'Ottawa'), state: pick('state', 'ON'),
    country: pick('country', 'CA'), zip: pick('zip', 'K1A1A1'),
    primary_addresss_validated: pick('primary_addresss_validated', null), created_on: created,
  };
}
const e911 = (data) => ({ data, errors: [], subscriberId: null });
// The CSV rows of a multipart upload, when the body reached us: [{ id, op }].
function csvRows(body) {
  const src = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : '';
  const lines = src.split(/\r?\n/);
  const h = lines.findIndex((l) => /operationtype/i.test(l));
  if (h < 0) return null;
  const cols = lines[h].split(',').map((c) => c.trim().toLowerCase());
  const idCol = cols.indexOf('id');
  const opCol = cols.indexOf('operationtype');
  const rows = [];
  for (const l of lines.slice(h + 1)) {
    if (/^--/.test(l)) break;
    const c = l.split(',');
    if (c.length < 2 || idCol < 0) continue;
    rows.push({ id: String(c[idCol] || '').trim(), op: String(c[opCol] || '').trim().toUpperCase() });
  }
  return rows.slice(0, 1000);
}

// ---- mobile app ------------------------------------------------------------------------------

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const esimProfile = (n, matchingId = `SAMPLE-MATCHING-ID-${pad(n, 4)}`) => ({
  iccid: iccid(n), matchingId, smdpAddress: 'smdp.example.com', activationCode: `LPA:1$smdp.example.com$${matchingId}`,
});
const TICKET_STATES = ['New', 'In Progress', 'Resolved'];
const TICKET_TOPICS = [
  ['Sample: no data after SIM swap', 'Sandbox ticket. The subscriber reports no data service after changing SIM cards.'],
  ['Sample: question about my bill', 'Sandbox ticket. The subscriber asks about a charge on this month\'s invoice.'],
  ['Sample: port-in status', 'Sandbox ticket. The subscriber asks when their number port will complete.'],
];
const sysTime = (iso) => iso.replace('T', ' ').slice(0, 19);
function ticket(k, id, opened = at(ago(6 - (k % 3)), 15, 20)) {
  const sysId = id || hex(0x5a000000 + k, 32);
  return {
    sys_id: sysId, number: `INC${pad(10100 + k, 7)}`, short_description: TICKET_TOPICS[k % 3][0], description: TICKET_TOPICS[k % 3][1],
    state: TICKET_STATES[k % 3], priority: '4 - Low', opened_at: sysTime(opened), sys_updated_on: sysTime(later(opened, 90)),
  };
}
const ticketIndex = (id) => { const k = [0, 1, 2].find((n) => ticket(n).sys_id === id || ticket(n).number === id); return k === undefined ? hash(id) % 3 : k; };

// ---- DID Orders (Espresso's order schema, as the router passes it on) -------------------------

const COMPANY_ID = uuid(900);
const ROUTING_PROFILES = [
  { id: uuid(201), label: 'Sample SIP trunk (primary)', format: 'E164', active: true },
  { id: uuid(202), label: 'Sample hosted PBX', format: 'E164', active: true },
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NO_RE = /^ORD-\d{6}-[0-9A-F]{12}$/i;
const ORDER_FIELDS = new Set(['routingProfileId', 'acquisitionType', 'selectDids', 'reference', 'numberRequests']);
const ORDER_FIX = [
  { status: 'COMPLETED', selectDids: false, npa: '613', ago: 5, ref: 'PO-SAMPLE-0001', filters: [{ categoryName: 'ratecenter', categoryValue: 'Ottawa,ON' }], qty: 2 },
  { status: 'PENDING', selectDids: true, npa: '416', ago: 0, ref: 'PO-SAMPLE-0002', filters: [{ categoryName: 'prefix', categoryValue: '1416' }], qty: 3 },
  { status: 'CANCELLED', selectDids: true, npa: '514', ago: 3, ref: null, filters: [{ categoryName: 'did', categoryValue: ['15145550130'] }], qty: 1 },
];
// Any other order id: a completed two-number order.
const ORDER_ANY = { status: 'COMPLETED', selectDids: false, npa: '613', ago: 1, ref: 'PO-SAMPLE-0042', filters: [{ categoryName: 'ratecenter', categoryValue: 'Ottawa,ON' }], qty: 2 };
const orderNumber = (n, createdIso) => `ORD-${createdIso.slice(2, 4)}${createdIso.slice(5, 7)}${createdIso.slice(8, 10)}-${hex(n, 12).toUpperCase()}`;
const gatewayRef = (seed, ref) => `mp-${hex(hash(seed), 8)}${hex(hash(seed + '#'), 8)}${ref ? ' ' + ref : ''}`;

// The order: a fixture (0-2), or one built for an id (n), in a status.
function didOrder({ i, n, id, number, status, keep, requests, selectDids, acquisitionType, routingProfileId, reference, createdAt } = {}) {
  const f = i !== undefined ? ORDER_FIX[i] : ORDER_ANY;
  const num = i !== undefined ? 101 + i : n;
  const created = createdAt || at(ago(f.ago), 14, 5);
  const st = status || f.status;
  const reqs = (requests || [{ quantity: f.qty, filters: f.filters }]).map((r, k) => ({
    id: uuid(4000 + (num % 1000) * 10 + k), index: k, quantity: r.quantity,
    filters: (Array.isArray(r.filters) ? r.filters : []).map((x) => ({ ...(isObj(x) ? x : {}), categoryOperator: 'and' })),
    reservedQty: 0, error: null,
  }));
  const ordered = reqs.reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  // Numbers exist once reserved: PENDING on a selectDids order, and every later status.
  const reserved = st !== 'PENDING' || (status ? false : f.selectDids);
  const base = num % 50;
  const exact = (r) => r.filters.filter((x) => x.categoryName === 'did').flatMap((x) => (Array.isArray(x.categoryValue) ? x.categoryValue : String(x.categoryValue || '').split(',')))
    .map(did11).filter(Boolean);
  const dids = reserved ? reqs.flatMap((r) => {
    const qty = Math.min(5, Number(r.quantity) || 0);
    const picked = exact(r).slice(0, qty);
    const list = picked.length ? picked : Array.from({ length: qty }, (_, k) => '1' + tn(base + r.index * 5 + k, f.npa));
    return list.map((did) => ({ did, numberRequestId: r.id }));
  }) : [];
  if (reserved) reqs.forEach((r) => { r.reservedQty = dids.filter((d) => d.numberRequestId === r.id).length; });
  const each = { COMPLETED: 'ASSIGNED', PENDING: 'RESERVED', PROCESSING: 'RESERVED', CANCELLED: 'RELEASED', EXPIRED: 'RELEASED', REJECTED: 'RELEASED', FAILED: 'RESERVED' }[st];
  const keepSet = keep && keep.length ? new Set(keep.map(did11)) : null;
  const numbers = dids.map((d) => ({ ...d, status: keepSet && !keepSet.has(d.did) && st !== 'CANCELLED' ? 'NOT_SELECTED' : each }));
  const sel = selectDids !== undefined ? selectDids : f.selectDids;
  const out = {
    id: id || uuid(num), orderNumber: number || orderNumber(num, created), accountId: COMPANY_ID, countryId: '1', ocn: '154E',
    vanity: false, selectDids: sel, acquisitionType: acquisitionType || 'BUY', routingProfileId: routingProfileId || ROUTING_PROFILES[0].id,
    reference: reference !== undefined ? reference : gatewayRef(num, f.ref),
    status: st, canComplete: st === 'PENDING' && sel && reserved,
    totalOrderedQty: ordered, totalReservedQty: dids.length, totalAssignedQty: numbers.filter((x) => x.status === 'ASSIGNED').length,
    reservationExpiresAt: reserved ? plusMin(created, 61) : null, rejectionReason: null, failureReason: null,
  };
  if (st === 'COMPLETED') out.completedAt = later(created, 3);
  out.createdAt = created;
  out.updatedAt = later(created, st === 'PENDING' ? 1 : 4);
  out.numberRequests = reqs;
  out.numbers = numbers;
  return out;
}
// 10 or 11 digits -> 11 starting with 1, else null.
function did11(v) { const d = String(v == null ? '' : v).replace(/\D/g, ''); return /^1\d{10}$/.test(d) ? d : /^\d{10}$/.test(d) ? '1' + d : null; }
const summary = (o) => { const { numberRequests, numbers, ...rest } = o; return rest; };
// The order behind :orderId (the UUID or its ORD- number), or a 400 like the router's.
function orderFor(raw, extra = {}) {
  const s = String(raw || '');
  const fixtures = ORDER_FIX.map((_, i) => didOrder({ i }));
  if (ORDER_NO_RE.test(s)) {
    const i = fixtures.findIndex((o) => o.orderNumber === s.toUpperCase());
    return i >= 0 ? didOrder({ i, ...extra }) : didOrder({ n: 600 + (hash(s.toUpperCase()) % 9000), number: s.toUpperCase(), ...extra });
  }
  if (!UUID_RE.test(s)) return null;
  const i = fixtures.findIndex((o) => o.id === s.toLowerCase());
  return i >= 0 ? didOrder({ i, ...extra }) : didOrder({ n: 600 + (hash(s.toLowerCase()) % 9000), id: s.toLowerCase(), ...extra });
}
const badOrderId = () => bad('orderId must be the order id (a UUID) or its order number (ORD-…).');

const RATECENTERS = { ottawa: '613', toronto: '416', montreal: '514', vancouver: '604', calgary: '403' };
const REGIONS = { ON: '613', QC: '514', BC: '604', AB: '403' };

// ---- LRN ------------------------------------------------------------------------------------------

const CARRIERS = [['346J', 'Iristel Inc.'], ['SMP1', 'Sample Telecom Inc.'], ['SMP2', 'Example Wireless Ltd.']];
function lrnE164(n) {
  if (typeof n !== 'string' && typeof n !== 'number') return null;
  const d = String(n).slice(0, 40).replace(/[\s().+-]/g, '');
  if (/^\d{10}$/.test(d)) return '1' + d;
  if (/^1\d{10}$/.test(d)) return d;
  return null;
}
const badNumber = (n) => bad(`"${String(n).slice(0, 30)}" is not a phone number: use 10 digits, or 11 starting with 1.`);
function lrnBasic(number) {
  const now = CARRIERS[hash(number) % 3];
  return { number, lrn: tn(99, number.slice(1, 4)), spid: now[0], spid_operator: now[1] };
}
function lrnHistory(number) {
  const b = lrnBasic(number);
  const k = CARRIERS.findIndex((c) => c[0] === b.spid);
  const orig = CARRIERS[(k + 1) % 3];
  const first = unix(at(2, 9, 0, -1));
  const moved = unix(at(ago(4), 13, 30));
  return {
    ...b, orig_spid: orig[0], orig_spid_operator: orig[1], activation_ts: moved,
    history: [{ spid: orig[0], spid_operator: orig[1], change_ts: first }, { spid: b.spid, spid_operator: b.spid_operator, change_ts: moved }],
  };
}

// ---- WLNP ------------------------------------------------------------------------------------------

const HOME_SPID = '346J';
const reqNoOf = (n) => `${HOME_SPID}SMPL${pad(n, 8)}`;
const WLNP_FIX = [
  { n: 101, status: 'Confirmed', onsp: 'BM03', npa: '416', person: 0, ago: 6 },
  { n: 102, status: 'Pending', onsp: 'ICW2', npa: '613', person: 1, ago: 2 },
  { n: 103, status: 'Resolution Required', onsp: 'BM03', npa: '514', person: 2, ago: 4 },
];
function wlnpFix(reqNo) {
  const f = WLNP_FIX.find((x) => reqNoOf(x.n) === reqNo);
  return f || { n: 200 + (hash(reqNo) % 700), status: 'Pending', onsp: 'BM03', npa: '613', person: hash(reqNo) % 5, ago: 1 };
}
function wlnpDetails(reqNo) {
  const f = wlnpFix(reqNo);
  const p = f.person;
  return {
    requestId: requestIdOf(reqNo), requestNumber: reqNo, status: f.status, npdi: 'A', chc: 'Y', exp: 'N',
    desiredDueAt: `${ymd(ahead(3))}T12:00:00`, billFirstName: PEOPLE[p][0], billLastName: PEOPLE[p][1],
    businessName: BUSINESSES[p], billStreetNumber: '123', billStreetName: 'Sample St', city: CITIES[p].city,
    stateProvince: CITIES[p].province, zipCode: CITIES[p].postal.replace(' ', ''), country: 'CAN',
    accountNumber: `SAMPLE${pad(f.n, 10)}`, onsp: f.onsp, nnsp: HOME_SPID, nlsp: HOME_SPID, verIdReq: '01',
    lines: [{ lnum: '00001', portedNum: wl(60 + (f.n % 40), f.npa), name: fullName(p) }],
  };
}
function wlnpRow(reqNo) {
  const d = wlnpDetails(reqNo);
  const f = wlnpFix(reqNo);
  return {
    requestId: d.requestId, requestNumber: reqNo, verIdReq: d.verIdReq, portType: 'IN', status: d.status,
    onsp: d.onsp, nnsp: d.nnsp, nlsp: d.nlsp, desiredDueAt: d.desiredDueAt, portedNum: d.lines[0].portedNum,
    createdAt: at(ago(f.ago), 9, 30).slice(0, 19),
  };
}
// IBM MQ message ids are 24 bytes: "AMQ SMPL" + 16 sample bytes, in hex.
const mqId = (seed) => `414D5120534D504C${hex(hash(seed), 8).toUpperCase()}${'0'.repeat(24)}`;
const requestIdOf = (reqNo) => 5000 + wlnpFix(reqNo).n;
const submitted = (reqNo, verIdReq, seed) => ({ requestId: requestIdOf(reqNo), messageId: mqId(seed), reqNo, verIdReq, messageSent: true });
const responded = (b, seed) => {
  const reqNo = text(b.reqNo) || reqNoOf(301);
  return {
    requestId: requestIdOf(reqNo), messageId: mqId(seed), reqNo, respNo: `${reqNo.slice(0, 13)}R${pad(hash(seed) % 100, 2)}`,
    responseType: ['C', 'D', 'R'].includes(text(b.responseType).toUpperCase()) ? text(b.responseType).toUpperCase() : 'C', messageSent: true,
  };
};

// ---- BroadWorks (values typed as lib/routes/broadworks.js shapes OCI text) ------------------------

const BW_SP = 'Sample_Enterprise';
const BW_DOMAIN = 'voice.example.com';
const BW_GROUPS = [
  { groupId: 'Sample_Ottawa', groupName: 'Sample Dental Inc. - Ottawa', npa: '613', userLimit: 25, city: 'Ottawa', province: 'ON', postal: 'K1A 1A1' },
  { groupId: 'Sample_Toronto', groupName: 'Sample Dental Inc. - Toronto', npa: '416', userLimit: 50, city: 'Toronto', province: 'ON', postal: 'M5V 1A1' },
  { groupId: 'Sample_Montreal', groupName: 'Sample Dental Inc. - Montreal', npa: '514', userLimit: 10, city: 'Montreal', province: 'QC', postal: 'H2X 1A1' },
];
const BW_USERS = 3;          // users 1..3 of each group: <npa>55501{01..03}@voice.example.com
const bwGroupIndex = (gid) => { const i = BW_GROUPS.findIndex((g) => g.groupId.toLowerCase() === String(gid).toLowerCase()); return i >= 0 ? i : hash(String(gid).toLowerCase()) % BW_GROUPS.length; };
const bwSp = (q) => text(q.enterprise) || BW_SP;
const bwUserId = (g, k) => `${tn(k, BW_GROUPS[g].npa)}@${BW_DOMAIN}`;
function bwLocate(userId) {
  const local = String(userId).split('@')[0];
  for (let g = 0; g < BW_GROUPS.length; g++) {
    for (let k = 1; k <= BW_USERS; k++) if (tn(k, BW_GROUPS[g].npa) === local) return { g, k, phone: local };
  }
  const h = hash(String(userId).toLowerCase());
  const g = /^\d{10}$/.test(local) ? Math.max(0, BW_GROUPS.findIndex((x) => x.npa === local.slice(0, 3))) : h % 3;
  return { g, k: 1 + (h % BW_USERS), phone: /^\d{10}$/.test(local) ? local : tn(1 + (h % BW_USERS), BW_GROUPS[g].npa) };
}
const bwPerson = (k) => PEOPLE[(k - 1) % PEOPLE.length];
const bwList = (rows, asked) => {
  const out = { data: rows, total: rows.length };
  if (asked && rows.length >= asked) { out.truncated = true; out.note = `Only the first ${rows.length} are shown; there may be more.`; }
  return out;
};
const bwContact = () => ({ contactName: 'Alex Sample', contactNumber: tn(10), contactEmail: 'it@example.com' });
const bwAddress = (g = 0) => ({
  addressLine1: STREET, addressLine2: `Suite ${200 + g}`, city: BW_GROUPS[g].city,
  stateOrProvince: BW_GROUPS[g].province, zipOrPostalCode: BW_GROUPS[g].postal, country: 'Canada',
});
const UNKNOWN_TAIL = '; the enterprise and group come from your account and the path.';
const bwDevice = (g, d) => `Sample-Desk-${pad(g * 10 + d, 2)}`;

function bwUserRow(g, k) {
  const [first, last] = bwPerson(k);
  return {
    userId: bwUserId(g, k), lastName: last, firstName: first, department: null, phoneNumber: dashed(k, BW_GROUPS[g].npa),
    phoneNumberActivated: true, emailAddress: `${first}.${last}@example.com`.toLowerCase(), hiraganaLastName: last,
    hiraganaFirstName: first, inTrunkGroup: false, extension: `01${pad(k, 2)}`, countryCode: '1', nationalPrefix: '1',
  };
}
// UserGetRequest22V5, as Get a user returns it (after "userId").
function bwUser(userId) {
  const { g, k, phone } = bwLocate(userId);
  const [first, last] = bwPerson(k);
  return {
    userId, serviceProviderId: BW_SP, groupId: BW_GROUPS[g].groupId, isEnterprise: true, lastName: last, firstName: first,
    callingLineIdLastName: last, callingLineIdFirstName: first, hiraganaLastName: last, hiraganaFirstName: first,
    phoneNumber: phone, extension: phone.slice(-4), callingLineIdPhoneNumber: phone, language: 'English',
    timeZone: 'America/Toronto', timeZoneDisplayName: '(GMT-05:00) (Canada) Eastern Time', defaultAlias: `${phone}@${BW_DOMAIN}`,
    accessDeviceEndpoint: {
      accessDevice: { deviceLevel: 'Group', deviceName: bwDevice(g, k) }, linePort: `${phone}@${BW_DOMAIN}`,
      staticRegistrationCapable: false, useDomain: true, supportVisualDeviceManagement: false,
    },
    emailAddress: `${first}.${last}@example.com`.toLowerCase(), countryCode: '1', nationalPrefix: '1',
  };
}

// User features: current settings, typed as the router shapes them. Note
// transferOnZeroToPhoneNumber and sendVoiceMessageNotifyEmail stay the text
// "false": their names end in "Number" / "Email" (TEXT_KEY), so the router's
// shape() keeps them as text.
const BW_FEATURES = {
  'call-forwarding/always': {
    now: () => ({ isActive: false, forwardToPhoneNumber: tn(99), isRingSplashActive: false }),
    fields: { isActive: 'bool', forwardToPhoneNumber: 'dest', isRingSplashActive: 'bool' },
  },
  'call-forwarding/busy': {
    now: () => ({ isActive: true, forwardToPhoneNumber: tn(99) }),
    fields: { isActive: 'bool', forwardToPhoneNumber: 'dest' },
  },
  'call-forwarding/no-answer': {
    now: () => ({ isActive: true, forwardToPhoneNumber: tn(99), numberOfRings: 4 }),
    fields: { isActive: 'bool', forwardToPhoneNumber: 'dest', numberOfRings: 'rings' },
  },
  dnd: {
    now: () => ({ isActive: false, ringSplash: false }),
    fields: { isActive: 'bool', ringSplash: 'bool' },
  },
  voicemail: {
    now: (userId) => ({
      isActive: true, processing: 'Unified Voice and Email Messaging', voiceMessageDeliveryEmailAddress: `voicemail+${String(userId).split('@')[0]}@example.com`,
      usePhoneMessageWaitingIndicator: true, sendVoiceMessageNotifyEmail: 'false', sendCarbonCopyVoiceMessage: false,
      transferOnZeroToPhoneNumber: 'false', alwaysRedirectToVoiceMail: false, busyRedirectToVoiceMail: true,
      noAnswerRedirectToVoiceMail: true, outOfPrimaryZoneRedirectToVoiceMail: false,
    }),
    fields: {
      isActive: 'bool', processing: 'processing', voiceMessageDeliveryEmailAddress: 'email', usePhoneMessageWaitingIndicator: 'bool',
      sendVoiceMessageNotifyEmail: 'boolText', voiceMessageNotifyEmailAddress: 'email', sendCarbonCopyVoiceMessage: 'bool',
      voiceMessageCarbonCopyEmailAddress: 'email', transferOnZeroToPhoneNumber: 'boolText', transferPhoneNumber: 'dest',
      alwaysRedirectToVoiceMail: 'bool', busyRedirectToVoiceMail: 'bool', noAnswerRedirectToVoiceMail: 'bool',
    },
  },
};
const PROCESSING = ['Unified Voice and Email Messaging', 'Deliver To Email Address Only'];
const NULLABLE = new Set(['dest', 'email', 'phone', 'ext', 'callsOrNull']);
const asBool = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined);

// Applies a change body to current settings, checking it as the router does.
// Returns { out } or { error } (a 400). kinds: bool, boolText, dest, email,
// processing, rings, text, phone, ext, calls, callsOrNull.
function bwApply(cur, b, fields) {
  const unknown = Object.keys(b).filter((k) => !has(fields, k));
  if (unknown.length) {
    return { error: bad(`Unknown field(s): ${unknown.slice(0, 10).map((k) => k.slice(0, 40)).join(', ')}. Send only ${Object.keys(fields).join(', ')}${UNKNOWN_TAIL}`) };
  }
  const sent = Object.keys(fields).filter((k) => b[k] !== undefined);
  if (!sent.length) return { error: bad(`Send at least one of ${Object.keys(fields).join(', ')}.`) };
  const out = { ...cur };
  for (const k of sent) {
    const v = b[k];
    const kind = fields[k];
    if (v === null && NULLABLE.has(kind)) { delete out[k]; continue; }
    if (kind === 'bool' || kind === 'boolText') {
      const x = asBool(v);
      if (x === undefined) return { error: bad(`${k} must be true or false.`) };
      out[k] = kind === 'boolText' ? String(x) : x;
    } else if (kind === 'rings') {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0 || x > 20 || x === 1) return { error: bad(`${k} must be 0 (system default) or 2 to 20.`) };
      out[k] = x;
    } else if (kind === 'calls' || kind === 'callsOrNull') {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0 || x > 999999) return { error: bad(`${k} must be a whole number from 0 to 999999.`) };
      out[k] = x;
    } else if (kind === 'processing') {
      if (!PROCESSING.includes(v)) return { error: bad(`${k} must be "${PROCESSING.join('" or "')}".`) };
      out[k] = v;
    } else {
      if (typeof v !== 'string' && typeof v !== 'number') return { error: bad(`${k} must be text.`) };
      out[k] = String(v).trim();
    }
  }
  return { out };
}

function bwTrunk(g, name) {
  const gr = BW_GROUPS[g];
  return {
    pilotUserId: `${tn(90, gr.npa)}@${BW_DOMAIN}`, department: null,
    accessDevice: { deviceLevel: 'Group', deviceName: `Sample-SBC-${pad(g + 1, 2)}` },
    maxActiveCalls: 10, maxIncomingCalls: 10, maxOutgoingCalls: 10, enableBursting: false,
    capacityExceededAction: 'Forward', capacityExceededForwardAddress: tn(98, gr.npa),
    capacityExceededTrapInitialCalls: '0', capacityExceededTrapOffsetCalls: '0', unreachableDestinationAction: 'Return',
    invitationTimeout: '6', requireAuthentication: true, sipAuthenticationUserName: `${String(name).toLowerCase()}_auth`,
    trunkGroupIdentity: `${String(name).toLowerCase()}@${BW_DOMAIN}`, otgDtgIdentity: String(name).toLowerCase(),
    includeTrunkGroupIdentity: false, includeDtgIdentity: false, enableNetworkAddressIdentity: false,
    allowUnscreenedCalls: false, allowUnscreenedEmergencyCalls: false,
    pilotUserCallingLineIdentityForExternalCallsPolicy: 'No Calls', pilotUserChargeNumberPolicy: 'No Calls',
    routeToPeeringDomain: false, prefixEnabled: false, statefulReroutingEnabled: false, sendContinuousOptionsMessage: false,
    continuousOptionsSendingIntervalSeconds: '30', failureOptionsSendingIntervalSeconds: '10', failureThresholdCounter: '1',
    successThresholdCounter: '1', inviteFailureThresholdCounter: '1', inviteFailureThresholdWindowSeconds: '30',
  };
}
const TRUNK_FIELDS = {
  maxActiveCalls: 'calls', maxIncomingCalls: 'callsOrNull', maxOutgoingCalls: 'callsOrNull', enableBursting: 'bool',
  burstingMaxActiveCalls: 'callsOrNull', burstingMaxIncomingCalls: 'callsOrNull', burstingMaxOutgoingCalls: 'callsOrNull',
};
const USER_FIELDS = {
  lastName: 'text', firstName: 'text', callingLineIdLastName: 'text', callingLineIdFirstName: 'text',
  phoneNumber: 'phone', extension: 'ext', callingLineIdPhoneNumber: 'phone',
};
const ADD_FIELDS = ['userId', 'lastName', 'firstName', 'callingLineIdLastName', 'callingLineIdFirstName', 'phoneNumber', 'extension', 'password', 'timeZone', 'emailAddress'];
const BW_PHONE = /^(?:\+\d{1,3}-)?\d{1,30}$/;

function bwNumbers(ctx) {
  const b = bodyOf(ctx);
  const unknown = Object.keys(b).filter((k) => k !== 'numbers');
  if (unknown.length) return { error: bad(`Unknown field(s): ${unknown.slice(0, 10).join(', ')}. Send only numbers${UNKNOWN_TAIL}`) };
  const list = b.numbers;
  if (!Array.isArray(list) || !list.length || list.length > 50) return { error: bad('Body must be { "numbers": [ ... ] } with 1 to 50 phone numbers.') };
  const out = [];
  for (const n of list) {
    const s = typeof n === 'number' ? String(n) : typeof n === 'string' ? n.trim() : '';
    if (!BW_PHONE.test(s)) return { error: bad(`numbers[]: "${String(n).slice(0, 40)}" is not a phone number: digits only (6135550100), optionally with a country code (+1-6135550100).`) };
    if (!out.includes(s)) out.push(s);
  }
  return { numbers: out };
}
const bwDnChange = (done) => (ctx) => {
  const r = bwNumbers(ctx);
  return r.error || ok({ ok: true, groupId: ctx.params.groupId, [done]: r.numbers });
};

function bwFeatureGet(path) {
  return (ctx) => ok({ userId: ctx.params.userId, ...BW_FEATURES[path].now(ctx.params.userId) });
}
function bwFeaturePut(path) {
  return (ctx) => {
    const f = BW_FEATURES[path];
    const r = bwApply(f.now(ctx.params.userId), bodyOf(ctx), f.fields);
    return r.error || ok({ userId: ctx.params.userId, ...r.out });
  };
}

// ---- the samples -------------------------------------------------------------------------------------

const SAMPLES = {
  provisioning: {
    'GET /uboss-robot/all-trunk-provisioning': () => ok(UBOSS_IDS.map(ubossJob)),
    // Best guess: the success body isn't documented; the client code reads its id.
    'POST /uboss-robot/email/:id': (ctx) => {
      const j = ubossJob(ctx.params.id);
      const to = j.parameters.notificationEmail;
      return ok({ id: j.id, status: 'Sent', recipientEmail: to, message: `Sandbox: the welcome letter for job ${j.id} would be emailed to ${to}. Nothing was sent.` });
    },
    'GET /uboss-robot/email/:id/welcome-letter.pdf': (ctx) => {
      const r = welcomeRecord(ctx.params.id);
      return {
        status: 200,
        contentType: 'application/pdf',
        body: samplePdf('SAMPLE welcome letter (API Marketplace sandbox)', [
          `Job: ${r.jobId}`, `Business: ${r.businessName}`, `Pilot number: ${r.pilotNumber}`, `Channels: ${r.channelCount}`,
          'This is sample data from the sandbox. It is not a real welcome letter or service.',
        ]),
      };
    },
    'GET /uboss-robot/email/welcome-letters': (ctx) => {
      const email = text(ctx.query.email);
      return ok([0, 3, 1].map((i) => welcomeRecord(UBOSS_IDS[i], email || undefined)));
    },
    // With ?id= one job (as the saved example); without, best guess: the list.
    'GET /uboss-robot/trunk-provisioning': (ctx) => {
      const id = text(ctx.query.id);
      return ok(id ? ubossJob(id) : UBOSS_IDS.map(ubossJob));
    },
    'POST /uboss-robot/trunk-provisioning': (ctx) => ok({
      id: uuid(700000000 + (hash(JSON.stringify(bodyOf(ctx))) % 100000000)), sipAuthenticationPassword: SAMPLE_PASSWORD,
    }),
    'GET /uboss-robot/trunk-provisioning/:id/status': (ctx) => ok(ubossStatus(ctx.params.id)),
  },

  'did-orders': {
    'GET /api/did-orders/health': () => ok({ ok: true, environment: 'sandbox' }),
    'GET /api/did-orders/routing-profiles': () => ok({ data: ROUTING_PROFILES.map((p) => ({ ...p })), total: ROUTING_PROFILES.length }),
    'GET /api/did-orders/available': (ctx) => {
      const q = ctx.query;
      const limit = intIn(q.limit, 1, 100, 20);
      const offset = intIn(q.offset, 0, 1e9, 0);
      const prefix = text(q.prefix).replace(/\D/g, '').slice(0, 16);
      const want = prefix ? (prefix.startsWith('1') ? prefix : '1' + prefix) : '';
      let npa = RATECENTERS[text(q.ratecenter).toLowerCase().split(',')[0]] || REGIONS[text(q.region).toUpperCase()] || '613';
      if (want.length >= 4) npa = want.slice(1, 4);
      const pool = [30, 31, 33, 36, 38].map((n) => '1' + tn(n, npa)).filter((n) => n.startsWith(want));
      return ok({ data: page(pool, offset, limit).map((number) => ({ number })), limit, offset });
    },
    'POST /api/did-orders/orders': (ctx) => {
      const b = bodyOf(ctx);
      const unknown = Object.keys(b).filter((k) => !ORDER_FIELDS.has(k));
      if (unknown.length) return bad(`Unknown field(s): ${unknown.join(', ')}. Send ${[...ORDER_FIELDS].join(', ')}; the gateway sets the company, country and OCN.`);
      if (!Array.isArray(b.numberRequests) || !b.numberRequests.length) return bad('Body must include a non-empty "numberRequests" array of { quantity, filters }.');
      const acquisitionType = String(b.acquisitionType || 'BUY').toUpperCase();
      if (!['BUY', 'LEASE'].includes(acquisitionType)) return bad('acquisitionType must be BUY or LEASE.');
      if (b.selectDids !== undefined && typeof b.selectDids !== 'boolean') return bad('selectDids must be true or false.');
      if (b.reference !== undefined && (typeof b.reference !== 'string' || Buffer.byteLength(b.reference) > 235)) return bad('reference must be text of at most 235 bytes.');
      const seed = JSON.stringify(b);
      const n = 10000 + (hash(seed) % 90000);
      const requests = b.numberRequests.map((r) => ({ quantity: isObj(r) ? Number(r.quantity) || 0 : 0, filters: isObj(r) ? r.filters : [] }));
      return ok(didOrder({
        n, status: 'PENDING', requests, createdAt: nowIso(), selectDids: b.selectDids === true, acquisitionType,
        routingProfileId: typeof b.routingProfileId === 'string' && b.routingProfileId ? b.routingProfileId : undefined,
        reference: gatewayRef(seed, typeof b.reference === 'string' ? b.reference : ''),
      }), 202);
    },
    'GET /api/did-orders/orders': (ctx) => {
      const pg = intIn(ctx.query.page, 1, 1e6, 1);
      const size = intIn(ctx.query.size, 1, 50, 20);
      const all = ORDER_FIX.map((_, i) => summary(didOrder({ i }))).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return ok({ data: page(all, (pg - 1) * size, size), total: all.length, page: pg, size });
    },
    'GET /api/did-orders/orders/:orderId': (ctx) => { const o = orderFor(ctx.params.orderId); return o ? ok(o) : badOrderId(); },
    'POST /api/did-orders/orders/:orderId/complete': (ctx) => {
      const b = bodyOf(ctx);
      const unknown = Object.keys(b).filter((k) => k !== 'numbers');
      if (unknown.length) return bad(`Unknown field(s): ${unknown.join(', ')}. Send only "numbers", or {}.`);
      if (b.numbers !== undefined && (!Array.isArray(b.numbers) || !b.numbers.length)) return bad('"numbers" must be a non-empty list of reserved numbers; send {} to keep them all.');
      const o = orderFor(ctx.params.orderId, { status: 'PROCESSING', selectDids: true, keep: b.numbers });
      return o ? ok(o, 202) : badOrderId();
    },
    'POST /api/did-orders/orders/:orderId/cancel': (ctx) => {
      const unknown = Object.keys(bodyOf(ctx)).filter((k) => k !== 'reason');
      if (unknown.length) return bad(`Unknown field(s): ${unknown.join(', ')}. Send only "reason", or {}.`);
      const o = orderFor(ctx.params.orderId, { status: 'CANCELLED', selectDids: true });
      return o ? ok(o) : badOrderId();
    },
  },

  lrn: {
    'GET /api/lrn/basic/:number': (ctx) => { const n = lrnE164(ctx.params.number); return n ? ok(lrnBasic(n)) : badNumber(ctx.params.number); },
    'GET /api/lrn/history/:number': (ctx) => { const n = lrnE164(ctx.params.number); return n ? ok(lrnHistory(n)) : badNumber(ctx.params.number); },
    'POST /api/lrn/history': (ctx) => {
      const list = bodyOf(ctx).numbers;
      if (!Array.isArray(list) || !list.length || list.length > 50) return bad('Body must be { "numbers": [ ... ] } with 1 to 50 phone numbers.');
      const seen = [];
      for (const x of list) {
        const n = lrnE164(x);
        if (!n) return badNumber(x);
        if (!seen.includes(n)) seen.push(n);
      }
      return ok(seen.map(lrnHistory));
    },
  },

  'lnp-wireless': {
    // Best guess: the IristelX /_healthcheck body isn't documented.
    'GET /api/wlnp/api/health': () => ok({ status: 'ok' }),
    'GET /api/wlnp/api/port-selection': (ctx) => {
      const rn = text(ctx.query.requestNumber);
      const tnq = text(ctx.query.portedTn);
      let items = (rn ? [rn] : WLNP_FIX.map((f) => reqNoOf(f.n))).map(wlnpRow);
      if (tnq) items = items.filter((it) => it.portedNum.includes(tnq));
      return ok({ total: items.length, items, homeSpid: HOME_SPID, portFilter: '' });
    },
    'GET /api/wlnp/api/port-details': (ctx) => ok(wlnpDetails(text(ctx.query.requestNumber) || reqNoOf(101))),
    'GET /api/wlnp/api/icp-soa-errors': (ctx) => {
      const rn = text(ctx.query.requestNumber) || reqNoOf(103);
      const f = wlnpFix(rn);
      const items = f.status === 'Resolution Required' ? [{
        requestNumber: rn, source: 'SOA', errorCode: '7004', errorMessage: 'Sample: the SOA rejected the subscription version. Sandbox data.',
        status: 'Open', createdAt: at(ago(1), 8, 15).slice(0, 19),
      }] : [];
      return ok({ total: items.length, items });
    },
    'POST /api/wlnp/workflow/portin/submit': (ctx) => {
      const seed = JSON.stringify(bodyOf(ctx));
      return ok(submitted(reqNoOf(1000 + (hash(seed) % 9000000)), '01', seed));
    },
    'POST /api/wlnp/workflow/portin/modify/submit': (ctx) => ok(submitted(text(bodyOf(ctx).reqNo) || reqNoOf(102), '02', 'modify' + JSON.stringify(bodyOf(ctx)))),
    'POST /api/wlnp/workflow/portin/change-due-date/submit': (ctx) => ok(submitted(text(bodyOf(ctx).reqNo) || reqNoOf(102), '02', 'due' + JSON.stringify(bodyOf(ctx)))),
    'POST /api/wlnp/workflow/portin/cancel/submit': (ctx) => ok(submitted(text(bodyOf(ctx).reqNo) || reqNoOf(102), '02', 'cancel' + JSON.stringify(bodyOf(ctx)))),
    'POST /api/wlnp/workflow/portout/submit': (ctx) => ok(submitted(text(bodyOf(ctx).reqNo) || reqNoOf(201), '01', 'out' + JSON.stringify(bodyOf(ctx)))),
    'POST /api/wlnp/workflow/portout/response/submit': (ctx) => ok(responded(bodyOf(ctx), 'outr' + JSON.stringify(bodyOf(ctx)))),
    'POST /api/wlnp/workflow/cancel-svc/request/submit': (ctx) => {
      const seed = 'csvc' + JSON.stringify(bodyOf(ctx));
      return ok(submitted(reqNoOf(1000 + (hash(seed) % 9000000)), '01', seed));
    },
    'POST /api/wlnp/workflow/cancel-svc/response/submit': (ctx) => ok(responded(bodyOf(ctx), 'csvcr' + JSON.stringify(bodyOf(ctx)))),
  },

  broadworks: {
    'GET /api/broadworks/health': () => ok({ ok: true, linked: true }),
    'GET /api/broadworks/enterprise': (ctx) => ok({
      serviceProviderId: bwSp(ctx.query), isEnterprise: true, useCustomRoutingProfile: false, serviceProviderName: 'Sample Dental Inc.',
      supportEmail: 'support@example.com', contact: bwContact(), address: bwAddress(0),
    }),
    'GET /api/broadworks/enterprise/dns': () => ok(bwList([
      ...BW_GROUPS.map((g, i) => ({ phoneNumbers: `${dashed(1, g.npa)} - ${dashed(9, g.npa)}`, groupId: g.groupId, assigned: true, activated: i !== 2 })),
      { phoneNumbers: `${dashed(50, '613')} - ${dashed(59, '613')}`, groupId: null, assigned: false, activated: false },
    ])),
    'GET /api/broadworks/groups': () => ok(bwList(BW_GROUPS.map((g) => ({ groupId: g.groupId, groupName: g.groupName, userLimit: g.userLimit })), 1000)),
    'GET /api/broadworks/groups/:groupId': (ctx) => {
      const g = bwGroupIndex(ctx.params.groupId);
      const gr = BW_GROUPS[g];
      return ok({
        serviceProviderId: bwSp(ctx.query), groupId: ctx.params.groupId, defaultDomain: BW_DOMAIN, userLimit: gr.userLimit,
        userCount: BW_USERS, groupName: gr.groupName, callingLineIdName: 'Sample Dental', timeZone: 'America/Toronto',
        timeZoneDisplayName: '(GMT-05:00) (Canada) Eastern Time', contact: bwContact(), address: bwAddress(g),
      });
    },
    'GET /api/broadworks/groups/:groupId/dns': (ctx) => {
      const g = bwGroupIndex(ctx.params.groupId);
      const users = Array.from({ length: BW_USERS }, (_, n) => bwUserRow(g, n + 1)).map((u) => ({
        phoneNumbers: u.phoneNumber, department: null, activated: true, userId: u.userId, lastName: u.lastName,
        firstName: u.firstName, extension: u.extension, emailAddress: u.emailAddress, userType: 'Normal', countryCode: '1', nationalPrefix: '1',
      }));
      const free = [5, 6].map((n) => ({
        phoneNumbers: dashed(n, BW_GROUPS[g].npa), department: null, activated: n === 5, userId: null, lastName: null,
        firstName: null, extension: null, emailAddress: null, userType: null, countryCode: '1', nationalPrefix: '1',
      }));
      return ok(bwList([...users, ...free]));
    },
    'GET /api/broadworks/groups/:groupId/dns/available': (ctx) => ok(bwList([5, 6, 7].map((n) => dashed(n, BW_GROUPS[bwGroupIndex(ctx.params.groupId)].npa)))),
    'POST /api/broadworks/groups/:groupId/dns/assign': bwDnChange('assigned'),
    'POST /api/broadworks/groups/:groupId/dns/unassign': bwDnChange('unassigned'),
    'POST /api/broadworks/groups/:groupId/dns/activate': bwDnChange('activated'),
    'GET /api/broadworks/groups/:groupId/users': (ctx) => {
      let limit;
      if (ctx.query.limit !== undefined) {
        limit = Number(text(ctx.query.limit));
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return bad('limit must be a whole number from 1 to 1000.');
      }
      const g = bwGroupIndex(ctx.params.groupId);
      const rows = Array.from({ length: BW_USERS }, (_, n) => bwUserRow(g, n + 1)).slice(0, limit || 1000);
      return ok(bwList(rows, limit || 1000));
    },
    'POST /api/broadworks/groups/:groupId/users': (ctx) => {
      const b = bodyOf(ctx);
      const unknown = Object.keys(b).filter((k) => !ADD_FIELDS.includes(k));
      if (unknown.length) return bad(`Unknown field(s): ${unknown.slice(0, 10).join(', ')}. Send only ${ADD_FIELDS.join(', ')}${UNKNOWN_TAIL}`);
      if (b.userId === undefined || b.lastName === undefined || b.firstName === undefined) return bad('userId, lastName and firstName are required.');
      const userId = typeof b.userId === 'string' ? b.userId.trim() : '';
      const domain = userId.slice(userId.lastIndexOf('@') + 1).toLowerCase();
      if (!userId.includes('@') || domain !== BW_DOMAIN) return bad(`userId must be name@domain with one of the group's domains: ${BW_DOMAIN}.`);
      return ok({ ok: true, userId, groupId: ctx.params.groupId }, 201);
    },
    'GET /api/broadworks/users/:userId': (ctx) => ok(bwUser(ctx.params.userId)),
    'PATCH /api/broadworks/users/:userId': (ctx) => {
      const r = bwApply(bwUser(ctx.params.userId), bodyOf(ctx), USER_FIELDS);
      return r.error || ok(r.out);
    },
    'DELETE /api/broadworks/users/:userId': (ctx) => (Object.keys(bodyOf(ctx)).length
      ? bad('Unknown field(s): ' + Object.keys(bodyOf(ctx)).slice(0, 10).join(', ') + '. Send only an empty body' + UNKNOWN_TAIL)
      : ok({ ok: true, userId: ctx.params.userId, deleted: true })),
    'GET /api/broadworks/users/:userId/services': () => ok({
      userServices: [
        ['Call Forwarding Always', true], ['Call Forwarding Busy', true], ['Call Forwarding No Answer', true],
        ['Do Not Disturb', true], ['Voice Messaging User', true], ['Call Waiting', true], ['Anonymous Call Rejection', false],
      ].map(([serviceName, assigned]) => ({ serviceName, assigned })),
      servicePacks: [
        { servicePackName: 'Sample Basic Seat', assigned: true, description: 'Sample pack: forwarding, voicemail and do not disturb.' },
        { servicePackName: 'Sample Premium Seat', assigned: false, description: 'Sample pack: Basic Seat plus call recording.' },
      ],
    }),
    'POST /api/broadworks/users/:userId/services/assign': (ctx) => {
      const b = bodyOf(ctx);
      const unknown = Object.keys(b).filter((k) => !['services', 'servicePacks'].includes(k));
      if (unknown.length) return bad(`Unknown field(s): ${unknown.slice(0, 10).join(', ')}. Send only services, servicePacks${UNKNOWN_TAIL}`);
      const list = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))].slice(0, 50) : []);
      const services = list(b.services);
      const servicePacks = list(b.servicePacks);
      if (!services.length && !servicePacks.length) return bad('Send services and/or servicePacks: lists of names to assign.');
      return ok({ ok: true, userId: ctx.params.userId, services, servicePacks });
    },
    'GET /api/broadworks/users/:userId/registrations': (ctx) => {
      const { g, k, phone } = bwLocate(ctx.params.userId);
      const expires = new Date(Math.floor(Date.now() / 60000) * 60000 + 3600000).toUTCString();   // registrations last an hour
      return ok(bwList([{
        deviceLevel: 'Group', deviceName: bwDevice(g, k), order: 1, uri: `sip:${phone}@203.0.113.${10 + k}:5060;transport=udp`,
        expiration: expires, linePort: `${phone}@${BW_DOMAIN}`, endpointType: 'Primary', publicNetAddress: '203.0.113.10',
        publicPort: 5060, privateNetAddress: `192.0.2.${10 + k}`, privatePort: 5060, userAgent: 'SampleVendor SP-100/1.0.0',
        lockoutStarted: null, lockoutExpires: null, lockoutCount: 0,
      }]));
    },
    'GET /api/broadworks/users/:userId/call-forwarding/always': bwFeatureGet('call-forwarding/always'),
    'PUT /api/broadworks/users/:userId/call-forwarding/always': bwFeaturePut('call-forwarding/always'),
    'GET /api/broadworks/users/:userId/call-forwarding/busy': bwFeatureGet('call-forwarding/busy'),
    'PUT /api/broadworks/users/:userId/call-forwarding/busy': bwFeaturePut('call-forwarding/busy'),
    'GET /api/broadworks/users/:userId/call-forwarding/no-answer': bwFeatureGet('call-forwarding/no-answer'),
    'PUT /api/broadworks/users/:userId/call-forwarding/no-answer': bwFeaturePut('call-forwarding/no-answer'),
    'GET /api/broadworks/users/:userId/dnd': bwFeatureGet('dnd'),
    'PUT /api/broadworks/users/:userId/dnd': bwFeaturePut('dnd'),
    'GET /api/broadworks/users/:userId/voicemail': bwFeatureGet('voicemail'),
    'PUT /api/broadworks/users/:userId/voicemail': bwFeaturePut('voicemail'),
    'GET /api/broadworks/groups/:groupId/trunk-groups': (ctx) => {
      const g = bwGroupIndex(ctx.params.groupId);
      return ok(bwList([1, 2].map((n) => ({ name: `Sample_Trunk_${g * 2 + n}`, department: null, isActive: n === 1 }))));
    },
    'GET /api/broadworks/groups/:groupId/trunk-groups/:name': (ctx) => ok({
      groupId: ctx.params.groupId, name: ctx.params.name, ...bwTrunk(bwGroupIndex(ctx.params.groupId), ctx.params.name),
    }),
    'PATCH /api/broadworks/groups/:groupId/trunk-groups/:name': (ctx) => {
      const r = bwApply(bwTrunk(bwGroupIndex(ctx.params.groupId), ctx.params.name), bodyOf(ctx), TRUNK_FIELDS);
      return r.error || ok({ groupId: ctx.params.groupId, name: ctx.params.name, ...r.out });
    },
    'GET /api/broadworks/groups/:groupId/devices': (ctx) => {
      const g = bwGroupIndex(ctx.params.groupId);
      return ok(bwList(Array.from({ length: BW_USERS }, (_, n) => ({
        deviceName: bwDevice(g, n + 1), deviceType: 'Generic SIP Phone', availablePorts: 3, netAddress: null,
        macAddress: `00005E0053${pad(g * 10 + n + 1, 2)}`, status: n === 2 ? 'Offline' : 'Online', version: 'SampleVendor-SP100/1.0.0',
      })), 1000));
    },
    'GET /api/broadworks/groups/:groupId/devices/:deviceName': (ctx) => {
      const g = bwGroupIndex(ctx.params.groupId);
      const n = 1 + (hash(ctx.params.deviceName) % 90);
      return ok({
        groupId: ctx.params.groupId, deviceName: ctx.params.deviceName, deviceType: 'Generic SIP Phone', protocol: 'SIP 2.0',
        macAddress: `00005E0053${pad(n, 2)}`, serialNumber: `SAMPLE${pad(g * 100 + n, 6)}`, description: 'Sample desk phone (sandbox)',
        numberOfPorts: { quantity: '4' }, numberOfAssignedPorts: 1, status: 'Online', configurationMode: 'Default',
        transportProtocol: 'Unspecified', physicalLocation: `${STREET}, ${BW_GROUPS[g].city}`, version: 'SampleVendor-SP100/1.0.0',
      });
    },
    'POST /api/broadworks/groups/:groupId/devices/:deviceName/reset': (ctx) => (Object.keys(bodyOf(ctx)).length
      ? bad('Unknown field(s): ' + Object.keys(bodyOf(ctx)).slice(0, 10).join(', ') + '. Send only an empty body' + UNKNOWN_TAIL)
      : ok({ ok: true, groupId: ctx.params.groupId, deviceName: ctx.params.deviceName, reset: true })),
    'GET /api/broadworks/groups/:groupId/hunt-groups': (ctx) => {
      const g = BW_GROUPS[bwGroupIndex(ctx.params.groupId)];
      return ok(bwList([['Sales', 70], ['Support', 71]].map(([name, n]) => ({
        serviceUserId: `${g.groupId.toLowerCase()}_hg_${name.toLowerCase()}@${BW_DOMAIN}`, name: `Sample ${name}`, video: false,
        phoneNumber: dashed(n, g.npa), extension: `07${n - 70}0`, department: null, isActive: true,
      }))));
    },
    'GET /api/broadworks/groups/:groupId/auto-attendants': (ctx) => {
      const g = BW_GROUPS[bwGroupIndex(ctx.params.groupId)];
      return ok(bwList([['Main Menu', 80, 'Standard'], ['After Hours', 81, 'Basic']].map(([name, n, type]) => ({
        serviceUserId: `${g.groupId.toLowerCase()}_aa_${n}@${BW_DOMAIN}`, name: `Sample ${name}`, video: false,
        phoneNumber: dashed(n, g.npa), extension: `08${n - 80}0`, department: null, isActive: true, type,
      }))));
    },
  },

  'iristelx-accounts': {
    // Best guess (undocumented): accounts in the date range, like /account-details-with-phone's { accounts }.
    'GET /account-details': () => ok({
      accounts: ACCOUNT_IDS.slice(0, 3).map((id, i) => ({ code: id, accountId: id, name: BUSINESSES[i], status: ACCOUNT_STATUS[i], createdOn: at(ago(10 - i), 14), product: { code: 'ICENP' } })),
      total: 3,
    }),
    'GET /accounts': (ctx) => {
      const q = ctx.query;
      const pg = intIn(q.page, 1, 1e6, 1);
      const limit = intIn(q.pageLimit, 1, 1e9, 10);
      let rows = ACCOUNT_IDS.map((_, i) => accountRow(i));
      const statuses = text(q.status).toUpperCase().split(/[\s,|]+/).filter(Boolean);
      if (statuses.length) rows = rows.filter((r) => statuses.includes(r.status));
      const s = text(q.query).toLowerCase();
      if (s) rows = rows.filter((r) => [r.accountId, r.name, r.contact.emailAddress, r.contact.fname, r.contact.lname].some((x) => String(x).toLowerCase().includes(s)));
      const agent = text(q.agentId);
      if (agent) rows = rows.map((r) => ({ ...r, agent: { agentId: agent, commissionCode: null } }));
      if (text(q.sort) === 'updatedOnDesc') rows.sort((a, b) => (a.updatedOn < b.updatedOn ? 1 : -1));
      return ok({ total: rows.length, totalPages: Math.ceil(rows.length / limit), pageLimit: limit, page: pg, accounts: page(rows, (pg - 1) * limit, limit) });
    },
    'POST /accounts': (ctx) => {
      const b = bodyOf(ctx);
      const c = isObj(b.contact) ? b.contact : {};
      const accountId = String(9002000 + (hash(JSON.stringify(b)) % 1000));
      const base = contactFull(0);
      const phone = Array.isArray(c.phone) ? { home: '', business: '', mobile: text(c.phone[0]) } : isObj(c.phone) ? { home: '', business: '', mobile: '', ...c.phone } : base.phone;
      return ok({
        accountId, language: text(b.language) || 'EN', status: 'NEW', memberSince: ymd(today()).replace(/-/g, ''),
        contact: { ...base, ...c, phone }, name: text(b.name) || BUSINESSES[0], provider: 'ICENP', agent: noAgent(),
        creditLimit: { limitedCreditType: null }, debit: { expirationDate: null, paidUntilDate: null },
        udf: { iristelx: '', flatRateThrottlingUDF: '', throttleOverrideProfile: '' },
      });
    },
    'GET /accounts/:accountId': (ctx) => ok(accountDetail(indexOf(ACCOUNT_IDS, ctx.params.accountId), ctx.params.accountId)),
    'PATCH /accounts/:accountId': (ctx) => {
      const i = indexOf(ACCOUNT_IDS, ctx.params.accountId);
      const b = bodyOf(ctx);
      const d = accountDetail(i, ctx.params.accountId);
      return ok({
        status: text(b.status).toUpperCase() || d.status, memberSince: d.memberSince, contact: { ...d.contact, ...(isObj(b.contact) ? b.contact : {}) },
        name: text(b.name) || d.name, provider: d.provider, agent: { ...d.agent, ...(isObj(b.agent) ? b.agent : {}) }, creditLimit: d.creditLimit,
        debit: d.debit, udf: udf(), language: text(b.language) || d.language,
      });
    },
    'GET /accounts/:accountId/log': (ctx) => ok({ accountId: ctx.params.accountId, journal: journal(ctx.params.accountId, ctx.query) }),
    'GET /accounts/:accountId/services': (ctx) => {
      const q = ctx.query;
      const pg = intIn(q.page, 1, 1e6, 1);
      const limit = intIn(q.pageLimit, 1, 1e9, 10);
      const i = indexOf(ACCOUNT_IDS, ctx.params.accountId);
      let rows = [serviceRow(i, ctx.params.accountId)];
      const statuses = text(q.status).toUpperCase().split(/[\s,|]+/).filter(Boolean);
      if (statuses.length) rows = rows.filter((r) => statuses.includes(r.status));
      if (text(q.sim)) rows = rows.filter((r) => String(r.sim || '').includes(text(q.sim)));
      if (text(q.telephoneNumber)) rows = rows.filter((r) => String(r.telephoneNumber || '').includes(text(q.telephoneNumber).replace(/\D/g, '')));
      return ok({ total: rows.length, totalPages: Math.ceil(rows.length / limit), pageLimit: limit, page: pg, services: page(rows, (pg - 1) * limit, limit) });
    },
    'POST /accounts/:accountId/services': (ctx) => {
      const b = bodyOf(ctx);
      const i = indexOf(ACCOUNT_IDS, ctx.params.accountId);
      const p = typeof b.planCode === 'string' && !/^[A-Z]+$/.test(b.planCode) ? planFor(b.planCode) : PLANS[0];
      const code = typeof b.planCode === 'string' && !/^[A-Z]+$/.test(b.planCode) ? b.planCode : p.planCode;
      const seed = ctx.params.accountId + JSON.stringify(b);
      const c = contactFull(i);
      return ok({
        contact: {
          fname: c.fname, lname: c.lname, address1: c.address1, city: c.city, province: c.province, country: c.country,
          postalCode: c.postalCode, emailAddress: c.emailAddress, timezone: 'America/Toronto', ...(isObj(b.contact) ? b.contact : {}),
        },
        billing: { recurringCharge: p.recurringCharge, billParentAccount: true },
        provisioning: { planCode: code, telephoneNumber: null, SIM: null, IMEI: null },
        contract: { startDate: null, length: null, ...(isObj(b.contract) ? b.contract : {}) },
        serviceId: String(9102000 + (hash(seed) % 1000)), mindId: String(190000 + (hash(seed) % 1000)), language: 'EN', agent: noAgent(),
      });
    },
    // Best guess (undocumented).
    'DELETE /accounts/:accountId/services/:serviceId': (ctx) => ok({ accountId: ctx.params.accountId, serviceId: ctx.params.serviceId, message: 'Service deleted.' }),
    'GET /accounts/:accountId/services/:serviceId': (ctx) => ok(serviceDetail(indexOf(SERVICE_IDS, ctx.params.serviceId))),
    'PATCH /accounts/:accountId/services/:serviceId': (ctx) => {
      const b = bodyOf(ctx);
      const d = serviceDetail(indexOf(SERVICE_IDS, ctx.params.serviceId));
      const { plan, ...prov } = d.provisioning;
      return ok({
        contract: { ...d.contract, ...(isObj(b.contract) ? b.contract : {}) }, name: text(b.name) || d.name, status: text(b.status).toUpperCase() || d.status,
        memberSince: d.memberSince, contact: { ...d.contact, timezone: 'America/Toronto', ...(isObj(b.contact) ? b.contact : {}) }, provider: d.provider,
        agent: { ...d.agent, ...(isObj(b.agent) ? b.agent : {}) },
        billing: { billParentAccount: d.billing.billParentAccount, recurringCharge: d.billing.recurringCharge, expirationDate: null, paidUntilDate: null, ...(isObj(b.billing) ? b.billing : {}) },
        creditLimit: d.creditLimit, debit: d.debit, provisioning: prov, udf: d.udf,
      });
    },
    // A GET in the catalog ("Update Call Forwarding"). Best guess: the settings, with any sent body applied.
    'GET /accounts/:accountId/services/:serviceId/call-forwarding': (ctx) => {
      const b = bodyOf(ctx);
      const to = tn(99);
      const cur = {
        always: { enabled: false, forwardToNumber: to }, busy: { enabled: true, forwardToNumber: to },
        notReachable: { enabled: true, forwardToNumber: to }, noAnswer: { enabled: true, forwardToNumber: to, numberOfRings: 4 },
      };
      for (const k of Object.keys(cur)) if (isObj(b[k])) cur[k] = { ...cur[k], ...b[k] };
      return ok({ serviceId: ctx.params.serviceId, callForwarding: cur });
    },
    'GET /accounts/:accountId/services/:serviceId/log': (ctx) => ok({ accountId: ctx.params.accountId, serviceId: ctx.params.serviceId, journal: journal(ctx.params.serviceId, ctx.query) }),
    // A GET in the catalog ("Update Plan"). Best guess, like the SIM / number updates: { serviceId, … }.
    'GET /accounts/:accountId/services/:serviceId/plan': (ctx) => {
      const b = bodyOf(ctx);
      const p = typeof b.planCode === 'string' && !/^[A-Z]+$/.test(b.planCode) ? b.planCode : PLANS[indexOf(SERVICE_IDS, ctx.params.serviceId) % PLANS.length].planCode;
      return ok({ serviceId: ctx.params.serviceId, planCode: p, isShared: b.isShared === true });
    },
    'GET /accounts/:accountId/services/:serviceId/usage': (ctx) => ok(usage(ctx.query.type)),
    // Best guess (undocumented). A new PIN is never echoed.
    'PATCH /accounts/:accountId/services/:serviceId/voicemail': (ctx) => {
      const b = bodyOf(ctx);
      return ok({
        serviceId: ctx.params.serviceId,
        voicemail: { voicemailToEmail: { enabled: true, ...(isObj(b.voicemailToEmail) ? b.voicemailToEmail : {}) }, autoLogin: { ...(isObj(b.autoLogin) ? b.autoLogin : {}) } },
        message: b.newPin !== undefined ? 'Voicemail updated. The new PIN is set.' : 'Voicemail updated.',
      });
    },
    // Best guesses (undocumented); create / reset answer { message } (iristelwireless shows data.message).
    'POST /accounts/authenticatePin/:accountId': (ctx) => ok({ accountId: ctx.params.accountId, authenticated: true, message: 'PIN authenticated.' }),
    'POST /accounts/createPin/:accountId': () => ok({ message: 'PIN created successfully.' }),
    'POST /accounts/freeBundleUnitSharing/:accountId': (ctx) => ok({ accountId: ctx.params.accountId, isShared: bodyOf(ctx).isShared !== false }),
    // iristelwireless reads .pin.
    'GET /accounts/getPin/:accountId': (ctx) => ok({ accountId: ctx.params.accountId, pin: '1234' }),
    'GET /accounts/getSmsChoice/:accountId': (ctx) => ok({ accountId: ctx.params.accountId, smsChoice: 0 }),
    'POST /accounts/resetPin/:accountId': () => ok({ message: 'PIN updated successfully.' }),
    'GET /accounts/services': (ctx) => {
      const q = ctx.query;
      const pg = intIn(q.page, 1, 1e6, 1);
      const limit = intIn(q.pageLimit, 1, 1e9, 10);
      let rows = SERVICE_IDS.map((_, i) => serviceRow(i));
      const statuses = text(q.status).toUpperCase().split(/[\s,|]+/).filter(Boolean);
      if (statuses.length) rows = rows.filter((r) => statuses.includes(r.status));
      const plans = text(q.planCode).split(/[\s,|]+/).filter(Boolean);
      if (plans.length) rows = rows.filter((r) => plans.includes(r.planCode));
      if (text(q.serviceId)) rows = rows.filter((r) => r.serviceId === text(q.serviceId));
      const s = text(q.query).toLowerCase();
      if (s) rows = rows.filter((r) => [r.serviceId, r.name, r.contact.emailAddress, r.telephoneNumber].some((x) => String(x || '').toLowerCase().includes(s)));
      const agent = text(q.agentId);
      if (agent) rows = rows.map((r) => ({ ...r, agent: { agentId: agent, commissionCode: null } }));
      if (text(q.sort) === 'updatedOnDesc') rows.sort((a, b) => (a.updatedOn < b.updatedOn ? 1 : -1));
      return ok({ total: rows.length, totalPages: Math.ceil(rows.length / limit), pageLimit: limit, page: pg, services: page(rows, (pg - 1) * limit, limit) });
    },
    'POST /accounts/updateSmsChoice/:accountId': (ctx) => ok({ accountId: ctx.params.accountId, smsChoice: Number(bodyOf(ctx).smsChoice) || 0 }),
    // Best guess: Canada Post AddressComplete Find / Retrieve, passed through ({ Items }).
    'GET /canada-post/find': (ctx) => {
      const s = text(ctx.query.address) || STREET;
      return ok({
        Items: CITIES.slice(0, 3).map((c, k) => ({
          Id: `CA|CP|SAMPLE|${pad(101 + k, 8)}`, Text: STREET, Highlight: `0-${Math.min(s.length, STREET.length)}`, Cursor: 0,
          Description: `${c.city}, ${c.province}, ${c.postal}`, Next: 'Retrieve',
        })),
      });
    },
    'GET /canada-post/retrieve': (ctx) => {
      const id = text(ctx.query.id) || `CA|CP|SAMPLE|${pad(101, 8)}`;
      const c = CITIES[Math.max(0, Number(id.slice(-3)) - 101) % 5] || CITIES[0];
      return ok({
        Items: [{
          Id: id, DomesticId: id.split('|').pop(), Language: 'ENG', LanguageAlternatives: 'ENG,FRE', Department: '', Company: '',
          SubBuilding: '', BuildingNumber: '123', BuildingName: '', SecondaryStreet: '', Street: 'Sample St', Block: '', Neighbourhood: '',
          District: '', City: c.city, Line1: STREET, Line2: '', Line3: '', Line4: '', Line5: '', AdminAreaName: c.city, AdminAreaCode: '',
          Province: c.province, ProvinceName: c.province === 'QC' ? 'Quebec' : c.province === 'BC' ? 'British Columbia' : c.province === 'AB' ? 'Alberta' : 'Ontario',
          ProvinceCode: c.province, PostalCode: c.postal, CountryName: 'Canada', CountryIso2: 'CA', CountryIso3: 'CAN', CountryIsoNumber: 124,
          SortingNumber1: '', SortingNumber2: '', Barcode: '', POBoxNumber: '', Label: `${STREET}\n${c.city} ${c.province} ${c.postal}\nCANADA`, DataLevel: 'Premise',
        }],
      });
    },
    'GET /plans': (ctx) => {
      let rows = PLANS.map(planRow);
      const st = text(ctx.query.status);
      if (st === '0') rows = [];
      const types = text(ctx.query.billingTypes).toLowerCase().split(/[\s,|]+/).filter(Boolean);
      if (types.length) rows = rows.filter((r) => types.includes(r.billingType));
      return ok({ plans: rows });
    },
    // Best guesses (undocumented): the plan as Get a plan returns it.
    'POST /plans': (ctx) => {
      const b = bodyOf(ctx);
      const code = typeof b.planCode === 'string' && !/^[A-Z]+$/.test(b.planCode) ? b.planCode : 'ICENP_SAMPLENEW';
      const out = planFull(planFor(code), code);
      for (const k of ['planName', 'planType', 'billingType', 'billingTypeLabel', 'billingCycle', 'flatRateTariff']) if (typeof b[k] === 'string' && !/^[A-Z]+$/.test(b[k])) out[k] = b[k];
      for (const k of ['billable', 'active']) if (typeof b[k] === 'boolean') out[k] = b[k];
      return ok(out);
    },
    'DELETE /plans/:planCode': (ctx) => ok({ planCode: ctx.params.planCode, message: 'Plan deleted.' }),
    'PATCH /plans/:planCode': (ctx) => {
      const b = bodyOf(ctx);
      const out = planFull(planFor(ctx.params.planCode), ctx.params.planCode);
      for (const k of ['planName', 'planType', 'billingType', 'billingTypeLabel', 'billingCycle', 'flatRateTariff']) if (typeof b[k] === 'string' && !/^[A-Z]+$/.test(b[k])) out[k] = b[k];
      for (const k of ['billable', 'active']) if (typeof b[k] === 'boolean') out[k] = b[k];
      if (typeof b.recurringCharge === 'number') out.recurringCharge = b.recurringCharge;
      out.updatedOn = nowIso();
      return ok(out);
    },
  },

  'iristelx-sim': {
    // Best guess, like Update SIM / Update Telephone Number.
    'PATCH /accounts/:accountId/services/:serviceId/imei': (ctx) => {
      const v = text(bodyOf(ctx).imei);
      return ok({ serviceId: ctx.params.serviceId, imei: /^\d{14,16}$/.test(v) ? v : imei(hash(ctx.params.serviceId) % 900 + 100) });
    },
    'PATCH /accounts/:accountId/services/:serviceId/sim': (ctx) => {
      const v = text(bodyOf(ctx).sim);
      return ok({ serviceId: ctx.params.serviceId, sim: /^\d{18,22}F?$/i.test(v) ? v : iccid(104) });
    },
    'PATCH /accounts/:accountId/services/:serviceId/telephone-number': (ctx) => {
      const v = text(bodyOf(ctx).telephoneNumber).replace(/\D/g, '');
      return ok({ telephoneNumber: /^1?\d{10}$/.test(v) ? (v.length === 10 ? '1' + v : v) : '1' + tn(25), serviceId: ctx.params.serviceId });
    },
    // { simCards } as iristelwireless reads it (shape assumed the same as SIM cards).
    'GET /esim-cards': (ctx) => ok({ simCards: simFilter(ctx.query, ESIM_NS) }),
    // Best guess: like Add SIM Card.
    'POST /esim-cards': (ctx) => ok({ simcards: simList(bodyOf(ctx)).map((x) => ({ iccid: x, status: 'INSERTED IN THE DATABASE' })), errors: [] }),
    // Best guess (undocumented).
    'PUT /esim-cards/:iccid/assign': (ctx) => {
      const used = bodyOf(ctx).isUsed;
      return ok({ ...simByIccid(ctx.params.iccid, ESIM_NS), isUsed: used === undefined || used === true || used === 'true' || used === 'ISUSED' });
    },
    'GET /plans/:planCode': (ctx) => ok(planFull(planFor(ctx.params.planCode), ctx.params.planCode)),
    // Best guess: like Add SIM Card.
    'DELETE /sim-cards': (ctx) => ok({ simcards: simList(bodyOf(ctx)).map((x) => ({ iccid: x, status: 'DELETED FROM THE DATABASE' })), errors: [] }),
    'GET /sim-cards': (ctx) => ok({ simCards: simFilter(ctx.query, SIM_NS) }),
    'POST /sim-cards': (ctx) => ok({ simcards: simList(bodyOf(ctx)).map((x) => ({ iccid: x, status: 'INSERTED IN THE DATABASE' })), errors: [] }),
    'GET /sim-cards/:iccid': (ctx) => ok(simByIccid(ctx.params.iccid, SIM_NS)),
    // Best guesses (undocumented); :sacode is the service the SIM is held for.
    'POST /sim-cards/:sacode/reserve': (ctx) => ok({ iccid: text(bodyOf(ctx).iccid).replace(/^ICCID$/, '') || iccid(104), serviceId: ctx.params.sacode, status: 'RESERVED' }),
    'PUT /sim-cards/:sacode/unreserve': (ctx) => ok({ iccid: text(bodyOf(ctx).iccid).replace(/^ICCID$/, '') || iccid(104), serviceId: ctx.params.sacode, status: 'AVAILABLE' }),
    'POST /sim-cards/booked': (ctx) => ok({ iccid: text(bodyOf(ctx).iccid).replace(/^ICCID$/, '') || iccid(105), status: 'BOOKED' }),
  },

  'iristelx-commission': {
    'GET /commission/:agentId/:startDate/:endDate': (ctx) => {
      const inv = invDate(ctx.params.startDate, ctx.params.endDate);
      const rows = COMMISSION_LINES.map((_, i) => commissionRow(i, inv));
      const limit = intIn(ctx.query.limit, 1, 100000, rows.length);
      const offset = intIn(ctx.query.offset, 0, 1e9, 0);
      return ok({ data: page(rows, offset, limit) });
    },
    // Staff only (see STAFF_ONLY): every agent's rows, tagged with AGENT_ID.
    'GET /commission/agents': (ctx) => {
      const inv = invDate(text(ctx.query.startDate), text(ctx.query.endDate));
      const rows = COMMISSION_LINES.map((_, i) => ({ AGENT_ID: AGENTS[i % 3][0], ...commissionRow(i, inv, AGENTS[i % 3][1]) }));
      const limit = intIn(ctx.query.limit, 1, 100000, rows.length);
      const pg = intIn(ctx.query.page, 1, 1e6, 1);
      return ok({ data: page(rows, (pg - 1) * limit, limit) });
    },
    // Staff only. Best guess (undocumented): the agents and their commission set-up.
    'GET /agent-commissions': () => ok({
      data: AGENTS.map(([id, name], k) => ({
        AGENT_ID: id, AGENT_NAME: name, COMMISSION_CODE: `SAMPLE-COMM-${pad(k + 1, 2)}`, PERCENTAGE: ['10', '12.5', '8'][k],
        SYMBOL: '$', COMMISSIONSYMBOL: '%', START_DATE: `${ymd(1, -2)}T00:00:00`,
      })),
    }),
  },

  // Every mobile-app answer is a best guess: the endpoints are undocumented.
  'iristelx-mobile': {
    'GET /mobile/app-notification': () => ok({
      data: [
        ['Your bill is ready', 'Your sample invoice for this month is ready to view.', 'BILLING', 1],
        ['Data at 80%', 'You have used 80% of this month\'s sample data allowance.', 'USAGE', 3],
        ['Welcome', 'Thanks for trying the API Marketplace sandbox.', 'GENERAL', 8],
      ].map(([title, message, type, d], k) => ({ id: 7001 + k, title, message, type, isRead: k === 2, createdAt: at(ago(d), 9) })),
    }),
    'POST /mobile/app-user-notification-read': (ctx) => ok({ data: { id: Number(bodyOf(ctx).id) || bodyOf(ctx).id || 7001, isRead: true, readAt: nowIso() } }),
    // { qr, iccid, profile } as iristelwireless reads it.
    'GET /mobile/esim/qrcode/local': () => ok({ qr: TINY_PNG, iccid: iccid(203), profile: esimProfile(203) }),
    'GET /mobile/esim/qrcode/matching': (ctx) => {
      const m = text(ctx.query.matchingId);
      const n = 201 + (hash(m) % 3);
      return ok({ qr: TINY_PNG, iccid: iccid(n), profile: esimProfile(n, m || undefined) });
    },
    // The card details are never echoed.
    'GET /mobile/mock-payment': (ctx) => {
      const b = bodyOf(ctx);
      return ok({
        data: {
          success: true, transactionId: `SAMPLE-TXN-${pad(hash(JSON.stringify(b)) % 100000, 5)}`, amount: Number(b.amount) || 0,
          currency: 'CAD', remark: typeof b.remark === 'string' ? b.remark : '', status: 'APPROVED',
        },
      });
    },
    'GET /mobile/my-plan': (ctx) => {
      const id = text(ctx.query.macode) || ACCOUNT_IDS[0];
      const i = indexOf(ACCOUNT_IDS, id);
      const p = PLANS[i % PLANS.length];
      return ok({ data: { accountId: id, serviceId: SERVICE_IDS[i], telephoneNumber: line(i).telephoneNumber, status: 'ACTIVE', renewalDate: ymd(ahead(5)), plan: planFull(p) } });
    },
    'GET /mobile/plan': () => ok({ plans: PLANS.map(planRow) }),
    'GET /mobile/plan-feature': (ctx) => {
      const code = typeof bodyOf(ctx).planCode === 'string' && !/^[A-Z]+$/.test(bodyOf(ctx).planCode) ? bodyOf(ctx).planCode : PLANS[0].planCode;
      return ok({
        data: {
          planCode: code,
          features: [['VOICEMAIL', 'Voicemail', true], ['CALLERID', 'Caller ID', true], ['CALLWAIT', 'Call waiting', true], ['ROAMUSA', 'US roaming', false]]
            .map(([featureCode, name, included]) => ({ featureCode, name, included })),
        },
      });
    },
    'GET /mobile/port-in': (ctx) => {
      const id = text(ctx.query.id) || 'PORT-SAMPLE-0001';
      return ok({
        data: {
          id, portedNumber: tn(70), status: 'SUBMITTED', oldServiceProvider: 'Sample Wireless Co.', newServiceProvider: 'Iristel',
          desiredDueDate: ymd(ahead(3)), remarks: 'Sandbox port request.', createdAt: at(ago(1), 16), updatedAt: at(today(), 8),
        },
      });
    },
    'POST /mobile/port-in': (ctx) => {
      const b = bodyOf(ctx);
      const keep = {};
      for (const [k, v] of Object.entries(b)) if (typeof v === 'string' && !/^[A-Z_]+$/.test(v)) keep[k] = v;
      return ok({ data: { id: `PORT-SAMPLE-${pad(hash(JSON.stringify(b)) % 10000, 4)}`, portedNumber: tn(70), ...keep, status: 'SUBMITTED', createdAt: nowIso() } });
    },
    'GET /mobile/service-now/tickets': () => ok({ result: [0, 1, 2].map((k) => ticket(k)) }),
    'POST /mobile/service-now/tickets': (ctx) => {
      const b = bodyOf(ctx);
      const t = ticket(3 + (hash(JSON.stringify(b)) % 90), undefined, nowIso());
      return ok({ result: { ...t, short_description: text(b.short_description) || t.short_description, description: text(b.description) || t.description, state: 'New' } });
    },
    'POST /mobile/service-now/tickets/:id/comments': (ctx) => {
      const t = ticket(ticketIndex(ctx.params.id));
      return ok({
        result: {
          sys_id: hex(0x6c000000 + (hash(ctx.params.id) % 4096), 32), element: 'comments', element_id: ctx.params.id,
          value: text(bodyOf(ctx).comment) || 'Sample comment.', sys_created_on: sysTime(nowIso()), sys_created_by: 'alex.sample@example.com', number: t.number,
        },
      });
    },
    'POST /mobile/service-now/tickets/:id/images': (ctx) => {
      const sysId = hex(0x1a000000 + (hash(ctx.params.id) % 4096), 32);
      return ok({
        result: {
          sys_id: sysId, file_name: 'sample-screenshot.png', content_type: 'image/png', size_bytes: '68', table_name: 'incident',
          table_sys_id: ctx.params.id, download_link: `https://support.example.com/api/now/attachment/${sysId}/file`, sys_created_on: sysTime(nowIso()),
        },
      });
    },
    'GET /mobile/service-now/tickets/:id/with-comments': (ctx) => {
      const k = ticketIndex(ctx.params.id);
      const t = ticket(k);
      return ok({ result: { ...t, sys_id: /^[0-9a-f]{32}$/.test(ctx.params.id) ? ctx.params.id : t.sys_id, number: /^INC\d+$/.test(ctx.params.id) ? ctx.params.id : t.number, comments: [
        { value: 'Thanks, we are looking into it. (sample)', sys_created_on: sysTime(later(at(ago(6 - (k % 3)), 15, 20), 60)), sys_created_by: 'support@example.com' },
        { value: 'Any update? (sample)', sys_created_on: sysTime(later(at(ago(6 - (k % 3)), 15, 20), 1440)), sys_created_by: 'alex.sample@example.com' },
      ] } });
    },
    'GET /mobile/service-usage': (ctx) => {
      const q = ctx.query;
      const types = ['GPRS', 'MOBILEOUT', 'SMSOUT'];
      return ok({
        accountId: text(q.accountId) || ACCOUNT_IDS[0], serviceId: text(q.serviceId) || SERVICE_IDS[0], fromDate: text(q.fromDate) || ymd(1), toDate: text(q.toDate) || ymd(today()),
        data: types.map((t) => { const u = usage(t); return { type: t, units: u.units, actualUsage: u.actualUsage, billableUsage: u.billableUsage, allottedUsage: u.allottedUsage }; }),
      });
    },
  },

  e911: {
    'GET /911-info': (ctx) => ok(e911(listing(text(ctx.query.number)))),
    'POST /911-info': (ctx) => { const b = bodyOf(ctx); return ok(e911(listing(String(b.id || ''), b, { created: nowIso() }))); },
    'PUT /911-info': (ctx) => { const b = bodyOf(ctx); return ok(e911(listing(String(b.id || ''), b, { modified: nowIso() }))); },
    'DELETE /911-info': () => ok(e911('Success')),
    'POST /911-info/upload': (ctx) => {
      const rows = csvRows(ctx.body) || [{ id: tn(42), op: 'A' }, { id: tn(43), op: 'U' }];
      return ok(rows.map((r) => {
        const why = !/^\d{10}$/.test(r.id) ? 'Id must be a 10-digit telephone number.' : !['A', 'U', 'D'].includes(r.op) ? 'OperationType must be A, U or D.' : '';
        return { Id: r.id, Status: why ? 'Error' : 'Success', ErrorMessage: why };
      }));
    },
  },
};

// Operations partners may not call (product + catalog key). The sandbox
// refuses them with 403 like the live gateway; staff never reach samples.
const STAFF_ONLY = new Set([
  // WLNP: they act on other carriers' requests (lib/routes/wlnp.js STAFF_ONLY).
  'lnp-wireless POST /api/wlnp/workflow/portout/submit',
  'lnp-wireless POST /api/wlnp/workflow/portout/response/submit',
  'lnp-wireless POST /api/wlnp/workflow/cancel-svc/response/submit',
  // Commissions: all-agents staff reporting (scripts/export-iris-kb.js, public/console-app.js).
  'iristelx-commission GET /commission/agents',
  'iristelx-commission GET /agent-commissions',
  // Enterprise LNP: forcing a PON status is a staff tool (lib/routes/lnp.js answers 403 staff_only).
  'lnp-enterprise POST /api/lnp/pons/:pon/status',
]);

/**
 * The sample answer to a sandbox call: { status, body } (body null: no
 * content; contentType set when the body isn't JSON), or null when the
 * operation has none.
 */
function sampleFor(product, endpointKey, ctx = {}) {
  const table = has(SAMPLES, product) ? SAMPLES[product] : null;
  const fn = table && has(table, endpointKey) ? table[endpointKey] : null;
  if (!fn) return null;
  const c = ctx || {};
  return fn({ params: isObj(c.params) ? c.params : {}, query: isObj(c.query) ? c.query : {}, body: c.body });
}

module.exports = { sampleFor, STAFF_ONLY, SAMPLED_PRODUCTS: Object.keys(SAMPLES) };
