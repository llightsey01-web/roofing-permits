'use strict'

/**
 * Canonical AcroForm field names for templates/noc-template.pdf
 * (notice-of-commencement-2023 / Florida §713.13).
 *
 * Production NOC generation and unit tests must import these constants
 * instead of hardcoding Acrobat field-name strings.
 *
 * Only fields currently referenced by fillNocForm are listed.
 */

var NOC_FIELDS = Object.freeze({
  PERMIT_NUMBER: 'Permit No',
  TAX_FOLIO_NUMBER: 'Tax Folio No',
  LEGAL_DESCRIPTION: '1 Description of property legal description of property',
  STREET_ADDRESS: 'a Street job Address',
  GENERAL_DESCRIPTION: '2 General description of improvements',
  OWNER_NAME_AND_ADDRESS: 'a Name and address',
  OWNER_INTEREST: 'b Interest in property',
  CONTRACTOR_NAME_AND_ADDRESS: 'a Name and address_2',
  CONTRACTOR_PHONE: 'b Phone number',
  // Acrobat naming: online notarization checkbox is "physical presence or";
  // physical-presence checkbox is the longer "acknowledged before me…" name.
  NOTARY_PHYSICAL_PRESENCE_CHECKBOX: 'The foregoing instrument was acknowledged before me by means of',
  NOTARY_ONLINE_CHECKBOX: 'physical presence or',
})

/** Text fields written/read by production NOC fill (excludes checkboxes). */
var NOC_TEXT_FIELDS = Object.freeze([
  NOC_FIELDS.PERMIT_NUMBER,
  NOC_FIELDS.TAX_FOLIO_NUMBER,
  NOC_FIELDS.LEGAL_DESCRIPTION,
  NOC_FIELDS.STREET_ADDRESS,
  NOC_FIELDS.GENERAL_DESCRIPTION,
  NOC_FIELDS.OWNER_NAME_AND_ADDRESS,
  NOC_FIELDS.OWNER_INTEREST,
  NOC_FIELDS.CONTRACTOR_NAME_AND_ADDRESS,
  NOC_FIELDS.CONTRACTOR_PHONE,
])

/** Every PDF field name currently referenced by fillNocForm. */
var NOC_PRODUCTION_FIELD_NAMES = Object.freeze(
  Object.keys(NOC_FIELDS).map(function (key) {
    return NOC_FIELDS[key]
  })
)

module.exports = {
  NOC_FIELDS: NOC_FIELDS,
  NOC_TEXT_FIELDS: NOC_TEXT_FIELDS,
  NOC_PRODUCTION_FIELD_NAMES: NOC_PRODUCTION_FIELD_NAMES,
}
