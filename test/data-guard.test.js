const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdvisor, updateAdvisor, deleteAdvisor } = require('../src/dataAccess');

test('direct advisor data helpers refuse disabled writes before calling the provider', async t => {
  const old = process.env.LEGACY_ROUTING_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.LEGACY_ROUTING_ENABLED; else process.env.LEGACY_ROUTING_ENABLED = old; });
  const calls = [];
  t.mock.method(global, 'fetch', async (...args) => {
    calls.push(args);
    return Response.json({ id: 'synthetic', fields: {} });
  });
  for (const flag of ['0', '', 'false', 'true', ' 1', '1 ', 'invalid']) {
    process.env.LEGACY_ROUTING_ENABLED = flag;
    for (const action of [() => createAdvisor({ name: 'Synthetic' }), () => updateAdvisor('synthetic', {}), () => deleteAdvisor('synthetic')]) {
      await assert.rejects(action, { code: 'LEGACY_ROUTING_DISABLED' });
    }
  }
  assert.deepEqual(calls, []);
});
