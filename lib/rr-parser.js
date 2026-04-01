import ExcelJS from 'exceljs'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

/** Parse Excel buffer → tab-separated text preserving all sheets */
export async function parseExcelToText(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
  const sheets = []
  wb.eachSheet(ws => {
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        let val = cell.value
        if (val === null || val === undefined) { cells.push(''); return }
        if (val instanceof Date) { cells.push(val.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' })); return }
        if (typeof val === 'object') {
          if (val.result !== undefined) {
            const r = val.result
            if (r instanceof Date) cells.push(r.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' }))
            else cells.push(r !== null && r !== undefined ? String(r) : '')
          } else if (val.richText) cells.push(val.richText.map(rt => rt.text).join(''))
          else if (val.text) cells.push(String(val.text))
          else cells.push('')
          return
        }
        cells.push(String(val))
      })
      if (cells.some(c => c.trim())) rows.push(cells.join('\t'))
    })
    if (rows.length) sheets.push({ name: ws.name, rows })
  })
  if (!sheets.length) return '(empty workbook)'
  return sheets.map(s => `=== SHEET: ${s.name} ===\n${s.rows.join('\n')}`).join('\n\n')
}

/** Parse PDF buffer → text */
export async function parsePdfToText(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  try {
    const data = await pdfParse(buf)
    return data.text?.trim() || ''
  } catch (e) { return `[PDF parse error: ${e.message}]` }
}

/** Detect file type and parse accordingly. Returns { type, text, scanned? } */
export async function parseRRFile(buffer, filename) {
  const lower = (filename || '').toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return { type: 'excel', text: await parseExcelToText(buffer) }
  }
  if (lower.endsWith('.csv')) {
    return { type: 'csv', text: Buffer.from(buffer).toString('utf-8') }
  }
  if (lower.endsWith('.pdf')) {
    const text = await parsePdfToText(buffer)
    const scanned = !text || text.length < 50
    return { type: 'pdf', text: scanned ? '[SCANNED IMAGE PDF — text extraction returned empty; OCR would be required]' : text, scanned }
  }
  return { type: 'text', text: Buffer.from(buffer).toString('utf-8') }
}
