/**
 * metricsSync.js — Weekly funnel metrics → Airtable Weekly Metrics table
 *
 * Calculates aggregate funnel metrics for the current webinar cycle and
 * writes (or updates) one row in the Weekly Metrics table.
 *
 * Called automatically at the end of the Tuesday spend sync.
 * Can also be triggered manually via POST /admin/sync-metrics.
 *
 * Cycle window (same as spend sync):
 *   Last Tuesday → this Tuesday (7-day window)
 *
 * Metrics written:
 *   Total Spend       — sum of Spend across all Ad Creative rows for this webinar date
 *   Registrations     — Webinar Attendance records for this webinar date (any status)
 *   Shows             — Webinar Attendance records where Status = "Attended"
 *   Show Rate         — Shows / Registrations
 *   Calls Booked      — Appointments created in the 7-day cycle window
 *   Booking Rate      — Calls Booked / Shows
 *   Calls Showed      — Appointments in window with a "completed" stage
 *   Qualified Calls   — Appointments in window with a "qualified" stage
 *   Qualified Rate    — Qualified Calls / Calls Booked
 *   Cost Per *        — Total Spend / each count above
 */

const AIRTABLE_TOKEN        = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE         = process.env.AIRTABLE_BASE_ID || 'appHJlW9fAp3BzPfg';
const WEEKLY_METRICS_TABLE  = 'Weekly%20Metrics';
const AD_CREATIVE_TABLE     = 'Ad%20Creative';
const WEBINAR_ATTENDANCE_TABLE = 'Webinar%20Attendance';
const APPOINTMENTS_TABLE    = 'Appointments';

// Prospect stages that count as "showed up on the disco call"
const SHOWED_STAGES = [
  '1st Call Completed - Qualified',
  '1st Call Completed- Not Qualified',  // note: inconsistent spacing in GHL
  '2nd Call Booked',
  '2nd Call Completed',
  'App Submitted',
];

// Prospect stages that count as "qualified"
const QUALIFIED_STAGES = [
  '1st Call Completed - Qualified',
  '2nd Call Booked',
  '2nd Call Completed',
  'App Submitted',
];

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Returns last Tuesday's date. If today is Tuesday, returns 7 days ago.
function getLastTuesdayDate() {
  const now       = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const daysBack  = dayOfWeek === 2 ? 7 : (dayOfWeek + 5) % 7;
  const lastTue   = new Date(now);
  lastTue.setDate(now.getDate() - daysBack);
  return lastTue;
}

// ── Airtable helpers ──────────────────────────────────────────────────────────

async function airtableFetch(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable fetch failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Fetch all pages from an Airtable list endpoint
async function airtableFetchAll(path) {
  const records = [];
  let url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${path}`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Airtable fetch failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    records.push(...(data.records || []));
    url = data.offset
      ? `https://api.airtable.com/v0/${AIRTABLE_BASE}/${path}${path.includes('?') ? '&' : '?'}offset=${data.offset}`
      : null;
  }
  return records;
}

async function airtableCreate(table, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function airtableUpdate(table, recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable update failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// ── Metric calculations ───────────────────────────────────────────────────────

async function getTotalSpend(webinarDateStr) {
  const formula = encodeURIComponent(`{Webinar Date} = "${webinarDateStr}"`);
  const records = await airtableFetchAll(`${AD_CREATIVE_TABLE}?filterByFormula=${formula}&fields[]=Spend`);
  return records.reduce((sum, r) => sum + (r.fields['Spend'] || 0), 0);
}

async function getWebinarAttendance(webinarDateStr) {
  const formula = encodeURIComponent(`{Webinar Date} = "${webinarDateStr}"`);
  const records = await airtableFetchAll(`${WEBINAR_ATTENDANCE_TABLE}?filterByFormula=${formula}&fields[]=Status`);
  const registrations = records.length;
  const shows = records.filter(r => r.fields['Status'] === 'Attended').length;
  return { registrations, shows };
}

async function getAppointmentMetrics(cycleStart, cycleEnd) {
  // Count appointments created within the cycle window
  const formula = encodeURIComponent(
    `AND(IS_AFTER({Created Date}, "${cycleStart}"), IS_BEFORE({Created Date}, "${cycleEnd}"))`
  );
  const records = await airtableFetchAll(
    `${APPOINTMENTS_TABLE}?filterByFormula=${formula}&fields[]=Prospect%20Stage`
  );

  const callsBooked  = records.length;
  const callsShowed  = records.filter(r => SHOWED_STAGES.includes(r.fields['Prospect Stage'])).length;
  const qualifiedCalls = records.filter(r => QUALIFIED_STAGES.includes(r.fields['Prospect Stage'])).length;

  return { callsBooked, callsShowed, qualifiedCalls };
}

// ── Find existing Weekly Metrics row for this date (for upsert) ───────────────

async function findExistingRow(webinarDateStr) {
  const formula = encodeURIComponent(`{Webinar Date} = "${webinarDateStr}"`);
  const data = await airtableFetch(`${WEEKLY_METRICS_TABLE}?filterByFormula=${formula}&maxRecords=1`);
  return data.records?.[0] ?? null;
}

// ── Safe division ─────────────────────────────────────────────────────────────

function safeDivide(numerator, denominator) {
  if (!denominator || denominator === 0) return null;
  return numerator / denominator;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function syncWeeklyMetrics() {
  const lastTuesday = getLastTuesdayDate();
  const today       = new Date();

  const cycleStartStr   = formatDate(lastTuesday);
  const cycleEndStr     = formatDate(today);
  const webinarDateStr  = cycleStartStr; // Ad Creative and Webinar Attendance use last Tuesday

  console.log(`[metrics-sync] Cycle: ${cycleStartStr} → ${cycleEndStr}`);

  // ── Gather raw counts ────────────────────────────────────────────────────────
  const [spend, attendance, appts] = await Promise.all([
    getTotalSpend(webinarDateStr),
    getWebinarAttendance(webinarDateStr),
    getAppointmentMetrics(cycleStartStr, cycleEndStr),
  ]);

  const { registrations, shows }                     = attendance;
  const { callsBooked, callsShowed, qualifiedCalls } = appts;

  console.log(`[metrics-sync] Spend: $${spend.toFixed(2)} | Registrations: ${registrations} | Shows: ${shows} | Booked: ${callsBooked} | Showed: ${callsShowed} | Qualified: ${qualifiedCalls}`);

  // ── Calculate derived metrics ────────────────────────────────────────────────
  const fields = {
    'Webinar Date':          cycleStartStr,
    'Total Spend':           spend,
    'Registrations':         registrations,
    'Shows':                 shows,
    'Show Rate':             safeDivide(shows, registrations),
    'Calls Booked':          callsBooked,
    'Booking Rate':          safeDivide(callsBooked, shows),
    'Calls Showed':          callsShowed,
    'Qualified Calls':       qualifiedCalls,
    'Qualified Rate':        safeDivide(qualifiedCalls, callsBooked),
    'Cost Per Registration': safeDivide(spend, registrations),
    'Cost Per Show':         safeDivide(spend, shows),
    'Cost Per Call Booked':  safeDivide(spend, callsBooked),
    'Cost Per Qualified':    safeDivide(spend, qualifiedCalls),
  };

  // Remove null values — Airtable doesn't accept null for number fields
  Object.keys(fields).forEach(k => { if (fields[k] === null) delete fields[k]; });

  // ── Upsert ───────────────────────────────────────────────────────────────────
  const existing = await findExistingRow(cycleStartStr);

  if (existing) {
    await airtableUpdate(WEEKLY_METRICS_TABLE, existing.id, fields);
    console.log(`[metrics-sync] Updated existing row for ${cycleStartStr} (${existing.id})`);
  } else {
    const created = await airtableCreate(WEEKLY_METRICS_TABLE, fields);
    console.log(`[metrics-sync] Created new row for ${cycleStartStr} (${created.id})`);
  }

  return { webinarDate: cycleStartStr, spend, registrations, shows, callsBooked, callsShowed, qualifiedCalls };
}

module.exports = { syncWeeklyMetrics };
