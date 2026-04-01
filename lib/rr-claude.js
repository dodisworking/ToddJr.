import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT — CRE Rent Roll Reconciliation Expert
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are a senior commercial real estate paralegal and rent roll reconciliation expert with 20+ years of experience. You specialize in comparing Argus Enterprise rent rolls against client accounting system rent rolls.

MATCHING RULES (strict priority order):
1. Match tenants primarily by suite/unit number — "suite" and "unit" are exact synonyms, always treat them identically
2. If suite is absent or does not match: try square footage as secondary match
3. If SF also does not match: try tenant name as tertiary match
4. Sort all output by suite number ascending

RENT NORMALIZATION (required):
- Client rent rolls may express rent as: monthly total, annual total, monthly per-sqft, or annual per-sqft
- ALWAYS normalize to BOTH: monthly dollar total AND monthly per-sqft
- Monthly total = Annual total / 12
- Monthly per-sqft = Monthly total / SF
- Annual per-sqft × SF / 12 = Monthly total
- Ignore differences < $0.02 per sqft — these are rounding errors, do NOT flag them

RENT STEPS:
- For each rent step: compare BOTH the rent amount AND the effective date
- If the date is wrong even if amount matches — that is a finding (severity HIGH)
- Missing rent steps from one side = HIGH severity

IGNORED FIELDS (do not compare, do not mention):
- Building share percentage
- Leasing period
- Lease status
- Market leasing assumptions
- Lease type

SF COMPARISON:
- Compare total SF only, not percentages
- Do not compare pro-rata or building share %

TENANT NAMES:
- Names slightly different (e.g. "ABC Corp" vs "ABC Corporation") → flag as LOW severity, note the similarity
- Suite match takes priority over name match

SEVERITY:
- HIGH: missing tenant, SF difference >2%, lease date conflict >30 days, rent/SF difference >1%, rent step date wrong, missing rent steps
- MEDIUM: date variance 1–30 days, monetary difference $100–$1000, name variation with other mismatches
- LOW: rounding <$0.02/SF, differences <$100, name variation only (all other fields match)

OUTPUT FORMAT:
Return ONLY valid JSON with no markdown fences, no text outside the JSON object.
Schema:
{
  "property": "string or null",
  "argusTenantsTotal": 10,
  "clientTenantsTotal": 10,
  "tenantGroups": [
    {
      "suite": "101",
      "matchedBy": "suite|name|sqft|unmatched",
      "argusOnly": false,
      "clientOnly": false,
      "argus": {
        "tenantName": "string",
        "sqft": 1500,
        "leaseStart": "MM/DD/YYYY or null",
        "leaseEnd": "MM/DD/YYYY or null",
        "monthlyRent": 5000,
        "monthlyPerSF": 3.33,
        "rentSteps": [{ "effectiveDate": "MM/DD/YYYY", "monthlyRent": 5150, "monthlyPerSF": 3.43 }]
      },
      "client": {
        "tenantName": "string",
        "sqft": 1500,
        "leaseStart": "MM/DD/YYYY or null",
        "leaseEnd": "MM/DD/YYYY or null",
        "monthlyRent": 5000,
        "monthlyPerSF": 3.33,
        "rentSteps": [{ "effectiveDate": "MM/DD/YYYY", "monthlyRent": 5150, "monthlyPerSF": 3.43 }]
      },
      "differences": [
        { "field": "tenant_name|sqft|lease_start|lease_end|monthly_rent|rent_step_amount|rent_step_date", "label": "Human Readable Label", "argusValue": "string", "clientValue": "string", "severity": "HIGH|MEDIUM|LOW" }
      ],
      "allMatch": true
    }
  ],
  "summary": { "totalTenants": 10, "matched": 9, "argusOnly": 0, "clientOnly": 1, "withDifferences": 3, "cleanMatch": 6 }
}`

// ═══════════════════════════════════════════════════════════
// Strip markdown fences from Claude response
// ═══════════════════════════════════════════════════════════
function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════
/**
 * @param {{ argusText: string, argusType: string, clientText: string, clientType: string }} files
 * @param {(progress: { stage: string, percent: number, message: string }) => void} onProgress
 */
export async function analyzeRentRolls({ argusText, argusType, clientText, clientType }, onProgress) {
  onProgress({ stage: 'toppings', percent: 55, message: 'Sending to Claude for deep comparison...' })

  const userPrompt = `You are reconciling two rent rolls for the same property.

===== ARGUS ENTERPRISE RENT ROLL (format: ${argusType}) =====
${argusText}

===== CLIENT RENT ROLL (format: ${clientType}) =====
${clientText}

Perform a complete field-by-field reconciliation. Match tenants by suite first, then SF, then name. Normalize all rent to monthly total and monthly per-sqft. Flag every discrepancy (ignore differences < $0.02/sqft). Sort output by suite number.

Return ONLY valid JSON matching the schema in your instructions. No markdown fences. No text outside the JSON.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  })

  onProgress({ stage: 'oven', percent: 80, message: 'Processing Claude response...' })

  const raw = response.content[0]?.text || '{}'
  const stripped = stripFences(raw)

  // First parse attempt
  try {
    const m = stripped.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('No JSON object found in response')
    return JSON.parse(m[0])
  } catch (firstErr) {
    // Retry: ask Claude to fix the JSON
    onProgress({ stage: 'oven', percent: 83, message: 'Fixing JSON response...' })
    try {
      const fixResp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: 'You are a JSON repair tool. Return ONLY valid JSON, no markdown, no text outside.',
        messages: [
          { role: 'user', content: `The following JSON is invalid. Fix it and return ONLY the corrected JSON:\n\n${stripped.slice(0, 4000)}` }
        ]
      })
      const fixed = stripFences(fixResp.content[0]?.text || '{}')
      const m2 = fixed.match(/\{[\s\S]*\}/)
      if (!m2) throw new Error('No JSON found after repair')
      return JSON.parse(m2[0])
    } catch (retryErr) {
      throw new Error(`Failed to parse Claude response: ${firstErr.message}. Retry also failed: ${retryErr.message}`)
    }
  }
}
