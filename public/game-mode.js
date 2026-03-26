// ═══════════════════════════════════════════════════════════
// GAME MODE — 8-bit arena mini-game that runs while Todd hunts
// Loaded after app.js; patches updateArena + drawArena, adds
// NES controller events, pixel HUD (hearts / score / prompts).
// ═══════════════════════════════════════════════════════════
;(function () {

  // ── Extend arenaAnim with game-mode state ──────────────────
  Object.assign(arenaAnim, {
    gm:              false,
    gmHearts:        3,
    gmMaxHearts:     3,
    gmScore:         0,
    gmSwing:         false,
    gmSwingF:        0,     // 0-3 current frame within swing
    gmSwingTick:     0,     // ticks on current swing frame
    gmCooldown:      0,     // ticks until next swing allowed
    gmGameOver:      false,
    gmGameOverTick:  0,
    gmHitFlash:      0,     // red screen flash ticks
    gmKillFlash:     0,     // gold screen flash ticks
    gmBonusScore:    0,     // multi-kill bonus accumulator
  })

  // ── Constants ───────────────────────────────────────────────
  const GM_BODY_X   = ARENA_TODD_X + 8 * ARENA_TPS // x where enemy "hits" Todd = 40px
  const GM_STRIKE_X = ARENA_TODD_REACH + 10         // sword kill zone edge = 74px
  const GM_FRAME_T  = 4                             // ticks per swing frame (snappy)
  const GM_COOLDOWN = 22                            // ticks cooldown after swing
  const GM_SPEED    = 0.5                           // extra speed bonus for enemies

  // ── 8-bit SFX (standalone — access engine vars from app.js) ─
  function _gmNote(freq, t, dur, type, vol) {
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
  function sfxSword() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (_sfxCtx.state === 'suspended') _sfxCtx.resume()
    const t = _sfxCtx.currentTime
    _gmNote(1047, t,       0.03, 'square',   0.14)
    _gmNote(784,  t+0.03,  0.03, 'square',   0.12)
    _gmNote(523,  t+0.06,  0.05, 'sawtooth', 0.09)
  }
  function sfxHitPlayer() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (_sfxCtx.state === 'suspended') _sfxCtx.resume()
    const t = _sfxCtx.currentTime
    _gmNote(110, t,      0.08, 'sawtooth', 0.22)
    _gmNote(82,  t+0.09, 0.14, 'sawtooth', 0.17)
  }
  function sfxKillEnemy(multi) {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (_sfxCtx.state === 'suspended') _sfxCtx.resume()
    const t = _sfxCtx.currentTime
    const base = multi > 1 ? 659 : 523
    _gmNote(base,      t,      0.04, 'square', 0.12)
    _gmNote(base*1.5,  t+0.04, 0.07, 'square', 0.12)
    if (multi > 1) _gmNote(base*2, t+0.1, 0.09, 'square', 0.11)
  }
  function sfxGameOverSound() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (_sfxCtx.state === 'suspended') _sfxCtx.resume()
    const t = _sfxCtx.currentTime
    _gmNote(440, t,      0.14, 'sawtooth', 0.14)
    _gmNote(392, t+0.15, 0.14, 'sawtooth', 0.14)
    _gmNote(349, t+0.30, 0.14, 'sawtooth', 0.14)
    _gmNote(294, t+0.45, 0.30, 'sawtooth', 0.18)
  }
  function sfxRetry() {
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (_sfxCtx.state === 'suspended') _sfxCtx.resume()
    const t = _sfxCtx.currentTime
    _gmNote(261, t,      0.06, 'square', 0.1)
    _gmNote(392, t+0.06, 0.06, 'square', 0.1)
    _gmNote(523, t+0.12, 0.12, 'square', 0.12)
  }

  // ── Pixel heart renderer ─────────────────────────────────────
  function drawHeart(ctx, x, y, filled, px) {
    const body    = filled ? '#ef4444' : '#1e293b'
    const hilite  = filled ? '#fca5a5' : '#334155'
    const pattern = [
      [0,1,1,0,1,1,0],
      [1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1],
      [0,1,1,1,1,1,0],
      [0,0,1,1,1,0,0],
      [0,0,0,1,0,0,0],
    ]
    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        if (!pattern[r][c]) continue
        // Tiny highlight on top-left for 3d look
        ctx.fillStyle = (filled && r === 0 && c <= 2) ? hilite : body
        ctx.fillRect(x + c * px, y + r * px, px, px)
      }
    }
  }

  // ── Score pop text (floating numbers) ────────────────────────
  const gmPops = []   // [{x,y,txt,tick,color}]
  function addPop(x, y, txt, color) {
    gmPops.push({ x, y, txt, tick: 0, color: color || '#fbbf24' })
  }

  // ── Patch updateArena ─────────────────────────────────────────
  const _origUpdate = window.updateArena
  window.updateArena = function () {
    const a = arenaAnim
    if (!a.gm) { _origUpdate(); return }

    a.tick++

    // Victory → normal victory anim (exit game mode visually but keep score)
    if (a.victory) { _origUpdate(); return }

    // Game over: just drain animals and tick
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

    // ── Swing animation ──────────────────────────────────────
    if (a.gmSwing) {
      if (++a.gmSwingTick >= GM_FRAME_T) {
        a.gmSwingTick = 0
        a.gmSwingF++

        if (a.gmSwingF === 2) {
          // ★ STRIKE FRAME — kill every enemy in sword range
          let killed = 0
          for (const en of a.animals) {
            if (!en.dying && en.x <= GM_STRIKE_X) {
              en.dying = true; killed++
            }
          }
          if (killed) {
            a.gmScore += killed
            a.gmKillFlash = 10
            // Pop text near sword tip
            const canvas = document.getElementById('arena-canvas')
            const H = canvas ? canvas.height : 120
            const GY = H - 18
            const pts = killed > 1 ? `${killed}x COMBO!` : '+1'
            const col = killed > 1 ? '#f97316' : '#fbbf24'
            addPop(GM_STRIKE_X - 10, GY - 40, pts, col)
            sfxKillEnemy(killed)
            updateScoreDisplay()
          }
        }

        if (a.gmSwingF >= 4) {
          a.gmSwing   = false
          a.gmSwingF  = 0
          a.gmCooldown = GM_COOLDOWN
        }
      }
      a.toddF = a.gmSwingF
    } else {
      a.toddF = 0   // idle / ready stance
      if (a.gmCooldown > 0) a.gmCooldown--
    }

    // ── Spawn enemies (faster in game mode) ────────────────────
    const canvas = document.getElementById('arena-canvas')
    const W = canvas ? canvas.width : 800
    if (--a.spawnIn <= 0 && a.animals.filter(x => !x.dying).length < 7) {
      const def = ARENA_DEFS[Math.floor(Math.random() * ARENA_DEFS.length)]
      a.animals.push({ def, x: W + def.w * def.ps, bob: 0, bobDir: 1, dying: false, deathTick: 0, moveTick: 0 })
      a.spawnIn = 12 + Math.floor(Math.random() * 25)   // more frequent
    }

    // ── Move + body-hit detection ───────────────────────────────
    for (const en of a.animals) {
      if (en.dying) { en.deathTick++; continue }
      en.x -= (en.def.speed + GM_SPEED)
      en.moveTick++
      if (en.moveTick % 10 === 0) {
        en.bob += en.bobDir
        if (en.bob >= 1 || en.bob <= 0) en.bobDir *= -1
      }
      // Body hit — enemy reached Todd
      if (en.x <= GM_BODY_X) {
        en.dying = true
        a.gmHearts--
        a.gmHitFlash = 22
        sfxHitPlayer()
        addPop(GM_BODY_X + 5, 30, '-1 ♥', '#ef4444')
        if (a.gmHearts <= 0) {
          a.gmHearts    = 0
          a.gmGameOver  = true
          sfxGameOverSound()
        }
      }
    }

    a.animals = a.animals.filter(en => !en.dying || en.deathTick < 16)
  }

  // ── Patch drawArena ───────────────────────────────────────────
  const _origDraw = window.drawArena
  window.drawArena = function () {
    _origDraw()
    const a = arenaAnim
    if (!a.gm) return

    const canvas = document.getElementById('arena-canvas')
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const GY = H - 18

    // ── Screen flash overlays ──────────────────────────────────
    if (a.gmHitFlash > 0) {
      ctx.fillStyle = `rgba(220,38,38,${(a.gmHitFlash / 22) * 0.38})`
      ctx.fillRect(0, 0, W, H)
    }
    if (a.gmKillFlash > 0) {
      ctx.fillStyle = `rgba(251,191,36,${(a.gmKillFlash / 10) * 0.20})`
      ctx.fillRect(0, 0, W, H)
    }

    // ── HUD labels ─────────────────────────────────────────────
    ctx.font = '7px "Press Start 2P", monospace'
    ctx.textBaseline = 'top'

    // "GAME MODE" badge (replaces HUNTING...)
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#7c3aed'
    ctx.textAlign = 'left'
    ctx.fillText('GAME MODE', 4, 4)
    ctx.globalAlpha = 1

    // Score
    ctx.fillStyle = '#fbbf24'
    ctx.textAlign = 'center'
    ctx.fillText('\u2605 ' + a.gmScore, W / 2, 4)

    // ── Hearts (top-right) ─────────────────────────────────────
    const heartPx = 2
    const heartW  = 7 * heartPx + 4   // 18px each
    const hx0     = W - a.gmMaxHearts * heartW - 4
    for (let i = 0; i < a.gmMaxHearts; i++) {
      // Pulse filled hearts when recently hit
      if (i < a.gmHearts && a.gmHitFlash > 0 && a.gmHitFlash % 6 < 3) {
        ctx.globalAlpha = 0.4
      }
      drawHeart(ctx, hx0 + i * heartW, 4, i < a.gmHearts, heartPx)
      ctx.globalAlpha = 1
    }

    // ── Floating pop text ──────────────────────────────────────
    ctx.font = '7px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    for (const p of gmPops) {
      const alpha = Math.max(0, 1 - p.tick / 28)
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color
      ctx.fillText(p.txt, p.x, p.y - p.tick * 0.7)
    }
    ctx.globalAlpha = 1

    // ── "PRESS A!" prompt when ready ───────────────────────────
    if (!a.gmSwing && !a.gmGameOver && a.gmCooldown === 0) {
      // Blinking prompt above Todd's sword area — only if enemy nearby
      const danger = a.animals.some(en => !en.dying && en.x < W * 0.65)
      if (danger) {
        const blink = a.tick % 28 < 20
        if (blink) {
          ctx.globalAlpha = 0.9
          ctx.fillStyle = '#4ade80'
          ctx.font = '6px "Press Start 2P", monospace'
          ctx.textAlign = 'center'
          ctx.fillText('A!', ARENA_TODD_X + 10 * ARENA_TPS, GY - 52)
          ctx.font = '7px "Press Start 2P", monospace'
          ctx.globalAlpha = 1
        }
      }
    }

    // ── Swing cooldown bar (above Todd) ────────────────────────
    if (a.gmCooldown > 0) {
      const bW = 32, bH = 3
      const bX = ARENA_TODD_X + 2 * ARENA_TPS
      const bY = GY - 55
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(bX, bY, bW, bH)
      ctx.fillStyle = '#7c3aed'
      const fill = Math.round(bW * (1 - a.gmCooldown / GM_COOLDOWN))
      ctx.fillRect(bX, bY, fill, bH)
    }

    // ── GAME OVER overlay ──────────────────────────────────────
    if (a.gmGameOver) {
      const alpha = Math.min(1, a.gmGameOverTick / 18)
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.72})`
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = alpha

      // Flicker on entry
      if (a.gmGameOverTick < 8 && a.gmGameOverTick % 2 === 0) {
        ctx.globalAlpha = 0
      }

      ctx.fillStyle = '#ef4444'
      ctx.textAlign = 'center'
      ctx.font = '11px "Press Start 2P", monospace'
      ctx.fillText('GAME OVER', W / 2, H / 2 - 16)

      ctx.font = '6px "Press Start 2P", monospace'
      ctx.fillStyle = '#fbbf24'
      ctx.fillText('SCORE: ' + a.gmScore, W / 2, H / 2 + 2)

      if (a.gmGameOverTick > 45) {
        const blink = a.gmGameOverTick % 32 < 22
        if (blink) {
          ctx.fillStyle = '#a78bfa'
          ctx.fillText('PRESS A TO RETRY', W / 2, H / 2 + 18)
        }
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
    a.gmHearts       = 3
    a.gmScore        = 0
    a.gmSwing        = false
    a.gmSwingF       = 0
    a.gmSwingTick    = 0
    a.gmCooldown     = 0
    a.gmGameOver     = false
    a.gmGameOverTick = 0
    a.gmHitFlash     = 0
    a.gmKillFlash    = 0
    a.animals        = []
    a.spawnIn        = 10
    gmPops.length    = 0
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

    // Retry after game over
    if (a.gmGameOver) {
      resetGameState()
      sfxRetry()
      return
    }

    if (a.victory || a.gmSwing || a.gmCooldown > 0) return

    a.gmSwing    = true
    a.gmSwingF   = 0
    a.gmSwingTick = 0
    sfxSword()

    // Visual press on A button
    const aBtn = document.getElementById('nes-a-btn')
    if (aBtn) {
      aBtn.classList.add('pressed')
      setTimeout(() => aBtn.classList.remove('pressed'), 120)
    }
  }

  // ── Also auto-exit game mode on arena victory ─────────────────
  const _origStartArena = window.startArena
  if (_origStartArena) {
    window.startArena = function () {
      _origStartArena()
      // Keep game mode state if user had it on from last hunt
    }
  }

  // Detect victory to hide controller / update button
  const _checkVictory = setInterval(() => {
    if (arenaAnim.gm && arenaAnim.victory) {
      const ctrl = document.getElementById('nes-controller')
      ctrl?.classList.add('hidden')
      const btn = document.getElementById('btn-game-mode')
      if (btn) { btn.textContent = '🕹 GAME MODE'; btn.classList.remove('gm-active') }
      arenaAnim.gm = false
      gmPops.length = 0
      clearInterval(_checkVictory)
    }
  }, 400)

  // ── Wire up button + keyboard ─────────────────────────────────
  document.getElementById('btn-game-mode')?.addEventListener('click', toggleGameMode)
  document.getElementById('nes-a-btn')?.addEventListener('click',     gameModeSwing)
  document.getElementById('nes-b-btn')?.addEventListener('click',     gameModeSwing)

  // Keyboard: Space / Z / X = A button swing
  document.addEventListener('keydown', e => {
    if (!arenaAnim.gm) return
    if (e.code === 'Space' || e.key === 'z' || e.key === 'Z' || e.key === 'x' || e.key === 'X') {
      e.preventDefault()
      gameModeSwing()
    }
  })

  // Touch support — tap anywhere on the canvas to swing
  document.getElementById('arena-canvas')?.addEventListener('click', () => {
    if (arenaAnim.gm) gameModeSwing()
  })

})()
