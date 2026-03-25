/**
 * Dr. Todd Test Lab — parametric pixel flasks (per-mode colors, fixed shape).
 */
;(function () {
  const DEFAULTS = {
    fillPercent: 48,
    baseWidthScale: 0.92,
    pivotY: 17,
    outlineColor: '#000000',
    emptyTop: '#C8F0D8',
    emptyBottom: '#90D4AE',
    liquidTop: '#5BC97E',
    liquidBottom: '#28934F',
    highlightColor: '#F5F7E9',
    glowColor: '',
    bottomOutlineThickness: 1,
  }

  const MODE_THEMES = {
    juice: {
      emptyTop: '#C8F0D8',
      emptyBottom: '#90D4AE',
      liquidTop: '#5BC97E',
      liquidBottom: '#28934F',
      highlightColor: '#F5F7E9',
      glowColor: '',
    },
    triple: {
      emptyTop: '#EDE9FE',
      emptyBottom: '#C4B5FD',
      liquidTop: '#A78BFA',
      liquidBottom: '#6D28D9',
      highlightColor: '#FAF5FF',
      glowColor: '',
    },
    double: {
      emptyTop: '#E0F2FE',
      emptyBottom: '#7DD3FC',
      liquidTop: '#38BDF8',
      liquidBottom: '#0369A1',
      highlightColor: '#F0F9FF',
      glowColor: '',
    },
    api: {
      emptyTop: '#FEF3C7',
      emptyBottom: '#FCD34D',
      liquidTop: '#FBBF24',
      liquidBottom: '#B45309',
      highlightColor: '#FFFBEB',
      glowColor: '',
    },
    openai: {
      emptyTop: '#D1FAE5',
      emptyBottom: '#6EE7B7',
      liquidTop: '#34D399',
      liquidBottom: '#047857',
      highlightColor: '#ECFDF5',
      glowColor: '',
    },
  }

  function labModeFromTube(tube) {
    if (!tube) return 'juice'
    if (tube.classList.contains('drlab-tube-triple')) return 'triple'
    if (tube.classList.contains('drlab-tube-double')) return 'double'
    if (tube.classList.contains('drlab-tube-api')) return 'api'
    if (tube.classList.contains('drlab-tube-openai')) return 'openai'
    return 'juice'
  }

  function settingsForMode(mode) {
    const theme = MODE_THEMES[mode] || MODE_THEMES.juice
    return { ...DEFAULTS, ...theme }
  }

  function glowHexForSettings(s) {
    const full = { ...DEFAULTS, ...s }
    const fallback = full.liquidTop || '#5BC97E'
    let glow = (full.glowColor && full.glowColor.trim()) || fallback
    if (!/^#[0-9A-Fa-f]{6}$/.test(glow)) glow = fallback
    return glow
  }

  const OUTLINE_UPPER_RECTS = [
    [7, 1, 6, 1], [6, 2, 8, 1], [8, 3, 4, 1], [8, 4, 1, 1], [11, 4, 1, 1],
    [7, 5, 1, 1], [12, 5, 1, 1], [6, 6, 1, 1], [13, 6, 1, 1], [5, 7, 1, 1],
    [14, 7, 1, 1], [4, 8, 1, 1], [15, 8, 1, 1], [3, 9, 1, 1], [16, 9, 1, 1],
    [2, 10, 1, 1], [17, 10, 1, 1], [2, 11, 1, 1], [17, 11, 1, 1], [2, 12, 1, 1],
    [17, 12, 1, 1], [2, 13, 1, 1], [17, 13, 1, 1], [2, 14, 1, 1], [17, 14, 1, 1],
  ]

  function buildBottomOutlineRects(thickness) {
    const t = clamp(Math.round(Number(thickness) || 1), 1, 5)
    const rows = []
    for (let i = 0; i < t; i++) {
      const y = 15 + i
      if (y > 19) break
      const x = 2 + i
      const w = 16 - 2 * i
      if (w < 4) break
      rows.push([x, y, w, 1])
    }
    return rows
  }

  const INNER_X = {
    3: [9, 10], 4: [9, 10], 5: [9, 10], 6: [8, 11], 7: [7, 12], 8: [6, 13],
    9: [5, 14], 10: [4, 15], 11: [3, 15], 12: [3, 15], 13: [3, 15], 14: [3, 15],
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n))
  }

  function lerpColor(a, b, t) {
    const pa = a.replace('#', '')
    const pb = b.replace('#', '')
    const ra = parseInt(pa.slice(0, 2), 16), ga = parseInt(pa.slice(2, 4), 16), ba = parseInt(pa.slice(4, 6), 16)
    const rb = parseInt(pb.slice(0, 2), 16), gb = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16)
    const r = Math.round(ra + (rb - ra) * t)
    const g = Math.round(ga + (gb - ga) * t)
    const bl = Math.round(ba + (bb - ba) * t)
    return `#${[r, g, bl].map(x => x.toString(16).padStart(2, '0')).join('')}`
  }

  function scaleXAround(cx, x, sx) {
    return Math.round(cx + (x - cx) * sx)
  }

  function buildFlaskSvg(settings) {
    const s = { ...DEFAULTS, ...settings }
    const sx = clamp(Number(s.baseWidthScale) || 1, 0.55, 1)
    const py = clamp(Number(s.pivotY) || 17, 8, 19)
    const fillPct = clamp(Number(s.fillPercent) || 0, 0, 100)
    const oc = s.outlineColor || '#000000'
    const emptyTop = s.emptyTop || DEFAULTS.emptyTop
    const emptyBottom = s.emptyBottom || DEFAULTS.emptyBottom
    const liquidTop = s.liquidTop || DEFAULTS.liquidTop
    const liquidBottom = s.liquidBottom || DEFAULTS.liquidBottom
    const hiCol = s.highlightColor || DEFAULTS.highlightColor

    const rows = Object.keys(INNER_X).map(Number).sort((a, b) => a - b)
    const yMin = rows[0]
    const yMax = rows[rows.length - 1]
    const innerH = yMax - yMin + 1
    const liquidStartY = yMin + Math.ceil(innerH * (100 - fillPct) / 100)

    const bottomThick = clamp(
      Math.round(Number(s.bottomOutlineThickness) || DEFAULTS.bottomOutlineThickness),
      1,
      5
    )
    const outlineRects = [...OUTLINE_UPPER_RECTS, ...buildBottomOutlineRects(bottomThick)]

    let body = ''
    for (const [x, y, w, h] of outlineRects) {
      body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${oc}"/>`
    }

    for (const y of rows) {
      let [xa, xb] = INNER_X[y]
      xa = scaleXAround(10, xa, sx)
      xb = scaleXAround(10, xb, sx)
      if (xa > xb) [xa, xb] = [xb, xa]
      const tEmpty = (y - yMin) / Math.max(1, innerH - 1)
      const tLiq = (y - liquidStartY) / Math.max(1, yMax - liquidStartY + 0.001)
      for (let x = xa; x <= xb; x++) {
        const isLiq = y >= liquidStartY
        const fill = isLiq
          ? lerpColor(liquidTop, liquidBottom, clamp(tLiq, 0, 1))
          : lerpColor(emptyTop, emptyBottom, tEmpty)
        body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`
      }
    }

    const hx = [[7, 8], [6, 9], [6, 10]]
    for (const [x, y] of hx) {
      const xs = scaleXAround(10, x, sx)
      if (y < liquidStartY) {
        body += `<rect x="${xs}" y="${y}" width="1" height="1" fill="${hiCol}"/>`
      }
    }

    const g = `<g transform="translate(10,${py}) scale(${sx},1) translate(-10,-${py})">${body}</g>`

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" shape-rendering="crispEdges">${g}</svg>`
    )
  }

  const blobUrls = new WeakMap()

  function setJarImg(jarEl, svgString) {
    let img = jarEl.querySelector('img.drlab-flask-sprite')
    if (!img) {
      img = document.createElement('img')
      img.className = 'drlab-flask-sprite'
      img.alt = ''
      img.width = 86
      img.height = 86
      jarEl.appendChild(img)
    }
    const prev = blobUrls.get(img)
    if (prev) URL.revokeObjectURL(prev)
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }))
    blobUrls.set(img, url)
    img.src = url
  }

  function refreshAllLabFlasks() {
    document.querySelectorAll('.drlab-tube').forEach(tube => {
      const jar = tube.querySelector('.drlab-tube-jar')
      if (!jar) return
      const mode = labModeFromTube(tube)
      const s = settingsForMode(mode)
      setJarImg(jar, buildFlaskSvg(s))
      tube.style.setProperty('--drlab-flask-glow', glowHexForSettings(s))
    })
    document.documentElement.style.removeProperty('--drlab-flask-glow')
  }

  function init() {
    window.__refreshLabFlasks = refreshAllLabFlasks
    if (document.querySelector('.drlab-tube-jar')) refreshAllLabFlasks()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
