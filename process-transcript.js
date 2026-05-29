/**
 * process-transcript.js — Manually process a backlog Zoom transcript
 *
 * Usage:
 *   node process-transcript.js                        — paste mode
 *   node process-transcript.js transcript.txt         — single file
 *   node process-transcript.js "C:\path\to\folder"   — entire folder of .txt files
 */

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const OPENAI_KEY     = process.env.OPENAI_API_KEY;
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

async function extractFields(transcriptText) {
  console.log('\n[OpenAI] Extracting fields...');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `You are analyzing a long-term care insurance sales call transcript. Extract the following fields as a JSON object. If a field cannot be determined, use null.

Fields to extract:
- prospect_name: The full name of the prospect/client on the call
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
- has_dependents: Must be exactly one of: "Yes", "No", or "Not Mentioned"
- marital_status: Must be exactly one of: "Married", "Single", "Divorced", "Widowed", or "Not Mentioned"
- investable_assets: The prospect's total investable/repositionable assets mapped to EXACTLY one of these eight strings (match character-for-character, including the en-dash):
  "Under $100K"
  "$100K–$250K"
  "$250K–$500K"
  "$500K–$750K"
  "$750K–$1M"
  "$1M–$2M"
  "$2M+"
  "Not Mentioned/Unclear"

  RULES for investable_assets (follow strictly):
  1. ANTI-FABRICATION: If the prospect's investable assets are not explicitly stated, output "Not Mentioned/Unclear". Never estimate, infer, or default to any number — especially not $750K. When uncertain, ALWAYS choose "Not Mentioned/Unclear".
  2. DEFINITION — count ONLY liquid or repositionable assets: IRA/401k/qualified retirement accounts, brokerage/investment accounts, stocks, mutual funds, CDs, existing annuities (exchangeable), cash/savings/bank balances, and other liquid investments.
  3. EXPLICITLY EXCLUDE — never count these (if only these are present, output "Not Mentioned/Unclear"):
     - Home equity or primary residence value
     - Any other real estate or rental/investment property (illiquid)
     - Money the prospect spends or plans to spend on care
     - Care-cost figures quoted by the advisor (e.g. "$6,000/mo for in-home care")
     - Any dollar figure quoted by the ADVISOR as a product example, premium, benefit amount, benefit multiple, death benefit, or hypothetical (e.g. "if you put in $75,000 you'd get $228,000")
  4. HOUSEHOLD vs INDIVIDUAL:
     - DEFAULT to HOUSEHOLD assets when the prospect is married/partnered and their finances appear shared or jointly considered — sum both spouses' stated investable assets.
     - EXCEPTION: if the prospect explicitly states a spouse's assets are SEPARATE and not available for their care or this decision, count ONLY the assets available to the prospect and do NOT add the spouse's separate assets.
     - Single/widowed/divorced → count only the individual's investable assets.
  5. PROSPECT STATEMENTS ONLY: Only count asset figures the PROSPECT states. If the only figure available is the ADVISOR guessing or estimating the prospect's assets (and the prospect did not confirm a specific number), output "Not Mentioned/Unclear".
  6. SUMMATION: Sum all qualifying investable asset figures the prospect states across account types (IRA + stocks + cash + annuities, etc.), then select the bracket containing the total.
  7. EVIDENCE RULE: You must be able to point to a specific prospect statement establishing each asset figure. If you cannot, output "Not Mentioned/Unclear".
  8. OUTPUT: The value must be EXACTLY one of the eight strings above. Do not output a raw number or any other text.

- monthly_income: The prospect's total monthly income mapped to EXACTLY one of these seven strings (match character-for-character, including the en-dash):
  "Under $2,000/month"
  "$2,000–$3,500/month"
  "$3,500–$5,000/month"
  "$5,000–$7,500/month"
  "$7,500–$10,000/month"
  "$10,000+/month"
  "Not stated"

  RULES for monthly_income (follow strictly):
  1. ANTI-FABRICATION: If income is not explicitly stated by the PROSPECT, output "Not stated". Never estimate, infer, or default to a number. When uncertain, always choose "Not stated".
  2. DEFINITION: Income = recurring money the PROSPECT personally RECEIVES each month. Valid sources: employment/wages, Social Security, pension, rental/Airbnb income, business income, dividends/investment income, annuity payments currently being drawn.
  3. METHOD: Sum all stated income sources the prospect mentions, then select the bracket that contains the total.
  4. NEVER count any of the following as income — if only these figures are present, output "Not stated":
     - Insurance premiums or policy costs
     - Long-term care benefit amounts or any product benefit figures
     - Money the prospect spends on care (for themselves or a family member)
     - Funding budget / what they could pay into a policy (e.g. "I could put in $500/month")
     - Asset or account balances (401k, IRA, CD, annuity face values, MYGA, etc.)
     - Any dollar figure quoted by the ADVISOR about a product
     - Future or conditional income not yet being received
  5. EVIDENCE RULE: You must be able to point to a specific statement by the PROSPECT establishing the income figure. If you cannot, output "Not stated".
  6. OUTPUT: The value must be EXACTLY one of the seven strings above. Do not output a raw number or any other text.

- lead_intent: The prospect's motivation and readiness to actually move forward with purchasing long-term care coverage. Select EXACTLY one of these four strings (match character-for-character):
  "High"
  "Medium"
  "Low"
  "Unclear"

  CRITICAL ANTI-FABRICATION RULE: If the prospect's level of intent/motivation is not clearly evident from the transcript, output "Unclear". NEVER inflate intent, never default to a positive level, never guess. It is always correct to select "Unclear" when signals are mixed or absent. Do not select a level unless you can point to specific prospect statements or behaviors that support it.

  WHAT "INTENT" MEANS: Intent = the prospect's motivation and READINESS TO ACT on purchasing LTC coverage. It is about urgency and seriousness of purchase intent — NOT about how friendly, talkative, or pleasant they were. A warm, chatty prospect who is just researching is LOW intent. A reserved prospect who says "I need to get this done this month" is HIGH intent. Need ≠ intent — a person can clearly need coverage but show no readiness to act.

  LEVEL DEFINITIONS (classify based on what the PROSPECT says/does, not the advisor):
  1. "High" — Clear signals of urgency and readiness to act. E.g.: states a deadline or time pressure ("I want to get this done soon," "before my birthday," "before rates go up"); a triggering life event driving action (recent family diagnosis, just became a caregiver, spouse's health event, recently retired and planning); explicitly asks to move forward, see quotes, or schedule next steps; already taking concrete action (comparing policies, has money earmarked, ready to reposition assets); expresses strong emotional motivation and wants to act on it.
  2. "Medium" — Genuine interest but not urgent or not yet ready to commit. E.g.: engaged and asking substantive questions, but no deadline; wants to think it over, discuss with spouse/advisor, or "learn more first"; sees the need but is in information-gathering mode; open to next steps but non-committal on timing.
  3. "Low" — Minimal motivation or significant hesitation. E.g.: "just researching" / "just curious" / "not ready to do anything"; strong price resistance or doubt that overrides interest; passive throughout with no questions about moving forward; indicates this is a low priority or far-off consideration; significant skepticism about whether they need coverage at all.
  4. "Unclear" — Intent genuinely cannot be determined. The call was too short, too focused on other topics, cut off, or signals are too mixed/absent to classify. This is the DEFAULT when in doubt.

  CLASSIFICATION RULES:
  - Base the rating ONLY on the prospect's own statements and behavior, not the advisor's enthusiasm or assumptions.
  - Do NOT confuse friendliness/rapport with buying intent.
  - Do NOT confuse having a real need with intent to buy.
  - When signals conflict (interested but very price-resistant), weigh toward the more conservative rating; use "Unclear" if genuinely ambiguous.
  - If intent is not addressed at all → "Unclear", never a level.

- health_qualification: An internal triage signal indicating which product family fits the prospect's stated health. Select EXACTLY one of these five strings (match character-for-character):
  "Likely qualifiable"
  "Qualifiable with limitations"
  "Annuity-only candidate"
  "Likely not qualifiable"
  "Not discussed / Unknown"

  CRITICAL ANTI-FABRICATION RULE: If health/medical conditions were NOT meaningfully discussed in the call, output "Not discussed / Unknown". NEVER infer a health status from absence, never default to a tier, never guess. Do not select a qualification tier unless you can point to specific health statements in the transcript. When in doubt, always choose "Not discussed / Unknown".

  ONLY CLASSIFY BASED ON:
  - Conditions the PROSPECT (or the household member being insured) actually states about themselves.
  - Do NOT count: the advisor's general statements about conditions; conditions of OTHER people mentioned (e.g. a parent who had Alzheimer's — that is family history, not the prospect's condition); care-cost or product figures. Family history ≠ the prospect having the condition.

  BUCKET DEFINITIONS (conditions are illustrative, not exhaustive):
  1. "Likely qualifiable" — No concerning conditions mentioned, OR only minor/well-controlled conditions that don't affect underwriting. E.g.: health was discussed and prospect indicated good health; controlled hypertension or hyperlipidemia alone; hypothyroidism on treatment.
  2. "Qualifiable with limitations" — Manageable conditions that may affect rate class or product choice but typically do NOT knock the prospect out of underwritten products (traditional LTC / hybrid). E.g.: Type 2 non-insulin diabetes (no complications); mild/stable depression or anxiety on treatment; stable atrial fibrillation without other heart disease; mild stable sleep apnea; mild/moderate osteoarthritis; mild osteoporosis without fracture; well-controlled conditions with elevated-but-acceptable build.
  3. "Annuity-only candidate" — Conditions that would likely DECLINE for underwritten products (traditional LTC / hybrid) but could still be served by lenient asset-based / annuity products. E.g.: congestive heart failure; insulin-dependent or Type 1 diabetes; defibrillator/pacemaker history; single stroke or TIA history; chronic kidney disease/dialysis; COPD/emphysema or oxygen use; organ transplant; certain cancers in history; osteoporosis with compression fracture; significant cardiac history.
  4. "Likely not qualifiable" — Conditions severe enough that even lenient annuity/asset-based products are likely out, OR the person is effectively on-claim. E.g.: Alzheimer's / dementia / significant memory loss; Parkinson's disease; ALS; MS; Huntington's; currently needs help with ADLs (bathing, dressing, eating, toileting, transferring, continence); currently in assisted living / nursing home / receiving home care; currently using wheelchair/walker due to disability; currently taking dementia or Parkinson's medications (Aricept, Namenda, Exelon, Sinemet, carbidopa/levodopa, etc.).
  5. "Not discussed / Unknown" — Health was not meaningfully covered in the call, OR there is insufficient information to place the lead in any tier. This is the DEFAULT whenever in doubt.

  CONSERVATISM RULES:
  - Between two buckets → pick the less optimistic one.
  - Condition mentioned but severity/control is unclear → lean toward the more cautious bucket (e.g. unclear diabetes → "Qualifiable with limitations" not "Likely qualifiable"; unclear stroke severity → "Annuity-only candidate" not "Qualifiable with limitations").
  - Genuinely no health info → "Not discussed / Unknown", never a tier.

- asset_notes: A brief, factual summary of the prospect's asset and financial situation based only on what they actually stated in the call. Use short sentences or bullet-style notes. This is reference context for a human advisor preparing for a follow-up call.

  WHAT TO CAPTURE (only what the prospect or their household actually stated):
  - Specific asset holdings and amounts (e.g. "~$1M in IRA, ~$30K in stocks, two homes owned free and clear")
  - Account types (IRA/401k, Roth, brokerage, CDs, annuities, cash/savings, pensions, life insurance cash value, real estate)
  - Whether money is qualified (IRA/401k), tax-free (Roth), or non-qualified, when stated
  - Existing annuities or life insurance that could be repositioned
  - Spousal/household asset arrangements (e.g. "spouse has separate $800K, explicitly not for her care")
  - Liquidity timing or constraints (e.g. "annuities coming due over next 7-8 years", "money in a trust")
  - Income sources relevant to the financial picture (Social Security, pension, rental income)
  - Any other financial context an advisor would find useful

  RULES for asset_notes (follow strictly):
  1. ANTI-FABRICATION: Only include information the prospect (or household) actually stated. Never infer, estimate, or invent figures.
  2. EXCLUDE advisor-side figures: do NOT record the advisor's product examples, premium quotes, benefit amounts, benefit multiples, hypotheticals, or care-cost figures as if they were the prospect's assets.
  3. PROSPECT STATEMENTS, NOT ADVISOR GUESSES: if the advisor guesses the prospect's assets and the prospect doesn't confirm, note it as unconfirmed (e.g. "advisor estimated ~$700-800K, not confirmed by prospect").
  4. IF NOTHING RELEVANT WAS STATED: output null. Do not write "Not stated" or any placeholder. Null is the correct output when the prospect gave no financial information.
  5. KEEP IT FACTUAL AND CONCISE: a few sentences or short notes. No interpretation, no sales commentary — just what they have and any relevant context.

Transcript:
${transcriptText}

Respond with only valid JSON, no explanation.`,
      }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Deterministic lead score — computed from structured fields, NOT from transcript ──
function computeLeadScore(fields) {
  const age    = fields.age;
  const assets = fields.investable_assets;
  const income = fields.monthly_income;
  const health = fields.health_qualification;
  const intent = fields.lead_intent;

  const assetsGte250k = ['$250K–$500K', '$500K–$750K', '$750K–$1M', '$1M–$2M', '$2M+'].includes(assets);
  const assetsLt250k  = ['Under $100K', '$100K–$250K'].includes(assets);
  const incomeGt5k    = ['$5,000–$7,500/month', '$7,500–$10,000/month', '$10,000+/month'].includes(income);
  const okayHealth    = ['Likely qualifiable', 'Qualifiable with limitations'].includes(health);
  const badHealth     = ['Annuity-only candidate', 'Likely not qualifiable'].includes(health);

  // STEP 1 — UNCLEAR: missing hard-gate data
  if (!age || assets === 'Not Mentioned/Unclear' || health === 'Not discussed / Unknown') return 'Unclear';

  // STEP 2 — AGE GATE
  if (age < 35 || age > 80) return 'D';
  if (age >= 80 && assetsLt250k) return 'D';

  // STEP 3 — FINANCIAL GATE
  const passesFinancial = assetsGte250k || (incomeGt5k && okayHealth && age < 80);
  if (!passesFinancial) return 'D';

  // STEP 4 — BAD-HEALTH ASSET REQUIREMENT
  if (badHealth && assetsLt250k) return 'D';

  // STEP 5 — ASSIGN A / B / C
  if (health === 'Likely not qualifiable') {
    return (intent === 'High' && assetsGte250k) ? 'B' : 'C';
  }
  return intent === 'High' ? 'A' : 'B';
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
      fields: {
        'AI Call Summary':                fields.ai_call_summary,
        'Primary Concern':                fields.primary_concern,
        'Lead Quality Reason':            fields.lead_quality_reason,
        'Next Step Agreed On':            fields.next_step_agreed_on,
        'Main Objection':                 fields.main_objection,
        'What triggered their interest?': fields.what_triggered_interest,
        'Approximate Assets':             fields.approximate_investible_assets,
        'Approximate Monthly Income':     fields.approximate_monthly_income,
        'Income Sources':                 Array.isArray(fields.income_sources) ? fields.income_sources.join(', ') : fields.income_sources,
        'Health Conditions Mentioned':    Array.isArray(fields.health_conditions) ? fields.health_conditions.join(', ') : fields.health_conditions,
        'Age':                            fields.age,
        'Lead Quality':                   fields.lead_quality_score,
        'Lead intent':                    fields.lead_intent,
        'Product Type Discussed':         fields.product_type_discussed,
        'Medications':                    Array.isArray(fields.medications) ? fields.medications.join(', ') : fields.medications,
        'Health Qualification':           fields.health_qualification,
        'Has Children/Dependents':        fields.has_dependents,
        'Marital Status':                 fields.marital_status,
        'Investable assets':              fields.investable_assets,
        'Asset Notes':                    fields.asset_notes,
        'Monthly income':                 fields.monthly_income,
        'Lead Score':                     computeLeadScore(fields),
        'Needs Manual Review?':           false,
      },
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
    // Paste mode — single transcript
    const transcript = await readTranscriptFromPaste();
    if (!transcript.trim()) { console.log('No transcript provided.'); return; }
    await processOne(transcript, null);
    return;
  }

  // File/folder mode
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
