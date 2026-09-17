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

- The unlike SNAG flow (which hardcodes provisioning@ as recipient), this flow
  must map **To** from the payload — a marketplace approval goes to the
  requester.
- For manual approvals done directly in Dynamics (filling
  `iristel_apimarketplaceaccess` on the Account), add a second flow with the
  Dataverse trigger *"When a row is added, modified or deleted"* on Account,
  column filter `iristel_apimarketplaceaccess`, sending the same email to
  `emailaddress1` — then the email also fires when your team approves in CRM.
- Future hardening: OnlineOrdering also has a direct Microsoft Graph sender
  using the same D365 app registration; it needs the `Mail.Send` application
  permission with admin consent. The webhook needs no consent, which is why
  it's the default.
