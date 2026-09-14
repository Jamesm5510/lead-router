// Run the real server with synthetic provider responses. Never use live credentials.
const net = require('node:net');
const calls = [];
const advisor = { id: 'recSynthetic', fields: {
  Name: 'Synthetic advisor', States: 'Oregon', 'Client Current Status': 'Active',
  'Number of Appointments': '10', 'Appointments This Month': 2,
  'Appointments This Week': 1, 'Calendar URL': 'https://example.com/book',
} };
global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
  if (String(url).includes('/Advisors')) {
    if (options.method === 'PATCH' || options.method === 'POST') {
      return Response.json({ ...advisor, fields: { ...advisor.fields, ...JSON.parse(options.body).fields } });
    }
    if (String(url).endsWith('/recSynthetic')) return Response.json(advisor);
    return Response.json({ records: [advisor] });
  }
  if (String(url).includes('graph.facebook.com')) return Response.json({ data: [] });
  if (String(url).includes('api.airtable.com')) return Response.json({ records: [] });
  if (String(url).includes('api.resend.com')) return Response.json({ id: 'synthetic-email' });
  throw new Error(`Unexpected synthetic provider request: ${url}`);
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send({ port: this.address().port }));
  return listen.apply(this, args);
};
process.on('message', () => process.send({ calls: calls.splice(0) }));
require('../../server');
