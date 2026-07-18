'use strict'

/**
 * Add AcroForm text fields onto the user's blank one-page NOC artwork.
 *
 * Coordinates measured from underline positions on BLANK_NOC_TEMPLATE.PDF
 * (PDF origin = bottom-left, page 612 x 792).
 *
 * Usage: node scripts/make-noc-fillable.js
 */

const { PDFDocument, rgb } = require('pdf-lib')
const fs = require('fs')
const os = require('os')
const path = require('path')

async function makeNocFillable() {
  const templatePath = path.join(os.homedir(), 'Desktop', 'BLANK_NOC_TEMPLATE.PDF')
  const bytes = fs.readFileSync(templatePath)
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  const { width, height } = page.getSize()
  const form = doc.getForm()

  console.log('Page size:', width, 'x', height)

  /**
   * underlineY = measured y of the printed blank line (from bottom).
   * Field sits just above that line.
   */
  function addField(name, x, underlineY, fieldWidth, fieldHeight, fontSize) {
    fieldHeight = fieldHeight || 12
    fontSize = fontSize || 8
    const field = form.createTextField(name)
    field.addToPage(page, {
      x: x,
      y: underlineY + 1,
      width: fieldWidth,
      height: fieldHeight,
      borderWidth: 0,
      backgroundColor: rgb(1, 1, 1),
      borderColor: rgb(1, 1, 1),
    })
    field.setFontSize(fontSize)
    console.log('Added field:', name, 'at', x, underlineY + 1, 'size', fieldWidth + 'x' + fieldHeight)
  }

  // Prepared By
  addField('prepared_by_name', 88, 741, 180, 12, 8)
  addField('prepared_by_address', 98, 730, 180, 12, 8)
  addField('Permit No', 128, 719.5, 180, 12, 8)

  // COUNTY OF ________
  addField('county', 158, 669, 140, 12, 9)

  // 1. DESCRIPTION OF PROPERTY (parcel/legal + street address)
  addField('Tax Folio No', 56, 629.5, 358, 12, 8) // parcel + legal on first line
  addField('1', 56, 618.5, 358, 12, 8) // street address / continued legal

  // 2. GENERAL DESCRIPTION OF IMPROVEMENT
  addField('General description of improvement', 56, 586, 358, 12, 8)
  addField('general_description_line2', 56, 575.5, 358, 12, 8)

  // 3. OWNER INFORMATION
  addField('Name and address', 158, 543, 270, 12, 8)
  addField('owner_address_line2', 56, 532, 358, 12, 8)
  addField('Interest in property', 158, 521.5, 270, 12, 8)
  addField('fee_simple_titleholder', 74, 499.5, 358, 12, 8)

  // 4. CONTRACTOR (467.5 after label, 456.5 full line, 445.5 phone)
  addField('Contractor Name and Address', 158, 467.5, 270, 12, 8)
  addField('contractor_address_line2', 74, 456.5, 358, 12, 8)
  addField('Contractors phone number', 160, 445.5, 250, 12, 8)

  // 5. SURETY
  addField('Name and address_2', 160, 413.5, 250, 12, 8)
  addField('Amount of bond', 210, 402.5, 90, 12, 8)
  addField('surety_phone', 160, 391.5, 250, 12, 8)

  // 6. LENDER
  addField('Name and Address', 160, 359.5, 250, 12, 8)
  addField('Lenders phone number', 160, 348.5, 250, 12, 8)

  // 7–8 notices left blank (optional)

  // 9. Expiration
  addField('expiration_date', 220, 197.5, 160, 12, 8)

  // Printed name under signature
  addField('owner_printed_name', 104, 113, 240, 12, 9)

  const outBytes = await doc.save()
  const outDir = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'noc-template-fillable.pdf')
  fs.writeFileSync(outPath, outBytes)

  console.log('Fillable template saved:', outPath)
  console.log('Fields added:', form.getFields().length)
  console.log('Pages:', doc.getPageCount())
  return outBytes
}

if (require.main === module) {
  makeNocFillable()
    .then(function () {
      console.log('Done — open tmp/noc-template-fillable.pdf to verify field positions')
    })
    .catch(function (e) {
      console.error('FAILED:', e.message)
      process.exit(1)
    })
}

module.exports = { makeNocFillable }
