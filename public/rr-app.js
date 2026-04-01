// ═══════════════════════════════════════════════════════════
// RENT ROLL CHEF — Frontend (Game 02)
// Self-contained; does not depend on app.js internals.
// ═══════════════════════════════════════════════════════════

;(function RRChef() {
'use strict'

// ── Helpers ──────────────────────────────────────────────
const el = id => document.getElementById(id)

function rrApiBase() {
  const meta = document.querySelector('meta[name="todd-api-base"]')
  return (meta?.content || '').replace(/\/$/, '')
}

function rrApi(path) {
  return rrApiBase() + path
}

function rrArrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function rrToast(msg, type) {
  if (typeof toast === 'function') { toast(msg, type); return }
  // Fallback
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#f9fafb;padding:10px 20px;border-radius:6px;font-family:monospace;font-size:13px;z-index:9999'
  d.textContent = msg
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 3500)
}

async function readSSEStream(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop()
    for (const part of parts) {
      if (!part.trim()) continue
      const lines = part.split('\n')
      const eventLine = lines.find(l => l.startsWith('event:'))
      const dataLine  = lines.find(l => l.startsWith('data:'))
      if (eventLine && dataLine) {
        const evt = eventLine.slice(6).trim()
        try { onEvent(evt, JSON.parse(dataLine.slice(5).trim())) } catch {}
      }
    }
  }
}

// ── State ────────────────────────────────────────────────
const rr = {
  files: [null, null],
  comparison: null,
  excelBase64: null,
}

// ── Sub-screen navigation ────────────────────────────────
function rrGoTo(subName) {
  document.querySelectorAll('#screen-rr .rr-sub').forEach(s => s.classList.remove('active'))
  const target = el(`rr-sub-${subName}`)
  if (target) target.classList.add('active')

  const topbar = el('rr-topbar')
  if (topbar) topbar.style.display = subName === 'upload' ? 'none' : 'flex'
}

// ── File slot logic ──────────────────────────────────────
function setSlot(num, file) {
  rr.files[num - 1] = file
  const slot     = el(`rr-slot-${num}`)
  const nameEl   = el(`rr-slot-${num}-name`)
  const sizeEl   = el(`rr-slot-${num}-size`)
  if (file) {
    slot?.classList.add('has-file')
    if (nameEl) nameEl.textContent = file.name
    if (sizeEl) sizeEl.textContent = fmtBytes(file.size)
  } else {
    slot?.classList.remove('has-file')
  }
  updateUploadBtn()
}

function clearSlot(num) {
  rr.files[num - 1] = null
  const input = el(`rr-input-${num}`)
  if (input) input.value = ''
  setSlot(num, null)
}

function updateUploadBtn() {
  const btn = el('btn-rr-upload')
  if (btn) btn.disabled = !(rr.files[0] && rr.files[1])
}

// ── Drag & drop ──────────────────────────────────────────
function bindSlotDragDrop(num) {
  const slot = el(`rr-slot-${num}`)
  if (!slot) return
  slot.addEventListener('dragover',  e => { e.preventDefault(); slot.classList.add('drag-over') })
  slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'))
  slot.addEventListener('drop', e => {
    e.preventDefault()
    slot.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (file) setSlot(num, file)
  })
}

// ── Cooking stage display ────────────────────────────────
const STAGE_ORDER = ['dough', 'sauce', 'toppings', 'pan', 'oven', 'done']

function setCookStage(stage) {
  STAGE_ORDER.forEach(s => {
    const stageEl = el(`rr-stage-${s}`)
    if (stageEl) stageEl.classList.toggle('active', s === stage)
  })
}

function updateProgress(percent, message) {
  const fill = el('rr-cook-fill')
  const msg  = el('rr-cook-msg')
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`
  if (msg)  msg.textContent = message || ''
}

// ── Upload + analyze ─────────────────────────────────────
async function startCooking() {
  if (!rr.files[0] || !rr.files[1]) return

  const btn = el('btn-rr-upload')
  if (btn) btn.disabled = true

  rrGoTo('cooking')
  setCookStage('dough')
  updateProgress(5, 'Reading files...')

  try {
    // Read both files as ArrayBuffer → base64
    const [buf1, buf2] = await Promise.all([
      rr.files[0].arrayBuffer(),
      rr.files[1].arrayBuffer(),
    ])

    const argusFile  = { name: rr.files[0].name, base64: rrArrayBufferToBase64(buf1) }
    const clientFile = { name: rr.files[1].name, base64: rrArrayBufferToBase64(buf2) }

    updateProgress(15, 'Uploading to server...')

    const response = await fetch(rrApi('/api/rr/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ argusFile, clientFile })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(err.error || 'Server error')
    }

    // Read SSE stream
    let resolved = false
    await readSSEStream(response, (evt, data) => {
      if (evt === 'rr-progress') {
        updateProgress(data.percent || 0, data.message || '')
        if (data.stage) setCookStage(data.stage)
      } else if (evt === 'rr-complete') {
        resolved = true
        rr.comparison  = data.comparison
        rr.excelBase64 = data.excelBase64

        setCookStage('done')
        updateProgress(100, 'Done!')

        const flash = el('rr-ding-flash')
        if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 600) }

        setTimeout(() => {
          renderResults()
          rrGoTo('report')
        }, 1200)
      } else if (evt === 'rr-error') {
        throw new Error(data.error || 'Analysis failed')
      }
    })

    if (!resolved) {
      throw new Error('Stream ended without a result.')
    }
  } catch (err) {
    rrToast(`Error: ${err.message}`, 'error')
    updateProgress(0, 'Failed. Please try again.')
    if (btn) btn.disabled = false
    rrGoTo('upload')
  }
}

// ── Results ──────────────────────────────────────────────
function renderResults() {
  const comp = rr.comparison
  if (!comp) return

  // Property name
  const propEl = el('rr-report-property')
  if (propEl) propEl.textContent = comp.property || 'Unknown Property'

  // Stats grid
  const grid = el('rr-stats-grid')
  if (grid) {
    const s = comp.summary || {}
    const stats = [
      { label: 'Total Tenants',    value: s.totalTenants ?? 0 },
      { label: 'Clean Match',      value: s.cleanMatch ?? 0,       good: true },
      { label: 'Has Differences',  value: s.withDifferences ?? 0,  bad: (s.withDifferences ?? 0) > 0 },
      { label: 'Argus Only',       value: s.argusOnly ?? 0,         bad: (s.argusOnly ?? 0) > 0 },
      { label: 'Client Only',      value: s.clientOnly ?? 0,        bad: (s.clientOnly ?? 0) > 0 },
    ]
    grid.innerHTML = stats.map(st => {
      const cls = st.bad ? 'bad' : st.good ? 'good' : ''
      return `<div class="rr-stat-card"><span class="rr-stat-value ${cls}">${st.value}</span><span class="rr-stat-label">${st.label}</span></div>`
    }).join('')
  }

  // Preview table
  const list = el('rr-preview-list')
  if (!list || !comp.tenantGroups) return

  const groups = comp.tenantGroups
  if (!groups.length) {
    list.innerHTML = '<p style="text-align:center;color:#6b7280;padding:20px">No tenant data found.</p>'
    return
  }

  const headerCols = ['Suite', 'Tenant (Argus)', 'Tenant (Client)', 'SF', 'Dates', 'Rent', 'Status']
  const rows = groups.map(g => {
    const argus  = g.argus  || {}
    const client = g.client || {}
    const hasDiff = !g.allMatch || g.argusOnly || g.clientOnly
    const rowStyle = hasDiff ? 'border-left:3px solid #ef4444' : 'border-left:3px solid #10b981'

    const fmt = v => (v === null || v === undefined) ? '—' : String(v)
    const fmtMoney = v => (v === null || v === undefined) ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

    // Build diffs summary for differences rows
    const diffsHtml = hasDiff && g.differences?.length
      ? `<div style="font-size:10px;color:#dc2626;margin-top:4px">${g.differences.map(d => `${d.label}: <b>${d.argusValue}</b> vs <b>${d.clientValue}</b>`).join(' | ')}</div>`
      : ''

    // Status badge
    let statusClass = 'rr-status-match'
    let statusText = 'MATCH'
    if (g.argusOnly)  { statusClass = 'rr-status-only'; statusText = 'ARGUS ONLY' }
    else if (g.clientOnly) { statusClass = 'rr-status-only'; statusText = 'CLIENT ONLY' }
    else if (!g.allMatch) { statusClass = 'rr-status-diff'; statusText = 'DIFF' }

    // SF: show with mismatch highlight
    const sfMatch = !(g.differences || []).some(d => d.field === 'sqft')
    const sfCell = sfMatch
      ? `${fmt(argus.sqft)}`
      : `<span style="color:#dc2626">${fmt(argus.sqft)} vs ${fmt(client.sqft)}</span>`

    // Dates
    const startMatch = !(g.differences || []).some(d => d.field === 'lease_start')
    const endMatch   = !(g.differences || []).some(d => d.field === 'lease_end')
    const datesCell = `${startMatch ? '' : '<span style="color:#dc2626">'}${fmt(argus.leaseStart)}–${fmt(argus.leaseEnd)}${startMatch && endMatch ? '' : '</span>'}`

    // Rent
    const rentMatch = !(g.differences || []).some(d => d.field === 'monthly_rent')
    const rentCell = rentMatch
      ? fmtMoney(argus.monthlyRent)
      : `<span style="color:#dc2626">${fmtMoney(argus.monthlyRent)} vs ${fmtMoney(client.monthlyRent)}</span>`

    return `<tr style="${rowStyle}">
      <td>${fmt(g.suite)}</td>
      <td>${fmt(argus.tenantName)}</td>
      <td>${fmt(client.tenantName)}${diffsHtml}</td>
      <td>${sfCell}</td>
      <td style="font-size:11px">${datesCell}</td>
      <td>${rentCell}</td>
      <td><span class="rr-status-badge ${statusClass}">${statusText}</span></td>
    </tr>`
  }).join('')

  list.innerHTML = `
    <table class="rr-preview-table">
      <thead><tr>${headerCols.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

// ── Download ─────────────────────────────────────────────
function downloadExcel() {
  if (!rr.excelBase64) { rrToast('No report available.', 'error'); return }
  try {
    const binary = atob(rr.excelBase64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const prop = rr.comparison?.property || 'RentRoll'
    a.href = url
    a.download = `RentRoll_Comparison_${prop.replace(/[^a-z0-9]/gi, '_')}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    rrToast(`Download failed: ${e.message}`, 'error')
  }
}

// ── Reset ────────────────────────────────────────────────
function resetRR() {
  rr.files = [null, null]
  rr.comparison  = null
  rr.excelBase64 = null

  clearSlot(1)
  clearSlot(2)

  const btn = el('btn-rr-upload')
  if (btn) { btn.disabled = true; btn.textContent = '🫓 ROLL THE DOUGH' }

  rrGoTo('upload')
}

// ═══════════════════════════════════════════════════════════
// INIT — called by app.js via window.__rrInit, or on DOMContentLoaded
// ═══════════════════════════════════════════════════════════
function init() {
  // File pick buttons
  for (const num of [1, 2]) {
    el(`btn-rr-pick-${num}`)?.addEventListener('click', e => {
      e.stopPropagation()
      el(`rr-input-${num}`)?.click()
    })
    el(`rr-input-${num}`)?.addEventListener('change', function() {
      if (this.files?.[0]) setSlot(num, this.files[0])
    })
    el(`btn-rr-remove-${num}`)?.addEventListener('click', e => {
      e.stopPropagation()
      clearSlot(num)
    })
    bindSlotDragDrop(num)
  }

  // Roll the dough
  el('btn-rr-upload')?.addEventListener('click', () => startCooking())

  // Download
  el('btn-rr-download')?.addEventListener('click', () => downloadExcel())

  // New comparison
  el('btn-rr-new')?.addEventListener('click', () => resetRR())

  // Back button
  el('btn-rr-back')?.addEventListener('click', () => {
    if (typeof goTo === 'function') goTo('home')
    else {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
      document.getElementById('screen-home')?.classList.add('active')
    }
  })

  // Game card on home screen
  el('game-card-rr')?.addEventListener('click', () => {
    if (typeof goTo === 'function') goTo('rr')
    else {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
      document.getElementById('screen-rr')?.classList.add('active')
      rrGoTo('upload')
    }
  })
}

// Expose for app.js to call when navigating to screen-rr
window.__rrInit = function() {
  rrGoTo('upload')
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

})()
