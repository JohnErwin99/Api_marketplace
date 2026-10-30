'use strict';

/**
 * Admins: the one list of Iristel admins for the partner portal and the API
 * Marketplace (since 2026-10-30; before, every portal page kept its own copy).
 *
 * The portal asks GET /portal/staff, which answers { staff, admin } for the
 * signed-in caller; window.IR_ACCESS.isAdmin() in the portal head uses that
 * answer, and no portal page keeps a list. The gateway's own admin checks
 * (dashboard, approvals, billing) use isAdmin() in lib/session.js, which
 * reads this module.
 *
 * Managed on the staff dashboard (Admins card): any admin can add or remove
 * admins, and every change is audit-logged. Owners can't be removed: the
 * OWNERS below plus anyone in the ADMIN_EMAILS environment variable.
 * Only company emails (@iristel.com, @telehop.com) can be admins.
 */

const db = require('./db');

const COMPANY_EMAIL = /^[^@\s]+@(iristel|telehop)\.com$/i;
const OWNERS = ['jerwin@iristel.com', 'jayoub@iristel.com'];
// The list as it stood when it moved here (portal nav + gateway + Presidents
// Club admin, merged, plus Oana Radu). Seeded once; after that the table is
// the list, so someone removed on the dashboard never comes back.
const SEED = [
  'fdalberto@iristel.com', 'jtamo@iristel.com', 'storozyan@iristel.com',
  'nlajeunesse@iristel.com', 'tkhei@iristel.com', 'sarmanious@iristel.com',
  'tcui@iristel.com', 'adumitru@iristel.com', 'mghanat@iristel.com',
  'sbishay@iristel.com', 'oradu@iristel.com',
];

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    email    TEXT PRIMARY KEY,
    added_by TEXT,
    added_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admins_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const q = {
  get: db.prepare('SELECT email FROM admins WHERE email = ?'),
  all: db.prepare('SELECT email, added_by AS addedBy, added_at AS addedAt FROM admins ORDER BY email'),
  add: db.prepare('INSERT OR IGNORE INTO admins (email, added_by, added_at) VALUES (?, ?, ?)'),
  del: db.prepare('DELETE FROM admins WHERE email = ?'),
  seeded: db.prepare("SELECT value FROM admins_meta WHERE key = 'seeded'"),
  markSeeded: db.prepare("INSERT INTO admins_meta (key, value) VALUES ('seeded', ?)"),
};

db.transaction(() => {
  if (q.seeded.get()) return;
  const now = new Date().toISOString();
  SEED.forEach((e) => q.add.run(e, 'seed', now));
  q.markSeeded.run(now);
})();

const lower = (e) => String(e || '').trim().toLowerCase();
const owners = () => new Set(OWNERS.concat(
  (process.env.ADMIN_EMAILS || '').split(',').map(lower).filter(Boolean)));

const isOwner = (email) => owners().has(lower(email));
const has = (email) => {
  const e = lower(email);
  return !!e && (owners().has(e) || !!q.get.get(e));
};

// Owners first, then everyone else alphabetically.
function list() {
  const own = [...owners()].sort().map((email) => ({ email, owner: true, addedBy: null, addedAt: null }));
  const rows = q.all.all().filter((r) => !owners().has(r.email)).map((r) => ({ ...r, owner: false }));
  return own.concat(rows);
}

// Returns { ok } or { error, status }.
function add(email, by) {
  const e = lower(email);
  if (!COMPANY_EMAIL.test(e)) return { error: 'Only @iristel.com or @telehop.com emails can be admins', status: 400 };
  if (has(e)) return { error: `${e} is already an admin`, status: 409 };
  q.add.run(e, lower(by) || null, new Date().toISOString());
  return { ok: true, email: e };
}

function remove(email) {
  const e = lower(email);
  if (isOwner(e)) return { error: `${e} is an owner and can't be removed`, status: 400 };
  if (!q.del.run(e).changes) return { error: `${e} is not an admin`, status: 404 };
  return { ok: true, email: e };
}

module.exports = { has, list, add, remove, isOwner };
