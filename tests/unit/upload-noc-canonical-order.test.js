// tests/unit/upload-noc-canonical-order.test.js
// Behavioral POST() test: compile the ESM route to CJS with injected mocks.
// This is not a live Next.js / Postgres run.
'use strict'

const fs = require('fs')
const path = require('path')
const Module = require('module')

var routePath = path.join(
  __dirname,
  '../../app/api/contractor/jobs/[id]/upload-noc/route.js'
)

function loadPost(mocks) {
  var src = fs.readFileSync(routePath, 'utf8')
  var replaced = src
    .replace(/^import .+$/gm, '')
    .replace(/const require = createRequire\(import\.meta\.url\)\s*/, '')
    .replace('export async function POST', 'async function POST')

  if (/^import /m.test(replaced) || /export /.test(replaced) || /import\.meta/.test(replaced)) {
    throw new Error('upload-noc route still has ESM import/export after stub compile')
  }

  var factory = new Function(
    'mocks',
    'Response',
    'console',
    "const authenticateRequest = mocks.authenticateRequest;\n" +
      "const requireCompanyUser = mocks.requireCompanyUser;\n" +
      "const assertJobAccess = mocks.assertJobAccess;\n" +
      "const createClient = mocks.createClient;\n" +
      "const require = mocks.requireImpl;\n" +
      replaced +
      "\nreturn POST;\n"
  )
  return factory(mocks, Response, console)
}

function makeRequireImpl(persistFn, packetMergeFn) {
  var realRequire = Module.createRequire(routePath)
  return function (id) {
    if (String(id).indexOf('upsert-canonical-job-document') !== -1) {
      return { persistUploadedNocDocument: persistFn }
    }
    if (String(id).indexOf('try-packet-merge') !== -1) {
      return { tryPacketMergeForJob: packetMergeFn }
    }
    return realRequire(id)
  }
}

function createServiceClient(store) {
  return {
    storage: {
      from: function (bucket) {
        expect(bucket).toBe('job-documents')
        return {
          upload: async function (filePath) {
            store.events.push('storage')
            store.uploads.push(filePath)
            return { error: null }
          },
        }
      },
    },
    from: function (table) {
      if (table === 'jobs') {
        return {
          update: function (payload) {
            store.events.push('job_update')
            store.jobUpdates.push(payload)
            return {
              eq: function () {
                return {
                  select: function () {
                    return {
                      single: async function () {
                        store.job = Object.assign({}, store.job, payload)
                        return { data: store.job, error: null }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'automation_runs') {
        return {
          insert: async function (row) {
            store.events.push('queue')
            store.queued.push(row)
            return { error: null }
          },
        }
      }
      throw new Error('unexpected table ' + table)
    },
  }
}

function createUserClient(store) {
  return {
    from: function (table) {
      expect(table).toBe('jobs')
      return {
        select: function () {
          return {
            eq: function () {
              return {
                eq: function () {
                  return {
                    single: async function () {
                      return { data: store.job, error: null }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

function makePdfFile() {
  var pdf = Buffer.from('%PDF-1.4 test')
  if (typeof File === 'function') {
    return new File([pdf], 'noc.pdf', { type: 'application/pdf' })
  }
  var blob = new Blob([pdf], { type: 'application/pdf' })
  blob.name = 'noc.pdf'
  return blob
}

async function makeRequest(jobId) {
  var form = new FormData()
  form.set('noc_option', 'upload_signed')
  form.set('file', makePdfFile())
  return new Request('http://localhost/api/contractor/jobs/' + jobId + '/upload-noc', {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    body: form,
  })
}

function setup(opts) {
  var options = opts || {}
  var store = {
    events: [],
    uploads: [],
    jobUpdates: [],
    queued: [],
    job: {
      id: 'job-1',
      company_id: 'company-1',
      noc_file_path: null,
      job_specs: {},
    },
  }
  var persist = options.failCanonical
    ? async function () {
        store.events.push('canonical')
        throw new Error('canonical persist failed')
      }
    : options.persist || async function () {
        store.events.push('canonical')
      }
  var merge = options.merge || async function () {
    store.events.push('merge')
    return { merged: false }
  }
  var userClient = createUserClient(store)
  var serviceClient = createServiceClient(store)
  var POST = loadPost({
    authenticateRequest: async function () {
      return {
        user: { id: 'user-1' },
        companyId: 'company-1',
        userSupabase: userClient,
        supabase: userClient,
        error: null,
      }
    },
    requireCompanyUser: async function (ctx) {
      return ctx
    },
    assertJobAccess: async function () {
      return { error: null }
    },
    createClient: function () {
      return serviceClient
    },
    requireImpl: makeRequireImpl(persist, merge),
  })
  return { POST: POST, store: store }
}

describe('contractor upload-noc canonical ordering', function () {
  var errorSpy

  beforeEach(function () {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(function () {})
  })

  afterEach(function () {
    errorSpy.mockRestore()
  })

  test('canonical persist failure does not update the job or queue automation', async function () {
    var harness = setup({ failCanonical: true })
    var res = await harness.POST(await makeRequest('job-1'), { params: { id: 'job-1' } })
    var body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/canonical persist failed/)
    expect(harness.store.events).toEqual(['storage', 'canonical'])
    expect(harness.store.jobUpdates).toHaveLength(0)
    expect(harness.store.queued).toHaveLength(0)
  })

  test('success order is storage then canonical then job update then queue', async function () {
    var harness = setup()
    var res = await harness.POST(await makeRequest('job-1'), { params: { id: 'job-1' } })
    var body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.queued).toBe('proof_send')
    expect(body.path).toBe('jobs/job-1/uploaded/noc-uploaded.pdf')
    expect(harness.store.events).toEqual(['storage', 'canonical', 'job_update', 'merge', 'queue'])
    expect(harness.store.jobUpdates[0].noc_status).toBe('queued_for_notarization')
    expect(harness.store.queued[0].run_type).toBe('proof_send')
  })
})
