/**
 * server.js — Lead Router
 *
 * Routes:
 *   POST /route-lead              → public: assign a lead to an advisor
 *   GET  /advisors                → admin: list all advisors
 *   POST /advisors                → admin: create advisor
 *   POST /advisors/update         → admin: update advisor fields
 *   POST /advisors/set-counts     → admin: set appointment counts
 *   POST /advisors/toggle-active  → admin: pause / unpause
 *   DELETE /advisors/:id          → admin: delete advisor
 *   GET  /admin                   → admin dashboard UI
 *   GET  /health                  → liveness check
 *
 * All /advisors routes require the X-Admin-Key header.
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────
// /route-lead is called from external pages (GHL) so it needs CORS open.
// /advisors is admin-only and stays locked down by the X-Admin-Key header.
app.use('/route-lead', cors(), require('./src/routes/leads'));
app.use('/advisors',   require('./src/routes/advisors'));

// ── Admin UI — clean URL ───────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lead router  →  http://localhost:${PORT}`);
  console.log(`Admin UI     →  http://localhost:${PORT}/admin`);
  console.log(`GHL embed    →  http://localhost:${PORT}/ghl-embed.js`);
});
