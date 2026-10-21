'use strict';

/**
 * DID Orders — ordering phone numbers on Espresso's REST API
 * (lib/routes/did-orders.js). Reference:
 * https://api.espressodid.com/ws/v1/dids/orders/ (orders),
 * https://api.espressodid.com/ws/v1/network/ (routing profiles) and the
 * /ws/v1/dids/inventory/ search. It replaces Phone Numbers (DIDs), the
 * Espresso SOAP product, once it is switched on.
 *
 * Orders are placed on Iristel's Espresso company: the gateway adds the
 * company, country and OCN, and records who placed each order. A partner
 * sees and acts on only their own orders; Iristel staff see all of them.
 */

const ORDER_ID = {
  name: 'orderId', in: 'path', required: true,
  description: 'The order id (a UUID, returned as id when you create the order) or its order number (ORD-261020-3FA94C0B12DE).',
};
const NOT_YOURS = { code: 404, when: 'not_found: no such order on your account. You can only use orders you placed through the marketplace.' };
const STATUSES = 'PENDING (numbers being reserved, or waiting for complete when selectDids is true) · PROCESSING · COMPLETED · REJECTED (see rejectionReason) · FAILED (see failureReason) · CANCELLED · EXPIRED (the one-hour reservation ran out)';

module.exports = [
  {
    method: 'GET', path: '/api/did-orders/health', upstream: 'POST /ws/v1/auth/token + GET /ws/v1/general/companies',
    summary: 'Check the connection',
    description: 'Confirms the gateway can sign in to Espresso\'s new API and knows which company to order on. Use it first when setting up.',
    returns: '{ ok: true, environment: "sandbox" | "production" }',
  },
  {
    method: 'GET', path: '/api/did-orders/routing-profiles', upstream: 'GET /ws/v1/network/routing_profiles',
    summary: 'List routing profiles',
    description: 'The active DID routing profiles you can order numbers on. Pass one\'s id as routingProfileId when you create an order, or leave routingProfileId out to use Iristel\'s default.',
    returns: '{ data: [{ id, label, format, active }], total }',
  },
  {
    method: 'GET', path: '/api/did-orders/available', upstream: 'POST /ws/v1/dids/inventory/search',
    summary: 'Search available numbers',
    description: 'Lists numbers you can order now. Filter by prefix, rate centre or province; filters combine with AND. Nothing is reserved until you create an order.',
    params: [
      { name: 'prefix', in: 'query', required: false, description: 'Leading digits including the 1, e.g. 1416 or 1416555.' },
      { name: 'ratecenter', in: 'query', required: false, description: 'Rate centre name, e.g. Toronto.' },
      { name: 'region', in: 'query', required: false, description: 'Province or state code, e.g. ON.' },
      { name: 'limit', in: 'query', required: false, description: 'How many numbers to return, 1 to 100 (default 20).' },
      { name: 'offset', in: 'query', required: false, description: 'How many to skip, for the next page (default 0).' },
    ],
    returns: '{ data: [{ number }], limit, offset }. A page can hold fewer than limit numbers; ask for the next one with offset + limit.',
  },
  {
    method: 'POST', path: '/api/did-orders/orders', upstream: 'POST /ws/v1/dids/orders',
    summary: 'Create a DID order',
    description: 'Reserves numbers for each number request, then assigns them. With selectDids false (the default) the order completes on its own; with selectDids true it waits so you can pick which reserved numbers to keep (Complete an order). Up to 1000 numbers per order.',
    body: {
      acquisitionType: 'BUY',
      selectDids: false,
      reference: 'PO-2026-0042',
      numberRequests: [
        { quantity: 2, filters: [{ categoryName: 'ratecenter', categoryValue: 'Toronto,ON' }] },
        { quantity: 1, filters: [{ categoryName: 'did', categoryValue: ['14165550100'] }] },
      ],
    },
    fields: [
      { name: 'numberRequests[].quantity', required: true, description: 'How many numbers this request reserves (1 to 1000; at most 1000 in the whole order).' },
      { name: 'numberRequests[].filters[]', required: true, description: 'Which numbers: { categoryName, categoryValue } pairs, combined with AND. categoryName is prefix (1416), ratecenter ("Toronto,ON"), region (ON), exchange, did (a list of exact numbers from Search available numbers) or did_range ("14168004747:14168004999").' },
      { name: 'routingProfileId', required: false, description: 'A routing profile id from List routing profiles. Leave it out to use Iristel\'s default profile.' },
      { name: 'acquisitionType', required: false, description: 'BUY (default) or LEASE, for the whole order.' },
      { name: 'selectDids', required: false, description: 'false (default): the order completes on its own. true: it waits up to an hour for Complete an order, so you can choose which reserved numbers to keep.' },
      { name: 'reference', required: false, description: 'Your own reference, e.g. a PO number (up to 235 bytes). The gateway puts its own tag in front (mp-…), which lets it find the order again if Espresso\'s answer is lost.' },
    ],
    returns: `202 with the order: id, orderNumber, status, numberRequests and numbers (empty until reserved). Statuses: ${STATUSES}. Poll Get an order until it is final.`,
    errors: [
      { code: 400, when: 'validation_error (from the gateway) or espresso_error with code VALIDATION_ERROR or INVALID_ROUTING_PROFILE: a field is missing or wrong; errors[].path says which.' },
      { code: 409, when: 'espresso_error, code ADMISSION_LIMIT: too many open orders on the account. Wait for some to finish.' },
      { code: 503, when: 'order_unconfirmed: Espresso didn\'t confirm the order but may have placed it. Don\'t order again: check List your orders a few minutes later.' },
    ],
  },
  {
    method: 'GET', path: '/api/did-orders/orders', upstream: 'GET /ws/v1/dids/orders',
    summary: 'List your orders',
    description: 'Your DID orders, most recent first, without their number lists (use Get an order for those).',
    params: [
      { name: 'page', in: 'query', required: false, description: 'Page number, starting at 1.' },
      { name: 'size', in: 'query', required: false, description: 'Orders per page, 1 to 50 (default 20).' },
    ],
    returns: '{ data: [order summaries: id, orderNumber, status, totalOrderedQty, totalReservedQty, totalAssignedQty, reference, createdAt, …], total, page, size }, plus unconfirmed: [{ reference, sentAt }] while an order Espresso didn\'t confirm is still being looked for.',
  },
  {
    method: 'GET', path: '/api/did-orders/orders/:orderId', upstream: 'GET /ws/v1/dids/orders/{id}',
    summary: 'Get an order',
    description: 'One order with its number requests and numbers. Poll it after creating or completing an order; numbers with status ASSIGNED are yours.',
    params: [ORDER_ID],
    returns: `The order: status (${STATUSES}), canComplete, reservationExpiresAt, rejectionReason, failureReason, numberRequests [{ id, quantity, filters, reservedQty, error }] and numbers [{ did, status: RESERVED | NOT_SELECTED | ASSIGNED | RELEASED }].`,
    errors: [NOT_YOURS],
  },
  {
    method: 'POST', path: '/api/did-orders/orders/:orderId/complete', upstream: 'POST /ws/v1/dids/orders/{id}/complete',
    summary: 'Complete an order',
    description: 'For orders created with selectDids true: assigns the reserved numbers and sets up their routing. Send numbers to keep only some of them; the others are released. Do it before reservationExpiresAt (one hour).',
    precondition: 'The order is PENDING with canComplete true.',
    params: [ORDER_ID],
    body: { numbers: ['14165550100', '14165550103'] },
    fields: [
      { name: 'numbers[]', required: false, description: 'The reserved numbers to keep. Send {} (or, from code, no body) to keep all of them.' },
    ],
    returns: '202 with the order, now PROCESSING. Poll Get an order until COMPLETED.',
    errors: [
      NOT_YOURS,
      { code: 409, when: 'espresso_error, code COMPLETION_NOT_ALLOWED: the order was created with selectDids false and completes on its own.' },
      { code: 409, when: 'espresso_error, code INELIGIBLE_STATUS: the order is not waiting to be completed.' },
      { code: 409, when: 'espresso_error, code RESERVATION_EXPIRED: the hour ran out and the order is now EXPIRED. Create a new order.' },
      { code: 409, when: 'espresso_error, code ORDER_BUSY: the order is being processed. Try again shortly.' },
    ],
  },
  {
    method: 'POST', path: '/api/did-orders/orders/:orderId/cancel', upstream: 'POST /ws/v1/dids/orders/{id}/cancel',
    summary: 'Cancel an order',
    description: 'Cancels a PENDING order that isn\'t reserving numbers at this moment, and releases its numbers. Cancelling an order that is already cancelled changes nothing.',
    precondition: 'The order is PENDING.',
    params: [ORDER_ID],
    body: { reason: 'Customer changed their mind' },
    fields: [
      { name: 'reason', required: false, description: 'Why it was cancelled (optional; longer than 1000 bytes is cut).' },
    ],
    returns: 'The order, now CANCELLED.',
    errors: [
      NOT_YOURS,
      { code: 409, when: 'espresso_error, code INELIGIBLE_STATUS: the order can\'t be cancelled in its current status.' },
      { code: 409, when: 'espresso_error, code ORDER_BUSY: the order is being processed. Try again shortly.' },
    ],
  },
];
