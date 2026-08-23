const crypto = require('node:crypto');

const STATE_CODES = Object.freeze({
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase();
  return STATE_CODES[normalized] || null;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildShadowObservation(input, config, deps = {}) {
  const randomUUID = deps.randomUUID || crypto.randomUUID;
  const email = normalizeEmail(input.lead.email);
  const phone = normalizePhone(input.lead.phone);
  const prospectState = normalizeState(input.lead.state);
  if (!email || !prospectState) throw new Error('SHADOW_IDENTITY_INPUT_INVALID');

  const normalizedRequest = {
    cohortRef: config.cohortRef,
    emailHash: sha256(email),
    ...(phone ? { phoneHash: sha256(phone) } : {}),
    prospectState,
  };
  const routeRequestId = randomUUID();
  const startedAt = new Date(input.startedAt);
  const completedAt = new Date(input.completedAt);
  const latencyMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

  return {
    routeRequestId,
    requestHash: sha256(JSON.stringify(normalizedRequest)),
    requestedAt: startedAt.toISOString(),
    normalizedRequest,
    legacy: {
      status: input.result.assignedAdvisor ? 'selected' : 'no_route',
      ...(input.result.assignedAdvisorAirtableId
        ? { advisorAirtableId: input.result.assignedAdvisorAirtableId }
        : {}),
      ...(input.result.calendarUrl
        ? { calendarUrlHash: sha256(input.result.calendarUrl) }
        : {}),
      reasonCodes: [input.result.reasonCode || 'LEGACY_REASON_UNKNOWN'],
      latencyMs,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome: { authority: 'james', effectsPerformed: true },
    },
  };
}

function createCaptureRequest(observation, config, deps = {}) {
  const now = deps.now || (() => new Date());
  const body = JSON.stringify(observation);
  const timestamp = now().toISOString();
  const signature = crypto
    .createHmac('sha256', config.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-lpg-shadow-signature': signature,
      'x-lpg-shadow-timestamp': timestamp,
    },
    method: 'POST',
  };
}

function configFromEnv(environment = process.env) {
  return {
    captureUrl: environment.SHADOW_CAPTURE_URL || '',
    cohortRef: environment.SHADOW_COHORT_REF || '',
    enabled: environment.SHADOW_CAPTURE_ENABLED === '1',
    secret: environment.SHADOW_CAPTURE_SECRET || '',
    timeoutMs: Number(environment.SHADOW_CAPTURE_TIMEOUT_MS || 500),
  };
}

function scheduleShadowObservation(input, config, deps = {}) {
  if (!config.enabled || !config.captureUrl || !config.cohortRef || !config.secret)
    return false;

  const logger = deps.logger || console;
  const fetchImpl = deps.fetch || global.fetch;
  const defer = deps.defer || ((task) => void task);
  try {
    const observation = buildShadowObservation(input, config, deps);
    const request = createCaptureRequest(observation, config, deps);
    const task = Promise.resolve()
      .then(() => fetchImpl(config.captureUrl, {
        ...request,
        signal: AbortSignal.timeout(config.timeoutMs),
      }))
      .then((response) => {
        if (!response.ok) throw new Error(`capture returned ${response.status}`);
      })
      .catch((error) => {
        logger.error('[ShadowTee] capture failed:', error.message);
      });
    defer(task);
    return true;
  } catch (error) {
    logger.error('[ShadowTee] observation rejected:', error.message);
    return false;
  }
}

module.exports = {
  buildShadowObservation,
  configFromEnv,
  createCaptureRequest,
  normalizeState,
  scheduleShadowObservation,
};
