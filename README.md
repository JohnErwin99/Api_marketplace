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

- **The test console** sends the partner's portal login session
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

**Espresso login (DIDs, LNP).** Send your own credentials as
`X-EDID-Username` / `X-EDID-Password` (Basic auth also works when the
marketplace key goes in `X-Marketplace-Key`). Without them the gateway uses
the shared `EDID_USER` / `EDID_PASS` account, but **only on the test
system**; production calls without your own login get 401.

```bash
curl -s https://api-marketplace-1im9.onrender.com/api/catalog \
  -H 'Authorization: Bearer mk_...' \
  -H 'X-EDID-Username: partner@example.com' \
  -H 'X-EDID-Password: their-espresso-password' \
  -H 'X-EDID-Env: production'
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
| `DATA_DIR` | Folder for the SQLite ledger (usage, cards on file, charges). **Set to the Render persistent disk mount, e.g. `/var/data`** — without a disk the data is wiped on every deploy. |
| `PAYMENT_API_KEY` | IristelX payment key used to charge saved cards (`POST /bot/{account}/payment`) |

### Usage billing

- Every `/api/*` call is recorded server-side (`lib/entitlements.js` → `lib/db.js`).
  A call is **billable** when it succeeded (2xx), came from a paying partner (not staff,
  not an agent, not an internal key) and hit a live system — Espresso test-environment calls are free.
- Prices are per successful call, in CAD cents, in `lib/catalogs/pricing.js`. They are
  all `0` until set; a call with a price needs a card on file (402 otherwise).
- **Agents are never billed** and have no card on file: they have an agent record
  (`GET /agents?email=`) and no MIND billing account of their own.
- Partners add a card in the console under **Billing & usage**. The card goes to MIND
  (`PATCH /billing/{account}/credit-card`); we keep only the token, masked number,
  type, expiry and holder — never the card number or CVV, and nothing is logged.
  The card number does pass through the gateway once, so the gateway is in PCI scope;
  a hosted card field (e.g. Moneris Hosted Tokenization) would remove that.
- Staff run the monthly charge from `/admin` → **Billing** → *Run charges*. Each
  partner is charged once per month (`MKT-{account}-{YYYYMM}`); paid and unknown
  charges are never repeated automatically. A failed charge marks the partner past
  due, which pauses billed calls until it's resolved.

Environment (`test` vs `production`) resolves from the `X-EDID-Env` header,
`?env=` query param, or `EDID_ENV` on the server (defaults to `test`).

> **The gateway defaults to `test`.** Calls without an environment go to the
> Espresso test system — orders placed there are not real and no DIDs are
> provisioned. When you move from trying things out to calling the API for real,
> you must send `X-EDID-Env: production` (or `?env=production`) on **every**
> request, alongside your own production Espresso credentials. Test credentials
> do not work against production, and vice versa.

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

# per-customer credentials (marketplace) + production env
curl -s "$BASE/api/catalog" \
  -H 'X-EDID-Username: someuser' -H 'X-EDID-Password: somepass' -H 'X-EDID-Env: production'
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
