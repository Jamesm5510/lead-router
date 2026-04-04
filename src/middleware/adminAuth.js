/**
 * adminAuth.js
 *
 * Checks the X-Admin-Key header against the ADMIN_KEY env variable.
 * Applied to all /advisors routes so only the admin dashboard can call them.
 */

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

module.exports = adminAuth;
