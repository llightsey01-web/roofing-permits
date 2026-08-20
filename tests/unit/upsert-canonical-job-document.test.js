// tests/unit/upsert-canonical-job-document.test.js
'use strict'

jest.mock('../../lib/permits/packet-freshness.js', function () {
  return {
    evaluatePacketFreshnessAfterMutation: jest.fn(function (jobId, supabase, options) {
      if (options && options.skipPacketFreshness === true) {
        return Promise.resolve({ ok: true, skipped: true })
      }
      return Promise.resolve({ ok: true, skipped: false })
    }),
    STORAGE_FAILED: 'packet_freshness_storage_failed',
  }
})

const fs = require('fs')
const path = require('path')
const {
  upsertCanonicalJobDocument,
  persistGeneratedNocDocument,
  persistNotarizedNocDocument,
  persistRecordedNocDocument,
  persistUploadedNocDocument,
  isUniqueViolation,
} = require('../../lib/documents/upsert-canonical-job-document')
const freshness = require('../../lib/permits/packet-freshness')

function createClient(opts) {
  var options = opts || {}
  var existingRows = options.existingRows !== undefined ? options.existingRows.slice() : []
  var insertError = options.insertError || null
  var winningRowsAfterUniqueInsert = options.winningRowsAfterUniqueInsert || null
  var calls = {
    selects: 0,
    inserts: 0,
    updates: 0,
    lastInsert: null,
    lastUpdate: null,
  }

  return {
    calls: calls,
    from: function (table) {
      expect(table).toBe('job_documents')
      return {
        select: function () {
          return {
            eq: function () {
              return {
                eq: function () {
                  return {
                    order: async function () {
                      calls.selects += 1
                      if (options.lookupError && calls.selects === 1) {
                        return { data: null, error: options.lookupError }
                      }
                      return { data: existingRows.slice(), error: null }
                    },
                  }
                },
              }
            },
          }
        },
        insert: function (row) {
          calls.inserts += 1
          calls.lastInsert = row
          return {
            select: function () {
              return {
                single: async function () {
                  if (insertError) {
                    if (winningRowsAfterUniqueInsert) {
                      existingRows = winningRowsAfterUniqueInsert.slice()
                    }
                    return { data: null, error: insertError }
                  }
                  existingRows = [{ id: 'doc-new' }]
                  return { data: { id: 'doc-new' }, error: null }
                },
              }
            },
          }
        },
        update: function (payload) {
          calls.updates += 1
          calls.lastUpdate = payload
          return {
            eq: function () {
              return {
                eq: async function () {
                  return { error: options.updateError || null }
                },
              }
            },
          }
        },
      }
    },
  }
}

describe('upsertCanonicalJobDocument', function () {
  beforeEach(function () {
    freshness.evaluatePacketFreshnessAfterMutation.mockClear()
  })
  test('programmer error when supabase or identity fields are missing', async function () {
    await expect(upsertCanonicalJobDocument(null, {})).rejects.toMatchObject({
      errorCode: 'canonical_document_programmer_error',
    })
    var client = createClient()
    await expect(
      upsertCanonicalJobDocument(client, { jobId: 'j1', documentType: 'other', fileName: 'a.pdf', filePath: 'p' })
    ).rejects.toMatchObject({ errorCode: 'canonical_document_programmer_error' })
  })

  test('inserts when no existing row for job + type', async function () {
    var client = createClient({ existingRows: [] })
    var result = await persistGeneratedNocDocument(
      client,
      'job-1',
      'jobs/job-1/generated/noc-filled.pdf',
      1200
    )
    expect(result.reused).toBe(false)
    expect(client.calls.inserts).toBe(1)
    expect(client.calls.updates).toBe(0)
    expect(client.calls.lastInsert).toMatchObject({
      job_id: 'job-1',
      document_type: 'notice_of_commencement',
      file_name: 'noc-filled.pdf',
      file_path: 'jobs/job-1/generated/noc-filled.pdf',
      file_size_bytes: 1200,
      mime_type: 'application/pdf',
    })
    expect(client.calls.lastInsert.ahj_document_requirement_id).toBeUndefined()
  })

  test('updates existing row instead of inserting another', async function () {
    var client = createClient({ existingRows: [{ id: 'doc-1' }] })
    var result = await persistGeneratedNocDocument(
      client,
      'job-1',
      'jobs/job-1/generated/noc-filled.pdf',
      1300
    )
    expect(result.reused).toBe(true)
    expect(result.id).toBe('doc-1')
    expect(client.calls.inserts).toBe(0)
    expect(client.calls.updates).toBe(1)
    expect(client.calls.lastUpdate.file_path).toBe('jobs/job-1/generated/noc-filled.pdf')
    expect(client.calls.lastUpdate.file_size_bytes).toBe(1300)
  })

  test('isUniqueViolation recognizes Postgres 23505 only as uniqueness', function () {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "job_documents_job_id_noc_document_type_uidx"' })).toBe(true)
    expect(isUniqueViolation({
      code: '409',
      message: 'duplicate key value violates unique constraint "job_documents_job_id_noc_document_type_uidx"',
    })).toBe(true)
    expect(isUniqueViolation({ code: '23503', message: 'insert or update on table violates foreign key constraint' })).toBe(false)
    expect(isUniqueViolation({ code: 'PGRST204', message: 'Could not find the table' })).toBe(false)
    expect(isUniqueViolation({ message: 'boom' })).toBe(false)
  })

  test('simulated unique_violation triggers re-query and reuses one row', async function () {
    var client = createClient({
      existingRows: [],
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "job_documents_job_id_noc_document_type_uidx"',
      },
      winningRowsAfterUniqueInsert: [{ id: 'doc-raced' }],
    })

    var result = await persistNotarizedNocDocument(
      client,
      'job-2',
      'jobs/job-2/notarized/noc-notarized.pdf',
      900
    )
    expect(result.id).toBe('doc-raced')
    expect(result.reused).toBe(true)
    expect(result.raced).toBe(true)
    expect(result.alignedRows).toBe(1)
    expect(client.calls.selects).toBe(2)
    expect(client.calls.inserts).toBe(1)
    expect(client.calls.updates).toBe(1)
    expect(client.calls.lastUpdate.file_path).toBe('jobs/job-2/notarized/noc-notarized.pdf')
  })

  test('non-unique insert errors do not enter the reuse path', async function () {
    var client = createClient({
      existingRows: [],
      insertError: { code: '23503', message: 'insert or update on table violates foreign key constraint' },
    })
    await expect(
      persistGeneratedNocDocument(client, 'job-3', 'jobs/job-3/generated/noc-filled.pdf', 10)
    ).rejects.toMatchObject({
      errorCode: 'canonical_document_write_failed',
      message: expect.stringMatching(/insert failed/),
    })
    expect(client.calls.updates).toBe(0)
  })

  test('persist wrappers use existing enum labels', async function () {
    var client = createClient({ existingRows: [] })
    await persistNotarizedNocDocument(client, 'j', 'jobs/j/notarized/noc-notarized.pdf', 1)
    expect(client.calls.lastInsert.document_type).toBe('noc_uploaded_notarized')

    client = createClient({ existingRows: [] })
    await persistRecordedNocDocument(client, 'j', 'jobs/j/recorded/noc-recorded.pdf')
    expect(client.calls.lastInsert.document_type).toBe('noc_uploaded_recorded')
    expect(client.calls.lastInsert.file_size_bytes).toBeUndefined()

    client = createClient({ existingRows: [] })
    await persistUploadedNocDocument(client, 'j', 'signed', 'upload.pdf', 'jobs/j/uploaded/noc-uploaded.pdf', 10, 'user-1')
    expect(client.calls.lastInsert.document_type).toBe('noc_uploaded_signed')
    expect(client.calls.lastInsert.uploaded_by).toBe('user-1')
  })

  test('lookup failure is visible, not swallowed', async function () {
    var client = createClient({ lookupError: { message: 'boom' } })
    await expect(
      persistGeneratedNocDocument(client, 'j', 'jobs/j/generated/noc-filled.pdf', 1)
    ).rejects.toMatchObject({
      errorCode: 'canonical_document_write_failed',
      message: expect.stringMatching(/lookup failed/),
    })
  })

  test('normal ready-state external upsert invokes evaluator', async function () {
    var client = createClient({ existingRows: [] })
    await persistGeneratedNocDocument(client, 'job-1', 'jobs/job-1/generated/noc-filled.pdf', 10)
    expect(freshness.evaluatePacketFreshnessAfterMutation).toHaveBeenCalledTimes(1)
    expect(freshness.evaluatePacketFreshnessAfterMutation.mock.calls[0][0]).toBe('job-1')
    expect(freshness.evaluatePacketFreshnessAfterMutation.mock.calls[0][2]).toEqual({
      skipPacketFreshness: false,
    })
  })

  test('suppressed internal write does not evaluate live freshness', async function () {
    var client = createClient({ existingRows: [] })
    var result = await persistGeneratedNocDocument(
      client,
      'job-1',
      'jobs/job-1/generated/noc-filled.pdf',
      10,
      { skipPacketFreshness: true }
    )
    expect(result.id).toBe('doc-new')
    expect(result.freshness).toEqual({ ok: true, skipped: true })
    expect(freshness.evaluatePacketFreshnessAfterMutation).toHaveBeenCalledWith(
      'job-1',
      client,
      { skipPacketFreshness: true }
    )
  })

  test('transient freshness failure after successful persist does not fail the write', async function () {
    freshness.evaluatePacketFreshnessAfterMutation.mockResolvedValueOnce({
      ok: false,
      skipped: false,
      retryable: true,
      errorCode: 'packet_freshness_storage_failed',
    })
    var client = createClient({ existingRows: [] })
    var result = await persistGeneratedNocDocument(
      client,
      'job-1',
      'jobs/job-1/generated/noc-filled.pdf',
      10
    )
    expect(result.id).toBe('doc-new')
    expect(result.reused).toBe(false)
    expect(result.freshness.retryable).toBe(true)
    expect(client.calls.inserts).toBe(1)
  })
})

describe('ZIG-17 PR 1 writers do not invent enum labels', function () {
  test('pipeline / proof / erecord persist existing types only', function () {
    var noc = fs.readFileSync(path.join(__dirname, '../../lib/noc/noc-pipeline.js'), 'utf8')
    var proof = fs.readFileSync(path.join(__dirname, '../../lib/proof/completion.js'), 'utf8')
    var erecord = fs.readFileSync(
      path.join(__dirname, '../../lib/erecord/providers/manual.js'),
      'utf8'
    )
    expect(noc).toMatch(/persistGeneratedNocDocument/)
    expect(proof).toMatch(/persistNotarizedNocDocument/)
    expect(erecord).toMatch(/persistRecordedNocDocument/)
    expect(noc).not.toMatch(/ALTER TYPE/)
    expect(proof).not.toMatch(/noc_generated_notarized/)
    expect(erecord).not.toMatch(/noc_generated_recorded/)
  })
})
