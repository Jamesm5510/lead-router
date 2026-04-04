/**
 * routes/leads.js
 *
 * POST /route-lead
 * Accepts a lead payload and returns the assigned advisor + booking link.
 */

const express    = require('express');
const router     = express.Router();
const { routeLead } = require('../routingLogic');

router.post('/', (req, res) => {
  const { name, email, phone, state } = req.body;

  // State is the only field required for routing
  if (!state) {
    return res.status(400).json({ error: 'Missing required field: state' });
  }

  const result = routeLead({ name, email, phone, state });

  if (!result.assignedAdvisor) {
    return res.status(503).json({
      error: 'No advisor available and no default configured.',
      ...result,
    });
  }

  return res.json(result);
});

module.exports = router;
