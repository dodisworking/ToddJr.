import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'

const P = {
  headerBg:     'FF0F172A',
  headerFont:   'FFFCD34D',
  highBg:       'FF450A0A', highFont:   'FFFCA5A5',
  medBg:        'FF431407', medFont:    'FFFBBF24',
  lowBg:        'FF1C1917', lowFont:    'FF94A3B8',
  matchBg:      'FF064E3B', matchFont:  'FF6EE7B7',
  missingBg:    'FF3B0764', missingFont:'FFE879F9',
  clientBg:     'FF0D1B35', clientFont: 'FF93C5FD',
  argusBg:      'FF1A0D35', argusFont:  'FFCDB4FB',
  rowAlt:       'FF111827', rowNorm:    'FF0F172A',
  noteFont:     'FF6B7280',
}
const FONT = 'Courier New'

function ac(ws, r, c, val, bg, fg, opts = {}) {
  const cl = ws.getRow(r).getCell(c)
  cl.value = val
  cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
  cl.font  = { name: FONT, size: opts.sz||9, bold: !!opts.bold, italic: !!opts.italic, color: { argb: fg } }
  cl.alignment = { vertical: 'top', horizontal: opts.align||'left', wrapText: opts.wrap !== false }
  return cl
}

export async function generateRRReport(analysisData, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Todd Jr. — Rent Roll Chef'
  wb.created = new Date()
  buildSummarySheet(wb, analysisData)
  buildDiscrepancySheet(wb, analysisData)
  if ((analysisData.missing || []).length > 0) buildMissingSheet(wb, analysisData)
  buildCleanSheet(wb, analysisData)
  await wb.xlsx.writeFile(outputPath)
  return outputPath
}

// ── SHEET 1: SUMMARY ───────────────────────────────────────────
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary', { tabColor: { argb: 'FF10B981' } })
  ws.columns = [{ width: 36 }, { width: 16 }]

  const s = data.summary || {}

  const rows = [
    { l: 'TODD JR. — RENT ROLL CHEF',                  isTitle: true },
    { l: `Generated: ${new Date().toLocaleString()}`,   isMeta: true },
    { l: `Property: ${data.property || 'Unknown'}`,    isMeta: true },
    { l: `Analysis Date: ${data.analysisDate || ''}`,  isMeta: true },
    { l: '' },
    { l: 'RECONCILIATION OVERVIEW', isSection: true },
    { l: 'Client Accounting Tenants',  v: s.clientTenants    ?? 0 },
    { l: 'Argus Enterprise Tenants',   v: s.argusTenants     ?? 0 },
    { l: 'Clean Matched Tenants',      v: s.matched          ?? 0, isGood: true },
    { l: 'Tenants with Discrepancies', v: s.discrepancyCount ?? 0, isBad: true },
    { l: 'Missing from Client',        v: s.missingFromClient ?? 0, isBad: true },
    { l: 'Missing from Argus',         v: s.missingFromArgus  ?? 0, isBad: true },
    { l: '' },
    { l: 'SEVERITY BREAKDOWN', isSection: true },
    { l: 'High Severity Issues',   v: s.highSeverity   ?? 0, isHigh: true },
    { l: 'Medium Severity Issues', v: s.mediumSeverity ?? 0, isMed: true },
    { l: '' },
    { l: 'FORMAT NOTES', isSection: true },
    { l: 'Client Format',       v: data.clientFormat     || '—', isMeta: true, fullRow: true },
    { l: 'Rent Normalization',  v: data.rentNormalization || '—', isMeta: true, fullRow: true },
  ]

  for (const def of rows) {
    const row = ws.addRow([def.l, def.fullRow ? '' : (def.v ?? '')])
    if (def.isTitle) {
      row.height = 28
      row.getCell(1).font = { name: FONT, bold: true, size: 14, color: { argb: 'FFFCD34D' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.headerBg } }
    } else if (def.isSection) {
      row.height = 20
      row.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: 'FF10B981' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A1E' } }
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A1E' } }
    } else if (def.isMeta) {
      row.getCell(1).font = { name: FONT, size: 9, italic: true, color: { argb: 'FF94A3B8' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } }
      if (def.fullRow) {
        row.getCell(2).value = def.v
        row.getCell(2).font = { name: FONT, size: 9, italic: true, color: { argb: 'FFF1F5F9' } }
        row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
      }
    } else if (def.l) {
      row.getCell(1).font = { name: FONT, size: 9, color: { argb: 'FFF1F5F9' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
      const vc = row.getCell(2)
      const bg = def.isHigh ? P.highBg : def.isMed ? P.medBg : def.isBad ? P.highBg : def.isGood ? P.matchBg : 'FF1E293B'
      const fg = def.isHigh ? P.highFont : def.isMed ? P.medFont : def.isBad ? P.highFont : def.isGood ? P.matchFont : 'FF10B981'
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      vc.font = { name: FONT, size: 10, bold: true, color: { argb: fg } }
      vc.alignment = { horizontal: 'center', vertical: 'middle' }
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

// ── SHEET 2: DISCREPANCIES (flat table, one row per mismatched field) ──
function buildDiscrepancySheet(wb, data) {
  const ws = wb.addWorksheet('❌ Discrepancies', {
    tabColor: { argb: 'FFEF4444' },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  })

  ws.columns = [
    { header: 'SEV',           key: 'sev',         width: 8  },
    { header: 'SUITE',         key: 'suite',        width: 10 },
    { header: 'CLIENT TENANT', key: 'clientName',   width: 26 },
    { header: 'ARGUS TENANT',  key: 'argusName',    width: 26 },
    { header: 'FIELD',         key: 'field',        width: 18 },
    { header: 'CLIENT VALUE',  key: 'clientVal',    width: 28 },
    { header: 'ARGUS VALUE',   key: 'argusVal',     width: 28 },
    { header: 'NOTES',         key: 'notes',        width: 36 },
  ]

  // Header row
  const hdr = ws.getRow(1)
  hdr.height = 22
  hdr.eachCell(cl => {
    cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.headerBg } }
    cl.font = { name: FONT, bold: true, size: 9, color: { argb: P.headerFont } }
    cl.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cl.border = { bottom: { style: 'medium', color: { argb: 'FF374151' } } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const disc = data.discrepancies || []
  if (disc.length === 0) {
    const r = ws.addRow(['', '', '✅ NO DISCREPANCIES FOUND — ALL TENANTS MATCH', '', '', '', '', ''])
    r.getCell(3).font = { name: FONT, bold: true, size: 11, color: { argb: P.matchFont } }
    r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.matchBg } }
    return
  }

  disc.forEach((d, i) => {
    const sev = (d.severity || 'MEDIUM').toUpperCase()
    const bg  = sev === 'HIGH' ? P.highBg : sev === 'LOW' ? P.lowBg : P.medBg
    const fg  = sev === 'HIGH' ? P.highFont : sev === 'LOW' ? P.lowFont : P.medFont
    const rowBg = i % 2 === 0 ? P.rowNorm : P.rowAlt
    const r = ws.addRow([])
    r.height = 16

    ac(ws, r.number, 1, sev,               bg,      fg,           { align: 'center', bold: true, wrap: false })
    ac(ws, r.number, 2, d.suite||'—',      rowBg,   'FF94A3B8',   { align: 'center', wrap: false })
    ac(ws, r.number, 3, d.clientTenant||'—', P.clientBg, P.clientFont, { wrap: false })
    ac(ws, r.number, 4, d.argusTenant||'—',  P.argusBg,  P.argusFont,  { wrap: false })
    ac(ws, r.number, 5, d.field||'—',      rowBg,   'FFF1F5F9',   { bold: true, wrap: false })
    ac(ws, r.number, 6, d.clientValue||'—',P.clientBg, 'FFFBBF24', { wrap: false })
    ac(ws, r.number, 7, d.argusValue||'—', P.argusBg,  'FFFBBF24', { wrap: false })
    ac(ws, r.number, 8, d.note||'',        rowBg,   P.noteFont,   { italic: true, wrap: true })
  })

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } }
}

// ── SHEET 3: MISSING TENANTS ────────────────────────────────────
function buildMissingSheet(wb, data) {
  const ws = wb.addWorksheet('🔴 Missing Tenants', { tabColor: { argb: 'FF7C3AED' } })
  ws.columns = [
    { header: 'SEV',    key: 'sev',   width: 8  },
    { header: 'SUITE',  key: 'suite', width: 10 },
    { header: 'SIDE',   key: 'side',  width: 20 },
    { header: 'TENANT', key: 'name',  width: 34 },
    { header: 'SF',     key: 'sf',    width: 12 },
  ]

  const hdr = ws.getRow(1)
  hdr.height = 22
  hdr.eachCell(cl => {
    cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.headerBg } }
    cl.font = { name: FONT, bold: true, size: 9, color: { argb: P.headerFont } }
    cl.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  ;(data.missing || []).forEach((m, i) => {
    const rowBg = i % 2 === 0 ? P.missingBg : 'FF2D0A52'
    const r = ws.addRow([])
    r.height = 16
    ac(ws, r.number, 1, m.severity||'HIGH',       rowBg, P.missingFont, { align: 'center', bold: true })
    ac(ws, r.number, 2, m.suite||'—',             rowBg, P.missingFont, { align: 'center' })
    ac(ws, r.number, 3, m.side||'—',              rowBg, 'FFFDE68A',    { bold: true })
    ac(ws, r.number, 4, m.name||'—',              rowBg, 'FFF1F5F9')
    ac(ws, r.number, 5, m.sf||'—',               rowBg, P.missingFont, { align: 'right' })
  })
}

// ── SHEET 4: CLEAN / MATCHED TENANTS ───────────────────────────
function buildCleanSheet(wb, data) {
  const ws = wb.addWorksheet('✅ Clean Matches', { tabColor: { argb: 'FF10B981' } })
  ws.columns = [{ header: 'MATCHED SUITES (ALL FIELDS MATCH)', key: 'suites', width: 60 }]

  const hdr = ws.getRow(1)
  hdr.height = 20
  hdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.matchBg } }
  hdr.getCell(1).font = { name: FONT, bold: true, size: 9, color: { argb: P.matchFont } }
  hdr.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' }

  const suites = (data.matchedSuites || '').split(',').map(s => s.trim()).filter(Boolean)
  if (suites.length === 0) {
    ws.addRow(['No fully-matched tenants found.'])
  } else {
    // List in chunks of 10 per row for readability
    for (let i = 0; i < suites.length; i += 10) {
      const chunk = suites.slice(i, i + 10).join('   |   ')
      const r = ws.addRow([chunk])
      r.height = 16
      r.getCell(1).font = { name: FONT, size: 9, color: { argb: P.matchFont } }
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? P.matchBg : 'FF054030' } }
    }
  }
}
