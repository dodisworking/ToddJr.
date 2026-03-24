import ExcelJS from 'exceljs'

// ── Color palette ─────────────────────────────────────────────
const PALETTE = {
  headerBg:    'FF1F3864',   // deep navy
  headerFont:  'FFFFFFFF',   // white
  highBg:      'FFFEE2E2',   // red-50
  highFont:    'FF991B1B',   // red-800
  medBg:       'FFFEF3C7',   // amber-50
  medFont:     'FF92400E',   // amber-800
  lowBg:       'FFFEF9C3',   // yellow-50
  lowFont:     'FF713F12',   // yellow-900
  okBg:        'FFF0FDF4',   // green-50
  okFont:      'FF166534',   // green-800
  altRow:      'FFF8FAFC',   // slate-50
  border:      'FFE2E8F0',   // slate-200
  subHeader:   'FF334155',   // slate-700
}

const CHECK_LABELS = {
  EXECUTION:        'Execution',
  EXHIBIT:          'Missing Exhibit',
  CURRENCY:         'Lease Currency',
  REFERENCED_DOC:   'Missing Document',
  AMENDMENT_GAP:    'Amendment Gap',
  MISSING_PAGE:     'Missing Pages',
  LEGIBILITY:       'Legibility',
  SPECIAL_AGREEMENT:'Special Agreement',
  GUARANTY:         'Guaranty',
  NAME_MISMATCH:    'Name Mismatch',
}

/**
 * Generate the Excel missing documents report.
 *
 * @param {Array} allFindings - [{ tenant, result }]
 * @param {string} outputPath - Absolute path to write the .xlsx file
 */
export async function generateReport(allFindings, outputPath) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Todd Jr.'
  wb.created = new Date()
  wb.properties.date1904 = false

  // ── Sheet 1: Missing Documents Report ─────────────────────
  const ws = wb.addWorksheet('Missing Documents Report', {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9, // A4
    },
    headerFooter: {
      oddHeader: '&C&B&16Todd Jr. — Missing Documents Report',
      oddFooter: '&LGenerated: ' + new Date().toLocaleDateString() + '&RPage &P of &N'
    }
  })

  // ── Column widths ──────────────────────────────────────────
  ws.columns = [
    { key: 'property',    width: 16 },
    { key: 'tenant',      width: 30 },
    { key: 'suite',       width: 12 },
    { key: 'missing',     width: 45 },
    { key: 'comment',     width: 65 },
    { key: 'severity',    width: 12 },
    { key: 'checkType',   width: 20 },
  ]

  // ── Header row ─────────────────────────────────────────────
  const headers = ['Property Name', 'Tenant Name', 'Suite Number', 'Missing Document', 'Comment / Status', 'Severity', 'Check Type']
  const headerRow = ws.addRow(headers)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.headerBg } }
    cell.font   = { bold: true, color: { argb: PALETTE.headerFont }, size: 11, name: 'Calibri' }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF93C5FD' } } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Data rows ─────────────────────────────────────────────
  let dataRowIndex = 0

  for (const { tenant, result } of allFindings) {
    const resolvedName = result?.tenantNameInDocuments || tenant.tenantName

    if (!result || (result.allClear && (!result.findings || result.findings.length === 0))) {
      // All-clear row
      addDataRow(ws, {
        property:   tenant.property,
        tenant:     resolvedName,
        suite:      String(tenant.suite),
        missing:    'None',
        comment:    'All documents present and properly executed.',
        severity:   'OK',
        checkType:  '',
      }, 'OK', dataRowIndex)
      dataRowIndex++

    } else {
      const findings = result.findings || []

      // If no findings but allClear is false (shouldn't happen, but just in case)
      if (findings.length === 0) {
        addDataRow(ws, {
          property:   tenant.property,
          tenant:     resolvedName,
          suite:      String(tenant.suite),
          missing:    'Review required',
          comment:    'Analysis completed but no specific findings were generated. Manual review recommended.',
          severity:   'LOW',
          checkType:  '',
        }, 'LOW', dataRowIndex)
        dataRowIndex++
        continue
      }

      for (const finding of findings) {
        const missingDocText = (!finding.missingDocument || finding.missingDocument === 'N/A')
          ? finding.comment
          : finding.missingDocument

        const commentText = buildCommentText(finding)

        addDataRow(ws, {
          property:   tenant.property,
          tenant:     resolvedName,
          suite:      String(tenant.suite),
          missing:    missingDocText,
          comment:    commentText,
          severity:   finding.severity || 'LOW',
          checkType:  CHECK_LABELS[finding.checkType] || finding.checkType || '',
        }, finding.severity, dataRowIndex)
        dataRowIndex++
      }
    }
  }

  // Auto-filter on header row
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 7 }
  }

  // ── Sheet 2: Summary ───────────────────────────────────────
  const sumWs = wb.addWorksheet('Summary', {
    tabColor: { argb: 'FF1D4ED8' }
  })
  buildSummarySheet(sumWs, allFindings)

  // ── Write file ─────────────────────────────────────────────
  await wb.xlsx.writeFile(outputPath)
  return outputPath
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function addDataRow(ws, data, severity, rowIndex) {
  const row = ws.addRow([
    data.property,
    data.tenant,
    data.suite,
    data.missing,
    data.comment,
    data.severity,
    data.checkType,
  ])

  row.height = Math.max(18, Math.min(120, estimateRowHeight(data.missing, data.comment)))

  const colors = getSeverityColors(severity)
  const isAlt = rowIndex % 2 === 1

  row.eachCell((cell, colNum) => {
    const bgColor = isAlt && severity === 'OK'
      ? PALETTE.altRow
      : colors.bg
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
    cell.font = { color: { argb: colors.font }, size: 10, name: 'Calibri' }
    cell.border = { bottom: { style: 'thin', color: { argb: PALETTE.border } } }
    cell.alignment = { vertical: 'top', wrapText: colNum >= 4 }
  })

  // Severity cell — bold
  const sevCell = row.getCell(6)
  sevCell.font = { ...sevCell.font, bold: true }

  // Suite — force text so numeric suites with leading zeros are preserved
  const suiteCell = row.getCell(3)
  suiteCell.value = data.suite
  suiteCell.numFmt = '@'
}

function buildCommentText(finding) {
  let parts = []
  if (finding.comment && finding.comment.trim()) {
    parts.push(finding.comment.trim())
  }
  if (finding.evidence && finding.evidence.trim() && finding.evidence !== 'N/A') {
    parts.push(`Evidence: ${finding.evidence.trim()}`)
  }
  return parts.join('\n\n')
}

function estimateRowHeight(missing, comment) {
  const longestLine = Math.max(
    ...(comment || '').split('\n').map(l => l.length),
    (missing || '').length
  )
  const wrappedLines = Math.ceil(longestLine / 60) + (comment || '').split('\n').length
  return 18 + wrappedLines * 13
}

function getSeverityColors(severity) {
  switch (severity) {
    case 'HIGH':   return { bg: PALETTE.highBg, font: PALETTE.highFont }
    case 'MEDIUM': return { bg: PALETTE.medBg,  font: PALETTE.medFont }
    case 'LOW':    return { bg: PALETTE.lowBg,  font: PALETTE.lowFont }
    case 'OK':     return { bg: PALETTE.okBg,   font: PALETTE.okFont }
    default:       return { bg: 'FFFFFFFF',      font: 'FF1E293B' }
  }
}

function buildSummarySheet(ws, allFindings) {
  const total     = allFindings.length
  const allClear  = allFindings.filter(t => t.result?.allClear).length
  const withIssues = allFindings.filter(t => (t.result?.findings?.length || 0) > 0).length
  const totalIssues = allFindings.reduce((s, t) => s + (t.result?.findings?.length || 0), 0)
  const high   = allFindings.reduce((s, t) => s + (t.result?.findings?.filter(f => f.severity === 'HIGH').length   || 0), 0)
  const medium = allFindings.reduce((s, t) => s + (t.result?.findings?.filter(f => f.severity === 'MEDIUM').length || 0), 0)
  const low    = allFindings.reduce((s, t) => s + (t.result?.findings?.filter(f => f.severity === 'LOW').length    || 0), 0)

  ws.columns = [
    { key: 'label', width: 35 },
    { key: 'value', width: 14 },
  ]

  const rows = [
    ['TODD JR. — MISSING DOCUMENTS ANALYSIS',       ''],
    [`Generated: ${new Date().toLocaleString()}`,  ''],
    ['',                                            ''],
    ['PORTFOLIO OVERVIEW',                          ''],
    ['Total Tenants Reviewed',                      total],
    ['All Clear (No Issues)',                       allClear],
    ['Tenants With Issues',                         withIssues],
    ['',                                            ''],
    ['FINDINGS BREAKDOWN',                          ''],
    ['Total Findings',                              totalIssues],
    ['High Severity',                               high],
    ['Medium Severity',                             medium],
    ['Low Severity',                                low],
  ]

  for (const [label, value] of rows) {
    const row = ws.addRow({ label, value })

    if (label === 'TODD JR. — MISSING DOCUMENTS ANALYSIS') {
      row.getCell('label').font  = { bold: true, size: 16, color: { argb: 'FF1F3864' }, name: 'Calibri' }
      row.height = 28
    } else if (label === 'PORTFOLIO OVERVIEW' || label === 'FINDINGS BREAKDOWN') {
      row.getCell('label').font  = { bold: true, size: 12, color: { argb: 'FF1D4ED8' }, name: 'Calibri' }
      row.getCell('label').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
      row.height = 20
    } else if (value !== '') {
      row.getCell('value').font  = { bold: true, size: 11, name: 'Calibri' }
      row.getCell('value').alignment = { horizontal: 'center' }
    }
  }
}

function clipCellText(s, max = 8000) {
  if (s == null) return ''
  const t = String(s)
  return t.length > max ? t.slice(0, max) + '…' : t
}

function buildTeacherToddComment(fb) {
  if (!fb) return 'Not reviewed'
  const v = fb.verdict
  const c = (fb.comment || '').trim()
  if (v === 'correct') return c ? `Confirmed correct — ${c}` : 'Confirmed correct'
  if (v === 'wrong') return c ? `Wrong — ${c}` : 'Wrong'
  if (v === 'partial') return c ? `Partially correct — ${c}` : 'Partially correct'
  return c || '—'
}

/**
 * Excel export for Gym Teacher “Save for Isaac” — same columns as the main report plus
 * “Teacher Todd comments” and optional flag screenshots in the last column.
 *
 * @param {object} opts.tenant - { property, suite, tenantName }
 * @param {Array}  opts.findings
 * @param {Array}  opts.feedbacks - [{ findingId, verdict, comment }]
 * @param {Array}  opts.annotations - [{ docName, pageNum, comment, cropDataUrl? }]
 * @param {string} outputPath
 */
export async function generateGymTeacherWorkbook(opts, outputPath) {
  const { tenant, findings = [], feedbacks = [], annotations = [] } = opts
  const fbById = Object.fromEntries((feedbacks || []).map(f => [f.findingId, f]))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Todd Jr.'
  wb.created = new Date()

  const ws = wb.addWorksheet('Teacher Todd Export', {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9
    },
    headerFooter: {
      oddHeader: '&C&BTeacher Todd — Gym review export',
      oddFooter: '&L' + new Date().toLocaleString() + '&RPage &P of &N'
    }
  })

  const headers = [
    'Property Name',
    'Tenant Name',
    'Suite Number',
    'Missing Document',
    'Comment / Status',
    'Severity',
    'Check Type',
    'Teacher Todd comments',
    'Screenshot'
  ]

  ws.columns = [
    { width: 14 },
    { width: 28 },
    { width: 10 },
    { width: 40 },
    { width: 48 },
    { width: 11 },
    { width: 18 },
    { width: 40 },
    { width: 16 }
  ]

  const headerRow = ws.addRow(headers)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.headerBg } }
    cell.font = { bold: true, color: { argb: PALETTE.headerFont }, size: 10, name: 'Calibri' }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF93C5FD' } } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  let dataRowIndex = 0

  const paintRow = (row, severity, rowH) => {
    const sevKey = severity === 'NOTE' ? 'LOW' : severity
    const colors = getSeverityColors(sevKey)
    const isAlt = dataRowIndex % 2 === 1
    row.height = rowH
    row.eachCell((cell, colNum) => {
      const bg = isAlt ? PALETTE.altRow : colors.bg
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.font = { color: { argb: colors.font }, size: 10, name: 'Calibri' }
      cell.border = { bottom: { style: 'thin', color: { argb: PALETTE.border } } }
      cell.alignment = { vertical: 'top', wrapText: colNum >= 4 && colNum <= 8 }
    })
    row.getCell(6).font = { ...row.getCell(6).font, bold: true }
    row.getCell(3).numFmt = '@'
  }

  const addFindingRows = () => {
    for (const finding of findings) {
      const fb = fbById[finding.id]
      const missingDocText = (!finding.missingDocument || finding.missingDocument === 'N/A')
        ? (finding.comment || '')
        : finding.missingDocument

      const row = ws.addRow([
        tenant.property,
        tenant.tenantName,
        String(tenant.suite),
        clipCellText(missingDocText, 4000),
        clipCellText(buildCommentText(finding), 8000),
        finding.severity || 'LOW',
        CHECK_LABELS[finding.checkType] || finding.checkType || '',
        clipCellText(buildTeacherToddComment(fb), 6000),
        ''
      ])
      dataRowIndex++
      const h = Math.max(24, Math.min(110, estimateRowHeight(missingDocText, buildCommentText(finding)) + 10))
      paintRow(row, finding.severity || 'LOW', h)
    }
  }

  const addAnnotationRows = () => {
    for (const ann of annotations) {
      const miss = `Flag — ${ann.docName || 'Document'} · page ${ann.pageNum ?? '?'}`
      const row = ws.addRow([
        tenant.property,
        tenant.tenantName,
        String(tenant.suite),
        clipCellText(miss, 2000),
        '',
        '—',
        'Flag',
        clipCellText(ann.comment || '', 6000),
        ''
      ])
      dataRowIndex++
      const hasImg = !!(ann.cropDataUrl && String(ann.cropDataUrl).startsWith('data:image'))
      paintRow(row, 'NOTE', hasImg ? 130 : 28)

      if (hasImg) {
        const m = String(ann.cropDataUrl).match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i)
        if (m) {
          let ext = m[1].toLowerCase()
          if (ext === 'jpg') ext = 'jpeg'
          const base64 = m[2]
          try {
            const imageId = wb.addImage({ base64, extension: ext })
            const row0 = row.number - 1
            ws.addImage(imageId, {
              tl: { col: 8.05, row: row0 + 0.05 },
              ext: { width: 320, height: 180 }
            })
          } catch {
            row.getCell(9).value = '(screenshot could not be embedded)'
          }
        } else {
          row.getCell(9).value = '(use PNG/JPEG crop for Excel image)'
        }
      }
    }
  }

  if (findings.length === 0 && annotations.length === 0) {
    const row = ws.addRow([
      tenant.property,
      tenant.tenantName,
      String(tenant.suite),
      '—',
      'No findings and no flag annotations in this save.',
      'OK',
      '',
      '—',
      ''
    ])
    dataRowIndex++
    paintRow(row, 'OK', 28)
  } else {
    addFindingRows()
    addAnnotationRows()
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 9 }
  }

  await wb.xlsx.writeFile(outputPath)
  return outputPath
}
