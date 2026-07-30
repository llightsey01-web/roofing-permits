/**
 * Shared PDF AcroForm fill helpers (extracted from NOC pipeline).
 * Used by NOC and future affidavit generation.
 */
'use strict'

/**
 * Fill a single-line AcroForm text field with pdf-lib auto-shrink.
 * setFontSize(0) sets /Tf 0 so flatten() runs layoutSinglelineText auto-fit.
 */
function safeSetFieldAutoFit(form, fieldName, value) {
  if (value == null || value === '') return
  try {
    var field = form.getTextField(fieldName)
    field.setFontSize(0)
    field.setText(String(value))
  } catch (e) {}
}

function safeSetField(form, fieldName, value) {
  if (value == null || value === '') return
  try {
    form.getTextField(fieldName).setText(String(value))
  } catch (e) {}
}

function safeCheck(form, fieldName) {
  try {
    form.getCheckBox(fieldName).check()
  } catch (e) {}
}

function safeUncheck(form, fieldName) {
  try {
    form.getCheckBox(fieldName).uncheck()
  } catch (e) {}
}

function exceedsAutofitCapacity(value, maxChars) {
  if (value == null || value === '') return false
  return String(value).length > maxChars
}

/**
 * Generic overflow detection for any template field map.
 * @param {Array<{ field: string, value: any, maxChars: number, message?: string }>} candidates
 * @returns {Array<{ field: string, maxChars: number, length: number, message: string }>}
 */
function detectAutofitOverflows(candidates) {
  return (candidates || []).filter(function (c) {
    return exceedsAutofitCapacity(c.value, c.maxChars)
  }).map(function (c) {
    return {
      field: c.field,
      maxChars: c.maxChars,
      length: String(c.value).length,
      message: c.message || (c.field + ' exceeds template capacity'),
    }
  })
}

/**
 * Apply a field_map to an AcroForm.
 * field_map entries: { pdfField, value, autofit?: boolean }
 * or { pdfField, source } with values provided separately via resolveValue(source).
 */
function fillFormFromMap(form, fieldEntries, options) {
  var opts = options || {}
  var resolveValue = typeof opts.resolveValue === 'function' ? opts.resolveValue : function (v) { return v }
  ;(fieldEntries || []).forEach(function (entry) {
    if (!entry || !entry.pdfField) return
    var value = entry.value != null ? entry.value : resolveValue(entry.source)
    if (entry.autofit) safeSetFieldAutoFit(form, entry.pdfField, value)
    else safeSetField(form, entry.pdfField, value)
  })
}

module.exports = {
  safeSetField,
  safeSetFieldAutoFit,
  safeCheck,
  safeUncheck,
  exceedsAutofitCapacity,
  detectAutofitOverflows,
  fillFormFromMap,
}
