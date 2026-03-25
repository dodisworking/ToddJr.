import path from 'path'
import { readFile, stat } from 'fs/promises'
import OpenAI from 'openai'
import { extractText } from './parser.js'
import { buildBatches, mergeResults } from './analyzer.js'

/** Same ceiling as Claude path — per-file hard limit and batch packing */
const PDF_MAX_BYTES = 32 * 1024 * 1024
const OPENAI_BATCH_MAX_BASE64 = 20 * 1024 * 1024

/** Lazy client — OpenAI SDK throws at construct time if apiKey is missing; Railway may omit OPENAI_API_KEY until you add it. */
let _openaiClient = null
function getOpenAIClient() {
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

function buildSystemPrompt() {
  return `You are a senior commercial real estate paralegal conducting lease and amendment due diligence.

You receive PDFs as native file attachments. For each PDF the platform supplies extractable text when it exists AND rendered page images. Image-only and scanned leases are still readable from those page images.

CRITICAL: Do NOT emit a LEGIBILITY finding that says "no extractable text layer" or "requires OCR" when you can read the agreement from the attached PDF pages. Only flag LEGIBILITY when the content is genuinely unreadable (damaged scan, illegible handwriting with no context, etc.).

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
      "evidence": "string — document name, page/section, verbatim quote or date"
    }
  ],
  "allClear": true|false
}

Each distinct issue must be its own finding. The evidence field is mandatory for every finding.
Be conservative: if no real issues are found, findings should be [] and allClear=true.
If no lease documents were actually provided in this request, use checkType REFERENCED_DOC, severity HIGH, and describe what is missing.`
}

function buildUserPreamble(tenant, pdfBatch, textDocs, batchInfo, allPdfNames) {
  const fileList = allPdfNames.map(n => `  • ${n}`).join('\n')
  const thisBatch = pdfBatch.map(p => `  • ${p.filename}`).join('\n')
  let batchBlock = ''
  if (batchInfo && batchInfo.totalBatches > 1) {
    const other = allPdfNames.filter(n => !pdfBatch.some(p => p.filename === n))
    const otherNote = other.length
      ? `\nOther PDFs from this same folder are attached in separate API batches (they exist — do NOT flag them as missing):\n${other.map(o => `  • ${o}`).join('\n')}\n`
      : ''
    batchBlock = `
${'═'.repeat(60)}
BATCH ${batchInfo.batchNumber} OF ${batchInfo.totalBatches}
PDFs attached in THIS request only:
${thisBatch}
${otherNote}${'═'.repeat(60)}`
  }

  const textNote =
    textDocs.length > 0
      ? `\nAfter the PDFs, non-PDF files follow as plain text extractions: ${textDocs.map(d => d.filename).join(', ')}\n`
      : ''

  return `Tenant: ${tenant.tenantName}
Folder: ${tenant.folderName || tenant.tenantName}

COMPLETE FILE LIST for this tenant (entire folder):
${fileList}
${batchBlock}
${textNote}

Read every attached PDF end-to-end (all pages). Cross-check references, amendment chains, exhibits, execution, dates, guaranties, and name consistency across the set.

Return ONLY the JSON object — no markdown, no code fences, no commentary.`
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

async function runOpenAiPdfBatch(client, model, tenant, pdfBatch, textDocs, batchInfo, allPdfNames, options) {
  const preamble = buildUserPreamble(tenant, pdfBatch, textDocs, batchInfo, allPdfNames)
  const content = [{ type: 'input_text', text: preamble }]
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

  const resp = await client.responses.create({
    model,
    input: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content }
    ],
    max_output_tokens: options.cheapMode ? 6000 : 14000
  })

  const raw = String(resp.output_text || '').trim()
  const parsed = parseModelJson(raw)
  return normalizeResult(parsed, tenant)
}

async function runOpenAiTextOnly(client, model, tenant, docs, options) {
  const docBlock = docs
    .map(d => `### ${d.name} (${d.pages} pages)\n${d.text || '(no text extracted)'}`)
    .join('\n\n')
  const userPrompt = `Tenant: ${tenant.tenantName}\nFolder: ${tenant.folderName}\n\nAudit the following extracted document text and return strict JSON.\n\n${trimForPrompt(docBlock)}`

  const resp = await client.responses.create({
    model,
    input: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userPrompt }
    ],
    max_output_tokens: options.cheapMode ? 4000 : 8000
  })

  const parsed = parseModelJson(resp.output_text || '')
  return normalizeResult(parsed, tenant)
}

/**
 * Model-compare / OpenAI column: send native PDFs via Responses API `input_file` (vision + text),
 * batched like Claude. Falls back to extracted text only when there are no in-limit PDFs.
 */
export async function openaiAnalyzeTenant(tenant, files, onProgress = () => {}, options = {}) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY missing on server. Add it in Railway Variables, then redeploy.')
  }
  const client = getOpenAIClient()
  if (!client) {
    throw new Error('OPENAI_API_KEY missing on server. Add it in Railway Variables, then redeploy.')
  }

  onProgress({ percent: 5, message: 'OpenAI: reading folder...' })

  const pdfCandidates = []
  const textDocs = []

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

  if (pdfCandidates.length === 0 && textDocs.length === 0) {
    return normalizeResult(
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
  }

  const model = pickOpenAIModel(!!options.cheapMode)

  if (pdfCandidates.length === 0) {
    onProgress({ percent: 40, message: 'OpenAI: analyzing (text-only documents)...' })
    const flatDocs = textDocs.map(d => ({
      name: d.filename,
      text: d.text || '',
      pages: d.pageCount || 0
    }))
    const out = await runOpenAiTextOnly(client, model, tenant, flatDocs, options)
    onProgress({ percent: 100, message: 'OpenAI: complete' })
    return out
  }

  const batches = buildBatches(pdfCandidates, OPENAI_BATCH_MAX_BASE64)
  const totalBatch = batches.length
  const allPdfNames = pdfCandidates.map(p => p.filename)
  console.log(`[openai] ${tenant.tenantName}: ${pdfCandidates.length} PDFs → ${totalBatch} batch(es) (native PDF input_file)`)

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

    try {
      const result = await runOpenAiPdfBatch(
        client,
        model,
        tenant,
        batch,
        textDocs,
        batchInfo,
        allPdfNames,
        options
      )
      allResults.push(result)
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg.includes('413') || /too large|request too large/i.test(msg)) {
        console.warn(`[openai] batch ${b + 1} too large, retrying PDFs one-by-one`)
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
            options
          )
          allResults.push(result)
        }
      } else {
        throw err
      }
    }
  }

  onProgress({ percent: 95, message: 'OpenAI: merging batches...' })
  const merged = mergeResults(allResults, tenant)
  onProgress({ percent: 100, message: 'OpenAI: complete' })
  return normalizeResult(
    {
      tenantNameInDocuments: merged.tenantNameInDocuments,
      mostRecentDocumentDate: merged.mostRecentDocumentDate,
      leaseExpirationDate: merged.leaseExpirationDate,
      findings: merged.findings,
      allClear: merged.allClear
    },
    tenant
  )
}
