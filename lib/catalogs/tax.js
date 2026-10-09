'use strict';

/**
 * Sales tax on API Marketplace invoices, by the partner's billing province.
 *
 * TODO(finance): confirm these rates and which ones apply to API usage
 * (telecom / software services) before relying on them. Canadian partners
 * only — partners in the US, Romania and Kenya are invoiced without tax.
 * A Canadian (or unknown-country) partner with no province on file is
 * charged GST only and the invoice is flagged for review.
 */

// Rates in percent, as labelled on the invoice.
const CANADA = {
  ON: [['HST', 13]],
  NS: [['HST', 14]],
  NB: [['HST', 15]],
  NL: [['HST', 15]],
  PE: [['HST', 15]],
  QC: [['GST', 5], ['QST', 9.975]],
  BC: [['GST', 5], ['PST', 7]],
  MB: [['GST', 5], ['RST', 7]],
  SK: [['GST', 5], ['PST', 6]],
  AB: [['GST', 5]],
  NT: [['GST', 5]],
  NU: [['GST', 5]],
  YT: [['GST', 5]],
};
const PROVINCE_NAMES = {
  ONTARIO: 'ON', 'NOVA SCOTIA': 'NS', 'NEW BRUNSWICK': 'NB', 'NEWFOUNDLAND AND LABRADOR': 'NL',
  NEWFOUNDLAND: 'NL', 'PRINCE EDWARD ISLAND': 'PE', QUEBEC: 'QC', 'QUÉBEC': 'QC',
  'BRITISH COLUMBIA': 'BC', MANITOBA: 'MB', SASKATCHEWAN: 'SK', ALBERTA: 'AB',
  'NORTHWEST TERRITORIES': 'NT', NUNAVUT: 'NU', YUKON: 'YT',
};
const CANADA_NAMES = new Set(['CA', 'CAN', 'CANADA']);

// { country, province } from the CRM account -> { region, lines: [{label,
// rate, cents}], review }. Each line is rounded to the cent.
function taxesFor({ country, province } = {}, subtotalCents) {
  const c = String(country || '').trim().toUpperCase();
  const p0 = String(province || '').trim().toUpperCase();
  const p = CANADA[p0] ? p0 : PROVINCE_NAMES[p0] || null;
  const inCanada = CANADA_NAMES.has(c) || (!c && !!p);
  if (c && !inCanada) return { region: c, lines: [], review: false };
  const rates = p ? CANADA[p] : [['GST', 5]];
  return {
    region: p ? `CA-${p}` : 'CA',
    lines: rates.map(([label, rate]) => ({
      label: p && label !== 'GST' ? `${label} ${p}` : label,
      rate,
      cents: Math.round(subtotalCents * rate / 100),
    })),
    review: !p,
  };
}

module.exports = { taxesFor, CANADA };
