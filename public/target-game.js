/**
 * target-game.js — Robin Hood Todd animation + mini-game (v4)
 * Rounds: 3 arrows per round — miss = lose a life (3 lives) — each
 * round the target gets further + smaller + more obstacles drop.
 */
;(function TargetPracticeGame() {

  let _animId   = null
  let _canvas   = null
  let _ctx      = null
  let _gameMode = false
  let W, H

  // Layout — TGT_X/TGT_Y/TGT_R update each round
  let TODD_X, TODD_Y
  let TGT_X,  TGT_Y
  let TGT_R = [20, 13, 6]

  // Round scaling tables (index = round-1, clamped at last entry)
  const ROUND_CFG = [
    { radii: [20, 13, 6], obstInt: 85, obstMax: 4, speedMul: 1.0 },
    { radii: [17, 11, 5], obstInt: 65, obstMax: 5, speedMul: 1.2 },
    { radii: [14,  9, 4], obstInt: 50, obstMax: 6, speedMul: 1.4 },
    { radii: [11,  7, 3], obstInt: 38, obstMax: 7, speedMul: 1.6 },
    { radii: [ 9,  5, 2], obstInt: 28, obstMax: 8, speedMul: 1.9 },
  ]
  function roundCfg(r) { return ROUND_CFG[Math.min(r - 1, ROUND_CFG.length - 1)] }

  // ── Colors ─────────────────────────────────────────────────────
  const BG      = '#08101e'
  const GROUND  = '#0f172a'
  const GRASS   = '#15803d'
  const TREE_D  = '#14532d'
  const TREE_L  = '#166534'
  const TRUNK   = '#92400e'
  const HAT     = '#1a5c0e'
  const HAT_L   = '#2d8a1a'
  const FEATHER = '#f1f5f9'
  const SKIN    = '#c87844'
  const TUNIC   = '#2d6a1e'
  const TUNIC_L = '#3d8a28'
  const BELT    = '#7c4a1c'
  const PANTS   = '#6b3a1c'
  const BOOTS   = '#2d1a0a'
  const EYE_C   = '#1a0e00'
  const BOW_C   = '#7c4a1c'
  const SHAFT   = '#a16207'
  const TIP_C   = '#94a3b8'
  const FLETCH  = '#dc2626'
  const STRING  = '#e2e8f0'
  const TGT_RED = '#dc2626'
  const TGT_WHT = '#f8fafc'
  const DARK    = '#1e293b'

  // ── Idle/flight animation state ──────────────────────────────
  const A = {
    phase: 'idle',
    timer: 0,
    frame: 0,
    arrowX: 0, arrowY: 0,
    arrowVX: 0, arrowVY: 0,
    hitFlash: 0,
  }

  // ── Mini-game state ───────────────────────────────────────────
  const G = {
    arrows:      3,    // remaining arrows this round
    arrowsShot:  0,    // total fired this round
    lives:       3,    // hearts (max 3)
    score:       0,
    round:       1,
    power:       0.3,
    powerDir:    1,
    mx: 0, my: 0,
    projectiles:     [],
    obstacles:       [],
    particles:       [],
    gameOver:        false,
    fired:           false,
    obstTimer:       0,
    roundOver:       false,
    roundTimer:      0,    // frames left in round-over flash
    missFlash:       0,    // red screen flash when life lost
    roundBonus:      0,    // bonus points shown on round clear
  }

  // ── Draw helpers ──────────────────────────────────────────────
  function cls(c) { _ctx.fillStyle = c }
  function rec(x, y, w, h) { _ctx.fillRect(x|0, y|0, w|0, h|0) }
  function pxl(col, row, S, ox, oy, color) {
    cls(color); rec(ox + col * S, oy + row * S, S, S)
  }

  // ── Background ───────────────────────────────────────────────
  function drawBG() {
    if (!_ctx) return
    cls(BG);          rec(0, 0, W, H * 0.7)
    cls('#0d1b2e');   rec(0, H * 0.7, W, H * 0.3)
    // Moon
    cls('#fef9c3')
    _ctx.beginPath(); _ctx.arc(W - 40, 22, 10, 0, Math.PI * 2); _ctx.fill()
    cls('#0d1b2e')
    _ctx.beginPath(); _ctx.arc(W - 36, 20, 9,  0, Math.PI * 2); _ctx.fill()
    // Stars
    cls('#e2e8f0')
    const starPts = [15,10, 35,8, 60,15, 90,6, 120,12, 160,5, W-80,8, W-120,14]
    for (let si = 0; si < starPts.length; si += 2) { rec(starPts[si], starPts[si+1], 2, 2) }
    // Ground
    cls(GROUND); rec(0, H - 18, W, 18)
    cls(GRASS)
    for (let gx = 0; gx < W; gx += 8) { rec(gx, H - 18, 4, 3) }
    // Trees
    const treePairs = [20, H - 18, W - 24, H - 18]
    for (let ti = 0; ti < 4; ti += 2) {
      const tx = treePairs[ti], ty = treePairs[ti+1]
      cls(TRUNK); rec(tx - 3, ty - 22, 6, 22)
      cls(TREE_D); rec(tx - 10, ty - 40, 20, 18)
      cls(TREE_L); rec(tx - 7,  ty - 52, 14, 16)
      cls(TREE_D); rec(tx - 4,  ty - 62, 8,  14)
    }
  }

  // ── Todd Robin Hood sprite ────────────────────────────────────
  function drawTodd(cx, cy, phase, frame) {
    const S   = 3
    const bob = Math.floor(frame / 24) % 2 === 0 ? 0 : 1
    const ox  = cx - 6 * S
    const oy  = cy - 16 * S + bob

    function p(col, row, color) { pxl(col, row, S, ox, oy, color) }
    function r(col, row, w, h, color) { cls(color); rec(ox+col*S, oy+row*S, w*S, h*S) }

    r(4, 0, 3, 1, HAT); r(3, 1, 5, 1, HAT); r(2, 2, 7, 1, HAT_L)
    p(9, 1, FEATHER); p(10, 0, FEATHER)
    r(3, 3, 5, 3, SKIN); r(2, 4, 7, 2, SKIN)
    p(3, 4, EYE_C); p(6, 4, EYE_C)
    r(4, 5, 3, 1, '#7c2c10')
    r(2, 6, 8, 1, TUNIC_L); r(1, 7, 10, 3, TUNIC); r(3, 9, 6, 1, BELT)
    p(0, 7, SKIN); p(0, 8, SKIN); p(0, 9, SKIN)
    if (phase === 'draw') {
      p(11, 7, SKIN); p(11, 8, SKIN)
    } else {
      p(11, 7, SKIN); p(10, 8, SKIN); p(11, 8, SKIN)
    }
    r(2, 10, 4, 2, PANTS); r(7, 10, 3, 2, PANTS)
    r(1, 12, 4, 2, BOOTS); r(6, 12, 4, 2, BOOTS)

    // Bow
    const bCX = ox - S * 1
    const bCY = oy + S * 8
    const bR  = S * 6
    _ctx.strokeStyle = BOW_C; _ctx.lineWidth = 2.5
    _ctx.beginPath()
    _ctx.arc(bCX + bR * 0.25, bCY, bR, -Math.PI * 0.65, Math.PI * 0.65)
    _ctx.stroke()

    const pull  = phase === 'draw' ? S * 4 : 0
    const topPt = {
      x: bCX + bR * 0.25 + bR * Math.cos(-Math.PI * 0.65),
      y: bCY + bR * Math.sin(-Math.PI * 0.65)
    }
    const botPt = {
      x: bCX + bR * 0.25 + bR * Math.cos(Math.PI * 0.65),
      y: bCY + bR * Math.sin(Math.PI * 0.65)
    }
    const midPt = { x: bCX + bR * 0.25 + pull, y: bCY }

    _ctx.strokeStyle = STRING; _ctx.lineWidth = 1
    _ctx.beginPath()
    _ctx.moveTo(topPt.x, topPt.y); _ctx.lineTo(midPt.x, midPt.y); _ctx.lineTo(botPt.x, botPt.y)
    _ctx.stroke()

    if (phase !== 'fly' && phase !== 'hit') {
      const arrowTail = midPt.x
      const arrowTipX = bCX + bR * 0.25 + bR + S * 5
      _ctx.strokeStyle = SHAFT; _ctx.lineWidth = 2
      _ctx.beginPath(); _ctx.moveTo(arrowTail, bCY); _ctx.lineTo(arrowTipX, bCY); _ctx.stroke()
      cls(TIP_C)
      _ctx.beginPath()
      _ctx.moveTo(arrowTipX + 6, bCY)
      _ctx.lineTo(arrowTipX, bCY - 3); _ctx.lineTo(arrowTipX, bCY + 3)
      _ctx.closePath(); _ctx.fill()
      cls(FLETCH)
      _ctx.beginPath()
      _ctx.moveTo(arrowTail - 8, bCY - 5)
      _ctx.lineTo(arrowTail, bCY)
      _ctx.lineTo(arrowTail - 8, bCY + 5)
      _ctx.closePath(); _ctx.fill()
    }
  }

  // ── Target ────────────────────────────────────────────────────
  function drawTarget(tx, ty) {
    if (!_ctx) return
    const r0 = TGT_R[0]
    cls(TRUNK); rec(tx - 3, ty + r0, 6, 22)
    cls(TRUNK); rec(tx - 14, ty + r0 + 22, 28, 4)
    const ringColors = [TGT_RED, TGT_WHT, TGT_RED]
    for (let ri = 0; ri < 3; ri++) {
      cls(ringColors[ri])
      _ctx.beginPath(); _ctx.arc(tx, ty, TGT_R[ri], 0, Math.PI * 2); _ctx.fill()
    }
    _ctx.strokeStyle = DARK; _ctx.lineWidth = 1.5
    _ctx.beginPath(); _ctx.arc(tx, ty, r0, 0, Math.PI * 2); _ctx.stroke()
  }

  // ── Flying arrow ─────────────────────────────────────────────
  function drawFlyingArrow(x, y, vx, vy) {
    const angle = Math.atan2(vy, vx)
    const len   = 22
    _ctx.strokeStyle = SHAFT; _ctx.lineWidth = 2
    _ctx.beginPath()
    _ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len)
    _ctx.lineTo(x, y); _ctx.stroke()
    cls(TIP_C)
    _ctx.beginPath()
    _ctx.moveTo(x, y)
    _ctx.lineTo(x - Math.cos(angle - 0.35) * 7, y - Math.sin(angle - 0.35) * 7)
    _ctx.lineTo(x - Math.cos(angle + 0.35) * 7, y - Math.sin(angle + 0.35) * 7)
    _ctx.closePath(); _ctx.fill()
    const tx2 = x - Math.cos(angle) * len
    const ty2 = y - Math.sin(angle) * len
    cls(FLETCH)
    _ctx.beginPath()
    _ctx.moveTo(tx2, ty2)
    _ctx.lineTo(tx2 - Math.cos(angle - Math.PI / 2) * 5, ty2 - Math.sin(angle - Math.PI / 2) * 5)
    _ctx.lineTo(tx2 + Math.cos(angle) * 5, ty2 + Math.sin(angle) * 5)
    _ctx.closePath(); _ctx.fill()
    _ctx.beginPath()
    _ctx.moveTo(tx2, ty2)
    _ctx.lineTo(tx2 - Math.cos(angle + Math.PI / 2) * 5, ty2 - Math.sin(angle + Math.PI / 2) * 5)
    _ctx.lineTo(tx2 + Math.cos(angle) * 5, ty2 + Math.sin(angle) * 5)
    _ctx.closePath(); _ctx.fill()
  }

  // ── Obstacles ─────────────────────────────────────────────────
  function drawObstacle(o) {
    _ctx.save()
    _ctx.translate(o.x | 0, o.y | 0)
    _ctx.rotate(o.rot)
    if (o.type === 'box') {
      cls('#7c3a10'); rec(-11, -11, 22, 22)
      _ctx.strokeStyle = '#5a2a08'; _ctx.lineWidth = 1.5; _ctx.strokeRect(-11, -11, 22, 22)
      _ctx.strokeStyle = '#a05a30'; _ctx.lineWidth = 1
      _ctx.beginPath(); _ctx.moveTo(-11, 0); _ctx.lineTo(11, 0); _ctx.stroke()
      _ctx.beginPath(); _ctx.moveTo(0, -11); _ctx.lineTo(0, 11); _ctx.stroke()
    } else if (o.type === 'barrel') {
      cls('#6b3010')
      _ctx.beginPath(); _ctx.ellipse(0, 0, 10, 13, 0, 0, Math.PI * 2); _ctx.fill()
      _ctx.strokeStyle = '#4a2008'; _ctx.lineWidth = 2
      _ctx.beginPath(); _ctx.moveTo(-10, -4); _ctx.lineTo(10, -4); _ctx.stroke()
      _ctx.beginPath(); _ctx.moveTo(-10, 4);  _ctx.lineTo(10, 4);  _ctx.stroke()
    } else {
      cls('#a16207'); rec(-18, -4, 36, 8)
      _ctx.strokeStyle = '#7c4a10'; _ctx.lineWidth = 1; _ctx.strokeRect(-18, -4, 36, 8)
    }
    _ctx.restore()
  }

  // ── Particles ─────────────────────────────────────────────────
  function spawnParticles(px, py, color, count) {
    const n = count || 10
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      G.particles.push({
        x: px, y: py,
        vx: Math.cos(ang) * (1 + Math.random() * 2.5),
        vy: Math.sin(ang) * (1 + Math.random() * 2.5),
        color,
        life: (22 + Math.random() * 10) | 0
      })
    }
  }

  // ── HUD helpers ───────────────────────────────────────────────
  function drawHUD() {
    // Hearts (lives) — bottom left
    for (let hi = 0; hi < 3; hi++) {
      _ctx.fillStyle = hi < G.lives ? '#ef4444' : '#2d3748'
      _ctx.font = '11px monospace'
      _ctx.textAlign = 'left'
      _ctx.fillText('\u2665', 8 + hi * 14, H - 34)
    }
    // Arrows left — top left
    _ctx.fillStyle = '#fbbf24'
    _ctx.font = '8px monospace'
    _ctx.textAlign = 'left'
    _ctx.fillText('\uD83C\uDFF9\u00D7' + G.arrows, 8, 14)
    // Round — top center
    _ctx.fillStyle = '#a78bfa'
    _ctx.textAlign = 'center'
    _ctx.fillText('RND ' + G.round, W / 2, 14)
    // Score — top right
    _ctx.fillStyle = '#4ade80'
    _ctx.textAlign = 'right'
    _ctx.fillText(G.score + ' pts', W - 8, 14)
  }

  // ── Idle animation tick ──────────────────────────────────────
  function idleTick() {
    A.frame++; A.timer++
    _ctx.clearRect(0, 0, W, H)
    drawBG()

    if (A.phase === 'idle') {
      if (A.timer > 70) { A.phase = 'draw'; A.timer = 0 }
    } else if (A.phase === 'draw') {
      if (A.timer > 55) { A.phase = 'release'; A.timer = 0 }
    } else if (A.phase === 'release') {
      if (A.timer > 6) {
        A.phase = 'fly'
        A.arrowX = TODD_X + 14; A.arrowY = TODD_Y - 50
        const dx = TGT_X - A.arrowX, dy = TGT_Y - A.arrowY
        const spd = 7, dist = Math.sqrt(dx*dx + dy*dy)
        A.arrowVX = (dx / dist) * spd
        A.arrowVY = (dy / dist) * spd - 2.5
        A.timer = 0
      }
    } else if (A.phase === 'fly') {
      A.arrowX += A.arrowVX; A.arrowY += A.arrowVY; A.arrowVY += 0.18
      const adx = A.arrowX - TGT_X, ady = A.arrowY - TGT_Y
      if (Math.sqrt(adx*adx + ady*ady) < TGT_R[0] + 4 || A.timer > 90) {
        A.phase = 'hit'; A.hitFlash = 1; A.timer = 0
      }
    } else if (A.phase === 'hit') {
      A.hitFlash = Math.max(0, A.hitFlash - 0.045)
      if (A.timer > 90) { A.phase = 'idle'; A.timer = 0 }
    }

    if (A.hitFlash > 0) {
      _ctx.save(); _ctx.globalAlpha = A.hitFlash * 0.7
      cls('#fbbf24')
      _ctx.beginPath(); _ctx.arc(TGT_X, TGT_Y, TGT_R[0] + 8, 0, Math.PI * 2); _ctx.fill()
      _ctx.restore()
    }

    drawTarget(TGT_X, TGT_Y)
    if (A.phase === 'hit') drawFlyingArrow(TGT_X - 22, TGT_Y + 1, 7, 0.5)
    if (A.phase === 'fly') drawFlyingArrow(A.arrowX, A.arrowY, A.arrowVX, A.arrowVY)
    drawTodd(TODD_X, TODD_Y, A.phase, A.frame)

    _ctx.fillStyle = 'rgba(148,163,184,0.45)'
    _ctx.font = '8px monospace'; _ctx.textAlign = 'center'
    _ctx.fillText('[ click to play ]', W / 2, H - 4)

    _animId = requestAnimationFrame(idleTick)
  }

  // ── Game tick ─────────────────────────────────────────────────
  function gameTick() {
    A.frame++
    _ctx.clearRect(0, 0, W, H)
    drawBG()

    // Miss flash (red tint)
    if (G.missFlash > 0) {
      G.missFlash--
      _ctx.save()
      _ctx.globalAlpha = (G.missFlash / 20) * 0.28
      cls('#dc2626'); rec(0, 0, W, H)
      _ctx.restore()
    }

    if (!G.gameOver && !G.roundOver) {
      // Power bar
      G.power += 0.022 * G.powerDir
      if (G.power >= 1) G.powerDir = -1
      if (G.power <= 0) G.powerDir =  1

      // Spawn obstacles
      const cfg = roundCfg(G.round)
      G.obstTimer++
      if (G.obstTimer > cfg.obstInt && G.obstacles.length < cfg.obstMax) {
        G.obstTimer = 0
        G.obstacles.push({
          type:     ['box','barrel','plank'][Math.random() * 3 | 0],
          x:        TGT_X - 55 + Math.random() * 90,
          y:        -20,
          vy:       (0.9 + Math.random() * 0.8) * cfg.speedMul,
          rot:      0,
          rotSpeed: (Math.random() - 0.5) * 0.07,
        })
      }

      // Update obstacles
      G.obstacles.forEach(o => { o.y += o.vy; o.rot += o.rotSpeed })
      G.obstacles = G.obstacles.filter(o => o.y < H + 40)

      // Update projectiles
      G.projectiles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.17
        if (p.dead) return
        // Target hit
        const dx = p.x - TGT_X, dy = p.y - TGT_Y
        const d  = Math.sqrt(dx*dx + dy*dy)
        if (d < TGT_R[0] + 4) {
          let pts = 10
          if (d < TGT_R[2]) pts = 150
          else if (d < TGT_R[1]) pts = 60
          G.score += pts; A.hitFlash = 1; p.hit = true
          spawnParticles(p.x, p.y, '#fbbf24', 12)
          p.dead = true
        }
        // Obstacle hit
        G.obstacles.forEach(o => {
          if (o.dead || p.dead) return
          const dx2 = p.x - o.x, dy2 = p.y - o.y
          if (Math.abs(dx2) < 14 && Math.abs(dy2) < 14) {
            G.score += 30; spawnParticles(o.x, o.y, '#f97316')
            o.dead = true; p.dead = true
          }
        })
        // Off-screen = miss
        if (!p.dead && (p.x > W + 20 || p.y > H + 20 || p.x < -20)) {
          if (!p.hit) {
            G.lives = Math.max(0, G.lives - 1)
            G.missFlash = 20
            spawnParticles(TODD_X + 14, TODD_Y - 50, '#ef4444', 8)
            if (G.lives <= 0) { G.gameOver = true }
          }
          p.dead = true
        }
      })
      G.projectiles = G.projectiles.filter(p => !p.dead)
      G.obstacles   = G.obstacles.filter(o => !o.dead)

      // Particles
      G.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life-- })
      G.particles = G.particles.filter(p => p.life > 0)

      // Glow decay
      if (A.hitFlash > 0) A.hitFlash = Math.max(0, A.hitFlash - 0.04)

      // All 3 arrows resolved → round over (if still alive)
      if (!G.gameOver && G.arrowsShot >= 3 && G.projectiles.length === 0) {
        G.roundBonus = G.round * 25  // round-clear bonus
        G.score += G.roundBonus
        G.roundOver  = true
        G.roundTimer = 100
      }
    }

    // Round-over countdown → advance to next round
    if (G.roundOver) {
      G.roundTimer--
      if (G.roundTimer <= 0) {
        startRound(G.round + 1)
        return  // fresh tick loop started inside startRound
      }
    }

    // Draw scene
    G.obstacles.forEach(drawObstacle)

    if (A.hitFlash > 0) {
      _ctx.save(); _ctx.globalAlpha = A.hitFlash * 0.6
      cls('#fbbf24')
      _ctx.beginPath(); _ctx.arc(TGT_X, TGT_Y, TGT_R[0] + 9, 0, Math.PI * 2); _ctx.fill()
      _ctx.restore()
    }

    drawTarget(TGT_X, TGT_Y)

    G.particles.forEach(p => {
      _ctx.save(); _ctx.globalAlpha = p.life / 30
      cls(p.color); rec(p.x - 2, p.y - 2, 4, 4)
      _ctx.restore()
    })

    G.projectiles.forEach(p => drawFlyingArrow(p.x, p.y, p.vx, p.vy))

    // Aim line
    if (!G.gameOver && !G.roundOver && G.arrows > 0) {
      const ang = Math.atan2(G.my - (TODD_Y - 50), G.mx - (TODD_X + 14))
      _ctx.save()
      _ctx.setLineDash([4, 5])
      _ctx.strokeStyle = 'rgba(251,191,36,0.35)'
      _ctx.lineWidth = 1
      _ctx.beginPath()
      _ctx.moveTo(TODD_X + 14, TODD_Y - 50)
      _ctx.lineTo(TODD_X + 14 + Math.cos(ang) * 70, TODD_Y - 50 + Math.sin(ang) * 70)
      _ctx.stroke()
      _ctx.restore()
    }

    const toddPhase = G.projectiles.length > 0 ? 'fly'
                    : G.arrows > 0             ? 'draw'
                    :                            'idle'
    drawTodd(TODD_X, TODD_Y, toddPhase, A.frame)

    // HUD
    drawHUD()

    // Power bar
    if (!G.gameOver && !G.roundOver && G.arrows > 0) {
      const PX = 10, PY = H - 26, PW = 56, PH = 7
      cls('#0f172a'); rec(PX, PY, PW, PH)
      const pc = G.power > 0.7 ? '#ef4444' : G.power > 0.4 ? '#f97316' : '#4ade80'
      cls(pc); rec(PX, PY, PW * G.power, PH)
      _ctx.strokeStyle = '#334155'; _ctx.lineWidth = 1; _ctx.strokeRect(PX, PY, PW, PH)
      _ctx.fillStyle = '#94a3b8'; _ctx.font = '7px monospace'; _ctx.textAlign = 'left'
      _ctx.fillText('PWR', PX, PY - 2)
    }

    // Round-clear overlay
    if (G.roundOver) {
      const fade = Math.min(1, (100 - G.roundTimer) / 15)
      _ctx.fillStyle = 'rgba(0,0,0,' + (fade * 0.72) + ')'
      rec(0, 0, W, H)
      _ctx.fillStyle = '#4ade80'; _ctx.font = 'bold 13px monospace'; _ctx.textAlign = 'center'
      _ctx.fillText('ROUND ' + G.round + ' CLEAR!', W / 2, H / 2 - 18)
      _ctx.fillStyle = '#fbbf24'; _ctx.font = '9px monospace'
      _ctx.fillText('+' + G.roundBonus + ' BONUS', W / 2, H / 2 - 2)
      _ctx.fillStyle = '#a78bfa'; _ctx.font = '8px monospace'
      _ctx.fillText('ROUND ' + (G.round + 1) + ' \u2192 target is further!', W / 2, H / 2 + 16)
      if (G.roundTimer < 40) {
        _ctx.fillStyle = 'rgba(148,163,184,0.5)'; _ctx.font = '7px monospace'
        _ctx.fillText('get ready...', W / 2, H / 2 + 30)
      }
    }

    // Game over overlay
    if (G.gameOver) {
      _ctx.fillStyle = 'rgba(0,0,0,0.65)'
      rec(0, 0, W, H)
      _ctx.fillStyle = '#ef4444'; _ctx.font = 'bold 12px monospace'; _ctx.textAlign = 'center'
      _ctx.fillText('GAME OVER', W / 2, H / 2 - 22)
      _ctx.fillStyle = '#4ade80'; _ctx.font = 'bold 11px monospace'
      _ctx.fillText('SCORE: ' + G.score, W / 2, H / 2 - 6)
      _ctx.fillStyle = '#94a3b8'; _ctx.font = '8px monospace'
      _ctx.fillText('Round ' + G.round + '  \u2665\u2665\u2665'.substring(0, G.lives * 2 || 1), W / 2, H / 2 + 10)
      _ctx.fillStyle = '#a78bfa'
      _ctx.fillText('[ click to play again ]', W / 2, H / 2 + 26)
    }

    _animId = requestAnimationFrame(gameTick)
  }

  // ── Start a specific round ────────────────────────────────────
  function startRound(roundNum) {
    const cfg = roundCfg(roundNum)
    TGT_R = cfg.radii.slice()

    // Target moves slightly right + up each round (looks farther away)
    TGT_X = Math.min(W - TGT_R[0] - 8, (W - 52) + (roundNum - 1) * 6)
    TGT_Y = Math.max(H * 0.28, H / 2 - 5 - (roundNum - 1) * 7)

    G.round      = roundNum
    G.arrows     = 3
    G.arrowsShot = 0
    G.fired      = false
    G.roundOver  = false
    G.roundTimer = 0
    G.obstTimer  = 0
    G.projectiles = []
    G.obstacles   = []
    G.particles   = []
    A.hitFlash    = 0

    if (_animId) cancelAnimationFrame(_animId)
    _animId = requestAnimationFrame(gameTick)
  }

  // ── Start game (full reset) ───────────────────────────────────
  function startGame() {
    _gameMode  = true
    G.score    = 0
    G.lives    = 3
    G.gameOver = false
    G.missFlash = 0
    G.power    = 0.3
    G.powerDir = 1
    G.mx = W / 2; G.my = H / 2

    // Reset TGT to initial position for round 1
    TGT_X = W - 52
    TGT_Y = H / 2 - 5

    startRound(1)
  }

  // ── Fire arrow ────────────────────────────────────────────────
  function fireArrow() {
    if (G.fired || G.arrows <= 0 || G.gameOver || G.roundOver) return
    G.fired = true
    G.arrows--
    G.arrowsShot++
    const ang = Math.atan2(G.my - (TODD_Y - 50), G.mx - (TODD_X + 14))
    const spd = 5 + G.power * 7
    G.projectiles.push({
      x: TODD_X + 14, y: TODD_Y - 50,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      hit: false, dead: false
    })
    setTimeout(() => { G.fired = false }, 350)
  }

  // ── Input ─────────────────────────────────────────────────────
  function onCanvasClick(e) {
    if (!_gameMode) { startGame(); return }
    if (G.gameOver)  { startGame(); return }
    if (G.roundOver) return
    const rect   = _canvas.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    G.mx = (e.clientX - rect.left) * scaleX
    G.my = (e.clientY - rect.top)  * scaleY
    fireArrow()
  }

  function onCanvasMouseMove(e) {
    if (!_gameMode || !_canvas) return
    const rect   = _canvas.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    G.mx = (e.clientX - rect.left) * scaleX
    G.my = (e.clientY - rect.top)  * scaleY
  }

  // ── Public API ────────────────────────────────────────────────
  window.initTargetPracticeAnim = function(canvas) {
    if (_animId) cancelAnimationFrame(_animId)
    _canvas = canvas
    if (!_canvas) return
    _ctx = _canvas.getContext('2d')
    W = _canvas.width; H = _canvas.height
    TODD_X = 52;    TODD_Y = H - 22
    TGT_X  = W - 52; TGT_Y = H / 2 - 5
    TGT_R  = [20, 13, 6]

    _gameMode = false
    A.phase = 'idle'; A.timer = 0; A.frame = 0; A.hitFlash = 0

    _canvas.style.cursor = 'pointer'
    _canvas.addEventListener('click',     onCanvasClick)
    _canvas.addEventListener('mousemove', onCanvasMouseMove)

    _animId = requestAnimationFrame(idleTick)
  }

  window.stopTargetPracticeAnim = function() {
    if (_animId) { cancelAnimationFrame(_animId); _animId = null }
    if (_canvas) {
      _canvas.removeEventListener('click',     onCanvasClick)
      _canvas.removeEventListener('mousemove', onCanvasMouseMove)
      _canvas.style.cursor = ''
    }
    _canvas = null; _ctx = null; _gameMode = false
  }

})()
