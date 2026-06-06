/**
 * process-transcript.js — Manually process a backlog Zoom transcript
 *
 * Usage:
 *   node process-transcript.js                        — paste mode
 *   node process-transcript.js transcript.txt         — single file
 *   node process-transcript.js "C:\path\to\folder"   — entire folder of .txt files
 *
 * Extraction logic (prompt, field mapping, lead score) lives in:
 *   src/jobs/transcriptProcessor.js
 */

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const { extractFields, buildAirtableFields } = require('./src/jobs/transcriptProcessor');

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE;
const AIRTABLE_TABLE = 'Appointments';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function getInputFiles() {
  const args = process.argv.slice(2).map(a => a.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  if (args.length === 0) return null; // paste mode

  const files = [];
  for (const arg of args) {
    if (!fs.existsSync(arg)) { console.warn(`[Warn] Path not found, skipping: ${arg}`); continue; }
    const stat = fs.statSync(arg);
    if (stat.isDirectory()) {
      const dirFiles = fs.readdirSync(arg)
        .filter(f => f.toLowerCase().endsWith('.txt'))
        .map(f => path.join(arg, f));
      files.push(...dirFiles);
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) { console.error('No valid .txt files found.'); process.exit(1); }
  return files;
}

async function readTranscriptFromPaste() {
  console.log('\nPaste the transcript below. When done, type END on its own line and press Enter:\n');
  const rl    = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  return new Promise(resolve => {
    rl.on('line', line => {
      if (line.trim().toUpperCase() === 'END') { rl.close(); resolve(lines.join('\n')); }
      else lines.push(line);
    });
  });
}

async function searchByName(name) {
  const formula = encodeURIComponent(`SEARCH(LOWER("${name}"), LOWER({Name})) > 0`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${formula}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable search failed: ${res.status}`);
  const data = await res.json();
  return data.records || [];
}

async function updateRecord(recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    body: JSON.stringify({
      fields: buildAirtableFields(fields, { 'Needs Manual Review?': false }),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable update failed: ${res.status} — ${err}`);
  }
  return res.json();
}

async function processOne(transcriptText, label) {
  console.log(`\n${'─'.repeat(50)}`);
  if (label) console.log(`[File] ${label}`);

  const fields = await extractFields(transcriptText);
  if (!fields) {
    console.log('[Error] OpenAI returned no data — transcript may be empty or too short. Skipping.');
    return;
  }
  const prospectName = fields.prospect_name;

  console.log(`[Extracted] Prospect: ${prospectName || '(not found)'}`);
  console.log(`[Extracted] Quality:  ${fields.lead_quality_score}/10`);
  console.log(`[Extracted] Summary:  ${fields.ai_call_summary}`);

  let recordId = null;

  if (prospectName) {
    console.log(`\n[Airtable] Searching for "${prospectName}"...`);
    const records = await searchByName(prospectName);

    if (records.length === 1) {
      const rec = records[0];
      console.log(`Found 1 match: "${rec.fields['Name'] || '(no name)'}" (ID: ${rec.id})`);
      const confirm = await prompt('Update this record? (y/n): ');
      if (confirm.toLowerCase() === 'y') recordId = rec.id;

    } else if (records.length > 1) {
      console.log(`Found ${records.length} matches:`);
      records.forEach((r, i) => {
        const f = r.fields;
        console.log(`  ${i + 1}. ${f['Name'] || '(no name)'} — ${f['Appointment Date'] || f['Date'] || 'no date'} (ID: ${r.id})`);
      });
      const pick = await prompt('Enter the number to select, or 0 to enter ID manually: ');
      const idx = parseInt(pick);
      if (idx > 0 && idx <= records.length) recordId = records[idx - 1].id;

    } else {
      console.log(`No Airtable record found for "${prospectName}".`);
    }
  }

  if (!recordId) {
    const manualId = await prompt('Paste the Airtable record ID to update (or press Enter to skip): ');
    if (manualId) recordId = manualId.trim();
  }

  if (!recordId) {
    console.log('Skipped.');
    return;
  }

  await updateRecord(recordId, fields);
  console.log('✓ Updated successfully.');
}

async function main() {
  console.log('=== Manual Transcript Processor ===');

  const files = getInputFiles();

  if (!files) {
    const transcript = await readTranscriptFromPaste();
    if (!transcript.trim()) { console.log('No transcript provided.'); return; }
    await processOne(transcript, null);
    return;
  }

  console.log(`\nFound ${files.length} file(s) to process.\n`);
  let done = 0, skipped = 0;

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) { console.log(`[Skip] ${path.basename(filePath)} is empty`); skipped++; continue; }
    try {
      await processOne(text, path.basename(filePath));
      done++;
    } catch (err) {
      console.error(`[Error] ${path.basename(filePath)}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Done. ${done} updated, ${skipped} skipped.`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
