'use strict';

/**
 * BroadWorks (Hosted Voice): Cisco BroadWorks provisioning over OCI-P
 * (lib/routes/broadworks.js, lib/broadworks.js). Reference: Cisco BroadWorks
 * "Application Server Provisioning Interface Specification", Release 23;
 * every upstream command below is listed in its Appendix B.
 *
 * The gateway signs in to BroadWorks for you. A partner works on the
 * enterprise (service provider) linked to their account, and only on that
 * enterprise's groups and users; Iristel staff name the enterprise with
 * ?enterprise=.
 */

const ENTERPRISE = {
  name: 'enterprise', in: 'query', required: false,
  description: 'Leave it out: the enterprise linked to your account is used (name one only if your account has several). Iristel marketplace admins and the internal key: required, the enterprise (service provider) id.',
};
const GROUP = { name: 'groupId', in: 'path', required: true, description: 'The group id, exactly as List groups shows it.' };
const USER = { name: 'userId', in: 'path', required: true, description: 'The full user id, name@domain: 6135550100@voice.example.com.' };
const TRUNK = { name: 'name', in: 'path', required: true, description: 'The trunk group name, exactly as List trunk groups shows it.' };
const DEVICE = { name: 'deviceName', in: 'path', required: true, description: 'The device name, exactly as List devices shows it.' };

const NOT_LINKED = { code: 403, when: 'broadworks_not_linked: your account isn\'t linked to a BroadWorks enterprise yet; ask Iristel support.' };
const NEEDS_ENTERPRISE = { code: 400, when: 'validation_error: Iristel admin and internal calls must add ?enterprise=<id>.' };
const BUSY = { code: 429, when: 'busy: you have too many BroadWorks requests waiting. Wait for them to finish (retryAfter seconds).' };
const UNKNOWN = { code: 502, when: 'outcome_unknown: BroadWorks didn\'t confirm the change and it may have been made. Check the current state before you retry.' };
const NO_GROUP = { code: 404, when: 'not_found: no such group in your enterprise.' };
const NO_USER = { code: 404, when: 'not_found: no such user in your enterprise.' };
const REFUSED = { code: 400, when: 'broadworks_error: BroadWorks refused the request; code is its error number. (Iristel staff also see BroadWorks\' own text as detail.)' };
const CONFLICT = { code: 409, when: 'conflict: the id or number is already in use.' };
const FORBIDDEN = { code: 403, when: 'broadworks_forbidden ([Error 4003]): the gateway\'s BroadWorks login may not do this. Contact Iristel support.' };
const SCOPED = [NOT_LINKED, NEEDS_ENTERPRISE, BUSY];
const IN_GROUP = [...SCOPED, NO_GROUP, REFUSED];
const IN_USER = [...SCOPED, NO_USER, REFUSED, FORBIDDEN];

const NUMBERS_FIELD = { name: 'numbers[]', required: true, description: '1 to 50 phone numbers: digits only (6135550100), or with the country code (+1-6135550100).' };
const BOOL = (what) => `true or false: ${what}`;
const FWD = 'Where calls go: a phone number (digits, optionally + * #) or a SIP address (user@host). Send null to clear it.';

// GET and PUT for a user feature.
function feature(path, title, get, modify, fields, returns, body) {
  return [
    {
      method: 'GET', path: `/api/broadworks/users/:userId/${path}`, upstream: `OCI-P ${get}`,
      summary: `Get ${title}`,
      description: `The user's ${title} settings.`,
      params: [USER, ENTERPRISE],
      returns: `{ userId, ${returns} }`,
      errors: IN_USER,
    },
    {
      method: 'PUT', path: `/api/broadworks/users/:userId/${path}`, upstream: `OCI-P ${modify} + ${get}`,
      summary: `Set ${title}`,
      description: `Changes the ${title} settings you send and leaves the others as they are. Answers with the settings now in force.`,
      params: [USER, ENTERPRISE],
      body,
      fields,
      returns: `{ userId, ${returns} }, after the change.`,
      errors: [{ code: 400, when: 'validation_error: no field sent, an unknown field, or a value in the wrong form.' }, ...IN_USER, UNKNOWN],
    },
  ];
}

module.exports = [
  // ---- connection and enterprise ---------------------------------------------
  {
    method: 'GET', path: '/api/broadworks/health', upstream: 'OCI-P LoginRequest22V3 (when needed) + AvailabilityTestRequest',
    summary: 'Check the connection',
    description: 'Confirms the gateway can sign in to BroadWorks and reach it. Reads no enterprise data. Partners also see whether their account is linked to an enterprise yet.',
    returns: '{ ok: true, linked } (linked: partners only, true once Iristel has linked your account to a BroadWorks enterprise).',
    errors: [{ code: 502, when: 'broadworks_auth or upstream_unreachable: the gateway could not sign in to or reach BroadWorks. Contact Iristel support.' }],
  },
  {
    method: 'GET', path: '/api/broadworks/enterprise', upstream: 'OCI-P ServiceProviderGetRequest22V2',
    summary: 'Get your enterprise',
    description: 'Your enterprise\'s profile on BroadWorks: name, contact, address and support email.',
    params: [ENTERPRISE],
    returns: '{ serviceProviderId, isEnterprise, serviceProviderName, supportEmail, contact: { contactName, contactNumber, contactEmail }, address: { … }, … }',
    errors: [...SCOPED, FORBIDDEN],
  },
  {
    method: 'GET', path: '/api/broadworks/enterprise/dns', upstream: 'OCI-P ServiceProviderDnGetSummaryListRequest',
    summary: 'List your enterprise\'s numbers',
    description: 'Every phone number (DN) in your enterprise, with the group it is assigned to (if any) and whether it is activated.',
    params: [ENTERPRISE],
    returns: '{ data: [{ phoneNumbers, groupId, assigned, activated, … }], total }: one row per number or range, columns as BroadWorks names them.',
    errors: [...SCOPED, FORBIDDEN],
  },

  // ---- groups ------------------------------------------------------------------
  {
    method: 'GET', path: '/api/broadworks/groups', upstream: 'OCI-P GroupGetListInServiceProviderRequest',
    summary: 'List groups',
    description: 'The groups (sites or customers) in your enterprise. Use a groupId from here in the group calls.',
    params: [ENTERPRISE],
    returns: '{ data: [{ groupId, groupName, userLimit }], total }; at most 1000, with truncated: true and a note when there are more.',
    errors: SCOPED,
  },
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId', upstream: 'OCI-P GroupGetRequest22V2',
    summary: 'Get a group',
    description: 'One group\'s profile: name, default domain, user limit and count, time zone, contact and address.',
    params: [GROUP, ENTERPRISE],
    returns: '{ serviceProviderId, groupId, groupName, defaultDomain, userLimit, userCount, timeZone, callingLineIdName, contact, address, … }',
    errors: IN_GROUP,
  },
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/dns', upstream: 'OCI-P GroupDnGetAssignmentListRequest18',
    summary: 'List a group\'s numbers',
    description: 'The phone numbers assigned to the group, whether each is activated, and the user it belongs to, if any.',
    params: [GROUP, ENTERPRISE],
    returns: '{ data: [{ phoneNumbers, department, activated, userId, lastName, firstName, extension, emailAddress, userType, … }], total }',
    errors: IN_GROUP,
  },
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/dns/available', upstream: 'OCI-P GroupDnGetAvailableListRequest',
    summary: 'List a group\'s free numbers',
    description: 'Numbers assigned to the group but not yet given to a user or service: ready for Add a user or Update a user.',
    params: [GROUP, ENTERPRISE],
    returns: '{ data: ["6135550100", …], total }',
    errors: IN_GROUP,
  },
  {
    method: 'POST', path: '/api/broadworks/groups/:groupId/dns/assign', upstream: 'OCI-P GroupDnAssignListRequest',
    summary: 'Assign numbers to a group',
    description: 'Moves numbers from your enterprise\'s pool to the group. The numbers must already be in your enterprise (List your enterprise\'s numbers).',
    params: [GROUP, ENTERPRISE],
    body: { numbers: ['6135550100', '6135550101'] },
    fields: [NUMBERS_FIELD],
    returns: '{ ok: true, groupId, assigned: [numbers] }',
    errors: [{ code: 400, when: 'validation_error: no list, more than 50 numbers, or a number in the wrong form.' }, ...IN_GROUP, CONFLICT, UNKNOWN],
  },
  {
    method: 'POST', path: '/api/broadworks/groups/:groupId/dns/unassign', upstream: 'OCI-P GroupDnUnassignListRequest',
    summary: 'Return numbers to the enterprise',
    description: 'Takes numbers off the group and puts them back in your enterprise\'s pool. Numbers a user or service still has are refused.',
    params: [GROUP, ENTERPRISE],
    body: { numbers: ['6135550101'] },
    fields: [NUMBERS_FIELD],
    returns: '{ ok: true, groupId, unassigned: [numbers] }',
    errors: [{ code: 400, when: 'validation_error: no list, more than 50 numbers, or a number in the wrong form.' }, ...IN_GROUP, CONFLICT, UNKNOWN],
  },
  {
    method: 'POST', path: '/api/broadworks/groups/:groupId/dns/activate', upstream: 'OCI-P GroupDnActivateListRequest',
    summary: 'Activate numbers',
    description: 'Activates numbers of the group so they take calls (for example once a port completes).',
    params: [GROUP, ENTERPRISE],
    body: { numbers: ['6135550100'] },
    fields: [NUMBERS_FIELD],
    returns: '{ ok: true, groupId, activated: [numbers] }',
    errors: [{ code: 400, when: 'validation_error: no list, more than 50 numbers, or a number in the wrong form.' }, ...IN_GROUP, CONFLICT, UNKNOWN],
  },

  // ---- users -------------------------------------------------------------------
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/users', upstream: 'OCI-P UserGetListInGroupRequest',
    summary: 'List a group\'s users',
    description: 'The users in a group, with their number, extension and email.',
    params: [GROUP, ENTERPRISE, { name: 'limit', in: 'query', required: false, description: 'At most this many users, 1 to 1000 (default 1000).' }],
    returns: '{ data: [{ userId, lastName, firstName, department, phoneNumber, phoneNumberActivated, emailAddress, inTrunkGroup, extension, … }], total }, plus truncated: true and a note when the limit was reached.',
    errors: IN_GROUP,
  },
  {
    method: 'POST', path: '/api/broadworks/groups/:groupId/users', upstream: 'OCI-P GroupDomainGetAssignedListRequest + UserAddRequest22',
    summary: 'Add a user',
    description: 'Creates a user in the group. The user id must be name@domain with one of the group\'s domains. Caller-ID names default to the user\'s names. Give the user a number from List a group\'s free numbers, then assign services.',
    params: [GROUP, ENTERPRISE],
    body: { userId: '6135550100@voice.example.com', lastName: 'Tremblay', firstName: 'Marie', phoneNumber: '6135550100', extension: '0100' },
    fields: [
      { name: 'userId', required: true, description: 'The new user\'s id: name@domain, where domain is one of the group\'s domains (usually the number at the group\'s default domain).' },
      { name: 'lastName', required: true, description: 'Last name, 1 to 30 characters.' },
      { name: 'firstName', required: true, description: 'First name, 1 to 30 characters.' },
      { name: 'callingLineIdLastName', required: false, description: 'Caller-ID last name (default: lastName).' },
      { name: 'callingLineIdFirstName', required: false, description: 'Caller-ID first name (default: firstName).' },
      { name: 'phoneNumber', required: false, description: 'A free number of the group, digits only.' },
      { name: 'extension', required: false, description: '2 to 20 digits, within the group\'s extension length.' },
      { name: 'password', required: false, description: 'The user\'s web portal password; must meet the group\'s password rules. Never returned.' },
      { name: 'timeZone', required: false, description: 'Time zone such as America/Toronto (default: the group\'s).' },
      { name: 'emailAddress', required: false, description: 'The user\'s email address.' },
    ],
    returns: '201 { ok: true, userId, groupId }',
    errors: [
      { code: 400, when: 'validation_error: a required field is missing, an unknown field, a value in the wrong form, or a userId whose domain isn\'t one of the group\'s (the message lists them).' },
      ...IN_GROUP,
      { code: 409, when: 'conflict: that user id is already taken. Pick another.' },
      UNKNOWN,
    ],
  },
  {
    method: 'GET', path: '/api/broadworks/users/:userId', upstream: 'OCI-P UserGetRequest22V5',
    summary: 'Get a user',
    description: 'One user\'s profile: group, names, caller ID, number, extension, email, time zone and device.',
    params: [USER, ENTERPRISE],
    returns: '{ userId, serviceProviderId, groupId, lastName, firstName, callingLineIdLastName, callingLineIdFirstName, phoneNumber, extension, callingLineIdPhoneNumber, emailAddress, timeZone, defaultAlias, accessDeviceEndpoint, countryCode, … }',
    errors: IN_USER,
  },
  {
    method: 'PATCH', path: '/api/broadworks/users/:userId', upstream: 'OCI-P UserModifyRequest22 + UserGetRequest22V5',
    summary: 'Update a user',
    description: 'Changes the names, number, extension or caller ID you send and leaves the rest. Send null for phoneNumber, extension or callingLineIdPhoneNumber to remove it. Answers with the updated user.',
    params: [USER, ENTERPRISE],
    body: { extension: '0101', callingLineIdPhoneNumber: '6135550100' },
    fields: [
      { name: 'lastName', required: false, description: 'Last name, 1 to 30 characters.' },
      { name: 'firstName', required: false, description: 'First name, 1 to 30 characters.' },
      { name: 'callingLineIdLastName', required: false, description: 'Caller-ID last name.' },
      { name: 'callingLineIdFirstName', required: false, description: 'Caller-ID first name.' },
      { name: 'phoneNumber', required: false, description: 'A free number of the group, digits only; null removes it.' },
      { name: 'extension', required: false, description: '2 to 20 digits; null removes it.' },
      { name: 'callingLineIdPhoneNumber', required: false, description: 'The number shown as caller ID; null removes it.' },
    ],
    returns: 'The user, as Get a user returns it, after the change.',
    errors: [{ code: 400, when: 'validation_error: no field sent, an unknown field, or a value in the wrong form.' }, ...IN_USER, UNKNOWN],
  },
  {
    method: 'DELETE', path: '/api/broadworks/users/:userId', upstream: 'OCI-P UserDeleteRequest',
    summary: 'Delete a user',
    description: 'Deletes the user and all their settings and voicemail. Their number goes back to the group\'s free numbers. This cannot be undone.',
    params: [USER, ENTERPRISE],
    returns: '{ ok: true, userId, deleted: true }',
    errors: [...IN_USER, UNKNOWN],
  },
  {
    method: 'GET', path: '/api/broadworks/users/:userId/services', upstream: 'OCI-P UserServiceGetAssignmentListRequest',
    summary: 'List a user\'s services',
    description: 'Every service and service pack the user can have, and which are assigned.',
    params: [USER, ENTERPRISE],
    returns: '{ userServices: [{ serviceName, assigned }], servicePacks: [{ servicePackName, assigned, description }] }',
    errors: IN_USER,
  },
  {
    method: 'POST', path: '/api/broadworks/users/:userId/services/assign', upstream: 'OCI-P UserServiceAssignListRequest',
    summary: 'Assign services to a user',
    description: 'Assigns services and/or service packs, by name as List a user\'s services shows them. Services must be authorised for the group.',
    params: [USER, ENTERPRISE],
    body: { services: ['Call Forwarding Always', 'Voice Messaging User'], servicePacks: [] },
    fields: [
      { name: 'services[]', required: false, description: 'Service names, e.g. "Call Forwarding Always" (up to 50).' },
      { name: 'servicePacks[]', required: false, description: 'Service pack names (up to 50). Send services, servicePacks or both.' },
    ],
    returns: '{ ok: true, userId, services, servicePacks }',
    errors: [{ code: 400, when: 'validation_error: nothing to assign, or a name in the wrong form. broadworks_error: a service isn\'t authorised for the group.' }, ...IN_USER, UNKNOWN],
  },
  {
    method: 'GET', path: '/api/broadworks/users/:userId/registrations', upstream: 'OCI-P UserGetRegistrationListRequest',
    summary: 'List a user\'s registrations',
    description: 'The SIP registrations of the user\'s phones and clients now: device, contact URI, expiry, user agent and addresses. Use it to see whether a phone is online.',
    params: [USER, ENTERPRISE],
    returns: '{ data: [{ deviceLevel, deviceName, order, uri, expiration, linePort, endpointType, publicNetAddress, publicPort, privateNetAddress, privatePort, userAgent, … }], total }',
    errors: IN_USER,
  },

  // ---- features ----------------------------------------------------------------
  ...feature('call-forwarding/always', 'call forwarding always',
    'UserCallForwardingAlwaysGetRequest', 'UserCallForwardingAlwaysModifyRequest',
    [
      { name: 'isActive', required: false, description: BOOL('forward every call.') },
      { name: 'forwardToPhoneNumber', required: false, description: FWD },
      { name: 'isRingSplashActive', required: false, description: BOOL('play a short ring on the phone when a call is forwarded.') },
    ],
    'isActive, forwardToPhoneNumber, isRingSplashActive',
    { isActive: true, forwardToPhoneNumber: '6135550199' }),
  ...feature('call-forwarding/busy', 'call forwarding busy',
    'UserCallForwardingBusyGetRequest', 'UserCallForwardingBusyModifyRequest',
    [
      { name: 'isActive', required: false, description: BOOL('forward calls while the user is on a call.') },
      { name: 'forwardToPhoneNumber', required: false, description: FWD },
    ],
    'isActive, forwardToPhoneNumber',
    { isActive: true, forwardToPhoneNumber: '6135550199' }),
  ...feature('call-forwarding/no-answer', 'call forwarding no answer',
    'UserCallForwardingNoAnswerGetRequest13mp16', 'UserCallForwardingNoAnswerModifyRequest',
    [
      { name: 'isActive', required: false, description: BOOL('forward calls that aren\'t answered.') },
      { name: 'forwardToPhoneNumber', required: false, description: FWD },
      { name: 'numberOfRings', required: false, description: 'Rings before forwarding: 2 to 20, or 0 for the system default.' },
    ],
    'isActive, forwardToPhoneNumber, numberOfRings',
    { isActive: true, forwardToPhoneNumber: '6135550199', numberOfRings: 4 }),
  ...feature('dnd', 'do not disturb',
    'UserDoNotDisturbGetRequest', 'UserDoNotDisturbModifyRequest',
    [
      { name: 'isActive', required: false, description: BOOL('send every call to busy treatment (voicemail, if the user has it).') },
      { name: 'ringSplash', required: false, description: BOOL('play a short ring on the phone when a call is blocked.') },
    ],
    'isActive, ringSplash',
    { isActive: true }),
  ...feature('voicemail', 'voicemail',
    'UserVoiceMessagingUserGetVoiceManagementRequest17', 'UserVoiceMessagingUserModifyVoiceManagementRequest',
    [
      { name: 'isActive', required: false, description: BOOL('voicemail on.') },
      { name: 'processing', required: false, description: '"Unified Voice and Email Messaging" (messages kept in the mailbox) or "Deliver To Email Address Only".' },
      { name: 'voiceMessageDeliveryEmailAddress', required: false, description: 'Where messages are emailed with "Deliver To Email Address Only"; null clears it.' },
      { name: 'usePhoneMessageWaitingIndicator', required: false, description: BOOL('light the phone\'s message-waiting lamp.') },
      { name: 'sendVoiceMessageNotifyEmail', required: false, description: BOOL('email a notice for each new message.') },
      { name: 'voiceMessageNotifyEmailAddress', required: false, description: 'Where notices go; null clears it.' },
      { name: 'sendCarbonCopyVoiceMessage', required: false, description: BOOL('email a copy of each message.') },
      { name: 'voiceMessageCarbonCopyEmailAddress', required: false, description: 'Where copies go; null clears it.' },
      { name: 'transferOnZeroToPhoneNumber', required: false, description: BOOL('callers can press 0 to reach another number.') },
      { name: 'transferPhoneNumber', required: false, description: 'The number 0 transfers to (digits, optionally + * #); null clears it.' },
      { name: 'alwaysRedirectToVoiceMail', required: false, description: BOOL('send every call straight to voicemail.') },
      { name: 'busyRedirectToVoiceMail', required: false, description: BOOL('send calls to voicemail while busy.') },
      { name: 'noAnswerRedirectToVoiceMail', required: false, description: BOOL('send unanswered calls to voicemail.') },
    ],
    'isActive, processing, voiceMessageDeliveryEmailAddress, usePhoneMessageWaitingIndicator, sendVoiceMessageNotifyEmail, voiceMessageNotifyEmailAddress, sendCarbonCopyVoiceMessage, voiceMessageCarbonCopyEmailAddress, transferOnZeroToPhoneNumber, transferPhoneNumber, alwaysRedirectToVoiceMail, busyRedirectToVoiceMail, noAnswerRedirectToVoiceMail, outOfPrimaryZoneRedirectToVoiceMail',
    { isActive: true, busyRedirectToVoiceMail: true, noAnswerRedirectToVoiceMail: true }),

  // ---- trunk groups ------------------------------------------------------------
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/trunk-groups', upstream: 'OCI-P GroupTrunkGroupGetInstanceListRequest14sp4',
    summary: 'List trunk groups',
    description: 'The group\'s SIP trunk groups.',
    params: [GROUP, ENTERPRISE],
    returns: '{ data: [{ name, department, … }], total }: columns as BroadWorks names them.',
    errors: IN_GROUP,
  },
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/trunk-groups/:name', upstream: 'OCI-P GroupTrunkGroupGetInstanceRequest23',
    summary: 'Get a trunk group',
    description: 'One trunk group: pilot user, access device, call capacity and bursting, and its routing and authentication options. Passwords are never returned.',
    params: [GROUP, TRUNK, ENTERPRISE],
    returns: '{ groupId, name, pilotUserId, accessDevice, maxActiveCalls, maxIncomingCalls, maxOutgoingCalls, enableBursting, burstingMaxActiveCalls, capacityExceededAction, … }',
    errors: [...IN_GROUP, { code: 404, when: 'not_found: no such trunk group in the group.' }],
  },
  {
    method: 'PATCH', path: '/api/broadworks/groups/:groupId/trunk-groups/:name', upstream: 'OCI-P GroupTrunkGroupModifyInstanceRequest20sp1 + GroupTrunkGroupGetInstanceRequest23',
    summary: 'Change trunk capacity',
    description: 'Changes the trunk group\'s call capacity and bursting, and leaves everything else. Limits can\'t exceed what Iristel set for your enterprise. Answers with the trunk group after the change.',
    params: [GROUP, TRUNK, ENTERPRISE],
    body: { maxActiveCalls: 20, enableBursting: true, burstingMaxActiveCalls: 5 },
    fields: [
      { name: 'maxActiveCalls', required: false, description: 'Most calls at once, in and out together.' },
      { name: 'maxIncomingCalls', required: false, description: 'Most incoming calls at once; null removes the limit.' },
      { name: 'maxOutgoingCalls', required: false, description: 'Most outgoing calls at once; null removes the limit.' },
      { name: 'enableBursting', required: false, description: BOOL('allow calls above maxActiveCalls, up to the bursting limits.') },
      { name: 'burstingMaxActiveCalls', required: false, description: 'Extra calls allowed while bursting; null clears it.' },
      { name: 'burstingMaxIncomingCalls', required: false, description: 'Extra incoming calls while bursting; null clears it.' },
      { name: 'burstingMaxOutgoingCalls', required: false, description: 'Extra outgoing calls while bursting; null clears it.' },
    ],
    returns: 'The trunk group, as Get a trunk group returns it, after the change.',
    errors: [{ code: 400, when: 'validation_error: no field sent, an unknown field, or a number out of range. broadworks_error: above the enterprise\'s trunking licence.' }, ...IN_GROUP, UNKNOWN],
  },

  // ---- devices -----------------------------------------------------------------
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/devices', upstream: 'OCI-P GroupAccessDeviceGetListRequest',
    summary: 'List devices',
    description: 'The group\'s phones and other access devices.',
    params: [GROUP, ENTERPRISE],
    returns: '{ data: [{ deviceName, deviceType, availablePorts, netAddress, macAddress, status, version, … }], total }; at most 1000, with truncated: true and a note when there are more.',
    errors: IN_GROUP,
  },
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/devices/:deviceName', upstream: 'OCI-P GroupAccessDeviceGetRequest18sp1',
    summary: 'Get a device',
    description: 'One device: type, ports, MAC address, serial number, address and configuration. Passwords are never returned.',
    params: [GROUP, DEVICE, ENTERPRISE],
    returns: '{ groupId, deviceName, deviceType, protocol, numberOfPorts, numberOfAssignedPorts, status, macAddress, serialNumber, description, … }',
    errors: [...IN_GROUP, { code: 404, when: 'not_found: no such device in the group.' }],
  },
  {
    method: 'POST', path: '/api/broadworks/groups/:groupId/devices/:deviceName/reset', upstream: 'OCI-P GroupAccessDeviceResetRequest',
    summary: 'Reboot a device',
    description: 'Tells the phone to restart and fetch its configuration again. Calls on it drop. Only device types that support a remote reset.',
    params: [GROUP, DEVICE, ENTERPRISE],
    body: {},
    returns: '{ ok: true, groupId, deviceName, reset: true }',
    errors: [...IN_GROUP, { code: 400, when: 'broadworks_error: the device type can\'t be reset remotely.' }, UNKNOWN],
  },

  // ---- group services ------------------------------------------------------------
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/hunt-groups', upstream: 'OCI-P GroupHuntGroupGetInstanceListRequest',
    summary: 'List hunt groups',
    description: 'The group\'s hunt groups: each rings a set of users by a policy.',
    params: [GROUP, ENTERPRISE],
    returns: '{ data: [{ serviceUserId, name, video, phoneNumber, extension, department, isActive }], total }',
    errors: IN_GROUP,
  },
  {
    method: 'GET', path: '/api/broadworks/groups/:groupId/auto-attendants', upstream: 'OCI-P GroupAutoAttendantGetInstanceListRequest',
    summary: 'List auto attendants',
    description: 'The group\'s auto attendants (voice menus).',
    params: [GROUP, ENTERPRISE],
    returns: '{ data: [{ serviceUserId, name, video, phoneNumber, extension, department, isActive, type }], total }',
    errors: IN_GROUP,
  },
];
