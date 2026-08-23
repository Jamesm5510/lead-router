/**
 * routes/leads.js
 *
 * POST /route-lead
 * Accepts a lead payload and returns the assigned advisor + booking link.
 */

const express = require('express');
const { routeLead: defaultRouteLead } = require('../routingLogic');
const {
  configFromEnv,
  scheduleShadowObservation: defaultScheduleShadowObservation,
} = require('../shadowTee');

function publicResult(result) {
  return {
    assignedAdvisor: result.assignedAdvisor,
    calendarUrl: result.calendarUrl,
    reasoning: result.reasoning,
  };
}

function createLeadsRouter(deps = {}) {
  const router = express.Router();
  const routeLead = deps.routeLead || defaultRouteLead;
  const scheduleShadowObservation =
    deps.scheduleShadowObservation || defaultScheduleShadowObservation;
  const shadowConfig = deps.shadowConfig || configFromEnv();
  const clock = deps.clock || (() => new Date());
  const logger = deps.logger || console;

  router.post('/', async (req, res) => {
    const { name, email, phone, state } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'Missing required field: state' });
    }

    const lead = { name, email, phone, state };
    const startedAt = clock().toISOString();
    try {
      const result = await routeLead(lead);
      const completedAt = clock().toISOString();
      const response = publicResult(result);

      if (!result.assignedAdvisor) {
        res.status(503).json({
          error: 'No advisor available and no default configured.',
          ...response,
        });
      } else {
        res.json(response);
      }

      try {
        scheduleShadowObservation(
          { completedAt, lead, result, startedAt },
          shadowConfig,
          { logger },
        );
      } catch (error) {
        logger.error('[ShadowTee] scheduling failed:', error.message);
      }
      return undefined;
    } catch (err) {
      console.error('[LeadRouter] Routing error:', err.message);
      return res.status(500).json({ error: 'Routing failed. Please try again.' });
    }
  });

  return router;
}

module.exports = createLeadsRouter();
module.exports.createLeadsRouter = createLeadsRouter;
module.exports.publicResult = publicResult;
