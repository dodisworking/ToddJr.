import Anthropic from '@anthropic-ai/sdk'
import { pickClaudeModel, pickClaudeMaxTokens } from './anthropic-config.js'

const client = new Anthropic()

// Repair truncated JSON by removing the last incomplete entry and closing open brackets
function repairJson(str) {
  // Remove trailing incomplete token — cut back to last complete value before a comma or closing bracket
  let s = str.trimEnd()
  // Drop everything after the last clean closing bracket/quote that ended a complete value
  // Walk back until we find a spot after a complete value: }, ], "...", number, true, false, null
  const safeEnd = s.search(/[}\]"0-9a-z](?=[^}\]"0-9a-z]*$)/i)
  if (safeEnd > 0) s = s.slice(0, safeEnd + 1)
  // Remove a trailing comma if present
  s = s.replace(/,\s*$/, '')
  // Count and close open brackets
  let opens = []
  let inStr = false, esc = false
  for (const ch of s) {
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') opens.push('}')
    else if (ch === '[') opens.push(']')
    else if (ch === '}' || ch === ']') opens.pop()
  }
  // Close all open structures in reverse
  return s + opens.reverse().join('')
}

const SYSTEM_PROMPT = `You are Chef Todd — a senior commercial real estate paralegal and rent roll reconciliation expert with deep knowledge of Argus Enterprise and accounting platforms (Yardi, MRI, RealPage).

YOUR WORKFLOW (in order):
1. STANDARDIZE the Client Accounting RR to normalize column names/formats to match Argus conventions
2. SORT all tenants by suite/unit number (ascending)
3. MATCH tenants — try suite first, then name (fuzzy), then SF as tiebreaker
4. COMPARE each matched pair field-by-field
5. REPORT discrepancies with exact source citations

FIELD RULES:
- "unit" and "suite" are the same field — treat interchangeably
- Square footage: compare the rentable SF only — IGNORE building share percentage / pro-rata area
- IGNORE these columns entirely: leasing period, lease status, market leasing assumptions, lease type
- Rent normalization: both systems may express rent as monthly, annual, monthly/SF, or annual/SF — ALWAYS convert to BOTH annual total AND annual $/SF before comparing
- Rent steps: compare BOTH the step amount AND the step date (month+year must match). A step on Apr 2027 vs May 2027 is a discrepancy.
- Rounding tolerance: differences less than $0.02/SF are rounding errors — classify as MATCH (LOW), not DISCREPANCY
- Name matching: if names differ, first check if suites match; if suites match, flag as NAME_VARIATION (not DISCREPANCY). If no suite match, try SF match as secondary.
- Combined suites: Argus "101-102" may equal Client rows "101" + "102" — add SFs together and compare combined rent

SEVERITY LEVELS:
- HIGH: rent/SF difference >1%, missing tenant, SF difference >2%, lease date conflict >30 days, rent step date mismatch
- MEDIUM: date variance ≤30 days, monetary difference $100–$1000, name variation only, rent step amount difference
- LOW: rounding (<$0.02/SF), minor formatting, trivial differences <$100`

export async function detectFileRoles(file1Data, file2Data, file1Name, file2Name, cheapMode) {
  const model = pickClaudeModel(cheapMode)

  const preview1 = file1Data.isImage ? `[IMAGE FILE]` : (file1Data.text || '').slice(0, 2000)
  const preview2 = file2Data.isImage ? `[IMAGE FILE]` : (file2Data.text || '').slice(0, 2000)

  const prompt = `Identify which rent roll is Client Accounting (Yardi/MRI/RealPage) and which is Argus Enterprise.

FILE 1: "${file1Name}"
${preview1}

FILE 2: "${file2Name}"
${preview2}

Respond ONLY with valid JSON:
{
  "file1Role": "CLIENT" or "ARGUS",
  "file2Role": "CLIENT" or "ARGUS",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "file1Reasoning": "One sentence",
  "file2Reasoning": "One sentence"
}`

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }]
  })

  const raw = response.content[0]?.text || '{}'
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : {
      file1Role: 'CLIENT', file2Role: 'ARGUS', confidence: 'LOW',
      file1Reasoning: 'Could not determine — assuming File 1 is Client.',
      file2Reasoning: 'Could not determine — assuming File 2 is Argus.'
    }
  } catch {
    return {
      file1Role: 'CLIENT', file2Role: 'ARGUS', confidence: 'LOW',
      file1Reasoning: 'Parse error — defaulting to Client.',
      file2Reasoning: 'Parse error — defaulting to Argus.'
    }
  }
}

/**
 * Full rent roll reconciliation.
 * @param {{ clientData, argusData, clientName, argusName }} files
 * @param {function} onProgress
 * @param {boolean} cheapMode
 * @param {string[]} enabledChecks  — list of check IDs from Secret Recipe panel (all = default)
 */
export async function analyzeRentRolls({ clientData, argusData, clientName, argusName }, onProgress, cheapMode, enabledChecks) {
  const model = pickClaudeModel(cheapMode)
  const maxTokens = pickClaudeMaxTokens(cheapMode, 32000)

  onProgress({ stage: 'parsing-client', percent: 10, message: 'Reading client rent roll...' })

  const contentBlocks = []

  contentBlocks.push({
    type: 'text',
    text: `Reconcile these two rent rolls for the same property:
1. CLIENT ACCOUNTING RENT ROLL: "${clientName}"
2. ARGUS ENTERPRISE RENT ROLL: "${argusName}"`
  })

  contentBlocks.push({ type: 'text', text: `\n\n===== CLIENT RENT ROLL: "${clientName}" =====\n` })
  if (clientData.isImage) {
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: clientData.mimeType, data: clientData.base64 } })
  } else {
    contentBlocks.push({ type: 'text', text: clientData.text || '[Empty]' })
  }

  onProgress({ stage: 'parsing-argus', percent: 20, message: 'Reading Argus rent roll...' })

  contentBlocks.push({ type: 'text', text: `\n\n===== ARGUS RENT ROLL: "${argusName}" =====\n` })
  if (argusData.isImage) {
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: argusData.mimeType, data: argusData.base64 } })
  } else {
    contentBlocks.push({ type: 'text', text: argusData.text || '[Empty]' })
  }

  onProgress({ stage: 'analyzing', percent: 35, message: 'Chef Todd is cooking the comparison...' })

  // Build optional skip/add instructions from Secret Recipe
  // enabledChecks can be: null (use defaults), or { standard: [...ids], custom: [...labels] }
  let skipNote = ''
  const ALL_CHECKS = ['tenant_name','suite','square_feet','lease_start','lease_exp','rent','rent_steps','cam','rent_psf','name_fuzzy','rounding','normalize']
  const SKIP_MAP = {
    tenant_name:  'Do not check tenant name matching',
    suite:        'Do not check suite/unit matching',
    square_feet:  'Do not check square footage',
    lease_start:  'Do not check lease start dates',
    lease_exp:    'Do not check lease expiration dates',
    rent:         'Do not check rent amounts',
    rent_steps:   'Do not check rent steps',
    cam:          'Do not check CAM/NNN charges',
    rent_psf:     'Do not check rent per SF',
    name_fuzzy:   'Do strict name matching only (no fuzzy)',
    rounding:     'Report all differences including rounding',
    normalize:    'Do not normalize rent formats — compare raw values only',
  }

  if (enabledChecks && typeof enabledChecks === 'object' && !Array.isArray(enabledChecks)) {
    const { standard = ALL_CHECKS, custom = [] } = enabledChecks
    // Disabled default checks
    const disabled = ALL_CHECKS.filter(c => !standard.includes(c))
    const skipLines = disabled.map(c => SKIP_MAP[c]).filter(Boolean)
    if (skipLines.length) {
      skipNote += `\n\nSECRET RECIPE — SKIP these checks:\n${skipLines.map(s => `- ${s}`).join('\n')}\n`
    }
    // Custom AI instructions
    if (custom.length) {
      skipNote += `\n\nSECRET RECIPE — ADDITIONAL CUSTOM CHECKS (run these in addition to everything else):\n${custom.map(c => `- ${c}`).join('\n')}\nFor each custom check above, add findings to the relevant tenantGroup's toddAssessment and evidence fields, and flag as DISCREPANCY if the check fails.\n`
    }
  }

  const analysisPrompt = `${skipNote}

RULES:
- Normalize client rents to annual total + annual $/SF before comparing
- Match tenants by suite first, then fuzzy name, then SF
- Ignore: lease status, market leasing, lease type, building share %
- Rounding <$0.02/SF = ignore (no discrepancy)
- Rent step: flag if amount OR date (month+year) differs

OUTPUT RULES (keep JSON small and fast):
- Only list rows that have problems. Clean matched tenants = not listed, just counted.
- "discrepancies" array = one row per mismatched FIELD (not per tenant)
- "missing" array = tenants that only exist on one side
- "matchedSuites" = comma-separated list of clean suite numbers

RESPOND ONLY with this compact JSON (no markdown):
{
  "property": "string",
  "analysisDate": "${new Date().toISOString().split('T')[0]}",
  "clientFormat": "e.g. Monthly + NNN",
  "rentNormalization": "e.g. Monthly x12 = annual",
  "summary": {
    "clientTenants": 0,
    "argusTenants": 0,
    "matched": 0,
    "discrepancyCount": 0,
    "missingFromClient": 0,
    "missingFromArgus": 0,
    "highSeverity": 0,
    "mediumSeverity": 0
  },
  "discrepancies": [
    {
      "suite": "101",
      "clientTenant": "ABC Corp",
      "argusTenant": "ABC Corporation",
      "field": "Lease Expiration",
      "clientValue": "12/31/2025",
      "argusValue": "1/31/2026",
      "severity": "HIGH",
      "note": "31-day variance"
    }
  ],
  "missing": [
    {
      "suite": "205",
      "side": "MISSING_FROM_CLIENT",
      "name": "New Tenant LLC",
      "sf": "2,400 SF",
      "severity": "HIGH"
    }
  ],
  "matchedSuites": "102, 103, 104"
}`

  contentBlocks.push({ type: 'text', text: analysisPrompt })

  onProgress({ stage: 'analyzing', percent: 50, message: 'Claude is cooking the comparison...' })

  // Use streaming to avoid 10-min timeout on large rent rolls
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentBlocks }]
  })
  const response = await stream.finalMessage()

  onProgress({ stage: 'analyzing', percent: 85, message: 'Finishing up...' })

  const raw = response.content[0]?.text || '{}'

  // Check if Claude hit the token limit (truncated response)
  if (response.stop_reason === 'max_tokens') {
    console.warn('[rr-claude] WARNING: Claude hit max_tokens limit — response may be truncated')
  }

  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  // Extract the JSON object from the response
  const m = stripped.match(/\{[\s\S]*/)
  const jsonStr = m ? m[0] : stripped

  // Try to parse as-is first
  try {
    const result = JSON.parse(jsonStr)
    onProgress({ stage: 'done', percent: 100, message: 'Analysis complete!' })
    return result
  } catch (_) {}

  // If truncated (max_tokens hit), try to repair the JSON
  if (response.stop_reason === 'max_tokens' || jsonStr.length > 1000) {
    console.warn('[rr-claude] Attempting JSON repair on truncated response...')
    try {
      const repaired = repairJson(jsonStr)
      const result = JSON.parse(repaired)
      console.warn('[rr-claude] JSON repair succeeded — partial results returned')
      onProgress({ stage: 'done', percent: 100, message: 'Analysis complete (partial)!' })
      return result
    } catch (repairErr) {
      console.error('[rr-claude] JSON repair failed:', repairErr.message)
    }
  }

  throw new Error(`Failed to parse Claude response. Raw (first 300): ${raw.slice(0, 300)}`)
}
