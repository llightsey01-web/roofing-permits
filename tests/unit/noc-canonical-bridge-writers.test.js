// tests/unit/noc-canonical-bridge-writers.test.js
// Proof / eRecord persist hooks without Playwright or live portals
'use strict'

jest.mock('@supabase/supabase-js', function () {
  return {
    createClient: function () {
      return global.__zig17BridgeClient
    },
  }
})

function createBridgeClient(store) {
  return {
    storage: {
      from: function () {
        return {
          upload: async function (filePath) {
            store.uploads.push(filePath)
            return { error: null }
          },
        }
      },
    },
    from: function (table) {
      if (table === 'job_documents') {
        return {
          select: function () {
            return {
              eq: function () {
                return {
                  eq: function () {
                    return {
                      order: async function () {
                        return {
                          data: store.docs.map(function (r) { return { id: r.id } }),
                          error: null,
                        }
                      },
                    }
                  },
                }
              },
            }
          },
          insert: function (row) {
            store.docs.push(Object.assign({ id: 'doc-' + (store.docs.length + 1) }, row))
            return {
              select: function () {
                return {
                  single: async function () {
                    return { data: { id: store.docs[store.docs.length - 1].id }, error: null }
                  },
                }
              },
            }
          },
          update: function (payload) {
            store.docs.forEach(function (row) { Object.assign(row, payload) })
            return {
              eq: function () {
                return { eq: async function () { return { error: null } } }
              },
            }
          },
        }
      }
      return {
        select: function () {
          return {
            eq: function () {
              var node = {
                single: async function () {
                  return { data: store.job, error: null }
                },
                maybeSingle: async function () {
                  return { data: store.job, error: null }
                },
                eq: function () {
                  return node
                },
              }
              return node
            },
          }
        },
        update: function (payload) {
          store.jobUpdates.push(payload)
          store.job = Object.assign({}, store.job, payload)
          return {
            eq: function () {
              return {
                select: function () {
                  return {
                    single: async function () {
                      return { data: store.job, error: null }
                    },
                  }
                },
                then: function (resolve) {
                  return Promise.resolve({ error: null }).then(resolve)
                },
              }
            },
          }
        },
      }
    },
  }
}

describe('Proof notarized NOC canonical index', function () {
  test('persistNotarizedNocDocument is idempotent and keeps job_specs path convention', async function () {
    var {
      persistNotarizedNocDocument,
    } = require('../../lib/documents/upsert-canonical-job-document')
    var store = { docs: [], jobUpdates: [], uploads: [], job: { id: 'job-p' } }
    var client = createBridgeClient(store)
    var filePath = 'jobs/job-p/notarized/noc-notarized.pdf'

    await persistNotarizedNocDocument(client, 'job-p', filePath, 50)
    await persistNotarizedNocDocument(client, 'job-p', filePath, 50)

    expect(store.docs).toHaveLength(1)
    expect(store.docs[0].document_type).toBe('noc_uploaded_notarized')
    expect(store.docs[0].file_path).toBe(filePath)
  })
})

describe('eRecord recorded NOC canonical index', function () {
  var ManualProvider

  beforeEach(function () {
    jest.resetModules()
    var store = {
      docs: [],
      jobUpdates: [],
      uploads: [],
      job: {
        id: 'job-e',
        noc_status: 'notarized',
        job_specs: { proof: { notarized_file_path: 'jobs/job-e/notarized/noc-notarized.pdf' } },
        company_id: 'co-1',
      },
    }
    global.__zig17BridgeClient = createBridgeClient(store)
    global.__zig17BridgeStore = store
    ManualProvider = require('../../lib/erecord/providers/manual.js')
  })

  test('markRecorded with file writes noc_uploaded_recorded and keeps job_specs.erecord', async function () {
    var provider = new ManualProvider()
    var filePath = 'jobs/job-e/recorded/noc-recorded.pdf'
    var first = await provider.markRecorded({
      jobId: 'job-e',
      recordingNumber: '2026-REC-1',
      recordedFilePath: filePath,
    })
    expect(first.success).toBe(true)
    expect(first.nocStatus).toBe('recorded')
    expect(global.__zig17BridgeStore.docs).toHaveLength(1)
    expect(global.__zig17BridgeStore.docs[0].document_type).toBe('noc_uploaded_recorded')
    expect(global.__zig17BridgeStore.docs[0].file_path).toBe(filePath)
    expect(global.__zig17BridgeStore.jobUpdates[0].noc_status).toBe('recorded')
    expect(global.__zig17BridgeStore.jobUpdates[0].job_specs.erecord.recorded_file_path).toBe(filePath)

    global.__zig17BridgeStore.job.noc_status = 'notarized'
    await provider.markRecorded({
      jobId: 'job-e',
      recordingNumber: '2026-REC-1',
      recordedFilePath: filePath,
    })
    expect(global.__zig17BridgeStore.docs).toHaveLength(1)
  })

  test('recordingNumberOnly does not invent a recorded document row', async function () {
    var provider = new ManualProvider()
    await provider.markRecorded({
      jobId: 'job-e',
      recordingNumber: '2026-REC-2',
      recordingNumberOnly: true,
    })
    expect(global.__zig17BridgeStore.docs).toHaveLength(0)
    expect(global.__zig17BridgeStore.jobUpdates[0].job_specs.erecord.recording_number_only).toBe(true)
  })
})
