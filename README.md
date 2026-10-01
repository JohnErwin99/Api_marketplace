# Espresso DID — REST Gateway

A small Express service that exposes the Espresso DID **V3 SOAP** provisioning
API as clean JSON REST endpoints, so your API-marketplace console can call
`GET /api/catalog` instead of hand-building SOAP envelopes.

Only the **13 methods documented in the V3 PDF** are exposed (plus `testConnection`
as a health check). The service hand-builds the rpc/encoded SOAP envelopes and the
`Credentials` header, then parses the response back to JSON.

## Base URL

```
https://api-marketplace-1im9.onrender.com
```

Every path in this document is relative to that host — `/api/catalog` means
`https://api-marketplace-1im9.onrender.com/api/catalog`. The live console is at
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
approved for (`cr57d_apimarketplaceapproved` plus the product fields); staff
(`ADMIN_EMAILS`) may call everything. Otherwise the gateway answers 401 (no or
bad key) or 403 (not approved for that product). Revoking access in CRM
disables the key within a minute.

**Upstream keys never leave the server.** IristelX-backed products
(provisioning, 911, accounts, SIM, commissions, mobile) are proxied at
`/api/ix/<product>/<path>`, and only the paths in that product's catalog are
forwarded. The portal login and sign-up pages call `/portal/*` for the same
reason.

### Sandbox and production

The card on file is the only switch, and the partner's API key is the same in
both modes (`lib/entitlements.js`):

| Partner state | Mode | What works |
|---|---|---|
| Chose **Sandbox → Production** on the request form, no card yet | `sandbox` | 30 free calls in total (one-time). DIDs/LNP run on the Espresso **test** system; other products (no test system) allow `GET` only. Never billed. |
| Chose **Production**, no card yet | — | Nothing: 402 until a card is added. |
| Card on file | `production` | Everything, live. Every successful call is billable. |
| Past due | — | Nothing: 402 until the outstanding charge is paid. |

The choice is stored in CRM `cr57d_environment` (649950001 = Sandbox →
Production, 649950002 = Production; the legacy "Sandbox only" value is treated
as Sandbox → Production). Every response carries `X-Marketplace-Mode` and, in
sandbox, `X-Sandbox-Calls-Remaining`. Staff, agents and internal callers are
exempt: no card, no limit, never billed.

**Espresso login (DIDs, LNP).** No partner login is needed: the gateway uses
`EDID_USER` / `EDID_PASS`, the same account on Espresso's test and production
systems. The system follows the partner's mode; partners can't override it
with `X-EDID-Env`. Staff and internal callers can still send
`X-EDID-Env: test|production` (default `test`).

```bash
curl -s https://api-marketplace-1im9.onrender.com/api/catalog \
  -H 'Authorization: Bearer mk_...'
```

**Server environment (Render):**

| Variable | Used for |
|---|---|
| `SESSION_SECRET` | Signs login sessions and partner keys. Changing it logs everyone out and rotates every partner key. |
| `IRISTELX_API_KEY` | Unified log-in / sign-up / forgot-password, employee lookup, provisioning and 911 |
| `MIND_API_KEY` | IristelX accounts, SIM, commissions, mobile; creating customer billing accounts |
| `MIND_RESELL_KEY` | Creating reseller billing accounts (RESELL provider) |
| `MIND_SEARCH_KEY` | Get Account By Email |
| `EDID_USER` / `EDID_PASS` / `EDID_ENV` | Shared Espresso test account |
| `D365_*` | Dynamics 365 (approvals are read from here) |
| `ADMIN_EMAILS` | Optional staff list override |
| `GATEWAY_API_KEY` | Optional internal override key |
| `DATA_DIR` | Folder for the SQLite ledger (usage, cards on file, charges) and `access-requests.json`. **Set to the Render persistent disk's mount path exactly, e.g. `/var/data`** — otherwise everything is wiped on every deploy. The startup log warns, and the `/admin` dashboard says so, when it isn't a mounted disk. |
| `PAYMENT_API_KEY` | IristelX payment key used to charge saved cards (`POST /bot/{account}/payment`) |

### Usage billing

- Every `/api/*` call is recorded server-side (`lib/entitlements.js` → `lib/db.js`),
  with its mode. A call is **billable** when it succeeded (2xx) in `production` mode —
  sandbox, staff, agent and internal calls never are.
- Prices are per successful call, in CAD cents, in `lib/catalogs/pricing.js`. They are
  all `0` until set; production mode needs a card on file regardless of price.
- **Agents are never billed** and have no card on file: they have an agent record
  (`GET /agents?email=`) and no MIND billing account of their own.
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

Espresso environment: see [Sandbox and production](#sandbox-and-production).

## Endpoints

| Method | Path | SOAP method | Notes |
|--------|------|-------------|-------|
| GET  | `/api/ping?name=` | testConnection | health/auth check |
| GET  | `/api/catalog` | didGetProductCatalog | ratecenter/NPA pairs |
| GET  | `/api/routing-profiles` | didGetRoutingProfiles | |
| GET  | `/api/routing-profiles/full` | didGetRoutingProfilesDetailsFull | incl. tech_prefix, format |
| GET  | `/api/routing-profiles/:profile` | didGetRoutingProfileDetails | URL-encode the profile |
| POST | `/api/orders` | didOrderDids | create order |
| GET  | `/api/orders?from=&to=` | didGetOrders | dates `Y-m-d H:i:s` |
| GET  | `/api/orders/:id` | didGetOrderInfo | |
| GET  | `/api/orders/:id/status` | didGetOrderStatus | |
| GET  | `/api/orders/:id/details` | didGetOrderDetails | only when Completed |
| GET  | `/api/orders/:id/problems` | didGetOrderProblems | only when Rejected. Pending Update |
| POST | `/api/orders/:id/requests` | didOrderEdit | append requests |
| POST | `/api/orders/:id/discard-rejected` | didOrderDiscardRejected | |
| POST | `/api/orders/:id/cancel` | didOrderCancel | |

## Examples

```bash
BASE=http://localhost:3000
# Every /api call needs your marketplace key; add -H "$AUTH" to each example.
AUTH='Authorization: Bearer mk_...'

# health / auth
curl -s "$BASE/api/ping?name=hello" -H "$AUTH"

# product catalog
curl -s "$BASE/api/catalog"

# routing profiles (+ full)
curl -s "$BASE/api/routing-profiles"
curl -s "$BASE/api/routing-profiles/full"
curl -s "$BASE/api/routing-profiles/Profile%202542"

# create an order
curl -s -X POST "$BASE/api/orders" -H 'Content-Type: application/json' -d '{
  "profiles": [
    { "profile": "Profile 2542",
      "requests": [ { "ratecenter": "TORONTO", "npa": "647", "quantity": 1 } ] },
    { "profile": "Profile 373",
      "requests": [ { "ratecenter": "TORONTO", "npa": "647", "quantity": 100 } ] }
  ]
}'

# list orders by date range
curl -s "$BASE/api/orders?from=2026-08-01%2000:00:00&to=2026-08-18%2023:59:59"

# order lifecycle
curl -s "$BASE/api/orders/DID1205280200006/status"
curl -s "$BASE/api/orders/DID1205280200006/details"
curl -s "$BASE/api/orders/DID1205280200006/problems"

# append requests / discard rejected / cancel
curl -s -X POST "$BASE/api/orders/DID1205280200006/requests" -H 'Content-Type: application/json' -d '{
  "requests": [ { "ratecenter": "PARRY SOUND", "npa": "705", "quantity": 3 } ] }'
curl -s -X POST "$BASE/api/orders/DID1205280200006/discard-rejected"
curl -s -X POST "$BASE/api/orders/DID1205280200006/cancel"

# staff / internal only: pick the Espresso system (partners follow their mode)
curl -s "$BASE/api/catalog" -H "X-API-Key: $GATEWAY_API_KEY" -H 'X-EDID-Env: production'
```

## Error format

Every error is JSON with an HTTP status. Espresso's numeric app codes (1–8,
431–610 from the PDF) are preserved in `code` and mapped to sensible statuses:

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

- **CORS**: any origin when `ALLOWED_ORIGINS` is unset (dev); otherwise that list plus the partner portal origins.
- `GET /` gives the endpoint catalog as JSON; the console can render forms from it.
- The two **array** methods (`didOrderDids`, `didOrderEdit`) build rpc/encoded
  arrays by hand. The shape matches the PDF, but if the live server rejects the
  wrapping, that's the one place to tweak (`lib/soap.js` → `requestItems` /
  `orderRequestArray`). Verify against a real order once you're on-network.
- This sandbox can't reach Espresso, so responses were validated for routing,
  validation, and error-shape only. The live SOAP round-trip runs from your
  network where `connect.espressodid.com` is reachable.
