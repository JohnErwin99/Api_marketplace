'use strict';

/**
 * Number Porting — Wireless (WLNP).
 *
 * Canadian wireless number portability (CWNPG / Syniverse ICP). WLNP is part
 * of the public IristelX API (https://api.iristelx.com, under /workflow; the
 * reference is https://iristel-x.readme.io/reference/portin-submit). Every path
 * here is served through the gateway proxy at /api/wlnp/* (lib/routes/wlnp.js),
 * which adds the IristelX key, so callers only use the gateway base URL.
 *
 * Fields marked "not in the IristelX reference" are part of the WLNP service's
 * own rules but aren't listed on the public reference page.
 *
 * Every call uses Iristel's one IristelX key, so the gateway scopes partners
 * (lib/routes/wlnp.js): they see and change only the port requests they
 * submitted through the marketplace, and port-out / cancel-service responses
 * are Iristel staff only. The descriptions below say so per operation.
 */

const REF = 'https://iristel-x.readme.io/reference/';

const LINE = { portedNum: '867-458-1128', name: 'Test Customer' };

const PORT_IN_BODY = {
  onsp: 'BM03',
  desiredDueAt: '2026-09-20T12:00:00',
  nlsp: '346J',
  npdi: 'A',
  agauth: 'Y',
  authorizationDate: '2026-08-07T00:00:00',
  authorizerName: 'Test Customer',
  init: 'API',
  impcon: 'WNPIRIS',
  telNoImpcon: '647-933-0967',
  billFirstName: 'Test',
  billLastName: 'Customer',
  businessName: 'WLNP TEST',
  billStreetNumber: '100',
  billStreetName: 'Test Street',
  city: 'Toronto',
  stateProvince: 'ON',
  zipCode: 'M5V1A1',
  country: 'CAN',
  accountNumber: 'SYNBM031234567890',
  passwordPin: '1234',
  equipmentIdentifier: '123456789012345',
  remarks: 'Port In flow test.',
  lrn: '4377377777',
  chc: 'Y',
  autoAct: 'N',
  retOssp: 'N',
  lines: [LINE],
};

const PORT_IN_FIELDS = [
  { name: 'onsp', required: true, description: 'Old Network SPID, e.g. BM03 or ICW2.' },
  { name: 'nlsp', required: false, description: 'New Local SPID — usually the home SPID (346J today; Port Selection returns it as homeSpid). A remote SPID is rejected.' },
  { name: 'desiredDueAt', required: true, description: 'Desired due date/time, ISO local, e.g. 2026-09-20T12:00:00.' },
  { name: 'npdi', required: true, description: 'Port direction. A = wireless→wireless (default), C = wireline→wireless.' },
  { name: 'chc', required: false, description: 'Coordinated Hot Cut. Blank or Y only — N is not allowed on a request.' },
  { name: 'autoAct', required: false, description: 'Auto-activate, Y / N (default Y). Cannot be Y when chc=Y.' },
  { name: 'retOssp', required: false, description: 'Port to Original: Y / N / D. Create default N.' },
  { name: 'lrn', required: false, description: 'Location Routing Number, digits only.' },
  { name: 'init', required: true, description: 'Request creator, max 15 characters.' },
  { name: 'impcon', required: true, description: 'New SP contact, max 15 characters.' },
  { name: 'telNoImpcon', required: true, description: 'Contact telephone number, e.g. 647-933-0967.' },
  { name: 'agauth', required: true, description: 'Agency authorization, Y (default) or N.' },
  { name: 'authorizationDate', required: false, description: 'Required when agauth=Y.' },
  { name: 'authorizerName', required: false, description: 'Required when agauth=Y.' },
  { name: 'accountNumber', required: false, description: 'Account number, max 20 alphanumeric. Wireless single-line needs account, PIN or ESN.' },
  { name: 'passwordPin', required: false, description: 'Account PIN.' },
  { name: 'equipmentIdentifier', required: false, description: 'ESN / IMEI.' },
  { name: 'eumi', required: false, description: 'Customer moving indicator — used with NPDI C. Not in the IristelX reference.' },
  { name: 'dsl', required: false, description: 'DSL indicator — used with NPDI C. Not in the IristelX reference.' },
  { name: 'lines[].portedNum', required: true, description: 'Telephone number to port.' },
  { name: 'lines[].name', required: false, description: 'Subscriber name for the line.' },
  { name: 'remarks', required: false, description: 'Free text, max 160 characters.' },
];

const RESPONSE_BODY = {
  reqNo: 'YOUR-REQUEST-NO',
  verIdReq: '01',
  responseType: 'C',
  respondingSpid: 'ICW2',
  olsp: 'ICW2',
  dueAt: '2026-09-15T03:00:00',
  rep: 'Test Person',
  telNoRep: '647-933-0968',
  chc: 'Y',
  remarks: 'Confirmed; due changed.',
  lines: [{ lnum: '00001', portedNum: '867-458-1125', rcode: null, rdet: null }],
};

const RESPONSE_FIELDS = [
  { name: 'reqNo', required: true, description: 'Existing request number. Always respond against a real request.' },
  { name: 'responseType', required: true, description: 'C = Confirmed, D = Delay, R = Resolution Required (default C).' },
  { name: 'dueAt', required: true, description: 'Confirmed or proposed due date/time.' },
  { name: 'rep', required: true, description: 'Old SP contact name.' },
  { name: 'telNoRep', required: true, description: 'Old SP contact telephone number.' },
  { name: 'chc', required: false, description: 'Required Y or N only when the request asked for CHC; otherwise leave blank.' },
  { name: 'dcode', required: false, description: 'Delay code — required when responseType=D. One of 6G, 6H, 6J, 6L, 8J. Not in the IristelX reference.' },
  { name: 'lines', required: false, description: 'Empty array for Delay. For Resolution Required, per-line rcode + rdet (rdet max 60).' },
  { name: 'lines[].rcode', required: false, description: 'Resolution code. RCODE 1P also requires remarks.' },
];

module.exports = [
  {
    method: 'GET', path: '/api/wlnp/api/health', soap: 'GET /_healthcheck',
    summary: 'Health check',
    description: 'Checks that the IristelX API, which hosts WLNP, is up. Use it to tell "the gateway cannot reach IristelX" apart from "WLNP is up but rejecting my request".',
    returns: 'The IristelX health status.',
    errors: [
      { code: 503, when: 'The gateway has no WLNP key configured.' },
      { code: 504, when: 'The gateway could not reach the IristelX API.' },
    ],
  },
  {
    method: 'GET', path: '/api/wlnp/api/port-selection', soap: 'GET /workflow/api/port-selection',
    summary: 'Port Selection grid',
    description: 'The rows behind the ICP Port Selection screen. Use it to find a request before opening its details. Partners only see the requests they submitted through the marketplace; homeSpid applies to Iristel staff only. Reference: ' + REF + 'get-port-selection',
    params: [
      { name: 'requestNumber', in: 'query', required: false, description: 'Filter by request number. Empty returns all.' },
      { name: 'homeSpid', in: 'query', required: false, description: 'Home SPID override. Defaults to the configured service provider.' },
      { name: 'portedTn', in: 'query', required: false, description: 'Telephone number, e.g. 123-456-7890. Substring match on any request line — not an exact match.' },
    ],
    returns: 'total, items, homeSpid and portFilter.',
  },
  {
    method: 'GET', path: '/api/wlnp/api/port-details', soap: 'GET /workflow/api/port-details',
    summary: 'Port details by request number',
    description: 'Full detail for one port request: customer billing fields, WPR snapshot, and request lines. Read-only. Partners can only open requests they submitted through the marketplace. Reference: ' + REF + 'get-port-details',
    params: [{ name: 'requestNumber', in: 'query', required: true, description: 'Port request number (REQ_NO).' }],
    returns: 'requestId, requestNumber, status, NPDI/CHC/EXP flags, desired due date, billing fields, ONSP/NNSP/NLSP, verIdReq and lines[].',
    errors: [
      { code: 400, when: 'requestNumber missing or blank.' },
      { code: 404, when: 'No request exists for that number.' },
    ],
  },
  {
    method: 'GET', path: '/api/wlnp/api/icp-soa-errors', soap: 'GET /workflow/api/icp-soa-errors',
    summary: 'ICP / SOA errors grid',
    description: 'MPE fallout and ICP→SOA error rows for one request. Check here when a request looks stuck with no obvious rejection. Partners can only check requests they submitted through the marketplace. Reference: ' + REF + 'icp-soa-errors',
    params: [{ name: 'requestNumber', in: 'query', required: true, description: 'The port request number (REQ_NO) to check.' }],
    returns: 'total and items.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/submit', soap: 'POST /workflow/portin/submit',
    summary: 'Submit a Port In request (WPR / PQI)',
    description: 'Creates an outbound Port In — the equivalent of Syniverse "Create Port In Request". Persists the WPR, builds PORT_REQUEST XML and puts it on IBM MQ. The marketplace records the new reqNo for your account, so only you (and Iristel staff) can see or change it. Reference: ' + REF + 'portin-submit',
    body: PORT_IN_BODY,
    fields: PORT_IN_FIELDS,
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
    errors: [
      { code: 400, when: 'Validation failure — e.g. chc=Y together with autoAct=Y, missing ONSP / due date / TN, or agauth=Y with no authorization date and name.' },
      { code: 503, when: 'IBM MQ send failure.' },
    ],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/modify/submit', soap: 'POST /workflow/portin/modify/submit',
    summary: 'Modify a Port In (SPR SUP=3)',
    description: 'Full replacement of an existing Port In — not a partial patch. Bumps the version and re-sends the request. Remarks are ALWAYS required, even when nothing else changes. Only for requests you submitted through the marketplace. Reference: ' + REF + 'portin-modify-submit',
    body: { ...PORT_IN_BODY, reqNo: 'YOUR-REQUEST-NO', submittingSpid: '346J', remarks: 'Corrected customer details.' },
    fields: [
      { name: 'reqNo', required: true, description: 'Existing request number.' },
      { name: 'remarks', required: true, description: 'Mandatory on modify, even for a no-field-change supplement.' },
      { name: 'submittingSpid', required: false, description: 'Must be the NNSP (new network). Defaults to the local SPID.' },
      ...PORT_IN_FIELDS.filter((f) => !['remarks', 'equipmentIdentifier'].includes(f.name)),
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
    errors: [{ code: 400, when: 'Missing remarks, wrong submitting SPID, or line validation failure.' }],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/change-due-date/submit', soap: 'POST /workflow/portin/change-due-date/submit',
    summary: 'Change due date/time (SPR SUP=2)',
    description: 'Changes only the desired due date on an existing Port In. Cheaper than a full Modify — use this when the date is the only thing moving. Only for requests you submitted through the marketplace. Reference: ' + REF + 'portin-change-due-date-submit',
    body: { reqNo: 'YOUR-REQUEST-NO', submittingSpid: '346J', desiredDueAt: '2026-09-20T15:00:00', remarks: 'Customer requested a later window.' },
    fields: [
      { name: 'reqNo', required: true, description: 'Existing request number.' },
      { name: 'desiredDueAt', required: true, description: 'New desired due date/time.' },
      { name: 'submittingSpid', required: false, description: 'Must be the NNSP. Defaults to the local SPID.' },
      { name: 'remarks', required: false, description: 'Optional for SUP=2.' },
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/cancel/submit', soap: 'POST /workflow/portin/cancel/submit',
    summary: 'Cancel a Port In (SPR SUP=1)',
    description: 'Cancels an existing Port In via a cancel supplement. Only valid from the NNSP perspective. This is not the same as Cancel Service, which is its own product flow. Only for requests you submitted through the marketplace. Reference: ' + REF + 'portin-cancel-submit',
    body: { reqNo: 'YOUR-REQUEST-NO', submittingSpid: '346J', remarks: 'Customer cancelled the port request.' },
    fields: [
      { name: 'reqNo', required: true, description: 'Existing request number.' },
      { name: 'submittingSpid', required: false, description: 'Must equal the request NNSP. Defaults to the local SPID.' },
      { name: 'remarks', required: false, description: 'Optional cancel remarks.' },
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portout/submit', soap: 'POST /workflow/portout/submit',
    summary: 'Submit a Port Out request (WPR / PQ2)',
    description: 'Creates an outbound Port Out. Ownership is reversed from Port In: you supply the NEW local / reseller / network identity, and your home SPID is the OLD network. Iristel staff only: port-outs act on other carriers\' requests. Reference: ' + REF + 'portout-submint',
    body: {
      reqNo: '346J123456789012', onsp: '346J', nnsp: 'BM03', nlsp: 'BM03', nrSellNm: 'Bell Mobility',
      desiredDueAt: '2026-09-20T12:00:00', npdi: 'A', agauth: 'Y',
      authorizationDate: '2026-08-07T00:00:00', authorizerName: 'Test Customer',
      init: 'API', impcon: 'WNPIRIS', telNoImpcon: '647-933-0967',
      billFirstName: 'Test', billLastName: 'Customer', billStreetNumber: '100',
      billStreetName: 'Test Street', city: 'Toronto', stateProvince: 'ON',
      zipCode: 'M5V1A1', country: 'CAN', chc: 'Y', lines: [{ portedNum: '867-458-2201', name: 'Test Customer' }],
    },
    fields: [
      { name: 'reqNo', required: true, description: 'Request number, max 17 characters.' },
      { name: 'onsp', required: true, description: 'Old Network — your home SPID.' },
      { name: 'nnsp', required: true, description: 'New Network — the remote SPID, e.g. BM03.' },
      { name: 'nlsp', required: true, description: 'New Local SPID, max 4 characters.' },
      { name: 'nrSellNm', required: true, description: 'New reseller name, max 20 characters.' },
      { name: 'desiredDueAt', required: true, description: 'Desired due date/time.' },
      { name: 'npdi', required: true, description: 'A = wireless→wireless, B = wireless→wireline.' },
      { name: 'exp', required: false, description: 'Expedite. Allowed for NPDI B; rejected for A. Not in the IristelX reference.' },
      { name: 'billStreetNumber', required: true, description: 'Street number — required on Port Out, unlike Port In.' },
      { name: 'businessName', required: false, description: 'Business name on the account, when the subscriber is a business.' },
      { name: 'accountNumber', required: false, description: 'Subscriber account number at the old carrier, max 20 alphanumeric.' },
      { name: 'passwordPin', required: false, description: 'Account PIN.' },
      { name: 'equipmentIdentifier', required: false, description: 'ESN / IMEI.' },
      { name: 'remarks', required: false, description: 'Free text, max 160 characters.' },
      { name: 'lines[].portedNum', required: true, description: 'Telephone number to port out.' },
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
    errors: [{ code: 400, when: 'Blank reqNo / nlsp / nrSellNm / nnsp, NPDI A with exp=Y, missing street number, or length violations.' }],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portout/response/submit', soap: 'POST /workflow/portout/response/submit',
    summary: 'Submit a Port Out response (WPRR / PR2)',
    description: 'Confirm, delay, or ask for resolution on a port out. Allocates a response number and sends PORT_RESPONSE XML. Iristel staff only: it answers another carrier\'s request. Reference: ' + REF + 'portout-response-submit',
    body: RESPONSE_BODY,
    fields: RESPONSE_FIELDS,
    returns: 'requestId, messageId, reqNo, respNo, responseType and messageSent.',
    errors: [{ code: 400, when: 'SPID or response-type rule violation — e.g. a Delay carrying line data, or a missing delay code.' }],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/cancel-svc/request/submit', soap: 'POST /workflow/cancel-svc/request/submit',
    summary: 'Submit a Cancel Service request',
    description: 'Creates a Cancel Service WPR. Same body as Port In, but the server forces cancel-service mode and ignores auto-activate, LRN and port-to-original. Distinct from cancelling a Port In. The marketplace records the new reqNo for your account, so only you (and Iristel staff) can see or change it. Reference: ' + REF + 'cancel-svc-requesst-submit',
    body: { ...PORT_IN_BODY, lrn: null, autoAct: '', retOssp: '', requireCancelService: true, lines: [{ portedNum: '867-458-2201', name: 'Test Customer' }] },
    fields: [
      { name: 'requireCancelService', required: false, description: 'Forced true by the server regardless of what you send.' },
      ...PORT_IN_FIELDS.filter((f) => !['lrn', 'autoAct', 'retOssp'].includes(f.name)),
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/cancel-svc/response/submit', soap: 'POST /workflow/cancel-svc/response/submit',
    summary: 'Submit a Cancel Service response',
    description: 'Responds to a Cancel Service request. Same shape as the Port Out response, but the target must be a Cancel Service request. A confirmed response moves to completion_pending without NPAC activation. Iristel staff only: it answers another carrier\'s request. Reference: ' + REF + 'cancel-svc-response-submit',
    body: { ...RESPONSE_BODY, reqNo: 'THEIR-REQUEST-NO', requireCancelService: true },
    fields: RESPONSE_FIELDS,
    returns: 'requestId, messageId, reqNo, respNo, responseType and messageSent.',
    errors: [{ code: 400, when: 'The target request is not a Cancel Service request.' }],
  },
];
