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
import { generateGymTeacherWorkbook, generateTargetPracticeWorkbook } from './reporter.js'
import archiver from 'archiver'

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
        // Support both disk-based files and in-memory buffers (local extraction flow)
        if (file.buffer instanceof Buffer) {
          const safeName = path.basename(file.originalName || 'file.bin')
          const destPath = path.join(saveDocsDir, safeName)
          fs.writeFileSync(destPath, file.buffer)
          copied.push(safeName)
        } else {
          if (!file.diskPath || !fs.existsSync(file.diskPath)) continue
          // Sanitise filename — strip any path separators
          const safeName = path.basename(file.originalName || file.diskPath)
          const destPath = path.join(saveDocsDir, safeName)
          fs.copyFileSync(file.diskPath, destPath)
          copied.push(safeName)
        }
      } catch (err) {
        console.warn('[isaac] Could not copy file:', file.originalName, err.message)
      }
    }
    return copied
  }

  async function handleSaveForIsaac(req, res) {
    try {
      const {
        type: reportType = 'gym',
        tenantName, folderName, findings, feedbacks, annotations,
        sessionId, sessionIdx, sessionTotal, reviewerName,
        uploadSessionId, tenantId,
        localFiles  // [{name, base64, size}] — present when client-side extraction was used
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
      if (reportType === 'target-practice') {
        await generateTargetPracticeWorkbook({ tenant, findings, feedbacks, annotations, reviewerName }, xlsxPath)
      } else {
        await generateGymTeacherWorkbook({ tenant, findings, feedbacks, annotations }, xlsxPath)
      }

      // Copy PDFs into docs/ subfolder.
      // Prefer inline localFiles (client-side extraction) over session disk files.
      const docsDir = path.join(saveDir, 'docs')
      let savedDocs = []
      if (Array.isArray(localFiles) && localFiles.length > 0) {
        // Client-side extraction: write base64-encoded files from the request body
        fs.mkdirSync(docsDir, { recursive: true })
        for (const f of localFiles) {
          try {
            const safeName = path.basename(f.name || 'file.bin')
            const destPath = path.join(docsDir, safeName)
            fs.writeFileSync(destPath, Buffer.from(f.base64, 'base64'))
            savedDocs.push(safeName)
          } catch (err) {
            console.warn('[isaac] Could not write local file:', f.name, err.message)
          }
        }
      } else {
        // Legacy: files are on disk in the session's upload directory
        savedDocs = copyPdfsToSave(docsDir, uploadSessionId, tenantId)
      }
      console.log(`[isaac] Saved ${savedDocs.length} PDF(s) alongside report for ${tenant.tenantName}`)

      // Manifest entry
      const entry = {
        id,
        savedAt:    new Date().toISOString(),
        tenantName: tenant.tenantName,
        folderName: folderName || '',
        type:       reportType,
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

  // Delete a save — removes from manifest + deletes files on disk
  app.delete('/api/gym/isaac-delete/:id', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      // Remove from manifest
      let manifest = readIsaacManifest()
      manifest = manifest.filter(e => e.id !== raw)
      writeIsaacManifest(manifest)

      // Delete folder-based save
      const saveDir = path.join(resolveIsaacDir(), raw)
      if (fs.existsSync(saveDir)) {
        fs.rmSync(saveDir, { recursive: true, force: true })
      }
      // Delete legacy single .xlsx if present
      const legacyPath = path.join(resolveIsaacDir(), `${raw}.xlsx`)
      if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath)
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[gym/isaac-delete]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // Download a zip package: report.xlsx + all docs/ PDFs for a single save
  app.get('/api/gym/isaac-package/:id', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      const saveDir = path.join(resolveIsaacDir(), raw)
      const xlsxPath = path.join(saveDir, 'report.xlsx')
      if (!fs.existsSync(xlsxPath)) {
        return res.status(404).json({ error: 'Save not found' })
      }

      // Read manifest to get tenant name for the zip filename
      const manifest = readIsaacManifest()
      const entry = manifest.find(e => e.id === raw)
      const label = (entry?.tenantName || raw.slice(0, 8)).replace(/[^a-zA-Z0-9 _-]/g, '_').trim()
      const zipName = `Todd-Package-${label}.zip`

      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
      res.setHeader('Content-Type', 'application/zip')

      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('error', err => { console.error('[isaac-package]', err); if (!res.headersSent) res.status(500).end() })
      archive.pipe(res)

      // Add the Excel report
      archive.file(xlsxPath, { name: 'report.xlsx' })

      // Add all PDFs from docs/
      const docsDir = path.join(saveDir, 'docs')
      if (fs.existsSync(docsDir)) {
        archive.directory(docsDir, 'docs')
      }

      archive.finalize()
    } catch (err) {
      console.error('[gym/isaac-package]', err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    }
  })

  // Download a zip package for an entire exercise session: all tenant reports + PDFs
  app.get('/api/gym/isaac-session-package/:sessionId', (req, res) => {
    try {
      const sessionId = (req.params.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '')
      if (!sessionId) return res.status(400).json({ error: 'Invalid sessionId' })

      const manifest = readIsaacManifest()
      const sessionEntries = manifest.filter(e => e.sessionId === sessionId)
      if (sessionEntries.length === 0) return res.status(404).json({ error: 'Session not found' })

      const reviewer = (sessionEntries[0]?.reviewerName || 'session').replace(/[^a-zA-Z0-9 _-]/g, '_').trim()
      const zipName = `Todd-Session-${reviewer}.zip`

      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
      res.setHeader('Content-Type', 'application/zip')

      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('error', err => { console.error('[isaac-session-package]', err); if (!res.headersSent) res.status(500).end() })
      archive.pipe(res)

      for (const entry of sessionEntries) {
        const raw = (entry.id || '').replace(/[^a-f0-9-]/gi, '')
        if (!raw) continue
        const saveDir = path.join(resolveIsaacDir(), raw)
        const xlsxPath = path.join(saveDir, 'report.xlsx')
        const label = (entry.tenantName || raw.slice(0, 8)).replace(/[^a-zA-Z0-9 _-]/g, '_').trim()
        const folder = label || raw.slice(0, 8)

        if (fs.existsSync(xlsxPath)) {
          archive.file(xlsxPath, { name: `${folder}/report.xlsx` })
        }
        const docsDir = path.join(saveDir, 'docs')
        if (fs.existsSync(docsDir)) {
          archive.directory(docsDir, `${folder}/docs`)
        }
      }

      archive.finalize()
    } catch (err) {
      console.error('[gym/isaac-session-package]', err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    }
  })

  console.log('[isaac] mounted: save-for-isaac, isaac-logs, isaac-download/:id, isaac-doc/:id/:filename, isaac-delete/:id, isaac-package/:id, isaac-session-package/:sessionId')

  // ── Juice Model endpoints ────────────────────────────────────────────

  const JUICE_MANIFEST = 'juice-manifest.json'

  function juiceManifestPath() {
    return path.join(resolveIsaacDir(), JUICE_MANIFEST)
  }

  function readJuiceManifest() {
    try {
      const p = juiceManifestPath()
      if (!fs.existsSync(p)) return []
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  }

  function writeJuiceManifest(entries) {
    const dir = resolveIsaacDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(juiceManifestPath(), JSON.stringify(entries, null, 2), 'utf8')
  }

  // POST /api/target/save-model
  app.post('/api/target/save-model', (req, res) => {
    try {
      const {
        rules = [], reviewerName, comment, correctionsByTenant = [],
        sessionId, uploadSessionId, tenantCount, modelName, parentModelId, parentModelName,
        deepSynthesis = false
      } = req.body

      const id = randomUUID()
      const dir = resolveIsaacDir()
      fs.mkdirSync(path.join(dir, 'juice-models'), { recursive: true })
      const modelPath = path.join(dir, 'juice-models', `${id}.json`)

      const first = correctionsByTenant[0] ?? 0
      const last  = correctionsByTenant[correctionsByTenant.length - 1] ?? 0
      const errorReduction = first > 0 ? Math.round(((first - last) / first) * 100) : 100

      const model = {
        id, savedAt: new Date().toISOString(),
        name: modelName || `Target Practice Juice — ${reviewerName || 'Unknown'} — ${new Date().toLocaleDateString()}`,
        reviewerName: reviewerName || 'Unknown',
        comment: comment || '',
        rules,
        ruleCount: rules.length,
        tenantCount: tenantCount || correctionsByTenant.length,
        correctionsByTenant,
        errorReduction,
        sessionId:       sessionId       || null,
        uploadSessionId: uploadSessionId || null,
        parentModelId:   parentModelId   || null,
        parentModelName: parentModelName || null,
        deepSynthesis: !!deepSynthesis
      }

      fs.writeFileSync(modelPath, JSON.stringify(model, null, 2), 'utf8')

      const manifest = readJuiceManifest()
      manifest.unshift({
        id, savedAt: model.savedAt, name: model.name,
        reviewerName: model.reviewerName, comment: model.comment,
        ruleCount: model.ruleCount, tenantCount: model.tenantCount,
        errorReduction, correctionsByTenant,
        parentModelId: model.parentModelId, parentModelName: model.parentModelName,
        deepSynthesis: !!deepSynthesis
      })
      writeJuiceManifest(manifest.slice(0, 100))
      res.json({ ok: true, id, errorReduction })
    } catch (err) {
      console.error('[target/save-model]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/target/models — list summaries
  app.get('/api/target/models', (_req, res) => {
    try { res.json(readJuiceManifest()) }
    catch (err) { res.status(500).json({ error: err.message }) }
  })

  // GET /api/target/models/:id — full model with rules
  app.get('/api/target/models/:id', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      const modelPath = path.join(resolveIsaacDir(), 'juice-models', `${raw}.json`)
      if (!fs.existsSync(modelPath)) return res.status(404).json({ error: 'Model not found' })
      res.json(JSON.parse(fs.readFileSync(modelPath, 'utf8')))
    } catch (err) { res.status(500).json({ error: err.message }) }
  })

  // DELETE /api/target/models/:id
  app.delete('/api/target/models/:id', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      const modelPath = path.join(resolveIsaacDir(), 'juice-models', `${raw}.json`)
      if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath)
      writeJuiceManifest(readJuiceManifest().filter(m => m.id !== raw))
      res.json({ ok: true })
    } catch (err) { res.status(500).json({ error: err.message }) }
  })
}
