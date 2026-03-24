import express from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import unzipper from 'unzipper'
import { analyzeTenant, gymAnalyzeTenant, beefedUpAnalyzeTenant } from './lib/analyzer.js'
import { generateReport } from './lib/reporter.js'
import { mountIsaacRoutes } from './lib/isaac-routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const app  = express()
const PORT = process.env.PORT || 3000

/** UI "Dumb mode" — Haiku instead of Sonnet (query: cheap=1 or JSON cheapMode: true) */
function isCheapMode(req) {
  return req.query?.cheap === '1' || req.body?.cheapMode === true
}

// In-memory session store: sessionId -> SessionData
const sessions = new Map()

const UPLOADS_DIR = path.join(__dirname, 'uploads')
const OUTPUTS_DIR = path.join(__dirname, 'outputs')
fs.mkdirSync(UPLOADS_DIR, { recursive: true })
fs.mkdirSync(OUTPUTS_DIR, { recursive: true })

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

// Isaac / Teacher Excel — registered immediately after body parser (must not depend on later server.js code)
mountIsaacRoutes(app, { outputsDir: OUTPUTS_DIR, parseFolderName })

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'todd-jr',
    isaacRoutes: true,
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

    sessions.set(sessionId, {
      tenants,
      findings: new Map(),
      uploadDir: path.join(UPLOADS_DIR, sessionId),
      createdAt: Date.now()
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
  const { sessionId, testTenantId, concurrency, tenantIds } = req.query
  const session = sessions.get(sessionId)

  if (!session) return res.status(404).json({ error: 'Session not found' })

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
    // concurrency=1 → accuracy mode (sequential), concurrency=0 → speed mode (all at once)
    const CONCURRENCY = concurrency === '0' ? tenantsToProcess.length : 1
    console.log(`[hunt] Mode: ${CONCURRENCY === 1 ? 'ACCURACY (sequential)' : 'SPEED (parallel)'}`)
    await runConcurrent(tenantsToProcess, CONCURRENCY, async tenant => {
      if (aborted) return
      // Emit folder-start here so it fires exactly when this tenant begins processing
      emit('folder-start', {
        tenantId:   tenant.id,
        tenantName: tenant.tenantName,
        folderName: tenant.folderName,
        fileCount:  tenant.fileCount
      })
      const onProgress = ({ percent, message }) => {
        if (!aborted) emit('folder-progress', { tenantId: tenant.id, percent, message })
      }
      try {
        const result = await analyzeTenant(tenant, tenant.files, onProgress, { cheapMode: isCheapMode(req) })
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

    // Enrich with IDs, timestamps, source tag, and save
    const newLearnings = (result.learnings || []).map(l => ({
      ...l,
      id:        `learning-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      createdAt: new Date().toISOString(),
      source:    'dr-todd-diagnostic',
      active:    false,
    }))

    const existing = readLearnings()
    writeLearnings([...existing, ...newLearnings])

    res.json({ learnings: newLearnings, summary: result.summary })
  } catch (err) {
    console.error('[drtoddhunt/extract-learnings]', err)
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
// GYM TEACHER — learnings persistence (outputs/learnings.json)
// ═══════════════════════════════════════════════════════════

const LEARNINGS_PATH = path.join(__dirname, 'outputs', 'learnings.json')

function readLearnings() {
  try {
    if (!fs.existsSync(LEARNINGS_PATH)) return []
    return JSON.parse(fs.readFileSync(LEARNINGS_PATH, 'utf8'))
  } catch { return [] }
}
function writeLearnings(arr) {
  try { fs.writeFileSync(LEARNINGS_PATH, JSON.stringify(arr, null, 2)) } catch {}
}

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

    const newLearnings = (result.learnings || []).map(l => ({
      ...l,
      id:         randomUUID(),
      created_at: new Date().toISOString(),
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
   Railway: Service → Variables (or Project → Shared Variables), add ANTHROPIC_API_KEY, then redeploy.
`)
}

// Optional: UI on another origin — set CORS_ORIGIN to that site’s URL (e.g. https://app.pages.dev)
if (process.env.CORS_ORIGIN?.trim()) {
  const origin = process.env.CORS_ORIGIN.trim()
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
}

// Static assets LAST so every /api/* route is registered first
app.use(express.static(path.join(__dirname, 'public')))

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         Todd Jr. is ready to hunt 🏹         ║
║         Port ${PORT}                              ║
╚══════════════════════════════════════════════╝
`)
})
