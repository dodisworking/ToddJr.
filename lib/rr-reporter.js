import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'

// ── Color palette ──────────────────────────────────────────────
const P = {
  headerBg:        'FF0F172A',
  headerFont:      'FFFCD34D',
  matchBg:         'FF064E3B',
  matchFont:       'FF6EE7B7',
  mismatchBg:      'FF451A03',
  mismatchFont:    'FFFBBF24',
  missingBg:       'FF3B0764',
  missingFont:     'FFE879F9',
  nameVarBg:       'FF1E3A5F',
  nameVarFont:     'FF93C5FD',
  groupHeaderBg:   'FF1E293B',
  groupHeaderFont: 'FFF1F5F9',
  fieldBg:         'FF0F1A2E',
  fieldFont:       'FF94A3B8',
  clientValBg:     'FF0D1B35',
  clientValFont:   'FF93C5FD',
  argusValBg:      'FF1A0D35',
  argusValFont:    'FFCDB4FB',
  noteBg:          'FF111827',
  noteFont:        'FF6B7280',
  summaryTitleBg:  'FF0F172A',
  summarySubBg:    'FF1E293B',
}

const FONT = 'Courier New'

function applyCell(ws, r, c, value, bgArgb, fontArgb, opts = {}) {
  const cl = ws.getRow(r).getCell(c)
  cl.value = value
  cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } }
  cl.font  = { name: FONT, size: opts.size || 9, bold: opts.bold || false, italic: opts.italic || false, color: { argb: fontArgb } }
  cl.alignment = { vertical: 'top', horizontal: opts.align || 'left', wrapText: opts.wrap !== false }
  return cl
}

export async function generateRRReport(analysisData, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Todd Jr. — Rent Roll Chef'
  wb.created = new Date()

  buildSummarySheet(wb, analysisData)
  buildComparisonSheet(wb, analysisData)

  await wb.xlsx.writeFile(outputPath)
  return outputPath
}

// ─────────────────────────────────────────────────────────────────
// SUMMARY SHEET
// ─────────────────────────────────────────────────────────────────
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary', { tabColor: { argb: 'FF10B981' } })
  ws.columns = [{ width: 38 }, { width: 20 }]

  const s = data.summary || {}

  const rows = [
    { label: 'TODD JR. — RENT ROLL CHEF',          value: '',                  isTitle: true },
    { label: `Generated: ${new Date().toLocaleString()}`, value: '',            isMeta: true },
    { label: `Property: ${data.property || 'Unknown'}`, value: '',             isMeta: true },
    { label: `Analysis Date: ${data.analysisDate || ''}`, value: '',           isMeta: true },
    { label: '', value: '' },
    { label: 'RECONCILIATION OVERVIEW',              value: '',                  isSection: true },
    { label: 'Client Accounting Tenants',            value: s.clientTenants  ?? 0 },
    { label: 'Argus Enterprise Tenants',             value: s.argusTenants   ?? 0 },
    { label: 'Matched Groups',                       value: s.matched        ?? 0 },
    { label: 'Groups with Discrepancies',            value: s.discrepancies  ?? 0, isBad: true },
    { label: 'Missing from Client',                  value: s.missingFromClient ?? 0, isBad: true },
    { label: 'Missing from Argus',                   value: s.missingFromArgus  ?? 0, isBad: true },
    { label: '', value: '' },
    { label: 'SEVERITY BREAKDOWN',                   value: '',                  isSection: true },
    { label: 'High Severity Issues',                 value: s.highSeverity   ?? 0, isHigh: true },
    { label: 'Medium Severity Issues',               value: s.mediumSeverity ?? 0, isMed: true },
    { label: '', value: '' },
    { label: 'FORMAT NOTES',                         value: '',                  isSection: true },
    { label: 'Client Format',    value: data.clientFormat    || '—', isMeta: true, fullRow: true },
    { label: 'Argus Format',     value: data.argusFormat     || '—', isMeta: true, fullRow: true },
    { label: 'Rent Normalization', value: data.rentNormalization || '—', isMeta: true, fullRow: true },
  ]

  for (const def of rows) {
    const row = ws.addRow([def.label, def.fullRow ? '' : def.value])
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
        row.getCell(2).value = def.value
        row.getCell(2).font = { name: FONT, size: 9, italic: true, color: { argb: 'FFF1F5F9' } }
        row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
        row.height = Math.max(16, Math.min(80, Math.ceil((def.value?.length || 0) / 40) * 14))
      }
    } else if (def.label) {
      row.getCell(1).font = { name: FONT, size: 9, color: { argb: 'FFF1F5F9' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
      const vc = row.getCell(2)
      vc.font  = { name: FONT, size: 10, bold: true, color: { argb: def.isHigh ? 'FFFCA5A5' : def.isMed ? 'FFFBBF24' : def.isBad ? 'FFFCA5A5' : 'FF10B981' } }
      vc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: def.isHigh ? 'FF450A0A' : def.isMed ? 'FF431407' : def.isBad ? 'FF450A0A' : 'FF1E293B' } }
      vc.alignment = { horizontal: 'center', vertical: 'middle' }
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

// ─────────────────────────────────────────────────────────────────
// COMPARISON SHEET — side-by-side field-by-field
// Columns: SUITE | CLIENT TENANT | ARGUS TENANT | FIELD | CLIENT VALUE | ARGUS VALUE | STATUS | NOTES
// ─────────────────────────────────────────────────────────────────
function buildComparisonSheet(wb, data) {
  const ws = wb.addWorksheet('Rent Roll Comparison', {
    tabColor: { argb: 'FF1D4ED8' },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  })

  ws.columns = [
    { header: 'SUITE',         key: 'suite',       width: 10 },
    { header: 'CLIENT TENANT', key: 'clientName',  width: 28 },
    { header: 'ARGUS TENANT',  key: 'argusName',   width: 28 },
    { header: 'FIELD',         key: 'field',       width: 18 },
    { header: 'CLIENT VALUE (NORMALIZED)', key: 'clientVal', width: 30 },
    { header: 'ARGUS VALUE',   key: 'argusVal',    width: 30 },
    { header: 'STATUS',        key: 'status',      width: 14 },
    { header: 'NOTES',         key: 'notes',       width: 40 },
  ]

  // Style header row
  const hdr = ws.getRow(1)
  hdr.height = 22
  hdr.eachCell(cl => {
    cl.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: P.headerBg } }
    cl.font      = { name: FONT, bold: true, size: 9, color: { argb: P.headerFont } }
    cl.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cl.border    = { bottom: { style: 'medium', color: { argb: 'FF374151' } } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const groups = data.tenantGroups || []
  let row = 2

  for (const group of groups) {
    const suite      = group.suites || '—'
    const clientName = group.clientTenantName || (group.clientRow?.tenantName) || '—'
    const argusName  = group.argusTenantName  || (group.argusRow?.tenantName)  || '—'
    const status     = group.overallStatus || 'MATCH'
    const severity   = group.severity || 'LOW'

    // ── Group header row ──────────────────────────────────────
    const sevLabel = severity === 'HIGH' ? ' [HIGH]' : severity === 'MEDIUM' ? ' [MED]' : ''
    let ghBg, ghFont, ghIcon
    if (status === 'MATCH')          { ghBg = P.matchBg;   ghFont = P.matchFont;   ghIcon = '✅' }
    else if (status === 'DISCREPANCY'){ ghBg = P.mismatchBg; ghFont = P.mismatchFont; ghIcon = '⚠️' }
    else if (status === 'MISSING_CLIENT'){ ghBg = P.missingBg; ghFont = P.missingFont; ghIcon = '🔴' }
    else if (status === 'MISSING_ARGUS') { ghBg = P.missingBg; ghFont = P.missingFont; ghIcon = '🟠' }
    else                             { ghBg = P.groupHeaderBg; ghFont = P.groupHeaderFont; ghIcon = '—' }

    const gr = ws.getRow(row)
    gr.height = 18
    const groupHeaderText = `${ghIcon} SUITE ${suite} | CLIENT: ${clientName}  vs  ARGUS: ${argusName}${sevLabel} — ${group.toddAssessment || ''}`
    for (let c = 1; c <= 8; c++) {
      const cl = gr.getCell(c)
      cl.value = c === 1 ? groupHeaderText : ''
      cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: ghBg } }
      cl.font  = { name: FONT, bold: true, size: 9, color: { argb: ghFont } }
      cl.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false }
    }
    // Merge the group header across all 8 columns
    try { ws.mergeCells(row, 1, row, 8) } catch {}
    row++

    // ── Field comparison rows ─────────────────────────────────
    const fields = group.fieldComparisons || []

    // If no fieldComparisons (old format fallback), build from clientRow/argusRow
    const comparisons = fields.length > 0 ? fields : buildFieldComparisons(group)

    for (const fc of comparisons) {
      const fcStatus = (fc.status || 'MATCH').toUpperCase()
      let statusBg, statusFont, statusLabel
      if (fcStatus === 'MATCH') {
        statusBg = P.matchBg; statusFont = P.matchFont; statusLabel = '✅ MATCH'
      } else if (fcStatus === 'MISMATCH') {
        statusBg = P.mismatchBg; statusFont = P.mismatchFont; statusLabel = '❌ MISMATCH'
      } else if (fcStatus === 'MISSING_CLIENT') {
        statusBg = P.missingBg; statusFont = P.missingFont; statusLabel = '🔴 MISSING CLIENT'
      } else if (fcStatus === 'MISSING_ARGUS') {
        statusBg = P.missingBg; statusFont = P.missingFont; statusLabel = '🟠 MISSING ARGUS'
      } else if (fcStatus === 'NAME_VARIATION') {
        statusBg = P.nameVarBg; statusFont = P.nameVarFont; statusLabel = '🔵 NAME VARIATION'
      } else {
        statusBg = P.mismatchBg; statusFont = P.mismatchFont; statusLabel = `⚠️ ${fcStatus}`
      }

      const isMatch = fcStatus === 'MATCH'
      const rowH = 15

      // Suite
      applyCell(ws, row, 1, suite, P.fieldBg, P.fieldFont, { align: 'center', wrap: false })
      // Client Tenant
      applyCell(ws, row, 2, clientName, P.clientValBg, P.clientValFont, { wrap: false })
      // Argus Tenant
      applyCell(ws, row, 3, argusName, P.argusValBg, P.argusValFont, { wrap: false })
      // Field name
      applyCell(ws, row, 4, fc.field || '', P.fieldBg, P.fieldFont, { bold: true, wrap: false })
      // Client value
      applyCell(ws, row, 5, fc.clientValue || '—', P.clientValBg, isMatch ? P.clientValFont : P.mismatchFont, { wrap: false })
      // Argus value
      applyCell(ws, row, 6, fc.argusValue || '—', P.argusValBg, isMatch ? P.argusValFont : P.mismatchFont, { wrap: false })
      // Status
      applyCell(ws, row, 7, statusLabel, statusBg, statusFont, { align: 'center', bold: true, wrap: false })
      // Notes
      applyCell(ws, row, 8, fc.note || '', P.noteBg, P.noteFont, { italic: true, wrap: true })

      ws.getRow(row).height = rowH
      row++
    }

    // ── Separator row ─────────────────────────────────────────
    const sep = ws.getRow(row)
    sep.height = 5
    for (let c = 1; c <= 8; c++) {
      sep.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } }
    }
    row++
  }

  // Auto-filter
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } }
}

// Fallback: build fieldComparisons from old clientRow/argusRow format
function buildFieldComparisons(group) {
  const c = group.clientRow || {}
  const a = group.argusRow  || {}
  const disc = group.discrepancyFields || []

  const fields = [
    { field: 'Suite',             clientKey: 'suite',           argusKey: 'suite' },
    { field: 'Square Footage',    clientKey: 'squareFootage',   argusKey: 'squareFootage' },
    { field: 'Annual Rent',       clientKey: 'annualRent',      argusKey: 'annualRent' },
    { field: 'Monthly Rent',      clientKey: 'monthlyRent',     argusKey: 'monthlyRent' },
    { field: 'Rent/SF',           clientKey: 'rentPsf',         argusKey: 'rentPsf' },
    { field: 'Lease Start',       clientKey: 'leaseStart',      argusKey: 'leaseStart' },
    { field: 'Lease Expiration',  clientKey: 'leaseExpiration', argusKey: 'leaseExpiration' },
    { field: 'CAM/NNN',           clientKey: 'cam',             argusKey: 'cam' },
    { field: 'Rent Steps',        clientKey: 'rentSteps',       argusKey: 'rentSteps' },
  ]

  return fields.map(f => {
    const cv = Array.isArray(c[f.clientKey])
      ? c[f.clientKey].map(s => `${s.date}: ${s.amount}`).join('; ')
      : (c[f.clientKey] || '—')
    const av = Array.isArray(a[f.argusKey])
      ? a[f.argusKey].map(s => `${s.date}: ${s.amount}`).join('; ')
      : (a[f.argusKey] || '—')
    const isMismatch = disc.includes(f.clientKey)
    return { field: f.field, clientValue: cv, argusValue: av, status: isMismatch ? 'MISMATCH' : 'MATCH', note: '' }
  }).filter(f => f.clientValue !== '—' || f.argusValue !== '—')
}
