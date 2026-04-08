/**
 * dataAccess.js
 *
 * Advisor data lives in Airtable. All reads and writes go through here.
 * Routing logic and routes stay untouched — only this file changed.
 */

const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appHJlW9fAp3BzPfg';
const TABLE            = 'Advisors';
const BASE_URL         = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;

const HEADERS = {
  'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
  'Content-Type':  'application/json',
};

const ALL_50_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming',
];

function parseStates(raw) {
  if (!raw) return [];
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'all') return ALL_50_STATES;
  if (normalized.startsWith('all except')) {
    const excluded = normalized.replace('all except', '').trim();
    return ALL_50_STATES.filter(s => s.toLowerCase() !== excluded);
  }
  return raw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
}

function parseTarget(raw) {
  if (!raw) return 10;
  const match = String(raw).match(/\d+/);
  return match ? Number(match[0]) : 10;
}

/** Map an Airtable record to the advisor shape the rest of the app expects. */
function toAdvisor(record) {
  const f = record.fields;
  return {
    id:                             record.id,
    name:                           f['Name']                       || '',
    isDefault:                      f['🟠Is Default']                 || false,
    licensedStates:                 parseStates(f['🟠States']         || ''),
    targetAppointmentsPerMonth:     parseTarget(f['🟠Number of Appointments']),
    appointmentsDeliveredThisMonth: Number(f['🟠Appointments This Month']) || 0,
    appointmentsDeliveredThisWeek:  Number(f['🟠Appointments This Week'])  || 0,
    calendarUrl:                    f['🟠Calendar URL']               || '',
    isActive:                       (f['Client Current Status'] === 'Active' || f['Client Current Status'] === 'Trial'),
    manualPriorityBoost:            Number(f['Priority Boost'])     || 0,
    notes:                          '',
  };
}

/** Fetch all advisors from Airtable. */
async function readAdvisors() {
  const res = await fetch(BASE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Airtable read failed: ${res.status}`);
  const data = await res.json();
  return data.records.map(toAdvisor);
}

/** Find a single advisor by Airtable record ID. */
async function getAdvisorById(id) {
  const res = await fetch(`${BASE_URL}/${id}`, { headers: HEADERS });
  if (!res.ok) return null;
  return toAdvisor(await res.json());
}

/** Create a new advisor record in Airtable. */
async function createAdvisor(data) {
  const fields = {
    'Name':                     data.name,
    '🟠Calendar URL':             data.calendarUrl               || '',
    '🟠States':                   (data.licensedStates || []).join(', '),
    '🟠Number of Appointments':   String(data.targetAppointmentsPerMonth || 10),
    '🟠Appointments This Month':  0,
    '🟠Appointments This Week':   0,
    'Client Current Status':      data.isActive !== false ? 'Active' : 'Paused',
    '🟠Is Default':               false,
    '🟠Priority Boost':           Number(data.manualPriorityBoost) || 0,
  };

  const res = await fetch(BASE_URL, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create failed: ${res.status}`);
  return toAdvisor(await res.json());
}

/** Merge updates into an advisor record. Returns updated advisor or null. */
async function updateAdvisor(id, updates) {
  const fields = {};

  if (updates.name                           !== undefined) fields['Name']                    = updates.name;
  if (updates.calendarUrl                    !== undefined) fields['🟠Calendar URL']            = updates.calendarUrl;
  if (updates.licensedStates                 !== undefined) fields['🟠States']                  = updates.licensedStates.join(', ');
  if (updates.targetAppointmentsPerMonth     !== undefined) fields['🟠Number of Appointments']  = String(updates.targetAppointmentsPerMonth);
  if (updates.appointmentsDeliveredThisMonth !== undefined) fields['🟠Appointments This Month'] = updates.appointmentsDeliveredThisMonth;
  if (updates.appointmentsDeliveredThisWeek  !== undefined) fields['🟠Appointments This Week']  = updates.appointmentsDeliveredThisWeek;
  if (updates.isActive                       !== undefined) fields['Client Current Status']     = updates.isActive ? 'Active' : 'Paused';
  if (updates.manualPriorityBoost            !== undefined) fields['🟠Priority Boost']          = updates.manualPriorityBoost;

  const res = await fetch(`${BASE_URL}/${id}`, {
    method:  'PATCH',
    headers: HEADERS,
    body:    JSON.stringify({ fields }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable update failed: ${res.status}`);
  return toAdvisor(await res.json());
}

/** Delete an advisor record. Returns true if deleted, false if not found. */
async function deleteAdvisor(id) {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method:  'DELETE',
    headers: HEADERS,
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Airtable delete failed: ${res.status}`);
  return true;
}

module.exports = { readAdvisors, getAdvisorById, createAdvisor, updateAdvisor, deleteAdvisor };
