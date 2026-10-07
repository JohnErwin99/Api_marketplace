'use strict';

/**
 * Marketplace sessions: a short-lived signed token proving the holder logged
 * in to the partner portal with a real password. Issued by
 * POST /marketplace/session after the same unified/log-in check the portal
 * login page does; required by the staff-only /marketplace/admin/* routes.
 *
 * Token: base64url(JSON {email, exp}) + "." + base64url(HMAC-SHA256).
 * Set SESSION_SECRET in the environment so tokens survive restarts; without
 * it a random secret is generated at boot and everyone must log in again
 * after each deploy.
 */

const crypto = require('crypto');
const security = require('./security');

const TTL_MS = 8 * 60 * 60 * 1000;
const IX_BASE = 'https://api.iristelx.com';

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[session] SESSION_SECRET not set — sessions reset on every restart');
}

// Same list the partner portal nav script uses; override with ADMIN_EMAILS.
const DEFAULT_ADMINS = [
  'jerwin@iristel.com', 'jayoub@iristel.com', 'fdalberto@iristel.com',
  'jtamo@iristel.com', 'storozyan@iristel.com', 'nlajeunesse@iristel.com',
  'tkhei@iristel.com', 'sarmanious@iristel.com', 'tcui@iristel.com',
];
const admins = () => {
  const env = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(env.length ? env : DEFAULT_ADMINS);
};
const isAdmin = (email) => admins().has(String(email || '').trim().toLowerCase());

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function sign(email) {
  const body = b64(JSON.stringify({ email: String(email).toLowerCase(), exp: Date.now() + TTL_MS }));
  return `${body}.${hmac(body)}`;
}

// Partner API keys: "mk_" + a signed {email, iat}, for calling /api/* from
// the partner's own application. They don't expire; access is still decided
// per call by the CRM approval switch, so revoking the account disables the
// key. Signed in a separate domain ("api.") so a key can never pass as a
// session or the other way round. Changing SESSION_SECRET rotates every key.
function signApiKey(email) {
  const body = b64(JSON.stringify({ email: String(email).toLowerCase(), iat: Date.now() }));
  return `mk_${body}.${hmac('api.' + body)}`;
}

function checkSig(data, sig) {
  const want = Buffer.from(hmac(data));
  const got = Buffer.from(String(sig || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Returns the email the session token was issued to, or null if the token
// is missing, tampered with or expired.
function verify(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !checkSig(body, sig)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof email === 'string' && Date.now() < exp ? email : null;
  } catch { return null; }
}

function verifyApiKey(key) {
  const m = String(key || '').match(/^mk_([^.]+)\.(.+)$/);
  if (!m || !checkSig('api.' + m[1], m[2])) return null;
  try {
    const { email } = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    return typeof email === 'string' ? email : null;
  } catch { return null; }
}

const bearer = (req) => (String(req.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i) || [])[1];

// The session email of a request: "Authorization: Bearer <token>".
function sessionEmail(req) {
  const t = bearer(req);
  return t ? verify(t) : null;
}

// Who is calling /api/*: a console session or a partner API key, sent as
// "Authorization: Bearer ..." or "X-Marketplace-Key: mk_...".
function callerEmail(req) {
  const t = bearer(req) || req.get('X-Marketplace-Key');
  if (!t) return null;
  return t.startsWith('mk_') ? verifyApiKey(t) : verify(t);
}

// Rate limiter for password checks and intake forms. Persistent (SQLite on
// the Render disk), so a deploy doesn't hand attackers a fresh budget.
function tooMany(key, max = 10, windowMs = 15 * 60 * 1000) {
  return security.rateLimit(String(key), max, windowMs);
}

function register(app) {
  app.post('/marketplace/session', async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    if (tooMany('session:' + security.clientIp(req)) || tooMany('session:' + email)) {
      security.audit(req, 'login.rate_limited', { email, outcome: 'denied', detail: 'marketplace session' });
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    // Locked after 5 wrong passwords: refused even with the right one.
    const lock = security.lockStatus(email);
    if (lock.locked) {
      security.audit(req, 'login.blocked_locked', { email, outcome: 'denied', detail: 'marketplace session' });
      return security.sendLocked(res, lock);
    }

    const key = process.env.IRISTELX_API_KEY;
    if (!key) return res.status(503).json({ error: 'Login check is not configured on this gateway' });
    try {
      // Same rule as the portal login page: HTTP 200 without auth0Error
      // means the password is right.
      const r = await fetch(`${IX_BASE}/unified/log-in`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) return res.status(502).json({ error: 'Login service unavailable' });
      const d = await r.json();
      if (d.auth0Error) {
        const now = security.recordFailure(req, email);
        if (now.locked) return security.sendLocked(res, now);
        return res.status(401).json({ error: 'Wrong email or password' });
      }
      security.clearFailures(email);
      security.audit(req, 'session.created', { email, outcome: 'ok' });
      res.json({ token: sign(email), expiresInSeconds: TTL_MS / 1000 });
    } catch (err) {
      console.warn('[session] login check failed:', err.message);
      res.status(502).json({ error: 'Login service unavailable' });
    }
  });
}

module.exports = { register, sign, verify, signApiKey, verifyApiKey, sessionEmail, callerEmail, isAdmin, tooMany };
