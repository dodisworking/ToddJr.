import Anthropic from '@anthropic-ai/sdk'
import { pickClaudeModel, pickClaudeMaxTokens } from './anthropic-config.js'

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

  // ── Block 2: One document block per PDF ───────────────────
  for (const pdf of pdfDocs) {
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

Steps:
1. Note every exhibit letter/number listed in the FORMAL EXHIBIT INDEX (if present). If no index, note any exhibit letters/numbers that appear skipped in the document body.
2. For each indexed exhibit, search the ENTIRE document (and the full folder) before concluding it is absent. An exhibit heading page that appears blank may have its actual content on the following page — this is common in scanned leases. Read past the heading before deciding.
3. Only flag an exhibit as missing if, after reading the complete document and all other files in the folder, that exhibit's content is genuinely nowhere to be found.
4. Do NOT flag exhibits based on a single page that looks blank — always check the pages immediately following.
5. Do NOT flag exhibits that are referenced only in passing body text if they are not separately listed in an index.

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
    // ── 413: request body too large ──────────────────────────
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
    ? rejectedFindings.map((f, i) =>
        `${i + 1}. [${f.checkType}] "${f.missingDocument}"\n   Evidence: ${f.evidence || 'none'}\n   AI comment: ${f.comment || 'none'}\n   Reviewer note: ${f.reviewerNote || 'No comment provided'}`
      ).join('\n\n')
    : 'None — all findings were confirmed or no findings were generated.'

  const confirmedBlock = confirmedFindings.length > 0
    ? confirmedFindings.map((f, i) => `${i + 1}. [${f.checkType}] "${f.missingDocument}" — Evidence: ${f.evidence || 'none'}`).join('\n')
    : 'None'

  const annotationsBlock = annotations.length > 0
    ? annotations.map((a, i) => `${i + 1}. Reviewer flagged: "${a.comment}" on ${a.docName || 'unknown doc'} p.${a.pageNum || '?'}`).join('\n')
    : 'None'

  const currentRulesBlock = currentRules.length > 0
    ? currentRules.map((r, i) => `RULE ${i + 1} [${r.id}][${r.checkType}] ${r.type} (confidence ${r.confidence || 1}): ${r.rule}`).join('\n')
    : 'None yet — this is the first tenant in the session.'

  const prompt = `You are the active learning engine for Todd Jr., a real estate document review AI.

An expert paralegal just finished reviewing the AI's findings for one tenant folder.

═══ FINDINGS THE AI GOT WRONG (REJECTED BY REVIEWER) ═══
${rejectedBlock}

═══ FINDINGS THE AI GOT RIGHT (CONFIRMED) ═══
${confirmedBlock}

═══ THINGS THE REVIEWER FLAGGED THAT THE AI MISSED ═══
${annotationsBlock}

═══ CURRENT SESSION RULES (from prior tenants this session) ═══
${currentRulesBlock}

YOUR JOB:
Produce an updated complete rule set. For each rejected finding, analyze WHY it was wrong based on its evidence and generalize a rule that prevents the same mistake on a different tenant with different documents. For each missed finding, write a detection rule to catch that pattern.

Rules must be:
- Specific to the EVIDENCE PATTERN, not to the specific tenant's name or details
- Conditional where needed ("only flag X if Y is absent from the folder")
- Not so broad that they suppress an entire check type

Keep rules from prior tenants unless strongly contradicted. Increment confidence when the same pattern appears again.

Return ONLY valid JSON (no markdown, no prose, no code fences):
{
  "rules": [
    {
      "id": "r-1",
      "type": "AVOID_FALSE_POSITIVE",
      "checkType": "EXECUTION",
      "rule": "Clear actionable instruction for the next analysis",
      "triggeredBy": "Brief description of what caused this rule",
      "confidence": 1
    }
  ],
  "summary": "One sentence: what changed and why"
}`

  const response = await createMessageWithFailover({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    temperature: 0.1,
    system: [{ type: 'text', text: 'You are the active learning engine for a real estate document review AI. Return only valid JSON.' }],
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
  // Gym mode requires verbose output (reasoning, triggerQuote, checkedAndEliminated per finding)
  // — bump to 32768 to avoid truncation on complex folders.  Sonnet supports up to 64k output.
  const max_tokens = pickClaudeMaxTokens(cheap, 32768)
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)
    // Replace the last content block (standard instructions) with the gym version
    content.pop()
    content.push({ type: 'text', text: buildGymAnalysisInstructions(tenant, new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })) })

    // Use juice-enhanced system prompt if active learning rules are present
    const systemPrompt = options.juiceRules?.length > 0
      ? buildJuiceSystemPrompt(options.juiceRules)
      : SYSTEM_PROMPT

    const betaParams = {
      model,
      max_tokens,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25', 'prompt-caching-2024-07-31'],
      system:     [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages:   [{ role: 'user', content }]
    }
    // TP2 parallel mode: client picks the freshest key per tenant to avoid hammering a rate-limited key.
    // Otherwise use the gym-specific wrapper (20-min timeout) — gym responses can be large.
    const response = (options.preferredKeyIdx !== undefined)
      ? await createBetaMessageWithPreferredKey(betaParams, options.preferredKeyIdx)
      : await createBetaMessageForGym(betaParams)

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
  // Apply trailing fence strip BEFORE jsonStart so we don't leave ``` inside the JSON string.
  let raw     = text.trim().replace(/\s*```\s*$/, '').trim()
  const jsonStart = raw.indexOf('{')
  const jsonEnd   = raw.lastIndexOf('}')
  let cleaned = (jsonStart >= 0 && jsonEnd > jsonStart)
    ? raw.substring(jsonStart, jsonEnd + 1)
    : raw.replace(/^```(?:json)?\s*/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed.findings || !Array.isArray(parsed.findings)) throw new Error('findings array missing')
    return parsed
  } catch (e) {
    if (attempt < 1) {
      console.log(`[claude/gym] JSON parse failed for ${tenant.tenantName}, retrying...`)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, options)
    }
    console.error(`[claude/gym] Could not parse response for ${tenant.tenantName}:`, text.substring(0, 300))
    return {
      tenantNameInDocuments: 'Parse error',
      mostRecentDocumentDate: null,
      leaseExpirationDate: null,
      findings: [{
        checkType: 'LEGIBILITY', severity: 'HIGH',
        missingDocument: 'N/A',
        comment: 'Claude returned an unparseable response. Manual review required.',
        evidence: `Raw preview: ${text.substring(0, 300)}`,
        triggerQuote: '', reasoning: '', checkedAndEliminated: [], confidence: 'LOW', howIFoundThis: ''
      }],
      allClear: false
    }
  }
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
export async function synthesizeAcrossBatches(tenant, batchResults, allFileNames, options = {}) {
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

  const findingsBlock = allFindings.map((f, idx) =>
    `FINDING ${idx + 1} [from Batch ${f._batch}]
  checkType:       ${f.checkType}
  severity:        ${f.severity}
  missingDocument: ${f.missingDocument}
  comment:         ${f.comment}
  evidence:        ${f.evidence}`
  ).join('\n\n')

  const crossRefsBlock = allCrossRefs.length > 0
    ? allCrossRefs.map((r, idx) =>
        `CROSS-REF ${idx + 1} [from Batch ${r._batch}]: "${r.documentName}"\n  spotted in: ${r.referencedIn}\n  issue: ${r.issue}`
      ).join('\n\n')
    : 'None flagged.'

  // Pick the most specific tenant name and dates across all batches
  const tenantNameInDocuments = batchResults.find(r => r.tenantNameInDocuments)?.tenantNameInDocuments || tenant.tenantName
  const leaseExpirationDate   = batchResults.map(r => r.leaseExpirationDate).filter(Boolean).pop() || null
  const mostRecentDocumentDate = batchResults.map(r => r.mostRecentDocumentDate).filter(Boolean).sort().pop() || null

  const prompt = `CROSS-BATCH SYNTHESIS — FINAL RECONCILIATION

TENANT:  ${tenant.tenantName}
FOLDER:  ${tenant.folderName}
TODAY:   ${today}
BATCHES: ${batchResults.length}

ALL DOCUMENTS IN FOLDER (${allFileNames.length} total):
${allFileNames.map(f => `  • ${f}`).join('\n')}

This tenant folder was too large to send in one API call, so it was split into ${batchResults.length} batches. Each batch analyzed its own PDFs. Below are ALL findings from ALL batches combined, plus any cross-batch references that batches flagged for verification.

YOUR MISSION: Produce one final accurate findings list. Apply these rules:

1. EXPIRATION CONFLICTS — Most important: if any batch flagged a lease as expired or expiring, check ALL other batch findings for a later amendment that extends the term. If an extension exists, REMOVE the expiry finding and replace it with a note about the current controlling date only if an issue remains.

2. REFERENCED DOCUMENT CONFLICTS — If a batch flagged a document as "missing" but another batch's findings show that same document WAS found and analyzed, REMOVE the missing-doc finding.

3. AMENDMENT SEQUENCE CONFLICTS — If batch 1 flagged a missing Amendment 2, but batch 2 found and analyzed Amendment 2, REMOVE the gap finding.

4. CROSS-BATCH REFERENCES — For each crossBatchReference below, check whether the concern was resolved by findings in another batch. Remove findings that are now confirmed resolved.

5. DEDUPLICATE — If two batches both flagged the same issue (same checkType + same document), keep ONE finding with the most complete evidence.

6. PRESERVE genuine findings — Any finding that is not contradicted or resolved by another batch should be kept exactly as-is.

7. CALIBRATE severity correctly — Do not upgrade severity during synthesis. Only downgrade or remove findings that are resolved.

══════════════════════════════════════════════
ALL FINDINGS FROM ALL BATCHES:
══════════════════════════════════════════════
${findingsBlock}

══════════════════════════════════════════════
CROSS-BATCH REFERENCES TO VERIFY:
══════════════════════════════════════════════
${crossRefsBlock}

Now output the final reconciled result as ONLY this JSON object (no prose, no markdown, no code fences):

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

  console.log(`[claude] Synthesis pass: ${allFindings.length} raw findings from ${batchResults.length} batches, ${allCrossRefs.length} cross-refs to resolve`)

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

  console.log(`[claude] Synthesis pass complete: ${parsed.findings.length} final findings (was ${allFindings.length})`)
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
        `${i + 1}. [${f.checkType || 'UNKNOWN'}] "${f.missingDocument || 'N/A'}"\n   Evidence: ${(f.evidence || 'none').slice(0, 200)}\n   Comment: ${(f.comment || 'none').slice(0, 200)}`
      ).join('\n\n')
    : '⚠️ The model produced NO findings for this tenant (all clear).'

  const correctBlock = shouldFind.map((s, i) => `${i + 1}. ${s}`).join('\n')

  const prompt = `You are the Master Trainer judge for Todd Jr., a real estate document review AI.

TENANT: ${tenantName}

═══ CORRECT ANSWERS — what MUST be found ═══
${correctBlock}

═══ MODEL OUTPUT — what the model actually flagged ═══
${findingsBlock}

TASK:
1. For each correct answer, decide if the model found it. Use SEMANTIC matching — the model may describe the same issue with different words. A partial match counts as caught if the core issue is identified.
2. Identify any model findings that appear to be false positives (flagging things that are not real issues based on standard commercial lease review practice).
3. Write a brief analysis explaining WHY the model missed what it missed and what reasoning caused any false positives. Be specific about the document patterns or reasoning errors.

Score rubric:
  100 = all correct answers caught AND 0 false positives
  Each missed correct answer: -floor(100 / total_required)
  Each false positive: -10 (capped so score never goes below 0)

Return ONLY valid JSON (no markdown, no prose):
{
  "caught":         ["exact text of correct answers the model found (copy from the CORRECT ANSWERS list)"],
  "missed":         ["exact text of correct answers the model did NOT find (copy from the CORRECT ANSWERS list)"],
  "falsePositives": [
    {
      "checkType":       "the finding's checkType field",
      "missingDocument": "the finding's missingDocument text",
      "reason":          "why this appears to be a false positive"
    }
  ],
  "analysis": "2-3 sentences: what reasoning error caused misses/false positives and what pattern should be corrected",
  "score":    <integer 0-100>
}`

  const response = await createMessageWithFailover({
    model:       'claude-sonnet-4-6',
    max_tokens:  1500,
    temperature: 0.1,
    system: [{ type: 'text', text: 'You are the Master Trainer judge for a real estate document review AI. Return only valid JSON.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  })

  const rawText = response.content[0]?.text || ''
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)
  return JSON.parse(cleaned)
}
