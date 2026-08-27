'use strict';

/**
 * Number Porting — Wireless (WLNP).
 *
 * Canadian wireless number portability (CWNPG / Syniverse ICP). The upstream
 * WLNP Workflow API is on a private address; every path here is served through
 * the gateway proxy at /api/wlnp/*, so callers only use the gateway base URL.
 */

const LINE = { portedNum: '867-458-1128', name: 'Test Customer' };

const PORT_IN_BODY = {
  onsp: 'BM03',
  desiredDueAt: '2026-09-20T12:00:00',
  nlsp: 'ICW1',
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
  { name: 'nlsp', required: false, description: 'New Local SPID — usually your home SP (ICW1). A remote SPID is rejected.' },
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
  { name: 'eumi', required: false, description: 'Customer moving indicator — used with NPDI C.' },
  { name: 'dsl', required: false, description: 'DSL indicator — used with NPDI C.' },
  { name: 'lines[].portedNum', required: true, description: 'Telephone number to port.' },
  { name: 'lines[].name', required: false, description: 'Subscriber name for the line.' },
  { name: 'remarks', required: false, description: 'Free text, max 160 characters.' },
];

const RESPONSE_BODY = {
  reqNo: 'ICW1YOURREQNO001',
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
  { name: 'dcode', required: false, description: 'Delay code — required when responseType=D. One of 6G, 6H, 6J, 6L, 8J.' },
  { name: 'lines', required: false, description: 'Empty array for Delay. For Resolution Required, per-line rcode + rdet (rdet max 60).' },
  { name: 'lines[].rcode', required: false, description: 'Resolution code. RCODE 1P also requires remarks.' },
];

module.exports = [
  {
    method: 'GET', path: '/api/wlnp/api/health', soap: 'HealthCheck',
    summary: 'Health check',
    description: 'Liveness probe for the WLNP Workflow API. Confirms the service is up and whether its database is reachable. Use it to tell "the gateway cannot reach WLNP" apart from "WLNP is up but rejecting my request".',
    returns: 'service, status (ok / degraded), serviceProvider, database and targetFramework.',
    errors: [
      { code: 503, when: 'Service up but its database is unreachable.' },
      { code: 504, when: 'Gateway could not reach the WLNP API at all (private network).' },
    ],
  },
  {
    method: 'GET', path: '/api/wlnp/api/port-selection', soap: 'PortSelectionMainGrid',
    summary: 'Port Selection grid',
    description: 'The rows behind the ICP Port Selection screen. Use it to find a request before opening its details.',
    params: [
      { name: 'RequestNumber', in: 'query', required: false, description: 'Filter by request number. Empty returns all.' },
      { name: 'PortType', in: 'query', required: false, description: 'Port direction filter: portIn, portOut, IN, PORT_IN …' },
      { name: 'HomeSpid', in: 'query', required: false, description: 'Home SPID override. Defaults to the configured service provider.' },
      { name: 'PortedTn', in: 'query', required: false, description: 'Substring match on any request line TN — not an exact match.' },
    ],
    returns: 'total, items, homeSpid and portFilter.',
  },
  {
    method: 'GET', path: '/api/wlnp/api/port-details', soap: 'PortDetailsByRequestNumber',
    summary: 'Port details by request number',
    description: 'Full detail for one port request: customer billing fields, WPR snapshot, and request lines. Read-only.',
    params: [{ name: 'requestNumber', in: 'query', required: true, description: 'Port request number (REQ_NO).' }],
    returns: 'requestId, requestNumber, status, NPDI/CHC/EXP flags, desired due date, billing fields, ONSP/NNSP/NLSP, verIdReq and lines[].',
    errors: [
      { code: 400, when: 'requestNumber missing or blank.' },
      { code: 404, when: 'No request exists for that number.' },
    ],
  },
  {
    method: 'GET', path: '/api/wlnp/api/icp-soa-errors', soap: 'IcpSoaErrorsMainGrid',
    summary: 'ICP / SOA errors grid',
    description: 'MPE fallout and ICP→SOA error rows. Check here when a request looks stuck with no obvious rejection.',
    params: [{ name: 'RequestNumber', in: 'query', required: false, description: 'Filter to one request number. Empty returns the full grid.' }],
    returns: 'total and items.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/submit', soap: 'PortInSubmit',
    summary: 'Submit a Port In request (WPR / PQI)',
    description: 'Creates an outbound Port In — the equivalent of Syniverse "Create Port In Request". Persists the WPR, builds PORT_REQUEST XML and puts it on IBM MQ.',
    body: PORT_IN_BODY,
    fields: PORT_IN_FIELDS,
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
    errors: [
      { code: 400, when: 'Validation failure — e.g. chc=Y together with autoAct=Y, missing ONSP / due date / TN, or agauth=Y with no authorization date and name.' },
      { code: 503, when: 'IBM MQ send failure.' },
    ],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/modify/submit', soap: 'PortInModifySubmit',
    summary: 'Modify a Port In (SPR SUP=3)',
    description: 'Full replacement of an existing Port In — not a partial patch. Bumps the version and re-sends the request. Remarks are ALWAYS required, even when nothing else changes.',
    body: { ...PORT_IN_BODY, reqNo: 'ICW1YOURREQNO001', submittingSpid: 'ICW1', remarks: 'Corrected customer details.' },
    fields: [
      { name: 'reqNo', required: true, description: 'Existing request number.' },
      { name: 'remarks', required: true, description: 'Mandatory on modify, even for a no-field-change supplement.' },
      { name: 'submittingSpid', required: false, description: 'Must be the NNSP (new network). Defaults to the local SPID.' },
      ...PORT_IN_FIELDS.filter((f) => f.name !== 'remarks'),
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
    errors: [{ code: 400, when: 'Missing remarks, wrong submitting SPID, or line validation failure.' }],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/change-due-date/submit', soap: 'PortInChangeDueDateSubmit',
    summary: 'Change due date/time (SPR SUP=2)',
    description: 'Changes only the desired due date on an existing Port In. Cheaper than a full Modify — use this when the date is the only thing moving.',
    body: { reqNo: 'ICW1YOURREQNO001', submittingSpid: 'ICW1', desiredDueAt: '2026-09-20T15:00:00', remarks: 'Customer requested a later window.' },
    fields: [
      { name: 'reqNo', required: true, description: 'Existing request number.' },
      { name: 'desiredDueAt', required: true, description: 'New desired due date/time.' },
      { name: 'submittingSpid', required: false, description: 'Must be the NNSP. Defaults to the local SPID.' },
      { name: 'remarks', required: false, description: 'Optional for SUP=2.' },
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portin/cancel/submit', soap: 'PortInCancelSubmit',
    summary: 'Cancel a Port In (SPR SUP=1)',
    description: 'Cancels an existing Port In via a cancel supplement. Only valid from the NNSP perspective. This is not the same as Cancel Service, which is its own product flow.',
    body: { reqNo: 'ICW1YOURREQNO001', submittingSpid: 'ICW1', remarks: 'Customer cancelled the port request.' },
    fields: [
      { name: 'reqNo', required: true, description: 'Existing request number.' },
      { name: 'submittingSpid', required: false, description: 'Must equal the request NNSP. Defaults to the local SPID.' },
      { name: 'remarks', required: false, description: 'Optional cancel remarks.' },
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portout/submit', soap: 'PortOutSubmit',
    summary: 'Submit a Port Out request (WPR / PQ2)',
    description: 'Creates an outbound Port Out. Ownership is reversed from Port In: you supply the NEW local / reseller / network identity, and your home SPID is the OLD network.',
    body: {
      reqNo: 'ICW1123456789012', onsp: 'ICW1', nnsp: 'BM03', nlsp: 'BM03', nrSellNm: 'Bell Mobility',
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
      { name: 'exp', required: false, description: 'Expedite. Allowed for NPDI B; rejected for A.' },
      { name: 'billStreetNumber', required: true, description: 'Street number — required on Port Out, unlike Port In.' },
      { name: 'lines[].portedNum', required: true, description: 'Telephone number to port out.' },
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
    errors: [{ code: 400, when: 'Blank reqNo / nlsp / nrSellNm / nnsp, NPDI A with exp=Y, missing street number, or length violations.' }],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/portout/response/submit', soap: 'PortOutResponseSubmit',
    summary: 'Submit a Port Out response (WPRR / PR2)',
    description: 'Confirm, delay, or ask for resolution on a port out. Allocates a response number and sends PORT_RESPONSE XML.',
    body: RESPONSE_BODY,
    fields: RESPONSE_FIELDS,
    returns: 'requestId, messageId, reqNo, respNo, responseType and messageSent.',
    errors: [{ code: 400, when: 'SPID or response-type rule violation — e.g. a Delay carrying line data, or a missing delay code.' }],
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/cancel-svc/request/submit', soap: 'CancelSvcRequestSubmit',
    summary: 'Submit a Cancel Service request',
    description: 'Creates a Cancel Service WPR. Same body as Port In, but the server forces cancel-service mode and ignores auto-activate, LRN and port-to-original. Distinct from cancelling a Port In.',
    body: { ...PORT_IN_BODY, lrn: null, autoAct: '', retOssp: '', requireCancelService: true, lines: [{ portedNum: '867-458-2201', name: 'Test Customer' }] },
    fields: [
      { name: 'requireCancelService', required: false, description: 'Forced true by the server regardless of what you send.' },
      ...PORT_IN_FIELDS.filter((f) => !['lrn', 'autoAct', 'retOssp'].includes(f.name)),
    ],
    returns: 'requestId, messageId, reqNo, verIdReq and messageSent.',
  },
  {
    method: 'POST', path: '/api/wlnp/workflow/cancel-svc/response/submit', soap: 'CancelSvcResponseSubmit',
    summary: 'Submit a Cancel Service response',
    description: 'Responds to a Cancel Service request. Same shape as the Port Out response, but the target must be a Cancel Service request. A confirmed response moves to completion_pending without NPAC activation.',
    body: { ...RESPONSE_BODY, reqNo: 'ICW1YOURCANCEL001', requireCancelService: true },
    fields: RESPONSE_FIELDS,
    returns: 'requestId, messageId, reqNo, respNo, responseType and messageSent.',
    errors: [{ code: 400, when: 'The target request is not a Cancel Service request.' }],
  },
];
