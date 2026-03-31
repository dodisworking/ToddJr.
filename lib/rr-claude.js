import Anthropic from '@anthropic-ai/sdk'
import { pickClaudeModel, pickClaudeMaxTokens } from './anthropic-config.js'

const client = new Anthropic()

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
  const maxTokens = pickClaudeMaxTokens(cheapMode, 16000)

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

Now perform the reconciliation. Follow this exact process:

STEP 1 — NORMALIZE CLIENT RR:
Identify the rent format in the Client RR (monthly, annual, monthly/SF, annual/SF) and convert all rents to annual total AND annual $/SF. Note the format detected.

STEP 2 — SORT BY SUITE:
List all tenants sorted by suite/unit number ascending. Note combined suites.

STEP 3 — MATCH & COMPARE each tenant:
For every tenant group:
a) Match by suite first (suite = unit, treat identically)
b) If no suite match, try fuzzy name match, then SF match
c) Compare: tenant name, suite, SF, lease start, lease end, annual rent, annual rent/SF, rent steps (amount AND date), CAM/NNN
d) Ignore: leasing period, lease status, market leasing, lease type, building share %
e) Rounding: <$0.02/SF difference = MATCH (not discrepancy)
f) Rent steps: flag if step amount OR step date differs (month+year)

RESPOND ONLY with valid JSON (no markdown, no text outside JSON):
{
  "property": "Property name or 'Unknown Property'",
  "analysisDate": "${new Date().toISOString().split('T')[0]}",
  "clientFormat": "Detected format: e.g. 'Monthly rent + annual NNN per tenant row'",
  "argusFormat": "Detected Argus format",
  "rentNormalization": "How client rents were converted (e.g. 'Monthly x12 = annual')",
  "summary": {
    "clientTenants": 0,
    "argusTenants": 0,
    "matched": 0,
    "discrepancies": 0,
    "missingFromClient": 0,
    "missingFromArgus": 0,
    "highSeverity": 0,
    "mediumSeverity": 0
  },
  "tenantGroups": [
    {
      "groupId": 1,
      "suites": "101",
      "overallStatus": "MATCH",
      "severity": "LOW",
      "clientRow": {
        "tenantName": "",
        "suite": "",
        "squareFootage": "",
        "annualRent": "",
        "monthlyRent": "",
        "rentPsf": "",
        "leaseStart": "",
        "leaseExpiration": "",
        "cam": "",
        "rentSteps": [],
        "otherCharges": ""
      },
      "argusRow": {
        "tenantName": "",
        "suite": "",
        "squareFootage": "",
        "annualRent": "",
        "monthlyRent": "",
        "rentPsf": "",
        "leaseStart": "",
        "leaseExpiration": "",
        "cam": "",
        "rentSteps": [],
        "otherCharges": ""
      },
      "discrepancyFields": [],
      "toddAssessment": "1-3 sentence professional summary.",
      "evidence": "Client Row X: '...'; Argus Row Y: '...'"
    }
  ]
}

For rentSteps use this format: [{ "date": "Apr 2027", "amount": "$52,000/yr", "psf": "$20.00" }]
For discrepancyFields list the field names that differ, e.g. ["annualRent", "leaseExpiration"]`

  contentBlocks.push({ type: 'text', text: analysisPrompt })

  onProgress({ stage: 'analyzing', percent: 50, message: 'Claude is cooking the comparison...' })

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentBlocks }]
  })

  onProgress({ stage: 'analyzing', percent: 85, message: 'Finishing up...' })

  const raw = response.content[0]?.text || '{}'
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('No JSON found')
    const result = JSON.parse(m[0])
    onProgress({ stage: 'done', percent: 100, message: 'Analysis complete!' })
    return result
  } catch (err) {
    throw new Error(`Failed to parse Claude response: ${err.message}\n\nRaw (first 500): ${raw.slice(0, 500)}`)
  }
}
