// tests/unit/packet-field-map.test.js
// ZIG-17 PR 2: strict packet field-map adapter — no storage, no workers
'use strict'

const { PDFDocument, PDFTextField, PDFCheckBox, PDFName, PDFRef } = require('pdf-lib')
const {
  ERROR_CODE,
  KIND,
  parseCanonicalFieldMap,
  validateFieldMapAgainstPdf,
  validateFieldMapAgainstForm,
  resolveFieldValues,
  applyResolvedFields,
  packetConfigInvalidError,
} = require('../../lib/permits/packet-field-map.js')
const { isPacketConfigValid } = require('../../lib/ahj/packet-config.js')

const TEXT_FIELD = 'ApplicantName'
const CHECK_FIELD = 'IsOwnerOccupied'

function validTextField(overrides) {
  return Object.assign(
    {
      pdfField: TEXT_FIELD,
      source: 'job.owner_name',
      type: 'text',
      required: true,
      autofit: true,
      maxChars: 80,
    },
    overrides || {}
  )
}

function validCheckboxField(overrides) {
  return Object.assign(
    {
      pdfField: CHECK_FIELD,
      source: 'job.property_type',
      type: 'checkbox',
      required: false,
    },
    overrides || {}
  )
}

function canonicalMap(fields) {
  return { fields: fields }
}

async function buildPilotPdf() {
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  const form = doc.getForm()
  const text = form.createTextField(TEXT_FIELD)
  text.addToPage(page, { x: 50, y: 500, width: 220, height: 20 })
  const checkbox = form.createCheckBox(CHECK_FIELD)
  checkbox.addToPage(page, { x: 50, y: 460, width: 16, height: 16 })
  return Buffer.from(await doc.save())
}

function daFontName(textField) {
  var da = textField.acroField.getDefaultAppearance()
  expect(typeof da).toBe('string')
  var match = da.match(/\/([^\s]+)\s+[\d.]+\s+Tf/)
  expect(match).not.toBeNull()
  return match[1]
}

function assertDaFontRegisteredInAppearance(doc, textField, options) {
  var requireResolvedFont = options && options.requireResolvedFont
  var fontName = daFontName(textField)
  expect(fontName).not.toBe('Helv')
  var widgets = textField.acroField.getWidgets()
  expect(widgets.length).toBeGreaterThan(0)
  var normal = widgets[0].getNormalAppearance()
  var stream = normal instanceof PDFRef ? doc.context.lookup(normal) : normal
  expect(stream && stream.dict).toBeTruthy()
  var resources = stream.dict.lookup(PDFName.of('Resources'))
  expect(resources).toBeTruthy()
  var fonts = resources.lookup(PDFName.of('Font'))
  expect(fonts.has(PDFName.of(fontName))).toBe(true)
  var fontRef = fonts.get(PDFName.of(fontName))
  var fontObj = fonts.lookup(PDFName.of(fontName))
  expect(fontRef instanceof PDFRef || fontObj).toBeTruthy()
  if (requireResolvedFont) {
    expect(fontObj).toBeTruthy()
    if (typeof fontObj.lookup === 'function') {
      expect(String(fontObj.lookup(PDFName.of('Type')))).toMatch(/Font/)
    }
  }

  var dr = doc.getForm().acroForm.dict.lookup(PDFName.of('DR'))
  if (dr && typeof dr.lookup === 'function') {
    var drFonts = dr.lookup(PDFName.of('Font'))
    if (drFonts && typeof drFonts.has === 'function') {
      expect(drFonts.has(PDFName.of(fontName))).toBe(true)
    }
  }
}

function expectConfigError(fn, code) {
  try {
    fn()
    throw new Error('expected packet_config_invalid')
  } catch (err) {
    expect(err.errorCode).toBe(ERROR_CODE)
    expect(err.nonRetryable).toBe(true)
    expect(Array.isArray(err.problems)).toBe(true)
    if (code) {
      expect(err.problems.map(function (p) { return p.code })).toContain(code)
    }
  }
}

async function expectConfigErrorAsync(promise, code) {
  try {
    await promise
    throw new Error('expected packet_config_invalid')
  } catch (err) {
    expect(err.errorCode).toBe(ERROR_CODE)
    expect(err.nonRetryable).toBe(true)
    expect(Array.isArray(err.problems)).toBe(true)
    if (code) {
      expect(err.problems.map(function (p) { return p.code })).toContain(code)
    }
  }
}

describe('packet-field-map', function () {
  describe('parseCanonicalFieldMap', function () {
    test('accepts the approved canonical shape and applies defaults', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([
          validTextField(),
          { pdfField: CHECK_FIELD, source: 'job.property_type', type: 'checkbox' },
        ])
      )
      expect(parsed.fields).toHaveLength(2)
      expect(parsed.fields[0]).toEqual({
        pdfField: TEXT_FIELD,
        source: 'job.owner_name',
        type: 'text',
        required: true,
        autofit: true,
        maxChars: 80,
      })
      expect(parsed.fields[1]).toEqual({
        pdfField: CHECK_FIELD,
        source: 'job.property_type',
        type: 'checkbox',
        required: false,
      })
      expect(Object.prototype.hasOwnProperty.call(parsed.fields[1], 'autofit')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(parsed.fields[1], 'maxChars')).toBe(false)
    })

    test('defaults required and autofit to false when omitted on text', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([{ pdfField: TEXT_FIELD, source: 'job.owner_name', type: 'text' }])
      )
      expect(parsed.fields[0].required).toBe(false)
      expect(parsed.fields[0].autofit).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(parsed.fields[0], 'maxChars')).toBe(false)
    })

    test('rejects missing field_map', function () {
      expectConfigError(function () { parseCanonicalFieldMap(null) }, 'field_map_missing')
    })

    test('rejects legacy flat maps', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap({ Owner: 'job.owner_name' })
      }, 'unknown_top_level_key')
    })

    test('rejects fields that are not an array', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap({ fields: { pdfField: TEXT_FIELD } })
      }, 'fields_not_array')
    })

    test('rejects an empty fields array', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap({ fields: [] })
      }, 'fields_empty')
    })

    test('rejects autofit: true without maxChars', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(
          canonicalMap([
            {
              pdfField: TEXT_FIELD,
              source: 'job.owner_name',
              type: 'text',
              autofit: true,
            },
          ])
        )
      }, 'autofit_requires_max_chars')
    })

    test('accepts autofit: true with maxChars', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([
          {
            pdfField: TEXT_FIELD,
            source: 'job.owner_name',
            type: 'text',
            autofit: true,
            maxChars: 80,
          },
        ])
      )
      expect(parsed.fields[0].autofit).toBe(true)
      expect(parsed.fields[0].maxChars).toBe(80)
    })

    test('rejects unknown field keys such as maxChar / pdf_field / autofill', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ maxChar: 80 })]))
      }, 'unknown_field_key')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ pdf_field: TEXT_FIELD })]))
      }, 'unknown_field_key')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ autofill: true })]))
      }, 'unknown_field_key')
    })

    test('rejects duplicate pdfField', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(
          canonicalMap([
            validTextField(),
            validTextField({ source: 'company.name' }),
          ])
        )
      }, 'duplicate_pdf_field')
    })

    test('rejects missing pdfField and missing source', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([{ source: 'job.owner_name', type: 'text' }]))
      }, 'missing_pdf_field')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([{ pdfField: TEXT_FIELD, type: 'text' }]))
      }, 'missing_source')
    })

    test('rejects unsupported type without inferring', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ type: 'dropdown' })]))
      }, 'unsupported_type')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ type: 'TEXT' })]))
      }, 'unsupported_type')
    })

    test('rejects non-boolean required/autofit and invalid maxChars', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ required: 'true' })]))
      }, 'invalid_required')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ autofit: 1 })]))
      }, 'invalid_autofit')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ maxChars: 0 })]))
      }, 'invalid_max_chars')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ maxChars: 1.5 })]))
      }, 'invalid_max_chars')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ maxChars: '80' })]))
      }, 'invalid_max_chars')
    })

    test('rejects checkbox autofit:true and any checkbox maxChars', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validCheckboxField({ autofit: true })]))
      }, 'checkbox_autofit_not_allowed')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validCheckboxField({ maxChars: 10 })]))
      }, 'checkbox_max_chars_not_allowed')
    })

    test('normalizes checkbox autofit:false away', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validCheckboxField({ autofit: false })])
      )
      expect(parsed.fields[0].type).toBe('checkbox')
      expect(Object.prototype.hasOwnProperty.call(parsed.fields[0], 'autofit')).toBe(false)
    })

    test('rejects unsupported source paths including job.contractor.name', function () {
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ source: 'job.contractor.name' })]))
      }, 'unsupported_source')
      expectConfigError(function () {
        parseCanonicalFieldMap(canonicalMap([validTextField({ source: 'job.__proto__' })]))
      }, 'unsupported_source')
    })
  })

  describe('ZIG-10 seam remains permissive', function () {
    test('hasUsableFieldMap still accepts a legacy flat object via isPacketConfigValid', function () {
      var result = isPacketConfigValid([
        {
          document_role: 'permit_application',
          display_name: 'Permit Application',
          required: true,
          include_in_submission_packet: true,
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: { Owner: 'job.owner_name' },
        },
      ])
      expect(result.valid).toBe(true)
      expectConfigError(function () {
        parseCanonicalFieldMap({ Owner: 'job.owner_name' })
      }, 'unknown_top_level_key')
    })
  })

  describe('typed PDF validation against a real AcroForm', function () {
    var pdfBytes

    beforeAll(async function () {
      pdfBytes = await buildPilotPdf()
    })

    test('accepts matching text + checkbox types via pdf-lib field classes', async function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField(), validCheckboxField()])
      )
      var result = await validateFieldMapAgainstPdf(pdfBytes, parsed)
      expect(result.ok).toBe(true)

      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      expect(form.getTextField(TEXT_FIELD)).toBeInstanceOf(PDFTextField)
      expect(form.getCheckBox(CHECK_FIELD)).toBeInstanceOf(PDFCheckBox)
      validateFieldMapAgainstForm(form, parsed)
    })

    test('rejects a configured PDF field that does not exist', async function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField({ pdfField: 'DoesNotExist' })])
      )
      await expectConfigErrorAsync(
        validateFieldMapAgainstPdf(pdfBytes, parsed),
        'pdf_field_missing'
      )
    })

    test('rejects text mapped onto a real checkbox field', async function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField({ pdfField: CHECK_FIELD })])
      )
      await expectConfigErrorAsync(
        validateFieldMapAgainstPdf(pdfBytes, parsed),
        'pdf_field_type_mismatch'
      )
    })

    test('rejects checkbox mapped onto a real text field', async function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validCheckboxField({ pdfField: TEXT_FIELD })])
      )
      await expectConfigErrorAsync(
        validateFieldMapAgainstPdf(pdfBytes, parsed),
        'pdf_field_type_mismatch'
      )
    })

    test('typed accessors throw when names/types are wrong (ZIG-16 standard)', async function () {
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      expect(function () { form.getTextField('DoesNotExist') }).toThrow()
      expect(function () { form.getCheckBox(TEXT_FIELD) }).toThrow()
      expect(function () { form.getTextField(CHECK_FIELD) }).toThrow()
    })
  })

  describe('resolveFieldValues', function () {
    test('required source missing is completeness, not config', function () {
      var parsed = parseCanonicalFieldMap(canonicalMap([validTextField({ required: true })]))
      var result = resolveFieldValues(parsed, { job: {}, company: {} })
      expect(result.ok).toBe(false)
      expect(result.kind).toBe(KIND.INCOMPLETE)
      expect(result.problems.config).toHaveLength(0)
      expect(result.problems.completeness.map(function (p) { return p.code })).toEqual([
        'required_source_missing',
      ])
      expect(result.values[0].hasValue).toBe(false)
      expect(result.values[0].shouldApply).toBe(false)
    })

    test('optional source missing is informational and does not fail resolution', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField({ required: false })])
      )
      var result = resolveFieldValues(parsed, { job: {}, company: {} })
      expect(result.ok).toBe(true)
      expect(result.kind).toBe(KIND.OK)
      expect(result.problems.completeness).toHaveLength(0)
      expect(result.problems.informational.map(function (p) { return p.code })).toEqual([
        'optional_source_missing',
      ])
      expect(result.values[0].hasValue).toBe(false)
      expect(result.values[0].shouldApply).toBe(false)
      expect(result.values[0].value).toBe(null)
    })

    test('unsupported_source remains a config problem at resolve time', function () {
      var result = resolveFieldValues(
        { fields: [{ pdfField: TEXT_FIELD, source: 'job.contractor.name', type: 'text', required: false }] },
        { job: { contractor: { name: 'Acme' } } }
      )
      expect(result.ok).toBe(false)
      expect(result.kind).toBe(KIND.CONFIG)
      expect(result.problems.config[0].code).toBe('unsupported_source')
    })

    test('normalizes string/number/boolean text scalars and rejects objects/arrays', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([{ pdfField: TEXT_FIELD, source: 'job.owner_name', type: 'text' }])
      )
      expect(resolveFieldValues(parsed, { job: { owner_name: 'Jane' } }).values[0]).toMatchObject({
        hasValue: true,
        shouldApply: true,
        value: 'Jane',
      })
      expect(resolveFieldValues(parsed, { job: { owner_name: 42 } }).values[0].value).toBe('42')
      expect(resolveFieldValues(parsed, { job: { owner_name: false } }).values[0].value).toBe('false')

      var objectResult = resolveFieldValues(parsed, { job: { owner_name: { first: 'Jane' } } })
      expect(objectResult.ok).toBe(false)
      expect(objectResult.kind).toBe(KIND.INCOMPLETE)
      expect(objectResult.problems.completeness[0].code).toBe('unsupported_text_value')
      expect(objectResult.values[0].shouldApply).toBe(false)

      var arrayResult = resolveFieldValues(parsed, { job: { owner_name: ['Jane'] } })
      expect(arrayResult.problems.completeness[0].code).toBe('unsupported_text_value')
    })

    test('checkbox requires explicit boolean semantics', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validCheckboxField({ source: 'job.property_type', required: false })])
      )
      expect(resolveFieldValues(parsed, { job: { property_type: true } }).values[0]).toMatchObject({
        hasValue: true,
        shouldApply: true,
        value: true,
      })
      expect(resolveFieldValues(parsed, { job: { property_type: 'FALSE' } }).values[0].value).toBe(false)
      expect(resolveFieldValues(parsed, { job: { property_type: 1 } }).values[0].value).toBe(true)
      expect(resolveFieldValues(parsed, { job: { property_type: 0 } }).values[0].value).toBe(false)

      var yes = resolveFieldValues(parsed, { job: { property_type: 'yes' } })
      expect(yes.ok).toBe(false)
      expect(yes.kind).toBe(KIND.INCOMPLETE)
      expect(yes.problems.completeness[0].code).toBe('invalid_checkbox_value')
      expect(yes.values[0].shouldApply).toBe(false)
    })

    test('maxChars overflow is completeness and does not apply', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField({ maxChars: 4, required: false, autofit: false })])
      )
      var result = resolveFieldValues(parsed, { job: { owner_name: 'Jane Homeowner' } })
      expect(result.ok).toBe(false)
      expect(result.kind).toBe(KIND.INCOMPLETE)
      expect(result.problems.completeness[0].code).toBe('max_chars_exceeded')
      expect(result.values[0].hasValue).toBe(true)
      expect(result.values[0].shouldApply).toBe(false)
    })

    test('composed allowlisted addresses resolve without nested path walking', function () {
      var parsed = parseCanonicalFieldMap(
        canonicalMap([
          { pdfField: TEXT_FIELD, source: 'job.property_full_address', type: 'text', required: true },
        ])
      )
      var result = resolveFieldValues(parsed, {
        job: {
          property_address: '123 Main St',
          property_city: 'Lakeland',
          property_state: 'FL',
          property_zip: '33801',
        },
      })
      expect(result.ok).toBe(true)
      expect(result.values[0].value).toBe('123 Main St, Lakeland, FL 33801')
    })
  })

  describe('applyResolvedFields on a real AcroForm', function () {
    test('writes valid text and checkbox values; autofit round-trips with a registered font', async function () {
      var pdfBytes = await buildPilotPdf()
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField(), validCheckboxField({ required: false })])
      )
      var resolved = resolveFieldValues(parsed, {
        job: { owner_name: 'Jane Homeowner', property_type: true },
      })
      expect(resolved.ok).toBe(true)
      expect(resolved.values[0].autofit).toBe(true)
      applyResolvedFields(form, resolved.values)

      expect(form.getTextField(TEXT_FIELD).getText()).toBe('Jane Homeowner')
      expect(form.getCheckBox(CHECK_FIELD).isChecked()).toBe(true)
      assertDaFontRegisteredInAppearance(doc, form.getTextField(TEXT_FIELD))

      var roundTrip = await PDFDocument.load(await doc.save())
      var reloaded = roundTrip.getForm().getTextField(TEXT_FIELD)
      expect(reloaded.getText()).toBe('Jane Homeowner')
      assertDaFontRegisteredInAppearance(roundTrip, reloaded, { requireResolvedFont: true })
      expect(roundTrip.getForm().getCheckBox(CHECK_FIELD).isChecked()).toBe(true)
    })

    test('autofit without an existing /DA still registers a real font and round-trips', async function () {
      var pdfBytes = await buildPilotPdf()
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      var textField = form.getTextField(TEXT_FIELD)
      textField.acroField.dict.delete(PDFName.of('DA'))
      expect(textField.acroField.getDefaultAppearance()).toBeFalsy()
      expect(function () {
        textField.setFontSize(0)
      }).toThrow(/\/DA|Tf operator/)

      var parsed = parseCanonicalFieldMap(
        canonicalMap([validTextField({ required: true, autofit: true, maxChars: 80 })])
      )
      var resolved = resolveFieldValues(parsed, { job: { owner_name: 'Jane Homeowner' } })
      expect(resolved.values[0].autofit).toBe(true)
      applyResolvedFields(form, resolved.values)

      expect(form.getTextField(TEXT_FIELD).getText()).toBe('Jane Homeowner')
      assertDaFontRegisteredInAppearance(doc, form.getTextField(TEXT_FIELD))

      var roundTrip = await PDFDocument.load(await doc.save())
      var reloaded = roundTrip.getForm().getTextField(TEXT_FIELD)
      expect(reloaded.getText()).toBe('Jane Homeowner')
      assertDaFontRegisteredInAppearance(roundTrip, reloaded, { requireResolvedFont: true })
    })

    test('fails closed on an unexpected apply type without using the parser', async function () {
      var pdfBytes = await buildPilotPdf()
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      expectConfigError(function () {
        applyResolvedFields(form, [
          {
            pdfField: TEXT_FIELD,
            type: 'dropdown',
            shouldApply: true,
            hasValue: true,
            value: 'x',
          },
        ])
      }, 'unsupported_type')
    })

    test('optional missing checkbox does not uncheck an existing checked field', async function () {
      var pdfBytes = await buildPilotPdf()
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      form.getCheckBox(CHECK_FIELD).check()
      expect(form.getCheckBox(CHECK_FIELD).isChecked()).toBe(true)

      var parsed = parseCanonicalFieldMap(
        canonicalMap([validCheckboxField({ required: false })])
      )
      var resolved = resolveFieldValues(parsed, { job: {} })
      expect(resolved.ok).toBe(true)
      expect(resolved.values[0].shouldApply).toBe(false)
      applyResolvedFields(form, resolved.values)
      expect(form.getCheckBox(CHECK_FIELD).isChecked()).toBe(true)
    })

    test('explicit false checkbox value does uncheck', async function () {
      var pdfBytes = await buildPilotPdf()
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      form.getCheckBox(CHECK_FIELD).check()

      var parsed = parseCanonicalFieldMap(
        canonicalMap([validCheckboxField({ required: false })])
      )
      var resolved = resolveFieldValues(parsed, { job: { property_type: false } })
      expect(resolved.values[0].shouldApply).toBe(true)
      expect(resolved.values[0].value).toBe(false)
      applyResolvedFields(form, resolved.values)
      expect(form.getCheckBox(CHECK_FIELD).isChecked()).toBe(false)
    })

    test('required missing text is not written', async function () {
      var pdfBytes = await buildPilotPdf()
      var doc = await PDFDocument.load(pdfBytes)
      var form = doc.getForm()
      var parsed = parseCanonicalFieldMap(canonicalMap([validTextField({ required: true })]))
      var resolved = resolveFieldValues(parsed, { job: {} })
      applyResolvedFields(form, resolved.values)
      expect(form.getTextField(TEXT_FIELD).getText() || '').toBe('')
    })
  })

  test('packetConfigInvalidError is non-retryable', function () {
    var err = packetConfigInvalidError('boom', [])
    expect(err.errorCode).toBe('packet_config_invalid')
    expect(err.nonRetryable).toBe(true)
  })
})

describe('packet-relevant company field-map columns', function () {
  const {
    ALLOWED_SOURCE_PATHS,
    PACKET_RELEVANT_COMPANY_COLUMNS,
    packetRelevantCompanyFieldsChanged,
  } = require('../../lib/permits/packet-field-map.js')

  test('columns are derived from the field-map allowlist, including virtual full_address', function () {
    expect(PACKET_RELEVANT_COMPANY_COLUMNS).toEqual(
      [
        'address',
        'city',
        'dba_name',
        'license_number',
        'name',
        'phone',
        'primary_email',
        'qualifier_license',
        'qualifier_name',
        'state',
        'zip',
      ]
    )
    expect(ALLOWED_SOURCE_PATHS).toContain('company.full_address')
    expect(PACKET_RELEVANT_COMPANY_COLUMNS).not.toContain('full_address')
    expect(PACKET_RELEVANT_COMPANY_COLUMNS).not.toContain('subscription_status')
    expect(PACKET_RELEVANT_COMPANY_COLUMNS).not.toContain('notes')
  })

  test('packetRelevantCompanyFieldsChanged uses the shared allowlist', function () {
    expect(packetRelevantCompanyFieldsChanged({ name: 'Acme' })).toBe(true)
    expect(packetRelevantCompanyFieldsChanged({ license_number: 'CCC1' })).toBe(true)
    expect(packetRelevantCompanyFieldsChanged({ zip: '33601' })).toBe(true)
    expect(packetRelevantCompanyFieldsChanged({ qualifer_name: 'Pat' })).toBe(true)
    expect(packetRelevantCompanyFieldsChanged({ updated_at: '2026-08-20T00:00:00.000Z' })).toBe(false)
    expect(packetRelevantCompanyFieldsChanged({
      subscription_plan: 'pro',
      subscription_status: 'active',
      onboarding_status: 'approved',
      is_active: false,
      notes: 'x',
      review_gates: {},
    })).toBe(false)
  })
})
