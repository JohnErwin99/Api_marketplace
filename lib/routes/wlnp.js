'use strict';

/**
 * Number Porting — Wireless (WLNP) proxy.
 *
 * The WLNP Workflow API lives on a private address (default
 * http://192.168.142.21:8777) that browsers and partners cannot reach. This
 * router republishes it under /api/wlnp/* so callers only ever see the
 * gateway's own base URL.
 *
 * Configure with:
 *   WLNP_BASE_URL   upstream origin (default http://192.168.142.21:8777)
 *   WLNP_API_KEY    injected as X-Api-Key so the key never reaches the client
 *
 * Deployed off-network (e.g. Render) the upstream is unreachable and calls
 * return 504 until the gateway runs somewhere with a route to it.
 */

const express = require('express');
const axios = require('axios');

const DEFAULT_BASE = 'http://192.168.142.21:8777';

// Hop-by-hop and host-specific headers must not be forwarded upstream.
const STRIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding',
  'x-api-key', 'x-edid-username', 'x-edid-password', 'x-edid-env',
]);

module.exports = function wlnpRoutes() {
  const router = express.Router();
  const base = (process.env.WLNP_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

  router.use(
    // Raw body for the XML / form callbacks, JSON for the submits.
    express.text({ type: ['application/xml', 'text/xml'], limit: '5mb' }),
    express.urlencoded({ extended: false, limit: '5mb' }),
    async (req, res) => {
      const target = base + req.originalUrl.replace(/^\/api\/wlnp/, '');

      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!STRIP.has(k.toLowerCase())) headers[k] = v;
      }
      // The upstream key is held server-side; callers never send it.
      if (process.env.WLNP_API_KEY) headers['X-Api-Key'] = process.env.WLNP_API_KEY;

      let data;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        data = typeof req.body === 'string' ? req.body : req.body;
        if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
          headers['content-type'] = headers['content-type'] || 'application/json';
        }
      }

      let upstream;
      try {
        upstream = await axios({
          method: req.method,
          url: target,
          headers,
          data,
          timeout: 30000,
          responseType: 'text',
          transformResponse: (x) => x,
          validateStatus: () => true,
          maxRedirects: 0,
        });
      } catch (e) {
        // Async throws inside router.use are not caught by Express 4, so the
        // error is turned into a response here rather than rethrown.
        return res.status(504).json({
          error: 'upstream_unreachable',
          message: `Could not reach the WLNP API: ${e.message}. It runs on a private ` +
            'network, so the gateway must be hosted somewhere with a route to it.',
        });
      }

      const ct = upstream.headers['content-type'];
      if (ct) res.set('content-type', ct);
      res.status(upstream.status).send(upstream.data);
    }
  );

  return router;
};
