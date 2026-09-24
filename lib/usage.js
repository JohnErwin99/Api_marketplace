'use strict';

/**
 * API Marketplace usage log.
 *
 * Only `edid` / `proxy` products travel through this gateway — IristelX and
 * 911 calls go straight from the browser to their own hosts. So the console
 * reports every call it makes here (navigator.sendBeacon) and this module
 * appends it to data/usage.jsonl. One JSON object per line, newest last.
 *
 * The store is best-effort telemetry, not an audit log: Render's filesystem
 * is ephemeral, so it resets on each deploy. The admin dashboard says so.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG = path.join(DATA_DIR, 'usage.jsonl');
const MAX_LINES = 50000;

let cache = null;          // parsed rows
let cacheStamp = 0;        // mtimeMs the cache was built from

function readUsage() {
  let stat;
  try { stat = fs.statSync(LOG); } catch { return []; }
  if (cache && stat.mtimeMs === cacheStamp) return cache;
  const rows = [];
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  cache = rows; cacheStamp = stat.mtimeMs;
  return rows;
}

function append(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  // Trim from the front when the log outgrows the cap.
  const rows = readUsage();
  if (rows.length > MAX_LINES) {
    const keep = rows.slice(rows.length - Math.floor(MAX_LINES * 0.9));
    fs.writeFileSync(LOG, keep.map((r) => JSON.stringify(r)).join('\n') + '\n');
    cache = null;
  }
}

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function register(app) {
  // Beacon from the console. Accepts sendBeacon's text/plain body as well as
  // JSON, answers 204 quickly, and never fails loudly — telemetry must not
  // affect the page that reports it.
  app.post('/marketplace/usage', express_text_or_json, (req, res) => {
    try {
      const b = req.body || {};
      const entry = {
        at: new Date().toISOString(),
        email: str(b.email, 160).toLowerCase() || null,
        product: str(b.product, 60) || null,
        method: str(b.method, 10).toUpperCase() || null,
        endpoint: str(b.endpoint, 200) || null,
        status: Number.isFinite(+b.status) ? +b.status : null,
        ms: Number.isFinite(+b.ms) ? Math.round(+b.ms) : null,
      };
      if (entry.product || entry.endpoint) append(entry);
    } catch (err) {
      console.warn('[usage] append failed:', err.message);
    }
    res.status(204).end();
  });
}

// sendBeacon posts text/plain by default; express.json() ignores that, so
// parse the raw body ourselves when it isn't already an object.
function express_text_or_json(req, res, next) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return next();
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { raw += c; if (raw.length > 10000) req.destroy(); });
  req.on('end', () => {
    try { req.body = JSON.parse(raw || '{}'); } catch { req.body = {}; }
    next();
  });
  req.on('error', () => { req.body = {}; next(); });
}

module.exports = { register, readUsage };
