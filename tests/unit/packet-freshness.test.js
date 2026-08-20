// tests/unit/packet-freshness.test.js
// ZIG-17 PR 4 Phase D: packet freshness / stale evaluation
'use strict'

const { PDFDocument } = require('pdf-lib')
const {
  evaluatePacketFreshness,
  evaluatePacketFreshnessForCompany,
  evaluatePacketFreshnessForAhj,
  evaluatePacketFreshnessAfterMutation,
  maybeEvaluateCompanyPacketFreshness,
  packetRelevantCompanyFieldsChanged,
  selectPacketStaleReason,
  classifyStorageDownloadError,
  STALE_REASONS,
  NOOP_REASONS,
  STORAGE_FAILED,
  INVALIDATION_FAILED,
  FRESHNESS_STATUS,
  ALERT_PERSISTENCE_FAILED,
} = require('../../lib/permits/packet-freshness.js')
const freshness = require('../../lib/permits/packet-freshness.js')
const { computeLiveInputFingerprint } = require('../../lib/permits/packet-fingerprint-adapter.js')
const { sha256Hex } = require('../../lib/permits/packet-fingerprint.js')

function hex(ch) {
  return String(ch).repeat(64)
}

function requirementRow(overrides) {
  return Object.assign(
    {
      id: 'req-1',
      ahj_id: 'ahj-1',
      document_role: 'product_approval',
      display_name: 'Product Approval',
      required: true,
      include_in_submission_packet: true,
      source_type: 'contractor_uploaded',
      template_storage_path: null,
      field_map: null,
      sort_order: 10,
    },
    overrides || {}
  )
}

function sampleJob(overrides) {
  return Object.assign(
    {
      id: 'job-1',
      company_id: 'company-a',
      ahj_id: 'ahj-1',
      job_status: 'ready_for_physical_submission',
      owner_name: 'Ada Owner',
      job_specs: {},
    },
    overrides || {}
  )
}

function fingerprintEnvelope(inputHex, contentHex) {
  return {
    version: 1,
    input_fingerprint: inputHex,
    content_fingerprint: contentHex,
    computed_at: '2026-08-01T00:00:00.000Z',
    artifacts: [],
  }
}

async function makePdf(label) {
  var doc = await PDFDocument.create()
  doc.addPage([200, 280])
  if (label) {
    var form = doc.getForm()
    var field = form.createTextField(label)
    field.addToPage(doc.getPages()[0], { x: 20, y: 200, width: 160, height: 18 })
  }
  return Buffer.from(await doc.save())
}

function matchesFilters(row, filters, inFilters) {
  var eqOk = Object.keys(filters).every(function (key) {
    return row[key] === filters[key]
  })
  if (!eqOk) return false
  if (!inFilters) return true
  return Object.keys(inFilters).every(function (key) {
    var allowed = inFilters[key] || []
    return allowed.indexOf(row[key]) !== -1
  })
}

function createFreshnessClient(opts) {
  var options = opts || {}
  var state = {
    jobs: (options.jobs || [options.job || sampleJob()]).map(function (row) {
      return Object.assign({}, row)
    }),
    requirements: options.requirements || [requirementRow()],
    documents: (options.documents || []).slice(),
    company: options.company !== undefined
      ? options.company
      : { id: 'company-a', name: 'Acme Roofing', license_number: 'CCC123' },
    storage: Object.assign({}, options.storage || {}),
    storageErrors: Object.assign({}, options.storageErrors || {}),
    rpcCalls: [],
    downloads: [],
    uploads: [],
    inserts: [],
    updates: [],
    automationRuns: (options.automationRuns || []).map(function (row) {
      return Object.assign({}, row)
    }),
    nextRunId: options.nextRunId || 1,
    insertErrors: options.insertErrors || [],
    rpc: options.rpc || null,
  }

  function isActivePermitPacket(row) {
    return (
      row &&
      row.run_type === 'permit_packet' &&
      (row.run_status === 'queued' || row.run_status === 'running')
    )
  }

  function execute(ctx) {
    var table = ctx.table
    var filters = ctx.filters
    var inFilters = ctx.inFilters
    if (ctx.op === 'select') {
      var rows = []
      if (table === 'jobs') {
        rows = state.jobs.filter(function (row) {
          return matchesFilters(row, filters, inFilters)
        })
      } else if (table === 'job_documents') {
        rows = state.documents.filter(function (row) {
          return matchesFilters(row, filters, inFilters)
        })
      } else if (table === 'ahj_document_requirements') {
        rows = state.requirements.slice()
        for (var oi = ctx.orders.length - 1; oi >= 0; oi--) {
          var ord = ctx.orders[oi]
          rows.sort(function (a, b) {
            var av = a[ord.col]
            var bv = b[ord.col]
            if (av < bv) return ord.ascending ? -1 : 1
            if (av > bv) return ord.ascending ? 1 : -1
            return 0
          })
        }
      } else if (table === 'companies') {
        rows = state.company && matchesFilters(state.company, filters, inFilters)
          ? [state.company]
          : []
        if (!filters.id && state.company) rows = [state.company]
      } else if (table === 'automation_runs') {
        rows = state.automationRuns.filter(function (row) {
          return matchesFilters(row, filters, inFilters)
        })
      }
      if (ctx.mode === 'single' || ctx.mode === 'maybe') {
        return { data: rows[0] || null, error: null }
      }
      return { data: rows, error: null }
    }
    if (ctx.op === 'insert') {
      if (state.insertErrors.length) {
        return { data: null, error: state.insertErrors.shift() }
      }
      if (table === 'automation_runs') {
        var runPayload = Object.assign({}, ctx.payload)
        if (
          isActivePermitPacket(runPayload) &&
          state.automationRuns.some(function (row) {
            return row.job_id === runPayload.job_id && isActivePermitPacket(row)
          })
        ) {
          return {
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "automation_runs_one_active_permit_packet_uidx"',
            },
          }
        }
        var runId = 'run-' + state.nextRunId++
        var run = Object.assign({ id: runId }, runPayload)
        state.automationRuns.push(run)
        state.inserts.push({ table: table, payload: runPayload })
        return { data: run, error: null }
      }
      state.inserts.push({ table: table, payload: ctx.payload })
      return { data: { id: 'ins-1' }, error: null }
    }
    if (ctx.op === 'update') {
      state.updates.push({ table: table, payload: ctx.payload, filters: Object.assign({}, filters) })
      return { data: null, error: null }
    }
    return { data: null, error: { message: 'unsupported op ' + ctx.op } }
  }

  function chainFor(table) {
    var ctx = {
      table: table,
      filters: {},
      inFilters: {},
      payload: null,
      op: 'select',
      mode: 'list',
      orders: [],
    }
    var chain = {
      select: function () {
        if (ctx.op !== 'insert') ctx.op = 'select'
        return chain
      },
      insert: function (row) {
        ctx.op = 'insert'
        ctx.payload = row
        return chain
      },
      update: function (row) {
        ctx.op = 'update'
        ctx.payload = row
        return chain
      },
      eq: function (col, val) {
        ctx.filters[col] = val
        return chain
      },
      in: function (col, vals) {
        ctx.inFilters[col] = vals
        return chain
      },
      order: function (col, opts) {
        ctx.orders.push({ col: col, ascending: !(opts && opts.ascending === false) })
        return chain
      },
      single: function () {
        ctx.mode = 'single'
        return chain
      },
      maybeSingle: function () {
        ctx.mode = 'maybe'
        return chain
      },
      then: function (resolve, reject) {
        return Promise.resolve(execute(ctx)).then(resolve, reject)
      },
    }
    return chain
  }

  return {
    state: state,
    client: {
      rpc: async function (name, args) {
        state.rpcCalls.push({ name: name, args: args })
        if (typeof state.rpc === 'function') {
          return state.rpc(name, args, state.rpcCalls.length)
        }
        if (name === 'invalidate_permit_packet_readiness') {
          state.jobs.forEach(function (row) {
            if (row.id === args.p_job_id) row.job_status = 'needs_correction'
          })
          return {
            data: {
              ok: true,
              job_id: args.p_job_id,
              invalidated: true,
              job_status: 'needs_correction',
              cancelled_action_ids: [],
            },
            error: null,
          }
        }
        return { data: null, error: { message: 'unexpected rpc ' + name } }
      },
      from: function (table) {
        return chainFor(table)
      },
      storage: {
        from: function (bucket) {
          expect(bucket).toBe('job-documents')
          return {
            download: async function (filePath) {
              state.downloads.push(filePath)
              if (state.storageErrors[filePath]) {
                return { data: null, error: state.storageErrors[filePath] }
              }
              var bytes = state.storage[filePath]
              if (!bytes) return { data: null, error: { message: 'not found: ' + filePath, statusCode: 404 } }
              return {
                data: {
                  arrayBuffer: async function () {
                    return bytes
                  },
                },
                error: null,
              }
            },
            upload: async function (filePath, bytes) {
              state.uploads.push({ filePath: filePath, bytes: bytes })
              return { error: null }
            },
          }
        },
      },
    },
  }
}

async function readyFixture(overrides) {
  var data = overrides || {}
  var artifactBytes = data.artifactBytes || (await makePdf())
  var packetBytes = data.packetBytes || (await makePdf())
  var job = sampleJob(data.job)
  var documents = data.documents || [
    {
      id: 'doc-bound',
      job_id: job.id,
      document_type: 'product_approval',
      file_path: 'jobs/job-1/product.pdf',
      ahj_document_requirement_id: 'req-1',
    },
    {
      id: 'doc-packet',
      job_id: job.id,
      document_type: 'submission_packet',
      file_path: 'jobs/job-1/generated/submission-packet.pdf',
    },
  ]
  var mock = createFreshnessClient({
    job: job,
    jobs: data.jobs,
    requirements: data.requirements || [requirementRow()],
    documents: documents,
    storage: Object.assign(
      {
        'jobs/job-1/product.pdf': artifactBytes,
        'jobs/job-1/generated/submission-packet.pdf': packetBytes,
      },
      data.storage || {}
    ),
    storageErrors: data.storageErrors,
    rpc: data.rpc,
    company: data.company,
  })
  if (data.skipLiveSeed) return { mock: mock, job: job, packetBytes: packetBytes }
  var live = await computeLiveInputFingerprint(mock.client, job)
  if (!live.ok) {
    throw new Error('readyFixture live fingerprint failed: ' + live.reason)
  }
  mock.state.downloads = []
  job.job_specs = {
    packet: {
      fingerprint: fingerprintEnvelope(
        data.storedInput || live.inputFingerprint,
        data.storedContent || sha256Hex(packetBytes)
      ),
    },
  }
  mock.state.jobs = [Object.assign({}, job)]
  return {
    mock: mock,
    job: job,
    live: live,
    packetBytes: packetBytes,
    artifactBytes: artifactBytes,
  }
}

describe('packet-freshness helpers', function () {
  test('selectPacketStaleReason uses deterministic priority', function () {
    expect(
      selectPacketStaleReason({
        missingStoredFingerprint: true,
        missingSubmissionPacket: true,
        inputMismatch: true,
        contentMismatch: true,
      })
    ).toBe(STALE_REASONS.MISSING_STORED_FINGERPRINT)
    expect(
      selectPacketStaleReason({
        missingSubmissionPacket: true,
        inputMismatch: true,
        contentMismatch: true,
      })
    ).toBe(STALE_REASONS.MISSING_SUBMISSION_PACKET)
    expect(
      selectPacketStaleReason({
        inputMismatch: true,
        contentMismatch: true,
      })
    ).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
    expect(selectPacketStaleReason({ contentMismatch: true })).toBe(
      STALE_REASONS.PACKET_CONTENT_CHANGED
    )
  })

  test('classifyStorageDownloadError treats 404 as missing and 5xx as transient', function () {
    expect(classifyStorageDownloadError({ statusCode: 404 })).toBe('missing')
    expect(classifyStorageDownloadError({ message: 'not found: jobs/x.pdf' })).toBe('missing')
    expect(classifyStorageDownloadError({ statusCode: 503 })).toBe('transient')
    expect(classifyStorageDownloadError({ message: 'timeout contacting storage' })).toBe(
      'transient'
    )
    expect(classifyStorageDownloadError({ message: 'mysterious blob error' })).toBe('transient')
  })
})

describe('evaluatePacketFreshness', function () {
  test('not-ready job is a no-op with no downloads or RPC', async function () {
    var mock = createFreshnessClient({
      job: sampleJob({ job_status: 'automation_running' }),
    })
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result).toEqual({
      jobId: 'job-1',
      evaluated: false,
      fresh: null,
      invalidated: false,
      noop_reason: NOOP_REASONS.NOT_READY,
    })
    expect(mock.state.downloads.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.updates.length).toBe(0)
    expect(mock.state.inserts.length).toBe(0)
  })

  test('both hashes match → fresh with no RPC or writes', async function () {
    var fx = await readyFixture()
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result).toEqual({
      jobId: 'job-1',
      evaluated: true,
      fresh: true,
      invalidated: false,
    })
    expect(fx.mock.state.rpcCalls.length).toBe(0)
    expect(fx.mock.state.updates.length).toBe(0)
    expect(fx.mock.state.inserts.length).toBe(0)
    expect(fx.mock.state.uploads.length).toBe(0)
  })

  test('input mismatch → packet_inputs_changed', async function () {
    var fx = await readyFixture({ storedInput: hex('b') })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.fresh).toBe(false)
    expect(result.invalidated).toBe(true)
    expect(result.reason).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
    expect(fx.mock.state.rpcCalls[0].name).toBe('invalidate_permit_packet_readiness')
    expect(fx.mock.state.rpcCalls[0].args.p_expected_stored_input_fingerprint).toBe(hex('b'))
    expect(fx.mock.state.rpcCalls[0].args.p_expect_missing_stored_fingerprint).toBe(false)
    expect(fx.mock.state.rpcCalls[0].args.p_reason).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
    expect(fx.mock.state.rpcCalls[0].args.p_observed_input_fingerprint).toBe(
      fx.live.inputFingerprint
    )
    expect(fx.mock.state.updates.length).toBe(0)
    expect(result.rebuild.created).toBe(true)
    expect(fx.mock.state.inserts.length).toBe(1)
    expect(fx.mock.state.automationRuns.length).toBe(1)
    expect(fx.mock.state.inserts[0].payload).not.toHaveProperty('company_id')
    expect(Object.keys(fx.mock.state.inserts[0].payload).sort()).toEqual(
      ['attempts', 'job_id', 'payload', 'run_status', 'run_type', 'started_at'].sort()
    )
  })

  test('content-only mismatch → packet_content_changed', async function () {
    var fx = await readyFixture({ storedContent: hex('c') })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.PACKET_CONTENT_CHANGED)
    expect(result.invalidated).toBe(true)
    expect(fx.mock.state.rpcCalls[0].args.p_expected_stored_input_fingerprint).toBe(
      fx.live.inputFingerprint
    )
    expect(fx.mock.state.rpcCalls[0].args.p_expect_missing_stored_fingerprint).toBe(false)
    expect(fx.mock.state.rpcCalls[0].args.p_observed_input_fingerprint).toBe(
      fx.live.inputFingerprint
    )
  })

  test('both mismatch → input reason wins', async function () {
    var fx = await readyFixture({ storedInput: hex('b'), storedContent: hex('c') })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
  })

  test('missing canonical submission_packet row is stale', async function () {
    var fx = await readyFixture({
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
    })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.MISSING_SUBMISSION_PACKET)
    expect(result.invalidated).toBe(true)
  })

  test('blank submission_packet file_path is stale', async function () {
    var fx = await readyFixture({
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-packet',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: '',
        },
      ],
    })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.MISSING_SUBMISSION_PACKET)
  })

  test('empty Storage object is missing_submission_packet', async function () {
    var fx = await readyFixture({
      packetBytes: Buffer.alloc(0),
    })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.MISSING_SUBMISSION_PACKET)
    expect(result.invalidated).toBe(true)
  })

  test('definitive Storage not found is missing_submission_packet', async function () {
    var fx = await readyFixture({
      storage: { 'jobs/job-1/generated/submission-packet.pdf': null },
      storageErrors: {
        'jobs/job-1/generated/submission-packet.pdf': {
          message: 'Object not found',
          statusCode: 404,
        },
      },
    })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.MISSING_SUBMISSION_PACKET)
    expect(result.invalidated).toBe(true)
  })

  test('transient Storage failure does not invalidate', async function () {
    var fx = await readyFixture({
      storageErrors: {
        'jobs/job-1/generated/submission-packet.pdf': {
          message: 'timeout contacting storage',
          statusCode: 503,
        },
      },
    })
    await expect(evaluatePacketFreshness('job-1', fx.mock.client)).rejects.toMatchObject({
      errorCode: STORAGE_FAILED,
      retryable: true,
    })
    expect(fx.mock.state.rpcCalls.length).toBe(0)
    expect(fx.mock.state.updates.length).toBe(0)
    expect(fx.mock.state.inserts.length).toBe(0)
  })

  test('missing stored fingerprint invalidates via expect_missing CAS', async function () {
    var mock = createFreshnessClient({
      job: sampleJob({
        job_status: 'ready_for_physical_submission',
        job_specs: { packet: { complete: true } },
      }),
    })
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result.reason).toBe(STALE_REASONS.MISSING_STORED_FINGERPRINT)
    expect(result.fresh).toBe(false)
    expect(result.invalidated).toBe(true)
    expect(result.correction_required).toBeUndefined()
    expect(mock.state.rpcCalls.length).toBe(1)
    expect(mock.state.rpcCalls[0].args.p_expect_missing_stored_fingerprint).toBe(true)
    expect(mock.state.rpcCalls[0].args.p_expected_stored_input_fingerprint).toBeNull()
    expect(mock.state.rpcCalls[0].args.p_reason).toBe(STALE_REASONS.MISSING_STORED_FINGERPRINT)
    expect(mock.state.downloads.length).toBe(0)
  })

  test('missing fingerprint vs newer stored B is a CAS no-op', async function () {
    var mock = createFreshnessClient({
      job: sampleJob({
        job_status: 'ready_for_physical_submission',
        job_specs: { packet: { complete: true } },
      }),
      rpc: function (name, args) {
        expect(name).toBe('invalidate_permit_packet_readiness')
        expect(args.p_expect_missing_stored_fingerprint).toBe(true)
        expect(args.p_expected_stored_input_fingerprint).toBeNull()
        return {
          data: {
            ok: true,
            job_id: args.p_job_id,
            invalidated: false,
            job_status: 'ready_for_physical_submission',
            noop_reason: 'fingerprint_cas_mismatch',
            cancelled_action_ids: [],
          },
          error: null,
        }
      },
    })
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result.invalidated).toBe(false)
    expect(result.fresh).toBeNull()
    expect(result.noop_reason).toBe(NOOP_REASONS.FINGERPRINT_CAS_MISMATCH)
    expect(mock.state.updates.length).toBe(0)
    expect(mock.state.inserts.length).toBe(0)
  })

  test('malformed stored envelope with usable input hash invalidates via CAS', async function () {
    var mock = createFreshnessClient({
      job: sampleJob({
        job_specs: {
          packet: {
            fingerprint: {
              version: 1,
              input_fingerprint: hex('b'),
            },
          },
        },
      }),
    })
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result.reason).toBe(STALE_REASONS.MISSING_STORED_FINGERPRINT)
    expect(result.invalidated).toBe(true)
    expect(mock.state.rpcCalls[0].args.p_expected_stored_input_fingerprint).toBe(hex('b'))
    expect(mock.state.rpcCalls[0].args.p_expect_missing_stored_fingerprint).toBe(false)
    expect(mock.state.rpcCalls[0].args.p_reason).toBe(STALE_REASONS.MISSING_STORED_FINGERPRINT)
    expect(mock.state.downloads.length).toBe(0)
  })

  test('current included requirement missing/incomplete is stale', async function () {
    var fx = await readyFixture({
      documents: [
        {
          id: 'doc-packet',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
      ],
      skipLiveSeed: true,
    })
    fx.job.job_specs = {
      packet: { fingerprint: fingerprintEnvelope(hex('b'), hex('c')) },
    }
    fx.mock.state.jobs = [Object.assign({}, fx.job)]
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.reason).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
    expect(result.invalidated).toBe(true)
  })

  test('CAS mismatch does not claim invalidation or mutate', async function () {
    var fx = await readyFixture({
      storedInput: hex('b'),
      rpc: function (name, args) {
        expect(name).toBe('invalidate_permit_packet_readiness')
        expect(args.p_expected_stored_input_fingerprint).toBe(hex('b'))
        expect(args.p_expect_missing_stored_fingerprint).toBe(false)
        return {
          data: {
            ok: true,
            job_id: args.p_job_id,
            invalidated: false,
            job_status: 'ready_for_physical_submission',
            noop_reason: 'fingerprint_cas_mismatch',
            cancelled_action_ids: [],
          },
          error: null,
        }
      },
    })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.invalidated).toBe(false)
    expect(result.fresh).toBeNull()
    expect(result.noop_reason).toBe(NOOP_REASONS.FINGERPRINT_CAS_MISMATCH)
    expect(fx.mock.state.updates.length).toBe(0)
    expect(fx.mock.state.inserts.length).toBe(0)
  })

  test('not-ready RPC response is a no-op', async function () {
    var fx = await readyFixture({
      storedInput: hex('b'),
      rpc: function (name, args) {
        return {
          data: {
            ok: true,
            job_id: args.p_job_id,
            invalidated: false,
            job_status: 'needs_correction',
            noop_reason: 'not_ready',
            cancelled_action_ids: [],
          },
          error: null,
        }
      },
    })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.invalidated).toBe(false)
    expect(result.fresh).toBeNull()
    expect(result.noop_reason).toBe(NOOP_REASONS.NOT_READY)
    expect(fx.mock.state.updates.length).toBe(0)
    expect(fx.mock.state.inserts.length).toBe(0)
  })

  test('evaluation does not regenerate or persist DART artifacts', async function () {
    var artifactBytes = await makePdf('ApplicantName')
    var packetBytes = await makePdf()
    var job = sampleJob()
    var mock = createFreshnessClient({
      job: job,
      requirements: [
        requirementRow({
          id: 'req-app',
          document_role: 'permit_application',
          display_name: 'Permit Application',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: {
            fields: [
              {
                pdfField: 'ApplicantName',
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      documents: [
        {
          id: 'doc-app',
          job_id: 'job-1',
          document_type: 'permit_application',
          file_path: 'jobs/job-1/generated/req-app/permit_application.pdf',
          ahj_document_requirement_id: 'req-app',
        },
        {
          id: 'doc-packet',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
      ],
      storage: {
        'templates/app.pdf': await makePdf('ApplicantName'),
        'jobs/job-1/generated/req-app/permit_application.pdf': artifactBytes,
        'jobs/job-1/generated/submission-packet.pdf': packetBytes,
      },
    })
    var live = await computeLiveInputFingerprint(mock.client, job)
    expect(live.ok).toBe(true)
    mock.state.downloads = []
    job.job_specs = {
      packet: {
        fingerprint: fingerprintEnvelope(live.inputFingerprint, sha256Hex(packetBytes)),
      },
    }
    mock.state.jobs = [Object.assign({}, job)]
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result.fresh).toBe(true)
    expect(mock.state.uploads.length).toBe(0)
    expect(mock.state.inserts.length).toBe(0)
    expect(mock.state.updates.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.downloads).toContain(
      'jobs/job-1/generated/req-app/permit_application.pdf'
    )
    expect(mock.state.downloads).not.toContain('templates/app.pdf')
  })
})

describe('company and AHJ helpers', function () {
  test('company helper evaluates only ready jobs for that company', async function () {
    var artifactBytes = await makePdf()
    var packetBytes = await makePdf()
    var readyJob = sampleJob({
      id: 'job-ready',
      job_specs: {
        packet: { fingerprint: fingerprintEnvelope(hex('b'), sha256Hex(packetBytes)) },
      },
    })
    var otherCompany = sampleJob({
      id: 'job-other-co',
      company_id: 'company-b',
      job_specs: readyJob.job_specs,
    })
    var notReady = sampleJob({
      id: 'job-running',
      job_status: 'automation_running',
      job_specs: readyJob.job_specs,
    })
    var mock = createFreshnessClient({
      jobs: [readyJob, otherCompany, notReady],
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-ready',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-packet',
          job_id: 'job-ready',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
      ],
      storage: {
        'jobs/job-1/product.pdf': artifactBytes,
        'jobs/job-1/generated/submission-packet.pdf': packetBytes,
      },
    })
    var listed = await evaluatePacketFreshnessForCompany('company-a', mock.client)
    expect(listed.results.map(function (row) { return row.jobId })).toEqual(['job-ready'])
    expect(listed.results[0].evaluated).toBe(true)
  })

  test('AHJ helper selects ready jobs by jobs.ahj_id', async function () {
    var packetBytes = await makePdf()
    var ready = sampleJob({
      id: 'job-ahj',
      ahj_id: 'ahj-1',
      job_specs: {
        packet: { fingerprint: fingerprintEnvelope(hex('b'), sha256Hex(packetBytes)) },
      },
    })
    var otherAhj = sampleJob({
      id: 'job-other-ahj',
      ahj_id: 'ahj-2',
      job_specs: ready.job_specs,
    })
    var mock = createFreshnessClient({
      jobs: [ready, otherAhj],
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-ahj',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-packet',
          job_id: 'job-ahj',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
      ],
      storage: {
        'jobs/job-1/product.pdf': await makePdf(),
        'jobs/job-1/generated/submission-packet.pdf': packetBytes,
      },
    })
    var listed = await evaluatePacketFreshnessForAhj('ahj-1', mock.client)
    expect(listed.results.map(function (row) { return row.jobId })).toEqual(['job-ahj'])
  })
})

describe('Phase F company mutation freshness', function () {
  beforeEach(function () {
    jest
      .spyOn(freshness, 'reportProvenStaleInvalidationFailure')
      .mockResolvedValue({ persisted: false })
  })

  afterEach(function () {
    if (freshness.reportProvenStaleInvalidationFailure.mockRestore) {
      freshness.reportProvenStaleInvalidationFailure.mockRestore()
    }
  })
  test('relevant company field evaluates ready jobs only', async function () {
    var mock = createFreshnessClient({
      jobs: [sampleJob({ job_status: 'automation_running' })],
    })
    var result = await maybeEvaluateCompanyPacketFreshness(
      'company-a',
      { name: 'New Roofing Co', updated_at: new Date().toISOString() },
      mock.client
    )
    expect(packetRelevantCompanyFieldsChanged({ name: 'New Roofing Co' })).toBe(true)
    expect(result.skipped).toBe(false)
    expect(result.result.companyId).toBe('company-a')
    expect(result.result.results).toEqual([])
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('billing/admin-only fields skip evaluation', async function () {
    var mock = createFreshnessClient({
      jobs: [sampleJob()],
    })
    var result = await maybeEvaluateCompanyPacketFreshness(
      'company-a',
      {
        subscription_plan: 'pro',
        subscription_status: 'active',
        onboarding_status: 'approved',
        is_active: true,
        notes: 'internal',
        review_gates: { noc: true },
        updated_at: new Date().toISOString(),
      },
      mock.client
    )
    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'no_packet_relevant_company_fields',
    })
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.downloads.length).toBe(0)
  })

  test('one job storage failure does not prevent remaining jobs', async function () {
    var artifactBytes = await makePdf()
    var packetBytes = await makePdf()
    var jobFail = sampleJob({
      id: 'job-fail',
      job_specs: {
        packet: { fingerprint: fingerprintEnvelope(hex('b'), sha256Hex(packetBytes)) },
      },
    })
    var jobOk = sampleJob({
      id: 'job-ok',
      job_specs: {
        packet: { fingerprint: fingerprintEnvelope(hex('b'), sha256Hex(packetBytes)) },
      },
    })
    var mock = createFreshnessClient({
      jobs: [jobFail, jobOk],
      documents: [
        {
          id: 'doc-bound-fail',
          job_id: 'job-fail',
          document_type: 'product_approval',
          file_path: 'jobs/job-fail/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-packet-fail',
          job_id: 'job-fail',
          document_type: 'submission_packet',
          file_path: 'jobs/job-fail/generated/submission-packet.pdf',
        },
        {
          id: 'doc-bound-ok',
          job_id: 'job-ok',
          document_type: 'product_approval',
          file_path: 'jobs/job-ok/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-packet-ok',
          job_id: 'job-ok',
          document_type: 'submission_packet',
          file_path: 'jobs/job-ok/generated/submission-packet.pdf',
        },
      ],
      storage: {
        'jobs/job-fail/product.pdf': artifactBytes,
        'jobs/job-fail/generated/submission-packet.pdf': packetBytes,
        'jobs/job-ok/product.pdf': artifactBytes,
        'jobs/job-ok/generated/submission-packet.pdf': packetBytes,
      },
      storageErrors: {
        'jobs/job-fail/generated/submission-packet.pdf': {
          message: 'timeout contacting storage',
          statusCode: 503,
        },
      },
    })
    mock.state.downloads = []
    var liveFail = await computeLiveInputFingerprint(mock.client, jobFail)
    var liveOk = await computeLiveInputFingerprint(mock.client, jobOk)
    expect(liveFail.ok).toBe(true)
    expect(liveOk.ok).toBe(true)
    jobFail.job_specs.packet.fingerprint = fingerprintEnvelope(
      liveFail.inputFingerprint,
      sha256Hex(packetBytes)
    )
    jobOk.job_specs.packet.fingerprint = fingerprintEnvelope(
      liveOk.inputFingerprint,
      sha256Hex(packetBytes)
    )
    mock.state.jobs = [Object.assign({}, jobFail), Object.assign({}, jobOk)]
    mock.state.downloads = []
    var listed = await evaluatePacketFreshnessForCompany('company-a', mock.client)
    expect(listed.results).toHaveLength(2)
    var failed = listed.results.find(function (row) { return row.jobId === 'job-fail' })
    var ok = listed.results.find(function (row) { return row.jobId === 'job-ok' })
    expect(failed.errorCode).toBe(STORAGE_FAILED)
    expect(failed.retryable).toBe(true)
    expect(failed.side_effect_failed).toBe(false)
    expect(ok.evaluated).toBe(true)
    expect(listed.summary.transient_failures).toBe(1)
    expect(listed.summary.side_effect_failures).toBe(0)
  })

  test('transient freshness failure after mutation does not throw', async function () {
    var warn = jest.spyOn(console, 'warn').mockImplementation(function () {})
    var result = await evaluatePacketFreshnessAfterMutation(
      'job-1',
      {
        from: function () {
          throw Object.assign(new Error('packet_freshness_storage_failed: timeout'), {
            errorCode: STORAGE_FAILED,
            retryable: true,
          })
        },
      }
    )
    expect(result.ok).toBe(false)
    expect(result.retryable).toBe(true)
    expect(result.side_effect_failed).toBe(false)
    expect(result.status).toBe(FRESHNESS_STATUS.TRANSIENT_FAILURE)
    expect(result.errorCode).toBe(STORAGE_FAILED)
    expect(result.job_id).toBe('job-1')
    expect(warn).toHaveBeenCalled()
    expect(freshness.reportProvenStaleInvalidationFailure).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  test('invalidation failure is logged at error and does not throw', async function () {
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    var result = await evaluatePacketFreshnessAfterMutation(
      'job-1',
      {
        from: function () {
          throw Object.assign(new Error('invalidate_permit_packet_readiness failed'), {
            errorCode: INVALIDATION_FAILED,
            sideEffectFailed: true,
            jobId: 'job-1',
          })
        },
      }
    )
    expect(result.ok).toBe(false)
    expect(result.retryable).not.toBe(true)
    expect(result.side_effect_failed).toBe(true)
    expect(result.status).toBe(FRESHNESS_STATUS.SIDE_EFFECT_FAILED)
    expect(result.errorCode).toBe(INVALIDATION_FAILED)
    expect(result.job_id).toBe('job-1')
    expect(logged).toHaveBeenCalled()
    expect(freshness.reportProvenStaleInvalidationFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        errorCode: INVALIDATION_FAILED,
      })
    )
    logged.mockRestore()
  })

  test('proven stale + invalidation RPC error is side_effect_failed, not a write failure', async function () {
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    var fx = await readyFixture({
      storedInput: hex('b'),
      rpc: function () {
        return { data: null, error: { message: 'could not lock jobs row' } }
      },
    })
    var result = await evaluatePacketFreshnessAfterMutation('job-1', fx.mock.client)
    expect(result.ok).toBe(false)
    expect(result.side_effect_failed).toBe(true)
    expect(result.status).toBe(FRESHNESS_STATUS.SIDE_EFFECT_FAILED)
    expect(result.errorCode).toBe(INVALIDATION_FAILED)
    expect(result.job_id).toBe('job-1')
    expect(result.stale_reason).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
    expect(fx.mock.state.jobs[0].job_status).toBe('ready_for_physical_submission')
    expect(freshness.reportProvenStaleInvalidationFailure).toHaveBeenCalled()
    logged.mockRestore()
  })

  test('CAS mismatch is not a side-effect failure', async function () {
    var fx = await readyFixture({
      storedInput: hex('b'),
      rpc: function (name, args) {
        return {
          data: {
            ok: true,
            job_id: args.p_job_id,
            invalidated: false,
            job_status: 'ready_for_physical_submission',
            noop_reason: 'fingerprint_cas_mismatch',
            cancelled_action_ids: [],
          },
          error: null,
        }
      },
    })
    var result = await evaluatePacketFreshnessAfterMutation('job-1', fx.mock.client)
    expect(result.ok).toBe(true)
    expect(result.side_effect_failed).toBe(false)
    expect(result.status).toBe(FRESHNESS_STATUS.CAS_MISMATCH)
    expect(result.result.noop_reason).toBe(NOOP_REASONS.FINGERPRINT_CAS_MISMATCH)
    expect(freshness.reportProvenStaleInvalidationFailure).not.toHaveBeenCalled()
  })

  test('not_ready is not a side-effect failure', async function () {
    var mock = createFreshnessClient({
      job: sampleJob({ job_status: 'needs_correction' }),
    })
    var result = await evaluatePacketFreshnessAfterMutation('job-1', mock.client)
    expect(result.ok).toBe(true)
    expect(result.side_effect_failed).toBe(false)
    expect(result.status).toBe(FRESHNESS_STATUS.NOT_READY)
    expect(result.result.noop_reason).toBe(NOOP_REASONS.NOT_READY)
    expect(freshness.reportProvenStaleInvalidationFailure).not.toHaveBeenCalled()
  })

  test('side-effect reporter uses existing stuck_job alert infrastructure', async function () {
    freshness.reportProvenStaleInvalidationFailure.mockRestore()
    var alerts = require('../../lib/monitoring/alert-service')
    var send = jest.spyOn(alerts, 'sendAlert').mockResolvedValue({ persisted: true })
    await freshness.reportProvenStaleInvalidationFailure({
      jobId: 'job-1',
      companyId: 'company-a',
      errorCode: INVALIDATION_FAILED,
      stale_reason: STALE_REASONS.PACKET_INPUTS_CHANGED,
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stuck_job',
        severity: 'critical',
        jobId: 'job-1',
        companyId: 'company-a',
        details: expect.objectContaining({
          errorCode: INVALIDATION_FAILED,
          classification: 'packet_freshness_side_effect_failed',
        }),
      })
    )
    send.mockRestore()
    jest.spyOn(freshness, 'reportProvenStaleInvalidationFailure').mockResolvedValue({ persisted: false })
  })

  test('persisted true does not emit alert-persistence failure log', async function () {
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    freshness.reportProvenStaleInvalidationFailure.mockResolvedValue({ persisted: true })
    var result = await evaluatePacketFreshnessAfterMutation(
      'job-1',
      {
        from: function () {
          throw Object.assign(new Error('invalidate_permit_packet_readiness failed'), {
            errorCode: INVALIDATION_FAILED,
            sideEffectFailed: true,
            jobId: 'job-1',
            staleReason: STALE_REASONS.PACKET_INPUTS_CHANGED,
          })
        },
      }
    )
    expect(result.status).toBe(FRESHNESS_STATUS.SIDE_EFFECT_FAILED)
    expect(result.errorCode).toBe(INVALIDATION_FAILED)
    expect(result.side_effect_failed).toBe(true)
    var persistenceLogs = logged.mock.calls.filter(function (args) {
      return String(args[0]).indexOf(ALERT_PERSISTENCE_FAILED) !== -1
    })
    expect(persistenceLogs.length).toBe(0)
    logged.mockRestore()
  })

  test('persisted false emits alert-persistence failure log and keeps classification', async function () {
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    freshness.reportProvenStaleInvalidationFailure.mockResolvedValue({ persisted: false })
    var result = await evaluatePacketFreshnessAfterMutation(
      'job-1',
      {
        from: function () {
          throw Object.assign(new Error('invalidate_permit_packet_readiness failed'), {
            errorCode: INVALIDATION_FAILED,
            sideEffectFailed: true,
            jobId: 'job-1',
            staleReason: STALE_REASONS.PACKET_INPUTS_CHANGED,
          })
        },
      }
    )
    expect(result.status).toBe(FRESHNESS_STATUS.SIDE_EFFECT_FAILED)
    expect(result.errorCode).toBe(INVALIDATION_FAILED)
    expect(result.side_effect_failed).toBe(true)
    var persistenceLogs = logged.mock.calls.filter(function (args) {
      return String(args[0]).indexOf(ALERT_PERSISTENCE_FAILED) !== -1
    })
    expect(persistenceLogs.length).toBe(1)
    expect(persistenceLogs[0][1]).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        errorCode: INVALIDATION_FAILED,
        stale_reason: STALE_REASONS.PACKET_INPUTS_CHANGED,
        alertPersistenceCode: ALERT_PERSISTENCE_FAILED,
      })
    )
    logged.mockRestore()
  })

  test('reporter throw emits alert-persistence failure log and keeps classification', async function () {
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    freshness.reportProvenStaleInvalidationFailure.mockRejectedValue(
      new Error('system_alerts insert failed')
    )
    var result = await evaluatePacketFreshnessAfterMutation(
      'job-1',
      {
        from: function () {
          throw Object.assign(new Error('invalidate_permit_packet_readiness failed'), {
            errorCode: INVALIDATION_FAILED,
            sideEffectFailed: true,
            jobId: 'job-1',
            staleReason: STALE_REASONS.PACKET_INPUTS_CHANGED,
          })
        },
      }
    )
    expect(result.status).toBe(FRESHNESS_STATUS.SIDE_EFFECT_FAILED)
    expect(result.errorCode).toBe(INVALIDATION_FAILED)
    expect(result.side_effect_failed).toBe(true)
    var persistenceLogs = logged.mock.calls.filter(function (args) {
      return String(args[0]).indexOf(ALERT_PERSISTENCE_FAILED) !== -1
    })
    expect(persistenceLogs.length).toBe(1)
    expect(persistenceLogs[0][1]).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        errorCode: INVALIDATION_FAILED,
        stale_reason: STALE_REASONS.PACKET_INPUTS_CHANGED,
        alertPersistenceCode: ALERT_PERSISTENCE_FAILED,
      })
    )
    logged.mockRestore()
  })

  test('company fan-out mixed results evaluate all ready jobs', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockImplementation(async function (jobId) {
      if (jobId === 'job-1') {
        return { jobId: jobId, evaluated: true, fresh: true, invalidated: false }
      }
      if (jobId === 'job-2') {
        throw Object.assign(new Error('storage timeout'), {
          errorCode: STORAGE_FAILED,
          retryable: true,
        })
      }
      if (jobId === 'job-3') {
        return {
          jobId: jobId,
          evaluated: true,
          fresh: false,
          invalidated: true,
          reason: STALE_REASONS.PACKET_INPUTS_CHANGED,
        }
      }
      if (jobId === 'job-4') {
        throw Object.assign(new Error('invalidate failed'), {
          errorCode: INVALIDATION_FAILED,
          sideEffectFailed: true,
          jobId: jobId,
          staleReason: STALE_REASONS.PACKET_CONTENT_CHANGED,
        })
      }
      if (jobId === 'job-5') {
        return { jobId: jobId, evaluated: true, fresh: true, invalidated: false }
      }
      throw new Error('unexpected job ' + jobId)
    })
    var mock = createFreshnessClient({
      jobs: [
        sampleJob({ id: 'job-1' }),
        sampleJob({ id: 'job-2' }),
        sampleJob({ id: 'job-3' }),
        sampleJob({ id: 'job-4' }),
        sampleJob({ id: 'job-5' }),
      ],
    })
    var warn = jest.spyOn(console, 'warn').mockImplementation(function () {})
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    var result = await maybeEvaluateCompanyPacketFreshness(
      'company-a',
      { name: 'Acme Roofing' },
      mock.client
    )
    expect(result.side_effect_failed).toBe(true)
    expect(result.summary).toEqual({
      evaluated: 3,
      fresh: 2,
      invalidated: 1,
      transient_failures: 1,
      side_effect_failures: 1,
    })
    expect(result.result.results.map(function (row) { return row.jobId })).toEqual([
      'job-1',
      'job-2',
      'job-3',
      'job-4',
      'job-5',
    ])
    expect(freshness.reportProvenStaleInvalidationFailure).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    warn.mockRestore()
    logged.mockRestore()
  })
})
