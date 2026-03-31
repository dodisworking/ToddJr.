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
  const enabledChecks = getEnabledCheckIds()
  const checksParam = enabledChecks ? `&checks=${encodeURIComponent(JSON.stringify(enabledChecks))}` : ''
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
      if (d.stage === 'parsing-client') setCookStage('dough')
      else if (d.stage === 'parsing-argus') setCookStage('sauce')
      else if (d.stage === 'analyzing') setCookStage('oven')
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
  const stages = ['dough', 'sauce', 'oven', 'done']
  stages.forEach(s => {
    const el2 = el(`rr-stage-${s}`)
    if (!el2) return
    el2.classList.toggle('hidden', s !== stage)
  })
  rrState.cookStage = stage

  if (stage === 'dough' && typeof sfxDoughRoll === 'function') sfxDoughRoll()
  if (stage === 'oven'  && typeof sfxOvenDoor  === 'function') sfxOvenDoor()
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

  // Reset cooking stage
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

let secretState = {
  mode: false,
  ingredients: null,  // loaded from localStorage or defaults
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

function getEnabledCheckIds() {
  if (!secretState.mode) return null  // null = use all defaults
  return (secretState.ingredients || []).filter(i => i.on).map(i => i.id)
}

function renderIngredients() {
  const list = el('rr-ingredients-list')
  if (!list) return
  list.innerHTML = (secretState.ingredients || []).map(ing => `
    <div class="rr-ingredient${ing.on ? ' ing-on' : ' ing-off'}" data-id="${escapeHtml(ing.id)}">
      <span class="ing-emoji">${ing.emoji || '🍕'}</span>
      <span class="ing-label">${escapeHtml(ing.label)}</span>
      <label class="rr-toggle rr-ing-toggle">
        <input type="checkbox" class="ing-checkbox" data-id="${escapeHtml(ing.id)}" ${ing.on ? 'checked' : ''} />
        <span class="rr-toggle-track"></span>
      </label>
      ${ing.custom ? `<button class="ing-delete" data-id="${escapeHtml(ing.id)}" title="Remove">✕</button>` : ''}
    </div>
  `).join('')

  // Bind toggles
  list.querySelectorAll('.ing-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id
      const ing = secretState.ingredients.find(i => i.id === id)
      if (ing) { ing.on = cb.checked; saveSecretRecipe(); renderIngredients() }
    })
  })
  // Bind deletes (custom only)
  list.querySelectorAll('.ing-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      secretState.ingredients = secretState.ingredients.filter(i => i.id !== id)
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

  addBtn?.addEventListener('click', () => {
    const label = (addInput?.value || '').trim().toUpperCase()
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
