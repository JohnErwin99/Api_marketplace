'use strict';

/**
 * Bundles — curated, use-case packages built from the product catalogs.
 *
 * Each bundle targets one business model (audience) and lists the ordered
 * endpoints a partner would call to complete the use case. Steps reference
 * products by id and endpoints by the same `"METHOD path"` key used in
 * ui-hints.js. server.js validates every reference at startup and drops any
 * step whose product is classified `internal` or `restricted` — bundles only
 * ever expose partner-safe products.
 */

const AUDIENCES = [
  { id: 'resellers', label: 'Resellers · UCaaS · MSPs' },
  { id: 'carriers', label: 'Carriers · CLECs' },
  { id: 'enterprise', label: 'Enterprise' },
  { id: 'agents', label: 'Agents' },
];

const BUNDLES = [
  // ---- Resellers / UCaaS / MSPs ------------------------------------------
  {
    id: 'subscriber-activation',
    name: 'Subscriber Activation',
    audience: 'resellers',
    useCase: 'Stand up a paying subscriber end to end',
    summary: 'Validate the address, create the account, choose a plan, add the service, and attach a SIM or eSIM.',
    classification: 'customer-confidential',
    steps: [
      { product: 'iristelx-accounts', endpoint: 'GET /canada-post/find', note: 'Validate the service address before anything is created.' },
      { product: 'iristelx-accounts', endpoint: 'POST /accounts', note: 'Create the master account for the subscriber.' },
      { product: 'iristelx-accounts', endpoint: 'GET /plans', note: 'Pick the plan the subscriber signed up for.' },
      { product: 'iristelx-accounts', endpoint: 'POST /accounts/:accountId/services', note: 'Add the service under the account.' },
      { product: 'iristelx-sim', endpoint: 'POST /sim-cards/:sacode/reserve', note: 'Reserve a physical SIM — or skip to the eSIM step.' },
      { product: 'iristelx-sim', endpoint: 'PUT /esim-cards/:iccid/assign', note: 'Assign an eSIM for instant activation.' },
    ],
  },
  {
    id: 'whitelabel-voice-resale',
    name: 'White-label Voice Resale',
    audience: 'resellers',
    useCase: 'Resell trunks and numbers under your own brand',
    summary: 'Provision the trunk, order the numbers, register 911, and send your branded welcome letter.',
    classification: 'customer-confidential',
    steps: [
      { product: 'provisioning', endpoint: 'POST /uboss-robot/trunk-provisioning', note: 'Submit the trunk provisioning job.' },
      { product: 'provisioning', endpoint: 'GET /uboss-robot/trunk-provisioning/:id/status', note: 'Poll until the trunk is built.' },
      { product: 'dids', endpoint: 'POST /api/orders', note: 'Order DIDs for the customer.' },
      { product: 'e911', endpoint: 'POST /911-info', note: 'Register the 911 listing for every number in service.' },
      { product: 'provisioning', endpoint: 'POST /uboss-robot/email/:id', note: 'Send the welcome letter with SIP credentials.' },
    ],
  },
  // ---- Carriers / CLECs ---------------------------------------------------
  {
    id: 'wholesale-number-supply',
    name: 'Wholesale Number Supply',
    audience: 'carriers',
    useCase: 'Programmatic DID inventory at carrier scale',
    summary: 'Browse the rate-center catalog, order in bulk, track order status, and repair rejects without opening a ticket.',
    classification: 'customer-confidential',
    steps: [
      { product: 'dids', endpoint: 'GET /api/catalog', note: 'Read rate centers and NPAs with available inventory.' },
      { product: 'dids', endpoint: 'GET /api/routing-profiles', note: 'Pick the routing profile the numbers will land on.' },
      { product: 'dids', endpoint: 'POST /api/orders', note: 'Place the order — single numbers or blocks.' },
      { product: 'dids', endpoint: 'GET /api/orders/:id/status', note: 'Poll the order status.' },
      { product: 'dids', endpoint: 'GET /api/orders/:id/details', note: 'Collect the provisioned numbers once completed.' },
      { product: 'dids', endpoint: 'POST /api/orders/:id/requests', note: 'Repair rejected requests and resubmit.' },
    ],
  },
  {
    id: 'bulk-port-in',
    name: 'Bulk Port-In (LNP)',
    audience: 'carriers',
    useCase: 'Migrate customer bases onto the network',
    summary: 'Check portability, create and track PONs, correct fallout, activate, and keep 911 records current in bulk.',
    classification: 'customer-confidential',
    steps: [
      { product: 'lnp-enterprise', endpoint: 'GET /api/lnp/portability/:npanxx', note: 'Check each NPA-NXX is portable before promising dates.' },
      { product: 'lnp-enterprise', endpoint: 'POST /api/lnp/pons', note: 'Create the port requests (PONs).' },
      { product: 'lnp-enterprise', endpoint: 'GET /api/lnp/pons/:pon', note: 'Track each PON through the lifecycle.' },
      { product: 'lnp-enterprise', endpoint: 'POST /api/lnp/pons/:pon/edit', note: 'Supplement or correct when the losing carrier objects.' },
      { product: 'lnp-enterprise', endpoint: 'POST /api/lnp/pons/:pon/activate', note: 'Activate on the firm order commitment date.' },
      { product: 'e911', endpoint: 'POST /911-info/upload', note: 'Bulk-upload 911 listings by CSV for the ported base.' },
    ],
  },
  // ---- Enterprise ---------------------------------------------------------
  {
    id: 'sip-trunk-turnup',
    name: 'SIP Trunk Turn-Up',
    audience: 'enterprise',
    useCase: 'Order a SIP trunk, numbers included',
    summary: 'The "order a SIP trunk" package: provision the trunk, order your numbers, register 911, get your credentials.',
    classification: 'customer-confidential',
    steps: [
      { product: 'provisioning', endpoint: 'POST /uboss-robot/trunk-provisioning', note: 'Order the trunk — channel count, addresses, emails.' },
      { product: 'provisioning', endpoint: 'GET /uboss-robot/trunk-provisioning/:id/status', note: 'Follow the build.' },
      { product: 'dids', endpoint: 'POST /api/orders', note: 'Order numbers for the trunk.' },
      { product: 'e911', endpoint: 'POST /911-info', note: 'Register 911 for the site.' },
      { product: 'provisioning', endpoint: 'POST /uboss-robot/email/:id', note: 'Receive the welcome letter with SIP authentication details.' },
    ],
  },
  {
    id: 'bring-your-numbers',
    name: 'Bring Your Numbers',
    audience: 'enterprise',
    useCase: 'Keep your numbers when you move to Iristel',
    summary: 'Check portability, file the port request, track it to activation, and update 911 as numbers land.',
    classification: 'customer-confidential',
    steps: [
      { product: 'lnp-enterprise', endpoint: 'GET /api/lnp/portability/:npanxx', note: 'Confirm the numbers can port.' },
      { product: 'lnp-enterprise', endpoint: 'POST /api/lnp/pons', note: 'Create the port request.' },
      { product: 'lnp-enterprise', endpoint: 'GET /api/lnp/pons/:pon', note: 'Watch the status until the FOC date.' },
      { product: 'lnp-enterprise', endpoint: 'POST /api/lnp/pons/:pon/activate', note: 'Activate — the numbers are now on Iristel.' },
      { product: 'e911', endpoint: 'PUT /911-info', note: 'Point the 911 listings at the new service address.' },
    ],
  },
  // ---- Agents -------------------------------------------------------------
  {
    id: 'agent-sales-desk',
    name: 'Agent Sales Desk',
    audience: 'agents',
    useCase: 'Sign up customers in the field',
    summary: 'Validate the address, create the account, pick a plan, add the service, and hand over an eSIM on the spot.',
    classification: 'customer-confidential',
    steps: [
      { product: 'iristelx-accounts', endpoint: 'GET /canada-post/find', note: 'Validate the customer address.' },
      { product: 'iristelx-accounts', endpoint: 'POST /accounts', note: 'Create the account.' },
      { product: 'iristelx-accounts', endpoint: 'GET /plans', note: 'Choose the plan.' },
      { product: 'iristelx-accounts', endpoint: 'POST /accounts/:accountId/services', note: 'Add the service.' },
      { product: 'iristelx-sim', endpoint: 'PUT /esim-cards/:iccid/assign', note: 'Issue the eSIM — customer walks away connected.' },
    ],
  },
  {
    id: 'commission-tracking',
    name: 'Commission Tracking',
    audience: 'agents',
    useCase: 'See what you have earned',
    summary: 'List agents, read the commission summary, and drill into one agent for a date range.',
    classification: 'customer-confidential',
    steps: [
      { product: 'iristelx-commission', endpoint: 'GET /commission/agents', note: 'List the agents you can report on.' },
      { product: 'iristelx-commission', endpoint: 'GET /agent-commissions', note: 'Commission summary across agents.' },
      { product: 'iristelx-commission', endpoint: 'GET /commission/:agentId/:startDate/:endDate', note: 'Per-agent detail for the period.' },
    ],
  },
];

module.exports = { AUDIENCES, BUNDLES };
