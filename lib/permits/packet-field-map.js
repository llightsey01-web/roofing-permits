// lib/permits/packet-field-map.js
// ZIG-17 PR 2: strict, fail-closed adapter/validator for
// ahj_document_requirements.field_map used by future DART-generated
// permit application PDFs.
//
// Canonical shape:
//   { fields: [{ pdfField, source, type, required?, autofit?, maxChars? }] }
//
// Config validity is separate from job-data completeness.
// Does not assemble packets, persist documents, or touch NOC/affidavit helpers.
'use strict'

var { PDFDocument, PDFTextField, PDFCheckBox } = require('pdf-lib')
var { exceedsAutofitCapacity } = require('../pdf-fill/form-fill')

var ERROR_CODE = 'packet_config_invalid'

var CANONICAL_TOP_LEVEL_KEYS = Object.freeze(['fields'])
var CANONICAL_FIELD_KEYS = Object.freeze([
  'pdfField',
  'source',
  'type',
  'required',
  'autofit',
  'maxChars',
])
var ALLOWED_FIELD_TYPES = Object.freeze(['text', 'checkbox'])

var ALLOWED_SOURCE_PATHS = Object.freeze([
  'job.owner_name',
  'job.owner_email',
  'job.owner_phone',
  'job.property_address',
  'job.property_city',
  'job.property_state',
  'job.property_zip',
  'job.property_type',
  'job.parcel_number',
  'job.legal_description',
  'job.scope_of_work',
  'job.roof_type',
  'job.valuation',
  'job.permit_number',
  'job.contractor_name',
  'job.contractor_license',
  'job.qualifier_name',
  'job.qualifier_license',
  'job.material_manufacturer',
  'job.material_model',
  'job.material_approval_num',
  'job.property_full_address',
  'company.name',
  'company.dba_name',
  'company.address',
  'company.city',
  'company.state',
  'company.zip',
  'company.phone',
  'company.primary_email',
  'company.license_number',
  'company.qualifier_name',
  'company.qualifier_license',
  'company.full_address',
])

var ALLOWED_SOURCE_PATH_SET = Object.freeze(
  ALLOWED_SOURCE_PATHS.reduce(function (acc, path) {
    acc[path] = true
    return acc
  }, Object.create(null))
)

var COMPANY_FIELD_ALIASES = Object.freeze({
  qualifer_name: 'qualifier_name',
  qualifer_license: 'qualifier_license',
})

function derivePacketRelevantCompanyColumnSet() {
  var set = Object.create(null)
  ALLOWED_SOURCE_PATHS.forEach(function (source) {
    if (source.indexOf('company.') !== 0) return
    var key = source.slice('company.'.length)
    if (key === 'full_address') {
      set.address = true
      set.city = true
      set.state = true
      set.zip = true
      return
    }
    set[key] = true
  })
  return set
}

var PACKET_RELEVANT_COMPANY_COLUMN_SET = Object.freeze(derivePacketRelevantCompanyColumnSet())
var PACKET_RELEVANT_COMPANY_COLUMNS = Object.freeze(
  Object.keys(PACKET_RELEVANT_COMPANY_COLUMN_SET).sort()
)

function canonicalCompanyColumn(key) {
  if (typeof key !== 'string' || key === '') return null
  if (Object.prototype.hasOwnProperty.call(COMPANY_FIELD_ALIASES, key)) {
    return COMPANY_FIELD_ALIASES[key]
  }
  return key
}

/**
 * True when an updates object includes at least one company column that can
 * appear in ahj_document_requirements.field_map sources.
 * `company.full_address` is virtual and maps to address/city/state/zip.
 * Contractor typo columns alias onto qualifier_*.
 */
function packetRelevantCompanyFieldsChanged(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return false
  var keys = Object.keys(updates)
  for (var i = 0; i < keys.length; i++) {
    var column = canonicalCompanyColumn(keys[i])
    if (column && PACKET_RELEVANT_COMPANY_COLUMN_SET[column] === true) return true
  }
  return false
}

var KIND = Object.freeze({
  OK: 'ok',
  INCOMPLETE: 'incomplete',
  CONFIG: 'config',
})

/**
 * Terminal, non-retryable packet field-map configuration failure.
 * @param {string} reason
 * @param {object[]} [problems]
 */
function packetConfigInvalidError(reason, problems) {
  var detail = reason == null || reason === '' ? 'field_map is missing or invalid' : String(reason)
  return Object.assign(new Error('packet_config_invalid: ' + detail), {
    errorCode: ERROR_CODE,
    nonRetryable: true,
    problems: problems || [],
  })
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0
}

function isBoolean(value) {
  return value === true || value === false
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function ownKeys(obj) {
  return Object.keys(obj)
}

function makeProblem(code, extra) {
  var problem = { code: code }
  if (extra) {
    Object.keys(extra).forEach(function (key) {
      problem[key] = extra[key]
    })
  }
  if (!problem.message) {
    problem.message = code
  }
  return problem
}

function emptyProblemGroups() {
  return { config: [], completeness: [], informational: [] }
}

function emptyResolution(kind) {
  return {
    ok: kind === KIND.OK,
    kind: kind,
    values: [],
    problems: emptyProblemGroups(),
  }
}

/**
 * Parse and strictly validate canonical field_map JSON.
 * Rejects legacy flat maps such as { Owner: 'job.owner_name' }.
 * Throws packet_config_invalid. Does not inspect PDF bytes or job data
 * except for source-path allowlisting (unsupported_source is config).
 *
 * Checkbox `autofit: false` is accepted and normalized away (omitted from
 * the parsed field). `autofit: true` or any `maxChars` on checkbox is invalid.
 *
 * @param {*} fieldMap
 * @returns {{ fields: object[] }}
 */
function parseCanonicalFieldMap(fieldMap) {
  var problems = []

  if (fieldMap == null) {
    throw packetConfigInvalidError('field_map is missing', [
      makeProblem('field_map_missing', { message: 'field_map is missing' }),
    ])
  }

  if (!isPlainObject(fieldMap)) {
    throw packetConfigInvalidError('field_map must be an object with a fields array', [
      makeProblem('field_map_malformed', { message: 'field_map must be a non-array object' }),
    ])
  }

  ownKeys(fieldMap).forEach(function (key) {
    if (CANONICAL_TOP_LEVEL_KEYS.indexOf(key) === -1) {
      problems.push(
        makeProblem('unknown_top_level_key', {
          key: key,
          message: 'unknown top-level field_map key "' + key + '"',
        })
      )
    }
  })

  if (!Object.prototype.hasOwnProperty.call(fieldMap, 'fields')) {
    problems.push(
      makeProblem('fields_not_array', {
        message: 'field_map.fields is required and must be an array',
      })
    )
  } else if (!Array.isArray(fieldMap.fields)) {
    problems.push(
      makeProblem('fields_not_array', {
        message: 'field_map.fields must be an array',
      })
    )
  }

  if (Array.isArray(fieldMap.fields) && fieldMap.fields.length === 0) {
    problems.push(
      makeProblem('fields_empty', {
        message: 'field_map.fields must not be empty',
      })
    )
  }

  if (problems.length) {
    throw packetConfigInvalidError(problems[0].message, problems)
  }

  var seenPdfFields = Object.create(null)
  var parsedFields = []

  fieldMap.fields.forEach(function (entry, index) {
    if (!isPlainObject(entry)) {
      problems.push(
        makeProblem('field_map_malformed', {
          index: index,
          message: 'fields[' + index + '] must be an object',
        })
      )
      return
    }

    ownKeys(entry).forEach(function (key) {
      if (CANONICAL_FIELD_KEYS.indexOf(key) === -1) {
        problems.push(
          makeProblem('unknown_field_key', {
            index: index,
            key: key,
            message: 'fields[' + index + '] has unknown key "' + key + '"',
          })
        )
      }
    })

    if (!isNonEmptyString(entry.pdfField)) {
      problems.push(
        makeProblem('missing_pdf_field', {
          index: index,
          message: 'fields[' + index + '] pdfField must be a non-empty string',
        })
      )
    } else if (Object.prototype.hasOwnProperty.call(seenPdfFields, entry.pdfField)) {
      problems.push(
        makeProblem('duplicate_pdf_field', {
          index: index,
          pdfField: entry.pdfField,
          message: 'duplicate pdfField "' + entry.pdfField + '"',
        })
      )
    } else {
      seenPdfFields[entry.pdfField] = index
    }

    if (!isNonEmptyString(entry.source)) {
      problems.push(
        makeProblem('missing_source', {
          index: index,
          pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
          message: 'fields[' + index + '] source must be a non-empty string',
        })
      )
    } else if (!ALLOWED_SOURCE_PATH_SET[entry.source]) {
      problems.push(
        makeProblem('unsupported_source', {
          index: index,
          pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
          source: entry.source,
          message: 'unsupported source path "' + entry.source + '"',
        })
      )
    }

    if (entry.type !== 'text' && entry.type !== 'checkbox') {
      problems.push(
        makeProblem('unsupported_type', {
          index: index,
          pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
          type: entry.type,
          message:
            'fields[' +
            index +
            '] type must be exactly "text" or "checkbox"',
        })
      )
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'required') && !isBoolean(entry.required)) {
      problems.push(
        makeProblem('invalid_required', {
          index: index,
          pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
          message: 'fields[' + index + '] required must be a boolean when present',
        })
      )
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'autofit') && !isBoolean(entry.autofit)) {
      problems.push(
        makeProblem('invalid_autofit', {
          index: index,
          pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
          message: 'fields[' + index + '] autofit must be a boolean when present',
        })
      )
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'maxChars') && !isPositiveInteger(entry.maxChars)) {
      problems.push(
        makeProblem('invalid_max_chars', {
          index: index,
          pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
          message: 'fields[' + index + '] maxChars must be a positive integer when present',
        })
      )
    }

    if (entry.type === 'text' && entry.autofit === true) {
      if (!Object.prototype.hasOwnProperty.call(entry, 'maxChars')) {
        problems.push(
          makeProblem('autofit_requires_max_chars', {
            index: index,
            pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
            message: 'fields[' + index + '] autofit: true requires maxChars',
          })
        )
      }
    }

    if (entry.type === 'checkbox') {
      if (entry.autofit === true) {
        problems.push(
          makeProblem('checkbox_autofit_not_allowed', {
            index: index,
            pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
            message: 'fields[' + index + '] checkbox cannot set autofit: true',
          })
        )
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'maxChars')) {
        problems.push(
          makeProblem('checkbox_max_chars_not_allowed', {
            index: index,
            pdfField: isNonEmptyString(entry.pdfField) ? entry.pdfField : undefined,
            message: 'fields[' + index + '] checkbox cannot set maxChars',
          })
        )
      }
    }
  })

  if (problems.length) {
    throw packetConfigInvalidError(problems[0].message, problems)
  }

  fieldMap.fields.forEach(function (entry) {
    var parsed = {
      pdfField: entry.pdfField,
      source: entry.source,
      type: entry.type,
      required: entry.required === true,
    }
    if (entry.type === 'text') {
      parsed.autofit = entry.autofit === true
      if (Object.prototype.hasOwnProperty.call(entry, 'maxChars')) {
        parsed.maxChars = entry.maxChars
      }
    }
    // checkbox: autofit:false is accepted above and omitted here (normalized away).
    parsedFields.push(Object.freeze(parsed))
  })

  return Object.freeze({ fields: Object.freeze(parsedFields) })
}

function getFormFieldOrNull(form, name) {
  try {
    return form.getField(name)
  } catch (err) {
    return null
  }
}

function pdfFieldTypeLabel(field) {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field && field.constructor && field.constructor.name) return field.constructor.name
  return 'unknown'
}

/**
 * Validate a parsed canonical field map against an already-loaded pdf-lib form.
 * Uses typed field access (getTextField / getCheckBox) plus class checks.
 * Throws packet_config_invalid.
 *
 * @param {object} form
 * @param {{ fields: object[] }} parsedMap
 */
function validateFieldMapAgainstForm(form, parsedMap) {
  if (!form || typeof form.getField !== 'function') {
    throw packetConfigInvalidError('pdf form is required', [
      makeProblem('pdf_form_missing', { message: 'pdf form is required' }),
    ])
  }
  if (!parsedMap || !Array.isArray(parsedMap.fields)) {
    throw packetConfigInvalidError('parsed field_map is required', [
      makeProblem('field_map_malformed', { message: 'parsed field_map.fields must be an array' }),
    ])
  }

  var problems = []

  parsedMap.fields.forEach(function (entry) {
    var field = getFormFieldOrNull(form, entry.pdfField)
    if (!field) {
      problems.push(
        makeProblem('pdf_field_missing', {
          pdfField: entry.pdfField,
          message: 'configured PDF field "' + entry.pdfField + '" does not exist',
        })
      )
      return
    }

    if (entry.type === 'text') {
      var textOk = field instanceof PDFTextField
      try {
        form.getTextField(entry.pdfField)
      } catch (err) {
        textOk = false
      }
      if (!textOk) {
        problems.push(
          makeProblem('pdf_field_type_mismatch', {
            pdfField: entry.pdfField,
            configuredType: 'text',
            actualType: pdfFieldTypeLabel(field),
            message:
              'configured type "text" does not match PDF field "' +
              entry.pdfField +
              '" (' +
              pdfFieldTypeLabel(field) +
              ')',
          })
        )
      }
      return
    }

    if (entry.type === 'checkbox') {
      var checkOk = field instanceof PDFCheckBox
      try {
        form.getCheckBox(entry.pdfField)
      } catch (err) {
        checkOk = false
      }
      if (!checkOk) {
        problems.push(
          makeProblem('pdf_field_type_mismatch', {
            pdfField: entry.pdfField,
            configuredType: 'checkbox',
            actualType: pdfFieldTypeLabel(field),
            message:
              'configured type "checkbox" does not match PDF field "' +
              entry.pdfField +
              '" (' +
              pdfFieldTypeLabel(field) +
              ')',
          })
        )
      }
    }
  })

  if (problems.length) {
    throw packetConfigInvalidError(problems[0].message, problems)
  }

  return { ok: true, kind: KIND.OK }
}

/**
 * Load PDF bytes and validate the parsed map against real AcroForm fields/types.
 * @param {Buffer|Uint8Array} pdfBytes
 * @param {{ fields: object[] }} parsedMap
 */
async function validateFieldMapAgainstPdf(pdfBytes, parsedMap) {
  if (pdfBytes == null) {
    throw packetConfigInvalidError('pdf bytes are required', [
      makeProblem('pdf_bytes_missing', { message: 'pdf bytes are required' }),
    ])
  }
  var doc
  try {
    doc = await PDFDocument.load(pdfBytes)
  } catch (err) {
    throw packetConfigInvalidError('failed to load PDF form', [
      makeProblem('pdf_load_failed', {
        message: 'failed to load PDF form: ' + (err && err.message ? err.message : 'unknown error'),
      }),
    ])
  }
  return validateFieldMapAgainstForm(doc.getForm(), parsedMap)
}

function isAbsentRaw(raw) {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string' && raw.trim() === '') return true
  return false
}

function composeAddress(street, city, state, zip) {
  // Matches NOC buildFullAddress: "street, city, ST ZIP"
  var cityStateZip = [
    city == null ? '' : String(city).trim(),
    [state == null ? '' : String(state).trim(), zip == null ? '' : String(zip).trim()]
      .filter(function (part) {
        return part !== ''
      })
      .join(' '),
  ]
    .filter(function (part) {
      return part !== ''
    })
    .join(', ')
  var streetPart = street == null ? '' : String(street).trim()
  var line = [streetPart, cityStateZip]
    .filter(function (part) {
      return part !== ''
    })
    .join(', ')
  return line === '' ? undefined : line
}

function readAllowlistedSource(source, context) {
  var ctx = context && typeof context === 'object' ? context : {}
  var job = ctx.job && typeof ctx.job === 'object' ? ctx.job : null
  var company = ctx.company && typeof ctx.company === 'object' ? ctx.company : null

  if (source === 'job.property_full_address') {
    if (!job) return undefined
    return composeAddress(job.property_address, job.property_city, job.property_state, job.property_zip)
  }
  if (source === 'company.full_address') {
    if (!company) return undefined
    return composeAddress(company.address, company.city, company.state, company.zip)
  }

  var parts = String(source).split('.')
  if (parts.length !== 2) return undefined
  var root = parts[0]
  var key = parts[1]
  if (root === 'job') return job ? job[key] : undefined
  if (root === 'company') return company ? company[key] : undefined
  return undefined
}

function normalizeTextValue(raw) {
  if (isAbsentRaw(raw)) {
    return { status: 'absent' }
  }
  if (typeof raw === 'string') {
    return { status: 'present', value: raw }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { status: 'present', value: String(raw) }
  }
  if (typeof raw === 'boolean') {
    return { status: 'present', value: raw ? 'true' : 'false' }
  }
  return { status: 'unsupported' }
}

function normalizeCheckboxValue(raw) {
  if (isAbsentRaw(raw)) {
    return { status: 'absent' }
  }
  if (raw === true || raw === 1) {
    return { status: 'present', value: true }
  }
  if (raw === false || raw === 0) {
    return { status: 'present', value: false }
  }
  if (typeof raw === 'string') {
    var lowered = raw.trim().toLowerCase()
    if (lowered === 'true') return { status: 'present', value: true }
    if (lowered === 'false') return { status: 'present', value: false }
  }
  return { status: 'invalid' }
}

function skippedValue(entry) {
  var resolved = {
    pdfField: entry.pdfField,
    source: entry.source,
    type: entry.type,
    required: entry.required === true,
    hasValue: false,
    shouldApply: false,
    value: null,
  }
  if (entry.type === 'text') {
    resolved.autofit = entry.autofit === true
    if (Object.prototype.hasOwnProperty.call(entry, 'maxChars')) {
      resolved.maxChars = entry.maxChars
    }
  }
  return resolved
}

function presentValue(entry, value) {
  var resolved = skippedValue(entry)
  resolved.hasValue = true
  resolved.shouldApply = true
  resolved.value = value
  return resolved
}

/**
 * Resolve configured source paths from { job, company } context.
 * Config problems (unsupported_source) are distinct from completeness
 * problems (required_source_missing, invalid_checkbox_value, max_chars_exceeded,
 * unsupported_text_value). optional_source_missing is informational only.
 *
 * @param {{ fields: object[] }} parsedMap
 * @param {{ job?: object, company?: object }} context
 */
function resolveFieldValues(parsedMap, context) {
  if (!parsedMap || !Array.isArray(parsedMap.fields)) {
    var malformed = emptyResolution(KIND.CONFIG)
    malformed.problems.config.push(
      makeProblem('field_map_malformed', { message: 'parsed field_map.fields must be an array' })
    )
    return malformed
  }

  var problems = emptyProblemGroups()
  var values = []

  parsedMap.fields.forEach(function (entry) {
    if (!entry || !ALLOWED_SOURCE_PATH_SET[entry.source]) {
      problems.config.push(
        makeProblem('unsupported_source', {
          pdfField: entry && entry.pdfField,
          source: entry && entry.source,
          message: 'unsupported source path "' + (entry && entry.source) + '"',
        })
      )
      values.push(skippedValue(entry || {}))
      return
    }

    var raw = readAllowlistedSource(entry.source, context)

    if (entry.type === 'checkbox') {
      var checkNorm = normalizeCheckboxValue(raw)
      if (checkNorm.status === 'absent') {
        values.push(skippedValue(entry))
        if (entry.required === true) {
          problems.completeness.push(
            makeProblem('required_source_missing', {
              pdfField: entry.pdfField,
              source: entry.source,
              message: 'required source "' + entry.source + '" is missing',
            })
          )
        } else {
          problems.informational.push(
            makeProblem('optional_source_missing', {
              pdfField: entry.pdfField,
              source: entry.source,
              message: 'optional source "' + entry.source + '" is missing',
            })
          )
        }
        return
      }
      if (checkNorm.status === 'invalid') {
        values.push(skippedValue(entry))
        problems.completeness.push(
          makeProblem('invalid_checkbox_value', {
            pdfField: entry.pdfField,
            source: entry.source,
            message: 'source "' + entry.source + '" is not an explicit checkbox boolean',
          })
        )
        return
      }
      values.push(presentValue(entry, checkNorm.value))
      return
    }

    var textNorm = normalizeTextValue(raw)
    if (textNorm.status === 'unsupported') {
      values.push(skippedValue(entry))
      problems.completeness.push(
        makeProblem('unsupported_text_value', {
          pdfField: entry.pdfField,
          source: entry.source,
          message: 'source "' + entry.source + '" is not a string, number, or boolean',
        })
      )
      return
    }
    if (textNorm.status === 'absent') {
      values.push(skippedValue(entry))
      if (entry.required === true) {
        problems.completeness.push(
          makeProblem('required_source_missing', {
            pdfField: entry.pdfField,
            source: entry.source,
            message: 'required source "' + entry.source + '" is missing',
          })
        )
      } else {
        problems.informational.push(
          makeProblem('optional_source_missing', {
            pdfField: entry.pdfField,
            source: entry.source,
            message: 'optional source "' + entry.source + '" is missing',
          })
        )
      }
      return
    }

    if (
      Object.prototype.hasOwnProperty.call(entry, 'maxChars') &&
      exceedsAutofitCapacity(textNorm.value, entry.maxChars)
    ) {
      var overflow = skippedValue(entry)
      overflow.hasValue = true
      overflow.value = textNorm.value
      overflow.shouldApply = false
      values.push(overflow)
      problems.completeness.push(
        makeProblem('max_chars_exceeded', {
          pdfField: entry.pdfField,
          source: entry.source,
          maxChars: entry.maxChars,
          length: textNorm.value.length,
          message:
            'source "' +
            entry.source +
            '" exceeds maxChars ' +
            entry.maxChars,
        })
      )
      return
    }

    values.push(presentValue(entry, textNorm.value))
  })

  var kind = KIND.OK
  if (problems.config.length) kind = KIND.CONFIG
  else if (problems.completeness.length) kind = KIND.INCOMPLETE

  return {
    ok: kind === KIND.OK,
    kind: kind,
    values: values,
    problems: problems,
  }
}

function isMissingDaOrTfError(err) {
  if (!err) return false
  if (err.name === 'MissingDAEntryError' || err.name === 'MissingTfOperatorError') return true
  if (typeof err.message !== 'string') return false
  return err.message.indexOf('/DA') !== -1 || err.message.indexOf('Tf operator') !== -1
}

/**
 * Request pdf-lib autofit (font size 0) through the public setFontSize API.
 * If the field has no /DA or Tf operator, do not invent a font name. Missing
 * size is treated as autofit later by updateFieldAppearances / layoutSinglelineText.
 */
function applyAutofitFontSize(field) {
  try {
    field.setFontSize(0)
  } catch (err) {
    if (!isMissingDaOrTfError(err)) throw err
  }
}

function updateFormAppearances(form) {
  if (typeof form.getDefaultFont !== 'function' || typeof form.updateFieldAppearances !== 'function') {
    throw packetConfigInvalidError('pdf form cannot update field appearances', [
      makeProblem('pdf_form_missing', {
        message: 'pdf form cannot update field appearances',
      }),
    ])
  }
  // PDFForm.getDefaultFont() calls PDFDocument.embedStandardFont(Helvetica).
  // updateFieldAppearances registers that font on appearance-stream Resources.
  form.updateFieldAppearances(form.getDefaultFont())
}

function strictSetText(form, pdfField, value, autofit) {
  var field
  try {
    field = form.getTextField(pdfField)
  } catch (err) {
    throw packetConfigInvalidError('PDF text field "' + pdfField + '" is missing or not a text field', [
      makeProblem('pdf_field_type_mismatch', {
        pdfField: pdfField,
        configuredType: 'text',
        message: 'PDF text field "' + pdfField + '" is missing or not a text field',
      }),
    ])
  }
  if (autofit === true) {
    applyAutofitFontSize(field)
  }
  field.setText(String(value))
}

function strictSetCheckbox(form, pdfField, checked) {
  var field
  try {
    field = form.getCheckBox(pdfField)
  } catch (err) {
    throw packetConfigInvalidError(
      'PDF checkbox "' + pdfField + '" is missing or not a checkbox',
      [
        makeProblem('pdf_field_type_mismatch', {
          pdfField: pdfField,
          configuredType: 'checkbox',
          message: 'PDF checkbox "' + pdfField + '" is missing or not a checkbox',
        }),
      ]
    )
  }
  if (checked === true) field.check()
  else field.uncheck()
}

/**
 * Apply already-resolved values to a pdf-lib form. Skips entries where
 * shouldApply is not true. Does not flatten, assemble, or persist.
 *
 * @param {object} form
 * @param {object[]} resolvedValues
 */
function applyResolvedFields(form, resolvedValues) {
  if (!form || typeof form.getTextField !== 'function') {
    throw packetConfigInvalidError('pdf form is required', [
      makeProblem('pdf_form_missing', { message: 'pdf form is required' }),
    ])
  }

  ;(resolvedValues || []).forEach(function (entry) {
    if (!entry || entry.shouldApply !== true || entry.hasValue !== true) return
    if (entry.type === 'checkbox') {
      strictSetCheckbox(form, entry.pdfField, entry.value === true)
      return
    }
    if (entry.type === 'text') {
      strictSetText(form, entry.pdfField, entry.value, entry.autofit === true)
      return
    }
    throw packetConfigInvalidError(
      'unsupported field type "' + String(entry.type) + '"',
      [
        makeProblem('unsupported_type', {
          pdfField: entry.pdfField,
          type: entry.type,
          message: 'unsupported field type "' + String(entry.type) + '"',
        }),
      ]
    )
  })

  updateFormAppearances(form)
}

module.exports = {
  ERROR_CODE: ERROR_CODE,
  KIND: KIND,
  CANONICAL_TOP_LEVEL_KEYS: CANONICAL_TOP_LEVEL_KEYS,
  CANONICAL_FIELD_KEYS: CANONICAL_FIELD_KEYS,
  ALLOWED_FIELD_TYPES: ALLOWED_FIELD_TYPES,
  ALLOWED_SOURCE_PATHS: ALLOWED_SOURCE_PATHS,
  PACKET_RELEVANT_COMPANY_COLUMNS: PACKET_RELEVANT_COMPANY_COLUMNS,
  COMPANY_FIELD_ALIASES: COMPANY_FIELD_ALIASES,
  packetRelevantCompanyFieldsChanged: packetRelevantCompanyFieldsChanged,
  packetConfigInvalidError: packetConfigInvalidError,
  parseCanonicalFieldMap: parseCanonicalFieldMap,
  validateFieldMapAgainstForm: validateFieldMapAgainstForm,
  validateFieldMapAgainstPdf: validateFieldMapAgainstPdf,
  resolveFieldValues: resolveFieldValues,
  applyResolvedFields: applyResolvedFields,
}
