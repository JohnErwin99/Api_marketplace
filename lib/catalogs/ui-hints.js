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
 *
 * `product` under each id: { title, blurb } for the console header.
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
      title: 'Emergency 911 listings',
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

  dids: {
    product: {
      title: 'Phone numbers (DIDs)',
      blurb: 'Search the Espresso catalog, order numbers, and track your orders.',
    },
    'GET /api/orders': {
      title: 'List orders', icon: '📋',
      fields: {
        from: { label: 'From date', placeholder: '2026-08-01 00:00:00', help: 'Y-m-d H:i:s' },
        to: { label: 'To date', placeholder: '2026-08-31 23:59:59', help: 'Y-m-d H:i:s' },
      },
    },
    'GET /api/orders/:id': { title: 'Order details', icon: '🔍', fields: { id: { label: 'Order number', placeholder: 'DID1205280200006' } } },
    'GET /api/orders/:id/status': { title: 'Order status', icon: '⏱️', fields: { id: { label: 'Order number' } } },
    'POST /api/orders/:id/cancel': {
      title: 'Cancel order', icon: '🛑', danger: true,
      confirm: 'Cancel order {id}?',
      fields: { id: { label: 'Order number' } },
    },
  },

  'lnp-enterprise': {
    product: {
      title: 'Number porting — Enterprise',
      blurb: 'Create wireline porting requests (PONs), track them, correct rejections, and activate on the due date.',
    },
  },

  'lnp-wireless': {
    product: {
      title: 'Number porting — Wireless',
      blurb: 'Submit and track wireless port-in requests through the WLNP workflow — no credentials needed, the gateway signs for you.',
    },
  },

  provisioning: {
    product: {
      title: 'Provisioning (uBoss)',
      blurb: 'Provision trunks and send welcome letters through the uBoss robot.',
    },
  },

  'iristelx-accounts': {
    product: {
      title: 'IristelX — Accounts & Services',
      blurb: 'Create and manage customer accounts, services, and their lifecycle on IristelX.',
    },
  },
  'iristelx-sim': {
    product: {
      title: 'IristelX — SIM & eSIM',
      blurb: 'Order, activate, and manage physical SIMs and eSIM profiles.',
    },
  },
  'iristelx-addon': {
    product: {
      title: 'IristelX — Add-ons',
      blurb: 'Attach and manage add-on features on existing services.',
    },
  },
  'iristelx-commission': {
    product: {
      title: 'IristelX — Commissions',
      blurb: 'Query commission statements and payout details for your agent profile.',
    },
  },
  'iristelx-mobile': {
    product: {
      title: 'IristelX — Mobile App',
      blurb: 'Endpoints backing the IristelX mobile app experience.',
    },
  },
  'iristelx-bot': {
    product: {
      title: 'IristelX — Bot',
      blurb: 'Automation endpoints for the IristelX bot.',
    },
  },
};
