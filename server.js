// Local dev: load `.env` into process.env (same keys as Railway). Does not override vars already set by the host.
import 'dotenv/config'

import express from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import unzipper from 'unzipper'
import archiver from 'archiver'
import { analyzeTenant, gymAnalyzeTenant, beefedUpAnalyzeTenant, doubleCheckTenant, tp3AnalyzeTenant } from './lib/analyzer.js'
import { synthesizeActiveLearning, synthesizeDeepLearning, compareToCheatSheet, getKeyCount, getLastGymKeyIdx } from './lib/claude.js'
import { openaiAnalyzeTenant, isOpenAiKeyConfigured, getServerOpenAiKeyHint } from './lib/openai.js'
import { generateReport } from './lib/reporter.js'
import { mountIsaacRoutes } from './lib/isaac-routes.js'
import { mountTelemetry, logEvent } from './lib/telemetry.js'
import { parseRRFile } from './lib/rr-parser.js'
import { analyzeRentRolls } from './lib/rr-claude.js'
import { generateRRReport } from './lib/rr-reporter.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const app  = express()
/** Local default avoids clashing with Next/React/other stacks on 3000. Railway sets PORT automatically. */
const PORT = process.env.PORT || 3456
/** Bind all interfaces so the API is reachable on your LAN / from another local port (with LOCAL_DEV_CORS). */
const HOST = process.env.HOST?.trim() || '0.0.0.0'

const CORS_ORIGIN_FIXED = process.env.CORS_ORIGIN?.trim()
const LOCAL_DEV_CORS = ['1', 'true', 'yes'].includes(String(process.env.LOCAL_DEV_CORS || '').toLowerCase())

/** UI "Dumb mode" — Haiku instead of Sonnet (query: cheap=1 or JSON cheapMode: true) */
function isCheapMode(req) {
  return req.query?.cheap === '1' || req.body?.cheapMode === true
}

// In-memory session store: sessionId -> SessionData
const sessions = new Map()

/** OpenAI key from OPENAI_API_KEY or openai.key only (see lib/openai.js). */
function resolveSessionOpenAi(_session) {
  if (isOpenAiKeyConfigured()) return { configured: true, optionKey: null }
  return { configured: false, optionKey: null }
}

const UPLOADS_DIR = path.join(__dirname, 'uploads')

// PERSIST_DIR — set this env var to a Railway Volume mount path (e.g. /data)
// so that Isaac saves, learnings, and Dr. Todd reports survive restarts/redeploys.
// Without it, all data is written to the local filesystem and WILL be lost on restart.
const PERSIST_DIR = process.env.PERSIST_DIR
  ? path.resolve(process.env.PERSIST_DIR)
  : path.join(__dirname, 'outputs')

const OUTPUTS_DIR = PERSIST_DIR
fs.mkdirSync(UPLOADS_DIR, { recursive: true })
fs.mkdirSync(OUTPUTS_DIR, { recursive: true })

if (process.env.PERSIST_DIR) {
  console.log(`[storage] Persistent storage active → ${PERSIST_DIR}`)
} else {
  console.warn('[storage] ⚠️  No PERSIST_DIR set — data will be lost on restart. Set PERSIST_DIR to a Railway Volume path (e.g. /data).')
}

const LEARNINGS_PATH = path.join(OUTPUTS_DIR, 'learnings.json')
const DR_TODD_REPORTS_DIR = path.join(OUTPUTS_DIR, 'dr-todd-reports')
fs.mkdirSync(DR_TODD_REPORTS_DIR, { recursive: true })

function readLearnings() {
  try {
    if (!fs.existsSync(LEARNINGS_PATH)) return []
    return JSON.parse(fs.readFileSync(LEARNINGS_PATH, 'utf8'))
  } catch { return [] }
}
function writeLearnings(arr) {
  try { fs.writeFileSync(LEARNINGS_PATH, JSON.stringify(arr, null, 2)) } catch {}
}

// ─── Startup Seed: lawyer-validated rules from Lauren's 4/14/2026 TP2 review ───
// These are idempotent: rules are only added if their ID is not already present.
const LAUREN_REVIEW_SEED = [
  {
    id: 'learning-1775000000001-mp001', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_PAGES', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Page gap detection uses a TWO-SYSTEM dual-confirmation approach. System 1 is the automated algorithm that scans printed page numbers from every PDF page and reports sequence anomalies — but its output is labeled SUSPECTED, not confirmed. System 2 is your job: read the actual document content around every suspected gap and look for a content scar — a broken sentence, an incomplete clause, a section reference whose content is absent, or a table of contents entry with no corresponding pages. BOTH signals must be present before you flag missing pages: (1) a numbering anomaly flagged by System 1, AND (2) a content scar personally verified by you in System 2. If System 1 flags a gap but the document reads continuously and coherently around it, DO NOT generate a Missing Pages finding — the number sequence is wrong, not the content. Common System 1 false positives that must not become findings: dual numbering systems (per-section page numbers alongside overall document numbers), cover pages with no printed number, blank separator pages between exhibits, exhibit sections that restart their own page numbering, OCR misreads of page numbers from scan artifacts.",
    rationale: "Synthesized from 20+ rejected findings across 12 tenants. The Black Tie Formal Wear cascade (findings 73-79) shows what happens when System 1 fires but System 2 is skipped — every downstream check went wrong. Dual-confirmation was established in baseline commit ec26320."
  },
  {
    id: 'learning-1775000000002-lc002', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Never generate a finding that states a lease is current, active, or in good standing. The only valid Lease Currency findings are: (1) the lease is EXPIRED — the controlling end date is in the past and no extension document in the folder establishes a later date, OR (2) a document extending the term appears to be missing — e.g., the rent roll shows a later expiration date than any document in the folder can support. A confirmatory note saying 'the lease is current through [date]' is not a finding and must not be generated. Silence means current.",
    rationale: "Findings 3, 7, 22, 44, 54, 66, 92 all rejected — reviewer confirmed 'This is correct but does not need to be noted.'"
  },
  {
    id: 'learning-1775000000003-nm003', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'NAME_MISMATCH', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Never generate a Name Mismatch finding based on any difference between a folder label, file name, or external label and the legal entity name inside the document. Folder names and file names are assigned by the client and are almost never exact matches to legal entity names — this is expected and acceptable. The only relevant identity check is whether documents within the folder are consistent with each other; trade names, d/b/a abbreviations, entity conversions, and common shorthand are always acceptable variations.",
    rationale: "Findings 4, 57, 86, 98 rejected — reviewer: 'Folder names are rarely exact matches to Lease docs. This is irrelevant.'"
  },
  {
    id: 'learning-1775000000004-ar004', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "When a folder contains an Amended and Restated Lease that sets out full lease terms, do NOT flag the original lease or any amendments predating the Amended and Restated Lease as missing documents. An Amended and Restated Lease supersedes and replaces the original lease and all prior amendments — those earlier documents are intentionally absent because they have been folded into the A&R Lease. Only track the amendment sequence beginning after the Amended and Restated Lease's execution date.",
    rationale: "Findings 13, 14, 15, 42 rejected — reviewer: 'If there is an Amended and Restated Lease that contains full Lease terms, this is considered the Lease. We don't need the old Lease.'"
  },
  {
    id: 'learning-1775000000005-ex005', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "When a signature block contains a pre-printed name that has been crossed out (struck through) and replaced with a different handwritten or typed name and an accompanying signature, this is a VALID and fully executed signature block — do not flag it as an execution issue. Crossing out a pre-populated form name and writing a replacement is standard practice when correcting pre-filled documents; the result is a complete execution. Similarly, a blank 'Name:' or 'Printed Name:' line below a signature line is NOT an execution defect — a signature in the 'By:' field is legally sufficient. Only flag execution issues when the signature field ('By:' line) itself is blank or visibly unsigned.",
    rationale: "Findings 1 and 16 rejected — reviewer confirmed cross-outs and blank Name lines are fine when a signature is present."
  },
  {
    id: 'learning-1775000000006-ex006', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Do not flag a document as unexecuted or questionably executed based solely on signature size, penmanship quality, or visual appearance. A small, abbreviated, stylized, or difficult-to-read signature is legally valid. Only flag execution issues when the signature space ('By:' field) is visibly blank or empty. Missing initials at the bottom of pages are NEVER an execution defect — initials are not required. Do not flag missing initials on any document.",
    rationale: "Findings 10, 17, 26 rejected — reviewer: 'It's ok if they're small' and 'We don't need initials here.'"
  },
  {
    id: 'learning-1775000000007-ex007', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Exhibits embedded in or attached to a lease — such as Exhibit A (site plan), Exhibit B (work letter), Memorandum of Lease forms, Collateral Assignment forms, SNDA forms, or any other form exhibit — do NOT need to be executed. The ONLY exhibit type that must be verified for execution is a Guaranty of Lease (or Guaranty of License). For all other exhibit types, verify only that the exhibit is present as a form; execution is not required and must not be flagged. Do not flag the Certificate of Substantial Completion or any construction-related exhibit for execution either.",
    rationale: "Findings 34, 38, 80, 90 all rejected — reviewer: 'The only Exhibit we usually need executed are Guaranties.'"
  },
  {
    id: 'learning-1775000000008-ex008', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "When reviewing execution of a document and the entity name in the signature block differs slightly from the entity name elsewhere in the document (abbreviation, punctuation, d/b/a variation, or minor spelling difference), this is NOT an execution defect. Minor entity name variations within signature blocks are common and acceptable. Only flag an execution issue for an entity name discrepancy if the entity in the signature block appears to be a completely different and unrelated entity.",
    rationale: "Finding 5 rejected — reviewer: 'This doesn't matter.' Entity name minor variations in signature blocks are not execution defects."
  },
  {
    id: 'learning-1775000000009-sn009', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'SPECIAL_AGREEMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Never flag a Subordination, Non-Disturbance and Attornment Agreement (SNDA) as a missing document, a missing exhibit, or as requiring execution. SNDAs are not used or required in this lease abstracting practice. Whether an SNDA is present, absent, executed, or unexecuted — and whether or not one is referenced in the lease — must never generate a finding of any kind.",
    rationale: "Findings 35, 89, 91, 96 all rejected — reviewer: 'We don't need SNDA Agreements' and 'We do not use SNDA in abstracting. It's not needed.'"
  },
  {
    id: 'learning-1775000000010-oos010', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "The following document types are NEVER in scope for this lease abstracting practice and must never be flagged as missing regardless of whether they are referenced in the lease or absent from the folder: (1) Certificates of Insurance (COI), (2) HVAC Maintenance Contracts, (3) Pest Control Contracts, (4) Business Licenses, (5) Building Permits, (6) City Development Orders / Certifications of Ownership, (7) Broker Commission Agreements / Lease Commission Agreements / Broker Acknowledgment pages. If any of these appear in a folder, do not generate a finding about their presence or absence.",
    rationale: "Findings 56, 69, 70, 71, 83, 84, 85, 88 all rejected for these out-of-scope document types."
  },
  {
    id: 'learning-1775000000011-ca011', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Collateral Assignments of Lease and their attached exhibits are not required for lease abstracting. Do not flag a Collateral Assignment as a missing document, do not flag the exhibits to a Collateral Assignment (such as an attached copy of the lease) as missing, and do not flag the Collateral Assignment form embedded as an exhibit within the lease for execution. If a Collateral Assignment is present, that is fine — simply confirm it exists. Do not generate any findings about its content, execution, or attached materials.",
    rationale: "Findings 80, 81 rejected — reviewer: 'We don't usually need Collateral Assignments for abstracting.'"
  },
  {
    id: 'learning-1775000000012-ag012', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'AMENDMENT_GAP', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "If two documents in a folder are both labeled with the same amendment number (e.g., two documents both described as 'Fourth Amendment'), this is NOT an amendment gap and must not be flagged as a missing document. Duplicate amendment numbers typically reflect a correction, supersession, or restated version of the same amendment. Do not flag the sequence as incomplete or raise a clarification request simply because two documents share the same amendment number label.",
    rationale: "Finding 25 rejected — reviewer: 'This is ok and not considered a missing document.'"
  },
  {
    id: 'learning-1775000000013-ag013', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'AMENDMENT_GAP', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "If the amendment chain is complete and unbroken, do NOT generate any finding about it — not even a confirmatory or 'all clear' note. Amendment Gap findings must only be generated when a specific amendment is actually missing from the folder. Do not surface informational notes confirming completeness.",
    rationale: "Finding 23 rejected — reviewer: 'This is correct, but we don't need it noted.'"
  },
  {
    id: 'learning-1775000000014-est014', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'SPECIAL_AGREEMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Estoppel Certificates do not need to be signed by the landlord or lender — only the certifying party's signature (typically the tenant) is required. Do not flag an Estoppel Certificate for missing landlord execution, lender execution, or any other countersignature. If the certifying party has signed, the document is complete.",
    rationale: "Finding 20 rejected — reviewer: 'Estoppels don't need to be signed.'"
  },
  {
    id: 'learning-1775000000015-gty015', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "A Guaranty of Lease is fully and validly executed when the guarantor's signature is present in the signature ('By:') field. Do not flag a Guaranty as defectively executed because it lacks a notary acknowledgment, notary stamp, witness signatures, or witness lines. The presence of the guarantor's signature alone is sufficient execution. Additionally, when a Guaranty is present and signed, do NOT generate any findings about its scope, coverage period, which amendments it does or does not cover, or other informational details. The only Guaranty findings should be: (1) the Guaranty is absent and should be present, or (2) the Guaranty is present but the signature field is blank.",
    rationale: "Findings 87 and 97 rejected — notary absence and scope notes are not defects."
  },
  {
    id: 'learning-1775000000016-leg016', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'LEGIBILITY', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Only flag a document for legibility if the content critical to the analysis — party names, key dates, signature fields, or operative terms — is genuinely impossible to read and cannot be determined from surrounding context. Do not flag legibility issues for: scan shadows covering part of a page but leaving key content readable, textured or patterned backgrounds, photocopy artifacts overlaid with DocuSign formatting, dark smudges on non-critical portions of a page, or any condition where signatures and printed names can still be identified even with difficulty. The threshold for a legibility finding is that information essential to the analysis is truly and completely undecipherable.",
    rationale: "Findings 9, 48, 53, 60, 64 all rejected — reviewers confirmed documents were readable despite scan artifacts."
  },
  {
    id: 'learning-1775000000017-gen017', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Never generate informational, confirmatory, or 'all clear' findings. Every finding must identify an actual gap, defect, or document that is genuinely missing or defective. Do not surface notes confirming: that a lease is current, that an amendment chain is complete, that a particular document type is present and executed, or any other positive confirmation. If a check reveals everything is in order for a particular check type, generate no finding for that check type.",
    rationale: "13 separate findings rejected as 'correct but does not need to be noted.' Findings are only for problems."
  },
  {
    id: 'learning-1775000000018-gen018', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "File names (the names assigned to PDF files) are completely irrelevant to the analysis. A document's identity, date, type, amendment number, and parties must be determined solely by reading the document's own title, header, recitals, and signature block — not by what the file is named. Never flag a discrepancy between a file name and the document's internal content. Never exclude a document from analysis based on its file name.",
    rationale: "Finding 31 rejected — reviewer: 'File names are irrelevant because they can be named anything. We go by what the document inside the file says.'"
  },
  {
    id: 'learning-1775000000019-fa019', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Franchise Agreements are generally not required for this lease abstracting practice and must not be flagged as missing. Do not flag the absence of a Franchise Agreement as a finding even when the tenant operates under a franchise brand or when a Franchise Agreement is referenced in a lease document.",
    rationale: "Findings 82 and 94 rejected — Franchise Agreements are out of scope for standard abstracting."
  },
  {
    id: 'learning-1775000000020-ex020', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Sub-exhibits — documents referenced within an exhibit rather than directly in the lease (such as 'Exhibit A-1' within Exhibit D, or 'Exhibit A (WARRANTIES)' within Exhibit A) — are generally not required for abstracting and their absence should not generate a Missing Exhibit finding. If the parent exhibit is present and functional, sub-exhibits within it do not need to be separately present. Only flag a sub-exhibit as missing if the parent exhibit itself is materially incomplete without it.",
    rationale: "Findings 33, 46, 59 all rejected — reviewer: 'It's usually ok if the Exhibit to the Exhibit is missing' and 'We dont usually need sub exhibits.'"
  },
  {
    id: 'learning-1775000000021-noc021', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Do not flag a Notice of Commencement as a missing document. Notice of Commencement documents (including those required under Florida Statute 713.13 or equivalent statutes) are not included in this lease abstracting practice.",
    rationale: "Finding 21 rejected — reviewer: 'This is not considered a missing document.'"
  },
  {
    id: 'learning-1775000000022-ren022', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "When a tenant has exercised a lease renewal or extension option via an informal document (email, letter, or notice) rather than a formal executed amendment, this is acceptable — do not flag the absence of a formal Lease Renewal Amendment or Lease Commencement Notice as a missing document. An informal renewal exercise letter or email is sufficient evidence of the option exercise.",
    rationale: "Finding 93 rejected — reviewer: 'This is ok.' Informal renewal exercises are valid."
  },
  {
    id: 'learning-1775000000023-cog023', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "When reviewing a Consent of Guarantor page attached to an amendment: if the signature block is present and a signature appears in it, the document is fully executed — do not flag it for missing execution. Only flag a Consent of Guarantor if its signature block is completely blank or if the document is entirely absent from the folder.",
    rationale: "Findings 27 and 55 rejected — reviewer confirmed both were executed."
  },
  {
    id: 'learning-1775000000024-sa024', source: 'lauren-review-2026-04-14', active: true,
    checkType: 'SPECIAL_AGREEMENT', confidence: 'HIGH',
    createdAt: '2026-04-15T00:00:00.000Z',
    suggestion: "Do not generate findings about special rights or provisions that have been deleted, superseded, or removed by subsequent amendments. If a renewal option, exclusivity clause, or other special right that appeared in an earlier lease document has been explicitly deleted by a later amendment, this is not a finding — the deletion is intentional. Only flag the absence of special rights documents when those rights are currently operative.",
    rationale: "Finding 72 rejected — reviewer: 'This does not need to be noted.' Reporting deleted rights is informational noise."
  },
  {
    id: 'learning-1775100000001-dup001', source: 'manual-training-2026-04-16', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-16T00:00:00.000Z',
    suggestion: "When you find BOTH of these conditions for the same amendment: (1) the amendment document in the folder has completely blank 'By:' signature lines for both parties (unexecuted template), AND (2) one or more later amendments in the folder reference that same amendment as having been executed on a specific date — do NOT generate two separate findings. Generate exactly ONE consolidated REFERENCED_DOC finding that combines both pieces of evidence. The finding should state: (a) what was received — an unexecuted template with blank signature lines, (b) what later amendments confirm — that the executed version exists, citing the specific recital language and date, and (c) the conclusion — the signed counterpart is absent from the folder. DO NOT also generate a separate EXECUTION finding for the same amendment in this scenario. Two findings for the same document gap is redundant noise.",
    rationale: "Manual training 4/16/2026 (Monterey Bay Homes). Model generated 4 findings for 2 amendments: unexecuted Amendment 3 template (EXECUTION) + signed Amendment 3 missing per recitals (REFERENCED_DOC) = same gap, two findings. Correct behavior: one consolidated REFERENCED_DOC finding per amendment combining both pieces of evidence."
  },
  // ── Lauren's 2026-04-23 TP2 review (Masons-Pigtails + BOA-Ground Central) ──────
  {
    id: 'learning-1775527200001-fp001', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "CRITICAL — before flagging ANY document as unexecuted or partially executed, you must read ALL pages from the first signature block through the end of the document. Multi-party lease documents routinely place each party's signature on a separate consecutive page: Landlord signs on page N, Tenant signs on page N+1, Guarantor signs on page N+2. A blank 'By:' line on page N does NOT mean that party failed to sign — their signature may be on the very next page. Required two-step procedure: (1) locate the opening of the signature section, (2) scan every remaining page of the document for signatures before drawing any execution conclusion. Only flag a document as unexecuted when you have confirmed that NO signature for that party exists anywhere from the first signature block through the final page of the document.",
    rationale: "7 rejected HIGH findings from 2026-04-23 TP2 session (Evercore, Duff & Phelps ×5, BlakeTodd). Reviewer explicitly stated 'The tenant signed on the following page' for 2 findings; all others confirmed 'fully executed.' Single largest false-positive driver in this session."
  },
  {
    id: 'learning-1775527200002-bl002', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "A blank 'Date:' line or 'Dated:' line immediately below or beside a completed signature ('By:') block is NOT an execution defect. Documents are executed when parties sign — the date line is a courtesy field. The ONLY line whose blank status determines execution is the 'By:' signature line itself. If 'By:' has a signature, the document is executed regardless of whether the Date, Name, Title, or any other secondary field below it is blank.",
    rationale: "2 rejected HIGH findings from 2026-04-23 TP2 session (Monterey Bay Homes Amendment No. 5 and 6). Landlord 'By:' line had a visible signature; 'Date:' line below was blank. Reviewer confirmed both: 'This document is fully executed.' Extends existing rule ex005 to explicitly cover blank Date lines."
  },
  {
    id: 'learning-1775527200003-pb003', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "Template placeholder blanks in the preamble or recitals of a document — such as 'This Lease entered into this ___ day of _______________, 20__' — are completely irrelevant to execution status. These are form-printing artifacts routinely left blank in practice. Execution is determined solely by the signature page(s). If the signature blocks are completed, the document is fully executed regardless of blank preamble fields. Do not generate any finding about unfilled blanks in preamble or introductory language.",
    rationale: "1 rejected HIGH finding from 2026-04-23 TP2 session (Pho Tastic lease). Model flagged preamble 'this ___ day of ___' blanks as execution concern. Reviewer: 'This does not matter. This is not a missing document. The lease is executed.' Signature page had clear notary-acknowledged date (May 12, 2025)."
  },
  {
    id: 'learning-1775527200004-dv004', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "When a folder contains two versions of the same document — one fully executed (signed PDF) and one unexecuted template (blank .docx or unsigned PDF) — the executed version is the operative document and the folder is complete for that instrument. Do not flag the unexecuted template as an execution deficiency or a duplicate. To confirm two documents are versions of the same instrument, compare document title, effective date, and parties. If those match and one is executed, no finding is needed.",
    rationale: "1 rejected HIGH finding from 2026-04-23 TP2 session (China Dragon Second Amendment). Folder had both executed PDF and unexecuted .docx of same Amendment. Reviewer: 'One of the Second Amendments is executed which is sufficient.' Note: the inverse still applies — if ONLY the unexecuted template exists with no executed counterpart, the finding is valid."
  },
  {
    id: 'learning-1775527200005-oe005', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "A signed letter or notice exercising any contractual option — including renewal options, extension options, expansion options, right-of-first-offer exercises, and termination option notices — is sufficient documentation of that option exercise. Do not flag the absence of a formal executed amendment memorializing the exercise unless the option agreement itself expressly states that a formal amendment is required as a condition of effectiveness. An exercise notice or letter signed by the exercising party is the operative document.",
    rationale: "1 rejected MEDIUM finding from 2026-04-23 TP2 session (Morgan Stanley 10th Floor expansion option). Model flagged no formal amendment memorialized the expansion after the exercise notice. Reviewer: 'The letter says it is the exercise of the 10th floor expansion.' Extends existing rule ren022 to all option types, not just renewal/extension."
  },
  {
    id: 'learning-1775527200006-nd006', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "Do not generate any finding about a discrepancy between a notary acknowledgment date and the document's stated effective date (e.g., notary date precedes effective date by one month). Notary dates routinely differ from effective dates — pre-execution notarization and administrative post-dating are both common practice. This type of date discrepancy is outside review scope. A document is executed when signatures are present.",
    rationale: "1 rejected MEDIUM finding from 2026-04-23 TP2 session (Masons Tennismart Guaranty). Notary acknowledgment (Dec 15, 2022) predated effective date (Jan 18, 2023) by one month. Reviewer: 'This is not exactly wrong, but we don't need this information for Missing Documents.'"
  },
  {
    id: 'learning-1775527200007-rr007', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "When a document's recitals or body references another document by name, do NOT automatically generate a Missing Document finding. First search the entire folder — all files, all pages, including exhibits and attachments — to verify whether the referenced document is already present under a different filename, slightly different title, or as an attachment. Only flag it as missing after a thorough folder-wide search. If a document in the folder reasonably matches the referenced instrument (matching parties, approximate date, subject matter), do not flag it as missing even if filename or title differs slightly.",
    rationale: "1 rejected MEDIUM finding from 2026-04-23 TP2 session (Duff and Phelps). Model flagged missing document based on body reference. Reviewer: 'The reviewer determined this is not missing. It may just mean that it is a reference to an amendment we already have.'"
  },
  {
    id: 'learning-1775527200008-gty008', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "Do not flag a Guaranty as missing unless you find EXPLICIT evidence in the documents that a guaranty was contractually required. Acceptable evidence: (a) lease clause stating Tenant shall deliver a guaranty with named guarantor, (b) lease Table of Contents listing 'Exhibit [X]: Guaranty of Lease', (c) lease body referencing 'the Guaranty attached hereto as Exhibit [X]', or (d) amendment recital confirming a specific guaranty was delivered. If no such evidence exists and no guaranty document is in the folder, do not raise a Missing Guaranty finding — the guaranty requirement may have been waived or may never have existed. Flag only when: the obligation is documented AND either the document is absent OR present but unsigned.",
    rationale: "1 rejected HIGH finding from 2026-04-23 TP2 session (China Dragon Guaranty). Reviewer: 'It's possible a Guaranty was never signed. The best rule is if a document is titled guaranty then it should have the guaranty signature.' Only assert missing guaranty when lease explicitly required one."
  },
  {
    id: 'learning-1775527200009-mp009', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'MISSING_PAGES', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "Missing pages detection is a strict TWO-STEP process — both steps must confirm a gap before generating any finding. STEP 1 (TRIGGER): Read the page numbers physically printed on each page of the document (the numbers you can see at the top or bottom of each page, such as '5', 'Page 5 of 47', or '-5-'). Note: this is NOT the PDF viewer's page count — it is the number printed inside the document itself. Check that those printed numbers run in an unbroken sequence. A jump from printed page 5 to printed page 8 is a trigger. If the printed numbers are sequential with no gaps, stop — no finding. STEP 2 (DOUBLE-CHECK — required): For every gap identified in Step 1, verify it represents real missing content by confirming at least one of: (a) a broken sentence at the gap boundary — the page before the gap ends mid-clause and the page after begins in a different section, (b) a Table of Contents entry whose content never appears anywhere in the document, or (c) a section or article reference number that is skipped in the document's own structure (e.g., Section 5.1, 5.2, 5.4 — 5.3 is referenced but absent). If Step 2 finds no content confirmation, the page number gap is a formatting artifact — do NOT generate a finding.",
    rationale: "3 rejected LOW findings from 2026-04-23 TP2 session (BlakeTodd ×3). Reviewer confirmed in all three: 'Pages are not missing.' Updated to make the two-step procedure explicit: printed page numbers on the pages (not PDF viewer count) as the trigger, then content double-check as mandatory confirmation."
  },
  {
    id: 'learning-1775527200010-mp010', source: 'lauren-review-2026-04-23', active: true,
    checkType: 'MISSING_PAGES', confidence: 'HIGH',
    createdAt: '2026-04-29T00:00:00.000Z',
    suggestion: "In addition to the two-step page number check, always run these four content-integrity checks that catch real missing pages even when printed page numbers are absent, illegible, or use non-standard numbering: (1) TABLE OF CONTENTS — if a TOC exists, every section, article, and exhibit listed must have corresponding substantive content somewhere in the document. A listed entry with no content = confirmed missing. (2) SENTENCE CONTINUITY — at every section boundary and page transition, verify text flows coherently. Text ending mid-sentence with the next page resuming in a different unrelated section = content was cut between them. (3) SECTION/ARTICLE NUMBER SEQUENCE — scan all printed article and section numbers. A skip in the document's own structure (Article 1, 2, 4 — no Article 3) is itself evidence of missing content, independent of page numbers. (4) SIGNATURE PAGE — every executed lease must contain 'IN WITNESS WHEREOF' language followed by actual signature blocks somewhere in the folder. If the lease body ends without any signature section, material pages are missing. Any one of these four signals, standing alone, is sufficient to generate a Missing Pages finding at HIGH severity.",
    rationale: "Synthesized from ongoing false-positive pattern plus confirmed missing-page cases. Four content signals that catch real gaps regardless of page number formatting. These complement the printed-number two-step (mp009) and catch cases where page numbers are absent or unreliable."
  },
  {
    id: 'learning-1775700000001-nm011', source: 'lauren-review-2026-04-30', active: true,
    checkType: 'NAME_MISMATCH', confidence: 'HIGH',
    createdAt: '2026-04-30T00:00:00.000Z',
    suggestion: "Corporate name changes, entity transitions, and trade-name vs. legal-name differences across lease amendments are NORMAL and are NOT findings. Do NOT flag: (a) a tenant entity name changing across amendments due to corporate restructuring, acquisition, or rebranding (e.g., Aeropostale → Aero OpCo LLC → SPARC GROUP LLC); (b) a landlord entity name change through amendment; (c) a trade/DBA name differing from the legal entity name (e.g., 'BJ's Brewhouse' operating as 'BJ's Restaurants, Inc.'); (d) an assignment to a related entity or named acquirer that is documented anywhere in the folder. Only flag a name-change-related finding if ALL THREE conditions are met simultaneously: (1) the lease body expressly requires a formal consent or assignment for this specific type of transfer, AND (2) no assignment, consent, assumption, or name-change notification document exists anywhere in the folder under any filename, AND (3) the transition appears to be a complete arm's-length change to a wholly unrelated party with no connecting documentation.",
    rationale: "5 rejected findings from 2026-04-30 Test 4 session across 5 tenants: Aeropostale (entity chain), Gap (landlord name), Hey Dude→CROCS (assignment), Le Creuset (Schiller Stores→Le Creuset of America), BJ's Brewhouse (trade name vs legal name). Reviewer comments: 'very common for names to change,' 'normal, nothing to note,' 'fine, nothing to note,' 'not a missing document.'"
  },
  {
    id: 'learning-1775700000002-rd012', source: 'lauren-review-2026-04-30', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-30T00:00:00.000Z',
    suggestion: "A document named, defined, or listed as an exhibit in the lease body does NOT automatically mean it was ever executed or must be present in the folder. The following exhibit/document types are routinely referenced in lease forms but commonly never executed — do NOT flag them as missing unless you have affirmative evidence in the lease body that execution was mandatory AND the document cannot be found anywhere in the folder: Commencement Date Agreements or Commencement Certificates; Term Commencement Agreements; Landlord Consent to Assignment documents; SNDAs; Estoppel Certificates; Restriction Agreements; Expansion Exhibits (Exhibit B-1, etc.); and any document described with 'if applicable,' 'upon request,' 'if and when executed,' or 'if required' language. Similarly, a gap between amendment dates does NOT prove that amendments during that period exist — absence of evidence is not evidence of absence. Before flagging ANY exhibit or referenced document as missing, confirm: (1) the lease body explicitly states the document MUST be executed and delivered as a condition, AND (2) the document is genuinely absent from the entire folder under all possible filenames.",
    rationale: "5 rejected findings from 2026-04-30 Test 4 session: Vans (Sign License Agreement), Gap (Term Commencement Agreement), Adidas (Commencement Date Certificate), Under Armour (Exhibit B-1 Combined Premises CDC), Le Creuset (Assignment document), Spencers (assumed amendments between dates). Reviewer pattern: 'doesn't mean one was ever signed or existed,' 'we don't know if this document exists,' 'doesn't always mean amendments exist.'"
  },
  {
    id: 'learning-1775700000003-ca013', source: 'lauren-review-2026-04-30', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-04-30T00:00:00.000Z',
    suggestion: "If you can identify the lease term's expiration date and that date is in the future relative to the review date, do NOT generate any 'Lease Currency,' 'Expired Lease,' 'Missing Extension,' 'Missing Renewal,' or similar finding. A lease with a future expiration date is active and current — there is nothing to flag. Lease currency findings are only valid in two scenarios: (1) the lease has ALREADY expired with no evidence of extension, renewal, or holdover anywhere in the folder, OR (2) you cannot find any document establishing the current term end date after reviewing all amendments. Do not flag a lease as having a currency issue simply because you cannot find a Commencement Date Certificate or renewal amendment — if the term end date is visible anywhere in the documents and it is future-dated, the lease is current.",
    rationale: "2 rejected findings from 2026-04-30 Test 4 session: Elegance Menswear (license expires 2/28/27, reviewer: 'nothing needs to be noted'), Spencers (expires 1/31/28, reviewer: 'Lease is current. Nothing is missing'). Model was generating currency findings on leases that are plainly still active."
  },
  {
    id: 'learning-1775700000004-dup014', source: 'lauren-review-2026-04-30', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-04-30T00:00:00.000Z',
    suggestion: "If the same document appears two or more times in a folder under different filenames (e.g., 'Second Amendment.pdf' and 'Second Amendment (1).pdf'), treat them as a single document and use either copy. Do NOT generate any finding about duplicate files — not a Missing Document finding, not an Execution finding, not an Amendment Gap finding, and not a note of any kind. Duplicate files are administrative artifacts from scanning, re-uploading, or folder management and are entirely irrelevant to the review. Note: this is distinct from dv004 (executed PDF + unexecuted .docx of same document) — the dv004 rule applies when one copy is executed and one is not; dup014 applies when both copies are identical or both are the same execution state.",
    rationale: "2 rejected findings from 2026-04-30 Test 4 session: Rally House had two identical Second Amendment files. Reviewer: 'duplicates, nothing needs to be noted.' Model flagged both copies as execution issues instead of recognizing them as duplicates."
  },
  {
    id: 'learning-1775700000005-loi015', source: 'lauren-review-2026-04-30', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-04-30T00:00:00.000Z',
    suggestion: "The following document types are ENTIRELY OUT OF SCOPE and must NEVER be flagged as missing, unexecuted, or deficient — regardless of whether they appear in the folder: (1) Letters of Intent (LOIs) — pre-lease negotiation documents, always out of scope even if referenced in the lease; (2) Unexecuted draft documents (.doc, .docx files) that are clearly template versions with no signatures and no executed counterpart — if an unexecuted .docx exists alongside an executed PDF of the same document, see dv004; (3) Settlement Agreements, litigation documents, or legal proceeding records referencing other properties or leases outside the specific folder being reviewed; (4) Documents flagged as out-of-scope by context — e.g., Commencement Date Agreements marked 'Exhibit G/H' that are blank exhibit forms rather than executed certificates. If these are absent from a folder, do not flag them. If they are present but unexecuted, do not flag them.",
    rationale: "3 rejected findings from 2026-04-30 Test 4 session: Adidas (LOI .doc file unreadable — reviewer: 'we don't need LOIs'), Banana Republic (Settlement Agreement referencing El Paso leases — reviewer: 'not something we normally need'), BJ's Brewhouse (unexecuted blank Exhibit G/H forms — reviewer: 'don't need it executed,' 'scope question'). LOIs are explicitly excluded from standard TP review scope."
  },
  {
    id: 'learning-1775786400001-ds016', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "DocuSign audit trail pages are SUPPLEMENTARY reference only — they are NOT authoritative for determining execution status. The actual document signature page is the authority. If a party's signature, initials, or DocuSign indicator appears anywhere on the physical document pages, that party has signed regardless of whether the audit trail log records a signature event for them. Common scenario: Landlord signature appears on document page 3, but the audit trail at the end only logs the Tenant's completion event — the document is fully executed. Do NOT flag a document as unexecuted, partially executed, or 'missing Landlord signature' based on the audit trail log alone. Only use the audit trail to help locate signature pages — never use it as the execution verdict.",
    rationale: "4 rejected findings from 2026-05-01 Test 5 session: Jared Vault Third Amendment (×2) and Kay Jewelers Third Amendment (×2). In both cases, Landlord signature appeared on document pages but the DocuSign audit trail only recorded the Tenant completion event. Reviewer confirmed both fully executed. Model was trusting audit trail over actual document pages."
  },
  {
    id: 'learning-1775786400002-sf017', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "The ONLY field that determines whether a party has signed is the 'By:' signature line. Every other field on a signature block is a secondary administrative field — blank status on any of them is completely irrelevant to execution. This applies explicitly to: 'Its:' (title/role), 'Title:', 'Print Name:', 'Name:', 'Printed Name:', 'Notary Acknowledgment' blocks (the entire block including jurat, notary name, commission expiration), 'Witness:' lines, 'Address:', 'Attn:', and any other labeled line that is not 'By:'. If 'By:' has a mark — signature, initials, typed name, DocuSign tag, or any visible indicator — the party has signed and execution is confirmed. Generate no finding about any blank field other than 'By:'. This extends rule bl002 (blank Date lines) to ALL secondary signature block fields.",
    rationale: "6 rejected findings from 2026-05-01 Test 5 session: Oakley (notary acknowledgment block blank), Zumiez (blank Its: title line on Second Amendment), Perfumania (blank Its: line on Original Lease), Uptown Boutique (blank Print Name partially obscured), Cleopatra Ink (initials block partially blank), Zales (pre-printed name/title with no DocuSign overlay on Tenant side). All confirmed fully executed. Pattern: model is checking secondary fields when it should only check By:."
  },
  {
    id: 'learning-1775786400003-be018', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "Delivery Date Certificates, Commencement Date Certificates, Commencement Date Agreements, Tenant Opening Notices, and similar exhibit-form documents are fill-in-after-occupancy instruments. At the time of lease execution, these forms are intentionally blank in their date fields because the actual delivery or commencement date is not yet known. Do NOT flag blank date fields, blank 'Delivery Date:' lines, blank 'Commencement Date:' lines, or blank 'Lease Date:' fields on these specific form types as execution defects, missing information, or any kind of finding. The form being present in the folder — even with blank fields — satisfies the folder completeness requirement. Only flag this document type if it is entirely absent AND the lease body explicitly states it must be executed and delivered.",
    rationale: "2 rejected findings from 2026-05-01 Test 5 session: Cleopatra Ink Exhibit B (Delivery Date Certificate with blank Delivery Date field — reviewer: 'this exhibit does not need to be signed'), Perfumes 4U (Delivery Date Certificate with blank Lease Date field — reviewer: 'this document is fully executed'). Model was flagging blank date fields on forms that are designed to be filled in after occupancy."
  },
  {
    id: 'learning-1775786400004-ma019', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'AMENDMENT_GAP', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "When determining amendment chain completeness, always follow the RECITALS of the most recent amendment — not ordinal numbering arithmetic. Recitals explicitly list every prior amendment by name and type; if the recitals show a complete chain, the chain is complete. Critical scenarios: (1) 'Master Amendment,' 'Omnibus Amendment,' or 'Comprehensive Amendment' fills the numbered slot for one or more sequential amendments — e.g., if recitals list 'First Amendment, Second Amendment, Master Amendment' with no gap in the recital list, the Master Amendment IS the third amendment regardless of its title. (2) An 'Amended and Restated [X] Amendment' coexisting with the original [X] Amendment is not a gap or deficiency — the Restated version supersedes and both being present is normal. (3) A 'Letter Agreement,' 'Side Letter,' or 'COVID Amendment' that is listed in recitals as a prior amendment IS an amendment in the chain, not a missing document. ALWAYS read recitals first; if the recital list is complete and all listed documents are in the folder, no amendment gap finding is valid.",
    rationale: "3 rejected findings from 2026-05-01 Test 5 session: Sunglass Hut (Master Amendment = 3rd amendment, reviewer: 'Master Amendment is the 3rd Amendment. If we have document list in recitals, we go by the document list'), Famous Footwear (Amended and Restated 4th Amendment + original 4th both present, reviewer: 'nothing is missing'), Francesca's (COVID Amendment listed in recitals = the Letter Agreement referenced)."
  },
  {
    id: 'learning-1775786400005-rc020', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "When searching the folder for a document referenced in a recital, lease body, or amendment, match by DATE and PARTIES — not by document title or filename. Lease documents are routinely filed under informal, abbreviated, or descriptive names that do not match their formal title in recitals. Before flagging any referenced document as missing, confirm: (1) Is there any document in the folder with the SAME DATE as the referenced document, even if the filename is completely different? (2) Is there any document in the folder involving the SAME PARTIES as the referenced document, even if dated slightly differently and named differently? If YES to either, that document IS the referenced instrument and must not be flagged as missing. Examples: 'Letter Agreement dated 6/5/20' in recitals = 'Francescas - COVID Amendment.pdf' if dated 6/5/20. 'Amendment to Lease dated 1/1/21' = 'Fran 2005 - Lease Amendment.pdf' if dated 1/1/21. This is an enhancement of rule rr007 — after searching by title and failing to find the document, always run a second search by date and parties before concluding it is missing.",
    rationale: "3 rejected findings from 2026-05-01 Test 5 session: Francesca's Letter Agreement (COVID Amendment.pdf was the document — same date, same parties, reviewer: 'Letter Agreement dated 6/5/20 is in the document set'), Francesca's Amendment to Lease (Fran 2005 - Lease Amendment.pdf — reviewer: '2nd Amendment is present. Nothing is missing'). Model failed to match documents by date when filename differed from formal recital title."
  },
  {
    id: 'learning-1775786400006-hs021', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "Mixed or hybrid signature execution — where different parties to the same document sign using different methods — is fully valid and extremely common. Do NOT flag as an execution concern any document where: one party signed via DocuSign and another party signed with a wet/handwritten signature; one party has a DocuSign electronic overlay and another party has a pre-printed typed name with no overlay; one party has a notarized signature and another does not; one party's block shows 'By: [handwritten]' and another shows 'By: [DocuSign tag]'. All of these are valid, executed documents. The method of signing is irrelevant — what matters is that each required party has something in the 'By:' field using any method.",
    rationale: "1 rejected finding from 2026-05-01 Test 5 session: Zales First Amendment (Landlord had DocuSign overlay, Tenant had handwritten signature with pre-printed name but no DocuSign overlay — model flagged as execution concern, reviewer: 'Document is fully executed'). Pattern also consistent with multiple prior sessions."
  },
  {
    id: 'learning-1775786400007-pf022', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "MANDATORY PRE-SUBMISSION VETO GATE — before finalizing and outputting ANY finding, you must explicitly run the following 6 veto checks. If any veto condition is TRUE, the finding is DROPPED and must not appear in the output at all. (1) EXECUTION VETO: Does a visible signature, mark, or electronic indicator appear in the 'By:' field for each required party somewhere in the document? → TRUE = DROP the execution finding. (2) MISSING DOCUMENT VETO: Does any document in the folder match the referenced document by date OR by parties, regardless of filename or formal title? → TRUE = DROP the missing document finding. (3) CURRENCY VETO: Is the lease expiration date in the future — even if only weeks or months away? → TRUE = DROP the currency finding. A lease expiring in 8 months is current. (4) AMENDMENT GAP VETO: Do the recitals of the latest amendment explicitly list a complete chain and are all listed documents physically present in the folder? → TRUE = DROP the amendment gap finding. (5) NAME CHANGE VETO: Is the entity transition documented anywhere in the folder through restructuring, assignment, or amendment recitals? → TRUE = DROP the name mismatch finding. (6) MISSING PAGES VETO: After running the two-step content check (mp009), does the document read continuously and coherently with no content scar at the suspected gap — AND is the gap in the middle of body text (not at a document end, exhibit boundary, or section start)? → BOTH must be true to DROP. If the gap is at an exhibit boundary or document end, the veto does NOT apply — flag it. These veto checks run AFTER you draft a finding and BEFORE you include it in output. They are non-negotiable — a finding that fails a veto check must be discarded.",
    rationale: "Creative double-checker mechanism synthesized from Test 5 patterns. Multiple high-confidence false positives persist because the model generates findings from single-signal triggers without completing the full confirmation loop. The veto gate forces explicit disconfirmation before output. Updated rule 6: missing pages veto does NOT apply at exhibit boundaries — Kay Jewelers p.50 and Jared Vault Exhibit F were false negatives caused by the veto gate suppressing real missing pages at exhibit starts."
  },
  {
    id: 'learning-1775786400008-mp023', source: 'lauren-review-2026-05-01', active: true,
    checkType: 'MISSING_PAGES', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "EXHIBIT AND DOCUMENT-END PAGE GAPS ARE NOT SUBJECT TO THE CONTENT-CONTINUITY VETO. The content-continuity test (does the surrounding text flow without a scar?) only applies to gaps in the middle of body text sections. Two additional gap types must always be flagged regardless of content continuity: (1) EXHIBIT GAPS — if a referenced exhibit begins but appears to have its first page or opening pages missing (e.g., Exhibit F header appears with no content, or the exhibit index lists Exhibit F but no Exhibit F pages appear in the document), flag it. An exhibit stub with no content pages IS a missing pages finding. (2) DOCUMENT-END GAPS — if printed page numbers end before the expected last page (e.g., document shows pages 1-49 but the sequence implies page 50 should be present, or the document ends mid-section without a signature page), flag it regardless of whether preceding pages read continuously. For these two gap types, the simple page-number gap trigger (Step 1 of mp009) is sufficient — the content-continuity Step 2 is NOT required to confirm.",
    rationale: "2 false negatives from 2026-05-01 Test 5: Kay Jewelers (page 50 missing from lease — reviewer manual flag: 'Page 50 is missing from KayJewelers Lease dated 8.23.10.pdf') and Jared Vault (First page of Exhibit F missing — reviewer manual flag: 'Page 47: First page of Exh F missing'). In both cases the model suppressed the finding because surrounding body content read continuously, but the missing page was at an exhibit boundary or document end where that test is invalid."
  },
  {
    id: 'learning-1775872800001-sf024', source: 'lauren-review-2026-05-01b', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "If a document has a blank signature block for one party AND the folder contains a separate file that is clearly a detached signature page, signature scan, or standalone signature form, treat that separate file as the signature page for the main document — do NOT flag the main document as unexecuted. Matching logic: a separate signature file belongs to a main document if it shares any of: the same year, the same document type (amendment, renewal, assignment), or the same parties. Example: 'Scan Fried Signature to Renewal 2019.pdf' = the Landlord signature page for 'Assignment & 6th Amendment Renewal of Lease dated August 8, 2019.' You do not need an exact filename match — temporal and contextual proximity is sufficient. A blank signature block in the main PDF + a corresponding standalone signature file in the folder = fully executed.",
    rationale: "2 rejected findings (duplicate) from 2026-05-01b session: Freeway Insurance. Landlord 'By:' blank in main lease file; separate 'Scan Fried Signature to Renewal 2019.pdf' existed in folder. Model flagged as unexecuted despite the signature scan. Reviewer: 'Landlord signed document.' / 'Document is fully executed.'"
  },
  {
    id: 'learning-1775872800002-fn025', source: 'lauren-review-2026-05-01b', active: true,
    checkType: 'NAME_MISMATCH', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "The folder name used to organize tenant documents is an administrative label — it is NEVER the legal entity name and must NOT be compared against legal entity names in documents. Folder names are shorthand (e.g., 'Freeway Insurance' for 'Freeway Insurance Services, LLC'; 'Gap' for 'Gap Inc.'; 'BOA' for 'Bank of America, N.A.'). A discrepancy between the folder name and the legal entity name in a document is NOT a name mismatch finding of any kind. Name mismatch findings are only valid when comparing legal entity names within documents against each other — never folder name vs. document name.",
    rationale: "2 rejected findings (duplicate) from 2026-05-01b session: Freeway Insurance. Folder labeled 'Freeway Insurance'; documents show 'Freeway Insurance Services, LLC.' Model generated name mismatch finding. Reviewer: 'It's ok that the names are different. This does not need to be noted.' / 'Sometimes the names may not match. Nothing is missing.'"
  },
  {
    id: 'learning-1775872800003-gty026', source: 'lauren-review-2026-05-01b', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "The language 'the guarantor of the Lease shall be [Name]' or '[Name] shall be the guarantor' in an amendment DOES NOT create an obligation to produce a separate executed guaranty document. This language names who would serve as guarantor but does not require delivery of a separate instrument. Do NOT flag a missing guaranty based solely on this language. Only flag a missing guaranty when the document explicitly requires delivery: e.g., 'Tenant shall deliver a Guaranty of Lease executed by [Name]', 'a Guaranty in the form of Exhibit [X] shall be executed and delivered', or the lease Table of Contents lists a Guaranty as a required exhibit. A naming clause is not a delivery requirement.",
    rationale: "1 rejected finding from 2026-05-01b session: China Dragon Amendment No. 2 Paragraph 3 stated 'The guarantor of the Lease shall be Yu Hui Chen.' No Yu Hui Chen guaranty in folder. Model flagged as missing guaranty. Reviewer: 'The document doesn't exactly say a Guaranty exists. I wouldn't note this as a missing document.'"
  },
  {
    id: 'learning-1775872800004-mol027', source: 'lauren-review-2026-05-01b', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "Memoranda of Lease, Memoranda of Lease Agreement, Short Form Leases, and similar county-recording instruments are NOT operative lease documents and are completely out of scope for execution review. Do not flag blank witness lines, missing notarizations, incomplete acknowledgments, or any other execution concern in a Memorandum of Lease. These recording instruments are not used in abstracting and are never reviewed for execution deficiencies. If a Memorandum of Lease appears in a folder, it may be noted as present but requires no execution analysis whatsoever.",
    rationale: "1 rejected finding from 2026-05-01b session: Bank of America Memorandum of Lease had blank Witness #1 and #2 lines on Landlord signature page. Model flagged as execution concern. Reviewer: 'This document is fully executed. We do not use Memorandum of Lease in abstracting so we would not include this document at all.'"
  },
  {
    id: 'learning-1775872800005-sc029', source: 'lauren-review-2026-05-01b', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-05-01T00:00:00.000Z',
    suggestion: "SELF-CONTRADICTING FINDINGS MUST BE SUPPRESSED: If your own finding description already acknowledges that the issue is not a deficiency — using phrases such as 'this is acceptable', 'not a mismatch', 'executed version is operative', 'not a deficiency', 'no finding needed', 'sufficient', 'this is acceptable shorthand', or any other self-exculpatory language — you MUST NOT output that finding. A finding whose own text explains why it is not a problem is a zero-value output that wastes reviewer time. Before outputting any finding, read your own description: if it contains language that resolves or dismisses the concern, delete the finding entirely. Examples of self-contradicting findings that must be suppressed: (a) 'Folder labeled X but tenant is Y — this is acceptable shorthand variation, not a mismatch'; (b) 'Two versions exist — executed version is operative; unexecuted template is not a deficiency'; (c) 'Blank date line below completed By: signature — date is a secondary field and does not affect execution.'",
    rationale: "3 rejected findings from 2026-05-01b session where the AI's own finding text already dismissed the concern but still output the finding: Freeway Insurance name mismatch ('this is acceptable shorthand variation, not a mismatch' — still flagged), China Dragon Amendment No. 2 execution ('Executed version is operative; unexecuted template is not a deficiency' — still flagged). This is the single most wasteful false-positive pattern."
  },
  {
    id: 'learning-1775959200001-pb030', source: 'lauren-review-2026-05-02', active: true,
    checkType: 'NAME_MISMATCH', confidence: 'HIGH',
    createdAt: '2026-05-02T00:00:00.000Z',
    suggestion: "Minor entity name variants between the preamble and the signature block WITHIN THE SAME DOCUMENT are not name mismatch findings. When a single document uses slightly different versions of the same entity name (e.g., preamble reads 'OKC Outlets I, LLC' and signature block reads 'OKC Outlets, LLC'; or preamble reads 'Smith Properties Inc.' and signature reads 'Smith Properties, Inc.') — this is a drafting variation within one document, not a cross-document mismatch. Do NOT flag this as a name mismatch. Name mismatch findings are only valid when comparing entity names ACROSS DIFFERENT DOCUMENTS in the folder (e.g., the lease says 'ABC Corp.' but the amendment says 'XYZ Corp.' for the same party). Preamble-vs-signature-block discrepancies within a single document are routine and never actionable.",
    rationale: "Identified from Test 5 rejected findings pattern: Crudoolandia or similar tenant where preamble entity and signature block entity showed slight name variation within the same document (e.g., 'OKC Outlets I, LLC' vs 'OKC Outlets, LLC'). This is a drafting artifact, not a reviewable concern. The rule prevents the model from flagging intra-document name variants."
  },
  {
    id: 'learning-1777852800001-ex031', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "Blank or unexecuted EXHIBIT FORMS are NEVER execution deficiencies and are NEVER missing document findings. The only exhibit that must be executed is a Guaranty (or Guaranty of Lease). All other exhibits — including Delivery Date Certificates, Commencement Date Certificates, Work Letters, Construction Exhibits, Option Exercise forms, and any other fill-in-after-occupancy forms — are expected to remain blank in the folder, or may be absent entirely. Do NOT flag: (a) a blank Delivery Date Certificate because the Delivery Date has not yet been filled in; (b) a missing executed Delivery Date Certificate even when the lease states the Delivery Date 'shall be confirmed' in such a certificate; (c) a blank or absent Commencement Date Certificate; (d) a blank Work Letter or Tenant Improvement exhibit. These forms are administrative. A blank Exhibit B Delivery Date Certificate present as a template = acceptable and complete. A missing executed Delivery Date Certificate = NOT a finding. The lease expiration date can be estimated from the lease term length without a certificate.",
    rationale: "4 rejected findings across 3 tenants in 2026-05-04 Test 5 session: Lee Wrangler (x2, duplicate) — blank Delivery Date Certificate Exhibit B flagged as lease currency and missing document concern; reviewer: 'Exhibits do not need to be filled out/executed. The only exhibit we need an executed copy of is if it's a Guaranty.' Bath and Body Works — executed Delivery Date Certificate absent; reviewer: 'The only exhibit that needs to be executed is a Guaranty. All other amendments do not need to be filled out or executed.' Victoria's Secret — executed Delivery Date Certificate for 2022 Lease missing; same reviewer response."
  },
  {
    id: 'learning-1777852800002-ag032', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'AMENDMENT_GAP', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "The boilerplate phrase 'as same may have been amended' or 'as amended' in a document's recitals or reference clause does NOT indicate the existence of unspecified amendments and does NOT create an amendment gap finding. This language is standard legal boilerplate included as a protective catch-all, not as an affirmative representation that specific amendments exist. Example: 'Lease dated February 6, 2017, as same may have been amended' does NOT mean an amendment exists — it means the drafter was being cautious. Amendment gap findings require POSITIVE evidence of a specific amendment: a numbered amendment in the recitals (e.g., 'as amended by the First Amendment dated March 1, 2020'), a defined term referencing a specific instrument, or a gap in the chronological chain that cannot be explained by the recitals of the most recent document. 'As amended' language alone = no finding.",
    rationale: "1 rejected finding from 2026-05-04 Test 5 session: Bath and Body Works — AI flagged possible missing amendments because Letter Agreement (COVID rent deferral) referenced the Lease 'as same may have been amended.' Reviewer: 'No other specific amendments are noted. Nothing is missing.' The AI correctly identified no specific amendments were referenced in the recitals of the most recent document but still generated a speculative gap finding based solely on the boilerplate 'as amended' language."
  },
  {
    id: 'learning-1777852800003-td033', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "Internal suite or space identifier inconsistencies within a Temporary License Agreement (TLA) — where the Data Summary page and the body of the same agreement list different space numbers (e.g., Data Summary: 'F605' but body paragraph: 'Space G605') — are NOT missing document findings and are NOT actionable. These are data entry inconsistencies in the agreement form itself. Do not flag these as missing documents, discrepancies requiring confirmation, or findings of any kind. Similarly, if one TLA in a folder references a different space number in its body vs. its Data Summary, do not compare it against another TLA to manufacture a discrepancy finding.",
    rationale: "1 rejected finding from 2026-05-04 Test 5 session: Trendica — AI flagged suite identifier inconsistency (Data Summary: F605, body: 'Space G605') as requiring confirmation. Reviewer: 'This doesn't need to be noted.' Internal form inconsistencies in TLA boilerplate fields are administrative and never reviewable."
  },
  {
    id: 'learning-1777852800004-tla034', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'NAME_MISMATCH', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "In Temporary License Agreements (TLAs), a change in the legal entity name across successive agreements for the same operating tenant (same dba name, same contact person, same address) does NOT require assignment documentation, consent documentation, or name-change documentation and is NOT a name mismatch finding. TLAs are short-term licenses — each new TLA is a fresh standalone instrument. When successive TLAs list different legal entities operating under the same dba (e.g., Agreement 1: 'USA Global Power Trade, Inc. dba Trendica' → Agreement 2: 'Nomad Fashion, LLC dba Trendica'), treat this as a new agreement entered with a new entity under the same brand, not as an undocumented transfer. This pattern is common among pop-up, kiosk, and temporary tenants and requires no documentation. Do NOT flag entity changes across successive TLAs.",
    rationale: "2 rejected findings from 2026-05-04 Test 5 session (same pattern across two tenants): Trendica — USA Global Power Trade, Inc. (TLA 1) → Nomad Fashion, LLC (TLA 2), same dba/contact/address; reviewer: 'This doesn't need to be noted.' Waikiki — USA Global Power Trade Inc. (prior TLAs) → Nomad Fashion, LLC (TLA dated 12/30/25), same dba/contact; reviewer: 'This is fine. Nothing is missing.'"
  },
  {
    id: 'learning-1777852800005-etla035', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "Expired Temporary License Agreements (TLAs) and their amendments that have been superseded by a current active TLA are NOT required to be in the folder and are NOT missing document findings. If a folder contains a current TLA for a tenant and that current TLA clearly supersedes an earlier expired TLA (same tenant, same or related space), do not flag: (a) the expired original TLA as missing; (b) any amendments to the expired TLA as missing; (c) the gap period between the expiration of the old TLA and the start of the new TLA as an amendment gap or holdover finding. The current TLA is the only operative document needed. Exception: only flag a prior TLA as missing if the current TLA explicitly references it as required background (e.g., 'pursuant to the Original TLA dated X, as modified herein').",
    rationale: "2 rejected findings from 2026-05-04 Test 5 session: Waikiki — AI flagged (1) the original April 2022 TLA as missing, and (2) an amendment gap for the period May 2023–May 2024 between the expired TLA and the new May 2024 Renewal TLA. Reviewer (both): 'It's expired and replaced with license dated 12/30/25. Since it's expired and replaced, we don't need the document.' / 'Expired and replaced, so nothing is needed.'"
  },
  {
    id: 'learning-1777852800006-lc036', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "LEASE CURRENCY PARSING CROSS-CHECK (mandatory): Before flagging a lease as expired, verify that the expiration date you identified is internally consistent with the document's own execution date and term length. CRITICAL RULE: A lease cannot expire before it was signed — if you find an expiration date that predates or falls in the same year as the execution/signing date, you have almost certainly read from the wrong page, a prior exhibit, a placeholder section, or a superseded document. In that case: (1) do NOT flag the lease as expired; (2) re-read the correct lease term section (usually the Summary of Terms or Section 1 Basic Lease Provisions); (3) calculate expiration = commencement date + stated term length from the actual execution date. Example of parsing error: lease signed June 1, 2022 with '10-year term' cannot expire January 31, 2020 — the '2020' date is from a different page or prior version. Always sanity-check: expiration date > execution date > 2+ years ago is the only valid expired-lease pattern.",
    rationale: "1 rejected finding from 2026-05-04 Test 5 session: Puma — AI flagged lease as expired because it read 'expiring on January 31, 2020' from what was apparently the wrong section (possibly an old exhibit or prior version page), while the actual lease was executed June 1, 2022 with a 10-year term (expiration ~2032). Reviewer: 'It doesn't say this at all. The lease is dated 6.1.22 and the lease term is 10 years.' A lease signed in 2022 cannot expire in 2020 — this is an irreconcilable parsing error that should trigger re-reading, not a finding."
  },
  {
    id: 'learning-1777852800007-holdover037', source: 'lauren-review-2026-05-04', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-04T00:00:00.000Z',
    suggestion: "When a new lease (or new Temporary License Agreement) for the same space supersedes an expired prior lease, the holdover or month-to-month period between the expiration of the old lease and the execution of the new lease does NOT require formal documentation and is NOT a missing document finding. Do NOT flag: (a) the absence of a holdover amendment; (b) the absence of a month-to-month extension agreement; (c) the absence of Landlord written acknowledgment of holdover terms; (d) the gap period between lease expiration and new lease execution. The new superseding lease is the operative document and it covers the space going forward. A tenant letter confirming holdover intent (even one-sided/unsigned by Landlord) is sufficient context. The fact that Tenant occupied the space on a month-to-month basis before the new lease was signed is normal and self-explanatory from the documents.",
    rationale: "2 rejected findings from 2026-05-04 Test 5 session: Victoria's Secret — (1) AI flagged the ~10-month holdover gap between the Short Term Lease expiration (August 31, 2021) and the new 2022 Lease execution (June 8, 2022) as a currency/documentation concern; (2) AI flagged the absence of a formal holdover agreement for that gap period. Reviewer (both): 'The lease dated 6/2/22 is for the same space and takes over the expired Short Term Lease.' / 'Lease dated 6/2/22 is for the same space. It replaces the old expired short term lease.'"
  },
  // ── TP Excel corpus review 2026-05-05: patterns from all historical sessions ──
  {
    id: 'learning-1778025600001-el038', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "Internal exhibit label inconsistencies within a single document — where the body of the document refers to 'Exhibit A' but the attached exhibit page is labeled 'Exhibit B', or two sections of the same document use different letter designations for the same exhibit — are NOT missing exhibit findings and are NOT actionable. These are drafting and typographical artifacts within one instrument. The test for a missing exhibit finding is: is the exhibit content physically absent from the folder? If the exhibit content is present (regardless of label mismatch), no finding is needed. Do not flag internal cross-reference label conflicts where the actual exhibit content exists. Similarly, if an exhibit tab in a document reads 'Exhibit A-1' but the exhibit itself is headed 'Exhibit A', this is a label inconsistency, not a missing exhibit.",
    rationale: "Identified across multiple TP sessions from rejected findings: internal exhibit label conflicts (e.g., body says 'Exhibit A' but attached exhibit is labeled 'Exhibit B' or vice versa) within the same document. Reviewers consistently rejected these as non-actionable drafting artifacts where the exhibit content was physically present."
  },
  {
    id: 'learning-1778025600002-sp039', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'MISSING_PAGES', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "Blank white pages that appear in scanned PDFs are scan artifacts — they are NOT missing pages findings. A completely blank page between sections, between exhibits, or at the end of a document indicates the scanner captured a blank sheet that was used as a physical separator between document sections. These are extremely common in scanned lease packages. Do NOT flag: (a) a single blank page between document sections as a missing page; (b) a blank page at the end of a document as evidence of missing content; (c) multiple blank pages between exhibits as missing pages. Blank pages are only relevant if the two-step content check (mp009) independently confirms a content scar — a broken sentence, a missing TOC entry, or a skipped section number. A blank page alone, with no content scar on either side of it, is always a scan artifact.",
    rationale: "Pattern identified across TP sessions: model flagged blank white separator pages in scanned PDFs as missing pages findings. These are standard scan artifacts from physical separator sheets and are never missing content. Blank pages are not content — they do not trigger the two-step missing-pages test on their own."
  },
  {
    id: 'learning-1778025600003-rd040', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "When an amendment's recitals reference a prior document by a date that does not precisely match the date on the actual document in the folder — but the document is otherwise clearly the same instrument (same parties, same type, same general time period) — this is a scrivener's error in the recital, not a missing document. Do NOT flag: (a) a document as missing simply because its recital date differs from the date on the face of the document in the folder (e.g., recital says 'Lease dated June 1, 2012' but the lease in folder is dated 'June 5, 2012'); (b) a date discrepancy between the 'entered into as of' date and the actual signature date as a finding; (c) a one-digit transposition in a year (e.g., recital says '2012' but document says '2013') where the instrument is otherwise clearly identical. The document match test is: same document type + same parties = same instrument, regardless of a minor date discrepancy in a recital cross-reference.",
    rationale: "Pattern identified across TP sessions: recital cross-reference dates differing by days, weeks, or a year from the actual document date in the folder. When the document is physically present and otherwise matches, the date discrepancy is a drafting error, not evidence of a missing document. Reviewers consistently rejected these as 'scrivener's errors' or 'drafting artifacts.'"
  },
  {
    id: 'learning-1778025600004-gty041', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "When an amendment requires consent of guarantors and only one of multiple named guarantors has signed the Consent of Guarantor page, this is acceptable — do NOT flag it as an execution deficiency or a missing guarantor consent. Partial execution of a multi-guarantor consent block (where at least one guarantor has signed) is sufficient. Do not flag: (a) the absence of one guarantor's signature when another guarantor has signed; (b) blank signature blocks for secondary or additional guarantors; (c) a Consent of Guarantor page missing one of two or more guarantors' signatures. The only Guaranty execution findings that are valid are: (1) the Guaranty signature block ('By:') is entirely blank with no guarantor having signed at all, or (2) the entire Guaranty document is absent from the folder and was contractually required.",
    rationale: "Pattern identified across TP sessions: model flagged Consent of Guarantor pages where one of two or more guarantors had not signed. Reviewers consistently rejected: partial multi-guarantor consent is acceptable; only a completely blank guaranty consent is a finding."
  },
  {
    id: 'learning-1778025600005-de042', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "Internal body-text drafting errors and typographical mistakes within a document are NOT findings of any kind. Do NOT flag: (a) an amendment whose title or body text contains an incorrect ordinal label (e.g., a document titled 'Second Fourth Amendment' or a body paragraph that reads 'This Third Amendment' when it is actually the Fifth Amendment); (b) an amendment that numbers itself incorrectly in its own body text (e.g., 'Pursuant to Section 3 of this Second Amendment' when the document is the Third Amendment); (c) any other internal body-text mislabeling where the document is otherwise fully executed and present. These are scrivener's errors and drafting inconsistencies that are visible on the face of the document. They are not missing document findings, amendment gap findings, or execution findings. The presence of the document itself — regardless of what it calls itself internally — satisfies the folder completeness requirement.",
    rationale: "Pattern identified across TP sessions: model flagged documents with internal mislabeling errors (e.g., 'Second Fourth Amendment') as amendment gaps or potential missing documents. Reviewers consistently rejected: internal drafting errors in body text are not reviewable. The document's presence is what matters."
  },
  {
    id: 'learning-1778025600006-sl043', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "When a folder contains a sublease (where the tenant named in the folder's master lease is acting as sublandlord), this situation is in scope — do NOT generate a scope question or scope-clarification finding. Analyze the sublease documents in the folder normally, reviewing for execution, amendment gaps, and missing documents just as you would for a standard lease. Do not flag the sublease arrangement itself as a concern. Also do NOT flag: (a) the absence of the master lease between the sublandlord/tenant and the building owner (the overlying landlord) as a missing document — that is a separate folder; (b) the sublease as out of scope just because it involves a sub-landlord/subtenant relationship; (c) any finding asking whether the sublease is in scope. Subleases are within review scope — analyze them.",
    rationale: "Pattern identified across TP sessions: model generated scope-clarification questions or scope-query findings when encountering sublease documents in a tenant folder. Reviewers consistently rejected: subleases are in scope and should be analyzed normally. The absence of the overlying master lease from the same folder is not a finding."
  },
  {
    id: 'learning-1778025600007-gty044', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "When an amendment's recitals or body reaffirm or reference a Guaranty of Lease by a specific date that differs from the date on the Guaranty document actually present in the folder — but an executed Guaranty IS physically present — do NOT flag this as a missing document or a guaranty deficiency. The reaffirmation reference is to the executed guaranty by approximate date; minor date discrepancies between a reaffirmation reference and the actual guaranty document date are drafting artifacts. The presence of any executed Guaranty of Lease in the folder satisfies the guaranty requirement. Only flag a guaranty as missing when: (a) no executed guaranty is present anywhere in the folder, AND (b) the lease or an amendment expressly required one.",
    rationale: "Pattern identified across TP sessions: model flagged 'guaranty reaffirmation references guaranty dated X but the guaranty in folder is dated Y' as a missing document. Reviewers consistently rejected: an executed guaranty is present, which satisfies the requirement regardless of a date cross-reference discrepancy in a reaffirmation clause."
  },
  {
    id: 'learning-1778025600008-ex045', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "COUNTERPART-PAGE EXECUTION: Many multi-party lease documents are executed in counterparts, where each party signs a separate designated page within the same PDF file rather than all signing the same page. This is fully valid execution. Do NOT flag a document as partially executed or missing a party's signature simply because a signature block appears blank on the page where you expect to find it. Required procedure: scan ALL pages of the PDF, including pages after the primary signature page, for any signature by or on behalf of the party you believe has not signed. A counterpart execution page for Tenant may appear 3-5 pages after Landlord's signature page. Only flag a party as having not signed after confirming that no signature, mark, or indicator for that party appears on ANY page of the document from the first signature block through the final page.",
    rationale: "Pattern identified across TP sessions: model flagged counterpart-executed documents as partially executed when one party's signature appeared on a separate page from the other party's. Reviewers consistently rejected: counterpart execution within a single PDF is standard practice and fully valid. This extends fp001 (next-page signatures) to the explicit counterpart-page scenario."
  },
  {
    id: 'learning-1778025600009-oos046', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "Internal landlord administrative documents are entirely out of scope and must never be flagged as missing, referenced, or required. Documents in this category include: Committee Review Forms, Deal Approval Forms, Investment Committee Approval Memos, Credit Approval Forms, Leasing Committee Summaries, and any other internal landlord business process document. If such a document appears in a folder, it is purely informational background — do not analyze it, do not generate findings about its execution or content, and do not treat it as evidence of other missing documents. Its absence from a folder is not a finding of any kind. Similarly, do not flag the absence of any Landlord internal approval document even if referenced in lease negotiations or correspondence in the folder.",
    rationale: "Pattern identified across TP sessions: model generated findings about Committee Review Forms and internal landlord administrative documents, either flagging them as improperly executed or treating them as evidence of other missing approvals. These are internal business records outside review scope."
  },
  {
    id: 'learning-1778025600010-sur047', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "When a folder contains a Surrender Agreement, Early Termination Agreement, or similar document confirming that the tenant has surrendered possession of the space and the lease has been terminated — the tenant is likely out of scope (no longer an active tenant). In this scenario: generate ONE scope-confirmation note stating that the folder contains a Surrender/Termination Agreement and that the tenancy appears to have ended, and generate NO OTHER findings (no missing document findings, no execution findings, no amendment gap findings). Do not analyze the folder in detail as if the tenant is currently active. The single scope note is the complete output for this folder. Do not flag execution of the Surrender Agreement itself unless the surrender agreement's own signature blocks are entirely blank.",
    rationale: "Pattern identified across TP sessions: when a Surrender Agreement was present, the model either ignored it and continued generating standard findings, or generated multiple findings about the surrendered tenancy as if it were still active. The correct behavior is a single scope-confirmation note and no other findings."
  },
  {
    id: 'learning-1778025600011-mg048', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "A Notice of Merger, Certificate of Merger, Articles of Merger, or Statement of Merger in a folder does NOT create an obligation to find a separate Landlord Consent to Merger or Landlord Consent to Assignment. A merger that occurs by operation of law (statutory merger) does not require landlord consent unless the lease explicitly states that a merger — as opposed to an assignment — requires consent. Do NOT flag: (a) the absence of a Landlord Consent to Merger when a merger notice is present in the folder; (b) a merger as an undocumented transfer requiring assignment documentation; (c) the surviving entity as a new/different tenant requiring consent simply because its name changed via merger. A statutory merger resulting in a name change is not an assignment. Only flag missing merger/assignment consent if the lease body explicitly uses the words 'merger' and 'consent required' or 'prior written approval' together for that specific transaction type.",
    rationale: "Pattern identified across TP sessions: model treated a Notice of Merger in a folder as evidence that a Landlord Consent to Merger was missing. Reviewers consistently rejected: a merger notice documents the legal event; it does not mean landlord consent was required or obtained separately."
  },
  {
    id: 'learning-1778025600012-oos049', source: 'tp-corpus-review-2026-05-05', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-05T00:00:00.000Z',
    suggestion: "The following document types are ENTIRELY OUT OF SCOPE and must NEVER be flagged as missing, unexecuted, incomplete, or deficient — regardless of whether they appear in the folder or are referenced in lease documents: (1) Sales Reports — periodic tenant sales volume reports submitted to landlord; (2) Gross Sales Certifications — annual or periodic certifications of gross sales for percentage rent purposes; (3) Percentage Rent Statements — reports calculating or certifying percentage rent obligations; (4) Sales Audit Correspondence — landlord demands for sales reports, audit requests, or responses to same; (5) Sales Reconciliation Letters — any correspondence settling, disputing, or confirming gross sales figures. These are operational financial documents, not lease instruments. Their presence or absence in a folder is irrelevant to the lease abstracting review. If any of these appear, do not analyze them. If any are absent, do not flag them.",
    rationale: "Pattern identified across TP sessions: model generated findings about missing sales reports, gross sales certifications, and demand-for-sales correspondence when percentage rent clauses in the lease referenced them. These are recurring operational documents that are out of scope for lease abstracting. Their absence is never a finding."
  },

  // ── TP2 session 2026-05-05: patterns from Target Practice 2 review ──────────
  {
    id: 'learning-1778112000001-ex050', source: 'tp2-review-2026-05-05', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-05T12:00:00.000Z',
    suggestion: "A blank 'Date:' line immediately below or beside a signed 'By:' signature block is NEVER an execution defect. This is the single most-rejected category across all review sessions. The ONLY field that determines execution is the 'By:' signature line. If By: has any visible mark — handwritten signature, printed name with signature above it, electronic signature indicator, or initials — the document IS fully executed, regardless of: (a) a blank Date: field, (b) a blank Dated: field, (c) a date entered in the Title: field instead of the Date: field, (d) a blank Its: or Title: field, (e) a blank Print Name: or Printed Name: field. Do NOT generate any finding about these secondary fields. If you find yourself drafting a finding about a blank Date: line where By: is signed, DELETE that finding before outputting it. This is non-negotiable — reviewer has rejected this finding type in every test session.",
    rationale: "TP2 session 2026-05-05: 4 of 7 rejected findings (across Stretch Zone, Wells Fargo, Monterey Bay Homes) were about blank Date: lines in otherwise fully-signed documents. Reviewer in every case: 'Document is fully executed. We do not need the date line to be filled out. We just need a signature.' This strengthens bl002 (2026-04-23) with explicit deletion instruction and specific variants."
  },
  {
    id: 'learning-1778112000002-mp051', source: 'tp2-review-2026-05-05', active: true,
    checkType: 'MISSING_PAGE', confidence: 'HIGH',
    createdAt: '2026-05-05T12:00:00.000Z',
    suggestion: "Blank pages appearing at the end of an exhibit section — such as a page labeled 'D-3' that is entirely blank, or a duplicate 'D-1' page that is blank, following substantive content pages D-1 and D-2 — are scan artifacts from the physical back-sides of pages or physical separator sheets. They are NOT missing content. Before flagging any blank pages as missing exhibit content, verify: (a) does the exhibit's substantive content on the pages BEFORE the blank pages flow to completion without a broken sentence? (b) does the preceding content appear to finish its numbered list or section cleanly? If both are true, the blank trailing pages are artifacts — do NOT generate a finding. The same logic applies to any exhibit that has numbered pages out of sequence (e.g., D-3 followed by a second D-1) — this is a scanning artifact, not a structural defect.",
    rationale: "TP2 session 2026-05-05: Pho Tastic Exhibit D (Sign Criteria) — pages D-3 and duplicate D-1 were blank scan artifacts after complete content on D-1 and D-2. Reviewer: 'Nothing looks cut off. I wouldn't say anything is missing.' Model incorrectly flagged as LOW severity missing exhibit."
  },
  {
    id: 'learning-1778112000003-mp052', source: 'tp2-review-2026-05-05', active: true,
    checkType: 'MISSING_PAGE', confidence: 'HIGH',
    createdAt: '2026-05-05T12:00:00.000Z',
    suggestion: "Many commercial leases use dual numbering systems: Roman numerals (i, ii, iii, iv, v, vi) for front-matter sections (Table of Contents, Basic Lease Terms, Key Provisions Summary) and Arabic numerals (1, 2, 3…) starting at page 1 for the body. The transition from the last Roman-numeral page (e.g., page vi) to body page 1 (e.g., the first page of Section 2, Definitions) creates an apparent page number gap (the scan's page counter may jump from its internal count). This is NOT a missing page — it is a standard legal document formatting convention. Do NOT flag this transition as a missing pages gap. The two-step content check (mp009) must still confirm a genuine content scar before any missing-page finding is generated; the absence of page numbers '1' through '4' in the printed sequence when those pages are actually the Roman-numeral front matter is not a content scar.",
    rationale: "TP2 session 2026-05-05: Stretch Zone 2019 lease — front matter used Roman numerals i–vi, body began at Arabic page 1. Model incorrectly detected a 'jump from page 1 to page 5' as missing pages. Reviewer: 'This does not need to be noted.' The automated page-gap detection misread the Roman numeral front matter as pages 1-4."
  },

  // ── TP2 session 2026-05-06: 3-batch review of 15 tenants ───────────────────
  {
    id: 'learning-1778198400001-ex053', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "MANDATORY EXHIBIT ENUMERATION: When the lease (or most recent governing document) contains a formal exhibit index, Table of Contents, or exhibit schedule, you MUST list and check EVERY single exhibit individually — A, B, C, D, E, F, G, H, plus every Rider, Schedule, and Addendum. Do NOT generate findings for only a subset. After completing your enumeration, output one finding per missing exhibit. If the index lists Exhibits A–G plus Riders 1–2, you must check all 9 items individually and generate a finding for EACH absent one. Do not stop at the first few you notice. Common mistake: model checks 4 exhibits, finds them missing, generates 4 findings, and stops — leaving 4 other missing exhibits unflagged. Triple-check the index against the actual content before finalizing the missing-exhibit list.",
    rationale: "TP2 session 2026-05-06: Everbowl lease index listed Exhibits A–G plus Rider 1 + Rider 2. Model flagged Exhibits A, B, E and Rider 2 as missing but completely missed Exhibits C, D, G, and Rider 1 — reviewer manually flagged all four. Pattern: model inconsistently enumerates the exhibit list and stops after generating a few findings."
  },
  {
    id: 'learning-1778198400002-ex054', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "PARTIAL EXHIBIT — COVER PAGE ONLY: An exhibit whose cover or heading page IS present but whose substantive content appears absent (e.g., 'Exhibit C' heading exists on page 64 but the next page is 'Exhibit D' instead of Exhibit C content) is NOT a missing-exhibit finding at the initial review. The cover page being present satisfies the initial completeness check. The abstracting reviewer will determine if substantive content is required during their substantive review. Do NOT flag this as missing. Only flag exhibits as missing when the exhibit is COMPLETELY absent from the document — no cover page, no heading, no content of any kind.",
    rationale: "TP2 session 2026-05-06: Aspire Salon Exhibit C (Sign Criteria) — heading page present on PDF page 64 with no substantive content; next page was Exhibit D. Reviewer: 'For initial missing documents, it's ok that the cover page is there. We wouldn't note this as missing unless the reviewer determines we need it after abstracting.'"
  },
  {
    id: 'learning-1778198400003-ex055', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "COMMENCEMENT DATE AGREEMENT / ACCEPTANCE OF PREMISES ATTACHED AS RIDER OR EXHIBIT: When a Commencement Date Agreement, Acceptance of Premises, Delivery Date Certificate, or similar post-occupancy form is attached to the main lease as a Rider or Exhibit (rather than as a standalone fully-executed instrument), blank Landlord and/or Tenant signature lines on it are NOT execution findings. These are template forms placed in the lease for later post-occupancy execution. Do NOT flag any of: blank By: line, blank Date: line, blank Commencement Date field, blank Expiration Date field, or blank entity-chain fields on these attached forms. Only flag if the lease specifically requires a separately executed and delivered Commencement Date Agreement AND that document is entirely absent from the folder.",
    rationale: "TP2 session 2026-05-06: All American Car Wash Rider 1 (Commencement Date Agreement) — Tenant signed, Landlord blank. Aspire Salon Rider 1 (Commencement Date Agreement) — Tenant signed, Landlord blank. Both rejected. Reviewer: 'Sometimes the Commencement Date Agreement can be attached to the lease as an Exhibit or Rider and its just a form document for later. We don't note it as missing when it's attached to the lease like this.'"
  },
  {
    id: 'learning-1778198400004-dup056', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "DUAL COUNTERPARTS — ONE SIGNED IS DETERMINATIVE: When the folder contains two or more copies of the same document and ONE copy is fully executed while another copy has blank signature lines, the document IS EXECUTED. The signed copy is the operative instrument; the blank copy is a draft, working copy, or unexecuted counterpart. Do NOT generate any execution finding when at least one copy of the document is fully signed. This includes: standalone Guaranty file is executed but the Guaranty appearing as Exhibit D inside a lease PDF is blank → use the standalone, ignore the embedded blank. Pattern is universal: signed counterpart wins over blank counterpart, regardless of which file each appears in.",
    rationale: "TP2 session 2026-05-06: (1) Ichi Poki Salad Bar — Assignment Second Amendment dated 12/9/2022: folder had two copies, one fully signed by Jian Y. Zhang, the other blank. Model flagged the blank one. Reviewer: 'Document is fully executed.' (2) Mattress Firm — Tweeter Guaranty embedded as Exhibit D was blank, but standalone executed Guaranty file existed in folder. Reviewer: 'Document is fully executed.'"
  },
  {
    id: 'learning-1778198400005-fl057', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "FOLDER FILE-LIST VERIFICATION: Before flagging any document as missing, you MUST scan the COMPLETE list of filenames in the folder. Look for filename matches by: (a) date — '2002-12-31-' in filename matches a 'December 31, 2002' reference; (b) parties — 'Tweeter-Assignment' matches 'Assignment by Tweeter of California'; (c) document type — 'Amendment-No-3' matches a Third Amendment reference; (d) any combination. If ANY filename in the folder plausibly matches the referenced document, do NOT flag it as missing — even when the formal document title differs from the filename. Filenames are administrative and rarely match formal titles exactly. Match generously: a 60% similarity by date/parties/type is enough to assume the document is present.",
    rationale: "TP2 session 2026-05-06: Mattress Firm — model flagged 'Executed Assignment and Assumption of Leases dated December 31, 2002 (Tweeter of California → New England Audio)' as missing. The file '2002-12-31-Tweeter-Assignment-PDF.PDF' was present in the folder. Reviewer: 'Copy of executed document is file 2002-12-31-Tweeter-Assignment-PDF.' The model literally acknowledged the file existed but flagged the missing finding anyway."
  },
  {
    id: 'learning-1778198400006-oos058', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "OUT-OF-SCOPE OVERRIDE PROHIBITION: When an existing learning rule (any of: oos010, oos046, oos047, oos049, etc.) marks a document type as out of scope, you MUST NEVER override that rule with reasoning like 'but it is the only operative deal document,' 'but it is the only thing in the folder,' 'but it is relevant context,' or 'but it shows the deal terms.' Out of scope is absolute. Even if you find yourself drafting a finding because the OOS document seems to be the only operative document in the folder, DELETE that finding. The correct action when the only document in a folder is out-of-scope is to flag the folder as 'no in-scope lease documents present' — not to flag the OOS document for execution. Confirmed out-of-scope categories: LOIs, counter-offers, term sheets, business plans, marketing materials, tax returns, P&L statements, financial statements, deposit checks, photos of checks, lease abstract Word documents (.doc files that summarize lease terms but are not themselves leases), Owner-Contractor construction agreements, TI construction contracts, sales reports, gross sales certifications, percentage rent statements.",
    rationale: "TP2 session 2026-05-06: (1) Alaska Crab — model flagged execution issues on a Counter-Offer/LOI dated March 6, 2025. Model literally wrote 'AI notes Learning 40 says LOIs out of scope but flagged anyway since it's the only operative deal document.' Reviewer rejected. (2) Fantastic Sams — model flagged business plan, deposit check photo, P&L docs, tax docs as 'special agreement' findings. Reviewer rejected all. (3) Marshalls — model flagged Owner-Contractor Agreement with Gluck Building Company. Reviewer: 'We do not abstract construction agreements.'"
  },
  {
    id: 'learning-1778198400007-decl059', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'SPECIAL_AGREEMENT', confidence: 'MEDIUM',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "RECORDED COVENANTS / DECLARATIONS / EASEMENTS / CC&Rs: Recorded covenants, declarations, easements, CC&Rs (Covenants Conditions & Restrictions), REA agreements, and Covenant and Conditions Affecting Real Property are SCOPE QUESTIONS for the abstracting reviewer — not standalone execution or missing-document findings. When you encounter such a recorded instrument, generate ONE concise scope-confirmation note at LOW or MEDIUM severity stating that the document exists and asking the reviewer to confirm whether it is within abstracting scope. Do NOT: (a) generate execution findings for these instruments (they are recorded by the County, not executed bilaterally for this lease); (b) generate the same finding for every tenant in the property — the recorded instrument applies to the property, not to each tenant individually; (c) flag them as missing if absent — they are owned by the property, not the lease folder. One scope note total per property, not per tenant.",
    rationale: "TP2 session 2026-05-06: (1) Best Buy — model flagged 'Executed Covenant and Conditions Affecting Interests in Real Property' as missing. Reviewer: 'Partial: This is a separate document. We first need to ask if in scope before we ask if it's executed.' (2) User feedback: 'these should be flagged for abstracting scope, but if there's one, it's probably going to be the same one noted in multiple abstracts and I would only need to have it noted 1 times. Otherwise it could get cumbersome to go thru all the lines on the Excel Missing Documents report for the same Easement for every tenant.'"
  },
  {
    id: 'learning-1778198400008-mp060', source: 'tp2-review-2026-05-06', active: true,
    checkType: 'MISSING_PAGE', confidence: 'HIGH',
    createdAt: '2026-05-06T00:00:00.000Z',
    suggestion: "TEXT-EXTRACTION PAGE-NUMBER ARTIFACTS: When you observe printed page numbers that appear to skip wildly (e.g., 5 → 20, 1 → 28, 28 → 4097, or PDF page 50 → page 1 → page 200), this is almost always a TEXT-EXTRACTION ARTIFACT, not missing pages. Causes include: (a) text extraction concatenating page numbers from multiple sub-documents bound into one PDF; (b) header/footer noise being parsed as page numbers; (c) section restart numbering across exhibits; (d) PDF metadata vs printed page mismatches. Before flagging missing pages, verify: does the lease body's TEXT FLOW continuously? Does it END with substantive content followed by a signature page? Are sections complete? If the document reads as a coherent complete lease end-to-end, the apparent page jumps are extraction artifacts — DO NOT flag missing pages. Only flag when the two-step content check (mp009) confirms a real content scar (broken sentence at boundary, TOC entry with no content, or skipped section number).",
    rationale: "TP2 session 2026-05-06: Fantastic Sams — model flagged 'Lease-pdf.pdf' as 'severely truncated' with page jumps 5→20, 1→28, 28→4097 and concluded 'lease body incomplete; no signature block.' Reviewer: 'Pages are not missing. Lease is present and complete.' The text extraction had concatenated multiple sub-document page numbers, creating phantom gaps."
  },

  // ── TP3 historical-corpus mining 2026-05-06: 18+ rejected-finding xlsx files ──
  {
    id: 'learning-1778205600001-ex061', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "PRE-PRINTED NAME STRUCK OUT WITH HANDWRITTEN REPLACEMENT IS VALID: When a signature block has a pre-printed name that has been crossed out or struck through, with a handwritten name written in and a corresponding signature, the document IS executed. Do NOT flag this as a name mismatch or execution defect — it is standard practice when a different person from the originally-printed name actually signs. Similarly: if the handwritten signature does NOT visually match the printed name (e.g., printed name says 'John Smith' but signature looks like 'JS' initials or a stylized scrawl), this is still valid execution. Only the PRESENCE of a By: signature line marking determines execution.",
    rationale: "Historical TP corpus: Smart Repair (pre-printed name struck out + handwritten replacement, reviewer: 'It's ok that its crossed out. We have a matching name and signature'); Mount of Olives + Sweet Frog (signatures don't match printed names, reviewer: 'It's ok that signatures don't match the handwritten name perfectly')."
  },
  {
    id: 'learning-1778205600002-ex062', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "NOTARY ACKNOWLEDGMENT, WITNESS SIGNATURES, AND BROKER ACKNOWLEDGMENTS ARE NOT REQUIRED: A blank, missing, illegible, or absent notary acknowledgment block, jurat, witness signature line, or broker acknowledgment block is NEVER an execution finding. These elements are not required for lease execution validity in this practice. Documents with blank notary or witness sections are still fully executed if the By: signature line of each required party is signed. Specifically do not flag: (a) blank notary acknowledgment on a Memorandum of Lease; (b) missing notary stamp; (c) blank witness signature line on the lease body or any amendment; (d) blank broker acknowledgment / broker signature page; (e) absent jurat language. Confirmed across multiple sessions: Pho Tastic, Oakley, BoA Memorandum, Barberito's, Donato's.",
    rationale: "Historical TP corpus: Pho Tastic, Oakley, BoA Memorandum (notary blank, reviewer: 'Document is fully executed. Nothing needs to be noted'); BoA Memorandum + others (witnesses blank, reviewer: 'Document is fully executed'); Barberito's, Donato's (broker acknowledgment blank, reviewer: 'Not included in abstracting. Not missing'). Strengthens existing F12 (notarization absent) with explicit broker-ack and witness coverage."
  },
  {
    id: 'learning-1778205600003-oos063', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "MEMORANDUM OF LEASE / SNDA / ESTOPPEL / BROKER COMMISSION — NEVER FLAG AS MISSING OR REQUIRING SIGNATURE: These document types are out of abstracting scope and must NEVER appear in findings: (1) MEMORANDUM OF LEASE — not needed for abstracting, do not flag if missing, do not flag if unsigned; (2) SNDA / Subordination, Non-Disturbance & Attornment Agreement — never abstracted, regardless of references in the lease; (3) ESTOPPEL CERTIFICATE — estoppels do not need to be signed, do not flag missing or unsigned estoppels; (4) BROKER COMMISSION AGREEMENT / LEASE COMMISSION AGREEMENT — never abstracted; (5) FRANCHISE AGREEMENT / FRANCHISE COLLATERAL ASSIGNMENT — never abstracted. Even if any of these is referenced multiple times in the lease body, do not flag. Even if the lease 'requires' delivery of one of these, do not flag.",
    rationale: "Historical TP corpus: BoA, Price Chopper, Instant Replay (Memorandum of Lease flagged, reviewer: 'Memorandum of Leases are not needed for abstracting'); Academy Sports, Barberito's, Duff & Phelps (SNDA flagged, reviewer: 'We don't need SNDA Agreements'); Dollar General (estoppel signature, reviewer: 'Estoppels don't need to be signed'); Fins, Donato's, Instant Replay (broker commission, reviewer: 'We don't include Broker Commission Agreements in abstract'); Donato's, Barberito's (franchise/collateral assignment, reviewer: 'We don't usually need Collateral Assignments for abstracting')."
  },
  {
    id: 'learning-1778205600004-oos064', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "OPERATIONAL / ANCILLARY DOCUMENTS NEVER ABSTRACTED: HVAC Service Agreement, Pest Control Agreement, Certificates of Insurance (COIs), Business License, W-9 form, ACH/Direct Deposit Authorization, Committee Review Form / Deal Approval Form, Sales Report demands or audit correspondence, Notice of Merger, Bankruptcy Assumption Order, court orders, Construction Sub-Contracts (AIA G704 / Certificate of Substantial Completion / TIA / Punch List), and similar operational documents are NEVER abstracted and NEVER missing. Do not flag any of these as missing, deficient, or unsigned. AIA G704 and similar construction sub-documents specifically: 'This does not need to be signed.'",
    rationale: "Historical TP corpus: Wellness, BoA, Great Clips, Price Chopper (HVAC, COIs, W-9, ACH, Committee Review, sales-report demands flagged, reviewer: 'We do not need this'); Academy Sports (AIA G704 unsigned flagged, reviewer: 'This does not need to be signed'); Big Biscuit (Notice of Merger flagged, reviewer: 'We don't usually need a Notice of Merger'); Claire's (Bankruptcy Assumption Order flagged, reviewer: 'This is not a missing document')."
  },
  {
    id: 'learning-1778205600005-amr065', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "AMENDED & RESTATED LEASE SUPERSEDES ALL PRIOR DOCUMENTS: When the folder contains an Amended and Restated Lease (or A&R Lease) that contains the full lease terms, this document IS the operative lease. Do NOT flag the original lease, prior amendments, or related ancillary documents as missing — the A&R Lease incorporates and supersedes all of them. Specifically: (a) original lease that's been incorporated into A&R Lease — not missing; (b) early amendments incorporated into A&R Lease — not missing; (c) recital references to documents that have been folded into the A&R Lease — not findings. Same principle applies to expired/replaced TLA chains: when a current TLA supersedes prior expired TLAs, the prior TLAs are not missing.",
    rationale: "Historical TP corpus: Sweet Frog, La Rosa Nails (original lease + early amendments flagged as missing, reviewer: 'If there is an Amended and Restated Lease that contains full Lease terms, this is considered the Lease'); Waikiki, Victoria's Secret short-term lease (expired TLAs flagged, reviewer: 'Expired and replaced, so nothing is needed'). Strengthens existing F14 (superseded documents) with explicit A&R Lease language."
  },
  {
    id: 'learning-1778205600006-curr066', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'CURRENCY', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "DO NOT NARRATE A CURRENT LEASE: When the lease IS current (not expired and not expiring within 90 days), generate ZERO findings of any kind about lease currency. Do NOT write affirmative narratives like 'The lease is current and active through [date],' 'The amendment chain is complete,' 'The guaranty is executed and in force,' 'No documents are missing,' or any similar status-confirmation note. Reviewer time is spent on actionable items only. The complete output for a current lease is silence. This is the most-rejected pattern across 8+ sessions: every affirmative-current narrative was rejected with 'This is correct but does not need to be noted.'",
    rationale: "Historical TP corpus: Smart Repair, Sunset Shoes, Dollar General, La Rosa, Wellness, Barberito's, Zumiez x2, Zales, Big Biscuit (8+ sessions). All rejected affirmative-current narratives. Reviewer: 'This is correct but does not need to be noted. We only need to know if it's current.' Existing CHECK 3 already says silence = current, but the model keeps generating narratives anyway. This rule restates it as a hard prohibition."
  },
  {
    id: 'learning-1778205600007-ag067', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'AMENDMENT_GAP', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "AMENDMENT-CHAIN VERIFIED COMPLETE — DO NOT NOTE: When you have verified the amendment chain is complete and unbroken, generate NO finding about it. Do not write 'The amendment chain is complete,' 'All amendments are present,' 'Chain of title is unbroken,' or any affirmative completeness note. Generate findings ONLY for genuine gaps. Also: when recitals contain a DOCUMENT LIST that names every prior amendment by date and the listed documents are all present — even if the numbering differs from your expectation (e.g., 'Lease Extension' fills the Fifth-Amendment slot, or a 'Master Amendment' serves as the Third) — DO NOT flag a gap. The recitals' document list is authoritative. Go by the document list, not by ordinal numbering expectations.",
    rationale: "Historical TP corpus: Dollar General, Wellness, Journeys, Sunglass Hut (4 sessions) — affirmative chain-complete narratives rejected: 'This is correct, but we don't need it noted.' Advance America, Sunglass Hut, Francesca's — model flagged numbered amendments as missing when recitals listed renamed/non-standard amendment titles, reviewer: 'if we have a document list in the recitals, we go by the document list.'"
  },
  {
    id: 'learning-1778205600008-ex068', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "RESERVED EXHIBITS AND SUB-EXHIBITS ARE NEVER MISSING: (1) An exhibit explicitly marked 'RESERVED', '[Intentionally Left Blank]', '[Reserved]', or similar in the index or as a placeholder page is NOT missing — it is intentionally absent by design. Do NOT flag. (2) Sub-exhibits — exhibits within exhibits — such as Exhibit A-1, Exhibit A-2 within Exhibit A, sub-warranties, electrical proposals embedded in a Work Letter, or sub-attachments within a Collateral Assignment, are NOT separately required and are NEVER missing-exhibit findings. Only top-level exhibits listed in the formal lease exhibit index need to be checked.",
    rationale: "Historical TP corpus: Academy K (RESERVED exhibit flagged, reviewer: 'This is fine'); La Rosa, Goldsmith, Academy (sub-exhibits flagged, reviewer: 'We dont usually need sub exhibits'). Strengthens existing exhibit-handling rules."
  },
  {
    id: 'learning-1778205600009-gty069', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "DO NOT SPECULATIVELY FLAG GUARANTIES: A Guaranty finding is only valid when the lease/amendment EXPLICITLY requires delivery of a separate Guaranty document AND no executed Guaranty (under any filename) is present in the folder. Do NOT flag based on inference, indirect references, or speculative reasoning like 'a guaranty might exist,' 'a guaranty appears to be expected,' or 'language suggests a guarantor.' Naming a guarantor in passing (e.g., 'guarantor: John Smith') is NOT a delivery requirement. Also: if the guaranty IS present and signed by the guarantor, do NOT flag a missing Landlord countersignature/acceptance — guaranties are unilateral and do not require landlord countersignature.",
    rationale: "Historical TP corpus: China Dragon x2, Design Nails (guaranty inferred from text but no explicit requirement, reviewer: 'I would let the reviewer decide... document doesn't exactly say a Guaranty exists'); Donato's (Guaranty signed by guarantor, Landlord countersignature blank, reviewer: 'This is considered executed'). Strengthens existing gty008 rule."
  },
  {
    id: 'learning-1778205600010-init070', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "PARTIAL INITIALS ON BODY PAGES ARE NOT EXECUTION DEFECTS: Body-page initial blocks (where each party initials each page of the lease as 'read and accepted') being partially blank — only one party initialed, or initials missing on some pages but present on others — is NOT an execution defect. Do NOT flag missing or partial initials on lease body pages. The only line that determines execution is the By: signature line in the formal signature block at the end of the document. Initials on body pages are courtesy markings.",
    rationale: "Historical TP corpus: Sweet Frog (Tenant initialed body p.22, Landlord did not, reviewer: 'We don't need initials here')."
  },
  {
    id: 'learning-1778205600011-leg071', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'LEGIBILITY', confidence: 'MEDIUM',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "LEGIBILITY FINDINGS MUST INCLUDE THE SPECIFIC FAILURE REASON: When generating a LEGIBILITY finding (manual review required because a document cannot be analyzed), you MUST include in the finding text the SPECIFIC reason: 'image-only PDF, no extractable text,' 'OCR scan quality too low to read,' '.doc legacy format requires conversion,' 'password-protected PDF,' 'corrupted file,' etc. A finding that just says 'Claude returned an unparseable response — manual review required' without diagnostic detail is unhelpful. The reviewer needs to know WHY they need to look manually. Also: a Word document (.doc/.docx) whose contents is itself a lease abstract summary is NOT a missing-document or legibility issue — it is an internal work product, see oos058 / F31.",
    rationale: "Historical TP corpus: Pet Supplies, Sally Beauty, Hot Topic, Carter's, Old Navy, J. Crew (5+ sessions) — generic 'unparseable response' legibility flags, reviewer: 'It's correct to note this needs manual review, but it's helpful to see why this can't be reviewed.'"
  },
  {
    id: 'learning-1778205600012-md072', source: 'tp3-corpus-mining-2026-05-06', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-06T18:00:00.000Z',
    suggestion: "LEASE-DATE DISCREPANCIES IN AMENDMENT RECITALS ARE INFORMATIONAL ONLY: When an amendment's recital references the original lease by a date that differs slightly from the lease's actual date (e.g., recital says 'Lease dated June 1, 2018' but lease itself is dated 'May 30, 2018'), this is a scrivener-level inconsistency and is NOT a missing-document finding. Do NOT flag as 'N/A — Lease date discrepancy' or any variant. Recital date mismatches are common drafting artifacts when the lease's signing date differs from the lease's stated effective date. The actual lease document's presence satisfies the requirement.",
    rationale: "Historical TP corpus: La Rosa Nails ('N/A — Lease date discrepancy' flagged, reviewer: 'This is ok and not considered a missing document'). Strengthens F11 (recital date discrepancy)."
  },

  // ── TP2 session 2026-05-18: Lauren's tests (Mirage Hair, Pigtails, D&P, etc.) ──
  {
    id: 'learning-1778544000001-ex073', source: 'tp2-review-2026-05-18', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-18T12:00:00.000Z',
    suggestion: "COUNTERPART SIGNATURES ACROSS SEPARATE PAGES ARE STANDARD EXECUTION: When a document contains a counterparts clause (e.g., 'This Agreement may be executed in counterparts...' or 'each of which shall be deemed an original') AND the parties' signatures appear on SEPARATE PAGES (one party signs page N, another party signs page N+1, or hybrid wet-ink + DocuSign), the document is FULLY EXECUTED. Do NOT flag a counterpart signature block as 'blank' just because one party's signature is not on the same page as another party's. Before generating any execution finding about a multi-page signature document, check ALL pages of the document. If every required party has signed somewhere — including DocuSign indicators, wet-ink signatures on separate counterpart pages, or signatures on a clean execution page following the body — the document is executed. Specifically applies to multi-party Tri-Party Agreements, Subleases (Sublandlord on one page + Subtenant on next), and any document where the body explicitly states it may be executed in counterparts.",
    rationale: "TP2 session 2026-05-18 Test #4: 7 of 11 Duff & Phelps rejections were counterpart-execution false positives. Agreement of Lease 2018 (Landlord page 126, Tenant page 127), Sublease 4/5/2024 (Sublandlord page 33 wet ink + Subtenant page 34 DocuSign), Tri-Party Agreement 9/1/2023 (4 signatories on pages 12-14), Second/Third/First Amendments — all counterpart-signed. Reviewer consistently: 'Document is fully executed.'"
  },
  {
    id: 'learning-1778544000002-ex074', source: 'tp2-review-2026-05-18', active: true,
    checkType: 'EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-05-18T12:00:00.000Z',
    suggestion: "STOCKBRIDGE / NORTHWOOD PLAZA LANDLORD TEMPLATE — EXHIBIT LETTER MAP: In leases by 'Stockbridge Myrtle Beach, LLC' or any Northwood Plaza-affiliated landlord, the exhibit-letter to content map is: Exhibit A = Site Plan, Exhibit B = Legal Description, Exhibit C = Work Letter / TI Allowance, Exhibit D = SIGN CRITERIA (not Guaranty), Exhibit E = Rules and Regulations, Exhibit F = GUARANTY OF LEASE, Exhibit G = Authorization Agreement for Preauthorized Payments. Do NOT assume Exhibit D is a Guaranty. Do NOT label Exhibit D as 'Rent Commencement Date Agreement' — that's a separate document, not an exhibit-letter assignment. Read the lease's exhibit index carefully. If the index shows 'Exhibit D: Sign Criteria' and 'Exhibit F: Guaranty of Lease', use those labels in any finding.",
    rationale: "TP2 session 2026-05-18: 3 rejections from this same mislabeling. Pigtails & Crewcuts (flagged Guaranty as 'Exhibit D' twice — reviewer: 'Guaranty is Exh F and it's executed. Exh D is Sign Criteria and it's present'), Bank of America (flagged 'Exhibit D — Rent Commencement Date Agreement' — reviewer: 'Exhibit D is Sign Criteria and is present')."
  },
  {
    id: 'learning-1778544000003-md075', source: 'tp2-review-2026-05-18', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-18T12:00:00.000Z',
    suggestion: "'CONFIRMED EFFECTIVE DATE' IS NOT A MISSING-DOCUMENT CATEGORY: When an amendment's body has a blank effective date (e.g., 'made as of ____, 2023') but the document is signed and a later amendment confirms the date, or a handwritten date appears on the signature page, the date is established. This is NOT a Missing Document. Do NOT generate findings titled 'Confirmed effective date of X' or 'Missing effective date' or any variant where the deliverable is just confirmation of a date. The reviewer needs concrete missing items (documents, signatures, exhibits) — not requests to confirm dates that are already confirmable from the document itself or from later amendments.",
    rationale: "TP2 session 2026-05-18 Test #4: Evercore Fourth Amendment had blank effective date in body but handwritten 'April 3' on sig page, plus Fifth Amendment confirmed 'April 3, 2023.' AI flagged 'Confirmed effective date' as Missing Document. Reviewer: 'There isn't anything missing on this document. There is a date and it's fully executed. We don't note anything about confirmed effective date for initial Missing Documents.'"
  },
  {
    id: 'learning-1778544000004-ex076', source: 'tp2-review-2026-05-18', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-18T12:00:00.000Z',
    suggestion: "TWO INDIVIDUALS SIGNING IN ONE 'BY:' BLOCK = FULL EXECUTION: When a tenant signature block has 'By:' followed by multiple handwritten signatures (e.g., two officers of a corporation, two co-owners, a husband-and-wife duo signing as guarantors who are also corporate officers), this is FULL EXECUTION. Do NOT flag because 'Its:' or 'Title:' is blank, or because the relationship between the two signatures is unclear. If signatures are present in the By: area for the required party, the entity is bound. Do NOT speculate about whether the signers had authority — that's outside review scope. Similarly: a GUARANTOR label followed by no separate signature lines, where the named guarantors' signatures appear in the immediately preceding Tenant block, also counts as guaranty execution — the guarantors signed.",
    rationale: "TP2 session 2026-05-18 Test #1: Mirage Hair Amendment No. 1 flagged twice (because tenant was processed twice — separate bug). Tenant block had two signatures (Kelli Philo and Jeremy Philo) with 'Its:' blank. AI questioned whether two-officer signing was valid. Also flagged Guarantor block label with no separate sig line. Reviewer for both: 'The document is fully executed.'"
  },
  {
    id: 'learning-1778544000005-oos077', source: 'tp2-review-2026-05-18', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-18T12:00:00.000Z',
    suggestion: "MEMORANDUM OF LEASE IS UNCONDITIONALLY OUT OF SCOPE: Memoranda of Lease (whether titled 'Memorandum of Lease', 'Short Form Lease', 'Notice of Lease', or any variant) are NEVER abstracted. Do NOT flag any of the following: (a) Memorandum of Lease missing from folder; (b) Memorandum of Lease unsigned or with blank tenant signature; (c) Memorandum of Lease execution defect of ANY kind; (d) Memorandum of Lease not recorded; (e) discrepancy between an Exhibit-E template version of a Memorandum and the standalone executed Memorandum. This applies even when the lease body explicitly references the Memorandum, even when an Exhibit shows the Memorandum template, even when a standalone executed Memorandum is in the folder. Memoranda are out-of-scope. Strengthens learning-1778205600003-oos063.",
    rationale: "TP2 session 2026-05-18: Bank of America Memorandum of Lease tenant signature flagged — AI itself said 'Memoranda of Lease are not operative... completely out of scope for execution review... should be suppressed per Learning 53. Flagging for training transparency only.' Reviewer: 'Memorandum Lease is not used in abstracting.' Despite oos063, model still flagged."
  },
  {
    id: 'learning-1778544000006-dup078', source: 'tp2-review-2026-05-18', active: true,
    checkType: 'GUARANTY', confidence: 'HIGH',
    createdAt: '2026-05-18T12:00:00.000Z',
    suggestion: "ONE GAP = ONE FINDING (DEDUPLICATE BEFORE OUTPUT): When the same underlying document gap is detectable through multiple check types, emit ONE consolidated finding — NOT multiple. Specifically: if a missing Guaranty would also satisfy a Missing Exhibit finding (e.g., 'Exhibit F Guaranty of Lease' is missing AND a standalone executed Guaranty is missing — same gap), generate a single GUARANTY finding citing both the exhibit reference and the standalone requirement. Do NOT generate one MISSING_EXHIBIT finding + one GUARANTY finding for the same gap. Before output, scan your own findings: any pair of findings where (a) the missing document is the same instrument and (b) the evidence cites the same lease section → MERGE into the most-specific category (GUARANTY > MISSING_EXHIBIT > MISSING_DOCUMENT).",
    rationale: "TP2 session 2026-05-18: Pho Tastic had Exhibit F Guaranty missing flagged TWICE — once as Missing Exhibit, once as Guaranty. Reviewer: '◐ Partial: This is missing, but it was already noted. We don't need it noted twice.' Same gap = same finding."
  },

  // ── TP2 session 2026-05-19: Lauren's 32-rejection regression review ──
  {
    id: 'learning-1778803200001-ex079', source: 'tp2-review-2026-05-19', active: true,
    checkType: 'EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-05-19T12:00:00.000Z',
    suggestion: "EXHIBIT HEADING PAGE PRESENT = SUFFICIENT FOR INITIAL REVIEW: When an exhibit has a heading page in the document (e.g., a page with 'EXHIBIT F-1 — SIGNAGE' as the title, or 'EXHIBIT A — EXPANSION SPACE'), even if the page contains only the heading + a brief description (no full diagram, no detailed text body), that is SUFFICIENT for Missing Documents review purposes. Do NOT flag it as 'Exhibit X — incomplete' or 'heading present but content missing.' For initial Missing Documents review, the test is: does the exhibit APPEAR in the document? If yes (a heading page exists), it is present. The reviewer is checking that the deal package is complete, not that every exhibit's body content is verbose. Substantive diagram-level completeness is a downstream review step, not Missing Documents scope.",
    rationale: "TP2 session 2026-05-19: 5 rejections across 4 tenants (MedStar Exhibit F-1 Signage, StudyPro Exhibit A Expansion Space x2, McLean Neuropsychiatric Exhibit A, Norton Scott Exhibit G Janitorial). Reviewer consistently: 'We have a page for Exhibit X. Based off the language in the document that's sufficient.' AI was inferring missing content from text-body references when a heading page existed."
  },
  {
    id: 'learning-1778803200002-ex080', source: 'tp2-review-2026-05-19', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-05-19T12:00:00.000Z',
    suggestion: "DO NOT ANALYZE SIGNATURE SHAPE OR HANDWRITING — ONLY WHETHER A MARK IS PRESENT: When a signature block has a visible mark in the 'By:' line — whether it's a normal handwritten signature, initials, a stylized scrawl, an 'X-pattern' mark, a printed name with handwriting overlay, a DocuSign indicator, or any visible ink — the document IS executed. Do NOT question the SHAPE of the mark. Do NOT speculate whether 'this looking/crossing pattern could be a stylized signature or could be a cancellation mark.' Do NOT request 'human verification of signature legitimacy.' The reviewer rule is: 'Just make sure it's present. The document is fully executed.' Signature authenticity / handwriting analysis is outside review scope. If a By: line has any visible mark, generate NO execution finding for that party.",
    rationale: "TP2 session 2026-05-19: 3 rejections — LabCorp (DocuSign with blank Name + entity-name typo), Georgetown Psychology ('X-pattern' Landlord mark), Luxe Sculpt (stylized Landlord mark). Reviewer: 'We don't really need to analyze the signature. Just make sure it's present.'"
  },
  {
    id: 'learning-1778803200003-curr081', source: 'tp2-review-2026-05-19', active: true,
    checkType: 'CURRENCY', confidence: 'HIGH',
    createdAt: '2026-05-19T12:00:00.000Z',
    suggestion: "CHECK ALL AMENDMENTS AND SUPPLEMENTS FOR TERM EXTENSIONS BEFORE FLAGGING EXPIRED LEASE: Before generating any 'Document extending Term beyond [date]' / 'lease expired' finding, scan EVERY amendment AND every supplement (Lease Supplement, Amendment, Renewal, Extension, Option Exercise) in the folder for a controlling expiration date. The most recent supplemental document with an expiration date is authoritative — NOT the original lease's expiration. If a Lease Supplement or any amendment in the folder establishes a new expiration date that is in the future, the lease is CURRENT and no finding should be generated. Specifically: do NOT flag a lease as expired based on the original lease's expiration when a Supplement, Amendment, or Option Exercise letter in the folder establishes a later expiration.",
    rationale: "TP2 session 2026-05-19: Evexia flagged 'Document extending Term beyond June 30, 2025' — reviewer: 'Lease Commencement document has expiration date of 11/30/2032.' AND 'Leases' tenant flagged term ending 12/31/2024 — reviewer: 'The Lease Supplement says the Term ends on 6/30/2039.' Model only checked the original lease, missed the supplement/commencement extension."
  },
  {
    id: 'learning-1778803200004-md082', source: 'tp2-review-2026-05-19', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-05-19T12:00:00.000Z',
    suggestion: "DO NOT CHECK SUITE NUMBERS INSIDE EXHIBIT DIAGRAMS: Exhibit floor plans, site plans, and architectural drawings often display a Suite number that differs from the Suite Number in the lease's Basic Lease Terms (e.g., diagram labeled 'SUITE 100' but lease says 'Suite 130'). This is NOT a discrepancy worth flagging. Diagrams are pulled from the landlord's master plan files and may show neighboring suites or pre-renovation numbering. Do NOT generate findings about Suite-number mismatches between exhibit diagrams and the lease body. We do not check Suite numbers in Exhibits for Missing Documents review.",
    rationale: "TP2 session 2026-05-19: LabCorp Exhibit A floor plan labeled 'SUITE 100' but lease body says 'Suite 130'. Reviewer: 'This is ok. We are not checking the Suite numbers in Exhibits for missing docs.'"
  },
  // ════════════════════════════════════════════════════════════════════════
  // Blind self-learner loop rules (2026-06-16) — added after 21-tenant
  // double-blind test with iterative playbook patching. Each rule traces
  // to a specific blind-loop miss; rationale cites the failing tenant.
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'learning-1782000000001-blind08', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "PARTIAL EXHIBIT SUB-PAGE CHECK: When an exhibit spans multiple sub-pages (e.g., E-1, E-2, E-3 or F-1, F-2, F-3), explicitly verify each sub-page is present by reading bottom-right page labels in order. If E-2 appears but no E-1 exists in the file, OR F-3 (signature page) appears but no F-1/F-2 (body), generate a MISSING_DOCUMENT finding EVEN THOUGH the exhibit letter technically appears in the file. Match reviewer wording: 'First page of Exh [Letter] to Lease dated [date]' for a missing first page, or 'Full copy of [Exhibit Name] to Lease dated [date]' when only the signature page remains. When walking exhibit pages, list the sub-page labels you observe in order — any gap in the sub-numbering is a finding.",
    rationale: "Blind-loop test 2026-06-16: Pho Tastic emitted 1 finding (Exh F missing) when 2 expected. PDF jumped from D-3 to E-2 directly, skipping E-1. Sol Palms similarly required this rule to catch 'only signature page received' for partial Guaranty."
  },
  {
    id: 'learning-1782000000002-blind09', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "PRESUME ORIGINAL-LEASE EXECUTION FOR OPERATING TENANTS: When the rent roll's Begin date corresponds to the lease's term commencement (tenant is actively paying rent and operating), the original main lease's LANDLORD or TENANT signature on the main body signature page is PRESUMED — do not flag a blank By: line as an EXECUTION finding for an old original lease where the tenant has been in possession for years. The signature is assumed to exist via a separately-stored counterpart held in a different file. EXCEPTION (always check): Guaranty / Letter Agreement / Amendment / Rent Commencement Date Agreement / Substitute Guaranty / Release of Guaranty execution is ALWAYS checked. This rule applies ONLY to the original main-lease Landlord/Tenant signature blocks on a lease whose Term has already commenced per the rent roll.",
    rationale: "Blind-loop test 2026-06-16: Pigtails & Crewcuts FP — agent flagged original 2018 Lease Landlord By: line blank on p40, but tenant has been operating since 2018-01-16 per rent roll. Reviewer doesn't flag old original-lease Landlord signature on operating tenants; counterpart sig presumed elsewhere."
  },
  {
    id: 'learning-1782000000003-blind10', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "CHAIN GAP, NOT JUST CHAIN-END MISMATCH: When checking LEASE_CURRENCY, walk the amendment chain CHRONOLOGICALLY and flag INTERNAL gaps, not only the chain-endpoint vs rent-roll-end. If Document N expires on date X but Document N+1 commences on date Y > X, the period [X, Y] is uncovered. Flag as 'Document extending Term from original End Date (calculated as [X]) to [Y]' using the reviewer's wording pattern. This is a separate finding even when the LAST document's end date matches the rent roll end. Specifically: when the folder contains Original Lease + Amendment N (skipping intermediate amendments) and Amendment N's 'commencing' date is materially after the Original Lease's computed expiration, flag the gap.",
    rationale: "Blind-loop test 2026-06-16: Mirage Hair FN — agent saw Amendment 1's end (10/31/2028) matched rent roll end and called it clean, missing the 3-year-9-month gap between Original Lease's computed end (1/31/2020) and Amendment 1's start (11/1/2023). Reviewer wording: 'Document extending Term from original End Date (calculated as 1/31/20) to 10/31/23'."
  },
  {
    id: 'learning-1782000000004-blind11', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "DO NOT DOUBLE-COUNT — EXECUTION FINDING ON UNSIGNED AMENDMENT CAPTURES THE GAP: When EXECUTION findings on unsigned numbered amendments capture the chain-bridging defect (e.g., 'Amendment No. 3 dated [date] is not executed'), do NOT additionally add a LEASE_CURRENCY finding for the same period. The EXECUTION finding IS the gap-bridging issue — adding LEASE_CURRENCY is double-counting at a different abstraction level. Similarly, do NOT add LEASE_CURRENCY when the chain-end gap is less than 6 months from the rent-roll End — this is typically holdover or extension-in-progress. Use LEASE_CURRENCY ONLY when (a) no later amendment exists at all, OR (b) chain endpoint is materially short (>6 months) of the rent roll End AND no EXECUTION finding on a candidate bridging amendment is already present.",
    rationale: "Blind-loop test 2026-06-16: Monterey Bay Homes FP — agent flagged 2 EXECUTION (Amendment 3 + Amendment 4 unsigned) AND added a 3rd LEASE_CURRENCY for chain ending 12/31/2026 vs rent roll 3/31/2027 (3-month gap). Reviewer only tracks the 2 EXECUTION findings; the unsigned amendments ARE the gap-bridging defect."
  },
  {
    id: 'learning-1782000000005-blind12', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "MULTI-PARTY AGREEMENTS BELONG IN THIRD PARTY'S FOLDER: When a tenant's lease references a multi-party / tri-party agreement involving a THIRD party beyond Landlord and Tenant (e.g., Consent to Sublease among LL/Tenant/Subtenant, Tri-Party Letter Agreement among LL/Tenant/another Landlord, Sub-Sublease Consent), the document PRIMARILY belongs in the THIRD party's file system, NOT the primary tenant's review folder. Do NOT flag as MISSING when (a) the primary tenant is not the obligated party most likely to retain it, AND (b) the agreement does not directly modify the primary tenant's substantive rights/obligations under the lease. EXCEPTION: if the agreement directly modifies/limits the primary tenant's own rights (e.g., a Consent imposing new tenant obligations like profit-sharing or additional rent), DO flag it.",
    rationale: "Blind-loop test 2026-06-16: General Atlantic FP (Consent for Duff sublease belongs in Duff folder, not GA); Morgan Stanley FP (Tri-Party with 49E52 Landlord belongs in that landlord's folder). Duff & Phelps's Consent IS flagged because Third Amendment Article 4 imposes 50% Sublease Profit on Tenant — exception applies."
  },
  {
    id: 'learning-1782000000006-blind13', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "COUNTERPART SIGNATURE PAGES — SEARCH NEIGHBORING PAGES BEFORE FLAGGING: When a signature page shows ONE party signed (Landlord or Tenant) and the OTHER party's By: line is blank, this is OFTEN counterpart execution: each party signs their own page. BEFORE flagging an EXECUTION finding, search the ±3 PDF pages around the signature page for another `IN WITNESS WHEREOF` page bearing the OPPOSITE party's signature. Two complementary counterpart pages together = full execution. Sophisticated NYC commercial leases (Park Avenue Plaza, Stockbridge, Brixmor portfolios) commonly use back-to-back counterpart pages — one with Landlord signature only, one with Tenant signature only. Only flag EXECUTION when, after searching both directions, you can confirm NO counterpart signature page exists anywhere in the document.",
    rationale: "Blind-loop test 2026-06-16: Evercore Fifth Supplemental FP — agent flagged Tenant block blank on p14, but p13 had the Tenant + Guarantor counterpart signature page (Elizabeth Stevenson signed for Evercore Partners + Evercore L.P.). Standard NYC counterpart execution pattern."
  },
  {
    id: 'learning-1782000000007-blind14', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "SUB-SUBLEASE ARRANGEMENTS ARE OUT OF SCOPE FOR PRIMARY LEASE REVIEW: When a tenant's amendments reference an underlying sub-sublease, sub-sublease consent, or sub-sub-related agreement involving a different sub-sublessee, these are OUT OF SCOPE for the primary lease review. Do NOT flag them as MISSING_DOCUMENT even if substantively referenced in a recital. The reviewer's scope is the primary lease + its amendments + its Guaranty — not downstream sub-sub-leasing arrangements.",
    rationale: "Blind-loop test 2026-06-16: Evercore FP — agent flagged Court Square Sub-Sublease Consent and underlying Court Square Sub-Sublease. Both involve a different sub-sublessee (Court Square Capital Management) for a different floor. Reviewer doesn't track sub-sublease relationships in the primary lease folder."
  },
  {
    id: 'learning-1782000000008-blind15', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "ASSIGNMENT OF LEASE CHANGING TENANT IDENTITY IS NOT A FINDING: When a lease has been assigned to a successor entity (e.g., parent → subsidiary, original tenant → assignee), this Assignment of Lease is operationally tracked but is NOT a missing-document finding. Treat the current tenant on the rent roll as the operating party regardless of prior assignment. Do NOT flag an 'Assignment of Lease' or 'Assignment and Assumption of Lease' as missing unless specifically required by the cheat sheet pattern.",
    rationale: "Blind-loop test 2026-06-16: Morgan Stanley FP — agent flagged the 2009 Assignment from MSCO to Morgan Stanley Smith Barney Financing LLC as missing. Reviewer doesn't track tenant-identity assignments — the current rent-roll tenant is the operating party."
  },
  {
    id: 'learning-1782000000009-blind16', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "PREMISES-DESCRIPTION MISMATCH WITH RENT ROLL SUITE IS A FINDING: When the rent roll's Suite designation includes a premises identifier NOT described in any document in the folder (e.g., rent roll says 'BSMT/1600-1700' implying basement + floors 16-17, but lease documents only describe 16th and 17th floors with no basement reference anywhere), this IS a finding. Frame as 'Document reflecting Premises of [missing portion], as reflected on Rent Roll' — MISSING_DOCUMENT severity HIGH. The rent roll is authoritative; if documents don't describe everything the rent roll lists, a document is missing.",
    rationale: "Blind-loop test 2026-06-16: Duff & Phelps required this rule — rent roll suite 'BSMT/1600-1700' implies basement premises, but no lease document describes any basement portion. Reviewer flagged 'Document reflecting Premises of Part Basement, as reflected on Rent Roll'."
  },
  {
    id: 'learning-1782000000010-blindsnda', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'SPECIAL_AGREEMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "STRICT NO-EXCEPTIONS FOR SNDA / NON-DISTURBANCE CLASS DOCUMENTS (extends Learning 9): SNDA, Subordination Agreement, Non-Disturbance Agreement (NDA), Landlord's Non-Disturbance Agreement, Recognition Agreement, Subordination Non-Disturbance and Attornment Agreement, Tri-Party Non-Disturbance, or anything similarly named are NEVER findings — missing, present, executed, unexecuted, all fine. This applies EVEN WHEN the agreement is explicitly referenced by name in a recital or section of another document as 'that certain [X] dated [date]'. If the document name contains 'non-disturbance' / 'subordination' / 'attornment' / 'SNDA' / 'recognition', drop the finding on sight. Learning 9 only covered pure 'SNDA' label — this strengthens it to all variant names.",
    rationale: "Blind-loop test 2026-06-16: Duff & Phelps FP — agent flagged the Landlord's Non-Disturbance Agreement among LL/Tenant/GA referenced in Third Amendment Section 4.2 as MISSING_DOCUMENT. Existing Learning 9 (sn009) was insufficiently explicit for Non-Disturbance variants beyond pure SNDA wording."
  },
  {
    id: 'learning-1782000000011-blindoos', source: 'blind-loop-2026-06-16', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-16T12:00:00.000Z',
    suggestion: "EXTENDED OUT-OF-SCOPE LIST (extends Learning 10): In addition to COIs, HVAC contracts, pest control, business licenses, building permits, and broker commission agreements, the following are also NEVER findings: Authorization Agreement for Preauthorized Payments / ACH Authorization / payment-method authorization form (often appearing as Exhibit G on Stockbridge Northwood Plaza shopping center leases), Tenant Trade Name Confirmation, W-9 forms, COI insurance certificates exhibit attachments. These are administrative payment-setup / informational forms, not substantive lease documents. Drop on sight even when listed in the TOC and the page is absent from the file.",
    rationale: "Blind-loop test 2026-06-16: Sol Palms MedSpa FP — agent flagged Exhibit G (Authorization Agreement for Preauthorized Payments) as MISSING_EXHIBIT. Existing Learning 10 (oos010) listed standard out-of-scope docs but not payment-authorization forms; this rule patches that gap."
  },
  // ════════════════════════════════════════════════════════════════════════
  // Blind self-learner loop RUN 2 (2026-06-17) — re-ran the same dataset
  // and surfaced two edge cases the round-1 playbook didn't cover.
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'learning-1782086400001-blind08refined', source: 'blind-loop-2026-06-17', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-06-17T12:00:00.000Z',
    suggestion: "PARTIAL EXHIBIT SUB-PAGE CHECK — REFINED (extends Learning blind08): When checking whether an exhibit is partially missing by sub-page number, distinguish two cases. (a) REAL DEFECT — flag: the lowest-numbered sub-page present is a SIGNATURE PAGE ONLY (no exhibit title header, no body recitals, no operative paragraphs — just 'IN WITNESS WHEREOF' + signature blocks). The body of the exhibit is genuinely missing. Frame as 'Full copy of [Exhibit Name] to Lease dated [date]'. (b) TEMPLATE QUIRK — do NOT flag: the lowest-numbered sub-page present contains the exhibit's TITLE HEADER plus substantive BODY CONTENT (recitals, definitions, operative paragraphs). Different Stockbridge/Brixmor/Park Avenue Plaza templates use different sub-numbering schemes — some Guaranty exhibits literally start at F-3 with the full title page + body. Do NOT flag F-1/F-2 missing in this case. Decision rule: look at the FIRST page of the exhibit you find. Title heading + body content present? → template quirk, do not flag. Only signatures, no header/body? → body is missing, flag.",
    rationale: "Blind-loop run-2 2026-06-17: Thai E-San FP — agent flagged 'F-1 and F-2 of Guaranty missing' but the Guaranty's first content page is genuinely F-3 (template quirk) with full title + recitals + paragraphs 1-2 + signature on F-6. Reviewer treats this as complete. Patches the original blind08 rule which was too aggressive on numerical gap alone."
  },
  {
    id: 'learning-1782086400002-blind17', source: 'blind-loop-2026-06-17', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-06-17T12:00:00.000Z',
    suggestion: "AMENDMENT SUB-EXHIBITS DESCRIBING DIAGRAMS / DEPICTIONS — DO NOT flag: When an amendment's body section references a sub-exhibit that is a diagram, depiction, or floor-plan-style visual (e.g., 'Exhibit A attached hereto depicting the additional parking spaces', 'Exhibit B showing the new floor plan'), and that diagram is not physically attached to the amendment's PDF, do NOT generate a MISSING_EXHIBIT finding. Diagrammatic / depiction sub-exhibits to amendments are routinely tracked operationally rather than as missing documents. EXCEPTIONS: (a) the sub-exhibit is a Guaranty form (still flag per F-NONSIG-EXHIBITS / Learning 15), or (b) the diagram contains the only description of premises the rent roll requires — in that case L16 fires for the underlying premises description, not for the diagram itself.",
    rationale: "Blind-loop run-2 2026-06-17: Liberty Steakhouse FP — agent flagged 'Exhibit A to Second Amendment missing' (parking-space diagram referenced but not attached). Reviewer doesn't track amendment diagrams as missing documents."
  },
  // ════════════════════════════════════════════════════════════════════════
  // Village West + Project Dijon lawyer-test rules (2026-07-21)
  // Extracted from lawyer's actual target-practice sessions on
  // Village West.zip (Test 7.20) and Project Dijon.zip (Test 7.21).
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'learning-1782950400001-blind18', source: 'lawyer-test-2026-07-21', active: true,
    checkType: 'EXECUTION', confidence: 'HIGH',
    createdAt: '2026-07-21T12:00:00.000Z',
    suggestion: "SCHEDULE / RATIFICATION / REAFFIRMATION / ATTACHMENT TO AMENDMENTS — MANDATORY COUNTERPART SEARCH BEFORE FLAGGING: When a Schedule, Ratification and Reaffirmation of Guarantee, Consent, or Attachment inside an Amendment PDF appears unsigned, you MUST apply the same ±3-page counterpart-page search from Learning 13 BEFORE emitting an EXECUTION finding. Ratifications and Schedules are commonly signed on the page IMMEDIATELY AFTER the schedule form, on a separate counterpart page, or by the Guarantor whose signature appears a few pages later in the same PDF. Scan every page of the entire Amendment PDF for the party's signature before concluding it's missing. Common pattern: a Ratification signature by the Guarantor appears on the same PDF but on a page labeled differently (e.g., 'Guarantor Ratification page' vs 'Schedule 1'). If ANY page in the same Amendment PDF has the required party's counterpart signature, do NOT flag EXECUTION.",
    rationale: "Lawyer test 2026-07-20 Village West: Check into Cash — model flagged 'Ratification and Reaffirmation of Guarantee (Schedule 1 to Sixth Amendment) not executed' as HIGH, AND same finding for Seventh Amendment. Reviewer: 'Document is fully executed'. Same pattern for Jack in the Box's Consent to Assignment (May 2021). Learning 13 wasn't strong enough for schedule/ratification attachments to amendments."
  },
  {
    id: 'learning-1782950400002-blind19', source: 'lawyer-test-2026-07-21', active: true,
    checkType: 'MISSING_EXHIBIT', confidence: 'HIGH',
    createdAt: '2026-07-21T12:00:00.000Z',
    suggestion: "VERIFY WHAT AN EXHIBIT ACTUALLY IS BEFORE FLAGGING IT MISSING: Do NOT rely on lease conventions or TOC labels alone to conclude that a specific exhibit 'is a Guaranty' or 'is missing.' Before generating any MISSING_EXHIBIT / MISSING_DOCUMENT finding about a specific exhibit (e.g., 'Exhibit F Guaranty'), READ the actual pages under that exhibit letter and match the CONTENT to the finding's asserted document type. If Exhibit F is actually 'Tenant's Initial Signs' or 'Sign Criteria' or any other operational exhibit (not a Guaranty), the finding 'Exhibit F (Guaranty) is missing' is a MISIDENTIFICATION — do NOT emit it. If the TOC and actual content disagree, note the discrepancy and do NOT emit as a missing-document finding.",
    rationale: "Lawyer test 2026-07-20 Village West: America's Best FP — model flagged 'Exhibit F (Guaranty of Lease) to Lease dated July 24, 2023' as missing. Reviewer: 'Exhibit F is Tenant's Initial Signs. I don't see anything about a Guaranty. It's [something else].' Model assumed Exhibit F = Guaranty per convention without reading the actual exhibit content."
  },
  {
    id: 'learning-1782950400003-blind20', source: 'lawyer-test-2026-07-21', active: true,
    checkType: 'SPECIAL_AGREEMENT', confidence: 'HIGH',
    createdAt: '2026-07-21T12:00:00.000Z',
    suggestion: "SIGNAGE PACKAGES / SIGN CRITERIA PACKAGES ARE OPERATIONAL — NEVER flag as Special Agreement or missing: Standalone documents titled 'Signage Package', 'Sign Criteria Package', 'Signage Guidelines', 'Sign Rules', 'Signage Guidelines and Standards' attached to a lease or in a tenant folder are operational reference materials — NOT Special Agreements, NOT missing findings. They are akin to Rules and Regulations exhibits and administrative in nature. Do NOT flag their presence as a Special Agreement finding of any severity. Do NOT flag their absence as a missing document. If the reviewer needs sign-related documents flagged, they'll want a 'Sign Agreement' (a formal signed agreement about signage) — not the operational signage package.",
    rationale: "Lawyer test 2026-07-20 Village West: America's Best FP — model flagged standalone 'Signage Package.pdf' as a LOW-severity Special Agreement finding. Reviewer: 'A Signage Package wouldn't be a special agreement. It would either be a Sign Agreement.' Model over-classified an operational document."
  },
  {
    id: 'learning-1782950400004-blind21', source: 'lawyer-test-2026-07-21', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-07-21T12:00:00.000Z',
    suggestion: "VERIFY AMENDMENT / REFERENCED-DOCUMENT DATES AGAINST FILENAMES AND INTERNAL CONTENT: When later amendments' recitals identify a prior amendment / letter agreement BY DATE (e.g., 'as amended by First Amendment dated 3/3/2010'), verify that the date in the recital matches the actual date of the file named as that document. If a file exists named '1st Amendment' but its internal date is 4/30/2013 (different from the 3/3/2010 recital date), the file in the folder is a DIFFERENT document — the referenced-by-date prior amendment IS STILL MISSING. Flag as MISSING_DOCUMENT with the reviewer's wording: 'First Amendment dated [recital date]'. The date on the recital is authoritative; the date on the filename is not.",
    rationale: "Lawyer test 2026-07-20 Village West: iTan — reviewer flagged 'We are missing the First Amendment dated 3/3/2010'. Later amendments referenced that date but the '1st Amendment' file in the folder was internally dated 4/30/2013 (a different amendment). Model didn't catch the date-mismatch and didn't flag the referenced amendment as missing."
  },
  {
    id: 'learning-1782950400005-blind22', source: 'lawyer-test-2026-07-21', active: true,
    checkType: 'GENERAL', confidence: 'HIGH',
    createdAt: '2026-07-21T12:00:00.000Z',
    suggestion: "WRAPPER SUBFOLDERS LIKE 'Prior Lease' / 'Abstracts' / 'Archive' — INCLUDE their files as tenant material, do NOT treat as sub-tenants: When walking a tenant folder that contains subfolders labeled 'Prior Lease', 'Abstracts', 'Archive', 'Old', 'Historical', 'Superseded', or similar historical/reference designations, INCLUDE the files inside those subfolders as part of the tenant's file inventory. These subfolders contain reference or historical material relevant to the current lease analysis. Do NOT treat them as separate sub-tenants. Do NOT trigger the '_single_tenant_' upload fallback because a subfolder is present. The main operative lease is typically at the top level of the folder; the subfolder provides historical context (like the immediately-prior expired lease, terminated lease notice, or lease abstract).",
    rationale: "Lawyer test 2026-07-20 Village West: America's Best has a 'Prior Lease' subfolder containing the terminated January 2018 lease + First Amendment + Termination Notice — reference material for the current July 2023 lease. Also matches the Amazon (400 River) 'Abstracts' subfolder pattern that caused upload mis-bucketing earlier. Model should treat these subfolder files as tenant material without triggering wrapper detection."
  },
  {
    id: 'learning-1785801600001-blind23', source: 'lawyer-test-2026-08-03', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-08-04T12:00:00.000Z',
    suggestion: "A SUBLEASE NAMED BY AN IN-FOLDER CONSENT TO SUBLEASE IS A REQUIRED FINDING WHEN ABSENT: The multi-party-agreement suppression rule (a Consent to Sublease / Consent to Assignment belongs in the third party's file) stops at the CONSENT itself. The underlying Sublease is a TWO-PARTY document (Tenant as sublessor and Subtenant) and the Landlord affirmatively holds a copy, because Consent agreements almost always make Landlord's receipt of a fully-executed Sublease a condition precedent. RULE: whenever a Consent to Sublease or Consent to Assignment is physically present in the folder, the Sublease / Assignment it consents to MUST also be present. If absent, flag MISSING_DOCUMENT. Recover the Sublease date from anywhere it is stated — the Consent's recitals, a later lease's recitals, or an amendment — even when the Consent itself leaves it undated; if no date is recoverable anywhere, still flag it and write the date as 'dated xx/xx/xx'. DO NOT suppress on any of these grounds, all of which are wrong: that the document is 'subtenant-side'; that the Consent states it does not amend the Lease; that there is no profit-sharing obligation; or that the folder's tenant is the sublessor rather than the sublessee. The direction of the sublease is irrelevant. COROLLARY: a Consent that is itself referenced by date but absent is ALSO a valid finding — the suppression rule only means you should not hunt for a multi-party agreement that nothing in the folder references.",
    rationale: "Lawyer test 2026-08-03: reviewer's own Missing.xlsx requires the Sublease for US Live, for Mayer (Blue Tide) ('Sublease Agreement dated 9/30/22'), and for Amberjack ('Sublease Agreement dated 12/6/24' AND 'Consent to Sublease dated 12/20/24'). In blind loop 1 the Mayer and Amberjack agents caught the Sublease but the US Live agent dropped it citing the multi-party rule — same fact pattern, inconsistent outcome. Production's 8/3 run also caught Amberjack's Consent but missed the Sublease itself."
  },
  {
    id: 'learning-1785801600002-blind24', source: 'lawyer-test-2026-08-03', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-08-04T12:00:00.000Z',
    suggestion: "A LONG UNCOVERED GAP IN THE TERM CHAIN IS ITS OWN FINDING, EVEN ALONGSIDE MISSING-DOCUMENT FINDINGS: The anti-double-counting rule (do not add LEASE_CURRENCY when an EXECUTION defect on an unsigned amendment already IS the gap) is narrow and does NOT apply when the chain has a genuine multi-year hole covered by no document of any kind. RULE: walk the chain chronologically; if Document N's term ends on X and the next document's term begins on Y, and the period [X, Y] exceeds 6 months, emit a LEASE_CURRENCY finding worded 'Document extending Term from [X] to [Y minus 1 day]' IN ADDITION TO any MISSING_DOCUMENT findings naming the specific instruments believed to belong in that hole. The reviewer wants both: the missing-instrument findings name what can be identified, and the chain-gap finding states the period that is unaccounted for. Naming a missing First Amendment does NOT discharge the obligation to report the uncovered period.",
    rationale: "Lawyer test 2026-08-03 Amberjack: the Prime Lease runs to ~4/30/2024 and the Short Term Lease begins 6/1/2026, a 762-day hole. The reviewer's list contains 'Document extending Term from 5/1/24-5/31/26' as a separate confirmed finding sitting alongside the missing First Amendment and the missing Sublease. In blind loop 1 the agent explicitly folded the gap into those two findings and dropped it — a recall miss."
  },
  {
    id: 'learning-1785801600003-blind25', source: 'lawyer-test-2026-08-03', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-08-04T12:00:00.000Z',
    suggestion: "A REFERENCED DOCUMENT THAT THE REFERENCING TEXT SAYS HAS TERMINATED OR EXPIRED IS NEVER MISSING: Before flagging any referenced instrument as a missing document, read the sentence that references it. Lease and amendment recitals routinely name prior agreements for the express purpose of RETIRING them. If the referencing text states the instrument terminates, expires, is superseded, is of no further force and effect, or has been replaced, then its absence from the folder is intentional and correct — DO NOT flag it. Trigger phrases to check for in the referencing sentence: 'terminates pursuant to its terms', 'shall be of no further force or effect', 'is hereby terminated', 'expired by its terms', 'is superseded and replaced by', 'shall automatically terminate upon'. This is the reference-side companion to the superseded-documents filter: that filter drops superseded documents after the fact, this rule stops the finding from ever being drafted.",
    rationale: "Blind loop 1 regression 2026-08-04, Bank of Houston: the agent flagged 'Temporary Lease Agreement dated 5/9/2018' as MISSING_DOCUMENT. Rider No. 4 Section E of the lease reads '...the term of that certain Temporary Lease Agreement dated May 9, 2018 between Landlord and Tenant ... terminates pursuant to its terms as of the commencement of Tenant's lease of the Temporary Premises.' The document is named and dated, which makes it look like a textbook referenced-document hit, but the clause exists to extinguish it. This was the only new false positive introduced in loop 1."
  },
  {
    id: 'learning-1785801600004-blind26', source: 'lawyer-test-2026-08-03', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-08-04T12:00:00.000Z',
    suggestion: "PAST-TENSE TEST — A DOCUMENT THE LEASE MERELY CONTEMPLATES IS NOT MISSING; ONLY DOCUMENTS RECITED AS ALREADY EXISTING ARE. Before drafting any missing-document finding, ask one question about the referencing sentence: does the text say this instrument ALREADY EXISTS, or that it WILL BE CREATED if and when some future event occurs? ALREADY EXISTS = past tense, a specific date, or a definite article ('that certain Sublease dated 12/6/24', 'the First Amendment entered into as of 1/28/21', 'has been executed by Tenant and Subtenant') — these ARE findings. CONTEMPLATED ONLY = future/conditional ('Landlord shall prepare and deliver', 'in the form attached as Exhibit C', 'Tenant shall execute upon request', 'within 10 days after the Commencement Date') — these are NOT findings, because the document may never have been created and its absence is not a defect. A BLANK FORM EXHIBIT BOUND INTO THE LEASE IS THE CLEAREST CASE OF 'CONTEMPLATED ONLY' AND IS NEVER A FINDING UNDER ANY CHECK TYPE. Exhibits titled Commencement Letter, Commencement Date Agreement/Certificate, Delivery Certificate, Estoppel Certificate, SNDA form, Form of Letter of Credit, Form of Guaranty and Notice forms are TEMPLATES — their blankness is their normal state. Do not flag them as MISSING_DOCUMENT ('the completed X is absent'), as EXECUTION ('both By: lines are blank'), as MISSING_EXHIBIT ('the executed Exhibit C is missing'), or as LEASE_CURRENCY ('without the commencement letter the expiration cannot be confirmed'). RELABELING THE SAME OBSERVATION UNDER A DIFFERENT CHECK TYPE DOES NOT MAKE IT A VALID FINDING. The only exhibit whose execution is ever checked is a GUARANTY. Corollary for term math: if a blank Commencement Letter means you can only compute an OUTER BOUND on the expiration date, that is fine — compute the bound and move on. Inability to pin the exact date is not itself a finding.",
    rationale: "Reviewer rejection FP83-19, Financial Synergies, lawyer test 2026-08-03: 'The only exhibit that should be executed are guaranties. Many exhibits are just forms.' The rule was re-verified in blind loop 2 on 2026-08-04, where it REGRESSED — the agent re-emitted the identical blank Exhibit C commencement letter observation, merely relabeled from LEASE_CURRENCY to MISSING_DOCUMENT, reasoning that Section 3.A obligates Landlord to 'prepare and deliver' the letter. Three other tenants in the same loop (Avison Young, Century Oaks, Mayer) present the identical blank Exhibit C and correctly dropped it, which makes this an inconsistency rather than a systematic failure. Same root cause as FP83-14 (Eagle LNG), where the reviewer wrote 'There isn't any Exhibit F listed or noted anywhere. No exhibits are missing.'"
  },
  {
    id: 'learning-1785801600005-blind27', source: 'lawyer-test-2026-08-03', active: true,
    checkType: 'MISSING_DOCUMENT', confidence: 'HIGH',
    createdAt: '2026-08-04T12:00:00.000Z',
    suggestion: "CORPORATE-LEVEL TRANSACTION DOCUMENTS ARE OUT OF SCOPE, EVEN WHEN A LEASE DOCUMENT NAMES AND DATES ONE. The file being abstracted is a LEASE file. Instruments that govern the ENTITY rather than the TENANCY do not belong in it and are never missing documents. Out of scope regardless of how specifically they are referenced: merger agreements, bank merger agreements, agreements and plans of merger, certificates of merger or conversion, plans of reorganization, stock/asset/equity purchase agreements, membership-interest and partnership-interest transfer agreements, corporate resolutions authorizing a transaction, and financing/loan/credit/security agreements between the tenant and its own lenders. This holds even when (a) the referencing document names the agreement and gives its effective date, and (b) a lease clause requires the tenant to deliver 'all applicable documentation' of a transfer to Landlord — a general delivery covenant is NOT evidence that a specific corporate instrument is part of the landlord's lease file. What IS in scope when a tenant changes identity is the LEASE-SIDE instrument that documents the change: the Assignment and Assumption, Acknowledgement Agreement, Consent to Assignment, or amendment naming the successor. If that document is present in the folder, the succession is fully documented and there is nothing to flag — and note it is also not a SPECIAL_AGREEMENT, it is an ordinary link in the lease chain.",
    rationale: "Blind loop 2 regression 2026-08-04, Bank of Houston: the agent flagged 'Bank Merger Agreement effective December 1, 2025' as a missing document because Acknowledgement Section 1.6 names and dates it and lease Section 11.G(8) requires Tenant to deliver 'all applicable documentation'. The folder already contained the executed Acknowledgement and Assumption Agreement recording the same Bank of Houston to City Bank merger, so the succession was fully documented. A bank merger agreement is a bank-regulatory corporate instrument, not a lease document. The reviewer had already rejected the adjacent finding on the Acknowledgement itself (FP83-13) with 'This is not considered a separate agreement.'"
  },
  {
    id: 'learning-1785801600006-blind28', source: 'lawyer-test-2026-08-03', active: true,
    checkType: 'LEASE_CURRENCY', confidence: 'HIGH',
    createdAt: '2026-08-04T12:00:00.000Z',
    suggestion: "LEASE CURRENCY IS A RECONCILIATION CHECK, NEVER A FORECAST. Its purpose is to catch a file whose documents fail to support occupancy that is ALREADY ESTABLISHED. It is not an early-warning alarm for leases that happen to expire soon. Before writing any LEASE_CURRENCY finding you must be able to point to an EVIDENCED SHORTFALL — something in the record showing occupancy or obligation extending PAST the chain's end date X. Exactly one of these must hold: (1) X IS ALREADY IN THE PAST — the documents demonstrably lag reality; this is self-proving and needs no other evidence. (2) The finding is an INTERNAL GAP phrased as a range 'from A to B' between two in-folder documents. (3) A RENT ROLL End column is later than X. (4) A DOCUMENT IN THE FOLDER EVIDENCES OCCUPANCY PAST X — a holdover, an option or renewal that was EXERCISED without a documenting amendment, a sublease running longer than the prime term, or a recital that Tenant remains in possession. IF NONE OF THE FOUR HOLDS — X is in the future and nothing contradicts it — OUTPUT NOTHING. The instrument that would extend the term may not have been negotiated yet; a lease simply approaching its end date is a current, complete file, and asking an abstractor to chase a document that does not yet exist is a false positive. PROXIMITY IS NOT EVIDENCE: this is true at 89 days out just as at 890. The former 'within 90 days of today' fallback trigger is WITHDRAWN. Signals confirming the end date is an INTENDED HARD STOP rather than a documentation hole: a termination letter or notice closing the tenancy; a short-term or bridge lease that EXPRESSLY EXCLUDES the extension machinery (Option to Extend, Right of First Refusal, renewal riders); or a recital that such rights 'shall not apply.'",
    rationale: "Blind loop 3, 2026-08-04. Two independent blind runs over the IDENTICAL Mayer (Blue Tide) folder computed the identical arithmetic — chain end 10/31/2026, 89 days from today — and reached OPPOSITE conclusions, each logging it as its single closest call. The folder's newest instrument is a two-month direct lease signed four months earlier whose term has not yet commenced, with Rider No. 1 (Option to Extend) and Rider No. 2 (ROFR) expressly excluded by its Section 2.2; the file is fully current and no document is missing. The old rule made the answer depend on which side of an arbitrary 90-day cutoff the arithmetic landed. Verified safe against every confirmed LEASE_CURRENCY true positive in the reviewer set — Amberjack 'Document extending Term from 5/1/24-5/31/26' (internal gap, both dates past), LOGIX 'beyond 4/30/22' (past), Century Oaks 'beyond October 31, 2021' (past) — none of which rests on a future expiration date."
  }
]

function seedLaurensLearnings() {
  const existing = readLearnings()
  const existingIds = new Set(existing.map(l => l.id))
  const toAdd = LAUREN_REVIEW_SEED.filter(l => !existingIds.has(l.id))
  if (toAdd.length > 0) {
    writeLearnings([...existing, ...toAdd])
    console.log(`[learnings] Seeded ${toAdd.length} lawyer-validated rules from Lauren's 4/14/2026 TP2 review`)
  }
}
seedLaurensLearnings()

/** Persist full Dr. Todd synthesis reports on disk (Railway outputs volume). */
function appendDrToddReportArchive({ tenantName, folderName, reportText, sessionId }) {
  try {
    const id = randomUUID()
    const safe = String(tenantName || 'tenant').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 48) || 'tenant'
    const fname = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe.slice(0, 32)}_${id.slice(0, 8)}.json`
    const rec = {
      id,
      savedAt: new Date().toISOString(),
      sessionId: sessionId || null,
      tenantName: tenantName || '',
      folderName: folderName || '',
      report: reportText || ''
    }
    fs.writeFileSync(path.join(DR_TODD_REPORTS_DIR, fname), JSON.stringify(rec, null, 2), 'utf8')
  } catch (e) {
    console.error('[dr-todd-reports]', e.message)
  }
}

function parseFolderName(name) {
  const s = name || ''
  const dashIdx = s.indexOf(' - ')
  if (dashIdx === -1) {
    return { property: 'UNKNOWN', suite: 'N/A', tenantName: s.trim() || 'Unknown' }
  }
  const prefix = s.substring(0, dashIdx).trim()
  const tenantName = s.substring(dashIdx + 3).trim()
  const parts = prefix.split(/\s+/)
  const property = parts[0] || 'UNKNOWN'
  const suite = parts.slice(1).join(' ') || 'N/A'
  return { property, suite, tenantName }
}

app.use(express.json({ limit: '200mb' }))

// CORS must be registered *before* /api/* routes, or browsers get no ACAO headers on cross-origin calls
// (e.g. UI on http://127.0.0.1:3456, API on https://*.up.railway.app with LOCAL_DEV_CORS=1 on Railway).
if (CORS_ORIGIN_FIXED || LOCAL_DEV_CORS) {
  app.use((req, res, next) => {
    const origin = req.headers.origin || ''
    let allow = ''
    if (CORS_ORIGIN_FIXED && origin === CORS_ORIGIN_FIXED) allow = CORS_ORIGIN_FIXED
    else if (LOCAL_DEV_CORS && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) allow = origin
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow)
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id')
    }
    if (req.method === 'OPTIONS' && allow) return res.sendStatus(204)
    next()
  })
  if (LOCAL_DEV_CORS) {
    console.log('[cors] LOCAL_DEV_CORS — allowing browser Origin http://localhost:* and http://127.0.0.1:*')
  }
}

// Isaac / Teacher Excel — registered immediately after body parser (must not depend on later server.js code)
mountIsaacRoutes(app, { outputsDir: OUTPUTS_DIR, parseFolderName, sessions })
mountTelemetry(app, { outputsDir: OUTPUTS_DIR })

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'todd-jr',
    isaacRoutes: true,
    claudeConfigured: !!process.env.ANTHROPIC_API_KEY?.trim(),
    claudeKeyCount: getKeyCount(),
    openaiConfigured: isOpenAiKeyConfigured(),
    openaiKeySource: getServerOpenAiKeyHint(),
    localDevCors: LOCAL_DEV_CORS,
    /** Set by Railway on deploy — compare to GitHub to confirm the live build */
    gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    time: new Date().toISOString()
  })
})

/** Test each Anthropic API key with a minimal 1-token call — owner-accessible only */
app.get('/api/health/keys', async (_req, res) => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const keys = [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_API_KEY_2,
    process.env.ANTHROPIC_API_KEY_3,
    process.env.ANTHROPIC_API_KEY_4
  ]
  const results = await Promise.all(keys.map(async (key, i) => {
    if (!key?.trim()) return { key: `KEY_${i + 1}`, status: 'not_configured' }
    try {
      await new Anthropic({ apiKey: key }).messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
      return { key: `KEY_${i + 1}`, status: 'ok' }
    } catch (err) {
      return { key: `KEY_${i + 1}`, status: 'error', error: err.message?.slice(0, 80) }
    }
  }))
  const allOk = results.every(r => r.status === 'ok' || r.status === 'not_configured')
  res.json({ ok: allOk, keys: results })
})

// ═══════════════════════════════════════════════════════════
// MULTER — FILE UPLOAD
// ═══════════════════════════════════════════════════════════

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || req.body?.sessionId
    if (!sessionId) return cb(new Error('Missing session ID'))
    const dir = path.join(UPLOADS_DIR, sessionId)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    // Preserve the full relative path by encoding slashes as __SEP__
    // file.originalname = "Folder Name/subfolder/file.pdf" when sent via webkitdirectory
    const normalized = file.originalname.replace(/\\/g, '/')
    const safe = normalized.replace(/\//g, '__SEP__')
    cb(null, safe)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
  fileFilter: (_req, file, cb) => cb(null, true) // Accept all — let parser handle unknown types
})

// GET /api/session/check — Preflight before EventSource (side-by-side / model compare)
app.get('/api/session/check', (req, res) => {
  const sessionId = String(req.query.sessionId || '').trim()
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing sessionId query parameter.' })
  }
  const session = sessions.get(sessionId)
  if (!session) {
    return res.status(404).json({
      ok: false,
      error:
        'This browser is not connected to a live session on the server. Upload tenant folders from the Hunt screen again, or the server restarted (sessions are stored in memory only).'
    })
  }
  const tenantCount = Array.isArray(session.tenants) ? session.tenants.length : 0
  const openAIConfigured = isOpenAiKeyConfigured()
  const openAIKeySource = getServerOpenAiKeyHint()
  if (tenantCount === 0) {
    return res.json({
      ok: true,
      tenantCount: 0,
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY?.trim(),
      openAIConfigured,
      openAIKeySource,
      note: 'Upload tenant folders to run hunts and OpenAI Test Lab.'
    })
  }
  res.json({
    ok: true,
    tenantCount,
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY?.trim(),
    openAIConfigured,
    openAIKeySource
  })
})

function ensureSessionShell(sessionId) {
  let session = sessions.get(sessionId)
  if (session) return session
  session = {
    tenants: [],
    findings: new Map(),
    uploadDir: path.join(UPLOADS_DIR, sessionId),
    createdAt: Date.now()
  }
  sessions.set(sessionId, session)
  try {
    fs.mkdirSync(session.uploadDir, { recursive: true })
  } catch {
    /* non-fatal — multer also mkdirs on upload */
  }
  return session
}

// ═══════════════════════════════════════════════════════════
// POST /api/upload
// ═══════════════════════════════════════════════════════════

app.post('/api/upload', upload.array('files', 10000), async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id']
    if (!sessionId) return res.status(400).json({ error: 'Missing X-Session-Id header' })
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files received' })

    // Check if a single ZIP file was uploaded
    if (req.files.length === 1 && req.files[0].originalname.toLowerCase().endsWith('.zip')) {
      console.log('[upload] ZIP file detected, extracting...')
      const zipFile = req.files[0]
      const extractDir = path.join(UPLOADS_DIR, sessionId, 'extracted')
      fs.mkdirSync(extractDir, { recursive: true })

      try {
        await new Promise((resolve, reject) => {
          fs.createReadStream(zipFile.path)
            .pipe(unzipper.Extract({ path: extractDir }))
            .on('close', resolve)
            .on('error', reject)
        })
        console.log('[upload] ZIP extracted successfully')

        // Find the actual root: skip __MACOSX, detect single wrapper folders
        // e.g. Mac zips often produce: WrapperFolder/ -> Tenant1/, Tenant2/...
        const SKIP_DIRS = new Set(['__MACOSX', '__pycache__', '.git'])
        const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

        function findTenantRoot(dir) {
          const entries = fs.readdirSync(dir).filter(e => !SKIP_DIRS.has(e) && !e.startsWith('.'))
          const subdirs = entries.filter(e => fs.statSync(path.join(dir, e)).isDirectory())
          const files   = entries.filter(e => fs.statSync(path.join(dir, e)).isFile())

          // If only one subdir and no real files at this level → go one level deeper
          if (subdirs.length === 1 && files.length === 0) {
            console.log(`[upload] Wrapper folder detected: "${subdirs[0]}", descending...`)
            return findTenantRoot(path.join(dir, subdirs[0]))
          }
          return dir
        }

        const tenantRoot = findTenantRoot(extractDir)
        console.log(`[upload] Tenant root resolved to: ${tenantRoot}`)

        // Walk from tenant root, collecting files with paths relative to tenant root
        const extractedFiles = []
        function walkDir(dir, relPath = '') {
          const entries = fs.readdirSync(dir)
          for (const entry of entries) {
            if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry) || entry.startsWith('.')) continue
            const fullPath = path.join(dir, entry)
            const entryRelPath = relPath ? `${relPath}/${entry}` : entry
            const stat = fs.statSync(fullPath)
            if (stat.isFile()) {
              extractedFiles.push({ path: fullPath, originalname: entryRelPath })
            } else if (stat.isDirectory()) {
              walkDir(fullPath, entryRelPath)
            }
          }
        }
        walkDir(tenantRoot)
        console.log(`[upload] Found ${extractedFiles.length} files under tenant root`)

        // Normalize path separators: "/" → "__SEP__" for consistent grouping.
        // Also apply Unicode NFC normalization so macOS NFD-encoded filenames
        // ("Alibertos" with accent stored as decomposed form) don't end up as
        // a different string from the same name in NFC form. Without this, two
        // visually-identical folder names can produce two different Map keys.
        req.files = extractedFiles.map(f => ({
          ...f,
          originalname: f.originalname.normalize('NFC').replace(/\\/g, '/').replace(/\//g, '__SEP__')
        }))
      } catch (err) {
        console.error('[upload] ZIP extraction failed:', err)
        return res.status(400).json({ error: `Failed to extract ZIP: ${err.message}` })
      }
    }

    // Group uploaded files by their tenant folder.
    //
    // We need to handle two drop patterns:
    //   A) Drop a parent folder containing multiple tenant subfolders:
    //      "My Portfolio/RN 6419 - Freeway Insurance/lease.pdf"  → 3 parts → tenant = parts[1]
    //   B) Drop a single tenant folder directly, or a sibling set of tenant folders:
    //      "RN 6419 - Freeway Insurance/lease.pdf"               → 2 parts → tenant = parts[0]
    //
    // Detection: if ALL path-bearing files share the same parts[0] AND at least one has
    // depth >= 3, then parts[0] is a wrapper — skip it and use parts[1] as the tenant.

    const allParsedParts = req.files.map(f => {
      const filename = f.filename || f.originalname || 'unknown'
      return filename.split('__SEP__')
    })

    const pathFiles = allParsedParts.filter(p => p.length >= 2)
    const uniqueTopLevel = new Set(pathFiles.map(p => p[0]))
    const hasWrapperFolder = uniqueTopLevel.size === 1 && pathFiles.some(p => p.length >= 3)
    const tenantDepth = hasWrapperFolder ? 1 : 0

    if (hasWrapperFolder) {
      console.log(`[upload] Wrapper folder detected: "${[...uniqueTopLevel][0]}" — grouping by depth ${tenantDepth + 1}`)
    }

    const tenantMap = new Map()

    for (let i = 0; i < req.files.length; i++) {
      const file  = req.files[i]
      const parts = allParsedParts[i]

      console.log(`[upload] File: ${parts.join('__SEP__')} → parts: ${parts.length}`)

      if (parts.length >= 2) {
        // Tenant folder is at tenantDepth (0 normally, 1 when there's a wrapper)
        const tenantFolder   = parts[tenantDepth] || parts[0]
        const originalFileName = parts[parts.length - 1]

        if (!tenantMap.has(tenantFolder)) {
          tenantMap.set(tenantFolder, { folderName: tenantFolder, files: [] })
        }
        tenantMap.get(tenantFolder).files.push({
          diskPath:     file.path,
          originalName: originalFileName
        })
      } else {
        // No folder path — root-level file with no subfolder structure
        const bucketName = '_single_tenant_'
        if (!tenantMap.has(bucketName)) {
          tenantMap.set(bucketName, { folderName: bucketName, files: [] })
        }
        tenantMap.get(bucketName).files.push({
          diskPath:     file.path || file.fullPath || '',
          originalName: parts[0]
        })
        console.log(`[upload] Root-level file bucketed as single tenant: ${parts[0]}`)
      }
    }

    console.log(`[upload] Grouped ${req.files.length} files into ${tenantMap.size} folder(s)`)
    for (const [name, data] of tenantMap) {
      console.log(`  - ${name}: ${data.files.length} files`)
    }

    // ── Tenant skip-detection diagnostic ───────────────────────────────
    // Catches the bug where one tenant's files end up bucketed under another
    // tenant's folder name, causing the second tenant to be skipped entirely.
    // Log all unique top-level folder candidates so we can compare what the
    // user uploaded vs what got grouped.
    const allTopLevels = new Set(
      allParsedParts
        .filter(p => p.length >= 2)
        .map(p => p[tenantDepth] || p[0])
    )
    if (allTopLevels.size !== tenantMap.size) {
      console.warn(`[upload] ⚠️  TENANT GROUPING MISMATCH: detected ${allTopLevels.size} unique folder names but grouped into ${tenantMap.size} buckets`)
      console.warn(`[upload]    Detected folder names: ${[...allTopLevels].join(' | ')}`)
      console.warn(`[upload]    Bucket names:          ${[...tenantMap.keys()].join(' | ')}`)
      const missing = [...allTopLevels].filter(t => !tenantMap.has(t))
      if (missing.length > 0) {
        console.warn(`[upload]    🚨 LIKELY SKIPPED TENANTS: ${missing.join(', ')}`)
      }
    }

    if (tenantMap.size === 0) {
      return res.status(400).json({
        error: 'No files received. Please try uploading again.'
      })
    }

    // Parse folder names and build tenant list
    const PDF_LIMIT = 32 * 1024 * 1024 // 32MB
    const tenants = []
    for (const [folderName, data] of tenantMap) {
      // Special case: root-level files with no folder context
      if (folderName === '_single_tenant_') {
        const oversizedFiles = data.files
          .filter(f => f.originalName?.toLowerCase().endsWith('.pdf'))
          .filter(f => { try { return fs.statSync(f.diskPath).size > PDF_LIMIT } catch { return false } })
          .map(f => f.originalName)
        tenants.push({
          id: randomUUID(),
          folderName: 'Uploaded Files',
          property: '--',
          suite: '--',
          tenantName: 'Uploaded Files',
          fileCount: data.files.length,
          files: data.files,
          oversizedFiles
        })
        continue
      }
      const parsed = parseFolderName(folderName)
      // Flag any files that exceed the native PDF size limit
      const oversizedFiles = data.files
        .filter(f => f.originalName?.toLowerCase().endsWith('.pdf'))
        .filter(f => { try { return fs.statSync(f.diskPath).size > PDF_LIMIT } catch { return false } })
        .map(f => f.originalName)
      tenants.push({
        id:         randomUUID(),
        folderName,
        property:   parsed.property,
        suite:      parsed.suite,
        tenantName: parsed.tenantName,
        fileCount:  data.files.length,
        files:      data.files,
        oversizedFiles
      })
    }

    // ── Dedup + integrity validation ───────────────────────────────────────
    // ROOT-CAUSE FIX for "AAC ran twice / Alibertos skipped" pattern.
    // All issues found here are also written to session.uploadDiagnostics so
    // they surface in the Target Practice Excel as an "Upload Issues" sheet.
    const tenantIdentityKey = (t) =>
      [t.property, t.suite, t.tenantName]
        .map(s => String(s ?? '').normalize('NFC').toLowerCase().trim())
        .join('||')

    const uploadDiagnostics = {
      uploadedAt:        new Date().toISOString(),
      filesUploaded:     req.files.length,
      foldersDetected:   tenantMap.size,
      duplicatesMerged:  [],   // [{mergedInto, duplicate, filesAdded}]
      emptyTenantsDropped: [], // [folderName]
      fileCountDelta:    0,    // uploaded - in-tenants (positive = files lost)
      finalTenantList:   []    // [{tenantName, property, suite, fileCount, folderName}]
    }

    const dedupedMap = new Map()
    for (const tenant of tenants) {
      const key = tenantIdentityKey(tenant)
      if (dedupedMap.has(key)) {
        const existing = dedupedMap.get(key)
        const existingPaths = new Set(existing.files.map(f => f.diskPath))
        const newFiles = tenant.files.filter(f => !existingPaths.has(f.diskPath))
        existing.files.push(...newFiles)
        existing.fileCount = existing.files.length
        uploadDiagnostics.duplicatesMerged.push({
          mergedInto: existing.folderName,
          duplicate:  tenant.folderName,
          filesAdded: newFiles.length
        })
        console.warn(`[upload] ⚠️  DUPLICATE TENANT MERGED: "${tenant.folderName}" → "${existing.folderName}" (+${newFiles.length} files)`)
        logEvent('upload.duplicate_merged', { sessionId, mergedInto: existing.folderName, duplicate: tenant.folderName, filesAdded: newFiles.length })
      } else {
        dedupedMap.set(key, tenant)
      }
    }

    const finalTenants = [...dedupedMap.values()].filter(t => {
      if (!t.files || t.files.length === 0) {
        uploadDiagnostics.emptyTenantsDropped.push(t.folderName)
        console.warn(`[upload] ⚠️  EMPTY TENANT DROPPED: "${t.folderName}" had no files`)
        logEvent('upload.empty_dropped', { sessionId, folderName: t.folderName })
        return false
      }
      return true
    })

    const totalFilesInTenants = finalTenants.reduce((sum, t) => sum + t.files.length, 0)
    uploadDiagnostics.fileCountDelta = req.files.length - totalFilesInTenants
    if (uploadDiagnostics.fileCountDelta !== 0) {
      console.warn(`[upload] ⚠️  FILE COUNT MISMATCH: uploaded ${req.files.length} files but tenants contain ${totalFilesInTenants} (delta ${uploadDiagnostics.fileCountDelta})`)
      logEvent('upload.file_count_mismatch', { sessionId, uploadedFiles: req.files.length, inTenants: totalFilesInTenants, delta: uploadDiagnostics.fileCountDelta })
    }
    // Log every detected tenant + a summary event for the whole upload
    for (const t of finalTenants) {
      let totalBytes = 0
      try { totalBytes = t.files.reduce((s, f) => s + (fs.statSync(f.diskPath).size || 0), 0) } catch {}
      logEvent('upload.tenant_detected', {
        sessionId,
        tenantId: t.id,
        tenantName: t.tenantName,
        folderName: t.folderName,
        property: t.property,
        suite: t.suite,
        fileCount: t.files.length,
        totalBytes,
        oversizedCount: Array.isArray(t.oversizedFiles) ? t.oversizedFiles.length : 0,
      })
    }
    logEvent('upload.complete', {
      sessionId,
      finalTenantCount: finalTenants.length,
      filesUploaded: req.files.length,
      duplicatesMerged: uploadDiagnostics.duplicatesMerged.length,
      emptyDropped: uploadDiagnostics.emptyTenantsDropped.length,
    })

    console.log(`[upload] ✅ Final tenant count: ${finalTenants.length}${uploadDiagnostics.duplicatesMerged.length > 0 ? ` (after merging ${uploadDiagnostics.duplicatesMerged.length} duplicate(s))` : ''}`)
    for (const t of finalTenants) {
      console.log(`  • ${t.tenantName} (${t.property}/${t.suite}) — ${t.files.length} files [folder: ${t.folderName}]`)
      uploadDiagnostics.finalTenantList.push({
        tenantName: t.tenantName,
        property:   t.property,
        suite:      t.suite,
        fileCount:  t.files.length,
        folderName: t.folderName
      })
    }

    tenants.length = 0
    tenants.push(...finalTenants)

    // Sort by property then suite number
    tenants.sort((a, b) => {
      const propCmp = a.property.localeCompare(b.property)
      if (propCmp !== 0) return propCmp
      return String(a.suite).localeCompare(String(b.suite), undefined, { numeric: true })
    })

    sessions.set(sessionId, {
      tenants,
      findings: new Map(),
      uploadDir: path.join(UPLOADS_DIR, sessionId),
      createdAt: Date.now(),
      uploadDiagnostics
    })

    res.json({
      sessionId,
      tenants: tenants.map(t => ({
        id:            t.id,
        folderName:    t.folderName,
        property:      t.property,
        suite:         t.suite,
        tenantName:    t.tenantName,
        fileCount:     t.fileCount,
        oversizedFiles: t.oversizedFiles,
        files: t.files.map(f => {
          let sizeBytes = 0
          try { sizeBytes = fs.statSync(f.diskPath).size } catch {}
          return { name: f.originalName, sizeBytes }
        })
      }))
    })

  } catch (err) {
    console.error('[upload] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// POST /api/session/register  — register local-extraction session metadata
// (no files uploaded — files live in browser RAM for analysis)
// ═══════════════════════════════════════════════════════════

app.post('/api/session/register', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const { sessionId, tenants, uploadDiagnostics: clientDiagnostics } = req.body
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' })
    if (!Array.isArray(tenants)) return res.status(400).json({ error: 'tenants must be an array' })

    // Server-side dedup safety net — even if frontend forgot, dedup here.
    // Catches Mirage Hair/Pigtails-twice class of bugs.
    const tenantIdentityKey = (t) =>
      [t.property, t.suite, t.tenantName]
        .map(s => String(s ?? '').normalize('NFC').toLowerCase().trim())
        .join('||')
    const seen = new Map()
    const serverMerges = []
    for (const t of tenants) {
      const k = tenantIdentityKey(t)
      if (seen.has(k)) {
        serverMerges.push({ duplicate: t.folderName, mergedInto: seen.get(k).folderName, filesAdded: 0 })
        console.warn(`[session/register] ⚠️  Server-side dedup: dropping duplicate "${t.folderName}" (already have "${seen.get(k).folderName}")`)
        continue
      }
      seen.set(k, t)
    }
    const dedupedTenants = [...seen.values()]

    // Build/merge uploadDiagnostics — accept client-provided diagnostics if
    // present, otherwise reconstruct minimal version from the deduped list.
    const uploadDiagnostics = clientDiagnostics && typeof clientDiagnostics === 'object'
      ? {
          ...clientDiagnostics,
          // Append server-side merges to whatever the client already noted
          duplicatesMerged: [...(clientDiagnostics.duplicatesMerged || []), ...serverMerges]
        }
      : {
          uploadedAt:        new Date().toISOString(),
          filesUploaded:     dedupedTenants.reduce((s, t) => s + (t.fileCount || 0), 0),
          foldersDetected:   tenants.length,
          duplicatesMerged:  serverMerges,
          emptyTenantsDropped: [],
          fileCountDelta:    0,
          finalTenantList:   dedupedTenants.map(t => ({
            tenantName: t.tenantName,
            property:   t.property,
            suite:      t.suite,
            fileCount:  t.fileCount || 0,
            folderName: t.folderName
          }))
        }

    sessions.set(sessionId, {
      tenants:   dedupedTenants.map(t => ({ ...t, files: [] })), // no disk files
      findings:  new Map(),
      createdAt: Date.now(),
      isLocal:   true,
      uploadDiagnostics
    })

    console.log(`[session/register] sessionId=${sessionId} tenants=${dedupedTenants.length}${serverMerges.length > 0 ? ` (after server dedup of ${serverMerges.length})` : ''}`)
    res.json({ ok: true, sessionId, tenantCount: dedupedTenants.length, mergesApplied: serverMerges.length })
  } catch (err) {
    console.error('[session/register]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// POST /api/hunt/tenant  — analyze one tenant with inline base64 files
// (client-side extraction: files sent in request body, no disk writes)
// ═══════════════════════════════════════════════════════════

app.post('/api/hunt/tenant', express.json({ limit: '500mb' }), async (req, res) => {
  try {
    const { sessionId, tenant, files, juiced, tp3, learnings, cheap } = req.body
    if (!tenant || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Missing tenant or files' })
    }

    // Convert base64 files to buffer-based file objects the analyzer understands
    const fileObjs = files.map(f => ({
      originalName: f.name,
      buffer:       Buffer.from(f.base64, 'base64'),
      size:         f.size,
      isPDF:        f.name.toLowerCase().endsWith('.pdf')
    }))

    const useJuice     = !!juiced
    const useTP3       = !!tp3
    const cheapOpts    = { cheapMode: !!cheap }
    const learningsArr = Array.isArray(learnings) ? learnings : []

    console.log(`[hunt/tenant] ${tenant.tenantName}: ${fileObjs.length} file(s), juice=${useJuice}, tp3=${useTP3}, cheap=${cheapOpts.cheapMode}`)

    let result
    if (useTP3 && learningsArr.length > 0) {
      result = await tp3AnalyzeTenant(tenant, fileObjs, () => {}, learningsArr, cheapOpts)
    } else if (useJuice && learningsArr.length > 0) {
      result = await beefedUpAnalyzeTenant(tenant, fileObjs, () => {}, learningsArr, cheapOpts)
    } else {
      result = await analyzeTenant(tenant, fileObjs, () => {}, cheapOpts)
    }

    // Store in session findings if session exists
    const session = sessions.get(sessionId)
    if (session) session.findings.set(tenant.id, result)

    res.json({ ok: true, tenantId: tenant.id, result })
  } catch (err) {
    console.error('[hunt/tenant]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// GET /api/hunt  — Server-Sent Events stream
// ═══════════════════════════════════════════════════════════

app.get('/api/hunt', async (req, res) => {
  const { sessionId, testTenantId, concurrency, tenantIds, juiced, tp3 } = req.query
  const session = sessions.get(sessionId)

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const useJuice = juiced === '1'
  const useTP3   = tp3 === '1'  // TP3 implies juice + Opus universal verifier + senior-lawyer review
  // Same learnings file as Gym: includes Dr. Todd "Extract & Save" rules + workout feedback (only l.active === true apply)
  const learningsForHunt = (useJuice || useTP3) ? readLearnings() : []
  const activeLearningCount = learningsForHunt.filter(l => l.active).length

  // Use local copy — never mutate session.tenants so the user can re-run
  // Filter by active tenant IDs sent from frontend (respects user deletions)
  const activeIds = tenantIds ? new Set(tenantIds.split(',')) : null
  let tenantsToProcess = activeIds
    ? session.tenants.filter(t => activeIds.has(t.id))
    : session.tenants
  if (testTenantId) tenantsToProcess = tenantsToProcess.filter(t => t.id === testTenantId)

  console.log(`[hunt] Processing ${tenantsToProcess.length} tenant(s)${testTenantId ? ' (TEST MODE)' : ''}`)

  // SSE headers — must NOT be buffered
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no'  // Disable nginx buffering if proxied
  })
  res.flushHeaders()

  const emit = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch { /* client disconnected */ }
  }

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)

  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  try {
    if (!aborted) {
      emit('hunt-start', {
        juiced: useJuice,
        activeLearningsApplied: activeLearningCount,
        learningsInFile: learningsForHunt.length
      })
    }
    // concurrency=1 → accuracy mode (sequential), concurrency=0 → speed mode (all at once)
    const CONCURRENCY = concurrency === '0' ? Math.min(5, tenantsToProcess.length) : 1
    const modeLabel = useTP3 ? 'TP3 (Opus universal verifier + senior-lawyer review)' : useJuice ? `JUICE (${activeLearningCount} active learnings)` : 'PLAIN'
    console.log(`[hunt] Mode: ${CONCURRENCY === 1 ? 'ACCURACY (sequential)' : 'SPEED (parallel)'} | ${modeLabel}`)
    await runConcurrent(tenantsToProcess, CONCURRENCY, async tenant => {
      if (aborted) return
      // Emit folder-start here so it fires exactly when this tenant begins processing
      emit('folder-start', {
        tenantId:   tenant.id,
        tenantName: tenant.tenantName,
        folderName: tenant.folderName,
        fileCount:  tenant.fileCount,
        juiced:     useJuice || useTP3,
        tp3:        useTP3,
        activeLearningsApplied: activeLearningCount
      })
      const onProgress = ({ percent, message }) => {
        if (!aborted) emit('folder-progress', { tenantId: tenant.id, percent, message })
      }
      try {
        const cheapOpts = { cheapMode: isCheapMode(req) }
        const result = useTP3
          ? await tp3AnalyzeTenant(tenant, tenant.files, onProgress, learningsForHunt, cheapOpts)
          : useJuice
            ? await beefedUpAnalyzeTenant(tenant, tenant.files, onProgress, learningsForHunt, cheapOpts)
            : await analyzeTenant(tenant, tenant.files, onProgress, cheapOpts)
        session.findings.set(tenant.id, result)
        emit('folder-done', {
          tenantId:     tenant.id,
          findingCount: result.findings?.length || 0,
          allClear:     result.allClear || false,
          severity:     maxSeverity(result.findings)
        })
      } catch (err) {
        console.error(`[hunt] Error on tenant ${tenant.tenantName}:`, err.message)
        const errResult = {
          tenantNameInDocuments: tenant.tenantName,
          findings: [{
            checkType:       'LEGIBILITY',
            severity:        'HIGH',
            missingDocument: 'N/A',
            comment:         `Document analysis failed: ${err.message}`,
            evidence:        'Server-side processing error — please retry or review manually.'
          }],
          allClear: false
        }
        session.findings.set(tenant.id, errResult)
        emit('folder-done', { tenantId: tenant.id, findingCount: 1, allClear: false, severity: 'HIGH', error: true })
      }
    })

    if (!aborted) {
      emit('hunt-complete', { totalTenants: tenantsToProcess.length })
    }

  } catch (err) {
    console.error('[hunt] Fatal error:', err)
    if (!aborted) emit('hunt-error', { error: err.message })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ═══════════════════════════════════════════════════════════
// GET /api/drtoddhunt — 3 independent runs + synthesis report
// ═══════════════════════════════════════════════════════════

app.get('/api/drtoddhunt', async (req, res) => {
  const { sessionId, tenantId } = req.query
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  // Pick specified tenant or random
  const tenant = (tenantId ? session.tenants.find(t => t.id === tenantId) : null)
    || session.tenants[Math.floor(Math.random() * session.tenants.length)]
  if (!tenant) return res.status(404).json({ error: 'No tenants found' })

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()

  const emit = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
  }

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)

  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  try {
    emit('drtoddhunt-start', { tenantName: tenant.tenantName, folderName: tenant.folderName })

    const runs = []
    for (let run = 1; run <= 3; run++) {
      if (aborted) break
      // Small pause between runs to avoid rate-limit bursts
      if (run > 1) await new Promise(r => setTimeout(r, 8000))
      emit('drtoddhunt-run-start', { runNumber: run })
      const onProgress = ({ percent, message }) => {
        if (!aborted) emit('drtoddhunt-run-progress', { runNumber: run, percent, message })
      }
      try {
        const result = await analyzeTenant(tenant, tenant.files, onProgress, { cheapMode: isCheapMode(req) })
        runs.push(result)
        emit('drtoddhunt-run-done', { runNumber: run, findingCount: result.findings?.length || 0, allClear: result.allClear })
      } catch (err) {
        console.error(`[drtoddhunt] Run ${run} error:`, err.message)
        runs.push({ findings: [], allClear: false, error: err.message })
        emit('drtoddhunt-run-done', { runNumber: run, findingCount: 0, error: err.message })
      }
    }

    // Always save runs to session so synthesize endpoint can use them
    session[`drtodd_${tenant.id}`] = { runs, tenant }

    // Signal runs complete — frontend shows the "Generate Analysis Report" button
    if (!aborted) {
      emit('drtoddhunt-runs-complete', {
        tenantId:   tenant.id,
        tenantName: tenant.tenantName,
        errorCount: runs.filter(r => r.error).length
      })
    }

  } catch (err) {
    console.error('[drtoddhunt] Fatal error:', err.message)
    if (!aborted) emit('drtoddhunt-error', { error: err.message })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ═══════════════════════════════════════════════════════════
// POST /api/drtoddhunt/synthesize
// ═══════════════════════════════════════════════════════════

app.post('/api/drtoddhunt/synthesize', async (req, res) => {
  try {
    const { sessionId, cheapMode } = req.body
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    // Find the saved Dr. Todd run data
    const key    = Object.keys(session).find(k => k.startsWith('drtodd_'))
    const saved  = key ? session[key] : null
    if (!saved) return res.status(404).json({ error: 'No Dr. Todd runs found — please run first' })

    const { runs, tenant } = saved
    const pad = n => runs[n] || { findings: [], allClear: false, error: 'Run not completed' }

    const { synthesizeDrTodd } = await import('./lib/claude.js')
    const report = await synthesizeDrTodd(tenant, pad(0), pad(1), pad(2), { cheapMode: !!cheapMode })

    appendDrToddReportArchive({
      tenantName: tenant.tenantName,
      folderName: tenant.folderName,
      reportText: report,
      sessionId
    })

    res.json({ report, tenantName: tenant.tenantName })
  } catch (err) {
    console.error('[drtoddhunt/synthesize] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// POST /api/drtoddhunt/extract-learnings
// "Lazy trainer" — pull learning rules out of the synthesis report
// ═══════════════════════════════════════════════════════════

app.post('/api/drtoddhunt/extract-learnings', async (req, res) => {
  try {
    const { sessionId, reportText, tenantName, cheapMode } = req.body
    if (!reportText) return res.status(400).json({ error: 'reportText is required' })

    const { extractLearningsFromDrTodd } = await import('./lib/gym-trainer.js')
    const result = await extractLearningsFromDrTodd(reportText, tenantName || 'Unknown', !!cheapMode)

    // One batch per extract — same batchId + timestamp so the UI can group “whole extract”
    const batchId = `drtodd-${Date.now()}`
    const savedAt = new Date().toISOString()
    const tenantLabel = tenantName || 'Unknown'
    const newLearnings = (result.learnings || []).map(l => ({
      ...l,
      id:         `learning-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt:  savedAt,
      batchId,
      tenantName: tenantLabel,
      source:     'dr-todd-diagnostic',
      active:     false,
    }))

    const existing = readLearnings()
    writeLearnings([...existing, ...newLearnings])

    res.json({ learnings: newLearnings, summary: result.summary })
  } catch (err) {
    console.error('[drtoddhunt/extract-learnings]', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/sidebyside/extract-learnings
// Pulls juice learnings from a Dr. Verdict report (juice, doublecheck, or modelcompare)
// ═══════════════════════════════════════════════════════════

app.post('/api/sidebyside/extract-learnings', async (req, res) => {
  try {
    const { verdictText, tenantName, mode, cheapMode } = req.body
    if (!verdictText) return res.status(400).json({ error: 'verdictText is required' })

    const { extractLearningsFromVerdict } = await import('./lib/gym-trainer.js')
    const result = await extractLearningsFromVerdict(
      verdictText,
      tenantName || 'Unknown',
      mode || 'juice',
      !!cheapMode
    )

    const batchId  = `verdict-${Date.now()}`
    const savedAt  = new Date().toISOString()
    const newLearnings = (result.learnings || []).map(l => ({
      ...l,
      id:         `learning-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt:  savedAt,
      batchId,
      tenantName: tenantName || 'Unknown',
      source:     `verdict-${mode || 'juice'}`,
      active:     false,
    }))

    const existing = readLearnings()
    writeLearnings([...existing, ...newLearnings])

    res.json({ learnings: newLearnings, summary: result.summary })
  } catch (err) {
    console.error('[sidebyside/extract-learnings]', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/doublecheck/extract-learnings
// Pulls juice rules from structured double-check QA data (not verdict text)
// ═══════════════════════════════════════════════════════════

app.post('/api/doublecheck/extract-learnings', async (req, res) => {
  try {
    const { beefedFindings, removedFindings, rawFindings, tenantName, cheapMode } = req.body
    if (!beefedFindings && !removedFindings) {
      return res.status(400).json({ error: 'beefedFindings or removedFindings required' })
    }

    const allBeefed = beefedFindings || []
    const addedFindings     = allBeefed.filter(f => f.reviewStatus === 'ADDED')
    const correctedFindings = allBeefed.filter(f => f.reviewStatus === 'CORRECTED')
    const confirmedFindings = allBeefed.filter(f => f.reviewStatus === 'CONFIRMED')

    const { extractLearningsFromDoubleCheck } = await import('./lib/gym-trainer.js')
    const result = await extractLearningsFromDoubleCheck({
      addedFindings,
      correctedFindings,
      removedFindings: removedFindings || [],
      confirmedFindings,
      tenantName: tenantName || 'Unknown',
      cheapMode:  !!cheapMode
    })

    const batchId  = `dc-${Date.now()}`
    const savedAt  = new Date().toISOString()
    const newLearnings = (result.learnings || []).map(l => ({
      ...l,
      id:         `learning-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt:  savedAt,
      batchId,
      tenantName: tenantName || 'Unknown',
      source:     'doublecheck-review',
      active:     false,
    }))

    const existing = readLearnings()
    writeLearnings([...existing, ...newLearnings])

    res.json({ learnings: newLearnings, summary: result.summary })
  } catch (err) {
    console.error('[doublecheck/extract-learnings]', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/drtoddhunt/tldr
app.post('/api/drtoddhunt/tldr', async (req, res) => {
  try {
    const { reportText, tenantName, cheapMode } = req.body || {}
    if (!reportText || !String(reportText).trim()) {
      return res.status(400).json({ error: 'reportText is required' })
    }
    const { dumbDownDrToddReport } = await import('./lib/gym-trainer.js')
    const tldr = await dumbDownDrToddReport(String(reportText), String(tenantName || ''), !!cheapMode)
    res.json({ tldr })
  } catch (err) {
    console.error('[drtoddhunt/tldr]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// GET /api/sidebyside — Raw Todd vs Beefed-Up Todd, SSE stream
// ═══════════════════════════════════════════════════════════

app.get('/api/sidebyside', async (req, res) => {
  const { sessionId, tenantId } = req.query
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const tenant = tenantId
    ? session.tenants.find(t => t.id === tenantId)
    : session.tenants[0]
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()

  const emit = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)
  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  try {
    const learnings = readLearnings()
    const activeLearnings = learnings.filter(l => l.active)
    const cheapOpts = { cheapMode: isCheapMode(req) }

    emit('sbs-start', {
      tenantName: tenant.tenantName,
      activeLearningCount: activeLearnings.length
    })

    // Run both in parallel
    const [rawResult, beefedResult] = await Promise.all([
      analyzeTenant(tenant, tenant.files, ({ percent, message }) => {
        if (!aborted) emit('sbs-progress', { side: 'raw', percent, message })
      }, cheapOpts),
      beefedUpAnalyzeTenant(tenant, tenant.files, ({ percent, message }) => {
        if (!aborted) emit('sbs-progress', { side: 'beefed', percent, message })
      }, learnings, cheapOpts)
    ])

    if (!aborted) {
      emit('sbs-complete', {
        tenantName:  tenant.tenantName,
        raw:         rawResult,
        beefed:      beefedResult,
        activeLearnings
      })
    }
  } catch (err) {
    console.error('[sidebyside]', err)
    if (!aborted) emit('sbs-error', { error: err.message })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ═══════════════════════════════════════════════════════════
// GET /api/doublecheck — Regular vs Reviewer second pass (SSE)
// ═══════════════════════════════════════════════════════════

app.get('/api/doublecheck', async (req, res) => {
  const { sessionId, tenantId } = req.query
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const tenant = tenantId
    ? session.tenants.find(t => t.id === tenantId)
    : session.tenants[0]
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()

  const emit = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)
  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  try {
    const cheapOpts = { cheapMode: isCheapMode(req) }

    emit('sbs-start', {
      tenantName: tenant.tenantName,
      activeLearningCount: 0
    })

    // Sequential double-check:
    // Pass 1 (raw)    — base model reads all docs cold, produces findings
    // Pass 2 (review) — same docs + Pass 1 findings → senior reviewer verifies,
    //                   removes false positives, corrects errors, adds misses
    const { firstPass, reviewed } = await doubleCheckTenant(
      tenant,
      tenant.files,
      ({ percent, message }) => {
        if (!aborted) emit('sbs-progress', { side: 'raw', percent, message })
      },
      ({ percent, message }) => {
        const msg = message ? `Reviewer: ${message}` : 'Reviewer pass running...'
        if (!aborted) emit('sbs-progress', { side: 'beefed', percent, message: msg })
      },
      cheapOpts
    )

    if (!aborted) {
      emit('sbs-complete', {
        tenantName:     tenant.tenantName,
        raw:            firstPass,
        beefed:         reviewed,
        activeLearnings: [],
        mode:           'doublecheck'
      })
    }
  } catch (err) {
    console.error('[doublecheck]', err)
    if (!aborted) emit('sbs-error', { error: err.message })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ═══════════════════════════════════════════════════════════
// GET /api/modelcompare — Claude API vs OpenAI API (SSE)
// ═══════════════════════════════════════════════════════════
app.get('/api/modelcompare', async (req, res) => {
  const { sessionId, tenantId } = req.query
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const tenant = tenantId
    ? session.tenants.find(t => t.id === tenantId)
    : session.tenants[0]
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()

  const emit = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)
  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  const { configured: openaiConfigured, optionKey: openaiOptionKey } = resolveSessionOpenAi(session)

  function skippedOpenaiResult(reason) {
    return {
      tenantNameInDocuments: tenant.tenantName,
      mostRecentDocumentDate: null,
      leaseExpirationDate: null,
      findings: [
        {
          checkType: 'SPECIAL_AGREEMENT',
          severity: 'LOW',
          missingDocument: 'OpenAI API',
          comment: `Not run — ${reason}. Add OPENAI_API_KEY (Railway Variables or .env) or openai.key next to package.json, then restart.`,
          evidence: ''
        }
      ],
      allClear: false,
      openaiSkipped: true,
      openaiSkipReason: reason
    }
  }

  try {
    emit('sbs-start', {
      tenantName: tenant.tenantName,
      activeLearningCount: 0,
      mode: 'modelcompare',
      openaiEnabled: openaiConfigured
    })
    const cheapOpts = { cheapMode: isCheapMode(req), openaiApiKey: openaiOptionKey || undefined }

    if (!aborted) {
      emit('sbs-progress', { side: 'raw', percent: 1, message: 'Claude API engaged' })
      if (openaiConfigured) {
        emit('sbs-progress', { side: 'beefed', percent: 1, message: 'OpenAI API engaged' })
      } else {
        emit('sbs-progress', {
          side: 'beefed',
          percent: 5,
          message: 'OpenAI skipped — no key (set OPENAI_API_KEY or openai.key on the server)'
        })
      }
    }

    const claudePromise = analyzeTenant(tenant, tenant.files, ({ percent, message }) => {
      if (!aborted) {
        emit('sbs-progress', {
          side: 'raw',
          percent,
          message: message ? `Claude · ${message}` : 'Claude API engaged'
        })
      }
    }, cheapOpts)

    const openaiPromise = (async () => {
      if (!openaiConfigured) {
        return skippedOpenaiResult('No OpenAI key (OPENAI_API_KEY or openai.key on server)')
      }
      try {
        return await openaiAnalyzeTenant(tenant, tenant.files, ({ percent, message }) => {
          if (!aborted) emit('sbs-progress', { side: 'beefed', percent, message })
        }, cheapOpts)
      } catch (openaiErr) {
        console.error('[modelcompare] OpenAI failed:', openaiErr.message)
        if (!aborted) {
          emit('sbs-progress', {
            side: 'beefed',
            percent: 100,
            message: `OpenAI error: ${openaiErr.message}`
          })
        }
        return {
          tenantNameInDocuments: tenant.tenantName,
          mostRecentDocumentDate: null,
          leaseExpirationDate: null,
          findings: [
            {
              checkType: 'REFERENCED_DOC',
              severity: 'HIGH',
              missingDocument: 'OpenAI API run',
              comment: String(openaiErr.message || 'OpenAI request failed'),
              evidence: ''
            }
          ],
          allClear: false,
          openaiError: true
        }
      }
    })()

    const [claudeResult, openaiResult] = await Promise.all([claudePromise, openaiPromise])

    if (!aborted) {
      emit('sbs-complete', {
        tenantName: tenant.tenantName,
        raw: claudeResult,
        beefed: openaiResult,
        activeLearnings: [],
        mode: 'modelcompare'
      })
    }
  } catch (err) {
    console.error('[modelcompare]', err)
    if (!aborted) emit('sbs-error', { error: err.message })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

/** Keep OpenAI Test Lab SSE `sbs-complete` under typical proxy/browser line limits (large PDF folders). */
function slimOpenAiTestMetaForSse(meta) {
  if (meta == null || typeof meta !== 'object') return meta
  let m
  try {
    m = JSON.parse(JSON.stringify(meta))
  } catch {
    return { note: 'Pipeline metadata could not be cloned for the stream' }
  }
  if (Array.isArray(m.batches)) {
    m.batches = m.batches.map(b => ({
      batchIndex: b.batchIndex,
      logicalGroup: b.logicalGroup,
      pdfCount: b.pdfCount,
      approxBase64Chars: b.approxBase64Chars,
      note: b.note,
      filenameCount: Array.isArray(b.filenames) ? b.filenames.length : 0
    }))
  }
  if (Array.isArray(m.nativePdfFiles) && m.nativePdfFiles.length > 48) {
    const n = m.nativePdfFiles.length
    m.nativePdfFiles = m.nativePdfFiles.slice(0, 48)
    m.nativePdfFilesNote = `List truncated (${n} files — first 48 shown)`
  }
  try {
    const json = JSON.stringify(m)
    if (json.length > 350_000) {
      return {
        api: m.api,
        model: m.model,
        cheapMode: m.cheapMode,
        openaiKeySource: m.openaiKeySource,
        analysisPath: m.analysisPath,
        tenantFilesTotal: m.tenantFilesTotal,
        pdfBatchesPlanned: m.pdfBatchesPlanned,
        apiCallsForOpenAI: m.apiCallsForOpenAI,
        mergePasses: m.mergePasses,
        note:
          'Pipeline metadata was very large and was trimmed so results can reach the browser. Check server logs for the full run.',
        trimmedJsonCharsApprox: json.length
      }
    }
  } catch {
    return { note: 'Pipeline metadata failed JSON check — see server logs' }
  }
  return m
}

// ═══════════════════════════════════════════════════════════
// GET /api/openaitest — OpenAI only (debug pipeline; no Claude)
// ═══════════════════════════════════════════════════════════
app.get('/api/openaitest', async (req, res) => {
  const { sessionId, tenantId } = req.query
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const tenant = tenantId
    ? session.tenants.find(t => t.id === tenantId)
    : session.tenants[0]
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()

  const cloneJsonSafe = (obj, label) => {
    if (obj == null) return null
    try {
      return JSON.parse(JSON.stringify(obj))
    } catch (e) {
      console.warn(`[openaitest] ${label} not JSON-cloneable`, e)
      return {
        note: `${label} omitted (not serializable)`,
        error: String(e?.message || e)
      }
    }
  }
  const emit = (event, data) => {
    let payload
    try {
      payload = JSON.stringify(data)
    } catch (serErr) {
      console.error('[openaitest] SSE JSON.stringify failed', event, serErr)
      if (event === 'sbs-complete') {
        const fallback = {
          tenantName: tenant.tenantName,
          mode: 'openaitest',
          openaiTestMeta: {
            api: 'OpenAI Responses API',
            error: 'Server could not serialize the full result for SSE.',
            stringifyMessage: String(serErr?.message || serErr)
          },
          raw: {
            tenantNameInDocuments: tenant.tenantName,
            findings: [],
            allClear: true,
            openaiTestPlaceholder: true
          },
          beefed: {
            tenantNameInDocuments: tenant.tenantName,
            mostRecentDocumentDate: null,
            leaseExpirationDate: null,
            findings: [
              {
                checkType: 'REFERENCED_DOC',
                severity: 'HIGH',
                missingDocument: 'Stream serialization error',
                comment: String(serErr?.message || serErr),
                evidence: 'Check server logs for [openaitest] SSE JSON.stringify failed'
              }
            ],
            allClear: false,
            openaiError: true
          },
          activeLearnings: []
        }
        try {
          res.write(`event: sbs-complete\ndata: ${JSON.stringify(fallback)}\n\n`)
        } catch (e2) {
          console.error('[openaitest] fallback sbs-complete failed', e2)
          try {
            res.write(
              `event: sbs-error\ndata: ${JSON.stringify({ error: 'Results could not be sent over the stream' })}\n\n`
            )
          } catch {}
        }
      } else {
        try {
          res.write(
            `event: sbs-error\ndata: ${JSON.stringify({ error: 'Server stream encoding failed' })}\n\n`
          )
        } catch {}
      }
      return
    }
    try {
      res.write(`event: ${event}\ndata: ${payload}\n\n`)
    } catch (writeErr) {
      console.error('[openaitest] SSE write failed', event, writeErr)
    }
  }
  /* Shorter ping helps proxies (e.g. Railway) keep the SSE alive during long OpenAI calls. */
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 5000)
  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  const { configured: openaiConfigured, optionKey: openaiOptionKey } = resolveSessionOpenAi(session)

  try {
    emit('sbs-start', {
      tenantName: tenant.tenantName,
      activeLearningCount: 0,
      mode: 'openaitest',
      openaiEnabled: openaiConfigured
    })
    const cheapOpts = {
      cheapMode: isCheapMode(req),
      includeDebug: true,
      openaiApiKey: openaiOptionKey || undefined
    }

    if (!aborted) {
      emit('sbs-progress', {
        side: 'raw',
        percent: 0,
        message: 'OpenAI-only test — Claude not called'
      })
      if (openaiConfigured) {
        emit('sbs-progress', { side: 'beefed', percent: 2, message: 'OpenAI: starting…' })
      } else {
        emit('sbs-progress', {
          side: 'beefed',
          percent: 100,
          message: 'No OpenAI key — set OPENAI_API_KEY or openai.key on the server'
        })
      }
    }

    if (!openaiConfigured) {
      if (!aborted) {
        emit('sbs-complete', {
          tenantName: tenant.tenantName,
          mode: 'openaitest',
          openaiTestMeta: {
            api: 'OpenAI Responses API',
            error: 'No OpenAI key — set OPENAI_API_KEY or openai.key on the server.'
          },
          raw: {
            tenantNameInDocuments: tenant.tenantName,
            findings: [],
            allClear: true,
            openaiTestPlaceholder: true
          },
          beefed: {
            tenantNameInDocuments: tenant.tenantName,
            mostRecentDocumentDate: null,
            leaseExpirationDate: null,
            findings: [
              {
                checkType: 'SPECIAL_AGREEMENT',
                severity: 'LOW',
                missingDocument: 'OpenAI API',
                comment:
                  'Set OPENAI_API_KEY (Railway Variables or .env) or create openai.key next to package.json, then restart the server.',
                evidence: ''
              }
            ],
            allClear: false,
            openaiSkipped: true
          },
          activeLearnings: []
        })
      }
    } else {
      const openaiResult = await openaiAnalyzeTenant(
        tenant,
        tenant.files,
        ({ percent, message }) => {
          if (!aborted) emit('sbs-progress', { side: 'beefed', percent, message })
        },
        cheapOpts
      )

      const meta = openaiResult._openaiDebug
      delete openaiResult._openaiDebug
      const openaiTestMeta = slimOpenAiTestMetaForSse(
        meta == null
          ? { note: 'Debug metadata missing' }
          : cloneJsonSafe(meta, 'Pipeline metadata') || { note: 'Debug metadata missing' }
      )

      if (!aborted) {
        emit('sbs-complete', {
          tenantName: tenant.tenantName,
          mode: 'openaitest',
          openaiTestMeta,
          raw: {
            tenantNameInDocuments: tenant.tenantName,
            findings: [],
            allClear: true,
            openaiTestPlaceholder: true
          },
          beefed: openaiResult,
          activeLearnings: []
        })
      }
    }
  } catch (err) {
    console.error('[openaitest]', err)
    if (!aborted) {
      const msg = err?.message != null ? String(err.message) : String(err)
      emit('sbs-complete', {
        tenantName: tenant.tenantName,
        mode: 'openaitest',
        openaiTestMeta: {
          api: 'OpenAI Responses API',
          error: msg
        },
        raw: {
          tenantNameInDocuments: tenant.tenantName,
          findings: [],
          allClear: true,
          openaiTestPlaceholder: true
        },
        beefed: {
          tenantNameInDocuments: tenant.tenantName,
          mostRecentDocumentDate: null,
          leaseExpirationDate: null,
          findings: [
            {
              checkType: 'REFERENCED_DOC',
              severity: 'HIGH',
              missingDocument: 'OpenAI Test Lab run failed',
              comment: msg,
              evidence:
                'See server logs [openaitest]. Confirm API key, model access, and PDF size limits.'
            }
          ],
          allClear: false,
          openaiError: true
        },
        activeLearnings: []
      })
    }
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ═══════════════════════════════════════════════════════════
// POST /api/sidebyside/verdict — Dr. Verdict on Raw vs Beefed-Up
// ═══════════════════════════════════════════════════════════

app.post('/api/sidebyside/verdict', async (req, res) => {
  try {
    const { rawResult, beefedResult, activeLearnings, tenantName, cheapMode, mode } = req.body
    if (!rawResult || !beefedResult) return res.status(400).json({ error: 'rawResult and beefedResult are required' })

    const { evaluateSideBySide } = await import('./lib/gym-trainer.js')
    const verdict = await evaluateSideBySide({ rawResult, beefedResult, activeLearnings, tenantName, cheapMode: !!cheapMode, mode })

    res.json({ verdict })
  } catch (err) {
    console.error('[sidebyside/verdict]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// POST /api/cook  — Generate Excel report
// ═══════════════════════════════════════════════════════════

app.post('/api/cook', async (req, res) => {
  try {
    const { sessionId } = req.body
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    // Compile findings for all tenants
    const allFindings = session.tenants.map(tenant => ({
      tenant,
      result: session.findings.get(tenant.id) || {
        tenantNameInDocuments: tenant.tenantName,
        findings: [{
          checkType: 'REFERENCED_DOC',
          severity: 'HIGH',
          missingDocument: 'Lease and any amendments.',
          comment: 'No analysis results found for this tenant — folder may not have been scanned.',
          evidence: 'N/A'
        }],
        allClear: false
      }
    }))

    const outputPath = path.join(OUTPUTS_DIR, `${sessionId}.xlsx`)
    await generateReport(allFindings, outputPath)

    res.json({
      downloadUrl: `/api/download/${sessionId}`,
      tenantCount:   session.tenants.length,
      findingCount:  allFindings.reduce((s, t) => s + (t.result?.findings?.length || 0), 0)
    })

  } catch (err) {
    console.error('[cook] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// GET /api/download/:sessionId  — Stream Excel file
// ═══════════════════════════════════════════════════════════

app.get('/api/download/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const outputPath = path.join(OUTPUTS_DIR, `${sessionId}.xlsx`)

  if (!fs.existsSync(outputPath)) {
    return res.status(404).json({ error: 'Report not found. Please cook your prey first.' })
  }

  const date = new Date().toLocaleDateString('en-US').replace(/\//g, '-')
  const filename = `Todd Jr - Missing Documents Report - ${date}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

  const stream = fs.createReadStream(outputPath)
  stream.pipe(res)
  stream.on('error', err => {
    console.error('[download] Error:', err)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  })
})

// POST /api/download/tenant — generate Excel for a single completed tenant
app.post('/api/download/tenant', express.json({ limit: '2mb' }), async (req, res) => {
  const { tenant, result } = req.body
  if (!tenant || !result) return res.status(400).json({ error: 'Missing tenant or result' })
  try {
    const tmpPath = path.join(OUTPUTS_DIR, `tenant-${randomUUID()}.xlsx`)
    await generateReport([{ tenant, result }], tmpPath)
    const date     = new Date().toLocaleDateString('en-US').replace(/\//g, '-')
    const filename = `Todd Jr - ${tenant.tenantName} - ${date}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    const stream = fs.createReadStream(tmpPath)
    stream.pipe(res)
    stream.on('finish', () => { try { fs.unlinkSync(tmpPath) } catch {} })
    stream.on('error',  () => { if (!res.headersSent) res.status(500).end() })
  } catch (err) {
    console.error('[download/tenant]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// GYM TEACHER — serve raw PDF files to browser PDF.js viewer
// ═══════════════════════════════════════════════════════════

// POST /api/gym/register-files — store local file buffers in session for gym use
// Called by client before opening /api/gym/analyze when files are in browser RAM
app.post('/api/gym/register-files', express.json({ limit: '500mb' }), (req, res) => {
  const { sessionId, tenantId, files } = req.body
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const tenant = session.tenants.find(t => t.id === tenantId)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })
  tenant.files = (files || []).map(f => ({
    originalName: f.name,
    buffer:       Buffer.from(f.base64, 'base64'),
    size:         f.size,
    isPDF:        f.name.toLowerCase().endsWith('.pdf')
  }))
  res.json({ ok: true, fileCount: tenant.files.length })
})

// POST /api/target/free-tenant-files — drop PDF buffers for a tenant the reviewer just finished
// Called by client when reviewer moves on — frees RAM without ending the session
app.post('/api/target/free-tenant-files', (req, res) => {
  const { sessionId, tenantId } = req.body || {}
  if (sessionId && tenantId) {
    const session = sessions.get(sessionId)
    const tenant  = session?.tenants.find(t => t.id === tenantId)
    if (tenant?.files?.length) {
      const freed = tenant.files.reduce((n, f) => n + (f.buffer?.length || 0), 0)
      tenant.files.forEach(f => { delete f.buffer })
      console.log(`[mem] freed ~${Math.round(freed / 1024 / 1024)}MB for tenant ${tenantId}`)
    }
  }
  res.json({ ok: true })
})

app.get('/api/gym/file/:sessionId/:tenantId/:fileIndex', (req, res) => {
  const { sessionId, tenantId, fileIndex } = req.params
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).end()
  const tenant = session.tenants.find(t => t.id === tenantId)
  if (!tenant) return res.status(404).end()
  const idx = parseInt(fileIndex)
  if (isNaN(idx) || idx < 0 || idx >= tenant.files.length) return res.status(404).end()
  const file = tenant.files[idx]
  if (!file) return res.status(404).end()

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`)
  res.setHeader('Access-Control-Allow-Origin', '*')

  // Local session: file is in memory buffer
  if (file.buffer) return res.send(file.buffer)

  // Disk-based session: stream from file path
  if (!file.diskPath || !fs.existsSync(file.diskPath)) return res.status(404).end()
  const stream = fs.createReadStream(file.diskPath)
  stream.pipe(res)
  stream.on('error', () => { if (!res.headersSent) res.status(404).end() })
})

// ═══════════════════════════════════════════════════════════
// GYM TEACHER — run analysis via SSE (same engine as main hunt)
// ═══════════════════════════════════════════════════════════

app.get('/api/gym/analyze', async (req, res) => {
  const { sessionId, tenantId, keyIndex, tp3 } = req.query
  const useTP3 = tp3 === '1'
  const preferredKeyIdx = (keyIndex !== undefined && !isNaN(parseInt(keyIndex, 10))) ? parseInt(keyIndex, 10) : undefined
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const tenant = tenantId
    ? session.tenants.find(t => t.id === tenantId)
    : session.tenants[0]
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()

  const emit = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
  }
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)
  let aborted = false
  req.on('close', () => { aborted = true; clearInterval(heartbeat) })

  const analyzeStartedAt = Date.now()
  logEvent('analyze.start', {
    sessionId,
    tenantId: tenant.id,
    tenantName: tenant.tenantName,
    folderName: tenant.folderName,
    fileCount: (tenant.files || []).length,
    tp3: !!useTP3,
  })

  try {
    emit('gym-start', { tenantName: tenant.tenantName, folderName: tenant.folderName })
    const onProgress = ({ percent, message }) => {
      if (!aborted) emit('gym-progress', { percent, message })
    }
    // Gym mode uses the extended reasoning schema
    // If this session has active learning juice rules (Target Practice), inject them.
    // Always inject active learnings so MT/gym sees the same trained model as the main hunt.
    const juiceRules       = session.targetJuiceRules || []
    const activeLearnings  = readLearnings().filter(l => l.active)
    const result = await gymAnalyzeTenant(tenant, tenant.files, onProgress, { cheapMode: isCheapMode(req), juiceRules, activeLearnings, preferredKeyIdx })

    // ── TP3 post-processing pipeline ────────────────────────────────────────
    // When the client invoked this endpoint with &tp3=1, run the Generator's
    // findings through the full TP3 pipeline before sending them back:
    //   1. Universal Document Verifier (Opus) — re-checks every finding type
    //      against the actual PDFs (executes signature checks for EXECUTION,
    //      folder-manifest matching for MISSING_DOCUMENT, lease-PDF scanning
    //      for MISSING_EXHIBIT). Drops verified false positives.
    //   2. Todd Filter (Sonnet, F1–F38 + folder manifest + 96 rules).
    //   3. Senior Lawyer Self-Review (Opus) — final actionability gate.
    if (useTP3 && result.findings && result.findings.length > 0) {
      try {
        const { tp3VerifyAllFindings, filterFindingsForRelevance, tp3SeniorLawyerReview } = await import('./lib/claude.js')
        const before = result.findings.length

        if (!aborted) emit('gym-progress', { percent: 92, message: 'TP3 — Universal verifier (Opus)...' })
        let verified = await tp3VerifyAllFindings(result.findings, tenant.files)

        if (!aborted) emit('gym-progress', { percent: 96, message: 'TP3 — Todd filter...' })
        let toddFiltered = verified
        if (activeLearnings.length > 0) {
          toddFiltered = await filterFindingsForRelevance(verified, activeLearnings, tenant.tenantName, tenant.files)
        }

        if (!aborted) emit('gym-progress', { percent: 99, message: 'TP3 — Senior lawyer review (Opus)...' })
        const finalFindings = await tp3SeniorLawyerReview(toddFiltered, tenant.tenantName)

        console.log(`[gym/analyze tp3] ${tenant.tenantName}: ${before} → verified ${verified.length} → Todd ${toddFiltered.length} → lawyer ${finalFindings.length}`)
        result.findings = finalFindings
        result.allClear = finalFindings.length === 0
      } catch (err) {
        console.warn(`[gym/analyze tp3] post-pipeline failed for ${tenant.tenantName}: ${err.message} — returning raw findings`)
      }
    }

    // ── Always-on self-suppression + bad-date-math filters ──────────────
    // Runs BEFORE finding-level dedup. Catches the lawyer-reported pattern
    // where the model writes "SUPPRESSED" / "FALSE POSITIVE" / "fully executed"
    // inside its own finding text but emits it anyway. Also catches the
    // "expiring within 90 days" claim when the math doesn't add up.
    if (Array.isArray(result.findings) && result.findings.length > 0) {
      try {
        const {
          dropSelfSuppressedFindings, dropBadDateMathFindings, dropFindingsInFolderManifest,
          dropFolderLabelNameMismatch, dropTerminatedReferencedDocs,
          dropContemplatedFormDocs, dropCorporateTransactionDocs,
          dropUnevidencedForwardCurrency
        } = await import('./lib/claude.js')
        const before = result.findings.length
        const droppedBy = []
        const onDrop = (filter) => (f, reason) => droppedBy.push({ filter, reason, missingDoc: (f.missingDocument || '').slice(0, 120), checkType: f.checkType })
        result.findings = dropSelfSuppressedFindings(result.findings, { tenantName: tenant.tenantName, source: useTP3 ? 'tp3' : 'tp2', onDrop: onDrop('self_suppression') })
        result.findings = dropBadDateMathFindings(result.findings,    { tenantName: tenant.tenantName, onDrop: onDrop('bad_date_math') })
        result.findings = dropFindingsInFolderManifest(result.findings, tenant.files, { tenantName: tenant.tenantName, onDrop: onDrop('folder_manifest') })
        // Lawyer test 2026-08-03 regressions: FP83-16 (folder label vs entity
        // name, a prompt rule the model ignored) and the Bank of Houston
        // terminated-document FP surfaced in blind loop 1.
        result.findings = dropFolderLabelNameMismatch(result.findings, { tenantName: tenant.tenantName, folderName: tenant.folderName, onDrop: onDrop('folder_label_name') })
        result.findings = dropTerminatedReferencedDocs(result.findings, { tenantName: tenant.tenantName, onDrop: onDrop('terminated_reference') })
        // Blind loop 2 regressions: FP83-19 (blank Exhibit C commencement letter
        // re-emerged relabeled as MISSING_DOCUMENT) and the Bank of Houston
        // "Bank Merger Agreement" corporate-document FP.
        result.findings = dropContemplatedFormDocs(result.findings,    { tenantName: tenant.tenantName, onDrop: onDrop('contemplated_form_doc') })
        result.findings = dropCorporateTransactionDocs(result.findings, { tenantName: tenant.tenantName, onDrop: onDrop('corporate_transaction_doc') })
        // Blind loop 3: LEASE_CURRENCY is a reconciliation check, not a forecast.
        // No rent roll reaches this path (that lives in the rr-* modules), so the
        // model falls back to "chain end within 90 days of today" — which fired on
        // Mayer at 89 days for a file whose newest lease was signed four months
        // ago and has not yet commenced. Two blind runs on identical facts split
        // on it. Drops forward-looking findings with no evidenced shortfall.
        result.findings = dropUnevidencedForwardCurrency(result.findings, { tenantName: tenant.tenantName, onDrop: onDrop('forward_looking_currency') })
        if (result.findings.length !== before) {
          console.log(`[gym/analyze] ${tenant.tenantName}: pre-dedup filters ${before} → ${result.findings.length}`)
        }
        for (const d of droppedBy) {
          logEvent('analyze.filter_drop', { sessionId, tenantId: tenant.id, tenantName: tenant.tenantName, ...d })
        }
      } catch (err) {
        console.warn(`[gym/analyze] self-suppress/date-math/manifest filter failed: ${err.message} — keeping findings as-is`)
      }
    }

    // ── Finding-level deduplication ──────────────────────────────────────
    // Fixes the StudyPro-2× / MedStar-2× duplicate-rows bug. Even after tenant
    // dedup, the model occasionally emits two byte-identical finding rows for
    // the same defect (e.g., Tenant signature and Landlord signature treated
    // as separate findings for the same already-signed counterpart). Dedup on
    // (checkType, missingDoc[:200], severity) before assigning IDs.
    const findingDedupKey = (f) => [
      f.checkType || '',
      (f.missingDocument || '').substring(0, 200),
      f.severity || ''
    ].join('||').toLowerCase().replace(/\s+/g, ' ').trim()
    const seenFindingKeys = new Set()
    const dedupedFindings = []
    for (const f of (result.findings || [])) {
      const k = findingDedupKey(f)
      if (seenFindingKeys.has(k)) {
        console.log(`[gym/analyze] Dropped duplicate finding for ${tenant.tenantName}: ${(f.missingDocument || '').substring(0, 80)}`)
        continue
      }
      seenFindingKeys.add(k)
      dedupedFindings.push(f)
    }
    result.findings = dedupedFindings

    // Attach stable IDs to findings for feedback tracking
    const findingsWithIds = (result.findings || []).map((f, i) => ({ ...f, id: `finding-${i}` }))

    // Build file manifest so frontend can request each PDF
    const files = tenant.files.map((f, i) => ({
      name: f.originalName,
      index: i,
      url: `/api/gym/file/${sessionId}/${tenant.id}/${i}`,
      isPDF: f.originalName.toLowerCase().endsWith('.pdf')
    }))

    if (!aborted) {
      emit('gym-complete', {
        findings: findingsWithIds,
        allClear: result.allClear,
        tenantNameInDocuments: result.tenantNameInDocuments,
        files,
        tenantId: tenant.id,
        tenantName: tenant.tenantName,
        folderName: tenant.folderName,
        tokenUsage: result._tokenUsage || null
      })
    }
    logEvent('analyze.complete', {
      sessionId,
      tenantId: tenant.id,
      tenantName: tenant.tenantName,
      folderName: tenant.folderName,
      findingsCount: findingsWithIds.length,
      allClear: !!result.allClear,
      ms: Date.now() - analyzeStartedAt,
      tp3: !!useTP3,
      findingTypes: findingsWithIds.map(f => f.checkType).filter(Boolean),
      tokenUsage: result._tokenUsage || null,
    })
  } catch (err) {
    console.error('[gym/analyze]', err)
    logEvent('analyze.error', {
      sessionId,
      tenantId: tenant.id,
      tenantName: tenant.tenantName,
      error: err.message,
      failedKeyIdx: getLastGymKeyIdx(),
      ms: Date.now() - analyzeStartedAt,
    })
    // Include failedKeyIdx so the client can mark that key as rate-limited and rotate on retry
    if (!aborted) emit('gym-error', { error: err.message, failedKeyIdx: getLastGymKeyIdx() })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// ═══════════════════════════════════════════════════════════
// GYM TEACHER — learnings persistence (readLearnings at top of file)
// ═══════════════════════════════════════════════════════════

app.get('/api/gym/learnings', (_req, res) => res.json(readLearnings()))

app.patch('/api/gym/learnings/:id', (req, res) => {
  const learnings = readLearnings()
  const l = learnings.find(x => x.id === req.params.id)
  if (!l) return res.status(404).json({ error: 'Not found' })
  l.active = !!req.body.active
  writeLearnings(learnings)
  res.json(l)
})

app.delete('/api/gym/learnings/:id', (req, res) => {
  const learnings = readLearnings().filter(x => x.id !== req.params.id)
  writeLearnings(learnings)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════
// TARGET PRACTICE — active learning synthesis + model management
// ═══════════════════════════════════════════════════════════

// POST /api/target/synthesize — run synthesis after a tenant review, update session juice rules
app.post('/api/target/synthesize', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { sessionId, rejectedFindings = [], confirmedFindings = [], annotations = [], currentRules = [] } = req.body
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const result = await synthesizeActiveLearning({ rejectedFindings, confirmedFindings, annotations, currentRules })
    // Store updated rules in session for the next /api/gym/analyze call
    session.targetJuiceRules = result.rules || []
    res.json({ ok: true, rules: session.targetJuiceRules, summary: result.summary || '' })
  } catch (err) {
    console.error('[target/synthesize]', err)
    res.status(500).json({ error: err.message || 'Synthesis failed' })
  }
})

// POST /api/target/deep-synthesize — end-of-session deep synthesis for TP 2.0
app.post('/api/target/deep-synthesize', express.json({ limit: '32mb' }), async (req, res) => {
  try {
    const { sessionId, tenantFeedbacks = [] } = req.body
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    if (tenantFeedbacks.length === 0) return res.status(400).json({ error: 'No feedback provided' })

    // Persist raw feedback to disk immediately — so synthesis can always be retried
    // even if the Claude call fails or the session expires.
    try {
      const feedbackDir = process.env.ISAAC_SAVE_DIR
        ? path.join(process.env.ISAAC_SAVE_DIR, 'tp2-feedback')
        : path.join(OUTPUTS_DIR, 'tp2-feedback')
      fs.mkdirSync(feedbackDir, { recursive: true })
      const feedbackFile = path.join(feedbackDir, `${sessionId}.json`)
      fs.writeFileSync(feedbackFile, JSON.stringify({ sessionId, tenantFeedbacks, savedAt: new Date().toISOString() }, null, 2))
      console.log(`[deep-synthesize] feedback saved to disk: ${feedbackFile} (${tenantFeedbacks.length} tenants)`)
    } catch (saveErr) {
      console.warn('[deep-synthesize] could not persist feedback to disk:', saveErr.message)
      // Non-fatal — still attempt synthesis
    }

    const result = await synthesizeDeepLearning({ tenantFeedbacks })
    // Store rules in session so they can be loaded if user runs TP 1.0 after
    session.targetJuiceRules = result.rules || []
    res.json({ ok: true, rules: session.targetJuiceRules, summary: result.summary || '' })
  } catch (err) {
    console.error('[target/deep-synthesize]', err)
    res.status(500).json({ error: err.message || 'Deep synthesis failed' })
  }
})

// POST /api/target/retry-synthesis — re-run deep synthesis from persisted feedback file
// Body: { sessionId } — reads the saved feedback JSON and retries synthesizeDeepLearning
app.post('/api/target/retry-synthesis', express.json({ limit: '1kb' }), async (req, res) => {
  try {
    const { sessionId } = req.body || {}
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

    const feedbackDir = process.env.ISAAC_SAVE_DIR
      ? path.join(process.env.ISAAC_SAVE_DIR, 'tp2-feedback')
      : path.join(OUTPUTS_DIR, 'tp2-feedback')
    const feedbackFile = path.join(feedbackDir, `${sessionId}.json`)

    if (!fs.existsSync(feedbackFile)) return res.status(404).json({ error: 'No saved feedback for this session' })

    const saved = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'))
    const tenantFeedbacks = saved.tenantFeedbacks || []
    if (tenantFeedbacks.length === 0) return res.status(400).json({ error: 'Saved feedback is empty' })

    console.log(`[retry-synthesis] retrying for sessionId=${sessionId}, ${tenantFeedbacks.length} tenants`)
    const result = await synthesizeDeepLearning({ tenantFeedbacks })
    res.json({ ok: true, rules: result.rules || [], summary: result.summary || '', retried: true })
  } catch (err) {
    console.error('[retry-synthesis]', err)
    res.status(500).json({ error: err.message || 'Retry synthesis failed' })
  }
})

// POST /api/target/load-model — load a saved juice model into session as starting rules
app.post('/api/target/load-model', express.json({ limit: '500kb' }), (req, res) => {
  try {
    const { sessionId, rules = [], modelId, modelName } = req.body
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    session.targetJuiceRules   = rules
    session.targetLoadedModel  = { id: modelId, name: modelName }
    res.json({ ok: true, ruleCount: rules.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE session juice rules (reset to fresh at start of Target Practice)
app.post('/api/target/reset-juice', express.json({ limit: '1kb' }), (req, res) => {
  const { sessionId } = req.body
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  session.targetJuiceRules  = []
  session.targetLoadedModel = null
  res.json({ ok: true })
})

// ── Juice Model persistence ────────────────────────────────
const JUICE_MODELS_SUBDIR = 'juice-models'
function resolveJuiceModelsDir() {
  const base = process.env.ISAAC_SAVE_DIR
    ? path.join(process.env.ISAAC_SAVE_DIR, JUICE_MODELS_SUBDIR)
    : path.join(OUTPUTS_DIR, JUICE_MODELS_SUBDIR)
  fs.mkdirSync(base, { recursive: true })
  return base
}
function readJuiceIndex(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'models-index.json'), 'utf8')) } catch { return [] }
}
function writeJuiceIndex(dir, entries) {
  fs.writeFileSync(path.join(dir, 'models-index.json'), JSON.stringify(entries, null, 2))
}

// POST /api/target/save-model
app.post('/api/target/save-model', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const { rules = [], reviewerName = '', comment = '', correctionsByTenant = [],
            sessionId, tenantCount = 0, uploadSessionId, parentModelId = null,
            parentModelName = null, deepSynthesis = false, modelName } = req.body
    const dir = resolveJuiceModelsDir()
    const id  = randomUUID()
    const now = new Date().toISOString()
    const _now = new Date()
    const date = _now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const time = _now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const name = modelName || `${reviewerName || 'Model'} — ${date} ${time}`

    const totalCorrections = correctionsByTenant.reduce((s, n) => s + n, 0)
    const errorReduction   = tenantCount > 0 ? Math.round((totalCorrections / Math.max(tenantCount * 3, 1)) * 100) : 0

    const meta = { id, name, reviewerName, comment, tenantCount, savedAt: now,
                   deepSynthesis: !!deepSynthesis, correctionsByTenant, errorReduction,
                   parentModelId, parentModelName, sessionId, uploadSessionId, ruleCount: rules.length }
    const full = { ...meta, rules }

    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(full, null, 2))

    const idx = readJuiceIndex(dir)
    idx.push(meta)
    writeJuiceIndex(dir, idx)

    console.log(`[save-model] saved: ${name} (${rules.length} rules, id=${id})`)
    res.json({ ok: true, id, name, errorReduction })
  } catch (err) {
    console.error('[save-model]', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/target/models — list all saved juice models (no rules, lightweight)
app.get('/api/target/models', (_req, res) => {
  try {
    const dir = resolveJuiceModelsDir()
    const idx = readJuiceIndex(dir)
    res.json(idx.slice().reverse())  // newest first
  } catch (err) {
    console.error('[get-models]', err)
    res.json([])
  }
})

// GET /api/target/models/:id — full model with rules
app.get('/api/target/models/:id', (req, res) => {
  try {
    const dir  = resolveJuiceModelsDir()
    const file = path.join(dir, `${req.params.id}.json`)
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Model not found' })
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    console.error('[get-model-id]', err)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/target/models/:id
app.delete('/api/target/models/:id', (req, res) => {
  try {
    const dir  = resolveJuiceModelsDir()
    const file = path.join(dir, `${req.params.id}.json`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    const idx  = readJuiceIndex(dir).filter(m => m.id !== req.params.id)
    writeJuiceIndex(dir, idx)
    res.json({ ok: true })
  } catch (err) {
    console.error('[delete-model]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Target Practice session report storage ─────────────────
const TP_REPORTS_SUBDIR  = 'target-session-reports'
const TP_REPORTS_MANIFEST = 'tp-manifest.json'

function resolveTPReportsDir() {
  if (process.env.ISAAC_SAVE_DIR) return path.join(process.env.ISAAC_SAVE_DIR, TP_REPORTS_SUBDIR)
  const primary = path.join(OUTPUTS_DIR, TP_REPORTS_SUBDIR)
  try { fs.mkdirSync(primary, { recursive: true }); return primary } catch {}
  const fallback = path.join(os.tmpdir(), 'todd-tp-reports')
  fs.mkdirSync(fallback, { recursive: true })
  return fallback
}

function readTPManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, TP_REPORTS_MANIFEST), 'utf8')) } catch { return [] }
}
function writeTPManifest(dir, entries) {
  fs.writeFileSync(path.join(dir, TP_REPORTS_MANIFEST), JSON.stringify(entries.slice(-100), null, 2))
}

// POST /api/target/straight-excel — run-and-download: no reviewer, just findings → Excel
app.post('/api/target/straight-excel', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { tenantResults = [] } = req.body
    const { generateReport } = await import('./lib/reporter.js')

    // Map client payload to generateReport's [{tenant, result}] format
    const allFindings = tenantResults.map(r => ({
      tenant: {
        tenantName: r.tenantName || r.folderName || 'Unknown',
        property:   r.property  || '',
        suite:      r.suite     || '',
      },
      result: r.error ? null : {
        findings:                r.findings  || [],
        allClear:                !!r.allClear,
        tenantNameInDocuments:   r.tenantName,
      }
    }))

    const tmpPath = path.join(UPLOADS_DIR, `straight-excel-${Date.now()}.xlsx`)
    await generateReport(allFindings, tmpPath)

    const stat = fs.statSync(tmpPath)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="Missing-Documents-${new Date().toISOString().slice(0, 10)}.xlsx"`)
    res.setHeader('Content-Length', stat.size)
    const stream = fs.createReadStream(tmpPath)
    stream.pipe(res)
    stream.on('end', () => { try { fs.unlinkSync(tmpPath) } catch {} })
  } catch (err) {
    console.error('[straight-excel]', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/target/download-excel — generate, persist, and stream session Excel
app.post('/api/target/download-excel', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { tenantResults = [], reviewerName = 'Unknown', juiceRules = [], sessionId, uploadSessionId } = req.body
    const { generateTargetPracticeSessionExcel } = await import('./lib/reporter.js')

    // Pull upload diagnostics off the session if we have one — surface any
    // duplicate-tenant merges, empty-tenant drops, or file-count gaps in the
    // Excel so the reviewer sees them without digging through Railway logs.
    //
    // IMPORTANT: `sessionId` here is the REVIEW session ('tp2-…' / 'target-…'),
    // which is minted client-side and is NOT the key that
    // /api/session/register stored the diagnostics under. That key is the
    // UPLOAD session id. Prefer uploadSessionId; fall back to sessionId for
    // older clients that don't send it.
    // Regression this guards: lawyer test 2026-08-03 — every audit report read
    // "Files Uploaded: —" / "No upload diagnostics available", so the
    // file-count reconciliation that exists specifically to catch silently
    // skipped tenants had never actually run in production.
    const sessionRec = (uploadSessionId ? sessions.get(uploadSessionId) : null)
                    || (sessionId       ? sessions.get(sessionId)       : null)
    const uploadDiagnostics = sessionRec?.uploadDiagnostics || null
    if (!uploadDiagnostics) {
      console.warn(`[download-excel] no upload diagnostics found (uploadSessionId=${uploadSessionId || 'none'} sessionId=${sessionId || 'none'}) — Audit tab will show the "older session" placeholder`)
    }

    // Generate to temp first
    const tmpPath = path.join(UPLOADS_DIR, `tp-session-${Date.now()}.xlsx`)
    await generateTargetPracticeSessionExcel({ tenantResults, reviewerName, juiceRules, uploadDiagnostics }, tmpPath)

    // Persist a copy to cloud storage
    try {
      const dir   = resolveTPReportsDir()
      const id    = (sessionId || Date.now().toString())
      const fname = `Target-Practice-${new Date().toISOString().slice(0, 10)}-${id.slice(-6)}.xlsx`
      const dest  = path.join(dir, fname)
      fs.copyFileSync(tmpPath, dest)
      const entries = readTPManifest(dir)
      // Overwrite any existing entry for the same sessionId (idempotent re-saves)
      const existingIdx = entries.findIndex(e => e.sessionId === sessionId)
      const entry = {
        id, filename: fname, savedAt: new Date().toISOString(),
        sessionId: sessionId || null, reviewerName, tenantCount: tenantResults.length
      }
      if (existingIdx >= 0) entries[existingIdx] = entry
      else entries.push(entry)
      writeTPManifest(dir, entries)
    } catch (saveErr) {
      console.warn('[target/download-excel] cloud save failed (non-fatal):', saveErr.message)
    }

    const stat = fs.statSync(tmpPath)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="Target-Practice-${new Date().toISOString().slice(0, 10)}.xlsx"`)
    res.setHeader('Content-Length', stat.size)
    const stream = fs.createReadStream(tmpPath)
    stream.pipe(res)
    stream.on('end', () => { try { fs.unlinkSync(tmpPath) } catch {} })
  } catch (err) {
    console.error('[target/download-excel]', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/target/session-reports — list saved session reports
app.get('/api/target/session-reports', (req, res) => {
  try {
    const dir     = resolveTPReportsDir()
    const entries = readTPManifest(dir)
    res.json({ reports: entries.slice().reverse() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/target/session-reports/:fname — download a saved report
app.get('/api/target/session-reports/:fname', (req, res) => {
  try {
    const dir   = resolveTPReportsDir()
    const fname = path.basename(req.params.fname)   // sanitize — no path traversal
    const fpath = path.join(dir, fname)
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Not found' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    fs.createReadStream(fpath).pipe(res)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/target/session-zip/:uploadSessionId — download uploaded tenant files as ZIP
app.get('/api/target/session-zip/:uploadSessionId', (req, res) => {
  try {
    const uploadSessionId = path.basename(req.params.uploadSessionId)
    const sessionDir = path.join(UPLOADS_DIR, uploadSessionId)
    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({ error: 'Session files not found. Files may have been cleaned up after upload.' })
    }
    const zipName = `session-files-${uploadSessionId.slice(-8)}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
    const archive = archiver('zip', { zlib: { level: 5 } })
    archive.on('error', err => { console.error('[session-zip]', err); res.end() })
    archive.pipe(res)
    archive.directory(sessionDir, false)
    archive.finalize()
  } catch (err) {
    console.error('[session-zip]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// GYM TEACHER — compile feedback into learnings
// ═══════════════════════════════════════════════════════════

app.post('/api/gym/workout-feedback', async (req, res) => {
  try {
    const { sessionId, tenantId, findings, feedbacks, annotations, cheapMode } = req.body
    const session = sessions.get(sessionId)
    const tenant = session?.tenants.find(t => t.id === tenantId)
      || { tenantName: 'Unknown', folderName: 'Unknown' }

    // Telemetry: log reviewer confirm/reject decisions
    try {
      for (const fb of (feedbacks || [])) {
        const verdict = (fb.verdict || fb.decision || '').toLowerCase()
        if (verdict === 'confirm' || verdict === 'accept' || verdict === 'keep' || fb.confirmed === true) {
          logEvent('feedback.confirm', {
            sessionId, tenantId, tenantName: tenant.tenantName,
            findingId: fb.id || fb.findingId,
            checkType: fb.checkType,
            missingDoc: (fb.missingDocument || '').slice(0, 120),
          })
        } else if (verdict === 'reject' || verdict === 'wrong' || verdict === 'drop' || fb.confirmed === false) {
          logEvent('feedback.reject', {
            sessionId, tenantId, tenantName: tenant.tenantName,
            findingId: fb.id || fb.findingId,
            checkType: fb.checkType,
            missingDoc: (fb.missingDocument || '').slice(0, 120),
            reason: (fb.reason || fb.note || fb.reviewerNote || '').slice(0, 240),
          })
        }
      }
    } catch {}

    const { compileWorkoutFeedback } = await import('./lib/gym-trainer.js')
    const result = await compileWorkoutFeedback({
      tenant,
      findings:    findings    || [],
      feedbacks:   feedbacks   || [],
      annotations: annotations || [],
      cheapMode:   !!cheapMode
    })

    const batchId = `gym-${Date.now()}`
    const savedAt = new Date().toISOString()
    const newLearnings = (result.learnings || []).map(l => ({
      ...l,
      id:         randomUUID(),
      created_at: savedAt,
      batchId,
      tenant:     tenant.tenantName,
      active:     false  // inactive by default — user must explicitly activate
    }))

    writeLearnings([...readLearnings(), ...newLearnings])

    if (newLearnings.length > 0) {
      logEvent('learning.created', {
        sessionId, tenantId, tenantName: tenant.tenantName, batchId,
        count: newLearnings.length,
        types: [...new Set(newLearnings.map(l => l.checkType).filter(Boolean))],
      })
    }

    res.json({ learnings: newLearnings, summary: result.summary || '' })
  } catch (err) {
    console.error('[gym/workout-feedback]', err)
    res.status(500).json({ error: err.message })
  }
})



// ═══════════════════════════════════════════════════════════
// RENT ROLL CHEF — in-memory only, nothing written to volume
// ═══════════════════════════════════════════════════════════

app.post('/api/rr/analyze', express.json({ limit: '200mb' }), async (req, res) => {
  const { argusFile, clientFile } = req.body || {}
  if (!argusFile?.base64 || !clientFile?.base64) {
    return res.status(400).json({ error: 'Need argusFile and clientFile with base64 data.' })
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const emit = (ev, d) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`) } catch {} }
  const hb = setInterval(() => { try { res.write(': ping\n\n') } catch { clearInterval(hb) } }, 15000)

  try {
    emit('rr-progress', { stage: 'dough', percent: 10, message: 'Parsing Argus rent roll...' })
    const argusBuf = Buffer.from(argusFile.base64, 'base64')
    const argusData = await parseRRFile(argusBuf, argusFile.name)

    emit('rr-progress', { stage: 'sauce', percent: 30, message: 'Parsing client rent roll...' })
    const clientBuf = Buffer.from(clientFile.base64, 'base64')
    const clientData = await parseRRFile(clientBuf, clientFile.name)

    if (argusData.scanned || clientData.scanned) {
      emit('rr-progress', { stage: 'toppings', percent: 40, message: 'PDF appears scanned — text extraction limited, Claude will do its best...' })
    }

    emit('rr-progress', { stage: 'toppings', percent: 50, message: 'Sending to Claude for standardization & comparison...' })
    const comparison = await analyzeRentRolls(
      { argusText: argusData.text, argusType: argusData.type, clientText: clientData.text, clientType: clientData.type },
      (p) => emit('rr-progress', p)
    )

    emit('rr-progress', { stage: 'oven', percent: 85, message: 'Generating Excel report...' })
    const excelBuf = await generateRRReport(comparison)

    emit('rr-progress', { stage: 'done', percent: 100, message: 'Done!' })
    emit('rr-complete', { comparison, excelBase64: excelBuf.toString('base64') })
  } catch (e) {
    console.error('[rr/analyze]', e)
    emit('rr-error', { error: e.message })
  } finally {
    clearInterval(hb)
    res.end()
  }
})

app.get('/api/rr/analyze', (_req, res) => res.status(405).json({ error: 'Use POST /api/rr/analyze' }))
app.get('/api/rr/download/:sid', (_req, res) => res.status(410).json({ error: 'Downloads are now client-side from base64.' }))

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

// Run tasks with a max concurrency limit to avoid API rate limits
async function runConcurrent(items, limit, fn) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item) await fn(item)
    }
  })
  await Promise.allSettled(workers)
}

function maxSeverity(findings) {
  if (!findings || findings.length === 0) return 'NONE'
  if (findings.some(f => f.severity === 'HIGH'))   return 'HIGH'
  if (findings.some(f => f.severity === 'MEDIUM')) return 'MEDIUM'
  return 'LOW'
}

// ═══════════════════════════════════════════════════════════
// SESSION CLEANUP — runs every 10 minutes
// ═══════════════════════════════════════════════════════════

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000 // 30 minutes
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      // isLocal sessions have no uploadDir (files were in browser RAM, never written to disk)
      if (!session.isLocal && session.uploadDir) {
        try { fs.rmSync(session.uploadDir, { recursive: true, force: true }) } catch {}
      }
      try { fs.rmSync(path.join(OUTPUTS_DIR, `${id}.xlsx`), { force: true }) } catch {}
      sessions.delete(id)
      console.log(`[cleanup] Removed session ${id}`)
    }
  }
}, 10 * 60 * 1000)

// ═══════════════════════════════════════════════════════════
// MASTER TRAINER — self-correcting training loop
// ═══════════════════════════════════════════════════════════

/**
 * Correct answers for the 17 known-mistake tenant folders.
 * Keyed by exact folder name. shouldFind = what the model MUST flag.
 * Parsed from Cheat Sheet.numbers.
 */
const MT_CHEAT_SHEET = {
  'Bank of America': {
    shouldFind: ['Rent Commencement Date Agreement dated 9/25/25 is not executed by Tenant.']
  },
  'China Dragon': {
    shouldFind: ['Document extending Term beyond 5/31/2025.']
  },
  'Mirage Hair ': {
    shouldFind: ['Document extending Term from original End Date (calculated as 1/31/20) to 10/31/23.']
  },
  'Monterey Bay Homes': {
    shouldFind: [
      'Amendment No. 3 dated 8/13/20 is not executed.',
      'Amendment No. 4 dated 7/27/21 is not executed.'
    ]
  },
  'Pho Tastic': {
    shouldFind: [
      'First page of Exhibit E to Lease dated 5/2025.',
      'Exhibit F (Guaranty of Lease) to Lease dated 5/2025.'
    ]
  },
  'Pigtails & Crewcuts': {
    shouldFind: ['Document extending Term beyond 4/2023.']
  },
  'Signworld': {
    shouldFind: [
      'Amendment No. 1, if any. (Only Lease and Amendment No. 3 were received.)',
      'Amendment No. 2, if any. (Only Lease and Amendment No. 3 were received.)'
    ]
  },
  'Sol Palms MedSpa': {
    shouldFind: ['Full copy of Guaranty to Lease dated 12/2025. (Only signature page received.)']
  },
  'Stretch Zone': {
    shouldFind: ['Document extending Term beyond 12/31/25.']
  },
  'Thai E-San': {
    shouldFind: ['Document extending Term beyond 1/2024.']
  },
  'Wells Fargo': {
    shouldFind: ['Document extending Term beyond 11/30/25.']
  },
  'Ground Central': {
    shouldFind: ['Guaranty of License is not executed.']
  },
  'MASONS TENNISMART (BSMT, LOBBY)': {
    shouldFind: [
      'First Rent Abatement Agreement dated 5/2020, referenced in Third Amendment dated 1/18/23. (Internal email received — agreement itself is still missing.)'
    ]
  },
  'Evercore': {
    shouldFind: ['Guaranty of Lease (Exhibit E of Lease dated 7/1/18) is not executed.']
  },
  'BlakeTodd': {
    shouldFind: ['Exhibit E (Form of Good Guy Guaranty) to Agreement of Lease dated 7/1/11.']
  },
  'Duff and Phelps': {
    shouldFind: [
      'Letter agreement (Consent) by and among Landlord, Tenant and General Atlantic Service Company, L.P., as referenced in Third Amendment to Lease dated 4/5/24.',
      'Document reflecting Premises of Part Basement, as reflected on Rent Roll as of 11/30/25.'
    ]
  },
  'Morgan Stanley': {
    shouldFind: [
      'Guaranty of Lease (Exhibit F of Second Amendment dated 9/30/21) is not executed.',
      'Release of Guaranty of Lease (Exhibit J of Second Amendment dated 9/30/21) is not executed.'
    ]
  }
}

// GET /api/mt/cheat-sheet — returns correct answers (for debugging / display)
app.get('/api/mt/cheat-sheet', (_req, res) => res.json(MT_CHEAT_SHEET))

// POST /api/mt/compare — compare model findings to cheat sheet answer key
app.post('/api/mt/compare', express.json({ limit: '500kb' }), async (req, res) => {
  try {
    const { tenantName, modelFindings = [] } = req.body
    if (!tenantName) return res.status(400).json({ error: 'tenantName required' })

    // Fuzzy match tenant name (trim + lowercase) against cheat sheet keys
    const csKey = Object.keys(MT_CHEAT_SHEET).find(k =>
      k.trim().toLowerCase() === (tenantName || '').trim().toLowerCase()
    )
    if (!csKey) return res.status(404).json({ error: `No cheat sheet entry for: "${tenantName}"` })

    const result = await compareToCheatSheet({
      tenantName,
      modelFindings,
      shouldFind: MT_CHEAT_SHEET[csKey].shouldFind
    })
    res.json(result)
  } catch (err) {
    console.error('[mt/compare]', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/mt/synthesize — generate juice rules from comparison errors
app.post('/api/mt/synthesize', express.json({ limit: '500kb' }), async (req, res) => {
  try {
    const { tenantName, missed=[], falsePositives=[], caught=[], analysis='', trainerNotes='', currentRules=[], currentFindings=[] } = req.body

    const fullAnalysis = [analysis, trainerNotes ? `\nTRAINER'S OWN NOTES: ${trainerNotes}` : ''].filter(Boolean).join('')

    // Helper: find the actual gym finding matching a text label (from teacher comparison)
    function findGymFinding(label) {
      if (!label || !currentFindings.length) return null
      const norm = s => String(s || '').toLowerCase().replace(/\s+/g,' ').trim()
      const target = norm(label)
      // exact match on missingDocument
      let hit = currentFindings.find(f => norm(f.missingDocument) === target)
      // fuzzy: one contains the other
      if (!hit) hit = currentFindings.find(f => {
        const doc = norm(f.missingDocument)
        return doc.length > 8 && (target.includes(doc) || doc.includes(target))
      })
      return hit || null
    }

    // Build rejectedFindings with full reasoning chains from actual findings
    const rejectedFindings = falsePositives.map(fp => {
      const label = typeof fp === 'string' ? fp : (fp.missingDocument || fp.description || '')
      const gymF  = findGymFinding(label)
      return {
        checkType:            gymF?.checkType       || (fp.checkType || 'UNKNOWN'),
        missingDocument:      label,
        evidence:             gymF?.evidence        || fp.evidence || '',
        comment:              gymF?.comment         || fp.comment  || '',
        triggerQuote:         gymF?.triggerQuote    || '',  // EXACT text that made the AI fire
        reasoning:            gymF?.reasoning       || '',  // AI's step-by-step logic chain
        checkedAndEliminated: gymF?.checkedAndEliminated || [],  // what AI verified before flagging
        howIFoundThis:        gymF?.howIFoundThis   || '',  // plain-English signal summary
        confidence:           gymF?.confidence      || '',
        reviewerNote:         `False positive — model incorrectly flagged this. ${fullAnalysis.slice(0,300)}`
      }
    })

    // Annotations for missed items
    const annotations = missed.map(item => ({
      comment: `MISSED: ${item}  |  Root cause analysis: ${fullAnalysis.slice(0, 500)}`,
      docName: tenantName,
      pageNum: ''
    }))

    // Confirmed findings with reasoning
    const confirmedFindings = caught.map(c => {
      const label = typeof c === 'string' ? c : (c.missingDocument || c.description || c)
      const gymF  = findGymFinding(label)
      return {
        checkType:       gymF?.checkType    || 'CONFIRMED',
        missingDocument: label,
        evidence:        gymF?.evidence     || '',
        triggerQuote:    gymF?.triggerQuote || '',
        reasoning:       gymF?.reasoning    || '',
        comment: 'Model found this correctly — do NOT create rules that would suppress or narrow this finding type.'
      }
    })

    const result = await synthesizeActiveLearning({
      rejectedFindings,
      confirmedFindings,
      annotations,
      currentRules
    })
    res.json(result)
  } catch (err) {
    console.error('[mt/synthesize]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// CONTACTS — persisted in Railway volume (PERSIST_DIR/contacts.json)
// ═══════════════════════════════════════════════════════════

const CONTACTS_PATH = path.join(OUTPUTS_DIR, 'contacts.json')

function readContacts() {
  try { return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf8')) } catch { return [] }
}
function writeContacts(arr) {
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(arr, null, 2))
}

app.get('/api/contacts', (_req, res) => {
  res.json(readContacts())
})

app.post('/api/contacts', express.json({ limit: '100kb' }), (req, res) => {
  try {
    const { id, name, email, phone, role, tenantName, property, notes } = req.body || {}
    const contacts = readContacts()
    const contact = {
      id:         id || randomUUID(),
      name:       (name       || '').trim(),
      email:      (email      || '').trim(),
      phone:      (phone      || '').trim(),
      role:       (role       || '').trim(),
      tenantName: (tenantName || '').trim(),
      property:   (property   || '').trim(),
      notes:      (notes      || '').trim(),
      savedAt:    new Date().toISOString()
    }
    const idx = id ? contacts.findIndex(c => c.id === id) : -1
    if (idx >= 0) contacts[idx] = contact
    else contacts.push(contact)
    writeContacts(contacts)
    res.json({ ok: true, contact })
  } catch (err) {
    console.error('[contacts/save]', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/contacts/:id', (req, res) => {
  try {
    writeContacts(readContacts().filter(c => c.id !== req.params.id))
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── LEADS — track call/schedule clicks, persisted to volume ──────────────

const LEADS_PATH = path.join(OUTPUTS_DIR, 'leads.json')

function readLeads() {
  try { return JSON.parse(fs.readFileSync(LEADS_PATH, 'utf8')) } catch { return [] }
}
function writeLeads(arr) {
  fs.writeFileSync(LEADS_PATH, JSON.stringify(arr, null, 2))
}

// POST /api/leads/track  { type: 'call_click' | 'schedule_submit', name?, email?, phone?, message? }
app.post('/api/leads/track', express.json({ limit: '20kb' }), (req, res) => {
  try {
    const { type, name, email, phone, message } = req.body || {}
    if (!type) return res.status(400).json({ error: 'type required' })
    const lead = {
      id:        randomUUID(),
      type:      type === 'call_click' ? 'call_click' : 'schedule_submit',
      name:      (name    || '').trim(),
      email:     (email   || '').trim(),
      phone:     (phone   || '').trim(),
      message:   (message || '').trim(),
      userAgent: req.headers['user-agent'] || '',
      ip:        req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      savedAt:   new Date().toISOString()
    }
    const leads = readLeads()
    leads.push(lead)
    writeLeads(leads)
    console.log(`[leads] ${lead.type} — ${lead.name || lead.email || 'anonymous'}`)
    res.json({ ok: true })
  } catch (err) {
    console.error('[leads/track]', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/config  — public config for client (phone, schedule URL, etc.)
// Set OWNER_PHONE and OWNER_SCHEDULE_URL in Railway env vars
app.get('/api/config', (_req, res) => {
  res.json({
    phone:       process.env.OWNER_PHONE        || '',
    scheduleUrl: process.env.OWNER_SCHEDULE_URL || ''
  })
})

// GET /api/leads  (admin — no auth, owner PIN required on client side)
app.get('/api/leads', (_req, res) => {
  try {
    const leads = readLeads()
    const scheduleCount = leads.filter(l => l.type === 'schedule_submit').length
    const callCount     = leads.filter(l => l.type === 'call_click').length
    res.json({ leads: leads.slice().reverse(), scheduleCount, callCount, total: leads.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error(`
⚠️  ANTHROPIC_API_KEY is missing or empty — Claude analysis will fail with connection/auth errors.
   Local: copy .env.example → .env and set ANTHROPIC_API_KEY (same value as Railway if you like).
   Railway: Service → Variables, add ANTHROPIC_API_KEY, then redeploy.
`)
}
if (!isOpenAiKeyConfigured()) {
  console.warn(`
ℹ️  No OpenAI key yet — OpenAI Test Lab / API Battle need one.
   Easiest local: create openai.key in this folder (one line, your sk-… key) and restart.
   Or: OPENAI_API_KEY in .env.
   Railway: Service → Variables → OPENAI_API_KEY, then redeploy.
`)
}

// Static assets LAST so every /api/* route is registered first
app.use(express.static(path.join(__dirname, 'public')))

app.listen(PORT, HOST, () => {
  const browse =
    HOST === '0.0.0.0' || HOST === '::' ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`
  console.log(`[todd-jr] listening ${HOST}:${PORT} — open ${browse} in your browser`)
})
