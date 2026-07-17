'use strict'

/**
 * Build a single-page Florida NOC (s. 713.13) fillable PDF template.
 * Field names match existing noc-pipeline.js mappings.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const fs = require('fs')
const path = require('path')

async function createNocTemplate() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const form = doc.getForm()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const L = 28
  const R = 584
  const W = R - L
  let y = 768

  function t(text, x, ly, size, f) {
    page.drawText(String(text), {
      x: x,
      y: ly,
      size: size || 7,
      font: f || font,
      color: rgb(0.2, 0.2, 0.2),
    })
  }

  function box(x, by, w, h) {
    page.drawRectangle({
      x: x,
      y: by,
      width: w,
      height: h,
      borderColor: rgb(0.5, 0.5, 0.5),
      borderWidth: 0.4,
    })
  }

  function field(name, x, by, w, h, multiline) {
    if (by < 20) throw new Error('Field ' + name + ' below page bottom at y=' + by)
    box(x, by, w, h)
    const tf = form.createTextField(name)
    tf.addToPage(page, {
      x: x + 1,
      y: by + 0.5,
      width: w - 2,
      height: h - 1,
      borderWidth: 0,
      backgroundColor: rgb(1, 1, 1),
    })
    tf.setFontSize(7.5)
    if (multiline) tf.enableMultiline()
    return tf
  }

  // Title
  t('NOTICE OF COMMENCEMENT', L, y, 12, bold)
  y -= 11
  t('Pursuant to Section 713.13, Florida Statutes', L, y, 7)
  y -= 16

  // County / Permit / Folio
  t('County', L, y, 6.5)
  t('Permit No.', L + 175, y, 6.5)
  t('Tax Folio No.', L + 330, y, 6.5)
  y -= 14
  field('County', L, y, 165, 13)
  field('Permit No', L + 175, y, 145, 13)
  field('Tax Folio No', L + 330, y, W - 330, 13)
  y -= 22

  // 1 Legal
  t('1. Legal Description and Street Address of Property Being Improved', L, y, 6.5)
  y -= 28
  field('1', L, y, W, 24, true)
  y -= 20

  // 2 General
  t('2. General Description of Improvement', L, y, 6.5)
  y -= 22
  field('General description of improvement', L, y, W, 18, true)
  y -= 20

  // 3 Owner
  t('3. Owner Name and Address', L, y, 6.5)
  y -= 14
  field('Name and address', L, y, W, 13)
  y -= 20

  // 4 Interest
  t("4. Owner's Interest in Property", L, y, 6.5)
  y -= 14
  field('Interest in property', L, y, 200, 13)
  y -= 20

  // 5 Qualifier
  t('5. Qualifier Name', L, y, 6.5)
  t('Qualifier License', L + 290, y, 6.5)
  y -= 14
  field('Qualifier Name', L, y, 275, 13)
  field('Qualifier License', L + 290, y, W - 290, 13)
  y -= 20

  // 6 Contractor
  t('6. Contractor Name, Address and License', L, y, 6.5)
  y -= 14
  field('Contractor Name and Address', L, y, W, 13)
  y -= 18
  t('Contractor Phone', L, y, 6.5)
  t('Additional Contractor Info', L + 220, y, 6.5)
  y -= 14
  field('Contractors phone number', L, y, 205, 13)
  field('Contractor Information', L + 220, y, W - 220, 13)
  y -= 20

  // 7 Surety
  t('7. Surety (if any) Name and Address', L, y, 6.5)
  y -= 14
  field('Name and address_2', L, y, W, 13)
  y -= 18
  t('Amount of Bond', L, y, 6.5)
  t('Surety Phone', L + 200, y, 6.5)
  y -= 14
  field('Amount of bond', L, y, 185, 13)
  field('Phone number', L + 200, y, 170, 13)
  y -= 20

  // 8 Lender
  t('8. Lender (if any) Name and Address', L, y, 6.5)
  y -= 14
  field('Name and Address', L, y, W, 13)
  y -= 18
  t('Lender Phone', L, y, 6.5)
  y -= 14
  field('Lenders phone number', L, y, 185, 13)
  y -= 20

  // 9 Persons designated
  t('9. Persons Designated to Receive Notices (Fla. Stat. §713.13(1)(b))', L, y, 6.5)
  y -= 14
  field('Name and address_3', L, y, W, 13)
  y -= 18
  field(
    'receive a copy of the Lienors Notice as provided in Section 713131b Florida Statutes',
    L,
    y,
    300,
    11
  )
  field('of', L + 310, y, 60, 11)
  field('Phone numbers', L + 380, y, W - 380, 11)
  y -= 18

  // 10 Expiration
  t('10. Expiration Date of Notice (1 year from recording unless specified)', L, y, 6.5)
  y -= 14
  field(
    'Expiration date of notice of commencement the expiration date will be 1 year from the date of',
    L,
    y,
    270,
    13
  )
  field('recording unless a different date is specified', L + 280, y, W - 280, 13)
  y -= 16

  page.drawLine({
    start: { x: L, y: y },
    end: { x: R, y: y },
    thickness: 0.6,
    color: rgb(0, 0, 0),
  })
  y -= 11

  t('WARNING TO OWNER: ANY CLAIMS OF LIEN AFTER THE EXPIRATION DATE ARE INVALID.', L, y, 6, bold)
  y -= 12
  t('OWNER OR LESSEE SIGNATURE', L, y, 7.5, bold)
  y -= 10
  t('Signed this _____ day of _________________, 20____', L, y, 7.5)
  y -= 14
  t('Signature of Owner / Lessee / Authorized Officer', L, y, 6)
  t("Signatory's Title/Office", L + 310, y, 6)
  y -= 13
  field(
    'Signature of Owner or Lessee or Owners or Lessees Authorized OfficerDirectorPartnerManager',
    L,
    y,
    295,
    12
  )
  field('Signatorys TitleOffice', L + 310, y, W - 310, 12)
  y -= 18

  // Notary block
  t('STATE OF FLORIDA', L, y, 7.5, bold)
  y -= 10
  t('COUNTY OF _______________________________', L, y, 7.5)
  y -= 10
  t('The foregoing instrument was acknowledged before me this _____ day of _______________, 20____', L, y, 6.5)
  y -= 9
  t('by ________________________________ as ________________ for _______________________________.', L, y, 6.5)
  y -= 14

  t('as', L, y, 5.5)
  t('year by name of', L + 45, y, 5.5)
  t('authority', L + 155, y, 5.5)
  t('type of', L + 300, y, 5.5)
  y -= 12
  field('as', L, y, 38, 11)
  field('year  by name of', L + 45, y, 100, 11)
  field('authority eg officer trustee attorney in fact for', L + 155, y, 135, 11)
  field('type of', L + 300, y, 100, 11)
  y -= 16

  t('party on behalf of whom instrument was executed', L, y, 5.5)
  t('Type of Identification', L + 310, y, 5.5)
  y -= 12
  field('party on behalf of whom instrument was executed', L, y, 295, 11)
  field('Type of Identification', L + 310, y, W - 310, 11)
  y -= 16

  t('Notary Signature — State of Florida', L, y, 5.5)
  t('Print / Type / Stamp Commissioned Name of Notary Public', L + 275, y, 5.5)
  y -= 12
  field('Signature of Notary Public State of Florida', L, y, 260, 12)
  field('Print Type or Stamp Commissioned Name of Notary Public', L + 275, y, W - 275, 12)
  y -= 14

  // Tiny compatibility fields (still on-page)
  field('undefined', L, y, 30, 9)
  field('Text2', L + 40, y, 10, 9)
  field('Text3', L + 55, y, 10, 9)

  t('DART iQ — Florida Statutes §713.13 (single-page form)', L, 10, 5.5)

  return doc
}

async function main() {
  const outDir = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const doc = await createNocTemplate()
  const pdfBytes = await doc.save()
  const outPath = path.join(outDir, 'noc-template-new.pdf')
  fs.writeFileSync(outPath, pdfBytes)

  const verify = await PDFDocument.load(pdfBytes)
  const fields = verify.getForm().getFields()
  let oob = 0
  fields.forEach(function (f) {
    f.acroField.getWidgets().forEach(function (w) {
      const r = w.getRectangle()
      if (r.y < 0 || r.y + r.height > 792) oob += 1
    })
  })

  console.log(JSON.stringify({
    pages: verify.getPageCount(),
    bytes: pdfBytes.length,
    fieldCount: fields.length,
    outOfBounds: oob,
    outPath: outPath,
  }, null, 2))

  if (verify.getPageCount() !== 1) throw new Error('Must be 1 page')
  if (oob > 0) throw new Error('Fields out of bounds: ' + oob)
}

module.exports = { createNocTemplate }

if (require.main === module) {
  main().catch(function (err) {
    console.error(err.message)
    process.exit(1)
  })
}
