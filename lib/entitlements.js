'use strict';

/**
 * Server-side entitlement check for /api/*. Every call must identify its
 * caller — a console session or a partner API key (see lib/session.js) —
 * and the product the path belongs to must be one the caller's CRM account
 * is approved for. Staff may call everything.
 *
 * GATEWAY_API_KEY, when set, still works as an internal override for
 * Iristel's own server-to-server callers (X-API-Key header).
 */

const { callerEmail } = require('./session');
const { lookupAuthorization } = require('./onboarding');

// Which marketplace product a /api path belongs to. Paths are relative to
// the /api mount.
function productForPath(p) {
  if (p.startsWith('/lnp/') || p === '/lnp') return 'lnp-enterprise';
  if (p.startsWith('/wlnp/') || p === '/wlnp') return 'lnp-wireless';
  const ix = p.match(/^\/ix\/([^/]+)/);
  if (ix) return ix[1];
  return 'dids';
}

function requireEntitlement() {
  return async (req, res, next) => {
    const internal = process.env.GATEWAY_API_KEY;
    if (internal && req.get('X-API-Key') === internal) {
      req.marketplace = { email: null, internal: true };
      return next();
    }
    const email = callerEmail(req);
    if (!email) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Send your marketplace API key as "Authorization: Bearer mk_..." — get it from the API console.',
      });
    }
    const product = productForPath(req.path);
    let auth;
    try {
      auth = await lookupAuthorization(email);
    } catch (err) {
      console.warn('[entitlements] lookup failed:', err.message);
      return res.status(503).json({ error: 'unavailable', message: 'Access check is unavailable, try again shortly.' });
    }
    if (!auth.approved || !auth.products.includes(product)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `Your marketplace access does not include ${product}. Request it from the API Marketplace page.`,
      });
    }
    req.marketplace = { email, product, internal: false };
    next();
  };
}

module.exports = { requireEntitlement, productForPath };
