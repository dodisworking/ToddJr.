import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are a senior commercial real estate paralegal and lease abstraction specialist with 20+ years of experience performing due diligence document audits for institutional landlords, law firms, and REITs.

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
- WHEN IN DOUBT, keep reading. If after reading everything doubt remains, note it at LOW severity for human review rather than asserting it as a confirmed issue.`

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} tenant    - { id, folderName, property, suite, tenantName }
 * @param {Array}  pdfDocs   - [{ filename, base64, pageCount }]  — sent as native document blocks
 * @param {Array}  textDocs  - [{ filename, text, pageCount, isScanned, error }] — text extracted
 * @param {Array}  pageGapFindings - pre-confirmed page gaps from parser
 * @param {object} batchInfo - { batchNumber, totalBatches, allFileNames } — present when folder is split into batches
 */
export async function analyzeFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null) {
  return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, 0, batchInfo)
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

  // ── Block 4: Pre-confirmed page gap findings ───────────────
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
PRE-CONFIRMED PAGE NUMBER GAPS (detected by automated sequence scan)
${'═'.repeat(70)}
The following gaps were found by reading the printed page numbers from every
page of each PDF and checking the sequence. These are confirmed — include each
as a MISSING_PAGE finding in your JSON output.

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

function buildAnalysisInstructions(tenant, todayStr) {
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
Examine EVERY signature block, signature line, and initials line in EVERY document.

Rules:
- Leases and Amendments to Leases MUST be signed by ALL parties (Landlord and Tenant)
- Additional documents with signature lines should be signed
- If only one party signed, note which party's signature is missing
- If a document is undated after signing, note this
- IMPORTANT: Exhibits do NOT generally need to be executed, UNLESS the exhibit is a Guaranty (see Check 9)

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

Output:
- If expired: "Document extending Term beyond [most recent expiration date]."
- If expiring within 90 days: "Document extending Term beyond [expiration date]. NOTE: Expiring within 90 days."
- If lease is in holdover with no formal extension, also flag this

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

STEP 3 — FLAG ONLY CONFIRMED ABSENCES:
Only after completing the full folder search, flag documents that are referenced but confirmed absent.

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

────────────────────────────────────────────────────────────────
CHECK 6: MISSING PAGES — MANDATORY PAGE-BY-PAGE SCAN
────────────────────────────────────────────────────────────────
THIS CHECK IS MANDATORY FOR EVERY SINGLE DOCUMENT IN THE FOLDER.
You must perform the following scan on every document before moving on. Do not skip any document.

━━━ PART A: PAGE NUMBER SEQUENCE SCAN ━━━

For each document, do this:

1. Go through the document page by page from first to last.
2. On each page, look at the bottom (footer), top (header), or anywhere on the page for a printed page number. It may look like:
   - A standalone number at the bottom center: "3"
   - "Page 3" or "Page 3 of 12" or "- 3 -" or "3."
   - A number printed in a corner
3. Write down the page numbers in the order you encounter them as you move through the document.
4. When you have the full sequence, check for any gap:
   - If the sequence is [1, 2, 3, 4, 5] → no gap, do not flag
   - If the sequence is [1, 2, 3, 4, 8, 9] → pages 5, 6, 7 are missing → FLAG THIS
   - If the sequence is [1, 2, 5] → pages 3, 4 are missing → FLAG THIS
5. Report exactly which pages are missing and what numbers appeared before and after the gap.

This is a visual reading task. You are looking at what is printed on the page, not searching for text patterns. A "3" printed at the bottom of a scanned page IS a page number — read it the same way a human flipping through a file would.

━━━ PART B: CONTENT GAP INFERENCE ━━━

Even if a document has no printed page numbers, or page numbers are illegible, use your professional reading judgment to spot missing content:

- You read "...the Tenant shall comply with all terms set forth in Section 18..." but Section 18 never appears anywhere in the document → pages are likely missing
- A sentence ends mid-clause with no continuation → document is truncated
- The document states it is "15 pages" or "a document of 8 pages" but you counted far fewer → flag the discrepancy
- The body text flows from Section 12 directly to Section 16 with no Sections 13–15 → missing pages
- A signature page is referenced ("IN WITNESS WHEREOF the parties have signed below") but no signature page follows → truncated
- The document closes normally and makes sense end-to-end → no flag needed

━━━ WHAT NOT TO FLAG ━━━

- Roman numeral pages (i, ii, iii) before body pages (1, 2, 3) — this is normal
- Exhibits that restart their own page numbering (Exhibit A has pages 1–5, Exhibit B has pages 1–3) — this is normal
- A document with no page numbers that reads completely and ends at a signature page — no flag

Output format for this check:
• "Pages 5 to 7 of Lease dated 8/22/23 appear to be missing (page numbering jumps from page 4 to page 8)."
• "First Amendment to Lease dated 7/1/24 appears truncated — document ends mid-sentence on what is labeled page 12, no signature page follows."
• "Lease dated 4/1/19 — body text jumps from Section 12 to Section 16 with Sections 13–15 absent; pages likely missing."
• "Lease dated 8/22/23, Section 5.2 references 'Schedule 1 — Work Letter' but no Schedule 1 is present anywhere in this document or folder."

────────────────────────────────────────────────────────────────
CHECK 7: LEGIBILITY / SCAN QUALITY
────────────────────────────────────────────────────────────────
Flag any documents or pages where the content is not readable or usable.

Includes:
- Pages where text is blurry, cut off, or obscured
- Pages where key information (dates, signatures, exhibit content) cannot be read
- Extremely dark or light scans that make text unreadable

Output format:
• "First Amendment to Lease dated 7/1/24 is not scanned properly. Portions of page 2 are not legible."

────────────────────────────────────────────────────────────────
CHECK 8: SPECIAL AGREEMENTS (SCOPE CONFIRMATION)
────────────────────────────────────────────────────────────────
Identify any of the following document types found in the folder, whether standalone or embedded in exhibits:

- License Agreement
- Declaration (CC&Rs, REA, Operating Agreement)
- Easement Agreement
- Access Agreement
- Telecommunications / Telecom Agreement
- Parking Agreement
- SNDA (Subordination, Non-Disturbance, Attornment)
- Right of First Refusal or Option Agreement
- Any other non-standard agreement type

For each found, flag it and ask for scope confirmation.

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

IMPORTANT — do NOT flag these as mismatches:
- Punctuation differences: "Corp." vs "Corp" vs "Corporation"
- Common abbreviations: "Inc." vs "Inc" vs "Incorporated", "LLC" vs "L.L.C."
- Capitalization differences: "THE PIZZA PLACE" vs "The Pizza Place"
- Minor spacing or formatting differences
- Trade name vs legal entity where the connection is obvious

ONLY flag if:
- The base entity name is materially different (different words, different owner)
- There is evidence of an assignment to a different entity that may not be documented
- The tenant name in documents is completely unrecognizable from the folder label

If discrepancy is minor (abbreviation, formatting): do NOT flag — these are expected
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
  "allClear": true
}

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

async function callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo = null) {
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)

    // Use beta.messages for PDF document support
    const response = await client.beta.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 16384,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25'],
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content }]
    })

    const rawText = response.content[0]?.text || ''
    return parseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo)

  } catch (err) {
    // ── 413: request body too large ──────────────────────────
    // Drop all native PDF blocks and retry with text-only. This is a last-resort
    // safety net — analyzer.js should have prevented this via size checks already.
    if (err.status === 413) {
      if (pdfDocs.length > 0) {
        console.log(`[claude] 413 for ${tenant.tenantName} — dropping ${pdfDocs.length} native PDF(s), retrying text-only`)
        return callWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo)
      }
      // Already text-only and still 413 — text content itself is too large, truncate it
      if (textDocs.length > 0) {
        console.log(`[claude] 413 for ${tenant.tenantName} even in text-only mode — truncating text content`)
        const trimmed = textDocs.map(d => ({
          ...d,
          text: d.text ? d.text.substring(0, 50000) + '\n[...truncated due to size...]' : d.text
        }))
        return callWithRetry(tenant, [], trimmed, pageGapFindings, attempt + 1, batchInfo)
      }
      throw new Error(`Request too large even after all fallbacks for ${tenant.tenantName}`)
    }

    // ── 429 / 5xx: transient errors — retry with backoff ─────
    const retryable = err.status === 529 || (err.status >= 500 && err.status < 600) || err.status === 429
    if (retryable && attempt < 3) {
      const delay = err.status === 429 ? 65000 : Math.pow(2, attempt + 1) * 1500
      console.log(`[claude] Retrying ${tenant.tenantName} in ${Math.round(delay/1000)}s (attempt ${attempt + 1})...`)
      await sleep(delay)
      return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo)
    }
    throw new Error(`Claude API error: ${err.status} — ${err.message}`)
  }
}

function parseResponse(text, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo = null) {
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
      return callWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo)
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
// BEEFED-UP MODE — standard analysis but with active learnings
//                  injected into the system prompt
// ═══════════════════════════════════════════════════════════

/**
 * Like analyzeFolder but prepends active learnings to the system prompt.
 * @param {Array} learnings  — [{ checkType, suggestion, active }] from learnings.json
 */
export async function beefedUpAnalyzeFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null, learnings = []) {
  const activeLearnings = (learnings || []).filter(l => l.active)
  return beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, 0, batchInfo, activeLearnings)
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
${'═'.repeat(70)}`
}

async function beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo, activeLearnings) {
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)
    const beefedSystemPrompt = buildBeefedUpSystemPrompt(activeLearnings)

    const response = await client.beta.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 16384,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25'],
      system:     beefedSystemPrompt,
      messages:   [{ role: 'user', content }]
    })

    const rawText = response.content[0]?.text || ''
    return parseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo)
  } catch (err) {
    if (err.status === 413) {
      if (pdfDocs.length > 0) return beefedUpCallWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo, activeLearnings)
      if (textDocs.length > 0) {
        const trimmed = textDocs.map(d => ({ ...d, text: d.text ? d.text.substring(0, 50000) + '\n[...truncated...]' : d.text }))
        return beefedUpCallWithRetry(tenant, [], trimmed, pageGapFindings, attempt + 1, batchInfo, activeLearnings)
      }
      throw new Error(`Request too large for ${tenant.tenantName}`)
    }
    const retryable = err.status === 529 || (err.status >= 500 && err.status < 600) || err.status === 429
    if (retryable && attempt < 3) {
      const delay = err.status === 429 ? 65000 : Math.pow(2, attempt + 1) * 1500
      await sleep(delay)
      return beefedUpCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo, activeLearnings)
    }
    throw new Error(`Claude API error: ${err.status} — ${err.message}`)
  }
}

// ═══════════════════════════════════════════════════════════
// GYM MODE — richer analysis with full reasoning traces
// ═══════════════════════════════════════════════════════════

/**
 * Like analyzeFolder but returns an extended JSON schema that exposes
 * the full reasoning chain for each finding so humans can give precise feedback.
 */
export async function gymAnalyzeFolder(tenant, pdfDocs, textDocs, pageGapFindings = [], batchInfo = null) {
  return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, 0, batchInfo)
}

async function gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo = null) {
  try {
    const content = buildContent(tenant, pdfDocs, textDocs, pageGapFindings, batchInfo)
    // Replace the last content block (standard instructions) with the gym version
    content.pop()
    content.push({ type: 'text', text: buildGymAnalysisInstructions(tenant, new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })) })

    const response = await client.beta.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 16384,
      temperature: 0.1,
      betas:      ['pdfs-2024-09-25'],
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content }]
    })

    const rawText = response.content[0]?.text || ''
    return gymParseResponse(rawText, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo)

  } catch (err) {
    if (err.status === 413) {
      if (pdfDocs.length > 0) {
        return gymCallWithRetry(tenant, [], textDocs, pageGapFindings, attempt, batchInfo)
      }
      if (textDocs.length > 0) {
        const trimmed = textDocs.map(d => ({ ...d, text: d.text ? d.text.substring(0, 50000) + '\n[...truncated...]' : d.text }))
        return gymCallWithRetry(tenant, [], trimmed, pageGapFindings, attempt + 1, batchInfo)
      }
      throw new Error(`Request too large even after all fallbacks for ${tenant.tenantName}`)
    }
    const retryable = err.status === 529 || (err.status >= 500 && err.status < 600) || err.status === 429
    if (retryable && attempt < 3) {
      const delay = err.status === 429 ? 65000 : Math.pow(2, attempt + 1) * 1500
      await sleep(delay)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo)
    }
    throw new Error(`Claude API error: ${err.status} — ${err.message}`)
  }
}

function gymParseResponse(text, tenant, pdfDocs, textDocs, pageGapFindings, attempt, batchInfo) {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)
  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed.findings || !Array.isArray(parsed.findings)) throw new Error('findings array missing')
    return parsed
  } catch (e) {
    if (attempt < 1) {
      console.log(`[claude/gym] JSON parse failed for ${tenant.tenantName}, retrying...`)
      return gymCallWithRetry(tenant, pdfDocs, textDocs, pageGapFindings, attempt + 1, batchInfo)
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

export async function synthesizeDrTodd(tenant, run1, run2, run3) {
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

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4000,
    messages:   [{ role: 'user', content: prompt }]
  })

  return response.content[0]?.text || 'Synthesis failed — no response generated.'
}
