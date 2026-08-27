'use strict';

/**
 * 911 & E911 emergency listings.
 *
 * This API is public-facing and called directly by the client — the gateway
 * does not proxy it. Auth is an `x-api-key` header plus the account code as a
 * query parameter; the account code identifies which partner account a listing
 * belongs to and is required on every call.
 */

const LISTING_BODY = {
  id: 4165551212,
  language: 'EN',
  first_name: 'Test',
  last_name: 'Subscriber',
  street_address: '456 Abc Street',
  city: 'Brampton',
  state: 'ON',
  zip: 'L6Y2H6',
  country: 'CA',
  primary_addresss_validated: 'N',
};

const LISTING_FIELDS = [
  { name: 'id', required: true, description: 'Telephone number, exactly 10 digits, sent as a number (not a string).' },
  { name: 'language', required: true, description: 'Subscriber language, EN or FR.' },
  { name: 'first_name', required: true, description: 'Subscriber first name.' },
  { name: 'last_name', required: true, description: 'Subscriber last name.' },
  { name: 'street_address', required: true, description: 'Civic address — street number and name.' },
  { name: 'city', required: true, description: 'City.' },
  { name: 'state', required: true, description: 'Province / state code.' },
  { name: 'zip', required: true, description: 'Postal / ZIP code.' },
  { name: 'country', required: true, description: 'Country code, e.g. CA.' },
  { name: 'primary_addresss_validated', required: true, description: 'Y or N. Note the field name carries a triple "s" — that spelling is what the API expects.' },
];

const ACCOUNT_CODE = {
  name: 'code', in: 'query', required: true,
  description: 'Account code the listing belongs to. In the partner portal this comes from the `code` cookie; an account may carry several.',
};

module.exports = [
  {
    method: 'GET', path: '/911-info', soap: 'get911Listing',
    summary: 'Retrieve a 911 listing',
    description: 'Fetches the emergency listing on file for a telephone number. If the number is not registered under the given account code, the API answers with an error payload rather than a 404 — treat any error here as "not found".',
    params: [
      ACCOUNT_CODE,
      { name: 'number', in: 'query', required: true, description: '10-digit telephone number to look up.' },
    ],
    returns: 'The listing: id, language, names, address, validation flag, and created / modified / activated timestamps.',
    errors: [{ code: 401, when: 'Missing or invalid x-api-key.' }],
  },
  {
    method: 'POST', path: '/911-info', soap: 'add911Listing',
    summary: 'Add a 911 listing',
    description: 'Registers a new emergency listing for a telephone number. The address is what dispatch will see, so it must be a real civic address.',
    params: [ACCOUNT_CODE],
    body: LISTING_BODY,
    fields: LISTING_FIELDS,
    returns: 'The created listing.',
    errors: [{ code: 409, when: 'A listing already exists for this number — use PUT to change it.' }],
  },
  {
    method: 'PUT', path: '/911-info', soap: 'update911Listing',
    summary: 'Update a 911 listing',
    description: 'Replaces the listing for the telephone number in the body. Send the complete record: this is a full replacement, not a partial update.',
    params: [ACCOUNT_CODE],
    body: LISTING_BODY,
    fields: LISTING_FIELDS,
    returns: 'The updated listing.',
  },
  {
    method: 'DELETE', path: '/911-info', soap: 'delete911Listing',
    summary: 'Delete a 911 listing',
    description: 'Permanently removes the emergency listing for a number. Once deleted, calls from that number carry no address to dispatch — this cannot be undone.',
    params: [
      ACCOUNT_CODE,
      { name: 'number', in: 'query', required: true, description: '10-digit telephone number whose listing is removed.' },
    ],
    returns: '"Success" when the listing was removed.',
  },
  {
    method: 'POST', path: '/911-info/upload', soap: 'bulk911Upload',
    summary: 'Bulk upload listings (CSV)',
    description:
      'Uploads a CSV of listings as multipart/form-data under the field name "file". Every row carries its own OperationType — A to add, U to update, D to delete — and an accountCode column. ' +
      'Header row: OperationType, accountCode, Id, Language, First_name, Last_name, Street_address, City, State, Zip, Country, Primary_addresss_validated. ' +
      'The response is one result row per input row, so a partial success is normal: check every row rather than the HTTP status.',
    returns: 'Array of { Id, Status, ErrorMessage } — one entry per CSV row.',
    upload: { field: 'file', accept: '.csv' },
    errors: [{ code: 400, when: 'The file could not be parsed as CSV.' }],
  },
];
