// tests/unit/packet-document-type.test.js
'use strict'

const {
  coarseDocumentTypeForGeneratedRole,
  documentTypesForRole,
} = require('../../lib/permits/packet-document-type.js')

describe('packet-document-type mapper', function () {
  test('identity-maps existing canonical roles', function () {
    expect(coarseDocumentTypeForGeneratedRole('owners_affidavit')).toBe('owners_affidavit')
    expect(coarseDocumentTypeForGeneratedRole('notice_of_commencement')).toBe(
      'notice_of_commencement'
    )
    expect(coarseDocumentTypeForGeneratedRole('product_approval')).toBe('product_approval')
  })

  test('maps approved aliases', function () {
    expect(coarseDocumentTypeForGeneratedRole('permit_application')).toBe('permit_application')
    expect(coarseDocumentTypeForGeneratedRole('roofing_affidavit')).toBe('owners_affidavit')
    expect(coarseDocumentTypeForGeneratedRole('noc_recorded')).toBe('notice_of_commencement')
  })

  test('unknown generated role fails closed', function () {
    expect(function () {
      coarseDocumentTypeForGeneratedRole('mystery_form')
    }).toThrow(/unknown generated document_role/)
    try {
      coarseDocumentTypeForGeneratedRole('mystery_form')
    } catch (err) {
      expect(err.errorCode).toBe('packet_config_invalid')
      expect(err.nonRetryable).toBe(true)
      expect(err.problems[0].code).toBe('unknown_generated_role')
    }
  })

  test('legacy role matching uses explicit aliases', function () {
    expect(documentTypesForRole('roofing_affidavit')).toEqual([
      'roofing_affidavit',
      'owners_affidavit',
    ])
    expect(documentTypesForRole('notice_of_commencement')).toContain('noc_uploaded_recorded')
    expect(documentTypesForRole('product_approval')).toEqual(['product_approval'])
  })
})
