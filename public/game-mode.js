// ═══════════════════════════════════════════════════════════
// GAME MODE — 8-bit arena mini-game that runs while Todd hunts
// ═══════════════════════════════════════════════════════════
;(function () {

  // ── Extend arenaAnim with game-mode state ──────────────────
  Object.assign(arenaAnim, {
    gm:              false,
    gmHearts:        3,
    gmMaxHearts:     3,
    gmScore:         0,
    gmToddX:         ARENA_TODD_X,   // moveable x position
    gmMoveLeft:      false,
    gmMoveRight:     false,
    gmSwing:         false,
    gmSwingF:        0,
    gmSwingTick:     0,
    gmCooldown:      0,
    gmGameOver:      false,
    gmGameOverTick:  0,
    gmHitFlash:      0,
    gmKillFlash:     0,
  })

  // ── Constants ───────────────────────────────────────────────
  const GM_SWORD_OFFSET = ARENA_TODD_REACH - ARENA_TODD_X  // 56px — sword reach relative to Todd
  const GM_BODY_OFFSET  = 8 * ARENA_TPS                    // 32px — body hit zone relative to Todd
  const GM_MIN_X        = 2
  const GM_MAX_X        = 130    // can't chase enemies too far right
  const GM_MOVE_SPEED   = 2      // px per tick
  const GM_FRAME_T      = 4      // ticks per swing frame
  const GM_COOLDOWN     = 20
  const GM_SPEED        = 0.5    // extra enemy speed

  // Star positions (match app.js drawArena)
  const STAR_POS = [50,7,140,13,270,4,400,10,530,6,660,15,780,3,900,11,1020,8,1140,5]

  // ── SFX helpers ─────────────────────────────────────────────
  function _note(freq, t, dur, type, vol) {
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (!_sfxCtx) return
    const g = _sfxCtx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    const o = _sfxCtx.createOscillator()
    o.type = type; o.frequency.setValueAtTime(freq, t)
    o.connect(g); g.connect(_sfxCtx.destination)
    o.start(t); o.stop(t + dur + 0.05)
  }
  function _sfxResumeFn() { if (_sfxCtx && _sfxCtx.state === 'suspended') _sfxCtx.resume() }

  function sfxSword() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    _sfxResumeFn()
    const t = _sfxCtx.currentTime
    _note(1047, t,       0.03, 'square',   0.14)
    _note(784,  t+0.03,  0.03, 'square',   0.11)
    _note(523,  t+0.06,  0.05, 'sawtooth', 0.09)
  }
  function sfxStep() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    _sfxResumeFn()
    const t = _sfxCtx.currentTime
    _note(110, t, 0.03, 'square', 0.06)
  }
  function sfxHitPlayer() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    _sfxResumeFn()
    const t = _sfxCtx.currentTime
    _note(110, t,      0.08, 'sawtooth', 0.22)
    _note(82,  t+0.09, 0.14, 'sawtooth', 0.17)
  }
  function sfxKillEnemy(multi) {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    _sfxResumeFn()
    const t = _sfxCtx.currentTime
    const base = multi > 1 ? 659 : 523
    _note(base,     t,      0.04, 'square', 0.12)
    _note(base*1.5, t+0.04, 0.07, 'square', 0.12)
    if (multi > 1) _note(base*2, t+0.1, 0.09, 'square', 0.11)
  }
  function sfxGameOverSound() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    _sfxResumeFn()
    const t = _sfxCtx.currentTime
    _note(440, t,      0.14, 'sawtooth', 0.14)
    _note(392, t+0.15, 0.14, 'sawtooth', 0.14)
    _note(349, t+0.30, 0.14, 'sawtooth', 0.14)
    _note(294, t+0.45, 0.30, 'sawtooth', 0.18)
  }
  function sfxRetry() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    _sfxResumeFn()
    const t = _sfxCtx.currentTime
    _note(261, t,      0.06, 'square', 0.1)
    _note(392, t+0.06, 0.06, 'square', 0.1)
    _note(523, t+0.12, 0.12, 'square', 0.12)
  }

  // ── Pixel heart renderer ─────────────────────────────────────
  function drawHeart(ctx, x, y, filled, px) {
    const body   = filled ? '#ef4444' : '#1e293b'
    const hilite = filled ? '#fca5a5' : '#334155'
    const P = [
      [0,1,1,0,1,1,0],
      [1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1],
      [0,1,1,1,1,1,0],
      [0,0,1,1,1,0,0],
      [0,0,0,1,0,0,0],
    ]
    for (let r = 0; r < P.length; r++)
      for (let c = 0; c < P[r].length; c++)
        if (P[r][c]) {
          ctx.fillStyle = (filled && r === 0 && c <= 2) ? hilite : body
          ctx.fillRect(x + c * px, y + r * px, px, px)
        }
  }

  // ── Floating score pop text ──────────────────────────────────
  const gmPops = []
  function addPop(x, y, txt, color) {
    gmPops.push({ x, y, txt, tick: 0, color: color || '#fbbf24' })
  }

  // ── Patch updateArena ─────────────────────────────────────────
  const _origUpdate = window.updateArena
  window.updateArena = function () {
    const a = arenaAnim
    if (!a.gm) { _origUpdate(); return }

    a.tick++
    if (a.victory) { _origUpdate(); return }

    // Game over — drain animals + wait for retry
    if (a.gmGameOver) {
      a.gmGameOverTick++
      for (const en of a.animals) { if (!en.dying) en.dying = true; en.deathTick++ }
      a.animals = a.animals.filter(en => en.deathTick < 20)
      return
    }

    // Flash timers
    if (a.gmHitFlash  > 0) a.gmHitFlash--
    if (a.gmKillFlash > 0) a.gmKillFlash--

    // Pop text aging
    for (const p of gmPops) p.tick++
    gmPops.splice(0, gmPops.length, ...gmPops.filter(p => p.tick < 28))

    // ── Movement ─────────────────────────────────────────────
    const wasMoving = a.gmMoveLeft || a.gmMoveRight
    if (a.gmMoveLeft)  a.gmToddX = Math.max(GM_MIN_X,  a.gmToddX - GM_MOVE_SPEED)
    if (a.gmMoveRight) a.gmToddX = Math.min(GM_MAX_X, a.gmToddX + GM_MOVE_SPEED)
    // Footstep sound every 12 ticks while moving
    if (wasMoving && a.tick % 12 === 0) sfxStep()

    // Dynamic hit zones (follow Todd)
    const bodyHitX   = a.gmToddX + GM_BODY_OFFSET
    const strikeZone = a.gmToddX + GM_SWORD_OFFSET + 10

    // ── Swing animation ──────────────────────────────────────
    if (a.gmSwing) {
      if (++a.gmSwingTick >= GM_FRAME_T) {
        a.gmSwingTick = 0
        a.gmSwingF++
        if (a.gmSwingF === 2) {
          // STRIKE FRAME
          let killed = 0
          for (const en of a.animals) {
            if (!en.dying && en.x <= strikeZone) { en.dying = true; killed++ }
          }
          if (killed) {
            a.gmScore += killed
            a.gmKillFlash = 10
            addPop(strikeZone - 10, 30, killed > 1 ? `${killed}x COMBO!` : '+1', killed > 1 ? '#f97316' : '#fbbf24')
            sfxKillEnemy(killed)
            updateScoreDisplay()
          }
        }
        if (a.gmSwingF >= 4) { a.gmSwing = false; a.gmSwingF = 0; a.gmCooldown = GM_COOLDOWN }
      }
      a.toddF = a.gmSwingF
    } else {
      // Walk cycle when moving (use frames 0→1 alternating), idle at 0
      if (wasMoving) {
        a.toddF = Math.floor(a.tick / 10) % 2 === 0 ? 0 : 3
      } else {
        a.toddF = 0
      }
      if (a.gmCooldown > 0) a.gmCooldown--
    }

    // ── Spawn (faster in game mode) ──────────────────────────
    const canvas = document.getElementById('arena-canvas')
    const W = canvas ? canvas.width : 800
    if (--a.spawnIn <= 0 && a.animals.filter(x => !x.dying).length < 7) {
      const def = ARENA_DEFS[Math.floor(Math.random() * ARENA_DEFS.length)]
      a.animals.push({ def, x: W + def.w * def.ps, bob: 0, bobDir: 1, dying: false, deathTick: 0, moveTick: 0 })
      a.spawnIn = 12 + Math.floor(Math.random() * 25)
    }

    // ── Move enemies + body-hit detection ────────────────────
    for (const en of a.animals) {
      if (en.dying) { en.deathTick++; continue }
      en.x -= (en.def.speed + GM_SPEED)
      en.moveTick++
      if (en.moveTick % 10 === 0) { en.bob += en.bobDir; if (en.bob >= 1 || en.bob <= 0) en.bobDir *= -1 }
      if (en.x <= bodyHitX) {
        en.dying = true
        a.gmHearts--
        a.gmHitFlash = 22
        addPop(bodyHitX + 4, 30, '-1 ♥', '#ef4444')
        sfxHitPlayer()
        if (a.gmHearts <= 0) { a.gmHearts = 0; a.gmGameOver = true; sfxGameOverSound() }
      }
    }

    a.animals = a.animals.filter(en => !en.dying || en.deathTick < 16)
  }

  // ── Patch drawArena ───────────────────────────────────────────
  // In game mode we own the full draw so Todd renders at gmToddX.
  // Non-game-mode falls through to the original unchanged.
  const _origDraw = window.drawArena
  window.drawArena = function () {
    const a = arenaAnim
    if (!a.gm) { _origDraw(); return }

    const canvas = document.getElementById('arena-canvas')
    if (!canvas) return
    const ctx  = canvas.getContext('2d')
    const W    = canvas.width
    const H    = canvas.height
    const GY   = H - 18
    const TPS  = ARENA_TPS
    const TX   = a.gmToddX          // Todd's current x
    const TR   = TX + GM_SWORD_OFFSET   // sword reach

    // ── Background ────────────────────────────────────────────
    ctx.fillStyle = '#07091A'
    ctx.fillRect(0, 0, W, H)

    ctx.fillStyle = '#0C1124'
    for (let x = 0; x < W; x += 12) ctx.fillRect(x, 0, 1, GY)
    for (let y = 0; y < GY; y += 12) ctx.fillRect(0, y, W, 1)

    // Stars (twinkling)
    for (let i = 0; i < STAR_POS.length - 1; i += 2) {
      const sx = STAR_POS[i], sy = STAR_POS[i+1]
      if (sx >= W) continue
      ctx.fillStyle = Math.sin(a.tick * 0.04 + i) > 0 ? '#FFFFFF' : '#1E3A5F'
      ctx.fillRect(sx, sy, 1, 1)
    }

    // Ground
    ctx.fillStyle = '#1E3A5F'
    ctx.fillRect(0, GY, W, 2)
    ctx.fillStyle = '#0F1B2D'
    ctx.fillRect(0, GY + 2, W, H - GY - 2)
    ctx.fillStyle = '#243B55'
    const gScroll = (a.tick * 1.5) % 24
    for (let x = -(24 - gScroll % 24); x < W; x += 24) ctx.fillRect(Math.round(x), GY, 1, 2)

    // ── Enemies ───────────────────────────────────────────────
    for (const en of a.animals) {
      const ax = Math.round(en.x)
      const ay = GY - en.def.h * en.def.ps + (en.def.fy || 0) + en.bob
      if (en.dying) {
        ctx.globalAlpha = Math.max(0, 1 - en.deathTick / 14)
        if (en.deathTick % 4 < 2) {
          ctx.fillStyle = '#FCD34D'
          ctx.fillRect(ax - 2, ay - 2, en.def.w * en.def.ps + 4, en.def.h * en.def.ps + 4)
        }
        drawSpriteAt(ctx, en.def.d, ax, ay, en.def.ps)
        ctx.globalAlpha = 1
      } else {
        drawSpriteAt(ctx, en.def.s, ax, ay, en.def.ps)
      }
    }

    // ── Todd at gmToddX ───────────────────────────────────────
    const FRAME_BOB  = [0, -4, 0, 3]
    const toddSprite = ARENA_ATTACKS[a.toddF]
    const toddY      = GY - toddSprite.length * TPS + FRAME_BOB[a.toddF]
    const tf         = a.toddF
    const P          = TPS

    drawSpriteAt(ctx, toddSprite, TX, toddY, TPS)

    // Sword trail (uses TX instead of fixed TODD_X)
    if (tf === 1) {
      ctx.globalAlpha = 0.6
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TX + 10*P, toddY + 1*P, P, P)
      ctx.fillRect(TX + 11*P, toddY + 2*P, P, P)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(TX + 11*P, toddY + 1*P, P, P)
      ctx.globalAlpha = 1
    } else if (tf === 2) {
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(TX + 11*P, toddY + 5*P, 7*P, 2)
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TX + 11*P, toddY + 5*P + 2, 6*P, 2)
      ctx.fillRect(TX + 11*P, toddY + 4*P, 3*P, 2)
      ctx.globalAlpha = 1
    } else if (tf === 3) {
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TX + 11*P, toddY + 7*P, P, P)
      ctx.fillRect(TX + 12*P, toddY + 8*P, P, P)
      ctx.fillRect(TX + 13*P, toddY + 9*P, P, P)
      ctx.globalAlpha = 1
    }

    // Sword impact flash near enemy
    const close = a.animals.some(en => !en.dying && en.x < TR + 20)
    if (close && a.tick % 6 < 3) {
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TR - 2, GY - 20, 10, 3)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(TR + 3, GY - 20, 5, 3)
    }

    // ── Movement direction indicator ─────────────────────────
    if (a.gmMoveLeft || a.gmMoveRight) {
      ctx.globalAlpha = 0.55
      ctx.fillStyle = '#60a5fa'
      ctx.font = '7px "Press Start 2P", monospace'
      ctx.textBaseline = 'top'
      ctx.textAlign = 'center'
      ctx.fillText(a.gmMoveLeft ? '◀' : '▶', TX + 7*P, toddY - 10)
      ctx.globalAlpha = 1
    }

    // ── Screen flash overlays ─────────────────────────────────
    if (a.gmHitFlash > 0) {
      ctx.fillStyle = `rgba(220,38,38,${(a.gmHitFlash / 22) * 0.38})`
      ctx.fillRect(0, 0, W, H)
    }
    if (a.gmKillFlash > 0) {
      ctx.fillStyle = `rgba(251,191,36,${(a.gmKillFlash / 10) * 0.20})`
      ctx.fillRect(0, 0, W, H)
    }

    // ── HUD ───────────────────────────────────────────────────
    ctx.font = '7px "Press Start 2P", monospace'
    ctx.textBaseline = 'top'

    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#7c3aed'
    ctx.textAlign = 'left'
    ctx.fillText('GAME MODE', 4, 4)
    ctx.globalAlpha = 1

    ctx.fillStyle = '#fbbf24'
    ctx.textAlign = 'center'
    ctx.fillText('\u2605 ' + a.gmScore, W / 2, 4)

    // Hearts
    const heartPx = 2
    const heartW  = 7 * heartPx + 4
    const hx0     = W - a.gmMaxHearts * heartW - 4
    for (let i = 0; i < a.gmMaxHearts; i++) {
      if (i < a.gmHearts && a.gmHitFlash > 0 && a.gmHitFlash % 6 < 3) ctx.globalAlpha = 0.3
      drawHeart(ctx, hx0 + i * heartW, 4, i < a.gmHearts, heartPx)
      ctx.globalAlpha = 1
    }

    // Floating pop text
    ctx.font = '7px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    for (const pop of gmPops) {
      ctx.globalAlpha = Math.max(0, 1 - pop.tick / 28)
      ctx.fillStyle = pop.color
      ctx.fillText(pop.txt, pop.x, pop.y - pop.tick * 0.7)
    }
    ctx.globalAlpha = 1

    // "A!" swing prompt (blinks when enemy is close + ready to swing)
    if (!a.gmSwing && !a.gmGameOver && a.gmCooldown === 0) {
      const danger = a.animals.some(en => !en.dying && en.x < W * 0.65)
      if (danger && a.tick % 28 < 20) {
        ctx.globalAlpha = 0.9
        ctx.fillStyle = '#4ade80'
        ctx.font = '6px "Press Start 2P", monospace'
        ctx.textAlign = 'center'
        ctx.fillText('A!', TX + 10*P, toddY - 14)
        ctx.font = '7px "Press Start 2P", monospace'
        ctx.globalAlpha = 1
      }
    }

    // Swing cooldown bar above Todd
    if (a.gmCooldown > 0) {
      const bW = 32, bH = 3
      const bX = TX + 2*P
      const bY = GY - 55
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(bX, bY, bW, bH)
      ctx.fillStyle = '#7c3aed'
      ctx.fillRect(bX, bY, Math.round(bW * (1 - a.gmCooldown / GM_COOLDOWN)), bH)
    }

    // GAME OVER overlay
    if (a.gmGameOver) {
      const alpha = Math.min(1, a.gmGameOverTick / 18)
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.72})`
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = alpha
      if (a.gmGameOverTick < 8 && a.gmGameOverTick % 2 === 0) ctx.globalAlpha = 0
      ctx.fillStyle = '#ef4444'
      ctx.textAlign = 'center'
      ctx.font = '11px "Press Start 2P", monospace'
      ctx.fillText('GAME OVER', W / 2, H / 2 - 16)
      ctx.font = '6px "Press Start 2P", monospace'
      ctx.fillStyle = '#fbbf24'
      ctx.fillText('SCORE: ' + a.gmScore, W / 2, H / 2 + 2)
      if (a.gmGameOverTick > 45 && a.gmGameOverTick % 32 < 22) {
        ctx.fillStyle = '#a78bfa'
        ctx.fillText('PRESS A TO RETRY', W / 2, H / 2 + 18)
      }
      ctx.globalAlpha = 1
    }

    ctx.textAlign = 'left'
  }

  // ── Toggle game mode ──────────────────────────────────────────
  function toggleGameMode() {
    const a = arenaAnim
    if (!a.running) {
      if (typeof toast !== 'undefined') toast('Start a hunt first to play!', 'info')
      return
    }
    a.gm = !a.gm
    const btn  = document.getElementById('btn-game-mode')
    const ctrl = document.getElementById('nes-controller')
    if (a.gm) {
      resetGameState()
      ctrl?.classList.remove('hidden')
      if (btn) { btn.textContent = '✕ EXIT GAME'; btn.classList.add('gm-active') }
    } else {
      ctrl?.classList.add('hidden')
      if (btn) { btn.textContent = '🕹 GAME MODE'; btn.classList.remove('gm-active') }
      gmPops.length = 0
    }
  }

  function resetGameState() {
    const a = arenaAnim
    a.gmHearts = 3; a.gmScore = 0
    a.gmToddX = ARENA_TODD_X
    a.gmMoveLeft = false; a.gmMoveRight = false
    a.gmSwing = false; a.gmSwingF = 0; a.gmSwingTick = 0; a.gmCooldown = 0
    a.gmGameOver = false; a.gmGameOverTick = 0
    a.gmHitFlash = 0; a.gmKillFlash = 0
    a.animals = []; a.spawnIn = 10
    gmPops.length = 0
    updateScoreDisplay()
  }

  function updateScoreDisplay() {
    const el = document.getElementById('gm-score-val')
    if (el) el.textContent = arenaAnim.gmScore
  }

  // ── Swing action ──────────────────────────────────────────────
  function gameModeSwing() {
    const a = arenaAnim
    if (!a.gm || !a.running) return
    if (a.gmGameOver) { resetGameState(); sfxRetry(); return }
    if (a.victory || a.gmSwing || a.gmCooldown > 0) return
    a.gmSwing = true; a.gmSwingF = 0; a.gmSwingTick = 0
    sfxSword()
    const aBtn = document.getElementById('nes-a-btn')
    if (aBtn) { aBtn.classList.add('pressed'); setTimeout(() => aBtn.classList.remove('pressed'), 120) }
  }

  // ── Auto-exit game mode on hunt victory ───────────────────────
  setInterval(() => {
    if (arenaAnim.gm && arenaAnim.victory) {
      document.getElementById('nes-controller')?.classList.add('hidden')
      const btn = document.getElementById('btn-game-mode')
      if (btn) { btn.textContent = '🕹 GAME MODE'; btn.classList.remove('gm-active') }
      arenaAnim.gm = false; gmPops.length = 0
    }
  }, 400)

  // ── Keyboard controls ─────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!arenaAnim.gm) return
    if (e.code === 'Space') {
      e.preventDefault()
      gameModeSwing()
    } else if (e.code === 'ArrowLeft'  || e.key === 'ArrowLeft') {
      e.preventDefault()
      arenaAnim.gmMoveLeft = true
      highlightDpad('left', true)
    } else if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
      e.preventDefault()
      arenaAnim.gmMoveRight = true
      highlightDpad('right', true)
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'x' || e.key === 'X') {
      gameModeSwing()
    }
  })
  document.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft'  || e.key === 'ArrowLeft')  { arenaAnim.gmMoveLeft  = false; highlightDpad('left',  false) }
    if (e.code === 'ArrowRight' || e.key === 'ArrowRight') { arenaAnim.gmMoveRight = false; highlightDpad('right', false) }
  })

  // ── D-pad button hold (pointer events so holding works) ──────
  function bindDpad(id, dir) {
    const el = document.getElementById(id)
    if (!el) return
    const start = () => { if (arenaAnim.gm) { arenaAnim['gmMove' + dir] = true;  highlightDpad(dir.toLowerCase(), true)  } }
    const stop  = () => { arenaAnim['gmMove' + dir] = false; highlightDpad(dir.toLowerCase(), false) }
    el.addEventListener('pointerdown',  start)
    el.addEventListener('pointerup',    stop)
    el.addEventListener('pointerleave', stop)
  }
  bindDpad('nes-dpad-left-btn',  'Left')
  bindDpad('nes-dpad-right-btn', 'Right')

  function highlightDpad(dir, on) {
    const el = document.getElementById('nes-dpad-' + dir + '-btn')
    if (el) el.classList.toggle('dpad-pressed', on)
  }

  // ── A/B buttons ───────────────────────────────────────────────
  document.getElementById('nes-a-btn')?.addEventListener('click', gameModeSwing)
  document.getElementById('nes-b-btn')?.addEventListener('click', gameModeSwing)

  // Tap canvas in game mode = swing
  document.getElementById('arena-canvas')?.addEventListener('click', () => {
    if (arenaAnim.gm) gameModeSwing()
  })

  // ── Game Mode toggle button ───────────────────────────────────
  document.getElementById('btn-game-mode')?.addEventListener('click', toggleGameMode)

})()
