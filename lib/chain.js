/**
 * chain.js — merged term-chain coverage across batches.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVENANCE — READ THIS BEFORE TRUSTING THIS FILE.
 *
 * The original chain.js was written for the Loop 7 commit (a5d3be0, 2026-08-19)
 * but was never committed. The import in lib/claude.js shipped without it, so
 * production crash-looped on boot from 2026-08-19 until this file was restored.
 *
 * This is a RECONSTRUCTION from the specification that *was* committed:
 *   • data shape        — lib/openai.js chainWalk / chainGaps JSON schema
 *   • algorithm         — lib/claude.js "RECORD THE WALK ITSELF" (~line 1503)
 *   • 180-day threshold — server.js seed rule blind-gap ("exceeds 6 months")
 *                         and lib/claude.js ~line 1517 ("longer than 6 months")
 *   • output contract   — lib/claude.js synthesis prompt section C2 (~line 3243),
 *                         which requires the marker "SPANS A BATCH BOUNDARY"
 *
 * It is NOT the artifact blind loop 7 validated. Behaviour may differ from the
 * original in edge cases. Every judgement call below is resolved in the EMIT
 * direction, per the project's standing doctrine: a duplicate row costs one
 * glance, a deleted correct finding is invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS AT ALL: when a folder is too large for one API call it is
 * split into batches. A hole between the last term-bearing document of batch 1
 * and the first of batch 2 was in no single batch's request, so no batch could
 * have reported it. Stitching every batch's chainWalk together is the only pass
 * that can see it.
 */

export const MIN_REPORTABLE_GAP_DAYS = 180   // "exceeds 6 months" — server.js seed rules

const DAY_MS = 86_400_000

/** YYYY-MM-DD -> UTC epoch ms, or null. Never throws. */
function parseDate (value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms : null
}

const fmt = ms => new Date(ms).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS)

/**
 * Flatten every batch's chainWalk into one list of dated rows.
 *
 * A row with no parseable coversFrom cannot be placed on the timeline at all,
 * so it is dropped from the sweep and surfaced separately — dropping it
 * silently is how a document quietly stops counting.
 */
function collectRows (batchResults) {
  const rows = []
  const undated = []

  for (const r of Array.isArray(batchResults) ? batchResults : []) {
    const batch = r?._batch ?? null
    const walk = Array.isArray(r?.chainWalk) ? r.chainWalk : []
    for (const w of walk) {
      const doc = String(w?.doc ?? '(unnamed document)')
      const from = parseDate(w?.coversFrom)
      const through = parseDate(w?.coversThrough)
      if (from === null) { undated.push({ doc, batch, raw: w }); continue }
      rows.push({
        doc,
        batch,
        from,
        // An end the file never establishes does NOT get to close a gap. Treating
        // an unknown end as open-ended would silently swallow every hole behind
        // it; treating it as covering only its start date can at worst produce a
        // visible interval a reviewer rejects. Bias to visible.
        through: through === null ? from : through,
        throughKnown: through !== null
      })
    }
  }

  rows.sort((a, b) => a.from - b.from || a.through - b.through)
  return { rows, undated }
}

/**
 * Sweep the sorted rows and return every uncovered interval.
 * `spansBatchBoundary` marks intervals whose two sides came from different
 * batches — those are precisely the holes no single batch could see.
 */
export function computeUncoveredIntervals (batchResults) {
  const { rows, undated } = collectRows(batchResults)
  const intervals = []

  let cursor = null        // furthest coversThrough reached so far
  let cursorDoc = null
  let cursorBatch = null

  for (const row of rows) {
    if (cursor === null) {
      cursor = row.through; cursorDoc = row.doc; cursorBatch = row.batch
      continue
    }

    // A gap exists when the next term starts more than one day after the
    // furthest point currently covered. Adjacent (next day) is contiguous.
    if (row.from > cursor + DAY_MS) {
      const start = cursor + DAY_MS
      const end = row.from - DAY_MS
      intervals.push({
        from: fmt(start),
        to: fmt(end),
        days: daysBetween(start, end) + 1,
        afterDoc: cursorDoc,
        beforeDoc: row.doc,
        afterBatch: cursorBatch,
        beforeBatch: row.batch,
        spansBatchBoundary:
          cursorBatch !== null && row.batch !== null && cursorBatch !== row.batch
      })
    }

    if (row.through > cursor) {
      cursor = row.through; cursorDoc = row.doc; cursorBatch = row.batch
    }
  }

  return { intervals, rows, undated }
}

/**
 * Render the merged chain for the cross-batch synthesis prompt.
 * Called from lib/claude.js with batchResults already tagged `_batch`.
 *
 * Never throws: a formatting failure here must not take down an analysis, but
 * it must also not read as "no gaps". On error it says so in the block.
 */
export function formatChainCoverageForPrompt (batchResults) {
  let data
  try {
    data = computeUncoveredIntervals(batchResults)
  } catch (err) {
    return `MERGED TERM CHAIN: could not be computed (${err?.message || 'unknown error'}).\n` +
           `Do NOT read this as "no gaps found". Walk the chain yourself from the full ` +
           `document text below and rule on every uncovered interval.`
  }

  const { intervals, rows, undated } = data
  const lines = []

  lines.push('MERGED TERM CHAIN (all batches stitched together):')

  if (rows.length === 0) {
    lines.push('  (no batch reported a dated term-bearing document)')
    lines.push('')
    lines.push('  This is NOT evidence that the term is continuous — it means the walk')
    lines.push('  came back empty. Build the chain yourself from the full document text')
    lines.push('  below before concluding anything about coverage.')
    return lines.join('\n')
  }

  for (const r of rows) {
    const batch = r.batch === null ? '?' : r.batch
    const through = r.throughKnown ? r.through : `${fmt(r.through)} (END NOT ESTABLISHED IN FILE)`
    lines.push(`  [Batch ${batch}] ${r.doc}: ${fmt(r.from)} → ${
      r.throughKnown ? fmt(r.through) : through}`)
  }

  if (undated.length > 0) {
    lines.push('')
    lines.push('DOCUMENTS THAT COULD NOT BE PLACED ON THE TIMELINE (no start date recorded):')
    for (const u of undated) {
      lines.push(`  [Batch ${u.batch ?? '?'}] ${u.doc}`)
    }
    lines.push('  These were excluded from the sweep below. If any of them bears a term,')
    lines.push('  it may cover an interval shown as uncovered — check the text before ruling.')
  }

  lines.push('')

  if (intervals.length === 0) {
    lines.push('UNCOVERED INTERVALS: none found by the merge.')
    lines.push('The merge only sees dates the batches recorded. If a term-bearing document')
    lines.push('was omitted from every batch\'s walk, its hole is invisible here — so this')
    lines.push('is not a clean bill of health, only an absence of computed gaps.')
    return lines.join('\n')
  }

  lines.push(`UNCOVERED INTERVALS (${intervals.length} found; rule on every one longer than ${MIN_REPORTABLE_GAP_DAYS} days):`)
  for (const iv of intervals) {
    const flag = iv.spansBatchBoundary ? '  ← SPANS A BATCH BOUNDARY' : ''
    lines.push(`  ${iv.from} → ${iv.to}  (${iv.days} days)${flag}`)
    lines.push(`      after: ${iv.afterDoc} [Batch ${iv.afterBatch ?? '?'}]`)
    lines.push(`      before: ${iv.beforeDoc} [Batch ${iv.beforeBatch ?? '?'}]`)
  }

  return lines.join('\n')
}
