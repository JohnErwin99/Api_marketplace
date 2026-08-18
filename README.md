# Espresso DID — REST Gateway

A small Express service that exposes the Espresso DID **V3 SOAP** provisioning
API as clean JSON REST endpoints, so your API-marketplace console can call
`GET /api/catalog` instead of hand-building SOAP envelopes.

Only the **13 methods documented in the V3 PDF** are exposed (plus `testConnection`
as a health check). The service hand-builds the rpc/encoded SOAP envelopes and the
`Credentials` header, then parses the response back to JSON.

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

**Who is authenticating to Espresso?**

- **The test console** (`/console`) always uses the **shared default account** —
  the `EDID_USER` / `EDID_PASS` set on the server. Partners open it from inside
  the (already login-protected) partner portal and don't enter Espresso
  credentials. The console does not expose username/password fields.
- **Calling the API directly** (your own app, scripts, server-to-server): a
  caller with their **own Espresso account** should send their credentials as
  headers `X-EDID-Username` / `X-EDID-Password` (or HTTP Basic auth). Anyone who
  does **not** send credentials falls back to the shared default account
  configured on the server.

Resolution order, per request:

1. Headers `X-EDID-Username` / `X-EDID-Password`
2. HTTP Basic auth (`Authorization: Basic ...`)
3. Server defaults (`EDID_USER` / `EDID_PASS`)

So `EDID_USER` / `EDID_PASS` on the server are the **fallback / shared** account.
Leave them set if you want a shared default; unset them if you require every
caller to bring their own Espresso login.

Direct call with your own Espresso account:

```bash
curl -s https://your-gateway.onrender.com/api/catalog \
  -H 'X-EDID-Username: partner@example.com' \
  -H 'X-EDID-Password: their-espresso-password'
```

Environment (`test` vs `production`) resolves from the `X-EDID-Env` header,
`?env=` query param, or `EDID_ENV` on the server (defaults to `test`).

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

# health / auth
curl -s "$BASE/api/ping?name=hello"

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

- **CORS** is wide open (`cors()`) for dev — restrict `origin` before production.
- `GET /` gives the endpoint catalog as JSON; the console can render forms from it.
- The two **array** methods (`didOrderDids`, `didOrderEdit`) build rpc/encoded
  arrays by hand. The shape matches the PDF, but if the live server rejects the
  wrapping, that's the one place to tweak (`lib/soap.js` → `requestItems` /
  `orderRequestArray`). Verify against a real order once you're on-network.
- This sandbox can't reach Espresso, so responses were validated for routing,
  validation, and error-shape only. The live SOAP round-trip runs from your
  network where `connect.espressodid.com` is reachable.
