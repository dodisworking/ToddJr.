import Anthropic from '@anthropic-ai/sdk'
import { pickClaudeModel, pickClaudeMaxTokens } from './anthropic-config.js'

const client = new Anthropic()

const SYSTEM_PROMPT = `You are a senior commercial real estate paralegal specializing in rent roll reconciliation between accounting systems (Client/Yardi/MRI) and valuation systems (Argus Enterprise).

You have deep expertise in:
- Identifying rent roll formats from accounting platforms (Yardi, MRI, RealPage) vs. Argus Enterprise export formats
- Matching tenants across systems when names or suite references differ
- Flagging discrepancies in rent, square footage, lease dates, and charges with professional precision
- Understanding combined suite references (e.g., "101-102" in Argus vs. separate rows "101" and "102" in accounting)

Your analysis is thorough, citation-based, and uses specific row references as evidence.`

/**
 * Detect which file is Client Accounting RR and which is Argus RR.
 * Returns: { file1Role, file2Role, confidence, file1Reasoning, file2Reasoning }
 */
export async function detectFileRoles(file1Data, file2Data, file1Name, file2Name, cheapMode) {
  const model = pickClaudeModel(cheapMode)

  const preview1 = file1Data.isImage
    ? `[IMAGE FILE — cannot preview text content]`
    : (file1Data.text || '').slice(0, 2000)

  const preview2 = file2Data.isImage
    ? `[IMAGE FILE — cannot preview text content]`
    : (file2Data.text || '').slice(0, 2000)

  const prompt = `I have two rent roll files. Determine which is the Client Accounting Rent Roll (Yardi/MRI/RealPage style) and which is the Argus Enterprise Rent Roll.

FILE 1: "${file1Name}"
Content preview:
${preview1}

FILE 2: "${file2Name}"
Content preview:
${preview2}

Based on file names and content structure, identify each file's role.

Respond with ONLY valid JSON in this exact format:
{
  "file1Role": "CLIENT" or "ARGUS",
  "file2Role": "CLIENT" or "ARGUS",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "file1Reasoning": "One sentence explanation",
  "file2Reasoning": "One sentence explanation"
}`

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }]
  })

  const raw = response.content[0]?.text || '{}'
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {
      file1Role: 'CLIENT', file2Role: 'ARGUS',
      confidence: 'LOW',
      file1Reasoning: 'Could not determine — assuming File 1 is Client.',
      file2Reasoning: 'Could not determine — assuming File 2 is Argus.'
    }
  } catch {
    return {
      file1Role: 'CLIENT', file2Role: 'ARGUS',
      confidence: 'LOW',
      file1Reasoning: 'Parse error — defaulting File 1 to Client.',
      file2Reasoning: 'Parse error — defaulting File 2 to Argus.'
    }
  }
}

/**
 * Full rent roll comparison between client accounting RR and Argus RR.
 * @param {{ clientData, argusData, clientName, argusName }} files
 * @param {function} onProgress - ({ stage, percent, message }) => void
 * @param {boolean} cheapMode
 */
export async function analyzeRentRolls({ clientData, argusData, clientName, argusName }, onProgress, cheapMode) {
  const model = pickClaudeModel(cheapMode)
  const maxTokens = pickClaudeMaxTokens(cheapMode, 16000)

  onProgress({ stage: 'parsing-client', percent: 10, message: 'Reading client rent roll...' })

  // Build content blocks
  const contentBlocks = []

  contentBlocks.push({
    type: 'text',
    text: `You are comparing two rent rolls for the same property:
1. CLIENT ACCOUNTING RENT ROLL ("${clientName}") — from the property management/accounting system
2. ARGUS ENTERPRISE RENT ROLL ("${argusName}") — from the valuation/DCF model

Below I will provide both rent rolls. After reading them, perform a comprehensive reconciliation.`
  })

  // Client file content
  contentBlocks.push({ type: 'text', text: `\n\n===== CLIENT ACCOUNTING RENT ROLL: "${clientName}" =====\n` })

  if (clientData.isImage) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: clientData.mimeType, data: clientData.base64 }
    })
  } else {
    contentBlocks.push({ type: 'text', text: clientData.text || '[Empty file]' })
  }

  onProgress({ stage: 'parsing-argus', percent: 20, message: 'Reading Argus rent roll...' })

  // Argus file content
  contentBlocks.push({ type: 'text', text: `\n\n===== ARGUS ENTERPRISE RENT ROLL: "${argusName}" =====\n` })

  if (argusData.isImage) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: argusData.mimeType, data: argusData.base64 }
    })
  } else {
    contentBlocks.push({ type: 'text', text: argusData.text || '[Empty file]' })
  }

  onProgress({ stage: 'analyzing', percent: 35, message: 'Chef Todd is analyzing discrepancies...' })

  const analysisPrompt = `
Now perform the complete rent roll reconciliation. Follow these instructions precisely:

1. IDENTIFY FORMAT: Describe the column structure of each rent roll in one sentence.

2. MATCH TENANTS: For every tenant/suite in either rent roll:
   - Match by suite number and/or tenant name (fuzzy match — "ACME Corp" matches "ACME Corporation")
   - Handle combined suites: Argus "101-102" may correspond to Client rows "101" and "102" separately
   - Flag MISSING_CLIENT if present in Argus but not Client
   - Flag MISSING_ARGUS if present in Client but not Argus

3. COMPARE ALL FIELDS for each matched tenant group:
   - Tenant name (flag NAME_VARIATION if different but same tenant)
   - Suite number(s)
   - Square footage
   - Annual rent
   - Monthly rent
   - Rent per SF ($/SF)
   - Lease start date
   - Lease expiration date
   - CAM / operating expenses / NNN charges
   - Security deposit
   - Any other charges

4. SEVERITY RULES:
   - HIGH: rent/SF difference >1%, missing tenant entirely, major lease date conflict (>30 days), square footage difference >2%
   - MEDIUM: minor date variance (≤30 days), small monetary difference ($100-$1000), name variation only
   - LOW: formatting differences, minor rounding, trivial differences (<$100)

5. STATUS FLAGS:
   - MATCH: All key fields agree within rounding
   - DISCREPANCY: Fields present in both but values differ
   - MISSING_CLIENT: Tenant in Argus but not found in Client
   - MISSING_ARGUS: Tenant in Client but not found in Argus
   - NAME_VARIATION: Same tenant, name spelled/formatted differently

Respond ONLY with valid JSON in this exact format (no markdown, no explanation outside the JSON):
{
  "property": "Property name if determinable, else 'Unknown Property'",
  "analysisDate": "${new Date().toISOString().split('T')[0]}",
  "clientFormat": "One sentence describing the client rent roll format and columns",
  "argusFormat": "One sentence describing the Argus rent roll format and columns",
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
        "otherCharges": ""
      },
      "toddAssessment": "Professional 1-3 sentence summary of this tenant's reconciliation status.",
      "evidence": "Specific citation: Client Row X: '...'; Argus Row Y: '...'"
    }
  ]
}`

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
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    const result = JSON.parse(jsonMatch[0])
    onProgress({ stage: 'done', percent: 100, message: 'Analysis complete!' })
    return result
  } catch (err) {
    throw new Error(`Failed to parse Claude response: ${err.message}\n\nRaw response (first 500 chars): ${raw.slice(0, 500)}`)
  }
}
