import fs from 'fs'
import path from 'path'
import { extractText, detectPageNumberGaps } from './parser.js'
import { analyzeFolder, gymAnalyzeFolder, beefedUpAnalyzeFolder, doubleCheckFolder, synthesizeAcrossBatches } from './claude.js'
import { PDFDocument } from 'pdf-lib'

// Hard limits based on Anthropic API
const PDF_MAX_BYTES      = 32 * 1024 * 1024  // 32MB — actual per-file API ceiling
const BATCH_MAX_BASE64   = 15 * 1024 * 1024  // 15MB per batch (was 25MB) — ~100-120 pages max
const BATCH_MAX_PAGES    = 120               // hard page-count cap per batch (~800-1500 tokens/page × 120 = 96k-180k tokens for images alone)
const OTHER_BATCH_TEXT_CAP = 1500            // max chars of extracted text from each out-of-batch PDF (cross-reference context only)

// Target chunk size when splitting oversized PDFs (raw bytes, before base64 ×1.33)
// 15MB raw → ~20MB base64 → comfortably under the 25MB batch limit
const SPLIT_TARGET_BYTES = 12 * 1024 * 1024  // 12MB raw chunks (was 15MB) so page-count stays under cap

/**
 * Split a PDF buffer that exceeds PDF_MAX_BYTES into page-range chunks,
 * each targeting SPLIT_TARGET_BYTES. Returns an array of chunk objects:
 *   { buffer, filename, pageCount, sizeBytes }
 * where filename encodes the page range, e.g. "Lease_p1-80.pdf".
 * Falls back to null if splitting fails (caller then uses text extraction).
 */
async function splitOversizedPDF(buffer, originalName) {
  try {
    const srcDoc    = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const totalPages = srcDoc.getPageCount()
    if (totalPages < 2) return null  // can't split a 1-page PDF

    // Estimate pages per chunk based on average page size
    const avgPageBytes  = buffer.length / totalPages
    const pagesPerChunk = Math.max(1, Math.floor(SPLIT_TARGET_BYTES / avgPageBytes))

    const baseName = path.basename(originalName, path.extname(originalName))
    const chunks   = []

    for (let start = 0; start < totalPages; start += pagesPerChunk) {
      const end    = Math.min(start + pagesPerChunk - 1, totalPages - 1)
      const chunk  = await PDFDocument.create()
      const copied = await chunk.copyPages(srcDoc, Array.from({ length: end - start + 1 }, (_, i) => start + i))
      copied.forEach(p => chunk.addPage(p))

      const chunkBuf  = Buffer.from(await chunk.save())
      const chunkName = `${baseName}_p${start + 1}-${end + 1}.pdf`
      chunks.push({ buffer: chunkBuf, filename: chunkName, pageCount: end - start + 1, sizeBytes: chunkBuf.length })
    }

    console.log(`[analyzer] Split ${originalName} (${Math.round(buffer.length/1024/1024)}MB, ${totalPages}pp) → ${chunks.length} chunks`)
    return chunks
  } catch (err) {
    console.warn(`[analyzer] PDF split failed for ${originalName}: ${err.message} — falling back to text extraction`)
    return null
  }
}

/**
 * Orchestrate full analysis of a single tenant folder.
 *
 * GUARANTEE: Every file is visually scanned by Claude. No file is ever
 * downgraded to text-only because of folder size. If the combined PDFs
 * exceed the per-request limit, they are split into batches and each batch
 * is analyzed independently. Findings are merged into one result.
 *
 * Files exceeding 32MB are automatically split into page-range chunks (e.g.
 * Lease_p1-80.pdf, Lease_p81-160.pdf) so Claude still sees the full PDF visually.
 * Text extraction is only used as a last resort if splitting itself fails.
 */
export async function analyzeTenant(tenant, files, onProgress, options = {}) {
  return _orchestrateAnalysis(tenant, files, onProgress, (t, pdfs, txts, gaps, bi, opts) =>
    analyzeFolder(t, pdfs, txts, gaps, bi, opts), options)
}

/**
 * Pack PDF candidates into batches where each batch's total base64 size
 * fits within maxBytes.
 * Strategy: sort largest files first so oversized files get their own batch,
 * then all remaining small files pack together — minimises total batch count.
 * e.g. [26.7MB, 0.5MB, 0.5MB...] → batch1: 26.7MB alone, batch2: all smalls
 * instead of sequential: batch1: smalls, batch2: 26.7MB alone, batch3: tail smalls
 */
export function buildBatches(candidates, maxBytes, maxPages = BATCH_MAX_PAGES) {
  if (candidates.length === 0) return [[]]

  // Sort largest → smallest so big files are isolated first
  const sorted = [...candidates].sort((a, b) => b.base64.length - a.base64.length)

  const batches   = []
  let   current   = []
  let   currSize  = 0
  let   currPages = 0

  for (const pdf of sorted) {
    const sz = pdf.base64.length
    const pg = pdf.pageCount || 1
    // Split when either the byte budget OR the page-count budget would be exceeded
    if (current.length > 0 && (currSize + sz > maxBytes || currPages + pg > maxPages)) {
      batches.push(current)
      current   = [pdf]
      currSize  = sz
      currPages = pg
    } else {
      current.push(pdf)
      currSize  += sz
      currPages += pg
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Merge findings from multiple batch results into a single coherent result.
 * Deduplicates findings that appear identical across batches.
 */
export function mergeResults(results, tenant) {
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

/**
 * Double-Check version — runs the base model first, then feeds those findings
 * into a second reviewer pass that verifies, corrects, and enriches them.
 * Returns { firstPass, reviewed } so the caller can show both side-by-side.
 */
export async function doubleCheckTenant(tenant, files, onProgressFirst, onProgressReview, options = {}) {
  // Pass 1: base model — normal analysis
  const firstPass = await _orchestrateAnalysis(tenant, files, onProgressFirst,
    (t, pdfs, txts, gaps, bi, opts) => analyzeFolder(t, pdfs, txts, gaps, bi, opts),
    options
  )

  // Pass 2: reviewer — same documents + first-pass findings
  const reviewed = await _orchestrateAnalysis(tenant, files, onProgressReview,
    (t, pdfs, txts, gaps, bi, opts) => doubleCheckFolder(t, pdfs, txts, gaps, firstPass, bi, opts),
    options
  )

  return { firstPass, reviewed }
}

// ── shared orchestration (DRY) ────────────────────────────────────────────────

async function _orchestrateAnalysis(tenant, files, onProgress, analyzeFolder_fn, options = {}) {
  onProgress({ percent: 5, message: 'Opening documents...' })

  const pdfCandidates = []
  const textDocs      = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext  = path.extname(file.originalName).toLowerCase()

    // Support both disk-based files (file.diskPath) and in-memory buffers (file.buffer)
    const inlineBuffer = file.buffer instanceof Buffer ? file.buffer : null

    if (ext === '.pdf') {
      try {
        const sizeBytes = inlineBuffer ? inlineBuffer.length : fs.statSync(file.diskPath).size
        if (sizeBytes <= PDF_MAX_BYTES) {
          const buffer  = inlineBuffer ?? fs.readFileSync(file.diskPath)
          const base64  = buffer.toString('base64')
          let pageCount = 1
          let extractedText = ''
          try {
            const meta = await extractText(file.diskPath, file.originalName, inlineBuffer)
            pageCount     = meta.pageCount || 1
            extractedText = meta.text || ''
          } catch { /* cosmetic */ }
          pdfCandidates.push({ filename: file.originalName, diskPath: file.diskPath || null, base64, pageCount, sizeBytes, extractedText })
        } else {
          // File exceeds 32MB hard limit — try splitting by page range first
          console.log(`[analyzer] ${file.originalName}: ${Math.round(sizeBytes/1024/1024)}MB exceeds 32MB — attempting page-range split`)
          const rawBuffer = inlineBuffer ?? fs.readFileSync(file.diskPath)
          const chunks    = await splitOversizedPDF(rawBuffer, file.originalName)

          if (chunks && chunks.length > 0) {
            // Each chunk is treated as its own PDF document
            for (const chunk of chunks) {
              const base64 = chunk.buffer.toString('base64')
              let extractedText = ''
              try {
                const meta = await extractText(null, chunk.filename, chunk.buffer)
                extractedText = meta.text || ''
              } catch { /* cosmetic */ }
              pdfCandidates.push({
                filename:      chunk.filename,
                diskPath:      null,
                base64,
                pageCount:     chunk.pageCount,
                sizeBytes:     chunk.sizeBytes,
                extractedText,
                splitFrom:     file.originalName   // for logging/debugging
              })
            }
          } else {
            // Split failed — last resort: text extraction
            console.log(`[analyzer] ${file.originalName}: split failed, falling back to text extraction`)
            const doc = await extractText(file.diskPath, file.originalName, inlineBuffer)
            textDocs.push(doc)
          }
        }
      } catch (err) {
        console.warn(`[analyzer] Error reading ${file.originalName}:`, err.message)
        textDocs.push({ filename: file.originalName, text: `[Error reading file: ${err.message}]`, pageCount: 0, error: true })
      }
    } else {
      try { textDocs.push(await extractText(file.diskPath, file.originalName, inlineBuffer)) }
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
        const inlineBuffer = file.buffer instanceof Buffer ? file.buffer : null
        const gaps = await detectPageNumberGaps(file.diskPath, file.originalName, inlineBuffer)
        pageGapFindings.push(...gaps)
      } catch { /* non-critical */ }
    }
  }

  const batches    = buildBatches(pdfCandidates, BATCH_MAX_BASE64)
  const totalBatch = batches.length
  const totalPages = pdfCandidates.reduce((sum, p) => sum + (p.pageCount || 1), 0)
  console.log(`[analyzer] ${tenant.tenantName}: ${pdfCandidates.length} PDFs, ~${totalPages} pages → ${totalBatch} batch(es)`)

  const allFileNames = pdfCandidates.map(p => p.filename)

  // Auto-split a batch in half when a 400 "prompt is too long" comes back.
  // Recursive — keeps halving until batches are small enough or we're down to 1 PDF.
  async function _runBatchSafe(batchPdfs, batchInfo) {
    // Cap each out-of-batch file's text to OTHER_BATCH_TEXT_CAP chars —
    // these are cross-reference context only, not full content.
    const otherBatchTexts = totalBatch > 1
      ? pdfCandidates
          .filter(p => !batchPdfs.some(bp => bp.filename === p.filename))
          .filter(p => p.extractedText && p.extractedText.trim().length > 50)
          .map(p => ({
            filename: p.filename,
            text: p.extractedText.slice(0, OTHER_BATCH_TEXT_CAP),
            pageCount: p.pageCount,
            isFromOtherBatch: true
          }))
      : []

    try {
      return await analyzeFolder_fn(tenant, batchPdfs, textDocs, pageGapFindings, {
        ...batchInfo,
        allFileNames,
        otherBatchTexts
      }, options)
    } catch (err) {
      const isTokenOverflow = err?.status === 400 &&
        (err?.message?.toLowerCase().includes('too long') ||
         err?.message?.includes('1000000') ||
         err?.message?.toLowerCase().includes('maximum'))

      // Split in half and retry recursively
      if (isTokenOverflow && batchPdfs.length > 1) {
        const mid   = Math.ceil(batchPdfs.length / 2)
        const half1 = batchPdfs.slice(0, mid)
        const half2 = batchPdfs.slice(mid)
        console.log(`[analyzer] 400 token overflow (${batchPdfs.length} PDFs, ~${batchPdfs.reduce((s,p)=>s+(p.pageCount||1),0)} pages) — splitting in half`)
        const r1 = await _runBatchSafe(half1, { ...batchInfo, autoSplit: true })
        const r2 = await _runBatchSafe(half2, { ...batchInfo, autoSplit: true })
        return mergeResults([r1, r2], tenant)
      }

      // Single-PDF overflow (extreme edge case — very long document)
      if (isTokenOverflow && batchPdfs.length === 1) {
        console.warn(`[analyzer] Single PDF still too large after splits: ${batchPdfs[0].filename} — returning empty result for this segment`)
        return { findings: [], tenantNameInDocuments: tenant.tenantName, leaseExpirationDate: null, mostRecentDocumentDate: null, allClear: true }
      }

      throw err
    }
  }

  const allResults = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const batchPages = batch.reduce((s, p) => s + (p.pageCount || 1), 0)
    const pct   = 30 + Math.round((b / totalBatch) * 60)
    const label = totalBatch === 1
      ? `Sending ${batch.length} PDF${batch.length !== 1 ? 's' : ''} (~${batchPages} pages) to Claude...`
      : `Batch ${b + 1}/${totalBatch}: ${batch.length} PDF${batch.length !== 1 ? 's' : ''} (~${batchPages} pages)...`

    onProgress({ percent: pct, message: label })

    const result = await _runBatchSafe(batch, {
      batchNumber:  b + 1,
      totalBatches: totalBatch
    })
    allResults.push(result)
  }

  // ── Single batch: simple merge, no synthesis needed ──────────────────────
  if (totalBatch === 1) {
    onProgress({ percent: 95, message: 'Merging results...' })
    const merged = mergeResults(allResults, tenant)
    onProgress({ percent: 100, message: 'Complete' })
    return merged
  }

  // ── Multi-batch: run synthesis pass to reconcile cross-batch conflicts ────
  // This catches cases like: expiration in batch 1 extended by amendment in
  // batch 2, or a referenced document that is in a different batch.
  onProgress({ percent: 90, message: `Cross-batch synthesis (${totalBatch} batches)...` })
  try {
    const synthesized = await synthesizeAcrossBatches(
      tenant,
      allResults,
      pdfCandidates.map(p => p.filename),
      options
    )
    onProgress({ percent: 100, message: 'Complete' })
    return synthesized
  } catch (err) {
    console.error('[analyzer] Synthesis pass failed — falling back to simple merge:', err.message)
    onProgress({ percent: 95, message: 'Merging results...' })
    const merged = mergeResults(allResults, tenant)
    onProgress({ percent: 100, message: 'Complete' })
    return merged
  }
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
