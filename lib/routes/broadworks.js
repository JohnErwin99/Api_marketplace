'use strict';

/**
 * BroadWorks (Hosted Voice) routes: Cisco BroadWorks provisioning over
 * OCI-P (lib/broadworks.js; catalog: lib/catalogs/broadworks.js).
 *
 *   gateway (/api/broadworks)                         OCI-P command (R23, Appendix B)
 *   GET    /health                                    LoginRequest22V3 (when needed) + AvailabilityTestRequest
 *   GET    /enterprise                                ServiceProviderGetRequest22V2
 *   GET    /enterprise/dns                            ServiceProviderDnGetSummaryListRequest
 *   GET    /groups                                    GroupGetListInServiceProviderRequest
 *   GET    /groups/:groupId                           GroupGetRequest22V2
 *   GET    /groups/:groupId/dns                       GroupDnGetAssignmentListRequest18
 *   GET    /groups/:groupId/dns/available             GroupDnGetAvailableListRequest
 *   POST   /groups/:groupId/dns/assign                GroupDnAssignListRequest
 *   POST   /groups/:groupId/dns/unassign              GroupDnUnassignListRequest
 *   POST   /groups/:groupId/dns/activate              GroupDnActivateListRequest
 *   GET    /groups/:groupId/users                     UserGetListInGroupRequest
 *   POST   /groups/:groupId/users                     GroupDomainGetAssignedListRequest (cached) + UserAddRequest22
 *   GET    /users/:userId                             UserGetRequest22V5
 *   PATCH  /users/:userId                             UserModifyRequest22
 *   DELETE /users/:userId                             UserDeleteRequest
 *   GET    /users/:userId/services                    UserServiceGetAssignmentListRequest
 *   POST   /users/:userId/services/assign             UserServiceAssignListRequest
 *   GET    /users/:userId/registrations               UserGetRegistrationListRequest
 *   GET|PUT /users/:userId/call-forwarding/always     UserCallForwardingAlways{Get,Modify}Request
 *   GET|PUT /users/:userId/call-forwarding/busy       UserCallForwardingBusy{Get,Modify}Request
 *   GET|PUT /users/:userId/call-forwarding/no-answer  UserCallForwardingNoAnswerGetRequest13mp16 / …ModifyRequest
 *   GET|PUT /users/:userId/dnd                        UserDoNotDisturb{Get,Modify}Request
 *   GET|PUT /users/:userId/voicemail                  UserVoiceMessagingUserGetVoiceManagementRequest17 / …ModifyVoiceManagementRequest
 *   GET    /groups/:groupId/trunk-groups              GroupTrunkGroupGetInstanceListRequest14sp4
 *   GET    /groups/:groupId/trunk-groups/:name        GroupTrunkGroupGetInstanceRequest23
 *   PATCH  /groups/:groupId/trunk-groups/:name        GroupTrunkGroupModifyInstanceRequest20sp1
 *   GET    /groups/:groupId/devices                   GroupAccessDeviceGetListRequest
 *   GET    /groups/:groupId/devices/:deviceName       GroupAccessDeviceGetRequest18sp1
 *   POST   /groups/:groupId/devices/:deviceName/reset GroupAccessDeviceResetRequest
 *   GET    /groups/:groupId/hunt-groups               GroupHuntGroupGetInstanceListRequest
 *   GET    /groups/:groupId/auto-attendants           GroupAutoAttendantGetInstanceListRequest
 *
 * Scoping. The gateway signs in to BroadWorks with one login that can see
 * many enterprises, so it scopes callers itself:
 *  - A caller's enterprise (serviceProviderId) is one linked to their
 *    marketplace accounts (broadworks_links). With no link: 403
 *    broadworks_not_linked. With several, ?enterprise= picks one of them.
 *    Only marketplace admins and the internal key may name any enterprise
 *    (?enterprise=, required for them); other Iristel staff are scoped like
 *    partners. Bodies never carry an enterprise or group: unknown fields are
 *    refused.
 *  - A :groupId must be one of the enterprise's groups
 *    (GroupGetListInServiceProviderRequest, cached 5 minutes). Every group
 *    command also names the enterprise, so a group can't be reached
 *    through another enterprise.
 *  - A :userId (name@domain) must be in the enterprise: UserGetRequest22V5
 *    gives its serviceProviderId. Every change re-reads it, in the same
 *    queued task as the change itself; reads may use a 60-second cache.
 *  - Devices and trunk groups are reached through a checked group.
 * Each request is one task on the BroadWorks queue (lib/broadworks.js run()),
 * so the check and the command go out with nothing in between. Someone
 * else's group or user answers the same 404 as one that doesn't exist.
 * BroadWorks' own error text reaches Iristel staff only (as `detail`).
 */

const express = require('express');
const { AppError } = require('../soap');
const bw = require('../broadworks');

const { el } = bw;
const GROUP_TTL_MS = 5 * 60 * 1000;
const GROUP_REFRESH_MS = 30 * 1000;   // a miss re-reads the list at most this often
const USER_READ_TTL_MS = 60 * 1000;   // reads only; changes always re-check
const DOMAIN_TTL_MS = 5 * 60 * 1000;
const MAX_LIST = 50;                  // numbers / services per change
const LIST_LIMIT = 1000;              // rows per list answer

const bad = (message) => new AppError(400, 'validation_error', message);
const groupNotFound = (id) => new AppError(404, 'not_found', `No group "${String(id).slice(0, 80)}" in your BroadWorks enterprise.`);
const userNotFound = (id) => new AppError(404, 'not_found', `No user "${String(id).slice(0, 80)}" in your BroadWorks enterprise.`);
// BroadWorks ids compare without regard to case.
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Used when the router is mounted without server.js's wrapper (tests).
const defaultHandle = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err instanceof AppError) return res.status(err.status).json(err.toJSON());
    console.error(err);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  });
};

// ---- request values --------------------------------------------------------

function bodyOf(req, allowed) {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const unknown = Object.keys(b).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw bad(`Unknown field(s): ${unknown.slice(0, 10).map((k) => k.slice(0, 40)).join(', ')}. Send only ${allowed.join(', ') || 'an empty body'}; `
      + 'the enterprise and group come from your account and the path.');
  }
  return b;
}

const V = {
  bool(v, name) {
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    throw bad(`${name} must be true or false.`);
  },
  int(v, name, min, max) {
    const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d{1,9}\s*$/.test(v) ? Number(v) : NaN);
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}.`);
    return n;
  },
  text(v, name, max = 30) {
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) {
      throw bad(`${name} must be text of 1 to ${max} characters.`);
    }
    return v.trim();
  },
  phone(v, name) { return bw.checkId('phone', typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : v, name); },
  extension(v, name) {
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string' || !/^\d{2,20}$/.test(v.trim())) throw bad(`${name} must be 2 to 20 digits.`);
    return v.trim();
  },
  // OutgoingDN: digits, optionally + * # and dashes.
  outgoingDn(v, name) {
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    if (!/^\+?[0-9*#][0-9*#-]{0,29}$/.test(s)) throw bad(`${name} must be a phone number (digits, optionally + * #).`);
    return s;
  },
  // OutgoingDNorSIPURI: a number as above, or a SIP address.
  dest(v, name) {
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    if (!/^(?:\+?[0-9*#][0-9*#-]{0,29}|(?:sips?:)?[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,126}[A-Za-z0-9])?)$/.test(s)) {
      throw bad(`${name} must be a phone number (digits, optionally + * #) or a SIP address (user@host).`);
    }
    return s;
  },
  email(v, name) {
    if (typeof v !== 'string' || v.length > 80 || !/^[^\s@<>"'&]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,78}[A-Za-z0-9])?$/.test(v.trim())) {
      throw bad(`${name} must be an email address of at most 80 characters.`);
    }
    return v.trim();
  },
  password(v, name) {
    if (typeof v !== 'string' || !v || v.length > 60 || /[\x00-\x1f\x7f]/.test(v)) throw bad(`${name} must be text of 1 to 60 characters.`);
    return v;
  },
};
// `kind` or null (send xsi:nil, which clears the value) when nullable.
const orNull = (fn) => (v, name, ...rest) => (v === null ? null : fn(v, name, ...rest));

function numbersOf(b) {
  const list = b.numbers;
  if (!Array.isArray(list) || !list.length || list.length > MAX_LIST) {
    throw bad(`Body must be { "numbers": [ ... ] } with 1 to ${MAX_LIST} phone numbers.`);
  }
  return [...new Set(list.map((n) => V.phone(n, 'numbers[]')))];
}

// ---- answers ---------------------------------------------------------------

const NUMERIC = new Set([
  'userLimit', 'userCount', 'numberOfRings', 'maxActiveCalls', 'maxIncomingCalls', 'maxOutgoingCalls',
  'burstingMaxActiveCalls', 'burstingMaxIncomingCalls', 'burstingMaxOutgoingCalls', 'numberOfPorts',
  'numberOfAssignedPorts', 'availablePorts', 'order', 'publicPort', 'privatePort', 'lockoutCount',
]);
const SECRET = /password|passcode|secret/i;
// Free-text and id keys keep their text even when it reads "true".
const TEXT_KEY = /(?:[Nn]ame|[Tt]itle|[Dd]escription|[Dd]epartment|[Aa]lias|[Ee]mail|[Aa]ddress|Id|^id|[Nn]umber|[Ee]xtension)$/;

// OCI text values as JSON: "true"/"false" -> booleans, known counts ->
// numbers, anything that looks like a credential dropped.
function shape(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => shape(x, key));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET.test(k)) o[k] = shape(x, k);
    return o;
  }
  if (typeof v !== 'string') return v;
  if (!TEXT_KEY.test(key) && (v === 'true' || v === 'false')) return v === 'true';
  if (NUMERIC.has(key) && /^-?\d{1,15}$/.test(v)) return Number(v);
  return v;
}

// An OCI table (or repeated element) as an array.
function listOf(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}
// The named table, or the answer's first table.
function tableOf(r, name) {
  if (r && r[name] !== undefined) return listOf(r[name]).filter((x) => x && typeof x === 'object');
  const first = r && Object.values(r).find((x) => Array.isArray(x) && x.every((y) => y && typeof y === 'object'));
  return first || [];
}
// { data, total }, at most LIST_LIMIT rows; truncated when BroadWorks
// stopped at the limit we asked for (`asked`) or there were more rows.
function listJson(rows, asked) {
  const all = shape(rows);
  const data = all.length > LIST_LIMIT ? all.slice(0, LIST_LIMIT) : all;
  const out = { data, total: data.length };
  if (all.length > LIST_LIMIT || (asked && rows.length >= asked)) {
    out.truncated = true;
    out.note = `Only the first ${data.length} are shown; there may be more.`;
  }
  return out;
}

// ---- features (GET and PUT each). Fields in schema order. --------------------

const PROCESSING = ['Unified Voice and Email Messaging', 'Deliver To Email Address Only'];
const FEATURES = {
  'call-forwarding/always': {
    get: 'UserCallForwardingAlwaysGetRequest', modify: 'UserCallForwardingAlwaysModifyRequest',
    fields: [['isActive', V.bool], ['forwardToPhoneNumber', orNull(V.dest)], ['isRingSplashActive', V.bool]],
  },
  'call-forwarding/busy': {
    get: 'UserCallForwardingBusyGetRequest', modify: 'UserCallForwardingBusyModifyRequest',
    fields: [['isActive', V.bool], ['forwardToPhoneNumber', orNull(V.dest)]],
  },
  'call-forwarding/no-answer': {
    get: 'UserCallForwardingNoAnswerGetRequest13mp16', modify: 'UserCallForwardingNoAnswerModifyRequest',
    fields: [
      ['isActive', V.bool], ['forwardToPhoneNumber', orNull(V.dest)],
      ['numberOfRings', (v, n) => { const x = V.int(v, n, 0, 20); if (x === 1) throw bad(`${n} must be 0 (system default) or 2 to 20.`); return x; }],
    ],
  },
  dnd: {
    get: 'UserDoNotDisturbGetRequest', modify: 'UserDoNotDisturbModifyRequest',
    fields: [['isActive', V.bool], ['ringSplash', V.bool]],
  },
  voicemail: {
    get: 'UserVoiceMessagingUserGetVoiceManagementRequest17', modify: 'UserVoiceMessagingUserModifyVoiceManagementRequest',
    fields: [
      ['isActive', V.bool],
      ['processing', (v, n) => { if (!PROCESSING.includes(v)) throw bad(`${n} must be "${PROCESSING.join('" or "')}".`); return v; }],
      ['voiceMessageDeliveryEmailAddress', orNull(V.email)],
      ['usePhoneMessageWaitingIndicator', V.bool],
      ['sendVoiceMessageNotifyEmail', V.bool],
      ['voiceMessageNotifyEmailAddress', orNull(V.email)],
      ['sendCarbonCopyVoiceMessage', V.bool],
      ['voiceMessageCarbonCopyEmailAddress', orNull(V.email)],
      ['transferOnZeroToPhoneNumber', V.bool],
      ['transferPhoneNumber', orNull(V.outgoingDn)],
      ['alwaysRedirectToVoiceMail', V.bool],
      ['busyRedirectToVoiceMail', V.bool],
      ['noAnswerRedirectToVoiceMail', V.bool],
    ],
  },
};

// The OCI children for the fields present in the body, in schema order.
function fieldsXml(b, spec) {
  let xml = '';
  let n = 0;
  for (const [name, check] of spec) {
    if (b[name] === undefined) continue;
    xml += el(name, check(b[name], name));
    n++;
  }
  if (!n) throw bad(`Send at least one of ${spec.map(([name]) => name).join(', ')}.`);
  return xml;
}

// Reads the settings back after a change; null if that read fails (the
// change itself went through).
async function readBack(s, command, xml) {
  try { return shape(await s.send(command, xml)); } catch { return null; }
}
const SAVED_UNREAD = 'Saved. The new settings could not be read back; read them again in a moment.';

// ---- the router --------------------------------------------------------------

module.exports = function broadworksRoutes(h = defaultHandle) {
  // Exact paths only (letter case, trailing slash), like the entitlement
  // check that classified the request (lib/entitlements.js).
  const router = express.Router({ caseSensitive: true, strict: true });

  const groupCache = new Map();    // enterprise (lower case) -> { at, ids: Set (lower case), truncated }
  const userCache = new Map();     // userId (lower case) -> { at, sp }   (reads only)
  const domainCache = new Map();   // "enterprise/group" (lower case) -> { at, domains }

  const mp = (req) => req.marketplace || {};
  // May name any enterprise: marketplace admins and the internal key.
  const anyEnterprise = (req) => !!(mp(req).admin || mp(req).internal);
  // May see BroadWorks' own error text: Iristel staff, admins, the internal key.
  const insider = (req) => !!(mp(req).staff || mp(req).admin || mp(req).internal);
  // Whose turn on the BroadWorks queue this request takes.
  const callerOf = (req) => (mp(req).internal ? 'internal' : `user:${String(mp(req).email || 'anonymous').toLowerCase()}`);

  // h() plus: BroadWorks' own text (err.detail) goes to insiders only.
  const H = (fn) => h(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof AppError && err.detail && insider(req)) {
        throw new AppError(err.status, err.error, err.message, { ...err.meta, detail: err.detail });
      }
      throw err;
    }
  });

  // Off until the URL and login are set (the gateway also blocks preview products).
  router.use((req, res, next) => {
    if (bw.configured()) return next();
    const e = bw.notEnabled();
    return res.status(e.status).json(e.toJSON());
  });

  // The enterprise (serviceProviderId) this call works on.
  function enterprise(req) {
    const m = mp(req);
    const asked = req.query.enterprise;
    if (asked !== undefined && typeof asked !== 'string') throw bad('Send enterprise once, as text.');
    if (anyEnterprise(req)) {
      if (!asked) throw bad('Iristel admin and internal calls must name the enterprise: add ?enterprise=<serviceProviderId>.');
      return bw.checkId('enterprise', asked, 'enterprise');
    }
    const mine = bw.linksFor(Array.isArray(m.accountIds) ? m.accountIds : []);
    if (!mine.length) {
      throw new AppError(403, 'broadworks_not_linked', 'Your account isn\'t linked to a BroadWorks enterprise yet; ask Iristel support.');
    }
    if (asked) {
      const hit = mine.find((e) => same(e, asked));
      if (!hit) {
        throw new AppError(403, 'broadworks_scope', 'That enterprise isn\'t linked to your account. Leave enterprise out, or name one of yours.',
          { enterprises: mine });
      }
      return hit;
    }
    if (mine.length > 1) {
      throw new AppError(400, 'validation_error',
        `Your account is linked to ${mine.length} BroadWorks enterprises: add ?enterprise= with one of them.`, { enterprises: mine });
    }
    return mine[0];
  }

  // One queued task for this request.
  const task = (req, fn) => bw.run(callerOf(req), fn);

  async function readGroups(s, sp) {
    const r = await s.send('GroupGetListInServiceProviderRequest', el('serviceProviderId', sp) + el('responseSizeLimit', LIST_LIMIT));
    const rows = tableOf(r, 'groupTable');
    groupCache.set(sp.toLowerCase(), {
      at: Date.now(),
      ids: new Set(rows.map((g) => String(g.groupId || '').toLowerCase()).filter(Boolean)),
      truncated: rows.length >= LIST_LIMIT,
    });
    return rows;
  }

  async function checkGroup(s, g) {
    const gid = g.groupId.toLowerCase();
    let hit = groupCache.get(g.sp.toLowerCase());
    const age = hit ? Date.now() - hit.at : Infinity;
    if (!hit || age > GROUP_TTL_MS || (!hit.ids.has(gid) && age > GROUP_REFRESH_MS)) {
      await readGroups(s, g.sp);
      hit = groupCache.get(g.sp.toLowerCase());
    }
    if (hit.ids.has(gid)) return;
    if (hit.truncated) {
      // More groups than one list holds: look this one up by its id.
      const r = await s.send('GroupGetListInServiceProviderRequest', el('serviceProviderId', g.sp)
        + `<searchCriteriaGroupId>${el('mode', 'Equal To')}${el('value', g.groupId)}${el('isCaseInsensitive', true)}</searchCriteriaGroupId>`);
      if (tableOf(r, 'groupTable').some((x) => same(x.groupId, g.groupId))) { hit.ids.add(gid); return; }
    }
    throw groupNotFound(g.groupId);
  }

  // A task on a group of the caller's enterprise: fn(s, { sp, groupId }).
  function groupTask(req, fn) {
    const g = { sp: enterprise(req), groupId: bw.checkId('group', req.params.groupId, 'groupId') };
    return task(req, async (s) => { await checkGroup(s, g); return fn(s, g); });
  }

  // Reads the user (UserGetRequest22V5) and checks it is in the enterprise.
  async function lookUser(s, sp, userId) {
    let u;
    try {
      u = await s.send('UserGetRequest22V5', el('userId', userId));
    } catch (err) {
      // The same answer as for someone else's user, so ids can't be probed.
      if (err instanceof AppError && err.status === 404) throw userNotFound(userId);
      throw err;
    }
    if (typeof u.serviceProviderId === 'string') userCache.set(userId.toLowerCase(), { at: Date.now(), sp: u.serviceProviderId });
    if (!same(u.serviceProviderId, sp)) throw userNotFound(userId);
    return u;
  }

  // A task on a user of the caller's enterprise: fn(s, { sp, userId, user }).
  // fresh: always re-read the user (every change, and Get a user); otherwise
  // a recent read may stand in for it (user is then null).
  function userTask(req, fresh, fn) {
    const sp = enterprise(req);
    const userId = bw.checkId('user', req.params.userId, 'userId');
    return task(req, async (s) => {
      const hit = fresh ? null : userCache.get(userId.toLowerCase());
      let user = null;
      if (hit && Date.now() - hit.at < USER_READ_TTL_MS) {
        if (!same(hit.sp, sp)) throw userNotFound(userId);
      } else {
        user = await lookUser(s, sp, userId);
      }
      return fn(s, { sp, userId, user });
    });
  }

  async function groupDomains(s, g, refresh) {
    const key = `${g.sp}/${g.groupId}`.toLowerCase();
    const hit = domainCache.get(key);
    if (hit && !refresh && Date.now() - hit.at < DOMAIN_TTL_MS) return hit.domains;
    const r = await s.send('GroupDomainGetAssignedListRequest', groupFields(g));
    const domains = [...new Set([r.groupDefaultDomain, ...listOf(r.domain)]
      .filter((d) => typeof d === 'string' && d).map((d) => d.toLowerCase()))];
    domainCache.set(key, { at: Date.now(), domains });
    return domains;
  }

  const groupFields = (g) => el('serviceProviderId', g.sp) + el('groupId', g.groupId);
  const tgKey = (g, name) => `<trunkGroupKey>${groupFields(g)}${el('name', name)}</trunkGroupKey>`;

  // ---- connection -----------------------------------------------------------

  router.get('/health', H(async (req, res) => {
    await bw.health(callerOf(req));
    const out = { ok: true };
    if (!anyEnterprise(req)) out.linked = bw.linksFor(Array.isArray(mp(req).accountIds) ? mp(req).accountIds : []).length > 0;
    res.json(out);
  }));

  // ---- enterprise -----------------------------------------------------------

  router.get('/enterprise', H(async (req, res) => {
    const sp = enterprise(req);
    const r = await task(req, (s) => s.send('ServiceProviderGetRequest22V2', el('serviceProviderId', sp)));
    res.json({ serviceProviderId: sp, ...shape(r) });
  }));

  router.get('/enterprise/dns', H(async (req, res) => {
    const sp = enterprise(req);
    const r = await task(req, (s) => s.send('ServiceProviderDnGetSummaryListRequest', el('serviceProviderId', sp)));
    res.json(listJson(tableOf(r, 'dnSummaryTable')));
  }));

  // ---- groups ---------------------------------------------------------------

  router.get('/groups', H(async (req, res) => {
    const sp = enterprise(req);
    res.json(listJson(await task(req, (s) => readGroups(s, sp)), LIST_LIMIT));
  }));

  router.get('/groups/:groupId', H(async (req, res) => {
    const { g, r } = await groupTask(req, async (s, g) => ({ g, r: await s.send('GroupGetRequest22V2', groupFields(g)) }));
    res.json({ serviceProviderId: g.sp, groupId: g.groupId, ...shape(r) });
  }));

  router.get('/groups/:groupId/dns', H(async (req, res) => {
    const r = await groupTask(req, (s, g) => s.send('GroupDnGetAssignmentListRequest18', groupFields(g)));
    res.json(listJson(tableOf(r, 'dnTable')));
  }));

  router.get('/groups/:groupId/dns/available', H(async (req, res) => {
    const r = await groupTask(req, (s, g) => s.send('GroupDnGetAvailableListRequest', groupFields(g)));
    const all = listOf(r.phoneNumber).filter((x) => typeof x === 'string');
    res.json(listJson(all));
  }));

  const dnChange = (command, done) => H(async (req, res) => {
    const numbers = numbersOf(bodyOf(req, ['numbers']));
    const g = await groupTask(req, async (s, grp) => {
      await s.send(command, groupFields(grp) + numbers.map((n) => el('phoneNumber', n)).join(''));
      return grp;
    });
    res.json({ ok: true, groupId: g.groupId, [done]: numbers });
  });
  router.post('/groups/:groupId/dns/assign', dnChange('GroupDnAssignListRequest', 'assigned'));
  router.post('/groups/:groupId/dns/unassign', dnChange('GroupDnUnassignListRequest', 'unassigned'));
  router.post('/groups/:groupId/dns/activate', dnChange('GroupDnActivateListRequest', 'activated'));

  // ---- users ----------------------------------------------------------------

  router.get('/groups/:groupId/users', H(async (req, res) => {
    const limit = req.query.limit === undefined ? LIST_LIMIT : V.int(req.query.limit, 'limit', 1, LIST_LIMIT);
    const r = await groupTask(req, (s, g) => s.send('UserGetListInGroupRequest', groupFields(g) + el('responseSizeLimit', limit)));
    res.json(listJson(tableOf(r, 'userTable'), limit));
  }));

  // UserAddRequest22, required fields and a few common optional ones, in schema order.
  const ADD_FIELDS = ['userId', 'lastName', 'firstName', 'callingLineIdLastName', 'callingLineIdFirstName',
    'phoneNumber', 'extension', 'password', 'timeZone', 'emailAddress'];
  router.post('/groups/:groupId/users', H(async (req, res) => {
    const b = bodyOf(req, ADD_FIELDS);
    if (b.userId === undefined || b.lastName === undefined || b.firstName === undefined) {
      throw bad('userId, lastName and firstName are required.');
    }
    const userId = bw.checkId('user', typeof b.userId === 'string' ? b.userId.trim() : b.userId, 'userId');
    const domain = userId.slice(userId.lastIndexOf('@') + 1).toLowerCase();
    const lastName = V.text(b.lastName, 'lastName');
    const firstName = V.text(b.firstName, 'firstName');
    const opt = (name, check) => (b[name] === undefined || b[name] === '' ? undefined : check(b[name], name));
    const timeZone = opt('timeZone', (v, n) => {
      if (typeof v !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v)) throw bad(`${n} must be a time zone such as America/Toronto.`);
      return v;
    });
    const xml = el('userId', userId)
      + el('lastName', lastName)
      + el('firstName', firstName)
      + el('callingLineIdLastName', opt('callingLineIdLastName', V.text) ?? lastName)
      + el('callingLineIdFirstName', opt('callingLineIdFirstName', V.text) ?? firstName)
      + el('phoneNumber', opt('phoneNumber', V.phone))
      + el('extension', opt('extension', V.extension))
      + el('password', opt('password', V.password))
      + el('timeZone', timeZone)
      + el('emailAddress', opt('emailAddress', V.email));
    const g = await groupTask(req, async (s, grp) => {
      // Only the group's own domains: an id at someone else's domain is refused
      // before BroadWorks is asked, so it can't tell whose ids exist.
      let domains = await groupDomains(s, grp);
      if (!domains.includes(domain)) domains = await groupDomains(s, grp, true);
      if (!domains.includes(domain)) {
        throw bad(`userId must be name@domain with one of the group's domains: ${domains.join(', ') || '(none assigned)'}.`);
      }
      try {
        await s.send('UserAddRequest22', groupFields(grp) + xml);
      } catch (err) {
        if (err instanceof AppError && err.status === 409) {
          throw Object.assign(new AppError(409, 'conflict', 'That user id can\'t be used. Pick another.', err.meta), { detail: err.detail });
        }
        throw err;
      }
      return grp;
    });
    userCache.delete(userId.toLowerCase());
    res.status(201).json({ ok: true, userId, groupId: g.groupId });
  }));

  router.get('/users/:userId', H(async (req, res) => {
    const { userId, user } = await userTask(req, true, async (s, u) => u);
    res.json({ userId, ...shape(user) });
  }));

  // UserModifyRequest22: names, numbers and caller id, in schema order.
  const MODIFY_FIELDS = [
    ['lastName', V.text], ['firstName', V.text],
    ['callingLineIdLastName', V.text], ['callingLineIdFirstName', V.text],
    ['phoneNumber', orNull(V.phone)], ['extension', orNull(V.extension)],
    ['callingLineIdPhoneNumber', orNull(V.phone)],
  ];
  router.patch('/users/:userId', H(async (req, res) => {
    const xml = fieldsXml(bodyOf(req, MODIFY_FIELDS.map(([n]) => n)), MODIFY_FIELDS);
    const out = await userTask(req, true, async (s, u) => {
      await s.send('UserModifyRequest22', el('userId', u.userId) + xml);
      const fresh = await readBack(s, 'UserGetRequest22V5', el('userId', u.userId));
      return fresh ? { userId: u.userId, ...fresh } : { ok: true, userId: u.userId, note: SAVED_UNREAD };
    });
    res.json(out);
  }));

  router.delete('/users/:userId', H(async (req, res) => {
    bodyOf(req, []);
    const userId = await userTask(req, true, async (s, u) => {
      try {
        await s.send('UserDeleteRequest', el('userId', u.userId));
      } finally {
        userCache.clear();
      }
      return u.userId;
    });
    res.json({ ok: true, userId, deleted: true });
  }));

  router.get('/users/:userId/services', H(async (req, res) => {
    const r = await userTask(req, false, (s, u) => s.send('UserServiceGetAssignmentListRequest', el('userId', u.userId)));
    const rows = (v) => shape(listOf(v).filter((x) => x && typeof x === 'object'));
    res.json({ userServices: rows(r.userServicesAssignmentTable), servicePacks: rows(r.servicePacksAssignmentTable) });
  }));

  router.post('/users/:userId/services/assign', H(async (req, res) => {
    const b = bodyOf(req, ['services', 'servicePacks']);
    const list = (v, name, check) => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.length > MAX_LIST) throw bad(`${name} must be a list of at most ${MAX_LIST} names.`);
      return [...new Set(v.map((x) => check(x, `${name}[]`)))];
    };
    const services = list(b.services, 'services', (v, n) => {
      if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._()+/-]{0,79}$/.test(v.trim())) {
        throw bad(`${n}: "${String(v).slice(0, 40)}" is not a BroadWorks service name (e.g. "Call Forwarding Always").`);
      }
      return v.trim();
    });
    const servicePacks = list(b.servicePacks, 'servicePacks', (v, n) => V.text(v, n, 80));
    if (!services.length && !servicePacks.length) throw bad('Send services and/or servicePacks: lists of names to assign.');
    const userId = await userTask(req, true, async (s, u) => {
      await s.send('UserServiceAssignListRequest', el('userId', u.userId)
        + services.map((x) => el('serviceName', x)).join('')
        + servicePacks.map((x) => el('servicePackName', x)).join(''));
      return u.userId;
    });
    res.json({ ok: true, userId, services, servicePacks });
  }));

  router.get('/users/:userId/registrations', H(async (req, res) => {
    const r = await userTask(req, false, (s, u) => s.send('UserGetRegistrationListRequest', el('userId', u.userId)));
    res.json(listJson(tableOf(r, 'registrationTable')));
  }));

  for (const [path, f] of Object.entries(FEATURES)) {
    router.get(`/users/:userId/${path}`, H(async (req, res) => {
      const out = await userTask(req, false, async (s, u) => ({ userId: u.userId, ...shape(await s.send(f.get, el('userId', u.userId))) }));
      res.json(out);
    }));
    router.put(`/users/:userId/${path}`, H(async (req, res) => {
      const xml = fieldsXml(bodyOf(req, f.fields.map(([n]) => n)), f.fields);
      const out = await userTask(req, true, async (s, u) => {
        await s.send(f.modify, el('userId', u.userId) + xml);
        const now = await readBack(s, f.get, el('userId', u.userId));
        return now ? { userId: u.userId, ...now } : { ok: true, userId: u.userId, note: SAVED_UNREAD };
      });
      res.json(out);
    }));
  }

  // ---- trunk groups -----------------------------------------------------------

  router.get('/groups/:groupId/trunk-groups', H(async (req, res) => {
    const r = await groupTask(req, (s, g) => s.send('GroupTrunkGroupGetInstanceListRequest14sp4', groupFields(g)));
    res.json(listJson(tableOf(r, 'trunkGroupTable')));
  }));

  router.get('/groups/:groupId/trunk-groups/:name', H(async (req, res) => {
    const name = bw.checkId('name', req.params.name, 'name');
    const { g, r } = await groupTask(req, async (s, grp) => ({ g: grp, r: await s.send('GroupTrunkGroupGetInstanceRequest23', tgKey(grp, name)) }));
    res.json({ groupId: g.groupId, name, ...shape(r) });
  }));

  // Capacity and bursting only, in schema order (after newName, pilotUserId,
  // department and accessDevice, which are not offered).
  const calls = (v, n) => V.int(v, n, 0, 999999);
  const TRUNK_FIELDS = [
    ['maxActiveCalls', calls], ['maxIncomingCalls', orNull(calls)], ['maxOutgoingCalls', orNull(calls)],
    ['enableBursting', V.bool],
    ['burstingMaxActiveCalls', orNull(calls)], ['burstingMaxIncomingCalls', orNull(calls)], ['burstingMaxOutgoingCalls', orNull(calls)],
  ];
  router.patch('/groups/:groupId/trunk-groups/:name', H(async (req, res) => {
    const xml = fieldsXml(bodyOf(req, TRUNK_FIELDS.map(([n]) => n)), TRUNK_FIELDS);
    const name = bw.checkId('name', req.params.name, 'name');
    const out = await groupTask(req, async (s, g) => {
      await s.send('GroupTrunkGroupModifyInstanceRequest20sp1', tgKey(g, name) + xml);
      const now = await readBack(s, 'GroupTrunkGroupGetInstanceRequest23', tgKey(g, name));
      return now ? { groupId: g.groupId, name, ...now } : { ok: true, groupId: g.groupId, name, note: SAVED_UNREAD };
    });
    res.json(out);
  }));

  // ---- devices ----------------------------------------------------------------

  router.get('/groups/:groupId/devices', H(async (req, res) => {
    const r = await groupTask(req, (s, g) => s.send('GroupAccessDeviceGetListRequest', groupFields(g) + el('responseSizeLimit', LIST_LIMIT)));
    res.json(listJson(tableOf(r, 'accessDeviceTable'), LIST_LIMIT));
  }));

  router.get('/groups/:groupId/devices/:deviceName', H(async (req, res) => {
    const deviceName = bw.checkId('name', req.params.deviceName, 'deviceName');
    const { g, r } = await groupTask(req, async (s, grp) => ({ g: grp, r: await s.send('GroupAccessDeviceGetRequest18sp1', groupFields(grp) + el('deviceName', deviceName)) }));
    res.json({ groupId: g.groupId, deviceName, ...shape(r) });
  }));

  router.post('/groups/:groupId/devices/:deviceName/reset', H(async (req, res) => {
    bodyOf(req, []);
    const deviceName = bw.checkId('name', req.params.deviceName, 'deviceName');
    const g = await groupTask(req, async (s, grp) => {
      await s.send('GroupAccessDeviceResetRequest', groupFields(grp) + el('deviceName', deviceName));
      return grp;
    });
    res.json({ ok: true, groupId: g.groupId, deviceName, reset: true });
  }));

  // ---- group services ---------------------------------------------------------

  router.get('/groups/:groupId/hunt-groups', H(async (req, res) => {
    const r = await groupTask(req, (s, g) => s.send('GroupHuntGroupGetInstanceListRequest', groupFields(g)));
    res.json(listJson(tableOf(r, 'huntGroupTable')));
  }));

  router.get('/groups/:groupId/auto-attendants', H(async (req, res) => {
    const r = await groupTask(req, (s, g) => s.send('GroupAutoAttendantGetInstanceListRequest', groupFields(g)));
    res.json(listJson(tableOf(r, 'autoAttendantTable')));
  }));

  return router;
};
