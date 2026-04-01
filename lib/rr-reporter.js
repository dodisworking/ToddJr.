import ExcelJS from 'exceljs'

// ── Color helpers ──────────────────────────────────────────
const NAVY   = 'FF0F172A'
const WHITE  = 'FFFFFFFF'
const GREEN  = 'FF10B981'
const RED    = 'FFEF4444'
const ORANGE = 'FFF97316'
const YELLOW = 'FFFBBF24'
const LIGHT_GREEN = 'FFD1FAE5'
const LIGHT_RED   = 'FFFEE2E2'
const LIGHT_ORANGE= 'FFFED7AA'
const LIGHT_YELLOW= 'FFFEF9C3'
const GRAY_BG     = 'FFF1F5F9'

function applyCell(cell, value, opts = {}) {
  cell.value = value
  if (opts.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
  }
  cell.font = {
    name: 'Calibri',
    size: opts.size || 10,
    bold: !!opts.bold,
    color: { argb: opts.color || 'FF000000' }
  }
  cell.alignment = {
    vertical: 'middle',
    horizontal: opts.align || 'left',
    wrapText: !!opts.wrap
  }
  if (opts.border) {
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right:  { style: 'thin', color: { argb: 'FFD1D5DB' } }
    }
  }
}

function headerRow(ws, rowNum, cols) {
  const row = ws.getRow(rowNum)
  cols.forEach((label, i) => {
    const cell = row.getCell(i + 1)
    applyCell(cell, label, { fill: NAVY, color: WHITE, bold: true, size: 10, align: 'center', border: true })
  })
  row.height = 18
}

function checkMark(match) {
  return match ? '✓' : '✗'
}

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT — returns Buffer
// ═══════════════════════════════════════════════════════════
export async function generateRRReport(comparison) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Todd Jr. — Rent Roll Chef'
  wb.created = new Date()

  buildSummarySheet(wb, comparison)
  buildComparisonSheet(wb, comparison)
  buildDifferencesSheet(wb, comparison)

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// ═══════════════════════════════════════════════════════════
// SHEET 1: Summary
// ═══════════════════════════════════════════════════════════
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary', { tabColor: { argb: '10B981' } })
  ws.columns = [{ width: 36 }, { width: 20 }]

  const s = data.summary || {}
  let r = 1

  // Title
  const titleCell = ws.getRow(r).getCell(1)
  ws.mergeCells(r, 1, r, 2)
  applyCell(titleCell, 'RENT ROLL CHEF — RECONCILIATION REPORT', { fill: NAVY, color: WHITE, bold: true, size: 13, align: 'center' })
  ws.getRow(r).height = 24
  r++

  // Property
  const propCell = ws.getRow(r).getCell(1)
  ws.mergeCells(r, 1, r, 2)
  applyCell(propCell, `Property: ${data.property || 'Unknown'}`, { fill: GRAY_BG, bold: true, size: 11, align: 'center' })
  ws.getRow(r).height = 20
  r++

  // Generated date
  const dateCell = ws.getRow(r).getCell(1)
  ws.mergeCells(r, 1, r, 2)
  applyCell(dateCell, `Generated: ${new Date().toLocaleString()}`, { fill: GRAY_BG, size: 9, align: 'center', color: 'FF6B7280' })
  r++

  r++ // blank row

  // Stats header
  const statsHdr = ws.getRow(r).getCell(1)
  ws.mergeCells(r, 1, r, 2)
  applyCell(statsHdr, 'RECONCILIATION STATISTICS', { fill: NAVY, color: WHITE, bold: true, align: 'center' })
  r++

  const statRow = (label, value, highlight) => {
    const row = ws.getRow(r)
    applyCell(row.getCell(1), label, { fill: GRAY_BG, border: true })
    applyCell(row.getCell(2), value, {
      fill: highlight ? LIGHT_RED : GRAY_BG,
      color: highlight ? 'FFDC2626' : 'FF111827',
      bold: highlight,
      align: 'center',
      border: true
    })
    r++
  }

  statRow('Total Argus Tenants',    data.argusTenantsTotal  ?? s.totalTenants ?? 0)
  statRow('Total Client Tenants',   data.clientTenantsTotal ?? s.totalTenants ?? 0)
  statRow('Matched Tenants',        s.matched ?? 0)
  statRow('Clean Match (no diffs)', s.cleanMatch ?? 0)
  statRow('With Differences',       s.withDifferences ?? 0, (s.withDifferences ?? 0) > 0)
  statRow('Argus Only (not in client)', s.argusOnly ?? 0, (s.argusOnly ?? 0) > 0)
  statRow('Client Only (not in argus)', s.clientOnly ?? 0, (s.clientOnly ?? 0) > 0)
}

// ═══════════════════════════════════════════════════════════
// SHEET 2: Comparison
// ═══════════════════════════════════════════════════════════
function buildComparisonSheet(wb, data) {
  const ws = wb.addWorksheet('Comparison', {
    tabColor: { argb: '3B82F6' },
    views: [{ state: 'frozen', ySplit: 1 }]
  })

  const COLS = [
    { header: 'Suite',          width: 10 },
    { header: 'Matched By',     width: 12 },
    { header: 'Argus Tenant',   width: 28 },
    { header: 'Client Tenant',  width: 28 },
    { header: 'Name✓/✗',        width: 8  },
    { header: 'Argus SF',       width: 10 },
    { header: 'Client SF',      width: 10 },
    { header: 'SF✓/✗',          width: 7  },
    { header: 'Argus Start',    width: 12 },
    { header: 'Client Start',   width: 12 },
    { header: 'Start✓/✗',       width: 8  },
    { header: 'Argus End',      width: 12 },
    { header: 'Client End',     width: 12 },
    { header: 'End✓/✗',         width: 7  },
    { header: 'Argus Monthly',  width: 13 },
    { header: 'Client Monthly', width: 13 },
    { header: 'Rent✓/✗',        width: 7  },
    { header: 'Argus $/SF',     width: 10 },
    { header: 'Client $/SF',    width: 10 },
    { header: 'Differences',    width: 40 },
    { header: 'Status',         width: 14 },
  ]

  ws.columns = COLS.map(c => ({ width: c.width }))
  headerRow(ws, 1, COLS.map(c => c.header))

  const groups = data.tenantGroups || []
  let r = 2

  for (const g of groups) {
    const row = ws.getRow(r)
    row.height = 16

    // Determine row status color
    let statusFill, statusLabel
    if (g.argusOnly) {
      statusFill = LIGHT_ORANGE; statusLabel = 'ARGUS ONLY'
    } else if (g.clientOnly) {
      statusFill = LIGHT_ORANGE; statusLabel = 'CLIENT ONLY'
    } else if (!g.allMatch) {
      statusFill = LIGHT_RED; statusLabel = 'DIFFERENCES'
    } else {
      statusFill = LIGHT_GREEN; statusLabel = 'MATCH'
    }

    const argus  = g.argus  || {}
    const client = g.client || {}

    // Build differences text
    const diffs = (g.differences || []).map(d => `${d.label}: Argus=${d.argusValue} | Client=${d.clientValue}`).join('\n')

    // Helper: check if a field matches
    const fieldMatch = (fieldKey) => {
      return !(g.differences || []).some(d => d.field === fieldKey)
    }
    const tick = (match) => {
      const c = row.getCell(0) // placeholder
      return match ? '✓' : '✗'
    }
    const tickFill = (match) => match ? LIGHT_GREEN : LIGHT_RED
    const tickColor = (match) => match ? 'FF059669' : 'FFDC2626'

    const nameMatch  = fieldMatch('tenant_name')
    const sfMatch    = fieldMatch('sqft')
    const startMatch = fieldMatch('lease_start')
    const endMatch   = fieldMatch('lease_end')
    const rentMatch  = fieldMatch('monthly_rent')

    const fmt = (v) => (v === null || v === undefined) ? '—' : String(v)
    const fmtNum = (v) => (v === null || v === undefined) ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)

    const cells = [
      { val: fmt(g.suite),              fill: statusFill },
      { val: fmt(g.matchedBy),          fill: statusFill },
      { val: fmt(argus.tenantName),     fill: statusFill },
      { val: fmt(client.tenantName),    fill: statusFill },
      { val: checkMark(nameMatch),      fill: tickFill(nameMatch),  color: tickColor(nameMatch),  align: 'center' },
      { val: fmtNum(argus.sqft),        fill: statusFill },
      { val: fmtNum(client.sqft),       fill: statusFill },
      { val: checkMark(sfMatch),        fill: tickFill(sfMatch),    color: tickColor(sfMatch),    align: 'center' },
      { val: fmt(argus.leaseStart),     fill: statusFill },
      { val: fmt(client.leaseStart),    fill: statusFill },
      { val: checkMark(startMatch),     fill: tickFill(startMatch), color: tickColor(startMatch), align: 'center' },
      { val: fmt(argus.leaseEnd),       fill: statusFill },
      { val: fmt(client.leaseEnd),      fill: statusFill },
      { val: checkMark(endMatch),       fill: tickFill(endMatch),   color: tickColor(endMatch),   align: 'center' },
      { val: fmtNum(argus.monthlyRent), fill: statusFill },
      { val: fmtNum(client.monthlyRent),fill: statusFill },
      { val: checkMark(rentMatch),      fill: tickFill(rentMatch),  color: tickColor(rentMatch),  align: 'center' },
      { val: fmtNum(argus.monthlyPerSF), fill: statusFill },
      { val: fmtNum(client.monthlyPerSF),fill: statusFill },
      { val: diffs || '',               fill: statusFill, wrap: true },
      { val: statusLabel,               fill: statusFill, bold: true, align: 'center' },
    ]

    cells.forEach((c, i) => {
      applyCell(row.getCell(i + 1), c.val, {
        fill: c.fill,
        color: c.color || 'FF111827',
        bold: !!c.bold,
        align: c.align || 'left',
        wrap: !!c.wrap,
        border: true
      })
    })

    if (diffs) row.height = Math.min(80, 16 + (diffs.split('\n').length - 1) * 14)
    r++
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

// ═══════════════════════════════════════════════════════════
// SHEET 3: Differences Only
// ═══════════════════════════════════════════════════════════
function buildDifferencesSheet(wb, data) {
  const ws = wb.addWorksheet('Differences Only', {
    tabColor: { argb: 'EF4444' },
    views: [{ state: 'frozen', ySplit: 1 }]
  })

  const COLS = [
    { header: 'Suite',         width: 10 },
    { header: 'Tenant',        width: 28 },
    { header: 'Field',         width: 20 },
    { header: 'Argus Value',   width: 24 },
    { header: 'Client Value',  width: 24 },
    { header: 'Severity',      width: 10 },
  ]

  ws.columns = COLS.map(c => ({ width: c.width }))
  headerRow(ws, 1, COLS.map(c => c.header))

  const severityFill = (sev) => {
    if (sev === 'HIGH')   return LIGHT_RED
    if (sev === 'MEDIUM') return LIGHT_ORANGE
    return LIGHT_YELLOW
  }
  const severityColor = (sev) => {
    if (sev === 'HIGH')   return 'FFDC2626'
    if (sev === 'MEDIUM') return 'FFC2410C'
    return 'FF92400E'
  }

  const groups = data.tenantGroups || []
  let r = 2

  for (const g of groups) {
    const tenantName = g.argus?.tenantName || g.client?.tenantName || '—'
    const diffs = g.differences || []

    // Argus-only or client-only tenants
    if (g.argusOnly || g.clientOnly) {
      const row = ws.getRow(r)
      const fill = LIGHT_ORANGE
      const label = g.argusOnly ? 'Argus Only' : 'Client Only'
      const cells = [
        fmt(g.suite), fmt(tenantName), 'MISSING TENANT',
        g.argusOnly ? fmt(tenantName) : '—',
        g.clientOnly ? fmt(tenantName) : '—',
        'HIGH'
      ]
      cells.forEach((val, i) => {
        applyCell(row.getCell(i + 1), val, {
          fill, color: 'FFC2410C', bold: i === 5, border: true, align: i === 5 ? 'center' : 'left'
        })
      })
      row.height = 16
      r++
      continue
    }

    for (const diff of diffs) {
      const sev = diff.severity || 'LOW'
      const fill = severityFill(sev)
      const color = severityColor(sev)
      const row = ws.getRow(r)
      const cells = [
        fmt(g.suite),
        fmt(tenantName),
        fmt(diff.label || diff.field),
        fmt(diff.argusValue),
        fmt(diff.clientValue),
        sev
      ]
      cells.forEach((val, i) => {
        applyCell(row.getCell(i + 1), val, {
          fill, color, bold: i === 5, border: true, align: i === 5 ? 'center' : 'left', wrap: i === 3 || i === 4
        })
      })
      row.height = 16
      r++
    }
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

function fmt(v) {
  return (v === null || v === undefined) ? '—' : String(v)
}
