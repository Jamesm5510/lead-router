/**
 * zoom.js — Zoom webhook handler
 *
 * POST /zoom-webhook
 *   1. Receives recording.transcript_completed event from Zoom
 *   2. Downloads the VTT transcript
 *   3. Sends transcript to OpenAI to extract structured fields
 *   4. Updates the matching Airtable Appointments record
 */

const express = require('express');
const router  = express.Router();

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const AIRTABLE_TOKEN  = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE   = process.env.AIRTABLE_BASE;
const AIRTABLE_TABLE  = 'Appointments';

// ── Download the VTT transcript from Zoom ────────────────────────────────────
async function downloadTranscript(downloadUrl, downloadToken) {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${downloadToken}` },
  });
  if (!res.ok) throw new Error(`Transcript download failed: ${res.status}`);
  return res.text();
}

// ── Extract structured fields via OpenAI ─────────────────────────────────────
async function extractFields(transcriptText) {
  const prompt = `You are analyzing a long-term care insurance sales call transcript. Extract the following fields as a JSON object. If a field cannot be determined, use null.

Fields to extract:
- ai_call_summary: A 2-4 sentence summary of the call
- primary_concern: The prospect's main concern or reason for interest
- lead_quality_reason: Why you gave the lead quality score you did
- next_step_agreed_on: What the prospect and advisor agreed to do next
- main_objection: The prospect's primary objection if any
- what_triggered_interest: The real emotional trigger that made them reach out (not just "watched the webinar")
- approximate_investible_assets: Estimated investible assets as a string (e.g. "$500,000")
- approximate_monthly_income: Estimated monthly income as a string (e.g. "$4,000/month")
- income_sources: List of income sources mentioned (e.g. "Social Security, pension")
- health_conditions: Any health conditions mentioned
- age: The prospect's age as a number
- lead_quality_score: A score from 1-10 rating the quality of this lead
- product_type_discussed: The product or coverage type discussed
- medications: Any medications mentioned
- has_dependents: Boolean - whether they have children or dependents
- marital_status: The prospect's marital status

Transcript:
${transcriptText}

Respond with only valid JSON, no explanation.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Find Airtable record by meeting topic or host email ───────────────────────
async function findAppointmentRecord(meetingId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${encodeURIComponent(`{Zoom Meeting ID} = "${meetingId}"`)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable lookup failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] ?? null;
}

// ── Update Airtable record ────────────────────────────────────────────────────
async function updateAirtableRecord(recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    },
    body: JSON.stringify({
      fields: {
        'AI Call Summary':            fields.ai_call_summary,
        'Primary Concern':            fields.primary_concern,
        'Lead Quality Reason':        fields.lead_quality_reason,
        'Next Step Agreed On':        fields.next_step_agreed_on,
        'Main Objection':             fields.main_objection,
        'What Triggered Interest':    fields.what_triggered_interest,
        'Approximate Investible Assets': fields.approximate_investible_assets,
        'Approximate Monthly Income': fields.approximate_monthly_income,
        'Income Sources':             fields.income_sources,
        'Health Conditions':          fields.health_conditions,
        'Age':                        fields.age,
        'Lead Quality Score':         fields.lead_quality_score,
        'Product Type Discussed':     fields.product_type_discussed,
        'Medications':                fields.medications,
        'Has Dependents':             fields.has_dependents,
        'Marital Status':             fields.marital_status,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable update failed: ${res.status} — ${err}`);
  }
  return res.json();
}

// ── Webhook endpoint ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const event = req.body;

  // Zoom sends a validation request when you first set up the webhook
  if (event.event === 'endpoint.url_validation') {
    const crypto = require('crypto');
    const token  = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    const hash   = crypto.createHmac('sha256', token).update(event.payload.plainToken).digest('hex');
    return res.json({ plainToken: event.payload.plainToken, encryptedToken: hash });
  }

  if (event.event !== 'recording.transcript_completed') {
    return res.json({ status: 'ignored' });
  }

  // Acknowledge immediately so Zoom doesn't retry
  res.json({ status: 'received' });

  try {
    const obj           = event.payload.object;
    const downloadToken = event.download_token;
    const meetingId     = obj.id?.toString();
    const transcriptFile = obj.recording_files?.find(f => f.file_type === 'TRANSCRIPT');

    if (!transcriptFile) {
      console.log('[zoom] No transcript file in payload');
      return;
    }

    console.log(`[zoom] Processing transcript for meeting ${meetingId}`);

    const transcriptText = await downloadTranscript(transcriptFile.download_url, downloadToken);
    console.log(`[zoom] Transcript downloaded (${transcriptText.length} chars)`);

    const fields = await extractFields(transcriptText);
    console.log('[zoom] Fields extracted:', JSON.stringify(fields, null, 2));

    const record = await findAppointmentRecord(meetingId);
    if (!record) {
      console.log(`[zoom] No Airtable record found for meeting ID ${meetingId}`);
      return;
    }

    await updateAirtableRecord(record.id, fields);
    console.log(`[zoom] Airtable record ${record.id} updated successfully`);
  } catch (err) {
    console.error('[zoom] Error processing webhook:', err.message);
  }
});

module.exports = router;
