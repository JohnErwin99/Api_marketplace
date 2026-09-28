'use strict';

// Renders the ready-to-paste bodies for Power Automate Flow 2 (the Dataverse
// trigger that sends "access granted" / "access removed") from the same
// branded template the gateway uses. Re-run after changing
// lib/email-template.js, then re-paste into the flow's "Send an email (V2)".
//   node scripts/render-flow2-emails.js

const fs = require('fs');
const path = require('path');
const { render, PORTAL_URL } = require('../lib/email-template');

const OUT = path.join(__dirname, '..', 'docs', 'emails');
const link = `<a href="${PORTAL_URL}" style="color:#D1155A;">${PORTAL_URL.replace('https://', '')}</a>`;

const emails = {
  'access-granted.html': render({
    title: 'Your API Marketplace access has been granted',
    paragraphs: [
      "Your access for <strong>@{triggerOutputs()?['body/cr57d_apimarketplaceaccess']}</strong> has been granted.",
      'Log in to the Iristel Partner Portal and open the API Marketplace to start using the console.',
      `Partner Portal: ${link}`,
    ],
    ctaLabel: 'Open the Partner Portal',
    ctaUrl: PORTAL_URL,
  }),
  'access-removed.html': render({
    title: 'Your API Marketplace access has been removed',
    paragraphs: [
      'Your API Marketplace access has been removed. You will no longer see the API console in the partner portal.',
      'If you believe this is an error, contact your Iristel representative or submit a new access request from the Partner Portal.',
      `Partner Portal: ${link}`,
    ],
    ctaLabel: 'Open the Partner Portal',
    ctaUrl: PORTAL_URL,
  }),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, html] of Object.entries(emails)) {
  fs.writeFileSync(path.join(OUT, name), html);
  console.log('wrote docs/emails/' + name);
}
