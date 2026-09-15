const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createHmac } = require('node:crypto');
const { createFallbackMarkerRouter } = require('../src/routes/fallbackMarker');

test('existing host keeps fallback endpoint disabled without provider calls', async () => {
  const app = express();
  app.use(express.json());
  app.use('/fallback-use', createFallbackMarkerRouter({ env: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/fallback-use`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contactId: 'never-trusted' }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'disabled' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('invalid enabled configuration stays unavailable without exposing secrets', async () => {
  const app = express();
  app.use(express.json());
  app.use('/fallback-use', createFallbackMarkerRouter({ env: { FALLBACK_MARKER_ENABLED: 'true', FALLBACK_MARKER_CONFIG_JSON: '{bad-secret-input' } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/fallback-use`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'disabled' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('HTTP marker verifies accepted Test submission and leaves normal assignment untouched', async () => {
  const attemptId = '10000000-0000-4000-8000-000000000001';
  const config = {
    locationId: 'vZcdSE5AHmL4slrXdAZz', formId: 'fixture-form', pageOrigin: 'https://native.synthetic.test', pageVersion: 'fixture-v1',
    fallbackAdvisorId: 'fixture-advisor', allowedCalendarHosts: ['calendar.synthetic.test'],
    fields: { attempt: 'attempt', publication: 'publication', publicationId: 'publicationId', mode: 'mode', reference: 'reference', advisor: 'fallback-advisor', reason: 'fallback-reason' },
  };
  const unsigned = { schemaVersion: 3, publicationId: 'fixture-publication', publishedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), active: { advisorId: 'fixture-advisor', advisorName: 'Fixture', calendarUrl: 'https://calendar.synthetic.test/book', version: 'fixture-v1' }, retained: [] };
  const publication = { ...unsigned, signature: createHmac('sha256', 'fixture-publication-key').update(JSON.stringify(unsigned)).digest('hex') };
  const fields = {};
  const writes = [];
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://services.leadconnectorhq.com');
    if (url.pathname === '/forms/submissions') return Response.json({ submissions: [{ id: 'fixture-submission', contactId: 'fixture-contact', formId: config.formId, createdAt: new Date(Date.now() - 1000).toISOString(), others: { attempt: attemptId, publication: JSON.stringify(publication), publicationId: publication.publicationId, mode: 'emergency_uncounted', reference: '' } }], meta: { currentPage: 1, nextPage: null, total: 1 } });
    assert.equal(url.pathname, '/contacts/fixture-contact');
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ['customFields']);
      writes.push(body);
      body.customFields.forEach(field => { fields[field.id] = field.fieldValue; });
    }
    return Response.json({ contact: { id: 'fixture-contact', locationId: config.locationId, assignedTo: 'original-advisor', customFields: Object.entries(fields).map(([id, value]) => ({ id, value })) } });
  };
  const app = express();
  app.use(express.json());
  app.use('/fallback-use', createFallbackMarkerRouter({ env: { FALLBACK_MARKER_ENABLED: 'true', FALLBACK_MARKER_CONFIG_JSON: JSON.stringify(config), FALLBACK_GHL_TOKEN: 'fixture-token', FALLBACK_PUBLICATION_SIGNING_KEY: 'fixture-publication-key', FALLBACK_NATIVE_SIGNING_KEY: 'ab'.repeat(32) }, fetcher }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/fallback-use`;
    const send = origin => fetch(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ attemptId, publication }) });
    assert.equal((await send('https://foreign.synthetic.test')).status, 403);
    assert.equal(writes.length, 0);
    for (let i = 0; i < 2; i++) {
      const response = await send(config.pageOrigin);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), config.pageOrigin);
      assert.deepEqual(await response.json(), { status: 'marked' });
    }
    assert.equal(writes.length, 1);
    assert.deepEqual(fields, { 'fallback-advisor': 'fixture-advisor', 'fallback-reason': 'outage_fallback' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
