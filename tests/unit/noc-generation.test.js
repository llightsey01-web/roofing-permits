// tests/unit/noc-generation.test.js — no real network calls
'use strict'

const fs = require('fs')
const path = require('path')
const { PDFDocument } = require('pdf-lib')
const {
  NOC_FIELDS,
  NOC_TEXT_FIELDS,
} = require('../../lib/noc/noc-field-map')

let mockTemplateBytes
let originalFlatten

async function buildNocTemplatePdf() {
  const doc = await PDFDocument.create()
  const form = doc.getForm()
  NOC_TEXT_FIELDS.forEach(function (name) {
    form.createTextField(name)
  })
  // Checkboxes referenced by fillNocForm (not in NOC_TEXT_FIELDS)
  form.createCheckBox(NOC_FIELDS.NOTARY_PHYSICAL_PRESENCE_CHECKBOX)
  form.createCheckBox(NOC_FIELDS.NOTARY_ONLINE_CHECKBOX)
  return Buffer.from(await doc.save())
}

async function readPdfField(pdfBytes, fieldName) {
  const doc = await PDFDocument.load(pdfBytes)
  const form = doc.getForm()
  return form.getTextField(fieldName).getText()
}

jest.mock('@supabase/supabase-js', function () {
  return {
    createClient: jest.fn(function () {
      return {
        storage: {
          from: jest.fn(function () {
            return {
              download: jest.fn(async function () {
                return {
                  data: {
                    arrayBuffer: async function () {
                      return mockTemplateBytes.buffer.slice(
                        mockTemplateBytes.byteOffset,
                        mockTemplateBytes.byteOffset + mockTemplateBytes.byteLength
                      )
                    },
                  },
                  error: null,
                }
              }),
              upload: jest.fn(async function () {
                return { error: null }
              }),
            }
          }),
        },
        from: jest.fn(function () {
          return {
            update: jest.fn(function () {
              return { eq: jest.fn(async function () { return { error: null } }) }
            }),
          }
        }),
      }
    }),
  }
})

describe('noc-generation', function () {
  let generateNOC

  beforeAll(async function () {
    mockTemplateBytes = await buildNocTemplatePdf()
    const probeDoc = await PDFDocument.create()
    const probeForm = probeDoc.getForm()
    probeForm.createTextField('__probe__')
    originalFlatten = probeForm.flatten.bind(probeForm)
    const FormCtor = probeForm.constructor
    FormCtor.prototype.flatten = function () {}

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    generateNOC = require('../../lib/noc/noc-pipeline.js').generateNOC
  })

  afterAll(function () {
    if (originalFlatten) {
      const probeDoc = PDFDocument.create()
      probeDoc.then(function (doc) {
        const form = doc.getForm()
        form.constructor.prototype.flatten = originalFlatten
      })
    }
  })

  const sampleJob = {
    owner_name: 'Jane Homeowner',
    property_address: '123 Main St',
    property_city: 'Lakeland',
    property_state: 'FL',
    property_zip: '33801',
    legal_description: 'LOT 5 BLK 2 SUNNY ACRES',
    parcel_number: '12-34-56-7890',
    scope_of_work: 'Residential re-roof',
  }

  const sampleCompany = {
    name: 'Test Roofing LLC',
    address: '500 Contractor Blvd',
    city: 'Tampa',
    state: 'FL',
    zip: '33602',
    phone: '813-555-0100',
    license_number: 'CCC9999999',
  }

  const fullAddress = '123 Main St, Lakeland, FL 33801'

  test('production template contains every canonical NOC field with the correct field type', async function () {
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'noc-template.pdf')
    expect(fs.existsSync(templatePath)).toBe(true)

    const doc = await PDFDocument.load(fs.readFileSync(templatePath))
    const form = doc.getForm()

    NOC_TEXT_FIELDS.forEach(function (name) {
      expect(function () {
        form.getTextField(name)
      }).not.toThrow()
    })

    ;[
      NOC_FIELDS.NOTARY_PHYSICAL_PRESENCE_CHECKBOX,
      NOC_FIELDS.NOTARY_ONLINE_CHECKBOX,
    ].forEach(function (name) {
      expect(function () {
        form.getCheckBox(name)
      }).not.toThrow()
    })
  })

  test('generateNOC completes without error', async function () {
    const result = await generateNOC('test-job-id', sampleJob, sampleCompany)
    expect(result.filePath).toMatch(/noc-filled\.pdf$/)
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array)
    expect(result.pdfBytes.length).toBeGreaterThan(0)
    expect(result.generalDescription).toBe('Residential re-roof')
  })

  test('NOC contains correct owner name', async function () {
    const { pdfBytes } = await generateNOC('test-job-id-2', sampleJob, sampleCompany)
    const nameAndAddress = await readPdfField(pdfBytes, NOC_FIELDS.OWNER_NAME_AND_ADDRESS)
    expect(nameAndAddress).toContain('Jane Homeowner')
    expect(nameAndAddress).toContain(fullAddress)
  })

  test('NOC contains correct property address', async function () {
    const { pdfBytes } = await generateNOC('test-job-id-3', sampleJob, sampleCompany)
    const streetAddress = await readPdfField(pdfBytes, NOC_FIELDS.STREET_ADDRESS)
    expect(streetAddress).toContain('123 Main St')
    expect(streetAddress).toContain('Lakeland')
  })

  test('NOC contains correct legal description', async function () {
    const { pdfBytes } = await generateNOC('test-job-id-4', sampleJob, sampleCompany)
    const legalDescription = await readPdfField(pdfBytes, NOC_FIELDS.LEGAL_DESCRIPTION)
    expect(legalDescription).toContain('LOT 5 BLK 2 SUNNY ACRES')
  })
})
