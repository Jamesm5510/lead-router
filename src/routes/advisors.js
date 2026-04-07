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

router.use(adminAuth);

// ── GET /advisors ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    return res.json(await readAdvisors());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /advisors ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, calendarUrl } = req.body;
  if (!name || !calendarUrl) {
    return res.status(400).json({ error: 'name and calendarUrl are required' });
  }
  try {
    const advisor = await createAdvisor(req.body);
    return res.status(201).json({ success: true, advisor });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /advisors/update ─────────────────────────────────────────────────
router.post('/update', async (req, res) => {
  const { id, ...updates } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }
  delete updates.id;
  delete updates.isDefault;

  try {
    const updated = await updateAdvisor(id, updates);
    if (!updated) {
      return res.status(404).json({ error: `No advisor found with id "${id}"` });
    }
    return res.json({ success: true, advisor: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /advisors/set-counts ─────────────────────────────────────────────
router.post('/set-counts', async (req, res) => {
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

  try {
    const updated = await updateAdvisor(id, updates);
    if (!updated) {
      return res.status(404).json({ error: `No advisor found with id "${id}"` });
    }
    return res.json({ success: true, advisor: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /advisors/toggle-active ──────────────────────────────────────────
router.post('/toggle-active', async (req, res) => {
  const { id, isActive } = req.body;
  if (!id || isActive === undefined) {
    return res.status(400).json({ error: 'Missing required fields: id, isActive' });
  }

  try {
    const updated = await updateAdvisor(id, { isActive: Boolean(isActive) });
    if (!updated) {
      return res.status(404).json({ error: `No advisor found with id "${id}"` });
    }
    return res.json({ success: true, status: updated.isActive ? 'activated' : 'paused', advisor: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /advisors/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const advisor = await getAdvisorById(id);
    if (!advisor) {
      return res.status(404).json({ error: `No advisor found with id "${id}"` });
    }
    if (advisor.isDefault) {
      return res.status(400).json({ error: 'Cannot delete the default advisor' });
    }
    await deleteAdvisor(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
