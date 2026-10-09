'use strict';

/**
 * Business-registration check for sign-up and the access request form, for
 * the four countries we serve. verify() returns
 *
 *   { status: 'verified' | 'review' | 'invalid', registry, legalName, reason }
 *
 *   verified  found in an official registry (legalName is the registered name)
 *   review    well-formed, but no free registry could confirm it — staff check
 *   invalid   malformed, failed its check digit, or the registry says it
 *             doesn't exist. Sign-up is refused.
 *
 *   RO  CUI/CIF check digit, then ANAF's free public API (legal name).
 *   CA  9-digit Business Number (Luhn check digit, optional RT0001-style
 *       program suffix) or a 7–10 digit federal/provincial corporation
 *       number. Corporations Canada's API needs an ISED API Store account,
 *       so Canadian numbers go to review for now.
 *   US  EIN NN-NNNNNNN with an IRS-assigned prefix, then review (there is no
 *       national registry).
 *   KE  KRA PIN (P051234567X) or a BRS registration number, then review.
 *
 * A registry that is slow or down never blocks anyone: the result is review.
 */

const TIMEOUT_MS = 6000;
const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map();

const COUNTRY = { CA: 'CA', CAN: 'CA', CANADA: 'CA', US: 'US', USA: 'US', 'UNITED STATES': 'US',
  RO: 'RO', ROU: 'RO', ROMANIA: 'RO', KE: 'KE', KEN: 'KE', KENYA: 'KE' };
const countryCode = (c) => COUNTRY[String(c || '').trim().toUpperCase()] || null;

const out = (status, reason, extra = {}) => ({ status, reason, registry: null, legalName: null, ...extra });

// ---- Romania ---------------------------------------------------------------
function roCheckDigitOk(cui) {
  if (!/^\d{2,10}$/.test(cui)) return false;
  const body = cui.slice(0, -1).padStart(9, '0');
  const key = '753217532';
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +body[i] * +key[i];
  const check = (sum * 10) % 11 % 10;
  return check === +cui.slice(-1);
}
async function anafLookup(cui) {
  const r = await fetch('https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ cui: Number(cui), data: new Date().toISOString().slice(0, 10) }]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('ANAF HTTP ' + r.status);
  const j = await r.json();
  const hit = (j.found || [])[0];
  return hit ? { name: hit.date_generale && hit.date_generale.denumire, status: hit.date_generale && hit.date_generale.stare_inregistrare } : null;
}
async function verifyRO(raw) {
  const cui = raw.replace(/^RO/i, '').replace(/\D/g, '');
  if (!roCheckDigitOk(cui)) return out('invalid', 'That isn\'t a valid Romanian CUI/CIF — check the number.');
  try {
    const hit = await anafLookup(cui);
    if (!hit) return out('invalid', 'ANAF has no company with that CUI.', { registry: 'ANAF' });
    if (/RADIAT/i.test(hit.status || '')) return out('invalid', 'ANAF lists that company as deregistered.', { registry: 'ANAF', legalName: hit.name });
    return out('verified', 'Found in the ANAF register.', { registry: 'ANAF', legalName: hit.name || null });
  } catch {
    return out('review', 'The Romanian register didn\'t respond — our team will check the number.', { registry: 'ANAF' });
  }
}

// ---- Canada ----------------------------------------------------------------
function luhnOk(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
function verifyCA(raw) {
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  const bn = s.match(/^(\d{9})([A-Z]{2}\d{4})?$/);
  if (bn) {
    if (!luhnOk(bn[1])) return out('invalid', 'That Business Number fails its check digit — check the 9 digits.');
    return out('review', 'Valid Business Number format — our team will confirm it with the CRA.', { registry: 'CRA format' });
  }
  if (/^\d{7,10}$/.test(s)) return out('review', 'Corporation number noted — our team will confirm it in the registry.', { registry: 'format' });
  return out('invalid', 'Enter your 9-digit CRA Business Number (e.g. 123456789 or 123456789RT0001) or your corporation number.');
}

// ---- United States -----------------------------------------------------------
// IRS campus prefixes (first two digits) assigned to EINs.
const EIN_PREFIXES = new Set(['01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16',
  '20', '21', '22', '23', '24', '25', '26', '27', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '40', '41', '42', '43', '44', '45', '46', '47', '48', '50', '51', '52', '53', '54', '55', '56', '57', '58',
  '59', '60', '61', '62', '63', '64', '65', '66', '67', '68', '71', '72', '73', '74', '75', '76', '77',
  '80', '81', '82', '83', '84', '85', '86', '87', '88', '90', '91', '92', '93', '94', '95', '98', '99']);
function verifyUS(raw) {
  const d = raw.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(d)) return out('invalid', 'Enter your 9-digit EIN, e.g. 12-3456789.');
  if (!EIN_PREFIXES.has(d.slice(0, 2))) return out('invalid', 'That EIN prefix isn\'t one the IRS assigns — check the number.');
  return out('review', 'Valid EIN format — our team will confirm it.', { registry: 'IRS format' });
}

// ---- Kenya ---------------------------------------------------------------------
function verifyKE(raw) {
  const s = raw.toUpperCase().replace(/\s/g, '');
  if (/^[AP]\d{9}[A-Z]$/.test(s)) return out('review', 'Valid KRA PIN format — our team will confirm it.', { registry: 'KRA format' });
  if (/^(PVT|CPR|BN|LLP|CLG|PF|C)[-./]?[A-Z0-9][A-Z0-9/.-]{3,20}$/.test(s))
    return out('review', 'Registration number noted — our team will confirm it with the BRS.', { registry: 'BRS format' });
  return out('invalid', 'Enter your KRA PIN (e.g. P051234567X) or BRS registration number (e.g. PVT-ABC1234).');
}

// The registered name should look like the name entered; if it clearly
// doesn't, staff take a look rather than us refusing the sign-up.
const words = (s) => new Set(String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2 && !['SRL', 'SA', 'LTD', 'INC', 'THE', 'CORP', 'LLC', 'COMPANY', 'LIMITED'].includes(w)));
function namesMatch(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return true;
  return [...x].some((w) => y.has(w));
}

async function verify({ country, number, name } = {}) {
  const c = countryCode(country);
  const n = String(number || '').trim().slice(0, 40);
  if (!n) return out('invalid', 'Enter your business registration number.');
  if (!c) return out('invalid', 'We currently serve businesses in Canada, the United States, Romania and Kenya.');
  const key = `${c}|${n.toUpperCase()}`;
  const hit = cache.get(key);
  let res = hit && Date.now() - hit.at < CACHE_MS ? hit.res : null;
  if (!res) {
    res = c === 'RO' ? await verifyRO(n) : c === 'CA' ? verifyCA(n) : c === 'US' ? verifyUS(n) : verifyKE(n);
    if (res.status !== 'review' || !/didn't respond/.test(res.reason)) cache.set(key, { at: Date.now(), res });
  }
  if (res.status === 'verified' && name && !namesMatch(name, res.legalName))
    return { ...res, status: 'review', reason: `Registered as "${res.legalName}" — our team will confirm it's your business.` };
  return res;
}

// One line for the CRM (cr57d_regcheck) and the dashboard.
const summary = (r, country, number) =>
  [r.status, countryCode(country), number, r.registry, r.legalName, new Date().toISOString().slice(0, 10)]
    .filter(Boolean).join(' · ').slice(0, 250);

module.exports = { verify, summary, countryCode, roCheckDigitOk, luhnOk };
