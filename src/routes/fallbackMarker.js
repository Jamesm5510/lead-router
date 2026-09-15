const express = require('express');

// Existing independent host only. No router/DB dependency, jobs, counters or
// normal assignment mutation. Production enablement is a separate Go switch.
function createFallbackMarkerRouter({ env = process.env, fetcher = fetch } = {}) {
  const router = express.Router();
  let mark;
  let origin;
  if (env.FALLBACK_MARKER_ENABLED === 'true') {
    try {
      const config = JSON.parse(env.FALLBACK_MARKER_CONFIG_JSON);
      const { createIndependentFallbackMarker } = require('../vendor/lpg-fallback-marker.cjs');
      origin = config.pageOrigin;
      mark = createIndependentFallbackMarker({
        ...config,
        enabled: true,
        productionEnabled: env.FALLBACK_MARKER_PRODUCTION_ENABLED === 'true',
        token: env.FALLBACK_GHL_TOKEN,
        publicationSigningKey: env.FALLBACK_PUBLICATION_SIGNING_KEY,
        nativeSigningKey: env.FALLBACK_NATIVE_SIGNING_KEY,
      }, fetcher);
    } catch {
      // Fail this endpoint closed without breaking unrelated existing jobs.
      mark = null;
    }
  }
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!mark) return res.status(503).json({ status: 'disabled' });
    if (req.get('origin') !== origin) return res.status(403).json({ status: 'refused' });
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  router.post('/', async (req, res) => {
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 32768)
      return res.status(400).json({ status: 'refused' });
    try {
      const result = await mark(req.body, req.get('origin'));
      return res.status(result.status === 'marked' ? 200 : result.status === 'disabled' ? 503 : 409).json(result);
    } catch {
      return res.status(503).json({ status: 'unknown' });
    }
  });
  return router;
}

module.exports = { createFallbackMarkerRouter };
