// Only an absent flag or the exact value "1" permits legacy routing effects.
function legacyRoutingEnabled() {
  const value = process.env.LEGACY_ROUTING_ENABLED;
  return value === undefined || value === '1';
}

function requireLegacyRouting(req, res, next) {
  if (!legacyRoutingEnabled()) {
    return res.status(503).json({
      code: 'LEGACY_ROUTING_DISABLED',
      error: 'Legacy routing is disabled.',
    });
  }
  return next();
}

function assertLegacyRoutingEnabled() {
  if (!legacyRoutingEnabled()) {
    const error = new Error('Legacy routing is disabled.');
    error.code = 'LEGACY_ROUTING_DISABLED';
    throw error;
  }
}

module.exports = { legacyRoutingEnabled, requireLegacyRouting, assertLegacyRoutingEnabled };
