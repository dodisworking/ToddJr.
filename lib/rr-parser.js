import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

/**
 * Parse a rent roll file. Returns:
 * Text files: { type, text, isImage: false }
 * Image/scanned: { type, base64, mimeType, isImage: true }
 */
export async function parseRRFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (['.xlsx', '.xls'].includes(ext)) return parseExcel(filePath)
  if (ext === '.csv') return parseCsv(filePath)
  if (ext === '.pdf') return parsePDF(filePath)
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return parseImageFile(filePath, ext)
  throw new Error(`Unsupported file type: ${ext}`)
}

async function parseExcel(filePath) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheets = []
  wb.worksheets.forEach(ws => {
    if (ws.rowCount < 1) return
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const vals = []
      row.eachCell({ includeEmpty: true }, cell => {
        let v = cell.value
        if (v === null || v === undefined) { vals.push(''); return }
        if (typeof v === 'object' && v.text)   { vals.push(String(v.text)); return }
        if (typeof v === 'object' && v.result !== undefined) { vals.push(String(v.result)); return }
        if (v instanceof Date) { vals.push(v.toLocaleDateString('en-US')); return }
        vals.push(String(v))
      })
      rows.push(`Row ${rowNum}: ${vals.join(' | ')}`)
    })
    sheets.push(`=== Sheet: ${ws.name} (${ws.rowCount} rows) ===\n${rows.join('\n')}`)
  })
  return { type: 'excel', text: sheets.join('\n\n'), isImage: false }
}

async function parseCsv(filePath) {
  const wb = new ExcelJS.Workbook()
  await wb.csv.readFile(filePath)
  const ws = wb.worksheets[0]
  const rows = []
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    rows.push(`Row ${rowNum}: ${row.values.slice(1).map(v => String(v ?? '')).join(' | ')}`)
  })
  return { type: 'csv', text: `=== CSV ===\n${rows.join('\n')}`, isImage: false }
}

async function parsePDF(filePath) {
  const buffer = fs.readFileSync(filePath)
  try {
    const data = await pdfParse(buffer)
    const text = data.text?.trim() || ''
    if (text.length > 80) return { type: 'pdf', text, isImage: false }
  } catch {}
  return { type: 'pdf-image', base64: buffer.toString('base64'), mimeType: 'application/pdf', isImage: true }
}

async function parseImageFile(filePath, ext) {
  const buffer = fs.readFileSync(filePath)
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
  return { type: 'image', base64: buffer.toString('base64'), mimeType: mime[ext] || 'image/png', isImage: true }
}
