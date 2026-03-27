// ═══════════════════════════════════════════════════════════
// GAME MODE — full 8-bit platformer mini-game while Todd hunts
// ═══════════════════════════════════════════════════════════
;(function () {

  // ── Extend arenaAnim with game-mode state ──────────────────
  Object.assign(arenaAnim, {
    gm:             false,
    gmHearts:       3,
    gmMaxHearts:    3,
    gmScore:        0,
    gmToddX:        ARENA_TODD_X,
    gmMoveLeft:     false,
    gmMoveRight:    false,
    gmElev:         0,           // elevation above ground (px, +ve = up)
    gmVY:           0,           // vertical velocity (+ve = upward)
    gmOnGround:     true,
    gmSwing:        false,
    gmSwingF:       0,
    gmSwingTick:    0,
    gmSwingQueued:  false,       // queued swing — fires the instant current ends
    gmCooldown:     0,
    gmGameOver:     false,
    gmGameOverTick: 0,
    gmHitFlash:     0,
    gmKillFlash:    0,
    gmPlatforms:    [],
  })

  // ── Constants ──────────────────────────────────────────────
  const GM_MOVE_SPEED  = 2.5
  const GM_JUMP_VY     = 8.2    // initial jump velocity (px/tick upward)
  const GM_GRAVITY     = 0.40   // gravity (px/tick² downward)
  const GM_FRAME_T     = 4      // ticks per swing frame
  const GM_COOLDOWN    = 14     // reduced cooldown between unqueued swings
  const GM_ENEMY_SPEED = 0.55   // extra speed bonus in game mode
  const GM_MIN_X       = 2
  const PLAT_H         = 8      // platform height in canvas px
  const GM_CANVAS_H    = 220    // expanded canvas height while in game mode
  // Sword reach relative to gmToddX (same as arena: TODD_X + 14*TPS = 56px)
  const GM_SWORD_REL   = ARENA_TODD_REACH - ARENA_TODD_X   // 56
  // Body hit zone relative to gmToddX
  const GM_BODY_REL    = 8 * ARENA_TPS   // 32px from left edge of sprite

  const STAR_POS = [50,7,140,13,270,4,400,10,530,6,660,15,780,3,900,11,1020,8,1140,5]

  // ── SFX ───────────────────────────────────────────────────
  function _gm(freq, t, dur, type, vol) {
    if (typeof _sfxMuted !== 'undefined' && _sfxMuted) return
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const g = _sfxCtx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    const o = _sfxCtx.createOscillator()
    o.type = type; o.frequency.setValueAtTime(freq, t)
    o.connect(g); g.connect(_sfxCtx.destination)
    o.start(t); o.stop(t + dur + 0.05)
  }
  function _wake() { if (typeof _sfxCtx !== 'undefined' && _sfxCtx && _sfxCtx.state === 'suspended') _sfxCtx.resume() }

  function sfxSword() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(1047, t,      0.03, 'square',   0.14)
    _gm(784,  t+0.03, 0.03, 'square',   0.11)
    _gm(440,  t+0.06, 0.05, 'sawtooth', 0.09)
  }
  function sfxJump() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(330, t,      0.04, 'square', 0.09)
    _gm(523, t+0.04, 0.07, 'square', 0.09)
  }
  function sfxLand() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(110, t, 0.03, 'square', 0.07)
  }
  function sfxHitPlayer() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(110, t,      0.08, 'sawtooth', 0.22)
    _gm(82,  t+0.09, 0.14, 'sawtooth', 0.17)
  }
  function sfxKill(multi) {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    const b = multi > 1 ? 659 : 523
    _gm(b,     t,      0.04, 'square', 0.12)
    _gm(b*1.5, t+0.04, 0.07, 'square', 0.12)
    if (multi > 1) _gm(b*2, t+0.10, 0.09, 'square', 0.11)
  }
  function sfxGameOver() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(440, t,      0.14, 'sawtooth', 0.14)
    _gm(392, t+0.15, 0.14, 'sawtooth', 0.14)
    _gm(349, t+0.30, 0.14, 'sawtooth', 0.14)
    _gm(294, t+0.45, 0.30, 'sawtooth', 0.18)
  }
  function sfxRetry() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(261, t,      0.06, 'square', 0.10)
    _gm(392, t+0.06, 0.06, 'square', 0.10)
    _gm(523, t+0.12, 0.12, 'square', 0.12)
  }
  function sfxStep() {
    _wake()
    if (typeof _sfxCtx === 'undefined' || !_sfxCtx) return
    const t = _sfxCtx.currentTime
    _gm(110, t, 0.02, 'square', 0.05)
  }

  // ── Pixel heart ───────────────────────────────────────────
  function drawHeart(ctx, x, y, filled, px) {
    const body = filled ? '#ef4444' : '#1e293b'
    const hi   = filled ? '#fca5a5' : '#334155'
    const P = [[0,1,1,0,1,1,0],[1,1,1,1,1,1,1],[1,1,1,1,1,1,1],[0,1,1,1,1,1,0],[0,0,1,1,1,0,0],[0,0,0,1,0,0,0]]
    for (let r = 0; r < P.length; r++)
      for (let c = 0; c < P[r].length; c++)
        if (P[r][c]) { ctx.fillStyle = (filled && r === 0 && c <= 2) ? hi : body; ctx.fillRect(x+c*px, y+r*px, px, px) }
  }

  // ── Pop text ──────────────────────────────────────────────
  const gmPops = []
  function addPop(x, y, txt, color) { gmPops.push({ x, y, txt, tick: 0, color: color || '#fbbf24' }) }

  // ── Platform generation ───────────────────────────────────
  // Called once when game mode activates, using current canvas width
  function generatePlatforms(W) {
    return [
      { x1: ~~(W * 0.14), x2: ~~(W * 0.29), elev: 50 },
      { x1: ~~(W * 0.41), x2: ~~(W * 0.56), elev: 66 },
      { x1: ~~(W * 0.65), x2: ~~(W * 0.80), elev: 44 },
    ]
  }

  // ── Platform pixel-art draw ───────────────────────────────
  function drawPlatform(ctx, plat, GY) {
    const py  = GY - plat.elev
    const pw  = plat.x2 - plat.x1

    // Drop shadow
    ctx.fillStyle = '#000000'
    ctx.globalAlpha = 0.35
    ctx.fillRect(plat.x1 + 3, py + PLAT_H + 2, pw, 3)
    ctx.globalAlpha = 1

    // Main body — dark stone
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(plat.x1, py, pw, PLAT_H)

    // Mid layer
    ctx.fillStyle = '#334155'
    ctx.fillRect(plat.x1, py + 2, pw, PLAT_H - 4)

    // Top edge highlight
    ctx.fillStyle = '#64748b'
    ctx.fillRect(plat.x1, py, pw, 2)

    // Pixel brick joints (vertical lines every 16px)
    ctx.fillStyle = '#1e293b'
    for (let bx = plat.x1 + 16; bx < plat.x2 - 2; bx += 16)
      ctx.fillRect(bx, py + 2, 1, PLAT_H - 4)

    // Moss/highlight dots on top
    ctx.fillStyle = '#4ade80'
    ctx.globalAlpha = 0.35
    for (let mx = plat.x1 + 5; mx < plat.x2 - 4; mx += 10)
      ctx.fillRect(mx, py, 2, 1)
    ctx.globalAlpha = 1
  }

  // ── Patch updateArena ─────────────────────────────────────
  const _origUpdate = window.updateArena
  window.updateArena = function () {
    const a = arenaAnim
    if (!a.gm) { _origUpdate(); return }

    a.tick++
    if (a.victory) { _origUpdate(); return }

    // Game over state
    if (a.gmGameOver) {
      a.gmGameOverTick++
      for (const en of a.animals) { if (!en.dying) en.dying = true; en.deathTick++ }
      a.animals = a.animals.filter(en => en.deathTick < 20)
      return
    }

    if (a.gmHitFlash  > 0) a.gmHitFlash--
    if (a.gmKillFlash > 0) a.gmKillFlash--
    for (const p of gmPops) p.tick++
    gmPops.splice(0, gmPops.length, ...gmPops.filter(p => p.tick < 32))

    // ── Canvas dimensions ──────────────────────────────────
    const canvas  = document.getElementById('arena-canvas')
    const W       = canvas ? canvas.width  : 800
    const H       = canvas ? canvas.height : GM_CANVAS_H
    const GY      = H - 18
    const GM_MAX_X = Math.round(W * 0.72)

    // ── Movement ──────────────────────────────────────────
    const wasMoving = a.gmMoveLeft || a.gmMoveRight
    if (a.gmMoveLeft)  a.gmToddX = Math.max(GM_MIN_X, a.gmToddX - GM_MOVE_SPEED)
    if (a.gmMoveRight) a.gmToddX = Math.min(GM_MAX_X, a.gmToddX + GM_MOVE_SPEED)
    if (wasMoving && a.tick % 14 === 0) sfxStep()

    // ── Gravity + jump ─────────────────────────────────────
    const wasOnGround = a.gmOnGround
    a.gmVY   -= GM_GRAVITY
    let newElev = a.gmElev + a.gmVY

    if (newElev <= 0) {
      if (!wasOnGround && a.gmVY < -3) sfxLand()
      newElev     = 0
      a.gmVY      = 0
      a.gmOnGround = true
    } else {
      a.gmOnGround = false
      // Platform landing (only when falling down)
      if (a.gmVY <= 0) {
        for (const plat of a.gmPlatforms) {
          const tx1 = a.gmToddX + 2 * ARENA_TPS
          const tx2 = a.gmToddX + 10 * ARENA_TPS
          if (tx2 > plat.x1 && tx1 < plat.x2) {
            if (a.gmElev >= plat.elev && newElev <= plat.elev) {
              if (!wasOnGround) sfxLand()
              newElev      = plat.elev
              a.gmVY       = 0
              a.gmOnGround = true
              break
            }
          }
        }
      }
    }
    a.gmElev = Math.max(0, newElev)

    // ── Swing animation ───────────────────────────────────
    if (a.gmSwing) {
      if (++a.gmSwingTick >= GM_FRAME_T) {
        a.gmSwingTick = 0
        a.gmSwingF++

        if (a.gmSwingF === 2) {
          // ★ STRIKE — generous vertical tolerance so elevated Todd can still hit
          const strikeX   = a.gmToddX + GM_SWORD_REL + 10
          const toddFeetY = GY - a.gmElev              // canvas Y of Todd's feet
          let killed = 0
          for (const en of a.animals) {
            if (en.dying || en.x > strikeX) continue
            const enTopY = GY - en.def.h * en.def.ps + (en.def.fy || 0)
            const enBotY = enTopY + en.def.h * en.def.ps
            // Vertical overlap: Todd's swing zone is feet ± 50px (covers jump + ground)
            const swingTop = toddFeetY - 50
            const swingBot = toddFeetY + 10
            if (enBotY >= swingTop && enTopY <= swingBot) {
              en.dying = true; killed++
            }
          }
          if (killed) {
            a.gmScore    += killed
            a.gmKillFlash = 10
            addPop(strikeX - 12, GY - a.gmElev - 30, killed > 1 ? `${killed}x COMBO!` : '+1', killed > 1 ? '#f97316' : '#fbbf24')
            sfxKill(killed)
          }
        }

        if (a.gmSwingF >= 4) {
          a.gmSwing  = false
          a.gmSwingF = 0
          // Fire queued swing immediately with no cooldown
          if (a.gmSwingQueued) {
            a.gmSwingQueued = false
            a.gmSwing       = true
            a.gmSwingF      = 0
            a.gmSwingTick   = 0
            sfxSword()
          } else {
            a.gmCooldown = GM_COOLDOWN
          }
        }
      }
      a.toddF = a.gmSwingF
    } else {
      // Walk/idle frames
      a.toddF = wasMoving ? (Math.floor(a.tick / 8) % 2 === 0 ? 0 : 3) : 0
      if (a.gmCooldown > 0) a.gmCooldown--
    }

    // ── Spawn enemies ─────────────────────────────────────
    if (--a.spawnIn <= 0 && a.animals.filter(x => !x.dying).length < 7) {
      const def = ARENA_DEFS[Math.floor(Math.random() * ARENA_DEFS.length)]
      a.animals.push({ def, x: W + def.w * def.ps, bob: 0, bobDir: 1, dying: false, deathTick: 0, moveTick: 0 })
      a.spawnIn = 12 + Math.floor(Math.random() * 22)
    }

    // ── Move enemies + hit detection ─────────────────────
    const bodyHitX = a.gmToddX + GM_BODY_REL
    for (const en of a.animals) {
      if (en.dying) { en.deathTick++; continue }
      en.x -= (en.def.speed + GM_ENEMY_SPEED)
      en.moveTick++
      if (en.moveTick % 10 === 0) { en.bob += en.bobDir; if (en.bob >= 1 || en.bob <= 0) en.bobDir *= -1 }

      if (en.x <= bodyHitX) {
        // Elevated Todd dodges ground enemies (bats have fy < -10 so they fly high)
        const isBat = (en.def.fy || 0) < -10
        const dodging = a.gmElev > 25 && !isBat   // on platform or in air = safe from ground
        if (dodging) continue

        en.dying     = true
        a.gmHearts--
        a.gmHitFlash = 22
        addPop(bodyHitX + 6, GY - a.gmElev - 24, '-1 ♥', '#ef4444')
        sfxHitPlayer()
        if (a.gmHearts <= 0) { a.gmHearts = 0; a.gmGameOver = true; sfxGameOver() }
      }
    }

    a.animals = a.animals.filter(en => !en.dying || en.deathTick < 16)
  }

  // ── Patch drawArena ───────────────────────────────────────
  const _origDraw = window.drawArena
  window.drawArena = function () {
    const a = arenaAnim
    if (!a.gm) { _origDraw(); return }

    const canvas = document.getElementById('arena-canvas')
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height
    const GY  = H - 18
    const TPS = ARENA_TPS
    const TX  = a.gmToddX
    const TR  = TX + GM_SWORD_REL

    // ── Background ────────────────────────────────────────
    ctx.fillStyle = '#07091A'
    ctx.fillRect(0, 0, W, H)

    // Grid lines
    ctx.fillStyle = '#0C1124'
    for (let x = 0; x < W; x += 12) ctx.fillRect(x, 0, 1, GY)
    for (let y = 0; y < GY; y += 12) ctx.fillRect(0, y, W, 1)

    // Stars
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
    const gs = (a.tick * 1.5) % 24
    for (let x = -(24 - gs % 24); x < W; x += 24) ctx.fillRect(Math.round(x), GY, 1, 2)

    // ── Platforms ─────────────────────────────────────────
    for (const plat of a.gmPlatforms) drawPlatform(ctx, plat, GY)

    // ── Enemies ───────────────────────────────────────────
    for (const en of a.animals) {
      const ax = Math.round(en.x)
      const ay = GY - en.def.h * en.def.ps + (en.def.fy || 0) + en.bob
      if (en.dying) {
        ctx.globalAlpha = Math.max(0, 1 - en.deathTick / 14)
        if (en.deathTick % 4 < 2) { ctx.fillStyle = '#FCD34D'; ctx.fillRect(ax-2, ay-2, en.def.w*en.def.ps+4, en.def.h*en.def.ps+4) }
        drawSpriteAt(ctx, en.def.d, ax, ay, en.def.ps)
        ctx.globalAlpha = 1
      } else {
        drawSpriteAt(ctx, en.def.s, ax, ay, en.def.ps)
      }
    }

    // ── Todd (at gmToddX, lifted by gmElev) ───────────────
    const FRAME_BOB  = [0, -4, 0, 3]
    const toddSprite = ARENA_ATTACKS[a.toddF]
    const tf         = a.toddF
    const P          = TPS
    const toddY      = GY - toddSprite.length * TPS + FRAME_BOB[tf] - Math.round(a.gmElev)

    drawSpriteAt(ctx, toddSprite, TX, toddY, TPS)

    // Sword trails (same as original, using TX)
    if (tf === 1) {
      ctx.globalAlpha = 0.6
      ctx.fillStyle = '#FCD34D'; ctx.fillRect(TX+10*P, toddY+1*P, P, P); ctx.fillRect(TX+11*P, toddY+2*P, P, P)
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(TX+11*P, toddY+1*P, P, P)
      ctx.globalAlpha = 1
    } else if (tf === 2) {
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(TX+11*P, toddY+5*P, 7*P, 2)
      ctx.fillStyle = '#FCD34D'; ctx.fillRect(TX+11*P, toddY+5*P+2, 6*P, 2); ctx.fillRect(TX+11*P, toddY+4*P, 3*P, 2)
      ctx.globalAlpha = 1
    } else if (tf === 3) {
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#FCD34D'
      ctx.fillRect(TX+11*P, toddY+7*P, P, P); ctx.fillRect(TX+12*P, toddY+8*P, P, P); ctx.fillRect(TX+13*P, toddY+9*P, P, P)
      ctx.globalAlpha = 1
    }

    // Sword impact glow near enemy
    const close = a.animals.some(en => !en.dying && en.x < TR + 20)
    if (close && a.tick % 6 < 3) {
      ctx.fillStyle = '#FCD34D'; ctx.fillRect(TR - 2, toddY + 5*P, 10, 3)
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(TR + 3, toddY + 5*P, 5, 3)
    }

    // Shadow under Todd when airborne
    if (a.gmElev > 2) {
      ctx.globalAlpha = Math.min(0.45, a.gmElev / 120)
      ctx.fillStyle = '#000'
      const sw = Math.max(4, 20 - a.gmElev * 0.18)
      ctx.fillRect(TX + 4*P - sw/2, GY + 1, sw, 3)
      ctx.globalAlpha = 1
    }

    // Movement arrow above Todd
    if (a.gmMoveLeft || a.gmMoveRight) {
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#60a5fa'
      ctx.font = '7px "Press Start 2P", monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'center'
      ctx.fillText(a.gmMoveLeft ? '◀' : '▶', TX + 6*P, toddY - 10)
      ctx.globalAlpha = 1
    }

    // ── Screen flash overlays ─────────────────────────────
    if (a.gmHitFlash > 0) { ctx.fillStyle = `rgba(220,38,38,${(a.gmHitFlash/22)*0.35})`; ctx.fillRect(0,0,W,H) }
    if (a.gmKillFlash > 0) { ctx.fillStyle = `rgba(251,191,36,${(a.gmKillFlash/10)*0.18})`; ctx.fillRect(0,0,W,H) }

    // ── HUD ───────────────────────────────────────────────
    ctx.font = '7px "Press Start 2P", monospace'
    ctx.textBaseline = 'top'

    // GAME MODE badge
    ctx.globalAlpha = 0.9; ctx.fillStyle = '#7c3aed'; ctx.textAlign = 'left'
    ctx.fillText('GAME MODE', 4, 4); ctx.globalAlpha = 1

    // Score
    ctx.fillStyle = '#fbbf24'; ctx.textAlign = 'center'
    ctx.fillText('\u2605 ' + a.gmScore, W / 2, 4)

    // Hearts (top-right, px=2 → each heart = 14×12px + 4 gap)
    const hpx = 2, hw = 7*hpx + 4
    const hx0 = W - a.gmMaxHearts * hw - 4
    for (let i = 0; i < a.gmMaxHearts; i++) {
      if (i < a.gmHearts && a.gmHitFlash > 0 && a.gmHitFlash % 6 < 3) ctx.globalAlpha = 0.25
      drawHeart(ctx, hx0 + i*hw, 4, i < a.gmHearts, hpx)
      ctx.globalAlpha = 1
    }

    // Floating pop text
    ctx.textAlign = 'center'
    for (const pop of gmPops) {
      ctx.globalAlpha = Math.max(0, 1 - pop.tick / 32)
      ctx.fillStyle = pop.color
      ctx.fillText(pop.txt, pop.x, pop.y - pop.tick * 0.7)
    }
    ctx.globalAlpha = 1

    // "SWING!" prompt when enemy is near + ready
    if (!a.gmSwing && !a.gmSwingQueued && !a.gmGameOver && a.gmCooldown === 0) {
      const danger = a.animals.some(en => !en.dying && en.x < W * 0.62)
      if (danger && a.tick % 26 < 18) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#4ade80'
        ctx.font = '6px "Press Start 2P", monospace'; ctx.textAlign = 'center'
        ctx.fillText('SPACE!', TX + 10*P, toddY - 12)
        ctx.globalAlpha = 1
      }
    }

    // Queued swing indicator — small ★ above Todd
    if (a.gmSwingQueued) {
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#f97316'
      ctx.font = '6px "Press Start 2P", monospace'; ctx.textAlign = 'center'
      ctx.fillText('★', TX + 8*P, toddY - 12)
      ctx.globalAlpha = 1
    }

    // Cooldown bar above Todd
    if (a.gmCooldown > 0) {
      const bX = TX + 2*P, bY = GY - a.gmElev - 60, bW = 32, bH = 3
      ctx.fillStyle = '#1e293b'; ctx.fillRect(bX, bY, bW, bH)
      ctx.fillStyle = '#7c3aed'; ctx.fillRect(bX, bY, ~~(bW * (1 - a.gmCooldown/GM_COOLDOWN)), bH)
    }

    // ── GAME OVER overlay ─────────────────────────────────
    if (a.gmGameOver) {
      const alpha = Math.min(1, a.gmGameOverTick / 18)
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.72})`; ctx.fillRect(0,0,W,H)
      ctx.globalAlpha = (a.gmGameOverTick < 8 && a.gmGameOverTick % 2 === 0) ? 0 : alpha
      ctx.fillStyle = '#ef4444'; ctx.textAlign = 'center'
      ctx.font = '11px "Press Start 2P", monospace'
      ctx.fillText('GAME OVER', W/2, H/2 - 18)
      ctx.font = '6px "Press Start 2P", monospace'
      ctx.fillStyle = '#fbbf24'; ctx.fillText('SCORE: ' + a.gmScore, W/2, H/2)
      if (a.gmGameOverTick > 45 && a.gmGameOverTick % 32 < 22) {
        ctx.fillStyle = '#a78bfa'; ctx.fillText('PRESS A TO RETRY', W/2, H/2 + 16)
      }
      ctx.globalAlpha = 1
    }

    ctx.textAlign = 'left'
    ctx.font = '8px "Press Start 2P", monospace'
  }

  // ── Helpers ────────────────────────────────────────────────
  function resetGameState() {
    const a  = arenaAnim
    const cv = document.getElementById('arena-canvas')
    a.gmHearts = 3; a.gmScore = 0
    a.gmToddX  = ARENA_TODD_X
    a.gmElev   = 0; a.gmVY = 0; a.gmOnGround = true
    a.gmMoveLeft = false; a.gmMoveRight = false
    a.gmSwing = false; a.gmSwingF = 0; a.gmSwingTick = 0; a.gmSwingQueued = false; a.gmCooldown = 0
    a.gmGameOver = false; a.gmGameOverTick = 0
    a.gmHitFlash = 0; a.gmKillFlash = 0
    a.animals = []; a.spawnIn = 10
    gmPops.length = 0
    a.gmPlatforms = generatePlatforms(cv ? cv.width : 800)
  }

  // ── Toggle game mode ──────────────────────────────────────
  function toggleGameMode() {
    const a    = arenaAnim
    const cv   = document.getElementById('arena-canvas')
    const btn  = document.getElementById('btn-game-mode')
    const ctrl = document.getElementById('nes-controller')
    if (!a.running) { if (typeof toast !== 'undefined') toast('Start a hunt first!', 'info'); return }
    a.gm = !a.gm
    if (a.gm) {
      // Expand canvas height for proper jump space
      if (cv) { cv.height = GM_CANVAS_H; cv.style.height = GM_CANVAS_H + 'px' }
      resetGameState()
      ctrl?.classList.remove('hidden')
      if (btn) { btn.textContent = '✕ EXIT'; btn.classList.add('gm-active') }
    } else {
      // Restore canvas
      if (cv) { cv.height = 120; cv.style.height = '' }
      ctrl?.classList.add('hidden')
      if (btn) { btn.textContent = '🕹 GAME MODE'; btn.classList.remove('gm-active') }
      gmPops.length = 0
      a.gmMoveLeft = false; a.gmMoveRight = false
    }
  }

  // ── Swing ─────────────────────────────────────────────────
  function gameModeSwing() {
    const a = arenaAnim
    if (!a.gm || !a.running) return
    if (a.gmGameOver) { resetGameState(); sfxRetry(); return }
    if (a.victory) return
    if (a.gmSwing) {
      // Queue it — will fire the instant current swing ends
      a.gmSwingQueued = true
      return
    }
    if (a.gmCooldown > 0) return
    a.gmSwing = true; a.gmSwingF = 0; a.gmSwingTick = 0; a.gmSwingQueued = false
    sfxSword()
    const aBtn = document.getElementById('nes-a-btn')
    if (aBtn) { aBtn.classList.add('pressed'); setTimeout(() => aBtn.classList.remove('pressed'), 110) }
  }

  // ── Jump ──────────────────────────────────────────────────
  function gameModeJump() {
    const a = arenaAnim
    if (!a.gm || !a.running || a.gmGameOver || a.victory) return
    if (!a.gmOnGround) return
    a.gmVY = GM_JUMP_VY; a.gmOnGround = false
    sfxJump()
    const bBtn = document.getElementById('nes-b-btn')
    if (bBtn) { bBtn.classList.add('pressed'); setTimeout(() => bBtn.classList.remove('pressed'), 110) }
    highlightDpad('up', true); setTimeout(() => highlightDpad('up', false), 150)
  }

  // ── Auto-exit on hunt victory ─────────────────────────────
  setInterval(() => {
    if (arenaAnim.gm && arenaAnim.victory) {
      const cv = document.getElementById('arena-canvas')
      if (cv) { cv.height = 120; cv.style.height = '' }
      document.getElementById('nes-controller')?.classList.add('hidden')
      const btn = document.getElementById('btn-game-mode')
      if (btn) { btn.textContent = '🕹 GAME MODE'; btn.classList.remove('gm-active') }
      arenaAnim.gm = false; arenaAnim.gmMoveLeft = false; arenaAnim.gmMoveRight = false
      gmPops.length = 0
    }
  }, 400)

  // ── Keyboard ──────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!arenaAnim.gm) return
    switch (e.code) {
      case 'Space':
        e.preventDefault(); gameModeSwing(); break
      case 'ArrowLeft':
        e.preventDefault(); arenaAnim.gmMoveLeft = true; highlightDpad('left', true); break
      case 'ArrowRight':
        e.preventDefault(); arenaAnim.gmMoveRight = true; highlightDpad('right', true); break
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault(); gameModeJump(); break
      case 'KeyZ': case 'KeyX':
        gameModeSwing(); break
    }
  })
  document.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft')  { arenaAnim.gmMoveLeft  = false; highlightDpad('left',  false) }
    if (e.code === 'ArrowRight') { arenaAnim.gmMoveRight = false; highlightDpad('right', false) }
  })

  // ── D-Pad press+hold (pointer events) ────────────────────
  function bindDpad(id, dir) {
    const el = document.getElementById(id)
    if (!el) return
    const start = () => { if (!arenaAnim.gm) return; arenaAnim['gmMove' + dir] = true;  highlightDpad(dir.toLowerCase(), true)  }
    const stop  = () => {                              arenaAnim['gmMove' + dir] = false; highlightDpad(dir.toLowerCase(), false) }
    el.addEventListener('pointerdown',  start)
    el.addEventListener('pointerup',    stop)
    el.addEventListener('pointerleave', stop)
    el.addEventListener('touchstart',   e => { e.preventDefault(); start() }, { passive: false })
    el.addEventListener('touchend',     stop)
  }
  bindDpad('nes-dpad-left-btn',  'Left')
  bindDpad('nes-dpad-right-btn', 'Right')

  function highlightDpad(dir, on) {
    const map = { left: 'nes-dpad-left-btn', right: 'nes-dpad-right-btn', up: 'nes-dpad-up-btn' }
    const el = document.getElementById(map[dir])
    if (el) el.classList.toggle('dpad-pressed', on)
  }

  // ── Action buttons ────────────────────────────────────────
  document.getElementById('nes-a-btn')?.addEventListener('click',      gameModeSwing)
  document.getElementById('nes-b-btn')?.addEventListener('click',      gameModeJump)  // B = JUMP
  document.getElementById('nes-dpad-up-btn')?.addEventListener('click', gameModeJump)

  // Tap canvas = swing
  document.getElementById('arena-canvas')?.addEventListener('click', () => { if (arenaAnim.gm) gameModeSwing() })

  // ── Toggle button ─────────────────────────────────────────
  document.getElementById('btn-game-mode')?.addEventListener('click', toggleGameMode)

})()
