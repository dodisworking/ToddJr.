import path from 'path'
import { readFile, stat } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import OpenAI from 'openai'
import { extractText, detectPageNumberGaps } from './parser.js'
import { buildBatches, mergeResults } from './analyzer.js'
import { SYSTEM_PROMPT, buildAnalysisInstructions } from './claude.js'

/**
 * Strict JSON Schema for OpenAI Structured Outputs (Responses API `text.format`).
 * Guarantees parseable shape; enums prevent invalid checkType/severity.
 */
const TODD_AUDIT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tenantNameInDocuments: {
      type: 'string',
      description: 'Tenant legal name from the most recent controlling document signature block'
    },
    mostRecentDocumentDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Date of the most recent document in the folder, or null'
    },
    leaseExpirationDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Controlling lease expiration after amendments, or null if unknown'
    },
    findings: {
      type: 'array',
      description: 'Distinct audit issues; empty array if folder passes all checks',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          checkType: {
            type: 'string',
            description: 'Which of the 10 checks this finding belongs to',
            enum: [
              'EXECUTION',
              'EXHIBIT',
              'CURRENCY',
              'REFERENCED_DOC',
              'AMENDMENT_GAP',
              'MISSING_PAGE',
              'LEGIBILITY',
              'SPECIAL_AGREEMENT',
              'GUARANTY',
              'NAME_MISMATCH'
            ]
          },
          severity: {
            type: 'string',
            enum: ['HIGH', 'MEDIUM', 'LOW']
          },
          missingDocument: {
            type: 'string',
            description: 'Short label of the missing/problem document or N/A for non-document issues'
          },
          comment: {
            type: 'string',
            description: 'Actionable description for a human reviewer'
          },
          evidence: {
            type: 'string',
            description: 'Document name, page, section, verbatim quote or key date; N/A only if no page applies'
          }
        },
        required: ['checkType', 'severity', 'missingDocument', 'comment', 'evidence']
      }
    },
    allClear: {
      type: 'boolean',
      description: 'True only when findings is empty after completing all checks'
    }
  },
  required: ['tenantNameInDocuments', 'mostRecentDocumentDate', 'leaseExpirationDate', 'findings', 'allClear']
}

/** Same ceiling as Claude path — per-file hard limit and batch packing */
const PDF_MAX_BYTES = 32 * 1024 * 1024
const OPENAI_BATCH_MAX_BASE64 = 20 * 1024 * 1024

const __openaiDir = path.dirname(fileURLToPath(import.meta.url))
const OPENAI_KEY_FILE = path.join(__openaiDir, '..', 'openai.key')

function loadOpenAiKeyFile() {
  try {
    if (!existsSync(OPENAI_KEY_FILE)) return ''
    const s = readFileSync(OPENAI_KEY_FILE, 'utf8').trim()
    if (s.startsWith('sk-') && s.length >= 20) return s
  } catch {
    /* ignore */
  }
  return ''
}

/** One-line file next to package.json — easiest local setup (gitignored). Restart server after creating/editing. */
const _fileOpenAiKey = loadOpenAiKeyFile()
if (_fileOpenAiKey) {
  console.log('[openai] Using API key from openai.key (restart after changing that file).')
}

/** Set via POST /api/local-openai-key (localhost only) — survives until server restart. */
let _memoryOpenAiKey = ''

/**
 * Localhost UI: store key in server RAM (no session, no upload required).
 * Pass empty string to clear.
 */
export function setLocalOpenAiKey(key) {
  const t = String(key || '').trim()
  _memoryOpenAiKey = t
}

/** Env, openai.key file, or localhost memory paste — not per-browser session override. */
export function isOpenAiKeyConfigured() {
  return !!(
    process.env.OPENAI_API_KEY?.trim() ||
    _fileOpenAiKey ||
    _memoryOpenAiKey?.trim()
  )
}

/** For /api/health: env | openai.key | localhost_memory | none */
export function getServerOpenAiKeyHint() {
  if (process.env.OPENAI_API_KEY?.trim()) return 'env'
  if (_fileOpenAiKey) return 'openai.key'
  if (_memoryOpenAiKey?.trim()) return 'localhost_memory'
  return 'none'
}

/**
 * Priority: explicit session option (from server) > localhost memory > openai.key > .env
 */
function resolveOpenAiOverride(explicitFromCaller) {
  const ex = explicitFromCaller !== undefined && explicitFromCaller !== null ? String(explicitFromCaller).trim() : ''
  if (ex) return { key: ex, source: 'browser_session' }
  if (_memoryOpenAiKey?.trim()) return { key: _memoryOpenAiKey.trim(), source: 'localhost_memory' }
  if (_fileOpenAiKey) return { key: _fileOpenAiKey, source: 'openai.key' }
  return { key: '', source: 'server_env' }
}

/** Lazy client for server env key only. Per-request keys use a fresh client (never cached). */
let _openaiClient = null
function getOpenAIClient(overrideKey) {
  const trimmed =
    overrideKey !== undefined && overrideKey !== null && String(overrideKey).trim()
      ? String(overrideKey).trim()
      : ''
  if (trimmed) return new OpenAI({ apiKey: trimmed })
  const k = process.env.OPENAI_API_KEY?.trim()
  if (!k) return null
  if (!_openaiClient) _openaiClient = new OpenAI({ apiKey: k })
  return _openaiClient
}

function pickOpenAIModel(cheapMode) {
  if (cheapMode) return process.env.OPENAI_MODEL_CHEAP || 'gpt-4o-mini'
  return process.env.OPENAI_MODEL || 'gpt-4o'
}

function normalizeResult(parsed, tenant) {
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : []
  const normalizedFindings = findings.map(f => ({
    checkType: String(f?.checkType || 'REFERENCED_DOC'),
    severity: String(f?.severity || 'LOW').toUpperCase(),
    missingDocument: String(f?.missingDocument || 'N/A'),
    comment: String(f?.comment || ''),
    evidence: String(f?.evidence || '')
  }))
  return {
    tenantNameInDocuments: parsed?.tenantNameInDocuments || tenant.tenantName || 'Unknown',
    mostRecentDocumentDate: parsed?.mostRecentDocumentDate || null,
    leaseExpirationDate: parsed?.leaseExpirationDate || null,
    findings: normalizedFindings,
    /* Fail-safe: any finding means not all clear (ignore contradictory model flags). */
    allClear: normalizedFindings.length === 0
  }
}

function trimForPrompt(s, max = 120000) {
  const str = String(s || '')
  if (str.length <= max) return str
  return `${str.slice(0, max)}\n\n[TRUNCATED]`
}

/**
 * Full textual checklist from Claude path, but replace the prose JSON template with
 * strict machine rules so the model does not echo "EXECUTION | EXHIBIT" style literals.
 */
function buildOpenAiAnalysisInstructions(tenant, todayStr) {
  const full = buildAnalysisInstructions(tenant, todayStr)
  const marker = '\nJSON OUTPUT FORMAT'
  const idx = full.indexOf(marker)
  const body = idx === -1 ? full : full.slice(0, idx)
  return `${body}
${'═'.repeat(70)}
OPENAI OUTPUT — SCHEMA-VALIDATED JSON ONLY
${'═'.repeat(70)}
Your final message MUST be a single JSON object (no markdown fences, no commentary before or after).

• checkType must be EXACTLY one of: EXECUTION, EXHIBIT, CURRENCY, REFERENCED_DOC, AMENDMENT_GAP, MISSING_PAGE, LEGIBILITY, SPECIAL_AGREEMENT, GUARANTY, NAME_MISMATCH (uppercase, as listed).
• severity must be EXACTLY one of: HIGH, MEDIUM, LOW.
• evidence is REQUIRED on every finding: document name + page + section/clause if known + verbatim quote or key date. Use the string "N/A" only when no page applies (e.g. zero files received for the tenant).
• findings: use one object per distinct issue. If there are zero real issues after all 10 checks, findings MUST be [] and allClear MUST be true.
• If there is at least one finding, allClear MUST be false.
• Do not invent issues. Follow PHASE 1 → 2 → 3 in the instructions above before emitting JSON.

Today's date for currency checks: ${todayStr}
Expected folder tenant label: ${tenant.tenantName || 'Unknown'}`
}

/** Same rigor as Claude; add Responses API `input_file` specifics. */
function buildOpenAiSystemPrompt() {
  return `${SYSTEM_PROMPT}

OPENAI INPUT NOTE — You receive PDFs as native file attachments (input_file). For each PDF you still get full page images plus any extractable text in the file.

OUTPUT NOTE — Your reply is constrained to valid structured JSON matching the audit schema. Never wrap it in markdown code blocks. Never add explanations outside the JSON object.

CRITICAL: Do NOT emit a LEGIBILITY finding that says "no extractable text layer" or "requires OCR" when you can read the agreement from the attached PDF pages. Only flag LEGIBILITY when the content is genuinely unreadable (damaged scan, illegible handwriting with no context, etc.).`
}

function extractRefusalFromResponse(resp) {
  const out = resp?.output
  if (!Array.isArray(out)) return ''
  for (const item of out) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'refusal' && c.refusal) return String(c.refusal)
      }
    }
  }
  return ''
}

function isStructuredFormatRejected(err) {
  const status = err?.status ?? err?.statusCode
  const msg = `${err?.message || ''} ${err?.error?.message || ''} ${JSON.stringify(err?.error || {})}`
  if (status !== 400) return false
  return /json_schema|structured|text\.format|response_format|invalid.*schema|format/i.test(msg)
}

/**
 * Prefer strict json_schema (fail-proof parsing); fall back if the model/account rejects it.
 */
async function openaiResponsesCreate(client, body, useStructured) {
  const allowStructured =
    useStructured &&
    !['1', 'true', 'yes'].includes(String(process.env.OPENAI_DISABLE_STRUCTURED || '').toLowerCase())
  const base = { ...body, temperature: body.temperature ?? 0.15 }
  if (!allowStructured) {
    return client.responses.create(base)
  }
  try {
    return await client.responses.create({
      ...base,
      text: {
        format: {
          type: 'json_schema',
          name: 'todd_folder_audit',
          strict: true,
          description:
            'Commercial real estate lease folder audit: perform all 10 checks, then emit one JSON result.',
          schema: TODD_AUDIT_JSON_SCHEMA
        }
      }
    })
  } catch (e) {
    if (isStructuredFormatRejected(e)) {
      console.warn('[openai] Structured output format rejected; retrying without json_schema:', e.message)
      return client.responses.create(base)
    }
    throw e
  }
}

function buildPageGapPromptBlock(pageGapFindings) {
  if (!pageGapFindings || pageGapFindings.length === 0) return ''
  const lines = pageGapFindings.map(f => {
    const gapDesc = f.gaps
      .map(g =>
        `page${g.missing.length > 1 ? 's' : ''} ${g.missing.join(', ')} missing (jumps from ${g.afterLabel} to ${g.beforeLabel})`
      )
      .join('; ')
    return `  • "${f.filename}" — ${gapDesc}`
  }).join('\n')

  return `${'═'.repeat(70)}
PRE-CONFIRMED PAGE NUMBER GAPS (detected by automated sequence scan)
${'═'.repeat(70)}
The following gaps were found by reading the printed page numbers from every
page of each PDF and checking the sequence. These are confirmed — include each
as a MISSING_PAGE finding in your JSON output.

${lines}
${'═'.repeat(70)}`
}

function buildOpenAiFolderHeader(tenant, pdfBatch, textDocs, batchInfo, allPdfNames, todayStr) {
  const pdfFileSet = new Set(pdfBatch.map(d => d.filename))
  const allFiles = [
    ...allPdfNames.map(name => {
      const inThisBatch = pdfFileSet.has(name)
      const batchHint =
        batchInfo && batchInfo.totalBatches > 1
          ? inThisBatch
            ? ' (attached in this batch)'
            : ' (in separate batch — exists in folder)'
          : ''
      return `  - ${name} — PDF${batchHint}`
    }),
    ...textDocs.map(d =>
      `  - ${d.filename} (${d.pageCount} page${d.pageCount !== 1 ? 's' : ''}${d.isScanned ? ' — ⚠️ SCANNED IMAGE' : ''}${d.error ? ' — ⚠️ EXTRACTION ERROR' : ''})`)
  ].join('\n')

  const thisBatchFiles = pdfBatch.map(p => `  • ${p.filename}`).join('\n')
  let batchBlock = ''
  if (batchInfo && batchInfo.totalBatches > 1) {
    const otherFiles = (batchInfo.allFileNames || allPdfNames).filter(name => !pdfBatch.some(p => p.filename === name))
    const otherFilesNote =
      otherFiles.length > 0
        ? `The following PDF files from this same folder are being analyzed in separate batch calls and are NOT attached here:\n${otherFiles.map(f => `  • ${f}`).join('\n')}\n\n⚠️ CRITICAL: Do NOT flag any of those other-batch files as missing just because you don't see them in this call. They exist in the folder and will be audited independently. Only flag a referenced document as missing if it is absent from the COMPLETE folder file list shown above.\n`
        : ''

    batchBlock = `
${'═'.repeat(70)}
BATCH PROCESSING NOTICE — BATCH ${batchInfo.batchNumber} OF ${batchInfo.totalBatches}
${'═'.repeat(70)}
This folder contains more PDF files than can be sent in a single API call. The PDFs have been split into ${batchInfo.totalBatches} batches. You are analyzing batch ${batchInfo.batchNumber} of ${batchInfo.totalBatches}.

PDFs attached IN THIS BATCH:
${thisBatchFiles}

${otherFilesNote}
For all other checks: analyze only the documents you can see in this batch. The other batches will handle their own documents. Findings will be merged at the end.
${'═'.repeat(70)}`
  }

  return `TENANT FOLDER AUDIT

FOLDER LABEL: ${tenant.folderName || tenant.tenantName}
PROPERTY CODE: ${tenant.property || ''}
SUITE / SPACE NUMBER: ${tenant.suite || ''}
EXPECTED TENANT NAME (from folder): ${tenant.tenantName}
TODAY'S DATE (for lease currency check): ${todayStr}

FILES RECEIVED IN THIS FOLDER:
${allFiles}

${'═'.repeat(70)}
DOCUMENT CONTENTS — read every page carefully including all scanned images
${'═'.repeat(70)}

The PDF documents for this batch are attached below as native files. Read every single page of each PDF visually.`
}

function parseModelJson(text) {
  const t = String(text || '').trim()
  if (!t) throw new Error('OpenAI returned empty response')
  try {
    return JSON.parse(t)
  } catch {
    const m = t.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('OpenAI returned non-JSON output')
    return JSON.parse(m[0])
  }
}

/** Prefer SDK output_text; fall back to walking response.output (reasoning models, edge cases). */
function extractResponsesOutputText(resp) {
  if (!resp) return ''
  const direct = typeof resp.output_text === 'string' ? resp.output_text.trim() : ''
  if (direct) return direct
  const out = resp.output
  if (!Array.isArray(out)) return ''
  const parts = []
  for (const item of out) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'output_text' && c.text) parts.push(c.text)
        else if (c.type === 'text' && c.text) parts.push(c.text)
      }
    }
  }
  return parts.join('').trim()
}

async function runOpenAiPdfBatch(
  client,
  model,
  tenant,
  pdfBatch,
  textDocs,
  batchInfo,
  allPdfNames,
  pageGapFindings,
  options
) {
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
  const header = buildOpenAiFolderHeader(tenant, pdfBatch, textDocs, batchInfo, allPdfNames, todayStr)
  const content = [{ type: 'input_text', text: header }]
  for (const pdf of pdfBatch) {
    content.push({
      type: 'input_file',
      filename: pdf.filename,
      file_data: `data:application/pdf;base64,${pdf.base64}`
    })
  }
  for (const doc of textDocs) {
    content.push({
      type: 'input_text',
      text: `### ${doc.filename} (${doc.pageCount || 0} pages)\n${trimForPrompt(doc.text || '(no text extracted)', 80000)}`
    })
  }
  const gapBlock = buildPageGapPromptBlock(pageGapFindings)
  if (gapBlock) content.push({ type: 'input_text', text: gapBlock })
  content.push({ type: 'input_text', text: buildOpenAiAnalysisInstructions(tenant, todayStr) })

  const resp = await openaiResponsesCreate(
    client,
    {
      model,
      input: [
        { role: 'system', content: buildOpenAiSystemPrompt() },
        { role: 'user', content }
      ],
      max_output_tokens: options.cheapMode ? 8000 : 16000
    },
    true
  )

  if (resp.status === 'incomplete') {
    console.warn('[openai] response incomplete:', resp.incomplete_details?.reason || resp.incomplete_details || 'unknown')
  }

  const refusal = extractRefusalFromResponse(resp)
  if (refusal) {
    throw new Error(`OpenAI refused the audit: ${refusal.slice(0, 800)}`)
  }

  const raw = extractResponsesOutputText(resp)
  const parsed = parseModelJson(raw)
  return normalizeResult(parsed, tenant)
}

async function runOpenAiTextOnly(client, model, tenant, docs, pageGapFindings, options) {
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
  const docBlock = docs
    .map(d => `### ${d.name} (${d.pages} pages)\n${d.text || '(no text extracted)'}`)
    .join('\n\n')
  const gapBlock = buildPageGapPromptBlock(pageGapFindings)
  const userParts = [
    `TENANT FOLDER AUDIT (text-only — no native PDFs in this run)

FOLDER LABEL: ${tenant.folderName || tenant.tenantName}
PROPERTY CODE: ${tenant.property || ''}
SUITE / SPACE NUMBER: ${tenant.suite || ''}
EXPECTED TENANT NAME (from folder): ${tenant.tenantName}
TODAY'S DATE (for lease currency check): ${todayStr}

DOCUMENT TEXT (extracted locally):
${trimForPrompt(docBlock)}`,
    gapBlock,
    buildOpenAiAnalysisInstructions(tenant, todayStr)
  ]
    .filter(Boolean)
    .join('\n\n')

  const resp = await openaiResponsesCreate(
    client,
    {
      model,
      input: [
        { role: 'system', content: buildOpenAiSystemPrompt() },
        { role: 'user', content: userParts }
      ],
      max_output_tokens: options.cheapMode ? 6000 : 12000
    },
    true
  )

  if (resp.status === 'incomplete') {
    console.warn('[openai] response incomplete:', resp.incomplete_details?.reason || resp.incomplete_details || 'unknown')
  }

  const refusal = extractRefusalFromResponse(resp)
  if (refusal) {
    throw new Error(`OpenAI refused the audit: ${refusal.slice(0, 800)}`)
  }

  const parsed = parseModelJson(extractResponsesOutputText(resp))
  return normalizeResult(parsed, tenant)
}

/**
 * Model-compare / OpenAI column: send native PDFs via Responses API `input_file` (vision + text),
 * batched like Claude. Falls back to extracted text only when there are no in-limit PDFs.
 */
export async function openaiAnalyzeTenant(tenant, files, onProgress = () => {}, options = {}) {
  const { key: overrideKey, source: overrideSource } = resolveOpenAiOverride(options.openaiApiKey)
  const keyFromEnv = process.env.OPENAI_API_KEY?.trim() || ''
  if (!overrideKey && !keyFromEnv) {
    throw new Error(
      'No OpenAI API key. Easiest: create openai.key in the project folder (one line, sk-…), or set OPENAI_API_KEY in .env, or paste under OpenAI key on the home screen (localhost).'
    )
  }
  const client = getOpenAIClient(overrideKey || undefined)
  if (!client) {
    throw new Error(
      'No OpenAI API key. Add openai.key, .env OPENAI_API_KEY, or paste on the home screen (localhost).'
    )
  }
  const openaiKeySource = overrideKey ? overrideSource : 'server_env'

  onProgress({ percent: 5, message: 'OpenAI: reading folder...' })

  const pdfCandidates = []
  const textDocs = []
  const oversizedAsText = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = path.extname(file.originalName).toLowerCase()

    if (ext === '.pdf') {
      try {
        const sizeBytes = (await stat(file.diskPath)).size
        if (sizeBytes <= PDF_MAX_BYTES) {
          const buffer = await readFile(file.diskPath)
          const base64 = buffer.toString('base64')
          let pageCount = 1
          try {
            const meta = await extractText(file.diskPath, file.originalName)
            pageCount = meta.pageCount || 1
          } catch {
            /* cosmetic */
          }
          pdfCandidates.push({
            filename: file.originalName,
            diskPath: file.diskPath,
            base64,
            pageCount,
            sizeBytes
          })
        } else {
          oversizedAsText.push({ filename: file.originalName, sizeBytes })
          console.log(
            `[openai] ${file.originalName}: ${Math.round(sizeBytes / 1024 / 1024)}MB exceeds ${PDF_MAX_BYTES / 1024 / 1024}MB — using text extraction`
          )
          try {
            textDocs.push(await extractText(file.diskPath, file.originalName))
          } catch (err) {
            textDocs.push({
              filename: file.originalName,
              text: `[Error reading file: ${err.message}]`,
              pageCount: 0,
              error: true
            })
          }
        }
      } catch (err) {
        console.warn(`[openai] Error reading ${file.originalName}:`, err.message)
        textDocs.push({
          filename: file.originalName,
          text: `[Error reading file: ${err.message}]`,
          pageCount: 0,
          error: true
        })
      }
    } else {
      try {
        textDocs.push(await extractText(file.diskPath, file.originalName))
      } catch (err) {
        textDocs.push({
          filename: file.originalName,
          text: `[Error: ${err.message}]`,
          pageCount: 0,
          error: true
        })
      }
    }

    const pct = 5 + Math.round(((i + 1) / Math.max(files.length, 1)) * 25)
    onProgress({
      percent: pct,
      message: `OpenAI: processed ${i + 1}/${files.length} file${files.length !== 1 ? 's' : ''}...`
    })
  }

  onProgress({ percent: 30, message: 'OpenAI: scanning page numbers...' })
  const pageGapFindings = []
  for (const file of files) {
    if (path.extname(file.originalName).toLowerCase() === '.pdf') {
      try {
        const gaps = await detectPageNumberGaps(file.diskPath, file.originalName)
        pageGapFindings.push(...gaps)
      } catch {
        /* non-critical */
      }
    }
  }

  if (pdfCandidates.length === 0 && textDocs.length === 0) {
    const out = normalizeResult(
      {
        findings: [
          {
            checkType: 'REFERENCED_DOC',
            severity: 'HIGH',
            missingDocument: 'Lease and any amendments',
            comment: 'No documents were received for this tenant',
            evidence: 'N/A'
          }
        ],
        allClear: false
      },
      tenant
    )
    if (options.includeDebug) {
      out._openaiDebug = {
        api: 'OpenAI Responses API (client.responses.create)',
        model: pickOpenAIModel(!!options.cheapMode),
        cheapMode: !!options.cheapMode,
        tenantFilesTotal: files.length,
        openaiKeySource,
        note: 'No readable files after scan — nothing sent to OpenAI.'
      }
    }
    return out
  }

  const model = pickOpenAIModel(!!options.cheapMode)

  if (pdfCandidates.length === 0) {
    onProgress({ percent: 40, message: 'OpenAI: analyzing (text-only documents)...' })
    const flatDocs = textDocs.map(d => ({
      name: d.filename,
      text: d.text || '',
      pages: d.pageCount || 0
    }))
    const out = await runOpenAiTextOnly(client, model, tenant, flatDocs, pageGapFindings, options)
    onProgress({ percent: 100, message: 'OpenAI: complete' })
    if (options.includeDebug) {
      out._openaiDebug = {
        api: 'OpenAI Responses API (client.responses.create)',
        model,
        cheapMode: !!options.cheapMode,
        openaiKeySource,
        analysisPath: 'single_user_message_text_only',
        explanation:
          'No PDFs under 32MB were queued as native files. Each document was read locally; extracted text was sent in one user message (no input_file PDF parts). Same 10-check instructions and pre-scanned page gaps as the Claude path.',
        tenantFilesTotal: files.length,
        nativePdfCount: 0,
        pageGapFilesWithGaps: pageGapFindings.length,
        pageGapFindings: pageGapFindings.length ? pageGapFindings : undefined,
        pdfOversizedSentAsExtractedText: oversizedAsText.length ? oversizedAsText : undefined,
        nonPdfAndOversizedAsText: flatDocs.map(d => ({
          filename: d.name,
          pages: d.pages,
          textCharsApprox: (d.text || '').length
        }))
      }
    }
    return out
  }

  const batches = buildBatches(pdfCandidates, OPENAI_BATCH_MAX_BASE64)
  const totalBatch = batches.length
  const allPdfNames = pdfCandidates.map(p => p.filename)
  console.log(`[openai] ${tenant.tenantName}: ${pdfCandidates.length} PDFs → ${totalBatch} batch(es) (native PDF input_file)`)

  const batchDebug = []
  const split413Notes = []

  const allResults = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const pct = 35 + Math.round((b / Math.max(totalBatch, 1)) * 55)
    const label =
      totalBatch === 1
        ? `OpenAI: sending ${batch.length} PDF${batch.length !== 1 ? 's' : ''} (native files)...`
        : `OpenAI: batch ${b + 1}/${totalBatch} — ${batch.length} PDF${batch.length !== 1 ? 's' : ''}...`
    onProgress({ percent: pct, message: label })

    const batchInfo =
      totalBatch > 1
        ? { batchNumber: b + 1, totalBatches: totalBatch, allFileNames: allPdfNames }
        : null

    const recordBatch = (subBatch, note) => {
      batchDebug.push({
        batchIndex: batchDebug.length + 1,
        logicalGroup: b + 1,
        pdfCount: subBatch.length,
        filenames: subBatch.map(p => p.filename),
        approxBase64Chars: subBatch.reduce((s, p) => s + p.base64.length, 0),
        note: note || null
      })
    }

    try {
      const result = await runOpenAiPdfBatch(
        client,
        model,
        tenant,
        batch,
        textDocs,
        batchInfo,
        allPdfNames,
        pageGapFindings,
        options
      )
      allResults.push(result)
      recordBatch(batch, null)
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg.includes('413') || /too large|request too large/i.test(msg)) {
        console.warn(`[openai] batch ${b + 1} too large, retrying PDFs one-by-one`)
        split413Notes.push(`Batch ${b + 1} exceeded size limit — retried ${batch.length} separate requests (each PDF + shared text attachments).`)
        for (const single of batch) {
          const oneInfo =
            totalBatch > 1
              ? { batchNumber: b + 1, totalBatches: totalBatch, allFileNames: allPdfNames }
              : null
          const result = await runOpenAiPdfBatch(
            client,
            model,
            tenant,
            [single],
            textDocs,
            oneInfo,
            allPdfNames,
            pageGapFindings,
            options
          )
          allResults.push(result)
          recordBatch([single], '413 recovery — one PDF per request')
        }
      } else {
        throw err
      }
    }
  }

  onProgress({ percent: 95, message: 'OpenAI: merging batches...' })
  const merged = mergeResults(allResults, tenant)
  onProgress({ percent: 100, message: 'OpenAI: complete' })
  const out = normalizeResult(
    {
      tenantNameInDocuments: merged.tenantNameInDocuments,
      mostRecentDocumentDate: merged.mostRecentDocumentDate,
      leaseExpirationDate: merged.leaseExpirationDate,
      findings: merged.findings,
      allClear: merged.allClear
    },
    tenant
  )

  if (options.includeDebug) {
    out._openaiDebug = {
      api: 'OpenAI Responses API (client.responses.create)',
      model,
      cheapMode: !!options.cheapMode,
      openaiKeySource,
      analysisPath: 'native_pdf_input_file_per_batch',
      explanation:
        'Each API call sends: the same system + 10-check instructions as Claude, folder header, one input_file per PDF in that batch, non-PDF text blocks, pre-scanned page gaps when present, then buildAnalysisInstructions. Native PDFs use data:application/pdf;base64,...',
      tenantFilesTotal: files.length,
      pageGapFilesWithGaps: pageGapFindings.length,
      pageGapFindings: pageGapFindings.length ? pageGapFindings : undefined,
      nativePdfFiles: pdfCandidates.map(p => ({
        filename: p.filename,
        sizeBytes: p.sizeBytes,
        pageCount: p.pageCount
      })),
      pdfBatchesPlanned: totalBatch,
      apiCallsForOpenAI: batchDebug.length,
      batches: batchDebug,
      split413Notes: split413Notes.length ? split413Notes : undefined,
      textDocsAppendedToEachBatch: textDocs.map(d => d.filename),
      pdfOversizedSentAsExtractedText: oversizedAsText.length ? oversizedAsText : undefined,
      mergePasses: allResults.length,
      envModelOverride: process.env.OPENAI_MODEL || null,
      envModelCheapOverride: process.env.OPENAI_MODEL_CHEAP || null
    }
  }

  return out
}
