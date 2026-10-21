'use strict';

/**
 * LRN Lookup — Espresso REST number dipping for Canada and the US
 * (lib/routes/lrn.js). Reference: https://api.espressodid.com/ws/v1/dip/caus/
 * (basic) and https://api.espressodid.com/ws/v1/dipping/caus/history/ (with
 * porting history). The gateway adds Iristel's Espresso company to each call.
 */

const NUMBER = {
  name: 'number', in: 'path', required: true,
  description: 'The phone number: 10 digits (4168004747) or 11 digits starting with 1 (14168004747).',
};
const BASIC_FIELDS = 'number (11 digits), lrn (the Local Routing Number calls to it are routed on), spid (4-character Service Provider ID of the carrier that serves it now) and spid_operator (that carrier\'s name). lrn, spid and spid_operator are null when Espresso has no portability record for the number.';
const HISTORY_FIELDS = BASIC_FIELDS + ' Also orig_spid / orig_spid_operator (the carrier the number was first assigned to), activation_ts (Unix time of the current assignment) and history: up to 100 past carriers as { spid, spid_operator, change_ts }.';
const ERRORS = [
  { code: 400, when: 'validation_error: the number is not 10 digits, or 11 starting with 1 (checked by the gateway).' },
  { code: 404, when: 'espresso_error: Espresso has no record of the number.' },
  { code: 403, when: 'espresso_error: lookups are not enabled on Iristel\'s Espresso account. Contact Iristel support.' },
];

module.exports = [
  {
    method: 'GET', path: '/api/lrn/basic/:number', upstream: 'GET /ws/v1/dip/caus/basicdip/{company_id}/{number}',
    summary: 'Basic LRN lookup',
    description: 'Looks up one Canadian or US number: its LRN and the carrier (SPID) that serves it today. Use it to route a call or to see who a number belongs to before you port it.',
    params: [NUMBER],
    returns: BASIC_FIELDS,
    errors: ERRORS,
  },
  {
    method: 'GET', path: '/api/lrn/history/:number', upstream: 'GET /ws/v1/dipping/caus/history/basicdip/{company_id}/{number}',
    summary: 'LRN lookup with porting history',
    description: 'Everything the basic lookup returns, plus the carrier the number started with, when it moved to its current carrier and every carrier it has been with. Use it to check a number\'s porting record.',
    params: [NUMBER],
    returns: HISTORY_FIELDS,
    errors: ERRORS,
  },
  {
    method: 'POST', path: '/api/lrn/history', upstream: 'POST /ws/v1/dipping/caus/history/basicdip/{company_id}',
    summary: 'Bulk LRN lookup with porting history',
    description: 'The lookup with porting history for up to 50 numbers in one call (a longer list is refused). Numbers may be 10 or 11 digits; each is looked up once.',
    body: { numbers: ['4168004747', '18334747835'] },
    fields: [
      { name: 'numbers[]', required: true, description: '1 to 50 phone numbers, 10 or 11 digits each.' },
    ],
    returns: 'An array with one result per number, each with the fields of the single lookup with history.',
    errors: ERRORS,
  },
];
