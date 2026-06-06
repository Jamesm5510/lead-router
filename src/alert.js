/**
 * alert.js — Lightweight email alerting via Resend API
 *
 * Requires two env vars:
 *   RESEND_API_KEY  — API key from resend.com (free tier: 3,000 emails/month)
 *   ALERT_EMAIL     — destination address (e.g. james@formidian.com)
 *
 * If either var is missing, sendAlert() logs a warning and returns — nothing breaks.
 */

async function sendAlert(subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.ALERT_EMAIL;

  if (!apiKey || !to) {
    console.warn(`[alert] RESEND_API_KEY or ALERT_EMAIL not set — skipping alert: ${subject}`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from:    'Lead Router <alerts@lead-router.formidian.com>',
        to:      [to],
        subject,
        text:    body,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[alert] Failed to send alert "${subject}": ${res.status} — ${err}`);
    } else {
      console.log(`[alert] Sent: ${subject}`);
    }
  } catch (err) {
    console.error(`[alert] Error sending alert "${subject}": ${err.message}`);
  }
}

module.exports = { sendAlert };
