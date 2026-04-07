/**
 * target-game.js — Robin Hood Todd loading animation + mini-game
 * Purely cosmetic. No AI calls or server state is touched.
 */
;(function TargetPracticeGame() {

  let _animId  = null
  let _canvas  = null
  let _ctx     = null
  let _gameMode = false
  let W, H

  // Layout (set on init)
  let TODD_X, TODD_Y   // feet position
  let TGT_X,  TGT_Y   // target center

  // ── Colors ────────────────────────────────────────────────────
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

  // ── Idle animation state ──────────────────────────────────────
  const A = {
    phase: 'idle',   // idle | draw | release | fly | hit
    timer: 0,
    frame: 0,
    arrowX: 0,
    arrowY: 0,
    arrowVX: 0,
    arrowVY: 0,
    hitFlash: 0,
  }

  // ── Mini-game state ────────────────────────────────────────────
  const G = {
    arrows:      3,
    score:       0,
    power:       0.3,
    powerDir:    1,
    mx:          0,     // mouse x (in canvas coords)
    my:          0,
    projectiles: [],
    obstacles:   [],
    particles:   [],
    gameOver:    false,
    fired:       false,
    obstTimer:   0,
  }

  // ── Draw helpers ──────────────────────────────────────────────
  function cls(c) { _ctx.fillStyle = c }
  function rec(x, y, w, h) { _ctx.fillRect(x|0, y|0, w|0, h|0) }

  // Draw a "pixel" at pixel-grid position col,row with given scale S, offset ox,oy
  function pxl(col, row, S, ox, oy, color) {
    cls(color); rec(ox + col * S, oy + row * S, S, S)
  }

  // ── Background scene ─────────────────────────────────────────
  function drawBG() {
    // Sky gradient via two rects
    cls(BG);     rec(0, 0, W, H * 0.7)
    cls('#0d1b2e'); rec(0, H * 0.7, W, H * 0.3)
    // Moon
    cls('#fef9c3')
    _ctx.beginPath(); _ctx.arc(W - 40, 22, 10, 0, Math.PI * 2); _ctx.fill()
    cls('#0d1b2e')
    _ctx.beginPath(); _ctx.arc(W - 36, 20, 9, 0, Math.PI * 2); _ctx.fill()
    // Stars
    cls('#e2e8f0')
    [[15,10],[35,8],[60,15],[90,6],[120,12],[160,5],[W-80,8],[W-120,14]].forEach(([sx,sy]) => {
      rec(sx, sy, 2, 2)
    })
    // Ground
    cls(GROUND); rec(0, H - 18, W, 18)
    cls(GRASS)
    for (let gx = 0; gx < W; gx += 8) { rec(gx, H - 18, 4, 3) }
    // Trees
    [[20, H - 18], [W - 24, H - 18]].forEach(([tx, ty]) => {
      cls(TRUNK); rec(tx - 3, ty - 22, 6, 22)
      cls(TREE_D); rec(tx - 10, ty - 40, 20, 18)
      cls(TREE_L); rec(tx - 7,  ty - 52, 14, 16)
      cls(TREE_D); rec(tx - 4,  ty - 62, 8,  14)
    })
  }

  // ── Todd Robin Hood sprite ────────────────────────────────────
  function drawTodd(cx, cy, phase, frame) {
    const S  = 3
    const bob = Math.floor(frame / 24) % 2 === 0 ? 0 : 1
    // Sprite is 12 cols × 16 rows; feet at cy, centered at cx
    const ox = cx - 6 * S
    const oy = cy - 16 * S + bob

    function p(col, row, color) { pxl(col, row, S, ox, oy, color) }
    function r(col, row, w, h, color) { cls(color); rec(ox+col*S, oy+row*S, w*S, h*S) }

    // Hat
    r(4, 0, 3, 1, HAT)
    r(3, 1, 5, 1, HAT)
    r(2, 2, 7, 1, HAT_L)
    p(9, 1, FEATHER); p(10, 0, FEATHER)

    // Head
    r(3, 3, 5, 3, SKIN)
    r(2, 4, 7, 2, SKIN)
    // Eyes
    p(3, 4, EYE_C); p(6, 4, EYE_C)
    // Mouth
    r(4, 5, 3, 1, '#7c2c10')

    // Tunic
    r(2, 6, 8, 1, TUNIC_L)
    r(1, 7, 10, 3, TUNIC)
    r(3, 9, 6, 1, BELT)

    // Left arm (bow arm — relaxed)
    p(0, 7, SKIN); p(0, 8, SKIN); p(0, 9, SKIN)

    // Right arm (drawing or relaxed)
    if (phase === 'draw') {
      p(11, 7, SKIN); p(11, 8, SKIN)
    } else {
      p(11, 7, SKIN); p(10, 8, SKIN); p(11, 8, SKIN)
    }

    // Pants
    r(2, 10, 4, 2, PANTS)
    r(7, 10, 3, 2, PANTS)

    // Boots
    r(1, 12, 4, 2, BOOTS)
    r(6, 12, 4, 2, BOOTS)

    // ── Bow ──────────────────────────────────────────────────────
    const bCX = ox - S * 1        // bow left of sprite
    const bCY = oy + S * 8        // mid-body height
    const bR  = S * 6

    _ctx.strokeStyle = BOW_C
    _ctx.lineWidth   = 2.5
    _ctx.beginPath()
    _ctx.arc(bCX + bR * 0.25, bCY, bR, -Math.PI * 0.65, Math.PI * 0.65)
    _ctx.stroke()

    // String
    const pull = phase === 'draw' ? S * 4 : 0
    const topPt = {
      x: bCX + bR * 0.25 + bR * Math.cos(-Math.PI * 0.65),
      y: bCY + bR * Math.sin(-Math.PI * 0.65)
    }
    const botPt = {
      x: bCX + bR * 0.25 + bR * Math.cos(Math.PI * 0.65),
      y: bCY + bR * Math.sin(Math.PI * 0.65)
    }
    const midPt = { x: bCX + bR * 0.25 + pull, y: bCY }

    _ctx.strokeStyle = STRING
    _ctx.lineWidth   = 1
    _ctx.beginPath()
    _ctx.moveTo(topPt.x, topPt.y)
    _ctx.lineTo(midPt.x, midPt.y)
    _ctx.lineTo(botPt.x, botPt.y)
    _ctx.stroke()

    // Nocked arrow (if not in flight)
    if (phase !== 'fly' && phase !== 'hit') {
      const arrowTail = midPt.x
      const arrowTipX = bCX + bR * 0.25 + bR + S * 5
      // Shaft
      _ctx.strokeStyle = SHAFT; _ctx.lineWidth = 2
      _ctx.beginPath()
      _ctx.moveTo(arrowTail, bCY)
      _ctx.lineTo(arrowTipX, bCY)
      _ctx.stroke()
      // Metal tip
      cls(TIP_C)
      _ctx.beginPath()
      _ctx.moveTo(arrowTipX + 6, bCY)
      _ctx.lineTo(arrowTipX, bCY - 3)
      _ctx.lineTo(arrowTipX, bCY + 3)
      _ctx.closePath()
      _ctx.fill()
      // Fletching
      cls(FLETCH)
      _ctx.beginPath()
      _ctx.moveTo(arrowTail - 8, bCY - 5)
      _ctx.lineTo(arrowTail, bCY)
      _ctx.lineTo(arrowTail - 8, bCY + 5)
      _ctx.closePath()
      _ctx.fill()
    }
  }

  // ── Target ─────────────────────────────────────────────────────
  const TGT_R = [20, 13, 6]

  function drawTarget(tx, ty) {
    // Stand
    cls(TRUNK); rec(tx - 3, ty + TGT_R[0], 6, 20)
    cls(TRUNK); rec(tx - 14, ty + TGT_R[0] + 20, 28, 4)
    // Rings
    [TGT_RED, TGT_WHT, TGT_RED].forEach((c, i) => {
      cls(c)
      _ctx.beginPath(); _ctx.arc(tx, ty, TGT_R[i], 0, Math.PI * 2); _ctx.fill()
    })
    // Outline
    _ctx.strokeStyle = DARK; _ctx.lineWidth = 1.5
    _ctx.beginPath(); _ctx.arc(tx, ty, TGT_R[0], 0, Math.PI * 2); _ctx.stroke()
  }

  // ── Arrow projectile (in-flight) ──────────────────────────────
  function drawFlyingArrow(x, y, vx, vy) {
    const angle = Math.atan2(vy, vx)
    const len   = 22
    // Shaft
    _ctx.strokeStyle = SHAFT; _ctx.lineWidth = 2
    _ctx.beginPath()
    _ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len)
    _ctx.lineTo(x, y)
    _ctx.stroke()
    // Tip
    cls(TIP_C)
    _ctx.beginPath()
    _ctx.moveTo(x, y)
    _ctx.lineTo(x - Math.cos(angle - 0.35) * 7, y - Math.sin(angle - 0.35) * 7)
    _ctx.lineTo(x - Math.cos(angle + 0.35) * 7, y - Math.sin(angle + 0.35) * 7)
    _ctx.closePath()
    _ctx.fill()
    // Fletching (tail)
    const tx2 = x - Math.cos(angle) * len
    const ty2 = y - Math.sin(angle) * len
    cls(FLETCH)
    _ctx.beginPath()
    _ctx.moveTo(tx2, ty2)
    _ctx.lineTo(tx2 - Math.cos(angle - Math.PI / 2) * 5, ty2 - Math.sin(angle - Math.PI / 2) * 5)
    _ctx.lineTo(tx2 + Math.cos(angle) * 5, ty2 + Math.sin(angle) * 5)
    _ctx.closePath()
    _ctx.fill()
    _ctx.beginPath()
    _ctx.moveTo(tx2, ty2)
    _ctx.lineTo(tx2 - Math.cos(angle + Math.PI / 2) * 5, ty2 - Math.sin(angle + Math.PI / 2) * 5)
    _ctx.lineTo(tx2 + Math.cos(angle) * 5, ty2 + Math.sin(angle) * 5)
    _ctx.closePath()
    _ctx.fill()
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
      _ctx.beginPath(); _ctx.moveTo(-10, 4); _ctx.lineTo(10, 4); _ctx.stroke()
    } else {
      // plank
      cls('#a16207'); rec(-18, -4, 36, 8)
      _ctx.strokeStyle = '#7c4a10'; _ctx.lineWidth = 1; _ctx.strokeRect(-18, -4, 36, 8)
    }
    _ctx.restore()
  }

  // ── Particles ─────────────────────────────────────────────────
  function spawnParticles(px, py, color) {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2
      G.particles.push({
        x: px, y: py,
        vx: Math.cos(ang) * (1 + Math.random() * 2.5),
        vy: Math.sin(ang) * (1 + Math.random() * 2.5),
        color,
        life: 22 + Math.random() * 10 | 0
      })
    }
  }

  // ── Idle animation tick ───────────────────────────────────────
  function idleTick() {
    A.frame++
    A.timer++
    _ctx.clearRect(0, 0, W, H)
    drawBG()

    // Phase machine — use if/else to avoid const-in-switch TDZ issues
    if (A.phase === 'idle') {
      if (A.timer > 70) { A.phase = 'draw'; A.timer = 0 }
    } else if (A.phase === 'draw') {
      if (A.timer > 55) { A.phase = 'release'; A.timer = 0 }
    } else if (A.phase === 'release') {
      if (A.timer > 6) {
        A.phase = 'fly'
        A.arrowX = TODD_X + 14
        A.arrowY = TODD_Y - 50
        var _dx = TGT_X - A.arrowX, _dy = TGT_Y - A.arrowY
        var _spd = 7, _dist = Math.sqrt(_dx * _dx + _dy * _dy)
        A.arrowVX = (_dx / _dist) * _spd
        A.arrowVY = (_dy / _dist) * _spd - 2.5
        A.timer = 0
      }
    } else if (A.phase === 'fly') {
      A.arrowX += A.arrowVX
      A.arrowY += A.arrowVY
      A.arrowVY += 0.18
      var _adx = A.arrowX - TGT_X, _ady = A.arrowY - TGT_Y
      if (Math.sqrt(_adx * _adx + _ady * _ady) < TGT_R[0] + 4 || A.timer > 90) {
        A.phase = 'hit'; A.hitFlash = 1; A.timer = 0
      }
    } else if (A.phase === 'hit') {
      A.hitFlash = Math.max(0, A.hitFlash - 0.045)
      if (A.timer > 90) { A.phase = 'idle'; A.timer = 0 }
    }

    // Target hit glow
    if (A.hitFlash > 0) {
      _ctx.save(); _ctx.globalAlpha = A.hitFlash * 0.7
      cls('#fbbf24')
      _ctx.beginPath(); _ctx.arc(TGT_X, TGT_Y, TGT_R[0] + 8, 0, Math.PI * 2); _ctx.fill()
      _ctx.restore()
    }

    drawTarget(TGT_X, TGT_Y)

    // Stuck arrow
    if (A.phase === 'hit') {
      drawFlyingArrow(TGT_X - 22, TGT_Y + 1, 7, 0.5)
    }

    // Flying arrow
    if (A.phase === 'fly') {
      drawFlyingArrow(A.arrowX, A.arrowY, A.arrowVX, A.arrowVY)
    }

    drawTodd(TODD_X, TODD_Y, A.phase, A.frame)

    // Click hint
    _ctx.fillStyle = 'rgba(148,163,184,0.45)'
    _ctx.font = '8px monospace'
    _ctx.textAlign = 'center'
    _ctx.fillText('[ click to play ]', W / 2, H - 4)

    _animId = requestAnimationFrame(idleTick)
  }

  // ── Mini-game tick ────────────────────────────────────────────
  function gameTick() {
    A.frame++
    _ctx.clearRect(0, 0, W, H)
    drawBG()

    // Update power bar
    if (!G.gameOver) {
      G.power += 0.022 * G.powerDir
      if (G.power >= 1) G.powerDir = -1
      if (G.power <= 0) G.powerDir =  1

      // Spawn obstacles
      G.obstTimer++
      if (G.obstTimer > 80 && G.obstacles.length < 4) {
        G.obstTimer = 0
        G.obstacles.push({
          type:     ['box','barrel','plank'][Math.random() * 3 | 0],
          x:        TGT_X - 40 + Math.random() * 60,
          y:        -20,
          vy:       0.9 + Math.random() * 0.7,
          rot:      0,
          rotSpeed: (Math.random() - 0.5) * 0.06,
        })
      }

      // Update obstacles
      G.obstacles.forEach(o => {
        o.y += o.vy; o.rot += o.rotSpeed
      })
      G.obstacles = G.obstacles.filter(o => o.y < H + 40)

      // Update projectiles
      G.projectiles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.17
        // Target hit
        const dx = p.x - TGT_X, dy = p.y - TGT_Y
        const d  = Math.sqrt(dx * dx + dy * dy)
        if (d < TGT_R[0] + 4) {
          let pts = 10
          if (d < TGT_R[2]) pts = 100
          else if (d < TGT_R[1]) pts = 50
          G.score += pts
          A.hitFlash = 1
          spawnParticles(p.x, p.y, '#fbbf24')
          p.dead = true
        }
        // Obstacle hit
        G.obstacles.forEach(o => {
          const dx2 = p.x - o.x, dy2 = p.y - o.y
          if (!o.dead && Math.abs(dx2) < 13 && Math.abs(dy2) < 13) {
            G.score += 25
            spawnParticles(o.x, o.y, '#f97316')
            o.dead = true; p.dead = true
          }
        })
        if (p.x > W + 20 || p.y > H + 20 || p.x < -20) p.dead = true
      })
      G.projectiles = G.projectiles.filter(p => !p.dead)
      G.obstacles   = G.obstacles.filter(o => !o.dead)

      // Particles
      G.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life-- })
      G.particles = G.particles.filter(p => p.life > 0)

      // Target hit glow
      if (A.hitFlash > 0) A.hitFlash = Math.max(0, A.hitFlash - 0.04)

      // Game over?
      if (G.arrows <= 0 && G.projectiles.length === 0 && !G.fired) {
        G.gameOver = true
      }
    }

    // Draw obstacles (below target)
    G.obstacles.forEach(drawObstacle)

    // Target glow
    if (A.hitFlash > 0) {
      _ctx.save(); _ctx.globalAlpha = A.hitFlash * 0.6
      cls('#fbbf24')
      _ctx.beginPath(); _ctx.arc(TGT_X, TGT_Y, TGT_R[0] + 9, 0, Math.PI * 2); _ctx.fill()
      _ctx.restore()
    }

    drawTarget(TGT_X, TGT_Y)

    // Particles
    G.particles.forEach(p => {
      _ctx.save(); _ctx.globalAlpha = p.life / 30
      cls(p.color); rec(p.x - 2, p.y - 2, 4, 4)
      _ctx.restore()
    })

    // Projectiles
    G.projectiles.forEach(p => drawFlyingArrow(p.x, p.y, p.vx, p.vy))

    // Aim line (dashed)
    if (!G.gameOver && G.arrows > 0) {
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

    drawTodd(TODD_X, TODD_Y,
      G.projectiles.length > 0 ? 'fly' : (G.arrows > 0 ? 'draw' : 'idle'),
      A.frame)

    // ── HUD ───────────────────────────────────────────────────────
    // Power bar
    if (!G.gameOver) {
      const PX = 10, PY = H - 28, PW = 56, PH = 7
      cls('#0f172a'); rec(PX, PY, PW, PH)
      const pc = G.power > 0.7 ? '#ef4444' : G.power > 0.4 ? '#f97316' : '#4ade80'
      cls(pc); rec(PX, PY, PW * G.power, PH)
      _ctx.strokeStyle = '#334155'; _ctx.lineWidth = 1; _ctx.strokeRect(PX, PY, PW, PH)
      _ctx.fillStyle = '#94a3b8'; _ctx.font = '7px monospace'; _ctx.textAlign = 'left'
      _ctx.fillText('PWR', PX, PY - 2)
    }
    // Arrows & score
    _ctx.fillStyle = '#fbbf24'; _ctx.font = '8px monospace'; _ctx.textAlign = 'left'
    _ctx.fillText('🏹×' + G.arrows, 8, 14)
    _ctx.fillStyle = '#4ade80'; _ctx.textAlign = 'right'
    _ctx.fillText(G.score + ' pts', W - 8, 14)

    // Game over overlay
    if (G.gameOver) {
      _ctx.fillStyle = 'rgba(0,0,0,0.55)'
      rec(0, 0, W, H)
      _ctx.fillStyle = '#4ade80'; _ctx.font = 'bold 13px monospace'; _ctx.textAlign = 'center'
      _ctx.fillText('SCORE: ' + G.score, W / 2, H / 2 - 10)
      _ctx.fillStyle = '#a78bfa'; _ctx.font = '8px monospace'
      _ctx.fillText('[ click to play again ]', W / 2, H / 2 + 10)
    }

    _animId = requestAnimationFrame(gameTick)
  }

  // ── Game actions ──────────────────────────────────────────────
  function startGame() {
    _gameMode = true
    G.arrows = 3; G.score = 0; G.power = 0.3; G.powerDir = 1
    G.projectiles = []; G.obstacles = []; G.particles = []
    G.gameOver = false; G.fired = false; G.obstTimer = 0
    A.hitFlash = 0
    if (_animId) cancelAnimationFrame(_animId)
    _animId = requestAnimationFrame(gameTick)
  }

  function fireArrow() {
    if (G.fired || G.arrows <= 0 || G.gameOver) return
    G.fired = true
    G.arrows--
    const ang = Math.atan2(G.my - (TODD_Y - 50), G.mx - (TODD_X + 14))
    const spd = 5 + G.power * 7
    G.projectiles.push({
      x: TODD_X + 14, y: TODD_Y - 50,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      dead: false
    })
    setTimeout(() => { G.fired = false }, 350)
  }

  // ── Event wiring ──────────────────────────────────────────────
  function onCanvasClick(e) {
    if (!_gameMode) {
      startGame()
      return
    }
    if (G.gameOver) {
      startGame()
      return
    }
    const rect = _canvas.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    G.mx = (e.clientX - rect.left) * scaleX
    G.my = (e.clientY - rect.top)  * scaleY
    fireArrow()
  }

  function onCanvasMouseMove(e) {
    if (!_gameMode || !_canvas) return
    const rect  = _canvas.getBoundingClientRect()
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
    _ctx    = _canvas.getContext('2d')
    W  = _canvas.width
    H  = _canvas.height
    TODD_X = 52
    TODD_Y = H - 22
    TGT_X  = W - 52
    TGT_Y  = H / 2 - 5

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
