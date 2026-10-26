'use strict';

/**
 * The developer sandbox allowance (pricing proposal §1 and §6).
 *
 * SANDBOX_CALLS non-production calls per CRM account per calendar month
 * (UTC), shared by every login on the account and never billed. Past the
 * allowance calls are refused (429), never silently billed; Iristel staff
 * can grant an approved extension for one account and month.
 *
 * An account is identified by its sandbox key: "acct:<CRM account id>" (the
 * lowest approved account id when a login sits on several), or
 * "email:<address>" for a caller with no approved account on record.
 * Each sandbox call is written to the usage ledger with that key
 * (usage.sandbox_key, lib/entitlements.js).
 */

const db = require('./db');
const { SANDBOX_CALLS } = require('./catalogs/pricing');

db.exec(`
  CREATE TABLE IF NOT EXISTS sandbox_extensions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sandbox_key TEXT NOT NULL,
    month       TEXT NOT NULL,
    extra_calls INTEGER NOT NULL,
    granted_by  TEXT,
    granted_at  TEXT NOT NULL,
    note        TEXT
  );
  CREATE INDEX IF NOT EXISTS sandbox_extensions_key ON sandbox_extensions (sandbox_key, month);
`);
if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === 'sandbox_key')) {
  db.exec('ALTER TABLE usage ADD COLUMN sandbox_key TEXT');
}
db.exec(`CREATE INDEX IF NOT EXISTS usage_sandbox_key ON usage (sandbox_key, month) WHERE mode = 'sandbox'`);

const q = {
  used: db.prepare(`SELECT COUNT(*) AS n FROM usage WHERE sandbox_key = ? AND month = ? AND mode = 'sandbox'`),
  extra: db.prepare('SELECT COALESCE(SUM(extra_calls), 0) AS n FROM sandbox_extensions WHERE sandbox_key = ? AND month = ?'),
  grants: db.prepare('SELECT extra_calls, granted_by, granted_at, note FROM sandbox_extensions WHERE sandbox_key = ? AND month = ? ORDER BY id'),
  insert: db.prepare(`INSERT INTO sandbox_extensions (sandbox_key, month, extra_calls, granted_by, granted_at, note)
    VALUES (?, ?, ?, ?, ?, ?)`),
};

const month = (d = new Date()) => d.toISOString().slice(0, 7);
const accountKey = (accountId) => 'acct:' + String(accountId).trim().toLowerCase();

// The sandbox key of a caller, from their CRM authorization.
function keyFor(email, auth) {
  const ids = ((auth && auth.accountIds) || []).map((a) => String(a).toLowerCase()).filter(Boolean).sort();
  return ids.length ? accountKey(ids[0]) : 'email:' + String(email || '').trim().toLowerCase();
}

// { limit, used, left, extra } for a sandbox key and month.
function stateFor(key, mon = month()) {
  const extra = q.extra.get(key, mon).n;
  const limit = SANDBOX_CALLS + extra;
  const used = q.used.get(key, mon).n;
  return { limit, used, left: Math.max(0, limit - used), extra };
}

// Staff grant: extra calls for one CRM account and month (added to any
// earlier grant). Returns the account's new state.
function grant(accountId, mon, extraCalls, byEmail, note) {
  const key = accountKey(accountId);
  q.insert.run(key, mon, extraCalls, byEmail || null, new Date().toISOString(), note ? String(note).slice(0, 300) : null);
  return { ...stateFor(key, mon), grants: q.grants.all(key, mon) };
}

module.exports = { keyFor, accountKey, stateFor, grant, month, grantsFor: (key, mon) => q.grants.all(key, mon) };
