'use strict';

/**
 * Marketplace database: usage ledger, billing profiles (card on file) and
 * monthly charges, in one SQLite file.
 *
 * On Render the file must live on the persistent disk — set DATA_DIR to the
 * disk's mount path (e.g. /var/data). Without it the file sits in ./data,
 * which Render wipes on every deploy.
 *
 * Card data: billing_profiles holds only what MIND returns for charging a
 * stored card (token) and what we show the partner (masked number, type,
 * expiry, holder). The card number and CVV are never stored.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const APP_DATA = path.join(__dirname, '..', 'data');
const DIR = process.env.DATA_DIR || APP_DATA;
fs.mkdirSync(DIR, { recursive: true });

// Is DIR really a separate (mounted) disk? On Render a persistent disk is its
// own filesystem; a folder on the app's filesystem is wiped every deploy.
const onSeparateDisk = (() => {
  try { return fs.statSync(DIR).dev !== fs.statSync(path.join(__dirname, '..')).dev; }
  catch { return false; }
})();
const storage = {
  dataDir: DIR,
  fromEnv: !!process.env.DATA_DIR,
  persistent: !!process.env.DATA_DIR && onSeparateDisk,
};
if (!storage.persistent) {
  console.warn(`[db] WARNING: ${DIR} is not a mounted disk${storage.fromEnv ? '' : ' (DATA_DIR not set)'}`
    + ' — usage, cards, charges and access requests are wiped on every deploy.');
}

const db = new Database(path.join(DIR, 'marketplace.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    month        TEXT NOT NULL,
    email        TEXT,
    mind_account TEXT,
    product      TEXT,
    method       TEXT,
    path         TEXT,
    status       INTEGER,
    ms           INTEGER,
    billable     INTEGER NOT NULL DEFAULT 0,
    price_cents  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS usage_month ON usage (month, mind_account);
  CREATE INDEX IF NOT EXISTS usage_at ON usage (at);

  CREATE TABLE IF NOT EXISTS billing_profiles (
    email        TEXT PRIMARY KEY,
    mind_account TEXT,
    token        TEXT,
    card_code    TEXT,
    masked       TEXT,
    exp_month    TEXT,
    exp_year     TEXT,
    holder       TEXT,
    past_due     INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS charges (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    email            TEXT NOT NULL,
    mind_account     TEXT,
    month            TEXT NOT NULL,
    amount_cents     INTEGER NOT NULL,
    status           TEXT NOT NULL,
    reference        TEXT,
    gateway_response TEXT,
    created_at       TEXT NOT NULL,
    UNIQUE (email, month)
  );
`);

// usage.mode: 'sandbox' | 'production' for paying partners, NULL for staff,
// agents and internal callers. Added after the table first shipped.
if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === 'mode')) {
  db.exec('ALTER TABLE usage ADD COLUMN mode TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS usage_sandbox ON usage (email, mode)');

// usage.ip / usage.user_agent: who made each API call (security audit).
for (const col of ['ip', 'user_agent']) {
  if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === col)) {
    db.exec(`ALTER TABLE usage ADD COLUMN ${col} TEXT`);
  }
}

// billing_profiles.key_name: which MIND key (business unit) saved the card,
// so removing it uses the same one.
if (!db.prepare('PRAGMA table_info(billing_profiles)').all().some((c) => c.name === 'key_name')) {
  db.exec('ALTER TABLE billing_profiles ADD COLUMN key_name TEXT');
}

// Security: audit trail (kept 1 year), wrong-password lockouts, and rate
// limit hits — all on the persistent disk so a deploy doesn't reset them.
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    event      TEXT NOT NULL,
    email      TEXT,
    ip         TEXT,
    user_agent TEXT,
    outcome    TEXT,
    detail     TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at);
  CREATE INDEX IF NOT EXISTS audit_email ON audit_log (email, at);
  CREATE INDEX IF NOT EXISTS audit_ip ON audit_log (ip, at);

  CREATE TABLE IF NOT EXISTS login_failures (
    email        TEXT PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 0,
    first_at     TEXT,
    last_ip      TEXT,
    locked_until TEXT
  );

  CREATE TABLE IF NOT EXISTS rate_hits (
    key TEXT NOT NULL,
    at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits (key, at);
`);

console.log('[db] using', path.join(DIR, 'marketplace.db'));

// Access requests used to be written to ./data regardless of DATA_DIR; carry
// a leftover file over once (only matters if the container wasn't replaced).
const REQUESTS = path.join(DIR, 'access-requests.json');
const OLD_REQUESTS = path.join(APP_DATA, 'access-requests.json');
if (DIR !== APP_DATA && !fs.existsSync(REQUESTS) && fs.existsSync(OLD_REQUESTS)) {
  try { fs.copyFileSync(OLD_REQUESTS, REQUESTS); } catch { /* best effort */ }
}

module.exports = db;
module.exports.DATA_DIR = DIR;
module.exports.REQUESTS_FILE = REQUESTS;
module.exports.storage = storage;
