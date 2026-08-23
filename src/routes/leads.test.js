const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

const { createLeadsRouter } = require('./leads');

async function post(router) {
  const app = express();
  app.use(express.json());
  app.use('/route-lead', router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/route-lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Synthetic',
        email: 'synthetic@example.invalid',
        phone: '+1 555 010 0200',
        state: 'Texas',
      }),
    });
    return { body: await response.json(), status: response.status };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function postMany(router, count) {
  const app = express();
  app.use(express.json());
  app.use('/route-lead', router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const { port } = server.address();
    return await Promise.all(Array.from({ length: count }, (_, index) =>
      fetch(`http://127.0.0.1:${port}/route-lead`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `synthetic-${index}@example.invalid`, state: 'Texas',
        }),
      }).then(async (response) => ({ status: response.status, body: await response.json() })),
    ));
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('returns the existing public response while teeing internal evidence', async () => {
  const observations = [];
  const router = createLeadsRouter({
    clock: () => new Date('2026-08-23T18:00:00.000Z'),
    routeLead: async () => ({
      assignedAdvisor: 'Advisor A',
      assignedAdvisorAirtableId: 'rec-advisor-a',
      calendarUrl: 'https://example.com/calendar-a',
      reasonCode: 'TOP_RANKED',
      reasoning: {
        eligibleAdvisors: ['Advisor A'],
        filteredAtCapacity: [],
        filteredInactive: [],
        finalReason: 'Advisor A selected.',
      },
    }),
    scheduleShadowObservation: (input) => observations.push(input),
    shadowConfig: { enabled: true },
  });

  const response = await post(router);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    assignedAdvisor: 'Advisor A',
    calendarUrl: 'https://example.com/calendar-a',
    reasoning: {
      eligibleAdvisors: ['Advisor A'],
      filteredAtCapacity: [],
      filteredInactive: [],
      finalReason: 'Advisor A selected.',
    },
  });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].result.assignedAdvisorAirtableId, 'rec-advisor-a');
});

test('a synchronous tee failure cannot replace James response', async () => {
  const router = createLeadsRouter({
    routeLead: async () => ({
      assignedAdvisor: 'Advisor A',
      assignedAdvisorAirtableId: 'rec-advisor-a',
      calendarUrl: 'https://example.com/calendar-a',
      reasonCode: 'TOP_RANKED',
      reasoning: {},
    }),
    scheduleShadowObservation: () => {
      throw new Error('tee failed');
    },
    shadowConfig: { enabled: true },
  });

  const response = await post(router);
  assert.equal(response.status, 200);
  assert.equal(response.body.calendarUrl, 'https://example.com/calendar-a');
});

test('preserves one James call and one tee schedule across 200 concurrent requests', async () => {
  let routeCalls = 0;
  let teeCalls = 0;
  const router = createLeadsRouter({
    routeLead: async () => {
      routeCalls += 1;
      return {
        assignedAdvisor: 'Advisor A', assignedAdvisorAirtableId: 'rec-advisor-a',
        calendarUrl: 'https://example.com/calendar-a', reasonCode: 'TOP_RANKED',
        reasoning: {},
      };
    },
    scheduleShadowObservation: () => { teeCalls += 1; },
    shadowConfig: { enabled: true },
  });
  const responses = await postMany(router, 200);
  assert.equal(routeCalls, 200);
  assert.equal(teeCalls, 200);
  assert.equal(responses.filter((response) => response.status === 200).length, 200);
  assert.ok(responses.every((response) =>
    response.body.calendarUrl === 'https://example.com/calendar-a'));
});
