// Local dev: load `.env` into process.env (same keys as Railway). Does not override vars already set by the host.
import 'dotenv/config'

import express from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import unzipper from 'unzipper'
import { analyzeTenant, gymAnalyzeTenant, beefedUpAnalyzeTenant } from './lib/analyzer.js'
import {
  openaiAnalyzeTenant,
  setLocalOpenAiKey,
  isOpenAiKeyConfigured,
  getServerOpenAiKeyHint
} from './lib/openai.js'
import { generateReport } from './lib/reporter.js'
import { mountIsaacRoutes } from './lib/isaac-routes.js'

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

/** Per-session pasted key wins; else openai.key / localhost memory / .env (see lib/openai.js). */
function resolveSessionOpenAi(session) {
  const pasted = session?.openaiApiKeyOverride?.trim()
  if (pasted) return { configured: true, optionKey: pasted }
  if (isOpenAiKeyConfigured()) return { configured: true, optionKey: null }
  return { configured: false, optionKey: null }
}

const ALLOW_LOCAL_OPENAI_BODY = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_LOCAL_OPENAI_KEY || '').toLowerCase()
)

function requestAllowsLocalOpenAiKey(req) {
  if (ALLOW_LOCAL_OPENAI_BODY) return true
  const addr = String(req.socket?.remoteAddress || '')
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return [addr, xff].filter(Boolean).some(a =>
    /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/i.test(a)
  )
}

const UPLOADS_DIR = path.join(__dirname, 'uploads')
const OUTPUTS_DIR = path.join(__dirname, 'outputs')
fs.mkdirSync(UPLOADS_DIR, { recursive: true })
fs.mkdirSync(OUTPUTS_DIR, { recursive: true })

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

app.use(express.json({ limit: '50mb' }))

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

// Localhost only: paste OpenAI key into UI — no session, no upload (RAM until restart).
app.post('/api/local-openai-key', (req, res) => {
  try {
    if (!requestAllowsLocalOpenAiKey(req)) {
      return res.status(403).json({
        ok: false,
        error:
          'This save only works when the Todd server runs on your Mac (request from 127.0.0.1). If the API is on Railway, add OPENAI_API_KEY there. Optional: ALLOW_LOCAL_OPENAI_KEY=1 on the server to allow this from any client (dev only).'
      })
    }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'openaiApiKey')) {
      return res.status(400).json({ ok: false, error: 'Missing openaiApiKey (use "" to clear).' })
    }
    const key = String(req.body.openaiApiKey ?? '').trim()
    if (!key) {
      setLocalOpenAiKey('')
      return res.json({
        ok: true,
        openaiConfigured: isOpenAiKeyConfigured(),
        openaiKeySource: getServerOpenAiKeyHint()
      })
    }
    if (key.length < 20 || !key.startsWith('sk-')) {
      return res.status(400).json({ ok: false, error: 'Key should start with sk-.' })
    }
    setLocalOpenAiKey(key)
    return res.json({
      ok: true,
      openaiConfigured: true,
      openaiKeySource: getServerOpenAiKeyHint()
    })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Server error' })
  }
})

// Isaac / Teacher Excel — registered immediately after body parser (must not depend on later server.js code)
mountIsaacRoutes(app, { outputsDir: OUTPUTS_DIR, parseFolderName })

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'todd-jr',
    isaacRoutes: true,
    claudeConfigured: !!process.env.ANTHROPIC_API_KEY?.trim(),
    openaiConfigured: isOpenAiKeyConfigured(),
    openaiKeySource: getServerOpenAiKeyHint(),
    localDevCors: LOCAL_DEV_CORS,
    /** Set by Railway on deploy — compare to GitHub to confirm the live build */
    gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    time: new Date().toISOString()
  })
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
  const openSession = !!session.openaiApiKeyOverride?.trim()
  const openAIConfigured = openSession || isOpenAiKeyConfigured()
  const openAIKeySource = openSession ? 'session' : getServerOpenAiKeyHint()
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
    createdAt: Date.now(),
    openaiApiKeyOverride: null
  }
  sessions.set(sessionId, session)
  try {
    fs.mkdirSync(session.uploadDir, { recursive: true })
  } catch {
    /* non-fatal — multer also mkdirs on upload */
  }
  return session
}

// POST /api/session/openai-key — store per-session OpenAI key (RAM only; never logged)
app.post('/api/session/openai-key', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim()
    if (!sessionId) return res.status(400).json({ ok: false, error: 'Missing sessionId' })
    const session = ensureSessionShell(sessionId)
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'openaiApiKey')) {
      return res.status(400).json({ ok: false, error: 'Missing openaiApiKey (use empty string to clear).' })
    }
    const key = String(req.body.openaiApiKey ?? '').trim()
    if (!key) {
      session.openaiApiKeyOverride = null
      return res.json({
        ok: true,
        openAIConfigured: isOpenAiKeyConfigured(),
        openAIKeySource: getServerOpenAiKeyHint()
      })
    }
    if (key.length < 20 || !key.startsWith('sk-')) {
      return res.status(400).json({
        ok: false,
        error: 'Key should start with sk- and resemble a valid OpenAI API secret.'
      })
    }
    session.openaiApiKeyOverride = key
    return res.json({ ok: true, openAIConfigured: true, openAIKeySource: 'session' })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Server error' })
  }
})

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

        // Normalize path separators: "/" → "__SEP__" for consistent grouping
        req.files = extractedFiles.map(f => ({
          ...f,
          originalname: f.originalname.replace(/\//g, '__SEP__')
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

    // Sort by property then suite number
    tenants.sort((a, b) => {
      const propCmp = a.property.localeCompare(b.property)
      if (propCmp !== 0) return propCmp
      return String(a.suite).localeCompare(String(b.suite), undefined, { numeric: true })
    })

    const prevSession = sessions.get(sessionId)
    sessions.set(sessionId, {
      tenants,
      findings: new Map(),
      uploadDir: path.join(UPLOADS_DIR, sessionId),
      createdAt: Date.now(),
      openaiApiKeyOverride: prevSession?.openaiApiKeyOverride || null
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
// GET /api/hunt  — Server-Sent Events stream
// ═══════════════════════════════════════════════════════════

app.get('/api/hunt', async (req, res) => {
  const { sessionId, testTenantId, concurrency, tenantIds, juiced } = req.query
  const session = sessions.get(sessionId)

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const useJuice = juiced === '1'
  // Same learnings file as Gym: includes Dr. Todd "Extract & Save" rules + workout feedback (only l.active === true apply)
  const learningsForHunt = useJuice ? readLearnings() : []
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
    const CONCURRENCY = concurrency === '0' ? tenantsToProcess.length : 1
    console.log(`[hunt] Mode: ${CONCURRENCY === 1 ? 'ACCURACY (sequential)' : 'SPEED (parallel)'}${useJuice ? ` | JUICE (${activeLearningCount} active learnings)` : ''}`)
    await runConcurrent(tenantsToProcess, CONCURRENCY, async tenant => {
      if (aborted) return
      // Emit folder-start here so it fires exactly when this tenant begins processing
      emit('folder-start', {
        tenantId:   tenant.id,
        tenantName: tenant.tenantName,
        folderName: tenant.folderName,
        fileCount:  tenant.fileCount,
        juiced:     useJuice,
        activeLearningsApplied: activeLearningCount
      })
      const onProgress = ({ percent, message }) => {
        if (!aborted) emit('folder-progress', { tenantId: tenant.id, percent, message })
      }
      try {
        const cheapOpts = { cheapMode: isCheapMode(req) }
        const result = useJuice
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

    // Two independent passes:
    // 1) Regular model baseline
    // 2) Reviewer pass (same engine, separate run for confirmation)
    const [rawResult, reviewResult] = await Promise.all([
      analyzeTenant(tenant, tenant.files, ({ percent, message }) => {
        if (!aborted) emit('sbs-progress', { side: 'raw', percent, message })
      }, cheapOpts),
      analyzeTenant(tenant, tenant.files, ({ percent, message }) => {
        const reviewMsg = message ? `Reviewer: ${message}` : 'Reviewer pass running...'
        if (!aborted) emit('sbs-progress', { side: 'beefed', percent, message: reviewMsg })
      }, cheapOpts)
    ])

    if (!aborted) {
      emit('sbs-complete', {
        tenantName: tenant.tenantName,
        raw: rawResult,
        beefed: reviewResult,
        activeLearnings: [],
        mode: 'doublecheck'
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
          comment: `Not run — ${reason}. Add OPENAI_API_KEY on the server or paste a key on the home screen (OpenAI API key → Save to session).`,
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
          message: 'OpenAI skipped — no key (set OPENAI_API_KEY or paste key on home → OpenAI API key)'
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
        return skippedOpenaiResult('No OpenAI key (server env or pasted session key)')
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
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 15000)
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
          message: 'No OpenAI key — set OPENAI_API_KEY or paste key (home → OpenAI API key)'
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
            error: 'No OpenAI key — set OPENAI_API_KEY on the server or paste a key under OpenAI API key on the home screen.'
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
                  'Set OPENAI_API_KEY on the server, or on the home screen open “OpenAI API key (optional)”, paste your key, and Save to session.',
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
    const { rawResult, beefedResult, activeLearnings, tenantName, cheapMode } = req.body
    if (!rawResult || !beefedResult) return res.status(400).json({ error: 'rawResult and beefedResult are required' })

    const { evaluateSideBySide } = await import('./lib/gym-trainer.js')
    const verdict = await evaluateSideBySide({ rawResult, beefedResult, activeLearnings, tenantName, cheapMode: !!cheapMode })

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

// ═══════════════════════════════════════════════════════════
// GYM TEACHER — serve raw PDF files to browser PDF.js viewer
// ═══════════════════════════════════════════════════════════

app.get('/api/gym/file/:sessionId/:tenantId/:fileIndex', (req, res) => {
  const { sessionId, tenantId, fileIndex } = req.params
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).end()
  const tenant = session.tenants.find(t => t.id === tenantId)
  if (!tenant) return res.status(404).end()
  const idx = parseInt(fileIndex)
  if (isNaN(idx) || idx < 0 || idx >= tenant.files.length) return res.status(404).end()
  const file = tenant.files[idx]
  if (!file || !fs.existsSync(file.diskPath)) return res.status(404).end()

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  const stream = fs.createReadStream(file.diskPath)
  stream.pipe(res)
  stream.on('error', () => { if (!res.headersSent) res.status(404).end() })
})

// ═══════════════════════════════════════════════════════════
// GYM TEACHER — run analysis via SSE (same engine as main hunt)
// ═══════════════════════════════════════════════════════════

app.get('/api/gym/analyze', async (req, res) => {
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
    emit('gym-start', { tenantName: tenant.tenantName, folderName: tenant.folderName })
    const onProgress = ({ percent, message }) => {
      if (!aborted) emit('gym-progress', { percent, message })
    }
    // Gym mode uses the extended reasoning schema
    const result = await gymAnalyzeTenant(tenant, tenant.files, onProgress, { cheapMode: isCheapMode(req) })

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
        folderName: tenant.folderName
      })
    }
  } catch (err) {
    console.error('[gym/analyze]', err)
    if (!aborted) emit('gym-error', { error: err.message })
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
// GYM TEACHER — compile feedback into learnings
// ═══════════════════════════════════════════════════════════

app.post('/api/gym/workout-feedback', async (req, res) => {
  try {
    const { sessionId, tenantId, findings, feedbacks, annotations, cheapMode } = req.body
    const session = sessions.get(sessionId)
    const tenant = session?.tenants.find(t => t.id === tenantId)
      || { tenantName: 'Unknown', folderName: 'Unknown' }

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

    res.json({ learnings: newLearnings, summary: result.summary || '' })
  } catch (err) {
    console.error('[gym/workout-feedback]', err)
    res.status(500).json({ error: err.message })
  }
})

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
// SESSION CLEANUP — runs every 30 minutes
// ═══════════════════════════════════════════════════════════

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000 // 2 hours
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      try { fs.rmSync(session.uploadDir, { recursive: true, force: true }) } catch {}
      try { fs.rmSync(path.join(OUTPUTS_DIR, `${id}.xlsx`), { force: true }) } catch {}
      sessions.delete(id)
      console.log(`[cleanup] Removed session ${id}`)
    }
  }
}, 30 * 60 * 1000)

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
   Or: OPENAI_API_KEY in .env, or paste in the browser (home screen) when Todd runs on this machine.
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
