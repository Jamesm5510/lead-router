const test = require('node:test');
const assert = require('node:assert/strict');

const dataAccessPath = require.resolve('../src/dataAccess');
const alertPath = require.resolve('../src/alert');
const routingPath = require.resolve('../src/routingLogic');

function loadRouting(advisors, alerts) {
  delete require.cache[routingPath];
  require.cache[dataAccessPath] = {
    id: dataAccessPath,
    filename: dataAccessPath,
    loaded: true,
    exports: {
      readAdvisors: async () => advisors,
      updateAdvisor: async () => null,
    },
  };
  require.cache[alertPath] = {
    id: alertPath,
    filename: alertPath,
    loaded: true,
    exports: { sendAlert: async (subject, body) => alerts.push({ subject, body }) },
  };
  return require(routingPath).routeLead;
}

function clearRoutingModules() {
  delete require.cache[routingPath];
  delete require.cache[dataAccessPath];
  delete require.cache[alertPath];
}

test.afterEach(clearRoutingModules);

test('owner alert explains when a lead cannot book without a default advisor', async () => {
  const alerts = [];
  const routeLead = loadRouting([
    {
      name: 'Inactive advisor', isActive: false, isDefault: false, licensedStates: ['Oregon'],
      targetAppointmentsPerMonth: 10, appointmentsDeliveredThisMonth: 1,
      appointmentsDeliveredThisWeek: 1, manualPriorityBoost: 0,
    },
    {
      name: 'Full advisor', isActive: true, isDefault: false, licensedStates: ['Oregon'],
      targetAppointmentsPerMonth: 2, appointmentsDeliveredThisMonth: 2,
      appointmentsDeliveredThisWeek: 1, manualPriorityBoost: 0,
    },
  ], alerts);

  const result = await routeLead({ name: 'Taylor Example', email: 'taylor@example.com', state: 'Oregon' });

  assert.equal(result.calendarUrl, null);
  assert.deepEqual(alerts, [{
    subject: "Oregon lead can't book, no advisor available",
    body: "Taylor Example (taylor@example.com) tried to book and didn't get a calendar. Reach out today, then add an active advisor for Oregon in Airtable.\n\nSkipped as inactive: Inactive advisor.\nSkipped as full: Full advisor.",
  }]);
});

test('owner alert explains when a lead was booked with the default advisor', async () => {
  const alerts = [];
  const routeLead = loadRouting([
    {
      name: 'Inactive advisor', isActive: false, isDefault: false, licensedStates: ['Oregon'],
      targetAppointmentsPerMonth: 10, appointmentsDeliveredThisMonth: 1,
      appointmentsDeliveredThisWeek: 1, manualPriorityBoost: 0,
    },
    {
      name: 'Full advisor', isActive: true, isDefault: false, licensedStates: ['Oregon'],
      targetAppointmentsPerMonth: 2, appointmentsDeliveredThisMonth: 2,
      appointmentsDeliveredThisWeek: 1, manualPriorityBoost: 0,
    },
    {
      name: 'Default advisor', isActive: true, isDefault: true, licensedStates: ['Washington'],
      targetAppointmentsPerMonth: 10, appointmentsDeliveredThisMonth: 1,
      appointmentsDeliveredThisWeek: 1, calendarUrl: 'https://calendar.example/default', manualPriorityBoost: 0,
    },
  ], alerts);

  const result = await routeLead({ name: 'Taylor Example', email: 'taylor@example.com', state: 'Oregon' });

  assert.equal(result.calendarUrl, 'https://calendar.example/default');
  assert.deepEqual(alerts, [{
    subject: 'Oregon lead sent to the default advisor',
    body: "Taylor Example (taylor@example.com) got Default advisor's calendar because no Oregon advisor had room. Check Oregon capacity and licensing in Airtable.\n\nSkipped as inactive: Inactive advisor.\nSkipped as full: Full advisor.",
  }]);
});
