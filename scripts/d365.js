'use strict';
/**
 * Shared Dynamics 365 (Dataverse) Web API client for the marketplace.
 * Auth: OAuth2 client credentials against the tenant in .env.
 */
require('dotenv').config();

const BASE = process.env.D365_URL;
const API = BASE + '/api/data/v9.2';
let cached = null;

async function token() {
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.t;
  const r = await fetch(`https://login.microsoftonline.com/${process.env.D365_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.D365_CLIENT_ID,
      client_secret: process.env.D365_CLIENT_SECRET,
      scope: BASE + '/.default',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('D365 token failed: ' + JSON.stringify(j).slice(0, 300));
  cached = { t: j.access_token, exp: Date.now() / 1000 + (j.expires_in || 3600) };
  return j.access_token;
}

async function api(method, pathname, body, headers) {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: 'Bearer ' + (await token()),
      'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
      Accept: 'application/json', 'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: r.status, ok: r.ok, json, text, headers: r.headers };
}

module.exports = { api, token, BASE };
