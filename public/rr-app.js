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
    try {
      const data = JSON.parse(e.data)
      rrState.reportData = data
      setCookStage('done')
      updateCookProgress(100, 'Pizza is ready!')
      if (typeof sfxKitchenDing === 'function') sfxKitchenDing()
      // Bounce the DING element
      const ding = el('rr-pizza-ding')
      if (ding) {
        ding.classList.remove('hidden')
        ding.classList.add('ding-pop')
      }
      // After a short pause, go to report
      setTimeout(() => {
        if (rrState.animTimer) clearInterval(rrState.animTimer)
        renderReport(data)
        rrGoTo('report')
      }, 2200)
    } catch {}
    es.close()
    rrState.eventSource = null
  })

  es.addEventListener('rr-error', e => {
    try {
      const d = JSON.parse(e.data)
      if (typeof toast === 'function') toast(`Analysis failed: ${d.error}`, 'error')
      else alert(`Analysis failed: ${d.error}`)
    } catch {}
    es.close()
    rrState.eventSource = null
    rrGoTo('confirm')
  })

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return
    if (typeof toast === 'function') toast('Connection lost. Please try again.', 'error')
    es.close()
    rrState.eventSource = null
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
      { label: 'DISCREPANCIES',     value: s.discrepancies   ?? '—', color: '#FBBF24' },
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

  // Preview table — first 5 groups with discrepancies/issues
  const previewTable = el('rr-preview-table')
  if (previewTable) {
    const groups = (data.tenantGroups || [])
      .filter(g => g.overallStatus !== 'MATCH')
      .slice(0, 5)

    if (groups.length === 0) {
      previewTable.innerHTML = '<div class="rr-preview-empty">✅ No discrepancies found!</div>'
    } else {
      previewTable.innerHTML = groups.map(g => {
        const statusColor = g.overallStatus === 'DISCREPANCY' ? '#FBBF24'
          : g.overallStatus === 'MISSING_CLIENT' ? '#E879F9'
          : g.overallStatus === 'MISSING_ARGUS'  ? '#FCA5A5'
          : '#6EE7B7'
        const sevColor = g.severity === 'HIGH' ? '#F87171'
          : g.severity === 'MEDIUM' ? '#FBBF24'
          : '#94A3B8'
        return `
          <div class="rr-preview-row">
            <span class="rr-prev-suite">${escapeHtml(g.suites || '—')}</span>
            <span class="rr-prev-status" style="color:${statusColor}">${g.overallStatus}</span>
            <span class="rr-prev-sev" style="color:${sevColor}">${g.severity}</span>
            <span class="rr-prev-name">${escapeHtml(g.clientTenantName || g.argusTenantName || '—')}</span>
            <span class="rr-prev-assessment">${escapeHtml(g.toddAssessment || '')}</span>
          </div>`
      }).join('')
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
          <span class="rr-xl-tag rr-xl-tag-argus">📐 ${escapeHtml(c.argusFile.name)}${c.argusCount > 1 ? ` (+${c.argusCount - 1})` : ''}</span>
          <span class="rr-xl-tag rr-xl-tag-client">📄 ${escapeHtml(c.clientFile.name)}${c.clientCount > 1 ? ` (+${c.clientCount - 1})` : ''}</span>
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

// Run init after DOM is fully parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

})() // end IIFE RRChef
