import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'

// ── Color palette ──────────────────────────────────────────────
const P = {
  headerBg:       'FF0F172A',  // dark navy
  headerFont:     'FFFCD34D',  // gold
  clientBg:       'FF1E2A4A',  // dark blue
  clientFont:     'FF93C5FD',  // blue-300
  argusBg:        'FF2A1A4A',  // dark purple
  argusFont:      'FFCDB4FB',  // purple-300
  matchBg:        'FF064E3B',  // dark green
  matchFont:      'FF6EE7B7',  // green-300
  discrepBg:      'FF451A03',  // dark amber
  discrepFont:    'FFFBBF24',  // amber-400
  missingClientBg:'FF3B0764',  // dark purple
  missingClientFont:'FFE879F9',// fuchsia-400
  missingArgusBg: 'FF431407',  // dark red
  missingArgusFont:'FFFCA5A5', // red-300
  evidenceBg:     'FF1C1917',  // dark charcoal
  evidenceFont:   'FF78716C',  // stone-500
  separatorBg:    'FF000000',  // black
  summaryTitleBg: 'FF0F172A',  // dark navy
  summarySubBg:   'FF1E293B',  // slate-800
  okBg:           'FF064E3B',
  okFont:         'FF6EE7B7',
  highBg:         'FF450A0A',
  highFont:       'FFFCA5A5',
  medBg:          'FF431407',
  medFont:        'FFFBBF24',
  lowBg:          'FF1C1917',
  lowFont:        'FF94A3B8',
}

const FONT_NAME = 'Courier New'

function cell(ws, r, c) {
  return ws.getRow(r).getCell(c)
}

function applyCell(ws, r, c, value, bgArgb, fontArgb, opts = {}) {
  const cl = ws.getRow(r).getCell(c)
  cl.value = value
  cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } }
  cl.font  = {
    name: FONT_NAME,
    size: opts.size || 9,
    bold: opts.bold || false,
    italic: opts.italic || false,
    color: { argb: fontArgb }
  }
  cl.alignment = {
    vertical: 'top',
    horizontal: opts.align || 'left',
    wrapText: opts.wrap !== false
  }
  if (opts.border) {
    cl.border = { bottom: { style: 'thin', color: { argb: 'FF374151' } } }
  }
  return cl
}

/**
 * Generate RR reconciliation Excel report.
 * @param {object} analysisData - from rr-claude.analyzeRentRolls()
 * @param {string} outputPath   - absolute file path for .xlsx
 */
export async function generateRRReport(analysisData, outputPath) {
  // Ensure output dir exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const wb = new ExcelJS.Workbook()
  wb.creator  = 'Todd Jr. — Rent Roll Chef'
  wb.created  = new Date()

  buildSummarySheet(wb, analysisData)
  buildComparisonSheet(wb, analysisData)

  await wb.xlsx.writeFile(outputPath)
  return outputPath
}

// ─────────────────────────────────────────────────────────────────
// SUMMARY SHEET
// ─────────────────────────────────────────────────────────────────
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary', {
    tabColor: { argb: 'FF10B981' }
  })

  ws.columns = [
    { width: 38 },
    { width: 18 }
  ]

  const s = data.summary || {}

  const rows = [
    { label: 'TODD JR. — RENT ROLL CHEF', value: '', isTitle: true },
    { label: `Generated: ${new Date().toLocaleString()}`, value: '', isMeta: true },
    { label: `Property: ${data.property || 'Unknown'}`, value: '', isMeta: true },
    { label: `Analysis Date: ${data.analysisDate || new Date().toISOString().split('T')[0]}`, value: '', isMeta: true },
    { label: '', value: '' },
    { label: 'RECONCILIATION OVERVIEW', value: '', isSection: true },
    { label: 'Client Accounting Tenants', value: s.clientTenants ?? 0 },
    { label: 'Argus Enterprise Tenants', value: s.argusTenants ?? 0 },
    { label: 'Matched Groups', value: s.matched ?? 0 },
    { label: 'Groups with Discrepancies', value: s.discrepancies ?? 0 },
    { label: 'Missing from Client', value: s.missingFromClient ?? 0 },
    { label: 'Missing from Argus', value: s.missingFromArgus ?? 0 },
    { label: '', value: '' },
    { label: 'SEVERITY BREAKDOWN', value: '', isSection: true },
    { label: 'High Severity Issues', value: s.highSeverity ?? 0, isHigh: true },
    { label: 'Medium Severity Issues', value: s.mediumSeverity ?? 0, isMed: true },
    { label: '', value: '' },
    { label: 'FORMAT NOTES', value: '', isSection: true },
    { label: 'Client Format', value: data.clientFormat || '—', isMeta: true, fullRow: true },
    { label: 'Argus Format', value: data.argusFormat || '—', isMeta: true, fullRow: true },
  ]

  for (const rowDef of rows) {
    const row = ws.addRow([rowDef.label, rowDef.fullRow ? '' : rowDef.value])

    if (rowDef.isTitle) {
      row.height = 28
      row.getCell(1).font = { name: FONT_NAME, bold: true, size: 14, color: { argb: 'FFFCD34D' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.headerBg } }
    } else if (rowDef.isSection) {
      row.height = 20
      row.getCell(1).font  = { name: FONT_NAME, bold: true, size: 10, color: { argb: 'FF10B981' } }
      row.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A1E' } }
      row.getCell(2).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A1E' } }
    } else if (rowDef.isMeta) {
      row.getCell(1).font  = { name: FONT_NAME, size: 9, italic: true, color: { argb: 'FF94A3B8' } }
      row.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }
      row.getCell(2).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }
      if (rowDef.fullRow) {
        row.getCell(2).value = rowDef.value
        row.getCell(2).font  = { name: FONT_NAME, size: 9, italic: true, color: { argb: 'FFF1F5F9' } }
        row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
        row.height = Math.max(16, Math.min(80, Math.ceil((rowDef.value?.length || 0) / 40) * 14))
      }
    } else if (rowDef.label) {
      row.getCell(1).font  = { name: FONT_NAME, size: 9, color: { argb: 'FFF1F5F9' } }
      row.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
      const vCell = row.getCell(2)
      vCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowDef.isHigh ? 'FF450A0A' : rowDef.isMed ? 'FF431407' : 'FF1E293B' } }
      vCell.font  = { name: FONT_NAME, size: 10, bold: true, color: { argb: rowDef.isHigh ? 'FFFCA5A5' : rowDef.isMed ? 'FFFBBF24' : 'FF10B981' } }
      vCell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

// ─────────────────────────────────────────────────────────────────
// COMPARISON SHEET
// ─────────────────────────────────────────────────────────────────
function buildComparisonSheet(wb, data) {
  const ws = wb.addWorksheet('Rent Roll Comparison', {
    tabColor: { argb: 'FF1D4ED8' },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  })

  // Columns: ROW TYPE | SUITE(S) | TENANT NAME | SQ FOOTAGE | ANNUAL RENT | MONTHLY RENT | RENT/SF | LEASE START | LEASE EXP | CAM/OTHER | STATUS/ASSESSMENT | EVIDENCE
  ws.columns = [
    { header: 'ROW TYPE',          key: 'rowType',     width: 14 },
    { header: 'SUITE(S)',          key: 'suite',       width: 10 },
    { header: 'TENANT NAME',       key: 'tenantName',  width: 28 },
    { header: 'SQ FOOTAGE',        key: 'sqft',        width: 12 },
    { header: 'ANNUAL RENT',       key: 'annualRent',  width: 14 },
    { header: 'MONTHLY RENT',      key: 'monthlyRent', width: 14 },
    { header: 'RENT/SF',           key: 'rentPsf',     width: 10 },
    { header: 'LEASE START',       key: 'leaseStart',  width: 13 },
    { header: 'LEASE EXP',         key: 'leaseExp',    width: 13 },
    { header: 'CAM/OTHER',         key: 'cam',         width: 13 },
    { header: 'STATUS/ASSESSMENT', key: 'assessment',  width: 36 },
    { header: 'EVIDENCE',          key: 'evidence',    width: 50 },
  ]

  // Header row styling
  const headerRow = ws.getRow(1)
  headerRow.height = 22
  headerRow.eachCell((cl, colNum) => {
    cl.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.headerBg } }
    cl.font      = { name: FONT_NAME, bold: true, size: 9, color: { argb: P.headerFont } }
    cl.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cl.border    = { bottom: { style: 'medium', color: { argb: 'FF374151' } } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const groups = data.tenantGroups || []
  let currentRow = 2

  for (const group of groups) {
    const status   = group.overallStatus || 'MATCH'
    const severity = group.severity || 'LOW'
    const client   = group.clientRow || {}
    const argus    = group.argusRow  || {}

    // ── Row 1: CLIENT RR ─────────────────────────────────────
    const r1 = ws.getRow(currentRow)
    r1.height = 16
    const clientCells = [
      '🔵 CLIENT RR',
      client.suite         || group.suites || '',
      client.tenantName    || '',
      client.squareFootage || '',
      client.annualRent    || '',
      client.monthlyRent   || '',
      client.rentPsf       || '',
      client.leaseStart    || '',
      client.leaseExpiration || '',
      client.cam           || '',
      '',
      '',
    ]
    clientCells.forEach((v, i) => {
      const cl = r1.getCell(i + 1)
      cl.value = v
      cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.clientBg } }
      cl.font  = { name: FONT_NAME, size: 9, color: { argb: P.clientFont } }
      cl.alignment = { vertical: 'top', wrapText: false }
    })
    currentRow++

    // ── Row 2: ARGUS RR ──────────────────────────────────────
    const r2 = ws.getRow(currentRow)
    r2.height = 16
    const argusCells = [
      '🟣 ARGUS RR',
      argus.suite          || group.suites || '',
      argus.tenantName     || '',
      argus.squareFootage  || '',
      argus.annualRent     || '',
      argus.monthlyRent    || '',
      argus.rentPsf        || '',
      argus.leaseStart     || '',
      argus.leaseExpiration|| '',
      argus.cam            || '',
      '',
      '',
    ]
    argusCells.forEach((v, i) => {
      const cl = r2.getCell(i + 1)
      cl.value = v
      cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.argusBg } }
      cl.font  = { name: FONT_NAME, size: 9, color: { argb: P.argusFont } }
      cl.alignment = { vertical: 'top', wrapText: false }
    })
    currentRow++

    // ── Row 3: TODD CHEF assessment ──────────────────────────
    const r3 = ws.getRow(currentRow)
    r3.height = 32

    let chefBg, chefFont, chefLabel
    if (status === 'MATCH') {
      chefBg = P.matchBg; chefFont = P.matchFont; chefLabel = '✅ MATCH'
    } else if (status === 'DISCREPANCY') {
      chefBg = P.discrepBg; chefFont = P.discrepFont; chefLabel = '⚠️ DISCREPANCY'
    } else if (status === 'MISSING_CLIENT') {
      chefBg = P.missingClientBg; chefFont = P.missingClientFont; chefLabel = '🔴 MISSING CLIENT'
    } else if (status === 'MISSING_ARGUS') {
      chefBg = P.missingArgusBg; chefFont = P.missingArgusFont; chefLabel = '🟠 MISSING ARGUS'
    } else {
      chefBg = P.discrepBg; chefFont = P.discrepFont; chefLabel = `⚠️ ${status}`
    }

    const sevLabel = severity === 'HIGH' ? ' [HIGH]' : severity === 'MEDIUM' ? ' [MED]' : ' [LOW]'

    const chefCells = [
      '👨‍🍳 CHEF TODD',
      group.suites || '',
      `${chefLabel}${sevLabel}`,
      '', '', '', '', '', '', '',
      group.toddAssessment || '',
      '',
    ]
    chefCells.forEach((v, i) => {
      const cl = r3.getCell(i + 1)
      cl.value = v
      cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: chefBg } }
      cl.font  = { name: FONT_NAME, size: 9, bold: true, color: { argb: chefFont } }
      cl.alignment = { vertical: 'top', wrapText: i === 10 }
    })
    currentRow++

    // ── Row 4: EVIDENCE ──────────────────────────────────────
    const r4 = ws.getRow(currentRow)
    const evidText = group.evidence || ''
    const evidLines = Math.max(2, Math.min(8, Math.ceil(evidText.length / 80)))
    r4.height = evidLines * 12 + 8

    const evidCells = ['📍 EVIDENCE', group.suites || '', '', '', '', '', '', '', '', '', '', evidText]
    evidCells.forEach((v, i) => {
      const cl = r4.getCell(i + 1)
      cl.value = v
      cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.evidenceBg } }
      cl.font  = { name: FONT_NAME, size: 8, italic: true, color: { argb: P.evidenceFont } }
      cl.alignment = { vertical: 'top', wrapText: i === 11 }
    })
    currentRow++

    // ── Separator row ────────────────────────────────────────
    const rSep = ws.getRow(currentRow)
    rSep.height = 4
    for (let c = 1; c <= 12; c++) {
      const cl = rSep.getCell(c)
      cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.separatorBg } }
      cl.value = ''
    }
    currentRow++
  }

  // Auto-filter on header
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } }
}
