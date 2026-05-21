import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import { pickClaudeModel, pickClaudeMaxTokens, MODEL_OPUS } from './anthropic-config.js'

// ── API keys — 3 keys only ────────────────────────────────────
// KEY 0 = ANTHROPIC_API_KEY   — Tier 3 (800K tok/min, primary workhorse — 5 slots)
// KEY 1 = ANTHROPIC_API_KEY_2 — Tier 2 (450K tok/min, secondary — 3 slots)
// KEY 2 = ANTHROPIC_API_KEY_3 — Tier 2 (450K tok/min, secondary — 3 slots)
//
// 11-slot weighted schedule: key0=5/11, key1=3/11, key2=3/11
// Matches the client-side slot pool (K0×5 + K1×3 + K2×3 = 11 concurrent slots).
// On 429: always wait 65s on the same key — never rotate to another key.
const _KEYS = [
  process.env.ANTHROPIC_API_KEY,
  process.env.ANTHROPIC_API_KEY_2,
  process.env.ANTHROPIC_API_KEY_3
].filter(Boolean)

// Startup diagnostic — visible in Railway logs
console.log(`[claude] ${_KEYS.length} API key(s) configured: ${
  ['ANTHROPIC_API_KEY','ANTHROPIC_API_KEY_2','ANTHROPIC_API_KEY_3']
    .filter((_, i) => _KEYS[i])
    .join(', ')
}`)

const _KEY_SCHEDULE = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2]  // key0=5/11, key1=3/11, key2=3/11
let _schedIdx = 0
let _callCount = [0, 0, 0]  // per-key call counter for diagnostics

export function getKeyCount() { return _KEYS.length }

/** Index of the key most recently used by a gym-preferred call — lets server report it back to client. */
let _lastGymKeyIdx = 0
export function getLastGymKeyIdx() { return _lastGymKeyIdx }

const client = new Anthropic({ apiKey: _KEYS[0] })  // legacy ref for streaming

/**
 * Pick next key using tier-aware weighted schedule and return a fresh Anthropic client.
 * Key 0 (Tier 3) handles ~50% of all calls; keys 1-3 share the remainder.
 */
function nextClient() {
  if (_KEYS.length === 1) {
    _callCount[0]++
    return new Anthropic({ apiKey: _KEYS[0] })
  }
  const slot   = _KEY_SCHEDULE[_schedIdx % _KEY_SCHEDULE.length]
  const keyIdx = slot % _KEYS.length   // safe if fewer than 4 keys configured
  _schedIdx++
  _callCount[keyIdx] = (_callCount[keyIdx] || 0) + 1
  console.log(`[claude] key${keyIdx + 1} selected (calls so far: ${_callCount.slice(0, _KEYS.length).map((n,i) => `key${i+1}=${n}`).join(' ')})`)
  return new Anthropic({ apiKey: _KEYS[keyIdx] })
}

/** Return the index of the key the LAST nextClient() call used. */
function lastKeyIdx() {
  const slot = _KEY_SCHEDULE[(_schedIdx - 1) % _KEY_SCHEDULE.length]
  return slot % _KEYS.length
}

/**
 * On a 429 from `failedKeyIdx`, cycle through ALL remaining keys until one accepts.
 * Priority order:
 *   - If key0 didn't fail → try key0 first (tier 3, highest capacity), then others
 *   - If key0 did fail    → try keys 1→2→3, then give key0 a 2s recovery window and retry it last
 * Any non-429 error is re-thrown immediately (it's a real error, not a rate limit).
 *
 * @param {function(string): Promise} fn  - (apiKey) => Anthropic call
 * @param {number} failedKeyIdx           - index of the key that just 429'd
 */
async function tryAllKeys(fn, failedKeyIdx) {
  const order = []
  if (failedKeyIdx !== 0) order.push(0)            // key0 first if it didn't fail
  for (let i = 1; i < _KEYS.length; i++) {
    if (i !== failedKeyIdx) order.push(i)
  }
  if (failedKeyIdx === 0) order.push(0)            // retry key0 at the very end after all others

  let lastErr
  for (let i = 0; i < order.length; i++) {
    const idx = order[i]
    const isKey0Retry = idx === 0 && failedKeyIdx === 0 && i === order.length - 1
    if (isKey0Retry) {
      console.warn('[claude] all secondary keys 429 — pausing 2s before retrying key0 (tier3)')
      await new Promise(r => setTimeout(r, 2000))
    }
    console.warn(`[claude] 429 on key ${failedKeyIdx} → trying key ${idx} (${i + 1}/${order.length})`)
    try {
      return await fn(_KEYS[idx])
    } catch (e) {
      if (e?.status !== 429) throw e    // real error — propagate immediately
      lastErr = e
    }
  }
  throw lastErr   // all keys exhausted — let caller's retry loop handle it
}

/**
 * messages.create — weighted schedule + full key cycling on 429.
 * Also handles model-name fallback: if a request fails with 400/404 because
 * the model name isn't recognized (e.g., MODEL_OPUS not yet on the API),
 * retry once with MODEL_SONNET so TP3's Opus calls don't break the pipeline.
 */
async function createMessageWithFailover(params) {
  const c   = nextClient()
  const idx = lastKeyIdx()
  try {
    return await c.messages.create(params)
  } catch (err) {
    if (err?.status === 429 && _KEYS.length > 1) {
      return tryAllKeys(key => new Anthropic({ apiKey: key }).messages.create(params), idx)
    }
    // Model not found / not yet available → retry with Sonnet as a safety net.
    // This keeps TP3's Opus-powered stages from breaking when Opus isn't on the API.
    const isModelErr = (err?.status === 400 || err?.status === 404) &&
                       /model|not_found|not.found|invalid.model/i.test(String(err?.message || err?.error?.message || ''))
    if (isModelErr && params.model && params.model !== 'claude-sonnet-4-6') {
      console.warn(`[failover] Model "${params.model}" rejected by API — retrying with claude-sonnet-4-6`)
      try {
        return await c.messages.create({ ...params, model: 'claude-sonnet-4-6' })
      } catch (err2) {
        throw err2
      }
    }
    throw err
  }
}

/**
 * beta.messages.create — weighted schedule + full key cycling on 429.
 * 8 concurrent tenant analyses use the tier-aware schedule; any 429 cascades
 * through all remaining keys before giving up.
 */
async function createBetaMessageWithFailover(params) {
  const c   = nextClient()
  const idx = lastKeyIdx()
  try {
    return await c.beta.messages.create(params)
  } catch (err) {
    if (err?.status === 429 && _KEYS.length > 1) {
      return tryAllKeys(key => new Anthropic({ apiKey: key }).beta.messages.create(params), idx)
    }
    throw err
  }
}

/**
 * Gym-mode beta.messages.create — same as createBetaMessageWithFailover but
 * passes a 20-minute SDK timeout.  Gym responses can be large (32k max_tokens
 * + verbose reasoning fields) so the default 10-minute SDK timeout is not enough.
 */
const GYM_TIMEOUT_MS = 20 * 60 * 1000  // 20 minutes
async function createBetaMessageForGym(params) {
  const c   = nextClient()
  const idx = lastKeyIdx()
  const opt = { timeout: GYM_TIMEOUT_MS }
  try {
    return await c.beta.messages.create(params, opt)
  } catch (err) {
    if (err?.status === 429 && _KEYS.length > 1) {
      return tryAllKeys(key => new Anthropic({ apiKey: key }).beta.messages.create(params, opt), idx)
    }
    throw err
  }
}

/**
 * beta.messages.create with a CLIENT-CHOSEN preferred key tried first.
 * Used for TP2 parallel gym analysis — client tracks key health and rotates
 * to the freshest key on each retry so rate-limited keys get time to recover.
 *
 * @param {object} params          - Anthropic API params
 * @param {number} preferredKeyIdx - Key index to try first (0 = Tier-3, highest)
 */
async function createBetaMessageWithPreferredKey(params, preferredKeyIdx) {
  const safe = (Number.isInteger(preferredKeyIdx) && preferredKeyIdx >= 0 && preferredKeyIdx < _KEYS.length)
    ? preferredKeyIdx : 0
  _lastGymKeyIdx = safe
  _callCount[safe] = (_callCount[safe] || 0) + 1
  console.log(`[claude/gym] preferred key${safe + 1} (calls: ${_callCount.slice(0, _KEYS.length).map((n, i) => `k${i + 1}=${n}`).join(' ')})`)
  // No key rotation — always use the assigned key. On 429, throw up to caller
  // which waits 65s and retries the same key. Rotating would cause cross-key
  // token double-billing and defeat the static assignment strategy.
  return await new Anthropic({ apiKey: _KEYS[safe] }).beta.messages.create(params)
}

/** No HTTP status — socket/DNS/TLS/timeout (common on cloud hosts under load). */
function isRetryableNetworkError(err) {
  if (err == null || err.status != null) return false
  const msg = `${err.message || ''} ${err.cause?.message || ''} ${err.code || ''}`
  return /connection|socket|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch|timeout|network|TLS|UND_ERR|terminated/i.test(msg)
}

function formatClaudeError(err) {
  const status = err.status != null ? err.status : 'network'
  let detail = err.message || String(err)
  if (err.cause?.message) detail += ` (${err.cause.message})`
  if (!process.env.ANTHROPIC_API_KEY?.trim())
    detail += ' — ANTHROPIC_API_KEY may be missing on the server.'
  return `Claude API error: ${status} — ${detail}`
}

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════
export const SYSTEM_PROMPT = `You are a senior commercial real estate paralegal and lease abstraction specialist with 20+ years of experience performing due diligence document audits for institutional landlords, law firms, and REITs.

Your expertise includes:
- Commercial lease structures (NNN, gross, modified gross, percentage rent)
- Lease amendment chains and document sequencing
- Exhibit requirements and their legal significance
- Guaranty structures and execution requirements under various state laws
- Special use agreements (easements, licenses, telecom, parking, access, declarations)
- Document execution formalities and signature authority
- Estoppel certificates and their documentary cross-references

YOUR MISSION: Replicate the work of a senior commercial real estate paralegal performing a missing documents audit. Read every document completely, then report findings. Quality over quantity — a single accurate finding is worth more than ten wrong ones.

IRON RULE — READ EVERYTHING FIRST, CONCLUDE SECOND:
You MUST finish reading the entire document — every page, all the way to the end — before forming any conclusion about that document. Never flag something as missing, blank, or absent based on what you see on one page alone. The content you think is missing on page 29 may be on page 30. The exhibit you think is empty may continue on the next page. An exhibit heading page followed by what appears to be a blank area is NOT a missing exhibit — read the next page first. Only after you have read the complete document from first page to last page may you form conclusions about what is or is not present.

ABSOLUTE REQUIREMENTS:
1. Read every single page of every single document in the folder before drawing any conclusions. This is non-negotiable. Do not skip documents, do not skip pages.
2. As you read each document page by page, track the page numbers printed at the top or bottom of each page (e.g., "3", "Page 3", "- 3 -", "Page 3 of 12"). After reading the full document, check the sequence you recorded. If it jumps from 4 to 8, pages 5–7 are missing. Report this only after you have read the whole document.
3. For EVERY single finding, you MUST provide exact citation evidence — specify the exact document name and date, the exact page number, the exact section/clause name if present, and the verbatim text or key date that triggered the finding.
4. You output ONLY valid JSON — absolutely no prose, no markdown fences, no explanation outside the JSON structure.
5. Missing documents referenced in recitals are HIGH priority — if a document is mentioned but not received, flag it.
6. Expired leases are HIGH severity — always compare dates to today.
7. Unsigned or partially signed documents are HIGH severity — flag every blank signature line.

CRITICAL ANTI-FALSE-POSITIVE RULES:
- NEVER conclude content is missing from a single-page observation. Always verify by reading the pages that follow before flagging.
- DO NOT flag exhibits as "missing" unless you have read the full document and the exhibit content is genuinely absent — not present anywhere in the document or folder.
- DO NOT flag tenant name variations as a mismatch when the entity is clearly the same (e.g., "ABC Corp" vs "ABC Corporation" vs "ABC Corp." are the same entity). Only flag if the base entity name is materially different.
- DO NOT flag a document as "unexecuted" unless the signature block is visibly blank. If you cannot clearly see the signature area due to scan quality, flag as a legibility concern instead.
- DO NOT flag an amendment sequence gap unless you have confirmed the specific amendments present and the gap is real.
- DO NOT manufacture findings. allClear: true is a valid and correct result for a clean folder.
- WHEN IN DOUBT, keep reading. If after reading everything doubt remains, note it at LOW severity for human review rather than asserting it as a confirmed issue.

BASELINE RULES — TRAINED FROM EXPERT PARALEGAL REVIEW:

EXECUTION:
- Exhibits do NOT need to be executed unless the exhibit is a Guaranty. All other exhibits (SNDAs, Broker Acknowledgments, Collateral Assignments, blank sample forms, etc.) are routinely unexecuted — never flag them.
- A valid signature present in a signature block is sufficient execution even if the printed name line beside it is crossed out, blank, or altered.
- Initialing of interior pages is NOT required — never flag missing initials.
- Small, informal, or stylized signatures are acceptable — never flag signature size or style.
- DocuSign overlays, electronic signature backgrounds, and textured scan backgrounds do not affect execution status — focus on whether a signature is present, not how it looks.

MISSING DOCUMENTS — OUT OF SCOPE (never flag these):
- Operational and compliance documents: COIs (certificates of insurance), HVAC contracts, pest control agreements, business licenses, and similar operational documents are NOT in lease abstracting scope.
- Broker and commission agreements are always out of scope.
- Franchise agreements are out of scope.
- Government permits, Notices of Commencement, development orders, and building permits are out of scope.
- SNDAs (Subordination, Non-Disturbance, Attornment agreements) are out of scope — never flag as missing.
- Sub-exhibits (exhibits within exhibits, e.g., Exhibit A-1, A-2, electrical proposals embedded in an exhibit) are not required and should never be flagged.

AMENDED & RESTATED LEASES:
- When an Amended & Restated Lease exists in the folder, prior original leases and all prior amendments are superseded. Do NOT flag them as missing — they are irrelevant once an A&R lease is present.

LEASE CURRENCY:
- If the lease is current as of today based on the documents received, output NOTHING for this check. Do not write a note, do not acknowledge it, do not flag it. Only flag lease currency if: (a) the lease is expired with no extension found, or (b) a document confirming the current term is genuinely missing.

AMENDMENT GAP:
- If the amendment chain is complete and accounted for, output NOTHING. Do not write a note confirming the chain is complete. Only flag if there is a genuine missing amendment.

FOLDER AND FILE NAME MATCHING:
- Client-assigned folder names and file names are IRRELEVANT. They do not need to match the legal entity name or document title. Never flag a name mismatch based on how the client named a folder or file — only flag if the legal entity names within the document content itself are materially inconsistent.

LEGIBILITY:
- Dark shadows, edge smudges, scan artifacts, and textured backgrounds are acceptable as long as key information (signatures, dates, names, terms) can be discerned. Only flag legibility if critical content is genuinely unreadable.
- A single extra line in a signature panel, or a signature that is off by a letter from the printed name, does not affect legibility or execution status.

PAGE GAPS — DUAL-CONFIRMATION REQUIRED:
- A page number sequence gap alone is NOT sufficient to flag missing pages. You must ALSO find a content reason — broken text, orphaned reference, incomplete clause, or structural evidence — before flagging.
- Common false gap causes that must NOT be flagged: dual numbering systems (printed page numbers vs. PDF page numbers), cover pages with no printed number (causing the body to start at a high number), blank separator pages between exhibits, exhibit sections that restart numbering.
- Only flag a page gap when BOTH signals are present: (1) a numbering anomaly AND (2) a content scar (mid-sentence cutoff, missing section referenced in table of contents, body jumps from Section 12 to Section 16, etc.).`

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} tenant    - { id, folderName, property, suite, tenantName }
 * @param {Array}  pdfDocs   - [{ filename, base64, pageCount }]  — sent as native document blocks
 * @param {Array}  textDocs  - [{ filename, text, pageCount, isScanned, error }] — text extracted
 * @param {Array}  pageGapFindings - suspected page gaps from parser (require dual-confirmation)
 * @param {object} batchInfo - { batchNumber, totalBatches, allFileNames } — present when folder is split into batches
 */
export async function analyzeFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null, options = {}) {
  return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, 0, batchInfo, options)
}

// ═══════════════════════════════════════════════════════════
// CONTENT BUILDER — header text + PDF blocks + analysis instructions
// ═══════════════════════════════════════════════════════════

function buildContent(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null) {
  const today    = new Date()
  const todayStr = today.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })

  // File inventory listing — show ALL files in the folder (not just this batch)
  // When batching, allFileNames lists every PDF in the folder so Claude can cross-reference
  const pdfFileSet = new Set(pdfDocs.map(d => d.filename))
  const allPdfNames = (batchInfo && batchInfo.allFileNames && batchInfo.allFileNames.length > 0)
    ? batchInfo.allFileNames
    : pdfDocs.map(d => d.filename)

  const allFiles = [
    ...allPdfNames.map(name => {
      const inThisBatch = pdfFileSet.has(name)
      return `  - ${name} — PDF${inThisBatch ? ' (attached in this batch)' : ' (in separate batch — exists in folder)'}`
    }),
    ...textDocs.map(d =>
      `  - ${d.filename} (${d.pageCount} page${d.pageCount !== 1 ? 's' : ''}${d.isScanned ? ' — ⚠️ SCANNED IMAGE' : ''}${d.error ? ' — ⚠️ EXTRACTION ERROR' : ''})`)
  ].join('\n')

  const content = []

  // ── Block 1: Header / context ──────────────────────────────
  content.push({
    type: 'text',
    text: `TENANT FOLDER AUDIT

FOLDER LABEL: ${tenant.folderName}
PROPERTY CODE: ${tenant.property}
SUITE / SPACE NUMBER: ${tenant.suite}
EXPECTED TENANT NAME (from folder): ${tenant.tenantName}
TODAY'S DATE (for lease currency check): ${todayStr}

FILES RECEIVED IN THIS FOLDER:
${allFiles}

${'═'.repeat(70)}
DOCUMENT CONTENTS — read every page carefully including all scanned images
${'═'.repeat(70)}

The PDF documents are attached below. Read every single page of each PDF visually.`
  })

  // ── Block 1b: Batch context note (only when folder is split) ──
  if (batchInfo && batchInfo.totalBatches > 1) {
    const thisBatchFiles = pdfDocs.map(p => `  • ${p.filename}`)
    const otherFiles = (batchInfo.allFileNames || [])
      .filter(name => !pdfDocs.some(p => p.filename === name))
    const otherFilesNote = otherFiles.length > 0
      ? `The following PDF files from this same folder are being analyzed in separate batch calls and are NOT attached here:\n${otherFiles.map(f => `  • ${f}`).join('\n')}\n\n⚠️  CRITICAL: Do NOT flag any of those other-batch files as missing just because you don't see them in this call. They exist in the folder and will be audited independently. Only flag a referenced document as missing if it is absent from the COMPLETE folder file list shown above.`
      : ''

    content.push({
      type: 'text',
      text: `${'═'.repeat(70)}
BATCH PROCESSING NOTICE — BATCH ${batchInfo.batchNumber} OF ${batchInfo.totalBatches}
${'═'.repeat(70)}
This folder contains more PDF files than can be sent in a single API call. The PDFs have been split into ${batchInfo.totalBatches} batches. You are analyzing batch ${batchInfo.batchNumber} of ${batchInfo.totalBatches}.

PDFs visually attached IN THIS BATCH:
${thisBatchFiles.join('\n')}

${otherFilesNote}

For all other checks (execution, exhibits, currency, referenced docs, amendments, legibility, special agreements, guaranty, name matching): analyze only the documents you can see in this batch. The other batches will handle their own documents. Findings will be merged at the end.
${'═'.repeat(70)}`
    })
  }

  // ── Block 1c: Other-batch PDF texts (cross-batch context) ─
  // When a folder is split across batches, inject extracted text from the
  // OTHER batches so Claude can reason across the full folder:
  // amendment chains, referenced docs, expiration extensions, etc.
  // Visual checks (signatures, legibility) are NOT requested on these —
  // those PDFs will be visually scanned in their own batch.
  if (batchInfo && batchInfo.totalBatches > 1 && batchInfo.otherBatchTexts && batchInfo.otherBatchTexts.length > 0) {
    const otherTextsContent = batchInfo.otherBatchTexts
      .map(d => `${'─'.repeat(60)}\nDOCUMENT: ${d.filename} [OTHER BATCH — TEXT EXTRACTED]\n${'─'.repeat(60)}\n${d.text.trim()}\n`)
      .join('\n\n')

    content.push({
      type: 'text',
      text: `${'═'.repeat(70)}
OTHER BATCH DOCUMENTS — EXTRACTED TEXT FOR CROSS-REFERENCE CONTEXT ONLY
${'═'.repeat(70)}
The following PDFs are in OTHER batches of this same folder. Their extracted text is provided here ONLY for cross-document reasoning.

USE THIS TEXT TO:
  • Identify amendment chains and find the most recent controlling expiration date
  • Confirm whether a referenced document actually exists in another batch
  • Spot that an extension/renewal/modification in another batch resolves an apparent issue in this batch
  • Populate crossBatchReferences in your JSON if you see something you need to flag for the synthesis pass

DO NOT use this text to:
  • Flag signature issues (you cannot see the actual signature pages here)
  • Flag legibility or scan quality issues
  • Flag page gaps (you cannot see the actual page sequence here)

⚠️  CRITICAL FOR EXPIRATION DATES: If you see a lease expiration date in documents you are visually reading, ALWAYS check this other-batch text for any later amendment that extends, renews, or modifies that date before flagging it as expired.

${'─'.repeat(70)}
${otherTextsContent}
${'═'.repeat(70)}`
    })
  }

  // ── Block 2: One document block per PDF (or image blocks if compressed) ─────
  for (const pdf of pdfDocs) {
    if (pdf.jpegPages && pdf.jpegPages.length > 0) {
      // COMPRESSED PATH — each page is a pre-rendered JPEG at reduced DPI.
      // Send a label block then one image block per page so Claude knows which
      // document each page belongs to.
      content.push({
        type: 'text',
        text: `\n${'─'.repeat(60)}\nDOCUMENT: ${pdf.filename} (${pdf.jpegPages.length} page${pdf.jpegPages.length !== 1 ? 's' : ''}, auto-compressed to ${pdf.compressedDpi || 72} DPI for single-call analysis)\n${'─'.repeat(60)}`
      })
      for (const jpegB64 of pdf.jpegPages) {
        content.push({
          type:   'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: jpegB64 }
        })
      }
    } else {
      // NATIVE PATH — raw PDF as Anthropic document block
      content.push({
        type: 'document',
        source: {
          type:       'base64',
          media_type: 'application/pdf',
          data:       pdf.base64
        },
        title: pdf.filename
      })
    }
  }

  // ── Block 3: Text-extracted docs (DOCX/TXT/oversized PDFs) ─
  if (textDocs.length > 0) {
    const textContent = textDocs.map(d =>
      `${'═'.repeat(70)}\nDOCUMENT: ${d.filename}\n${'═'.repeat(70)}\n${d.text}\n`
    ).join('\n\n')
    content.push({ type: 'text', text: textContent })
  }

  // ── Block 4: Suspected page gap findings (require dual-confirmation) ────
  if (pageGapFindings.length > 0) {
    const lines = pageGapFindings.map(f => {
      const gapDesc = f.gaps.map(g =>
        `page${g.missing.length > 1 ? 's' : ''} ${g.missing.join(', ')} missing (jumps from ${g.afterLabel} to ${g.beforeLabel})`
      ).join('; ')
      return `  • "${f.filename}" — ${gapDesc}`
    }).join('\n')

    content.push({
      type: 'text',
      text: `${'═'.repeat(70)}
SUSPECTED PAGE NUMBER GAPS (detected by automated sequence scan — requires your confirmation)
${'═'.repeat(70)}
The following page number gaps were detected by an automated scan of printed
page numbers. These are SUSPECTED gaps only — not confirmed.

For each one below, apply the DUAL-CONFIRMATION RULE from Check 6:
- Read the content around the gap. Is there a content scar (broken text, missing section, incomplete clause)?
- If YES (content scar + number gap): include as a MISSING_PAGE finding.
- If NO (number gap only, content reads fine): this is likely a false positive — DO NOT include as a finding.

Suspected gaps:
${lines}
${'═'.repeat(70)}`
    })
  }

  // ── Block 5: All 10 analysis checks + JSON format ─────────
  content.push({
    type: 'text',
    text: buildAnalysisInstructions(tenant, todayStr)
  })

  return content
}

// ═══════════════════════════════════════════════════════════
// ANALYSIS INSTRUCTIONS (all 10 checks + JSON schema)
// ═══════════════════════════════════════════════════════════

export function buildAnalysisInstructions(tenant, todayStr) {
  return `${'═'.repeat(70)}
REQUIRED ANALYSIS — PERFORM ALL 10 CHECKS THOROUGHLY
${'═'.repeat(70)}

HOW TO APPROACH THIS AUDIT — READ THIS FIRST:

PHASE 1 — READ EVERYTHING:
Before writing a single finding, read every page of every document in this folder from beginning to end. As you read, build these three lists in your working memory:
  A) Every specific document referenced by name anywhere (recitals, body text, estoppel, exhibits, anywhere)
  B) The page number sequence for each document (tracking the printed numbers at top/bottom of each page)
  C) Every exhibit listed in any index or table of contents

PHASE 2 — CROSS-CHECK:
After reading everything:
  - For list A: search the full folder to confirm whether each referenced document is actually present. Only flag it as missing if you genuinely cannot find it anywhere across all received files.
  - For list B: identify any gaps in page number sequences within each document.
  - For list C: confirm each indexed exhibit has actual content somewhere in the folder.

PHASE 3 — REPORT:
Only now write your findings. Every finding must be based on the complete picture of the folder — not a mid-read snap judgment.

This three-phase discipline is what separates a professional audit from a rushed scan. Do not skip phases.

⚠️  EVIDENCE REQUIREMENT: For EVERY finding, you MUST specify:
    • The exact document name and date
    • The exact page number (or "Page unknown" if pagination is absent)
    • The exact section or clause name/number if identifiable
    • The verbatim text, date, or description that triggered the finding

    Example evidence format:
    "Third Amendment to Lease dated 6/15/23, Page 1, Recitals: 'as further amended by that certain Second Amendment to Lease dated [no date listed] — Second Amendment not found in folder'"

────────────────────────────────────────────────────────────────
CHECK 1: EXECUTION STATUS
────────────────────────────────────────────────────────────────
Examine EVERY signature block in EVERY Lease, Amendment, and Guaranty document.

Rules:
- Leases and Amendments to Leases MUST be signed by ALL parties (Landlord and Tenant)
- If only one party signed, note which party's signature is missing
- If a document is undated after signing, note this
- CRITICAL: Exhibits do NOT need to be executed UNLESS the exhibit is a Guaranty. All other exhibits — SNDAs, broker acknowledgments, sample blank forms, operational exhibits — are routinely unexecuted. NEVER flag an exhibit for missing execution unless it is a Guaranty.
- CRITICAL: A valid signature present in a block is SUFFICIENT even if the printed name line is crossed out, blank, or altered beside it.
- CRITICAL: Do NOT flag initialing of interior pages — it is not required.
- CRITICAL: Do NOT flag signature size, style, or aesthetics. If a signature exists, it is executed.

Output format for missing execution:
• "Letter dated 7/19/01 is not executed."
• "Third Amendment to Lease dated 3/20/03 is not executed by Landlord."
• "Lease dated 8/11/20 is not executed by Tenant."

────────────────────────────────────────────────────────────────
CHECK 2: MISSING EXHIBITS
────────────────────────────────────────────────────────────────
Find the exhibit index, table of contents, or exhibit schedule in the Lease (or most recent governing document).

🚨 MANDATORY ENUMERATION — TRIPLE-CHECK EVERY EXHIBIT 🚨
You MUST enumerate every single exhibit letter/number/Rider/Schedule/Addendum listed in the formal index — NOT a subset. Read the index character by character. Common indexes list Exhibits A, B, C, D, E, F, G plus Riders 1, 2, 3 — that is 10 separate items, all of which must be checked individually. If the index lists 10 items, your enumeration MUST cover all 10. Do not stop after finding 4 missing exhibits — continue enumerating until every indexed item has been verified. Do not assume a sequence is complete after checking only some of its members. Pattern of failure: model checks A, B, E, Rider 2 and stops, missing C, D, G, Rider 1 entirely.

Steps:
1. List every exhibit letter/number AND every Rider/Schedule/Addendum listed in the FORMAL EXHIBIT INDEX. Write them out as an explicit ordered list before checking presence. If no index, note any exhibit letters/numbers that appear skipped in the document body.
2. For EACH item in your enumeration, individually search the ENTIRE document (and the full folder) before concluding it is absent. An exhibit heading page that appears blank may have its actual content on the following page — read past the heading before deciding.
3. Only flag an exhibit as missing if, after reading the complete document and all other files in the folder, that exhibit's content is genuinely nowhere to be found AND no cover/heading page for it exists either.
4. Generate ONE missing-exhibit finding for EACH absent exhibit. If 4 exhibits are missing, output 4 separate findings — not a single combined finding and not just 1 or 2 of the 4.
5. Do NOT flag exhibits based on a single page that looks blank — always check the pages immediately following.
6. Do NOT flag exhibits that are referenced only in passing body text if they are not separately listed in an index.
7. PARTIAL-EXHIBIT EXCEPTION: If only the cover/heading page of an exhibit is present (e.g., "Exhibit C, Page 1" exists but the next page is Exhibit D), do NOT flag this as missing at the initial review. The cover page satisfies initial completeness — substantive content is for the abstracting reviewer's later review.

⚠️ EXHIBIT READING RULE: An exhibit heading (e.g., "EXHIBIT B — FLOOR PLAN") followed by a page that appears blank or sparse does NOT mean the exhibit is missing. The actual content may be on the next page or pages. You must read the complete document before concluding any exhibit is absent.

Note: Many commercial leases include all exhibits within the same PDF. Only flag if an exhibit index entry has NO corresponding content anywhere in the entire document after reading it fully.

Output format:
• "Exhibit A (Legal Description of Landlord's Center) to Lease dated 8/11/20."
• "Exhibit C (Floor Plan) to Lease dated 8/11/20."

────────────────────────────────────────────────────────────────
CHECK 3: LEASE CURRENCY
────────────────────────────────────────────────────────────────
Find ALL lease term expiration, termination, and extension dates across ALL documents.

Steps:
1. Identify the original lease term expiration date
2. Identify any extended or amended expiration dates from all amendments
3. Determine the MOST RECENT controlling expiration date
4. Compare to today: ${todayStr}

CRITICAL OUTPUT RULE:
- If the lease IS current (not expired, not expiring within 90 days): OUTPUT NOTHING FOR THIS CHECK. Do not write a note, do not acknowledge currency. Silence = current.
- If expired: flag "Document extending Term beyond [most recent expiration date]."
- If expiring within 90 days: flag "Document extending Term beyond [expiration date]. NOTE: Expiring within 90 days."
- If in holdover with no formal extension: flag this.
- Only flag if something is WRONG. A current lease with a clear expiration date is not a finding.

────────────────────────────────────────────────────────────────
CHECK 4: MISSING REFERENCED DOCUMENTS
────────────────────────────────────────────────────────────────
This check applies everywhere — not just Recitals. Any time ANY document in the folder names or references another specific document, you must verify that document is actually present in the folder.

STEP 1 — COLLECT ALL REFERENCES:
As you read every document in the folder, build a running list of every specific document that is named or referenced. Look in ALL of these places:
- Recitals / Witnesseth / Background sections (most common)
- Estoppel Certificates (often list all documents in the chain)
- Body text: "as amended by the First Amendment dated...", "pursuant to that certain Side Letter dated...", "subject to the terms of the Agreement dated..."
- Signature blocks and notary acknowledgments
- Exhibit indexes and exhibit text
- Any clause that names a specific dated document by title

STEP 2 — VERIFY EACH REFERENCED DOCUMENT IS IN THE FOLDER:
For each document you collected in Step 1, actively search across ALL files in the folder to determine if it is physically present. Do not assume it is absent just because you haven't seen it yet — check everything received.

A document is considered PRESENT if:
- It exists as its own separate file in the folder, OR
- Its content is embedded within another document in the folder (e.g., an exhibit within the lease PDF)

A document is considered MISSING only if, after searching all received files, it genuinely cannot be found anywhere.

STEP 3 — FLAG ONLY CONFIRMED ABSENCES (AND ONLY IN-SCOPE DOCUMENTS):
Only after completing the full folder search, flag documents that are referenced but confirmed absent.

CRITICAL — These document types are OUT OF SCOPE and must NEVER be flagged even if referenced and absent:
- COIs / certificates of insurance
- HVAC contracts, pest control agreements, maintenance contracts
- Business licenses and operational permits
- Broker agreements and commission agreements
- Franchise agreements
- Government permits, Notices of Commencement, development orders, building permits
- SNDAs (Subordination, Non-Disturbance, Attornment agreements)
- Sub-exhibits (Exhibit A-1, A-2, exhibits within exhibits, electrical proposals embedded in exhibits)
- Any pre-existing lease or amendment that is superseded by an Amended & Restated Lease in the folder

Output format for the missingDocument field:
• "Agreement dated 12/9/75."
• "First Amendment to Lease dated 9/30/14."

Output format for the evidence/comment field:
• "Referenced in Second Amendment to Lease dated 8/1/15, Page 1, Recitals."

────────────────────────────────────────────────────────────────
CHECK 5: MISSING AMENDMENT SEQUENCE
────────────────────────────────────────────────────────────────
Identify ALL amendments received and check for gaps in numbering.

Examples of gaps to flag:
- Amendment 1 and Amendment 3 present → flag Missing Amendment 2
- "First Amendment" and "Third Amendment" present → flag "Second Amendment to Lease"
- A Recital in the Third Amendment says "as amended by the First Amendment... and the Second Amendment..." but no Second Amendment is in the folder → flag it

For the evidence/comment field, note exactly how you detected the gap:
- Which amendments are present (e.g., "First and Third Amendment received, Second Amendment absent")
- OR which document's Recitals revealed the gap (e.g., "Third Amendment to Lease dated 6/15/23, Page 1, Recitals references Second Amendment which is not in folder")

Output format for the missingDocument field:
• "Second Amendment to Lease dated [date range if inferable, otherwise omit date]."

Output format for the evidence/comment field:
• "First Amendment to Lease dated 3/1/18 and Third Amendment to Lease dated 5/1/22 received — Second Amendment absent."
• "Referenced in Third Amendment to Lease dated 5/1/22, Page 1, Recitals."

CRITICAL OUTPUT RULE: If the amendment chain is complete and no gap exists — output NOTHING for this check. Do not write a note confirming completeness. Only create a finding if a document is genuinely missing.

────────────────────────────────────────────────────────────────
CHECK 6: MISSING PAGES — DUAL-CONFIRMATION REQUIRED
────────────────────────────────────────────────────────────────
Page gap detection requires TWO independent signals before flagging. One signal alone is never enough.

━━━ SIGNAL 1: PAGE NUMBER SEQUENCE SCAN ━━━

For each document, track the printed page numbers as you read page by page. After reading the full document, check for gaps in the sequence.

Common false positives — these produce a number gap but are NOT real missing pages. Do NOT flag:
- Dual numbering systems: the document uses both printed body page numbers AND PDF page numbers — these often diverge
- Cover page with no printed number: a cover page with no number causes the body to start at a high number (e.g., body starts at "19") — not a gap
- Blank separator pages between exhibits that have no printed number
- Exhibit sections that restart numbering from 1 (normal)
- Roman numeral front matter (i, ii, iii) before body pagination

━━━ SIGNAL 2: CONTENT GAP SCAN ━━━

Independently of page numbers, look for content scars that prove something is structurally missing:
- A sentence or clause ends mid-thought with no continuation on the next page
- The table of contents or body text references a Section (e.g., "Section 14") that never appears anywhere in the document
- The body jumps from Section 12 directly to Section 16 with Sections 13–15 absent
- A signature page is promised ("IN WITNESS WHEREOF...") but the document ends without one
- The document states it is "15 pages" but you counted far fewer AND the content seems incomplete
- An amendment recital references a document that structurally must exist (e.g., "the Lease as amended by the First, Second, and Third Amendments") but one is absent from the folder

━━━ DUAL-CONFIRMATION RULE ━━━

ONLY flag a page gap finding when BOTH signals fire:
✅ Signal 1 (number gap) AND Signal 2 (content scar) → FLAG IT — high confidence real gap
⚠️ Signal 1 only (number gap, no content issue) → DO NOT FLAG — likely false positive (dual numbering, cover page, etc.)
⚠️ Signal 2 only (content scar, no number gap) → FLAG IT as content truncation, not a page number gap
❌ Neither signal → clean document, no flag

Output format:
• "Pages 5 to 7 of Lease dated 8/22/23 appear to be missing — page numbering jumps from 4 to 8 AND body text in Section 6 ends mid-clause with no continuation."
• "Lease dated 4/1/19 appears truncated — body jumps from Section 12 to Section 16 with Sections 13–15 absent and no page number gap detected."
• "Lease dated 8/22/23, Section 5.2 references 'Schedule 1 — Work Letter' but no Schedule 1 is present anywhere in this document or folder."

────────────────────────────────────────────────────────────────
CHECK 7: LEGIBILITY / SCAN QUALITY
────────────────────────────────────────────────────────────────
Flag ONLY documents where critical content is genuinely unreadable.

CRITICAL — These are NOT legibility issues and must NOT be flagged:
- Dark shadows or smudges on edges of pages — acceptable if key content is readable
- DocuSign overlays, electronic signature background patterns, or textured scan backgrounds — always acceptable
- A single extra mark, line, or artifact in a signature panel
- Scan quality that is imperfect but where signatures, dates, names, and key terms can still be discerned
- Signatures that appear stylized, small, or informal — not a legibility issue

ONLY flag legibility if:
- Key terms, dates, names, or signature blocks are genuinely unreadable (not just imperfect)
- A page is so dark, blurry, or cut off that its content cannot be determined at all

Output format:
• "First Amendment to Lease dated 7/1/24 is not scanned properly. Portions of page 2 are not legible."

────────────────────────────────────────────────────────────────
CHECK 8: SPECIAL AGREEMENTS (SCOPE CONFIRMATION)
────────────────────────────────────────────────────────────────
Identify any of the following non-standard agreement types found in the folder:

- License Agreement
- Declaration (CC&Rs, REA, Operating Agreement)
- Easement Agreement
- Access Agreement
- Telecommunications / Telecom Agreement
- Parking Agreement
- Right of First Refusal or Option Agreement
- Any other non-standard agreement type

CRITICAL — Do NOT flag these as special agreements (they are always out of scope):
- SNDAs (Subordination, Non-Disturbance, Attornment) — always out of scope, never flag
- Broker agreements, commission agreements — always out of scope
- COIs, insurance certificates — always out of scope

For each in-scope type found, flag it and ask for scope confirmation.

Output format for the missingDocument field:
• "Telecom Agreement dated 3/15/18 — See comments."

Output format for the comment:
• "Please confirm if w/in abstracting scope."

────────────────────────────────────────────────────────────────
CHECK 9: GUARANTY EXECUTION
────────────────────────────────────────────────────────────────
Search ALL documents AND all exhibits for any Guaranty, Personal Guarantee, Corporate Guarantee, or Surety.

Rules:
- A Guaranty found ANYWHERE (including as an exhibit) MUST be signed by the guarantor(s)
- Blank guaranty signature lines = HIGH severity
- Partially signed guaranties (e.g., guarantor signed but witness/notary blank) = MEDIUM severity
- Check for corporate guaranties that may require officer signature + corporate seal

Output format:
• "Guaranty (Exhibit G of Lease dated 9/1/21) is not executed."
• "Personal Guarantee dated 3/20/18 is not executed by Guarantor."

────────────────────────────────────────────────────────────────
CHECK 10: TENANT NAME MATCHING
────────────────────────────────────────────────────────────────
The expected tenant name from the folder label is: "${tenant.tenantName}"

Steps:
1. Find the tenant's exact legal name in the most recent amendment's signature block
2. Find the tenant's exact legal name in the original lease's signature block and preamble
3. Compare these to the folder label name

CRITICAL: Folder names and file names are assigned by the client and are IRRELEVANT to this check. Never compare a folder name or file name to a legal entity name. Only compare legal entity names as they appear within the document content itself.

IMPORTANT — do NOT flag these as mismatches:
- Punctuation differences: "Corp." vs "Corp" vs "Corporation"
- Common abbreviations: "Inc." vs "Inc" vs "Incorporated", "LLC" vs "L.L.C."
- Capitalization differences: "THE PIZZA PLACE" vs "The Pizza Place"
- Minor spacing or formatting differences
- Trade name vs legal entity where the connection is obvious
- d/b/a names vs legal entity names where the connection is clear
- Entity type conversions where the business is clearly the same (e.g., from LLC to Corp)

ONLY flag if:
- The base entity name is materially different (different words, suggesting a different owner or assignee)
- There is evidence of an assignment to a different entity that may not be documented
- The tenant name in documents is completely unrecognizable from the folder label

If discrepancy is minor (abbreviation, formatting, d/b/a): do NOT flag — these are expected
If discrepancy is significant and potentially a different entity: flag as MEDIUM severity for confirmation

${'═'.repeat(70)}
SELF-VERIFICATION — MANDATORY BEFORE OUTPUTTING
${'═'.repeat(70)}

Before you write a single character of JSON output, you MUST conduct an internal review of every finding you are about to report. Act as a second senior paralegal who is skeptical and will reject any finding that is not iron-clad.

You are a senior commercial real estate paralegal with 20+ years of experience. You use professional judgment — including reasonable inference — to identify issues. A real issue does not always announce itself in writing. Sometimes you KNOW something is missing because of what the document says, what it references, what the standard practice requires, or what a trained eye can see.

For EACH finding, run it through this quality check:

1. WHAT IS MY BASIS FOR THIS FINDING?
   — It may be: (a) direct text evidence (signature block blank, exhibit listed but absent, page numbers skip), OR
   — (b) professional inference (a lease references "the Guaranty attached hereto as Exhibit G" — no guaranty exists anywhere — that is a real finding even if no page number proves it), OR
   — (c) structural knowledge (a 2nd Amendment exists but no 1st Amendment is in the folder — that is a real finding based on standard document sequencing)
   — ALL THREE BASES ARE VALID. Do not delete findings just because they are inferred rather than directly proven.
   — The only things to delete: pure speculation with no basis in the document text or standard practice.

2. AM I BEING PRECISE OR SLOPPY?
   — Sloppy: "Some documents may be missing." DELETE.
   — Precise: "Exhibit C (Rules and Regulations) is listed on page 2 of the Lease exhibit index but no Exhibit C document is present in the folder." KEEP.
   — Every finding must identify specifically WHAT is missing or wrong and WHERE the basis for that conclusion comes from.

3. COULD THERE BE AN INNOCENT EXPLANATION?
   — Could the "missing" exhibit be embedded within the same PDF already reviewed? If yes, recheck before flagging.
   — Could the "name mismatch" just be a punctuation/abbreviation difference? If yes, do NOT flag.
   — Could the "unsigned" block be a witness/notary line rather than the party's own signature? If yes, reassess severity.
   — Use judgment. If the explanation is obvious and harmless, lower severity or remove. If ambiguous, flag at MEDIUM for confirmation.

4. IS THE SEVERITY CALIBRATED CORRECTLY?
   — HIGH: missing core document, unexecuted lease/amendment, expired lease with no extension
   — MEDIUM: name discrepancy needing confirmation, partially signed document, scope confirmation needed
   — LOW: minor formatting issue, cosmetic concern, informational note
   — Do not mark everything HIGH. Reserve HIGH for genuinely critical issues.

5. allClear IS VALID — DO NOT MANUFACTURE FINDINGS
   — If after honest review there are no real issues, allClear: true is the correct and professional result.
   — Do not add findings to justify your existence. A clean folder is a good outcome.

After completing this review, output only findings that are specific, well-grounded (by evidence OR professional inference), and correctly calibrated.

${'═'.repeat(70)}
JSON OUTPUT FORMAT
${'═'.repeat(70)}

Return ONLY this JSON object with no surrounding text, no markdown, no code fences:

{
  "tenantNameInDocuments": "exact legal name as found in the most recent document signature block",
  "mostRecentDocumentDate": "date of the most recent document found, or null",
  "leaseExpirationDate": "controlling expiration date as found in documents, or null if undeterminable",
  "findings": [
    {
      "checkType": "EXECUTION | EXHIBIT | CURRENCY | REFERENCED_DOC | AMENDMENT_GAP | MISSING_PAGE | LEGIBILITY | SPECIAL_AGREEMENT | GUARANTY | NAME_MISMATCH",
      "severity": "HIGH | MEDIUM | LOW",
      "missingDocument": "the missing or problematic document name formatted per the instructions above; use 'N/A' only for non-document issues like legibility",
      "comment": "specific, actionable description of the issue for the reviewer",
      "evidence": "REQUIRED — exact document name and date, page number, section/clause name, and verbatim text or key date that triggered this finding"
    }
  ],
  "allClear": true,
  "crossBatchReferences": [
    {
      "documentName": "exact name of document referenced or spotted that may be in another batch",
      "referencedIn": "which document in THIS batch contains the reference — name, page, section",
      "issue": "what needs cross-batch verification — e.g. 'This amendment extends expiration to [date] — verify no later amendment exists', 'This agreement is referenced but I cannot confirm its content from another batch', 'Amendment sequence gap — verify batch contains missing amendment'"
    }
  ]
}

IMPORTANT — crossBatchReferences:
- Only populate this field when this folder is being processed in multiple batches (you will be told if it is)
- Use it to flag anything you spotted that DEPENDS ON or MAY BE RESOLVED BY documents in another batch
- Examples: an expiration date you found that might be extended by an amendment in another batch; a referenced document you cannot locate but which may be in another batch; an amendment gap that might be filled by a document in another batch
- The synthesis pass will use these to reconcile findings across all batches
- Leave as empty array [] if processing as a single batch or if nothing needs cross-batch verification

IMPORTANT:
- allClear must be true ONLY if findings is empty after thorough review of all 10 checks
- Each distinct issue must be its own separate finding object
- Do not combine multiple separate issues into one finding
- If no document was received at all for this tenant, create a single finding: checkType "REFERENCED_DOC", severity "HIGH", missingDocument "Lease and any amendments", comment "No lease documents were received for this tenant", evidence "N/A"
- The evidence field is MANDATORY for every finding — never omit it`
}

// ═══════════════════════════════════════════════════════════
// API CALL WITH RETRY
// ═══════════════════════════════════════════════════════════

async function callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo = null, options = {}) {
  const cheap = !!options.cheapMode
  const model = pickClaudeModel(cheap)
  const max_tokens = pickClaudeMaxTokens(cheap, 16384)
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)

    // Use beta.messages for PDF document support + prompt caching on the system prompt
    const response = await createBetaMessageWithFailover({
      model,
      max_tokens,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25', 'prompt-caching-2024-07-31'],
      system:     [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content }]
    })

    const rawText = response.content[0]?.text || ''
    return parseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, options)

  } catch (err) {
    // ── 413: request body too large (HTTP level) ─────────────
    if (err.status === 413) {
      if (pdfDocs.length > 0) {
        console.log(`[claude] 413 for ${tenant.tenantName} — dropping ${pdfDocs.length} native PDF(s), retrying text-only`)
        return callWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo, options)
      }
      if (textDocs.length > 0) {
        console.log(`[claude] 413 for ${tenant.tenantName} even in text-only mode — truncating text content`)
        const trimmed = textDocs.map(d => ({
          ...d,
          text: d.text ? d.text.substring(0, 50000) + '\n[...truncated due to size...]' : d.text
        }))
        return callWithRetry(tenant, [], trimmed, pageGapFindings, attempt + 1, batchInfo, options)
      }
      throw new Error(`Request too large even after all fallbacks for ${tenant.tenantName}`)
    }

    // ── 400 "prompt is too long" (token limit exceeded) ──────
    // Batching should prevent this, but handle as last resort: drop PDFs → text-only
    if (err.status === 400 &&
        (err?.message?.toLowerCase().includes('too long') ||
         err?.message?.includes('1000000') ||
         err?.message?.toLowerCase().includes('maximum'))) {
      if (pdfDocs.length > 0) {
        console.log(`[claude] 400 token overflow for ${tenant.tenantName} — falling back to text-only`)
        return callWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo, options)
      }
      throw new Error(formatClaudeError(err))
    }

    // ── Network / connection errors (no err.status) ───────────
    if (isRetryableNetworkError(err) && attempt < 3) {
      const delay = Math.pow(2, attempt + 1) * 2500
      console.log(`[claude] Network error for ${tenant.tenantName}, retry in ${delay}ms: ${err.message}`)
      await sleep(delay)
      return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }

    // ── 429: createBetaMessageWithFailover already tried both keys;
    //         just retry the whole batch call (attempt limit prevents loops)
    if (err.status === 429 && attempt < 3) {
      if (_KEYS.length > 1) {
        console.warn(`[claude] 429 for ${tenant.tenantName} — retrying (attempt ${attempt + 1})`)
        return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
      }
      // No backup key — wait 65s
      console.log(`[claude] 429 for ${tenant.tenantName} — no backup key, waiting 65s...`)
      await sleep(65000)
      return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }

    // ── 5xx / 529: transient server errors ───────────────────
    const retryable = err.status === 529 || (err.status >= 500 && err.status < 600)
    if (retryable && attempt < 3) {
      const delay = Math.pow(2, attempt + 1) * 1500
      console.log(`[claude] Retrying ${tenant.tenantName} in ${Math.round(delay/1000)}s (attempt ${attempt + 1})...`)
      await sleep(delay)
      return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }
    throw new Error(formatClaudeError(err))
  }
}

function parseResponse(text, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo = null, options = {}) {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)

  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      throw new Error('findings array missing')
    }
    return parsed
  } catch (e) {
    if (attempt < 1) {
      console.log(`[claude] JSON parse failed for ${tenant.tenantName}, retrying with explicit prompt...`)
      // Rebuild content with explicit JSON instruction appended
      const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)
      content.push({
        type: 'text',
        text: '\n\n⚠️ YOUR PREVIOUS RESPONSE WAS NOT VALID JSON. Return ONLY the JSON object. Start your response with { and end with }. No other text whatsoever.'
      })
      return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }

    console.error(`[claude] Could not parse response for ${tenant.tenantName}:`, text.substring(0, 300))
    return {
      tenantNameInDocuments: 'Parse error — manual review required',
      mostRecentDocumentDate: null,
      leaseExpirationDate:    null,
      findings: [{
        checkType:       'LEGIBILITY',
        severity:        'HIGH',
        missingDocument: 'N/A',
        comment:         'Claude API returned an unparseable response. Manual document review is required.',
        evidence:        `Raw response preview: ${text.substring(0, 300)}`
      }],
      allClear: false
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ═══════════════════════════════════════════════════════════
// DOUBLE-CHECK MODE — reviewer second pass
// Run 1: base model reads all docs, produces findings
// Run 2: same documents + Run 1 findings → senior reviewer
//         confirms, corrects, removes false positives, adds misses
// ═══════════════════════════════════════════════════════════

const DOUBLE_CHECK_SYSTEM_PROMPT = `You are a senior commercial real estate paralegal with 20+ years of experience performing SECOND-PASS QUALITY REVIEW of document audits.

A junior analyst has already reviewed this tenant folder and produced a set of findings. You have been given both the original documents AND the junior analyst's findings. Your job is to act as the strict senior reviewer who signs off on (or corrects) every finding before it goes to the attorney.

YOUR ROLE:
1. Read every document thoroughly yourself — do not rely solely on what the junior analyst said
2. For each finding the junior analyst produced, assign a reviewStatus:
   — "CONFIRMED"  if you independently verify the same issue with your own evidence
   — "CORRECTED"  if the issue is real but the details are wrong (fix document name, date, severity, or comment) — explain what was wrong in reviewNote
   — "REMOVED"    if you cannot find any basis for it after carefully reading the documents — this is a false positive, it goes in removedFindings not in findings
3. After reviewing all junior findings, perform your own independent full scan and add anything the junior missed — use reviewStatus "ADDED" and explain briefly in reviewNote why it was missed or why it matters
4. Every finding you keep, correct, or add must cite exact evidence — document name, page number, section, verbatim text
5. allClear: true ONLY if after your complete review the findings array is empty

This dual-pass system catches both false positives (junior flagged something unreal → REMOVED) and false negatives (junior missed something real → ADDED). Both failure modes matter equally.

All standard paralegal rules apply: read every page, check all 10 standard checks, require exact evidence.`

/**
 * Build content blocks for the double-check reviewer pass.
 * Same document blocks as normal but with first-pass findings injected.
 */
function buildDoubleCheckContent(tenant, pdfDocs, textDocs, pageGapFindings, firstPassResult, batchInfo = null) {
  // Start with the standard content blocks (header, docs, text, page gaps)
  const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)

  // Inject first-pass findings before the analysis instructions block
  // (analysis instructions are always the last block from buildContent)
  const firstPassFindings = (firstPassResult?.findings || [])
  const findingsText = firstPassFindings.length === 0
    ? 'No findings — junior analyst returned allClear.'
    : firstPassFindings.map((f, i) =>
        `Finding ${i + 1}:
  checkType:       ${f.checkType}
  severity:        ${f.severity}
  missingDocument: ${f.missingDocument}
  comment:         ${f.comment}
  evidence:        ${f.evidence}`
      ).join('\n\n')

  // Insert first-pass findings block just before the last block (analysis instructions)
  const reviewBlock = {
    type: 'text',
    text: `${'═'.repeat(70)}
JUNIOR ANALYST FIRST-PASS FINDINGS — REVIEW THESE AGAINST THE DOCUMENTS
${'═'.repeat(70)}
The following findings were produced by the first-pass analysis. Your job is to verify every single one against the actual documents attached above.

For EACH finding below:
  ✓ CONFIRM  — if you independently find the same issue in the documents (update evidence with your own citation)
  ✗ REMOVE   — if you cannot find any basis for it after reading the documents carefully (false positive)
  ✎ CORRECT  — if the issue is real but the details are wrong (fix the document name, date, or severity)

After reviewing all findings below, also perform your own independent full scan and add anything missed.

${'─'.repeat(70)}
${findingsText}
${'─'.repeat(70)}

Now read the documents above carefully and produce the final verified findings list.`
  }

  // Insert the review block second-to-last (before analysis instructions)
  content.splice(content.length - 1, 0, reviewBlock)

  // Append double-check specific JSON format AFTER the standard analysis instructions
  content.push({
    type: 'text',
    text: `${'═'.repeat(70)}
REVIEWER JSON OUTPUT FORMAT (OVERRIDES STANDARD FORMAT FOR THIS PASS)
${'═'.repeat(70)}

Return ONLY this JSON — no markdown, no code fences, no other text:

{
  "tenantNameInDocuments": "exact legal name from most recent document signature block",
  "mostRecentDocumentDate": "date of most recent document, or null",
  "leaseExpirationDate": "controlling expiration date from documents, or null",
  "findings": [
    {
      "checkType": "EXECUTION | EXHIBIT | CURRENCY | REFERENCED_DOC | AMENDMENT_GAP | MISSING_PAGE | LEGIBILITY | SPECIAL_AGREEMENT | GUARANTY | NAME_MISMATCH",
      "severity": "HIGH | MEDIUM | LOW",
      "missingDocument": "missing or problematic document name; use N/A for non-document issues",
      "comment": "specific actionable description of the issue",
      "evidence": "REQUIRED — exact document name+date, page number, section/clause, verbatim text or date",
      "reviewStatus": "CONFIRMED | CORRECTED | ADDED",
      "reviewNote": "For CONFIRMED: leave empty string. For CORRECTED: one sentence explaining what the junior got wrong and what you fixed. For ADDED: one sentence explaining what was missed and why it matters."
    }
  ],
  "removedFindings": [
    {
      "originalFinding": "brief description of the junior finding that was removed (checkType + what it claimed)",
      "reason": "one sentence explaining why this is a false positive — cite the document/page that disproves it"
    }
  ],
  "allClear": false
}

CRITICAL RULES FOR THIS REVIEWER PASS:
- Every finding in "findings" must have reviewStatus: "CONFIRMED", "CORRECTED", or "ADDED"
- Do NOT put REMOVED findings in the findings array — they go in removedFindings only
- If the junior had no findings and you found nothing either: findings=[], removedFindings=[], allClear=true
- If the junior had no findings but you found issues: all your findings get reviewStatus "ADDED"
- reviewNote is required for CORRECTED and ADDED; use empty string "" for CONFIRMED`
  })

  return content
}

/**
 * Reviewer second pass — takes first-pass result + all documents,
 * verifies findings and returns a corrected/enriched result.
 */
export async function doubleCheckFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], firstPassResult = null, batchInfo = null, options = {}) {
  return doubleCheckCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, firstPassResult, 0, batchInfo, options)
}

async function doubleCheckCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, firstPassResult, attempt, batchInfo, options = {}) {
  const cheap      = !!options.cheapMode
  const model      = pickClaudeModel(cheap)
  const max_tokens = pickClaudeMaxTokens(cheap, 16384)
  try {
    const content = buildDoubleCheckContent(tenant, pdfDocs, textDocs, pageGapFindings, firstPassResult, batchInfo)

    const response = await createBetaMessageWithFailover({
      model,
      max_tokens,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25', 'prompt-caching-2024-07-31'],
      system:     [{ type: 'text', text: DOUBLE_CHECK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content }]
    })

    const rawText = response.content[0]?.text || ''
    return parseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, options)
  } catch (err) {
    if (err.status === 413) {
      if (pdfDocs.length > 0) {
        console.log(`[claude/doublecheck] 413 for ${tenant.tenantName} — retrying text-only`)
        return doubleCheckCallWithRetry(tenant, [], textDocs, pageGapFindings, firstPassResult, attempt, batchInfo, options)
      }
    }
    const retryable = isRetryableNetworkError(err) ||
      err.status === 529 || (err.status >= 500 && err.status < 600) || err.status === 429
    if (retryable && attempt < 3) {
      const delay = err.status === 429 ? 65000 : Math.pow(2, attempt + 1) * 1500
      console.log(`[claude/doublecheck] Retrying ${tenant.tenantName} in ${Math.round(delay / 1000)}s...`)
      await sleep(delay)
      return doubleCheckCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, firstPassResult, attempt + 1, batchInfo, options)
    }
    throw new Error(formatClaudeError(err))
  }
}

// ═══════════════════════════════════════════════════════════
// BEEFED-UP MODE — standard analysis but with active learnings
//                  injected into the system prompt
// ═══════════════════════════════════════════════════════════

/**
 * Like analyzeFolder but prepends active learnings to the system prompt.
 * @param {Array} learnings  — [{ checkType, suggestion, active }] from learnings.json
 */
export async function beefedUpAnalyzeFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null, learnings = [], options = {}) {
  const activeLearnings = (learnings || []).filter(l => l.active)
  return beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, 0, batchInfo, activeLearnings, options)
}

function buildBeefedUpSystemPrompt(activeLearnings) {
  if (!activeLearnings || activeLearnings.length === 0) return SYSTEM_PROMPT

  const learningBlock = activeLearnings.map((l, i) =>
    `LEARNING ${i + 1} [${l.checkType}]: ${l.suggestion}`
  ).join('\n')

  return `${SYSTEM_PROMPT}

${'═'.repeat(70)}
APPLIED LEARNINGS — ADDITIONAL RULES FROM TRAINING (DO NOT IGNORE)
${'═'.repeat(70)}
The following rules have been validated by human experts reviewing past audits.
Apply these in addition to all standard rules above:

${learningBlock}

GENERALIZATION: For each learning, extract the underlying principle and apply it to whatever property type, lease structure, jurisdiction, and document set appears in this folder. Do not assume the training example's tenant name, layout, or missing-doc wording matches the current job—adapt the rule intelligently.
${'═'.repeat(70)}`
}

async function beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, activeLearnings, options = {}) {
  const cheap = !!options.cheapMode
  const model = pickClaudeModel(cheap)
  const max_tokens = pickClaudeMaxTokens(cheap, 16384)
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)
    const beefedSystemPrompt = buildBeefedUpSystemPrompt(activeLearnings)

    const response = await createBetaMessageWithFailover({
      model,
      max_tokens,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25', 'prompt-caching-2024-07-31'],
      system:     [{ type: 'text', text: beefedSystemPrompt, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content }]
    })

    const rawText = response.content[0]?.text || ''
    return parseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, options)
  } catch (err) {
    if (err.status === 413) {
      if (pdfDocs.length > 0) return beefedUpCallWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo, activeLearnings, options)
      if (textDocs.length > 0) {
        const trimmed = textDocs.map(d => ({ ...d, text: d.text ? d.text.substring(0, 50000) + '\n[...truncated...]' : d.text }))
        return beefedUpCallWithRetry(tenant, [], trimmed, pageGapFindings, attempt + 1, batchInfo, activeLearnings, options)
      }
      throw new Error(`Request too large for ${tenant.tenantName}`)
    }
    if (isRetryableNetworkError(err) && attempt < 3) {
      const delay = Math.pow(2, attempt + 1) * 2500
      console.log(`[claude/beefed] Network error for ${tenant.tenantName}, retry in ${delay}ms: ${err.message}`)
      await sleep(delay)
      return beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, activeLearnings, options)
    }
    const retryable = err.status === 529 || (err.status >= 500 && err.status < 600) || err.status === 429
    if (retryable && attempt < 3) {
      const delay = err.status === 429 ? 65000 : Math.pow(2, attempt + 1) * 1500
      await sleep(delay)
      return beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, activeLearnings, options)
    }
    throw new Error(formatClaudeError(err))
  }
}

// ═══════════════════════════════════════════════════════════
// GYM MODE — richer analysis with full reasoning traces
// ═══════════════════════════════════════════════════════════

/**
 * Build system prompt with active learning juice rules injected.
 * Used by Target Practice sessions so each tenant benefits from prior corrections.
 */
function buildJuiceSystemPrompt(juiceRules) {
  if (!juiceRules || juiceRules.length === 0) return SYSTEM_PROMPT
  const rulesBlock = juiceRules.map((r, i) => {
    const typeLabel = r.type === 'AVOID_FALSE_POSITIVE' ? '⚠️ AVOID FALSE POSITIVE' : '🔍 IMPROVE DETECTION'
    return `RULE ${i + 1} [${r.checkType}] ${typeLabel} (confidence: ${r.confidence || 1}):\n${r.rule}${r.triggeredBy ? `\n  → Learned from: ${r.triggeredBy}` : ''}`
  }).join('\n\n')
  return `${SYSTEM_PROMPT}

${'═'.repeat(70)}
ACTIVE LEARNING — EXPERT-VALIDATED RULES FROM THIS SESSION
${'═'.repeat(70)}
An expert paralegal reviewed prior tenant analyses in this session and generated these correction rules. Apply them to sharpen your analysis.

${rulesBlock}

IMPORTANT: These rules refine your judgment — they do not override it. If you see clear direct evidence of a real issue that appears to contradict a rule, flag it anyway and explain.
${'═'.repeat(70)}`
}

/**
 * Active Learning synthesis — called after each tenant review to update session rules.
 * Returns { rules, summary } where rules is the full updated rule set.
 */
export async function synthesizeActiveLearning({ rejectedFindings = [], confirmedFindings = [], annotations = [], currentRules = [] }) {
  const rejectedBlock = rejectedFindings.length > 0
    ? rejectedFindings.map((f, i) => {
        const parts = [`${i + 1}. [${f.checkType}] "${f.missingDocument}"`]
        if (f.triggerQuote)                   parts.push(`   → Exact text that triggered the AI: "${f.triggerQuote.slice(0,300)}"`)
        if (f.reasoning)                      parts.push(`   → AI's step-by-step reasoning:      "${f.reasoning.slice(0,400)}"`)
        else if (f.comment)                   parts.push(`   → AI comment: ${f.comment}`)
        if (f.checkedAndEliminated?.length)   parts.push(`   → What AI checked/eliminated:       ${f.checkedAndEliminated.slice(0,3).join(' | ')}`)
        if (f.howIFoundThis)                  parts.push(`   → How AI found it:                  "${f.howIFoundThis}"`)
        parts.push(`   → Expert verdict:                   "${f.reviewerNote || 'Marked wrong — no details'}"`)
        return parts.join('\n')
      }).join('\n\n')
    : 'None — all findings were confirmed or no findings were generated.'

  const confirmedBlock = confirmedFindings.length > 0
    ? confirmedFindings.map((f, i) => {
        const parts = [`${i + 1}. [${f.checkType}] "${f.missingDocument}"`]
        if (f.triggerQuote) parts.push(`   → Trigger pattern: "${f.triggerQuote.slice(0,200)}"`)
        if (f.reasoning)    parts.push(`   → Correct reasoning: "${f.reasoning.slice(0,200)}"`)
        else if (f.evidence) parts.push(`   → Evidence: ${f.evidence}`)
        return parts.join('\n')
      }).join('\n')
    : 'None'

  const annotationsBlock = annotations.length > 0
    ? annotations.map((a, i) => `${i + 1}. Reviewer flagged: "${a.comment}" on ${a.docName || 'unknown doc'} p.${a.pageNum || '?'}`).join('\n')
    : 'None'

  const currentRulesBlock = currentRules.length > 0
    ? currentRules.map((r, i) => `RULE ${i + 1} [${r.id}][${r.checkType}] ${r.type} (confidence ${r.confidence || 1}): ${r.rule}`).join('\n')
    : 'None yet — this is the first tenant in the session.'

  const prompt = `You are the active learning engine for Todd Jr., a real estate document review AI.

A paralegal just reviewed the AI's output on one tenant folder. Your job is to extract GENERALIZABLE REASONING PATTERNS — not memorize answers.

═══ WRONG FLAGS — AI'S REASONING CHAIN FOR EACH MISTAKE ═══
For each wrong flag below, you see: (1) the exact text that triggered the AI, (2) the AI's
step-by-step reasoning that led to the wrong conclusion, (3) what the AI checked to try to
verify its answer, and (4) what the expert said was wrong.
YOUR JOB: identify the specific REASONING STEP that was flawed, and write a rule that
corrects that exact step — not just says "don't flag X."
${rejectedBlock}

═══ CORRECT FLAGS — WHAT RIGHT REASONING LOOKS LIKE ═══
These show the trigger pattern and reasoning for findings that WERE correct.
Use these to understand what good evidence looks like — and protect these patterns.
${confirmedBlock}

═══ THINGS THE AI MISSED (SHOULD HAVE FLAGGED) ═══
${annotationsBlock}

═══ CURRENT SESSION RULES (accumulated from prior tenants) ═══
${currentRulesBlock}

════════════════════════════════════════════════════════════
CRITICAL INSTRUCTION — READ CAREFULLY:
════════════════════════════════════════════════════════════

You are NOT memorizing answers for this tenant. You are teaching the AI
HOW TO REASON so it finds the same class of issue in a completely different
tenant folder it has never seen before.

WRONG (memorizing the answer):
  "Always check for a Certificate of Insurance in every folder."
  "Look for Amendment No. 2 in every folder."

RIGHT (teaching a reasoning pattern):
  "When a lease clause requires tenant to maintain liability insurance naming
   landlord as additional insured, verify a current COI is on file. If absent, flag it."
  "When an amendment recites prior amendments by number (e.g. 'pursuant to Amendment No. 2'),
   confirm every referenced prior amendment is present in the folder."

The test for a good rule: Could a paralegal apply it to a folder they've NEVER seen,
with different tenant names, different document titles, and different clause numbering?
If the rule only works for THIS tenant's exact documents, it is NOT a good rule — rewrite it.

FOR MISSED ITEMS:
- Ask: what DOCUMENT EVIDENCE would indicate this item is required?
- Write the rule as a conditional: "When [evidence pattern in documents], check for [type of document/provision]"
- Never name the specific missing document as the rule itself

FOR FALSE POSITIVES (you have the AI's full reasoning chain above):
- Look at the AI's reasoning chain for each wrong flag — find the EXACT STEP where the logic broke down
- Did the AI misinterpret a document feature (e.g. dual page numbering, exhibit separator)?
- Did the AI over-generalize a pattern that only applies in some contexts?
- Write a rule that patches THAT SPECIFIC REASONING STEP, not just the conclusion
- Rules that say "never flag X" are almost always wrong — make them "only flag X when [bad reasoning pattern]; do not flag when [evidence that contradicts the concern]"
- Example: if the AI's reasoning says "I saw a page number jump from 3 to 9 and the content seemed continuous but I wasn't certain" — the rule should be: "When printed page numbers jump but the text around the gap reads continuously with no orphaned section references, treat as dual numbering — do NOT flag."

FOR CONFIRMED CORRECT FINDINGS:
- These are PROTECTED. Do not write any rule that narrows, conditions, or suppresses findings of this type.
- You may use them to understand what the AI already handles well and avoid overlap.

Keep rules from prior tenants unless directly contradicted. Increment confidence when pattern recurs across tenants.

Return ONLY valid JSON (no markdown, no prose, no code fences):
{
  "rules": [
    {
      "id": "r-1",
      "type": "AVOID_FALSE_POSITIVE",
      "checkType": "EXECUTION",
      "rule": "When [document evidence pattern], check for [what to verify] — only flag if [specific condition]",
      "triggeredBy": "What pattern in the documents led to this rule",
      "confidence": 1
    }
  ],
  "summary": "One sentence: what reasoning patterns changed and why"
}`

  const response = await createMessageWithFailover({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    temperature: 0.1,
    system: [{ type: 'text', text: `You are the active learning engine for Todd Jr., a real estate document review AI.
Your ONLY job is to extract generalizable reasoning patterns from reviewer feedback.
You must NEVER write a rule that simply names what was missing — that is memorizing the answer, not learning.
Every rule must describe the DOCUMENT EVIDENCE PATTERN that should trigger the check, and be testable against a completely different tenant folder.
Return only valid JSON.` }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  })

  const rawText = response.content[0]?.text || ''
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)
  return JSON.parse(cleaned)
}

/**
 * Deep Juice Extract — full-session synthesis for TP 2.0.
 * Receives feedback across ALL tenants and extracts cross-tenant patterns.
 * Returns { rules, summary } — same shape as synthesizeActiveLearning but richer.
 */
export async function synthesizeDeepLearning({ tenantFeedbacks = [] }) {
  if (tenantFeedbacks.length === 0) return { rules: [], summary: 'No feedback to synthesize.' }

  const n = tenantFeedbacks.length

  // ── Pre-aggregate across ALL tenants (scales to 5 or 50+) ──────────────
  // For each checkType, store count + up to 2 rich examples that include the
  // AI's own reasoning — so Claude can see exactly WHY it made the mistake.
  const rejectedByType  = {}   // checkType → { count, examples[] }
  const confirmedByType = {}   // checkType → { count, examples[] }
  const mixedTypes      = new Set()
  const allAnnotations  = []
  let totalRejected = 0, totalConfirmed = 0

  for (const fb of tenantFeedbacks) {
    // ── Rejected findings: capture the AI's full reasoning chain ──────────
    for (const f of (fb.rejectedFindings || [])) {
      const k = f.checkType || 'UNKNOWN'
      if (!rejectedByType[k]) rejectedByType[k] = { count: 0, examples: [] }
      rejectedByType[k].count++
      totalRejected++
      if (rejectedByType[k].examples.length < 2) {
        rejectedByType[k].examples.push({
          doc:          (f.missingDocument || '—').slice(0, 120),
          // triggerQuote = the exact lease text that made the AI fire this finding
          triggerQuote: (f.triggerQuote    || '').slice(0, 300),
          // reasoning    = the AI's logic: "I couldn't find X because Y"
          reasoning:    (f.reasoning       || f.comment || '').slice(0, 350),
          // reviewerNote = what the expert said was wrong about this flag
          reviewerNote: (f.reviewerNote    || 'marked wrong').slice(0, 200),
          severity:     f.severity         || '',
          tenant:       (fb.tenantName     || 'Unknown').slice(0, 60)
        })
      }
    }

    // ── Confirmed findings: capture what a CORRECT flag looks like ─────────
    // (helps Claude understand when to KEEP flagging, not just when to stop)
    for (const f of (fb.confirmedFindings || [])) {
      const k = f.checkType || 'UNKNOWN'
      if (!confirmedByType[k]) confirmedByType[k] = { count: 0, examples: [] }
      confirmedByType[k].count++
      totalConfirmed++
      if (confirmedByType[k].examples.length < 1) {
        confirmedByType[k].examples.push({
          doc:          (f.missingDocument || '—').slice(0, 100),
          triggerQuote: (f.triggerQuote    || '').slice(0, 200),
          reasoning:    (f.reasoning       || f.comment || '').slice(0, 200),
          tenant:       (fb.tenantName     || 'Unknown').slice(0, 60)
        })
      }
    }

    // ── Annotations: things the AI missed entirely ─────────────────────────
    for (const a of (fb.annotations || [])) {
      allAnnotations.push({
        comment: (a.comment || '—').slice(0, 200),
        docName: (a.docName || 'unknown').slice(0, 80),
        pageNum:  a.pageNum || '?',
        tenant:  (fb.tenantName || 'Unknown').slice(0, 60)
      })
    }
  }

  // checkTypes with both confirmed and rejected findings need CONDITIONAL rules
  for (const k of Object.keys(rejectedByType)) {
    if (confirmedByType[k]) mixedTypes.add(k)
  }

  // ── Build prompt sections ─────────────────────────────────────────────

  // SECTION A: Rejections — show AI's own reasoning chain per example
  // This is the core of deep learning: Claude sees WHY it was wrong, not just WHAT it flagged
  const rejectionLines = Object.entries(rejectedByType)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)   // top 15 most-rejected types (enough for any session)
    .map(([type, d]) => {
      const pct   = Math.round((d.count / n) * 100)
      const mixed = mixedTypes.has(type)
        ? ` ⚠️ ALSO CONFIRMED ${confirmedByType[type]?.count || 0}x — write CONDITIONAL rule, not blanket suppression`
        : ''
      const exLines = d.examples.map((e, i) => {
        const parts = []
        parts.push(`  Example ${i + 1}: flagged "${e.doc}"`)
        if (e.triggerQuote) parts.push(`    → Lease text that triggered AI: "${e.triggerQuote}"`)
        if (e.reasoning)    parts.push(`    → AI's reasoning:               "${e.reasoning}"`)
        parts.push(         `    → Reviewer correction:          "${e.reviewerNote}"`)
        return parts.join('\n')
      }).join('\n')
      return `[${type}] REJECTED ${d.count}/${n} tenants (${pct}%)${mixed}\n${exLines}`
    }).join('\n\n')

  // SECTION B: Confirmed — show what a REAL flag looks like (protect these patterns)
  const confirmLines = Object.entries(confirmedByType)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([type, d]) => {
      const ex   = d.examples[0]
      const isMixed = mixedTypes.has(type) ? ' (mixed — some also rejected)' : ''
      const exLine  = ex && ex.triggerQuote
        ? `\n    Correct-flag pattern: "${ex.triggerQuote}" → "${ex.reasoning}"`
        : ''
      return `  [${type}] confirmed correct ${d.count}x${isMixed}${exLine}`
    }).join('\n')

  // SECTION C: Missed items — blind spots to close (no tenant names — keep patterns general)
  const missedLines = allAnnotations.length > 0
    ? allAnnotations.map(a =>
        `  • "${a.comment}" — found in document: ${a.docName} p.${a.pageNum}`
      ).join('\n')
    : '  None'

  const prompt = `You are the Deep Juice synthesis engine for Todd Jr., an AI that reviews real estate lease documents.

A paralegal expert reviewed ${n} tenant lease files in one session.
Stats: ${totalConfirmed} findings confirmed correct · ${totalRejected} findings rejected as wrong · ${allAnnotations.length} items missed by AI

════════════════════════════════════════════════════
SECTION A — WRONG FLAGS  (AI fired, reviewer said WRONG)
For each: you see the exact text that triggered the AI, the AI's reasoning, and what the reviewer said.
Use this to write rules that fix the AI's misunderstanding AT THE SOURCE.
⚠️ = same checkType also had CONFIRMED correct flags → write a CONDITIONAL rule, not blanket suppression.
════════════════════════════════════════════════════
${rejectionLines || '  None'}

════════════════════════════════════════════════════
SECTION B — CONFIRMED CORRECT FLAGS  (AI fired, reviewer said RIGHT)
These are patterns the AI should KEEP doing. Do not suppress these.
Use the example trigger quotes to understand what a real missing document looks like.
════════════════════════════════════════════════════
${confirmLines || '  None'}

════════════════════════════════════════════════════
SECTION C — MISSED ITEMS  (reviewer found things AI never flagged)
These are blind spots. Write PRIORITIZE_CHECK rules so the AI looks harder in these areas.
════════════════════════════════════════════════════
${missedLines}

════════════════════════════════════════════════════
RULE WRITING INSTRUCTIONS
════════════════════════════════════════════════════

Write one rule per distinct pattern. Rules must be:

CRITICAL REQUIREMENT — RULES MUST BE FULLY GENERAL:
  ✅ Rules describe LEASE TEXT PATTERNS and DOCUMENT EVIDENCE PATTERNS that apply to any tenant.
  ❌ Never mention specific tenant names, company names, property names, or deal-specific details.
  ❌ Never say "for [tenant name]" or "in [property] leases" — the rule must apply universally.
  The trigger quote and reasoning are PROVIDED AS CONTEXT ONLY to help you understand the pattern.
  Extract the GENERALIZABLE PATTERN from the evidence — what about the lease language caused the mistake.

1. AVOID_FALSE_POSITIVE — for Section A non-mixed rejections
   Explain the LEASE LANGUAGE PATTERN that caused the AI to fire incorrectly.
   ✅ "Do not flag [checkType] when the lease contains language like [trigger pattern] — this wording confirms the document/requirement IS present, not missing."
   ❌ "Don't flag EXECUTION" (too vague — doesn't target the root cause text pattern)
   ❌ "Do not flag for Cash Cash tenant" (tenant-specific — invalid)

2. CONDITIONAL_FLAG — for ⚠️ Section A mixed types
   The same checkType was sometimes a real miss and sometimes a false alarm.
   Describe the DISTINGUISHING LEASE TEXT PATTERN precisely.
   ✅ "Flag [checkType] only when [lease text condition indicating real miss]. Do NOT flag when [lease text pattern that was incorrectly triggering]."

3. PRIORITIZE_CHECK — for Section C misses
   Tell the AI WHERE in the document to look harder and WHAT language pattern signals the item.
   ✅ "When reviewing [checkType], look for [specific clause / exhibit type / section heading] — this document type is commonly found in [exhibit/addendum/rider] rather than the main lease body."

For the "triggeredBy" field — describe the pattern frequency and root cause, NO tenant names:
  ✅ "Rejected ${Object.values(rejectedByType)[0]?.count || 'N'}/${n} times — AI misread [lease pattern] as evidence of missing document"
  ❌ "Triggered by Cash Cash example"

Confidence:
  3 = rejected or missed in >50% of tenants, or same pattern appeared 3+ times
  2 = pattern in 20–50% of tenants
  1 = single clear reviewer correction with explicit reasoning

Return ONLY valid JSON. No markdown. No text before or after the JSON object.
{
  "rules": [
    {
      "id": "r-1",
      "type": "AVOID_FALSE_POSITIVE",
      "checkType": "EXECUTION",
      "rule": "Specific, actionable instruction describing the lease text pattern that causes false positives and how to avoid it",
      "triggeredBy": "Flagged ${Object.values(rejectedByType)[0]?.count || 'N'}/${n} leases — [root cause: what lease language pattern misled the AI]",
      "confidence": 2
    }
  ],
  "summary": "One sentence naming the top 2-3 lease language patterns corrected across this ${n}-tenant session"
}`

  const response = await createMessageWithFailover({
    model:       'claude-sonnet-4-6',
    max_tokens:  16384,
    temperature: 0.1,
    system: [{
      type: 'text',
      text: 'You are the Deep Juice synthesis engine for a real estate lease review AI. Your job is to turn reviewer corrections into precise, evidence-grounded rules. Return only valid JSON — no markdown, no prose, no code fences.'
    }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  })

  const rawText = response.content[0]?.text || ''
  let cleaned   = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)
  const jsonEnd = cleaned.lastIndexOf('}')
  if (jsonEnd >= 0 && jsonEnd < cleaned.length - 1) cleaned = cleaned.substring(0, jsonEnd + 1)

  // Try normal parse first
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    // Truncated JSON recovery — salvage all complete rules before the cutoff
    console.warn('[deep-synthesize] JSON truncated — attempting recovery. Raw length:', rawText.length)
    const rulesMatch = cleaned.match(/"rules"\s*:\s*\[/)
    if (rulesMatch) {
      const start = cleaned.indexOf('[', cleaned.indexOf('"rules"'))
      const partial = cleaned.substring(start)
      // Find all complete rule objects (each ends with a closing })
      const completeRules = []
      let depth = 0, inStr = false, escape = false, ruleStart = -1
      for (let i = 0; i < partial.length; i++) {
        const c = partial[i]
        if (escape)          { escape = false; continue }
        if (c === '\\')      { escape = true;  continue }
        if (c === '"')       { inStr = !inStr; continue }
        if (inStr)           continue
        if (c === '{')       { if (depth === 0) ruleStart = i; depth++ }
        else if (c === '}')  {
          depth--
          if (depth === 0 && ruleStart >= 0) {
            try { completeRules.push(JSON.parse(partial.substring(ruleStart, i + 1))) } catch {}
            ruleStart = -1
          }
        }
      }
      if (completeRules.length > 0) {
        console.warn(`[deep-synthesize] Recovered ${completeRules.length} complete rules from truncated response`)
        return { rules: completeRules, summary: 'Partial synthesis — response was truncated but rules were recovered.' }
      }
    }
    throw e  // nothing salvageable — re-throw original error
  }
}

/**
 * Like analyzeFolder but returns an extended JSON schema that exposes
 * the full reasoning chain for each finding so humans can give precise feedback.
 */
export async function gymAnalyzeFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null, options = {}) {
  return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, 0, batchInfo, options)
}

async function gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo = null, options = {}) {
  const cheap = !!options.cheapMode
  const model = pickClaudeModel(cheap)
  const max_tokens = pickClaudeMaxTokens(cheap, 16384)
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)
    // Replace the last content block (standard instructions) with the gym version
    content.pop()
    content.push({ type: 'text', text: buildGymAnalysisInstructions(tenant, new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })) })

    // Use juice-enhanced system prompt if TP has loaded a juice model,
    // else fall back to global learnings (beefed-up), else base.
    // MT never injects juice rules — it always takes the global-learnings path.
    const systemPrompt = options.juiceRules?.length > 0
      ? buildJuiceSystemPrompt(options.juiceRules)
      : options.activeLearnings?.length > 0
        ? buildBeefedUpSystemPrompt(options.activeLearnings)
        : SYSTEM_PROMPT

    const betaParams = {
      model,
      max_tokens,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25', 'prompt-caching-2024-07-31'],
      system:     [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content }]
    }
    // TP2 parallel mode: client picks the freshest key per tenant to avoid hammering a rate-limited key
    const response = (options.preferredKeyIdx !== undefined)
      ? await createBetaMessageWithPreferredKey(betaParams, options.preferredKeyIdx)
      : await createBetaMessageWithFailover(betaParams)

    const rawText  = response.content[0]?.text || ''
    const usage    = response.usage   // capture before async parse (which may recurse)
    const parsed   = await Promise.resolve(gymParseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, options))
    // Attach token usage — only if a recursive retry hasn't already set it
    if (usage && parsed && typeof parsed === 'object' && !parsed._tokenUsage) {
      parsed._tokenUsage = {
        inputTokens:      usage.input_tokens                  || 0,
        outputTokens:     usage.output_tokens                 || 0,
        cacheReadTokens:  usage.cache_read_input_tokens       || 0,
        cacheWriteTokens: usage.cache_creation_input_tokens   || 0,
      }
    }
    return parsed

  } catch (err) {
    if (err.status === 413) {
      if (pdfDocs.length > 0) {
        return gymCallWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo, options)
      }
      if (textDocs.length > 0) {
        const trimmed = textDocs.map(d => ({ ...d, text: d.text ? d.text.substring(0, 50000) + '\n[...truncated...]' : d.text }))
        return gymCallWithRetry(tenant, [], trimmed, pageGapFindings, attempt + 1, batchInfo, options)
      }
      throw new Error(`Request too large even after all fallbacks for ${tenant.tenantName}`)
    }
    // ── 400 "prompt is too long" (token limit exceeded) ──────
    // Batching in analyzer.js should prevent this, but handle as last resort
    if (err.status === 400 &&
        (err?.message?.toLowerCase().includes('too long') ||
         err?.message?.includes('1000000') ||
         err?.message?.toLowerCase().includes('maximum'))) {
      if (pdfDocs.length > 0) {
        console.log(`[claude/gym] 400 token overflow for ${tenant.tenantName} — falling back to text-only`)
        return gymCallWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo, options)
      }
      throw new Error(formatClaudeError(err))
    }
    // Anthropic SDK "streaming recommended" error — SDK timeout on very slow responses.
    // Wait 15s and retry; the next attempt may hit a faster API server.
    if (err.message?.includes('Streaming is strongly recommended') && attempt < 2) {
      console.warn(`[claude/gym] SDK timeout for ${tenant.tenantName} (attempt ${attempt}) — retrying in 15s`)
      await sleep(15000)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }
    if (isRetryableNetworkError(err) && attempt < 3) {
      const delay = Math.pow(2, attempt + 1) * 2500
      console.log(`[claude/gym] Network error for ${tenant.tenantName}, retry in ${delay}ms: ${err.message}`)
      await sleep(delay)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }
    // 429: always wait 65s for the rate limit window to reset, same key — no rotation.
    // Rotating to another key can overload it and cause cascade failures + double billing.
    if (err.status === 429 && attempt < 3) {
      console.log(`[claude/gym] 429 for ${tenant.tenantName} — waiting 65s for rate limit reset (same key, no rotation)`)
      await sleep(65000)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }
    const retryable = err.status === 529 || (err.status >= 500 && err.status < 600)
    if (retryable && attempt < 3) {
      const delay = Math.pow(2, attempt + 1) * 1500
      await sleep(delay)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }
    throw new Error(formatClaudeError(err))
  }
}

function gymParseResponse(text, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, options = {}) {
  // Robustly extract the outermost { ... } regardless of code fences or preamble text.
  // Multi-strategy parser — falls through to progressively more lenient passes
  // before giving up. Tested against real 5/19 parse-failure transcripts where
  // valid JSON was wrapped in ```json fences with trailing prose.
  const parsed = _tolerantJsonParse(text)
  if (parsed && parsed.findings && Array.isArray(parsed.findings)) {
    return parsed
  }

  if (attempt < 1) {
    console.log(`[claude/gym] JSON parse failed for ${tenant.tenantName}, retrying...`)
    return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
  }

  console.error(`[claude/gym] Could not parse response for ${tenant.tenantName}:`, text.substring(0, 300))
  // Surface as a clear SYSTEM-level row, not a HIGH legibility finding. The
  // reviewer was rejecting these with "It's good to note that it needs manual
  // review, but it's more helpful for it to be reviewed by the app." So we
  // mark severity LOW and check_type SYSTEM_ERROR so it's visually distinct
  // and Todd's filter can choose to drop it.
  return {
    tenantNameInDocuments: 'Parse error',
    mostRecentDocumentDate: null,
    leaseExpirationDate: null,
    findings: [{
      checkType: 'SYSTEM_ERROR', severity: 'LOW',
      missingDocument: 'N/A — analysis incomplete (parser could not extract structured output)',
      comment: 'The model returned a response that could not be parsed after multiple retries. Re-running the tenant usually fixes it. If repeated, the document may be unusually large or formatted.',
      evidence: `Raw preview (first 300 chars): ${text.substring(0, 300)}`,
      triggerQuote: '', reasoning: '', checkedAndEliminated: [], confidence: 'LOW', howIFoundThis: ''
    }],
    allClear: false
  }
}

// Tolerant JSON parser — handles the patterns we've seen break the strict
// JSON.parse: markdown ```json fences, trailing prose after the JSON object,
// preamble text before the JSON, and (best-effort) trailing commas. Returns
// the parsed object on success, or null on failure.
function _tolerantJsonParse(text) {
  if (!text || typeof text !== 'string') return null

  // Pass 1: trim + strip leading/trailing markdown fences
  let work = text.trim()
                 .replace(/^```(?:json)?\s*/i, '')
                 .replace(/\s*```\s*$/, '')
                 .trim()

  // Pass 2: try direct parse
  try { return JSON.parse(work) } catch {}

  // Pass 3: find the OUTERMOST balanced braces — handles preamble + trailing prose
  // Walk the string tracking brace depth, ignoring braces inside strings
  let inString = false, escape = false, depth = 0, start = -1, end = -1
  for (let i = 0; i < work.length; i++) {
    const c = work[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') {
      if (depth === 0 && start === -1) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start !== -1) { end = i; break }
    }
  }
  if (start >= 0 && end > start) {
    const candidate = work.substring(start, end + 1)
    try { return JSON.parse(candidate) } catch {}
    // Pass 4: try removing trailing commas inside arrays/objects
    try { return JSON.parse(candidate.replace(/,(\s*[}\]])/g, '$1')) } catch {}
  }

  // Pass 5: last-resort — first { to last }
  const firstBrace = work.indexOf('{')
  const lastBrace  = work.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const fallback = work.substring(firstBrace, lastBrace + 1)
    try { return JSON.parse(fallback) } catch {}
    try { return JSON.parse(fallback.replace(/,(\s*[}\]])/g, '$1')) } catch {}
  }

  return null
}

function buildGymAnalysisInstructions(tenant, todayStr) {
  // Full 10-check instructions identical to the standard prompt, but with an
  // extended JSON schema that exposes the reasoning chain for each finding.
  const base = buildAnalysisInstructions(tenant, todayStr)

  // Strip only the JSON OUTPUT FORMAT section and replace it with the richer version
  const cutAt = base.indexOf('JSON OUTPUT FORMAT')
  const standardInstructions = cutAt > 0 ? base.substring(0, cutAt) : base

  return `${standardInstructions}
${'═'.repeat(70)}
GYM MODE — TRAINING ANALYSIS: EXPOSE YOUR FULL REASONING
${'═'.repeat(70)}

You are in Gym (Training) Mode. A human expert will review every single finding
you produce and mark it correct, wrong, or partially wrong — then explain why.
Their feedback will be used to improve the AI system.

This means your job here is DIFFERENT from a normal audit:

You must show your complete reasoning for EVERY finding. Do not just state the
conclusion — walk through every step:
  1. What document and page triggered your attention?
  2. What is the EXACT text or visual observation (quote it verbatim)?
  3. What did you check to make sure you weren't wrong?
  4. What alternative explanations did you consider and eliminate?
  5. Why did you ultimately conclude this is a real issue?

This transparency lets the human reviewer say precisely where your reasoning
went wrong (if it did) — which is far more valuable for training than just
knowing the conclusion was wrong.

${'═'.repeat(70)}
JSON OUTPUT FORMAT — GYM MODE (EXTENDED SCHEMA)
${'═'.repeat(70)}

Return ONLY this JSON object with no surrounding text, no markdown, no code fences:

{
  "tenantNameInDocuments": "exact legal name as found in the most recent document signature block",
  "mostRecentDocumentDate": "date of the most recent document found, or null",
  "leaseExpirationDate": "controlling expiration date as found in documents, or null if undeterminable",
  "findings": [
    {
      "checkType": "EXECUTION | EXHIBIT | CURRENCY | REFERENCED_DOC | AMENDMENT_GAP | MISSING_PAGE | LEGIBILITY | SPECIAL_AGREEMENT | GUARANTY | NAME_MISMATCH",
      "severity": "HIGH | MEDIUM | LOW",
      "missingDocument": "the missing or problematic document name; use 'N/A' for non-document issues",
      "comment": "specific, actionable description of the issue for the reviewer",
      "evidence": "exact document name, page number, section/clause, and verbatim text that triggered the finding",

      "triggerQuote": "The VERBATIM text, date, or visual observation that first flagged this issue — quote it exactly as it appears in the document, including surrounding context. If visual (e.g. blank signature line), describe what you saw in detail.",

      "reasoning": "Your COMPLETE step-by-step reasoning chain. Walk through every step: (1) what you were looking for per the check rules, (2) what you found and where, (3) what you did to verify or cross-check, (4) why you concluded this is a real issue and not an artifact. Write this as if explaining to a skeptical senior paralegal who will challenge every assumption.",

      "checkedAndEliminated": [
        "Each item in this array is one thing you checked to make sure this finding is real and not a false positive — e.g. 'Checked all remaining pages of the document — the signature block does not appear later', 'Searched other files in the folder — no standalone Amendment 2 exists', 'Re-read the exhibit index — Exhibit C is listed but no content follows the heading page'"
      ],

      "confidence": "HIGH | MEDIUM | LOW — HIGH means you are certain; MEDIUM means you believe it but acknowledge ambiguity; LOW means you are flagging for human review because doubt remains",

      "howIFoundThis": "One plain-English sentence summarizing the specific pattern or signal that led to this finding — e.g. 'The recitals in the Third Amendment named the Second Amendment, which is absent from the folder' or 'The signature block on page 8 has a typed name but no handwritten signature above it'"
    }
  ],
  "allClear": true
}

IMPORTANT:
- allClear must be true ONLY if findings is empty
- Each distinct issue must be its own separate finding object
- The reasoning, triggerQuote, checkedAndEliminated, confidence, and howIFoundThis fields are MANDATORY for every finding in Gym Mode
- Be honest about your confidence — LOW confidence findings are valuable for training too
- Do not manufacture findings to look thorough — allClear: true is a valid gym result`
}

// ═══════════════════════════════════════════════════════════
// DR. TODD — 3-run synthesis and diagnostic report
// ═══════════════════════════════════════════════════════════

export async function synthesizeDrTodd(tenant, run1, run2, run3, options = {}) {
  const formatRun = (run, n) => {
    if (!run || run.error) return `RUN ${n}: ERROR — ${run?.error || 'unknown'}`
    if (!run.findings || run.findings.length === 0) return `RUN ${n}: ALL CLEAR (no findings)`
    return `RUN ${n} — ${run.findings.length} finding(s):\n` +
      run.findings.map((f, i) =>
        `  [${i+1}] checkType: ${f.checkType} | severity: ${f.severity}\n` +
        `       missingDocument: ${f.missingDocument}\n` +
        `       comment: ${f.comment}\n` +
        `       evidence: ${f.evidence}`
      ).join('\n')
  }

  const prompt = `You are a prompt engineering expert analyzing three independent AI document audits of the same commercial real estate tenant folder. Your job is to identify what the AI is getting right, what it's missing, and what's causing inconsistency — then write specific improvements.

TENANT: ${tenant.tenantName}
FOLDER: ${tenant.folderName}

${'═'.repeat(60)}
${formatRun(run1, 1)}

${'═'.repeat(60)}
${formatRun(run2, 2)}

${'═'.repeat(60)}
${formatRun(run3, 3)}

${'═'.repeat(60)}

Write a diagnostic report with these exact sections:

CONSISTENT FINDINGS (all 3 runs agreed):
List every finding that appeared in all 3 runs. These are likely real issues.

INCONSISTENT FINDINGS (only 1 or 2 runs caught):
For each inconsistent finding, list: what was found, which run(s) found it, which missed it, and why that inconsistency is a problem.

ROOT CAUSES OF INCONSISTENCY:
What specific things is the model struggling with? Be direct — e.g. "The model sometimes flags X without checking Y first" or "The model is inconsistent about Z because the prompt doesn't specify..."

SPECIFIC PROMPT CHANGES NEEDED:
Write the exact text that should be added or changed in the prompt to fix each root cause. Write it as actual prompt text, not vague suggestions. Label each change with which check it affects (CHECK 1 through CHECK 10).

Keep the report clear and direct. It will be copy-pasted to a developer to improve the AI system prompt.`

  const cheap = !!options.cheapMode
  const response = await createMessageWithFailover({
    model:      pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 4000),
    messages:   [{ role: 'user', content: prompt }]
  })

  return response.content[0]?.text || 'Synthesis failed — no response generated.'
}

// ═══════════════════════════════════════════════════════════
// CROSS-BATCH SYNTHESIS PASS
// Runs AFTER all batch calls complete on a multi-batch folder.
// Reconciles findings across batches: resolves amendment-extension
// conflicts, removes false "missing doc" flags for docs that exist
// in another batch, deduplicates, and verifies cross-batch references.
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} tenant         - { id, folderName, property, suite, tenantName }
 * @param {Array}  batchResults   - array of result objects from each batch call
 * @param {Array}  allFileNames   - every PDF filename in the folder
 * @param {object} options        - { cheapMode }
 */
export async function synthesizeAcrossBatches(tenant, batchResults, allFileNames, options = {}, allPdfCandidates = []) {
  const cheap      = !!options.cheapMode
  const model      = pickClaudeModel(cheap)
  const max_tokens = pickClaudeMaxTokens(cheap, 16384)

  // Gather all findings and cross-batch references from every batch
  const allFindings  = []
  const allCrossRefs = []

  for (let i = 0; i < batchResults.length; i++) {
    const r = batchResults[i]
    for (const f of (r.findings || [])) {
      allFindings.push({ ...f, _batch: i + 1 })
    }
    for (const ref of (r.crossBatchReferences || [])) {
      allCrossRefs.push({ ...ref, _batch: i + 1 })
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })

  const findingsBlock = allFindings.length > 0
    ? allFindings.map((f, idx) =>
        `FINDING ${idx + 1} [Batch ${f._batch}]
  checkType:       ${f.checkType}
  severity:        ${f.severity}
  missingDocument: ${f.missingDocument}
  comment:         ${f.comment}
  evidence:        ${f.evidence}`
      ).join('\n\n')
    : '(no findings from any batch — potential all-clear)'

  const crossRefsBlock = allCrossRefs.length > 0
    ? allCrossRefs.map((r, idx) =>
        `CROSS-REF ${idx + 1} [Batch ${r._batch}]: "${r.documentName}"\n  spotted in: ${r.referencedIn}\n  issue: ${r.issue}`
      ).join('\n\n')
    : 'None flagged.'

  // Build full document content block — full extracted text of every PDF.
  // Text tokens are cheap (~4 chars/token). This gives the synthesis pass
  // complete document awareness so it can catch anything the batch splits missed.
  const docContentBlock = allPdfCandidates.length > 0
    ? allPdfCandidates
        .filter(p => p.extractedText && p.extractedText.trim().length > 20)
        .map(p => {
          const text = p.extractedText.trim()
          return `━━━ ${p.filename} (${p.pageCount || '?'} pages) ━━━\n${text}`
        })
        .join('\n\n')
    : '(no extracted text available)'

  // Pick the most specific tenant name and dates across all batches
  const tenantNameInDocuments  = batchResults.find(r => r.tenantNameInDocuments)?.tenantNameInDocuments || tenant.tenantName
  const leaseExpirationDate    = batchResults.map(r => r.leaseExpirationDate).filter(Boolean).pop() || null
  const mostRecentDocumentDate = batchResults.map(r => r.mostRecentDocumentDate).filter(Boolean).sort().pop() || null

  const prompt = `CROSS-BATCH SYNTHESIS — COMPLETE RE-ANALYSIS

TENANT:  ${tenant.tenantName}
FOLDER:  ${tenant.folderName}
TODAY:   ${today}

ALL DOCUMENTS IN FOLDER (${allFileNames.length} files):
${allFileNames.map(f => `  • ${f}`).join('\n')}

This folder was too large to send to Claude as one API call, so it was split into ${batchResults.length} batches. Each batch visually analyzed its own PDFs but only had text-snippet awareness of the others. You are now the final pass — you have the COMPLETE EXTRACTED TEXT of every document below, plus all findings from every batch.

YOUR ROLE: Produce the final authoritative findings list as if you had reviewed the entire folder at once. This means:

A) RE-EXAMINE every batch finding against the full document content. Remove findings that are contradicted by what you can now read in the full text (e.g., a document flagged as "missing" that is clearly present in another file's text).

B) FIND ANYTHING THE BATCHES MISSED. Read through the full document content below. If the extracted text reveals an issue that no batch caught — a referenced document that doesn't appear anywhere in the folder, a term extension that wasn't reconciled, a missing signature that a batch overlooked — add it as a new finding.

C) RECONCILE cross-document logic with full awareness:
   • Amendment chain completeness — does the text confirm every amendment in the chain is present?
   • Term expiration — what does the most recent document say the controlling end date is? Is there a more recent extension the batches may have missed?
   • Referenced documents — does any document's text reference an exhibit, side letter, guaranty, or consent that is not present in the folder?
   • Execution — does the text of any document indicate it was never signed / not fully executed?

D) DEDUPLICATE — if two batches flagged the same issue, keep ONE finding with the best evidence.

E) PRESERVE all genuine findings that are not contradicted.

F) DO NOT add informational or all-clear findings. Only flag actual missing or unexecuted documents.

══════════════════════════════════════════════
VISUAL ANALYSIS FINDINGS FROM ALL BATCHES:
══════════════════════════════════════════════
${findingsBlock}

══════════════════════════════════════════════
CROSS-BATCH REFERENCES FROM BATCHES:
══════════════════════════════════════════════
${crossRefsBlock}

══════════════════════════════════════════════
COMPLETE EXTRACTED TEXT OF ALL DOCUMENTS:
══════════════════════════════════════════════
${docContentBlock}

Output ONLY this JSON (no prose, no markdown, no code fences):

{
  "tenantNameInDocuments": "${tenantNameInDocuments}",
  "mostRecentDocumentDate": ${mostRecentDocumentDate ? `"${mostRecentDocumentDate}"` : 'null'},
  "leaseExpirationDate": ${leaseExpirationDate ? `"${leaseExpirationDate}"` : 'null'},
  "findings": [
    {
      "checkType": "...",
      "severity": "HIGH | MEDIUM | LOW",
      "missingDocument": "...",
      "comment": "...",
      "evidence": "..."
    }
  ],
  "allClear": false
}`

  const totalDocChars = allPdfCandidates.reduce((s, p) => s + (p.extractedText?.length || 0), 0)
  console.log(`[claude] Synthesis pass: ${allFindings.length} batch findings, ${allCrossRefs.length} cross-refs, ${allPdfCandidates.length} docs with ~${Math.round(totalDocChars/1000)}k chars of extracted text`)

  const response = await createMessageWithFailover({
    model,
    max_tokens,
    temperature: 0.1,
    system:      [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages:    [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  })

  const rawText = response.content[0]?.text || ''
  let cleaned   = rawText.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)

  const parsed = JSON.parse(cleaned)
  if (!parsed.findings || !Array.isArray(parsed.findings)) {
    throw new Error('synthesizeAcrossBatches: findings array missing in response')
  }

  console.log(`[claude] Synthesis pass complete: ${parsed.findings.length} final findings (was ${allFindings.length} raw across batches)`)
  return parsed
}

// ═══════════════════════════════════════════════════════════
// MASTER TRAINER — compare model output to cheat sheet
// ═══════════════════════════════════════════════════════════

/**
 * Master Trainer judge: semantically compare model findings to the correct answer key.
 * The cheat sheet is NEVER passed to the analysis prompt — only to this judge call.
 *
 * @param {string}   tenantName     - Tenant name for context
 * @param {Array}    modelFindings  - What the model actually flagged
 * @param {string[]} shouldFind     - What the model MUST flag (correct answers)
 * @returns {{ caught, missed, falsePositives, analysis, score }}
 */
export async function compareToCheatSheet({ tenantName, modelFindings = [], shouldFind = [] }) {
  const findingsBlock = modelFindings.length > 0
    ? modelFindings.map((f, i) =>
        `${i + 1}. [${f.checkType || 'UNKNOWN'}] "${f.missingDocument || 'N/A'}"
   Reasoning: ${(f.reasoning || 'none').slice(0, 300)}
   Trigger quote: ${(f.triggerQuote || 'none').slice(0, 200)}
   Evidence: ${(f.evidence || 'none').slice(0, 200)}
   Comment: ${(f.comment || 'none').slice(0, 200)}`
      ).join('\n\n')
    : '⚠️ The model produced NO findings for this tenant.'

  const correctBlock = shouldFind.map((s, i) => `${i + 1}. ${s}`).join('\n')

  const prompt = `You are the Master Trainer judge for Todd Jr., a real estate document review AI that reviews commercial lease folders for missing or unsigned documents.

TENANT: ${tenantName}

═══ CORRECT ANSWERS — every item below MUST be found ═══
${correctBlock}

═══ MODEL OUTPUT — what the model actually flagged (with its reasoning) ═══
${findingsBlock}

═══ TASK ═══

STEP 1 — SCORE
For each correct answer: did the model find it? Use SEMANTIC matching — different wording is fine if the core issue is the same. Partial match counts as caught if the essential gap is identified.
Identify false positives: model findings that flag non-issues under standard commercial lease review.

Score rubric:
  100 = all correct answers caught AND 0 false positives
  Each missed: -floor(100 / total_required)
  Each false positive: -10 (floor 0)

STEP 2 — ANALYSIS (the "WHY" shown to the trainer)
2-3 sentences. Diagnose the specific reasoning failure:
  • For MISSES: what signal in the documents did the model fail to recognize, or what inference did it fail to make?
  • For FALSE POSITIVES: what triggered the wrong flag — what text or pattern caused the model to think there was an issue when there wasn't?
Be concrete. Reference the type of document, clause, or pattern — not the tenant name.

STEP 3 — TRAINING INSTRUCTION (the "TELL CLAUDE CODE" — most important field)
Output a JSON snippet the developer can paste directly into learnings.json.
This is the MOST IMPORTANT output. Make it a complete, deployable rule.

Format exactly:
{
  "checkType": "<pick the most relevant: EXECUTION | REFERENCED_DOC | AMENDMENT_GAP | EXHIBIT | SIGNATURE | GENERAL | PAGE_GAP | SPECIAL_AGREEMENT>",
  "suggestion": "<Complete rule — 2-5 sentences. Must: (a) name the exact document signal or pattern that creates this situation, (b) give the model a precise do/do-not instruction, (c) cover the edge case that caused the failure. Start with an action verb. NO tenant names, property names, or deal-specific details.>",
  "rationale": "<1-2 sentences: what specific reasoning failure this rule prevents and why it matters.>"
}

Rules for the suggestion field:
  - Be surgical: instead of "be careful about X" → write "Do not generate [finding type] when [exact condition]"
  - If the model MISSED something: name the exact textual or structural signal it should look for and what to flag when found
  - If the model had FALSE POSITIVES: name the exact pattern it misread and explain why it is not a real issue
  - If BOTH missed and FPs exist: combine into one suggestion with "Additionally:" separating the two clauses
  - The rule must be testable on any random tenant folder — if it reads as specific to one deal, rewrite it more abstractly

If score is 100 (nothing wrong): set trainingInstruction to the string "No training needed — model performed correctly."

═══ RETURN ONLY valid JSON (no markdown, no prose outside the JSON) ═══
{
  "caught":            ["copy exact text from CORRECT ANSWERS list for each one found"],
  "missed":            ["copy exact text from CORRECT ANSWERS list for each one NOT found"],
  "falsePositives": [
    {
      "checkType":       "finding's checkType",
      "missingDocument": "finding's missingDocument text",
      "reason":          "why this is not a real issue"
    }
  ],
  "analysis":            "2-3 sentences diagnosing the specific reasoning failure — concrete, references document type/pattern",
  "trainingInstruction": <either the JSON object described above OR the string "No training needed — model performed correctly.">,
  "score":               <integer 0-100>
}`

  const response = await createMessageWithFailover({
    model:       'claude-sonnet-4-6',
    max_tokens:  2500,
    temperature: 0.1,
    system: [{ type: 'text', text: 'You are the Master Trainer judge for a real estate document review AI. Your most important job is producing a precise, immediately deployable training rule. Return only valid JSON.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  })

  const rawText = response.content[0]?.text || ''
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)
  const parsed = JSON.parse(cleaned)

  // Normalize trainingInstruction — if it came back as a JSON object, stringify it prettily
  // so the copy-paste box shows the actual JSON snippet
  if (parsed.trainingInstruction && typeof parsed.trainingInstruction === 'object') {
    parsed.trainingInstruction = 'Add this rule to learnings.json:\n\n' +
      JSON.stringify(parsed.trainingInstruction, null, 2)
  }

  return parsed
}

// ═══════════════════════════════════════════════════════════════════════════
// RELEVANCE FILTER — second-pass quality gate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lightweight second-pass relevance filter.
 *
 * Takes confirmed findings from the main analysis and runs them through a
 * cheap, text-only Claude call that checks each finding against all active
 * training rules.  Any finding that matches a known false-positive pattern
 * is dropped before the result reaches the UI.
 *
 * This is NOT a re-analysis — no PDFs, no documents, just findings text +
 * rule context.  Uses Haiku for speed and cost efficiency.
 *
 * Returns the filtered findings array.  On any error returns the original
 * unfiltered array (fail-safe — never silences real findings on error).
 */

// ── Todd's own filter rules — derived from reviewer rejection reasons, not generation patterns ──
// These are written from the DROPPER's perspective: "if a finding looks like this, drop it because
// the reviewer consistently said X." They are separate from the 73 main-model training rules.
const TODD_FILTER_RULES = `F1 [CONFIRMATORY]: The finding's primary message is that something IS correct, present, executed, or current — e.g. "the lease is active through [date]," "the amendment chain is complete," "the document is present and signed," "the guaranty is executed." The reviewer will always reject these with "this is correct but does not need to be noted." DROP — confirmatory observations are never findings.

F2 [SECONDARY SIGNATURE FIELDS]: The finding is about blank secondary fields in a signature block — Its:, Title:, Print Name:, Printed Name:, Date:, Notary Acknowledgment block, Witness lines, Address:, or Attn:. Only the By: line determines execution. A blank in any other field is irrelevant. DROP.

F3 [FOLDER OR FILE NAME vs DOCUMENT]: The finding compares a folder label, tab name, or PDF filename to a legal entity name inside a document. Folder names and file names are administrative and never match exactly. DROP.

F4 [MINOR NAME VARIATION — SAME PARTY]: The finding flags an abbreviation, punctuation difference, Inc./LLC/Corp. variant, d/b/a shorthand, or minor spelling difference for what is clearly the same party across documents or within one document. DROP unless the two entities are completely unrelated.

F5 [BOILERPLATE CATCH-ALL LANGUAGE]: The finding is triggered by standard legal boilerplate — "as same may have been amended," "as amended," "if applicable," "upon request," "if and when executed," "if required," or similar protective language. Boilerplate is not evidence of a specific missing document. DROP.

F6 [BLANK EXHIBIT FORM FIELDS]: The finding is about blank fill-in fields on an exhibit form — Delivery Date Certificate, Commencement Date Certificate, Tenant Opening Notice, Work Letter, or any other fill-in-after-occupancy form. These are blank by design until after occupancy. DROP.

F7 [SCAN ARTIFACT / BLANK SEPARATOR PAGE]: The finding is about a blank white page, scan shadow, photocopy smudge, or other scan artifact. If the critical content — party names, signature fields, operative terms — is still readable, this is not a finding. Blank separator pages are standard. DROP.

F8 [OUT OF SCOPE DOCUMENT TYPE]: The finding references any of the following as missing or deficient: SNDA, Certificate of Insurance (COI), HVAC contract, pest control contract, business license, building permit, broker commission agreement, franchise agreement, Letter of Intent (LOI), Notice of Commencement, Collateral Assignment, Memorandum of Lease, Committee Review Form / Deal Approval Form, sales reports, gross sales certifications, percentage rent statements, or audit correspondence. DROP — all are outside review scope.

F9 [SPECULATIVE GAP — NO POSITIVE EVIDENCE]: The finding speculates that amendments or documents might exist ("there may be," "it is possible that," "could indicate missing," "assumed amendments between dates") without a specific named amendment in recitals or a concrete numbered gap in the chain. DROP — absence of evidence is not evidence of a gap.

F10 [DUPLICATE FILES — SAME DOCUMENT]: The finding is about two copies of the same document appearing under different filenames in the same folder. Duplicate files are scanner or upload artifacts. DROP.

F11 [RECITAL DATE DISCREPANCY — DOCUMENT PRESENT]: The finding flags a date mismatch between a recital cross-reference and the actual document in the folder, but the document is physically present and clearly the same instrument (same parties, same type). Minor date differences are scrivener's errors. DROP.

F12 [NOTARIZATION OR WITNESS ABSENT]: The finding is about a missing notary acknowledgment, notary stamp, notary jurat, or witness signature on any document. Notarization and witnessing are not required for execution in this practice. DROP.

F13 [CORPORATE TRANSITION DOCUMENTED ANYWHERE]: The finding is about a name change, entity conversion, acquisition, merger, or rebranding, and any document anywhere in the folder — amendment recital, merger notice, assignment, or correspondence — references or explains the transition. DROP.

F14 [SUPERSEDED / EXPIRED DOCUMENTS]: The finding flags absence of documents that have been superseded — an original lease replaced by an Amended and Restated Lease, expired TLAs replaced by a current TLA, prior amendments fully incorporated into a later restated version. DROP — superseded documents are intentionally absent.

F15 [OPTION EXERCISE LETTER IS SUFFICIENT]: The finding flags the absence of a formal executed amendment after a renewal, extension, or expansion option exercise, where a signed exercise notice or letter is present. An exercise letter is sufficient — no formal amendment is required. DROP.

F16 [DOCUSIGN AUDIT TRAIL AS SOLE AUTHORITY]: The finding's execution conclusion is based on the DocuSign audit trail log rather than the actual document signature pages. The audit trail is supplementary only — the document pages are authoritative. DROP.

F17 [PREAMBLE OR RECITAL BLANKS]: The finding is about blank template fields in preamble or introductory recital language — "this ___ day of ___," blank effective date fields in the opening paragraph. These are form-printing artifacts and do not affect execution. DROP.

F18 [COUNTERPART OR NEXT-PAGE EXECUTION]: The finding flags a document as unexecuted or partially executed because one party's signature does not appear on the same page as another party's, or a signature block on one page is blank. Before drawing any conclusion, all pages of the document must be checked — parties routinely sign on separate consecutive pages or counterpart pages. If any signature for that party appears anywhere in the document, DROP.

F19 [INTERNAL DRAFTING OR NUMBERING ERROR]: The finding is about an internal body-text error — incorrect ordinal label ("Second Fourth Amendment"), wrong amendment number in a body paragraph, mismatched section cross-reference within the same document. These are scrivener's errors on the face of the document. The document's presence satisfies the folder requirement. DROP.

F20 [GUARANTY SCOPE, COVERAGE, OR NOTES]: The finding provides information about a Guaranty that is present and signed — its coverage period, which amendments it covers, whether it was reaffirmed, or other detail notes. The only valid Guaranty findings are (a) no guaranty is present and one was contractually required, or (b) the guaranty is present but the By: signature line is blank. Everything else about a signed guaranty → DROP.

F21 [SURRENDER OR TERMINATION PRESENT — EXTRA FINDINGS]: The folder contains a Surrender Agreement or Early Termination Agreement, meaning the tenancy has ended. Only one scope-confirmation note is appropriate. Any additional findings about missing documents, execution defects, or amendment gaps for a surrendered tenant → DROP.

F22 [LOW SEVERITY + NO SPECIFIC ITEM TO OBTAIN]: The finding's severity is LOW and it does not name a specific document to go get or a specific signature to obtain. LOW findings that are observations, notes, or general flags without a concrete actionable item → DROP.

F23 [BLANK DATE LINE — BY: FIELD IS SIGNED]: The finding is about a blank 'Date:', 'Dated:', or 'Date of Signing:' line in a signature block where the 'By:' line has a visible signature, mark, handwriting, or printed name indicating the signatory. This is the single most-rejected finding category. A document is executed the moment the By: line is signed — the Date: line is a courtesy field that has no bearing on execution validity. Even if the finding is labeled HIGH severity or checkType EXECUTION, if the By: is signed and the only defect is a blank Date: → DROP.

F24 [BLANK TRAILING OR DUPLICATE PAGES WITHIN AN EXHIBIT]: The finding is about blank pages that appear at the end of a substantive exhibit section — for example a page 'D-3' or a duplicate 'D-1' that is entirely blank, appearing after pages D-1 and D-2 contain complete substantive content — or a duplicate page of an exhibit that appears blank. If the exhibit's substantive content on the preceding pages is complete (not broken mid-sentence, not ending in an incomplete list), those trailing blank pages are scan artifacts from physical document backs or separator sheets. → DROP.

F25 [ROMAN-NUMERAL FRONT MATTER — ARABIC BODY NUMBERING]: The finding is about an apparent missing-page gap caused solely by the document using Roman numerals (i, ii, iii, iv, v, vi) for front-matter sections (Table of Contents, Key Provisions, Basic Lease Terms) and switching to Arabic numerals (1, 2, 3…) for the body. The apparent jump from Roman-numeral pages to body page '1' is standard legal document formatting, not a content gap. If the text flows coherently from the front matter into body Section 1 → DROP.

F26 [PARTIAL EXHIBIT — COVER/HEADING PAGE PRESENT, CONTENT ABSENT]: The finding flags an exhibit as missing because only its cover or heading page is present (e.g., a page reading "Exhibit C, Page 1" with no substantive content) and the next page jumps to a different exhibit. At the initial review level, the cover page being present satisfies completeness — substantive content review is for the abstracting reviewer later. If the finding's own text confirms a heading or cover page exists for the exhibit → DROP. Only KEEP missing-exhibit findings where the exhibit is COMPLETELY absent (no heading, no cover, no content of any kind).

F27 [COMMENCEMENT DATE AGREEMENT / ACCEPTANCE OF PREMISES AS RIDER OR EXHIBIT]: The finding is an EXECUTION finding about a Commencement Date Agreement, Acceptance of Premises, Delivery Date Certificate, Tenant Opening Notice, Memorandum of Commencement Date, or similar post-occupancy form that is attached to the main lease as a Rider, Exhibit, Schedule, or Addendum (rather than as a separate executed instrument). Blank Landlord/Tenant signature lines, blank entity-chain fields, blank Commencement Date fields, or blank Expiration Date fields on these attached form documents are NOT execution defects — they are template fields awaiting post-occupancy completion. → DROP.

F28 [DOCUMENT EXISTS UNDER DIFFERENT FILENAME — CHECK FOLDER MANIFEST]: A FOLDER FILE LIST may be provided to you under "FOLDER MANIFEST" below. If a missing-document finding names a document, scan the manifest for filenames that plausibly match by date (e.g., '2002-12-31' in filename matches 'December 31, 2002' reference), parties (e.g., 'Tweeter-Assignment' matches 'Assignment by Tweeter'), or document type (e.g., '3rd Amendment' matches 'Third Amendment'). If a plausible match exists in the manifest → DROP. Filenames are administrative and rarely match formal titles exactly — match generously.

F29 [DUAL COUNTERPART — ONE COPY IS SIGNED]: The finding's own evidence acknowledges that the folder contains two or more copies of the same document and that AT LEAST ONE copy is fully executed (e.g., "the other has signature," "standalone executed Guaranty file IS executed," "two copies in folder, one signed"). When at least one copy is signed, the document is executed regardless of any blank counterpart. The signed copy controls; the blank copy is a draft or unexecuted counterpart. → DROP.

F30 [LOI / COUNTER-OFFER / NEGOTIATION DOCUMENT — ANY FINDING]: The finding flags any defect (execution, missing, currency, etc.) on a Letter of Intent, Counter-Offer, term sheet, deal proposal, or pre-lease negotiation document — even when the LOI is the only operative-looking document in the folder. Negotiation documents are NEVER abstracted regardless of how operative they may appear. → DROP. The "but it is the only deal document" rationale is invalid.

F31 [BUSINESS PLAN / TAX DOC / DEPOSIT CHECK / FINANCIAL / LEASE-ABSTRACT WORD DOC]: The finding flags issues with: a business plan, marketing material, tax return, P&L statement, financial statement, deposit check, photo of a check, bank deposit slip, or a Word document (.doc/.docx) whose contents is itself a lease-abstract summary (not a lease). None of these are within abstracting scope. → DROP. (A Word doc that is itself a lease abstract or term summary is NOT a missing document — it is an internal work product.)

F32 [CONSTRUCTION AGREEMENT — OWNER/CONTRACTOR / TI CONTRACT]: The finding flags issues with an Owner-Contractor Agreement, Tenant Improvement construction contract, GC contract, AIA-form construction agreement, or general construction services agreement between the landlord/tenant and a contractor. These are operational construction documents, not lease instruments. → DROP.

F33 [MAIN MODEL OVERRIDING ITS OWN OUT-OF-SCOPE LEARNING]: The finding's own text explicitly references an existing learning rule that says the document is out of scope (e.g., "Learning 40 says LOIs out of scope," "per oos046 SNDAs are out of scope") but generated the finding anyway with reasoning like "but it's the only operative deal document," "but it's relevant," or "but it shows the deal terms." Out-of-scope learnings are absolute. The override rationale is invalid. → DROP.

F34 [AFFIRMATIVE-CURRENT NARRATIVE]: The finding is a narrative confirming the lease IS current, the chain IS complete, the document IS present, the guaranty IS executed, or any other affirmative status confirmation. Phrases include "the lease is current and active through," "the amendment chain is complete and unbroken," "the guaranty is in force," "all documents are present," "no missing documents." → DROP. Reviewer time is spent on actionable items only — silence = current.

F35 [MEMORANDUM OF LEASE / SNDA / ESTOPPEL / BROKER COMMISSION / FRANCHISE / COLLATERAL ASSIGNMENT]: The finding flags any of: a Memorandum of Lease as missing or unsigned; an SNDA as missing or unsigned; an Estoppel Certificate as missing or needing signature; a Broker Commission Agreement / Lease Commission Agreement as missing; a Franchise Agreement or Franchise Collateral Assignment as missing. → DROP — none of these are abstracted in this practice.

F36 [OPERATIONAL DOCS — HVAC / COI / W-9 / ACH / COMMITTEE / NOTICE OF MERGER / BANKRUPTCY ORDER / CONSTRUCTION SUB-DOC]: The finding flags any of: HVAC Service Agreement, Pest Control Agreement, Certificate of Insurance, Business License, W-9 form, ACH/Direct Deposit Authorization, Committee Review or Deal Approval Form, Sales Report demand or audit correspondence, Notice of Merger, Bankruptcy Assumption Order or court order, AIA G704 / Certificate of Substantial Completion / TIA / Punch List / construction sub-contract — as missing or unsigned. → DROP — operational documents are out of scope.

F37 [PRE-PRINTED NAME STRUCK OUT WITH HANDWRITTEN REPLACEMENT / SIGNATURE STYLE MISMATCH]: The finding flags an execution defect because either: (a) a pre-printed name was struck through and a different handwritten name + signature was added in its place; or (b) the handwritten signature does not visually match the printed name (e.g., printed name is John Smith but signature looks like initials or a stylized scrawl). → DROP — both are valid execution. Only the PRESENCE of a By: signature mark determines execution.

F38 [BODY-PAGE INITIALS PARTIAL OR MISSING]: The finding is about partial or missing initials on lease body pages (where each party initials each page as "read and accepted") — one party initialed, the other did not, or some pages have initials and others don't. → DROP — body-page initials are courtesy markings, not execution defects. Only the formal By: signature block at the end of the document determines execution.

F39 [COUNTERPART SIGNATURES ACROSS PAGES]: The finding flags a document as unexecuted, partially executed, or with blank signature blocks because one party's signature is on a different page from another party's, OR because one counterpart page has a blank block while another page has the signature. If the document contains a counterparts clause (or even when it does not — counterpart execution is standard practice), and EACH required party has a visible signature somewhere in the document (handwritten, electronic, DocuSign indicator, or initials), the document is FULLY EXECUTED. Apply this to Tri-Party Agreements (4+ signatories across multiple pages), Subleases (Sublandlord + Subtenant on consecutive pages), Supplemental Agreements (Landlord + Tenant + Guarantor each on their own counterpart), and any multi-page execution document. → DROP.

F40 [STOCKBRIDGE / NORTHWOOD-PLAZA EXHIBIT-LETTER MISMAP]: The finding identifies an exhibit by the wrong content (most commonly: calling Exhibit D the Guaranty when in this landlord's template Exhibit D = Sign Criteria and Exhibit F = Guaranty), OR flags an Exhibit D as missing when the lease's actual Exhibit D is "Sign Criteria" and is present. → DROP if the named exhibit content is actually present in the document under a different exhibit letter. Encourage re-reading the lease's exhibit INDEX to confirm letter assignments before flagging.

F41 [CONFIRMED EFFECTIVE DATE / META-OBSERVATION FINDINGS]: The finding's deliverable is to "confirm" something rather than to obtain a missing document or signature — examples: "Confirmed effective date of [amendment]," "Confirm scope of [agreement]," "Please confirm if this document is within abstracting scope," "Verify exhibit numbering." Findings whose action is "confirm" or "verify" rather than "obtain" or "secure" are meta-observations, not Missing Document findings. → DROP unless the finding restates a concrete missing item (a document, a signature, an exhibit).\``


// ── Pre-Todd execution verification ───────────────────────────────────────────
// When the main model flags a document as not executed, this re-examines that
// specific document to confirm. If the By: line actually has a signature, the
// finding is dropped before Todd ever sees it.
// Fail-safe: on any error the original findings are returned unchanged.
export async function verifyExecutionFindings(findings, files) {
  if (!findings || findings.length === 0) return findings

  const execEntries = findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.checkType === 'EXECUTION')

  if (execEntries.length === 0) return findings

  const extractFilename = (f) => {
    const haystack = `${f.evidence || ''} ${f.comment || ''} ${f.missingDocument || ''}`
    const m = haystack.match(/[\w\s\-'(),.&!#]+\.pdf/i)
    return m ? m[0].trim() : null
  }

  const findFile = (docName) => {
    if (!docName) return null
    const norm = s => s.toLowerCase().replace(/[\s_\-(),.&!'#]+/g, '')
    const target = norm(docName)
    return (
      files.find(f => norm(f.originalName) === target) ||
      files.find(f => norm(f.originalName).includes(target.substring(0, Math.min(target.length, 20)))) ||
      files.find(f => target.includes(norm(f.originalName).substring(0, Math.min(norm(f.originalName).length, 20))))
    ) || null
  }

  const verifyTargets = execEntries.map(({ f, i }) => {
    const docName = extractFilename(f)
    const file    = findFile(docName)
    return { idx: i, finding: f, docName, file }
  })

  const verifiable = verifyTargets.filter(v => v.file && v.file.diskPath)
  if (verifiable.length === 0) {
    console.log('[exec-verify] No matchable files for EXECUTION findings — skipping verification')
    return findings
  }

  const promptLines = verifiable
    .map((v, n) => `[${n}] ${v.file.originalName} — Finding: ${(v.finding.missingDocument || '').substring(0, 200)}`)
    .join('\n')

  const content = [{
    type: 'text',
    text: `For each item below, look at the corresponding document and answer: is the By: signature line actually signed (any handwritten signature, initials, electronic signature mark, or DocuSign indicator) for EACH required party?

Respond with exactly one line per item:
[N]: EXECUTED — [one-sentence evidence]
[N]: NOT_EXECUTED — [one-sentence evidence]

Items:
${promptLines}`
  }]

  for (const v of verifiable) {
    try {
      const buf = fs.readFileSync(v.file.diskPath)
      content.push({
        type:   'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        title:  v.file.originalName
      })
    } catch { /* skip unreadable */ }
  }

  try {
    const resp = await createMessageWithFailover({
      model:       MODEL_SONNET,
      max_tokens:  Math.max(300, verifiable.length * 80),
      temperature: 0,
      system:      'You verify document execution status. For each numbered item, examine the named PDF and determine whether the By: signature line for each required party has a visible signature. Answer EXECUTED if By: is signed, NOT_EXECUTED if By: is blank. Be concise.',
      messages:    [{ role: 'user', content }]
    })

    const text = resp.content[0]?.text || ''
    const confirmedExecuted = new Set()

    verifiable.forEach((v, n) => {
      const lineMatch = text.match(new RegExp(`\\[${n}\\][^\\n]*`, 'i'))
      if (lineMatch) {
        const line = lineMatch[0]
        if (/EXECUTED/i.test(line) && !/NOT_EXECUTED/i.test(line)) {
          confirmedExecuted.add(v.idx)
          console.log(`[exec-verify] Confirmed executed: ${v.file.originalName} — EXECUTION finding dropped`)
        }
      }
    })

    if (confirmedExecuted.size === 0) return findings
    const result = findings.filter((_, i) => !confirmedExecuted.has(i))
    console.log(`[exec-verify] Dropped ${confirmedExecuted.size} false EXECUTION finding(s) — ${result.length}/${findings.length} remain`)
    return result
  } catch (err) {
    console.warn(`[exec-verify] Verification call failed: ${err.message} — returning original findings`)
    return findings
  }
}

// ── TP3: Universal Document Verifier ──────────────────────────────────────────
// Replaces the narrow execution-only verifier with a per-finding-type document
// re-check. Every finding gets a targeted verification question against the
// relevant PDF(s):
//   EXECUTION  / GUARANTY      → "Is the By: line actually signed?"
//   MISSING_DOCUMENT           → "Is this document present in the folder under
//                                 ANY filename, by date / parties / type?"
//   MISSING_EXHIBIT / EXHIBIT  → "Does this exhibit's substantive content
//                                 actually exist anywhere in the lease PDF?"
//   AMENDMENT_GAP              → "Is the amendment chain truly broken, or are
//                                 all referenced amendments present?"
//   REFERENCED_DOC             → "Is the referenced document present anywhere?"
//
// Uses Opus 4.7 for the verification call so the document inspection is at the
// highest reasoning quality available. Drops a finding only if Opus is
// confident the issue is false.
//
// Fail-safe: any error returns the original findings unchanged.
export async function tp3VerifyAllFindings(findings, files) {
  if (!findings || findings.length === 0) return findings
  if (!files || files.length === 0) return findings

  // Group findings by verification strategy
  const groups = { perDoc: [], folder: [], lease: [] }
  findings.forEach((f, i) => {
    const t = (f.checkType || '').toUpperCase()
    if (t === 'EXECUTION' || t === 'GUARANTY') groups.perDoc.push({ idx: i, finding: f })
    else if (t === 'MISSING_DOCUMENT' || t === 'AMENDMENT_GAP' || t === 'REFERENCED_DOC') groups.folder.push({ idx: i, finding: f })
    else if (t === 'MISSING_EXHIBIT' || t === 'EXHIBIT') groups.lease.push({ idx: i, finding: f })
    // CURRENCY, NAME_MISMATCH, LEGIBILITY, SPECIAL_AGREEMENT — skip verification
    // (Todd's pattern filters handle these well already)
  })

  const droppedIndices = new Set()

  // Strategy A: per-document verification (EXECUTION, GUARANTY)
  if (groups.perDoc.length > 0) {
    await _tp3VerifyPerDoc(groups.perDoc, files, droppedIndices)
  }

  // Strategy B: folder-manifest verification (MISSING_DOCUMENT, AMENDMENT_GAP, REFERENCED_DOC)
  if (groups.folder.length > 0) {
    await _tp3VerifyAgainstFolder(groups.folder, files, droppedIndices)
  }

  // Strategy C: lease-document verification (MISSING_EXHIBIT, EXHIBIT)
  if (groups.lease.length > 0) {
    await _tp3VerifyAgainstLease(groups.lease, files, droppedIndices)
  }

  if (droppedIndices.size === 0) return findings
  const result = findings.filter((_, i) => !droppedIndices.has(i))
  console.log(`[tp3-verify] Dropped ${droppedIndices.size} false-positive finding(s) — ${result.length}/${findings.length} remain`)
  return result
}

// — Strategy A: send the named PDF to Opus, ask if By: is signed —
async function _tp3VerifyPerDoc(targets, files, droppedIndices) {
  const norm = s => String(s || '').toLowerCase().replace(/[\s_\-(),.&!'#]+/g, '')
  const findFile = (docName) => {
    if (!docName) return null
    const target = norm(docName)
    return (
      files.find(f => norm(f.originalName) === target) ||
      files.find(f => norm(f.originalName).includes(target.substring(0, Math.min(target.length, 20)))) ||
      files.find(f => target.includes(norm(f.originalName).substring(0, Math.min(norm(f.originalName).length, 20))))
    ) || null
  }
  const extractFilename = (f) => {
    const haystack = `${f.evidence || ''} ${f.comment || ''} ${f.missingDocument || ''}`
    const m = haystack.match(/[\w\s\-'(),.&!#]+\.pdf/i)
    return m ? m[0].trim() : null
  }

  const verifiable = targets
    .map(t => {
      const docName = extractFilename(t.finding)
      const file    = findFile(docName)
      return { ...t, docName, file }
    })
    .filter(v => v.file && v.file.diskPath)

  if (verifiable.length === 0) return

  const promptLines = verifiable
    .map((v, n) => `[${n}] ${v.file.originalName} — Finding: ${(v.finding.missingDocument || '').substring(0, 200)}`)
    .join('\n')

  const content = [{
    type: 'text',
    text: `For each numbered item below, examine the corresponding document. Determine whether the By: signature line for EACH required party has a visible signature (handwritten signature, initials, electronic signature mark, DocuSign indicator, OR a printed name with handwritten signature above/below it that does not perfectly match — pre-printed names crossed out with replacement handwritten signatures are still valid execution).\n\nA blank Date: line is NOT an execution defect — only the By: line determines execution.\n\nRespond with exactly one line per item:\n[N]: EXECUTED — [one-sentence evidence]\n[N]: NOT_EXECUTED — [one-sentence evidence describing the genuinely blank By: line]\n\nItems:\n${promptLines}`
  }]

  for (const v of verifiable) {
    try {
      const buf = fs.readFileSync(v.file.diskPath)
      content.push({
        type:   'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        title:  v.file.originalName
      })
    } catch { /* skip unreadable */ }
  }

  try {
    const resp = await createMessageWithFailover({
      model:       MODEL_OPUS,
      max_tokens:  Math.max(500, verifiable.length * 100),
      temperature: 0,
      system:      'You are a senior commercial real estate paralegal verifying document execution. Examine each numbered document and determine if the By: signature line is actually signed for each required party. Be thorough — pre-printed names struck through with handwritten replacements ARE valid signatures; signatures appearing on a counterpart or following page ARE valid; signatures that do not perfectly visually match the printed name ARE valid; only the By: line matters (Date:, Title:, notary, witnesses are irrelevant to execution).',
      messages:    [{ role: 'user', content }]
    })

    const text = resp.content[0]?.text || ''
    verifiable.forEach((v, n) => {
      const lineMatch = text.match(new RegExp(`\\[${n}\\][^\\n]*`, 'i'))
      if (!lineMatch) return
      const line = lineMatch[0]
      if (/EXECUTED/i.test(line) && !/NOT_EXECUTED/i.test(line)) {
        droppedIndices.add(v.idx)
        console.log(`[tp3-verify] perDoc ✅ EXECUTED: ${v.file.originalName} — finding dropped`)
      }
    })
  } catch (err) {
    console.warn(`[tp3-verify] perDoc batch failed: ${err.message}`)
  }
}

// — Strategy B: Opus sees full folder manifest + finding list, decides if doc is present —
async function _tp3VerifyAgainstFolder(targets, files, droppedIndices) {
  const manifest = files
    .map(f => `  • ${f.originalName}`)
    .join('\n')

  const findingsList = targets
    .map((t, n) => `[${n}] TYPE=${t.finding.checkType} — ${(t.finding.missingDocument || '').substring(0, 250)}`)
    .join('\n\n')

  const content = [{
    type: 'text',
    text: `You are verifying claims that documents are missing from a tenant's lease folder. Below is the COMPLETE list of files in the folder, followed by missing-document findings to verify.\n\nFor each finding, answer: is there a file in the manifest that plausibly corresponds to the document the finding claims is missing? Match generously by date (e.g., '2002-12-31' in filename matches 'December 31, 2002'), by parties (e.g., 'Tweeter-Assignment' matches 'Assignment by Tweeter'), by document type (e.g., '3rd-Amendment' matches 'Third Amendment'), or any combination. Filenames rarely match formal titles exactly.\n\nAlso consider: if the finding is about an amendment that's been superseded by an Amended & Restated Lease (also in the folder), or by a more recent amendment that incorporates the prior one, the finding is moot.\n\nRespond with exactly one line per item:\n[N]: PRESENT — [filename or evidence]\n[N]: GENUINELY_MISSING — [why no file in the manifest can satisfy this]\n\nFOLDER MANIFEST:\n${manifest}\n\nFINDINGS TO VERIFY:\n${findingsList}`
  }]

  try {
    const resp = await createMessageWithFailover({
      model:       MODEL_OPUS,
      max_tokens:  Math.max(500, targets.length * 100),
      temperature: 0,
      system:      'You are a senior real estate paralegal cross-checking missing-document claims against the actual folder manifest. Match filenames to claimed-missing documents generously. Filenames are administrative — they rarely match formal titles. A 50% similarity by date/parties/type is enough to declare PRESENT. Only mark GENUINELY_MISSING if there is no plausible filename match anywhere in the manifest.',
      messages:    [{ role: 'user', content }]
    })

    const text = resp.content[0]?.text || ''
    targets.forEach((t, n) => {
      const lineMatch = text.match(new RegExp(`\\[${n}\\][^\\n]*`, 'i'))
      if (!lineMatch) return
      const line = lineMatch[0]
      if (/PRESENT/i.test(line) && !/GENUINELY_MISSING/i.test(line)) {
        droppedIndices.add(t.idx)
        console.log(`[tp3-verify] folder ✅ PRESENT: ${(t.finding.missingDocument || '').substring(0, 60)} — finding dropped`)
      }
    })
  } catch (err) {
    console.warn(`[tp3-verify] folder batch failed: ${err.message}`)
  }
}

// — Strategy C: send the lease PDF to Opus, ask if exhibit content exists —
async function _tp3VerifyAgainstLease(targets, files, droppedIndices) {
  // Pick the largest PDF as the most likely lease document
  const pdfs = files.filter(f => /\.pdf$/i.test(f.originalName) && f.diskPath)
  if (pdfs.length === 0) return

  const lease = pdfs
    .map(f => ({ f, size: (() => { try { return fs.statSync(f.diskPath).size } catch { return 0 } })() }))
    .sort((a, b) => b.size - a.size)[0]?.f

  if (!lease) return

  const findingsList = targets
    .map((t, n) => `[${n}] ${(t.finding.missingDocument || '').substring(0, 250)}`)
    .join('\n\n')

  const content = [{
    type: 'text',
    text: `Below is the primary lease document for a tenant. After it, there are findings claiming specific exhibits are missing or incomplete.\n\nFor each finding, examine the lease PDF and determine: does the substantive content of the named exhibit exist anywhere in the document?\n\nKey rules:\n- Exhibit content can appear far past the signature page — read the full document.\n- An exhibit heading page (e.g., "Exhibit C, Page 1") with substantive content following = PRESENT.\n- An exhibit listed in the index but with no content anywhere AND no cover page = GENUINELY_MISSING.\n- An exhibit with ONLY a cover page and no following content = COVER_ONLY (not flagged at initial review).\n- An exhibit marked "RESERVED" or "[Intentionally Left Blank]" = PRESENT (intentionally so).\n- Sub-exhibits (Exhibit A-1, A-2 within Exhibit A) are not separately required.\n\nRespond with exactly one line per item:\n[N]: PRESENT — [page or section reference]\n[N]: COVER_ONLY — [evidence]\n[N]: GENUINELY_MISSING — [evidence]\n\nFINDINGS TO VERIFY:\n${findingsList}`
  }]

  try {
    const buf = fs.readFileSync(lease.diskPath)
    content.push({
      type:   'document',
      source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
      title:  lease.originalName
    })
  } catch {
    return
  }

  try {
    const resp = await createMessageWithFailover({
      model:       MODEL_OPUS,
      max_tokens:  Math.max(500, targets.length * 100),
      temperature: 0,
      system:      'You are a senior commercial real estate paralegal verifying exhibit-completeness claims. Examine the lease PDF in full — exhibit content often appears far after the signature page. PRESENT if substantive exhibit content exists anywhere. COVER_ONLY if only a heading page exists. GENUINELY_MISSING only if there is no cover page and no content for that specific exhibit.',
      messages:    [{ role: 'user', content }]
    })

    const text = resp.content[0]?.text || ''
    targets.forEach((t, n) => {
      const lineMatch = text.match(new RegExp(`\\[${n}\\][^\\n]*`, 'i'))
      if (!lineMatch) return
      const line = lineMatch[0]
      // Drop if PRESENT or COVER_ONLY (both are KEEP-not-flag at initial review)
      if (/PRESENT/i.test(line) && !/GENUINELY_MISSING/i.test(line)) {
        droppedIndices.add(t.idx)
        console.log(`[tp3-verify] lease ✅ PRESENT: ${(t.finding.missingDocument || '').substring(0, 60)} — finding dropped`)
      } else if (/COVER_ONLY/i.test(line)) {
        droppedIndices.add(t.idx)
        console.log(`[tp3-verify] lease ⚠️ COVER_ONLY: ${(t.finding.missingDocument || '').substring(0, 60)} — finding dropped (initial-review rule)`)
      }
    })
  } catch (err) {
    console.warn(`[tp3-verify] lease batch failed: ${err.message}`)
  }
}

// ── TP3: Senior-Lawyer Self-Review ────────────────────────────────────────────
// Final pass after Todd. Reads the surviving findings as a senior commercial
// real estate lawyer about to send them to a partner for review. Drops the
// findings that "would be embarrassing" — affirmative-current narratives,
// confirmatory observations, anything that's not a concrete actionable item.
// Uses Opus for highest judgment quality. Fail-safe: errors return findings
// unchanged.
export async function tp3SeniorLawyerReview(findings, tenantName) {
  if (!findings || findings.length === 0) return findings

  const block = findings.map((f, i) => {
    const md = (f.missingDocument || '').substring(0, 350)
    const co = (f.comment || '').substring(0, 600)
    return `[${i}] TYPE=${f.checkType} SEV=${f.severity}\n${md}\n${co ? '— ' + co : ''}`
  }).join('\n\n')

  const systemPrompt = `You are a senior commercial real estate lawyer performing the final review on a junior associate's lease-abstract findings before they go to the partner.

Your job: drop anything you would be embarrassed to send up. Keep ONLY findings that meet ALL THREE criteria:
  1. ACTIONABLE — the partner would need to do something specific (obtain a missing document, secure a missing signature, or flag a material ambiguity).
  2. UNRESOLVED — the finding's own text does not already explain why it's not actually a problem.
  3. NON-CONFIRMATORY — the finding is not just observing that something is correct, current, present, complete, or executed.

Drop on sight:
  • Affirmative narratives that the lease IS current, the chain IS complete, the document IS present, the guaranty IS executed.
  • Findings whose own text says "this is correct," "this is fine," "no action needed," "for awareness only," "informational."
  • Speculative findings without a specific named missing document.
  • Findings about secondary signature fields (Date, Title, witnesses, notary) when By: is signed.
  • Findings that contradict themselves at the end of a long comment.
  • Anything that the partner would shake their head at as not actionable.

Respond with one line per index, exactly:
KEEP [N]
DROP [N]: [one short reason]`

  const userPrompt = `TENANT: ${tenantName}

SURVIVING FINDINGS (${findings.length} total) — apply the senior-lawyer test to each:

${block}

For every index [0] through [${findings.length - 1}] respond KEEP or DROP. Do not skip any.`

  try {
    const resp = await createMessageWithFailover({
      model:       MODEL_OPUS,
      max_tokens:  Math.max(800, findings.length * 80),
      temperature: 0,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: userPrompt }]
    })

    const text = resp.content[0]?.text || ''
    const keepIndices = new Set()
    const dropLog = []
    for (const line of text.split('\n')) {
      const km = line.match(/^KEEP\s+(\d+)/i)
      const dm = line.match(/^DROP\s+(\d+):\s*(.*)/i)
      if (km) keepIndices.add(parseInt(km[1], 10))
      if (dm) dropLog.push({ index: parseInt(dm[1], 10), reason: dm[2].trim() })
    }

    if (keepIndices.size === 0 && dropLog.length === 0) {
      console.warn(`[tp3-lawyer] No decisions parsed for ${tenantName} — returning unfiltered`)
      return findings
    }
    if (keepIndices.size === 0 && dropLog.length > 0) {
      console.warn(`[tp3-lawyer] All findings dropped for ${tenantName} — too aggressive, returning unfiltered`)
      return findings
    }

    const filtered = findings.filter((_, i) => keepIndices.has(i))
    if (dropLog.length > 0) {
      console.log(`[tp3-lawyer] ${tenantName}: kept ${filtered.length}/${findings.length} — dropped ${dropLog.length}: ${dropLog.map(d => `[${d.index}] ${d.reason.substring(0, 60)}`).join(' | ')}`)
    }
    return filtered
  } catch (err) {
    console.warn(`[tp3-lawyer] Error for ${tenantName}: ${err.message} — returning unfiltered`)
    return findings
  }
}

export async function filterFindingsForRelevance(findings, activeLearnings, tenantName, fileList = []) {
  if (!findings || findings.length === 0) return findings
  if (!activeLearnings || activeLearnings.length === 0) return findings

  const learningBlock = activeLearnings
    .map((l, i) => `RULE ${i + 1} [${l.checkType || 'GENERAL'}]: ${l.suggestion}`)
    .join('\n\n')

  // Build folder manifest — list of filenames Todd can use for F28 cross-check
  const manifestBlock = (fileList && fileList.length > 0)
    ? fileList.map(f => `  • ${f.originalName || f}`).join('\n')
    : '  (no folder manifest provided)'

  const findingsBlock = findings.map((f, i) => {
    // Show BOTH missingDocument AND comment (concatenated, not OR) so self-withdrawal
    // text at the END of a long comment is always visible to the filter.
    const parts = []
    if (f.missingDocument) parts.push(f.missingDocument.substring(0, 400))
    if (f.comment)          parts.push(f.comment.substring(0, 800))
    const main     = parts.length > 0 ? parts.join('\n[COMMENT]: ') : 'No description'
    const evidence = f.evidence && f.evidence !== 'N/A' ? `\nEVIDENCE: ${f.evidence.substring(0, 300)}` : ''
    return `[${i}] TYPE=${f.checkType} SEVERITY=${f.severity}\n${main}${evidence}`
  }).join('\n\n')

  const systemPrompt = `You are Todd — a senior commercial lease review quality-control filter. Your ONLY job is FALSE POSITIVE REMOVAL. You have two sets of rules: your own FILTER RULES (F1–F41, derived directly from reviewer rejection reasons) and CROSS-CHECK RULES (the main model's training rules). Use both.

CORE PRINCIPLE — THE ONLY REASON TO KEEP A FINDING:
A finding earns KEEP only if acting on it would require the reviewer to do one of exactly three things:
  (A) Go obtain a specific document that is genuinely missing from the folder
  (B) Go obtain a specific signature that is genuinely absent from a document
  (C) Flag an ambiguity that materially affects the deal and cannot be resolved from the folder alone

If none of A, B, or C apply → DROP. This includes findings that are FACTUALLY CORRECT. A "true but irrelevant" finding is a false positive just as much as a factually wrong one. The reviewer's time is the resource being protected.

Run these four checks IN ORDER and DROP on the first match:

1. SELF-CONTRADICTION CHECK: Does the finding's own text already dismiss or explain away the issue? Look for ANY of these phrases anywhere in the text — including buried at the very END of a long comment:
   • "this is acceptable" / "this is acceptable shorthand" / "not a mismatch"
   • "not a deficiency" / "not a finding" / "executed version is operative"
   • "no missing document" / "fully executed" / "sufficient" / "no action needed"
   • "WITHDRAWING" / "WITHDRAWING THIS FINDING" / "WITHDRAWN" / "being WITHDRAWN"
   • "NOT valid per Learning" / "per learning rule" / "per training rule"
   • "false positive" / "not actionable" / "must be suppressed"
   • "no finding is generated" / "no finding generated" / "no finding is output"
   • "suppressed per Learning" / "suppressed per Rule" / "suppressed per" / "being suppressed" / "is suppressed"
   • "self-check — no finding" / "self-check:" / "This is a self-check"
   • "not an execution defect" / "no execution defect" / "not an execution issue"
   • "this finding is being withdrawn" / "being withdrawn" / "this finding is withdrawn"
   • "not actionable" / "does not need to be noted" / "need not be noted"
   • "but flagging anyway" / "flagged anyway" / "flagging anyway since"
   • "the only operative deal document" / "the only deal document" / "the only document in the folder"
   • "Learning [N] says" / "per Learning 40" / "Learning rule says"
   • "however, executed" / "however, signed" / "executed version exists" / "signed version exists"
   • "is in the folder as" / "exists in the folder as" / "is present as file" / "filename matches"
   • "the standalone" / "standalone Guaranty file IS executed" / "standalone copy is signed"
   • "the other has signature" / "other copy is signed" / "another copy is fully executed"
   • "retained for training" / "training transparency" / "Retained here for training" / "for training transparency only" / "training visibility" / "for training purposes" / "Flagging for training"
   • "for reviewer awareness" / "for awareness only" / "flagging at MEDIUM for reviewer awareness" / "flagging at LOW for awareness"
   • "NOT flagged as a finding" / "not flagged as a finding" / "is not being flagged" / "would not be flagged" / "this should not be flagged"
   • "self-resolving" / "self-resolved" / "this is self-resolving" / "is self-resolving"
   • "execution is complete" / "execution IS complete" / "no execution finding warranted" / "no execution defect exists" / "No execution deficiency exists"
   • "blank fill-in date is not" / "blank date is not" / "blank effective date is not"
   • "Both parties have signed" / "all parties have signed" / "Both parties signed" / "all required parties signed"
   • "WITHDRAW" / "WITHDRAWN" / "WITHDRAWING" / "WITHDRAWING THIS FINDING" / "withdraw this finding" / "I am withdrawing"
   • "RETRACT" / "I retract" / "retracting" / "RETRACT — see reasoning"
   • "FINDING DROPPED" / "finding is dropped" / "dropping this finding" / "DROP this finding" / "should be dropped"
   • "No finding warranted" / "no finding warranted" / "no finding is warranted" / "is not warranted"
   • "this finding is therefore NOT valid" / "this finding is NOT valid" / "this is NOT a valid finding"
   • "must be suppressed" / "should be suppressed" / "must be dropped"
   • "Just make sure it's present" / "we don't analyze signature shape" / "stylized mark" + ("is fine" or "is acceptable")
   • Exhibit heading present language: "We have a page for Exhibit" / "the exhibit page is present" / "heading page exists"
   If ANY of these appear → DROP immediately. This list is NON-NEGOTIABLE. The most common failure mode is the AI writes the rejection reason inside its own finding text and then submits the finding anyway. DO NOT LET THOSE THROUGH.

2. TODD FILTER RULE CHECK (primary): Does the finding match any of your F1–F41 filter rules below? These are derived directly from reviewer rejection language — patterns the reviewer consistently rejected. If matched → DROP.

3. CROSS-CHECK RULE MATCH (secondary): Does the finding match any of the main model's validated training rules? Use the finding's TYPE field to focus on matching-type rules first, then GENERAL rules. If matched → DROP.

4. FOLDER MANIFEST CHECK: For any MISSING_DOCUMENT, MISSING_EXHIBIT, AMENDMENT_GAP, or REFERENCED_DOC finding, scan the FOLDER MANIFEST (list of all files in the folder) below. Look for filename matches by date, parties, document type, or transaction date. Filenames rarely match formal titles exactly — match generously. If a plausible match exists in the manifest → DROP. Examples: filename '2002-12-31-Tweeter-Assignment-PDF.PDF' satisfies a finding about 'Assignment dated December 31, 2002 by Tweeter.' Filename '3rd-Amendment-Executed.pdf' satisfies a finding about 'Third Amendment.'

5. REDUNDANCY CHECK (run AFTER evaluating all findings individually): Scan across all findings you've marked KEEP and group them by the document they reference. For any group of 2+ findings about the same document with the same defect type, keep the single most specific and evidenced one — DROP the rest. Common patterns: same document flagged unexecuted twice, same gap as both MISSING_DOCUMENT and AMENDMENT_GAP, same execution issue from two pages of the same document. Keep the clearest version, drop the vaguer one.

KEEP only findings that survive all five checks — real, unresolved, non-duplicate, genuinely actionable.

Respond ONLY with one decision per line in EXACTLY this format — no other text:
KEEP [number]
DROP [number]: [one brief reason]`

  const userPrompt = `TENANT: ${tenantName}

FOLDER MANIFEST — every file present in this tenant's folder (use for Check 4):
${manifestBlock}

TODD FILTER RULES — DROP PATTERNS DERIVED FROM REVIEWER REJECTIONS (your primary decision guide):
${TODD_FILTER_RULES}

CROSS-CHECK RULES — MAIN MODEL TRAINING (secondary, use to catch remaining known patterns):
${learningBlock}

FINDINGS TO VALIDATE (${findings.length} total):
${findingsBlock}

Apply all five checks above (self-contradiction, Todd filter rules, cross-check rules, folder manifest, redundancy). Respond with KEEP or DROP for every finding [0] through [${findings.length - 1}]. Do not skip any index.`

  try {
    const response = await createMessageWithFailover({
      model:      MODEL_SONNET,
      max_tokens: Math.max(1200, findings.length * 100),
      temperature: 0,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0]?.text || ''
    const keepIndices = new Set()
    const dropLog     = []

    for (const line of text.split('\n')) {
      const km = line.match(/^KEEP\s+(\d+)/i)
      const dm = line.match(/^DROP\s+(\d+):\s*(.*)/i)
      if (km) keepIndices.add(parseInt(km[1], 10))
      if (dm) dropLog.push({ index: parseInt(dm[1], 10), reason: dm[2].trim() })
    }

    // Fail-safe: if nothing was parsed return original
    if (keepIndices.size === 0 && dropLog.length === 0) {
      console.warn(`[relevance-filter] Parse produced no decisions for ${tenantName} — returning unfiltered`)
      return findings
    }

    // Fail-safe: if everything was dropped (suspiciously aggressive) return original
    if (keepIndices.size === 0 && dropLog.length > 0) {
      console.warn(`[relevance-filter] All ${findings.length} findings dropped for ${tenantName} — too aggressive, returning unfiltered`)
      return findings
    }

    const filtered = findings.filter((_, i) => keepIndices.has(i))
    if (dropLog.length > 0) {
      console.log(`[relevance-filter] ${tenantName}: kept ${filtered.length}/${findings.length} — dropped ${dropLog.length}: ${dropLog.map(d => `[${d.index}] ${d.reason.substring(0, 60)}`).join(' | ')}`)
    }
    return filtered
  } catch (err) {
    console.warn(`[relevance-filter] Error for ${tenantName}: ${err.message} — returning unfiltered findings`)
    return findings
  }
}
