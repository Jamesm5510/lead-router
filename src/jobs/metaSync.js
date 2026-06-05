/**
 * metaSync.js — Meta Ads → Airtable Ad Creative sync
 *
 * Fetches all ACTIVE ads from Meta Ads Manager and creates a new row in the
 * Airtable Ad Creative table for any ad that doesn't already have a row
 * created within the last 7 days. Same ad running in a new week = new row.
 *
 * Fields auto-populated on create:
 *   Ad Creative        — Meta ad name
 *   Ad ID              — Meta ad ID
 *   Ad Creative Status — "Testing"
 *   Optimization Event — mapped from adset optimization_goal + conversion event
 *   Creative Notes     — Campaign name + Ad Set name
 *
 * Fields you still fill in manually after the row appears:
 *   Audience Type  — Cold / Warm (Meta doesn't expose this)
 *   Webinar Date   — set each week
 *   Spend          — entered manually
 *
 * Required env vars:
 *   META_ACCESS_TOKEN   — long-lived user token or System User token
 *   META_AD_ACCOUNT_ID  — ad account ID (with or without "act_" prefix)
 *   AIRTABLE_TOKEN      — already set
 *   AIRTABLE_BASE_ID    — already set
 *
 * ⚠️  Long-lived user tokens expire in ~60 days. For a permanent setup,
 *     generate a System User token in Meta Business Manager — it never expires.
 *     Meta Business Manager → Users → System Users → Generate token.
 */

const META_API_VERSION  = 'v19.0';
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID || 'appHJlW9fAp3BzPfg';
const AD_CREATIVE_TABLE = 'Ad%20Creative';

// ── Map Meta optimization goal + conversion event → Airtable singleSelect ─────
function mapOptimizationEvent(adset) {
  if (!adset) return null;
  const goal        = adset.optimization_goal;
  const customEvent = adset.promoted_object?.custom_event_type;

  if (goal === 'OFFSITE_CONVERSIONS') {
    if (customEvent === 'COMPLETE_REGISTRATION') return 'Complete Registration';
    if (customEvent === 'SUBMIT_APPLICATION')    return 'Submit Application';
    return customEvent || 'Offsite Conversions';
  }
  if (goal === 'LEAD_GENERATION') return 'Lead Generation';
  return null; // REACH, LINK_CLICKS, etc. — leave field blank
}

// ── Fetch with a timeout ──────────────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Fetch all ACTIVE ads from Meta (handles pagination) ───────────────────────
async function fetchActiveAds() {
  const token     = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !accountId) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set');
  }

  const actId     = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const fields    = 'id,name,effective_status,adset{name,optimization_goal,promoted_object},campaign{name}';
  const filtering = JSON.stringify([
    { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
  ]);

  let ads = [];
  let url = `https://graph.facebook.com/${META_API_VERSION}/${actId}/ads`
          + `?fields=${encodeURIComponent(fields)}`
          + `&filtering=${encodeURIComponent(filtering)}`
          + `&limit=100`
          + `&access_token=${token}`;

  while (url) {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta Ads API ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(`Meta API error: ${data.error.message} (code ${data.error.code})`);
    }
    ads = ads.concat(data.data || []);
    url = data.paging?.next ?? null;
  }

  return ads;
}

// ── Fetch Ad IDs that already have a row created in the last 7 days ───────────
// Same ad running in a new week will NOT be in this set → gets a fresh row.
async function fetchRecentAdIds() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const token        = process.env.AIRTABLE_TOKEN;
  const baseUrl      = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AD_CREATIVE_TABLE}`;
  const headers      = { Authorization: `Bearer ${token}` };

  const recentAdIds = new Set();
  let   offset      = null;

  do {
    const url = `${baseUrl}?fields%5B%5D=Ad+ID${offset ? `&offset=${offset}` : ''}`;
    const res  = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Airtable read failed: ${res.status}`);
    const data = await res.json();

    for (const record of data.records) {
      const id          = record.fields['Ad ID'];
      const createdTime = new Date(record.createdTime);
      if (id && createdTime > sevenDaysAgo) {
        recentAdIds.add(String(id).trim());
      }
    }
    offset = data.offset ?? null;
  } while (offset);

  return recentAdIds;
}

// ── Create a single Ad Creative row in Airtable ───────────────────────────────
async function createAdCreativeRow(ad) {
  const token   = process.env.AIRTABLE_TOKEN;
  const url     = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AD_CREATIVE_TABLE}`;
  const headers = {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const optimizationEvent = mapOptimizationEvent(ad.adset);
  const campaignName      = ad.campaign?.name || '';
  const adsetName         = ad.adset?.name    || '';

  const notes = [
    campaignName && `Campaign: ${campaignName}`,
    adsetName    && `Ad Set: ${adsetName}`,
  ].filter(Boolean).join('\n');

  const fields = {
    'Ad Creative':        ad.name,
    'Ad ID':              ad.id,
    'Ad Creative Status': 'Testing',
    ...(notes             && { 'Creative Notes':     notes }),
    ...(optimizationEvent && { 'Optimization Event': optimizationEvent }),
  };

  const res = await fetch(url, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable create failed ${res.status}: ${err}`);
  }

  return res.json();
}

// ── Main sync ─────────────────────────────────────────────────────────────────
async function syncMetaAdsToAirtable() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    console.warn('[meta-sync] META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set — skipping');
    return { skipped: true, created: 0, errors: [] };
  }

  console.log('[meta-sync] Starting sync...');

  const [activeAds, recentAdIds] = await Promise.all([
    fetchActiveAds(),
    fetchRecentAdIds(),
  ]);

  const newAds = activeAds.filter(ad => !recentAdIds.has(String(ad.id).trim()));

  console.log(
    `[meta-sync] ${activeAds.length} active in Meta | ` +
    `${recentAdIds.size} already have rows this week | ` +
    `${newAds.length} to create`
  );

  const results = { created: 0, alreadyExist: activeAds.length - newAds.length, errors: [] };

  for (const ad of newAds) {
    try {
      await createAdCreativeRow(ad);
      results.created++;
      console.log(`[meta-sync] ✓ ${ad.name} (${ad.id})`);
    } catch (err) {
      results.errors.push({ adId: ad.id, adName: ad.name, error: err.message });
      console.error(`[meta-sync] ✗ ${ad.name} (${ad.id}) — ${err.message}`);
    }
  }

  console.log(
    `[meta-sync] Done — created: ${results.created}, ` +
    `already existed: ${results.alreadyExist}, ` +
    `errors: ${results.errors.length}`
  );
  return results;
}

module.exports = { syncMetaAdsToAirtable };
