const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  buildShadowObservation,
  createCaptureRequest,
  scheduleShadowObservation,
} = require('./shadowTee');

const input = {
  lead: {
    name: 'Synthetic Person',
    email: ' Sample@Example.com ',
    phone: ' +1 (555) 010-0200 ',
    state: 'texas',
  },
  result: {
    assignedAdvisor: 'Advisor A',
    assignedAdvisorAirtableId: 'rec-advisor-a',
    calendarUrl: 'https://api.leadconnectorhq.com/widget/booking/calendar-a',
    reasonCode: 'TOP_RANKED',
  },
  startedAt: '2026-08-23T18:00:00.000Z',
  completedAt: '2026-08-23T18:00:00.075Z',
};

const config = {
  captureUrl: 'https://example.supabase.co/functions/v1/capture-route-shadow',
  cohortRef: '10000000-0000-4000-8000-000000000002',
  enabled: true,
  secret: 'test-secret',
  timeoutMs: 250,
};

test('builds a stable PII-minimized observation', () => {
  const observation = buildShadowObservation(input, config, {
    randomUUID: () => '10000000-0000-4000-8000-000000000001',
  });

  assert.equal(observation.routeRequestId, '10000000-0000-4000-8000-000000000001');
  assert.equal(observation.normalizedRequest.prospectState, 'TX');
  assert.equal(observation.normalizedRequest.cohortRef, config.cohortRef);
  assert.match(observation.normalizedRequest.emailHash, /^[0-9a-f]{64}$/);
  assert.match(observation.normalizedRequest.phoneHash, /^[0-9a-f]{64}$/);
  assert.equal(observation.legacy.advisorAirtableId, 'rec-advisor-a');
  assert.match(observation.legacy.calendarUrlHash, /^[0-9a-f]{64}$/);
  assert.equal(observation.legacy.reasonCodes[0], 'TOP_RANKED');
  assert.equal(observation.legacy.latencyMs, 75);

  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /Synthetic Person/);
  assert.doesNotMatch(serialized, /Sample@Example\.com/i);
  assert.doesNotMatch(serialized, /555/);
});

test('signs the exact timestamped request body', () => {
  const observation = buildShadowObservation(input, config, {
    randomUUID: () => '10000000-0000-4000-8000-000000000001',
  });
  const request = createCaptureRequest(observation, config, {
    now: () => new Date('2026-08-23T18:00:01.000Z'),
  });
  const expected = crypto
    .createHmac('sha256', config.secret)
    .update(`${request.headers['x-lpg-shadow-timestamp']}.${request.body}`)
    .digest('hex');

  assert.equal(request.headers['x-lpg-shadow-signature'], expected);
  assert.equal(request.headers['content-type'], 'application/json');
});

test('returns immediately and isolates capture failure', async () => {
  let deferred;
  const scheduled = scheduleShadowObservation(input, config, {
    defer: (task) => {
      deferred = task;
    },
    fetch: async () => {
      throw new Error('capture unavailable');
    },
    logger: { error() {} },
    now: () => new Date('2026-08-23T18:00:01.000Z'),
    randomUUID: () => '10000000-0000-4000-8000-000000000001',
  });

  assert.equal(scheduled, true);
  await assert.doesNotReject(deferred);
});

test('does nothing unless explicitly enabled with complete configuration', () => {
  let deferred = false;
  const scheduled = scheduleShadowObservation(input, { ...config, enabled: false }, {
    defer: () => {
      deferred = true;
    },
  });

  assert.equal(scheduled, false);
  assert.equal(deferred, false);
});
