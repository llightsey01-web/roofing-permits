'use strict'

const {
  buildDocumentFolder,
  requiredDocsPresent,
  findDocumentForRole,
  isIssuedStatus,
} = require('../../lib/documents/document-folder')
const { generateAffidavit } = require('../../lib/documents/affidavit-generate')
const { PDFDocument } = require('pdf-lib')
const { maybeMergeCombinedPacket } = require('../../lib/documents/packet-merge')
const { safeSetFieldAutoFit, detectAutofitOverflows } = require('../../lib/pdf-fill/form-fill')

describe('document folder', function () {
  const requirements = [
    { id: '1', document_role: 'noc_recorded', display_name: 'Recorded NOC', required: true, requires_permit_number: false, sort_order: 1 },
    { id: '2', document_role: 'product_approval', display_name: 'Product Approval', required: true, requires_permit_number: false, sort_order: 2 },
    { id: '3', document_role: 'owners_affidavit', display_name: 'Owner Affidavit', required: true, requires_permit_number: true, sort_order: 3 },
    { id: '4', document_role: 'approved_permit', display_name: 'Approved Permit', required: true, requires_permit_number: false, sort_order: 4 },
    { id: '5', document_role: 'site_plan', display_name: 'Site Plan', required: false, requires_permit_number: false, sort_order: 5 },
  ]

  test('pending affidavit without permit number', function () {
    const folder = buildDocumentFolder(requirements, [
      { id: 'a', document_type: 'noc_uploaded_recorded', file_path: 'a.pdf' },
      { id: 'b', document_type: 'product_approval', file_path: 'b.pdf' },
    ], { permit_number: null })

    const affidavit = folder.find(function (r) { return r.role === 'owners_affidavit' })
    expect(affidavit.status).toBe('pending')
    expect(affidavit.pendingReason).toMatch(/after permit submission/i)

    const site = folder.find(function (r) { return r.role === 'site_plan' })
    expect(site.status).toBe('not_required')
  })

  test('available when document present', function () {
    const folder = buildDocumentFolder(requirements, [
      { id: 'a', document_type: 'notice_of_commencement', file_path: 'a.pdf', file_name: 'noc.pdf' },
    ], { permit_number: 'BT-1' })
    const noc = folder.find(function (r) { return r.role === 'noc_recorded' })
    expect(noc.status).toBe('available')
    expect(noc.downloadKey).toBe('doc_a')
  })

  test('requiredDocsPresent false when missing', function () {
    expect(requiredDocsPresent(requirements, [
      { document_type: 'product_approval' },
    ])).toBe(false)
  })

  test('requiredDocsPresent true when all required present', function () {
    expect(requiredDocsPresent(requirements, [
      { document_type: 'noc_uploaded_recorded' },
      { document_type: 'product_approval' },
      { document_type: 'owners_affidavit' },
      { document_type: 'approved_permit' },
    ])).toBe(true)
  })

  test('isIssuedStatus', function () {
    expect(isIssuedStatus('permit_issued')).toBe(true)
    expect(isIssuedStatus('approved')).toBe(true)
    expect(isIssuedStatus('submitted')).toBe(false)
  })
})

describe('affidavit generate gating', function () {
  test('returns pending when requires_permit_number and no permit_number', async function () {
    const result = await generateAffidavit({
      job: { id: 'job-1', permit_number: null },
      requirement: {
        document_role: 'owners_affidavit',
        requires_permit_number: true,
        template_storage_path: 'templates/x.pdf',
      },
    })
    expect(result.status).toBe('pending')
  })

  test('returns not_configured when template missing', async function () {
    const result = await generateAffidavit({
      job: { id: 'job-1', permit_number: 'BT-1' },
      requirement: {
        document_role: 'owners_affidavit',
        requires_permit_number: true,
        template_storage_path: null,
      },
    })
    expect(result.status).toBe('not_configured')
  })
})

describe('shared pdf-fill', function () {
  test('detectAutofitOverflows', function () {
    const overflows = detectAutofitOverflows([
      { field: 'a', value: 'short', maxChars: 10 },
      { field: 'b', value: 'this is way too long', maxChars: 5, message: 'too long' },
    ])
    expect(overflows).toHaveLength(1)
    expect(overflows[0].field).toBe('b')
  })

  test('safeSetFieldAutoFit does not throw on valid field', async function () {
    const doc = await PDFDocument.create()
    doc.addPage()
    const form = doc.getForm()
    form.createTextField('Name')
    expect(function () {
      safeSetFieldAutoFit(form, 'Name', 'Acme Roofing')
    }).not.toThrow()
  })
})

describe('combined packet merge gating', function () {
  function mockSupabase(opts) {
    var documents = opts.documents || []
    var requirements = opts.requirements || []
    var downloads = opts.downloads || {}
    return {
      from: function (table) {
        if (table === 'ahj_document_requirements') {
          return {
            select: function () {
              return {
                eq: function () {
                  return {
                    order: async function () {
                      return { data: requirements, error: null }
                    },
                  }
                },
              }
            },
          }
        }
        if (table === 'job_documents') {
          return {
            select: function () {
              return {
                eq: async function () {
                  return { data: documents, error: null }
                },
              }
            },
            insert: function () {
              return {
                select: function () {
                  return {
                    single: async function () {
                      return { data: { id: 'combined-1' }, error: null }
                    },
                  }
                },
              }
            },
            update: function () {
              return { eq: async function () { return { error: null } } }
            },
          }
        }
        return {}
      },
      storage: {
        from: function () {
          return {
            download: async function (path) {
              if (!downloads[path]) return { data: null, error: { message: 'missing ' + path } }
              return {
                data: {
                  arrayBuffer: async function () { return downloads[path] },
                },
                error: null,
              }
            },
            upload: async function () {
              return { error: null }
            },
          }
        },
      },
    }
  }

  async function tinyPdfBytes() {
    const doc = await PDFDocument.create()
    doc.addPage()
    return Buffer.from(await doc.save())
  }

  test('does not merge when status not issued', async function () {
    const result = await maybeMergeCombinedPacket(mockSupabase({}), {
      id: 'j1',
      job_status: 'submitted',
      ahj_id: 'ahj1',
    })
    expect(result.merged).toBe(false)
    expect(result.reason).toMatch(/not issued/i)
  })

  test('does not merge when required doc missing', async function () {
    const pdf = await tinyPdfBytes()
    const requirements = [
      { document_role: 'noc_recorded', required: true, sort_order: 1 },
      { document_role: 'approved_permit', required: true, sort_order: 2 },
    ]
    const result = await maybeMergeCombinedPacket(
      mockSupabase({
        requirements: requirements,
        documents: [{ document_type: 'noc_uploaded_recorded', file_path: 'noc.pdf' }],
        downloads: { 'noc.pdf': pdf },
      }),
      { id: 'j1', job_status: 'permit_issued', ahj_id: 'ahj1' },
      { requirements: requirements }
    )
    expect(result.merged).toBe(false)
    expect(result.reason).toMatch(/missing/i)
  })

  test('merges when all required docs present and issued', async function () {
    const pdf = await tinyPdfBytes()
    const requirements = [
      { document_role: 'noc_recorded', required: true, sort_order: 1 },
      { document_role: 'approved_permit', required: true, sort_order: 2 },
    ]
    const documents = [
      { id: '1', document_type: 'noc_uploaded_recorded', file_path: 'noc.pdf' },
      { id: '2', document_type: 'approved_permit', file_path: 'permit.pdf' },
    ]
    const result = await maybeMergeCombinedPacket(
      mockSupabase({
        requirements: requirements,
        documents: documents,
        downloads: { 'noc.pdf': pdf, 'permit.pdf': pdf },
      }),
      { id: 'j1', job_status: 'permit_issued', ahj_id: 'ahj1' },
      { requirements: requirements, force: true }
    )
    expect(result.merged).toBe(true)
    expect(result.filePath).toMatch(/combined-packet\.pdf$/)
  })
})
