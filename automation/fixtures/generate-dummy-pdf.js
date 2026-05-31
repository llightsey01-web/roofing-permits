// automation/fixtures/generate-dummy-pdf.js
// Generates AHJ-IQ-TEST-DO-NOT-SUBMIT.pdf for ePN inspection only

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

function buildMinimalPdf(text, pageCount) {
  var pages = Math.max(1, pageCount || 1)
  var pageObjectNums = []
  var contentObjectNums = []
  var nextNum = 3

  for (var p = 0; p < pages; p++) {
    pageObjectNums.push(nextNum++)
    contentObjectNums.push(nextNum++)
  }
  var fontObjectNum = nextNum++

  var objects = {}
  objects[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'

  var kids = pageObjectNums.map(function(n) { return n + ' 0 R' }).join(' ')
  objects[2] = '2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + pages + ' >>\nendobj\n'

  for (var i = 0; i < pages; i++) {
    var pageNum = pageObjectNums[i]
    var contentNum = contentObjectNums[i]
    var y = 720 - (i * 40)
    var line = 'BT /F1 18 Tf 72 ' + y + ' Td (' + text + ' page ' + (i + 1) + ') Tj ET'
    objects[pageNum] = pageNum + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ' + contentNum + ' 0 R /Resources << /Font << /F1 ' + fontObjectNum + ' 0 R >> >> >>\nendobj\n'
    objects[contentNum] = contentNum + ' 0 obj\n<< /Length ' + line.length + ' >>\nstream\n' + line + '\nendstream\nendobj\n'
  }

  objects[fontObjectNum] = fontObjectNum + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'

  var objectNums = Object.keys(objects).map(Number).sort(function(a, b) { return a - b })
  var pdf = '%PDF-1.4\n'
  var offsets = [0]

  objectNums.forEach(function(num) {
    offsets.push(pdf.length)
    pdf += objects[num]
  })

  var xrefStart = pdf.length
  pdf += 'xref\n0 ' + (objectNums.length + 1) + '\n'
  pdf += '0000000000 65535 f \n'
  for (var j = 1; j < offsets.length; j++) {
    pdf += String(offsets[j]).padStart(10, '0') + ' 00000 n \n'
  }
  pdf += 'trailer\n<< /Size ' + (objectNums.length + 1) + ' /Root 1 0 R >>\n'
  pdf += 'startxref\n' + xrefStart + '\n%%EOF\n'
  return Buffer.from(pdf, 'utf8')
}

function ensureDummyPdf(targetDir, pageCount) {
  mkdirSync(targetDir, { recursive: true })
  var filePath = join(targetDir, 'AHJ-IQ-TEST-DO-NOT-SUBMIT.pdf')
  writeFileSync(filePath, buildMinimalPdf('AHJ-IQ TEST DO NOT SUBMIT', pageCount || 1))
  return filePath
}

module.exports = {
  buildMinimalPdf,
  ensureDummyPdf,
}
