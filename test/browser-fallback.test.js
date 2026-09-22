const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../public/ghl-embed.js'), 'utf8');

function loadBrowser(fetcher) {
  let clickHandler;
  let capture;
  const button = {
    addEventListener(event, handler, options) {
      assert.equal(event, 'click');
      clickHandler = handler;
      capture = options;
    },
  };
  const values = {
    first_name: 'Synthetic',
    email: 'synthetic@example.com',
    phone: '555-0100',
    state: 'Oregon',
  };
  const form = {
    querySelector(selector) {
      if (selector === '[type="submit"]') return button;
      const match = selector.match(/^\[name="(.+)"\]$/);
      if (!match || !(match[1] in values)) return null;
      return {
        classList: { contains: () => false },
        type: 'text',
        value: values[match[1]],
      };
    },
  };
  const window = {
    LeadRouterConfig: {
      backendUrl: 'https://router.synthetic.test/',
      formSelector: '#_builder-form',
      fallbackUrl: 'https://booking.synthetic.test/native',
      fields: { name: 'first_name', email: 'email', phone: 'phone', state: 'state' },
    },
    location: { href: 'https://intake.synthetic.test/form' },
  };
  const context = {
    window,
    fetch: fetcher,
    console: { log() {}, warn() {}, error() {} },
    document: {
      readyState: 'complete',
      querySelector: selector => selector === '#_builder-form' ? form : null,
      getElementById: () => null,
    },
  };
  vm.runInNewContext(source, context, { filename: 'ghl-embed.js' });
  assert.equal(typeof clickHandler, 'function');
  assert.equal(capture, true);
  return { clickHandler, window };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('browser keeps native GHL submit and reveals routed calendar without marker calls', async () => {
  const requests = [];
  const browser = loadBrowser(async (url, options) => {
    requests.push({ url, options });
    return { json: async () => ({ calendarUrl: 'https://calendar.synthetic.test/advisor' }) };
  });
  let prevented = false;
  browser.clickHandler({ preventDefault: () => { prevented = true; } });
  await flush();

  assert.equal(prevented, false);
  assert.equal(browser.window.location.href, 'https://calendar.synthetic.test/advisor');
  assert.deepEqual(requests.map(request => request.url), ['https://router.synthetic.test/route-lead']);
  assert.equal(requests.some(request => request.url.includes('fallback-use')), false);
});

test('browser retains configured native booking fallback when routing fails', async () => {
  const requests = [];
  const browser = loadBrowser(async url => {
    requests.push(url);
    throw new Error('synthetic routing outage');
  });
  browser.clickHandler({ preventDefault: () => assert.fail('native submit must not be prevented') });
  await flush();

  assert.equal(browser.window.location.href, 'https://booking.synthetic.test/native');
  assert.deepEqual(requests, ['https://router.synthetic.test/route-lead']);
  assert.equal(source.includes('/fallback-use'), false);
});
