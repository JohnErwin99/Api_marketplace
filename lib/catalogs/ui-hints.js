'use strict';

/**
 * UI hints for the guided console.
 *
 * Keyed by product id, then by "METHOD path". Everything here is optional —
 * the console falls back to the catalog's own params/body/fields metadata
 * (Title-Case labels, required markers, descriptions as help text) — so a
 * product with no entry still gets guided forms, just plainer ones.
 *
 * Per-endpoint hint shape:
 *   title       friendly card title ("Add a 911 listing")
 *   icon        small glyph shown in the card header
 *   info        info-box text shown above the submit button
 *   confirm     confirmation prompt shown before sending (destructive ops)
 *   successMsg  banner template; {name} interpolates form values
 *   submitLabel button text (default: title)
 *   danger      true -> red submit button
 *   fields      per-field: { label, help, placeholder, enum: [[value,label]…],
 *               default, type: 'select'|'tel'|'textarea'|'number' }
 *   description / returns  copied onto the catalog endpoint at startup when
 *               the generated catalog leaves them empty (IristelX imports)
 *
 * `product` under each id: { blurb } for the console header. Product names
 * come only from lib/catalogs/index.js, so they read the same everywhere.
 */

const PROVINCES = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'],
  ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

const E911_LISTING_FIELDS = {
  id: { label: 'Phone number', type: 'tel', placeholder: '4165551212', help: '10 digits, no spaces or punctuation.' },
  language: { label: 'Language', enum: [['EN', 'English'], ['FR', 'French']] },
  first_name: { label: 'First name', placeholder: 'John' },
  last_name: { label: 'Last name', placeholder: 'Doe' },
  street_address: { label: 'Street address', placeholder: '456 Abc Street', help: 'Civic address — this is what 911 dispatch will see.' },
  city: { label: 'City', placeholder: 'Brampton' },
  state: { label: 'Province / State', enum: PROVINCES },
  zip: { label: 'Postal / ZIP code', placeholder: 'L6Y 2H6' },
  country: { label: 'Country', enum: [['CA', 'Canada'], ['US', 'United States']] },
  primary_addresss_validated: { label: 'Address validated', enum: [['Y', 'Yes'], ['N', 'No']], default: 'N' },
};

const E911_CODE = { label: 'Account code', placeholder: 'e.g. 5046353', help: 'The partner account the listing belongs to.' };
const E911_NUMBER = { label: 'Phone number', type: 'tel', placeholder: '4165551212', help: '10 digits, no spaces or punctuation.' };

module.exports = {
  e911: {
    product: {
      blurb: 'Manage the address records dispatch sees on a 911 call: add, look up, update, delete, or bulk-upload listings.',
    },
    'POST /911-info': {
      title: 'Add Listing', icon: '➕',
      info: 'All fields are required. The address must be a real civic address — it is what emergency dispatch will see.',
      successMsg: 'Listing created for {id}.',
      submitLabel: 'Add Listing',
      fields: { code: E911_CODE, ...E911_LISTING_FIELDS },
    },
    'GET /911-info': {
      title: 'Get Listing', icon: '🔍',
      successMsg: 'Listing found for {number}.',
      submitLabel: 'Retrieve Listing',
      fields: { code: E911_CODE, number: E911_NUMBER },
    },
    'PUT /911-info': {
      title: 'Update Listing', icon: '✏️',
      info: 'This is a full replacement — send the complete record, not just the changed fields.',
      successMsg: 'Listing updated for {id}.',
      submitLabel: 'Update Listing',
      fields: { code: E911_CODE, ...E911_LISTING_FIELDS },
    },
    'DELETE /911-info': {
      title: 'Delete Listing', icon: '🗑️', danger: true,
      info: 'This cannot be undone. Once deleted, 911 calls from this number carry no address to dispatch.',
      confirm: 'Permanently delete the 911 listing for {number}? Calls from that number will carry no address to dispatch.',
      successMsg: 'Listing deleted for {number}.',
      submitLabel: 'Delete Listing',
      fields: { code: E911_CODE, number: E911_NUMBER },
    },
    'POST /911-info/upload': {
      title: 'Bulk Upload (CSV)', icon: '📤',
      info: 'Each row carries its own OperationType: A = add, U = update, D = delete. The response is one result row per input row — partial success is normal, check every row.',
      successMsg: 'File processed — check the per-row results below.',
      submitLabel: 'Upload File',
      csvTemplate: {
        filename: '911-listings-template.csv',
        header: 'OperationType,accountCode,Id,Language,First_name,Last_name,Street_address,City,State,Zip,Country,Primary_addresss_validated',
        example: 'A,5046353,4165551212,EN,Test,Subscriber,456 Abc Street,Brampton,ON,L6Y2H6,CA,N',
      },
    },
  },

  'lnp-enterprise': {
    product: {
      blurb: 'Create wireline porting requests (PONs), track them, correct rejections, and activate on the due date.',
    },
  },

  'lnp-wireless': {
    product: {
      blurb: 'Submit and track wireless port-in and port-out requests through the WLNP workflow. The gateway adds the WLNP key for you.',
    },
  },

  'did-orders': {
    product: {
      blurb: 'Order DIDs on Espresso\'s API: search available numbers, place an order, and collect the numbers once it completes. You see only the orders you placed.',
    },
    'GET /api/did-orders/health': { title: 'Check the connection', icon: '🩺' },
    'GET /api/did-orders/routing-profiles': { title: 'List routing profiles', icon: '🧭' },
    'GET /api/did-orders/available': {
      title: 'Search available numbers', icon: '🔎',
      info: 'Searching reserves nothing: numbers are only held once you create an order.',
      fields: {
        prefix: { label: 'Prefix', placeholder: '1416', help: 'Leading digits, with or without the 1.' },
        ratecenter: { label: 'Rate centre', placeholder: 'Toronto' },
        region: { label: 'Province', enum: PROVINCES },
        limit: { label: 'How many', type: 'number', placeholder: '20', help: '1 to 100.' },
        offset: { label: 'Skip', type: 'number', placeholder: '0', help: 'For the next page: add the limit.' },
      },
    },
    'POST /api/did-orders/orders': {
      title: 'Create a DID order', icon: '🛒',
      info: 'In production this orders real numbers on Iristel\'s account. The gateway adds the company, country and OCN.',
      successMsg: 'Order created. Poll Get an order until it is COMPLETED.',
    },
    'GET /api/did-orders/orders': {
      title: 'List your orders', icon: '📋',
      fields: {
        page: { label: 'Page', type: 'number', placeholder: '1' },
        size: { label: 'Per page', type: 'number', placeholder: '20', help: '1 to 50.' },
      },
    },
    'GET /api/did-orders/orders/:orderId': {
      title: 'Get an order', icon: '🔍',
      fields: { orderId: { label: 'Order id or number', placeholder: 'ORD-261020-3FA94C0B12DE' } },
    },
    'POST /api/did-orders/orders/:orderId/complete': {
      title: 'Complete an order', icon: '✅',
      info: 'Only for orders created with selectDids true, within an hour of the reservation. To keep every reserved number, replace the body with {}.',
      fields: { orderId: { label: 'Order id or number' } },
    },
    'POST /api/did-orders/orders/:orderId/cancel': {
      title: 'Cancel an order', icon: '🛑', danger: true,
      confirm: 'Cancel order {orderId}? Its reserved numbers are released.',
      fields: {
        orderId: { label: 'Order id or number' },
        reason: { label: 'Reason', placeholder: 'Customer changed their mind' },
      },
    },
  },

  lrn: {
    product: {
      blurb: 'Look up the LRN and current carrier of any Canadian or US number, with its porting history on the Premium lookup.',
    },
    'GET /api/lrn/basic/:number': {
      title: 'Basic LRN lookup', icon: '📍',
      fields: { number: { label: 'Phone number', type: 'tel', placeholder: '4168004747', help: '10 digits, or 11 starting with 1.' } },
    },
    'GET /api/lrn/history/:number': {
      title: 'LRN lookup with history', icon: '🕘',
      fields: { number: { label: 'Phone number', type: 'tel', placeholder: '4168004747', help: '10 digits, or 11 starting with 1.' } },
    },
    'POST /api/lrn/history': { title: 'Bulk lookup with history', icon: '📚' },
  },

  provisioning: {
    product: {
      blurb: 'Provision trunks and send welcome letters through the uBoss robot.',
    },
  },

  'iristelx-accounts': {
    product: {
      blurb: 'Create and manage customer accounts, services, and their lifecycle on IristelX.',
    },
  },
  'iristelx-sim': {
    product: {
      blurb: 'Order, activate, and manage physical SIMs and eSIM profiles.',
    },
  },
  'iristelx-commission': {
    product: {
      blurb: 'Commission detail rows for your agent ID over a date range: one row per invoiced service, with the base amount and your percentage.',
    },
    'GET /commission/:agentId/:startDate/:endDate': {
      title: 'My commission detail', icon: '💰',
      description: 'Returns the commission rows for one agent between two dates: one row per invoiced service line, with the base amount and the commission percentage. Use your own agent ID; the dates go in the URL path, not the query string. Results are paged with limit and offset.',
      returns: '{ data: [ { LINE_DESC, ACCOUNT_CODE, ACCOUNTNAME, AGENT_NAME, BASE_AMOUNT, PERCENTAGE, SYMBOL, COMMISSIONSYMBOL, PRECISION, AS_FIRSTACTDATE, INV_DATE } ] } — one row per invoiced service line. Commission per row = BASE_AMOUNT × PERCENTAGE ÷ 100.',
      info: 'Commission = Base amount × Percentage ÷ 100',
      fields: {
        agentId: { label: 'Agent ID', help: 'Your agent number — Iris and the console fill it from your account' },
        startDate: { label: 'Start date', placeholder: '2026-09-01', help: 'YYYY-MM-DD, part of the URL path' },
        endDate: { label: 'End date', placeholder: '2026-09-30', help: 'YYYY-MM-DD, part of the URL path' },
        limit: { label: 'Limit', type: 'number', placeholder: '500', help: 'Rows per page. Request this many rows, then raise offset by the same amount until a page comes back with fewer rows.' },
        offset: { label: 'Offset', type: 'number', placeholder: '0', help: 'Rows to skip. Start at 0 and add limit for each next page; a short page means you have everything.' },
      },
    },
    'GET /commission/agents': {
      title: 'All agents\' commission rows (staff reporting)',
      description: 'Returns every agent\'s commission rows for the period, each tagged with AGENT_ID. Intended for Iristel staff reporting across all agents, not for a single agent\'s own figures. Paged with page and limit.',
      fields: {
        startDate: { label: 'Start date', placeholder: '2026-09-01', help: 'YYYY-MM-DD' },
        endDate: { label: 'End date', placeholder: '2026-09-30', help: 'YYYY-MM-DD' },
        page: { label: 'Page', type: 'number', placeholder: '1', help: 'Page number, starting at 1. Ask for the next page until one comes back with fewer rows than limit.' },
        limit: { label: 'Limit', type: 'number', placeholder: '500', help: 'Rows per page.' },
      },
    },
    'GET /agent-commissions': {
      title: 'Agent commission records',
    },
  },
  'iristelx-mobile': {
    product: {
      blurb: 'What subscribers see in the Iristel mobile app: plans and usage, eSIM QR codes, number port-in, notifications, payments and support tickets.',
    },
  },
};
