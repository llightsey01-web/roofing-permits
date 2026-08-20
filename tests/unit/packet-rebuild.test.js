// tests/unit/packet-rebuild.test.js
// ZIG-17 PR 4 Phase E: idempotent permit_packet rebuild enqueue
'use strict'

const { PDFDocument } = require('pdf-lib')
const {
  queuePermitPacketRebuild,
  findActivePermitPacketRun,
  PERMIT_PACKET_RUN_TYPE,
  REBUILD_REASON_PACKET_STALE,
  REBUILD_INPUT_UNAVAILABLE,
  ACTIVE_RUN_STATUSES,
} = require('../../lib/permits/packet-rebuild.js')
const {
  evaluatePacketFreshness,
  STALE_REASONS,
  NOOP_REASONS,
  STORAGE_FAILED,
} = require('../../lib/permits/packet-freshness.js')
const { computeLiveInputFingerprint } = require('../../lib/permits/packet-fingerprint-adapter.js')
const { sha256Hex } = require('../../lib/permits/packet-fingerprint.js')

function hex(ch) {
  return String(ch).repeat(64)
}

function uniqueViolation() {
  return {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "automation_runs_one_active_permit_packet_uidx"',
  }
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

function isActivePermitPacket(row) {
  return (
    row &&
    row.run_type === PERMIT_PACKET_RUN_TYPE &&
    ACTIVE_RUN_STATUSES.indexOf(row.run_status) !== -1
  )
}

function createRebuildClient(opts) {
  var options = opts || {}
  var state = {
    jobs: (options.jobs || []).map(function (row) {
      return Object.assign({}, row)
    }),
    requirements: options.requirements || [],
    documents: (options.documents || []).slice(),
    company: options.company !== undefined
      ? options.company
      : { id: 'company-a', name: 'Acme Roofing', license_number: 'CCC123' },
    storage: Object.assign({}, options.storage || {}),
    storageErrors: Object.assign({}, options.storageErrors || {}),
    automationRuns: (options.automationRuns || []).map(function (row) {
      return Object.assign({}, row)
    }),
    nextRunId: options.nextRunId || 1,
    insertErrors: (options.insertErrors || []).slice(),
    raceWinner: options.raceWinner || null,
    inserts: [],
    updates: [],
    rpcCalls: [],
    downloads: [],
    uploads: [],
    rpc: options.rpc || null,
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
        var insertError = state.insertErrors.shift()
        if (state.raceWinner) {
          state.automationRuns.push(Object.assign({}, state.raceWinner))
          state.raceWinner = null
        }
        return { data: null, error: insertError }
      }
      if (table === 'automation_runs') {
        var runPayload = Object.assign({}, ctx.payload)
        if (
          isActivePermitPacket(runPayload) &&
          state.automationRuns.some(function (row) {
            return row.job_id === runPayload.job_id && isActivePermitPacket(row)
          })
        ) {
          return { data: null, error: uniqueViolation() }
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
      order: function () {
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
              if (!bytes) {
                return { data: null, error: { message: 'not found: ' + filePath, statusCode: 404 } }
              }
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

function queueArgs(overrides) {
  return Object.assign(
    {
      jobId: 'job-1',
      inputFingerprint: hex('a'),
      reason: REBUILD_REASON_PACKET_STALE,
    },
    overrides || {}
  )
}

function expectTrackedAutomationRunInsert(payload) {
  expect(Object.keys(payload).sort()).toEqual(
    ['attempts', 'job_id', 'payload', 'run_status', 'run_type', 'started_at'].sort()
  )
  expect(payload).not.toHaveProperty('company_id')
  expect(payload).toMatchObject({
    job_id: 'job-1',
    run_type: PERMIT_PACKET_RUN_TYPE,
    run_status: 'queued',
    attempts: 0,
  })
  expect(payload.started_at).toEqual(expect.any(String))
}

function requirementRow() {
  return {
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
  }
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

async function readyRebuildFixture(overrides) {
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
  var mock = createRebuildClient({
    jobs: [job],
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
    automationRuns: data.automationRuns,
    insertErrors: data.insertErrors,
    company: data.company,
  })
  var live = await computeLiveInputFingerprint(mock.client, job)
  if (!live.ok) {
    throw new Error('readyRebuildFixture live fingerprint failed: ' + live.reason)
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
  }
}

describe('queuePermitPacketRebuild validation', function () {
  test('rejects missing jobId', async function () {
    var mock = createRebuildClient()
    await expect(
      queuePermitPacketRebuild(queueArgs({ supabase: mock.client, jobId: '' }))
    ).rejects.toMatchObject({ errorCode: 'packet_rebuild_invalid' })
    expect(mock.state.inserts.length).toBe(0)
  })

  test('succeeds without companyId and does not write company_id', async function () {
    var mock = createRebuildClient()
    var result = await queuePermitPacketRebuild(
      queueArgs({ supabase: mock.client, companyId: undefined })
    )
    expect(result.created).toBe(true)
    expect(mock.state.inserts.length).toBe(1)
    expectTrackedAutomationRunInsert(mock.state.inserts[0].payload)
  })

  test('caller companyId is ignored and not copied onto automation_runs', async function () {
    var mock = createRebuildClient()
    var result = await queuePermitPacketRebuild(
      queueArgs({ supabase: mock.client, companyId: 'company-a' })
    )
    expect(result.created).toBe(true)
    expectTrackedAutomationRunInsert(mock.state.inserts[0].payload)
  })

  test('rejects invalid fingerprint', async function () {
    var mock = createRebuildClient()
    await expect(
      queuePermitPacketRebuild(
        queueArgs({ supabase: mock.client, inputFingerprint: 'ABC'.repeat(21) + 'A' })
      )
    ).rejects.toMatchObject({ errorCode: 'packet_rebuild_invalid' })
    await expect(
      queuePermitPacketRebuild(
        queueArgs({ supabase: mock.client, inputFingerprint: null })
      )
    ).rejects.toMatchObject({ errorCode: 'packet_rebuild_invalid' })
    await expect(
      queuePermitPacketRebuild(
        queueArgs({ supabase: mock.client, inputFingerprint: 'not-a-hash' })
      )
    ).rejects.toMatchObject({ errorCode: 'packet_rebuild_invalid' })
    expect(mock.state.inserts.length).toBe(0)
  })

  test('rejects unsupported reason and extra caller payloads', async function () {
    var mock = createRebuildClient()
    await expect(
      queuePermitPacketRebuild(
        queueArgs({ supabase: mock.client, reason: 'packet_inputs_changed' })
      )
    ).rejects.toMatchObject({ errorCode: 'packet_rebuild_invalid' })
    var result = await queuePermitPacketRebuild(
      queueArgs({
        supabase: mock.client,
        payload: { rebuild_reason: 'injected', extra: true },
      })
    )
    expect(result.created).toBe(true)
    expect(result.run.payload).toEqual({
      rebuild_reason: REBUILD_REASON_PACKET_STALE,
      rebuild_for_input_fingerprint: hex('a'),
    })
    expect(result.run.payload.extra).toBeUndefined()
  })
})

describe('queuePermitPacketRebuild insert', function () {
  test('inserts permit_packet queued with stale marker and input fingerprint', async function () {
    var mock = createRebuildClient()
    var result = await queuePermitPacketRebuild(queueArgs({ supabase: mock.client }))
    expect(result.created).toBe(true)
    expect(result.reused).toBe(false)
    expect(result.run.run_type).toBe(PERMIT_PACKET_RUN_TYPE)
    expect(result.run.run_status).toBe('queued')
    expect(result.run.job_id).toBe('job-1')
    expect(result.run.attempts).toBe(0)
    expect(result.run.started_at).toEqual(expect.any(String))
    expect(result.run.payload).toEqual({
      rebuild_reason: 'packet_stale',
      rebuild_for_input_fingerprint: hex('a'),
    })
    expect(result.run.run_type).not.toBe('permit_phase_1')
    expect(mock.state.inserts.length).toBe(1)
    expect(mock.state.automationRuns.length).toBe(1)
    expectTrackedAutomationRunInsert(mock.state.inserts[0].payload)
  })

  test('allows live-input unavailable markers instead of fabricating a hash', async function () {
    var mock = createRebuildClient()
    var result = await queuePermitPacketRebuild(
      queueArgs({
        supabase: mock.client,
        inputFingerprint: REBUILD_INPUT_UNAVAILABLE.LIVE_INCOMPLETE,
      })
    )
    expect(result.created).toBe(true)
    expect(result.run.payload.rebuild_for_input_fingerprint).toBe('live_incomplete')
  })
})

describe('queuePermitPacketRebuild active-run reuse', function () {
  test('reuses a queued existing run', async function () {
    var existing = {
      id: 'run-existing',
      job_id: 'job-1',
      run_type: PERMIT_PACKET_RUN_TYPE,
      run_status: 'queued',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: hex('z'),
      },
    }
    var mock = createRebuildClient({ automationRuns: [existing] })
    var result = await queuePermitPacketRebuild(queueArgs({ supabase: mock.client }))
    expect(result).toEqual({
      run: existing,
      created: false,
      reused: true,
    })
    expect(mock.state.inserts.length).toBe(0)
    expect(mock.state.automationRuns.length).toBe(1)
  })

  test('reuses a running existing run', async function () {
    var existing = {
      id: 'run-running',
      job_id: 'job-1',
      run_type: PERMIT_PACKET_RUN_TYPE,
      run_status: 'running',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: hex('z'),
      },
    }
    var mock = createRebuildClient({ automationRuns: [existing] })
    var result = await queuePermitPacketRebuild(queueArgs({ supabase: mock.client }))
    expect(result.reused).toBe(true)
    expect(result.created).toBe(false)
    expect(result.run.id).toBe('run-running')
    expect(mock.state.inserts.length).toBe(0)
  })

  test('payload fingerprint difference does not create a second run', async function () {
    var existing = {
      id: 'run-existing',
      job_id: 'job-1',
      run_type: PERMIT_PACKET_RUN_TYPE,
      run_status: 'queued',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: hex('1'),
      },
    }
    var mock = createRebuildClient({ automationRuns: [existing] })
    var result = await queuePermitPacketRebuild(
      queueArgs({ supabase: mock.client, inputFingerprint: hex('2') })
    )
    expect(result.reused).toBe(true)
    expect(result.run.payload.rebuild_for_input_fingerprint).toBe(hex('1'))
    expect(mock.state.automationRuns.length).toBe(1)
  })

  test('ignores completed permit_packet rows and inserts a new queued rebuild', async function () {
    var mock = createRebuildClient({
      automationRuns: [
        {
          id: 'run-done',
          job_id: 'job-1',
          run_type: PERMIT_PACKET_RUN_TYPE,
          run_status: 'complete',
        },
      ],
    })
    var result = await queuePermitPacketRebuild(queueArgs({ supabase: mock.client }))
    expect(result.created).toBe(true)
    expect(mock.state.automationRuns.length).toBe(2)
  })
})

describe('queuePermitPacketRebuild race', function () {
  test('precheck empty, insert 23505, reselect winner, no error', async function () {
    var winner = {
      id: 'run-winner',
      job_id: 'job-1',
      run_type: PERMIT_PACKET_RUN_TYPE,
      run_status: 'queued',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: hex('w'),
      },
    }
    var mock = createRebuildClient({
      insertErrors: [uniqueViolation()],
      raceWinner: winner,
    })
    var result = await queuePermitPacketRebuild(queueArgs({ supabase: mock.client }))
    expect(result.created).toBe(false)
    expect(result.reused).toBe(true)
    expect(result.raced).toBe(true)
    expect(result.run.id).toBe('run-winner')
    expect(mock.state.inserts.length).toBe(0)
  })

  test('23505 with no winner is a retryable write error', async function () {
    var mock = createRebuildClient({ insertErrors: [uniqueViolation()] })
    await expect(
      queuePermitPacketRebuild(queueArgs({ supabase: mock.client }))
    ).rejects.toMatchObject({
      errorCode: 'packet_rebuild_write_failed',
      retryable: true,
    })
  })
})

describe('freshness integration', function () {
  test('invalidated true → exactly one enqueue', async function () {
    var fx = await readyRebuildFixture({ storedInput: hex('b') })
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.invalidated).toBe(true)
    expect(result.reason).toBe(STALE_REASONS.PACKET_INPUTS_CHANGED)
    expect(result.rebuild.created).toBe(true)
    expect(result.rebuild.reused).toBe(false)
    expect(fx.mock.state.inserts.length).toBe(1)
    expect(fx.mock.state.automationRuns.length).toBe(1)
    expect(fx.mock.state.automationRuns[0]).toMatchObject({
      job_id: 'job-1',
      run_type: PERMIT_PACKET_RUN_TYPE,
      run_status: 'queued',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: fx.live.inputFingerprint,
      },
    })
    expectTrackedAutomationRunInsert(fx.mock.state.inserts[0].payload)
  })

  test('CAS mismatch → no enqueue', async function () {
    var fx = await readyRebuildFixture({
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
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.invalidated).toBe(false)
    expect(result.noop_reason).toBe(NOOP_REASONS.FINGERPRINT_CAS_MISMATCH)
    expect(result.rebuild).toBeUndefined()
    expect(fx.mock.state.inserts.length).toBe(0)
  })

  test('not_ready → no enqueue', async function () {
    var mock = createRebuildClient({
      jobs: [sampleJob({ job_status: 'needs_correction' })],
    })
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result.noop_reason).toBe(NOOP_REASONS.NOT_READY)
    expect(result.rebuild).toBeUndefined()
    expect(mock.state.inserts.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('fresh → no enqueue', async function () {
    var fx = await readyRebuildFixture()
    var result = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(result.fresh).toBe(true)
    expect(result.invalidated).toBe(false)
    expect(result.rebuild).toBeUndefined()
    expect(fx.mock.state.inserts.length).toBe(0)
    expect(fx.mock.state.rpcCalls.length).toBe(0)
  })

  test('storage failure → no enqueue', async function () {
    var fx = await readyRebuildFixture({
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
    expect(fx.mock.state.inserts.length).toBe(0)
  })

  test('missing stored fingerprint still enqueues using a live-input marker', async function () {
    var mock = createRebuildClient({
      jobs: [sampleJob({ job_specs: { packet: { complete: true } } })],
      requirements: [requirementRow()],
    })
    var result = await evaluatePacketFreshness('job-1', mock.client)
    expect(result.invalidated).toBe(true)
    expect(result.reason).toBe(STALE_REASONS.MISSING_STORED_FINGERPRINT)
    expect(result.rebuild.created).toBe(true)
    expect(result.rebuild.run.payload).toEqual({
      rebuild_reason: REBUILD_REASON_PACKET_STALE,
      rebuild_for_input_fingerprint: REBUILD_INPUT_UNAVAILABLE.LIVE_INCOMPLETE,
    })
  })

  test('rapid mutations collapse into one active rebuild', async function () {
    var fx = await readyRebuildFixture({ storedInput: hex('b') })
    var first = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(first.invalidated).toBe(true)
    expect(first.rebuild.created).toBe(true)

    var second = await evaluatePacketFreshness('job-1', fx.mock.client)
    expect(second.noop_reason).toBe(NOOP_REASONS.NOT_READY)
    expect(second.rebuild).toBeUndefined()

    var third = await queuePermitPacketRebuild(
      queueArgs({
        supabase: fx.mock.client,
        inputFingerprint: hex('c'),
      })
    )
    expect(third.reused).toBe(true)
    expect(third.created).toBe(false)
    expect(fx.mock.state.automationRuns.length).toBe(1)
    expect(fx.mock.state.inserts.length).toBe(1)
  })
})

describe('findActivePermitPacketRun', function () {
  test('matches the unique-index predicate exactly', async function () {
    var mock = createRebuildClient({
      automationRuns: [
        {
          id: 'run-other-type',
          job_id: 'job-1',
          run_type: 'permit_phase_1',
          run_status: 'queued',
        },
        {
          id: 'run-complete',
          job_id: 'job-1',
          run_type: PERMIT_PACKET_RUN_TYPE,
          run_status: 'complete',
        },
        {
          id: 'run-active',
          job_id: 'job-1',
          run_type: PERMIT_PACKET_RUN_TYPE,
          run_status: 'queued',
        },
      ],
    })
    var active = await findActivePermitPacketRun(mock.client, 'job-1')
    expect(active.id).toBe('run-active')
  })
})
