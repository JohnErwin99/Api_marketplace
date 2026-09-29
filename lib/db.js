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

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

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

console.log('[db] using', path.join(DIR, 'marketplace.db'));

module.exports = db;
