/**
 * routingLogic.js
 *
 * Pure routing decisions live here. This file does not write to disk
 * and does not know about HTTP — it receives a lead object and returns
 * an assignment result. That separation keeps it easy to test and reason about.
 *
 * Routing steps (in order):
 *   1. Filter to advisors licensed in the lead's state
 *   2. Remove inactive advisors
 *   3. Prefer the most constrained advisor (fewest licensed states)
 *   4. Remove advisors at or above their monthly target
 *   5. Among remaining, pick the lowest % to target
 *   6. Apply manualPriorityBoost as a score override
 *   7. If no one passes capacity, fall back to the default advisor
 */

const { readAdvisors, updateAdvisor } = require('./dataAccess');

/**
 * Score an advisor for selection. Lower score = higher priority.
 *
 * Components:
 *   - percentage to monthly target  (primary driver — step 5)
 *   - licensed state count * 0.001  (tiebreaker for most constrained — step 3)
 *   - minus manualPriorityBoost * 0.5  (operator override — step 6)
 *
 * The boost multiplier (0.5) means a boost of 1 moves an advisor ahead of
 * someone who is ~50 percentage points closer to their target. Adjust as needed.
 */
function scoreAdvisor(advisor) {
  const percentage      = advisor.appointmentsDeliveredThisMonth / advisor.targetAppointmentsPerMonth;
  const constraintPenalty = advisor.licensedStates.length * 0.001;
  const boostCredit     = (advisor.manualPriorityBoost || 0) * 0.5;

  return percentage + constraintPenalty - boostCredit;
}

/**
 * Route a lead to the best available advisor.
 *
 * @param {object} lead - { name, email, phone, state }
 * @returns {object} - { assignedAdvisor, calendarUrl, reasoning }
 */
async function routeLead(lead) {
  const { state } = lead;
  const allAdvisors = await readAdvisors();

  // ── Step 1: licensed in this state ──────────────────────────────────────
  const licensedForState = allAdvisors.filter(a =>
    a.licensedStates.map(s => s.toLowerCase()).includes(state.toLowerCase())
  );

  // ── Step 2: active only ──────────────────────────────────────────────────
  const activeAdvisors   = licensedForState.filter(a => a.isActive);
  const filteredInactive = licensedForState
    .filter(a => !a.isActive)
    .map(a => a.name);

  // ── Step 4: under monthly capacity ──────────────────────────────────────
  const underCapacity    = activeAdvisors.filter(
    a => a.appointmentsDeliveredThisMonth < a.targetAppointmentsPerMonth
  );
  const filteredAtCapacity = activeAdvisors
    .filter(a => a.appointmentsDeliveredThisMonth >= a.targetAppointmentsPerMonth)
    .map(a => a.name);

  const eligibleAdvisors = underCapacity.map(a => a.name);

  // ── Steps 3, 5, 6: score and pick the best ──────────────────────────────
  let chosen = null;

  if (underCapacity.length > 0) {
    const scored = underCapacity
      .map(a => ({ advisor: a, score: scoreAdvisor(a) }))
      .sort((a, b) => a.score - b.score);   // ascending — lowest wins

    chosen = scored[0].advisor;
  }

  // ── Step 7: fallback to default advisor ─────────────────────────────────
  let assignedAdvisor;
  let finalReason;

  if (chosen) {
    assignedAdvisor = chosen;
    const pct = Math.round(
      (chosen.appointmentsDeliveredThisMonth / chosen.targetAppointmentsPerMonth) * 100
    );
    finalReason =
      `${chosen.name} was eligible, under target (${pct}% to monthly goal), ` +
      `and most constrained with ${chosen.licensedStates.length} licensed state(s).`;

    if (chosen.manualPriorityBoost > 0) {
      finalReason += ` Manual priority boost of ${chosen.manualPriorityBoost} was applied.`;
    }
  } else {
    // No eligible advisor — use the one flagged isDefault: true
    const defaultAdvisor = allAdvisors.find(a => a.isDefault);

    if (!defaultAdvisor) {
      // Safety net: misconfiguration, no default set
      return {
        assignedAdvisor: null,
        calendarUrl: null,
        reasoning: {
          eligibleAdvisors,
          filteredInactive,
          filteredAtCapacity,
          finalReason: 'No eligible advisors found and no default advisor is configured.',
        },
      };
    }

    assignedAdvisor = defaultAdvisor;
    finalReason =
      `No advisors were under capacity for ${state}. ` +
      `Falling back to default advisor ${defaultAdvisor.name}.`;
  }

  // ── Increment count immediately so the next lead sees updated capacity ────
  await updateAdvisor(assignedAdvisor.id, {
    appointmentsDeliveredThisMonth: assignedAdvisor.appointmentsDeliveredThisMonth + 1,
    appointmentsDeliveredThisWeek:  assignedAdvisor.appointmentsDeliveredThisWeek  + 1,
  });

  return {
    assignedAdvisor: assignedAdvisor.name,
    calendarUrl: assignedAdvisor.calendarUrl,
    reasoning: {
      eligibleAdvisors,
      filteredInactive,
      filteredAtCapacity,
      finalReason,
    },
  };
}

module.exports = { routeLead };
