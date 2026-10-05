'use strict';

/**
 * Security: audit trail, wrong-password lockout and persistent rate limits.
 * Everything lives in the SQLite file on the persistent disk (lib/db.js), so
 * a deploy or restart doesn't reset a lockout or a limiter.
 *
 *   audit(req, event, { email, outcome, detail })   append to audit_log
 *   rateLimit(key, max, windowMs)                   true when over the limit
 *   lockStatus(email)                               { locked, retryAfterSeconds }
 *   recordFailure(req, email)                       5th wrong password locks 30 min
 *   clearFailures(email)                            after a correct password
 *   unlock(req, email, by)                          staff unlock (admin panel)
 *
 * audit_log and rate_hits rows older than a year are purged daily. IP
 * addresses are personal information: the log is only readable by admins.
 */

const db = require('./db');

const LOCK_AFTER = 5;                      // wrong passwords in a row
const LOCK_MS = 30 * 60 * 1000;            // locked for 30 minutes
const FAIL_WINDOW_MS = 30 * 60 * 1000;     // failures older than this start over
const KEEP_MS = 365 * 24 * 60 * 60 * 1000; // audit retention: 1 year

const lower = (v) => String(v || '').trim().toLowerCase();

// req.ip is the real client address (server.js sets trust proxy for Render).
function clientIp(req) {
  return String((req && req.ip) || '').replace(/^::ffff:/, '') || null;
}

const insertAudit = db.prepare(`INSERT INTO audit_log (at, event, email, ip, user_agent, outcome, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);

// Never throws: a logging problem must not break a login or an API call.
function audit(req, event, { email, outcome, detail } = {}) {
  try {
    insertAudit.run(
      new Date().toISOString(), event, lower(email) || null, clientIp(req),
      req && req.get ? String(req.get('User-Agent') || '').slice(0, 300) || null : null,
      outcome || null,
      detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000),
    );
  } catch (err) {
    console.warn('[security] audit write failed:', err.message);
  }
}

// ---- rate limits ------------------------------------------------------------
const dropOldHits = db.prepare('DELETE FROM rate_hits WHERE key = ? AND at <= ?');
const countHits = db.prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ?');
const addHit = db.prepare('INSERT INTO rate_hits (key, at) VALUES (?, ?)');

// Sliding window: every call counts as a hit, and the call is refused once
// more than `max` hits fall inside the window.
const rateLimit = db.transaction((key, max, windowMs) => {
  const now = Date.now();
  dropOldHits.run(key, now - windowMs);
  addHit.run(key, now);
  return countHits.get(key).n > max;
});

// ---- wrong-password lockout ------------------------------------------------
const getFailures = db.prepare('SELECT * FROM login_failures WHERE email = ?');
const putFailures = db.prepare(`INSERT INTO login_failures (email, count, first_at, last_ip, locked_until)
  VALUES (@email, @count, @first_at, @last_ip, @locked_until)
  ON CONFLICT(email) DO UPDATE SET count = @count, first_at = @first_at, last_ip = @last_ip, locked_until = @locked_until`);
const delFailures = db.prepare('DELETE FROM login_failures WHERE email = ?');
const lockedNow = db.prepare('SELECT * FROM login_failures WHERE locked_until > ? ORDER BY locked_until DESC');

function lockStatus(email) {
  const row = getFailures.get(lower(email));
  const left = row && row.locked_until ? Date.parse(row.locked_until) - Date.now() : 0;
  return left > 0 ? { locked: true, retryAfterSeconds: Math.ceil(left / 1000) } : { locked: false, retryAfterSeconds: 0 };
}

// Send the standard 423 for a locked account.
function sendLocked(res, status) {
  const mins = Math.max(1, Math.ceil(status.retryAfterSeconds / 60));
  res.set('Retry-After', String(status.retryAfterSeconds));
  return res.status(423).json({
    error: 'locked',
    message: `Too many wrong passwords. Your account is locked — try again in ${mins} minute${mins === 1 ? '' : 's'}, or contact support.`,
    retryAfterSeconds: status.retryAfterSeconds,
  });
}

// Count a wrong password. The 5th in a row (within 30 minutes) locks the
// email for 30 minutes and emails the owner once.
function recordFailure(req, email) {
  email = lower(email);
  const now = Date.now();
  const row = getFailures.get(email);
  const fresh = row && row.first_at && now - Date.parse(row.first_at) < FAIL_WINDOW_MS;
  const count = fresh ? row.count + 1 : 1;
  const lock = count >= LOCK_AFTER;
  putFailures.run({
    email, count,
    first_at: fresh ? row.first_at : new Date(now).toISOString(),
    last_ip: clientIp(req),
    locked_until: lock ? new Date(now + LOCK_MS).toISOString() : null,
  });
  audit(req, 'login.fail', { email, outcome: 'denied', detail: `attempt ${count} of ${LOCK_AFTER}` });
  if (!lock) return { locked: false, retryAfterSeconds: 0 };
  audit(req, 'login.locked', { email, outcome: 'locked', detail: `${LOCK_AFTER} wrong passwords; locked 30 min` });
  sendLockEmail(email, clientIp(req)).catch(() => {});
  return { locked: true, retryAfterSeconds: LOCK_MS / 1000 };
}

function clearFailures(email) {
  delFailures.run(lower(email));
}

function unlock(req, email, by) {
  email = lower(email);
  const was = lockStatus(email).locked;
  delFailures.run(email);
  audit(req, 'account.unlocked', { email, outcome: was ? 'unlocked' : 'not-locked', detail: `by ${by}` });
  return was;
}

function listLocked() {
  return lockedNow.all(new Date().toISOString());
}

async function sendLockEmail(email, ip) {
  // Loaded lazily: onboarding -> session -> security would be circular.
  const { sendMail } = require('./onboarding');
  const { render, PORTAL_URL } = require('./email-template');
  const where = ip ? ` from IP address <strong>${ip}</strong>` : '';
  await sendMail(
    email,
    'Your Iristel Partner Portal account was locked',
    `Your Iristel Partner Portal account was locked after ${LOCK_AFTER} failed sign-in attempts${ip ? ' from IP ' + ip : ''}. `
      + 'It unlocks automatically in 30 minutes. If this wasn\'t you, reset your password. ' + PORTAL_URL,
    render({
      title: 'Your account was locked',
      paragraphs: [
        `We locked your Iristel Partner Portal account after ${LOCK_AFTER} failed sign-in attempts${where}.`,
        'It unlocks automatically in 30 minutes.',
        'If this wasn\'t you, reset your password with "Forgot password?" on the login page, or contact support.',
      ],
      ctaLabel: 'Open the Partner Portal',
      ctaUrl: PORTAL_URL,
    }),
  );
}

// ---- retention --------------------------------------------------------------
const purgeAudit = db.prepare('DELETE FROM audit_log WHERE at < ?');
const purgeHits = db.prepare('DELETE FROM rate_hits WHERE at < ?');
function purge() {
  try {
    const cutoff = Date.now() - KEEP_MS;
    const a = purgeAudit.run(new Date(cutoff).toISOString()).changes;
    // Limiter windows are at most a day, so older hits are dead weight.
    const h = purgeHits.run(Date.now() - 24 * 60 * 60 * 1000).changes;
    if (a || h) console.log(`[security] purged ${a} audit rows older than a year, ${h} stale rate hits`);
  } catch (err) {
    console.warn('[security] purge failed:', err.message);
  }
}
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

module.exports = {
  clientIp, audit, rateLimit, lockStatus, sendLocked, recordFailure, clearFailures, unlock, listLocked,
  LOCK_AFTER,
};
