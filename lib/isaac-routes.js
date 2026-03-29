/**
 * Gym Teacher "Save for Isaac" — mounted FIRST in server.js (right after express.json)
 * so POST /api/gym/save-for-isaac always registers even if something fails later in server.js.
 */
import path from 'path'
import fs from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { generateGymTeacherWorkbook } from './reporter.js'

const ISAAC_SUBDIR = 'isaac-saves'
const ISAAC_MANIFEST = 'manifest.json'
const ISAAC_TMP_ROOT = path.join(tmpdir(), 'todd-isaac-saves')

export function mountIsaacRoutes(app, { outputsDir, parseFolderName }) {
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

  function pruneIsaacWorkbooks(keepIds) {
    const keep = new Set(keepIds)
    try {
      const dir = resolveIsaacDir()
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.xlsx')) continue
        const id = f.replace(/\.xlsx$/i, '')
        if (!keep.has(id)) {
          try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  async function handleSaveForIsaac(req, res) {
    try {
      const { tenantName, folderName, findings, feedbacks, annotations, sessionId, sessionIdx, sessionTotal, reviewerName } = req.body || {}
      const parsed = parseFolderName(folderName || tenantName || '')
      const tenant = {
        property:   parsed.property,
        suite:      parsed.suite,
        tenantName: tenantName || parsed.tenantName || 'Unknown'
      }
      const id = randomUUID()
      const xlsxPath = path.join(resolveIsaacDir(), `${id}.xlsx`)
      await generateGymTeacherWorkbook({ tenant, findings, feedbacks, annotations }, xlsxPath)

      let manifest = readIsaacManifest()
      const entry = {
        id,
        savedAt:    new Date().toISOString(),
        tenantName: tenant.tenantName,
        folderName: folderName || ''
      }
      // Tag with session info if this save is part of an exercise session
      if (sessionId) {
        entry.sessionId    = sessionId
        entry.sessionIdx   = sessionIdx ?? null
        entry.sessionTotal = sessionTotal ?? null
        entry.reviewerName = reviewerName || 'Unknown'
      } else if (reviewerName) {
        entry.reviewerName = reviewerName
      }
      manifest.unshift(entry)
      manifest = manifest.slice(0, 200)
      pruneIsaacWorkbooks(manifest.map(e => e.id))
      writeIsaacManifest(manifest)

      res.json({
        ok: true,
        id,
        downloadUrl: `/api/gym/isaac-download/${id}`
      })
    } catch (err) {
      console.error('[gym/save-for-isaac]', err)
      res.status(500).json({ error: err.message || 'Could not save workbook' })
    }
  }

  app.post('/api/gym/save-for-isaac', handleSaveForIsaac)
  app.post('/api/gym/teacher-save', handleSaveForIsaac)

  app.get('/api/gym/isaac-logs', (_req, res) => {
    try {
      res.json(readIsaacManifest())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/gym/isaac-download/:id', (req, res) => {
    try {
      const raw = (req.params.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return res.status(400).json({ error: 'Invalid id' })
      }
      const p = path.join(resolveIsaacDir(), `${raw}.xlsx`)
      if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' })
      const fname = `Teacher-Todd-${raw.slice(0, 8)}.xlsx`
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      fs.createReadStream(p).pipe(res)
    } catch (err) {
      console.error('[gym/isaac-download]', err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    }
  })

  console.log('[isaac] mounted: POST /api/gym/save-for-isaac, POST /api/gym/teacher-save, GET isaac-logs, GET isaac-download/:id')
}
