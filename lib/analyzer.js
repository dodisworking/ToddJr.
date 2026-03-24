import fs from 'fs'
import path from 'path'
import { extractText, detectPageNumberGaps } from './parser.js'
import { analyzeFolder, gymAnalyzeFolder, beefedUpAnalyzeFolder } from './claude.js'

// Hard limits based on Anthropic API
const PDF_MAX_BYTES      = 32 * 1024 * 1024  // 32MB — actual per-file API ceiling
const BATCH_MAX_BASE64   = 20 * 1024 * 1024  // 20MB per batch — safe headroom for body + prompt

/**
 * Orchestrate full analysis of a single tenant folder.
 *
 * GUARANTEE: Every file is visually scanned by Claude. No file is ever
 * downgraded to text-only because of folder size. If the combined PDFs
 * exceed the per-request limit, they are split into batches and each batch
 * is analyzed independently. Findings are merged into one result.
 *
 * The only exception is a file that physically exceeds 32MB — the actual
 * Anthropic per-document limit. Those are extracted as text (unavoidable).
 */
export async function analyzeTenant(tenant, files, onProgress, options = {}) {
  return _orchestrateAnalysis(tenant, files, onProgress, (t, pdfs, txts, gaps, bi, opts) =>
    analyzeFolder(t, pdfs, txts, gaps, bi, opts), options)
}

/**
 * Pack PDF candidates into batches where each batch's total base64 size
 * fits within maxBytes. Uses a greedy first-fit algorithm.
 */
function buildBatches(candidates, maxBytes) {
  if (candidates.length === 0) return [[]]
  const batches  = []
  let   current  = []
  let   currSize = 0

  for (const pdf of candidates) {
    const sz = pdf.base64.length
    if (current.length > 0 && currSize + sz > maxBytes) {
      batches.push(current)
      current  = [pdf]
      currSize = sz
    } else {
      current.push(pdf)
      currSize += sz
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Merge findings from multiple batch results into a single coherent result.
 * Deduplicates findings that appear identical across batches.
 */
function mergeResults(results, tenant) {
  if (results.length === 0) return emptyTenantResult(tenant)
  if (results.length === 1) return results[0]

  const allFindings = []
  const seen        = new Set()

  for (const r of results) {
    for (const f of (r.findings || [])) {
      // Deduplicate by checkType + missingDocument key
      const key = `${f.checkType}||${(f.missingDocument || '').trim().toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        allFindings.push(f)
      }
    }
  }

  // Take the most specific tenant name / dates found across batches
  const tenantName = results.find(r => r.tenantNameInDocuments)?.tenantNameInDocuments
    || tenant.tenantName
  const expiry = results.find(r => r.leaseExpirationDate)?.leaseExpirationDate || null
  const recent = results
    .map(r => r.mostRecentDocumentDate)
    .filter(Boolean)
    .sort()
    .pop() || null

  return {
    tenantNameInDocuments:  tenantName,
    mostRecentDocumentDate: recent,
    leaseExpirationDate:    expiry,
    findings:               allFindings,
    allClear:               allFindings.length === 0
  }
}

/**
 * Gym Mode version — same orchestration as analyzeTenant but calls
 * gymAnalyzeFolder so Claude returns the extended reasoning schema.
 */
export async function gymAnalyzeTenant(tenant, files, onProgress, options = {}) {
  return _orchestrateAnalysis(tenant, files, onProgress, (t, pdfs, txts, gaps, bi, opts) =>
    gymAnalyzeFolder(t, pdfs, txts, gaps, bi, opts), options)
}

/**
 * Beefed-Up version — standard analysis with active learnings injected
 * into the system prompt. Used for side-by-side comparison.
 * @param {Array} learnings — full learnings array from learnings.json
 */
export async function beefedUpAnalyzeTenant(tenant, files, onProgress, learnings = [], options = {}) {
  return _orchestrateAnalysis(tenant, files, onProgress,
    (t, pdfs, txts, gaps, batchInfo, opts) => beefedUpAnalyzeFolder(t, pdfs, txts, gaps, batchInfo, learnings, opts),
    options
  )
}

// ── shared orchestration (DRY) ────────────────────────────────────────────────

async function _orchestrateAnalysis(tenant, files, onProgress, analyzeFolder_fn, options = {}) {
  onProgress({ percent: 5, message: 'Opening documents...' })

  const pdfCandidates = []
  const textDocs      = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext  = path.extname(file.originalName).toLowerCase()

    if (ext === '.pdf') {
      try {
        const sizeBytes = fs.statSync(file.diskPath).size
        if (sizeBytes <= PDF_MAX_BYTES) {
          const buffer  = fs.readFileSync(file.diskPath)
          const base64  = buffer.toString('base64')
          let pageCount = 1
          try {
            const meta = await extractText(file.diskPath, file.originalName)
            pageCount  = meta.pageCount || 1
          } catch { /* cosmetic */ }
          pdfCandidates.push({ filename: file.originalName, diskPath: file.diskPath, base64, pageCount, sizeBytes })
        } else {
          console.log(`[analyzer] ${file.originalName}: ${Math.round(sizeBytes/1024/1024)}MB exceeds 32MB API hard limit — extracting text`)
          const doc = await extractText(file.diskPath, file.originalName)
          textDocs.push(doc)
        }
      } catch (err) {
        console.warn(`[analyzer] Error reading ${file.originalName}:`, err.message)
        textDocs.push({ filename: file.originalName, text: `[Error reading file: ${err.message}]`, pageCount: 0, error: true })
      }
    } else {
      try { textDocs.push(await extractText(file.diskPath, file.originalName)) }
      catch (err) { textDocs.push({ filename: file.originalName, text: `[Error: ${err.message}]`, pageCount: 0, error: true }) }
    }

    onProgress({
      percent: 5 + Math.round(((i + 1) / files.length) * 20),
      message: `Read ${i + 1} of ${files.length} document${files.length !== 1 ? 's' : ''}...`
    })
  }

  if (pdfCandidates.length === 0 && textDocs.length === 0) return emptyTenantResult(tenant)

  onProgress({ percent: 27, message: 'Scanning page numbers...' })
  const pageGapFindings = []
  for (const file of files) {
    if (path.extname(file.originalName).toLowerCase() === '.pdf') {
      try {
        const gaps = await detectPageNumberGaps(file.diskPath, file.originalName)
        pageGapFindings.push(...gaps)
      } catch { /* non-critical */ }
    }
  }

  const batches    = buildBatches(pdfCandidates, BATCH_MAX_BASE64)
  const totalBatch = batches.length
  console.log(`[analyzer] ${tenant.tenantName}: ${pdfCandidates.length} PDFs → ${totalBatch} batch(es)`)

  const allResults = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const pct   = 30 + Math.round((b / totalBatch) * 60)
    const label = totalBatch === 1
      ? `Sending ${batch.length} PDF${batch.length !== 1 ? 's' : ''} to Claude...`
      : `Sending batch ${b + 1} of ${totalBatch} to Claude (${batch.length} PDF${batch.length !== 1 ? 's' : ''})...`

    onProgress({ percent: pct, message: label })

    const result = await analyzeFolder_fn(tenant, batch, textDocs, pageGapFindings, {
      batchNumber: b + 1,
      totalBatches: totalBatch,
      allFileNames: pdfCandidates.map(p => p.filename)
    }, options)
    allResults.push(result)
  }

  onProgress({ percent: 95, message: 'Merging results...' })
  const merged = mergeResults(allResults, tenant)
  onProgress({ percent: 100, message: 'Complete' })
  return merged
}

function emptyTenantResult(tenant) {
  return {
    tenantNameInDocuments:  tenant.tenantName,
    mostRecentDocumentDate: null,
    leaseExpirationDate:    null,
    findings: [{
      checkType:       'REFERENCED_DOC',
      severity:        'HIGH',
      missingDocument: 'Lease and any amendments.',
      comment:         'No documents were received for this tenant folder.',
      evidence:        'No files found in or readable from the tenant folder.'
    }],
    allClear: false
  }
}
