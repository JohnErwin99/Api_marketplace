# Approval email — Power Automate setup

The marketplace gateway sends the approval / under-review email through a
Power Automate flow, the same pattern as the OnlineOrdering SNAG mail
(`OnlineOrdering/server.js` → `sendSnagWebhook`). The gateway fire-and-forgets
a JSON POST; the flow does the actual sending. If `MAIL_WEBHOOK_URL` is unset,
the gateway logs the email instead of sending (safe default).

## Create the flow (5 steps)

1. **New flow** in [make.powerautomate.com](https://make.powerautomate.com)
   (same environment as the SNAG flow) → *Instant cloud flow* → trigger
   **"When an HTTP request is received"**.
2. Set *Request Body JSON Schema*:
   ```json
   {
     "type": "object",
     "properties": {
       "to":       { "type": "string" },
       "subject":  { "type": "string" },
       "body":     { "type": "string" },
       "bodyText": { "type": "string" }
     }
   }
   ```
3. Add action **"Send an email (V2)"** (Office 365 Outlook):
   - **To** → dynamic content `to`
   - **Subject** → `subject`
   - **Body** → `body` (HTML)
4. **Save** — the trigger step now shows the *HTTP POST URL* (contains a
   `sig=` secret; treat it like a password).
5. On Render, add the env var **`MAIL_WEBHOOK_URL`** = that URL and redeploy.

## What the gateway sends

```json
{
  "to": "jane@acme.com",
  "subject": "Your Iristel API Marketplace access has been granted",
  "body": "<p>Your access for e911, dids has been granted. Please log in to the partner portal (https://www.iristelpartnerportal.com) and navigate to /console.</p>",
  "bodyText": "Your access for e911, dids has been granted. Please log in to the partner portal (https://www.iristelpartnerportal.com) and navigate to /console."
}
```

Pending-review requests get the "under review" subject/body instead.

## Notes

- Unlike the SNAG flow (which hardcodes provisioning@ as recipient), this flow
  must map **To** from the payload — a marketplace approval goes to the
  requester.

## Flow 2 — granted email on CRM approval (Dataverse trigger)

**This flow is the single sender of every "access granted" email** — both
manual approvals (your team fills the field in Dynamics) and automatic ones
(the gateway writes the same field on auto-authorization, which triggers this
flow). The gateway deliberately does not email granted requests itself when
the CRM write succeeded (`emailVia: "dynamics-flow"` in its response); Flow 1
(the HTTP webhook) then only carries pending-review notices and the fallback
when Dynamics is unreachable.

Build it:

1. **New flow** → *Automated cloud flow* → trigger
   **"When a row is added, modified or deleted"** (Microsoft Dataverse).
2. Trigger settings:
   - **Change type**: Modified
   - **Table name**: Accounts
   - **Scope**: Organization
   - **Select columns** (under Advanced): `iristel_apimarketplaceaccess`
     — the flow then fires *only* when that column changes.
3. Add a **Condition**: `iristel_apimarketplaceaccess` *is not equal to* empty
   — so clearing the field (revoking access) sends nothing.
4. In the **Yes** branch, add **"Send an email (V2)"** (Office 365 Outlook):
   - **To** → dynamic content **Email** (`emailaddress1`)
   - **Subject** → `Your Iristel API Marketplace access has been granted`
   - **Body**:
     > Your access for **@{triggerOutputs()?['body/iristel_apimarketplaceaccess']}**
     > has been granted. Please log in to the partner portal
     > (https://www.iristelpartnerportal.com) and navigate to /console.
5. **Save** and turn the flow on. Nothing to configure on Render for this one
   — Dynamics itself is the trigger.

Test: edit any Account's *API Marketplace Access* field in the sandbox → the
email arrives at that account's primary email within seconds.
- Future hardening: OnlineOrdering also has a direct Microsoft Graph sender
  using the same D365 app registration; it needs the `Mail.Send` application
  permission with admin consent. The webhook needs no consent, which is why
  it's the default.
