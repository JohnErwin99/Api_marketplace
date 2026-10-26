'use strict';

/**
 * Cisco BroadWorks OCI-P client: the Application Server provisioning
 * interface ("Application Server Provisioning Interface Specification",
 * Release 23) through the XSP's SOAP web service. Serves the BroadWorks
 * (Hosted Voice) product (lib/routes/broadworks.js).
 *
 * Transport (spec §9.1): one SOAP operation, processOCIMessage, document/
 * literal, at https://<xsp>/webservice/services/ProvisioningService. Its one
 * string argument (request, namespace urn:com:broadsoft:webservice) holds a
 * whole OCI BroadsoftDocument; the answer (processOCIMessageReturn) is the
 * same kind of document.
 *
 * Session (§9.2, §11, §12.6, §12.7): the gateway keeps ONE OCI session. It
 * makes a random sessionId, logs in with LoginRequest22V3 (login id and
 * plain-text password, over HTTPS; R22+ logins need no AuthenticationRequest
 * first) and keeps the JSESSIONID cookie of that first answer for every
 * later request. A session id and its cookie are a pair: a new login always
 * starts with a new id and no cookie. Every answer must carry our session id.
 *
 * Work is done in tasks: run(caller, fn) gives fn a context whose send()
 * runs commands on the session, so an ownership check and the change it
 * guards go out back to back with nothing in between. One task runs at a
 * time; waiting tasks are taken round-robin by caller, so one caller can't
 * starve the others.
 *
 * Retries (a command is never sent twice unless it provably didn't run):
 *  - the answer says the session is invalid (INVALID_REQUEST, "[Error n]
 *    Invalid session" …, matched at the start of the text only), or the
 *    connection was refused before anything was sent: sign in again, send
 *    once more;
 *  - reads (Get commands): also after a dropped connection or a broken
 *    answer, but not after a timeout (so a hung XSP holds the queue for one
 *    read timeout at most);
 *  - changes: any other failure answers 502 outcome_unknown ("it may have
 *    been made; check before retrying") and the next command signs in again.
 *
 * Sign-in protection: every failed sign-in backs off exponentially. Refusals
 * (an error answer, or a SOAP fault such as LOGIN_FAILED or ACCESS_DENIED)
 * wait 60 s, 120 s, …; after BROADWORKS_MAX_LOGIN_REFUSALS (2) refusals in a
 * row the gateway stops signing in until the login settings change or the
 * process restarts, so it can never lock the shared login out. Network
 * failures wait 5 s, 10 s, … up to 5 minutes.
 *
 * Answers (§4.2, §8): SuccessResponse, a <Command>Response, or ErrorResponse
 * ("[Error 4003] Unauthorized request: …"). send() returns the <command>
 * element as a plain object (text values stay strings); OCI tables
 * (<colHeading>/<row><col>) become arrays of objects keyed by the
 * camel-cased headings. ErrorResponse -> AppError with a stable code and a
 * generic message: 4003 -> 403 broadworks_forbidden, "already exists" / "in
 * use" -> 409 conflict, "not found" -> 404 not_found, anything else -> 400
 * broadworks_error; the BroadWorks error number stays in `code`. The raw
 * BroadWorks text (and SOAP fault text) is logged and kept on err.detail,
 * which the router shows to Iristel staff only.
 *
 * Partner scoping: broadworks_links maps a marketplace (CRM) account to the
 * BroadWorks enterprise (service provider id) it may manage. Iristel staff
 * set it; lib/routes/broadworks.js always uses it for a partner's calls.
 *
 * Settings (all optional but the first three):
 *   BROADWORKS_OCI_URL, BROADWORKS_USER, BROADWORKS_PASS   the XSP and login
 *   BROADWORKS_READ_TIMEOUT_MS      10000   Get commands
 *   BROADWORKS_WRITE_TIMEOUT_MS     30000   changes
 *   BROADWORKS_LOGIN_TIMEOUT_MS     15000   sign-in
 *   BROADWORKS_TIMEOUT_MS                   caps all three (older setting)
 *   BROADWORKS_MAX_QUEUED_PER_CALLER   10   waiting tasks per caller (429 busy)
 *   BROADWORKS_MAX_QUEUED             200   waiting tasks in all (503 busy)
 *   BROADWORKS_MAX_WAIT_MS          30000   a task that waited longer is dropped (503 busy)
 *   BROADWORKS_LOGIN_BACKOFF_MS     60000   first wait after a refused sign-in
 *   BROADWORKS_LOGIN_RETRY_MS        5000   first wait after a failed sign-in (network)
 *   BROADWORKS_MAX_LOGIN_REFUSALS       2   refusals in a row before sign-in stops
 * Until the first three are set the product is 'preview' (lib/catalogs) and
 * every call answers 503 not_enabled. The password and the login's XML are
 * never logged.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const axios = require('axios');
const { AppError } = require('./soap');

const LOGIN_COMMAND = 'LoginRequest22V3';
const SOAP_NS = 'urn:com:broadsoft:webservice';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const MAX_ANSWER_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 64;

const num = (name, dflt) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

function settings() {
  const cap = num('BROADWORKS_TIMEOUT_MS', 0);
  const capped = (v) => (cap ? Math.min(v, cap) : v);
  return {
    url: String(process.env.BROADWORKS_OCI_URL || '').trim(),
    user: String(process.env.BROADWORKS_USER || '').trim(),
    pass: String(process.env.BROADWORKS_PASS || ''),
    timeouts: {
      read: num('BROADWORKS_READ_TIMEOUT_MS', capped(10000)),
      write: num('BROADWORKS_WRITE_TIMEOUT_MS', capped(30000)),
      login: num('BROADWORKS_LOGIN_TIMEOUT_MS', capped(15000)),
    },
  };
}

function limits() {
  return {
    perCaller: num('BROADWORKS_MAX_QUEUED_PER_CALLER', 10),
    total: num('BROADWORKS_MAX_QUEUED', 200),
    maxWait: num('BROADWORKS_MAX_WAIT_MS', 30000),
    refusalWait: num('BROADWORKS_LOGIN_BACKOFF_MS', 60000),
    failureWait: num('BROADWORKS_LOGIN_RETRY_MS', 5000),
    maxRefusals: Math.max(1, Math.floor(num('BROADWORKS_MAX_LOGIN_REFUSALS', 2))),
  };
}

/** True when the URL, login and password are all set. */
function configured() {
  const s = settings();
  return !!(s.url && s.user && s.pass);
}

const notEnabled = () => new AppError(503, 'not_enabled',
  'BroadWorks isn\'t switched on yet. Iristel is finishing the connection to its BroadWorks platform; try again once it is live.');

// The password goes in clear text (§11), so only HTTPS, except to this
// machine (tests and an SSH tunnel).
function target(url) {
  let u;
  try { u = new URL(url); } catch { u = null; }
  const loopback = u && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (!u || !(u.protocol === 'https:' || (u.protocol === 'http:' && loopback))) {
    throw new AppError(503, 'not_ready', 'BROADWORKS_OCI_URL must be the XSP\'s https://…/webservice/services/ProvisioningService URL.');
  }
  return u;
}

// Get commands change nothing, so they may be re-sent; everything else may not.
const isRead = (command) => /[a-z]Get[A-Z]/.test(command) || command === 'AvailabilityTestRequest';

// ---------------------------------------------------------------------------
// Values placed in XML
// ---------------------------------------------------------------------------

const bad = (message) => new AppError(400, 'validation_error', message);

// Characters XML 1.0 can't carry at all (control characters, lone surrogates).
const NOT_XML = /[\x00-\x08\x0b\x0c\x0e-\x1f￾￿\ud800-\udfff]/u;

/**
 * Escapes text for an OCI element. Everything outside printable ASCII
 * becomes a character reference, so it survives the document's ISO-8859-1
 * declaration and the SOAP wrapping alike.
 */
function esc(value) {
  const s = String(value);
  if (NOT_XML.test(s)) throw bad('A value holds characters that can\'t be sent to BroadWorks (control characters).');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/gu, (c) => `&#x${c.codePointAt(0).toString(16).toUpperCase()};`);
}

/**
 * One OCI element: <name>escaped value</name>. undefined -> nothing (the
 * element is optional and left out); null -> xsi:nil (clears the value on a
 * Modify). Booleans and numbers are written as text.
 */
function el(name, value) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new AppError(500, 'internal_error', 'Bad OCI element name.');
  if (value === undefined) return '';
  if (value === null) return `<${name} xsi:nil="true"/>`;
  return `<${name}>${esc(value)}</${name}>`;
}

// Ids the gateway puts in a request. BroadWorks allows more, but these sets
// cover real ids and keep anything XML-like or path-like out. User ids must
// be name@domain: BroadWorks completes a bare id with the system domain
// (§12.3.1), so one bare id could name different users.
const ID_RES = {
  enterprise: /^[A-Za-z0-9_](?:[A-Za-z0-9 ._@+-]{0,78}[A-Za-z0-9._@+-])?$/,
  group: /^[A-Za-z0-9_](?:[A-Za-z0-9 ._@+-]{0,78}[A-Za-z0-9._@+-])?$/,
  user: /^[A-Za-z0-9._+-]{1,80}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,78}[A-Za-z0-9])?$/,
  name: /^[A-Za-z0-9_](?:[A-Za-z0-9 ._@:+()#-]{0,78}[A-Za-z0-9._@:+()#-])?$/,
  phone: /^(?:\+\d{1,3}-)?\d{2,20}$/,
  account: /^[A-Za-z0-9._:-]{1,64}$/,
};
const ID_HELP = {
  enterprise: 'an enterprise id (letters, digits, . _ - @ +; up to 80)',
  group: 'a group id (letters, digits, . _ - @ +; up to 80)',
  user: 'a full user id, name@domain, such as 6135550100@voice.example.com',
  name: 'a name of letters, digits, spaces and . _ - @ : + ( ) # (up to 80)',
  phone: 'a phone number: digits only (6135550100), optionally with a country code (+1-6135550100)',
  account: 'an account id',
};

/** The value, if it is a valid id of that kind; otherwise a 400. */
function checkId(kind, value, label = kind) {
  if (typeof value !== 'string' || !ID_RES[kind] || !ID_RES[kind].test(value)) {
    const shown = typeof value === 'string' ? `"${value.slice(0, 40)}"` : 'it';
    throw bad(`${label}: ${shown} is not ${ID_HELP[kind] || 'valid'}.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Minimal XML reader (elements, attributes, text, CDATA; no DTDs; depth
// limited; no recursion)
// ---------------------------------------------------------------------------

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const xmlError = (why) => Object.assign(new Error(`XML: ${why}`), { xml: true });

function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,4});/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

/** Parses a document into { name, local, attrs, children, text } nodes. */
function parseXml(src) {
  const s = String(src);
  const root = { name: '#document', local: '#document', attrs: Object.create(null), children: [], text: '' };
  const stack = [root];
  let i = 0;
  while (i < s.length) {
    const top = stack[stack.length - 1];
    const lt = s.indexOf('<', i);
    if (lt < 0) { top.text += decode(s.slice(i)); break; }
    if (lt > i) top.text += decode(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      if (e < 0) throw xmlError('unclosed comment');
      i = e + 3; continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      if (e < 0) throw xmlError('unclosed CDATA');
      top.text += s.slice(lt + 9, e);
      i = e + 3; continue;
    }
    if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt + 2);
      if (e < 0) throw xmlError('unclosed declaration');
      i = e + 2; continue;
    }
    if (s.startsWith('<!', lt)) throw xmlError('DOCTYPE and entity declarations are not accepted');
    let j = lt + 1;
    let q = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === '\'') q = c; else if (c === '>') break;
    }
    if (j >= s.length) throw xmlError('unclosed tag');
    let tag = s.slice(lt + 1, j);
    i = j + 1;
    if (tag[0] === '/') {
      if (stack.length < 2 || top.name !== tag.slice(1).trim()) throw xmlError('mismatched closing tag');
      stack.pop();
      continue;
    }
    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1);
    const m = /^[^\s/>]+/.exec(tag);
    if (!m) throw xmlError('bad tag');
    const name = m[0];
    const attrs = Object.create(null);
    const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    const rest = tag.slice(name.length);
    for (let a = re.exec(rest); a; a = re.exec(rest)) attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
    const node = { name, local: name.includes(':') ? name.slice(name.indexOf(':') + 1) : name, attrs, children: [], text: '' };
    top.children.push(node);
    if (!selfClosing) {
      if (stack.length > MAX_DEPTH) throw xmlError('too deeply nested');
      stack.push(node);
    }
  }
  if (stack.length !== 1) throw xmlError('unclosed element');
  return root;
}

// First descendant (depth-first, document order) with this local name.
function find(node, local) {
  const stack = node.children.slice().reverse();
  while (stack.length) {
    const c = stack.pop();
    if (c.local === local) return c;
    for (let k = c.children.length - 1; k >= 0; k--) stack.push(c.children[k]);
  }
  return null;
}

const isNil = (node) => Object.keys(node.attrs).some((k) => (k === 'nil' || k.endsWith(':nil')) && node.attrs[k] === 'true');
const isTable = (node) => node.children.some((k) => k.local === 'colHeading')
  && node.children.every((k) => k.local === 'colHeading' || k.local === 'row');

// "Group Id" -> groupId, "MAC Address" -> macAddress, "Line/Port" -> linePort.
function camel(heading) {
  const words = String(heading).trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w, n) => {
    const word = w === w.toUpperCase() ? w.toLowerCase() : w;
    return n === 0 ? word[0].toLowerCase() + word.slice(1) : word[0].toUpperCase() + word.slice(1);
  }).join('');
}

function tableRows(node) {
  const heads = node.children.filter((k) => k.local === 'colHeading').map((k, n) => camel(k.text) || `col${n + 1}`);
  return node.children.filter((k) => k.local === 'row').map((row) => {
    const o = {};
    row.children.filter((c) => c.local === 'col').forEach((c, n) => {
      const key = heads[n] || `col${n + 1}`;
      if (UNSAFE_KEYS.has(key)) return;
      const t = isNil(c) ? null : c.text.trim();
      o[key] = t === '' ? null : t;
    });
    return o;
  });
}

/**
 * A node as plain JS: text -> string (trimmed), xsi:nil -> null, an OCI
 * table -> array of row objects, other elements -> objects (a repeated
 * child becomes an array). Iterative (post-order), so depth costs no stack.
 */
function toJs(root) {
  const done = new Map();
  const opened = new Set();
  const stack = [root];
  while (stack.length) {
    const node = stack[stack.length - 1];
    const container = !isNil(node) && node.children.length > 0 && !isTable(node);
    if (container && !opened.has(node)) {
      opened.add(node);
      for (const c of node.children) stack.push(c);
      continue;
    }
    stack.pop();
    let v;
    if (isNil(node)) v = null;
    else if (!node.children.length) v = node.text.trim();
    else if (isTable(node)) v = tableRows(node);
    else {
      v = {};
      const many = new Set();
      for (const k of node.children) {
        if (UNSAFE_KEYS.has(k.local)) continue;
        const x = done.get(k);
        if (!Object.prototype.hasOwnProperty.call(v, k.local)) v[k.local] = x;
        else if (many.has(k.local)) v[k.local].push(x);
        else { v[k.local] = [v[k.local], x]; many.add(k.local); }
      }
    }
    done.set(node, v);
  }
  return done.get(root);
}

// ---------------------------------------------------------------------------
// One SOAP exchange
// ---------------------------------------------------------------------------

// Texts that prove the session is gone and the command did not run. Matched
// at the very start (after "[Error n]"), where BroadWorks and the XSP put
// their own wording, so text a caller sent and BroadWorks echoes later in
// the message can't trigger a new sign-in.
const SESSION_LOST = /^\s*(?:\[Error \d+\]\s*)?(?:INVALID_REQUEST|INVALID_SESSION)\b|^\s*\[Error \d+\]\s*(?:Invalid (?:OCI )?session\b|(?:The )?(?:OCI )?session (?:id )?(?:is )?(?:invalid|unknown|expired|has expired|timed out)\b|(?:The )?user is not logged in\b|Not logged in\b)/i;
const FAULT_SESSION_LOST = /^\s*INVALID_REQUEST\b/;
const CONFLICT = /already exists|already in use|is in use|in use by|duplicate/i;
const NOT_FOUND = /not found|does not exist|doesn't exist|no such/i;
// Connection errors raised before the request was written.
const UNSENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID']);

/**
 * An AppError with a failure kind (not sent to callers):
 *   oci      BroadWorks answered with an error; the session is fine
 *   session  the session is invalid; the command did not run
 *   unsent   no connection; the command was not sent
 *   timeout  no answer in time; the command may have run
 *   broken   an unusable answer or a dropped connection; it may have run
 *   fatal    misrouted, too large, or a setting: no retry
 * `detail` holds BroadWorks' own text, for logs and Iristel staff.
 */
function fail(kind, status, code, message, detail, meta = {}) {
  return Object.assign(new AppError(status, code, message, meta), { kind, detail: detail || undefined });
}
const broken = (detail) => fail('broken', 502, 'bad_gateway', 'BroadWorks answered in an unexpected way. Try again in a moment.', detail);

// An ErrorResponse as an AppError with a stable code and a generic message.
function ociError(cmd) {
  const get = (n) => { const x = cmd.children.find((c) => c.local === n); return x ? x.text.trim() : ''; };
  const summary = (get('summaryEnglish') || get('summary') || 'BroadWorks refused the request.').slice(0, 500);
  const m = /^\s*\[Error (\d+)\]/.exec(summary);
  const meta = m ? { code: Number(m[1]) } : {};
  if (SESSION_LOST.test(summary)) {
    return fail('session', 502, 'broadworks_session', 'The gateway\'s BroadWorks session was lost. Try again in a moment.', summary, meta);
  }
  if (meta.code === 4003) {
    return fail('oci', 403, 'broadworks_forbidden', 'BroadWorks refused this for the gateway\'s login. Contact Iristel support.', summary, meta);
  }
  if (CONFLICT.test(summary)) return fail('oci', 409, 'conflict', 'That id or number is already in use.', summary, meta);
  if (NOT_FOUND.test(summary)) return fail('oci', 404, 'not_found', 'BroadWorks has no such item.', summary, meta);
  return fail('oci', 400, 'broadworks_error', 'BroadWorks refused the request. Check the values you sent.', summary, meta);
}

function keepCookies(sess, setCookie) {
  for (const line of [].concat(setCookie || [])) {
    const pair = String(line).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) sess.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

// Reads reuse connections; sign-ins and changes get a new one each, so a
// stale kept-alive socket can't make a change's outcome unclear.
const AGENTS = {
  keep: { 'http:': new http.Agent({ keepAlive: true, maxSockets: 2 }), 'https:': new https.Agent({ keepAlive: true, maxSockets: 2 }) },
  fresh: { 'http:': new http.Agent({ keepAlive: false }), 'https:': new https.Agent({ keepAlive: false }) },
};

/**
 * Sends one command on a session and returns the <command> object, or
 * throws a fail() error. mode: 'read' | 'write' | 'login'.
 */
async function exchange(sess, command, fieldsXml, mode) {
  const s = settings();
  const login = mode === 'login';
  const url = target(s.url);
  const doc = '<?xml version="1.0" encoding="ISO-8859-1"?>'
    + `<BroadsoftDocument protocol="OCI" xmlns="C" xmlns:xsi="${XSI_NS}">`
    + `<sessionId xmlns="">${esc(sess.id)}</sessionId>`
    + `<command xsi:type="${command}" xmlns="">${fieldsXml || ''}</command>`
    + '</BroadsoftDocument>';
  const envelope = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
    + ' xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<soapenv:Body><processOCIMessage xmlns="${SOAP_NS}"><request>`
    + doc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    + '</request></processOCIMessage></soapenv:Body></soapenv:Envelope>';
  const headers = { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', Accept: 'text/xml' };
  // §9.2: the first request of a session carries no JSESSIONID.
  if (sess.cookies.size) headers.Cookie = [...sess.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const agent = AGENTS[mode === 'read' ? 'keep' : 'fresh'][url.protocol];
  const tag = `[broadworks] ${command}:`;

  let r;
  try {
    r = await axios.post(url.toString(), envelope, {
      headers, timeout: s.timeouts[mode], responseType: 'text', transformResponse: (x) => x,
      validateStatus: () => true, maxRedirects: 0, maxContentLength: MAX_ANSWER_BYTES,
      httpAgent: agent, httpsAgent: agent, proxy: false,
    });
  } catch (err) {
    const why = err.code || 'error';
    if (/maxContentLength/.test(err.message || '')) {
      console.warn(`${tag} answer larger than ${MAX_ANSWER_BYTES} bytes`);
      throw fail('fatal', 502, 'too_large', 'BroadWorks\' answer was too large. Ask for less (a lower limit).');
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
      console.warn(`${tag} no answer within ${s.timeouts[mode]} ms`);
      throw fail('timeout', 502, 'upstream_timeout', 'BroadWorks didn\'t answer in time. Try again in a moment.');
    }
    console.warn(`${tag} connection failed (${why})`);
    if (UNSENT.has(err.code)) throw fail('unsent', 502, 'upstream_unreachable', 'BroadWorks couldn\'t be reached. Try again in a moment.', why);
    throw broken(`connection dropped (${why})`);
  }
  keepCookies(sess, r.headers && r.headers['set-cookie']);

  let soap = null;
  try { soap = parseXml(typeof r.data === 'string' ? r.data : ''); } catch { soap = null; }
  const fault = soap && find(soap, 'Fault');
  if (fault) {
    const fs = (find(fault, 'faultstring') || { text: '' }).text.trim().slice(0, 300) || 'SOAP fault';
    const lead = (/^\s*([A-Z_]{3,40})\b/.exec(fs) || [])[1] || 'SOAP fault';
    console.warn(`${tag} SOAP fault, HTTP ${r.status}: ${login ? lead : fs}`);
    const e = FAULT_SESSION_LOST.test(fs)
      ? fail('session', 502, 'broadworks_session', 'The gateway\'s BroadWorks session was lost. Try again in a moment.', fs)
      : fail('broken', 502, 'bad_gateway', 'BroadWorks\' web service refused the request. Try again in a moment.', fs);
    throw Object.assign(e, { fault: lead });
  }
  if (r.status >= 300 && r.status < 400) {
    console.warn(`${tag} redirected (HTTP ${r.status}); check BROADWORKS_OCI_URL`);
    throw fail('fatal', 502, 'bad_gateway', 'BroadWorks sent this request somewhere other than its web service. Contact Iristel support.');
  }
  if (r.status !== 200) {
    console.warn(`${tag} HTTP ${r.status}`);
    throw broken(`HTTP ${r.status}`);
  }
  if (!soap) {
    console.warn(`${tag} answer is not XML`);
    throw broken('answer is not XML');
  }
  const ret = find(soap, 'processOCIMessageReturn') || find(soap, 'processMessageReturn');
  let inner = null;
  try { inner = ret ? parseXml(ret.text) : null; } catch { inner = null; }
  const bdoc = inner && find(inner, 'BroadsoftDocument');
  const cmd = bdoc && bdoc.children.find((c) => c.local === 'command');
  if (!cmd) {
    console.warn(`${tag} answer without an OCI command`);
    throw broken('answer without an OCI command');
  }
  // The answer must name our session: anything else is someone else's, or forged.
  const sid = bdoc.children.find((c) => c.local === 'sessionId');
  if (!sid || sid.text.trim() !== sess.id) {
    console.warn(`${tag} answer ${sid ? 'for another session' : 'without a session id'}`);
    throw broken(sid ? 'answer for another session' : 'answer without a session id');
  }
  const typeKey = Object.keys(cmd.attrs).find((k) => k.endsWith(':type'));
  const type = typeKey ? cmd.attrs[typeKey].split(':').pop() : '';
  if (type === 'ErrorResponse' || cmd.attrs.type === 'Error') {
    const err = ociError(cmd);
    console.warn(`${tag} ${err.error}${err.meta.code ? ` ${err.meta.code}` : ''}${login ? '' : `: ${err.detail}`}`);
    throw err;
  }
  const out = toJs(cmd);
  return out && typeof out === 'object' ? out : {};
}

// ---------------------------------------------------------------------------
// Sign-in, with back-off
// ---------------------------------------------------------------------------

let session = null;                    // { id, cookies: Map, at, loginType }
let gate = { fp: null, refusals: 0, failures: 0, until: 0, stopped: false, error: null };

// Which login the gate is about (a hash; the password is never kept apart from env).
const fingerprint = (s) => crypto.createHash('sha256').update(`${s.url}\0${s.user}\0${s.pass}`).digest('hex');

function gateError() {
  const e = gate.error;
  const wait = gate.stopped ? undefined : Math.max(1, Math.ceil((gate.until - Date.now()) / 1000));
  return new AppError(e.status, e.error, e.message, wait ? { ...e.meta, retryAfter: wait } : { ...e.meta });
}

// Records a failed sign-in and returns the error to answer with.
function signInFailed(err) {
  const L = limits();
  // Refused: BroadWorks or the XSP answered and said no. Not refused: no
  // usable answer (network, timeout, OCS down).
  const refused = err.kind === 'oci' || err.kind === 'session'
    || (err.fault && !/^(NO_OCS_CONNECTION|REQUEST_TIMEOUT)$/.test(err.fault));
  if (refused) {
    gate.refusals++;
    if (gate.refusals >= L.maxRefusals) {
      gate.stopped = true;
      gate.error = new AppError(503, 'broadworks_auth',
        'The gateway has stopped signing in to BroadWorks after its login was refused, so the shared login can\'t be locked out. Contact Iristel support.');
      console.error(`[broadworks] sign-in refused ${gate.refusals} times in a row (${err.fault || err.error}${err.meta && err.meta.code ? ` ${err.meta.code}` : ''}); `
        + 'not signing in again until BROADWORKS_USER / BROADWORKS_PASS / BROADWORKS_OCI_URL change or the gateway restarts');
    } else {
      const wait = Math.min(L.refusalWait * 2 ** (gate.refusals - 1), 60 * 60 * 1000);
      gate.until = Date.now() + wait;
      gate.error = new AppError(502, 'broadworks_auth', 'The gateway could not sign in to BroadWorks. Your key is fine; contact Iristel support.');
      console.warn(`[broadworks] sign-in refused (${err.fault || err.error}${err.meta && err.meta.code ? ` ${err.meta.code}` : ''}); next try in ${Math.round(wait / 1000)} s`);
    }
  } else {
    gate.failures++;
    const wait = Math.min(L.failureWait * 2 ** (gate.failures - 1), 5 * 60 * 1000);
    gate.until = Date.now() + wait;
    gate.error = new AppError(502, err.error || 'upstream_unreachable', err.message || 'BroadWorks couldn\'t be reached. Try again in a moment.');
    console.warn(`[broadworks] sign-in failed (${err.error}); next try in ${Math.round(wait / 1000)} s`);
  }
  return gateError();
}

async function login() {
  const s = settings();
  const fp = fingerprint(s);
  if (gate.fp !== fp) gate = { fp, refusals: 0, failures: 0, until: 0, stopped: false, error: null };
  if (gate.error && (gate.stopped || Date.now() < gate.until)) throw gateError();
  target(s.url);   // a bad URL is a setting, not a failed sign-in
  const sess = { id: crypto.randomBytes(16).toString('hex').toUpperCase(), cookies: new Map(), at: Date.now(), loginType: null };
  let r;
  try {
    r = await exchange(sess, LOGIN_COMMAND, el('userId', s.user) + el('password', s.pass), 'login');
  } catch (err) {
    if (!err.kind) throw err;
    throw signInFailed(err);
  }
  if (typeof r.loginType !== 'string' || !r.loginType) throw signInFailed(broken('sign-in answer is not a LoginResponse'));
  gate = { fp, refusals: 0, failures: 0, until: 0, stopped: false, error: null };
  if (!sess.cookies.has('JSESSIONID')) console.warn('[broadworks] the sign-in answer set no JSESSIONID cookie');
  if (r.passwordExpiresDays !== undefined && Number(r.passwordExpiresDays) <= 0) {
    console.warn('[broadworks] the gateway login\'s password has expired (§4.1.3): change it on BroadWorks and in BROADWORKS_PASS');
  }
  sess.loginType = r.loginType;
  session = sess;
  return sess;
}

// ---------------------------------------------------------------------------
// Commands within a task
// ---------------------------------------------------------------------------

const outcomeUnknown = (cause) => fail('fatal', 502, 'outcome_unknown',
  'BroadWorks didn\'t confirm this change, and it may have been made. Check the current state before you retry.',
  cause && (cause.detail || cause.error));

async function exec(command, fieldsXml) {
  if (typeof command !== 'string' || !/^[A-Z][A-Za-z0-9]{2,120}$/.test(command) || command.startsWith('Login')) {
    throw new AppError(500, 'internal_error', 'Bad OCI command name.');
  }
  const read = isRead(command);
  for (let attempt = 0; ; attempt++) {
    const sess = session || await login();
    try {
      return await exchange(sess, command, fieldsXml || '', read ? 'read' : 'write');
    } catch (err) {
      if (!err.kind || err.kind === 'oci' || err.kind === 'fatal') throw err;   // BroadWorks answered, or no retry helps
      if (session === sess) session = null;                                     // the next command signs in again
      const didNotRun = err.kind === 'session' || err.kind === 'unsent';
      if (attempt === 0 && (didNotRun || (read && err.kind === 'broken'))) {
        console.warn(`[broadworks] ${command}: signing in again and re-sending (${err.kind})`);
        continue;
      }
      if (!read && !didNotRun) throw outcomeUnknown(err);
      throw err;
    }
  }
}

const context = Object.freeze({ send: (command, fieldsXml) => exec(command, fieldsXml) });

// ---------------------------------------------------------------------------
// Fair queue: one task at a time, callers served round-robin
// ---------------------------------------------------------------------------

const queues = new Map();   // caller -> [{ fn, resolve, reject, at }]
const turn = [];            // callers with waiting tasks, in serving order
let waiting = 0;
let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (turn.length) {
      const key = turn.shift();
      const q = queues.get(key);
      const task = q.shift();
      if (q.length) turn.push(key); else queues.delete(key);
      waiting--;
      if (Date.now() - task.at > limits().maxWait) {
        task.reject(new AppError(503, 'busy', 'BroadWorks is busy with other requests. Try again in a moment.'));
        continue;
      }
      try { task.resolve(await task.fn(context)); } catch (err) { task.reject(err); }
    }
  } finally {
    pumping = false;
  }
}

/**
 * Runs fn(ctx) as one task for this caller, after the tasks ahead of it
 * (round-robin between callers). ctx.send(command, fieldsXml) sends a
 * command on the gateway's session and returns the parsed <command>; no
 * other task's command goes out until fn finishes. 429 busy when this
 * caller already has too many tasks waiting; 503 busy when everyone has.
 */
function run(caller, fn) {
  if (!configured()) return Promise.reject(notEnabled());
  const L = limits();
  const key = String(caller || 'anonymous');
  const q = queues.get(key);
  if (q && q.length >= L.perCaller) {
    return Promise.reject(new AppError(429, 'busy', 'You have too many BroadWorks requests waiting. Wait for them to finish, then try again.',
      { retryAfter: 2 }));
  }
  if (waiting >= L.total) {
    return Promise.reject(new AppError(503, 'busy', 'BroadWorks is busy with other requests. Try again in a moment.', { retryAfter: 5 }));
  }
  return new Promise((resolve, reject) => {
    if (q) q.push({ fn, resolve, reject, at: Date.now() });
    else { queues.set(key, [{ fn, resolve, reject, at: Date.now() }]); turn.push(key); }
    waiting++;
    pump();
  });
}

/** One command as its own task (see run()). */
function send(command, fieldsXml = '', { caller } = {}) {
  return run(caller || 'gateway', (s) => s.send(command, fieldsXml));
}

/**
 * Checks the gateway can sign in and reach BroadWorks: signs in if needed
 * and sends AvailabilityTestRequest. Any OCI answer proves the path works.
 */
async function health(caller) {
  try {
    await send('AvailabilityTestRequest', '', { caller });
  } catch (err) {
    if (err.kind !== 'oci') throw err;
  }
  return { ok: true };
}

/** Drops the session and clears the sign-in back-off (tests; a changed login). */
function reset() {
  session = null;
  gate = { fp: null, refusals: 0, failures: 0, until: 0, stopped: false, error: null };
}

// ---------------------------------------------------------------------------
// Partner -> enterprise links
// ---------------------------------------------------------------------------

// Created on first use, so loading the catalogs (scripts) opens no database.
let q = null;
function links() {
  if (q) return q;
  const db = require('./db');
  db.exec('CREATE TABLE IF NOT EXISTS broadworks_links (account_id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL, updated_at TEXT, updated_by TEXT)');
  q = {
    get: db.prepare('SELECT enterprise_id FROM broadworks_links WHERE account_id = ?'),
    set: db.prepare(`INSERT INTO broadworks_links (account_id, enterprise_id, updated_at, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET enterprise_id = excluded.enterprise_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
    del: db.prepare('DELETE FROM broadworks_links WHERE account_id = ?'),
    all: db.prepare('SELECT account_id, enterprise_id, updated_at, updated_by FROM broadworks_links ORDER BY account_id'),
    others: db.prepare('SELECT account_id FROM broadworks_links WHERE lower(enterprise_id) = lower(?) AND account_id <> ? ORDER BY account_id'),
  };
  return q;
}

// Account ids (CRM GUIDs, MIND numbers) compare without regard to case.
const accountKey = (x) => String(x).trim().toLowerCase();
const accountList = (ids) => (Array.isArray(ids) ? ids : [ids])
  .filter((x) => (typeof x === 'string' || typeof x === 'number') && String(x).trim())
  .map(accountKey);

/** Every enterprise linked to these accounts, in account order, without repeats. */
function linksFor(accountIds) {
  const out = [];
  for (const id of accountList(accountIds)) {
    const row = links().get.get(id);
    if (row && !out.some((e) => e.toLowerCase() === row.enterprise_id.toLowerCase())) out.push(row.enterprise_id);
  }
  return out;
}

/** The enterprise linked to the first of these accounts that has one, or null. */
function linkFor(accountIds) {
  return linksFor(accountIds)[0] || null;
}

/**
 * Links an account to an enterprise (service provider id), or unlinks it
 * with enterpriseId null or ''. Returns the link as stored.
 */
function setLink(accountId, enterpriseId, byEmail) {
  const account = checkId('account', accountId == null ? '' : accountKey(accountId), 'accountId');
  if (enterpriseId == null || enterpriseId === '') {
    links().del.run(account);
    return { accountId: account, enterpriseId: null };
  }
  const enterprise = checkId('enterprise', String(enterpriseId).trim(), 'enterpriseId');
  const at = new Date().toISOString();
  const by = byEmail ? String(byEmail).slice(0, 200) : null;
  links().set.run(account, enterprise, at, by);
  return { accountId: account, enterpriseId: enterprise, updatedAt: at, updatedBy: by };
}

/** All links: [{ accountId, enterpriseId, updatedAt, updatedBy }]. */
function listLinks() {
  return links().all.all().map((r) => ({
    accountId: r.account_id, enterpriseId: r.enterprise_id, updatedAt: r.updated_at, updatedBy: r.updated_by,
  }));
}

/** The other accounts already linked to this enterprise (any case), for a warning before linking. */
function linkedElsewhere(enterpriseId, accountId) {
  if (enterpriseId == null || String(enterpriseId).trim() === '') return [];
  return links().others.all(String(enterpriseId).trim(), accountId == null ? '' : accountKey(accountId)).map((r) => r.account_id);
}

module.exports = {
  configured,
  notEnabled,
  run,
  send,
  health,
  reset,
  el,
  esc,
  checkId,
  isRead,
  linkFor,
  linksFor,
  setLink,
  listLinks,
  linkedElsewhere,
  // XML reader, exported for tests
  parseXml,
  toJs,
  LOGIN_COMMAND,
};
