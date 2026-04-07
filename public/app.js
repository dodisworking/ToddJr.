// ═══════════════════════════════════════════════════════════
// 8-BIT SOUND ENGINE — Web Audio API, no files needed
// ═══════════════════════════════════════════════════════════

// AudioContext created lazily on first user gesture — Chrome blocks
// AudioContexts created at page load (autoplay policy).
let _sfxCtx = null

function _ensureCtx() {
  if (!_sfxCtx) {
    try { _sfxCtx = new (window.AudioContext || window.webkitAudioContext)() }
    catch (e) { console.warn('[sfx] AudioContext unavailable:', e) }
  }
  return _sfxCtx
}

// ── Mute state (persisted in localStorage) ──────────────────
let _sfxMuted = localStorage.getItem('toddSfxMuted') === '1'

function _sfxNote(freq, startT, durSec, type = 'square', vol = 0.18) {
  if (!_sfxCtx || _sfxMuted) return
  const g = _sfxCtx.createGain()
  g.gain.setValueAtTime(vol, startT)
  g.gain.exponentialRampToValueAtTime(0.001, startT + durSec)
  const o = _sfxCtx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, startT)
  o.connect(g)
  g.connect(_sfxCtx.destination)
  o.start(startT)
  o.stop(startT + durSec + 0.05)
}

// _sfxResume: creates context on first call (must be within user gesture),
// then awaits resume if suspended. Always call this before scheduling notes.
async function _sfxResume() {
  _ensureCtx()
  if (_sfxCtx && _sfxCtx.state === 'suspended') await _sfxCtx.resume()
}

/** 🔊 Toggle mute — called by speaker button */
function sfxToggleMute() {
  _sfxMuted = !_sfxMuted
  localStorage.setItem('toddSfxMuted', _sfxMuted ? '1' : '0')
  if (_sfxMuted) sfxStopBgLoop()
  updateSpeakerIcon()
}

function updateSpeakerIcon() {
  const btn = document.getElementById('btn-sfx-toggle')
  if (!btn) return
  btn.classList.toggle('muted', _sfxMuted)
  btn.title = _sfxMuted ? 'Sound OFF — click to unmute' : 'Sound ON — click to mute'
}

/** 🎵 Button click — quick square blip */
async function sfxBtnClick() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(440, t, 0.04, 'square', 0.09)
}

/** 🎵 Hunt complete — ascending 4-note 8-bit fanfare */
async function sfxHuntComplete() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(523,  t + 0.00, 0.12)   // C5
  _sfxNote(659,  t + 0.13, 0.12)   // E5
  _sfxNote(784,  t + 0.26, 0.12)   // G5
  _sfxNote(1047, t + 0.39, 0.25)   // C6
}

/** 🎵 All clear — clean 3-note chime */
async function sfxAllClear() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(784,  t + 0.00, 0.15, 'sine', 0.14)  // G5
  _sfxNote(988,  t + 0.16, 0.15, 'sine', 0.14)  // B5
  _sfxNote(1175, t + 0.32, 0.28, 'sine', 0.14)  // D6
}

/** 🎵 Test/verdict ready — 2-tone notification ping */
async function sfxReady() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(880,  t + 0.00, 0.10, 'square', 0.12) // A5
  _sfxNote(1175, t + 0.12, 0.18, 'square', 0.12) // D6
}

/** 🎵 Error — low descending buzz */
async function sfxError() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(220, t + 0.00, 0.12, 'sawtooth', 0.15)
  _sfxNote(165, t + 0.13, 0.20, 'sawtooth', 0.13)
}

/** 🎵 Juice saved — quick bloop */
async function sfxJuice() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(440, t + 0.00, 0.07, 'square', 0.1)
  _sfxNote(659, t + 0.08, 0.12, 'square', 0.1)
}

// ── Kitchen SFX (Rent Roll Chef) ─────────────────────────────

/** 🔔 Kitchen ding — warm bell when pizza is ready */
async function sfxKitchenDing() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  // Double ding — G6, E6, C6 sine tones
  _sfxNote(1568, t + 0.00, 0.35, 'sine', 0.20)
  _sfxNote(1319, t + 0.10, 0.30, 'sine', 0.18)
  _sfxNote(1047, t + 0.20, 0.50, 'sine', 0.22)
  // Second ding (echo)
  _sfxNote(1568, t + 0.60, 0.30, 'sine', 0.14)
  _sfxNote(1319, t + 0.70, 0.25, 'sine', 0.12)
  _sfxNote(1047, t + 0.80, 0.45, 'sine', 0.16)
}

/** 🫓 Dough roll — low rumble */
async function sfxDoughRoll() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(80, t + 0.00, 0.20, 'sawtooth', 0.10)
  _sfxNote(90, t + 0.15, 0.15, 'sawtooth', 0.08)
  _sfxNote(75, t + 0.30, 0.25, 'sawtooth', 0.10)
  _sfxNote(95, t + 0.50, 0.15, 'sawtooth', 0.07)
}

/** 🍅 Sauce spread — wet swoosh */
async function sfxSauceSpread() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(200, t + 0.00, 0.15, 'sine', 0.06)
  _sfxNote(350, t + 0.05, 0.20, 'sine', 0.08)
  _sfxNote(500, t + 0.10, 0.25, 'sine', 0.06)
  _sfxNote(300, t + 0.25, 0.15, 'sine', 0.04)
}

/** 🧅 Toppings — light pitter-patter */
async function sfxToppings() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  const notes = [880, 1047, 988, 1175, 1319]
  notes.forEach((f, i) => _sfxNote(f, t + i * 0.08, 0.06, 'triangle', 0.09))
}

/** 🍳 Pan sizzle — rapid high buzz */
async function sfxPanSizzle() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  for (let i = 0; i < 6; i++) {
    _sfxNote(2200 + Math.random() * 800, t + i * 0.04, 0.05, 'sawtooth', 0.04)
  }
}

/** 🔥 Oven door — deep creak */
async function sfxOvenDoor() {
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  const t = _sfxCtx.currentTime
  _sfxNote(120, t + 0.00, 0.30, 'sawtooth', 0.12)
  _sfxNote(85, t + 0.15, 0.40, 'sawtooth', 0.10)
  _sfxNote(60, t + 0.35, 0.35, 'sawtooth', 0.08)
}

// ── Background loop engine ───────────────────────────────────
let _bgLoopTimer = null
let _bgLoopActive = false

function sfxStopBgLoop() {
  _bgLoopActive = false
  if (_bgLoopTimer !== null) { clearTimeout(_bgLoopTimer); _bgLoopTimer = null }
}

/**
 * 🎵 Hunt loop — suspenseful Am pentatonic 8-bit melody (~130 BPM)
 */
async function sfxStartHuntLoop() {
  sfxStopBgLoop()
  if (_sfxMuted) return
  await _sfxResume()
  if (!_sfxCtx) return
  _bgLoopActive = true

  const seq = [220, 261, 293, 329, 261, 392, 329, 261,
               440, 392, 329, 293, 261, 220, 293, 220]
  const stepMs = 462
  let step = 0

  function playStep() {
    if (!_bgLoopActive || _sfxMuted) return
    const t = _sfxCtx.currentTime
    _sfxNote(seq[step % seq.length], t, 0.18, 'square', 0.07)
    if (step % 4 === 0) _sfxNote(55, t, 0.12, 'sawtooth', 0.05)
    step++
    _bgLoopTimer = setTimeout(playStep, stepMs)
  }
  playStep()
}

/**
 * 🎵 Cook / bubbling loop — whimsical C major arpeggio (~110 BPM)
 */
async function sfxStartCookLoop() {
  sfxStopBgLoop()
  if (_sfxMuted || !_sfxCtx) return
  await _sfxResume()
  _bgLoopActive = true

  const seq = [261, 329, 392, 523, 392, 329, 261, 329,
               392, 440, 523, 440, 392, 329, 261, 196]
  const stepMs = 545
  let step = 0

  function playStep() {
    if (!_bgLoopActive || _sfxMuted) return
    const t = _sfxCtx.currentTime
    const freq = seq[step % seq.length]
    _sfxNote(freq, t, 0.22, 'sine', 0.06)
    if (step % 16 === 0 || step % 16 === 8) _sfxNote(freq * 2, t, 0.08, 'square', 0.04)
    step++
    _bgLoopTimer = setTimeout(playStep, stepMs)
  }
  playStep()
}

/**
 * 🎵 Kitchen loop — jazzy Italian kitchen vibe for RR Chef
 */
async function sfxStartKitchenLoop() {
  sfxStopBgLoop()
  if (_sfxMuted || !_sfxCtx) return
  await _sfxResume()
  _bgLoopActive = true

  // Jazzy minor pentatonic — kitchen hustle vibe
  const seq = [330, 392, 440, 523, 440, 392, 330, 294,
               330, 440, 392, 523, 587, 523, 440, 330]
  const stepMs = 480
  let step = 0

  function playStep() {
    if (!_bgLoopActive || _sfxMuted) return
    const t = _sfxCtx.currentTime
    const freq = seq[step % seq.length]
    _sfxNote(freq, t, 0.20, 'triangle', 0.06)
    if (step % 4 === 0) _sfxNote(110, t, 0.15, 'sine', 0.05)  // bass note
    if (step % 8 === 4) _sfxNote(freq * 1.5, t, 0.08, 'square', 0.03)  // harmonic accent
    step++
    _bgLoopTimer = setTimeout(playStep, stepMs)
  }
  playStep()
}

// ═══════════════════════════════════════════════════════════
// 8-BIT PIXEL CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════

/**
 * Replaces window.confirm() with a pixel-art dialog.
 * Returns a Promise<boolean> — true = YES, false = NO/dismissed.
 */
function pixelConfirm(message, title = 'WARNING') {
  return new Promise(resolve => {
    const overlay = document.getElementById('pixel-confirm-overlay')
    const msgEl   = document.getElementById('pixel-confirm-msg')
    const titleEl = document.getElementById('pixel-confirm-title')
    const yesBtn  = document.getElementById('pixel-confirm-yes')
    const noBtn   = document.getElementById('pixel-confirm-no')
    if (!overlay) { resolve(window.confirm(message)); return }

    titleEl.textContent = title
    msgEl.textContent   = message
    overlay.classList.remove('hidden')
    noBtn.focus()

    function cleanup(result) {
      overlay.classList.add('hidden')
      yesBtn.removeEventListener('click', onYes)
      noBtn.removeEventListener('click', onNo)
      overlay.removeEventListener('click', onBackdrop)
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }
    function onYes()          { cleanup(true) }
    function onNo()           { cleanup(false) }
    function onBackdrop(e)    { if (e.target === overlay) cleanup(false) }
    function onKey(e) {
      if (e.key === 'Enter')  { cleanup(true);  e.preventDefault() }
      if (e.key === 'Escape') { cleanup(false); e.preventDefault() }
    }
    yesBtn.addEventListener('click', onYes)
    noBtn.addEventListener('click', onNo)
    overlay.addEventListener('click', onBackdrop)
    document.addEventListener('keydown', onKey)
  })
}

function pixelPrompt(message, title = 'ENTER', placeholder = '') {
  return new Promise(resolve => {
    const overlay   = document.getElementById('pixel-prompt-overlay')
    const msgEl     = document.getElementById('pixel-prompt-msg')
    const titleEl   = document.getElementById('pixel-prompt-title')
    const input     = document.getElementById('pixel-prompt-input')
    const okBtn     = document.getElementById('pixel-prompt-ok')
    const cancelBtn = document.getElementById('pixel-prompt-cancel')
    if (!overlay) { resolve(window.prompt(message) || ''); return }

    titleEl.textContent     = title
    msgEl.textContent       = message
    input.value             = ''
    input.placeholder       = placeholder
    overlay.classList.remove('hidden')
    setTimeout(() => input.focus(), 80)

    function cleanup(val) {
      overlay.classList.add('hidden')
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      overlay.removeEventListener('click', onBackdrop)
      document.removeEventListener('keydown', onKey)
      resolve(val)
    }
    function onOk()           { cleanup(input.value.trim()) }
    function onCancel()       { cleanup(null) }
    function onBackdrop(e)    { if (e.target === overlay) cleanup(null) }
    function onKey(e) {
      if (e.key === 'Enter')  { cleanup(input.value.trim()); e.preventDefault() }
      if (e.key === 'Escape') { cleanup(null);               e.preventDefault() }
    }
    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
    overlay.addEventListener('click', onBackdrop)
    document.addEventListener('keydown', onKey)
  })
}

// ── Global button-click sound ────────────────────────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('button, .btn, [role="button"]')
  if (!btn) return
  // Skip the mute toggle itself (it has its own logic)
  if (btn.id === 'btn-sfx-toggle') return
  sfxBtnClick()
}, { capture: true })

// ═══════════════════════════════════════════════════════════
// TODD JR. — Frontend State Machine
// ═══════════════════════════════════════════════════════════

// ── Client mode: 'public' (lawyer/reviewer) or 'full' (owner) ─
// Starts as public every page load; unlock via secret red button + PIN.
let clientMode = 'public'

// ── State ────────────────────────────────────────────────────
const state = {
  screen:           'home',
  sessionId:        crypto.randomUUID(),
  tenants:          [],        // [{ id, folderName, property, suite, tenantName, fileCount }]
  findings:         new Map(), // tenantId -> { findingCount, allClear, severity }
  eventSource:      null,
  downloadUrl:      null,
  allResults:       [],        // final compiled results for preview table
  singleTenantMode: false,     // if true, auto-run test mode after upload
  sbsMode:          'juice',
  /** Screen we were on before opening side-by-side (for Back / errors). */
  sbsSourceScreen:  null,
  drlabMode:        null,
  // Local file extraction (client-side, never uploaded to Railway for analysis)
  localFiles:       new Map(), // relativePath -> { name, buffer: ArrayBuffer, size }
  localTenants:     [],        // tenant objects built locally (mirrors server tenant list)
}

/**
 * Normalize API root from a full URL: origin + optional path prefix (no trailing slash).
 * Strips a lone `/api` suffix — Todd serves `/api/*` from site root.
 */
function normalizeToddApiBase(input) {
  try {
    const s = String(input || '').trim()
    if (!s) return ''
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    let path = (u.pathname || '').replace(/\/$/, '') || ''
    if (path === '/api') path = ''
    return `${u.origin}${path}`
  } catch {
    return ''
  }
}

/**
 * API base for every Todd request (fetch, XHR, EventSource, downloads).
 * 1) <meta name="todd-api-base" content="https://your-api-host"> when the HTML is NOT served by Todd (e.g. Live Server + Railway API).
 * 2) Otherwise: same origin as this page (open the URL from `npm start` or your Railway app URL).
 * Always use sameOriginApi('/api/...') or toddApiUrl(...) — never raw fetch('/api/...') or EventSource('/api/...').
 */
function getApiOrigin() {
  if (typeof window === 'undefined') return ''
  const raw = document.querySelector('meta[name="todd-api-base"]')?.getAttribute('content')?.trim()
  if (raw) {
    const n = normalizeToddApiBase(raw)
    if (n) return n
  }
  if (window.location.protocol === 'file:') return ''
  return normalizeToddApiBase(window.location.origin) || window.location.origin
}

/**
 * Absolute URL for Todd API routes. Resolves relative to API base so a subpath base
 * (e.g. https://host/app) yields https://host/app/api/... instead of dropping the prefix.
 */
function sameOriginApi(path) {
  const raw = String(path || '')
  const slug = raw.startsWith('/') ? raw.slice(1) : raw
  if (typeof window === 'undefined') return `/${slug}`
  const base = getApiOrigin()
  if (!base) return `/${slug}`
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`
  try {
    return new URL(slug, baseWithSlash).href
  } catch {
    return `/${slug}`
  }
}

/**
 * Server often returns path-only URLs (e.g. /api/report.xlsx). Always resolve against API base
 * so downloads and links work when UI is on another host or <meta name="todd-api-base"> points at Railway.
 */
function toddApiUrl(pathOrAbsolute) {
  const s = String(pathOrAbsolute || '').trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  const path = s.startsWith('/') ? s : `/${s}`
  return sameOriginApi(path)
}

// ── DOM refs ─────────────────────────────────────────────────
const screens = {
  // ── Root ───────────────────────────────────────────────────
  home:        document.getElementById('screen-home'),       // game launcher

  // ── Game 01: Lease Index & Missing Docs Hunter ─────────────
  upload:      document.getElementById('screen-upload'),
  loading:     document.getElementById('screen-loading'),
  hunt:        document.getElementById('screen-hunt'),
  cooking:     document.getElementById('screen-cooking'),
  report:      document.getElementById('screen-report'),
  drtoddlab:   document.getElementById('screen-drtoddlab'),
  drtoddhunt:  document.getElementById('screen-drtoddhunt'),
  gym:         document.getElementById('screen-gym'),
  sidebyside:  document.getElementById('screen-sidebyside'),

  // ── Game 02: Rent Roll Chef (under construction) ───────────
  rr:          document.getElementById('screen-rr'),
}

// ═══════════════════════════════════════════════════════════
// PIXEL ART SPRITE ENGINE
// Colors
// ═══════════════════════════════════════════════════════════
const C = {
  _: null,
  H: '#4A2C0A', // hair
  S: '#F5C5A3', // skin
  E: '#111111', // eyes
  M: '#8B0000', // mouth/detail
  B: '#1D4ED8', // blue shirt
  A: '#1565C0', // shirt arm
  P: '#1E3A5F', // pants
  T: '#3B1A09', // boots
  W: '#FFFFFF', // sword blade (bright white)
  G: '#FCD34D', // sword handle/gold (bright yellow)
  R: '#DC2626', // red accent
  N: '#6B7280', // neutral/gray
}
const _ = null

// Each frame: 15 columns × 21 rows, pixel size = 4
const PS = 4 // pixel size

// Idle frame 1 (standing)
const IDLE1 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

// Idle frame 2 (slight bob — same but body row shifted 1 down)
const IDLE2 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

// Attack frame 1 — sword raised HIGH above head (windup)
// Right arm path: shoulder col10 row8 → neck col10 row7 → arm col9 row3 → guard row2
const ATK1 = [
  [_,_,_,_,_,_,_,_,_,_,_,C.W,C.W,_,_], // blade tip
  [_,_,_,_,_,_,_,_,_,_,C.W,C.W,_,_,_], // blade
  [_,_,_,_,_,C.H,C.H,C.H,C.H,C.G,C.W,_,_,_,_], // guard(gold) + blade
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.S,_,_,_,_,_], // hair + SKIN HAND col9 (fist raised up, visible!)
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,C.A,_,_,_,_], // RIGHT ARM at neck col10
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_,_], // body + RIGHT ARM at shoulder col10
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_], // LEFT hand only — right arm is UP
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_],   // left hand only
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

// Attack frame 2 — sword thrust at shoulder height (Minecraft strike)
const ATK2 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_,_,_,_,_,_,_],
  // shoulder row — right arm extends RIGHT: arm(C.A) + SKIN HAND(C.S) + guard + blade
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,C.S,C.G,C.W,C.W,C.W,C.W,C.W,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_,_,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_,_,_,_,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_,_,_,_,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

// Victory — sword raised high
const VIC1 = [
  [_,_,_,_,_,_,_,_,_,C.W,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,C.W,_,_,_,_,_,_],
  [_,_,_,_,_,C.H,C.H,C.H,C.G,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_],
  [_,_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_],
  [_,_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

function drawFrame(canvas, frame, offsetY = 0) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let row = 0; row < frame.length; row++) {
    for (let col = 0; col < frame[row].length; col++) {
      const color = frame[row][col]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(col * PS, row * PS + offsetY, PS, PS)
      }
    }
  }
}

/** Later layers paint over earlier (falsy cell = keep below). */
function mergePix(...layers) {
  if (!layers.length) return []
  const h = layers[0].length
  const w = layers[0][0].length
  const out = []
  for (let r = 0; r < h; r++) {
    const row = []
    for (let c = 0; c < w; c++) {
      let v = layers[0][r][c]
      for (let i = 1; i < layers.length; i++) {
        const p = layers[i][r][c]
        if (p) v = p
      }
      row.push(v)
    }
    out.push(row)
  }
  return out
}

const Z = null // transparent in overlay grids
const BO = '#3f1f0f' // bow outline
const BR = '#8b5a2b' // bow wood
const ST = '#fef08a' // bow string
const AS = '#d1d5db' // arrow shaft
const AH = '#e5e7eb' // arrow head
const AF = '#fbbf24' // arrow fletch
const LG = '#94a3b8' // glasses rim

// Smart: specs on face (rows 0-indexed ~4–5)
const GLASSES_OVL = [
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,LG,C.W,C.W,LG,C.W,C.W,LG,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,LG,LG,Z,LG,LG,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
]

// Dumb: goofy eyes + tongue (overwrites face)
const DUMB_FACE_OVL = [
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,C.H,C.H,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,C.H,C.H,C.H,C.H,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,C.S,C.E,C.S,C.E,C.S,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,C.S,C.M,C.M,C.M,C.S,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,C.S,C.S,C.S,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
]

// Juice: broader chest / arms (muscle)
const MUSCLE_OVL = [
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,Z],
  [Z,C.B,C.B,C.A,C.B,C.B,C.B,C.B,C.B,C.A,C.B,C.B,Z],
  [Z,C.B,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,C.B,Z],
  [Z,Z,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.A,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
]

// Accuracy: pixel bow + arrow (Minecraft-ish) at left
const BOW_OVL = [
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,BO,BR,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [BO,Z,BR,BO,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [BO,Z,Z,BR,BO,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [BO,Z,Z,BR,ST,AS,AS,AS,AH,Z,Z,Z,Z,Z,Z],
  [BO,Z,Z,BR,BO,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [BO,Z,BR,BO,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,BO,BR,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,AF,AS,AS,AS,AH,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
  [Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z,Z],
]

// Speed: three running poses (full body, replaces idle legs/arms)
const JAR_RUN_0 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,C.P,C.P,_,_,_,_,_,_,C.P,C.P,_,_,_,_,_],
  [_,C.P,C.P,_,_,_,_,_,_,C.P,C.P,_,_,_,_,_],
  [_,C.T,C.T,_,_,_,_,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,C.T,C.T,_,_,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]
const JAR_RUN_1 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,C.P,C.P,_,_,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]
const JAR_RUN_2 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_],
  [_,_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_],
  [_,_,_,C.P,C.P,_,_,_,_,C.P,C.P,_,_,_,_],
  [_,_,C.T,C.T,_,_,_,C.T,C.T,_,_,_,_,_,_],
  [_,_,_,C.T,C.T,_,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

const JAR_RUN_FRAMES = [JAR_RUN_0, JAR_RUN_1, JAR_RUN_2]

function buildHuntJarComposite() {
  const accOn = document.getElementById('accuracy-toggle')?.checked !== false
  const dumb = document.getElementById('cheap-mode-toggle')?.checked === true
  const juice = document.getElementById('juice-toggle')?.checked === true

  let base
  if (!accOn) {
    const idx = jarRunPhase % JAR_RUN_FRAMES.length
    base = JAR_RUN_FRAMES[idx]
  } else {
    base = animState.heroFrame === 0 ? IDLE1 : IDLE2
  }

  const layers = [base]
  // Muscles only when Juice can actually apply rules (≥1 activated learning)
  const activeN = cachedActiveLearningCount ?? 0
  if (juice && activeN > 0) layers.push(MUSCLE_OVL)
  if (accOn) layers.push(BOW_OVL)
  if (dumb) layers.push(DUMB_FACE_OVL)
  else layers.push(GLASSES_OVL)
  return mergePix(...layers)
}

let jarRunPhase = 0
let jarRunTimer = 0

/** 9×13 @ 4px = 36×52 — Isaac (kipah, shades, tzitzit) */
const ISAAC_PS = 4
const ISAAC_COL = {
  '.': null,
  k: '#141414',
  h: '#5c4033',
  s: '#f0c8a8',
  v: '#0f172a',
  l: '#334155',
  g: '#e2e8f0',
  w: '#f8fafc',
  b: '#1d4ed8',
  p: '#1e3a5f',
  t: '#422006',
  y: '#facc15',
}
const ISAAC_FRAME_STRS = [
  [
    '...kkk...',
    '..kkkkk..',
    '.hhssshh.',
    '.hsvvvsh.',
    '.svlglvs.',
    '.svvvvvs.',
    '..ss.ss..',
    '..wwwww..',
    'b.wwwww.b',
    'b.wwwww.b',
    'y.wwwww.y',
    '..ppppp..',
    '..p.p.p..',
    '..t.t.t..',
  ],
  [
    '...kkk...',
    '..kkkkk..',
    '.hhssshh.',
    '.hsvvvsh.',
    '.svgllgvs.',
    '.svvvvvs.',
    '..ss.ss..',
    '..wwwww..',
    'b.wwwww.b',
    'b.wwwww.b',
    'y.wwwww.y',
    '..ppppp..',
    '..p.p.p..',
    '..t.t.t..',
  ],
]
const ISAAC_CANVAS = document.getElementById('isaac-canvas')
function drawIsaacFrame(strRows) {
  if (!ISAAC_CANVAS) return
  const ctx = ISAAC_CANVAS.getContext('2d')
  ctx.clearRect(0, 0, ISAAC_CANVAS.width, ISAAC_CANVAS.height)
  for (let r = 0; r < strRows.length; r++) {
    const row = strRows[r]
    for (let c = 0; c < row.length; c++) {
      const col = ISAAC_COL[row[c]]
      if (col) {
        ctx.fillStyle = col
        ctx.fillRect(c * ISAAC_PS, r * ISAAC_PS, ISAAC_PS, ISAAC_PS)
      }
    }
  }
}

// ── Animation loop ────────────────────────────────────────────
const animState = {
  heroFrame:    0,
  heroTimer:    0,
  btnFrame:     0,
  btnTimer:     0,
  cookFrame:    0,
  cookTimer:    0,
  reportFrame:  0,
  reportTimer:  0,
  isaacFrame:   0,
  isaacTimer:   0,
}

const HOME_TODD_CANVAS = document.getElementById('home-todd-canvas')
const HERO_CANVAS    = document.getElementById('hero-canvas')
const HUNT_JAR_CANVAS = document.getElementById('hunt-jar-canvas')
const HUNT_JAR_WRAP = document.getElementById('hunt-jar-wrap')
const COOK_CANVAS    = document.getElementById('cook-canvas')
const REPORT_CANVAS  = document.getElementById('report-canvas')

/** Redraw jar Todd right away when toggles change (don’t wait for next animation frame). */
function refreshHuntJarSprite() {
  if (!HUNT_JAR_CANVAS) return
  drawFrame(HUNT_JAR_CANVAS, buildHuntJarComposite())
}

function animLoop() {
  const now = performance.now()

  // Hero sprite (upload screen logo + home screen)
  if (animState.heroTimer < now) {
    animState.heroFrame = animState.heroFrame === 0 ? 1 : 0
    const heroSprite = animState.heroFrame === 0 ? IDLE1 : IDLE2
    drawFrame(HERO_CANVAS,       heroSprite)
    drawFrame(HOME_TODD_CANVAS,  heroSprite)  // same idle animation on the game launcher
    drawFrame(REPORT_CANVAS, animState.heroFrame === 0 ? VIC1 : IDLE1)
    animState.heroTimer = now + 500
  }

  // Hunt CTA — Todd in a jar (on loading screen; toggles: speed/accuracy, smart/dumb, plain/juice)
  if (state.screen === 'loading' && HUNT_JAR_CANVAS) {
    const accOn = document.getElementById('accuracy-toggle')?.checked !== false
    if (!accOn && now > jarRunTimer) {
      jarRunPhase++
      jarRunTimer = now + 90
    }
    drawFrame(HUNT_JAR_CANVAS, buildHuntJarComposite())
  }

  if (state.screen === 'upload' && ISAAC_CANVAS && animState.isaacTimer < now) {
    animState.isaacFrame = animState.isaacFrame === 0 ? 1 : 0
    drawIsaacFrame(ISAAC_FRAME_STRS[animState.isaacFrame])
    animState.isaacTimer = now + 450
  }

  // Cook canvas — show cooking animation using idle + attack alternating
  if (animState.cookTimer < now) {
    animState.cookFrame = animState.cookFrame === 0 ? 1 : 0
    drawFrame(COOK_CANVAS, animState.cookFrame === 0 ? ATK1 : ATK2)
    animState.cookTimer = now + 180
  }

  requestAnimationFrame(animLoop)
}
requestAnimationFrame(animLoop)

// ═══════════════════════════════════════════════════════════
// SCREEN TRANSITIONS
// ═══════════════════════════════════════════════════════════

const btnGlobalBack = document.getElementById('btn-global-back')
const btnGlobalHome = document.getElementById('btn-global-home')

function updateGlobalNav() {
  if (!btnGlobalBack || !btnGlobalHome) return
  // Hide nav entirely on the root launcher — it has its own back/close flow
  const isRoot = state.screen === 'home'
  btnGlobalHome.hidden = isRoot
  btnGlobalBack.hidden = isRoot
  const busyCook = state.screen === 'cooking'
  btnGlobalBack.disabled = busyCook
  btnGlobalBack.title = busyCook ? 'Not available while cooking' : 'Go back one screen'
}

function resetOpenAiBrewLog() {
  const el = document.getElementById('sbs-openai-brew-log')
  if (el) el.textContent = ''
}

/** Activity log beside the OpenAI Test Lab flask (stream progress + errors). */
function appendOpenAiBrewLog(message, kind = 'info') {
  const el = document.getElementById('sbs-openai-brew-log')
  if (!el || message == null || message === '') return
  const t = new Date().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const sym = kind === 'error' ? '✖' : kind === 'ok' ? '✓' : '·'
  const line = `[${t}] ${sym} ${String(message).replace(/\r\n/g, '\n')}`
  el.textContent = el.textContent ? `${el.textContent}\n${line}` : line
  const maxLines = 100
  const lines = el.textContent.split('\n')
  if (lines.length > maxLines) {
    el.textContent = '…\n' + lines.slice(-maxLines).join('\n')
  }
  el.scrollTop = el.scrollHeight
}

function updateSbsOpenAiLoadingChrome(show) {
  const loadEl = document.getElementById('sbs-loading')
  const brewHero = document.getElementById('sbs-openai-brew-hero')
  const mirror = document.getElementById('sbs-boxer-mirror-right')
  const jar = document.getElementById('sbs-openai-brew-jar')
  const vs = document.getElementById('sbs-vs-pixel')
  if (!loadEl) return
  const isOai = !!show && state.sbsMode === 'openaitest'
  loadEl.classList.toggle('sbs-loading--openaitest', isOai)
  if (brewHero) {
    brewHero.classList.toggle('hidden', !isOai)
    brewHero.setAttribute('aria-hidden', isOai ? 'false' : 'true')
  }
  if (mirror) mirror.classList.toggle('hidden', isOai)
  if (vs) vs.textContent = 'VS'
  if (isOai) {
    const paint = () => window.__paintOpenAiFlaskInto?.(jar)
    paint()
    requestAnimationFrame(() => {
      paint()
      window.setTimeout(paint, 60)
    })
  } else {
    window.__clearOpenAiFlaskPaint?.(jar)
  }
}

function setSideBySideLoadingVisible(show) {
  const el = document.getElementById('sbs-loading')
  const screen = document.getElementById('screen-sidebyside')
  if (!el || !screen) return
  if (show) {
    el.classList.remove('hidden')
    screen.classList.add('sbs-pixel-battle')
    updateSbsOpenAiLoadingChrome(true)
    window.SbsArena?.start()
  } else {
    updateSbsOpenAiLoadingChrome(false)
    el.classList.add('hidden')
    screen.classList.remove('sbs-pixel-battle')
    window.SbsArena?.stop()
  }
}

function goTo(screenName) {
  if (state.screen === 'sidebyside' && screenName !== 'sidebyside') {
    setSideBySideLoadingVisible(false)
  }
  Object.values(screens).forEach(s => s.classList.remove('active'))
  screens[screenName].classList.add('active')
  state.screen = screenName
  if (screenName === 'drtoddlab') {
    state.drlabMode = null
    const drInit = document.getElementById('btn-drlab-initiate')
    if (drInit) {
      drInit.disabled = true
      drInit.setAttribute('aria-label', 'Initiate Dr. Todd — pick a test flask first')
    }
    document.querySelectorAll('.drlab-tube').forEach(el => el.classList.remove('selected'))
    window.__refreshLabFlasks?.()
    // Populate tenant selector
    const sel = document.getElementById('drlab-tenant-select')
    if (sel) {
      if (state.tenants?.length) {
        sel.innerHTML = state.tenants.map(t =>
          `<option value="${t.id}">${escHtml(t.tenantName)} (${t.fileCount} file${t.fileCount !== 1 ? 's' : ''})</option>`
        ).join('')
      } else {
        sel.innerHTML = '<option value="">— upload folders first —</option>'
      }
    }
  }
  updateGlobalNav()
  if (screenName === 'upload' || screenName === 'loading') void refreshJuiceHomePanel()
}

// ═══════════════════════════════════════════════════════════
// GAME LAUNCHER — Home screen routing
// Games are listed directly on screen-home (NES-style menu).
// Each button routes straight to its game — no overlay needed.
// Add new game rows in index.html + a handler here.
// ═══════════════════════════════════════════════════════════

// ── Game 01: Lease Index & Missing Docs Hunter ──────────────
// Resume session if tenants are already loaded, otherwise go to upload
document.getElementById('game-card-hunter')?.addEventListener('click', () => {
  if (state.tenants?.length > 0) {
    goTo('loading')   // resume existing session
  } else {
    goTo('upload')    // fresh start
  }
})

// ── Game 02: Rent Roll Chef (coming soon — disabled) ────────
// Handler wired but button is disabled in HTML. Activate when ready.
document.getElementById('game-card-rr')?.addEventListener('click', () => {
  goTo('rr')
})

// Back button inside screen-rr → return to launcher
document.getElementById('btn-rr-back')?.addEventListener('click', () => {
  goTo('home')
})

// ═══════════════════════════════════════════════════════════
// CLIENT MODE — public (lawyer/reviewer) vs full (owner)
// ═══════════════════════════════════════════════════════════

function applyClientMode() {
  const pub = clientMode === 'public'

  // Home screen: hide game-02, rename game-01 title
  const rrCard = document.getElementById('game-card-rr')
  if (rrCard) rrCard.classList.toggle('hidden', pub)
  const hunterTitle = document.querySelector('#game-card-hunter .home-game-title')
  if (hunterTitle) hunterTitle.textContent = pub ? 'MISSING DOCUMENTS' : 'LEASE INDEX \u0026 MISSING DOCS HUNTER'

  // Loading screen: in public mode show only the Target Practice button
  const btnHunt      = document.getElementById('btn-hunt')
  const btnDrTodd    = document.getElementById('btn-drtoddhunt')
  const btnWorkout   = document.getElementById('btn-workout')
  const togglesPanel = document.querySelector('.hunt-toggles-panel')
  if (btnHunt)      btnHunt.classList.toggle('hidden', pub)
  if (btnDrTodd)    btnDrTodd.classList.toggle('hidden', pub)
  if (btnWorkout)   btnWorkout.classList.toggle('hidden', pub)
  if (togglesPanel) togglesPanel.classList.toggle('hidden', pub)

  // Secret button visual
  const unlockBtn = document.getElementById('btn-secret-unlock')
  if (unlockBtn) unlockBtn.classList.toggle('unlocked', !pub)
}

// Run once on load
applyClientMode()

// Secret owner unlock button
document.getElementById('btn-secret-unlock')?.addEventListener('click', async () => {
  if (clientMode === 'full') {
    toast('\u{1F512} Owner mode active', 'success')
    return
  }
  const pin = await pixelPrompt('ENTER OWNER PIN', '\uD83D\uDD10 UNLOCK', '')
  if (pin === '123') {
    clientMode = 'full'
    applyClientMode()
    toast('\u2705 Owner mode unlocked', 'success')
  } else if (pin !== null && pin !== '') {
    toast('Wrong PIN', 'error')
  }
})

// ═══════════════════════════════════════════════════════════
// UPLOAD SCREEN
// ═══════════════════════════════════════════════════════════

const dropZone      = document.getElementById('drop-zone')
const fileInput     = document.getElementById('file-input')
const fileInputZip  = document.getElementById('file-input-zip')
const btnBrowse     = document.getElementById('btn-browse')
const btnBrowseZip  = document.getElementById('btn-browse-zip')
const btnPreyMain   = document.getElementById('btn-prey-main')

// Choose folder — modern picker, then legacy webkitdirectory (never auto-opens ZIP on cancel)
btnBrowse.addEventListener('click', async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker()
      await uploadFolder(handle)
      return
    } catch (e) {
      if (e.name === 'AbortError') return
      console.warn('[browse] showDirectoryPicker failed, trying legacy folder input:', e)
    }
  }
  fileInput.click()
})

btnPreyMain?.addEventListener('click', () => btnBrowse.click())

btnBrowseZip?.addEventListener('click', () => fileInputZip.click())

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) startUploadWithWebkitOrRaw(fileInput.files)
})

fileInputZip.addEventListener('change', () => {
  if (fileInputZip.files.length > 0) startLocalExtract(Array.from(fileInputZip.files))
})

/** File inputs often populate webkitRelativePath — normalize relativePath for extraction */
function startUploadWithWebkitOrRaw(fileList) {
  const arr = Array.from(fileList)
  for (const f of arr) {
    if (f.webkitRelativePath) f.relativePath = f.webkitRelativePath.replace(/^\/+/, '')
  }
  startLocalExtract(arr)
}

dropZone.addEventListener('dragover', e => {
  e.preventDefault()
  dropZone.classList.add('drag-over')
})
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
dropZone.addEventListener('drop', async e => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')

  const dtFiles = Array.from(e.dataTransfer.files || [])

  // Every dropped *folder* as a DirectoryEntry (Chrome/Safari — supports multiple)
  const dirEntries = []
  if (e.dataTransfer.items) {
    for (const item of e.dataTransfer.items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) dirEntries.push(entry)
    }
  }

  const zipFiles = dtFiles.filter(f => f.name.toLowerCase().endsWith('.zip'))

  if (zipFiles.length > 1) {
    toast('Please drop one ZIP at a time.', 'error')
    return
  }

  if (zipFiles.length === 1 && dirEntries.length > 0) {
    toast('Drop either a ZIP or folder(s), not both.', 'error')
    return
  }

  if (zipFiles.length === 1 && dirEntries.length === 0) {
    console.log('[drop] ZIP only')
    startLocalExtract(zipFiles)
    return
  }

  if (dirEntries.length > 0) {
    console.log('[drop]', dirEntries.length, 'folder(s):', dirEntries.map(d => d.name).join(', '))
    try {
      if (dirEntries.length === 1) await uploadFolderFromEntry(dirEntries[0])
      else await uploadMultipleFolderEntries(dirEntries)
    } catch (err) {
      console.error('[drop] Folder walk failed:', err)
      toast('Could not read folder(s) — try a ZIP or Choose folder.', 'error')
    }
    return
  }

  if (dtFiles.length > 0 && tryStartUploadWithWebkitPaths(dtFiles)) return

  if (dtFiles.length > 0) startLocalExtract(dtFiles)
})

/** When browsers expose files with webkitRelativePath but no DirectoryEntry */
function tryStartUploadWithWebkitPaths(dtFiles) {
  const arr = Array.from(dtFiles)
  if (arr.length === 0) return false
  const withPath = arr.filter(f => f.webkitRelativePath)
  if (withPath.length !== arr.length) return false
  for (const f of withPath) {
    f.relativePath = f.webkitRelativePath.replace(/^\/+/, '')
  }
  console.log('[drop] Using webkitRelativePath for', arr.length, 'files')
  startLocalExtract(withPath)
  return true
}

// ── Drag-drop folder → webkit DirectoryEntry (not FileSystemDirectoryHandle) ──
function readAllDirEntries(dirEntry) {
  return new Promise((resolve, reject) => {
    const reader = dirEntry.createReader()
    const acc = []
    const read = () => {
      reader.readEntries(
        entries => {
          if (entries.length === 0) resolve(acc)
          else {
            acc.push(...entries)
            read()
          }
        },
        reject
      )
    }
    read()
  })
}

function fileEntryToFile(fileEntry) {
  return new Promise((resolve, reject) => fileEntry.file(resolve, reject))
}

/**
 * Collect files from one dropped directory (webkit DirectoryEntry).
 * Same tenant/portfolio rules as uploadFolder (FileSystemDirectoryHandle).
 */
async function collectFilesFromDirEntry(dirEntry) {
  const name = dirEntry.name
  const topEntries = await readAllDirEntries(dirEntry)
  const subfolders = topEntries.filter(e => e.isDirectory)

  const droppedFolderIsTenant     = name.includes(' - ')
  const subfoldersLookLikeTenants = subfolders.some(e => e.name.includes(' - '))
  const isSingleTenant            = droppedFolderIsTenant || !subfoldersLookLikeTenants

  const fileMap = new Map()

  async function walk(entry, pathPrefix) {
    const entries = await readAllDirEntries(entry)
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const childPath = pathPrefix ? `${pathPrefix}/${e.name}` : e.name
      if (e.isFile) {
        const file = await fileEntryToFile(e)
        file.relativePath = childPath
        fileMap.set(childPath, file)
      } else if (e.isDirectory) {
        await walk(e, childPath)
      }
    }
  }

  if (isSingleTenant) await walk(dirEntry, name)
  else                await walk(dirEntry, '')

  return { files: Array.from(fileMap.values()), isSingleTenant }
}

async function uploadFolderFromEntry(dirEntry) {
  const { files, isSingleTenant } = await collectFilesFromDirEntry(dirEntry)
  console.log('[uploadFolderFromEntry]', files.length, 'files, single-tenant:', isSingleTenant)
  if (files.length === 0) {
    toast('No files found in that folder.', 'error')
    return
  }
  startLocalExtract(files)
}

/** Several folders dropped at once (e.g. multiple tenant folders from Finder) */
async function uploadMultipleFolderEntries(dirEntries) {
  const all = []
  for (const de of dirEntries) {
    const { files } = await collectFilesFromDirEntry(de)
    all.push(...files)
  }
  console.log('[uploadMultipleFolderEntries]', dirEntries.length, 'roots →', all.length, 'files')
  if (all.length === 0) {
    toast('No files found in those folders.', 'error')
    return
  }
  startLocalExtract(all)
}

// Recursively collect files from a directory handle (File System Access API)
async function uploadFolder(dirHandle) {
  const fileMap = new Map() // path -> File

  async function walk(handle, path = '') {
    for await (const [name, childHandle] of handle.entries()) {
      if (name.startsWith('.')) continue
      const childPath = path ? `${path}/${name}` : name

      if (childHandle.kind === 'file') {
        const file = await childHandle.getFile()
        file.relativePath = childPath
        fileMap.set(childPath, file)
      } else if (childHandle.kind === 'directory') {
        await walk(childHandle, childPath)
      }
    }
  }

  // Smart detection: is this a single tenant folder or a root folder of multiple tenants?
  const topEntries = []
  for await (const [name, entry] of dirHandle.entries()) {
    if (!name.startsWith('.')) topEntries.push({ name, entry })
  }

  const subfolders = topEntries.filter(e => e.entry.kind === 'directory')

  // A folder name like "RN 6419 - Freeway Insurance" contains " - " → it IS a tenant
  const droppedFolderIsTenant = dirHandle.name.includes(' - ')
  // Subfolders that look like tenant names (contain " - ") → this is a multi-tenant root
  const subfoldersLookLikeTenants = subfolders.some(e => e.name.includes(' - '))

  const isSingleTenant = droppedFolderIsTenant || !subfoldersLookLikeTenants

  if (isSingleTenant) {
    // Use the dropped folder name as the tenant — walk with it as prefix
    await walk(dirHandle, dirHandle.name)
  } else {
    // Multi-tenant root: subfolders are the individual tenants
    await walk(dirHandle)
  }

  const files = Array.from(fileMap.values())
  console.log('[uploadFolder] Collected', files.length, 'files, single-tenant:', isSingleTenant)
  startLocalExtract(files)
}

async function startUpload(files) {
  goTo('loading')

  // Accept all files — server will validate structure
  // On macOS, webkitRelativePath might not be populated, so we accept files with or without it
  const allFiles = Array.from(files)
  if (allFiles.length === 0) {
    toast('No files selected.', 'error')
    goTo('upload')
    return
  }

  // Show progress
  setProgress(0, `Uploading ${allFiles.length} files...`)

  const formData = new FormData()
  for (const file of allFiles) {
    // Use relativePath (File System Access API), then webkitRelativePath, then filename
    const rawPath = file.relativePath || file.webkitRelativePath || file.name
    // Encode "/" as "__SEP__" so server can split folder structure reliably
    const encodedPath = rawPath.replace(/\//g, '__SEP__')
    console.log('[upload] File:', file.name, '→ path:', encodedPath)
    formData.append('files', file, encodedPath)
  }

  try {
    // Simulate incremental upload progress via XHR
    const result = await uploadWithProgress(formData, pct => setProgress(pct, `Uploading... ${pct}%`))

    state.tenants = result.tenants
    setProgress(100, '')
    renderTenantCards(result.tenants)
    showOversizeWarnings(result.tenants)
    sfxReady()
    showHuntCta()

    // Single tenant mode: auto-run on the only/first tenant
    if (state.singleTenantMode && result.tenants.length > 0) {
      state.singleTenantMode = false
      setTimeout(() => startHunt(result.tenants[0].id), 400)
    }
  } catch (err) {
    sfxError()
    const msg = err.message || 'Upload failed'
    toast(msg.includes('tenant folders')
      ? '💡 Tip: Try drag-and-drop instead! It works better on macOS. Drag your folder directly onto the drop zone.'
      : msg, 'error')
    goTo('upload')
  }
}

function uploadWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', sameOriginApi('/api/upload'))
    xhr.setRequestHeader('X-Session-Id', state.sessionId)

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 90))
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText)
          console.log('[upload] Success:', result.tenants.length, 'tenants detected')
          resolve(result)
        }
        catch (e) {
          console.error('[upload] Parse error:', e)
          reject(new Error('Invalid server response'))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          console.error('[upload] Server error:', err.error)
          reject(new Error(err.error || `Server error ${xhr.status}`))
        } catch {
          console.error('[upload] HTTP error:', xhr.status, xhr.responseText)
          reject(new Error(`Server error ${xhr.status}: ${xhr.responseText.substring(0, 100)}`))
        }
      }
    })

    xhr.addEventListener('error', (e) => {
      console.error('[upload] Network error:', e)
      reject(new Error('Network error'))
    })
    xhr.send(formData)
  })
}

// ═══════════════════════════════════════════════════════════
// CLIENT-SIDE FILE EXTRACTION — files never uploaded to Railway for analysis
// ═══════════════════════════════════════════════════════════

/** Mirror of server parseFolderName — same logic, runs in browser */
function parseFolderNameClient(name) {
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

/**
 * Convert ArrayBuffer to base64 string safely (handles large buffers without call-stack overflow).
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Extract files locally (in-browser) from a ZIP or a flat file list,
 * build tenant list, register metadata with server, then show cards.
 *
 * Replaces the XHR upload flow — files stay in RAM, never written to Railway.
 */
async function startLocalExtract(files) {
  goTo('loading')
  setProgress(0, 'Reading files...')

  const allFiles = Array.from(files)
  if (allFiles.length === 0) {
    toast('No files selected.', 'error')
    goTo('upload')
    return
  }

  // Clear previous local state
  state.localFiles = new Map()
  state.localTenants = []

  try {
    // ── Collect { relativePath, name, buffer, size } entries ──────────────
    const rawEntries = [] // { relativePath, name, buffer, size }

    const isZip = allFiles.length === 1 && allFiles[0].name.toLowerCase().endsWith('.zip')

    if (isZip) {
      setProgress(5, 'Reading ZIP...')
      const zipBuffer = await allFiles[0].arrayBuffer()
      const zip = await JSZip.loadAsync(zipBuffer)

      const SKIP_DIRS  = new Set(['__MACOSX', '__pycache__', '.git'])
      const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

      // Load all file entries (no folders) and normalize path
      const fileEntries = []
      zip.forEach((relPath, entry) => {
        if (entry.dir) return
        // Filter skip dirs and skip files
        const parts = relPath.replace(/\\/g, '/').split('/')
        if (parts.some(p => SKIP_DIRS.has(p) || p.startsWith('.'))) return
        const fileName = parts[parts.length - 1]
        if (SKIP_FILES.has(fileName) || fileName.startsWith('.')) return
        fileEntries.push({ relPath: relPath.replace(/\\/g, '/'), entry })
      })

      // Detect wrapper folder: if all paths share same top-level prefix and at least one is ≥ 3 deep
      const pathParts = fileEntries.map(e => e.relPath.split('/'))
      const uniqueTop = new Set(pathParts.map(p => p[0]))
      const hasWrapper = uniqueTop.size === 1 && pathParts.some(p => p.length >= 3)
      const skipDepth  = hasWrapper ? 1 : 0

      for (const { relPath, entry } of fileEntries) {
        const parts = relPath.split('/')
        // Strip wrapper prefix if present
        const strippedParts = parts.slice(skipDepth)
        if (strippedParts.length === 0) continue
        const strippedPath = strippedParts.join('/')
        const buffer = await entry.async('arraybuffer')
        rawEntries.push({
          relativePath: strippedPath,
          name: strippedParts[strippedParts.length - 1],
          buffer,
          size: buffer.byteLength
        })
      }
    } else {
      // Flat file list from folder drag-drop or <input>
      for (const file of allFiles) {
        const rawPath = (file.relativePath || file.webkitRelativePath || file.name).replace(/\\/g, '/')
        const buffer = await file.arrayBuffer()
        rawEntries.push({
          relativePath: rawPath,
          name: file.name,
          buffer,
          size: buffer.byteLength
        })
      }
    }

    setProgress(30, 'Grouping tenants...')

    if (rawEntries.length === 0) {
      toast('No files found.', 'error')
      goTo('upload')
      return
    }

    // ── Build tenant map (mirrors server upload logic) ─────────────────────
    const allParsedParts = rawEntries.map(e => e.relativePath.split('/'))
    const pathFiles      = allParsedParts.filter(p => p.length >= 2)
    const uniqueTopLevel = new Set(pathFiles.map(p => p[0]))
    const hasWrapperFolder = uniqueTopLevel.size === 1 && pathFiles.some(p => p.length >= 3)
    const tenantDepth    = hasWrapperFolder ? 1 : 0

    const tenantMap = new Map() // folderName -> { folderName, fileKeys: [] }

    for (let i = 0; i < rawEntries.length; i++) {
      const entry = rawEntries[i]
      const parts = allParsedParts[i]

      // Store in localFiles by relativePath
      state.localFiles.set(entry.relativePath, {
        name:   entry.name,
        buffer: entry.buffer,
        size:   entry.size
      })

      if (parts.length >= 2) {
        const tenantFolder = parts[tenantDepth] || parts[0]
        if (!tenantMap.has(tenantFolder)) {
          tenantMap.set(tenantFolder, { folderName: tenantFolder, fileKeys: [] })
        }
        tenantMap.get(tenantFolder).fileKeys.push(entry.relativePath)
      } else {
        const bucketName = '_single_tenant_'
        if (!tenantMap.has(bucketName)) {
          tenantMap.set(bucketName, { folderName: bucketName, fileKeys: [] })
        }
        tenantMap.get(bucketName).fileKeys.push(entry.relativePath)
      }
    }

    setProgress(50, 'Parsing tenant names...')

    const PDF_MAX_BYTES = 32 * 1024 * 1024
    const tenants = []
    for (const [folderName, data] of tenantMap) {
      const fileObjects = data.fileKeys.map(k => {
        const f = state.localFiles.get(k)
        return { relativePath: k, name: f.name, size: f.size }
      })

      const oversizedFiles = fileObjects
        .filter(f => f.name.toLowerCase().endsWith('.pdf') && f.size > PDF_MAX_BYTES)
        .map(f => f.name)

      if (folderName === '_single_tenant_') {
        tenants.push({
          id:            crypto.randomUUID(),
          folderName:    'Uploaded Files',
          property:      '--',
          suite:         '--',
          tenantName:    'Uploaded Files',
          fileCount:     fileObjects.length,
          files:         fileObjects.map(f => ({ name: f.name, sizeBytes: f.size, relativePath: f.relativePath })),
          oversizedFiles
        })
      } else {
        const parsed = parseFolderNameClient(folderName)
        tenants.push({
          id:            crypto.randomUUID(),
          folderName,
          property:      parsed.property,
          suite:         parsed.suite,
          tenantName:    parsed.tenantName,
          fileCount:     fileObjects.length,
          files:         fileObjects.map(f => ({ name: f.name, sizeBytes: f.size, relativePath: f.relativePath })),
          oversizedFiles
        })
      }
    }

    // Sort by property then suite
    tenants.sort((a, b) => {
      const propCmp = a.property.localeCompare(b.property)
      if (propCmp !== 0) return propCmp
      return String(a.suite).localeCompare(String(b.suite), undefined, { numeric: true })
    })

    state.localTenants = tenants

    // ── Register metadata with server (no file bytes) ─────────────────────
    setProgress(70, 'Registering session...')

    const regRes = await fetch(sameOriginApi('/api/session/register'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: state.sessionId, tenants: tenants.map(t => ({ id: t.id, folderName: t.folderName, property: t.property, suite: t.suite, tenantName: t.tenantName, fileCount: t.fileCount })) })
    })
    if (!regRes.ok) {
      const err = await regRes.json().catch(() => ({}))
      throw new Error(err.error || 'Session register failed')
    }

    // ── Show tenant cards (instant, no upload wait) ───────────────────────
    setProgress(100, '')
    state.tenants = tenants
    renderTenantCards(tenants)
    showOversizeWarnings(tenants)
    sfxReady()
    showHuntCta()

    if (state.singleTenantMode && tenants.length > 0) {
      state.singleTenantMode = false
      setTimeout(() => startHunt(tenants[0].id), 400)
    }

  } catch (err) {
    sfxError()
    toast(err.message || 'Could not read files', 'error')
    goTo('upload')
  }
}

const _progressQuips = [
  'SNIFFING FILES...',
  'CHASING FOLDERS...',
  'WAKING UP TODD...',
  'READING LEASES...',
  'COUNTING TENANTS...',
  'LOADING PREY...',
  'PARSING DOCS...',
  'ALMOST READY...',
  'LOCKED & LOADED',
]

function setProgress(pct, label) {
  const fill = document.getElementById('upload-progress-fill')
  const lbl  = document.getElementById('upload-progress-label')
  if (fill) fill.style.width = pct + '%'
  if (lbl) {
    // Use fun quip based on progress %, ignore the raw server label
    const idx = Math.min(Math.floor((pct / 100) * _progressQuips.length), _progressQuips.length - 1)
    lbl.textContent = _progressQuips[idx]
  }
}

function renderTenantCards(tenants) {
  const grid = document.getElementById('tenant-grid-loading')
  grid.innerHTML = ''
  tenants.forEach((t, i) => {
    const card = makeTenantCard(t, i, true)
    grid.appendChild(card)
  })
  updateHud()
}

function updateHud() {
  const el = document.getElementById('hud-count')
  if (el) el.textContent = state.tenants.length
}

/** Estimate how many Claude batches this tenant will need.
 *  Mirrors analyzer.js buildBatches: groups PDFs until base64 total > 20MB. */
function predictBatches(files) {
  const BATCH_MAX_BASE64 = 20 * 1024 * 1024
  const PDF_MAX_BYTES    = 32 * 1024 * 1024
  const pdfs = (files || []).filter(f => {
    const ext = f.name.split('.').pop().toLowerCase()
    return ext === 'pdf' && (f.sizeBytes || 0) <= PDF_MAX_BYTES
  })
  if (!pdfs.length) return 1
  let batches = 0, cur = 0
  for (const f of pdfs) {
    const b64 = Math.ceil((f.sizeBytes || 0) * 4 / 3) + 1024
    if (cur > 0 && cur + b64 > BATCH_MAX_BASE64) { batches++; cur = b64 }
    else cur += b64
  }
  if (cur > 0) batches++
  return batches
}

function makeTenantCard(t, animDelay = 0, removable = false) {
  const card = document.createElement('div')
  card.className = 'tenant-card'
  card.id = `card-${t.id}`
  card.style.animationDelay = (animDelay * 60) + 'ms'

  // ── Total size + batch prediction ──────────────────────────
  const totalBytes  = (t.files || []).reduce((s, f) => s + (f.sizeBytes || 0), 0)
  const batchCount  = predictBatches(t.files)
  const sizeLabel   = fmtBytes(totalBytes)
  const batchBadge  = batchCount > 1
    ? `<span class="badge badge-batch">⚡ ${batchCount} BATCHES</span>`
    : `<span class="badge badge-batch badge-batch--single">⚡ 1 BATCH</span>`

  card.innerHTML = `
    ${removable ? `<button class="card-remove" title="Remove tenant">−</button>` : ''}
    <div class="card-badges">
      <span class="badge badge-prop">${escHtml(t.property)}</span>
      <span class="badge badge-suite">${escHtml(String(t.suite))}</span>
      <span class="badge badge-files">${t.fileCount} file${t.fileCount !== 1 ? 's' : ''}</span>
      <span class="badge badge-size">${sizeLabel}</span>
      ${batchBadge}
    </div>
    <div class="card-tenant-name" title="${escHtml(t.tenantName)}">${escHtml(t.tenantName)}</div>
    ${t.files && t.files.length > 0 ? `
    <button class="card-preview-btn" id="preview-btn-${t.id}">📄 Preview Documents</button>
    <div class="card-preview-list" id="preview-list-${t.id}">
      ${t.files.map(f => `
        <div class="preview-file-row">
          <span class="preview-file-name">${escHtml(f.name)}</span>
          <span class="preview-file-size">${fmtBytes(f.sizeBytes)}</span>
        </div>`).join('')}
    </div>` : ''}
    <div class="card-progress-wrap">
      <div class="card-progress-msg" id="pmsg-${t.id}"></div>
    </div>
    <div class="card-result" id="cresult-${t.id}">
      <div class="card-result-dot"></div>
      <span class="card-result-text" id="cresult-text-${t.id}"></span>
    </div>
  `
  // Wire remove button
  const removeBtn = card.querySelector('.card-remove')
  if (removeBtn) {
    removeBtn.addEventListener('click', e => {
      e.stopPropagation()
      state.tenants = state.tenants.filter(x => x.id !== t.id)
      card.remove()
      updateHud()
    })
  }

  // Wire preview button
  const previewBtn = card.querySelector(`#preview-btn-${t.id}`)
  if (previewBtn) {
    previewBtn.addEventListener('click', e => {
      e.stopPropagation()
      const list = card.querySelector(`#preview-list-${t.id}`)
      const open = list.classList.toggle('open')
      previewBtn.textContent = open ? '📄 Hide Documents' : '📄 Preview Documents'
    })
  }

  return card
}

function fmtBytes(bytes) {
  if (!bytes) return '—'
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

// ── HUD buttons ───────────────────────────────────────────────
document.getElementById('btn-clear-all').addEventListener('click', () => {
  state.tenants     = []
  state.findings    = new Map()
  state.sessionId   = crypto.randomUUID()
  state.downloadUrl = null
  state.localFiles  = new Map()
  state.localTenants = []
  document.getElementById('tenant-grid-loading').innerHTML = ''
  document.getElementById('hunt-cta-wrap').classList.remove('ready')
  updateHud()
  goTo('upload')
})

// Add folder button — accepts folder or ZIP
document.getElementById('btn-add-tenant').addEventListener('click', async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker()
      await uploadFolderAdd(handle)
      return
    } catch (e) {
      if (e.name === 'AbortError') return
    }
  }
  document.getElementById('file-input-add-zip').click()
})
document.getElementById('file-input-add').addEventListener('change', e => {
  if (e.target.files.length > 0) addUpload(e.target.files)
})
document.getElementById('file-input-add-zip').addEventListener('change', e => {
  if (e.target.files.length > 0) addUpload(e.target.files)
})

async function addUpload(files) {
  const tempSession = crypto.randomUUID()
  const formData = new FormData()
  const allFiles = Array.from(files)
  for (const file of allFiles) {
    const rel = file.webkitRelativePath || file.name
    const encodedPath = rel.replace(/\//g, '__SEP__')
    formData.append('files', file, encodedPath)
  }
  try {
    // Must send session ID as header — multer reads it before body is parsed
    const res = await fetch(sameOriginApi('/api/upload'), {
      method: 'POST',
      headers: { 'X-Session-Id': tempSession },
      body: formData
    })
    if (!res.ok) { toast('Add failed: server error ' + res.status, 'error'); return }
    const data = await res.json()
    if (!data.tenants) return
    const grid = document.getElementById('tenant-grid-loading')
    for (const t of data.tenants) {
      if (!state.tenants.find(x => x.tenantName === t.tenantName)) {
        state.tenants.push(t)
        grid.appendChild(makeTenantCard(t, state.tenants.length - 1, true))
      }
    }
    updateHud()
  } catch (err) { toast('Add failed: ' + err.message, 'error') }
}

async function uploadFolderAdd(dirHandle) {
  const files = []
  async function walk(handle, parentPath) {
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith('.')) continue
      const p = parentPath ? `${parentPath}/${name}` : name
      if (entry.kind === 'file') files.push({ file: await entry.getFile(), path: p })
      else await walk(entry, p)
    }
  }

  // Smart detection: same logic as main upload
  const topEntries = []
  for await (const [name, entry] of dirHandle.entries()) {
    if (!name.startsWith('.')) topEntries.push({ name, entry })
  }

  const subfolders = topEntries.filter(e => e.entry.kind === 'directory')
  const droppedFolderIsTenant    = dirHandle.name.includes(' - ')
  const subfoldersLookLikeTenants = subfolders.some(e => e.name.includes(' - '))
  const isSingleTenant = droppedFolderIsTenant || !subfoldersLookLikeTenants

  if (isSingleTenant) {
    await walk(dirHandle, dirHandle.name)
  } else {
    // Multi-tenant root: each subfolder is a tenant
    for (const { name, entry } of topEntries) {
      if (entry.kind === 'directory') await walk(entry, name)
    }
  }

  const fileList = files.map(({ file, path }) =>
    new File([file], path.replace(/\//g, '__SEP__'), { type: file.type })
  )
  await addUpload(fileList)
}

// ── Speed vs Accuracy ─────────────────────────────────────────
const accuracyToggle = document.getElementById('accuracy-toggle')
accuracyToggle?.addEventListener('change', () => {
  refreshHuntJarSprite()
})

// ── Smart / Dumb (model tier) ─────────────────────────────────
const CHEAP_MODE_KEY = 'toddCheapMode'
const cheapModeToggle = document.getElementById('cheap-mode-toggle')

function isCheapModeActive() {
  return cheapModeToggle?.checked === true
}

function cheapQs() {
  return isCheapModeActive() ? '&cheap=1' : ''
}

function cheapJsonExtra() {
  return { cheapMode: isCheapModeActive() }
}

// Lab screen cheap toggle — synced with the main loading-screen toggle via localStorage
const cheapModeToggleLab = document.getElementById('cheap-mode-toggle-lab')

function syncCheapToggles(checked) {
  if (cheapModeToggle)    cheapModeToggle.checked    = checked
  if (cheapModeToggleLab) cheapModeToggleLab.checked = checked
  const label = document.getElementById('drlab-cheap-label')
  if (label) label.textContent = checked ? '🪙 DUMB MODE (on)' : '🪙 DUMB MODE'
}

if (cheapModeToggleLab) {
  cheapModeToggleLab.checked = localStorage.getItem(CHEAP_MODE_KEY) === '1'
  syncCheapToggles(cheapModeToggleLab.checked)
  cheapModeToggleLab.addEventListener('change', () => {
    localStorage.setItem(CHEAP_MODE_KEY, cheapModeToggleLab.checked ? '1' : '0')
    syncCheapToggles(cheapModeToggleLab.checked)
  })
}

if (cheapModeToggle) {
  cheapModeToggle.checked = localStorage.getItem(CHEAP_MODE_KEY) === '1'
  cheapModeToggle.addEventListener('change', () => {
    localStorage.setItem(CHEAP_MODE_KEY, cheapModeToggle.checked ? '1' : '0')
    syncCheapToggles(cheapModeToggle.checked)
    refreshHuntJarSprite()
  })
}

// ── Juice (active learnings on main hunt) ───────────────────
const JUICE_MODE_KEY = 'toddJuiceMode'
const juiceToggle = document.getElementById('juice-toggle')

function syncJuiceJarGlow({ flash = false } = {}) {
  if (!HUNT_JAR_WRAP || !juiceToggle) return
  const on = juiceToggle.checked
  HUNT_JAR_WRAP.classList.toggle('hunt-jar-wrap--juice', on)
  if (!on) {
    HUNT_JAR_WRAP.classList.remove('hunt-jar-wrap--juice-flash')
    return
  }
  if (flash) {
    HUNT_JAR_WRAP.classList.remove('hunt-jar-wrap--juice-flash')
    void HUNT_JAR_WRAP.offsetWidth
    HUNT_JAR_WRAP.classList.add('hunt-jar-wrap--juice-flash')
  }
}

HUNT_JAR_WRAP?.addEventListener('animationend', (e) => {
  if (e.animationName === 'huntJarJuiceFlash') {
    HUNT_JAR_WRAP.classList.remove('hunt-jar-wrap--juice-flash')
  }
})

let cachedActiveLearningCount = null
let cachedTotalLearnings = null

function juiceQs() {
  return juiceToggle?.checked ? '&juiced=1' : ''
}

async function prefetchLearningsCount() {
  try {
    const res = await fetch(sameOriginApi('/api/gym/learnings'))
    const list = await res.json()
    const arr = Array.isArray(list) ? list : []
    cachedTotalLearnings = arr.length
    cachedActiveLearningCount = arr.filter(l => l.active).length
  } catch {
    cachedActiveLearningCount = null
    cachedTotalLearnings = null
  }
}

/** Only when Juice is turned on and rules apply — details live on the home panel + 🧃 corner. */
function toastJuiceLearningsStatus() {
  const n = cachedActiveLearningCount ?? 0
  if (n > 0) {
    toast(
      `Juice on — ${n} activated rule${n !== 1 ? 's' : ''} will apply on this hunt.`,
      'success'
    )
  }
}

function formatLearningBatchDate(iso) {
  if (!iso) return 'unknown date'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso).slice(0, 16)
  }
}

function batchKeyForLearning(l) {
  if (l.batchId) return String(l.batchId)
  const isDr = l.source === 'dr-todd-diagnostic'
  const t = (l.createdAt || l.created_at || '').slice(0, 16)
  if (isDr) return `legacy-dr|${t}`
  const tenant = String(l.tenant || '').replace(/\|/g, '_')
  return `legacy-gym|${tenant}|${t}`
}

function buildJuiceLearningGroups(learnings) {
  const byKey = new Map()
  for (const l of learnings) {
    const key = batchKeyForLearning(l)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(l)
  }
  const groups = []
  for (const [, items] of byKey) {
    if (items.length === 0) continue
    const first = items[0]
    const kind = first.source === 'dr-todd-diagnostic' ? 'dr-todd' : 'gym'
    const tenant = first.tenantName || first.tenant || 'Unknown'
    const when = first.createdAt || first.created_at || ''
    groups.push({ kind, tenant, when, items })
  }
  groups.sort((a, b) => (b.when || '').localeCompare(a.when || ''))
  return groups
}

function sortLearningsForDisplay(items) {
  return [...items].sort(
    (a, b) => Number(!!b.active) - Number(!!a.active) ||
      String(a.checkType || '').localeCompare(String(b.checkType || ''))
  )
}

async function juicePatchLearningActive(id, active) {
  const res = await fetch(sameOriginApi(`/api/gym/learnings/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  })
  if (!res.ok) throw new Error('patch failed')
}

async function juiceRefreshModalAfterChange(bodyEl) {
  const res = await fetch(sameOriginApi('/api/gym/learnings'))
  const list = await res.json()
  if (!res.ok) throw new Error(list.error || 'Failed to load')
  const arr = Array.isArray(list) ? list : []
  cachedTotalLearnings = arr.length
  cachedActiveLearningCount = arr.filter(x => x.active).length
  renderJuiceLearningsListInto(bodyEl, arr)
  await refreshJuiceHomePanel()
  refreshHuntJarSprite()
}

async function juiceBulkSetActive(bodyEl, cbs, active) {
  const targets = cbs.filter(cb => cb.checked !== active)
  if (targets.length === 0) {
    toast(active ? 'Already all ON in that set' : 'Already all OFF in that set', 'info')
    return
  }
  try {
    for (const cb of targets) {
      await juicePatchLearningActive(cb.dataset.id, active)
    }
    toast(active ? `✅ ${targets.length} ON` : `${targets.length} OFF`, 'success')
    await juiceRefreshModalAfterChange(bodyEl)
  } catch {
    toast('Could not update — try again', 'error')
  }
}

function truncateJuiceText(str, max) {
  const s = String(str || '').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function syncJuiceGroupMaster(groupEl) {
  const cbs = [...groupEl.querySelectorAll('input.juice-learning-cb')]
  const master = groupEl.querySelector('.juice-master-cb')
  if (!master || cbs.length === 0) return
  const nOn = cbs.filter(c => c.checked).length
  master.indeterminate = nOn > 0 && nOn < cbs.length
  master.checked = nOn === cbs.length && cbs.length > 0
}

function syncAllJuiceGroupMasters(bodyEl) {
  bodyEl.querySelectorAll('[data-juice-group]').forEach(g => syncJuiceGroupMaster(g))
}

async function juiceBulkSetMaster(bodyEl, ids, active) {
  const targets = []
  for (const id of ids) {
    const el = bodyEl.querySelector(`input.juice-learning-cb[data-id="${id}"]`)
    if (el && el.checked !== active) targets.push(el)
  }
  if (targets.length === 0) {
    toast(active ? 'Already all ON for this report' : 'Already all OFF', 'info')
    syncAllJuiceGroupMasters(bodyEl)
    return
  }
  try {
    for (const el of targets) {
      await juicePatchLearningActive(el.dataset.id, active)
      el.checked = active
    }
    toast(active ? `✅ ${targets.length} rules juiced` : `${targets.length} OFF`, 'success')
    await prefetchLearningsCount()
    refreshHuntJarSprite()
    await refreshJuiceHomePanel()
    syncAllJuiceGroupMasters(bodyEl)
  } catch {
    toast('Could not update — try again', 'error')
    await juiceRefreshModalAfterChange(bodyEl)
  }
}

function renderJuiceRuleRowHtml(l, ctx = {}) {
  const ct = escHtml(l.checkType || 'RULE')
  const hint = escHtml(truncateJuiceText(l.suggestion || l.rationale || '', 140))
  const on = l.active ? 'checked' : ''
  const id = String(l.id).replace(/"/g, '')
  const tenantAttr = escHtml(String(ctx.tenant || 'RULE'))
  const kind = ctx.kind === 'dr-todd' ? 'dr-todd' : 'gym'
  return `
    <div class="juice-8bit-rule">
      <button type="button" class="juice-8bit-rule-delete" data-ids="${id}" data-tenant="${tenantAttr}" data-kind="${kind}" title="Delete this rule from the server">−</button>
      <label class="juice-8bit-toggle juice-8bit-toggle--sm" title="Juice this rule">
        <input type="checkbox" class="juice-learning-cb" data-id="${id}" ${on} />
        <span class="juice-8bit-slider"></span>
      </label>
      <span class="juice-8bit-rule-type">${ct}</span>
      <span class="juice-8bit-rule-hint">${hint}</span>
    </div>`
}

let juicePendingDelete = null

function openJuiceDeleteConfirm(ids, bodyEl, tenant, kind) {
  juicePendingDelete = { ids, bodyEl }
  const kindLine = kind === 'dr-todd' ? 'DR TODD EXTRACT' : 'GYM REPORT'
  const msg = document.getElementById('juice-del-modal-msg')
  if (msg) {
    const head = ids.length === 1 ? 'SCRAP THIS ONE RULE?' : 'SCRAP THIS WHOLE BATCH?'
    const tail =
      ids.length === 1
        ? 'Removed from the database — no undo.'
        : `${ids.length} RULE${ids.length !== 1 ? 'S' : ''} — GONE 4EVER`
    msg.textContent =
      `${head}\n\n` +
      `${String(tenant || 'RULES').slice(0, 80)}\n` +
      `${kindLine}\n\n` +
      tail
  }
  document.getElementById('juice-delete-confirm-modal')?.classList.remove('hidden')
}

function closeJuiceDeleteConfirm() {
  document.getElementById('juice-delete-confirm-modal')?.classList.add('hidden')
  juicePendingDelete = null
}

document.getElementById('juice-del-cancel')?.addEventListener('click', () => closeJuiceDeleteConfirm())
document.getElementById('juice-delete-confirm-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'juice-delete-confirm-modal') closeJuiceDeleteConfirm()
})
document.getElementById('juice-del-yes')?.addEventListener('click', async () => {
  const pending = juicePendingDelete
  if (!pending?.ids?.length) {
    closeJuiceDeleteConfirm()
    return
  }
  const { ids, bodyEl } = pending
  closeJuiceDeleteConfirm()
  try {
    for (const id of ids) {
      const res = await fetch(sameOriginApi(`/api/gym/learnings/${encodeURIComponent(id)}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
    }
    toast('SCRAPPED ✓', 'success')
    await juiceRefreshModalAfterChange(bodyEl)
    await prefetchLearningsCount()
    refreshHuntJarSprite()
    await refreshJuiceHomePanel()
  } catch {
    toast('DELETE FAILED', 'error')
    const body = document.getElementById('juice-learnings-body')
    if (body) await juiceRefreshModalAfterChange(body)
  }
})

function juiceLearningsDeleteEditActive() {
  return document.getElementById('juice-learnings-modal')?.classList.contains('juice-modal--delete-edit') === true
}

function setJuiceLearningsDeleteEdit(on) {
  const modal = document.getElementById('juice-learnings-modal')
  const btn = document.getElementById('juice-learnings-edit-toggle')
  if (!modal || !btn) return
  modal.classList.toggle('juice-modal--delete-edit', on)
  btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  btn.textContent = on ? 'DONE' : 'EDIT'
}

let juiceLearningsBodyDelegated = false
function ensureJuiceLearningsDelegation() {
  const body = document.getElementById('juice-learnings-body')
  if (!body || juiceLearningsBodyDelegated) return
  juiceLearningsBodyDelegated = true
  body.addEventListener('click', async (e) => {
    const ruleDel = e.target.closest('.juice-8bit-rule-delete')
    if (ruleDel) {
      if (!juiceLearningsDeleteEditActive()) return
      e.preventDefault()
      e.stopPropagation()
      const ids = (ruleDel.dataset.ids || '').split(',').map(s => s.trim()).filter(Boolean)
      const tenant = ruleDel.getAttribute('data-tenant') || ''
      const kind = ruleDel.getAttribute('data-kind') || ''
      openJuiceDeleteConfirm(ids, body, tenant, kind)
      return
    }
    const delBtn = e.target.closest('.juice-8bit-delete')
    if (delBtn) {
      if (!juiceLearningsDeleteEditActive()) return
      e.preventDefault()
      e.stopPropagation()
      const ids = (delBtn.dataset.ids || '').split(',').map(s => s.trim()).filter(Boolean)
      const tenant = delBtn.getAttribute('data-tenant') || ''
      const kind = delBtn.getAttribute('data-kind') || ''
      openJuiceDeleteConfirm(ids, body, tenant, kind)
      return
    }
    const expand = e.target.closest('.juice-8bit-expand')
    if (expand) {
      const group = expand.closest('[data-juice-group]')
      const det = group?.querySelector('.juice-8bit-details')
      if (!det || !group) return
      det.classList.toggle('hidden')
      const open = !det.classList.contains('hidden')
      expand.setAttribute('aria-expanded', String(open))
      const n = group.dataset.ruleCount || '0'
      expand.textContent = open
        ? `HIDE RULES (${n})`
        : `SEE RULES (${n})`
      return
    }
    if (e.target.closest('.juice-bulk-on.juice-bulk-global')) {
      await juiceBulkSetActive(body, [...body.querySelectorAll('input.juice-learning-cb')], true)
      return
    }
    if (e.target.closest('.juice-bulk-off.juice-bulk-global')) {
      await juiceBulkSetActive(body, [...body.querySelectorAll('input.juice-learning-cb')], false)
    }
  })
  body.addEventListener('change', async (e) => {
    const master = e.target.closest('.juice-master-cb')
    if (master && e.target === master) {
      master.indeterminate = false
      const ids = (master.dataset.ids || '').split(',').map(s => s.trim()).filter(Boolean)
      await juiceBulkSetMaster(body, ids, master.checked)
      return
    }
    const cb = e.target.closest('input.juice-learning-cb')
    if (!cb || e.target !== cb || cb.classList.contains('juice-master-cb')) return
    try {
      await juicePatchLearningActive(cb.dataset.id, cb.checked)
      toast(cb.checked ? '✅ Juiced' : 'OFF', 'success')
      await prefetchLearningsCount()
      refreshHuntJarSprite()
      await refreshJuiceHomePanel()
      const group = cb.closest('[data-juice-group]')
      if (group) syncJuiceGroupMaster(group)
    } catch {
      toast('Could not save — try again', 'error')
      cb.checked = !cb.checked
    }
  })
}

function renderJuiceLearningsListInto(container, learnings) {
  if (learnings.length === 0) {
    container.innerHTML =
      '<p class="gym-no-learnings">No learnings yet. Gym Teacher → Analysis or Dr. Todd → Extract.</p>'
    return
  }
  const groups = buildJuiceLearningGroups(learnings)
  const globalBar = `
    <div class="juice-8bit-global-bar">
      <span class="juice-8bit-pixel-label">ALL SAVED RULES</span>
      <button type="button" class="juice-8bit-chip juice-bulk-on juice-bulk-global">ALL ON</button>
      <button type="button" class="juice-8bit-chip juice-bulk-off juice-bulk-global">ALL OFF</button>
    </div>`
  const sections = groups.map(g => {
    const sorted = sortLearningsForDisplay(g.items)
    const ids = sorted.map(x => String(x.id).replace(/,/g, '')).join(',')
    const n = sorted.length
    const badgeClass = g.kind === 'dr-todd' ? 'juice-8bit-badge--extract' : 'juice-8bit-badge--gym'
    const badgeText = g.kind === 'dr-todd' ? 'EXTRACT' : 'GYM REPORT'
    const subBits = [
      g.kind === 'dr-todd' ? 'DR TODD' : 'WORKOUT',
      formatLearningBatchDate(g.when),
      `${n} RULE${n !== 1 ? 'S' : ''}`
    ]
    const rows = sorted.map(l => renderJuiceRuleRowHtml(l, { tenant: g.tenant, kind: g.kind })).join('')
    const allActive = sorted.length > 0 && sorted.every(x => x.active)
    const masterChecked = allActive ? 'checked' : ''
    return `
    <section class="juice-8bit-group" data-juice-group data-rule-count="${n}">
      <button type="button" class="juice-8bit-delete" data-ids="${ids}" data-tenant="${escHtml(g.tenant)}" data-kind="${g.kind === 'dr-todd' ? 'dr-todd' : 'gym'}" title="Delete this whole batch">✕</button>
      <div class="juice-8bit-group-bar">
        <div class="juice-8bit-group-info">
          <span class="juice-8bit-badge ${badgeClass}">${badgeText}</span>
          <span class="juice-8bit-tenant">${escHtml(g.tenant)}</span>
          <span class="juice-8bit-sub">${escHtml(subBits.join(' · '))}</span>
        </div>
        <div class="juice-8bit-group-juice">
          <span class="juice-8bit-juice-word">JUICE</span>
          <label class="juice-8bit-toggle" title="Whole report / whole extract">
            <input type="checkbox" class="juice-master-cb" data-ids="${ids}" ${masterChecked} />
            <span class="juice-8bit-slider"></span>
          </label>
        </div>
      </div>
      <button type="button" class="juice-8bit-expand" aria-expanded="false">SEE RULES (${n})</button>
      <div class="juice-8bit-details hidden">${rows}</div>
    </section>`
  }).join('')
  container.innerHTML = globalBar + `<div class="juice-learnings-groups-8bit">${sections}</div>`
  container.querySelectorAll('[data-juice-group]').forEach(g => syncJuiceGroupMaster(g))
}

async function openJuiceLearningsModal() {
  const modal = document.getElementById('juice-learnings-modal')
  const body = document.getElementById('juice-learnings-body')
  if (!modal || !body) return
  setJuiceLearningsDeleteEdit(false)
  ensureJuiceLearningsDelegation()
  body.innerHTML = '<p class="gym-no-learnings">Loading…</p>'
  modal.classList.remove('hidden')
  try {
    const res = await fetch(sameOriginApi('/api/gym/learnings'))
    const list = await res.json()
    if (!res.ok) throw new Error(list.error || 'Failed to load')
    const arr = Array.isArray(list) ? list : []
    cachedTotalLearnings = arr.length
    cachedActiveLearningCount = arr.filter(x => x.active).length
    renderJuiceLearningsListInto(body, arr)
    await refreshJuiceHomePanel()
  } catch (e) {
    body.innerHTML = `<p class="gym-no-learnings">Could not load: ${escHtml(e.message)}</p>`
    await prefetchLearningsCount()
    syncJuiceLoadingBanner()
  }
}

function syncJuiceLoadingBanner() {
  const el = document.getElementById('juice-loading-banner')
  const textEl = document.getElementById('juice-loading-banner-text')
  if (!el || !textEl) return
  const juiceOn = document.getElementById('juice-toggle')?.checked === true
  const n = cachedActiveLearningCount ?? 0
  const total = cachedTotalLearnings ?? 0
  const onLoading = state.screen === 'loading'
  if (!onLoading || !juiceOn || n > 0) {
    el.classList.add('hidden')
    return
  }
  el.classList.remove('hidden')
  if (cachedActiveLearningCount === null && cachedTotalLearnings === null) {
    textEl.textContent =
      'Juice is ON but learnings could not be loaded. Check your connection, then open the rule list to activate rules before hunting.'
    return
  }
  if (total === 0) {
    textEl.textContent =
      'Juice is ON and there are no saved rules yet — this hunt runs standard Todd. Add learnings from Gym Teacher or Dr. Todd, then activate them below, or turn Juice off for a plain run.'
  } else {
    textEl.textContent =
      `Juice is ON but no rules are activated (${total} saved). Open the rule list and turn rules ON, or this hunt won’t use your training.`
  }
}

async function refreshJuiceHomePanel() {
  const text = document.getElementById('juice-home-text')
  await prefetchLearningsCount()
  const n = cachedActiveLearningCount ?? 0
  const total = cachedTotalLearnings ?? 0
  const juiceOn = juiceToggle?.checked
  if (text) {
    if (cachedActiveLearningCount === null && cachedTotalLearnings === null) {
      text.textContent =
        'Could not reach the server. When you’re online, use “Open rule list” or the 🧃 in the corner to load learnings.'
    } else if (total === 0) {
      text.textContent = juiceOn
        ? 'Juice is ON — no saved rules yet. After Gym Teacher or Dr. Todd adds learnings, turn them ON here or via the 🧃 in the corner.'
        : 'No saved rules yet. Train Todd in Gym Teacher or Dr. Todd, then turn rules ON here (or 🧃 corner) and flip JUICE on after you upload folders.'
    } else if (n === 0) {
      text.textContent = juiceOn
        ? `Juice is ON, but no rules are activated yet — you have ${total} saved. Use “Open rule list” or the 🧃 below to switch rules ON for hunts.`
        : `You have ${total} saved rule${total !== 1 ? 's' : ''} — activate them below (or 🧃 corner), then turn JUICE on when you hunt.`
    } else {
      text.textContent = juiceOn
        ? `Juice is ON — ${n} activated rule${n !== 1 ? 's' : ''} will apply on hunts (${total} saved total).`
        : `${n} rule${n !== 1 ? 's' : ''} activated — turn JUICE on when you upload to apply them. ${total} saved total.`
    }
  }
  syncJuiceLoadingBanner()
}

if (juiceToggle) {
  juiceToggle.checked = localStorage.getItem(JUICE_MODE_KEY) === '1'
  syncJuiceJarGlow({ flash: false })
  juiceToggle.addEventListener('change', () => {
    localStorage.setItem(JUICE_MODE_KEY, juiceToggle.checked ? '1' : '0')
    const turnedOn = juiceToggle.checked
    syncJuiceJarGlow({ flash: turnedOn })
    prefetchLearningsCount().then(async () => {
      refreshHuntJarSprite()
      await refreshJuiceHomePanel()
      if (turnedOn) toastJuiceLearningsStatus()
    })
  })
}

document.getElementById('juice-home-manage')?.addEventListener('click', () => openJuiceLearningsModal())
document.getElementById('juice-easter')?.addEventListener('click', () => openJuiceLearningsModal())
document.getElementById('juice-loading-manage')?.addEventListener('click', () => openJuiceLearningsModal())
document.getElementById('juice-learnings-edit-toggle')?.addEventListener('click', () => {
  setJuiceLearningsDeleteEdit(!juiceLearningsDeleteEditActive())
})

document.getElementById('juice-learnings-close')?.addEventListener('click', () => {
  setJuiceLearningsDeleteEdit(false)
  document.getElementById('juice-learnings-modal')?.classList.add('hidden')
  void refreshJuiceHomePanel()
})

// Restore jar overlays (glasses/dumb, muscles when juice + active rules) after localStorage init
prefetchLearningsCount().then(async () => {
  requestAnimationFrame(() => refreshHuntJarSprite())
  await refreshJuiceHomePanel()
})

function showOversizeWarnings(tenants) {
  const warn = document.getElementById('oversize-warning')
  if (!warn) return
  const all = tenants.flatMap(t =>
    (t.oversizedFiles || []).map(f => `${t.tenantName}: ${f}`)
  )
  if (all.length === 0) { warn.classList.add('hidden'); return }
  warn.classList.remove('hidden')
  warn.innerHTML = `<strong>⚠️ ${all.length} file${all.length !== 1 ? 's' : ''} exceed 32MB — will use text extraction (may miss scanned content):</strong>` +
    all.map(f => `• ${f}`).join('<br/>')
}

function showHuntCta() {
  const wrap = document.getElementById('hunt-cta-wrap')
  wrap.classList.add('ready')
  syncJuiceJarGlow({ flash: false })
  prefetchLearningsCount().then(async () => {
    refreshHuntJarSprite()
    await refreshJuiceHomePanel()
  })
}

// ═══════════════════════════════════════════════════════════
// HUNT SCREEN
// ═══════════════════════════════════════════════════════════

document.getElementById('btn-hunt').addEventListener('click', () => startHunt())

document.getElementById('btn-kill-hunt').addEventListener('click', () => {
  fullResetSession()
  goTo('upload')
  toast('Hunt stopped — ready for a new session', 'info')
})
document.getElementById('btn-drtoddhunt').addEventListener('click', () => goTo('drtoddlab'))
document.getElementById('btn-drlab-back')?.addEventListener('click', () => navigateGlobalBack())
function setDrLabMode(mode) {
  state.drlabMode = mode
  document.querySelectorAll('.drlab-tube').forEach(el => el.classList.remove('selected'))
  const byMode = {
    juice: 'btn-drlab-juice',
    triple: 'btn-drlab-triple',
    doublecheck: 'btn-drlab-double',
    modelcompare: 'btn-drlab-api',
    openaitest: 'btn-drlab-openaitest'
  }
  document.getElementById(byMode[mode])?.classList.add('selected')
  const drInit = document.getElementById('btn-drlab-initiate')
  if (drInit) {
    drInit.disabled = false
    drInit.setAttribute('aria-label', 'Initiate Dr. Todd with selected test')
  }
}
function launchDrLabMode() {
  if (!state.drlabMode) return toast('Pick a flask first', 'info')
  if (!state.tenants?.length) {
    return toast('Load tenant folders on the Hunt screen first — these tests need documents in your session.', 'info')
  }
  const tenantId = document.getElementById('drlab-tenant-select')?.value || null
  if (state.drlabMode === 'triple') return startDrToddHunt(tenantId)
  void startSideBySide(tenantId, state.drlabMode)
}
document.getElementById('btn-drlab-juice')?.addEventListener('click', () => setDrLabMode('juice'))
document.getElementById('btn-drlab-triple')?.addEventListener('click', () => setDrLabMode('triple'))
document.getElementById('btn-drlab-double')?.addEventListener('click', () => setDrLabMode('doublecheck'))
document.getElementById('btn-drlab-api')?.addEventListener('click', () => setDrLabMode('modelcompare'))
document.getElementById('btn-drlab-openaitest')?.addEventListener('click', () => setDrLabMode('openaitest'))
document.getElementById('btn-drlab-initiate')?.addEventListener('click', launchDrLabMode)

document.getElementById('btn-generate-report').addEventListener('click', () => {
  requestDrToddReport()
})

document.getElementById('btn-drtodd-dumbdown')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-drtodd-dumbdown')
  const reportText = document.getElementById('drtoddhunt-report-text')?.textContent?.trim() || ''
  const tenantName = document.getElementById('drtoddhunt-sub')?.textContent || ''
  if (!reportText) return toast('Generate a Dr. Todd report first', 'info')
  btn.disabled = true
  const prev = btn.textContent
  btn.textContent = '🧃 Cooking TL;DR...'
  try {
    const res = await fetch(sameOriginApi('/api/drtoddhunt/tldr'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportText, tenantName, ...cheapJsonExtra() })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Could not create TL;DR')
    const wrap = document.getElementById('drtodd-tldr')
    const textEl = document.getElementById('drtodd-tldr-text')
    if (textEl) textEl.textContent = data.tldr || 'No TL;DR returned.'
    wrap?.classList.remove('hidden')
    toast('TL;DR ready', 'success')
  } catch (err) {
    toast('TL;DR error: ' + err.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = prev
  }
})

document.getElementById('btn-copy-report').addEventListener('click', () => {
  const text = document.getElementById('drtoddhunt-report-text').textContent
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-report')
    btn.textContent = '✅ Copied!'
    btn.classList.add('copied')
    setTimeout(() => {
      btn.textContent = '📋 Copy Report'
      btn.classList.remove('copied')
    }, 2000)
  }).catch(() => toast('Copy failed — please select and copy manually', 'error'))
})

document.getElementById('btn-drtoddhunt-restart').addEventListener('click', () => {
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
  goTo('loading')
})

// ── Dr. Todd → Extract Learnings ──────────────────────────
document.getElementById('btn-extract-learnings')?.addEventListener('click', async () => {
  const btn        = document.getElementById('btn-extract-learnings')
  const reportText = document.getElementById('drtoddhunt-report-text').textContent
  const tenantName = document.getElementById('drtoddhunt-sub').textContent.replace(/^.*?:/, '').trim()

  btn.disabled    = true
  btn.textContent = '⏳ Extracting...'

  try {
    const res  = await fetch(sameOriginApi('/api/drtoddhunt/extract-learnings'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: state.sessionId, reportText, tenantName, ...cheapJsonExtra() })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Server error')

    // Show summary
    document.getElementById('drtodd-learnings-summary').textContent = data.summary || ''

    // Render learning cards
    const list = document.getElementById('drtodd-learnings-list')
    list.innerHTML = (data.learnings || []).map(l => `
      <div class="drtodd-learning-item">
        <div class="drtodd-learning-item-top">
          <span class="drtodd-learning-badge">${escHtml(l.checkType || 'GENERAL')}</span>
          <span class="sev-pill sev-${(l.confidence||'low').toLowerCase()}">${escHtml(l.confidence || 'LOW')}</span>
          <span class="drtodd-learning-saved">✓ Saved</span>
        </div>
        <div class="drtodd-learning-suggestion">${escHtml(l.suggestion || '')}</div>
        ${l.rationale ? `<div class="drtodd-learning-rationale">${escHtml(l.rationale)}</div>` : ''}
      </div>`).join('')

    document.getElementById('drtodd-learnings-result').classList.remove('hidden')
    btn.textContent = '✅ Learnings Saved!'
    toast(`${data.learnings.length} learning${data.learnings.length !== 1 ? 's' : ''} saved from Dr. Todd`, 'success')
  } catch (err) {
    btn.disabled    = false
    btn.textContent = '🧠 Extract & Save Learnings'
    toast('Error: ' + err.message, 'error')
  }
})

// ── Side-by-Side button (from Dr. Todd results) ────────────
document.getElementById('btn-sidebyside')?.addEventListener('click', () => {
  void startSideBySide()
})

// ── Back from side-by-side ─────────────────────────────────
document.getElementById('sbs-back')?.addEventListener('click', () => {
  if (state.eventSource) {
    state.eventSource.close()
    state.eventSource = null
  }
  goTo(state.sbsSourceScreen || 'drtoddlab')
})

// ── Side-by-Side logic ─────────────────────────────────────
function getSbsModeConfig(mode = 'juice') {
  if (mode === 'openaitest') {
    return {
      title: '🤖 OpenAI API Test Lab',
      leftLabel: 'HOW IT WAS SENT',
      rightLabel: 'OPENAI FINDINGS',
      verdictTitle: '🔬 Run Dr. Verdict',
      verdictCopy: 'Not used in OpenAI Test Lab.',
      endpoint: '/api/openaitest'
    }
  }
  if (mode === 'modelcompare') {
    return {
      title: '🧪 API Battle: Claude vs OpenAI',
      leftLabel: 'CLAUDE API',
      rightLabel: 'OPENAI API',
      verdictTitle: '🔬 Run API Verdict',
      verdictCopy: 'Dr. Verdict compares Claude output vs OpenAI output and calls a winner for this folder.',
      endpoint: '/api/modelcompare'
    }
  }
  if (mode === 'doublecheck') {
    return {
      title: '🧪 Double Check Test',
      leftLabel: 'REGULAR MODEL',
      rightLabel: 'REVIEWER PASS',
      verdictTitle: '🔬 Run Reviewer Verdict',
      verdictCopy: 'Compare first-pass findings with the reviewer second pass to see what changed.',
      endpoint: '/api/doublecheck'
    }
  }
  return {
    title: '🥊 Juice Tester',
    leftLabel: 'RAW TODD',
    rightLabel: 'BEEFED-UP TODD',
    verdictTitle: '🔬 Run Dr. Verdict',
    verdictCopy: 'Let Dr. Todd compare both results and tell you if the learnings helped, hurt, or need revision.',
    endpoint: '/api/sidebyside'
  }
}

function applySbsModeUi(cfg) {
  document.getElementById('sbs-title').textContent = cfg.title
  document.getElementById('sbs-loading-left-label').textContent = cfg.leftLabel
  document.getElementById('sbs-loading-right-label').textContent = cfg.rightLabel
  document.getElementById('sbs-left-label').textContent = cfg.leftLabel
  document.getElementById('sbs-right-label').textContent = cfg.rightLabel
  document.getElementById('sbs-verdict-title').textContent = cfg.verdictTitle
  document.getElementById('sbs-verdict-copy').textContent = cfg.verdictCopy
}

async function startSideBySide(tenantId = null, mode = 'juice') {
  state.sbsSourceScreen = state.screen
  state.sbsMode = mode
  const cfg = getSbsModeConfig(mode)

  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    toast(
      'Do not open index.html from the file system. Run `npm start` and open the URL shown in the terminal (default http://127.0.0.1:3456), or your Railway URL.',
      'error'
    )
    return
  }

  let check
  const checkUrl = sameOriginApi(`/api/session/check?sessionId=${encodeURIComponent(state.sessionId)}`)
  try {
    const r = await fetch(checkUrl, { cache: 'no-store' })
    const text = await r.text()
    let data = {}
    if (text.trim()) {
      try {
        data = JSON.parse(text)
      } catch {
        const looksHtml = /<\!DOCTYPE|<html|Cannot GET/i.test(text)
        if (r.status === 404 && looksHtml) {
          toast(
            'This browser tab is not talking to Todd Jr. (the server returned HTML, not JSON). Run `npm start` in the project folder and open the URL it prints (port 3456 by default). If the UI is hosted separately, set <meta name="todd-api-base"> to your API origin.',
            'error'
          )
        } else {
          toast(
            `Server returned ${r.status} with non-JSON. Open ${sameOriginApi('/api/health')} — you should see JSON with "service":"todd-jr".`,
            'error'
          )
        }
        return
      }
    }
    if (!r.ok || !data.ok) {
      toast(
        data.error ||
          (r.status === 404
            ? 'No session on this server — upload folders again (or the server restarted and cleared in-memory sessions).'
            : `Server check failed (${r.status})`),
        'error'
      )
      return
    }
    if (!data.tenantCount) {
      toast(
        data.note ||
          'Upload at least one tenant folder before running this screen.',
        'error'
      )
      return
    }
    check = data
  } catch (e) {
    const origin = getApiOrigin() || '(unknown)'
    const hint =
      'Failed to connect. Run `npm start` and use the URL in the terminal (e.g. http://127.0.0.1:3456). ' +
      'If the UI is hosted separately, set <meta name="todd-api-base" content="https://…"> to your API origin (e.g. Railway).'
    toast(`${e?.message || 'Network error'} — API base: ${origin}. ${hint}`, 'error')
    return
  }

  if (mode === 'openaitest') {
    if (!check.openAIConfigured) {
      toast(
        'OpenAI Test Lab needs a key: add openai.key (one line) or OPENAI_API_KEY in .env (or Railway Variables) and restart. Then upload folders.',
        'error'
      )
      return
    }
  } else if (!check.anthropicConfigured) {
    toast(
      'ANTHROPIC_API_KEY is not set on the server — Claude cannot run. Add it in .env or Railway Variables and restart.',
      'error'
    )
    return
  }
  if (mode === 'modelcompare' && !check.openAIConfigured) {
    toast(
      'No OpenAI key — only Claude runs. Add openai.key or OPENAI_API_KEY on the server.',
      'info'
    )
  }

  applySbsModeUi(cfg)
  goTo('sidebyside')
  document.getElementById('sbs-subtitle').textContent =
    `Connected — ${check.tenantCount} tenant(s) in session · starting live stream…`
  setSideBySideLoadingVisible(true)
  document.getElementById('sbs-results').classList.add('hidden')
  document.getElementById('sbs-raw-fill').style.width    = '0%'
  document.getElementById('sbs-beefed-fill').style.width = '0%'
  document.getElementById('sbs-raw-msg').textContent     =
    mode === 'openaitest' ? 'OpenAI only — Claude not used' : 'Waiting for stream…'
  document.getElementById('sbs-beefed-msg').textContent  =
    mode === 'openaitest' ? 'Starting…' : 'Waiting for stream…'
  const brewSub = document.getElementById('sbs-openai-brew-sub')
  if (brewSub) brewSub.textContent = mode === 'openaitest' ? 'Starting…' : ''
  if (mode === 'openaitest') {
    resetOpenAiBrewLog()
    appendOpenAiBrewLog(`Connecting… ${cfg.endpoint}`)
  }

  // If local files in RAM, push them to server before SSE opens
  if (state.localFiles?.size > 0 && tenantId) {
    await gymRegisterLocalFiles(tenantId)
  }

  let qs = `sessionId=${encodeURIComponent(state.sessionId)}`
  if (tenantId) qs += `&tenantId=${encodeURIComponent(tenantId)}`
  qs += cheapQs()
  const url = sameOriginApi(`${cfg.endpoint}?${qs}`)

  if (state.eventSource) { state.eventSource.close() }
  const es = new EventSource(url)
  state.eventSource = es
  sfxStartHuntLoop()

  let sbsStreamAck = false
  const markSbsAck = () => { sbsStreamAck = true }
  const sbsFailTimer = window.setTimeout(() => {
    if (sbsStreamAck) return
    if (state.eventSource !== es) return
    if (state.screen !== 'sidebyside') return
    try { es.close() } catch {}
    state.eventSource = null
    if (mode === 'openaitest') {
      appendOpenAiBrewLog(
        'No stream activity within 15s — check server, session, and OPENAI_API_KEY / openai.key.',
        'error'
      )
    }
    toast(
      mode === 'openaitest'
        ? 'OpenAI test did not start. Confirm folders are uploaded, OPENAI_API_KEY or openai.key is set on the server, and the API URL is correct.'
        : 'Comparison did not start. Use your server URL, load tenant folders on the Hunt screen first, and ensure ANTHROPIC_API_KEY is set.',
      'error'
    )
    setSideBySideLoadingVisible(false)
    goTo(state.sbsSourceScreen || 'loading')
  }, 15000)

  es.addEventListener('sbs-start', e => {
    markSbsAck()
    window.clearTimeout(sbsFailTimer)
    const d = JSON.parse(e.data)
    const sub = document.getElementById('sbs-subtitle')
    if (mode === 'openaitest') {
      sub.textContent = d.openaiEnabled === false
        ? `${d.tenantName} — OpenAI Test Lab (API key missing on server)`
        : `${d.tenantName} — OpenAI Responses API only (native PDF input_file path)`
      appendOpenAiBrewLog(
        d.openaiEnabled === false
          ? 'sbs-start: OpenAI key not configured on server — expect skipped run.'
          : `sbs-start: ${d.tenantName || 'Tenant'} — OpenAI pipeline starting.`,
        d.openaiEnabled === false ? 'error' : 'ok'
      )
    } else if (mode === 'modelcompare') {
      sub.textContent = d.openaiEnabled === false
        ? `${d.tenantName} — Claude API (OpenAI not configured on server)`
        : `${d.tenantName} — Claude API vs OpenAI API (parallel runs)`
    } else if (mode === 'doublecheck') {
      sub.textContent = `${d.tenantName} — independent reviewer pass enabled`
    } else {
      sub.textContent =
        `${d.tenantName} — ${d.activeLearningCount} active learning${d.activeLearningCount !== 1 ? 's' : ''} applied`
    }
  })

  es.addEventListener('sbs-progress', e => {
    const d    = JSON.parse(e.data)
    const fill = document.getElementById(`sbs-${d.side}-fill`)
    const msg  = document.getElementById(`sbs-${d.side}-msg`)
    if (fill) fill.style.width = d.percent + '%'
    if (msg)  msg.textContent  = d.message || ''
    if (mode === 'openaitest' && d.side === 'beefed') {
      const sub = document.getElementById('sbs-openai-brew-sub')
      if (sub) sub.textContent = d.message || ''
    }
    if (mode === 'openaitest' && d.message) {
      const who = d.side === 'beefed' ? 'OpenAI' : 'Status'
      const isErr = /error|fail|skipped|missing key|no key/i.test(d.message)
      appendOpenAiBrewLog(`${who}: ${d.message}`, isErr ? 'error' : 'info')
    }
  })

  es.addEventListener('sbs-complete', e => {
    markSbsAck()
    window.clearTimeout(sbsFailTimer)
    es.close()
    state.eventSource = null
    sfxStopBgLoop()
    let d
    try {
      d = JSON.parse(e.data)
    } catch (parseErr) {
      console.error('[sbs-complete] JSON parse failed', parseErr, e.data?.slice?.(0, 400))
      if (mode === 'openaitest') {
        appendOpenAiBrewLog('sbs-complete: response was not valid JSON — check server / proxy logs.', 'error')
      }
      toast('Could not read results from the server. Try again or check server logs.', 'error')
      setSideBySideLoadingVisible(false)
      return
    }
    if (mode === 'openaitest') {
      const meta = d.openaiTestMeta
      const beefed = d.beefed || {}
      if (meta && typeof meta.error === 'string' && meta.error.trim()) {
        appendOpenAiBrewLog(`Pipeline: ${meta.error}`, 'error')
      }
      if (beefed.openaiSkipped) {
        const hint = (beefed.findings && beefed.findings[0] && beefed.findings[0].comment) || 'OpenAI skipped.'
        appendOpenAiBrewLog(`Skipped: ${hint}`, 'error')
      }
      if (beefed.openaiError && beefed.findings && beefed.findings[0]) {
        appendOpenAiBrewLog(`OpenAI failure: ${beefed.findings[0].comment || beefed.findings[0].missingDocument || 'see findings'}`, 'error')
      }
        appendOpenAiBrewLog('sbs-complete: run finished — showing results.', 'ok')
    }
    sfxReady()
    // Store for verdict call
    state.sbsLastResult = d
    setSideBySideLoadingVisible(false)
    document.getElementById('sbs-results').classList.remove('hidden')
    // Reset verdict panel (CTA visibility set in renderSideBySide for openaitest)
    document.getElementById('sbs-verdict-loading').classList.add('hidden')
    document.getElementById('sbs-verdict-report').classList.add('hidden')
    document.getElementById('btn-run-verdict').disabled = false
    document.getElementById('btn-run-verdict').textContent = '🔬 Generate Verdict'
    try {
      renderSideBySide(d)
    } catch (renderErr) {
      console.error('[sbs-complete] render failed', renderErr)
      if (mode === 'openaitest') {
        appendOpenAiBrewLog(`Results UI error: ${renderErr?.message || renderErr}`, 'error')
      }
      toast('Results arrived but the UI failed to display them. See the browser console.', 'error')
    }
  })

  es.addEventListener('sbs-error', e => {
    markSbsAck()
    window.clearTimeout(sbsFailTimer)
    es.close()
    state.eventSource = null
    sfxStopBgLoop()
    let errMsg = 'Unknown'
    try {
      errMsg = e.data ? (JSON.parse(e.data).error || 'Unknown') : 'Unknown'
    } catch {
      errMsg = typeof e.data === 'string' && e.data ? e.data : 'Unknown'
    }
    if (mode === 'openaitest') appendOpenAiBrewLog(`sbs-error: ${errMsg}`, 'error')
    sfxError()
    toast('Side-by-side error: ' + errMsg, 'error')
    setSideBySideLoadingVisible(false)
    goTo(state.sbsSourceScreen || 'loading')
  })

  es.addEventListener('error', () => {
    window.setTimeout(() => {
      if (sbsStreamAck) return
      if (state.eventSource !== es) return
      if (es.readyState !== EventSource.CLOSED) return
      window.clearTimeout(sbsFailTimer)
      state.eventSource = null
      if (state.sbsMode === 'openaitest') {
        appendOpenAiBrewLog('EventSource closed before the run completed — network, CORS, or server crash.', 'error')
      }
      toast(
        'Lost connection to the server before the run started. Reload, confirm folders are loaded, and check the server is running.',
        'error'
      )
      setSideBySideLoadingVisible(false)
      goTo(state.sbsSourceScreen || 'loading')
    }, 80)
  })
}

const CHECK_LABELS_SBS = {
  EXECUTION:'Execution', EXHIBIT:'Missing Exhibit', CURRENCY:'Lease Currency',
  REFERENCED_DOC:'Missing Doc', AMENDMENT_GAP:'Amendment Gap', MISSING_PAGE:'Missing Pages',
  LEGIBILITY:'Legibility', SPECIAL_AGREEMENT:'Special Agreement', GUARANTY:'Guaranty',
  NAME_MISMATCH:'Name Mismatch'
}

/**
 * Shared finding card renderer for all side-by-side modes (juice, doublecheck, openaitest, modelcompare).
 * Shows: check type, severity, unique badge, missing doc, comment, and evidence.
 */
function renderSbsFindings(findings, otherKeys, isBeefed) {
  if (!findings || findings.length === 0) {
    return '<div class="sbs-finding-card all-clear"><span class="sbs-card-doc">✅ All Clear — no findings</span></div>'
  }
  const isDoubleCheck = state.sbsMode === 'doublecheck'
  return findings.map(f => {
    const key      = `${f.checkType}||${(f.missingDocument || '').toLowerCase().trim()}`
    const isUnique = !otherKeys.has(key)
    const sevClass = (f.severity || 'low').toLowerCase()

    // Review status badge (doublecheck right column only)
    let reviewBadge = ''
    if (isDoubleCheck && isBeefed && f.reviewStatus) {
      const rs = f.reviewStatus.toUpperCase()
      if (rs === 'CONFIRMED') reviewBadge = `<span class="review-badge review-confirmed">✓ CONFIRMED</span>`
      else if (rs === 'CORRECTED') reviewBadge = `<span class="review-badge review-corrected">✎ CORRECTED</span>`
      else if (rs === 'ADDED') reviewBadge = `<span class="review-badge review-added">⚡ MISSED — ADDED</span>`
    } else if (!isDoubleCheck && isUnique) {
      reviewBadge = `<span class="sbs-unique-badge ${isBeefed ? 'only-beefed' : 'only-raw'}">${isBeefed ? '🆕 New find' : '⚠️ Only here'}</span>`
    }

    const reviewNoteHtml = (isDoubleCheck && isBeefed && f.reviewNote)
      ? `<div class="sbs-card-review-note">${escHtml(f.reviewNote)}</div>`
      : ''

    const evidenceHtml = f.evidence
      ? `<div class="sbs-card-evidence">
           <span class="sbs-card-evidence-label">📍 Evidence</span>
           <span class="sbs-card-evidence-text">${escHtml(f.evidence)}</span>
         </div>`
      : ''
    return `
      <div class="sbs-finding-card sev-${sevClass}">
        <div class="sbs-card-top">
          <span class="sbs-card-check">${escHtml(CHECK_LABELS_SBS[f.checkType] || f.checkType || '')}</span>
          <span class="sev-pill sev-${sevClass}">${escHtml(f.severity || 'LOW')}</span>
          ${reviewBadge}
        </div>
        <div class="sbs-card-doc">${escHtml(f.missingDocument || 'N/A')}</div>
        <div class="sbs-card-comment">${escHtml(f.comment || '')}</div>
        ${reviewNoteHtml}
        ${evidenceHtml}
      </div>`
  }).join('')
}

function renderRemovedFindings(removedFindings) {
  if (!removedFindings || removedFindings.length === 0) return ''
  const items = removedFindings.map(r =>
    `<div class="removed-finding-item">
      <div class="removed-finding-label">🗑 ${escHtml(r.originalFinding || '')}</div>
      <div class="removed-finding-reason">${escHtml(r.reason || '')}</div>
    </div>`
  ).join('')
  return `<div class="removed-findings-panel">
    <div class="removed-findings-header">❌ FALSE POSITIVES REMOVED (${removedFindings.length})</div>
    ${items}
  </div>`
}

function renderOpenAiTestLeftColumn(meta) {
  if (!meta || typeof meta !== 'object') {
    return '<p class="sbs-openai-summary-empty">No pipeline metadata returned.</p>'
  }
  const rows = []
  if (meta.error) {
    rows.push(`<li><strong>Error</strong>: ${escHtml(String(meta.error))}</li>`)
  }
  if (meta.model) rows.push(`<li><strong>Model</strong>: ${escHtml(String(meta.model))}${meta.cheapMode ? ' <em>(cheap mode)</em>' : ''}</li>`)
  if (meta.analysisPath) rows.push(`<li><strong>Request shape</strong>: ${escHtml(String(meta.analysisPath))}</li>`)
  if (meta.tenantFilesTotal != null) {
    rows.push(`<li><strong>Files in tenant folder</strong>: ${escHtml(String(meta.tenantFilesTotal))}</li>`)
  }
  if (Array.isArray(meta.nativePdfFiles)) {
    rows.push(`<li><strong>PDFs sent as <code>input_file</code></strong>: ${meta.nativePdfFiles.length}</li>`)
  }
  if (meta.apiCallsForOpenAI != null) {
    rows.push(`<li><strong>OpenAI API calls</strong>: ${escHtml(String(meta.apiCallsForOpenAI))}</li>`)
  }
  if (meta.pdfBatchesPlanned != null) {
    rows.push(`<li><strong>Batches planned</strong>: ${escHtml(String(meta.pdfBatchesPlanned))}</li>`)
  }
  if (Array.isArray(meta.split413Notes) && meta.split413Notes.length) {
    rows.push(`<li><strong>Size recovery</strong>: ${escHtml(meta.split413Notes.join(' '))}</li>`)
  }
  if (Array.isArray(meta.textDocsAppendedToEachBatch) && meta.textDocsAppendedToEachBatch.length) {
    rows.push(
      `<li><strong>Text blocks repeated each batch</strong>: ${escHtml(meta.textDocsAppendedToEachBatch.join(', '))}</li>`
    )
  }
  if (rows.length === 0 && meta.note) {
    rows.push(`<li>${escHtml(String(meta.note))}</li>`)
  }
  const explain = meta.explanation ? `<p class="sbs-openai-summary-explain">${escHtml(String(meta.explanation))}</p>` : ''
  return `<ul class="sbs-openai-summary-list">${rows.join('')}</ul>${explain}`
}

function renderSideBySide(data) {
  const mode = state.sbsMode || 'juice'
  const rightNoun = mode === 'doublecheck' ? 'reviewer pass' : 'learning'
  const raw    = data.raw    || {}
  const beefed = data.beefed || {}
  const rawF   = raw.findings    || []
  const beefedF = beefed.findings || []

  const verdictCta = document.getElementById('sbs-verdict-cta')
  if (verdictCta) {
    if (mode === 'openaitest') verdictCta.classList.add('hidden')
    else verdictCta.classList.remove('hidden')
  }
  // Show DC juice button only in doublecheck mode; hide in all others
  const dcJuiceBtn = document.getElementById('btn-dc-juice')
  if (dcJuiceBtn) {
    if (mode === 'doublecheck') dcJuiceBtn.classList.remove('hidden')
    else dcJuiceBtn.classList.add('hidden')
    dcJuiceBtn.disabled    = false
    dcJuiceBtn.textContent = '🧃 Juice this Review'
  }

  const debugPanel = document.getElementById('sbs-openai-debug')
  const debugPre = document.getElementById('sbs-openai-debug-pre')
  if (mode === 'openaitest' && data.openaiTestMeta) {
    debugPanel?.classList.remove('hidden')
    if (debugPre) debugPre.textContent = JSON.stringify(data.openaiTestMeta, null, 2)
  } else {
    debugPanel?.classList.add('hidden')
    if (debugPre) debugPre.textContent = ''
  }

  // Learnings bar
  const bar = document.getElementById('sbs-learnings-bar')
  if (mode === 'openaitest') {
    if (beefed.openaiSkipped) {
      bar.textContent =
        '⚠️ No OpenAI key — set OPENAI_API_KEY or openai.key on the server, then re-run.'
    } else if (beefed.openaiError || (data.openaiTestMeta && data.openaiTestMeta.error)) {
      bar.textContent =
        '⚠️ OpenAI Test Lab reported an error — see findings and pipeline summary; check server logs if needed.'
    } else {
      bar.textContent =
        '🤖 OpenAI Test Lab — left: pipeline summary; below: full debug JSON. Right: OpenAI findings. Claude is not called.'
    }
    bar.classList.remove('hidden')
  } else if (mode === 'modelcompare') {
    if (beefed.openaiSkipped) {
      bar.textContent =
        '⚠️ OpenAI not configured — Claude results on the left. Set OPENAI_API_KEY on the server (Railway Variables or .env) for the right column.'
    } else if (beefed.openaiError) {
      bar.textContent = '⚠️ OpenAI failed — see right column. Claude results on the left are still valid.'
    } else {
      bar.textContent = '⚔️ Model battle mode: left = Claude API, right = OpenAI API.'
    }
    bar.classList.remove('hidden')
  } else if (mode === 'doublecheck') {
    bar.textContent = '🧪 Reviewer pass runs as a separate confirmation analysis against the regular model.'
    bar.classList.remove('hidden')
  } else if (data.activeLearnings && data.activeLearnings.length > 0) {
    bar.textContent = `🧠 ${data.activeLearnings.length} active learning${data.activeLearnings.length !== 1 ? 's' : ''} applied to Beefed-Up Todd: ` +
      data.activeLearnings.map(l => l.checkType).join(' · ')
    bar.classList.remove('hidden')
  } else {
    bar.textContent = `⚠️ No active ${rightNoun}s — activate some in the Learnings panel to see the difference`
  }

  // Build sets for uniqueness highlighting
  const rawKeys    = new Set(rawF.map(f    => `${f.checkType}||${(f.missingDocument||'').toLowerCase().trim()}`))
  const beefedKeys = new Set(beefedF.map(f => `${f.checkType}||${(f.missingDocument||'').toLowerCase().trim()}`))

  if (mode === 'openaitest') {
    document.getElementById('sbs-raw-count').textContent = 'summary'
    document.getElementById('sbs-beefed-count').textContent =
      beefedF.length + ' finding' + (beefedF.length !== 1 ? 's' : '')
    document.getElementById('sbs-raw-findings').innerHTML = renderOpenAiTestLeftColumn(data.openaiTestMeta)
    const renderFindingsOai = (findings, otherKeys, isBeefed) => renderSbsFindings(findings, otherKeys, isBeefed)
    document.getElementById('sbs-beefed-findings').innerHTML = renderFindingsOai(beefedF, rawKeys, true)
    return
  }

  const renderFindings = (findings, otherKeys, isBeefed) => renderSbsFindings(findings, otherKeys, isBeefed)

  document.getElementById('sbs-raw-count').textContent =
    rawF.length + ' finding' + (rawF.length !== 1 ? 's' : '')

  // For doublecheck mode, include removed findings count in the header
  const removedF = (mode === 'doublecheck') ? (beefed.removedFindings || []) : []
  const added   = beefedF.filter(f => f.reviewStatus === 'ADDED').length
  const removed = removedF.length
  if (mode === 'doublecheck') {
    let summary = beefedF.length + ' finding' + (beefedF.length !== 1 ? 's' : '')
    if (added)   summary += ` · <span class="rc-added">${added} added</span>`
    if (removed) summary += ` · <span class="rc-removed">${removed} removed</span>`
    document.getElementById('sbs-beefed-count').innerHTML = summary
  } else {
    document.getElementById('sbs-beefed-count').textContent =
      beefedF.length + ' finding' + (beefedF.length !== 1 ? 's' : '')
  }

  document.getElementById('sbs-raw-findings').innerHTML    = renderFindings(rawF,    beefedKeys, false)
  document.getElementById('sbs-beefed-findings').innerHTML =
    renderFindings(beefedF, rawKeys, true) + renderRemovedFindings(removedF)
}

// ── Verdict text renderers ─────────────────────────────────

/**
 * Parse verdict plain-text into 8-bit styled HTML.
 * Section headers (ALL CAPS lines) get highlighted, bullets/actions get classes.
 */
function renderVerdictHtml(text) {
  const lines = String(text || '').split('\n')
  let html = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { html += '<div class="verdict-spacer"></div>'; continue }

    // Section header: all-caps words, may have colons/parens/dashes
    if (/^[A-Z][A-Z\s\-:()\/]+$/.test(trimmed) && trimmed.length >= 4 && !/^\d+\./.test(trimmed)) {
      html += `<div class="verdict-section-hdr">⬛ ${escHtml(trimmed)}</div>`
      continue
    }
    // Recommendation tags
    if (/^(KEEP|REVISE|DISCARD|PROMOTE|HOLD|CONFIDENT|NEEDS HUMAN REVIEW|LIKELY FALSE POSITIVE)[\s:—]/.test(trimmed)) {
      const tag = trimmed.match(/^(KEEP|REVISE|DISCARD|PROMOTE ALL|PROMOTE SOME|HOLD FOR MORE TESTING|DISCARD ALL|CONFIDENT|NEEDS HUMAN REVIEW|LIKELY FALSE POSITIVE)/)?.[1] || ''
      const cls = /KEEP|PROMOTE|CONFIDENT/.test(tag) ? 'verdict-tag--keep'
                : /REVISE|HOLD|NEEDS/.test(tag)      ? 'verdict-tag--revise'
                : 'verdict-tag--discard'
      html += `<div class="verdict-tag ${cls}">${escHtml(trimmed)}</div>`
      continue
    }
    // Bullet
    if (/^[-•*]\s/.test(trimmed)) {
      html += `<div class="verdict-bullet">${escHtml(trimmed)}</div>`
      continue
    }
    // Numbered list
    if (/^\d+[\.\)]\s/.test(trimmed)) {
      html += `<div class="verdict-numbered">${escHtml(trimmed)}</div>`
      continue
    }
    html += `<div class="verdict-line">${escHtml(line)}</div>`
  }
  return html
}

/**
 * Render TL;DR plain text — strip **bold** markdown, split into bullet lines.
 */
function renderTldrHtml(text) {
  const lines = String(text || '').split('\n')
  let html = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Strip markdown bold/italic
    const safe = escHtml(trimmed)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g,     '<em>$1</em>')
    // Section label (e.g. "WHAT’S GOOD:", "URGENCY LEVEL:")
    if (/^(WHAT’S|WHAT IS|URGENCY|WHAT TO DO)/i.test(trimmed) && trimmed.endsWith(':')) {
      html += `<div class="tldr-section">${safe}</div>`
    } else if (/^[-•*\d]/.test(trimmed) || trimmed.includes(':')) {
      html += `<div class="tldr-line">${safe}</div>`
    } else {
      html += `<div class="tldr-line">${safe}</div>`
    }
  }
  return html
}

// ── Dr. Verdict ────────────────────────────────────────────
document.getElementById('btn-run-verdict')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-verdict')
  const d   = state.sbsLastResult
  if (!d) { toast('No side-by-side results to evaluate', 'error'); return }

  btn.disabled    = true
  btn.textContent = '⏳ Evaluating...'
  document.getElementById('sbs-verdict-cta').classList.add('hidden')
  document.getElementById('sbs-verdict-loading').classList.remove('hidden')
  document.getElementById('sbs-verdict-report').classList.add('hidden')

  try {
    const res = await fetch(sameOriginApi('/api/sidebyside/verdict'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        rawResult:       d.raw,
        beefedResult:    d.beefed,
        activeLearnings: d.activeLearnings,
        tenantName:      d.tenantName,
        mode:            state.sbsMode || 'juice',
        ...cheapJsonExtra()
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Server error')

    document.getElementById('sbs-verdict-loading').classList.add('hidden')
    document.getElementById('sbs-verdict-text').innerHTML = renderVerdictHtml(data.verdict || '')
    document.getElementById('sbs-verdict-report').classList.remove('hidden')
    // Reset TL;DR + juice button each new verdict
    document.getElementById('verdict-tldr-wrap').classList.add('hidden')
    const tldrBtn = document.getElementById('btn-verdict-tldr')
    if (tldrBtn) { tldrBtn.disabled = false; tldrBtn.textContent = '⚡ TL;DR' }
    const juiceBtn = document.getElementById('btn-verdict-juice')
    if (juiceBtn) { juiceBtn.disabled = false; juiceBtn.textContent = '🧃 Send to Juice' }
    sfxReady()
    toast('Dr. Verdict complete', 'success')
  } catch (err) {
    document.getElementById('sbs-verdict-loading').classList.add('hidden')
    document.getElementById('sbs-verdict-cta').classList.remove('hidden')
    btn.disabled    = false
    btn.textContent = '🔬 Generate Verdict'
    toast('Verdict error: ' + err.message, 'error')
  }
})

document.getElementById('btn-copy-verdict')?.addEventListener('click', () => {
  const text = document.getElementById('sbs-verdict-text').innerText
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-verdict')
    btn.textContent = '✅ Copied!'
    setTimeout(() => { btn.textContent = '📋 Copy' }, 2000)
  }).catch(() => toast('Copy failed', 'error'))
})

// ── TL;DR button ──────────────────────────────────────────
document.getElementById('btn-verdict-tldr')?.addEventListener('click', async () => {
  const btn        = document.getElementById('btn-verdict-tldr')
  const reportText = document.getElementById('sbs-verdict-text').innerText
  const tenantName = state.sbsLastResult?.tenantName || ''
  if (!reportText) return

  btn.disabled    = true
  btn.textContent = '⏳...'

  try {
    const res  = await fetch(sameOriginApi('/api/drtoddhunt/tldr'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reportText, tenantName, ...cheapJsonExtra() })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'TL;DR failed')

    document.getElementById('verdict-tldr-text').innerHTML = renderTldrHtml(data.tldr || '')
    document.getElementById('verdict-tldr-wrap').classList.remove('hidden')
    btn.textContent = '⚡ TL;DR ✓'
  } catch (err) {
    toast('TL;DR error: ' + err.message, 'error')
    btn.disabled    = false
    btn.textContent = '⚡ TL;DR'
  }
})

// ── Send to Juice button ──────────────────────────────────
document.getElementById('btn-verdict-juice')?.addEventListener('click', async () => {
  const btn        = document.getElementById('btn-verdict-juice')
  const verdictText = document.getElementById('sbs-verdict-text').innerText
  const tenantName  = state.sbsLastResult?.tenantName || ''
  const mode        = state.sbsMode || 'juice'
  if (!verdictText) return

  btn.disabled    = true
  btn.textContent = '⏳...'

  try {
    // Use the verdict-specific extractor — understands IMPROVEMENTS/REGRESSIONS/RECOMMENDATION
    // sections and generates rules targeted at preventing mistakes or reinforcing wins
    const res = await fetch(sameOriginApi('/api/sidebyside/extract-learnings'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        verdictText,
        tenantName,
        mode,
        ...cheapJsonExtra()
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Extract failed')

    const count = data.learnings?.length || 0
    sfxJuice()
    btn.textContent = `🧃 ${count} rule${count !== 1 ? 's' : ''} juiced!`
    toast(`${count} prompt rule${count !== 1 ? 's' : ''} extracted and saved to Juice`, 'success')

    // Open juice modal so user can see + activate the new rules immediately
    setTimeout(() => openJuiceLearningsModal(), 400)
  } catch (err) {
    toast('Juice error: ' + err.message, 'error')
    btn.disabled    = false
    btn.textContent = '🧃 Send to Juice'
  }
})

// ── Juice from double-check review (structured data, not verdict text) ──
document.getElementById('btn-dc-juice')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-dc-juice')
  const d   = state.sbsLastResult
  if (!d || state.sbsMode !== 'doublecheck') {
    toast('No double-check results to juice', 'error')
    return
  }

  const beefedFindings  = d.beefed?.findings   || []
  const removedFindings = d.beefed?.removedFindings || []

  const added     = beefedFindings.filter(f => f.reviewStatus === 'ADDED').length
  const corrected = beefedFindings.filter(f => f.reviewStatus === 'CORRECTED').length
  const removed   = removedFindings.length

  if (added + corrected + removed === 0) {
    toast('Nothing to juice — reviewer confirmed everything, no misses or false positives found', 'info')
    return
  }

  btn.disabled    = true
  btn.textContent = '⏳ Juicing...'

  try {
    const res = await fetch(sameOriginApi('/api/doublecheck/extract-learnings'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        beefedFindings,
        removedFindings,
        rawFindings: d.raw?.findings || [],
        tenantName:  d.tenantName || '',
        ...cheapJsonExtra()
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Extract failed')

    const count = data.learnings?.length || 0
    sfxJuice()
    btn.textContent = `🧃 ${count} rule${count !== 1 ? 's' : ''} juiced!`
    toast(`${count} prompt rule${count !== 1 ? 's' : ''} extracted from QA review and saved to Juice`, 'success')

    // Open juice modal so user can see + activate immediately
    setTimeout(() => openJuiceLearningsModal(), 400)
  } catch (err) {
    toast('Juice error: ' + err.message, 'error')
    btn.disabled    = false
    btn.textContent = '🧃 Juice this Review'
  }
})

async function startHunt(testTenantId = null) {
  // Pre-hunt: warn about oversized files before executing
  const tenantsToCheck = testTenantId
    ? state.tenants.filter(t => t.id === testTenantId)
    : state.tenants
  const oversized = tenantsToCheck.flatMap(t =>
    (t.oversizedFiles || []).map(f => `• ${t.tenantName}: ${f}`)
  )
  if (oversized.length > 0) {
    const msg = `${oversized.length} file${oversized.length !== 1 ? 's' : ''} exceed 32MB.\nText extraction only — scanned pages may be missed.\n\n${oversized.join('\n')}\n\nContinue anyway?`
    if (!await pixelConfirm(msg, '⚠ LARGE FILES')) return
  }

  // If files are in local RAM (client-side extraction), use inline POST flow
  if (state.localFiles && state.localFiles.size > 0) {
    return startHuntLocal(testTenantId)
  }

  goTo('hunt')
  startArena()

  // Always hide cook button at start of hunt
  document.getElementById('cook-cta-wrap').classList.add('hidden')

  // In test mode, only show the selected tenant card
  const tenantsToShow = testTenantId
    ? state.tenants.filter(t => t.id === testTenantId)
    : state.tenants

  if (testTenantId) {
    const t = state.tenants.find(t => t.id === testTenantId)
    updateHuntSubtitle(`🎲 Test Mode — scanning: ${t?.tenantName || ''}`)
  }

  // Clear loading grid to avoid duplicate IDs before creating hunt cards
  document.getElementById('tenant-grid-loading').innerHTML = ''
  const huntGrid = document.getElementById('tenant-grid-hunt')
  huntGrid.innerHTML = ''
  tenantsToShow.forEach((t, i) => {
    huntGrid.appendChild(makeTenantCard(t, i))
  })

  // Show kill switch
  document.getElementById('btn-kill-hunt').classList.remove('hidden')

  // Pass only the active tenant IDs so server skips deleted ones
  const activeTenantIds = tenantsToShow.map(t => t.id).join(',')

  // Start SSE — pass accuracy mode (sequential=1, speed=parallel)
  const accuracyMode = document.getElementById('accuracy-toggle')?.checked !== false
  const base = `/api/hunt?sessionId=${encodeURIComponent(state.sessionId)}&concurrency=${accuracyMode ? 1 : 0}&tenantIds=${encodeURIComponent(activeTenantIds)}`
  const rel = (testTenantId ? `${base}&testTenantId=${encodeURIComponent(testTenantId)}` : base) + cheapQs() + juiceQs()
  const es = new EventSource(sameOriginApi(rel))
  state.eventSource = es
  sfxStartHuntLoop()

  es.addEventListener('hunt-start', e => {
    const d = JSON.parse(e.data)
    if (d.juiced && (d.activeLearningsApplied || 0) === 0) {
      toast(
        'Juice on but no rules activated — standard Todd this run. Turn ON in Gym → Results (Gym or Dr. Todd learnings).',
        'info'
      )
    } else if (d.juiced && (d.activeLearningsApplied || 0) > 0) {
      updateHuntSubtitle(`🧃 Juiced — ${d.activeLearningsApplied} rule${d.activeLearningsApplied !== 1 ? 's' : ''} (Gym / Dr. Todd)`)
    }
  })

  es.addEventListener('folder-start', e => {
    const d = JSON.parse(e.data)
    setCardActive(d.tenantId)
    setCardHunting(d.tenantId)
    updateHuntSubtitle(`🏹 Hunting: ${d.tenantName}`)
  })

  es.addEventListener('folder-progress', e => {
    const d = JSON.parse(e.data)
    const msg = document.getElementById(`pmsg-${d.tenantId}`)
    if (msg) msg.textContent = d.message || ''
  })

  es.addEventListener('folder-done', e => {
    const d = JSON.parse(e.data)
    state.findings.set(d.tenantId, d)
    setCardDone(d.tenantId, d)
    // Show cook button as soon as all expected tenants are done
    if (state.findings.size >= tenantsToShow.length) {
      document.getElementById('btn-kill-hunt').classList.add('hidden')
      showCookCta()
      updateHuntSubtitle(`🦁 Prey caught! ${tenantsToShow.length} tenant${tenantsToShow.length !== 1 ? 's' : ''} scanned.`)
    }
  })

  es.addEventListener('hunt-complete', () => {
    es.close()
    sfxStopBgLoop()
    document.getElementById('btn-kill-hunt').classList.add('hidden')
    sfxHuntComplete()
    showCookCta()
  })

  es.addEventListener('hunt-error', e => {
    const d = JSON.parse(e.data)
    es.close()
    sfxStopBgLoop()
    sfxError()
    toast('Hunt error: ' + d.error, 'error')
    // Still show cook button so user can get whatever results came in
    showCookCta()
  })

  es.onerror = () => {
    // SSE closed normally after hunt-complete — ignore
  }
}

/**
 * Local-file hunt: files are in RAM (state.localFiles), sent inline via POST /api/hunt/tenant.
 * Mirrors startHunt's card UI but driven by Promise resolution instead of SSE.
 */
async function startHuntLocal(testTenantId = null) {
  goTo('hunt')
  startArena()

  document.getElementById('cook-cta-wrap').classList.add('hidden')

  const tenantsToShow = testTenantId
    ? state.tenants.filter(t => t.id === testTenantId)
    : state.tenants

  if (testTenantId) {
    const t = state.tenants.find(t => t.id === testTenantId)
    updateHuntSubtitle(`🎲 Test Mode — scanning: ${t?.tenantName || ''}`)
  }

  document.getElementById('tenant-grid-loading').innerHTML = ''
  const huntGrid = document.getElementById('tenant-grid-hunt')
  huntGrid.innerHTML = ''
  tenantsToShow.forEach((t, i) => {
    huntGrid.appendChild(makeTenantCard(t, i))
  })

  document.getElementById('btn-kill-hunt').classList.remove('hidden')

  const useJuice = !!juiceToggle?.checked
  const cheap    = isCheapModeActive()

  // Fetch active learnings if juice is on
  let learnings = []
  if (useJuice) {
    try {
      const r = await fetch(sameOriginApi('/api/gym/learnings'))
      const list = await r.json()
      learnings = Array.isArray(list) ? list : []
      const activeCount = learnings.filter(l => l.active).length
      if (activeCount === 0) {
        toast('Juice on but no rules activated — standard Todd this run. Turn ON in Gym → Results.', 'info')
      } else {
        updateHuntSubtitle(`🧃 Juiced — ${activeCount} rule${activeCount !== 1 ? 's' : ''} (Gym / Dr. Todd)`)
      }
    } catch { /* non-critical */ }
  }

  sfxStartHuntLoop()

  // Concurrency: accuracy=1 sequential, speed=3 parallel
  // Capped at 3 (not 5) to avoid Railway 502s from simultaneous large requests
  const accuracyMode = document.getElementById('accuracy-toggle')?.checked !== false
  const CONCURRENCY  = accuracyMode ? 1 : Math.min(3, tenantsToShow.length)

  // Simple concurrent queue
  let aborted = false
  const killBtn = document.getElementById('btn-kill-hunt')
  const origKillHandler = killBtn?._localKillHandler
  if (killBtn) {
    killBtn._localKillHandler = () => { aborted = true }
    killBtn.addEventListener('click', killBtn._localKillHandler)
  }

  const queue   = [...tenantsToShow]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0 && !aborted) {
      const tenant = queue.shift()
      if (!tenant) continue
      await runLocalTenantAnalysis(tenant, tenantsToShow, useJuice, learnings, cheap)
    }
  })

  await Promise.allSettled(workers)

  if (killBtn && killBtn._localKillHandler) {
    killBtn.removeEventListener('click', killBtn._localKillHandler)
    delete killBtn._localKillHandler
  }

  sfxStopBgLoop()
  killBtn?.classList.add('hidden')

  if (!aborted) {
    sfxHuntComplete()
    showCookCta()
    updateHuntSubtitle(`🦁 Prey caught! ${tenantsToShow.length} tenant${tenantsToShow.length !== 1 ? 's' : ''} scanned.`)
  } else {
    showCookCta()
  }
}

/**
 * Analyze one tenant's files inline — convert ArrayBuffers to base64 and POST to /api/hunt/tenant.
 */
async function runLocalTenantAnalysis(tenant, tenantsToShow, useJuice, learnings, cheap) {
  setCardActive(tenant.id)
  setCardHunting(tenant.id)
  updateHuntSubtitle(`🏹 Hunting: ${tenant.tenantName}`)

  // Build file list from local RAM
  const files = (tenant.files || []).map(f => {
    const local = state.localFiles.get(f.relativePath)
    if (!local) return null
    return {
      name:   f.name,
      base64: arrayBufferToBase64(local.buffer),
      size:   local.size
    }
  }).filter(Boolean)

  // Build POST body once (files are large — don't re-serialize on every retry)
  const postBody = JSON.stringify({
    sessionId: state.sessionId,
    tenant: {
      id:         tenant.id,
      folderName: tenant.folderName,
      tenantName: tenant.tenantName,
      property:   tenant.property,
      suite:      tenant.suite
    },
    files,
    juiced:    useJuice,
    learnings: useJuice ? learnings : [],
    cheap
  })

  // Retry forever on gateway errors (502/503/504) — never give up on a tenant.
  // Only bail on genuine client/auth errors (400, 401, 403, 422, etc.)
  const GATEWAY_ERRORS = new Set([502, 503, 504, 429])
  const pmsg = document.getElementById(`pmsg-${tenant.id}`)

  try {
    let attempt = 0
    while (true) {
      attempt++

      if (attempt > 1) {
        // Exponential backoff capped at 30s: 5s, 10s, 20s, 30s, 30s, …
        const delay = Math.min(5000 * Math.pow(2, attempt - 2), 30000)
        if (pmsg) pmsg.textContent = `⏳ Retry ${attempt - 1} — waiting ${delay / 1000}s...`
        await new Promise(r => setTimeout(r, delay))
        if (pmsg) pmsg.textContent = `🔄 Retry ${attempt - 1} in progress...`
      }

      let res
      try {
        res = await fetch(sameOriginApi('/api/hunt/tenant'), {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    postBody
        })
      } catch (networkErr) {
        // Network-level failure (offline, ECONNRESET) — retry
        console.warn(`[hunt/local] ${tenant.tenantName} network error (attempt ${attempt}):`, networkErr.message)
        continue
      }

      if (!res.ok) {
        if (GATEWAY_ERRORS.has(res.status)) {
          // Transient server error — keep retrying
          console.warn(`[hunt/local] ${tenant.tenantName} got ${res.status} (attempt ${attempt}), retrying...`)
          continue
        }
        // Non-retriable error (400, 401, 413, 422 etc.)
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Server error ${res.status}`)
      }

      const data = await res.json()
      if (!data.result) throw new Error(data.error || 'Empty result from server')

      const result = data.result || {}
      const doneData = {
        tenantId:     tenant.id,
        findingCount: result.findings?.length || 0,
        allClear:     result.allClear || false,
        severity:     _localMaxSeverity(result.findings),
        ...result
      }
      state.findings.set(tenant.id, doneData)
      setCardDone(tenant.id, doneData)

      if (state.findings.size >= tenantsToShow.length) {
        document.getElementById('btn-kill-hunt').classList.add('hidden')
        showCookCta()
      }
      return  // success
    }

  } catch (err) {
    console.error(`[hunt/local] Permanent error on tenant ${tenant.tenantName}:`, err.message)
    const errData = {
      tenantId:     tenant.id,
      findingCount: 1,
      allClear:     false,
      severity:     'HIGH',
      error:        true,
      findings: [{
        checkType:       'LEGIBILITY',
        severity:        'HIGH',
        missingDocument: 'N/A',
        comment:         `Document analysis failed: ${err.message}`,
        evidence:        'Non-retriable error. Check file size/format and try again.'
      }]
    }
    state.findings.set(tenant.id, errData)
    setCardDone(tenant.id, errData)

    if (state.findings.size >= tenantsToShow.length) {
      document.getElementById('btn-kill-hunt').classList.add('hidden')
      showCookCta()
    }
  }
}

function _localMaxSeverity(findings) {
  if (!findings || findings.length === 0) return 'NONE'
  if (findings.some(f => f.severity === 'HIGH'))   return 'HIGH'
  if (findings.some(f => f.severity === 'MEDIUM')) return 'MEDIUM'
  return 'LOW'
}

async function startDrToddHunt(tenantId = null) {
  // If local files in RAM, push them to server before SSE opens
  if (state.localFiles?.size > 0 && tenantId) {
    await gymRegisterLocalFiles(tenantId)
  }

  // Reset the Dr. Todd screen UI
  for (let i = 1; i <= 3; i++) {
    const status = document.getElementById(`drtodd-status-${i}`)
    const fill   = document.getElementById(`drtodd-fill-${i}`)
    const msg    = document.getElementById(`drtodd-msg-${i}`)
    if (status) { status.textContent = 'Waiting...'; status.className = 'drtodd-run-status' }
    if (fill)   fill.style.width = '0%'
    if (msg)    msg.textContent = ''
  }
  document.getElementById('drtoddhunt-synthesis').classList.add('hidden')
  document.getElementById('drtoddhunt-report').classList.add('hidden')
  document.getElementById('drtoddhunt-report-text').textContent = ''
  document.getElementById('drtodd-tldr')?.classList.add('hidden')
  document.getElementById('drtodd-tldr-text').textContent = ''
  document.getElementById('drtoddhunt-cta').classList.add('hidden')
  const genBtn = document.getElementById('btn-generate-report')
  if (genBtn) { genBtn.disabled = false; genBtn.textContent = '📊 Generate Analysis Report' }
  document.getElementById('drtoddhunt-sub').textContent = 'Running 3 independent analyses...'

  goTo('drtoddhunt')

  let qs = `sessionId=${encodeURIComponent(state.sessionId)}`
  if (tenantId) qs += `&tenantId=${encodeURIComponent(tenantId)}`
  qs += cheapQs()
  const url = sameOriginApi(`/api/drtoddhunt?${qs}`)
  const es = new EventSource(url)
  state.eventSource = es
  sfxStartHuntLoop()

  es.addEventListener('drtoddhunt-start', e => {
    const d = JSON.parse(e.data)
    document.getElementById('drtoddhunt-sub').textContent =
      `Analyzing: ${d.tenantName} — 3 independent runs`
  })

  es.addEventListener('drtoddhunt-run-start', e => {
    const d = JSON.parse(e.data)
    const n = d.runNumber
    const status = document.getElementById(`drtodd-status-${n}`)
    if (status) { status.textContent = 'Running...'; status.className = 'drtodd-run-status running' }
    const msg = document.getElementById(`drtodd-msg-${n}`)
    if (msg) msg.textContent = 'Starting analysis...'
  })

  es.addEventListener('drtoddhunt-run-progress', e => {
    const d = JSON.parse(e.data)
    const n = d.runNumber
    const fill = document.getElementById(`drtodd-fill-${n}`)
    const msg  = document.getElementById(`drtodd-msg-${n}`)
    if (fill) fill.style.width = (d.percent || 0) + '%'
    if (msg)  msg.textContent  = d.message || ''
  })

  es.addEventListener('drtoddhunt-run-done', e => {
    const d = JSON.parse(e.data)
    const n = d.runNumber
    const status = document.getElementById(`drtodd-status-${n}`)
    const fill   = document.getElementById(`drtodd-fill-${n}`)
    const msg    = document.getElementById(`drtodd-msg-${n}`)
    if (fill) fill.style.width = '100%'
    if (d.error) {
      if (status) { status.textContent = 'Error'; status.className = 'drtodd-run-status error' }
      if (msg) msg.textContent = d.error
    } else {
      if (status) { status.textContent = d.allClear ? 'All Clear' : `${d.findingCount} finding${d.findingCount !== 1 ? 's' : ''}`; status.className = 'drtodd-run-status done' }
      if (msg) msg.textContent = ''
    }
  })

  es.addEventListener('drtoddhunt-runs-complete', e => {
    const d = JSON.parse(e.data)
    es.close()
    state.eventSource = null
    sfxStopBgLoop()
    const hint = d.errorCount > 0
      ? `${d.errorCount} run(s) had errors — report will use available data`
      : 'All 3 runs complete'
    sfxHuntComplete()
    document.getElementById('drtoddhunt-sub').textContent = hint
    document.getElementById('drtoddhunt-cta').classList.remove('hidden')
  })

  es.addEventListener('drtoddhunt-error', e => {
    const d = JSON.parse(e.data)
    es.close()
    state.eventSource = null
    sfxStopBgLoop()
    document.getElementById('drtoddhunt-synthesis').classList.add('hidden')
    document.getElementById('drtoddhunt-sub').textContent = 'Analysis encountered an error'
    // Still show the report button in case partial data was saved
    document.getElementById('drtoddhunt-cta').classList.remove('hidden')
    sfxError()
    toast('Dr. Todd error: ' + d.error, 'error')
  })

  es.onerror = () => { /* SSE closed normally — ignore */ }
}

function requestDrToddReport() {
  const btn = document.getElementById('btn-generate-report')
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...' }
  document.getElementById('drtoddhunt-cta').classList.add('hidden')
  document.getElementById('drtoddhunt-synthesis').classList.remove('hidden')
  document.getElementById('drtoddhunt-sub').textContent = 'Synthesizing findings across all 3 runs...'

  fetch(sameOriginApi('/api/drtoddhunt/synthesize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, ...cheapJsonExtra() })
  })
    .then(r => r.json())
    .then(d => {
      document.getElementById('drtoddhunt-synthesis').classList.add('hidden')
      if (d.error) {
        document.getElementById('drtoddhunt-sub').textContent = 'Report generation failed'
        document.getElementById('drtoddhunt-cta').classList.remove('hidden')
        if (btn) { btn.disabled = false; btn.textContent = '📊 Retry Report' }
        toast('Report error: ' + d.error, 'error')
        return
      }
      document.getElementById('drtoddhunt-sub').textContent = `Report ready — ${d.tenantName}`
      document.getElementById('drtoddhunt-report-text').textContent = d.report
      document.getElementById('drtoddhunt-report').classList.remove('hidden')
    })
    .catch(err => {
      document.getElementById('drtoddhunt-synthesis').classList.add('hidden')
      document.getElementById('drtoddhunt-cta').classList.remove('hidden')
      if (btn) { btn.disabled = false; btn.textContent = '📊 Retry Report' }
      toast('Network error: ' + err.message, 'error')
    })
}

function setCardActive(tenantId) {
  document.querySelectorAll('.tenant-card.active').forEach(c => c.classList.remove('active'))
  const card = document.getElementById(`card-${tenantId}`)
  if (card) card.classList.add('active')
}

function setCardHunting(tenantId) {
  const msg = document.getElementById(`pmsg-${tenantId}`)
  if (msg) msg.innerHTML = '<span class="hunting-pulse">🏹 Scanning...</span>'
  // Show the progress wrap for active card
  const wrap = msg?.closest('.card-progress-wrap')
  if (wrap) wrap.style.display = 'flex'
}

function setCardDone(tenantId, data) {
  const card = document.getElementById(`card-${tenantId}`)
  if (!card) return

  card.classList.remove('active')
  card.classList.add('done')
  card.classList.add(data.allClear ? 'done-clear' : 'done-issues')

  const fill = document.getElementById(`pfill-${tenantId}`)
  const msg  = document.getElementById(`pmsg-${tenantId}`)
  if (fill) fill.style.width = '100%'
  if (msg)  msg.textContent  = ''

  const resultDiv  = document.getElementById(`cresult-${tenantId}`)
  const resultText = document.getElementById(`cresult-text-${tenantId}`)
  if (resultDiv) resultDiv.classList.add(data.allClear ? 'clear' : 'issues')
  if (resultText) {
    if (data.allClear) {
      resultText.textContent = 'All Clear'
    } else {
      const sevLabel = data.severity || 'LOW'
      resultText.innerHTML = `${data.findingCount} issue${data.findingCount !== 1 ? 's' : ''} &nbsp;<span class="sev-pill sev-${sevLabel.toLowerCase()}">${sevLabel}</span>`
    }
  }

  // Add per-tenant download button
  const existingDlBtn = card.querySelector('.card-dl-btn')
  if (!existingDlBtn) {
    const dlBtn = document.createElement('button')
    dlBtn.className = 'card-dl-btn'
    dlBtn.textContent = '⬇ Download'
    dlBtn.title = 'Download findings for this tenant'
    dlBtn.addEventListener('click', async e => {
      e.stopPropagation()
      dlBtn.textContent = '⏳ Generating...'
      dlBtn.disabled = true
      try {
        const tenant = state.tenants.find(t => t.id === data.tenantId)
        const result = state.findings.get(data.tenantId)
        const resp = await fetch(sameOriginApi('/api/download/tenant'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant, result })
        })
        if (!resp.ok) throw new Error('Download failed')
        const blob = await resp.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `Todd Jr - ${tenant?.tenantName || 'Report'}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        toast('Download failed: ' + err.message, 'error')
      } finally {
        dlBtn.textContent = '⬇ Download'
        dlBtn.disabled = false
      }
    })
    card.appendChild(dlBtn)
  }
}


function updateHuntSubtitle(text) {
  const el = document.getElementById('hunt-subtitle')
  if (el) el.textContent = text
}

function showCookCta() {
  const wrap = document.getElementById('cook-cta-wrap')
  if (wrap) wrap.classList.remove('hidden')
  document.getElementById('btn-target-practice')?.classList.remove('hidden')
  // Trigger victory animation — all enemies die, Todd celebrates
  if (!arenaAnim.victory) {
    arenaAnim.victory = true
    arenaAnim.victoryCelebTick = 0
  }
}

// ═══════════════════════════════════════════════════════════
// COOK
// ═══════════════════════════════════════════════════════════

document.getElementById('btn-cook').addEventListener('click', startCook)
document.getElementById('btn-target-practice')?.addEventListener('click', startTargetPractice)

async function startCook() {
  stopArena()
  sfxStartCookLoop()
  goTo('cooking')

  // Fake progress animation while real API call happens
  const fill = document.getElementById('cook-bar-fill')
  let pct = 0
  const fakeProgress = setInterval(() => {
    pct = Math.min(90, pct + Math.random() * 8)
    if (fill) fill.style.width = pct + '%'
  }, 400)

  try {
    const res = await fetch(sameOriginApi('/api/cook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId })
    })

    const data = await res.json()
    clearInterval(fakeProgress)
    if (fill) fill.style.width = '100%'

    if (!res.ok) throw new Error(data.error || 'Cook failed')

    state.downloadUrl = data.downloadUrl ? toddApiUrl(data.downloadUrl) : null

    // Brief delay for satisfying animation
    await sleep(700)
    sfxStopBgLoop()
    sfxHuntComplete()
    goTo('report')
    buildReportScreen(data)

  } catch (err) {
    clearInterval(fakeProgress)
    sfxStopBgLoop()
    sfxError()
    toast('Cook failed: ' + err.message, 'error')
    goTo('hunt')
    showCookCta()
  }
}

// ═══════════════════════════════════════════════════════════
// REPORT SCREEN
// ═══════════════════════════════════════════════════════════

function buildReportScreen(data) {
  // Stats row
  const statsRow = document.getElementById('stats-row')
  const total       = state.tenants.length
  const allClearCnt = Array.from(state.findings.values()).filter(f => f.allClear).length
  const issuesCnt   = Array.from(state.findings.values()).filter(f => !f.allClear).length
  const totalIssues = data.findingCount || 0
  const highCnt = Array.from(state.findings.values()).filter(f => f.severity === 'HIGH').length

  statsRow.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Tenants Reviewed</span>
      <span class="stat-value blue">${total}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">All Clear</span>
      <span class="stat-value green">${allClearCnt}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">With Issues</span>
      <span class="stat-value amber">${issuesCnt}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total Findings</span>
      <span class="stat-value red">${totalIssues}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">High Severity</span>
      <span class="stat-value red">${highCnt}</span>
    </div>
  `

  // Build findings table
  buildFindingsTable()
}

function buildFindingsTable() {
  const wrap = document.getElementById('findings-table-wrap')

  // Build from findings Map using tenant order
  const rows = []
  for (const tenant of state.tenants) {
    const finding = state.findings.get(tenant.id)
    if (!finding) continue

    if (finding.allClear || finding.findingCount === 0) {
      rows.push({
        property: tenant.property,
        tenant:   tenant.tenantName,
        suite:    String(tenant.suite),
        doc:      'None',
        comment:  'All clear',
        sev:      'ok'
      })
    } else {
      // Placeholder rows — actual document names come from Excel
      const sevClass = (finding.severity || 'low').toLowerCase()
      rows.push({
        property: tenant.property,
        tenant:   tenant.tenantName,
        suite:    String(tenant.suite),
        doc:      `${finding.findingCount} issue${finding.findingCount !== 1 ? 's' : ''} found`,
        comment:  `Severity: ${finding.severity || 'LOW'} — see Excel report for full details`,
        sev:      sevClass
      })
    }
  }

  if (rows.length === 0) {
    wrap.innerHTML = '<p style="padding:20px;color:#94A3B8;font-size:13px">No results to display.</p>'
    return
  }

  wrap.innerHTML = `
    <table class="findings-table">
      <thead>
        <tr>
          <th>Property</th>
          <th>Tenant Name</th>
          <th>Suite</th>
          <th>Missing Document</th>
          <th>Comment / Status</th>
          <th>Severity</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="td-prop">${escHtml(r.property)}</td>
            <td class="td-name">${escHtml(r.tenant)}</td>
            <td class="td-suite">${escHtml(r.suite)}</td>
            <td class="td-doc">${escHtml(r.doc)}</td>
            <td class="td-comment">${escHtml(r.comment)}</td>
            <td class="td-sev"><span class="sev-pill sev-${r.sev}">${r.sev.toUpperCase()}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

// Download
document.getElementById('btn-download').addEventListener('click', () => {
  if (state.downloadUrl) {
    window.location.href = toddApiUrl(state.downloadUrl)
  } else {
    toast('No report available. Please cook first.', 'error')
  }
})

// Restart
document.getElementById('btn-restart').addEventListener('click', () => {
  if (state.eventSource) {
    state.eventSource.close()
    state.eventSource = null
  }
  stopArena()
  state.tenants      = []
  state.findings     = new Map()
  state.downloadUrl  = null
  state.sessionId    = crypto.randomUUID()
  state.localFiles   = new Map()
  state.localTenants = []

  document.getElementById('tenant-grid-loading').innerHTML = ''
  document.getElementById('tenant-grid-hunt').innerHTML    = ''
  document.getElementById('hunt-cta-wrap').classList.remove('ready')
  document.getElementById('cook-cta-wrap').classList.add('hidden')
  document.getElementById('upload-progress-fill').style.width = '0%'
  document.getElementById('cook-bar-fill').style.width = '0%'

  goTo('upload')
})

// ═══════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════

const toastEl = (() => {
  const el = document.createElement('div')
  el.id = 'toast'
  document.body.appendChild(el)
  return el
})()

let toastTimer = null
function toast(message, type = 'info') {
  toastEl.textContent  = message
  toastEl.className    = `show${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4000)
}

// ═══════════════════════════════════════════════════════════
// HUNT ARENA — continuous 8-bit battle animation
// ═══════════════════════════════════════════════════════════

// ── Sprite color palette ──────────────────────────────────
const N_ = null
const G = '#22C55E'; const Gd = '#15803D'
const Or = '#F97316'; const Br = '#92400E'; const BrD = '#78350F'
const Wh = '#FDE68A'; const Bl = '#1C1917'
const Rd = '#DC2626'; const Gy = '#6B7280'
const Pu = '#7C3AED'; const Pk = '#EC4899'
const Db = '#6B21A8'; const Lp = '#A855F7'
const Sk = '#E5E7EB'; const Cy = '#22D3EE'
const Yw = '#FACC15'; const Lm = '#84CC16'

// ── Enemy sprites ─────────────────────────────────────────

// 🐍 Snake (5×9)
const SNAKE_S = [[N_,G,G,N_,N_],[N_,G,Gd,G,N_],[N_,N_,G,Gd,G],[N_,N_,Gd,G,G],[G,Gd,G,N_,N_],[G,G,N_,N_,N_],[N_,G,Gd,G,N_],[N_,N_,G,Gd,N_],[N_,N_,G,N_,N_]]
const SNAKE_D = [[N_,G,G,N_,N_],[N_,Gy,Gy,Gy,N_],[N_,N_,Gy,Gy,Gy],[N_,N_,Gy,Gy,Gy],[Gy,Gy,Gy,N_,N_],[Gy,Gy,N_,N_,N_],[N_,Gy,Gy,Gy,N_],[N_,N_,Gy,Gy,N_],[N_,N_,Gy,N_,N_]]

// 🐯 Tiger (6×9)
const TIGER_S = [[N_,Or,Or,Or,Or,N_],[Or,Bl,Or,Or,Bl,Or],[Or,Or,Or,Or,Or,Or],[Wh,Wh,Or,Or,Wh,Wh],[N_,Bl,N_,N_,Bl,N_],[N_,Or,Or,Or,Or,N_],[N_,Or,N_,N_,Or,N_],[N_,Or,Or,Or,Or,N_],[N_,BrD,N_,N_,BrD,N_]]
const TIGER_D = [[N_,Gy,Gy,Gy,Gy,N_],[Gy,Bl,Gy,Gy,Bl,Gy],[Gy,Gy,Gy,Gy,Gy,Gy],[Gy,Gy,Gy,Gy,Gy,Gy],[N_,Rd,N_,N_,Rd,N_],[N_,Gy,Rd,Rd,Gy,N_],[N_,Gy,N_,N_,Gy,N_],[N_,Gy,Gy,Gy,Gy,N_],[N_,Gy,N_,N_,Gy,N_]]

// 🐻 Bear (7×9)
const BEAR_S = [[Br,N_,Br,N_,Br,N_,N_],[Br,Br,Br,Br,Br,Br,N_],[Br,Wh,Br,Br,Wh,Br,N_],[Br,Br,Rd,Br,Br,Br,N_],[N_,Br,Br,Br,Br,N_,N_],[N_,Br,BrD,BrD,Br,N_,N_],[N_,Br,N_,N_,Br,N_,N_],[N_,BrD,N_,N_,BrD,N_,N_],[N_,N_,N_,N_,N_,N_,N_]]
const BEAR_D = [[Gy,N_,Gy,N_,Gy,N_,N_],[Gy,Gy,Gy,Gy,Gy,Gy,N_],[Gy,Wh,Gy,Gy,Wh,Gy,N_],[Gy,Gy,Gy,Gy,Gy,Gy,N_],[N_,Rd,Gy,Gy,Rd,N_,N_],[N_,Gy,Rd,Rd,Gy,N_,N_],[N_,Gy,N_,N_,Gy,N_,N_],[N_,Gy,N_,N_,Gy,N_,N_],[N_,N_,N_,N_,N_,N_,N_]]

// 🦇 Bat (6×6)
const BAT_S = [[N_,Pu,N_,N_,Pu,N_],[Pu,Pu,Pk,Pk,Pu,Pu],[Pu,Pk,Pk,Pk,Pk,Pu],[N_,Pu,Pk,Pk,Pu,N_],[N_,N_,Pu,Pu,N_,N_],[N_,N_,N_,N_,N_,N_]]
const BAT_D  = [[N_,Gy,N_,N_,Gy,N_],[Gy,Gy,Gy,Gy,Gy,Gy],[Gy,Gy,Gy,Gy,Gy,Gy],[N_,Gy,Rd,Rd,Gy,N_],[N_,N_,Gy,Gy,N_,N_],[N_,N_,N_,N_,N_,N_]]

// 👺 Goblin (5×9)
const GOBLIN_S = [[N_,Lm,Lm,Lm,N_],[Lm,Lm,Gd,Lm,Lm],[N_,Bl,Lm,Bl,N_],[Lm,Gd,Lm,Gd,Lm],[N_,Lm,Lm,Lm,N_],[Rd,Lm,Lm,Lm,Rd],[N_,Lm,N_,Lm,N_],[N_,Lm,N_,Lm,N_],[N_,Br,N_,Br,N_]]
const GOBLIN_D = [[N_,Gy,Gy,Gy,N_],[Gy,Gy,Gy,Gy,Gy],[N_,Bl,Gy,Bl,N_],[Gy,Gy,Gy,Gy,Gy],[N_,Rd,Gy,Rd,N_],[N_,Gy,Gy,Gy,N_],[N_,Gy,N_,Gy,N_],[N_,Gy,N_,Gy,N_],[N_,Gy,N_,Gy,N_]]

// 💀 Skeleton (5×9)
const SKEL_S = [[N_,Sk,Sk,Sk,N_],[Sk,Bl,Sk,Bl,Sk],[Sk,Sk,Sk,Sk,Sk],[N_,Sk,Bl,Sk,N_],[Sk,Sk,Sk,Sk,Sk],[N_,Sk,N_,Sk,N_],[Sk,N_,N_,N_,Sk],[Sk,N_,N_,N_,Sk],[Bl,N_,N_,N_,Bl]]
const SKEL_D  = [[N_,Gy,Gy,Gy,N_],[Gy,Bl,Gy,Bl,Gy],[Gy,Gy,Gy,Gy,Gy],[N_,Gy,Bl,Gy,N_],[N_,Gy,N_,Gy,N_],[N_,Rd,N_,Rd,N_],[N_,N_,N_,N_,N_],[N_,N_,N_,N_,N_],[N_,N_,N_,N_,N_]]

// 🧙 Wizard (5×9)
const WIZ_S = [[N_,Db,Db,N_,N_],[N_,Db,Lp,Lp,N_],[Lp,Lp,Lp,Lp,Lp],[N_,Sk,Sk,Sk,N_],[N_,Bl,Sk,Bl,N_],[Lp,Lp,Lp,Lp,Lp],[Lp,Yw,Lp,Yw,Lp],[N_,Lp,N_,Lp,N_],[N_,Db,N_,Db,N_]]
const WIZ_D  = [[N_,Gy,Gy,N_,N_],[N_,Gy,Gy,Gy,N_],[Gy,Gy,Gy,Gy,Gy],[N_,Gy,Gy,Gy,N_],[N_,Bl,Gy,Bl,N_],[N_,Gy,Rd,Gy,N_],[N_,Gy,Gy,Gy,N_],[N_,Gy,N_,Gy,N_],[N_,Gy,N_,Gy,N_]]

// 🌊 Slime (6×6)
const SLIME_S = [[N_,Cy,Cy,Cy,Cy,N_],[Cy,Cy,Bl,Cy,Bl,Cy],[Cy,Cy,Cy,Cy,Cy,Cy],[Cy,Cy,Gd,Cy,Cy,Cy],[N_,Cy,Cy,Cy,Cy,N_],[N_,N_,Cy,Cy,N_,N_]]
const SLIME_D = [[N_,Gy,Gy,Gy,Gy,N_],[Gy,Gy,Bl,Gy,Bl,Gy],[Gy,Gy,Gy,Gy,Gy,Gy],[N_,Gy,Rd,Gy,Gy,N_],[N_,N_,Gy,Gy,N_,N_],[N_,N_,N_,N_,N_,N_]]

// ── Todd arena-specific attack frames (TPS=4) ─────────────
// Uses the same C.* color constants as main sprites

// AK2_ARN — mid-swing: sword at ~45° upper-right, right arm visible at shoulder
// Arm path: col10 shoulder → col10 neck → col9 head-level → guard col10 → blade
const AK2_ARN = [
  [_,_,_,_,_,_,_,_,_,_,_,_,C.W,_,_],   // blade tip col12
  [_,_,_,_,_,_,_,_,_,_,_,C.W,C.W,_,_], // blade 2px
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,C.G,C.W,_,_,_], // guard(gold) + blade
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.S,_,_,_,_,_], // SKIN HAND col9 (mid-swing, fist visible!)
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,C.A,_,_,_,_], // RIGHT ARM col10 at neck
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_,_], // body + RIGHT ARM at shoulder
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_], // LEFT hand only — right arm swinging
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_,_],   // left hand only
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

// AK3_ARN — follow-through: sword diagonal down-right after horizontal strike
const AK3_ARN = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,C.A,C.G,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,C.W,C.W,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,C.W,C.W],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,C.P,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,_,C.T,C.T,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,_,_,C.T,C.T,C.T,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

const ARENA_ATTACKS = [ATK1, AK2_ARN, ATK2, AK3_ARN]
const ARENA_TPS = 4
const ARENA_TODD_X = 8
const ARENA_TODD_REACH = ARENA_TODD_X + 14 * ARENA_TPS  // = 64px — sword hit zone

// ── Arena enemy roster ────────────────────────────────────
const ARENA_DEFS = [
  { s: SNAKE_S, d: SNAKE_D, w: 5, h: 9, speed: 1.0, ps: 3, fy: 0  },
  { s: BAT_S,   d: BAT_D,   w: 6, h: 6, speed: 1.5, ps: 3, fy: -14 },
  { s: TIGER_S, d: TIGER_D, w: 6, h: 9, speed: 1.2, ps: 3, fy: 0  },
  { s: BEAR_S,  d: BEAR_D,  w: 7, h: 9, speed: 0.8, ps: 3, fy: 0  },
  { s: GOBLIN_S,d: GOBLIN_D,w: 5, h: 9, speed: 1.4, ps: 3, fy: 0  },
  { s: SKEL_S,  d: SKEL_D,  w: 5, h: 9, speed: 1.1, ps: 3, fy: 0  },
  { s: WIZ_S,   d: WIZ_D,   w: 5, h: 9, speed: 1.3, ps: 3, fy: 0  },
  { s: SLIME_S, d: SLIME_D, w: 6, h: 6, speed: 0.6, ps: 3, fy: 3  },
]

// ── Arena state ────────────────────────────────────────────
let arenaRaf = null
const arenaAnim = {
  animals: [],         // [{ def, x, bob, bobDir, dying, deathTick, moveTick }]
  toddF:    0,         // 0-3 cycling through ARENA_ATTACKS
  toddTick: 0,
  spawnIn:  15,
  tick:     0,
  running:  false,
  victory:  false,     // set true when hunt completes
  victoryCelebTick: 0, // frames since victory triggered
}

// Draw a sprite at pixel-size ps
function drawSpriteAt(ctx, pixels, x, y, ps) {
  for (let ry = 0; ry < pixels.length; ry++) {
    const row = pixels[ry]
    for (let rx = 0; rx < row.length; rx++) {
      if (!row[rx]) continue
      ctx.fillStyle = row[rx]
      ctx.fillRect(x + rx * ps, y + ry * ps, ps, ps)
    }
  }
}

function drawArena() {
  const canvas = document.getElementById('arena-canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  const GY = H - 18          // ground line y (more room with H=120)
  const TPS = ARENA_TPS      // 4 — bigger Todd
  const TODD_X = ARENA_TODD_X
  const TODD_REACH = ARENA_TODD_REACH

  // Sky
  ctx.fillStyle = '#07091A'
  ctx.fillRect(0, 0, W, H)

  // Pixel grid
  ctx.fillStyle = '#0C1124'
  for (let x = 0; x < W; x += 12) ctx.fillRect(x, 0, 1, GY)
  for (let y = 0; y < GY; y += 12) ctx.fillRect(0, y, W, 1)

  // Twinkling stars
  const STAR_POS = [50,7,140,13,270,4,400,10,530,6,660,15,780,3,900,11,1020,8,1140,5]
  for (let i = 0; i < STAR_POS.length - 1; i += 2) {
    const sx = STAR_POS[i], sy = STAR_POS[i+1]
    if (sx >= W) continue
    ctx.fillStyle = Math.sin(arenaAnim.tick * 0.04 + i) > 0 ? '#FFFFFF' : '#1E3A5F'
    ctx.fillRect(sx, sy, 1, 1)
  }

  // Scrolling ground
  ctx.fillStyle = '#1E3A5F'
  ctx.fillRect(0, GY, W, 2)
  ctx.fillStyle = '#0F1B2D'
  ctx.fillRect(0, GY + 2, W, H - GY - 2)
  ctx.fillStyle = '#243B55'
  const gScroll = (arenaAnim.tick * 1.5) % 24
  for (let x = -(24 - gScroll % 24); x < W; x += 24) ctx.fillRect(Math.round(x), GY, 1, 2)

  // Status label — "HUNTING..." normally, "★ PREY CAUGHT! ★" on victory
  if (!arenaAnim.victory) {
    const dots = '.'.repeat((Math.floor(arenaAnim.tick / 18) % 4))
    const alpha = 0.6 + 0.4 * Math.sin(arenaAnim.tick * 0.05)
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#3B82F6'
    ctx.font = '8px "Press Start 2P", monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText('HUNTING' + dots, W / 2 - 40, 4)
    ctx.globalAlpha = 1
  }

  // Draw enemies
  for (const a of arenaAnim.animals) {
    const ax = Math.round(a.x)
    const ay = GY - a.def.h * a.def.ps + (a.def.fy || 0) + a.bob
    if (a.dying) {
      ctx.globalAlpha = Math.max(0, 1 - a.deathTick / 14)
      if (a.deathTick % 4 < 2) {
        ctx.fillStyle = '#FCD34D'
        ctx.fillRect(ax - 2, ay - 2, a.def.w * a.def.ps + 4, a.def.h * a.def.ps + 4)
      }
      drawSpriteAt(ctx, a.def.d, ax, ay, a.def.ps)
      ctx.globalAlpha = 1
    } else {
      drawSpriteAt(ctx, a.def.s, ax, ay, a.def.ps)
    }
  }

  // Draw Todd — victory pose or 4-frame attack cycle
  if (arenaAnim.victory) {
    const toddY = GY - VIC1.length * TPS
    drawSpriteAt(ctx, VIC1, TODD_X, toddY, TPS)

    // Sparkles orbiting Todd
    const t = arenaAnim.victoryCelebTick
    const sparkColors = ['#FCD34D','#F59E0B','#FFFFFF','#3B82F6','#22C55E','#EC4899','#F97316','#A855F7']
    const cx = TODD_X + 5 * TPS      // Todd center-ish x
    const cy = toddY + 8 * TPS       // Todd center-ish y
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + t * 0.09
      const r = 26 + 7 * Math.sin(t * 0.11 + i * 1.3)
      const sx = cx + Math.cos(angle) * r
      const sy = cy + Math.sin(angle) * r * 0.55
      ctx.fillStyle = sparkColors[i]
      const sz = Math.floor(t / 5) % 2 === 0 ? 3 : 2
      ctx.fillRect(Math.round(sx), Math.round(sy), sz, sz)
    }

    // "★ PREY CAUGHT! ★" text fading in
    const fadeIn = Math.min(1, arenaAnim.victoryCelebTick / 18)
    ctx.globalAlpha = fadeIn
    ctx.fillStyle = '#FCD34D'
    ctx.font = '8px "Press Start 2P", monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.fillText('\u2605 PREY CAUGHT! \u2605', W / 2, 4)
    ctx.textAlign = 'left'
    ctx.globalAlpha = 1
  } else {
    // Per-frame Y-bounce: Todd leans into the swing (-4px up on windup, +3px down on follow-through)
    const FRAME_BOB = [0, -4, 0, 3]
    const toddSprite = ARENA_ATTACKS[arenaAnim.toddF]
    const toddY = GY - toddSprite.length * TPS + FRAME_BOB[arenaAnim.toddF]
    drawSpriteAt(ctx, toddSprite, TODD_X, toddY, TPS)

    // Per-frame sword swing trail — makes animation visually obvious each frame
    const tf = arenaAnim.toddF
    const P = TPS  // 4px
    if (tf === 1) {
      // Mid-swing windup → diagonal: gold arc trailing from upper position
      ctx.globalAlpha = 0.6
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TODD_X + 10*P, toddY + 1*P, P, P)
      ctx.fillRect(TODD_X + 11*P, toddY + 2*P, P, P)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(TODD_X + 11*P, toddY + 1*P, P, P)
      ctx.globalAlpha = 1
    } else if (tf === 2) {
      // STRIKE FRAME: dramatic bright horizontal slash line
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(TODD_X + 11*P, toddY + 5*P, 7*P, 2)   // bright white slash
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TODD_X + 11*P, toddY + 5*P + 2, 6*P, 2) // gold shadow line
      ctx.fillRect(TODD_X + 11*P, toddY + 4*P, 3*P, 2)     // leading gold
      ctx.globalAlpha = 1
    } else if (tf === 3) {
      // Follow-through: downward diagonal trail
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TODD_X + 11*P, toddY + 7*P, P, P)
      ctx.fillRect(TODD_X + 12*P, toddY + 8*P, P, P)
      ctx.fillRect(TODD_X + 13*P, toddY + 9*P, P, P)
      ctx.globalAlpha = 1
    }

    // Sword slash impact effect when enemy is within strike range
    const close = arenaAnim.animals.some(a => !a.dying && a.x < TODD_REACH + 20)
    if (close && arenaAnim.tick % 6 < 3) {
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TODD_REACH - 2, GY - 20, 10, 3)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(TODD_REACH + 3, GY - 20, 5, 3)
    }
  }
}

function updateArena() {
  const a = arenaAnim
  a.tick++

  // Victory state — force-kill remaining enemies, no new spawns, no Todd update
  if (a.victory) {
    a.victoryCelebTick++
    for (const en of a.animals) {
      if (!en.dying) en.dying = true
      en.deathTick++
    }
    a.animals = a.animals.filter(en => en.deathTick < 20)
    return
  }

  // Todd 4-frame attack cycle (8 ticks per frame = ~8fps at 60fps raf)
  if (++a.toddTick >= 8) { a.toddTick = 0; a.toddF = (a.toddF + 1) % 4 }

  // Spawn enemies
  if (--a.spawnIn <= 0 && a.animals.filter(x => !x.dying).length < 7) {
    const def = ARENA_DEFS[Math.floor(Math.random() * ARENA_DEFS.length)]
    const canvas = document.getElementById('arena-canvas')
    const W = canvas ? canvas.width : 800
    a.animals.push({ def, x: W + def.w * def.ps, bob: 0, bobDir: 1, dying: false, deathTick: 0, moveTick: 0 })
    a.spawnIn = 20 + Math.floor(Math.random() * 40)
  }

  for (const en of a.animals) {
    if (en.dying) { en.deathTick++; continue }
    en.x -= en.def.speed
    en.moveTick++
    if (en.moveTick % 10 === 0) { en.bob += en.bobDir; if (en.bob >= 1 || en.bob <= 0) en.bobDir *= -1 }
    if (en.x <= ARENA_TODD_REACH + 4) { en.dying = true }
  }

  // Reap fully-faded dead enemies
  a.animals = a.animals.filter(en => !en.dying || en.deathTick < 16)
}

let arenaLoopId = null
function arenaLoop() {
  if (!arenaAnim.running) { arenaLoopId = null; return }
  updateArena()
  drawArena()
  arenaLoopId = requestAnimationFrame(arenaLoop)
}

function startArena() {
  const canvas = document.getElementById('arena-canvas')
  if (!canvas) return
  // Size canvas to its rendered width
  const w = canvas.parentElement?.getBoundingClientRect().width || 800
  canvas.width  = Math.round(w)
  canvas.height = 120
  arenaAnim.animals = []
  arenaAnim.tick = 0; arenaAnim.toddF = 0; arenaAnim.toddTick = 0; arenaAnim.spawnIn = 10
  arenaAnim.victory = false; arenaAnim.victoryCelebTick = 0
  arenaAnim.running = true
  if (!arenaLoopId) arenaLoopId = requestAnimationFrame(arenaLoop)
}

function stopArena() {
  arenaAnim.running = false
  if (arenaLoopId) { cancelAnimationFrame(arenaLoopId); arenaLoopId = null }
}

/** Full session reset (Home / Kill hunt) — tenants cleared, back to upload. */
function fullResetSession() {
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
  stopArena()
  gymReset()
  state.tenants      = []
  state.findings     = new Map()
  state.downloadUrl  = null
  state.sessionId    = crypto.randomUUID()
  state.localFiles   = new Map()
  state.localTenants = []
  animState.toddMode = 'idle'
  document.getElementById('btn-kill-hunt')?.classList.add('hidden')
  document.getElementById('cook-cta-wrap')?.classList.add('hidden')
  document.getElementById('btn-target-practice')?.classList.add('hidden')
  document.getElementById('tenant-grid-loading').innerHTML = ''
  document.getElementById('tenant-grid-hunt').innerHTML = ''
  document.getElementById('hunt-cta-wrap')?.classList.remove('ready')
  document.getElementById('upload-progress-fill').style.width = '0%'
}

function resetToHome() {
  fullResetSession()
  goTo('home')
  toast('Home — new session', 'info')
}

async function navigateGlobalBack() {
  switch (state.screen) {
    case 'home':
      break  // already at root — nothing to go back to
    case 'upload':
      // Back from hunter entry → return to game launcher
      goTo('home')
      return
    case 'rr':
      // Back from RR → return to game launcher
      goTo('home')
      return
    case 'loading':
      if (state.tenants.length === 0) {
        goTo('upload')
        return
      }
      if (!await pixelConfirm('Leave the folder list?\nYou\'ll start fresh from home.', '◀ LEAVE?')) return
      fullResetSession()
      goTo('upload')
      break
    case 'hunt':
      if (!await pixelConfirm('Stop the hunt and go\nback to your folder list?', '◀ STOP HUNT?')) return
      if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
      stopArena()
      animState.toddMode = 'idle'
      document.getElementById('btn-kill-hunt').classList.add('hidden')
      document.getElementById('cook-cta-wrap').classList.add('hidden')
      document.getElementById('tenant-grid-hunt').innerHTML = ''
      state.findings = new Map()
      goTo('loading')
      break
    case 'cooking':
      toast('Still cooking — use Home to cancel the whole session', 'info')
      break
    case 'report':
      goTo(state.tenants.length ? 'loading' : 'upload')
      break
    case 'drtoddhunt':
      if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
      goTo('loading')
      break
    case 'drtoddlab':
      goTo(state.tenants.length ? 'loading' : 'upload')
      break
    case 'gym':
      if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
      gymReset()
      goTo('loading')
      break
    case 'sidebyside':
      if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
      goTo(state.sbsSourceScreen || 'loading')
      break
    default:
      break
  }
}

btnGlobalHome?.addEventListener('click', async () => {
  if (state.screen === 'home') return  // already on launcher, nothing to do
  // If a hunt is actively running, warn before navigating away
  if (state.eventSource) {
    const ok = await pixelConfirm('A hunt is running.\nGo home anyway? (Hunt keeps going in background)', '⌂ GO HOME?')
    if (!ok) return
  }
  // Just navigate home — session stays intact, user can resume via Game 01
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
  sfxStopBgLoop()
  goTo('home')
})

btnGlobalBack?.addEventListener('click', () => navigateGlobalBack())

updateGlobalNav()

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Pixel juice box (home corner, next to Isaac) ────────────
const JUICE_EASTER_CANVAS = document.getElementById('juice-easter-canvas')
const JUICE_PS_E = 4
const JuC = {
  '.': null,
  b: '#0f172a',
  g: '#22c55e',
  l: '#86efac',
  y: '#eab308',
}
const JUICE_PIXELS = [
  'bbbbbbbb',
  'bggggggb',
  'bgllllgb',
  'bgllllgb',
  'bgygyyyb',
  'bggggggb',
  'bbbybbbb',
  'bbbbbbbb',
  'bbbbbbbb',
  'bbbbbbbb',
]
function drawJuiceEasterIcon() {
  if (!JUICE_EASTER_CANVAS) return
  const ctx = JUICE_EASTER_CANVAS.getContext('2d')
  ctx.clearRect(0, 0, JUICE_EASTER_CANVAS.width, JUICE_EASTER_CANVAS.height)
  for (let r = 0; r < JUICE_PIXELS.length; r++) {
    const row = JUICE_PIXELS[r]
    for (let c = 0; c < row.length; c++) {
      const col = JuC[row[c]]
      if (col) {
        ctx.fillStyle = col
        ctx.fillRect(c * JUICE_PS_E, r * JUICE_PS_E, JUICE_PS_E, JUICE_PS_E)
      }
    }
  }
}

// ── Initial draw ─────────────────────────────────────────────
drawFrame(HOME_TODD_CANVAS, IDLE1)
drawFrame(HERO_CANVAS,    IDLE1)
if (HUNT_JAR_CANVAS) drawFrame(HUNT_JAR_CANVAS, buildHuntJarComposite())
drawFrame(COOK_CANVAS,    ATK1)
drawFrame(REPORT_CANVAS,  VIC1)
drawJuiceEasterIcon()

// ═══════════════════════════════════════════════════════════
// GYM TEACHER MODE
// ═══════════════════════════════════════════════════════════

// ── PDF.js worker setup ────────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

// ── Running Todd sprites (headband 🏋️) ─────────────────────
const GYM_RUN1 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.R,C.R,C.R,C.R,C.R,C.R,_,_,_,_,_],  // red headband
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [C.A,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,_,_,C.P,_,_,_,_],  // left leg back, right forward
  [_,_,_,_,C.P,C.P,_,_,_,C.P,_,_,_,_,_],
  [_,_,_,_,C.P,C.P,_,_,C.P,_,_,_,_,_,_],
  [_,_,_,_,C.T,C.T,_,C.T,_,_,_,_,_,_,_],
  [_,_,_,C.T,C.T,C.T,C.T,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]
const GYM_RUN2 = [
  [_,_,_,_,_,C.H,C.H,C.H,C.H,_,_,_,_,_,_],
  [_,_,_,_,C.H,C.H,C.H,C.H,C.H,C.H,_,_,_,_,_],
  [_,_,_,_,C.R,C.R,C.R,C.R,C.R,C.R,_,_,_,_,_],  // red headband
  [_,_,_,_,C.S,C.S,C.E,C.S,C.E,C.S,C.S,_,_,_,_],
  [_,_,_,_,C.H,C.S,C.S,C.S,C.S,C.H,_,_,_,_,_],
  [_,_,_,_,C.S,C.S,C.M,C.M,C.S,C.S,_,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,_,_,_,_],
  [_,_,_,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,C.A,_,_],
  [_,_,C.A,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.B,C.A,_,_,_],
  [_,_,C.A,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,C.A,_,_,_],
  [_,_,_,C.S,C.B,C.B,C.B,C.B,C.B,C.B,C.S,_,_,_,_],
  [_,_,_,_,_,_,_,_,C.P,C.P,_,_,_,_,_],  // right leg back, left forward
  [_,_,_,_,_,_,_,C.P,C.P,_,_,_,_,_,_],
  [_,_,_,_,_,_,C.P,C.P,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.T,C.T,_,_,_,C.T,C.T,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,C.T,C.T,C.T,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
]

// ── Check type labels — mirror reporter.js ──────────────────
const CHECK_LABELS = {
  EXECUTION:         'Execution',
  EXHIBIT:           'Missing Exhibit',
  CURRENCY:          'Lease Currency',
  REFERENCED_DOC:    'Missing Document',
  AMENDMENT_GAP:     'Amendment Gap',
  MISSING_PAGE:      'Missing Pages',
  LEGIBILITY:        'Legibility',
  SPECIAL_AGREEMENT: 'Special Agreement',
  GUARANTY:          'Guaranty',
  NAME_MISMATCH:     'Name Mismatch',
}

// ── Gym state ──────────────────────────────────────────────
const gymState = {
  findings:         [],
  feedbacks:        {},   // findingId -> {verdict, comment}
  annotations:      [],   // [{docName, pageNum, comment, docIdx}]
  files:            [],
  tenantId:         null,
  tenantName:       '',
  folderName:       '',
  activeFindingId:  null,
  currentDocIdx:    0,
  currentPage:      1,
  totalPages:       0,
  pdfDoc:           null,
  pdfCache:         {},   // fileIndex -> PDFDocumentProxy  (prevents re-fetching)
  pdfPageLabels:    {},   // fileIndex -> string[]|null     (PDF printed page labels)
  annotating:       false,
  annoStart:        null,
  pendingAnno:      null, // {docIdx, pageNum}
  gymRunFrame:      0,
  gymRunTimer:      0,
  sweatDrops:       [],
  isTargetPractice: false,
}

// ── Target Practice session state ──────────────────────────
const targetSession = {
  active:              false,
  tenants:             [],
  currentIdx:          0,
  sessionId:           null,
  savedCount:          0,
  reviewerName:        '',
  juiceRules:          [],   // accumulated active learning rules
  correctionsByTenant: [],   // [8, 5, 3, 1, 0] — corrections per tenant for the graph
  loadedModelId:       null, // which juice model was loaded at session start
  loadedModelName:     null,
  synthesizing:        false, // true while synthesis call is in flight
  allTenantResults:    []    // accumulated per-tenant findings for session download
}

// ── Exercise Session state ─────────────────────────────────
const gymExSession = {
  active:       false,
  tenants:      [],   // all tenants queued for this session
  currentIdx:   0,    // which tenant we're on right now
  sessionId:    null, // groups all Isaac saves from this session
  savedCount:   0,
  reviewerName: ''    // who is running this session
}

async function startExerciseSession() {
  if (!state.tenants || state.tenants.length === 0) { toast('No tenants loaded', 'error'); return }
  const name = await pixelPrompt(
    `Who is reviewing this session?\nEnter your name to log the audit.`,
    '⚡ START SESSION',
    'e.g. Sarah M.'
  )
  if (name === null) return  // cancelled
  gymExSession.active       = true
  gymExSession.tenants      = [...state.tenants]
  gymExSession.currentIdx   = 0
  gymExSession.sessionId    = 'exsession-' + Date.now()
  gymExSession.savedCount   = 0
  gymExSession.reviewerName = name || 'Unknown'
  toast(`Session started — Reviewer: ${gymExSession.reviewerName}`, 'success')
  gymExStartTenant(0)
}

async function gymExStartTenant(idx) {
  const tenant = gymExSession.tenants[idx]
  if (!tenant) return
  const total = gymExSession.tenants.length
  gymReset()
  gymShowPanel('loading')
  gymExUpdateProgress()
  document.getElementById('gym-subtitle').textContent = `Session ${idx + 1}/${total}: ${tenant.tenantName}`
  document.getElementById('gym-progress-fill').style.width = '0%'
  document.getElementById('gym-loading-msg').textContent = 'Starting analysis...'

  // If files are local (not on Railway disk), push them to server first
  await gymRegisterLocalFiles(tenant.id)

  const url = sameOriginApi(
    `/api/gym/analyze?sessionId=${encodeURIComponent(state.sessionId)}&tenantId=${encodeURIComponent(tenant.id)}${cheapQs()}`
  )
  const es = new EventSource(url)
  state.eventSource = es
  es.addEventListener('gym-start', e => {
    const d = JSON.parse(e.data)
    document.getElementById('gym-subtitle').textContent = `[${idx + 1}/${total}] Analyzing: ${d.tenantName}`
  })
  es.addEventListener('gym-progress', e => {
    const d = JSON.parse(e.data)
    document.getElementById('gym-progress-fill').style.width = (d.percent || 0) + '%'
    document.getElementById('gym-loading-msg').textContent = d.message || ''
  })
  es.addEventListener('gym-complete', e => {
    es.close(); state.eventSource = null
    const d = JSON.parse(e.data)
    document.getElementById('gym-progress-fill').style.width = '100%'
    gymLaunchWorkout(d)
    gymExPlayDoneSound()
    gymExUpdateSaveButton()
    gymExUpdateProgress()
  })
  es.addEventListener('gym-error', e => {
    es.close(); state.eventSource = null
    const d = JSON.parse(e.data)
    toast('Gym error: ' + d.error, 'error')
    gymExSession.active = false
    gymShowPanel('picker')
  })
  es.onerror = () => {}
}

function gymExPlayDoneSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const playTone = (freq, start, dur, vol = 0.28) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(vol, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + dur + 0.05)
    }
    playTone(523, 0,    0.12)  // C5
    playTone(659, 0.13, 0.12)  // E5
    playTone(784, 0.26, 0.28)  // G5
  } catch { /* audio not available */ }
}

function gymExUpdateProgress() {
  const wrap  = document.getElementById('gym-ex-progress-wrap')
  const fill  = document.getElementById('gym-ex-progress-fill')
  const label = document.getElementById('gym-ex-progress-label')
  if (!wrap) return
  if (!gymExSession.active) { wrap.classList.add('hidden'); return }
  wrap.classList.remove('hidden')
  const total = gymExSession.tenants.length
  const pct   = total > 0 ? Math.round((gymExSession.savedCount / total) * 100) : 0
  if (fill)  fill.style.width = pct + '%'
  if (label) label.textContent = `Session: ${gymExSession.savedCount} of ${total} saved`
}

function gymExUpdateSaveButton() {
  const saveBtn   = document.getElementById('gym-save-isaac-btn')
  const exSaveBtn = document.getElementById('gym-ex-save-next-btn')
  if (!gymExSession.active) {
    saveBtn?.classList.remove('hidden')
    exSaveBtn?.classList.add('hidden')
    return
  }
  saveBtn?.classList.add('hidden')
  exSaveBtn?.classList.remove('hidden')
  const isLast = gymExSession.currentIdx >= gymExSession.tenants.length - 1
  if (exSaveBtn) exSaveBtn.textContent = isLast ? '💾 Save & Finish Session' : '💾 Save & Next Tenant ›'
}

async function gymExSaveAndNext() {
  const btn = document.getElementById('gym-ex-save-next-btn')
  if (btn) btn.disabled = true
  try {
    const _isaacLocalFiles = buildIsaacLocalFiles(gymState.tenantId)
    const payload = {
      tenantName:      gymState.tenantName,
      folderName:      gymState.folderName,
      findings:        gymFindingsForIsaacPayload(),
      feedbacks:       gymFeedbacksArray(),
      annotations:     gymAnnotationsForIsaacExcel(),
      sessionId:       gymExSession.sessionId,
      sessionIdx:      gymExSession.currentIdx,
      sessionTotal:    gymExSession.tenants.length,
      reviewerName:    gymExSession.reviewerName,
      uploadSessionId: state.sessionId,
      tenantId:        gymState.tenantId,
      ...(_isaacLocalFiles ? { localFiles: _isaacLocalFiles } : {})
    }
    const res = await fetch(sameOriginApi('/api/gym/save-for-isaac'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) { const raw = await res.text(); throw new Error(raw.slice(0, 200)) }
    gymExSession.savedCount++
    gymExSession.currentIdx++
    const isLast = gymExSession.currentIdx >= gymExSession.tenants.length
    if (isLast) {
      gymExSession.active = false
      toast(`Session complete! ${gymExSession.savedCount} tenant${gymExSession.savedCount !== 1 ? 's' : ''} saved to Isaac ✓`, 'success')
      gymOpenPicker()
    } else {
      toast(`Saved ✓ — loading next tenant...`, 'success')
      gymExStartTenant(gymExSession.currentIdx)
    }
  } catch (e) {
    toast(e.message || 'Could not save', 'error')
    if (btn) btn.disabled = false
  }
}

// ═══════════════════════════════════════════════════════════
// TODD TARGET PRACTICE — review completed hunt findings
// ═══════════════════════════════════════════════════════════

async function startTargetPractice() {
  if (state.tenants.length === 0) { toast('Upload files first', 'error'); return }

  // Show setup screen IMMEDIATELY — don't wait for network
  // Models list will populate in the background
  const setup = await showTargetSetupScreen(null)   // null = loading state
  if (!setup) return   // user cancelled

  const { reviewerName, loadedModel } = setup

  // Reset juice in session, optionally load model rules
  await fetch(sameOriginApi('/api/target/reset-juice'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId })
  })
  if (loadedModel?.id) {
    try {
      const fullRes   = await fetch(sameOriginApi(`/api/target/models/${loadedModel.id}`))
      const fullModel = fullRes.ok ? await fullRes.json() : null
      if (fullModel?.rules?.length > 0) {
        await fetch(sameOriginApi('/api/target/load-model'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.sessionId, rules: fullModel.rules, modelId: loadedModel.id, modelName: loadedModel.name })
        })
        targetSession.juiceRules      = fullModel.rules
        targetSession.loadedModelId   = loadedModel.id
        targetSession.loadedModelName = loadedModel.name
        toast(`🧠 Loaded: ${loadedModel.name} (${fullModel.rules.length} rules)`, 'info')
      }
    } catch { /* fail silently */ }
  } else {
    targetSession.juiceRules      = []
    targetSession.loadedModelId   = null
    targetSession.loadedModelName = null
  }

  targetSession.active              = true
  targetSession.tenants             = [...state.tenants]
  targetSession.currentIdx          = 0
  targetSession.sessionId           = 'target-' + Date.now()
  targetSession.savedCount          = 0
  targetSession.reviewerName        = reviewerName || 'Unknown'
  targetSession.correctionsByTenant = []
  targetSession.allTenantResults    = []

  gymState.mode = 'target'
  goTo('gym')
  gymReset()
  gymState.isTargetPractice = true
  gymShowPanel('loading')
  await targetStartTenant(0)
}

/**
 * Show the Target Practice setup screen immediately, then load models async.
 * Returns { reviewerName, loadedModel } or null if cancelled.
 */
function showTargetSetupScreen() {
  return new Promise(resolve => {
    const overlay     = document.getElementById('target-setup-overlay')
    const reviewerIn  = document.getElementById('tso-reviewer-input')
    const startBtn    = document.getElementById('tso-start-btn')
    const cancelBtn   = document.getElementById('tso-cancel-btn')
    const juiceBtn    = document.getElementById('tso-juice-btn')
    const juiceStatus = document.getElementById('tso-juice-status')
    const jlibOverlay = document.getElementById('juice-library-overlay')
    const jlibList    = document.getElementById('jlib-list')
    const jlibClose   = document.getElementById('jlib-close-btn')
    const juiceCanvas = document.getElementById('tso-juicebox-canvas')

    if (!overlay || !reviewerIn || !startBtn || !cancelBtn) {
      pixelPrompt('Who is reviewing these findings?', '🎯 START TARGET PRACTICE', 'e.g. Sarah M.')
        .then(name => resolve(name ? { reviewerName: name, loadedModel: null } : null))
      return
    }

    // Draw 8-bit juice box
    drawJuiceBox(juiceCanvas)

    let selectedModel = null
    let savedModels   = []

    // Reset state
    reviewerIn.value = ''
    reviewerIn.style.borderColor = ''
    if (juiceStatus) juiceStatus.innerHTML = '<span class="tso-juice-none">⚡ NONE — FRESH START</span>'

    // Show immediately
    overlay.classList.remove('hidden')
    setTimeout(() => reviewerIn.focus(), 80)

    // Fetch saved models in background
    fetch(sameOriginApi('/api/target/models'))
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
      .then(models => { savedModels = models })

    // Open juice library
    function openLibrary() {
      if (!jlibOverlay || !jlibList) return
      if (!savedModels.length) {
        jlibList.innerHTML = '<div class="jlib-empty">No juice models saved yet.<br>Complete a session and save juice<br>to build your library.</div>'
      } else {
        jlibList.innerHTML = savedModels.map(m => {
          const score    = m.errorReduction != null ? `${m.errorReduction}% better` : ''
          const tenants  = m.tenantCount ? `${m.tenantCount} tenants` : ''
          const reviewer = m.reviewerName || ''
          const isActive = selectedModel && selectedModel.id === m.id
          return `<div class="jlib-card${isActive ? ' selected' : ''}" data-id="${m.id}" data-name="${escHtml(m.name)}">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
              <span class="jlib-card-name">🧠 ${escHtml(m.name)}</span>
              ${score ? `<span class="jlib-card-score">${escHtml(score)}</span>` : ''}
            </div>
            ${(reviewer || tenants) ? `<div class="jlib-card-meta">${[reviewer, tenants].filter(Boolean).map(escHtml).join(' · ')}</div>` : ''}
            ${m.comment ? `<div class="jlib-card-comment">"${escHtml(m.comment)}"</div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px">
              <button class="jlib-view-btn" data-id="${m.id}" data-name="${escHtml(m.name)}" style="font-family:var(--font-pixel);font-size:7px;background:none;border:1px solid #334155;color:#64748b;padding:4px 8px;cursor:pointer;letter-spacing:0.4px">👁 VIEW DETAILS</button>
              <button class="jlib-use-btn" data-id="${m.id}" data-name="${escHtml(m.name)}" style="font-family:var(--font-pixel);font-size:7px;background:#14532d;border:1px solid #16a34a;color:#86efac;padding:4px 8px;cursor:pointer;letter-spacing:0.4px">USE ▶</button>
            </div>
          </div>`
        }).join('')
        jlibList.querySelectorAll('.jlib-use-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation()
            selectedModel = { id: btn.dataset.id, name: btn.dataset.name }
            if (juiceStatus) juiceStatus.innerHTML = `<span class="tso-juice-selected">🧠 ${escHtml(btn.dataset.name)}</span>`
            jlibOverlay.classList.add('hidden')
          })
        })
        jlibList.querySelectorAll('.jlib-view-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation()
            openModelDetail(btn.dataset.id, btn.dataset.name, (chosen) => {
              if (chosen) {
                selectedModel = chosen
                if (juiceStatus) juiceStatus.innerHTML = `<span class="tso-juice-selected">🧠 ${escHtml(chosen.name)}</span>`
                jlibOverlay.classList.add('hidden')
              }
            })
          })
        })
      }
      jlibOverlay.classList.remove('hidden')
    }

    juiceBtn   && juiceBtn.addEventListener('click', openLibrary)
    jlibClose  && jlibClose.addEventListener('click', () => jlibOverlay && jlibOverlay.classList.add('hidden'))

    function cleanup(result) {
      overlay.classList.add('hidden')
      jlibOverlay && jlibOverlay.classList.add('hidden')
      startBtn.removeEventListener('click', onStart)
      cancelBtn.removeEventListener('click', onCancel)
      juiceBtn  && juiceBtn.removeEventListener('click', openLibrary)
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }
    function onStart() {
      const name = reviewerIn.value.trim()
      if (!name) { reviewerIn.focus(); reviewerIn.style.borderColor = '#ef4444'; return }
      reviewerIn.style.borderColor = ''
      cleanup({ reviewerName: name, loadedModel: selectedModel })
    }
    function onCancel() { cleanup(null) }
    function onKey(e) {
      if (e.key === 'Enter' && document.activeElement !== startBtn) { onStart(); e.preventDefault() }
      if (e.key === 'Escape') {
        if (jlibOverlay && !jlibOverlay.classList.contains('hidden')) {
          jlibOverlay.classList.add('hidden'); e.preventDefault(); return
        }
        onCancel(); e.preventDefault()
      }
    }
    startBtn.addEventListener('click', onStart)
    cancelBtn.addEventListener('click', onCancel)
    document.addEventListener('keydown', onKey)
  })
}

/** Draw 8-bit bullseye target on a 40×52 canvas */
function drawJuiceBox(canvas) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const S = 4  // px per pixel-art pixel
  // 10 cols × 13 rows — bullseye centered in rows 1–11
  const T = null
  const g = [
    //  0    1    2    3    4    5    6    7    8    9
    [  T,   T,   T,   T,   T,   T,   T,   T,   T,   T],  // 0 pad
    [  T,   T,  'D', 'D', 'D', 'D', 'D', 'D',  T,   T],  // 1 top arc
    [  T,  'D', 'R', 'R', 'R', 'R', 'R', 'R', 'D',  T],  // 2 red ring
    [ 'D', 'R', 'R', 'W', 'W', 'W', 'W', 'R', 'R', 'D'], // 3 white ring
    [ 'D', 'R', 'W', 'W', 'W', 'W', 'W', 'W', 'R', 'D'], // 4 white
    [ 'D', 'R', 'W', 'W', 'C', 'C', 'W', 'W', 'R', 'D'], // 5 center
    [ 'D', 'R', 'W', 'W', 'C', 'C', 'W', 'W', 'R', 'D'], // 6 center
    [ 'D', 'R', 'W', 'W', 'W', 'W', 'W', 'W', 'R', 'D'], // 7 white
    [ 'D', 'R', 'R', 'W', 'W', 'W', 'W', 'R', 'R', 'D'], // 8 white ring
    [  T,  'D', 'R', 'R', 'R', 'R', 'R', 'R', 'D',  T],  // 9 red ring
    [  T,   T,  'D', 'D', 'D', 'D', 'D', 'D',  T,   T],  // 10 bottom arc
    [  T,   T,   T,   T,   T,   T,   T,   T,   T,   T],  // 11 pad
    [  T,   T,   T,   T,   T,   T,   T,   T,   T,   T],  // 12 pad
  ]
  const colorMap = {
    D: '#1e293b',  // dark outline
    R: '#dc2626',  // red ring
    W: '#f8fafc',  // white ring
    C: '#991b1b',  // dark red bullseye center
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let row = 0; row < g.length; row++) {
    for (let col = 0; col < g[row].length; col++) {
      const c = g[row][col]
      if (!c || !colorMap[c]) continue
      ctx.fillStyle = colorMap[c]
      ctx.fillRect(col * S, row * S, S, S)
    }
  }
}

// Show a pixel-style modal to pick a juice model or start fresh
function showJuiceModelPicker(models) {
  return new Promise(resolve => {
    const overlay = document.getElementById('target-model-picker-overlay')
    const list    = document.getElementById('target-model-picker-list')
    if (!overlay || !list) { resolve(null); return }

    list.innerHTML = models.map(m => {
      const score = m.errorReduction != null ? `${m.errorReduction}% error reduction` : ''
      const tenants = m.tenantCount ? `${m.tenantCount} tenants` : ''
      const parent = m.parentModelName ? `↳ built on ${m.parentModelName}` : ''
      return `<button class="juice-model-pick-btn" data-id="${m.id}" data-name="${escHtml(m.name)}">
        <span class="jmp-name">${escHtml(m.name)}</span>
        <span class="jmp-meta">${[score, tenants, m.reviewerName].filter(Boolean).join(' · ')}</span>
        ${m.comment ? `<span class="jmp-comment">"${escHtml(m.comment)}"</span>` : ''}
        ${parent ? `<span class="jmp-parent">${escHtml(parent)}</span>` : ''}
      </button>`
    }).join('')

    overlay.classList.remove('hidden')

    const cleanup = () => overlay.classList.add('hidden')

    overlay.querySelectorAll('.juice-model-pick-btn').forEach(btn => {
      btn.onclick = () => { cleanup(); resolve({ id: btn.dataset.id, name: btn.dataset.name }) }
    })
    document.getElementById('target-model-fresh-btn').onclick = () => { cleanup(); resolve(null) }
    document.getElementById('target-model-cancel-btn').onclick = () => { cleanup(); resolve(false) }
  })
}

/**
 * Open the model detail overlay for a given juice model id.
 * onSelect(chosen) is called with { id, name } if the user clicks "USE THIS JUICE".
 */
function openModelDetail(modelId, modelName, onSelect) {
  const overlay   = document.getElementById('model-detail-overlay')
  const titleEl   = document.getElementById('mdl-title')
  const bodyEl    = document.getElementById('mdl-body')
  const backBtn   = document.getElementById('mdl-back-btn')
  const selectBtn = document.getElementById('mdl-select-this-btn')
  if (!overlay || !bodyEl) return

  titleEl.textContent = modelName || 'MODEL DETAILS'
  bodyEl.innerHTML = '<div style="font-family:var(--font-pixel);font-size:8px;color:#475569;padding:20px 0;text-align:center">LOADING...</div>'
  overlay.classList.remove('hidden')

  function close() {
    overlay.classList.add('hidden')
    backBtn.removeEventListener('click', close)
    selectBtn.removeEventListener('click', onUse)
  }
  function onUse() {
    close()
    onSelect && onSelect({ id: modelId, name: modelName })
  }

  backBtn.addEventListener('click', close)
  selectBtn.addEventListener('click', onUse)

  // Fetch full model
  fetch(sameOriginApi(`/api/target/models/${modelId}`))
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
    .then(m => {
      if (!m) {
        bodyEl.innerHTML = '<div style="font-family:var(--font-pixel);font-size:8px;color:#ef4444;padding:20px;text-align:center">Failed to load model data.</div>'
        return
      }

      const savedDate  = m.savedAt ? new Date(m.savedAt).toLocaleDateString() : '—'
      const reduction  = m.errorReduction ?? 0
      const barWidth   = Math.max(2, Math.min(100, reduction))
      const rules      = m.rules || []
      const avoidFP    = rules.filter(r => r.type === 'AVOID_FALSE_POSITIVE').length
      const improve    = rules.filter(r => r.type !== 'AVOID_FALSE_POSITIVE').length

      // Correction curve sparkline
      const curve = m.correctionsByTenant || []

      let html = `
        <div class="mdl-meta-row">
          <span class="mdl-meta-chip">👤 ${escHtml(m.reviewerName || '—')}</span>
          <span class="mdl-meta-chip">📅 ${escHtml(savedDate)}</span>
          <span class="mdl-meta-chip">🏢 ${m.tenantCount || 0} tenants</span>
          <span class="mdl-meta-chip">🧠 ${rules.length} rules</span>
          ${m.parentModelName ? `<span class="mdl-meta-chip">↳ built on ${escHtml(m.parentModelName)}</span>` : ''}
        </div>
        ${m.comment ? `<div class="mdl-comment">"${escHtml(m.comment)}"</div>` : ''}

        <div>
          <div class="mdl-section-title">PERFORMANCE</div>
          <div class="mdl-perf-bar-wrap">
            <div class="mdl-perf-bar-fill" style="width:${barWidth}%"></div>
          </div>
          <div class="mdl-perf-label">${reduction}% error reduction</div>
          <div class="mdl-perf-sub">${avoidFP} false-positive blocks · ${improve} detection improvements</div>
        </div>`

      if (curve.length > 1) {
        html += `
        <div>
          <div class="mdl-section-title">CORRECTION CURVE — errors flagged per tenant</div>
          <div class="mdl-sparkline-wrap">
            <canvas id="mdl-spark-canvas" width="504" height="48" style="width:100%;height:48px;image-rendering:pixelated;display:block"></canvas>
          </div>
          <div style="font-family:var(--font-pixel);font-size:7px;color:#475569;margin-top:4px">Tenant 1 → Tenant ${curve.length} — lower is better</div>
        </div>`
      }

      if (rules.length === 0) {
        html += `<div style="font-family:var(--font-pixel);font-size:8px;color:#475569;padding:10px 0">No rules stored in this model.</div>`
      } else {
        html += `<div><div class="mdl-section-title">RULES (${rules.length})</div>`
        rules.forEach(r => {
          const isAvoid = r.type === 'AVOID_FALSE_POSITIVE'
          const typeLabel = isAvoid ? 'AVOID FALSE POS' : 'IMPROVE DETECT'
          const typeClass = isAvoid ? 'avoid' : 'improve'
          const conf = r.confidence ? `⬆ ${r.confidence}x` : ''
          html += `
          <div class="mdl-rule">
            <div class="mdl-rule-badges">
              <span class="mdl-rule-type ${typeClass}">${typeLabel}</span>
              <span class="mdl-rule-checktype">${escHtml(r.checkType || '—')}</span>
              ${conf ? `<span class="mdl-rule-conf">${conf}</span>` : ''}
            </div>
            <div class="mdl-rule-text">${escHtml(r.rule || '')}</div>
            ${r.triggeredBy ? `<div class="mdl-rule-trigger">↳ ${escHtml(r.triggeredBy)}</div>` : ''}
          </div>`
        })
        html += `</div>`
      }

      bodyEl.innerHTML = html

      // Draw sparkline if curve exists
      if (curve.length > 1) {
        const spark = document.getElementById('mdl-spark-canvas')
        if (spark) {
          const ctx = spark.getContext('2d')
          const W = spark.width, H = spark.height
          const max = Math.max(...curve, 1)
          const barW = Math.floor(W / curve.length)
          ctx.clearRect(0, 0, W, H)
          curve.forEach((val, i) => {
            const barH = Math.max(2, Math.round((val / max) * (H - 8)))
            const x = i * barW
            const y = H - barH
            // Color: starts red, trends green as corrections drop
            const ratio = curve.length > 1 ? i / (curve.length - 1) : 1
            const r2 = Math.round(239 - ratio * (239 - 74))
            const g2 = Math.round(68  + ratio * (222 - 68))
            const b2 = Math.round(68  + ratio * (128 - 68))
            ctx.fillStyle = `rgb(${r2},${g2},${b2})`
            ctx.fillRect(x, y, Math.max(1, barW - 1), barH)
            // Value label
            if (val > 0) {
              ctx.fillStyle = '#94a3b8'
              ctx.font = '8px monospace'
              ctx.textAlign = 'center'
              ctx.fillText(val, x + barW / 2, y - 2)
            }
          })
        }
      }
    })
}

async function targetStartTenant(idx) {
  const tenant = targetSession.tenants[idx]
  if (!tenant) return
  const total = targetSession.tenants.length

  gymReset()
  gymState.mode = 'target'
  gymState.isTargetPractice = true
  gymShowPanel('loading')

  const rulesNote = targetSession.juiceRules.length > 0
    ? ` · 🧠 ${targetSession.juiceRules.length} rules active`
    : ''
  document.getElementById('gym-subtitle').textContent = `🎯 Target Practice ${idx + 1}/${total}: ${tenant.tenantName}${rulesNote}`
  document.getElementById('gym-progress-fill').style.width = '0%'
  document.getElementById('gym-loading-msg').textContent = 'Starting analysis...'

  const wrap  = document.getElementById('gym-ex-progress-wrap')
  const fill  = document.getElementById('gym-ex-progress-fill')
  const label = document.getElementById('gym-ex-progress-label')
  if (wrap) wrap.classList.remove('hidden')
  const pct = total > 1 ? Math.round((idx / total) * 100) : 0
  if (fill)  fill.style.width = pct + '%'
  if (label) label.textContent = `🎯 Target Practice: ${idx + 1} of ${total} — ${tenant.tenantName}`

  await gymRegisterLocalFiles(tenant.id)

  const url = sameOriginApi(
    `/api/gym/analyze?sessionId=${encodeURIComponent(state.sessionId)}&tenantId=${encodeURIComponent(tenant.id)}${cheapQs()}`
  )
  const es = new EventSource(url)
  state.eventSource = es

  es.addEventListener('gym-start', e => {
    const d = JSON.parse(e.data)
    document.getElementById('gym-subtitle').textContent = `🎯 [${idx + 1}/${total}] Analyzing: ${d.tenantName}${rulesNote}`
  })
  es.addEventListener('gym-progress', e => {
    const d = JSON.parse(e.data)
    document.getElementById('gym-progress-fill').style.width = (d.percent || 0) + '%'
    document.getElementById('gym-loading-msg').textContent = d.message || ''
  })
  es.addEventListener('gym-complete', e => {
    es.close(); state.eventSource = null
    const d = JSON.parse(e.data)
    document.getElementById('gym-progress-fill').style.width = '100%'

    gymLaunchWorkout(d)
    gymState.mode = 'target'

    document.getElementById('gym-save-isaac-btn')?.classList.add('hidden')
    document.getElementById('gym-ex-save-next-btn')?.classList.add('hidden')
    document.getElementById('gym-submit-btn')?.classList.add('hidden')
    const targetSaveBtn = document.getElementById('gym-target-save-btn')
    if (targetSaveBtn) {
      targetSaveBtn.classList.remove('hidden')
      targetSaveBtn.disabled = false
      targetSaveBtn.textContent = idx < total - 1 ? '💾 Save & Learn Next →' : '💾 Save Final Report'
    }
  })
  es.addEventListener('gym-error', e => {
    es.close(); state.eventSource = null
    const d = JSON.parse(e.data)
    toast('Analysis error: ' + (d.error || 'unknown'), 'error')
    targetSession.active = false
    gymState.mode = null
    gymShowPanel('picker')
  })
  es.onerror = () => {}
}

async function targetSaveAndNext() {
  const btn = document.getElementById('gym-target-save-btn')
  if (btn) { btn.disabled = true; btn.textContent = '💾 Saving...' }

  const findings    = gymFindingsForIsaacPayload()
  const feedbacks   = gymFeedbacksArray()
  const annotations = gymAnnotationsForIsaacExcel()

  // Count corrections — partial counts as rejected (Excel + learning), not confirmed
  const rejectedFindings  = findings.filter(f => {
    const fb = (gymState.feedbacks || {})[f.id]
    return fb && (fb.verdict === 'wrong' || fb.verdict === 'partial')
  }).map(f => {
    const fb = (gymState.feedbacks || {})[f.id] || {}
    const prefix = fb.verdict === 'partial' ? '◐ Partial: ' : ''
    return { ...f, reviewerNote: prefix + (fb.comment || '') }
  })
  const confirmedFindings = findings.filter(f => {
    const fb = (gymState.feedbacks || {})[f.id]
    return !fb || fb.verdict === 'correct'
  })
  const correctionCount = rejectedFindings.length + annotations.length
  targetSession.correctionsByTenant.push(correctionCount)

  const payload = {
    type:            'target-practice',
    tenantName:      gymState.tenantName,
    folderName:      gymState.folderName,
    findings,
    feedbacks,
    annotations,
    juiceRules:      targetSession.juiceRules,
    sessionId:       targetSession.sessionId,
    sessionIdx:      targetSession.currentIdx,
    sessionTotal:    targetSession.tenants.length,
    reviewerName:    targetSession.reviewerName,
    uploadSessionId: state.sessionId,
    tenantId:        gymState.tenantId
  }
  const localFiles = buildIsaacLocalFiles(gymState.tenantId)
  if (localFiles) payload.localFiles = localFiles

  try {
    // 1. Save the report
    const res  = await fetch(sameOriginApi('/api/gym/save-for-isaac'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Save failed')
    targetSession.savedCount++
    // Accumulate for session-level download Excel
    const tenantMeta = state.tenants.find(t => t.id === gymState.tenantId) || {}
    targetSession.allTenantResults.push({
      tenantName:        gymState.tenantName,
      folderName:        gymState.folderName,
      property:          tenantMeta.property || '',
      suite:             tenantMeta.suite    || '',
      confirmedFindings,
      rejectedFindings,
      annotations:       gymAnnotationsForIsaacExcel()
    })

    if (btn) { btn.textContent = '✅ Saved!' }
    sfxReady()

    // 2. Active learning synthesis — run in background while showing "Saved!" flash
    const isLast = targetSession.currentIdx + 1 >= targetSession.tenants.length
    if (!isLast && (rejectedFindings.length > 0 || annotations.length > 0)) {
      targetSession.synthesizing = true
      targetLearningIndicator(true)
      try {
        const synthRes = await fetch(sameOriginApi('/api/target/synthesize'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            rejectedFindings,   // already have reviewerNote (+ partial prefix) attached above
            confirmedFindings,
            annotations: gymAnnotationsForIsaacExcel(),
            currentRules: targetSession.juiceRules
          })
        })
        if (synthRes.ok) {
          const synthData = await synthRes.json()
          targetSession.juiceRules = synthData.rules || targetSession.juiceRules
          const ruleCount = targetSession.juiceRules.length
          toast(`🧠 ${synthData.summary || `${ruleCount} rules updated`}`, 'info')
        }
      } catch { /* synthesis failure is non-blocking */ }
      targetSession.synthesizing = false
      targetLearningIndicator(false)
    }

    await new Promise(r => setTimeout(r, 600))

    const next = targetSession.currentIdx + 1
    if (next < targetSession.tenants.length) {
      targetSession.currentIdx = next
      gymShowPanel('loading')
      await targetStartTenant(next)
    } else {
      // Session complete — show summary
      targetSession.active = false
      gymState.mode = null
      document.getElementById('gym-ex-progress-wrap')?.classList.add('hidden')
      sfxHuntComplete()
      targetShowSessionComplete()
    }
  } catch (err) {
    sfxError()
    toast('Save failed: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save & Learn Next →' }
  }
}

function targetLearningIndicator(show) {
  const el = document.getElementById('target-learning-indicator')
  if (!el) return
  if (show) {
    el.classList.remove('hidden')
    el.textContent = '🧠 Learning from your corrections...'
  } else {
    el.classList.add('hidden')
  }
}

function targetShowSessionComplete() {
  const panel = document.getElementById('target-session-complete')
  if (!panel) {
    toast(`🎯 Review complete — ${targetSession.savedCount} reports saved.`, 'success')
    gymOpenPicker()
    return
  }

  // Fill stats
  const total = targetSession.tenants.length
  const corrections = targetSession.correctionsByTenant
  const first = corrections[0] ?? 0
  const last  = corrections[corrections.length - 1] ?? 0
  const reduction = first > 0 ? Math.round(((first - last) / first) * 100) : 100

  document.getElementById('tsc-tenants').textContent    = total
  document.getElementById('tsc-rules').textContent      = targetSession.juiceRules.length
  document.getElementById('tsc-reduction').textContent  = `${reduction}%`
  document.getElementById('tsc-reviewer').textContent   = targetSession.reviewerName

  // Build correction curve graph
  const graph = document.getElementById('tsc-graph')
  if (graph && corrections.length > 0) {
    const maxVal = Math.max(...corrections, 1)
    graph.innerHTML = corrections.map((val, i) => {
      const heightPct = Math.round((val / maxVal) * 100)
      return `<div class="tsc-bar-wrap" title="Tenant ${i + 1}: ${val} correction${val !== 1 ? 's' : ''}">
        <div class="tsc-bar" style="height:${heightPct}%"></div>
        <div class="tsc-bar-label">${val}</div>
      </div>`
    }).join('')
  }

  // Loaded model info
  const parentRow = document.getElementById('tsc-parent-row')
  if (parentRow) {
    if (targetSession.loadedModelName) {
      parentRow.textContent = `↳ Built on: ${targetSession.loadedModelName}`
      parentRow.classList.remove('hidden')
    } else {
      parentRow.classList.add('hidden')
    }
  }

  goTo('gym')
  gymShowPanel('target-complete')
}

async function targetSaveModel() {
  const comment = await pixelPrompt(
    'Add a note about this model (optional).\nHow well did it perform?',
    '💾 SAVE JUICE MODEL',
    'e.g. Great for retail strip malls'
  )
  if (comment === null) return  // cancelled

  const btn = document.getElementById('tsc-save-model-btn')
  if (btn) { btn.disabled = true; btn.textContent = '💾 Saving...' }

  try {
    const res = await fetch(sameOriginApi('/api/target/save-model'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules:               targetSession.juiceRules,
        reviewerName:        targetSession.reviewerName,
        comment:             comment || '',
        correctionsByTenant: targetSession.correctionsByTenant,
        sessionId:           targetSession.sessionId,
        tenantCount:         targetSession.tenants.length,
        parentModelId:       targetSession.loadedModelId,
        parentModelName:     targetSession.loadedModelName
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Save failed')
    if (btn) { btn.textContent = '✅ Model Saved!' }
    sfxReady()
    toast(`🧠 Juice Model saved — ${data.errorReduction}% error reduction recorded`, 'success')
  } catch (err) {
    sfxError()
    toast('Save failed: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save as Juice Model' }
  }
}

async function targetDownloadFindings() {
  const btn = document.getElementById('tsc-download-btn')
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...' }
  try {
    const res = await fetch(sameOriginApi('/api/target/download-excel'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantResults: targetSession.allTenantResults,
        reviewerName:  targetSession.reviewerName,
        juiceRules:    targetSession.juiceRules,
        sessionId:     targetSession.sessionId
      })
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed')
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `Target-Practice-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    if (btn) { btn.disabled = false; btn.textContent = '📥 Download Findings' }
  } catch (err) {
    sfxError()
    toast('Download failed: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = '📥 Download Findings' }
  }
}

document.getElementById('tsc-download-btn')?.addEventListener('click', targetDownloadFindings)
document.getElementById('tsc-save-model-btn')?.addEventListener('click', targetSaveModel)
document.getElementById('tsc-done-btn')?.addEventListener('click', () => gymOpenPicker())

// ── TSC tab switching ──────────────────────────────────────
document.querySelectorAll('.tsc-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tsc-tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tsc-tab-panel').forEach(p => p.classList.add('hidden'))
    tab.classList.add('active')
    const panel = document.getElementById('tsc-tab-' + tab.dataset.tab)
    if (panel) panel.classList.remove('hidden')
    if (tab.dataset.tab === 'findings') buildTscFindingsTable()
  })
})

function buildTscFindingsTable() {
  const wrap = document.getElementById('tsc-findings-table-wrap')
  if (!wrap) return
  const results = targetSession.allTenantResults
  if (!results || results.length === 0) {
    wrap.innerHTML = '<p style="padding:16px;color:#64748b;font-size:12px;">No findings recorded yet.</p>'
    return
  }
  const rows = []
  results.forEach(r => {
    const findings = r.confirmedFindings || []
    if (findings.length === 0) {
      rows.push(`<tr>
        <td>${r.property || ''}</td><td>${r.tenantName || ''}</td><td>${r.suite || ''}</td>
        <td style="color:#4ade80">None</td><td>All clear</td><td class="sev-CLEAR">CLEAR</td>
      </tr>`)
    } else {
      findings.forEach(f => {
        const sevClass = 'sev-' + (f.severity || 'LOW')
        const comment = [f.comment, f.evidence ? 'Evidence: ' + f.evidence : ''].filter(Boolean).join(' | ')
        rows.push(`<tr>
          <td>${r.property || ''}</td><td>${r.tenantName || ''}</td><td>${r.suite || ''}</td>
          <td>${f.missingDocument || f.checkType || ''}</td>
          <td style="max-width:280px;word-break:break-word">${comment}</td>
          <td class="${sevClass}">${f.severity || ''}</td>
        </tr>`)
      })
    }
  })
  wrap.innerHTML = `<table class="findings-table">
    <thead><tr><th>Property</th><th>Tenant</th><th>Suite</th>
    <th>Missing / Issue</th><th>Comment / Evidence</th><th>Severity</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`
}

document.getElementById('gym-target-save-btn')?.addEventListener('click', targetSaveAndNext)

// ── Running animation loop ─────────────────────────────────
const GYM_RUN_CANVAS = document.getElementById('gym-run-canvas')
function gymAnimLoop(now) {
  if (state.screen !== 'gym') { requestAnimationFrame(gymAnimLoop); return }
  if (gymState.gymRunTimer < now) {
    gymState.gymRunFrame = gymState.gymRunFrame === 0 ? 1 : 0
    if (GYM_RUN_CANVAS) drawFrame(GYM_RUN_CANVAS, gymState.gymRunFrame === 0 ? GYM_RUN1 : GYM_RUN2)
    gymState.gymRunTimer = now + 200

    // spawn sweat drop
    if (Math.random() > 0.5) {
      gymState.sweatDrops.push({ x: 52 + Math.random() * 12, y: 8, vx: 1 + Math.random(), vy: -1, life: 18 })
    }
  }
  // animate sweat drops
  const cont = document.getElementById('gym-sweat-container')
  if (cont) {
    gymState.sweatDrops = gymState.sweatDrops.filter(d => d.life > 0)
    gymState.sweatDrops.forEach(d => { d.x += d.vx; d.y += d.vy; d.vy += 0.2; d.life-- })
    cont.innerHTML = gymState.sweatDrops.map(d => {
      const op = (d.life / 18).toFixed(2)
      return `<div style="position:absolute;left:${d.x}px;top:${d.y}px;width:3px;height:3px;background:#60A5FA;border-radius:50%;opacity:${op}"></div>`
    }).join('')
  }
  requestAnimationFrame(gymAnimLoop)
}
requestAnimationFrame(gymAnimLoop)

// ── Open gym screen ────────────────────────────────────────
document.getElementById('btn-workout').addEventListener('click', () => {
  if (state.tenants.length === 0) { toast('Upload files first', 'error'); return }
  gymOpenPicker()
})

document.getElementById('btn-target-launch')?.addEventListener('click', () => {
  if (state.tenants.length === 0) { toast('Upload files first', 'error'); return }
  startTargetPractice()
})

document.getElementById('gym-back').addEventListener('click', () => {
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null }
  gymReset()
  goTo('loading')
})

/**
 * If files are local (state.localFiles), push them to the server session so
 * /api/gym/analyze can read them. No-op when files are already on Railway disk.
 */
async function gymRegisterLocalFiles(tenantId) {
  if (!state.localFiles || state.localFiles.size === 0) return
  const tenant = state.tenants.find(t => t.id === tenantId)
  if (!tenant) return
  const files = (tenant.files || []).map(f => {
    const local = state.localFiles.get(f.relativePath)
    if (!local) return null
    return { name: f.name, base64: arrayBufferToBase64(local.buffer), size: local.size }
  }).filter(Boolean)
  if (files.length === 0) return
  try {
    await fetch(sameOriginApi('/api/gym/register-files'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: state.sessionId, tenantId, files })
    })
  } catch (e) { console.warn('[gym] register-files failed:', e.message) }
}

function gymReset() {
  gymState.findings = []
  gymState.feedbacks = {}
  gymState.annotations = []
  gymState.files = []
  gymState.tenantId = null
  gymState.tenantName = ''
  gymState.folderName = ''
  gymState.activeFindingId = null
  gymState.pdfDoc = null
  gymState.pdfCache = {}
  gymState.pdfPageLabels = {}
  gymState.annotating = false
  gymState.pendingAnno = null
  gymState.sweatDrops = []
  gymState.isTargetPractice = false
  // reset panels
  gymShowPanel('picker')
  document.getElementById('gym-skip-btn').classList.add('hidden')
  document.getElementById('gym-flag-btn')?.classList.remove('active')
  document.getElementById('gym-anno-overlay')?.classList.remove('active')
}

function gymOpenPicker() {
  gymReset()
  goTo('gym')
  const sel = document.getElementById('gym-select')
  sel.innerHTML = state.tenants.map(t =>
    `<option value="${t.id}">${escHtml(t.tenantName)} (${t.fileCount} files)</option>`
  ).join('')
  document.getElementById('gym-subtitle').textContent = 'Pick a tenant to train on'
}

function gymShowPanel(name) {
  document.getElementById('gym-panel-picker').classList.toggle('hidden', name !== 'picker')
  document.getElementById('gym-panel-loading').classList.toggle('hidden', name !== 'loading')
  document.getElementById('gym-panel-workout').classList.toggle('hidden', name !== 'workout')
  document.getElementById('gym-panel-results').classList.toggle('hidden', name !== 'results')
  document.getElementById('target-session-complete')?.classList.toggle('hidden', name !== 'target-complete')

  if (name === 'loading') {
    const isTP = !!gymState.isTargetPractice
    // Toggle between running-Todd and Robin Hood archer
    const runWrap    = document.getElementById('gym-run-wrap')
    const targetWrap = document.getElementById('gym-target-wrap')
    const label      = document.getElementById('gym-loading-label')
    if (runWrap)    runWrap.classList.toggle('hidden', isTP)
    if (targetWrap) targetWrap.classList.toggle('hidden', !isTP)
    if (label) label.textContent = isTP ? 'Todd Jr. is on the hunt...' : 'Todd is working out...'
    const titleEl = document.getElementById('gym-title')
    if (titleEl) titleEl.textContent = isTP ? '🎯 Target Practice' : '🏋️ Gym Teacher'
    if (isTP) {
      const tc = document.getElementById('gym-target-canvas')
      if (tc && window.initTargetPracticeAnim) initTargetPracticeAnim(tc)
      // Wire PLAY button
      const playBtn = document.getElementById('gym-play-game-btn')
      if (playBtn) {
        playBtn.onclick = () => { if (window.initTargetPracticeAnim) initTargetPracticeAnim(tc, true) }
      }
    }
  } else {
    // Leaving loading panel — stop archer anim
    if (window.stopTargetPracticeAnim) stopTargetPracticeAnim()
  }
}

// ── Start workout ──────────────────────────────────────────
document.getElementById('gym-start-btn').addEventListener('click', async () => {
  const tenantId = document.getElementById('gym-select').value
  if (!tenantId) return
  const tenant = state.tenants.find(t => t.id === tenantId)
  gymShowPanel('loading')
  document.getElementById('gym-subtitle').textContent = `Analyzing ${tenant?.tenantName || ''}...`
  document.getElementById('gym-progress-fill').style.width = '0%'
  document.getElementById('gym-loading-msg').textContent = 'Starting analysis...'

  // Push local files to server if needed
  await gymRegisterLocalFiles(tenantId)

  const url = sameOriginApi(
    `/api/gym/analyze?sessionId=${encodeURIComponent(state.sessionId)}&tenantId=${encodeURIComponent(tenantId)}${cheapQs()}`
  )
  const es = new EventSource(url)
  state.eventSource = es

  es.addEventListener('gym-start', e => {
    const d = JSON.parse(e.data)
    document.getElementById('gym-subtitle').textContent = `Analyzing: ${d.tenantName}`
  })
  es.addEventListener('gym-progress', e => {
    const d = JSON.parse(e.data)
    document.getElementById('gym-progress-fill').style.width = (d.percent || 0) + '%'
    document.getElementById('gym-loading-msg').textContent = d.message || ''
  })
  es.addEventListener('gym-complete', e => {
    es.close(); state.eventSource = null
    const d = JSON.parse(e.data)
    document.getElementById('gym-progress-fill').style.width = '100%'
    gymLaunchWorkout(d)
  })
  es.addEventListener('gym-error', e => {
    es.close(); state.eventSource = null
    const d = JSON.parse(e.data)
    toast('Gym error: ' + d.error, 'error')
    gymShowPanel('picker')
  })
  es.onerror = () => {}
})

// ── Launch workout view ────────────────────────────────────
function gymLaunchWorkout(data) {
  gymState.findings = data.findings || []
  gymState.files    = data.files    || []
  gymState.feedbacks = {}
  gymState.annotations = []
  gymState.tenantId   = data.tenantId || null
  gymState.tenantName = data.tenantName || ''
  gymState.folderName = data.folderName || ''

  gymShowPanel('workout')
  document.getElementById('gym-skip-btn').classList.remove('hidden')
  document.getElementById('gym-subtitle').textContent = data.tenantName || ''

  // Update folder button label with doc count
  const folderLabel = document.getElementById('gym-folder-btn-label')
  if (folderLabel) folderLabel.textContent = `${gymState.files.length} doc${gymState.files.length !== 1 ? 's' : ''}`

  renderGymFindingCards()
  gymUpdateReviewStatus()

  // Load first PDF immediately, then silently pre-load all others in background
  const firstPDF = gymState.files.find(f => f.isPDF)
  if (firstPDF) {
    gymLoadDoc(firstPDF.index)
    gymPreloadAllPDFs()  // background — no await, fires silently
  } else {
    document.getElementById('gym-pdf-hint').textContent = 'No PDF files in this folder'
  }
}

// ── Finding cards ──────────────────────────────────────────
function renderGymFindingCards() {
  const scroll = document.getElementById('gym-findings-scroll')
  const count  = document.getElementById('gym-findings-count')
  count.textContent = gymState.findings.length + ' finding' + (gymState.findings.length !== 1 ? 's' : '')

  if (gymState.findings.length === 0) {
    scroll.innerHTML = '<p style="font-size:12px;color:#10B981;text-align:center;padding:20px">✅ All Clear — no findings to review!</p>'
    return
  }

  scroll.innerHTML = gymState.findings.map((f, i) => {
    const sevClass = (f.severity || 'low').toLowerCase()
    const loc      = gymParseEvidenceLocation(f.evidence)
    const locFile  = gymState.files[loc.docIdx]
    const locLabel = locFile ? `📄 ${locFile.name.replace(/\.pdf$/i,'')}, p.${loc.pageNum}` : ''

    // Confidence badge colour
    const confClass = { HIGH: 'conf-high', MEDIUM: 'conf-med', LOW: 'conf-low' }[f.confidence] || 'conf-med'

    // Build "checked & eliminated" list
    const checked = Array.isArray(f.checkedAndEliminated) && f.checkedAndEliminated.length
      ? f.checkedAndEliminated.map(c => `<li>${escHtml(c)}</li>`).join('')
      : ''

    return `
    <div class="gym-finding-card" id="gym-card-${f.id}" data-fid="${f.id}" data-idx="${i}">

      <!-- Row 1: badges -->
      <div class="gym-card-top">
        <span class="gym-card-check">${escHtml(CHECK_LABELS[f.checkType] || f.checkType || 'CHECK')}</span>
        <span class="sev-pill sev-${sevClass}">${escHtml(f.severity || 'LOW')}</span>
        ${f.confidence ? `<span class="gym-conf-badge ${confClass}">${escHtml(f.confidence)}</span>` : ''}
        <button class="gym-jump-btn" data-idx="${i}" title="Jump to document">📄</button>
      </div>

      <!-- Row 2: Missing Document (matches Excel col 4) -->
      <div class="gym-excel-row">
        <span class="gym-excel-label">Missing Document</span>
        <span class="gym-excel-value gym-card-doc">${escHtml(f.missingDocument || 'N/A')}</span>
      </div>

      <!-- Row 3: Comment / Status (matches Excel col 5) -->
      <div class="gym-excel-row">
        <span class="gym-excel-label">Comment / Status</span>
        <span class="gym-excel-value clamped gym-clamp-val">${escHtml(f.comment || '')}</span>
      </div>

      <!-- Row 4: Evidence -->
      <div class="gym-excel-row">
        <span class="gym-excel-label">Evidence</span>
        <span class="gym-excel-value clamped gym-clamp-val gym-evidence-val" id="gym-ev-${f.id}">${escHtml(f.evidence || '')}</span>
      </div>

      ${locLabel ? `<div class="gym-card-location">${escHtml(locLabel)}</div>` : ''}
      ${f.howIFoundThis ? `<div class="gym-how-found">💡 ${escHtml(f.howIFoundThis)}</div>` : ''}

      <!-- Verdict actions -->
      <div class="gym-card-actions">
        <button class="gym-verdict-btn gym-verdict-correct" data-fid="${f.id}">✅ Correct</button>
        <button class="gym-verdict-btn gym-verdict-wrong"   data-fid="${f.id}">❌ Wrong</button>
      </div>
      <div class="gym-card-comment" id="gym-comment-${f.id}"></div>

      <!-- Expandable: Todd’s full reasoning -->
      <button class="gym-expand-btn" id="gym-exp-${f.id}" data-fid="${f.id}">▼ Show Todd’s reasoning</button>
      <div class="gym-reasoning-block hidden" id="gym-rb-${f.id}">
        ${f.triggerQuote ? `
        <div class="gym-rb-section">
          <div class="gym-rb-label">🔍 What triggered this finding</div>
          <div class="gym-rb-quote">${escHtml(f.triggerQuote)}</div>
        </div>` : ''}

        ${f.reasoning ? `
        <div class="gym-rb-section">
          <div class="gym-rb-label">🧠 How Todd reasoned through it</div>
          <div class="gym-rb-text">${escHtml(f.reasoning)}</div>
        </div>` : ''}

        ${checked ? `
        <div class="gym-rb-section">
          <div class="gym-rb-label">✔️ What Todd checked & eliminated</div>
          <ul class="gym-rb-list">${checked}</ul>
        </div>` : ''}
      </div>
    </div>`
  }).join('')

  // Wire verdict buttons
  scroll.querySelectorAll('.gym-verdict-correct').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); gymSetVerdict(btn.dataset.fid, 'correct') })
  })
  scroll.querySelectorAll('.gym-verdict-wrong').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); gymOpenFeedbackModal(btn.dataset.fid) })
  })
  scroll.querySelectorAll('.gym-jump-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); gymJumpToFinding(parseInt(btn.dataset.idx)) })
  })
  // Click any clamped value to expand/collapse it
  // Clicking the evidence value also navigates to the cited document/page
  scroll.querySelectorAll('.gym-clamp-val').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      el.classList.toggle('expanded')
      if (el.classList.contains('gym-evidence-val')) {
        const card = el.closest('.gym-finding-card')
        if (card) gymJumpToFinding(parseInt(card.dataset.idx))
      }
    })
  })

  // Expand / collapse reasoning block
  scroll.querySelectorAll('.gym-expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const rb       = document.getElementById(`gym-rb-${btn.dataset.fid}`)
      const expanded = rb.classList.toggle('hidden') === false
      btn.textContent = expanded ? '▲ Hide reasoning' : '▼ Show Todd\'s reasoning'
    })
  })
  scroll.querySelectorAll('.gym-finding-card').forEach(card => {
    card.addEventListener('click', () => gymJumpToFinding(parseInt(card.dataset.idx)))
  })
}

function gymSetVerdict(findingId, verdict, comment = '') {
  gymState.feedbacks[findingId] = { verdict, comment }
  const card = document.getElementById(`gym-card-${findingId}`)
  if (card) {
    card.className = 'gym-finding-card verdict-' + verdict
    card.querySelectorAll('.gym-verdict-btn').forEach(b => b.classList.remove('active'))
    const activeBtn = card.querySelector(verdict === 'correct' ? '.gym-verdict-correct' : '.gym-verdict-wrong')
    if (activeBtn) activeBtn.classList.add('active')
  }
  const commentEl = document.getElementById(`gym-comment-${findingId}`)
  if (commentEl) commentEl.textContent = comment ? `"${comment}"` : ''
  gymUpdateReviewStatus()
}

function gymUpdateReviewStatus() {
  const total    = gymState.findings.length
  const reviewed = Object.keys(gymState.feedbacks).length + gymState.annotations.length
  const el = document.getElementById('gym-review-status')
  if (el) el.textContent = `${reviewed} of ${total} findings reviewed`
}

const GYM_VERDICT_LABEL = { correct: '✅ Confirmed correct', wrong: '❌ Wrong', partial: '◐ Partially right' }

function gymFeedbacksArray() {
  return Object.entries(gymState.feedbacks).map(([findingId, fb]) => ({
    findingId,
    verdict: fb.verdict,
    comment: fb.comment || ''
  }))
}

/** Omit base64 crops from POST bodies — keeps Save for Isaac / Workout under JSON limits; AI only needs text fields. */
function gymAnnotationsForPayload() {
  return (gymState.annotations || []).map(a => ({
    docIdx: a.docIdx,
    docName: a.docName,
    pageNum: a.pageNum,
    comment: a.comment,
    normRect: a.normRect,
    hasCrop: !!a.cropDataUrl
  }))
}

/** Annotations for Save for Isaac Excel — includes crop PNG for embedding in the Screenshot column. */
function gymAnnotationsForIsaacExcel() {
  return (gymState.annotations || []).map(a => ({
    docName: a.docName,
    pageNum: a.pageNum,
    comment: a.comment,
    cropDataUrl: a.cropDataUrl || null
  }))
}

const ISAAC_CLIENT_EVIDENCE_CAP = 32000

/** Slim findings for Save for Isaac — avoids 413 / huge JSON (gym evidence strings can be massive). */
/**
 * Build the localFiles array for Isaac save payloads.
 * When files are in browser RAM (local extraction flow), we send them as base64
 * so the server can write them to the Isaac docs/ folder on Railway volume.
 * Returns null if this is an old-style upload session (files already on disk).
 */
function buildIsaacLocalFiles(tenantId) {
  if (!state.localFiles || state.localFiles.size === 0) return null
  // Find the tenant's files
  const tenant = state.tenants.find(t => t.id === tenantId)
  if (!tenant) return null
  return (tenant.files || []).map(f => {
    const local = state.localFiles.get(f.relativePath)
    if (!local) return null
    return { name: f.name, base64: arrayBufferToBase64(local.buffer), size: local.size }
  }).filter(Boolean)
}

function gymFindingsForIsaacPayload() {
  return (gymState.findings || []).map(f => {
    const ev = f.evidence
    let evidence = ev
    if (typeof ev === 'string' && ev.length > ISAAC_CLIENT_EVIDENCE_CAP) {
      evidence = ev.slice(0, ISAAC_CLIENT_EVIDENCE_CAP) + '…'
    }
    return {
      id: f.id,
      checkType: f.checkType,
      severity: f.severity,
      missingDocument: f.missingDocument,
      comment: f.comment,
      evidence,
      confidence: f.confidence,
      reasoning: typeof f.reasoning === 'string' && f.reasoning.length > 16000
        ? f.reasoning.slice(0, 16000) + '…'
        : f.reasoning,
      triggerQuote: f.triggerQuote,
      checkedAndEliminated: f.checkedAndEliminated,
      howIFoundThis: typeof f.howIFoundThis === 'string' && f.howIFoundThis.length > 16000
        ? f.howIFoundThis.slice(0, 16000) + '…'
        : f.howIFoundThis
    }
  })
}

function buildGymNotesReviewHtml() {
  const parts = []

  if (gymState.findings.length === 0) {
    parts.push('<p>No findings in this workout. You can still add flag annotations and save for Isaac.</p>')
  } else {
    gymState.findings.forEach(f => {
      const fb = gymState.feedbacks[f.id]
      const verdictKey = fb?.verdict
      const verdictLine = verdictKey
        ? (GYM_VERDICT_LABEL[verdictKey] || verdictKey)
        : '<em>Not reviewed yet</em>'
      const com = fb?.comment ? escHtml(fb.comment) : ''
      const loc = gymParseEvidenceLocation(f.evidence)
      const locFile = gymState.files[loc.docIdx]
      const locLabel = locFile ? `${escHtml(locFile.name.replace(/\.pdf$/i, ''))}, p.${loc.pageNum}` : ''

      parts.push(`<div class="gym-note-block">
        <div class="gym-note-label">${escHtml(CHECK_LABELS[f.checkType] || f.checkType || 'Finding')}</div>
        <div><strong>Issue:</strong> ${escHtml(f.missingDocument || '')}</div>
        ${locLabel ? `<div><strong>Location:</strong> ${locLabel}</div>` : ''}
        <div><strong>Verdict:</strong> ${verdictLine}</div>
        ${com ? `<div><strong>Your note:</strong> ${com}</div>` : ''}
      </div>`)
    })
  }

  if (gymState.annotations.length > 0) {
    parts.push('<div class="gym-note-label" style="margin-top:16px">📌 Flag-area annotations</div>')
    gymState.annotations.forEach((a, i) => {
      parts.push(`<div class="gym-note-block">
        <div class="gym-note-label">Annotation ${i + 1}</div>
        <div>${escHtml(a.docName || '')} · page ${a.pageNum}</div>
        <div>${escHtml(a.comment || '')}</div>
      </div>`)
    })
  } else if (gymState.findings.length > 0) {
    parts.push('<p style="margin-top:12px;opacity:0.85">No flag-area annotations yet.</p>')
  }

  return parts.join('')
}

function gymOpenNotesReviewModal() {
  const body = document.getElementById('gym-notes-review-body')
  const modal = document.getElementById('gym-notes-review-modal')
  if (!body || !modal) return
  body.innerHTML = buildGymNotesReviewHtml()
  modal.classList.remove('hidden')
}

document.getElementById('gym-review-notes-btn')?.addEventListener('click', () => gymOpenNotesReviewModal())
document.getElementById('gym-notes-review-close')?.addEventListener('click', () => {
  document.getElementById('gym-notes-review-modal')?.classList.add('hidden')
})

document.getElementById('gym-save-isaac-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('gym-save-isaac-btn')
  if (!btn) return
  btn.disabled = true
  const tenantId = gymState.tenantId || document.getElementById('gym-select')?.value || ''
  try {
    const _isaacLocalFiles = buildIsaacLocalFiles(tenantId)
    const payload = {
      tenantName:      gymState.tenantName,
      folderName:      gymState.folderName,
      findings:        gymFindingsForIsaacPayload(),
      feedbacks:       gymFeedbacksArray(),
      annotations:     gymAnnotationsForIsaacExcel(),
      uploadSessionId: state.sessionId,
      tenantId,
      ...(_isaacLocalFiles ? { localFiles: _isaacLocalFiles } : {})
    }
    let body
    try {
      body = JSON.stringify(payload)
    } catch (serErr) {
      throw new Error('Could not serialize save data — try fewer annotations or refresh.')
    }
    const res = await fetch(sameOriginApi('/api/gym/save-for-isaac'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    })
    const raw = await res.text()
    let data = {}
    try { data = raw ? JSON.parse(raw) : {} } catch { /* non-JSON e.g. proxy error page */ }
    if (!res.ok) {
      if (res.status === 404 || /Cannot POST\s+\/api\/gym\/save-for-isaac/i.test(raw)) {
        throw new Error(
          'This URL is not running Todd’s Node server (no Save-for-Isaac route). Open ' +
            sameOriginApi('/api/health') +
            ' — you should see JSON with isaacRoutes. On Railway: one Web service, Root = repo with server.js, Start = npm start, redeploy from GitHub.'
        )
      }
      const hint = data.error || (res.status === 413 ? 'Request too large — fewer/lighter screenshots or refresh.' : raw.slice(0, 200))
      throw new Error(hint || `Save failed (${res.status})`)
    }
    toast('Teacher Todd Excel saved ✓', 'success')
    if (data.downloadUrl) {
      const a = document.createElement('a')
      a.href = toddApiUrl(data.downloadUrl)
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  } catch (e) {
    toast(e.message || 'Could not save', 'error')
  } finally {
    btn.disabled = false
  }
})

document.getElementById('gym-ex-save-next-btn')?.addEventListener('click', gymExSaveAndNext)
document.getElementById('gym-ex-session-btn')?.addEventListener('click', startExerciseSession)

function isaacDocLinks(entry) {
  if (!entry.docs || entry.docs.length === 0) return ''
  const links = entry.docs.map(fname => {
    const href = toddApiUrl(`/api/gym/isaac-doc/${encodeURIComponent(entry.id)}/${encodeURIComponent(fname)}`)
    return `<a class="isaac-pdf-link" href="${href}" target="_blank" rel="noopener">📄 ${escHtml(fname)}</a>`
  }).join('')
  return `<div class="isaac-pdf-links">${links}</div>`
}

function isaacPackageBtn(entry) {
  if (!entry.id) return ''
  const href = toddApiUrl(`/api/gym/isaac-package/${encodeURIComponent(entry.id)}`)
  return `<a class="isaac-download-link isaac-pkg-btn" href="${href}" download title="Download Excel + all PDFs as a zip">📦 Download Package</a>`
}

function renderIsaacLogsHtml(entries) {
  if (!entries || entries.length === 0) {
    return '<p>No exports yet. In Gym Teacher Mode use <strong>Save for Isaac</strong> — you get a compact Excel file (same columns as the main report + Teacher Todd comments + flag screenshots).</p>'
  }

  // Group session saves together, standalone saves separate
  const rendered     = []
  const seenSessions = new Set()

  for (const entry of entries) {
    const dt   = new Date(entry.savedAt).toLocaleString()
    const id   = entry.id || ''
    const href = id ? toddApiUrl(`/api/gym/isaac-download/${encodeURIComponent(id)}`) : '#'

    if (entry.sessionId) {
      if (!seenSessions.has(entry.sessionId)) {
        seenSessions.add(entry.sessionId)
        const sessionEntries = entries.filter(e => e.sessionId === entry.sessionId)
        const total    = entry.sessionTotal || sessionEntries.length
        const reviewer = entry.reviewerName ? ` · Reviewed by: ${escHtml(entry.reviewerName)}` : ''
        const sessionPkgHref = toddApiUrl(`/api/gym/isaac-session-package/${encodeURIComponent(entry.sessionId)}`)
        const sessionIcon = entry.type === 'target-practice' ? '🎯' : '⚡'
        const sessionLabel = entry.type === 'target-practice' ? 'Target Practice Review' : 'Exercise Session'
        rendered.push(`<div class="isaac-session-group">
          <div class="isaac-session-header">
            ${sessionIcon} ${sessionLabel} · ${escHtml(dt)}${reviewer} · ${sessionEntries.length} of ${total} tenants
            <a class="isaac-session-pkg-btn" href="${sessionPkgHref}" download title="Download all reports + PDFs for this session as a zip">📦 Download Full Session</a>
          </div>
          ${sessionEntries.map(se => {
            const sid   = se.id || ''
            const shref = sid ? toddApiUrl(`/api/gym/isaac-download/${encodeURIComponent(sid)}`) : '#'
            return `<div class="isaac-log-card isaac-session-item">
              <button class="isaac-delete-btn" data-id="${escHtml(sid)}" title="Delete this report">✕</button>
              <div class="isaac-log-meta">${escHtml(se.tenantName || '')} · ${escHtml(se.folderName || '')}</div>
              <div class="isaac-download-row">
                <a class="isaac-download-link" href="${shref}" download>⬇ Download .xlsx</a>
                ${isaacPackageBtn(se)}
              </div>
              ${isaacDocLinks(se)}
            </div>`
          }).join('')}
        </div>`)
      }
    } else {
      const cardIcon = entry.type === 'target-practice' ? '🎯 ' : ''
      rendered.push(`<div class="isaac-log-card">
        <button class="isaac-delete-btn" data-id="${escHtml(id)}" title="Delete this report">✕</button>
        <div class="isaac-log-meta">${cardIcon}${escHtml(dt)} · ${escHtml(entry.tenantName || '')} · ${escHtml(entry.folderName || '')}</div>
        <div class="isaac-download-row">
          <a class="isaac-download-link" href="${href}" download>⬇ Download .xlsx</a>
          ${isaacPackageBtn(entry)}
        </div>
        ${isaacDocLinks(entry)}
      </div>`)
    }
  }
  return rendered.join('')
}

document.getElementById('isaac-easter')?.addEventListener('click', async () => {
  const modal = document.getElementById('isaac-logs-modal')
  const body = document.getElementById('isaac-logs-body')
  if (!modal || !body) return
  body.innerHTML = '<p>Loading…</p>'
  modal.classList.remove('hidden')
  try {
    const res = await fetch(sameOriginApi('/api/gym/isaac-logs'))
    const logs = await res.json()
    if (!res.ok) throw new Error(logs.error || 'Failed to load')
    body.innerHTML = renderIsaacLogsHtml(Array.isArray(logs) ? logs : [])
    // Wire delete buttons
    body.querySelectorAll('.isaac-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const id = btn.dataset.id
        if (!id) return
        btn.disabled = true
        btn.textContent = '…'
        try {
          const dr = await fetch(sameOriginApi(`/api/gym/isaac-delete/${encodeURIComponent(id)}`), { method: 'DELETE' })
          if (!dr.ok) throw new Error((await dr.json()).error || 'Delete failed')
          // Remove card from DOM immediately
          const card = btn.closest('.isaac-log-card, .isaac-session-group')
          if (card) card.remove()
          // If body is now empty re-render empty state
          if (!body.querySelector('.isaac-log-card')) {
            body.innerHTML = renderIsaacLogsHtml([])
          }
        } catch (err) {
          toast(err.message || 'Could not delete', 'error')
          btn.disabled = false
          btn.textContent = '✕'
        }
      })
    })
  } catch (e) {
    body.innerHTML = `<p>Could not load logs: ${escHtml(e.message)}</p>`
  }
})

document.getElementById('isaac-logs-close')?.addEventListener('click', () => {
  document.getElementById('isaac-logs-modal')?.classList.add('hidden')
})

// ── Jump to finding (load relevant doc + page) ─────────────
function gymJumpToFinding(idx) {
  const finding = gymState.findings[idx]
  if (!finding) return

  gymState.activeFindingId = finding.id
  document.querySelectorAll('.gym-finding-card').forEach(c => c.classList.remove('active'))
  const card = document.getElementById(`gym-card-${finding.id}`)
  if (card) {
    card.classList.add('active')
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const { docIdx, pageNum } = gymParseEvidenceLocation(finding.evidence)
  const scanPage = gymPrintedToScan(docIdx, pageNum)
  if (docIdx !== gymState.currentDocIdx || !gymState.pdfDoc) {
    gymLoadDoc(docIdx, scanPage)
  } else {
    gymGoToPage(scanPage)
  }
}

/**
 * Parse the evidence string to find the best matching PDF file and page number.
 * Evidence format (from system prompt): "Filename.pdf, Page N, Section: 'text'"
 * Steps:
 *   1. Split on ", Page N" → left side is the document reference
 *   2. Try exact filename match
 *   3. Try word-overlap scoring against all PDF filenames
 *   4. Keyword fallback (amendment / guaranty / estoppel / lease)
 *   5. Default to first PDF
 */
function gymParseEvidenceLocation(evidence) {
  const pdfs = gymState.files.filter(f => f.isPDF)
  const fallback = { docIdx: pdfs[0]?.index ?? 0, pageNum: 1 }
  if (!evidence || pdfs.length === 0) return fallback

  // ── Extract page number ────────────────────────────────
  const pageMatch = evidence.match(/,\s*p(?:age)?\.?\s*(\d+)/i) ||
                    evidence.match(/page\s+(\d+)/i) ||
                    evidence.match(/\bp\.?\s*(\d+)\b/i)
  const pageNum = pageMatch ? parseInt(pageMatch[1]) : 1

  // ── Extract document reference (text before ", Page N") ─
  const docRef = (evidence.split(/,\s*p(?:age)?\.?\s*\d+/i)[0] || '').trim()
  const docRefLower = docRef.toLowerCase().replace(/\.pdf$/i, '').replace(/['"]/g, '').trim()

  // ── Step 1: Exact match against file names ─────────────
  for (const f of pdfs) {
    const fname = f.name.toLowerCase().replace(/\.pdf$/i, '')
    if (fname === docRefLower || docRefLower === fname) return { docIdx: f.index, pageNum }
  }

  // ── Step 2: Substring match (evidence contains filename or vice versa) ──
  for (const f of pdfs) {
    const fname = f.name.toLowerCase().replace(/\.pdf$/i, '')
    if (docRefLower.includes(fname) || fname.includes(docRefLower)) return { docIdx: f.index, pageNum }
  }

  // ── Step 3: Word-overlap scoring ───────────────────────
  const stopWords = new Set(['the','and','to','of','a','an','in','for','with','that','this','dated','date','as','by'])
  const refWords  = docRefLower.split(/[\s,.\-–—()]+/).filter(w => w.length > 2 && !stopWords.has(w))
  let bestFile  = null
  let bestScore = 0
  for (const f of pdfs) {
    const nameWords = f.name.toLowerCase().split(/[\s,.\-–—()]+/).filter(w => w.length > 2 && !stopWords.has(w))
    const score = refWords.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw))).length
    if (score > bestScore) { bestScore = score; bestFile = f }
  }
  if (bestFile && bestScore >= 1) return { docIdx: bestFile.index, pageNum }

  // ── Step 4: Keyword fallback on full evidence string ────
  const lower = evidence.toLowerCase()
  const keywords = [
    ['amendment', 'amendment'], ['guaranty', 'guaranty'], ['guarantee', 'guaranty'],
    ['estoppel', 'estoppel'], ['license', 'license'], ['snda', 'snda'],
    ['exhibit', 'exhibit'], ['lease', 'lease'],
  ]
  for (const [kw, match] of keywords) {
    if (!lower.includes(kw)) continue
    const hit = pdfs.find(f => f.name.toLowerCase().includes(match))
    if (hit) return { docIdx: hit.index, pageNum }
  }

  return { docIdx: pdfs[0].index, pageNum }
}

// ── Background PDF pre-loader ───────────────────────────────
// Silently fetches and caches every PDF referenced by any finding so that
// clicking a finding is instant — no network round-trip needed.
async function gymPreloadAllPDFs() {
  if (typeof pdfjsLib === 'undefined') return
  // Collect unique doc indices referenced by findings
  const docIndices = new Set()
  gymState.findings.forEach(f => {
    try { docIndices.add(gymParseEvidenceLocation(f.evidence).docIdx) } catch {}
  })
  // Also add every PDF file so navigating the drawer is instant too
  gymState.files.forEach(f => { if (f.isPDF) docIndices.add(f.index) })

  for (const fileIndex of docIndices) {
    if (gymState.pdfCache[fileIndex]) continue  // already loaded
    const file = gymState.files[fileIndex]
    if (!file || !file.isPDF) continue
    try {
      const pdfDoc = await pdfjsLib.getDocument(file.url).promise
      gymState.pdfCache[fileIndex] = pdfDoc
      await gymCachePageLabels(fileIndex, pdfDoc)
    } catch (e) { /* silently skip — user will get an error if they click this doc */ }
  }
}

// ── PDF page-label helpers ──────────────────────────────────
// Some PDFs embed printed page labels (e.g. cover pages labeled "i","ii" then
// main body starting at "1" on scan page 4). When labels exist we can map
// Claude's cited printed page → correct scan page index.

async function gymCachePageLabels(fileIndex, pdfDoc) {
  if (gymState.pdfPageLabels[fileIndex] !== undefined) return  // already cached
  try {
    gymState.pdfPageLabels[fileIndex] = await pdfDoc.getPageLabels()  // null if PDF has none
  } catch (e) {
    gymState.pdfPageLabels[fileIndex] = null
  }
}

function gymPrintedToScan(docIdx, printedPage) {
  const labels = gymState.pdfPageLabels[docIdx]
  if (!labels) return printedPage  // no labels — 1:1 mapping
  const target = String(printedPage)
  const idx = labels.findIndex(l => l === target || (l != null && l.trim() === target))
  return idx >= 0 ? idx + 1 : printedPage  // convert to 1-based scan page; fall back if not found
}

// ── Skip to next finding ────────────────────────────────────
document.getElementById('gym-skip-btn').addEventListener('click', () => {
  const ids    = gymState.findings.map(f => f.id)
  const curIdx = ids.indexOf(gymState.activeFindingId)
  const next   = (curIdx + 1) % ids.length
  gymJumpToFinding(next)
})

// ── PDF viewer ─────────────────────────────────────────────
async function gymLoadDoc(fileIndex, goToPage = 1) {
  const file = gymState.files[fileIndex]
  if (!file || !file.isPDF) return
  gymState.currentDocIdx = fileIndex
  document.getElementById('gym-pdf-docname').textContent = file.name

  // Keep drawer tile highlight in sync
  document.querySelectorAll('.gym-doc-tile').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.docidx) === fileIndex)
  })
  document.getElementById('gym-pdf-hint').textContent = 'Loading PDF...'

  try {
    if (typeof pdfjsLib === 'undefined') {
      document.getElementById('gym-pdf-hint').textContent = 'PDF.js not loaded — try refreshing'
      return
    }

    // Use cache — avoid re-fetching a document already loaded this session
    if (gymState.pdfCache[fileIndex]) {
      gymState.pdfDoc    = gymState.pdfCache[fileIndex]
      gymState.totalPages = gymState.pdfDoc.numPages
    } else {
      document.getElementById('gym-pdf-pageinfo').textContent = 'Loading...'
      const loadingTask = pdfjsLib.getDocument(file.url)
      gymState.pdfDoc   = await loadingTask.promise
      gymState.totalPages = gymState.pdfDoc.numPages
      gymState.pdfCache[fileIndex] = gymState.pdfDoc  // store in cache
    }
    await gymCachePageLabels(fileIndex, gymState.pdfDoc)  // cache printed→scan label map

    document.getElementById('gym-pdf-prev').disabled = false
    document.getElementById('gym-pdf-next').disabled = false
    document.getElementById('gym-pdf-hint').textContent = 'Drag to annotate in "Flag Area" mode'
    gymGoToPage(Math.min(goToPage, gymState.totalPages))
  } catch (err) {
    console.error('[gym PDF]', err)
    document.getElementById('gym-pdf-hint').textContent = 'Could not load PDF: ' + err.message
  }
}

async function gymGoToPage(pageNum) {
  if (!gymState.pdfDoc) return
  const total = gymState.totalPages
  pageNum = Math.max(1, Math.min(pageNum, total))
  gymState.currentPage = pageNum
  document.getElementById('gym-pdf-pageinfo').textContent = `${pageNum} / ${total}`
  document.getElementById('gym-pdf-prev').disabled = pageNum <= 1
  document.getElementById('gym-pdf-next').disabled = pageNum >= total

  try {
    const page  = await gymState.pdfDoc.getPage(pageNum)
    const scale = 1.4
    const vp    = page.getViewport({ scale })

    // Render to offscreen canvas first — eliminates blank flash on the display canvas
    const offscreen = document.createElement('canvas')
    offscreen.width  = vp.width
    offscreen.height = vp.height
    await page.render({ canvasContext: offscreen.getContext('2d'), viewport: vp }).promise

    // Swap onto the visible canvas in one synchronous step — instant, no flicker
    const canvas = document.getElementById('gym-pdf-canvas')
    canvas.width  = vp.width
    canvas.height = vp.height
    canvas.getContext('2d').drawImage(offscreen, 0, 0)
  } catch (err) {
    console.error('[gym render page]', err)
  }
}

document.getElementById('gym-pdf-prev').addEventListener('click', () => gymGoToPage(gymState.currentPage - 1))
document.getElementById('gym-pdf-next').addEventListener('click', () => gymGoToPage(gymState.currentPage + 1))

// ── Document folder browser ────────────────────────────────
function gymRenderDocDrawer() {
  const inner = document.getElementById('gym-doc-drawer-inner')
  if (!inner) return

  // Count findings per doc for the badge
  const findingsByDoc = {}
  gymState.findings.forEach(f => {
    const loc = gymParseEvidenceLocation(f.evidence)
    findingsByDoc[loc.docIdx] = (findingsByDoc[loc.docIdx] || 0) + 1
  })

  inner.innerHTML = gymState.files.map((file, i) => {
    const ext = file.name.split('.').pop().toLowerCase()
    const icon = ext === 'pdf' ? '📄' : (ext === 'docx' || ext === 'doc') ? '📝' : '📃'
    const isActive = i === gymState.currentDocIdx
    const fCount = findingsByDoc[i] || 0
    const shortName = file.name.replace(/\.[^.]+$/, '') // strip extension
    return `
    <div class="gym-doc-tile${isActive ? ' active' : ''}" data-docidx="${i}" title="${escHtml(file.name)}">
      <span class="gym-doc-tile-icon">${icon}</span>
      <span class="gym-doc-tile-name">${escHtml(shortName)}</span>
      ${fCount ? `<span class="gym-doc-tile-findings">⚠️ ${fCount}</span>` : ''}
    </div>`
  }).join('')

  inner.querySelectorAll('.gym-doc-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const idx = parseInt(tile.dataset.docidx)
      gymLoadDoc(idx, 1)
      gymToggleDocDrawer(false)

      // Find the first finding that belongs to this doc and jump to it
      const firstFindingIdx = gymState.findings.findIndex(f => {
        const loc = gymParseEvidenceLocation(f.evidence)
        return loc.docIdx === idx
      })
      if (firstFindingIdx !== -1) {
        // Highlight the card in the left panel
        const card = document.getElementById(`gym-card-${gymState.findings[firstFindingIdx].id}`)
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Brief flash so it’s obvious which one was selected
          card.classList.add('gym-card-flash')
          setTimeout(() => card.classList.remove('gym-card-flash'), 1200)
        }
      }
    })
  })
}

function gymToggleDocDrawer(forceOpen) {
  const drawer = document.getElementById('gym-doc-drawer')
  const btn    = document.getElementById('gym-folder-btn')
  const isOpen = !drawer.classList.contains('hidden')
  const open   = forceOpen !== undefined ? forceOpen : !isOpen

  if (open) {
    drawer.classList.remove('hidden')
    btn.classList.add('open')
    gymRenderDocDrawer()
    // Scroll active tile into view
    setTimeout(() => {
      const active = drawer.querySelector('.gym-doc-tile.active')
      if (active) active.scrollIntoView({ inline: 'center', behavior: 'smooth' })
    }, 50)
  } else {
    drawer.classList.add('hidden')
    btn.classList.remove('open')
  }
}

document.getElementById('gym-folder-btn').addEventListener('click', () => gymToggleDocDrawer())

// Close drawer when clicking outside
document.addEventListener('click', e => {
  const drawer = document.getElementById('gym-doc-drawer')
  const btn    = document.getElementById('gym-folder-btn')
  if (!drawer || drawer.classList.contains('hidden')) return
  if (!drawer.contains(e.target) && !btn.contains(e.target)) {
    gymToggleDocDrawer(false)
  }
})

document.getElementById('gym-findings-scroll')?.addEventListener('wheel', () => {}, { passive: true })

// ── Annotation (Flag Area) ─────────────────────────────────
let _gymAnnoDrawing = false
let _gymAnnoX0 = 0, _gymAnnoY0 = 0

document.getElementById('gym-flag-btn').addEventListener('click', () => {
  gymState.annotating = !gymState.annotating
  const btn     = document.getElementById('gym-flag-btn')
  const overlay = document.getElementById('gym-anno-overlay')
  if (gymState.annotating) {
    btn.classList.add('active')
    btn.textContent = '✏️ Cancel Flag'
    overlay.classList.add('active')
    toast('Drag a rectangle over the area Todd missed', 'info')
  } else {
    btn.classList.remove('active')
    btn.textContent = '✏️ Flag Area'
    overlay.classList.remove('active')
    document.getElementById('gym-anno-rect').classList.add('hidden')
  }
})

const _gymOverlay = document.getElementById('gym-anno-overlay')
const _gymRect    = document.getElementById('gym-anno-rect')

_gymOverlay.addEventListener('mousedown', e => {
  if (!gymState.annotating) return
  _gymAnnoDrawing = true
  const r = _gymOverlay.getBoundingClientRect()
  _gymAnnoX0 = e.clientX - r.left
  _gymAnnoY0 = e.clientY - r.top
  _gymRect.style.left   = _gymAnnoX0 + 'px'
  _gymRect.style.top    = _gymAnnoY0 + 'px'
  _gymRect.style.width  = '0px'
  _gymRect.style.height = '0px'
  _gymRect.classList.remove('hidden')
})

_gymOverlay.addEventListener('mousemove', e => {
  if (!_gymAnnoDrawing) return
  const r = _gymOverlay.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  const left   = Math.min(_gymAnnoX0, x)
  const top    = Math.min(_gymAnnoY0, y)
  const width  = Math.abs(x - _gymAnnoX0)
  const height = Math.abs(y - _gymAnnoY0)
  _gymRect.style.left   = left   + 'px'
  _gymRect.style.top    = top    + 'px'
  _gymRect.style.width  = width  + 'px'
  _gymRect.style.height = height + 'px'
})

function _gymFinishDraw(clientX, clientY) {
  if (!_gymAnnoDrawing) return
  _gymAnnoDrawing = false

  const overlayRect = _gymOverlay.getBoundingClientRect()
  const x1 = Math.min(_gymAnnoX0, clientX - overlayRect.left)
  const y1 = Math.min(_gymAnnoY0, clientY - overlayRect.top)
  const w  = Math.abs((clientX - overlayRect.left) - _gymAnnoX0)
  const h  = Math.abs((clientY - overlayRect.top)  - _gymAnnoY0)
  if (w < 10 || h < 10) { _gymRect.classList.add('hidden'); return }

  // ── Crop the exact area from the live PDF canvas ──────────
  // The overlay wraps the canvas directly (same parent, inset:0 → overlay ≡ canvas bounds).
  // Drag coords are relative to overlay top-left which equals canvas top-left → offset = 0.
  const canvasEl = document.getElementById('gym-pdf-canvas')
  const cr = canvasEl.getBoundingClientRect()

  // Overlay sits directly on canvas; compute residual offset (should be ~0)
  const canvasOffX = cr.left - overlayRect.left
  const canvasOffY = cr.top  - overlayRect.top

  // Scale: canvas internal pixel size vs its displayed CSS pixel size
  const scaleX = canvasEl.width  / cr.width
  const scaleY = canvasEl.height / cr.height

  // Map rectangle from overlay-space → canvas internal pixel space
  const cx = Math.max(0, (x1 - canvasOffX) * scaleX)
  const cy = Math.max(0, (y1 - canvasOffY) * scaleY)
  const cw = Math.min(w * scaleX, canvasEl.width  - cx)
  const ch = Math.min(h * scaleY, canvasEl.height - cy)

  // Crop to an offscreen canvas and export as PNG data URL
  let cropDataUrl = null
  if (cw > 4 && ch > 4) {
    const offscreen = document.createElement('canvas')
    offscreen.width  = Math.round(cw)
    offscreen.height = Math.round(ch)
    const ctx = offscreen.getContext('2d')
    ctx.drawImage(canvasEl, cx, cy, cw, ch, 0, 0, offscreen.width, offscreen.height)
    cropDataUrl = offscreen.toDataURL('image/png')
  }

  // Normalised coords (0–1) so they’re resolution-independent
  const normRect = {
    x: cx / canvasEl.width,
    y: cy / canvasEl.height,
    w: cw / canvasEl.width,
    h: ch / canvasEl.height,
  }

  const file = gymState.files[gymState.currentDocIdx]
  gymState.pendingAnno = {
    docIdx:      gymState.currentDocIdx,
    docName:     file ? file.name : 'Unknown',
    pageNum:     gymState.currentPage,
    cropDataUrl,   // base64 PNG of the flagged area
    normRect,      // normalised position on the page (for AI context)
  }

  // Turn off annotation mode
  gymState.annotating = false
  document.getElementById('gym-flag-btn').classList.remove('active')
  document.getElementById('gym-flag-btn').textContent = '✏️ Flag Area'
  _gymOverlay.classList.remove('active')
  _gymRect.classList.add('hidden')

  // Show crop preview in the modal before user adds comment
  const preview = document.getElementById('gym-anno-crop-preview')
  if (preview) {
    if (cropDataUrl) {
      preview.src = cropDataUrl
      preview.classList.remove('hidden')
    } else {
      preview.classList.add('hidden')
    }
  }

  document.getElementById('gym-annotation-comment').value = ''
  document.getElementById('gym-annotation-modal').classList.remove('hidden')
}

_gymOverlay.addEventListener('mouseup', e => _gymFinishDraw(e.clientX, e.clientY))

// fallback: release outside overlay still finishes the draw
window.addEventListener('mouseup', e => {
  if (_gymAnnoDrawing) _gymFinishDraw(e.clientX, e.clientY)
})

document.getElementById('gym-annotation-cancel').addEventListener('click', () => {
  document.getElementById('gym-annotation-modal').classList.add('hidden')
  gymState.pendingAnno = null
})

document.getElementById('gym-annotation-submit').addEventListener('click', () => {
  const comment = document.getElementById('gym-annotation-comment').value.trim()
  if (!comment) { toast('Please describe what Todd missed', 'error'); return }
  const ann = { ...gymState.pendingAnno, comment }
  gymState.annotations.push(ann)
  document.getElementById('gym-annotation-modal').classList.add('hidden')
  gymState.pendingAnno = null
  renderGymAnnotations()
  gymUpdateReviewStatus()
  toast('Annotation added ✓', 'success')
})

function renderGymAnnotations() {
  const scroll = document.getElementById('gym-annotations-scroll')
  const empty  = document.getElementById('gym-anno-empty')
  if (gymState.annotations.length === 0) {
    if (empty) empty.classList.remove('hidden')
    scroll.querySelectorAll('.gym-annotation-card').forEach(c => c.remove())
    return
  }
  if (empty) empty.classList.add('hidden')
  scroll.innerHTML = gymState.annotations.map((ann, i) => `
    <div class="gym-annotation-card">
      <div class="gym-annotation-card-header">
        <span class="gym-annotation-doc">📌 ${escHtml(ann.docName)}, p.${ann.pageNum}</span>
        <button class="gym-annotation-del" data-idx="${i}">✕</button>
      </div>
      ${ann.cropDataUrl ? `<img class="gym-anno-thumb" src="${ann.cropDataUrl}" alt="flagged area" title="Click to enlarge">` : ''}
      <div class="gym-annotation-comment">${escHtml(ann.comment)}</div>
    </div>
  `).join('')

  // Click thumbnail to enlarge
  scroll.querySelectorAll('.gym-anno-thumb').forEach(img => {
    img.addEventListener('click', () => {
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out'
      const big = document.createElement('img')
      big.src = img.src
      big.style.cssText = 'max-width:90vw;max-height:90vh;border:2px solid #10B981;border-radius:4px;box-shadow:0 0 40px rgba(0,0,0,0.8)'
      overlay.appendChild(big)
      overlay.addEventListener('click', () => overlay.remove())
      document.body.appendChild(overlay)
    })
  })
  scroll.querySelectorAll('.gym-annotation-del').forEach(btn => {
    btn.addEventListener('click', () => {
      gymState.annotations.splice(parseInt(btn.dataset.idx), 1)
      renderGymAnnotations()
      gymUpdateReviewStatus()
    })
  })
}

// ── Feedback modal (wrong verdict) ────────────────────────
let _gymPendingFeedbackId = null

function gymOpenFeedbackModal(findingId) {
  _gymPendingFeedbackId = findingId
  const finding = gymState.findings.find(f => f.id === findingId)
  document.getElementById('gym-feedback-finding-text').textContent =
    finding ? `[${finding.checkType}] ${finding.missingDocument}` : ''
  document.getElementById('gym-feedback-comment').value = ''
  document.getElementById('gym-feedback-modal').classList.remove('hidden')
}

document.getElementById('gym-feedback-cancel').addEventListener('click', () => {
  document.getElementById('gym-feedback-modal').classList.add('hidden')
  _gymPendingFeedbackId = null
})

document.getElementById('gym-feedback-submit').addEventListener('click', () => {
  const comment = document.getElementById('gym-feedback-comment').value.trim()
  if (_gymPendingFeedbackId) gymSetVerdict(_gymPendingFeedbackId, 'wrong', comment)
  document.getElementById('gym-feedback-modal').classList.add('hidden')
  _gymPendingFeedbackId = null
})

document.getElementById('gym-feedback-partial').addEventListener('click', () => {
  const comment = document.getElementById('gym-feedback-comment').value.trim()
  if (_gymPendingFeedbackId) gymSetVerdict(_gymPendingFeedbackId, 'partial', comment)
  document.getElementById('gym-feedback-modal').classList.add('hidden')
  _gymPendingFeedbackId = null
})

// ── Analysis Workout submit ────────────────────────────────
document.getElementById('gym-submit-btn').addEventListener('click', async () => {
  const btn = document.getElementById('gym-submit-btn')
  btn.disabled = true
  btn.textContent = '⏳ Compiling...'

  const feedbacksArr = gymFeedbacksArray()

  try {
    const res = await fetch(sameOriginApi('/api/gym/workout-feedback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId:   state.sessionId,
        tenantId:    gymState.tenantId || document.getElementById('gym-select').value,
        findings:    gymState.findings,
        feedbacks:   feedbacksArr,
        annotations: gymAnnotationsForPayload(),
        ...cheapJsonExtra()
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Workout failed')
    gymShowResults(data)
  } catch (err) {
    toast('Workout error: ' + err.message, 'error')
    btn.disabled = false
    btn.textContent = '💪 Analysis Workout'
  }
})

function gymShowResults(data) {
  gymShowPanel('results')
  document.getElementById('gym-skip-btn').classList.add('hidden')
  document.getElementById('gym-subtitle').textContent = 'Workout complete!'

  // Draw victory Todd on result canvas
  const rc = document.getElementById('gym-result-canvas')
  if (rc) drawFrame(rc, VIC1)

  document.getElementById('gym-results-summary').textContent = data.summary || 'Workout feedback compiled.'

  const list     = document.getElementById('gym-learnings-list')
  const learnings = data.learnings || []

  if (learnings.length === 0) {
    list.innerHTML = '<p class="gym-no-learnings">✅ No new learnings — all findings were correct! Todd is already nailing it.</p>'
    return
  }

  list.innerHTML = learnings.map(l => `
    <div class="gym-learning-card" id="gym-learning-${l.id}">
      <div class="gym-learning-top">
        <span class="gym-learning-check">${l.checkType}</span>
        <span class="gym-learning-confidence confidence-${l.confidence}">${l.confidence}</span>
      </div>
      <div class="gym-learning-suggestion">${escHtml(l.suggestion)}</div>
      <div class="gym-learning-rationale">${escHtml(l.rationale || '')}</div>
      <div class="gym-learning-activate">
        <label class="gym-activate-toggle">
          <input type="checkbox" class="gym-activate-cb" data-id="${l.id}" />
          <span class="gym-activate-slider"></span>
        </label>
        <span class="gym-activate-label">Activate for Juice hunts &amp; Beefed-Up Todd</span>
      </div>
    </div>
  `).join('')

  list.querySelectorAll('.gym-activate-cb').forEach(cb => {
    cb.addEventListener('change', async () => {
      try {
        await fetch(sameOriginApi(`/api/gym/learnings/${cb.dataset.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: cb.checked })
        })
        toast(cb.checked ? '✅ Learning activated' : 'Learning deactivated', 'success')
        await prefetchLearningsCount()
        refreshHuntJarSprite()
        await refreshJuiceHomePanel()
      } catch {
        toast('Could not save — try again', 'error')
        cb.checked = !cb.checked
      }
    })
  })
}

document.getElementById('gym-results-back').addEventListener('click', () => {
  gymOpenPicker()
})

// ── Speaker / Mute toggle ────────────────────────────────────
document.getElementById('btn-sfx-toggle')?.addEventListener('click', sfxToggleMute)
updateSpeakerIcon()

// ── Patient Turtle Animation ─────────────────────────────────
;(function initPatientTurtles() {
  const PATIENCE_MSG = 'be like todd... patient... this will take a minute or three or four...'

  // ── Draw turtle using explicit canvas shapes (no pixel arrays) ──────
  // This gives clean, recognizable turtle geometry at any scale.
  // Turtle faces RIGHT. All coordinates are in "turtle pixels" (tp).
  // Everything is scaled by S before drawing.

  function drawTurtle(ctx, frame) {
    const S = 4          // display scale
    const W = 100, H = 70
    const bob = frame === 1 ? S : 0   // cute 1-pixel bob on alternate frame
    ctx.clearRect(0, 0, W, H)

    // ── helpers ──────────────────────────────────────────────
    // Draw a filled rectangle in turtle-pixel coords
    function r(tx, ty, tw, th, color) {
      ctx.fillStyle = color
      ctx.fillRect(tx * S, ty * S + bob, tw * S, th * S)
    }

    // ── Colors ───────────────────────────────────────────────
    const OUTLINE = '#1a0800'
    const SHAD    = '#3d1800'
    const DARK    = '#6b3010'
    const MID     = '#9e5020'
    const WARM    = '#c87030'
    const LITE    = '#e09040'
    const GOLD    = '#f0b848'
    const TEAL_D  = '#1a4a38'
    const TEAL    = '#38886a'
    const TEAL_L  = '#60c090'
    const EYE     = '#0a0808'
    const ORANGE  = '#d07010'

    // ── SHELL ────────────────────────────────────────────────
    // Dome oval: wider in the middle, narrow top & bottom.
    // Each row: [startX, width, fillColor]
    // Shell is 16tp wide × 13tp tall, anchored at x=0
    const shellRows = [
      [ 3, 10, GOLD ],   // r0 — golden top arc (narrow)
      [ 2, 12, GOLD ],   // r1 — golden arc widens
      [ 1, 14, LITE ],   // r2 — light brown
      [ 0, 16, MID  ],   // r3 — first full-width row (SCUTE DIVIDER painted over)
      [ 0, 16, WARM ],   // r4 — main shell
      [ 0, 16, WARM ],   // r5 — main shell
      [ 0, 16, MID  ],   // r6 — (SCUTE DIVIDER painted over)
      [ 0, 16, MID  ],   // r7 — lower shell
      [ 0, 16, DARK ],   // r8 — darkening belly
      [ 1, 14, DARK ],   // r9
      [ 2, 12, SHAD ],   // r10
      [ 3, 10, SHAD ],   // r11
    ]
    // Fill shell bands
    for (let i = 0; i < shellRows.length; i++) {
      const [sx, sw, col] = shellRows[i]
      r(sx, i, sw, 1, col)
    }

    // Shell outline (left + right edges per row)
    for (let i = 0; i < shellRows.length; i++) {
      const [sx, sw] = shellRows[i]
      r(sx - 1, i, 1, 1, OUTLINE)   // left edge
      r(sx + sw, i, 1, 1, OUTLINE)  // right edge
    }
    // Top and bottom outline rows
    r(3, -1, 10, 1, OUTLINE)   // top edge
    r(3, 12, 10, 1, OUTLINE)   // bottom edge

    // ── SCUTE PATTERN (dark lines painted over shell fill) ────
    // Two horizontal dividers
    r(1, 3, 14, 1, OUTLINE)   // top scute divider
    r(1, 7, 14, 1, SHAD)      // middle scute divider (slightly lighter so shell reads)
    // Four vertical scute lines (top section cols 5 & 10; bottom cols 4,8,12)
    r(5,  0, 1, 3, SHAD)   // top-left vertical
    r(10, 0, 1, 3, SHAD)   // top-right vertical
    r(4,  4, 1, 3, SHAD)   // mid-left vertical
    r(9,  4, 1, 3, SHAD)   // mid-center vertical
    r(13, 4, 1, 3, SHAD)   // mid-right vertical
    r(5,  8, 1, 4, SHAD)   // bot-left vertical
    r(11, 8, 1, 4, SHAD)   // bot-right vertical

    // ── HEAD (right side, rows 2–5) ──────────────────────────
    // Neck connector
    r(16, 3, 2, 3, TEAL_D)
    // Head blob
    r(17, 1, 4, 1, TEAL_D)   // top of head
    r(17, 2, 5, 3, TEAL)     // main head
    r(17, 5, 3, 1, TEAL_D)   // chin
    // Head outline
    r(16, 1, 1, 1, OUTLINE)
    r(21, 2, 1, 3, OUTLINE)  // right edge
    r(17, 0, 4, 1, OUTLINE)  // top
    r(17, 6, 3, 1, OUTLINE)  // bottom
    // Eye (black dot + orange iris)
    r(20, 2, 1, 1, ORANGE)
    r(20, 3, 1, 1, EYE)
    // Highlight spot on head
    r(18, 2, 1, 1, TEAL_L)

    // ── TAIL (left side, row 5–6, small stub) ────────────────
    r(-1, 5, 1, 2, TEAL_D)

    // ── LEGS ─────────────────────────────────────────────────
    // 4 legs: front-pair under cols 2–5, back-pair under cols 10–13
    // Frame 0: front legs angled forward, back legs angled back
    // Frame 1: swapped (alternate step) + bob already applied above
    if (frame === 0) {
      // Front-left leg
      r(2, 13, 2, 1, TEAL); r(1, 14, 2, 1, TEAL); r(0, 15, 2, 1, TEAL_D)
      // Front-right leg (slightly behind)
      r(5, 13, 2, 1, TEAL_D); r(5, 14, 1, 1, TEAL_D)
      // Back-left leg
      r(10, 13, 2, 1, TEAL_D); r(10, 14, 1, 1, TEAL_D)
      // Back-right leg
      r(12, 13, 2, 1, TEAL); r(13, 14, 2, 1, TEAL); r(14, 15, 2, 1, TEAL_D)
    } else {
      // Front-left leg (raised)
      r(1, 12, 2, 1, TEAL_D); r(2, 13, 1, 1, TEAL_D)
      // Front-right leg (planted)
      r(4, 13, 2, 1, TEAL); r(3, 14, 2, 1, TEAL); r(2, 15, 2, 1, TEAL_D)
      // Back-left leg (planted)
      r(9, 13, 2, 1, TEAL); r(8, 14, 2, 1, TEAL); r(7, 15, 2, 1, TEAL_D)
      // Back-right leg (raised)
      r(13, 12, 2, 1, TEAL_D); r(13, 13, 1, 1, TEAL_D)
    }

    // Leg outlines (tiny dark pixels at tips)
    r(0, 15, 1, 1, OUTLINE)
    r(14, 15, 1, 1, OUTLINE)
  }

  function startTurtle(canvas) {
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    let frame = 0
    function tick() {
      drawTurtle(ctx, frame)
      frame = 1 - frame
      setTimeout(tick, 400)
    }
    tick()
  }

  function startTypewriter(span) {
    let timeoutId = null
    function loop() {
      let i = 0
      span.textContent = ''
      function type() {
        if (i >= PATIENCE_MSG.length) { timeoutId = setTimeout(loop, 2400); return }
        span.textContent += PATIENCE_MSG[i++]
        timeoutId = setTimeout(type, 52)
      }
      type()
    }
    loop()
  }

  document.querySelectorAll('.todd-patience-wrap').forEach(wrap => {
    const canvas = wrap.querySelector('.patience-turtle')
    const span   = wrap.querySelector('.patience-text')
    if (canvas) startTurtle(canvas)
    if (span)   startTypewriter(span)
  })
})();
