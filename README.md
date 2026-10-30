# Iristel API Marketplace — gateway

The Express service behind the Iristel API Marketplace. It republishes Iristel's
APIs (IristelX, 911, provisioning, wireless and enterprise number porting,
Espresso's DID ordering and LRN lookups, and BroadWorks hosted voice) as one JSON
REST API, checks every caller against their CRM approval, prices each call from the
rate card, keeps every upstream credential on the server, and runs the console, the
marketplace pages' scripts and monthly billing.

The original Espresso DID **V3 SOAP** product (`/api/ping`, `/api/catalog`,
`/api/routing-profiles*`, `/api/orders*`) was retired on 2026-10-23; DID ordering is
Phone Numbers (DID Orders) on Espresso's REST API. `lib/soap.js` still serves
Enterprise LNP (Espresso v4 SOAP).

## Base URL

```
https://api-marketplace-1im9.onrender.com
```

Every path in this document is relative to that host — `/api/lnp/routing-profiles`
means `https://api-marketplace-1im9.onrender.com/api/lnp/routing-profiles`. The live console is at
[`/console`](https://api-marketplace-1im9.onrender.com/console); it shows the
base URL and a ready-to-run `curl` for each endpoint.

## Run

```bash
npm install
cp .env.example .env   # then fill in credentials
npm start              # http://localhost:3000
```

**Test console:** open `http://localhost:3000/console` — pick an endpoint, fill params, send, see JSON. Set env / override credentials in the top bar.

`GET /` returns a machine-readable catalog of every endpoint — handy for
auto-generating the console UI.

> **Security:** `.env` holds Espresso credentials in plaintext and is gitignored.
> For the marketplace, prefer passing each customer's own credentials per request
> (see below) and keep the `.env` default only for internal testing. Rotate the
> shared password if it ever lands in git.

## Credentials & environment

**Who may call `/api/*`?** Every call must identify an approved caller
(`lib/entitlements.js`):

- **The console** sends the partner's portal login session
  (`Authorization: Bearer <session>`), issued by `POST /marketplace/session`
  after a real password check.
- **A partner's own application** sends their personal marketplace key,
  `Authorization: Bearer mk_...` or `X-Marketplace-Key: mk_...`. Approved
  partners get it from **Show my API key** in the console
  (`POST /marketplace/api-key`).
- **Iristel's own services** can send `X-API-Key: <GATEWAY_API_KEY>`.

The product the path belongs to must be one the caller's CRM account is
approved for (`cr57d_apimarketplaceapproved` plus the product fields); admins
(the admin list, `lib/admins.js`) may call everything. Otherwise the gateway answers 401 (no or
bad key) or 403 (not approved for that product). Revoking access in CRM
disables the key within a minute.

**Upstream keys never leave the server.** IristelX-backed products
(provisioning, 911, accounts, SIM, commissions, mobile) are proxied at
`/api/ix/<product>/<path>`, and only the paths in that product's catalog are
forwarded. The portal login and sign-up pages call `/portal/*` for the same
reason.

### Pricing (proposed rates)

From the pricing proposal of 25 Oct 2026 (`lib/catalogs/pricing.js`). The rates
need Product, Finance and Legal/Regulatory sign-off; every page and the console say
"proposed". No subscription, no packages, no platform fee. Each catalog operation
has a rate class in the versioned rate card `lib/catalogs/rate-card.json`:

| Class | Price | What |
|---|---|---|
| `free` | $0 | view, list, get, search, status and poll; commission reports; single 911 listing updates |
| `standard` | 1¢ CAD per successful event | standalone admin or configuration changes |
| `advanced` | 2.5¢ CAD per successful event | bulk or orchestration requests (one event per request) |
| `service` | no API fee | orders telecom service (numbers, ports, trunks, SIM/eSIM activation, BroadWorks seats); billed under the tariff, never twice |

The rate card is built from the catalog by `node scripts/build-rate-card.js`: GET is
free, a change is standard, and its `OVERRIDES` list sets the rest. Re-run it after
any catalog change (`--check` fails when it is stale; `--rows rows.json` writes the
review rows). An operation missing from it is never charged and is reported at
startup. `/catalog.json` publishes `pricing` (classes, sandbox allowance, the
proposed telecom service rates), each endpoint's `rateClass` / `priceCents` and each
bundle's `apiCents` per run.

The gateway (`lib/entitlements.js`), for a partner call:

| Mode | How | What works |
|---|---|---|
| `live` (default) | — | Free reads and service orders: no card needed. Standard and Advanced: a card on file, else `402 card_required`. Only 2xx calls are billed; a repeated `Idempotency-Key` within 24 h is billed once. |
| `sandbox` | header `X-Marketplace-Mode: sandbox` | 1,000 calls per CRM account per calendar month (UTC), shared by every login on the account, plus any staff extension (`lib/sandbox.js`, `POST /marketplace/admin/sandbox-extension`); never billed; then `429 sandbox_limit`. Non-production only: Enterprise LNP runs on Espresso's test system (DID Orders and LRN too once `ESPRESSO_SANDBOX_CLIENT_*` is set); every other product, coming-soon ones included, is answered by the gateway with sample data (`lib/catalogs/samples.js`, header `X-Marketplace-Sample: true`) after the required fields are checked. |
| past due | — | Free reads only; the rest `402 payment_required`. |

Every answer carries `X-Marketplace-Mode`, `X-Marketplace-Price` (`<class> <cents>`)
and, in the sandbox, `X-Sandbox-Calls-Remaining`. Only Iristel staff and internal
accounts (Internal employee with an @iristel.com email) are exempt: no card, never
billed. Agents are billed like any partner.

The Oct 23–26 package model (CRM `cr57d_apimarketplacepackage`, `package_months`)
is no longer written or read, except that a month already recorded in
`package_months` still bills its 1¢ fee.

**Espresso login (LNP, DID Orders, LRN).** No partner login is needed: the gateway
uses `EDID_USER` / `EDID_PASS` (and the Espresso REST client for DID Orders and LRN).
Partners always run on Espresso's production system and can't override it with
`X-EDID-Env`. Staff and internal callers can still send `X-EDID-Env: test|production`
(default `test`).

```bash
curl -s https://api-marketplace-1im9.onrender.com/api/lnp/routing-profiles \
  -H 'Authorization: Bearer mk_...'
```

**Server environment (Render):**

| Variable | Used for |
|---|---|
| `SESSION_SECRET` | Signs login sessions and partner keys. Changing it logs everyone out and rotates every partner key. |
| `IRISTELX_API_KEY` | Unified log-in / sign-up / forgot-password, employee lookup, provisioning and 911 |
| `EMPLOYEE_WARM_EMAIL` | Optional. A staff email the gateway looks up every 4 min so the slow IristelX employee directory stays warm for logins (default: the last staff member who logged in) |
| `MIND_API_KEY` | IristelX accounts, SIM, commissions, mobile; creating customer billing accounts |
| `MIND_RESELL_KEY` | Creating reseller billing accounts (RESELL provider) |
| `MIND_SEARCH_KEY` | Get Account By Email |
| `EDID_USER` / `EDID_PASS` / `EDID_ENV` | Shared Espresso test account |
| `WLNP_API_KEY` | Number Porting — Wireless: the IristelX key sent as `x-api-key` on `/workflow/*`. Unset → WLNP calls answer 503. |
| `WLNP_BASE_URL` | Optional WLNP upstream origin (default `https://api.iristelx.com`) |
| `ESPRESSO_CLIENT_ID` / `ESPRESSO_CLIENT_SECRET` | Espresso's REST API (OAuth client) for **DID Orders** and **LRN Lookup** (`lib/espresso-rest.js`). Until both are set (with a login, below) those two products are published as "soon": docs and forms show, calls answer `503 not_enabled`, nothing is metered. Setting them and redeploying switches both on. |
| `ESPRESSO_REST_USER` / `ESPRESSO_REST_PASS` | The REST login (an email). Default: `EDID_USER` / `EDID_PASS`. |
| `ESPRESSO_COMPANY_ID` / `ESPRESSO_SANDBOX_COMPANY_ID` | Optional: Iristel's Espresso company id (UUID) on production / on the sandbox. Default: that system's only active company. Never shared between the two systems. |
| `ESPRESSO_ROUTING_PROFILE_ID` / `ESPRESSO_SANDBOX_ROUTING_PROFILE_ID` | Optional: the DID routing profile used when an order names none, per system. Default: that system's only active DID profile. |
| `ESPRESSO_OCN` | Optional OCN set on DID orders and used to filter available numbers (default `154E`). |
| `ESPRESSO_SANDBOX_CLIENT_ID` / `_CLIENT_SECRET` | The Espresso sandbox's own OAuth client: the production client is refused there (checked 2026-10-26). Without it, partner sandbox calls to DID Orders and LRN get sample data, and staff calls with `X-EDID-Env: test` answer `503 not_enabled`. |
| `ESPRESSO_SANDBOX_REST_USER` / `_REST_PASS` | Only if the sandbox login differs from production's. |
| `BROADWORKS_OCI_URL` / `BROADWORKS_USER` / `BROADWORKS_PASS` | BroadWorks OCI-P over SOAP (`https://<xsp>/webservice/services/ProvisioningService`) and the gateway's admin login (`lib/broadworks.js`). Until all three are set, BroadWorks is published as "soon" and calls answer `503 not_enabled`. |
| `D365_*` | Dynamics 365 (approvals are read from here) |
| `ADMIN_EMAILS` | Optional extra admin owners (comma-separated); owners can't be removed on the dashboard. The admin list itself lives in the database (`lib/admins.js`), managed on the staff dashboard's Admins card |
| `GATEWAY_API_KEY` | Optional internal override key |
| `DATA_DIR` | Folder for the SQLite ledger (usage, cards on file, charges) and `access-requests.json`. **Set to the Render persistent disk's mount path exactly, e.g. `/var/data`** — otherwise everything is wiped on every deploy. The startup log warns, and the `/admin` dashboard says so, when it isn't a mounted disk. |
| `PAYMENT_API_KEY` | IristelX payment key used to charge saved cards (`POST /bot/{account}/payment`) |
| `ELEVENLABS_API_KEY` | Iris in the console: signs ElevenLabs conversation URLs (`GET /marketplace/iris/session`). Use a key scoped to agents only. |
| `IRIS_CONSOLE_AGENT_ID` | The "Iris Console" ElevenLabs agent (auth on). Separate from the public website agent. |
| `IRIS_CONSOLE_ENABLED` | `on` shows Iris in the console to every approved partner. Anything else limits it to `IRIS_CONSOLE_EMAILS`. |
| `IRIS_CONSOLE_EMAILS` | Comma-separated pilot emails that get Iris while `IRIS_CONSOLE_ENABLED` isn't `on`. `GET /marketplace/me` reports the gate as `irisEnabled`, and the console shows the Iris launcher only when it is `true`. Everyone else gets `irisEnabled: false` and a 404 from `GET /marketplace/iris/session`. |

### Usage billing

- Every `/api/*` call is recorded server-side (`lib/entitlements.js` → `lib/db.js`)
  with its mode, rate class and price. Billable rows are successful live Standard
  (1¢) and Advanced (2.5¢) events; the price is stored as is (2.5).
- **The invoice** (issued on the 1st, charged on the 5th) has one line per rate class,
  "Standard API events — <Month>" × N and "Advanced API events — <Month>" × N, each
  rounded to the cent, plus tax.
- **Everyone is billed except Iristel staff and internal employees** (account type
  Internal employee with an @iristel.com email). Business customers, partners and
  agents all add a card. An agent created outside the portal sign-up may have no
  MIND billing account yet — staff link one on the dashboard (Billing → "Link a
  partner to a MIND billing account").
- Partners add a card in the console under **Billing & usage**. The card goes to MIND
  (`PATCH /billing/{account}/credit-card`); we keep only the token, masked number,
  type, expiry and holder — never the card number or CVV, and nothing is logged.
  The card number does pass through the gateway once, so the gateway is in PCI scope;
  a hosted card field (e.g. Moneris Hosted Tokenization) would remove that.
- Staff run the monthly charge from `/admin` → **Billing** → *Run charges*. Each
  partner is charged once per month (`MKT-{account}-{YYYYMM}`). Running again retries
  declined charges but never repeats paid or unknown ones. A declined or unknown
  charge marks the partner past due, which blocks their calls (402):
  - **Declined:** saving a new card retries every declined month right away; the
    partner is unblocked once nothing is left declined or unknown.
  - **Unknown** (no clear answer from MIND — the card may have been charged): staff
    check MIND, then use **Retry** or **Mark paid** on that row in `/admin` → Billing.

Espresso environment: see [Pricing](#pricing-proposed-rates).

## Endpoints

Every product's operations are in `lib/catalogs` and in `GET /catalog.json`. Enterprise
LNP (Espresso v4 SOAP) is `/api/lnp/...` (`lib/routes/lnp.js`), wireless LNP
`/api/wlnp/...` (`lib/routes/wlnp.js`), and the IristelX-backed products
`/api/ix/<product>/...` (`lib/routes/ix.js`), and BroadWorks `/api/broadworks/...`
(`lib/routes/broadworks.js`).

Staff-only (`lib/admin.js`): `GET /marketplace/admin/summary`, `POST /marketplace/admin/access`
(`{ accountId, approved?, broadworksEnterprise? }`), and `GET /marketplace/admin/pending`
(`{ count, items }`: access requests still waiting for review, for the red badge on
the portal nav's Dashboards menu; cached 60 s, cleared on an approval).

### Espresso REST products (DID Orders, LRN Lookup)

Espresso's new REST API (`/ws/v1`, OAuth2) is served by `lib/espresso-rest.js`, which
caches one token per system (Espresso allows 5 live tokens per login) and never follows
redirects. Espresso's nginx answers the order collection, `/ws/v1/dids/orders`, with a
301 to a static Swagger docs folder (seen 2026-10-21 on both hosts), so creating and
listing orders go to `/index.php/ws/v1/dids/orders`, which reaches the API (`ROUTED`).
Ask Espresso to fix the route; `GET /api/did-orders/health` lists one order to prove
it works. OnlineOrdering calls the published path and is affected too.

| Method | Path | Espresso | Notes |
|--------|------|----------|-------|
| GET  | `/api/did-orders/health` | auth + `general/companies` | login check |
| GET  | `/api/did-orders/routing-profiles` | `network/routing_profiles` | DID profiles; partners don't get IPs |
| GET  | `/api/did-orders/available?prefix=&ratecenter=&region=&limit=&offset=` | `POST dids/inventory/search` | available, OCN `154E`, not on an account, not vanity |
| POST | `/api/did-orders/orders` | `POST dids/orders` | gateway sets company, country, OCN, vanity false; records the owner |
| GET  | `/api/did-orders/orders?page=&size=` | `GET dids/orders` | staff: whole company; partners: their own |
| GET  | `/api/did-orders/orders/:orderId` | `GET dids/orders/{id}` | UUID or `ORD-…` number; owner or staff only |
| POST | `/api/did-orders/orders/:orderId/complete` | `POST …/complete` | `{ numbers? }` |
| POST | `/api/did-orders/orders/:orderId/cancel` | `POST …/cancel` | `{ reason? }` |
| GET  | `/api/lrn/basic/:number` | `GET dip/caus/basicdip/{company}/{number}` | 10 or 11 digits |
| GET  | `/api/lrn/history/:number` | `GET dipping/caus/history/basicdip/{company}/{number}` | with porting history |
| POST | `/api/lrn/history` | `POST dipping/caus/history/basicdip/{company}` | `{ numbers: [...] }`, 1–50 |

DID orders are placed on Iristel's company, so the gateway records each order's owner
(`did_orders` table) and partners see only their own, as for WLNP. Every create carries
a reference unique to that request (`mp-<hex>` before the partner's own). If the answer
is lost (timeout, 5xx), the order is looked up by that exact reference; if it can't be
found yet, the partner gets `503 order_unconfirmed` ("don't order again") and the create
stays in `did_order_pending` until their next order list finds it (dropped after a day).
Approvals that still list the retired `dids` product are read as `did-orders`
(`lib/onboarding.js`), so partners move over without a CRM change. After switching on, regenerate the Iris KB
(`node scripts/export-iris-kb.js`, which reads each product's status from the deployed
`/catalog.json`) and upload it.

### BroadWorks (Hosted Voice)

Cisco BroadWorks OCI-P over SOAP (`lib/broadworks.js`, spec: Application Server
Provisioning Interface R23). The gateway holds one admin session (`LoginRequest22V3`,
`JSESSIONID` kept, commands serialized, one re-login on an invalid session; a refused
login backs off 60 s). It is published as "soon" until `BROADWORKS_OCI_URL`,
`BROADWORKS_USER` and `BROADWORKS_PASS` are set. 36 operations: enterprise and number
summary, groups and their numbers (assign, unassign, activate), users (list, get, add,
modify, delete, services, registrations), call forwarding (always, busy, no answer), Do
Not Disturb, voicemail, trunk groups (list, get, capacity and bursting), devices (list,
get, reset), hunt groups and auto attendants; see `/catalog.json`.

**Scoping.** Every partner reaches only the BroadWorks enterprise staff linked to their
CRM account (`broadworks_links`, set on `/admin` or with `POST /marketplace/admin/access`
`{ accountId, broadworksEnterprise }`). The enterprise is never taken from the request;
groups and users are checked to belong to it (cached 5 min), and another enterprise's
records answer like missing ones (404). No link: `403 broadworks_not_linked`. Staff and
internal callers name the enterprise with `?enterprise=`.

**Before going live**, run one real call each of `UserAddRequest22`,
`UserModifyRequest22`, `GroupTrunkGroupModifyInstanceRequest20sp1`,
`UserVoiceMessagingUserModifyVoiceManagementRequest` and
`UserCallForwardingNoAnswerModifyRequest` on a test enterprise: the element order of
each request was written from the R22/R23 schema, which the spec PDF doesn't include.

## Examples

```bash
BASE=http://localhost:3000
# Every /api call needs your marketplace key; add -H "$AUTH" to each example.
AUTH='Authorization: Bearer mk_...'

# DID Orders: find numbers, order, follow the order
curl -s "$BASE/api/did-orders/available?prefix=1416&limit=10" -H "$AUTH"
curl -s -X POST "$BASE/api/did-orders/orders" -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "numberRequests": [ { "quantity": 2, "ratecenter": "Toronto,ON" } ] }'
curl -s "$BASE/api/did-orders/orders/ORD-12345" -H "$AUTH"

# Enterprise LNP: portability check and a PON's status
curl -s "$BASE/api/lnp/portability/416555" -H "$AUTH"
curl -s "$BASE/api/lnp/pons/PON123" -H "$AUTH"

# LRN lookup
curl -s "$BASE/api/lrn/basic/4165551212" -H "$AUTH"

# staff / internal only: pick the Espresso system (partners always use production)
curl -s "$BASE/api/lnp/routing-profiles" -H "X-API-Key: $GATEWAY_API_KEY" -H 'X-EDID-Env: production'
```

## Error format

Every error is JSON with an HTTP status. Espresso's numeric app codes (1–8,
431–610 from its SOAP manuals) are preserved in `code` and mapped to sensible statuses:

| HTTP | Espresso codes | meaning |
|------|----------------|---------|
| 401 | 1, 2 | auth failed |
| 403 | 4, 607 | not entitled / option not enabled |
| 404 | 431, 451, 472, 511 | not found |
| 409 | 531, 551, 552, 605 | wrong order state |
| 422 | 6, 592–596, 604, 606, 608–610 | validation / limits |
| 423 | 8 | account locked |
| 429 | 3, 592 | quota |
| 503 | 5 | retry later |

```json
{ "error": "espresso_error", "message": "...", "code": 531 }
```

## Notes for the console build

- **The console mounts itself.** `public/console-app.js` holds the whole console (CSS,
  markup and logic) and renders it in a shadow root on `#mp-console`, then loads
  `iris-console.js` from the same gateway, which mounts the Iris panel in that shadow
  root. `/console` (`public/console.html`) is just a host page for it, and the partner
  portal's `/console` page in Webflow hosts the same script
  (`docs/marketplace-console-embed.html`), so there is no iframe: the page scrolls, the
  rails are sticky, and the login comes from the portal's own cookies (nothing in the
  URL). A host page with a fixed header sets `--mp-top` on `#mp-console`.
- **Card entry stays on the gateway.** Billing & usage shows the card form in a frame
  of `/billing-card` (`public/billing-card.html`, framable only by the gateway and the
  portal origins). The console hands that frame the login session by `postMessage`; the
  card number and CVV go straight from the frame to `PUT /marketplace/billing/card`, so
  the page hosting the console never sees them.
- **Wireless LNP is scoped per partner.** One IristelX key serves everyone, so
  `lib/routes/wlnp.js` records each partner's port requests (`wlnp_requests`) and a
  partner only sees and changes their own; port-out and the response operations are
  Iristel staff only. Routing is case-sensitive (`server.js`) so a path's letter case
  can't change which product it is checked against.
- **CORS**: any origin when `ALLOWED_ORIGINS` is unset (dev); otherwise that list plus the partner portal origins.
- `GET /` gives the endpoint catalog as JSON; the console can render forms from it.
- **Rates in the console.** Each endpoint card shows its rate class and price; a
  service order asks for confirmation first; a "Sandbox" switch sends
  `X-Marketplace-Mode: sandbox` and shows the calls left this month.
