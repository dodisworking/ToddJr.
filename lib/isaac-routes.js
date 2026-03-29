/**
 * Gym Teacher "Save for Isaac" — mounted FIRST in server.js (right after express.json)
 * so POST /api/gym/save-for-isaac always registers even if something fails later in server.js.
 *
 * Save structure per entry:
 *   {ISAAC_DIR}/{uuid}/report.xlsx   ← Teacher Todd Excel
 *   {ISAAC_DIR}/{uuid}/docs/         ← copies of all PDFs analyzed
 *
 * Legacy saves (single .xlsx at root) are still served by the old download route.
 */
import path from 'path'
import fs from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { generateGymTeacherWorkbook } from './reporter.js'

const ISAAC_SUBDIR   = 'isaac-saves'
const ISAAC_MANIFEST = 'manifest.json'
const ISAAC_TMP_ROOT = path.join(tmpdir(), 'todd-isaac-saves')

export function mountIsaacRoutes(app, { outputsDir, parseFolderName, sessions }) {
  let isaacDirResolved = null

  function resolveIsaacDir() {
    if (isaacDirResolved) return isaacDirResolved
    if (process.env.ISAAC_SAVE_DIR) {
      isaacDirResolved = process.env.ISAAC_SAVE_DIR
      return isaacDirResolved
    }
    const primary = path.join(outputsDir, ISAAC_SUBDIR)
    try {
      fs.mkdirSync(primary, { recursive: true })
      const probe = path.join(primary, '.w')
      fs.writeFileSync(probe, '1')
      fs.unlinkSync(probe)
      isaacDirResolved = primary
      return primary
    } catch {
      fs.mkdirSync(ISAAC_TMP_ROOT, { recursive: true })
      isaacDirResolved = ISAAC_TMP_ROOT
      console.warn('[isaac] outputs/isaac-saves not writable — using', ISAAC_TMP_ROOT)
      return isaacDirResolved
    }
  }

  function isaacManifestPath() {
    return path.join(resolveIsaacDir(), ISAAC_MANIFEST)
  }

  function readIsaacManifest() {
    try {
      const p = isaacManifestPath()
      if (!fs.existsSync(p)) return []
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  }

  function writeIsaacManifest(entries) {
    const dir = resolveIsaacDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(isaacManifestPath(), JSON.stringify(entries, null, 2), 'utf8')
  }

  function pruneIsaacSaves(keepIds) {
    const keep = new Set(keepIds)
    try {
      const dir = resolveIsaacDir()
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // Legacy: single .xlsx files
        if (entry.isFile() && entry.name.endsWith('.xlsx')) {
          const id = entry.name.replace(/\.xlsx$/i, '')
          if (!keep.has(id)) {
            try { fs.unlinkSync(path.join(dir, entry.name)) } catch { /* ignore */ }
          }
        }
        // New: UUID folders
        if (entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name)) {
          if (!keep.has(entry.name)) {
            try { fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true }) } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Copy PDF files from the session's tenant upload into the Isaac save folder.
   * Returns array of { originalName, savedName } for the manifest.
   */
  function copyPdfsToSave(saveDocsDir, uploadSessionId, tenantId) {
    const copied = []
    if (!sessions || !uploadSessionId || !tenantId) return copied
    const session = sessions.get(uploadSessionId)
    if (!session) return copied
    const tenant = session.tenants.find(t => t.id === tenantId)
    if (!tenant) return copied

    fs.mkdirSync(saveDocsDir, { recursive: true })

    for (const file of (tenant.files || [])) {
      try {
        if (!file.diskPath || !fs.existsSync(file.diskPath)) continue
        // Sanitise filename — strip any path separators
        const safeName = path.basename(file.originalName || file.diskPath)
        const destPath = path.join(saveDocsDir, safeName)
        fs.copyFileSync(file.diskPath, destPath)
        copied.push(safeName)
      } catch (err) {
        console.warn('[isaac] Could not copy file:', file.originalName, err.message)
      }
    }
    return copied
  }

  async function handleSaveForIsaac(req, res) {
    try {
      const {
        tenantName, folderName, findings, feedbacks, annotations,
        sessionId, sessionIdx, sessionTotal, reviewerName,
        uploadSessionId, tenantId
      } = req.body || {}

      const parsed = parseFolderName(folderName || tenantName || '')
      const tenant = {
        property:   parsed.property,
        suite:      parsed.suite,
        tenantName: tenantName || parsed.tenantName || 'Unknown'
      }

      const id      = randomUUID()
      const saveDir = path.join(resolveIsaacDir(), id)
      fs.mkdirSync(saveDir, { recursive: true })

      // Save the Excel report
      const xlsxPath = path.join(saveDir, 'report.xlsx')
      await generateGymTeacherWorkbook({ tenant, findings, feedbacks, annotations }, xlsxPath)

      // Copy PDFs from the session upload into docs/ subfolder
      const docsDir    = path.join(saveDir, 'docs')
      const savedDocs  = copyPdfsToSave(docsDir, uploadSessionId, tenantId)
      console.log(`[isaac] Saved ${savedDocs.length} PDF(s) alongside report for ${tenant.tenantName}`)

      // Manifest entry
      const entry = {
        id,
        savedAt:    new Date().toISOString(),
        tenantName: tenant.tenantName,
        folderName: folderName || '',
        docs:       savedDocs   // filenames of saved PDFs
      }
      if (sessionId) {
        entry.sessionId    = sessionId
        entry.sessionIdx   = sessionIdx ?? null
        entry.sessionTotal = sessionTotal ?? null
        entry.reviewerName = reviewerName || 'Unknown'
      } else if (reviewerName) {
        entry.reviewerName = reviewerName
      }

      let manifest = readIsaacManifest()
      manifest.unshift(entry)
      manifest = manifest.slice(0, 200)
      pruneIsaacSaves(manifest.map(e => e.id))
      writeIsaacManifest(manifest)

      res.json({
        ok:          true,
        id,
        downloadUrl: `/api/gym/isaac-download/${id}`,
        docs:        savedDocs
      })
    } catch (err) {
      console.error('[gym/save-for-isaac]', err)
      res.status(500).json({ error: err.message || 'Could not save workbook' })
    }
  }

  app.post('/api/gym/save-for-isaac', handleSaveForIsaac)
  app.post('/api/gym/teacher-save',   handleSaveForIsaac)

  app.get('/api/gym/isaac-logs', (_req, res) => {
    try {
      res.json(readIsaacManifest())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Download the Excel report for a save
  app.get('/api/gym/isaac-download/:id', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      // New folder-based save
      const newPath = path.join(resolveIsaacDir(), raw, 'report.xlsx')
      if (fs.existsSync(newPath)) {
        const fname = `Teacher-Todd-${raw.slice(0, 8)}.xlsx`
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        return fs.createReadStream(newPath).pipe(res)
      }
      // Legacy: single .xlsx at root
      const legacyPath = path.join(resolveIsaacDir(), `${raw}.xlsx`)
      if (fs.existsSync(legacyPath)) {
        const fname = `Teacher-Todd-${raw.slice(0, 8)}.xlsx`
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        return fs.createReadStream(legacyPath).pipe(res)
      }
      res.status(404).json({ error: 'File not found' })
    } catch (err) {
      console.error('[gym/isaac-download]', err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    }
  })

  // Download an individual PDF that was saved with a report
  app.get('/api/gym/isaac-doc/:id/:filename', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      // Sanitise filename — no path traversal
      const safeName = path.basename(req.params.filename || '')
      if (!safeName) return res.status(400).json({ error: 'Invalid filename' })

      const docPath = path.join(resolveIsaacDir(), raw, 'docs', safeName)
      if (!fs.existsSync(docPath)) return res.status(404).json({ error: 'Document not found' })

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}"`)
      fs.createReadStream(docPath).pipe(res)
    } catch (err) {
      console.error('[gym/isaac-doc]', err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    }
  })

  console.log('[isaac] mounted: save-for-isaac, isaac-logs, isaac-download/:id, isaac-doc/:id/:filename')
}
