'use strict';

/**
 * API Marketplace usage — read side.
 *
 * Every /api/* call is metered on the server by lib/entitlements.js into the
 * SQLite ledger (lib/db.js). This module reads it back for the staff
 * dashboard. The old browser beacon (POST /marketplace/usage) is kept only so
 * older console copies don't error; it no longer records anything, because
 * the server already counts every call.
 */

const db = require('./db');

const selectAll = db.prepare(
  'SELECT at, email, mind_account, product, method, path, status, ms, billable, price_cents FROM usage ORDER BY id');

function readUsage() {
  return selectAll.all().map((r) => ({
    at: r.at, email: r.email, mindAccount: r.mind_account, product: r.product,
    method: r.method, endpoint: r.path, status: r.status, ms: r.ms,
    billable: !!r.billable, priceCents: r.price_cents,
  }));
}

function register(app) {
  app.post('/marketplace/usage', (req, res) => res.status(204).end());
}

module.exports = { register, readUsage };
