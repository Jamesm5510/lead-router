/**
 * metaSpendSync.js — Meta Ads spend → Airtable Ad Creative sync
 *
 * Calculates ad spend for the current webinar cycle (last Tuesday 2PM →
 * this Tuesday 2PM) and writes it to the Spend field on each matching
 * Airtable Ad Creative row.
 *
 * Cycle breakdown:
 *   Last Tuesday   × (10/24)  — afternoon only, 2PM–midnight
 *   Wednesday      × 1.0      — full day
 *   Thursday       × 1.0      — full day
 *   Friday         × 1.0      — full day
 *   Saturday       × 1.0      — full day
 *   Sunday         × 1.0      — full day
 *   Monday         × 1.0      — full day
 *   This Tuesday   × 1.0      — Meta "today" at 2PM = morning spend already
 *
 * Note: Wednesday was missing from the previous manual SOP.
 *
 * Fields written to Airtable:
 *   Spend                — total cycle spend (currency)
 *   Tuesday Partial Spend — last Tuesday afternoon portion only (currency)
 *
 * Required env vars (all already set):
 *   META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, AIRTABLE_TOKEN, AIRTABLE_BASE_ID
 */

const META_API_VERSION  = 'v19.0';
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID || 'appHJlW9fAp3BzPfg';
const AD_CREATIVE_TABLE = 'Ad%20Creative';

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Returns last Tuesday's date. If today is Tuesday, returns 7 days ago.
function getLastTuesdayDate() {
  const now        = new Date();
  const dayOfWeek  = now.getDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const daysBack   = dayOfWeek === 2 ? 7 : (dayOfWeek + 5) % 7;
  const lastTue    = new Date(now);
  lastTue.setDate(now.getDate() - daysBack);
  return lastTue;
}

// Returns an array of YYYY-MM-DD strings from startDate to endDate (inclusive)
function dateRange(startDate, endDate) {
  const dates = [];
  const cur   = new Date(startDate);
  const end   = new Date(endDate);
  while (cur <= end) {
    dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── Meta Insights API ─────────────────────────────────────────────────────────

// Fetch daily spend for a single ad over a date range.
// Returns a map of { 'YYYY-MM-DD': spendFloat }
async function getAdDailySpend(adId, since, until) {
  const token      = process.env.META_ACCESS_TOKEN;
  const timeRange  = JSON.stringify({ since, until });

  let url = `https://graph.facebook.com/${META_API_VERSION}/${adId}/insights`
          + `?fields=spend,date_start`
          + `&time_range=${encodeURIComponent(timeRange)}`
          + `&time_increment=1`
          + `&access_token=${token}`;

  const spendByDate = {};

  while (url) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta Insights API ${res.status} for ad ${adId}: ${body}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`Meta API error for ad ${adId}: ${data.error.message}`);
    }

    for (const row of data.data || []) {
      spendByDate[row.date_start] = parseFloat(row.spend || 0);
    }

    url = data.paging?.next ?? null;
  }

  return spendByDate;
}

// Fetch daily spend for multiple ads with max concurrency to avoid rate limits
async function getAllAdsDailySpend(adIds, since, until, concurrency = 5) {
  const results = {};
  const queue   = [...adIds];

  async function worker() {
    while (queue.length > 0) {
      const adId = queue.shift();
      try {
        results[adId] = await getAdDailySpend(adId, since, until);
      } catch (err) {
        console.error(`[spend-sync] Failed to get spend for ad ${adId}: ${err.message}`);
        results[adId] = {};
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Airtable helpers ──────────────────────────────────────────────────────────

// Fetch current week's Ad Creative rows (created in last 8 days, has an Ad ID)
async function fetchCurrentWeekRows() {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const token        = process.env.AIRTABLE_TOKEN;
  const baseUrl      = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AD_CREATIVE_TABLE}`;
  const headers      = { Authorization: `Bearer ${token}` };

  const rows   = [];
  let   offset = null;

  do {
    const url = `${baseUrl}?fields%5B%5D=Ad+ID&fields%5B%5D=Ad+Creative${offset ? `&offset=${offset}` : ''}`;
    const res  = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Airtable read failed: ${res.status}`);
    const data = await res.json();

    for (const record of data.records) {
      const adId = record.fields['Ad ID'];
      if (adId && new Date(record.createdTime) > eightDaysAgo) {
        rows.push({ recordId: record.id, adId: String(adId).trim(), name: record.fields['Ad Creative'] || adId });
      }
    }
    offset = data.offset ?? null;
  } while (offset);

  return rows;
}

// Write Spend and Tuesday Partial Spend to an Airtable Ad Creative record
async function updateSpend(recordId, totalSpend, tuesdayPartialSpend) {
  const token   = process.env.AIRTABLE_TOKEN;
  const url     = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AD_CREATIVE_TABLE}/${recordId}`;
  const headers = {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method:  'PATCH',
    headers,
    body:    JSON.stringify({
      fields: {
        'Spend':                 Math.round(totalSpend * 100) / 100,
        'Tuesday Partial Spend': Math.round(tuesdayPartialSpend * 100) / 100,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable update failed ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Main sync ─────────────────────────────────────────────────────────────────

async function syncMetaSpendToAirtable() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    console.warn('[spend-sync] META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set — skipping');
    return { skipped: true };
  }

  console.log('[spend-sync] Starting spend sync...');

  // 1. Identify the date range
  const lastTuesday  = getLastTuesdayDate();
  const today        = new Date();
  const since        = formatDate(lastTuesday);
  const until        = formatDate(today);
  const allDates     = dateRange(lastTuesday, today);

  console.log(`[spend-sync] Cycle: ${since} → ${until} (${allDates.length} days)`);

  // 2. Get current week's Ad Creative rows
  const rows = await fetchCurrentWeekRows();
  if (rows.length === 0) {
    console.log('[spend-sync] No current week rows found in Airtable');
    return { updated: 0, errors: [] };
  }

  const adIds = [...new Set(rows.map(r => r.adId))];
  console.log(`[spend-sync] Found ${rows.length} Airtable rows across ${adIds.length} unique ad IDs`);

  // 3. Fetch daily spend from Meta for all ad IDs
  const spendData = await getAllAdsDailySpend(adIds, since, until);

  // 4. Calculate cycle spend per ad ID
  const cycleSpendByAdId = {};
  const tuesdayPartialByAdId = {};

  for (const adId of adIds) {
    const dailySpend = spendData[adId] || {};
    let total            = 0;
    let tuesdayPartial   = 0;

    for (const date of allDates) {
      const daySpend = dailySpend[date] || 0;

      if (date === since) {
        // Last Tuesday — only count spend from 2PM onward (10 of 24 hours)
        const afternoonPortion = daySpend * (10 / 24);
        total          += afternoonPortion;
        tuesdayPartial  = afternoonPortion;
      } else if (date === until) {
        // This Tuesday — Meta "today" at 2PM = morning spend already
        total += daySpend;
      } else {
        // Full day (Wednesday through Monday)
        total += daySpend;
      }
    }

    cycleSpendByAdId[adId]    = total;
    tuesdayPartialByAdId[adId] = tuesdayPartial;
  }

  // 5. Write to Airtable
  const results = { updated: 0, errors: [] };

  for (const row of rows) {
    const total    = cycleSpendByAdId[row.adId]     ?? 0;
    const tuePart  = tuesdayPartialByAdId[row.adId] ?? 0;

    try {
      await updateSpend(row.recordId, total, tuePart);
      results.updated++;
      console.log(`[spend-sync] ✓ ${row.name} — $${total.toFixed(2)} (tue partial: $${tuePart.toFixed(2)})`);
    } catch (err) {
      results.errors.push({ adId: row.adId, name: row.name, error: err.message });
      console.error(`[spend-sync] ✗ ${row.name} — ${err.message}`);
    }
  }

  console.log(`[spend-sync] Done — updated: ${results.updated}, errors: ${results.errors.length}`);
  return results;
}

module.exports = { syncMetaSpendToAirtable };
