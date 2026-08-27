'use strict';

/**
 * Number Porting — Enterprise (LNP).
 *
 * Espresso DID SOAP web service, Local Number Portability v4 (Feb 2020).
 * One REST endpoint per documented lnp* method. Same Espresso credentials as
 * the DID product; only the upstream endpoint differs (v4 instead of v3).
 */

const PON_STATUSES =
  'New, Pending, Processed, "Rejected. Pending Update", Confirmed, Closed, ' +
  '"Pending Cancellation", Canceled.';

// Reused across create/edit — the porting request body from the PDF.
const PON_BODY = {
  pon_data: {
    service_type: 'Wireline',
    current_provider_name: '',
    desired_due_date: '2026-09-20',
    auth_date: '2026-08-18',
    end_user_name: 'End User Name',
    house_number: '22',
    street_directional: 'N',
    street_name: 'Street',
    city: 'Toronto',
    province_state: 'ON',
    zip_code: 'M5V 1A1',
    comments: '',
    losing_carrier_comments: '',
    service_details: [
      { activity: 'Port', existing_account_number: '', start_number: '2509991212', end_number: '2509991213' },
    ],
  },
  routing: { default_routing_profile: 111, details: [] },
};

const PON_FIELD_DOCS = [
  { name: 'pon_data.service_type', required: true, description: 'Wireline or Wireless.' },
  { name: 'pon_data.current_provider_name', required: false, description: 'Reseller name. Leave empty if the numbers do not belong to a reseller.' },
  { name: 'pon_data.desired_due_date', required: true, description: 'Desired due date, YYYY-MM-DD.' },
  { name: 'pon_data.auth_date', required: true, description: 'Authorization date, YYYY-MM-DD.' },
  { name: 'pon_data.end_user_name', required: true, description: 'End user name as it appears with the losing carrier.' },
  { name: 'pon_data.house_number', required: true, description: 'Street number.' },
  { name: 'pon_data.street_name', required: true, description: 'Street name.' },
  { name: 'pon_data.street_directional', required: false, description: 'One of N, S, E, W, NW, NE, SE, SW.' },
  { name: 'pon_data.street_suffix', required: false, description: 'Street suffix.' },
  { name: 'pon_data.street_type', required: false, description: 'Street type.' },
  { name: 'pon_data.descriptive_location', required: false, description: 'Descriptive location.' },
  { name: 'pon_data.floor', required: false, description: 'Floor.' },
  { name: 'pon_data.room', required: false, description: 'Room number.' },
  { name: 'pon_data.building', required: false, description: 'Building.' },
  { name: 'pon_data.city', required: true, description: 'City.' },
  { name: 'pon_data.province_state', required: true, description: 'Two-letter code: AB, BC, MB, NB, NL, NT, NS, NU, ON, PE, QC, SK, YT.' },
  { name: 'pon_data.zip_code', required: true, description: 'Postal / ZIP code.' },
  { name: 'pon_data.comments', required: false, description: 'Comments for the Iristel team.' },
  { name: 'pon_data.losing_carrier_comments', required: false, description: 'Comments passed to the losing carrier.' },
  { name: 'pon_data.service_details[].activity', required: true, description: 'Port or Cancel.' },
  { name: 'pon_data.service_details[].existing_account_number', required: false, description: 'Existing account number with the losing carrier.' },
  { name: 'pon_data.service_details[].start_number', required: true, description: 'Single number, or first in a range. 10 digits.' },
  { name: 'pon_data.service_details[].end_number', required: false, description: 'Last in range. Leave empty for a single number.' },
];

const ROUTING_FIELD_DOCS = [
  { name: 'routing.default_routing_profile', required: true, description: 'Profile id from /api/lnp/routing-profiles. Applies to every number on the PON.' },
  { name: 'routing.details[].start_number', required: false, description: 'Number / first in subrange that needs a different profile.' },
  { name: 'routing.details[].end_number', required: false, description: 'Last in subrange. Empty for a single number.' },
  { name: 'routing.details[].routing_profile', required: false, description: 'Profile id to use for that subrange instead of the default.' },
];

module.exports = [
  {
    method: 'GET', path: '/api/lnp/portability/:npanxx', soap: 'lnpCheckNpaNxxPortability',
    summary: 'Check whether an NPA-NXX is portable',
    description: 'Tells you whether Iristel can port a given NPA-NXX before you build a request. Call this first — it is the cheapest way to rule out a port.',
    params: [{ name: 'npanxx', in: 'path', required: true, description: 'Six digits: NPA + NXX, e.g. 250999.' }],
    returns: 'portable: 1 = portable, 0 = rate center supported by Iristel but not yet open for portability, -1 = not portable.',
  },
  {
    method: 'GET', path: '/api/lnp/routing-profiles', soap: 'lnpGetRoutingProfiles',
    summary: 'List LNP routing profiles',
    description: 'Routing profiles usable in the LNP module. You need a profile id before creating a PON — it sets where calls to the ported numbers are delivered.',
    returns: 'Array of profiles with id, label, tech_prefix, format (E164 / National), routing_type and ips.',
  },
  {
    method: 'POST', path: '/api/lnp/pons', soap: 'lnpCreatePons',
    summary: 'Create a porting request (PON)',
    description: 'Creates a PON for one number or a range. The request is sent to the losing carrier, who confirms or rejects it. default_routing_profile applies to every number; use routing.details only when a specific number or subrange needs a different profile.',
    body: PON_BODY,
    fields: [...PON_FIELD_DOCS, ...ROUTING_FIELD_DOCS],
    returns: 'The created PON: pon, last_version, last_processstatus, service_details and date_last_update.',
    errors: [{ code: 12, when: 'A number is invalid — length must be 10 digits.' }],
  },
  {
    method: 'GET', path: '/api/lnp/pons', soap: 'lnpPonsByStatus',
    summary: 'List PONs by status',
    description: 'Filters your porting requests by a single status value.',
    params: [{ name: 'status', in: 'query', required: true, description: 'One of: ' + PON_STATUSES }],
    returns: 'Array of PON summaries.',
  },
  {
    method: 'GET', path: '/api/lnp/pons/updated', soap: 'lnpPonsStatusFromDate',
    summary: 'List PONs updated since a date',
    description: 'Every porting request touched after the given timestamp. Use this to poll for changes instead of re-reading each PON.',
    params: [{ name: 'date', in: 'query', required: true, description: 'Timestamp, format "Y-m-d H:i:s", e.g. 2026-08-01 00:00:00.' }],
    returns: 'Array of PON summaries with their latest status.',
  },
  {
    method: 'GET', path: '/api/lnp/pons/:pon', soap: 'lnpPonLastStatus',
    summary: 'Get PON details and status',
    description: 'Full detail for one PON, including status_reason — this is where the losing carrier\'s rejection reasons appear.',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier, e.g. IRIS102002170008.' }],
    returns: 'date, pon, last_version, last_processstatus, date_last_update, status_reason, note, routing and versions history.',
  },
  {
    method: 'POST', path: '/api/lnp/pons/:pon/edit', soap: 'lnpEditPon',
    summary: 'Correct or modify a PON',
    description: 'Replaces the porting information on an open PON. Use after a rejection, once you have read the reasons from the PON details.',
    precondition: 'The PON must still be open (typically "Rejected. Pending Update").',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier.' }],
    body: { pon_data: PON_BODY.pon_data },
    fields: PON_FIELD_DOCS,
    returns: '"success" when accepted.',
    errors: [{ code: 12, when: 'A number is invalid — length must be 10 digits.' }],
  },
  {
    method: 'POST', path: '/api/lnp/pons/:pon/routing', soap: 'lnpEditPonRouting',
    summary: 'Update PON routing',
    description: 'Changes where the ported numbers will be delivered, without touching the porting information itself.',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier.' }],
    body: { routing: { default_routing_profile: 111, details: [{ start_number: '2509991212', end_number: '', routing_profile: 112 }] } },
    fields: ROUTING_FIELD_DOCS,
    returns: '"success" when accepted.',
  },
  {
    method: 'POST', path: '/api/lnp/pons/:pon/due-date', soap: 'lnpEditDDD',
    summary: 'Request a new due date',
    description: 'Asks for a different due date on a PON the losing carrier has already confirmed.',
    precondition: 'PON status must be "Confirmed".',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier.' }],
    body: { desired_due_date: '2026-09-25', auth_date: '2026-08-18' },
    fields: [
      { name: 'desired_due_date', required: true, description: 'New desired due date, YYYY-MM-DD.' },
      { name: 'auth_date', required: true, description: 'Authorization date, YYYY-MM-DD.' },
    ],
    returns: '"success" when accepted.',
  },
  {
    method: 'POST', path: '/api/lnp/pons/:pon/cancel', soap: 'lnpCancelPon',
    summary: 'Cancel a PON',
    description: 'Requests cancellation of an open porting request. The PON moves to "Pending Cancellation" until the cancellation is processed.',
    precondition: 'The PON must be open.',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier.' }],
    returns: '"success" when accepted.',
  },
  {
    method: 'POST', path: '/api/lnp/pons/:pon/activate', soap: 'lnpActivatePon',
    summary: 'Activate (port) the numbers',
    description: 'Ports the telephone numbers for a confirmed request. This is the step that actually moves the numbers — run it on the due date.',
    precondition: 'PON status must be "Confirmed".',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier.' }],
    returns: 'true when the activation was accepted.',
  },
  {
    method: 'GET', path: '/api/lnp/numbers/:number/pons', soap: 'lnpPonInfoForTelNumber',
    summary: 'Find open PONs for a number',
    description: 'Summary of open porting requests that involve a specific telephone number. Useful when you know the number but not the PON.',
    params: [{ name: 'number', in: 'path', required: true, description: '10-digit telephone number, e.g. 2509991212.' }],
    returns: 'Array of PON summaries.',
  },
  {
    method: 'GET', path: '/api/lnp/report', soap: 'lnpGetReport',
    summary: 'Report on PONs in a date range',
    description: 'Details for every porting request created between two timestamps.',
    params: [
      { name: 'from', in: 'query', required: true, description: 'Start datetime, "Y-m-d H:i:s".' },
      { name: 'to', in: 'query', required: true, description: 'End datetime, "Y-m-d H:i:s".' },
    ],
    returns: 'Array of PON reports.',
  },
  {
    method: 'GET', path: '/api/lnp/error-dictionary', soap: 'lnpGetApplicationErrorDictionary',
    summary: 'List LNP validation error codes',
    description: 'The dictionary of validation error codes and descriptions for the LNP module. Handy for mapping the code on a rejected request to a readable message.',
    returns: 'Array of code / description pairs.',
  },
  {
    method: 'POST', path: '/api/lnp/pons/:pon/status', soap: 'lnpPonChangeStatus',
    summary: 'Force a PON status (sandbox only)',
    description: 'Moves a PON to an arbitrary status so you can exercise the whole flow without a losing carrier. Available on the test environment only — it does nothing in production.',
    precondition: 'Test environment only.',
    params: [{ name: 'pon', in: 'path', required: true, description: 'PON identifier.' }],
    body: { status: 'Confirmed' },
    fields: [{ name: 'status', required: true, description: 'Target status. One of: ' + PON_STATUSES }],
    returns: '"success" when accepted.',
  },
];
