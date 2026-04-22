/**
 * lib/compress.js
 *
 * Auto-compression for oversized tenant folders.
 *
 * When a folder's total page count would push the Claude request over ~880k
 * image tokens, this module renders every PDF page to a JPEG at a
 * dynamically-calculated DPI — just low enough to fit the whole folder in
 * ONE API call, never lower than 55 DPI (still crisp for standard lease text).
 *
 * Token math (tokens ∝ image area ∝ DPI²):
 *   tokens_at_dpi  = TOKENS_PER_PAGE_AT_100DPI × (dpi/100)²
 *   target_dpi     = 100 × sqrt(budget_per_page / TOKENS_PER_PAGE_AT_100DPI)
 *   minimum dpi    = 55 (floor — readable for any typed or scanned document)
 */

import { createCanvas }                        from '@napi-rs/canvas'
import { getDocument, GlobalWorkerOptions }    from 'pdfjs-dist/legacy/build/pdf.mjs'

// Disable pdfjs worker thread — not needed in Node.js
GlobalWorkerOptions.workerSrc = ''

// ── Budget constants ───────────────────────────────────────────────────────────
// At 100 DPI Anthropic renders a letter page as roughly 850×1100 px
// → (850×1100)/750 ≈ 1247 tokens.  We use 1500 to be conservative (some PDFs
// have higher-res embedded images that cost more).
export const TOKENS_PER_PAGE_AT_100DPI = 1500

// Leave 120 k for system prompt + instructions. Everything else goes to images.
export const IMAGE_TOKEN_BUDGET = 880_000

const DPI_FLOOR    = 55    // minimum DPI — still readable for lease text
const DPI_CEILING  = 120   // cap — excellent quality; no benefit going higher for text docs
const JPEG_QUALITY = 88    // 0–100, 88 = excellent quality, good compression
const PDFJS_BASE   = 72    // pdfjs uses 72 pt as its base resolution unit

// ── pdfjs canvas factory (required for Node.js rendering) ─────────────────────
const NodeCanvasFactory = {
  create(width, height) {
    const canvas  = createCanvas(width, height)
    const context = canvas.getContext('2d')
    return { canvas, context }
  },
  reset(canvasData, width, height) {
    canvasData.canvas.width  = width
    canvasData.canvas.height = height
  },
  destroy(canvasData) {
    canvasData.canvas.width  = 0
    canvasData.canvas.height = 0
    canvasData.canvas  = null
    canvasData.context = null
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Does this folder need compression to fit in one Claude call?
 * @param {number} totalPages — sum of page counts across all PDFs
 */
export function needsCompression(totalPages) {
  return (totalPages * TOKENS_PER_PAGE_AT_100DPI) > IMAGE_TOKEN_BUDGET
}

/**
 * DPI that fits all pages under the budget with the minimum quality loss.
 * Never returns less than DPI_FLOOR.
 * @param {number} totalPages
 * @returns {number} target DPI (integer)
 */
export function calculateTargetDpi(totalPages) {
  const budgetPerPage = IMAGE_TOKEN_BUDGET / totalPages
  const scaleSq       = budgetPerPage / TOKENS_PER_PAGE_AT_100DPI
  const dpi           = Math.floor(100 * Math.sqrt(scaleSq))
  return Math.min(DPI_CEILING, Math.max(DPI_FLOOR, dpi))
}

/**
 * Render all pages of a PDF buffer as JPEG images at the target DPI.
 * Processes pages in parallel chunks for speed.
 *
 * @param {Buffer}  pdfBuffer    — raw PDF bytes
 * @param {number}  targetDpi    — e.g. 72, 79, 100
 * @param {number}  quality      — JPEG quality 0–100
 * @returns {Promise<string[]>}  — array of base64 JPEG strings, one per page
 */
export async function renderPdfToJpegs(pdfBuffer, targetDpi = 72, quality = JPEG_QUALITY) {
  const scale = targetDpi / PDFJS_BASE

  const pdf = await getDocument({
    data:            new Uint8Array(pdfBuffer),
    canvasFactory:   NodeCanvasFactory,
    useSystemFonts:  true,
    disableFontFace: true,
    verbosity:       0                          // silence pdfjs console output
  }).promise

  const numPages = pdf.numPages
  const pages    = new Array(numPages)

  // Render in small parallel chunks to balance speed vs memory
  const CHUNK = 4
  for (let start = 1; start <= numPages; start += CHUNK) {
    const end      = Math.min(start + CHUNK - 1, numPages)
    const promises = []

    for (let p = start; p <= end; p++) {
      promises.push(
        pdf.getPage(p).then(async page => {
          const viewport = page.getViewport({ scale })
          const canvas   = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
          const ctx      = canvas.getContext('2d')

          await page.render({ canvasContext: ctx, viewport }).promise

          const buf    = await canvas.encode('jpeg', quality)
          const b64    = buf.toString('base64')
          page.cleanup()
          return { idx: p - 1, b64 }
        })
      )
    }

    const results = await Promise.all(promises)
    for (const { idx, b64 } of results) pages[idx] = b64
  }

  await pdf.destroy()
  return pages
}

/**
 * Compress every pdfCandidate in-place:
 *   adds { jpegPages: string[], compressedDpi: number }
 *   removes  .base64  (frees memory)
 *
 * Atomic: all pages are rendered before any candidate is mutated.
 * If rendering throws partway through, no candidates are modified —
 * callers can safely fall back to the native-PDF path.
 *
 * @param {object[]}  candidates   — from _orchestrateAnalysis
 * @param {number}    targetDpi
 * @param {Function}  onProgress   — (msg: string) callback for UI
 */
export async function compressCandidates(candidates, targetDpi, onProgress = () => {}) {
  const fsPromise = import('fs').then(m => m.default)

  // Phase 1 — render (no mutation; any throw leaves candidates untouched)
  const rendered = []
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    onProgress(`Compressing ${i + 1}/${candidates.length}: ${c.filename} (${c.pageCount || '?'} pages)`)

    const buffer = c.base64
      ? Buffer.from(c.base64, 'base64')
      : (await fsPromise).readFileSync(c.diskPath)

    rendered.push(await renderPdfToJpegs(buffer, targetDpi))
  }

  // Phase 2 — mutate in-place (only reached when all rendering succeeded)
  for (let i = 0; i < candidates.length; i++) {
    candidates[i].jpegPages     = rendered[i]
    candidates[i].compressedDpi = targetDpi
    delete candidates[i].base64   // free memory
  }
}
