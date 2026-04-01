import ExcelJS from 'exceljs'

// ── Palette ────────────────────────────────────────────────
const NAVY        = 'FF0F172A'
const WHITE       = 'FFFFFFFF'
const LIGHT_GREEN = 'FFD1FAE5'
const LIGHT_RED   = 'FFFEE2E2'
const LIGHT_ORANGE= 'FFFED7AA'
const GRAY_BG     = 'FFF8FAFC'
const MATCH_GREEN = 'FF059669'
const MISS_RED    = 'FFDC2626'
const ARGUS_HDR   = 'FF1E3A5F'   // dark blue — Argus columns
const CLIENT_HDR  = 'FF1A3B2A'   // dark green — Client columns
const CHECK_HDR   = 'FF374151'   // dark gray — ✓/✗ columns

function cell(ws, r, c, value, opts = {}) {
  const cl = ws.getRow(r).getCell(c)
  cl.value = value
  if (opts.fill) cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
  cl.font = { name: 'Calibri', size: opts.size || 10, bold: !!opts.bold, color: { argb: opts.color || 'FF111827' } }
  cl.alignment = { vertical: 'middle', horizontal: opts.align || 'left', wrapText: !!opts.wrap }
  cl.border = {
    top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right:  { style: 'thin', color: { argb: 'FFD1D5DB' } }
  }
}

const fmt = v => (v == null) ? '—' : String(v)
const fmtMoney = v => (v == null) ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtSF    = v => (v == null) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtPSF   = v => (v == null) ? '—' : `$${Number(v).toFixed(4)}/SF`

// ═══════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════
export async function generateRRReport(comparison) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Todd Jr. — Rent Roll Chef'
  wb.created = new Date()

  buildComparisonSheet(wb, comparison)
  buildSummarySheet(wb, comparison)
  buildDifferencesSheet(wb, comparison)

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// ═══════════════════════════════════════════════════════════
// SHEET 1: Side-by-Side Comparison  (main sheet)
//
// Layout — one row per tenant:
//   Suite | Matched By
//   | Argus Tenant | Client Tenant | ✓/✗
//   | Argus SF     | Client SF     | ✓/✗
//   | Argus Start  | Client Start  | ✓/✗
//   | Argus End    | Client End    | ✓/✗
//   | Argus Mthly  | Client Mthly  | ✓/✗  | Argus $/SF | Client $/SF
//   | Argus Steps  | Client Steps  | ✓/✗
//   | Status | Evidence
// ═══════════════════════════════════════════════════════════
function buildComparisonSheet(wb, data) {
  const ws = wb.addWorksheet('Comparison', {
    tabColor: { argb: '3B82F6' },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }]   // freeze first 2 header rows
  })

  // ── Column definitions ──────────────────────────────────
  // Col:  1        2           3               4               5
  //       Suite  Matched By  Argus Tenant    Client Tenant   Name✓/✗
  //   6          7           8
  //   Argus SF   Client SF   SF✓/✗
  //   9          10          11
  //   Argus Start Client Start Start✓/✗
  //   12         13          14
  //   Argus End   Client End  End✓/✗
  //   15            16              17
  //   Argus Monthly Client Monthly  Rent✓/✗
  //   18          19
  //   Argus $/SF   Client $/SF
  //   20            21              22
  //   Argus Steps   Client Steps    Steps✓/✗
  //   23       24
  //   Status   Evidence

  const colWidths = [
    10,  // 1  Suite
    12,  // 2  Matched By
    28,  // 3  Argus Tenant
    28,  // 4  Client Tenant
    7,   // 5  Name ✓/✗
    11,  // 6  Argus SF
    11,  // 7  Client SF
    7,   // 8  SF ✓/✗
    13,  // 9  Argus Start
    13,  // 10 Client Start
    7,   // 11 Start ✓/✗
    13,  // 12 Argus End
    13,  // 13 Client End
    7,   // 14 End ✓/✗
    15,  // 15 Argus Monthly
    15,  // 16 Client Monthly
    7,   // 17 Rent ✓/✗
    13,  // 18 Argus $/SF/Mo
    13,  // 19 Client $/SF/Mo
    36,  // 20 Argus Rent Steps
    36,  // 21 Client Rent Steps
    8,   // 22 Steps ✓/✗
    14,  // 23 Status
    70,  // 24 Evidence
  ]
  ws.columns = colWidths.map(w => ({ width: w }))

  // ── Row 1: group headers ────────────────────────────────
  const groupHeaders = [
    { col: 1,  span: 2,  label: 'IDENTIFIER',    fill: NAVY },
    { col: 3,  span: 3,  label: 'TENANT NAME',   fill: ARGUS_HDR },
    { col: 6,  span: 3,  label: 'SQUARE FOOTAGE',fill: ARGUS_HDR },
    { col: 9,  span: 3,  label: 'LEASE START',   fill: ARGUS_HDR },
    { col: 12, span: 3,  label: 'LEASE END',      fill: ARGUS_HDR },
    { col: 15, span: 5,  label: 'CURRENT RENT',   fill: ARGUS_HDR },
    { col: 20, span: 3,  label: 'RENT STEPS',     fill: ARGUS_HDR },
    { col: 23, span: 1,  label: 'STATUS',         fill: NAVY },
    { col: 24, span: 1,  label: 'EVIDENCE',       fill: NAVY },
  ]

  for (const gh of groupHeaders) {
    if (gh.span > 1) ws.mergeCells(1, gh.col, 1, gh.col + gh.span - 1)
    cell(ws, 1, gh.col, gh.label, { fill: gh.fill, color: WHITE, bold: true, size: 9, align: 'center' })
  }
  ws.getRow(1).height = 16

  // ── Row 2: field headers ────────────────────────────────
  const fieldHeaders = [
    'Suite', 'Matched By',
    'Argus', 'Client', '✓/✗',
    'Argus SF', 'Client SF', '✓/✗',
    'Argus Start', 'Client Start', '✓/✗',
    'Argus End', 'Client End', '✓/✗',
    'Argus Monthly', 'Client Monthly', '✓/✗', 'Argus $/SF', 'Client $/SF',
    'Argus Steps', 'Client Steps', '✓/✗',
    'Status', 'Evidence'
  ]

  const fieldHeaderFills = [
    NAVY, NAVY,
    ARGUS_HDR, CLIENT_HDR, CHECK_HDR,
    ARGUS_HDR, CLIENT_HDR, CHECK_HDR,
    ARGUS_HDR, CLIENT_HDR, CHECK_HDR,
    ARGUS_HDR, CLIENT_HDR, CHECK_HDR,
    ARGUS_HDR, CLIENT_HDR, CHECK_HDR, ARGUS_HDR, CLIENT_HDR,
    ARGUS_HDR, CLIENT_HDR, CHECK_HDR,
    NAVY, NAVY
  ]

  fieldHeaders.forEach((label, i) => {
    cell(ws, 2, i + 1, label, { fill: fieldHeaderFills[i], color: WHITE, bold: true, size: 9, align: 'center' })
  })
  ws.getRow(2).height = 18

  // ── Data rows ───────────────────────────────────────────
  const groups = data.tenantGroups || []
  let r = 3

  for (const g of groups) {
    const a = g.argus  || {}
    const c = g.client || {}
    const diffs = g.differences || []

    // Row background
    let rowFill
    if (g.argusOnly || g.clientOnly) rowFill = LIGHT_ORANGE
    else if (!g.allMatch)            rowFill = LIGHT_RED
    else                             rowFill = LIGHT_GREEN

    // Field match helpers
    const hasField = (key) => diffs.some(d => d.field === key || d.field.startsWith(key))
    const match    = (key) => !hasField(key)
    const tickVal  = (ok)  => ok ? '✓' : '✗'
    const tickFill = (ok)  => ok ? LIGHT_GREEN : LIGHT_RED
    const tickClr  = (ok)  => ok ? MATCH_GREEN  : MISS_RED

    // Rent steps — format as readable text
    const fmtSteps = (steps) => {
      if (!steps || !steps.length) return '—'
      return steps.map(s =>
        `${s.effectiveDate || '?'}: ${fmtMoney(s.monthlyRent)}${s.monthlyPerSF ? ` (${fmtPSF(s.monthlyPerSF)})` : ''}`
      ).join('\n')
    }

    const stepsOk = !diffs.some(d => d.field === 'rent_step_amount' || d.field === 'rent_step_date')

    // ── Build evidence string ───────────────────────────────
    // Evidence = clear human sentence for each discrepancy
    const evidenceParts = []
    if (g.argusOnly) {
      evidenceParts.push(`Tenant "${a.tenantName || '?'}" (Suite ${g.suite || '?'}) found in Argus but NOT in client rent roll.`)
    } else if (g.clientOnly) {
      evidenceParts.push(`Tenant "${c.tenantName || '?'}" (Suite ${g.suite || '?'}) found in client rent roll but NOT in Argus.`)
    } else {
      for (const d of diffs) {
        evidenceParts.push(`${d.label}: Argus = "${d.argusValue}" | Client = "${d.clientValue}"`)
      }
    }
    const evidence = evidenceParts.join('\n') || ''

    const status = g.argusOnly ? 'ARGUS ONLY'
                 : g.clientOnly ? 'CLIENT ONLY'
                 : g.allMatch  ? 'MATCH'
                 : 'DIFFERENCES'

    // Write cells
    const vals = [
      // 1-2: identifier
      { v: fmt(g.suite),             fill: rowFill },
      { v: fmt(g.matchedBy),         fill: rowFill },
      // 3-5: tenant name
      { v: fmt(a.tenantName),        fill: rowFill },
      { v: fmt(c.tenantName),        fill: rowFill },
      { v: tickVal(match('tenant_name')), fill: tickFill(match('tenant_name')), color: tickClr(match('tenant_name')), align: 'center', bold: true },
      // 6-8: SF
      { v: fmtSF(a.sqft),            fill: rowFill, align: 'right' },
      { v: fmtSF(c.sqft),            fill: rowFill, align: 'right' },
      { v: tickVal(match('sqft')),   fill: tickFill(match('sqft')),  color: tickClr(match('sqft')),  align: 'center', bold: true },
      // 9-11: start
      { v: fmt(a.leaseStart),        fill: rowFill, align: 'center' },
      { v: fmt(c.leaseStart),        fill: rowFill, align: 'center' },
      { v: tickVal(match('lease_start')), fill: tickFill(match('lease_start')), color: tickClr(match('lease_start')), align: 'center', bold: true },
      // 12-14: end
      { v: fmt(a.leaseEnd),          fill: rowFill, align: 'center' },
      { v: fmt(c.leaseEnd),          fill: rowFill, align: 'center' },
      { v: tickVal(match('lease_end')),   fill: tickFill(match('lease_end')),   color: tickClr(match('lease_end')),   align: 'center', bold: true },
      // 15-19: rent
      { v: fmtMoney(a.monthlyRent),  fill: rowFill, align: 'right' },
      { v: fmtMoney(c.monthlyRent),  fill: rowFill, align: 'right' },
      { v: tickVal(match('monthly_rent')), fill: tickFill(match('monthly_rent')), color: tickClr(match('monthly_rent')), align: 'center', bold: true },
      { v: fmtPSF(a.monthlyPerSF),   fill: rowFill, align: 'right' },
      { v: fmtPSF(c.monthlyPerSF),   fill: rowFill, align: 'right' },
      // 20-22: steps
      { v: fmtSteps(a.rentSteps),    fill: rowFill, wrap: true },
      { v: fmtSteps(c.rentSteps),    fill: rowFill, wrap: true },
      { v: tickVal(stepsOk),         fill: tickFill(stepsOk), color: tickClr(stepsOk), align: 'center', bold: true },
      // 23: status
      { v: status,                   fill: rowFill, bold: true, align: 'center',
        color: g.allMatch ? MATCH_GREEN : g.argusOnly || g.clientOnly ? 'FFC2410C' : MISS_RED },
      // 24: evidence (far right)
      { v: evidence,                 fill: rowFill, wrap: true },
    ]

    vals.forEach((cfg, i) => {
      cell(ws, r, i + 1, cfg.v, {
        fill:  cfg.fill,
        color: cfg.color,
        bold:  !!cfg.bold,
        align: cfg.align || 'left',
        wrap:  !!cfg.wrap,
      })
    })

    // Row height: expand for steps / evidence
    const maxLines = Math.max(
      (fmtSteps(a.rentSteps).match(/\n/g) || []).length + 1,
      (fmtSteps(c.rentSteps).match(/\n/g) || []).length + 1,
      evidenceParts.length,
      1
    )
    ws.getRow(r).height = Math.min(120, Math.max(18, maxLines * 15))
    r++
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

// ═══════════════════════════════════════════════════════════
// SHEET 2: Summary
// ═══════════════════════════════════════════════════════════
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary', { tabColor: { argb: '10B981' } })
  ws.columns = [{ width: 38 }, { width: 20 }]

  const s = data.summary || {}
  let r = 1

  ws.mergeCells(r, 1, r, 2)
  cell(ws, r, 1, 'RENT ROLL CHEF — RECONCILIATION REPORT', { fill: NAVY, color: WHITE, bold: true, size: 13, align: 'center' })
  ws.getRow(r).height = 26; r++

  ws.mergeCells(r, 1, r, 2)
  cell(ws, r, 1, `Property: ${data.property || 'Unknown'}`, { fill: GRAY_BG, bold: true, size: 11, align: 'center' })
  ws.getRow(r).height = 20; r++

  ws.mergeCells(r, 1, r, 2)
  cell(ws, r, 1, `Generated: ${new Date().toLocaleString()}`, { fill: GRAY_BG, size: 9, align: 'center', color: 'FF6B7280' })
  r++; r++

  ws.mergeCells(r, 1, r, 2)
  cell(ws, r, 1, 'RECONCILIATION STATISTICS', { fill: NAVY, color: WHITE, bold: true, align: 'center' })
  r++

  const stat = (label, val, highlight) => {
    cell(ws, r, 1, label, { fill: GRAY_BG, border: true })
    cell(ws, r, 2, val,   { fill: highlight ? LIGHT_RED : GRAY_BG, color: highlight ? MISS_RED : 'FF111827', bold: highlight, align: 'center' })
    r++
  }

  stat('Total Argus Tenants',          data.argusTenantsTotal  ?? 0)
  stat('Total Client Tenants',         data.clientTenantsTotal ?? 0)
  stat('Matched',                      s.matched       ?? 0)
  stat('Clean Match (all fields ✓)',    s.cleanMatch    ?? 0)
  stat('With Differences',             s.withDifferences ?? 0, (s.withDifferences ?? 0) > 0)
  stat('In Argus Only (not in client)',s.argusOnly     ?? 0, (s.argusOnly  ?? 0) > 0)
  stat('In Client Only (not in Argus)',s.clientOnly    ?? 0, (s.clientOnly ?? 0) > 0)
}

// ═══════════════════════════════════════════════════════════
// SHEET 3: Differences Only  (filtered flat list)
// ═══════════════════════════════════════════════════════════
function buildDifferencesSheet(wb, data) {
  const ws = wb.addWorksheet('Differences Only', {
    tabColor: { argb: 'EF4444' },
    views: [{ state: 'frozen', ySplit: 1 }]
  })

  const COLS = [
    { header: 'Suite',        width: 10 },
    { header: 'Tenant',       width: 30 },
    { header: 'Field',        width: 22 },
    { header: 'Argus Value',  width: 30 },
    { header: 'Client Value', width: 30 },
    { header: 'Severity',     width: 10 },
    { header: 'Evidence',     width: 55 },
  ]

  ws.columns = COLS.map(c => ({ width: c.width }))

  // Header row
  COLS.forEach((c, i) => {
    cell(ws, 1, i + 1, c.header, { fill: NAVY, color: WHITE, bold: true, align: 'center', size: 10 })
  })
  ws.getRow(1).height = 18

  const sevFill  = sev => sev === 'HIGH' ? LIGHT_RED : sev === 'MEDIUM' ? LIGHT_ORANGE : 'FFFEF9C3'
  const sevColor = sev => sev === 'HIGH' ? MISS_RED  : sev === 'MEDIUM' ? 'FFC2410C'   : 'FF92400E'

  const groups = data.tenantGroups || []
  let r = 2

  for (const g of groups) {
    const tenantName = g.argus?.tenantName || g.client?.tenantName || '—'

    if (g.argusOnly || g.clientOnly) {
      const fill  = LIGHT_ORANGE
      const label = g.argusOnly ? 'Missing from Client RR' : 'Missing from Argus RR'
      const ev    = g.argusOnly
        ? `Tenant "${tenantName}" (Suite ${g.suite || '?'}) is in Argus but has no match in the client rent roll.`
        : `Tenant "${tenantName}" (Suite ${g.suite || '?'}) is in the client rent roll but has no match in Argus.`
      ;[fmt(g.suite), fmt(tenantName), label, g.argusOnly ? fmt(tenantName) : '—', g.clientOnly ? fmt(tenantName) : '—', 'HIGH', ev]
        .forEach((v, i) => cell(ws, r, i + 1, v, { fill, color: sevColor('HIGH'), bold: i === 5, wrap: i === 6 }))
      ws.getRow(r).height = 16; r++
      continue
    }

    for (const d of g.differences || []) {
      const sev  = d.severity || 'LOW'
      const fill = sevFill(sev)
      const clr  = sevColor(sev)
      const ev   = `Suite ${g.suite || '?'} — ${tenantName}: ${d.label} — Argus has "${d.argusValue}", Client has "${d.clientValue}"`
      ;[fmt(g.suite), fmt(tenantName), fmt(d.label || d.field), fmt(d.argusValue), fmt(d.clientValue), sev, ev]
        .forEach((v, i) => cell(ws, r, i + 1, v, { fill, color: clr, bold: i === 5, wrap: i === 3 || i === 4 || i === 6 }))
      ws.getRow(r).height = 16; r++
    }
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}
