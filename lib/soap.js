'use strict';

/**
 * Thin SOAP client for the Espresso DID V3 web service.
 *
 * The service is classic NuSOAP (rpc / encoded), so we hand-build the SOAP
 * envelope rather than using node-soap, which is more reliable here and gives
 * us full control over the `Credentials` header and array encoding.
 */

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

// v3 carries the DID ordering methods, v4 the LNP (porting) methods. Both take
// the same Espresso credentials; only the endpoint (and therefore the derived
// namespace) differs.
const ENDPOINTS = {
  test: 'https://connect.espressodid.com/cloud/public/v3/test',
  production: 'https://connect.espressodid.com/cloud/public/v3/production',
};

const ENDPOINTS_V4 = {
  test: 'https://connect.espressodid.com/cloud/public/v4/test',
  production: 'https://connect.espressodid.com/cloud/public/v4/production',
};

const ENDPOINTS_BY_VERSION = { v3: ENDPOINTS, v4: ENDPOINTS_V4 };

// NuSOAP derives its target namespace + SOAPAction from the endpoint URL.
const nsFor = (endpoint) => `urn:${endpoint}`;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: true,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class AppError extends Error {
  constructor(status, error, message, meta = {}) {
    super(message);
    this.status = status;
    this.error = error;
    this.meta = meta;
  }
  toJSON() {
    return { error: this.error, message: this.message, ...this.meta };
  }
}

// Map Espresso app error codes (from the PDF) to HTTP status codes.
function codeToHttp(code) {
  const c = Number(code);
  if ([1, 2].includes(c)) return 401;           // auth
  if (c === 8) return 423;                        // account locked
  if ([4, 607].includes(c)) return 403;          // not entitled / option not enabled
  if ([3, 592].includes(c)) return 429;          // quota
  if (c === 5) return 503;                        // retry later
  if ([431, 451, 472, 511].includes(c)) return 404;
  if ([531, 551, 552, 605].includes(c)) return 409; // wrong order state
  if ([6, 593, 594, 595, 596, 604, 606, 608, 609, 610].includes(c)) return 422;
  return 400;
}

function extractCode(text) {
  const m = String(text).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const str = (name, v) => `<${name} xsi:type="xsd:string">${xmlEscape(v)}</${name}>`;
const int = (name, v) => `<${name} xsi:type="xsd:int">${Number(v)}</${name}>`;

/** Build the <item> list for a set of DID requests. */
function requestItems(requests = []) {
  return requests
    .map(
      (r) => `<item>` +
        str('ratecenter', r.ratecenter) +
        str('npa', r.npa) +
        int('quantity', r.quantity) +
        // prefix / country_prefix are deprecated + ignored by the server, but
        // the manual asks that they still be present for backward compat.
        str('prefix', r.prefix ?? '555#') +
        str('country_prefix', r.country_prefix ?? 'No') +
        `</item>`
    )
    .join('');
}

/** Build <didRequestArray> for didOrderDids (grouped by profile). */
function orderRequestArray(profiles = []) {
  const items = profiles
    .map(
      (p) => `<item>` +
        str('profile', p.profile ?? p.profile_id) +
        `<requests>${requestItems(p.requests)}</requests>` +
        `</item>`
    )
    .join('');
  return `<didRequestArray>${items}</didRequestArray>`;
}

// ---------------------------------------------------------------------------
// LNP (v4) structure builders
// ---------------------------------------------------------------------------

// Order matters to NuSOAP: emit every field the PDF lists, blank when absent.
const PON_FIELDS = [
  'service_type', 'current_provider_name', 'desired_due_date', 'auth_date',
  'end_user_name', 'house_number', 'street_directional', 'street_suffix',
  'street_name', 'street_type', 'descriptive_location', 'floor', 'room',
  'building', 'city', 'province_state', 'zip_code', 'comments',
  'losing_carrier_comments',
];

/** <item> list for pon_data.service_details. */
function serviceDetailItems(details = []) {
  return details
    .map(
      (d) => `<item xsi:type="ns1:lnpSdStructure">` +
        str('activity', d.activity ?? 'Port') +
        str('existing_account_number', d.existing_account_number ?? '') +
        str('start_number', d.start_number ?? '') +
        str('end_number', d.end_number ?? '') +
        `</item>`
    )
    .join('');
}

/** <pon_data> — the porting request body shared by create and edit. */
function ponStructure(ponData = {}) {
  const fields = PON_FIELDS.map((f) => str(f, ponData[f] ?? '')).join('');
  const details = ponData.service_details || [];
  return `<pon_data xsi:type="ns1:lnpPonStructure">` +
    fields +
    `<service_details SOAP-ENC:arrayType="ns1:lnpSdStructure[${details.length}]" xsi:type="ns1:lnpSdStructureArray">` +
      serviceDetailItems(details) +
    `</service_details>` +
    `</pon_data>`;
}

/** <routing> — default profile plus optional per-number overrides. */
function routingStructure(routing = {}) {
  const details = routing.details || [];
  const items = details
    .map(
      (d) => `<item xsi:type="ns1:lnpRoutingDetails">` +
        str('start_number', d.start_number ?? '') +
        str('end_number', d.end_number ?? '') +
        int('routing_profile', d.routing_profile) +
        `</item>`
    )
    .join('');
  return `<routing xsi:type="ns1:lnpRoutingStructure">` +
    int('default_routing_profile', routing.default_routing_profile) +
    `<details SOAP-ENC:arrayType="ns1:lnpRoutingDetails[${details.length}]" xsi:type="ns1:lnpRoutingDetailsArray">` +
      items +
    `</details>` +
    `</routing>`;
}

function envelope(method, innerXml, creds, ns) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:urn="${ns}" xmlns:ns1="${ns}">
  <soapenv:Header>
    <Credentials><username>${xmlEscape(creds.username)}</username><password>${xmlEscape(creds.password)}</password></Credentials>
  </soapenv:Header>
  <soapenv:Body soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <urn:${method}>${innerXml}</urn:${method}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** Collapse rpc/encoded `{ item: [...] }` wrappers into plain arrays. */
function normalize(node) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map(normalize);
  if (typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === 'item') {
      const it = node.item;
      return (Array.isArray(it) ? it : [it]).map(normalize);
    }
    const out = {};
    for (const k of keys) out[k] = normalize(node[k]);
    return out;
  }
  return node;
}

function isEmpty(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function parseResponse(raw, method) {
  let obj;
  try {
    obj = parser.parse(raw);
  } catch (e) {
    throw new AppError(502, 'bad_gateway', 'Could not parse SOAP response from Espresso', {
      raw: String(raw).slice(0, 800),
    });
  }

  const env = obj.Envelope || obj;
  const body = (env && env.Body) || {};

  // SOAP fault
  if (body.Fault) {
    const fs = body.Fault.faultstring ?? body.Fault.faultString ?? JSON.stringify(body.Fault);
    const code = extractCode(fs);
    throw new AppError(codeToHttp(code), 'espresso_fault', String(fs), code ? { code } : {});
  }

  const respKey = Object.keys(body).find((k) => k.endsWith('Response'));
  if (!respKey) {
    // No SOAP Body/Response and no Fault — likely an HTML error page, a proxy
    // block, or an auth wall in front of the endpoint.
    throw new AppError(502, 'bad_gateway', 'Unexpected non-SOAP response from Espresso', {
      raw: String(raw).slice(0, 800),
    });
  }
  const resp = body[respKey] || {};

  // Espresso returns an `errors` part alongside `return`.
  if (resp.errors && !isEmpty(resp.errors)) {
    const errs = normalize(resp.errors);
    const first = Array.isArray(errs) ? errs[0] : errs;
    const code = first?.code ?? first?.errorCode ?? extractCode(JSON.stringify(errs));
    const message = first?.message ?? first?.errorMessage ?? 'Espresso returned an error';
    throw new AppError(codeToHttp(code), 'espresso_error', String(message), {
      code: code ?? undefined,
      errors: errs,
    });
  }

  return normalize(resp.return);
}

// ---------------------------------------------------------------------------
// Public call()
// ---------------------------------------------------------------------------

async function call(method, innerXml, creds, env = 'test', version = 'v3') {
  if (!creds || !creds.username || !creds.password) {
    throw new AppError(401, 'missing_credentials', 'No Espresso credentials provided');
  }
  const table = ENDPOINTS_BY_VERSION[version] || ENDPOINTS;
  const endpoint = table[env] || table.test;
  const ns = nsFor(endpoint);
  const xml = envelope(method, innerXml, creds, ns);

  let res;
  try {
    res = await axios.post(endpoint, xml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${ns}#${method}"`,
      },
      timeout: 30000,
      validateStatus: () => true, // SOAP faults come back as HTTP 500
    });
  } catch (e) {
    throw new AppError(504, 'upstream_unreachable', `Could not reach Espresso: ${e.message}`);
  }

  return parseResponse(res.data, method);
}

module.exports = {
  ENDPOINTS,
  ENDPOINTS_V4,
  AppError,
  call,
  // exported builders used by the routes
  str,
  int,
  requestItems,
  orderRequestArray,
  ponStructure,
  routingStructure,
};
