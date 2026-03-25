import OpenAI from 'openai'
import { extractText } from './parser.js'

/** Lazy client — OpenAI SDK throws at construct time if apiKey is missing; Railway may omit OPENAI_API_KEY until you add it. */
let _openaiClient = null
function getOpenAIClient() {
  const k = process.env.OPENAI_API_KEY?.trim()
  if (!k) return null
  if (!_openaiClient) _openaiClient = new OpenAI({ apiKey: k })
  return _openaiClient
}

function pickOpenAIModel(cheapMode) {
  if (cheapMode) return process.env.OPENAI_MODEL_CHEAP || 'gpt-4.1-mini'
  return process.env.OPENAI_MODEL || 'gpt-4.1'
}

function normalizeResult(parsed, tenant) {
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : []
  return {
    tenantNameInDocuments: parsed?.tenantNameInDocuments || tenant.tenantName || 'Unknown',
    mostRecentDocumentDate: parsed?.mostRecentDocumentDate || null,
    leaseExpirationDate: parsed?.leaseExpirationDate || null,
    findings: findings.map(f => ({
      checkType: String(f?.checkType || 'REFERENCED_DOC'),
      severity: String(f?.severity || 'LOW').toUpperCase(),
      missingDocument: String(f?.missingDocument || 'N/A'),
      comment: String(f?.comment || ''),
      evidence: String(f?.evidence || '')
    })),
    allClear: findings.length === 0 || parsed?.allClear === true
  }
}

function trimForPrompt(s, max = 120000) {
  const str = String(s || '')
  if (str.length <= max) return str
  return `${str.slice(0, max)}\n\n[TRUNCATED]`
}

export async function openaiAnalyzeTenant(tenant, files, onProgress = () => {}, options = {}) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY missing on server. Add it in Railway Variables, then redeploy.')
  }
  const client = getOpenAIClient()
  if (!client) {
    throw new Error('OPENAI_API_KEY missing on server. Add it in Railway Variables, then redeploy.')
  }

  onProgress({ percent: 5, message: 'OpenAI: reading documents...' })
  const docs = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    try {
      const d = await extractText(f.diskPath, f.originalName)
      docs.push({ name: f.originalName, text: d?.text || '', pages: d?.pageCount || 0 })
    } catch (err) {
      docs.push({ name: f.originalName, text: `[Could not read: ${err.message}]`, pages: 0 })
    }
    const pct = 5 + Math.round(((i + 1) / Math.max(files.length, 1)) * 45)
    onProgress({ percent: pct, message: `OpenAI: processed ${i + 1}/${files.length} files...` })
  }

  const docBlock = docs.map(d => `### ${d.name} (${d.pages} pages)\n${d.text || '(no text extracted)'}`).join('\n\n')
  const userPrompt = `Tenant: ${tenant.tenantName}\nFolder: ${tenant.folderName}\n\nAudit the following extracted document text and return strict JSON.\n\n${trimForPrompt(docBlock)}`
  const systemPrompt = `You are a senior commercial real estate paralegal. Detect missing lease docs and due diligence issues.
Return ONLY valid JSON with this exact shape:
{
  "tenantNameInDocuments": "string",
  "mostRecentDocumentDate": "YYYY-MM-DD or null",
  "leaseExpirationDate": "YYYY-MM-DD or null",
  "findings": [
    {
      "checkType": "EXECUTION|EXHIBIT|CURRENCY|REFERENCED_DOC|AMENDMENT_GAP|MISSING_PAGE|LEGIBILITY|SPECIAL_AGREEMENT|GUARANTY|NAME_MISMATCH",
      "severity": "HIGH|MEDIUM|LOW",
      "missingDocument": "string",
      "comment": "string",
      "evidence": "string"
    }
  ],
  "allClear": true|false
}
Be conservative: if no real issues are found, findings should be [] and allClear=true.`

  onProgress({ percent: 60, message: 'OpenAI: analyzing folder...' })
  const model = pickOpenAIModel(!!options.cheapMode)
  const resp = await client.responses.create({
    model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_output_tokens: options.cheapMode ? 1800 : 4000
  })

  const text = String(resp.output_text || '').trim()
  if (!text) throw new Error('OpenAI returned empty response')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('OpenAI returned non-JSON output')
    parsed = JSON.parse(m[0])
  }

  onProgress({ percent: 100, message: 'OpenAI: complete' })
  return normalizeResult(parsed, tenant)
}

