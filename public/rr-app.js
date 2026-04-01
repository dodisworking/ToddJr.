// ═══════════════════════════════════════════════════════════
// RENT ROLL CHEF — Frontend State Machine
// Isolated from main app.js — no shared state.
// All API calls, SSE, and DOM manipulation live here.
// Sound (sfxKitchenDing etc.) and goTo/toast/sameOriginApi
// are global from app.js.
// ═══════════════════════════════════════════════════════════

;(function RRChef() {
'use strict'

// ── State ────────────────────────────────────────────────────
const rrState = {
  sub:         'upload',  // upload | confirm | cooking | report
  sessionId:   null,
  files:       [],        // [{ id, name, sizeBytes, file (File obj), detectedRole, reasoning }]
  assignments: { client: null, argus: null },  // fileId assignments
  cookStage:   'idle',    // idle | dough | sauce | oven | done
  reportData:  null,
  eventSource: null,
  cookPercent: 0,
  animTimer:   null,
  chefFrame:   0,
}

// ── DOM refs ────────────────────────────────────────────────
const el = id => document.getElementById(id)

// ── Sub-state management ─────────────────────────────────────
function rrGoTo(subName) {
  document.querySelectorAll('#screen-rr .rr-sub').forEach(s => {
    s.classList.remove('active')
    s.classList.add('hidden')
  })
  const target = el(`rr-sub-${subName}`)
  if (target) {
    target.classList.remove('hidden')
    target.classList.add('active')
  }
  rrState.sub = subName

  // Show/hide topbar
  const topbar = el('rr-topbar')
  if (topbar) {
    topbar.classList.toggle('hidden', subName === 'upload')
  }
}

// ── Chef Todd pixel art canvas ───────────────────────────────
// Uses globally defined IDLE1, IDLE2, C, PS, drawFrame from app.js

function drawRRChef(canvas, frame) {
  if (!canvas || typeof drawFrame !== 'function') return
  const sprite = frame === 0 ? IDLE1 : IDLE2
  drawFrame(canvas, sprite)
  const ctx = canvas.getContext('2d')
  const P = typeof PS !== 'undefined' ? PS : 4

  // ── Chef Hat ──────────────────────────────────────────────
  ctx.fillStyle = '#F8FAFC'
  ctx.fillRect(3*P, 0, 9*P, 2*P)          // hat brim
  ctx.fillRect(4*P, -10, 7*P, 12)          // hat body (tall toque)
  ctx.strokeStyle = '#9CA3AF'
  ctx.lineWidth = 1
  ctx.strokeRect(4*P, -10, 7*P, 12)
  ctx.strokeRect(3*P, 0, 9*P, 2*P)
  // Toque puff texture
  ctx.fillStyle = '#E2E8F0'
  ctx.fillRect(5*P, -8, 2*P, 4)
  ctx.fillRect(7*P, -9, 2*P, 5)
  ctx.fillRect(9*P, -7, 2*P, 4)

  // ── Chef Coat (white double-breasted) ─────────────────────
  // Main coat body over torso (rows 5–13 of sprite ≈ y=20–54)
  ctx.fillStyle = '#F8FAFC'
  ctx.fillRect(8, 22, 44, 32)
  // Left arm cuff
  ctx.fillRect(2, 30, 8, 12)
  // Right arm cuff
  ctx.fillRect(50, 30, 8, 12)

  // Coat collar — dark V
  ctx.fillStyle = '#1F2937'
  ctx.beginPath()
  ctx.moveTo(28, 22); ctx.lineTo(22, 30); ctx.lineTo(28, 28); ctx.closePath(); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(32, 22); ctx.lineTo(38, 30); ctx.lineTo(32, 28); ctx.closePath(); ctx.fill()

  // Red chef neckerchief
  ctx.fillStyle = '#DC2626'
  ctx.beginPath()
  ctx.moveTo(22, 22); ctx.lineTo(38, 22); ctx.lineTo(30, 30); ctx.closePath(); ctx.fill()

  // Coat buttons (left column)
  ctx.fillStyle = '#D1D5DB'
  ;[28, 34, 40].forEach(y => ctx.fillRect(18, y, 3, 3))

  // Coat outline
  ctx.strokeStyle = '#9CA3AF'
  ctx.lineWidth = 1
  ctx.strokeRect(8, 22, 44, 32)
  ctx.strokeRect(2, 30, 8, 12)
  ctx.strokeRect(50, 30, 8, 12)

  // ── Apron (white over lower coat) ────────────────────────
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(16, 32, 28, 22)
  ctx.strokeStyle = '#CBD5E1'
  ctx.strokeRect(16, 32, 28, 22)
  // Apron pocket
  ctx.fillStyle = '#F1F5F9'
  ctx.fillRect(24, 38, 12, 10)
  ctx.strokeStyle = '#CBD5E1'
  ctx.strokeRect(24, 38, 12, 10)
}

function startChefAnimation(canvasId) {
  const canvas = el(canvasId)
  if (!canvas) return
  if (rrState.animTimer) clearInterval(rrState.animTimer)
  rrState.chefFrame = 0
  drawRRChef(canvas, 0)
  rrState.animTimer = setInterval(() => {
    rrState.chefFrame = rrState.chefFrame === 0 ? 1 : 0
    drawRRChef(canvas, rrState.chefFrame)
    // Also update cooking canvas if visible
    const cookCanvas = el('rr-cook-canvas')
    if (cookCanvas) drawRRChef(cookCanvas, rrState.chefFrame)
  }, 600)
}

// ── File slot logic ──────────────────────────────────────────
let rrFiles = [null, null]  // File objects for slots 1 and 2

function setSlotFile(slotNum, file) {
  rrFiles[slotNum - 1] = file
  const emptyEl   = el(`rr-slot-${slotNum}-empty`)
  const filledEl  = el(`rr-slot-${slotNum}-filled`)
  const nameEl    = el(`rr-slot-${slotNum}-name`)
  const sizeEl    = el(`rr-slot-${slotNum}-size`)

  if (file) {
    emptyEl.classList.add('hidden')
    filledEl.classList.remove('hidden')
    nameEl.textContent = file.name
    sizeEl.textContent = formatBytes(file.size)
    // Visual drop feedback
    el(`rr-slot-${slotNum}`).classList.add('has-file')
  } else {
    emptyEl.classList.remove('hidden')
    filledEl.classList.add('hidden')
    el(`rr-slot-${slotNum}`).classList.remove('has-file')
  }

  updateUploadBtn()
}

function clearSlot(slotNum) {
  rrFiles[slotNum - 1] = null
  const input = el(`rr-input-${slotNum}`)
  if (input) input.value = ''
  setSlotFile(slotNum, null)
}

function updateUploadBtn() {
  const btn = el('btn-rr-upload')
  if (!btn) return
  const ready = rrFiles[0] && rrFiles[1]
  btn.classList.toggle('hidden', !ready)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── File pick buttons ────────────────────────────────────────
function bindSlotPick(slotNum) {
  const btn   = el(`btn-rr-pick-${slotNum}`)
  const input = el(`rr-input-${slotNum}`)
  const slot  = el(`rr-slot-${slotNum}`)

  if (!btn || !input) return

  btn.addEventListener('click', e => {
    e.stopPropagation()
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
    input.click()
  })

  input.addEventListener('change', () => {
    if (input.files && input.files[0]) setSlotFile(slotNum, input.files[0])
  })

  el(`btn-rr-remove-${slotNum}`)?.addEventListener('click', e => {
    e.stopPropagation()
    clearSlot(slotNum)
  })

  // Drag-and-drop
  slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drag-over') })
  slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'))
  slot.addEventListener('drop', e => {
    e.preventDefault()
    slot.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (file) setSlotFile(slotNum, file)
  })
}

// ── Upload ───────────────────────────────────────────────────
async function uploadRRFiles() {
  if (!rrFiles[0] || !rrFiles[1]) return

  // Show spinner
  el('btn-rr-upload').classList.add('hidden')
  const statusEl = el('rr-upload-status')
  const statusText = el('rr-upload-status-text')
  statusEl.classList.remove('hidden')
  statusText.textContent = 'READING FILES...'

  if (typeof sfxDoughRoll === 'function') sfxDoughRoll()

  try {
    const fd = new FormData()
    fd.append('files', rrFiles[0])
    fd.append('files', rrFiles[1])

    const url = typeof sameOriginApi === 'function'
      ? sameOriginApi('/api/rr/upload')
      : '/api/rr/upload'

    statusText.textContent = 'CHEF TODD IS SNIFFING THE FILES...'

    const resp = await fetch(url, { method: 'POST', body: fd })
    const data = await resp.json()

    if (!resp.ok) throw new Error(data.error || 'Upload failed')

    rrState.sessionId = data.sessionId
    rrState.files = data.files.map((f, i) => ({
      ...f,
      file: rrFiles[i]
    }))

    // Set initial assignments based on detected roles
    rrState.assignments = {
      argus:  data.files.find(f => f.detectedRole === 'ARGUS')?.id  || data.files[0].id,
      client: data.files.find(f => f.detectedRole === 'CLIENT')?.id || data.files[1].id,
    }

    statusEl.classList.add('hidden')
    renderConfirm(data)
    rrGoTo('confirm')

  } catch (err) {
    statusEl.classList.add('hidden')
    el('btn-rr-upload').classList.remove('hidden')
    if (typeof toast === 'function') toast(`Upload failed: ${err.message}`, 'error')
    else alert(`Upload failed: ${err.message}`)
  }
}

// ── Confirm screen ───────────────────────────────────────────
function renderConfirm(data) {
  const cards = el('rr-confirm-cards')
  if (!cards) return

  const files = rrState.files
  const assignments = rrState.assignments

  const clientFile = files.find(f => f.id === assignments.client)
  const argusFile  = files.find(f => f.id === assignments.argus)

  cards.innerHTML = `
    <div class="rr-confirm-card rr-card-client">
      <div class="rr-card-badge">CLIENT ACCOUNTING</div>
      <div class="rr-card-icon">🏢</div>
      <div class="rr-card-name">${escapeHtml(clientFile?.name || '—')}</div>
      <div class="rr-card-size">${clientFile ? formatBytes(clientFile.sizeBytes) : ''}</div>
      <div class="rr-card-reason">${escapeHtml(clientFile?.reasoning || '')}</div>
    </div>
    <div class="rr-confirm-vs">VS</div>
    <div class="rr-confirm-card rr-card-argus">
      <div class="rr-card-badge">ARGUS ENTERPRISE</div>
      <div class="rr-card-icon">📐</div>
      <div class="rr-card-name">${escapeHtml(argusFile?.name || '—')}</div>
      <div class="rr-card-size">${argusFile ? formatBytes(argusFile.sizeBytes) : ''}</div>
      <div class="rr-card-reason">${escapeHtml(argusFile?.reasoning || '')}</div>
    </div>
  `

  // Confidence badge
  const confBadge = data.confidence === 'HIGH' ? '✅ HIGH CONFIDENCE'
    : data.confidence === 'MEDIUM' ? '⚠️ MEDIUM CONFIDENCE'
    : '❓ LOW CONFIDENCE'

  const swapHint = el('rr-confirm-swap-hint')
  if (swapHint) {
    const existingBadge = swapHint.querySelector('.rr-confidence-badge')
    if (!existingBadge) {
      const badge = document.createElement('span')
      badge.className = `rr-confidence-badge conf-${(data.confidence || 'low').toLowerCase()}`
      badge.textContent = confBadge
      swapHint.insertBefore(badge, swapHint.firstChild)
    }
  }
}

function swapAssignments() {
  const { client, argus } = rrState.assignments
  rrState.assignments = { client: argus, argus: client }
  renderConfirm({ confidence: 'LOW' })
  if (typeof sfxBtnClick === 'function') sfxBtnClick()
}

// ── Cooking / SSE ────────────────────────────────────────────
function startMasterChef() {
  if (typeof sfxBtnClick === 'function') sfxBtnClick()
  if (rrState.eventSource) { rrState.eventSource.close(); rrState.eventSource = null }

  rrGoTo('cooking')
  startChefAnimation('rr-cook-canvas')
  // Force all stages hidden + reset cookStage so animations restart fresh
  rrState.cookStage = 'idle'
  ;['dough','sauce','toppings','pan','oven','done'].forEach(s => {
    const el2 = el(`rr-stage-${s}`)
    if (el2) { el2.classList.add('hidden'); void el2.offsetHeight }
  })
  setCookStage('dough')

  const { sessionId, assignments } = rrState
  const checksData = getEnabledCheckIds()  // { standard, custom } or null
  const checksParam = checksData ? `&checks=${encodeURIComponent(JSON.stringify(checksData))}` : ''
  const baseUrl = `/api/rr/analyze?sessionId=${sessionId}&clientFileId=${assignments.client}&argusFileId=${assignments.argus}${checksParam}`
  const url = typeof sameOriginApi === 'function' ? sameOriginApi(baseUrl) : baseUrl

  const es = new EventSource(url)
  rrState.eventSource = es

  es.addEventListener('rr-start', () => {
    setCookStage('dough')
    updateCookProgress(5, 'Chef Todd has entered the kitchen...')
  })

  es.addEventListener('rr-progress', e => {
    try {
      const d = JSON.parse(e.data)
      updateCookProgress(d.percent || 0, d.message || '')
      const pct = d.percent || 0
      if (d.stage === 'parsing-client') {
        if (pct < 15) setCookStage('dough')
        else setCookStage('sauce')
      } else if (d.stage === 'parsing-argus') {
        setCookStage('toppings')
      } else if (d.stage === 'analyzing') {
        if (pct < 58) setCookStage('pan')
        else setCookStage('oven')
      }
    } catch {}
  })

  es.addEventListener('rr-complete', e => {
    es.close()
    rrState.eventSource = null
    let data
    try {
      data = JSON.parse(e.data)
    } catch (err) {
      console.error('[rr-complete] JSON parse error:', err, 'raw:', e.data?.slice(0, 300))
      if (typeof toast === 'function') toast('Result parsing error — check console', 'error')
      rrGoTo('confirm')
      return
    }
    try {
      rrState.reportData = data
      setCookStage('done')
      updateCookProgress(100, 'Pizza is ready!')
      if (typeof sfxKitchenDing === 'function') sfxKitchenDing()
      const ding = el('rr-pizza-ding')
      if (ding) { ding.classList.remove('hidden'); ding.classList.add('ding-pop') }
      setTimeout(() => {
        if (rrState.animTimer) { clearInterval(rrState.animTimer); rrState.animTimer = null }
        renderReport(data)
        rrGoTo('report')
      }, 2200)
    } catch (err) {
      console.error('[rr-complete] render error:', err)
      if (typeof toast === 'function') toast(`Render error: ${err.message}`, 'error')
      rrGoTo('confirm')
    }
  })

  es.addEventListener('rr-error', e => {
    let msg = 'Analysis failed'
    try { msg = JSON.parse(e.data).error || msg } catch {}
    console.error('[rr-error]', msg)
    if (typeof toast === 'function') toast(`Analysis failed: ${msg}`, 'error')
    else alert(`Analysis failed: ${msg}`)
    es.close()
    rrState.eventSource = null
    rrGoTo('confirm')
  })

  es.onerror = (err) => {
    if (es.readyState === EventSource.CLOSED) return
    console.error('[rr SSE onerror]', err)
    if (typeof toast === 'function') toast('Connection lost. Please try again.', 'error')
    es.close()
    rrState.eventSource = null
    rrGoTo('confirm')
  }
}

function setCookStage(stage) {
  if (rrState.cookStage === stage) return  // no-op if same stage
  const stages = ['dough', 'sauce', 'toppings', 'pan', 'oven', 'done']
  stages.forEach(s => {
    const el2 = el(`rr-stage-${s}`)
    if (!el2) return
    el2.classList.toggle('hidden', s !== stage)
  })
  rrState.cookStage = stage

  if (stage === 'dough'    && typeof sfxDoughRoll   === 'function') sfxDoughRoll()
  if (stage === 'sauce'    && typeof sfxSauceSpread  === 'function') sfxSauceSpread()
  if (stage === 'toppings' && typeof sfxToppings     === 'function') sfxToppings()
  if (stage === 'pan'      && typeof sfxPanSizzle    === 'function') sfxPanSizzle()
  if (stage === 'oven'     && typeof sfxOvenDoor     === 'function') sfxOvenDoor()
}

function updateCookProgress(percent, message) {
  const fill = el('rr-cook-fill')
  const msg  = el('rr-cook-msg')
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`
  if (msg)  msg.textContent = message || ''
  rrState.cookPercent = percent
}

// ── Report ───────────────────────────────────────────────────
function renderReport(data) {
  // Property header
  const propEl = el('rr-report-property')
  if (propEl) propEl.textContent = data.property || 'Unknown Property'

  // Stat grid
  const grid = el('rr-stat-grid')
  if (grid) {
    const s = data.summary || {}
    const stats = [
      { label: 'CLIENT TENANTS',    value: s.clientTenants   ?? '—', color: '#93C5FD' },
      { label: 'ARGUS TENANTS',     value: s.argusTenants    ?? '—', color: '#CDB4FB' },
      { label: 'MATCHED',           value: s.matched         ?? '—', color: '#6EE7B7' },
      { label: 'DISCREPANCIES',     value: s.discrepancyCount ?? s.discrepancies ?? '—', color: '#FBBF24' },
      { label: 'MISSING CLIENT',    value: s.missingFromClient ?? '—', color: '#F9A8D4' },
      { label: 'MISSING ARGUS',     value: s.missingFromArgus  ?? '—', color: '#FCA5A5' },
      { label: 'HIGH SEVERITY',     value: s.highSeverity    ?? '—', color: '#F87171' },
      { label: 'MEDIUM SEVERITY',   value: s.mediumSeverity  ?? '—', color: '#FDE68A' },
    ]
    grid.innerHTML = stats.map(stat => `
      <div class="rr-stat-box">
        <div class="rr-stat-value" style="color:${stat.color}">${stat.value}</div>
        <div class="rr-stat-label">${stat.label}</div>
      </div>
    `).join('')
  }

  // Preview table — first 10 discrepancies from flat list
  const previewTable = el('rr-preview-table')
  if (previewTable) {
    const disc    = (data.discrepancies || []).slice(0, 10)
    const missing = (data.missing || []).slice(0, 5)

    if (disc.length === 0 && missing.length === 0) {
      previewTable.innerHTML = '<div class="rr-preview-empty">✅ No discrepancies found — all tenants match!</div>'
    } else {
      const discRows = disc.map((d, i) => {
        const sevColor = d.severity === 'HIGH' ? '#F87171' : d.severity === 'LOW' ? '#94A3B8' : '#FBBF24'
        return `
          <div class="rr-preview-row">
            <div class="rr-prev-header">
              <span class="rr-prev-suite">${escapeHtml(d.suite || '—')}</span>
              <span class="rr-prev-sev" style="color:${sevColor}">${escapeHtml(d.severity || '')}</span>
              <span class="rr-prev-name">${escapeHtml(d.clientTenant || d.argusTenant || '—')}</span>
            </div>
            <div class="rr-prev-field-row">
              <span class="rr-prev-field-name">${escapeHtml(d.field || '—')}</span>
              <span class="rr-prev-field-client">${escapeHtml(d.clientValue || '—')}</span>
              <span class="rr-prev-field-arrow">→</span>
              <span class="rr-prev-field-argus">${escapeHtml(d.argusValue || '—')}</span>
            </div>
            ${d.note ? `<div class="rr-prev-assessment">${escapeHtml(d.note)}</div>` : ''}
          </div>`
      })
      const missingRows = missing.map(m => `
          <div class="rr-preview-row">
            <div class="rr-prev-header">
              <span class="rr-prev-suite">${escapeHtml(m.suite || '—')}</span>
              <span class="rr-prev-sev" style="color:#E879F9">${escapeHtml(m.side || 'MISSING')}</span>
              <span class="rr-prev-name">${escapeHtml(m.name || '—')}</span>
            </div>
          </div>`)
      previewTable.innerHTML = [...discRows, ...missingRows].join('')
    }
  }

  // Download button
  const dlBtn = el('rr-download-btn')
  if (dlBtn && data.downloadPath) {
    const url = typeof sameOriginApi === 'function'
      ? sameOriginApi(data.downloadPath)
      : data.downloadPath
    dlBtn.href = url
    dlBtn.setAttribute('download', `RentRoll-Reconciliation.xlsx`)
  }
}

// ── Cook-again reset ─────────────────────────────────────────
function resetRR() {
  if (rrState.eventSource) { rrState.eventSource.close(); rrState.eventSource = null }
  if (rrState.animTimer)   { clearInterval(rrState.animTimer); rrState.animTimer = null }
  rrFiles = [null, null]
  rrState.sessionId = null
  rrState.files = []
  rrState.assignments = { client: null, argus: null }
  rrState.cookStage = 'idle'
  rrState.reportData = null
  rrState.cookPercent = 0

  // Clear file inputs and slots
  clearSlot(1)
  clearSlot(2)

  // Reset cooking stage (force by clearing state first)
  rrState.cookStage = 'idle'
  setCookStage('dough')
  updateCookProgress(0, 'Preparing kitchen...')

  // Clear confirm cards
  const cards = el('rr-confirm-cards')
  if (cards) cards.innerHTML = ''

  // Remove old confidence badge
  const badge = document.querySelector('.rr-confidence-badge')
  if (badge) badge.remove()

  rrGoTo('upload')

  // Restart hero animation
  setTimeout(() => startChefAnimation('rr-hero-chef-canvas'), 100)
}

// ══════════════════════════════════════════════════════════════
// SECRET RECIPE MODE
// ══════════════════════════════════════════════════════════════
const SECRET_RECIPE_KEY = 'rr_secret_recipe'

const DEFAULT_INGREDIENTS = [
  { id: 'tenant_name', label: 'TENANT NAME MATCH',       emoji: '🏷️',  on: true },
  { id: 'suite',       label: 'SUITE / UNIT MATCH',      emoji: '🔢',  on: true },
  { id: 'square_feet', label: 'SQUARE FOOTAGE',          emoji: '📐',  on: true },
  { id: 'lease_start', label: 'LEASE START DATE',        emoji: '📅',  on: true },
  { id: 'lease_exp',   label: 'LEASE EXPIRATION DATE',   emoji: '📆',  on: true },
  { id: 'rent',        label: 'RENT AMOUNT',             emoji: '💰',  on: true },
  { id: 'rent_steps',  label: 'RENT STEPS (AMT + DATE)', emoji: '📈',  on: true },
  { id: 'cam',         label: 'CAM / NNN CHARGES',       emoji: '🏢',  on: true },
  { id: 'rent_psf',    label: 'RENT PER SF',             emoji: '💲',  on: true },
  { id: 'name_fuzzy',  label: 'FUZZY NAME MATCHING',     emoji: '🔍',  on: true },
  { id: 'rounding',    label: 'IGNORE <$0.02/SF DIFFS',  emoji: '🔄',  on: true },
  { id: 'normalize',   label: 'NORMALIZE RENT FORMAT',   emoji: '📊',  on: true },
]

const INGREDIENT_INFO = {
  tenant_name:  'Checks that tenant names refer to the same business. Flags name variations like "ACME Corp" vs "ACME Corporation" as NAME_VARIATION rather than a hard discrepancy.',
  suite:        '"Unit" and "Suite" are treated as identical. Combined suites (e.g. Argus "101-102" vs separate Client rows "101" + "102") are detected and aggregated automatically.',
  square_feet:  'Compares rentable SF only — building share percentage is ignored. Differences >2% are flagged HIGH severity. Smaller differences get MEDIUM or LOW.',
  lease_start:  'Checks lease commencement/start dates across both systems. Variances ≤30 days = MEDIUM, >30 days = HIGH severity.',
  lease_exp:    'Checks lease expiration and termination dates. Variances ≤30 days = MEDIUM, >30 days = HIGH. Early termination options noted if present.',
  rent:         'Compares total annual rent. Claude first normalizes all rent formats (monthly, annual, monthly/SF, annual/SF) to the same basis before comparing.',
  rent_steps:   'Verifies rent step schedules — both the step AMOUNT and the exact step DATE (month + year). A step on Apr 2027 in one system vs May 2027 in the other is flagged HIGH.',
  cam:          'Checks CAM (Common Area Maintenance), NNN, operating expenses, and insurance charges. Compares absolute dollar amounts and $/SF if available.',
  rent_psf:     'Compares annual rent expressed as $/SF after normalization. Differences <$0.02/SF are treated as rounding errors and ignored.',
  name_fuzzy:   'When names differ, Claude first tries to match by suite number, then by approximate name similarity, then by square footage. Reduces false positives from minor name formatting differences.',
  rounding:     'Differences smaller than $0.02/SF are classified as MATCH (LOW) rather than DISCREPANCY. This ignores harmless rounding that occurs between systems.',
  normalize:    'Converts all rent expressions to a common format (annual total + annual $/SF) before any comparison. Without this, monthly vs annual entries would always appear as discrepancies.',
}

let secretState = {
  mode:      false,
  editMode:  false,
  openInfo:  null,        // id of ingredient with info panel open
  ingredients: null,
}

function loadSecretRecipe() {
  try {
    const saved = JSON.parse(localStorage.getItem(SECRET_RECIPE_KEY) || 'null')
    if (saved) {
      secretState.mode = !!saved.mode
      // Merge: keep defaults, apply saved on/off, keep any custom
      const savedById = {}
      ;(saved.ingredients || []).forEach(i => { savedById[i.id] = i })
      secretState.ingredients = DEFAULT_INGREDIENTS.map(d => ({
        ...d,
        on: savedById[d.id] !== undefined ? !!savedById[d.id].on : d.on
      }))
      // Append any custom ingredients not in defaults
      ;(saved.ingredients || []).filter(i => !DEFAULT_INGREDIENTS.find(d => d.id === i.id))
        .forEach(i => secretState.ingredients.push(i))
    } else {
      secretState.ingredients = DEFAULT_INGREDIENTS.map(d => ({ ...d }))
    }
  } catch {
    secretState.ingredients = DEFAULT_INGREDIENTS.map(d => ({ ...d }))
  }
}

function saveSecretRecipe() {
  try {
    localStorage.setItem(SECRET_RECIPE_KEY, JSON.stringify({
      mode: secretState.mode,
      ingredients: secretState.ingredients
    }))
  } catch {}
}

// Returns { standard: [ids], custom: [labels] } or null if mode off
function getEnabledCheckIds() {
  if (!secretState.mode) return null
  const on = (secretState.ingredients || []).filter(i => i.on)
  return {
    standard: on.filter(i => !i.custom).map(i => i.id),
    custom:   on.filter(i => i.custom).map(i => i.label),
  }
}

function renderIngredients() {
  const list = el('rr-ingredients-list')
  if (!list) return
  const editMode = secretState.editMode

  list.innerHTML = (secretState.ingredients || []).map(ing => {
    const infoText = ing.custom
      ? `Custom AI check — Claude will be explicitly instructed to: "${escapeHtml(ing.label)}"`
      : escapeHtml(INGREDIENT_INFO[ing.id] || '')
    const infoOpen = secretState.openInfo === ing.id
    return `
    <div class="rr-ingredient${ing.on ? ' ing-on' : ' ing-off'}${infoOpen ? ' info-open' : ''}" data-id="${escapeHtml(ing.id)}">
      <div class="ing-main-row">
        <span class="ing-emoji">${ing.emoji || '🍕'}</span>
        <span class="ing-label">${escapeHtml(ing.label)}</span>
        <button class="ing-info-btn" data-id="${escapeHtml(ing.id)}" title="What does this check?">ℹ</button>
        <label class="rr-toggle rr-ing-toggle">
          <input type="checkbox" class="ing-checkbox" data-id="${escapeHtml(ing.id)}" ${ing.on ? 'checked' : ''} />
          <span class="rr-toggle-track"></span>
        </label>
        ${editMode ? `<button class="ing-delete" data-id="${escapeHtml(ing.id)}" title="Delete">✕</button>` : ''}
      </div>
      ${infoOpen && infoText ? `<div class="ing-info-panel">${infoText}</div>` : ''}
    </div>`
  }).join('')

  // Toggles
  list.querySelectorAll('.ing-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const ing = secretState.ingredients.find(i => i.id === cb.dataset.id)
      if (ing) { ing.on = cb.checked; saveSecretRecipe(); renderIngredients() }
    })
  })
  // Info buttons
  list.querySelectorAll('.ing-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const id = btn.dataset.id
      secretState.openInfo = secretState.openInfo === id ? null : id
      renderIngredients()
    })
  })
  // Delete buttons
  list.querySelectorAll('.ing-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      secretState.ingredients = secretState.ingredients.filter(i => i.id !== btn.dataset.id)
      saveSecretRecipe()
      renderIngredients()
    })
  })
}

function updateSecretBtn() {
  const btn = el('btn-rr-secret')
  if (!btn) return
  btn.classList.toggle('secret-active', secretState.mode)
}

function initSecretRecipe() {
  loadSecretRecipe()

  const btn      = el('btn-rr-secret')
  const panel    = el('rr-secret-panel')
  const closeBtn = el('btn-rr-secret-close')
  const modeToggle = el('rr-secret-mode-toggle')
  const addBtn   = el('btn-rr-add-ingredient')
  const addInput = el('rr-ingredient-input')

  if (!btn || !panel) return

  // Sync mode toggle to saved state
  if (modeToggle) modeToggle.checked = secretState.mode
  updateSecretBtn()
  renderIngredients()

  btn.addEventListener('click', () => {
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
    panel.classList.toggle('hidden')
    if (!panel.classList.contains('hidden')) renderIngredients()
  })

  closeBtn?.addEventListener('click', () => {
    panel.classList.add('hidden')
  })

  modeToggle?.addEventListener('change', () => {
    secretState.mode = modeToggle.checked
    saveSecretRecipe()
    updateSecretBtn()
  })

  // EDIT mode toggle
  el('btn-rr-edit-mode')?.addEventListener('click', () => {
    secretState.editMode = !secretState.editMode
    const editBtn = el('btn-rr-edit-mode')
    if (editBtn) editBtn.textContent = secretState.editMode ? '✓ DONE' : '✎ EDIT'
    editBtn?.classList.toggle('edit-mode-active', secretState.editMode)
    renderIngredients()
  })

  addBtn?.addEventListener('click', () => {
    const label = (addInput?.value || '').trim()  // keep natural language as-is
    if (!label) return
    const id = 'custom_' + Date.now()
    secretState.ingredients.push({ id, label, emoji: '🍕', on: true, custom: true })
    saveSecretRecipe()
    renderIngredients()
    if (addInput) addInput.value = ''
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
  })

  addInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addBtn?.click()
  })
}

// ── Utility ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ══════════════════════════════════════════════════════════════
// EXTRA LARGE PIZZA ORDER — Batch folder analysis
// ══════════════════════════════════════════════════════════════

const xlState = {
  clients: [],        // [{ id, name, argusFile, clientFile, status, progress, msg, reportUrl }]
  eventSources: {},   // { clientId: EventSource }
}

// Detect argus vs client from folder/file name
function xlDetectRole(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('argus')) return 'argus'
  if (n.includes('client') || n.includes('accounting') || n.includes('yardi') || n.includes('mri')) return 'client'
  return null
}

// Pick best file: xlsx > xls > csv > pdf > png
function xlPickBest(files) {
  if (!files || !files.length) return null
  const order = { xlsx: 0, xls: 1, csv: 2, pdf: 3, png: 4, jpg: 5, jpeg: 5 }
  return [...files].sort((a, b) => {
    const ea = a.name.split('.').pop().toLowerCase()
    const eb = b.name.split('.').pop().toLowerCase()
    return (order[ea] ?? 99) - (order[eb] ?? 99)
  })[0]
}

// Parse a flat array of Files (with webkitRelativePath) into client pairs
function xlParseFiles(fileArray) {
  const groups = {}  // clientName → { argusFiles, clientFiles }

  for (const file of fileArray) {
    const rel = file.webkitRelativePath || file.name
    const parts = rel.split('/')
    let clientName = null, role = null

    if (parts.length >= 4) {
      // root/client/roleFolder/file
      clientName = parts[1]
      role = xlDetectRole(parts[2]) || xlDetectRole(parts[3])
    } else if (parts.length === 3) {
      const midRole = xlDetectRole(parts[1])
      if (midRole) {
        clientName = parts[0]
        role = midRole
      } else {
        clientName = parts[1]
        role = xlDetectRole(parts[2]) || xlDetectRole(parts[1])
      }
    } else if (parts.length === 2) {
      clientName = parts[0]
      role = xlDetectRole(parts[1])
    }

    if (!clientName || !role) continue
    if (!groups[clientName]) groups[clientName] = { argusFiles: [], clientFiles: [] }
    if (role === 'argus') groups[clientName].argusFiles.push(file)
    else groups[clientName].clientFiles.push(file)
  }

  return Object.entries(groups)
    .map(([name, g]) => ({
      id: 'xl_' + Math.random().toString(36).slice(2),
      name,
      argusFile:   xlPickBest(g.argusFiles),
      clientFile:  xlPickBest(g.clientFiles),
      argusCount:  g.argusFiles.length,
      clientCount: g.clientFiles.length,
      status: 'pending', progress: 0, msg: 'Waiting...', reportUrl: null,
    }))
    .filter(c => c.argusFile && c.clientFile)
}

// Recursively read a drag-drop directory entry into flat file list
async function xlReadEntry(entry, files, pathPrefix) {
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(f => {
        const path = (pathPrefix ? pathPrefix + '/' : '') + f.name
        Object.defineProperty(f, 'webkitRelativePath', { value: path, writable: false })
        files.push(f)
        resolve()
      })
    })
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    return new Promise(resolve => {
      reader.readEntries(async entries => {
        const prefix = (pathPrefix ? pathPrefix + '/' : '') + entry.name
        await Promise.all(entries.map(e => xlReadEntry(e, files, prefix)))
        resolve()
      })
    })
  }
}

function xlRenderQueue() {
  const list = el('rr-xl-client-list')
  const fireBtn = el('btn-rr-xl-fire')
  if (!list) return

  if (!xlState.clients.length) {
    list.classList.add('hidden')
    fireBtn?.classList.add('hidden')
    return
  }

  list.classList.remove('hidden')
  fireBtn?.classList.remove('hidden')

  list.innerHTML = `
    <div class="rr-xl-list-header">${xlState.clients.length} CLIENT${xlState.clients.length > 1 ? 'S' : ''} DETECTED</div>
    ${xlState.clients.map(c => `
      <div class="rr-xl-client-row" data-id="${c.id}">
        <div class="rr-xl-client-name">${escapeHtml(c.name)}</div>
        <div class="rr-xl-client-files">
          <span class="rr-xl-tag rr-xl-tag-argus">📐 ${escapeHtml(c.argusFile.name)}</span>
          <span class="rr-xl-tag rr-xl-tag-client">📄 ${escapeHtml(c.clientFile.name)}</span>
        </div>
        <button class="rr-xl-remove" data-id="${c.id}">✕</button>
      </div>
    `).join('')}
  `

  list.querySelectorAll('.rr-xl-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      xlState.clients = xlState.clients.filter(c => c.id !== btn.dataset.id)
      xlRenderQueue()
    })
  })
}

function xlRenderProgressList() {
  const list = el('rr-xl-progress-list')
  if (!list) return
  list.innerHTML = xlState.clients.map(c => `
    <div class="rr-xl-prog-row" id="xl-prog-${c.id}">
      <div class="rr-xl-prog-name">${escapeHtml(c.name)}</div>
      <div class="rr-xl-prog-track">
        <div class="rr-xl-prog-fill" id="xl-fill-${c.id}" style="width:0%"></div>
      </div>
      <div class="rr-xl-prog-msg" id="xl-msg-${c.id}">Waiting...</div>
      <div class="rr-xl-prog-icon" id="xl-icon-${c.id}">⏳</div>
    </div>
  `).join('')
}

function xlUpdateProgress(id, pct, msg, status) {
  const fill = el(`xl-fill-${id}`)
  const msgEl = el(`xl-msg-${id}`)
  const icon  = el(`xl-icon-${id}`)
  const row   = el(`xl-prog-${id}`)
  if (fill)  fill.style.width = `${Math.min(100, pct)}%`
  if (msgEl) msgEl.textContent = msg || ''
  if (icon)  icon.textContent = status === 'done' ? '✅' : status === 'error' ? '❌' : '⏳'
  if (row)   row.className = `rr-xl-prog-row xl-status-${status || 'running'}`
}

async function xlUploadClient(c) {
  const fd = new FormData()
  fd.append('files', c.argusFile)
  fd.append('files', c.clientFile)
  const url = typeof sameOriginApi === 'function' ? sameOriginApi('/api/rr/upload') : '/api/rr/upload'
  const resp = await fetch(url, { method: 'POST', body: fd })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || 'Upload failed')
  return {
    sessionId:    data.sessionId,
    argusFileId:  data.files.find(f => f.detectedRole === 'ARGUS')?.id || data.files[0].id,
    clientFileId: data.files.find(f => f.detectedRole === 'CLIENT')?.id || data.files[1].id,
  }
}

function xlAnalyzeClient(c, sessionId, argusFileId, clientFileId) {
  return new Promise((resolve, reject) => {
    const checks = getEnabledCheckIds()  // { standard, custom } or null
    const cp = checks ? `&checks=${encodeURIComponent(JSON.stringify(checks))}` : ''
    const base = `/api/rr/analyze?sessionId=${sessionId}&clientFileId=${clientFileId}&argusFileId=${argusFileId}${cp}`
    const url = typeof sameOriginApi === 'function' ? sameOriginApi(base) : base
    const es = new EventSource(url)
    xlState.eventSources[c.id] = es

    es.addEventListener('rr-progress', e => {
      try { const d = JSON.parse(e.data); xlUpdateProgress(c.id, d.percent || 0, d.message || '', 'running') } catch {}
    })
    es.addEventListener('rr-complete', e => {
      try {
        const d = JSON.parse(e.data)
        c.reportUrl = d.downloadPath
        c.status = 'done'
        c.summary = d.summary
        xlUpdateProgress(c.id, 100, 'Done!', 'done')
        xlAddResultCard(c, d)
      } catch {}
      es.close(); delete xlState.eventSources[c.id]; resolve()
    })
    es.addEventListener('rr-error', e => {
      try { const d = JSON.parse(e.data); c.error = d.error } catch {}
      c.status = 'error'
      xlUpdateProgress(c.id, 0, `Failed: ${c.error || 'Unknown error'}`, 'error')
      es.close(); delete xlState.eventSources[c.id]; reject(new Error(c.error))
    })
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return
      es.close(); delete xlState.eventSources[c.id]; reject(new Error('Connection lost'))
    }
  })
}

function xlAddResultCard(c, data) {
  const container = el('rr-xl-results')
  if (!container) return
  const s = data.summary || {}
  const dlUrl = typeof sameOriginApi === 'function' ? sameOriginApi(data.downloadPath) : data.downloadPath
  const card = document.createElement('div')
  card.className = 'rr-xl-result-card'
  card.id = `xl-result-${c.id}`
  card.innerHTML = `
    <div class="rr-xl-result-name">${escapeHtml(c.name)}</div>
    <div class="rr-xl-result-stats">
      <span class="rr-xl-stat">${s.matched ?? '—'} matched</span>
      <span class="rr-xl-stat rr-xl-stat-warn">${s.discrepancies ?? '—'} issues</span>
      <span class="rr-xl-stat rr-xl-stat-danger">${s.highSeverity ?? '—'} high</span>
    </div>
    <a class="rr-xl-result-dl" href="${escapeHtml(dlUrl)}" download>📥 DOWNLOAD EXCEL</a>
  `
  container.appendChild(card)
}

async function xlFireOvens() {
  if (!xlState.clients.length) return
  if (typeof sfxBtnClick === 'function') sfxBtnClick()
  rrGoTo('xl-cooking')
  xlRenderProgressList()

  await Promise.all(xlState.clients.map(async c => {
    try {
      xlUpdateProgress(c.id, 5, 'Uploading...', 'running')
      const { sessionId, argusFileId, clientFileId } = await xlUploadClient(c)
      c.sessionId = sessionId
      xlUpdateProgress(c.id, 20, 'Analyzing...', 'running')
      await xlAnalyzeClient(c, sessionId, argusFileId, clientFileId)
    } catch (err) {
      c.status = 'error'
      xlUpdateProgress(c.id, 0, `Error: ${err.message}`, 'error')
    }
  }))

  setTimeout(() => {
    if (typeof sfxKitchenDing === 'function') sfxKitchenDing()
    rrGoTo('xl-done')
  }, 600)
}

function xlReset() {
  Object.values(xlState.eventSources).forEach(es => { try { es.close() } catch {} })
  xlState.eventSources = {}
  xlState.clients = []
  const input = el('rr-xl-input')
  if (input) input.value = ''
  const list = el('rr-xl-client-list')
  if (list) { list.innerHTML = ''; list.classList.add('hidden') }
  el('btn-rr-xl-fire')?.classList.add('hidden')
  const results = el('rr-xl-results')
  if (results) results.innerHTML = ''
  const prog = el('rr-xl-progress-list')
  if (prog) prog.innerHTML = ''
  rrGoTo('xl-queue')
}

function initXLOrder() {
  el('btn-rr-xl-order')?.addEventListener('click', () => {
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
    xlState.clients = []
    const list = el('rr-xl-client-list')
    if (list) { list.innerHTML = ''; list.classList.add('hidden') }
    el('btn-rr-xl-fire')?.classList.add('hidden')
    rrGoTo('xl-queue')
  })

  el('btn-rr-xl-pick')?.addEventListener('click', () => el('rr-xl-input')?.click())

  el('rr-xl-input')?.addEventListener('change', e => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    xlState.clients = xlParseFiles(files)
    if (!xlState.clients.length) {
      if (typeof toast === 'function') toast('No client pairs found. Check folder names contain "argus" and "client".', 'error')
      return
    }
    xlRenderQueue()
  })

  const dz = el('rr-xl-dropzone')
  dz?.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over') })
  dz?.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz?.addEventListener('drop', async e => {
    e.preventDefault()
    dz.classList.remove('drag-over')
    const items = Array.from(e.dataTransfer?.items || [])
    const allFiles = []
    await Promise.all(items.map(item => {
      const entry = item.webkitGetAsEntry?.()
      return entry ? xlReadEntry(entry, allFiles, '') : Promise.resolve()
    }))
    if (!allFiles.length) return
    xlState.clients = xlParseFiles(allFiles)
    if (!xlState.clients.length) {
      if (typeof toast === 'function') toast('No client pairs found. Check folder structure.', 'error')
      return
    }
    xlRenderQueue()
  })

  el('btn-rr-xl-fire')?.addEventListener('click', xlFireOvens)
  el('btn-rr-xl-back')?.addEventListener('click', () => rrGoTo('upload'))
  el('btn-rr-xl-new-order')?.addEventListener('click', xlReset)
}

// ── Init ─────────────────────────────────────────────────────
function init() {
  bindSlotPick(1)
  bindSlotPick(2)

  el('btn-rr-upload')?.addEventListener('click', () => {
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
    uploadRRFiles()
  })

  el('btn-rr-swap')?.addEventListener('click', swapAssignments)

  el('btn-rr-master')?.addEventListener('click', startMasterChef)

  el('btn-rr-back-home')?.addEventListener('click', () => {
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
    if (rrState.eventSource) { rrState.eventSource.close(); rrState.eventSource = null }
    if (rrState.animTimer)   { clearInterval(rrState.animTimer); rrState.animTimer = null }
    if (typeof goTo === 'function') goTo('home')
  })

  el('btn-rr-cook-again')?.addEventListener('click', () => {
    if (typeof sfxBtnClick === 'function') sfxBtnClick()
    resetRR()
  })

  initSecretRecipe()
  initXLOrder()
  initTurtleGame()

  // Draw hero chef on upload screen when screen-rr becomes active
  // We watch for the screen-rr becoming active
  const rrScreen = document.getElementById('screen-rr')
  if (rrScreen) {
    const observer = new MutationObserver(() => {
      if (rrScreen.classList.contains('active')) {
        // Short delay so layout is settled
        setTimeout(() => {
          startChefAnimation('rr-hero-chef-canvas')
          drawRRChef(el('rr-chef-canvas'), 0)
        }, 100)
      }
    })
    observer.observe(rrScreen, { attributes: true, attributeFilter: ['class'] })
  }

  // Initial draw
  setTimeout(() => {
    drawRRChef(el('rr-hero-chef-canvas'), 0)
    drawRRChef(el('rr-chef-canvas'), 0)
  }, 200)
}

// ── Turtle Mini-Game ─────────────────────────────────────────
function initTurtleGame() {
  const overlay = el('turtle-game-overlay')
  const canvas  = el('tg-canvas')
  if (!overlay || !canvas) return

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const W = 640, H = 320
  canvas.width  = W
  canvas.height = H

  const livesEl    = el('tg-lives')
  const levelEl    = el('tg-level')
  const scoreEl    = el('tg-score')
  const fillEl     = el('tg-progress-fill')
  const msgEl      = el('tg-msg')

  // ── state ──
  let gState = 'idle'  // playing | levelwin | gameover | idle
  let level = 1, lives = 3, score = 0, progress = 0
  let invincFrames = 0, stateTimer = 0, bgScroll = 0
  let raf = null

  // ── player ──
  let px = 80, py = H / 2, pvy = 0, pFrame = 0, pFrameTimer = 0

  // ── obstacles ──
  let obs = [], spawnTimer = 0

  // ── keys ──
  const keys = {}
  function onKeyDown(e) {
    keys[e.key] = true
    if (e.key === 'Escape') closeGame()
    e.stopPropagation()
  }
  function onKeyUp(e) { keys[e.key] = false; e.stopPropagation() }

  // ── level config ──
  function cfg() {
    const lv = Math.min(level, 8)
    return {
      spawnInterval: Math.max(55 - lv * 5, 18),
      fishSpeed:     2 + lv * 0.6,
      progressRate:  0.0012 + lv * 0.00015,
    }
  }

  function resetLevel() {
    obs = []; progress = 0; spawnTimer = 0
    invincFrames = 0; stateTimer = 0
    px = 80; py = H / 2; pvy = 0
    gState = 'playing'
  }

  // ── drawing ──
  function drawBg() {
    // Water bands
    const bands = [[0,60,'#001833'],[60,130,'#002244'],[130,190,'#002a55'],[190,250,'#002244'],[250,320,'#001833']]
    for (const [y1,y2,c] of bands) { ctx.fillStyle=c; ctx.fillRect(0,y1,W,y2-y1) }
    // Caustic shimmer lines
    ctx.globalAlpha = 0.12
    ctx.strokeStyle = '#55aaff'
    ctx.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      const baseY = (i * 55 + bgScroll * 0.4) % H
      ctx.beginPath()
      for (let x = 0; x <= W; x += 4) {
        const y = baseY + Math.sin((x + bgScroll) * 0.035) * 5
        x === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    // Seaweed at bottom
    ctx.fillStyle = '#1a6633'
    for (let i = 0; i < 10; i++) {
      const sx = ((i * 68 + bgScroll * 0.7) % (W + 40)) - 20
      ctx.fillRect(sx, H-22, 4, 22)
      ctx.fillRect(sx+8, H-14, 4, 14)
    }
  }

  // Simplified 8-bit turtle (faces right, centered at x,y)
  function drawTurtleAt(x, y, frame, alpha) {
    ctx.globalAlpha = alpha
    const S = 2.5
    const bob = frame === 1 ? 1 : 0
    function r(tx, ty, tw, th, col) {
      ctx.fillStyle = col
      ctx.fillRect(Math.round(x + tx*S), Math.round(y + ty*S + bob), Math.round(tw*S), Math.round(th*S))
    }
    const SHAD='#3d1800',DARK='#6b3010',MID='#9e5020',WARM='#c87030',LITE='#e09040',GOLD='#f0b848'
    const TD='#1a4a38',T='#38886a',TL='#60c090',EYE='#0a0808',OR='#d07010',OUT='#1a0800'
    const rows=[[3,10,GOLD],[2,12,GOLD],[1,14,LITE],[0,16,MID],[0,16,WARM],[0,16,WARM],[0,16,MID],[0,16,MID],[0,16,DARK],[1,14,DARK],[2,12,SHAD],[3,10,SHAD]]
    for (let i=0; i<rows.length; i++) { const [sx,sw,c]=rows[i]; r(sx-8,i-6,sw,1,c) }
    // outline
    r(3-8,-1-6,10,1,OUT); r(3-8,12-6,10,1,OUT)
    // head
    r(8,-3,4,1,TD); r(8,-4,5,3,T); r(12,-2,1,3,OUT); r(11,-4,1,1,OR); r(11,-3,1,1,EYE)
    r(18-8,2-6,1,1,TL)
    // tail
    r(-9,-1,1,2,TD)
    // legs
    if (frame===0) {
      r(-5,7,2,1,T); r(-6,8,2,1,TD)
      r( 3,7,2,1,T); r( 4,8,2,1,TD)
    } else {
      r(-6,6,2,1,TD); r(-5,8,2,1,T)
      r( 2,6,2,1,TD); r( 4,8,2,1,T)
    }
    ctx.globalAlpha = 1
  }

  // Angry fish (faces left, centered at x,y)
  function drawFish(x, y, sz) {
    const S = sz
    function r(tx,ty,tw,th,c) { ctx.fillStyle=c; ctx.fillRect(Math.round(x+tx*S),Math.round(y+ty*S),Math.round(tw*S),Math.round(th*S)) }
    r(-3,-1,6,3,'#cc2200'); r(-4,0,1,1,'#cc2200')
    r(3,-2,2,1,'#ff4400'); r(3,2,2,1,'#ff4400'); r(3,-1,1,3,'#dd3300')
    r(-1,-3,3,1,'#aa1100'); r(0,-2,2,1,'#cc2200')
    r(-3,-1,1,1,'#fff'); r(-3,0,1,1,'#000')
    r(-5,0,1,1,'#ff6644'); r(-5,1,1,1,'#661100')
    r(-1,-1,1,1,'#aa1100'); r(1,0,1,1,'#aa1100')
  }

  // Bubble
  function drawBubble(x, y, r) {
    ctx.strokeStyle = 'rgba(120,190,255,0.4)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke()
  }

  function spawnObs() {
    const c = cfg()
    const y = 30 + Math.random() * (H - 60)
    obs.push({ x: W+20, y, speed: c.fishSpeed*(0.8+Math.random()*0.4), vy: (Math.random()-0.5)*0.4 })
  }

  function updateHUD() {
    if (livesEl) livesEl.textContent = '♥'.repeat(lives) + '♡'.repeat(Math.max(0, 3-lives))
    if (levelEl) levelEl.textContent  = `LEVEL ${level}`
    if (scoreEl) scoreEl.textContent  = score
    if (fillEl)  fillEl.style.width   = (progress * 100) + '%'
  }

  function showMsg(text, color, ms=2000) {
    if (!msgEl) return
    msgEl.textContent = text; msgEl.style.color = color; msgEl.classList.remove('hidden')
    setTimeout(() => msgEl?.classList.add('hidden'), ms)
  }

  function gameLoop() {
    bgScroll += 1.5

    if (gState === 'playing') {
      const c = cfg()
      // Input
      const up   = keys['ArrowUp']   || keys['w'] || keys['W']
      const down = keys['ArrowDown'] || keys['s'] || keys['S']
      if (up)   pvy -= 0.45
      if (down) pvy += 0.45
      pvy *= 0.84
      py  += pvy
      py   = Math.max(28, Math.min(H-36, py))

      // Turtle frame
      if (++pFrameTimer >= 8) { pFrame = 1-pFrame; pFrameTimer = 0 }

      // Progress + score
      progress = Math.min(1, progress + c.progressRate)
      score += 1

      // Spawn fish
      if (++spawnTimer >= c.spawnInterval) { spawnObs(); spawnTimer = 0 }

      // Move fish
      obs = obs.filter(o => o.x > -40)
      for (const o of obs) { o.x -= o.speed; o.y += o.vy; o.y = Math.max(24,Math.min(H-34,o.y)) }

      // Collision
      if (invincFrames > 0) {
        invincFrames--
      } else {
        for (const o of obs) {
          const dx = px - o.x, dy = py - o.y
          if (Math.sqrt(dx*dx + dy*dy) < 18) {
            lives--
            invincFrames = 90
            if (typeof sfxBuzz === 'function') sfxBuzz()
            if (lives <= 0) { gState = 'gameover'; stateTimer = 200; showMsg('GAME OVER', '#ff4455', 9999) }
            break
          }
        }
      }

      // Level complete
      if (progress >= 1) {
        score += level * 250
        gState = 'levelwin'; stateTimer = 100
        showMsg(`LEVEL ${level} CLEAR!`, '#44ff88')
        if (typeof sfxKitchenDing === 'function') sfxKitchenDing()
      }

    } else if (gState === 'levelwin') {
      if (--stateTimer <= 0) { level++; resetLevel() }
    } else if (gState === 'gameover') {
      stateTimer--
      if (stateTimer <= 0) closeGame()
    }

    // ── Render ──
    ctx.clearRect(0, 0, W, H)
    drawBg()

    // Obstacles
    for (const o of obs) drawFish(o.x, o.y, 3)

    // Bubbles
    for (let i=0; i<6; i++) {
      drawBubble((bgScroll*0.3 + i*113) % W, (bgScroll*0.6 + i*89) % H, 2+(i%3))
    }

    // Player (flicker when invincible)
    const alpha = invincFrames > 0 ? (Math.floor(invincFrames/5)%2===0 ? 0.3 : 1.0) : 1.0
    drawTurtleAt(px, py, pFrame, alpha)

    updateHUD()

    if (gState !== 'idle') raf = requestAnimationFrame(gameLoop)
  }

  function openGame() {
    level=1; lives=3; score=0
    resetLevel()
    overlay.classList.remove('hidden')
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup',   onKeyUp,   true)
    raf = requestAnimationFrame(gameLoop)
  }

  function closeGame() {
    overlay.classList.add('hidden')
    gState = 'idle'
    if (raf) { cancelAnimationFrame(raf); raf = null }
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('keyup',   onKeyUp,   true)
    if (msgEl) msgEl.classList.add('hidden')
  }

  // Bind to RR patience turtle
  document.querySelectorAll('.rr-patience .patience-turtle').forEach(c => {
    c.title = 'Click to play turtle game!'
    c.addEventListener('click', openGame)
  })

  el('tg-close-btn')?.addEventListener('click', closeGame)

  // Touch controls
  const btnUp = el('tg-btn-up')
  const btnDn = el('tg-btn-dn')
  if (btnUp) {
    btnUp.addEventListener('pointerdown', () => { keys['ArrowUp'] = true })
    btnUp.addEventListener('pointerup',   () => { keys['ArrowUp'] = false })
  }
  if (btnDn) {
    btnDn.addEventListener('pointerdown', () => { keys['ArrowDown'] = true })
    btnDn.addEventListener('pointerup',   () => { keys['ArrowDown'] = false })
  }
}

// Run init after DOM is fully parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

})() // end IIFE RRChef
