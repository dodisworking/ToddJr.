import { createRequire } from 'module'
import path from 'path'
import { readFile } from 'fs/promises'
import mammoth from 'mammoth'

const require = createRequire(import.meta.url)

// Use require() for pdf-parse to avoid the ESM side-effect crash
// (the package root tries to load test files on import)
let pdfParse = null
try {
  pdfParse = require('pdf-parse')
} catch (e) {
  console.warn('[parser] pdf-parse not available:', e.message)
}


/**
 * Scan a PDF page-by-page and detect gaps in the printed page number sequence.
 * Handles Arabic numerals (1, 2, 3) and Roman numerals (i, ii, iii, iv...).
 * Ignores pages with no printed number — only numbered pages are tracked.
 * Detects restarts (e.g. exhibit re-numbering) and does NOT flag those as gaps.
 *
 * @param {string} filePath
 * @param {string} originalName
 * @returns {Promise<Array<{filename, gaps}>>}  gaps = [{afterLabel, beforeLabel, missing[]}]
 */
export async function detectPageNumberGaps(filePath, originalName) {
  if (!pdfParse) return []
  try {
    const buffer = await readFile(filePath)
    const pageTexts = []

    await pdfParse(buffer, {
      pagerender(pageData) {
        return pageData.getTextContent({ normalizeWhitespace: false }).then(tc => {
          let lastY = null, text = ''
          for (const item of tc.items) {
            const y = item.transform ? item.transform[5] : null
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n'
            text += item.str
            lastY = y
          }
          pageTexts.push(text)
          return text
        })
      }
    })

    if (pageTexts.length < 2) return []

    // Pull just the numbered pages (those with a detectable page label)
    const numbered = []
    for (const text of pageTexts) {
      const label = extractPageLabel(text)
      if (label !== null) numbered.push(label)
    }

    if (numbered.length < 2) return []

    // Walk the sequence — split into runs on restart (exhibits re-number from 1)
    // Within each run, flag any forward skip > 1
    const gaps = []
    let runStart = 0
    for (let i = 1; i < numbered.length; i++) {
      const prev = numbered[i - 1]
      const curr = numbered[i]
      if (curr < prev) {
        // Numbering went backwards — new run (normal for exhibits), no gap to flag
        runStart = i
      } else if (curr > prev + 1) {
        // Gap within the same run — flag it
        const missing = []
        for (let m = prev + 1; m < curr; m++) missing.push(m)
        gaps.push({ afterLabel: prev, beforeLabel: curr, missing })
      }
    }

    if (gaps.length === 0) return []
    return [{ filename: originalName, gaps }]

  } catch {
    return []
  }
}

/** Extract a printed page number (Arabic or Roman numeral) from a page's text.
 *  Only looks in the top 4 lines and bottom 5 lines where numbers live. */
function extractPageLabel(pageText) {
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  const zones = [...lines.slice(0, 4), ...lines.slice(-5)]

  for (const line of zones) {
    // Arabic: standalone number like "3", "Page 3", "Page 3 of 12", "- 3 -"
    let m = line.match(/^page\s+(\d{1,4})(?:\s+of\s+\d+)?$/i)
      || line.match(/^[-–]\s*(\d{1,4})\s*[-–]$/)
      || line.match(/^(\d{1,4})$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 1 && n <= 9999) return n
    }

    // Roman numerals: standalone i, ii, iii, iv, v ... xlviii etc. (case insensitive)
    m = line.match(/^((?:x{0,3})(?:ix|iv|v?i{0,3}))$/i)
    if (m && m[1].length >= 1) {
      const n = romanToInt(m[1])
      if (n !== null && n >= 1) return n
    }
  }
  return null
}

function romanToInt(s) {
  const vals = { i:1, v:5, x:10, l:50, c:100, d:500, m:1000 }
  s = s.toLowerCase()
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const curr = vals[s[i]]
    const next = vals[s[i + 1]]
    if (curr === undefined) return null
    total += (next && next > curr) ? -curr : curr
  }
  return total > 0 ? total : null
}

/**
 * Extract text content from a document file.
 * @param {string} filePath - Absolute path to the file on disk
 * @param {string} originalName - Original filename (used for extension detection)
 * @returns {Promise<{filename, text, pageCount, isScanned, error}>}
 */
export async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase()

  try {
    if (ext === '.pdf') {
      return await extractPdf(filePath, originalName)
    }

    if (ext === '.docx') {
      return await extractDocx(filePath, originalName)
    }

    if (['.txt', '.rtf', '.text'].includes(ext)) {
      const text = await readFile(filePath, 'utf-8')
      return { filename: originalName, text, pageCount: 1, isScanned: false }
    }

    if (ext === '.doc') {
      // Older binary Word format — attempt mammoth, fallback to stub
      try {
        return await extractDocx(filePath, originalName)
      } catch {
        return stub(originalName, `[LEGACY .DOC FORMAT: Cannot extract text. Please convert to .docx for full analysis.]`)
      }
    }

    // All other file types: flag as unsupported
    return stub(originalName, `[UNSUPPORTED FORMAT: ${ext} — Text extraction not available. Please convert to PDF or DOCX.]`)

  } catch (err) {
    return stub(originalName, `[EXTRACTION ERROR: ${err.message} — File may be corrupted, password-protected, or unreadable.]`, err.message)
  }
}

async function extractPdf(filePath, originalName) {
  if (!pdfParse) {
    return stub(originalName, '[PDF EXTRACTION UNAVAILABLE: pdf-parse library not loaded.]')
  }

  const buffer = await readFile(filePath)
  const data = await pdfParse(buffer, { max: 0 }) // max: 0 = all pages

  const text = data.text || ''
  const pageCount = data.numpages || 1

  // Detect scanned image PDFs — very little or no text extracted
  const isScanned = text.trim().length < 80 && pageCount > 1
  if (isScanned) {
    return {
      filename: originalName,
      text: `[SCANNED IMAGE PDF — No text layer detected. This document has ${pageCount} pages but contains no extractable text. It likely requires OCR. This must be flagged as a legibility/scan quality issue.]`,
      pageCount,
      isScanned: true
    }
  }

  return { filename: originalName, text, pageCount, isScanned: false }
}

async function extractDocx(filePath, originalName) {
  const result = await mammoth.extractRawText({ path: filePath })
  const text = result.value || ''
  // Estimate page count from character count (~2000 chars per page)
  const pageCount = Math.max(1, Math.ceil(text.length / 2000))
  return { filename: originalName, text, pageCount, isScanned: false }
}

function stub(filename, text, error = null) {
  return { filename, text, pageCount: 0, isScanned: false, error }
}
