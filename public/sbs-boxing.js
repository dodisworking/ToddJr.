/**
 * 8-bit boxing arena for side-by-side loading (walk-in + silly punch loop).
 */
;(function () {
  const P = 4
  const W = 64
  const H = 72

  let raf = null
  let t0 = 0

  function drawPixel(ctx, gx, gy, gw, gh, fill) {
    ctx.fillStyle = fill
    ctx.fillRect(gx * P, gy * P, gw * P, gh * P)
  }

  /** Chibi facing right; mirror wrapper used for right-side boxer. punch 0..1 */
  function drawBoxer(ctx, skin, trunks, glove, punch) {
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, H)
    const o = '#0f172a'
    const w = '#ffffff'
    const armExt = Math.floor(punch * 3)

    drawPixel(ctx, 4, 2, 4, 4, skin)
    drawPixel(ctx, 3, 3, 6, 4, o)
    drawPixel(ctx, 4, 3, 4, 3, skin)
    drawPixel(ctx, 5, 6, 4, 6, trunks)
    drawPixel(ctx, 4, 6, 6, 6, o)
    drawPixel(ctx, 5, 12, 2, 5, o)
    drawPixel(ctx, 8, 12, 2, 5, o)
    drawPixel(ctx, 5, 12, 2, 4, skin)
    drawPixel(ctx, 8, 12, 2, 4, skin)
    drawPixel(ctx, 2, 7, 2, 2, skin)
    drawPixel(ctx, 1, 8, 2, 2, o)
    drawPixel(ctx, 8 + armExt, 7, 2 + Math.min(armExt, 2), 2, skin)
    drawPixel(ctx, 9 + armExt, 6, 2, 3, o)
    drawPixel(ctx, 10 + armExt, 6, 2, 2, glove)
    ctx.fillStyle = w
    ctx.fillRect(17, 11, P, P)
  }

  function frame(now) {
    const leftCv = document.getElementById('sbs-boxer-canvas-left')
    const rightCv = document.getElementById('sbs-boxer-canvas-right')
    const slotL = document.querySelector('.sbs-boxer-slot--left')
    const slotR = document.querySelector('.sbs-boxer-slot--right')
    if (!leftCv || !rightCv || !slotL || !slotR) {
      raf = requestAnimationFrame(frame)
      return
    }

    const openAiTest = document.getElementById('sbs-loading')?.classList.contains('sbs-loading--openaitest')
    if (openAiTest) {
      slotL.style.transform = ''
      slotR.style.transform = ''
      leftCv.getContext('2d').clearRect(0, 0, W, H)
      rightCv.getContext('2d').clearRect(0, 0, W, H)
      raf = requestAnimationFrame(frame)
      return
    }

    const t = (now - t0) / 1000
    const walkDur = 1.6
    const w = Math.min(1, t / walkDur)
    const ease = 1 - (1 - w) * (1 - w)
    const bob = Math.sin(t * 10) * 2

    slotL.style.transform = `translateX(${ease * 24}px) translateY(${bob}px)`
    slotR.style.transform = `translateX(${-ease * 24}px) translateY(${Math.sin(t * 10 + 0.8) * 2}px)`

    const fightT = Math.max(0, t - walkDur - 0.25)
    const beat = fightT * 3.2
    const pl = fightT > 0 ? Math.max(0, Math.sin(beat)) : 0
    const pr = fightT > 0 ? Math.max(0, Math.sin(beat + Math.PI * 0.85)) : 0

    drawBoxer(leftCv.getContext('2d'), '#fcd34d', '#3b82f6', '#ef4444', pl)
    drawBoxer(rightCv.getContext('2d'), '#fcd34d', '#22c55e', '#4ade80', pr)

    raf = requestAnimationFrame(frame)
  }

  function start() {
    stop()
    t0 = performance.now()
    const slotL = document.querySelector('.sbs-boxer-slot--left')
    const slotR = document.querySelector('.sbs-boxer-slot--right')
    if (slotL) slotL.style.transform = 'translateX(0)'
    if (slotR) slotR.style.transform = 'translateX(0)'
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    if (raf != null) {
      cancelAnimationFrame(raf)
      raf = null
    }
    const leftCv = document.getElementById('sbs-boxer-canvas-left')
    const rightCv = document.getElementById('sbs-boxer-canvas-right')
    if (leftCv) leftCv.getContext('2d').clearRect(0, 0, W, H)
    if (rightCv) rightCv.getContext('2d').clearRect(0, 0, W, H)
  }

  window.SbsArena = { start, stop }
})()
