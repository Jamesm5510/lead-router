/**
 * routes/leads.js
 *
 * POST /route-lead
 * Accepts a lead payload and returns the assigned advisor + booking link.
 */

const express    = require('express');
const router     = express.Router();
const { routeLead } = require('../routingLogic');

router.post('/', async (req, res) => {
  const { name, email, phone, state } = req.body;

  if (!state) {
    return res.status(400).json({ error: 'Missing required field: state' });
  }

  try {
    const result = await routeLead({ name, email, phone, state });

    if (!result.assignedAdvisor) {
      return res.status(503).json({
        error: 'No advisor available and no default configured.',
        ...result,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('[LeadRouter] Routing error:', err.message);
    return res.status(500).json({ error: 'Routing failed. Please try again.' });
  }
});

module.exports = router;
