/**
 * routes/advisors.js
 *
 * All advisor management endpoints. Every route requires the X-Admin-Key header.
 *
 *   GET    /advisors               — list all advisors
 *   POST   /advisors               — create a new advisor
 *   POST   /advisors/update        — update any field(s) on an advisor
 *   POST   /advisors/set-counts    — set monthly/weekly appointment counts
 *   POST   /advisors/toggle-active — pause or unpause an advisor
 *   DELETE /advisors/:id           — delete an advisor (cannot delete the default)
 */

const express   = require('express');
const router    = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { readAdvisors, getAdvisorById, createAdvisor, updateAdvisor, deleteAdvisor } = require('../dataAccess');

// Protect every advisor route
router.use(adminAuth);

// ── GET /advisors ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  return res.json(readAdvisors());
});

// ── POST /advisors ────────────────────────────────────────────────────────
// Create a new advisor. Counts start at 0 regardless of what's sent.
router.post('/', (req, res) => {
  const { name, calendarUrl } = req.body;
  if (!name || !calendarUrl) {
    return res.status(400).json({ error: 'name and calendarUrl are required' });
  }
  const advisor = createAdvisor(req.body);
  return res.status(201).json({ success: true, advisor });
});

// ── POST /advisors/update ─────────────────────────────────────────────────
// Update any field(s) on an existing advisor. id and isDefault are protected.
router.post('/update', (req, res) => {
  const { id, ...updates } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }
  delete updates.id;
  delete updates.isDefault;

  const updated = updateAdvisor(id, updates);
  if (!updated) {
    return res.status(404).json({ error: `No advisor found with id "${id}"` });
  }
  return res.json({ success: true, advisor: updated });
});

// ── POST /advisors/set-counts ─────────────────────────────────────────────
// Set appointment counters directly. Use for weekly resets or corrections.
router.post('/set-counts', (req, res) => {
  const { id, appointmentsDeliveredThisMonth, appointmentsDeliveredThisWeek } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }
  if (appointmentsDeliveredThisMonth === undefined && appointmentsDeliveredThisWeek === undefined) {
    return res.status(400).json({ error: 'Provide appointmentsDeliveredThisMonth and/or appointmentsDeliveredThisWeek' });
  }

  const updates = {};
  if (appointmentsDeliveredThisMonth !== undefined) updates.appointmentsDeliveredThisMonth = Number(appointmentsDeliveredThisMonth);
  if (appointmentsDeliveredThisWeek  !== undefined) updates.appointmentsDeliveredThisWeek  = Number(appointmentsDeliveredThisWeek);

  const updated = updateAdvisor(id, updates);
  if (!updated) {
    return res.status(404).json({ error: `No advisor found with id "${id}"` });
  }
  return res.json({ success: true, advisor: updated });
});

// ── POST /advisors/toggle-active ──────────────────────────────────────────
// Pause or unpause an advisor.
router.post('/toggle-active', (req, res) => {
  const { id, isActive } = req.body;
  if (!id || isActive === undefined) {
    return res.status(400).json({ error: 'Missing required fields: id, isActive' });
  }

  const updated = updateAdvisor(id, { isActive: Boolean(isActive) });
  if (!updated) {
    return res.status(404).json({ error: `No advisor found with id "${id}"` });
  }
  return res.json({ success: true, status: updated.isActive ? 'activated' : 'paused', advisor: updated });
});

// ── DELETE /advisors/:id ──────────────────────────────────────────────────
// Remove an advisor permanently. The default advisor is protected.
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const advisor = getAdvisorById(id);

  if (!advisor) {
    return res.status(404).json({ error: `No advisor found with id "${id}"` });
  }
  if (advisor.isDefault) {
    return res.status(400).json({ error: 'Cannot delete the default advisor' });
  }

  deleteAdvisor(id);
  return res.json({ success: true });
});

module.exports = router;
