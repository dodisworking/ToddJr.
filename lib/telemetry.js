/**
 * Telemetry — append-only event log.
 *
 * Captures the signals needed to analyze what the model is doing across
 * real reviewer sessions: which tenants were uploaded, what findings the
 * model emitted, what the new filters dropped (and why), reviewer
 * feedback (confirm/reject), and which uploads showed the duplication
 * or skipping bug.
 *
 * Storage: JSON Lines (one event per line) in `{outputsDir}/telemetry/`,
 * rotated daily — `events-YYYY-MM-DD.jsonl`. Persistent across Railway
 * restarts when PERSIST_DIR is set. All logging is wrapped in try/catch
 * so a telemetry failure never breaks an analysis.
 *
 * Never logs document text, signatures, or API keys. Only metadata
 * (filename, page count, byte size, finding type, etc.).
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

const TELEMETRY_SUBDIR = 'telemetry'
const FILE_PREFIX = 'events-'
const FILE_EXT = '.jsonl'

let outputsDirResolved = null

function setOutputsDir(dir) { outputsDirResolved = dir }

function telemetryDir() {
  if (!outputsDirResolved) return null
  const dir = path.join(outputsDirResolved, TELEMETRY_SUBDIR)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}

function todayFileName() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${FILE_PREFIX}${y}-${m}-${day}${FILE_EXT}`
}

/**
 * Log one event. Fire-and-forget — errors swallowed so this can never
 * break a production analysis path.
 *
 * @param {string} type   stable event type (e.g. "analyze.complete")
 * @param {object} payload  any JSON-serializable fields
 */
export function logEvent(type, payload = {}) {
  try {
    const dir = telemetryDir()
    if (!dir) return
    const event = {
      ts: new Date().toISOString(),
      type,
      ...payload,
    }
    const line = JSON.stringify(event) + '\n'
    const fpath = path.join(dir, todayFileName())
    fs.appendFile(fpath, line, () => {})
  } catch {}
}

/**
 * Read events matching the filter. For UI / analysis endpoints.
 *
 * @param {object} filter
 * @param {string} [filter.type]       exact type match (or startsWith if ends with .*)
 * @param {string} [filter.sessionId]  filter to one session
 * @param {string} [filter.tenantName] filter to one tenant
 * @param {string} [filter.since]      ISO timestamp (inclusive)
 * @param {string} [filter.until]      ISO timestamp (exclusive)
 * @param {number} [filter.limit]      max events returned (newest first), default 1000
 * @returns {Array<object>}
 */
export function queryEvents(filter = {}) {
  const dir = telemetryDir()
  if (!dir) return []
  const limit = filter.limit ?? 1000
  const type = filter.type
  const isPrefix = typeof type === 'string' && type.endsWith('.*')
  const typePrefix = isPrefix ? type.slice(0, -2) : null
  const since = filter.since ? new Date(filter.since).getTime() : null
  const until = filter.until ? new Date(filter.until).getTime() : null

  // Collect files in date order, latest first
  let files = []
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_EXT))
      .sort()
      .reverse()
  } catch { return [] }

  const out = []
  for (const f of files) {
    let raw = ''
    try { raw = fs.readFileSync(path.join(dir, f), 'utf8') } catch { continue }
    const lines = raw.split('\n')
    // Iterate newest line first within each file
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      let ev
      try { ev = JSON.parse(line) } catch { continue }
      if (type) {
        if (isPrefix) {
          if (!String(ev.type || '').startsWith(typePrefix)) continue
        } else if (ev.type !== type) continue
      }
      if (filter.sessionId && ev.sessionId !== filter.sessionId) continue
      if (filter.tenantName && ev.tenantName !== filter.tenantName) continue
      if (since || until) {
        const t = new Date(ev.ts).getTime()
        if (since && t < since) continue
        if (until && t >= until) continue
      }
      out.push(ev)
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Quick aggregate summary across recent events. Returns counts and basic
 * shape data; full slicing should go through queryEvents + CSV export.
 *
 * @param {object} [opts]
 * @param {string} [opts.since]   ISO timestamp (inclusive)
 * @returns {object}
 */
export function summarize(opts = {}) {
  const events = queryEvents({ since: opts.since, limit: 50000 })
  const summary = {
    total_events: events.length,
    counts_by_type: {},
    uploads: {
      sessions: new Set(),
      tenants_detected: 0,
      duplicates_merged: 0,
      empty_dropped: 0,
      mismatch_warnings: 0,
    },
    analyses: {
      started: 0,
      completed: 0,
      errored: 0,
      all_clear: 0,
      with_findings: 0,
      findings_total: 0,
      mean_ms: null,
    },
    filter_drops: {
      total: 0,
      by_filter: {},
    },
    feedback: {
      confirmed: 0,
      rejected: 0,
    },
  }
  let analyzeMsTotal = 0
  let analyzeMsCount = 0
  for (const ev of events) {
    summary.counts_by_type[ev.type] = (summary.counts_by_type[ev.type] || 0) + 1
    if (ev.sessionId && (ev.type || '').startsWith('upload.')) {
      summary.uploads.sessions.add(ev.sessionId)
    }
    switch (ev.type) {
      case 'upload.tenant_detected': summary.uploads.tenants_detected += 1; break
      case 'upload.duplicate_merged': summary.uploads.duplicates_merged += 1; break
      case 'upload.empty_dropped':    summary.uploads.empty_dropped += 1; break
      case 'upload.mismatch_warning': summary.uploads.mismatch_warnings += 1; break
      case 'analyze.start':           summary.analyses.started += 1; break
      case 'analyze.error':           summary.analyses.errored += 1; break
      case 'feedback.confirm':        summary.feedback.confirmed += 1; break
      case 'feedback.reject':         summary.feedback.rejected += 1; break
      case 'analyze.filter_drop': {
        summary.filter_drops.total += 1
        const key = ev.filter || 'unknown'
        summary.filter_drops.by_filter[key] = (summary.filter_drops.by_filter[key] || 0) + 1
        break
      }
      case 'analyze.complete': {
        summary.analyses.completed += 1
        if (ev.allClear) summary.analyses.all_clear += 1
        else if ((ev.findingsCount || 0) > 0) summary.analyses.with_findings += 1
        summary.analyses.findings_total += ev.findingsCount || 0
        if (typeof ev.ms === 'number') { analyzeMsTotal += ev.ms; analyzeMsCount += 1 }
        break
      }
    }
  }
  summary.uploads.sessions = summary.uploads.sessions.size
  summary.analyses.mean_ms = analyzeMsCount > 0 ? Math.round(analyzeMsTotal / analyzeMsCount) : null
  return summary
}

/**
 * Convert events to a flat CSV. Only includes columns that appear in at
 * least one event — keeps the CSV manageable.
 *
 * @param {Array<object>} events
 * @returns {string}
 */
export function eventsToCsv(events) {
  if (!Array.isArray(events) || events.length === 0) return 'ts,type\n'
  const cols = new Set(['ts', 'type'])
  for (const ev of events) Object.keys(ev).forEach(k => cols.add(k))
  const ordered = ['ts', 'type', 'sessionId', 'tenantId', 'tenantName', ...[...cols].filter(c => !['ts','type','sessionId','tenantId','tenantName'].includes(c)).sort()]
  const escape = v => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = [ordered.join(',')]
  for (const ev of events) {
    lines.push(ordered.map(c => escape(ev[c])).join(','))
  }
  return lines.join('\n') + '\n'
}

/**
 * Mount telemetry into the express app with three read endpoints.
 *
 * @param {object} app             express app
 * @param {object} opts
 * @param {string} opts.outputsDir
 */
export function mountTelemetry(app, { outputsDir }) {
  setOutputsDir(outputsDir)

  app.get('/api/telemetry/health', (_req, res) => {
    const dir = telemetryDir()
    let files = []
    try {
      files = fs.readdirSync(dir).filter(f => f.startsWith(FILE_PREFIX))
    } catch {}
    res.json({ ok: true, dir, files: files.sort() })
  })

  app.get('/api/telemetry/events', (req, res) => {
    const filter = {
      type: req.query.type,
      sessionId: req.query.sessionId,
      tenantName: req.query.tenantName,
      since: req.query.since,
      until: req.query.until,
      limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 1000, 10000) : 1000,
    }
    res.json({ events: queryEvents(filter), filter })
  })

  app.get('/api/telemetry/summary', (req, res) => {
    res.json(summarize({ since: req.query.since }))
  })

  app.get('/api/telemetry/export.csv', (req, res) => {
    const filter = {
      type: req.query.type,
      sessionId: req.query.sessionId,
      tenantName: req.query.tenantName,
      since: req.query.since,
      until: req.query.until,
      limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 10000, 100000) : 10000,
    }
    const events = queryEvents(filter)
    const csv = eventsToCsv(events)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="todd-telemetry-${Date.now()}.csv"`)
    res.send(csv)
  })

  console.log('[telemetry] mounted — events under ' + telemetryDir())
}
