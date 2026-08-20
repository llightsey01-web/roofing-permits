// tests/unit/permit-packet-assembly.test.js
// ZIG-17 PR 3: population, completeness, assembly, persistence
'use strict'

jest.mock('../../lib/ahj/packet-config.js', function () {
  var actual = jest.requireActual('../../lib/ahj/packet-config.js')
  return Object.assign({}, actual, {
    isPacketConfigValid: jest.fn(actual.isPacketConfigValid),
  })
})

const { PDFDocument } = require('pdf-lib')
const { isPacketConfigValid } = require('../../lib/ahj/packet-config.js')
const {
  runPermitPacket,
  completePermitPacket,
  isStalePacketRebuild,
  RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW,
  JOB_STATUS_NEEDS_REVIEW,
  JOB_STATUS_NEEDS_CORRECTION,
  REBUILD_REASON_PACKET_STALE,
  SKIPPED_READY_INPUT_CHANGED,
  READY_FINGERPRINT_MISMATCH,
} = require('../../lib/automation/permit-packet.js')
const {
  persistRequirementBackedJobDocument,
  persistSubmissionPacketDocument,
  resolveExistingRequirementDocument,
  includedRequirements,
} = require('../../lib/permits/packet-documents.js')
const { mergePdfBuffers } = require('../../lib/documents/packet-merge.js')
const { mergePacketJobSpecs } = require('../../lib/permits/packet-job-specs.js')
const { PACKET_INCOMPLETE_REVIEW_TYPE } = require('../../lib/permits/packet-review.js')
const { persistAssembledSubmissionPacket } = require('../../lib/permits/packet-assembly.js')
const freshness = require('../../lib/permits/packet-freshness.js')
const { selectExecutionFamily } = require('../../lib/automation/workflow-type-dispatch.js')
const { buildStoredFingerprint } = require('../../lib/permits/packet-fingerprint.js')
const {
  resolvedValuesFromFieldValues,
  toOrderedEntry,
} = require('../../lib/permits/packet-fingerprint-adapter.js')

const TEXT_FIELD = 'ApplicantName'

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
      owner_name: 'Ada Owner',
      owner_email: 'ada@example.com',
      property_address: '100 Test Ave',
      property_city: 'Tampa',
      property_state: 'FL',
      property_zip: '33601',
      job_specs: { proof: { transaction_id: 'keep-me' }, squares: 24 },
    },
    overrides || {}
  )
}

async function makePdf(options) {
  var opts = options || {}
  var doc = await PDFDocument.create()
  var pages = opts.pages || 1
  var width = opts.width || 200
  for (var i = 0; i < pages; i++) {
    doc.addPage([width, 280])
  }
  var fieldNames = opts.fieldNames
  if (!fieldNames && opts.fieldName) fieldNames = [opts.fieldName]
  if (fieldNames && fieldNames.length) {
    var form = doc.getForm()
    for (var fi = 0; fi < fieldNames.length; fi++) {
      var field = form.createTextField(fieldNames[fi])
      field.addToPage(doc.getPages()[0], {
        x: 20,
        y: 200 - fi * 24,
        width: 160,
        height: 18,
      })
    }
  }
  return Buffer.from(await doc.save())
}

function matchesFilters(row, filters) {
  return Object.keys(filters).every(function (key) {
    return row[key] === filters[key]
  })
}

function createPacketClient(opts) {
  var options = opts || {}
  var state = {
    requirements: options.requirements || [requirementRow()],
    documents: (options.documents || []).slice(),
    company: options.company !== undefined
      ? options.company
      : { id: 'company-a', name: 'Acme Roofing', license_number: 'CCC123' },
    jobSpecs: options.jobSpecs || { proof: { transaction_id: 'keep-me' }, squares: 24 },
    reviews: (options.reviews || []).slice(),
    storage: Object.assign({}, options.storage || {}),
    liveJob: options.liveJob ? Object.assign({}, options.liveJob) : sampleJob(),
    rpcCalls: [],
    runUpdates: [],
    jobUpdates: [],
    reviewInserts: [],
    reviewUpdates: [],
    actionInserts: [],
    actionUpdates: [],
    documentInserts: [],
    documentUpdates: [],
    uploads: [],
    documentInsertError: options.documentInsertError || null,
    uniqueRaceWinner: options.uniqueRaceWinner || null,
    uniqueRaceWinners: options.uniqueRaceWinners || null,
    reviewInsertError: options.reviewInsertError || null,
    nextDocId: 100,
    nextReviewId: 500,
  }

  function execute(ctx) {
    var table = ctx.table
    var filters = ctx.filters
    var payload = ctx.payload

    if (ctx.op === 'select') {
      var rows = []
      if (table === 'ahj_document_requirements') {
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
      } else if (table === 'job_documents') {
        rows = state.documents.filter(function (row) {
          return matchesFilters(row, filters)
        })
      } else if (table === 'companies') {
        rows = state.company && matchesFilters(state.company, filters) ? [state.company] : []
        if (!filters.id && state.company) rows = [state.company]
      } else if (table === 'jobs') {
        rows = [
          Object.assign({}, state.liveJob, {
            id: 'job-1',
            company_id: state.liveJob.company_id || 'company-a',
            job_specs: state.jobSpecs,
          }),
        ]
      } else if (table === 'review_requests') {
        rows = state.reviews.filter(function (row) {
          return matchesFilters(row, filters)
        })
      }
      if (ctx.mode === 'single' || ctx.mode === 'maybe') {
        return { data: rows[0] || null, error: null }
      }
      return { data: rows, error: null }
    }

    if (ctx.op === 'insert') {
      if (table === 'job_documents') {
        if (state.documentInsertError) {
          var winners = Array.isArray(state.uniqueRaceWinners)
            ? state.uniqueRaceWinners
            : state.uniqueRaceWinner
              ? [state.uniqueRaceWinner]
              : []
          winners.forEach(function (winner) {
            state.documents.push(Object.assign({}, winner))
          })
          return { data: null, error: state.documentInsertError }
        }
        var docId = 'doc-' + state.nextDocId++
        var saved = Object.assign({ id: docId }, payload)
        state.documents.push(saved)
        state.documentInserts.push(saved)
        return { data: { id: docId }, error: null }
      }
      if (table === 'review_requests') {
        if (state.reviewInsertError) {
          return { data: null, error: state.reviewInsertError }
        }
        var reviewId = 'rev-' + state.nextReviewId++
        var review = Object.assign({ id: reviewId }, payload)
        state.reviews.push(review)
        state.reviewInserts.push(review)
        return { data: { id: reviewId }, error: null }
      }
      if (table === 'job_actions') {
        state.actionInserts.push(payload)
        return { data: { id: 'action-ins-1' }, error: null }
      }
      return { data: { id: 'ins-1' }, error: null }
    }

    if (ctx.op === 'update') {
      if (table === 'job_documents') {
        state.documentUpdates.push({ filters: Object.assign({}, filters), payload: payload })
        state.documents.forEach(function (row) {
          if (matchesFilters(row, filters)) Object.assign(row, payload)
        })
      } else if (table === 'jobs') {
        state.jobUpdates.push(payload)
        if (payload.job_specs) state.jobSpecs = payload.job_specs
      } else if (table === 'automation_runs') {
        state.runUpdates.push(payload)
      } else if (table === 'review_requests') {
        state.reviewUpdates.push({ filters: Object.assign({}, filters), payload: payload })
        state.reviews.forEach(function (row) {
          if (matchesFilters(row, filters)) Object.assign(row, payload)
        })
      } else if (table === 'job_actions') {
        state.actionUpdates.push({ filters: Object.assign({}, filters), payload: payload })
      }
      return { data: null, error: null }
    }

    return { data: null, error: { message: 'unsupported op ' + ctx.op } }
  }

  function chainFor(table) {
    var ctx = { table: table, filters: {}, payload: null, op: 'select', mode: 'list', orders: [] }
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
        ctx.inFilters = ctx.inFilters || {}
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
        if (typeof options.rpc === 'function') {
          return options.rpc(name, args, state.rpcCalls.length)
        }
        if (name === 'complete_permit_packet') {
          return {
            data: {
              ok: true,
              job_id: args.p_job_id,
              company_id: 'company-a',
              action_id: 'action-1',
              action_created: true,
              job_status: 'ready_for_physical_submission',
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
              var bytes = state.storage[filePath]
              if (!bytes) return { data: null, error: { message: 'not found: ' + filePath } }
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
              state.storage[filePath] = bytes
              if (options.uploadError) return { error: options.uploadError }
              return { error: null }
            },
          }
        },
      },
    },
  }
}

describe('permit-packet assembly (ZIG-17 PR 3)', function () {
  test('valid complete packet persists submission_packet and sets run_status complete', async function () {
    var pdf = await makePdf({ pages: 1 })
    var mock = createPacketClient({
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
      storage: { 'jobs/job-1/product.pdf': pdf },
    })

    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })

    expect(result.complete).toBe(true)
    expect(result.ready).toBe(true)
    expect(result.jobStatus).toBe('ready_for_physical_submission')
    expect(result.submissionPacketDocumentId).toBeTruthy()
    expect(result.filePath).toBe('jobs/job-1/generated/submission-packet.pdf')
    expect(mock.state.rpcCalls.length).toBe(1)
    expect(mock.state.rpcCalls[0].name).toBe('complete_permit_packet')
    expect(mock.state.rpcCalls[0].args.p_job_id).toBe('job-1')
    expect(mock.state.rpcCalls[0].args.p_fingerprint).toEqual(result.fingerprint)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_COMPLETE)
    expect(mock.state.runUpdates[0].completed_at).toBeTruthy()
    expect(mock.state.runUpdates[0].checkpoint_data).toMatchObject({
      packet_assembled: true,
      document_id: result.submissionPacketDocumentId,
      file_path: result.filePath,
      ready: true,
      skipped_ready_reason: null,
    })
    expect(mock.state.jobUpdates[0].job_status).toBeUndefined()
    expect(mock.state.jobUpdates[0].job_specs.proof.transaction_id).toBe('keep-me')
    expect(mock.state.jobUpdates[0].job_specs.squares).toBe(24)
    expect(mock.state.jobUpdates[0].job_specs.packet.complete).toBe(true)
    expect(mock.state.jobUpdates[0].job_specs.packet.artifacts.submission_packet.document_id).toBe(
      result.submissionPacketDocumentId
    )
    expect(mock.state.jobUpdates[0].job_specs.packet.artifacts.generated[0]).toMatchObject({
      requirement_id: 'req-1',
      document_id: 'doc-bound',
      document_role: 'product_approval',
      source_type: 'contractor_uploaded',
      file_path: 'jobs/job-1/product.pdf',
    })
    expect(mock.state.documentInserts.some(function (row) {
      return row.document_type === 'submission_packet'
    })).toBe(true)
  })

  test('incomplete required contractor document does not create submission_packet', async function () {
    var mock = createPacketClient({ documents: [] })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })

    expect(result.complete).toBe(false)
    expect(result.submissionPacketDocumentId).toBeNull()
    expect(result.jobStatus).toBe(JOB_STATUS_NEEDS_REVIEW)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.jobUpdates[0].job_status).toBe(JOB_STATUS_NEEDS_REVIEW)
    expect(mock.state.jobUpdates[0].job_specs.packet.complete).toBe(false)
    expect(mock.state.jobUpdates[0].job_specs.packet.problems[0].code).toBe(
      'required_document_missing'
    )
    expect(mock.state.reviewInserts[0].review_type).toBe(PACKET_INCOMPLETE_REVIEW_TYPE)
    expect(mock.state.reviewInserts[0].review_status).toBe('pending')
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('isStalePacketRebuild uses payload or durable stale, never job_status alone', function () {
    var staleSpecs = { packet: { stale: { reason: 'input_changed' } } }
    expect(isStalePacketRebuild({ payload: { rebuild_reason: REBUILD_REASON_PACKET_STALE } }, {})).toBe(true)
    expect(isStalePacketRebuild({ id: 'run-1' }, staleSpecs)).toBe(true)
    expect(
      isStalePacketRebuild(
        { payload: { rebuild_reason: REBUILD_REASON_PACKET_STALE } },
        staleSpecs
      )
    ).toBe(true)
    expect(isStalePacketRebuild({ payload: {} }, { packet: { complete: false } })).toBe(false)
    expect(isStalePacketRebuild({ payload: { rebuild_reason: 'manual' } }, {})).toBe(false)
    expect(isStalePacketRebuild({ payload: { rebuild_reason: REBUILD_REASON_PACKET_STALE } }, null)).toBe(true)
    expect(isStalePacketRebuild({ id: 'run-1' }, { packet: { stale: null } })).toBe(false)
  })

  test('stale-origin incomplete via payload keeps needs_correction and packet_incomplete', async function () {
    var mock = createPacketClient({
      documents: [],
      liveJob: sampleJob({ job_status: JOB_STATUS_NEEDS_CORRECTION }),
    })
    var result = await runPermitPacket(mock.client, sampleJob({ job_status: JOB_STATUS_NEEDS_CORRECTION }), {
      id: 'run-stale-payload',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: 'b'.repeat(64),
      },
    })

    expect(result.complete).toBe(false)
    expect(result.ready).toBe(false)
    expect(result.jobStatus).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.jobUpdates[0].job_status).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.jobUpdates[0].job_specs.packet.complete).toBe(false)
    expect(mock.state.reviewInserts[0].review_type).toBe(PACKET_INCOMPLETE_REVIEW_TYPE)
    expect(mock.state.reviewInserts[0].review_status).toBe('pending')
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.actionInserts.length).toBe(0)
    expect(mock.state.actionUpdates.length).toBe(0)
  })

  test('stale-origin incomplete via durable packet.stale keeps needs_correction', async function () {
    var fingerprintB = {
      version: 1,
      input_fingerprint: 'b'.repeat(64),
      content_fingerprint: 'c'.repeat(64),
      computed_at: '2026-08-01T00:00:00.000Z',
      artifacts: [],
    }
    var history = [
      {
        version: 1,
        input_fingerprint: 'a'.repeat(64),
        content_fingerprint: 'd'.repeat(64),
        computed_at: '2026-07-01T00:00:00.000Z',
        artifacts: [],
      },
    ]
    var stale = {
      reason: 'input_changed',
      observed_input_fingerprint: 'e'.repeat(64),
      observed_at: '2026-08-19T12:00:00.000Z',
    }
    var mock = createPacketClient({
      documents: [],
      liveJob: sampleJob({ job_status: JOB_STATUS_NEEDS_CORRECTION }),
      jobSpecs: {
        proof: { transaction_id: 'keep-me' },
        squares: 24,
        packet: {
          fingerprint: fingerprintB,
          fingerprint_history: history,
          stale: stale,
          complete: true,
        },
      },
    })
    var result = await runPermitPacket(mock.client, sampleJob({ job_status: JOB_STATUS_NEEDS_CORRECTION }), {
      id: 'run-stale-marker',
    })

    expect(result.complete).toBe(false)
    expect(result.jobStatus).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.jobUpdates[0].job_status).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.jobUpdates[0].job_specs.packet.complete).toBe(false)
    expect(mock.state.jobUpdates[0].job_specs.packet.fingerprint).toEqual(fingerprintB)
    expect(mock.state.jobUpdates[0].job_specs.packet.fingerprint_history).toEqual(history)
    expect(mock.state.jobUpdates[0].job_specs.packet.stale).toEqual(stale)
    expect(mock.state.jobUpdates[0].job_specs.proof.transaction_id).toBe('keep-me')
    expect(mock.state.reviewInserts[0].review_type).toBe(PACKET_INCOMPLETE_REVIEW_TYPE)
    expect(mock.state.reviewInserts[0].review_status).toBe('pending')
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.actionInserts.length).toBe(0)
    expect(mock.state.actionUpdates.length).toBe(0)
  })

  test('both stale signals still yield one needs_correction incomplete outcome', async function () {
    var fingerprintB = {
      version: 1,
      input_fingerprint: 'b'.repeat(64),
      content_fingerprint: 'c'.repeat(64),
      computed_at: '2026-08-01T00:00:00.000Z',
      artifacts: [],
    }
    var stale = { reason: 'input_changed', observed_at: '2026-08-19T12:00:00.000Z' }
    var mock = createPacketClient({
      documents: [],
      jobSpecs: {
        packet: {
          fingerprint: fingerprintB,
          fingerprint_history: [],
          stale: stale,
        },
      },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), {
      id: 'run-both',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: fingerprintB.input_fingerprint,
      },
    })

    expect(result.jobStatus).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.jobUpdates[0].job_status).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.reviewInserts.length).toBe(1)
    expect(mock.state.reviewInserts[0].review_type).toBe(PACKET_INCOMPLETE_REVIEW_TYPE)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('unrelated needs_correction without stale signals keeps first-time incomplete review', async function () {
    var mock = createPacketClient({
      documents: [],
      liveJob: sampleJob({ job_status: JOB_STATUS_NEEDS_CORRECTION }),
      jobSpecs: { proof: { transaction_id: 'keep-me' }, squares: 24 },
    })
    var result = await runPermitPacket(
      mock.client,
      sampleJob({ job_status: JOB_STATUS_NEEDS_CORRECTION }),
      { id: 'run-unrelated' }
    )

    expect(result.jobStatus).toBe(JOB_STATUS_NEEDS_REVIEW)
    expect(mock.state.jobUpdates[0].job_status).toBe(JOB_STATUS_NEEDS_REVIEW)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.reviewInserts[0].review_type).toBe(PACKET_INCOMPLETE_REVIEW_TYPE)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('optional missing document is skipped with informational problem', async function () {
    var pdf = await makePdf()
    var mock = createPacketClient({
      requirements: [
        requirementRow(),
        requirementRow({
          id: 'req-opt',
          document_role: 'site_plan',
          display_name: 'Site Plan',
          required: false,
          sort_order: 20,
        }),
      ],
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
      storage: { 'jobs/job-1/product.pdf': pdf },
    })

    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    var problems = mock.state.jobUpdates[0].job_specs.packet.problems
    expect(problems.some(function (p) { return p.code === 'optional_document_missing' })).toBe(true)
    expect(problems.find(function (p) { return p.code === 'optional_document_missing' }).source_type).toBe(
      'contractor_uploaded'
    )
  })

  test('requirement-bound row wins over legacy fallback', async function () {
    var boundPdf = await makePdf({ pages: 1, width: 111 })
    var legacyPdf = await makePdf({ pages: 2, width: 333 })
    var mock = createPacketClient({
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/bound.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-legacy',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/legacy.pdf',
          ahj_document_requirement_id: null,
        },
      ],
      storage: {
        'jobs/job-1/bound.pdf': boundPdf,
        'jobs/job-1/legacy.pdf': legacyPdf,
      },
    })

    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    expect(result.jobSpecsPacket.artifacts.generated[0].document_id).toBe('doc-bound')
    var merged = await PDFDocument.load(mock.state.uploads[0].bytes)
    expect(merged.getPageCount()).toBe(1)
    expect(merged.getPage(0).getSize().width).toBe(111)
  })

  test('exactly one legacy fallback is used when no bound row exists', async function () {
    var pdf = await makePdf()
    var mock = createPacketClient({
      documents: [
        {
          id: 'doc-legacy',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/legacy.pdf',
          ahj_document_requirement_id: null,
        },
      ],
      storage: { 'jobs/job-1/legacy.pdf': pdf },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    expect(result.jobSpecsPacket.artifacts.generated[0].document_id).toBe('doc-legacy')
    expect(mock.state.documents.find(function (row) {
      return row.id === 'doc-legacy'
    }).ahj_document_requirement_id).toBeNull()
  })

  test('multiple legacy fallback rows are ambiguous_legacy_document', async function () {
    var pdf = await makePdf()
    var mock = createPacketClient({
      documents: [
        {
          id: 'legacy-a',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/a.pdf',
          ahj_document_requirement_id: null,
        },
        {
          id: 'legacy-b',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/b.pdf',
          ahj_document_requirement_id: null,
        },
      ],
      storage: { 'jobs/job-1/a.pdf': pdf, 'jobs/job-1/b.pdf': pdf },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(false)
    var problem = result.jobSpecsPacket.problems[0]
    expect(problem.code).toBe('ambiguous_legacy_document')
    expect(problem.requirement_id).toBe('req-1')
    expect(problem.document_role).toBe('product_approval')
    expect(problem.candidate_document_ids.sort()).toEqual(['legacy-a', 'legacy-b'])
    expect(mock.state.documentInserts.length).toBe(0)
  })

  test('human_obtained resolves like contractor_uploaded but keeps source_type', async function () {
    var pdf = await makePdf()
    var mock = createPacketClient({
      requirements: [requirementRow({ source_type: 'human_obtained' })],
      documents: [
        {
          id: 'doc-human',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/human.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
      storage: { 'jobs/job-1/human.pdf': pdf },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    expect(result.jobSpecsPacket.artifacts.generated[0].source_type).toBe('human_obtained')
  })

  test('unknown generated role fails closed before persist', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          document_role: 'mystery_form',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: {
            fields: [
              {
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })
    await expect(runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })).rejects.toMatchObject({
      errorCode: 'packet_config_invalid',
      nonRetryable: true,
    })
    expect(mock.state.uploads.length).toBe(0)
    expect(mock.state.documentInserts.length).toBe(0)
  })

  test('unknown source type fails closed as packet_config_invalid', async function () {
    var mock = createPacketClient({
      requirements: [requirementRow({ source_type: 'portal_scraped' })],
    })
    await expect(runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })).rejects.toMatchObject({
      errorCode: 'packet_config_invalid',
      nonRetryable: true,
    })
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.documentInserts.length).toBe(0)
  })

  test('strict generated permit application fill flattens and persists', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var mock = createPacketClient({
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
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
                autofit: true,
                maxChars: 80,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })

    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    var generated = mock.state.documentInserts.find(function (row) {
      return row.ahj_document_requirement_id === 'req-app'
    })
    expect(generated.document_type).toBe('permit_application')
    expect(generated.file_path).toBe('jobs/job-1/generated/req-app/permit_application.pdf')
    var roundTrip = await PDFDocument.load(mock.state.storage[generated.file_path])
    expect(roundTrip.getForm().getFields().length).toBe(0)
  })

  test('strict field-map failure is non-retryable config', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          document_role: 'permit_application',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: { ApplicantName: 'job.owner_name' },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })
    await expect(runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })).rejects.toMatchObject({
      errorCode: 'packet_config_invalid',
      nonRetryable: true,
    })
  })

  test('required source completeness failure is packet incomplete', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          document_role: 'permit_application',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: {
            fields: [
              {
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })
    var result = await runPermitPacket(
      mock.client,
      sampleJob({ owner_name: '' }),
      { id: 'run-1' }
    )
    expect(result.complete).toBe(false)
    expect(result.jobSpecsPacket.problems[0].code).toBe('required_source_missing')
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(result.fingerprint).toBeNull()
  })

  test('invalid required PDF prevents packet', async function () {
    var mock = createPacketClient({
      documents: [
        {
          id: 'doc-bad',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/not.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
      storage: { 'jobs/job-1/not.pdf': Buffer.from('not-a-pdf') },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(false)
    expect(result.jobSpecsPacket.problems[0].code).toBe('invalid_pdf')
    expect(mock.state.documentInserts.length).toBe(0)
  })

  test('invalid optional PDF is skipped with informational diagnostic', async function () {
    var pdf = await makePdf()
    var mock = createPacketClient({
      requirements: [
        requirementRow(),
        requirementRow({
          id: 'req-opt',
          document_role: 'site_plan',
          display_name: 'Site Plan',
          required: false,
          sort_order: 20,
        }),
      ],
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
        {
          id: 'doc-opt',
          job_id: 'job-1',
          document_type: 'site_plan',
          file_path: 'jobs/job-1/opt.pdf',
          ahj_document_requirement_id: 'req-opt',
        },
      ],
      storage: {
        'jobs/job-1/product.pdf': pdf,
        'jobs/job-1/opt.pdf': Buffer.from('not-a-pdf'),
      },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    expect(result.jobSpecsPacket.problems.some(function (p) {
      return p.code === 'invalid_pdf' && p.requirement_id === 'req-opt'
    })).toBe(true)
  })

  test('merge order follows requirement sort_order then document_role', async function () {
    var first = await makePdf({ pages: 1, width: 120 })
    var second = await makePdf({ pages: 1, width: 340 })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          id: 'req-b',
          document_role: 'site_plan',
          display_name: 'Site Plan',
          sort_order: 20,
        }),
        requirementRow({
          id: 'req-a',
          document_role: 'product_approval',
          sort_order: 10,
        }),
      ],
      documents: [
        {
          id: 'doc-a',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/a.pdf',
          ahj_document_requirement_id: 'req-a',
        },
        {
          id: 'doc-b',
          job_id: 'job-1',
          document_type: 'site_plan',
          file_path: 'jobs/job-1/b.pdf',
          ahj_document_requirement_id: 'req-b',
        },
      ],
      storage: {
        'jobs/job-1/a.pdf': first,
        'jobs/job-1/b.pdf': second,
      },
    })
    await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    var merged = await PDFDocument.load(
      mock.state.uploads.find(function (u) {
        return u.filePath.indexOf('submission-packet') !== -1
      }).bytes
    )
    expect(merged.getPageCount()).toBe(2)
    expect(merged.getPage(0).getSize().width).toBe(120)
    expect(merged.getPage(1).getSize().width).toBe(340)
  })

  test('packet review dedups pending and resolves to resolved only for packet_incomplete', async function () {
    var pdf = await makePdf()
    var mock = createPacketClient({
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
      storage: { 'jobs/job-1/product.pdf': pdf },
      reviews: [
        {
          id: 'rev-packet',
          job_id: 'job-1',
          review_type: 'packet_incomplete',
          review_status: 'pending',
        },
        {
          id: 'rev-noc',
          job_id: 'job-1',
          review_type: 'noc_before_send',
          review_status: 'pending',
        },
      ],
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    expect(mock.state.reviewInserts.length).toBe(0)
    var packetReview = mock.state.reviews.find(function (row) {
      return row.id === 'rev-packet'
    })
    var nocReview = mock.state.reviews.find(function (row) {
      return row.id === 'rev-noc'
    })
    expect(packetReview.review_status).toBe('resolved')
    expect(packetReview.reviewer_id).toBeNull()
    expect(packetReview.reviewed_at).toBeTruthy()
    expect(nocReview.review_status).toBe('pending')
  })

  test('storage success and DB failure throws without claiming success', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          document_role: 'permit_application',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: {
            fields: [
              {
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
      documentInsertError: { message: 'db down', code: 'XX000' },
    })
    await expect(runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })).rejects.toMatchObject({
      errorCode: 'packet_document_write_failed',
    })
    expect(mock.state.uploads.length).toBeGreaterThan(0)
    expect(mock.state.runUpdates.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('23505 reuses the winning canonical row', async function () {
    var mock = createPacketClient({
      documents: [],
      uniqueRaceWinner: {
        id: 'winner',
        job_id: 'job-1',
        ahj_document_requirement_id: 'req-app',
        document_type: 'permit_application',
        file_path: 'old.pdf',
      },
      documentInsertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    })
    var result = await persistRequirementBackedJobDocument(mock.client, {
      jobId: 'job-1',
      requirementId: 'req-app',
      documentType: 'permit_application',
      fileName: 'Permit Application.pdf',
      filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
      fileSizeBytes: 12,
    })
    expect(result.id).toBe('winner')
    expect(result.reused).toBe(true)
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.documentUpdates[0].payload.file_path).toBe(
      'jobs/job-1/generated/req-app/permit_application.pdf'
    )
  })

  test('requirement-backed multi-row lookup throws identity conflict and does not update', async function () {
    var mock = createPacketClient({
      documents: [
        {
          id: 'dup-a',
          job_id: 'job-1',
          ahj_document_requirement_id: 'req-app',
          document_type: 'permit_application',
          file_path: 'a.pdf',
        },
        {
          id: 'dup-b',
          job_id: 'job-1',
          ahj_document_requirement_id: 'req-app',
          document_type: 'permit_application',
          file_path: 'b.pdf',
        },
      ],
    })
    await expect(
      persistRequirementBackedJobDocument(mock.client, {
        jobId: 'job-1',
        requirementId: 'req-app',
        documentType: 'permit_application',
        fileName: 'Permit Application.pdf',
        filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
      })
    ).rejects.toMatchObject({
      errorCode: 'packet_document_identity_conflict',
      nonRetryable: true,
      identity_kind: 'requirement',
      job_id: 'job-1',
      requirement_id: 'req-app',
    })
    expect(mock.state.documentUpdates.length).toBe(0)
  })

  test('submission_packet multi-row lookup throws identity conflict and does not update', async function () {
    var mock = createPacketClient({
      documents: [
        {
          id: 'packet-a',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
        {
          id: 'packet-b',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet-old.pdf',
        },
      ],
    })
    await expect(
      persistSubmissionPacketDocument(mock.client, {
        jobId: 'job-1',
        fileName: 'Submission Packet.pdf',
        filePath: 'jobs/job-1/generated/submission-packet.pdf',
      })
    ).rejects.toMatchObject({
      errorCode: 'packet_document_identity_conflict',
      nonRetryable: true,
      identity_kind: 'submission_packet',
      job_id: 'job-1',
      document_type: 'submission_packet',
    })
    expect(mock.state.documentUpdates.length).toBe(0)
  })

  test('23505 retry lookup with two rows throws identity conflict', async function () {
    var mock = createPacketClient({
      documents: [],
      uniqueRaceWinners: [
        {
          id: 'winner-a',
          job_id: 'job-1',
          ahj_document_requirement_id: 'req-app',
          document_type: 'permit_application',
          file_path: 'a.pdf',
        },
        {
          id: 'winner-b',
          job_id: 'job-1',
          ahj_document_requirement_id: 'req-app',
          document_type: 'permit_application',
          file_path: 'b.pdf',
        },
      ],
      documentInsertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    })
    await expect(
      persistRequirementBackedJobDocument(mock.client, {
        jobId: 'job-1',
        requirementId: 'req-app',
        documentType: 'permit_application',
        fileName: 'Permit Application.pdf',
        filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
      })
    ).rejects.toMatchObject({
      errorCode: 'packet_document_identity_conflict',
      nonRetryable: true,
      candidate_document_ids: ['winner-a', 'winner-b'],
    })
    expect(mock.state.documentUpdates.length).toBe(0)
  })

  test('missing configured DART template is terminal packet_config_invalid', async function () {
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          document_role: 'permit_application',
          display_name: 'Permit Application',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: {
            fields: [
              {
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: {},
    })
    await expect(runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })).rejects.toMatchObject({
      errorCode: 'packet_config_invalid',
      nonRetryable: true,
    })
    try {
      await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    } catch (err) {
      expect(err.problems[0].code).toBe('template_storage_missing')
      expect(err.problems[0].requirement_id).toBe('req-1')
      expect(err.problems[0].document_role).toBe('permit_application')
      expect(err.problems[0].display_name).toBe('Permit Application')
      expect(err.problems[0].source_type).toBe('dart_generated')
      expect(err.problems[0].template_storage_path).toBe('templates/app.pdf')
    }
    expect(mock.state.uploads.length).toBe(0)
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.runUpdates.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('generated-output upload failure remains packet_document_write_failed', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          document_role: 'permit_application',
          source_type: 'dart_generated',
          template_storage_path: 'templates/app.pdf',
          field_map: {
            fields: [
              {
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
      uploadError: { message: 'storage unavailable' },
    })
    await expect(runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })).rejects.toMatchObject({
      errorCode: 'packet_document_write_failed',
    })
    try {
      await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    } catch (err) {
      expect(err.nonRetryable).not.toBe(true)
    }
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.runUpdates.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
  })

  test('empty mergeBytes is incomplete empty_packet even when ZIG-10 is bypassed', async function () {
    isPacketConfigValid.mockReturnValueOnce({ valid: true })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          required: false,
          include_in_submission_packet: true,
        }),
      ],
      documents: [],
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(false)
    expect(result.jobSpecsPacket.complete).toBe(false)
    expect(result.jobSpecsPacket.problems[0].code).toBe('empty_packet')
    expect(result.jobSpecsPacket.problems[0].message).toMatch(
      /No valid packet artifacts were resolved for submission/
    )
    expect(mock.state.reviewInserts[0].review_type).toBe(PACKET_INCOMPLETE_REVIEW_TYPE)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.uploads.length).toBe(0)
    expect(mock.state.documentInserts.length).toBe(0)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(result.fingerprint).toBeNull()
  })

  test('submission_packet upsert is idempotent on retry', async function () {
    var mock = createPacketClient({
      documents: [
        {
          id: 'packet-1',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
      ],
    })
    var first = await persistSubmissionPacketDocument(mock.client, {
      jobId: 'job-1',
      fileName: 'Submission Packet.pdf',
      filePath: 'jobs/job-1/generated/submission-packet.pdf',
      fileSizeBytes: 99,
    })
    expect(first.reused).toBe(true)
    expect(first.id).toBe('packet-1')
    expect(mock.state.documentInserts.length).toBe(0)
  })

  test('pdf_packet dispatch family still does not load Playwright', function () {
    expect(selectExecutionFamily('pdf_packet')).toBe('pdf_packet')
    expect(selectExecutionFamily('portal')).toBe('portal')
  })

  test('includedRequirements ignores rows not in the packet', function () {
    var rows = includedRequirements([
      requirementRow({ include_in_submission_packet: true }),
      requirementRow({ id: 'req-out', include_in_submission_packet: false }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('req-1')
  })

  test('mergePdfBuffers concatenates in caller order', async function () {
    var a = await makePdf({ pages: 1, width: 101 })
    var b = await makePdf({ pages: 2, width: 202 })
    var merged = await mergePdfBuffers([b, a])
    var doc = await PDFDocument.load(merged)
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(0).getSize().width).toBe(202)
    expect(doc.getPage(2).getSize().width).toBe(101)
  })

  test('job_specs merge preserves unrelated keys and last-ready fingerprint', function () {
    var fingerprintB = {
      version: 1,
      input_fingerprint: 'b'.repeat(64),
      content_fingerprint: 'c'.repeat(64),
      computed_at: '2026-08-01T00:00:00.000Z',
      artifacts: [],
    }
    var history = [
      {
        version: 1,
        input_fingerprint: 'a'.repeat(64),
        content_fingerprint: 'd'.repeat(64),
        computed_at: '2026-07-01T00:00:00.000Z',
        artifacts: [],
      },
    ]
    var stale = {
      reason: 'input_changed',
      observed_input_fingerprint: 'e'.repeat(64),
    }
    var merged = mergePacketJobSpecs(
      {
        proof: { transaction_id: 'abc' },
        erecord: { provider: 'epn' },
        packet: {
          fingerprint: fingerprintB,
          fingerprint_history: history,
          stale: stale,
          complete: true,
        },
      },
      {
        version: 1,
        complete: true,
        evaluated_at: '2026-08-20T00:00:00.000Z',
        ahj_id: 'ahj-1',
        included_requirement_ids: ['req-1'],
        problems: [],
        artifacts: { generated: [], submission_packet: { document_id: 'new-packet' } },
        fingerprint: {
          version: 1,
          input_fingerprint: 'a'.repeat(64),
          content_fingerprint: 'f'.repeat(64),
          computed_at: '2026-08-20T00:00:00.000Z',
          artifacts: [],
        },
        fingerprint_history: [],
        stale: null,
      }
    )
    expect(merged.proof.transaction_id).toBe('abc')
    expect(merged.erecord.provider).toBe('epn')
    expect(merged.packet.complete).toBe(true)
    expect(merged.packet.evaluated_at).toBe('2026-08-20T00:00:00.000Z')
    expect(merged.packet.artifacts.submission_packet.document_id).toBe('new-packet')
    expect(merged.packet.fingerprint).toEqual(fingerprintB)
    expect(merged.packet.fingerprint_history).toEqual(history)
    expect(merged.packet.stale).toEqual(stale)
  })

  test('legacy resolver is fail-closed on ambiguity', function () {
    var result = resolveExistingRequirementDocument(requirementRow(), [
      { id: 'a', document_type: 'product_approval', ahj_document_requirement_id: null },
      { id: 'b', document_type: 'product_approval', ahj_document_requirement_id: null },
    ])
    expect(result.kind).toBe('ambiguous')
    expect(result.problem.candidate_document_ids).toEqual(['a', 'b'])
  })

  test('resolvedValuesFromFieldValues maps source paths and missing to null', function () {
    expect(resolvedValuesFromFieldValues(null)).toEqual({})
    expect(
      resolvedValuesFromFieldValues([
        { source: 'job.owner_name', hasValue: true, value: 'Ada' },
        { source: 'job.property_city', hasValue: false, value: null },
        { source: 'job.owner_name', hasValue: true, value: 'Ignored duplicate' },
      ])
    ).toEqual({
      'job.owner_name': 'Ada',
      'job.property_city': null,
    })
  })

  test('toOrderedEntry keeps bytes by reference and does not invent resolvedValues', function () {
    var bytesA = Buffer.from('first')
    var bytesB = Buffer.from('second')
    var first = toOrderedEntry(
      sampleJob(),
      requirementRow({ id: 'req-b', sort_order: 20, document_role: 'site_plan' }),
      {
        bytes: bytesA,
        document: {
          id: 'doc-b',
          document_type: 'site_plan',
          file_path: 'jobs/job-1/b.pdf',
        },
      }
    )
    var second = toOrderedEntry(
      sampleJob(),
      requirementRow({
        id: 'req-a',
        sort_order: 10,
        source_type: 'dart_generated',
        field_map: { fields: [{ source: 'job.owner_name' }] },
      }),
      {
        bytes: bytesB,
        parsedFieldMap: {
          fields: [{ pdfField: TEXT_FIELD, source: 'job.owner_name', type: 'text' }],
        },
        fieldValues: [{ source: 'job.owner_name', hasValue: true, value: 'Ada Owner' }],
        document: {
          id: 'doc-a',
          document_type: 'permit_application',
          file_path: 'jobs/job-1/a.pdf',
        },
      }
    )
    var ordered = [first, second]
    expect(ordered[0].artifact.bytes).toBe(bytesA)
    expect(ordered[1].artifact.bytes).toBe(bytesB)
    expect(ordered.map(function (row) { return row.requirement.id })).toEqual([
      'req-b',
      'req-a',
    ])
    expect(first.resolvedValues).toEqual({})
    expect(second.resolvedValues).toEqual({ 'job.owner_name': 'Ada Owner' })
  })

  test('complete packet orderedEntries match mergeBytes and call complete_permit_packet', async function () {
    var first = await makePdf({ pages: 1, width: 120 })
    var second = await makePdf({ pages: 1, width: 340 })
    var mock = createPacketClient({
      requirements: [
        requirementRow({
          id: 'req-b',
          document_role: 'site_plan',
          display_name: 'Site Plan',
          sort_order: 20,
        }),
        requirementRow({
          id: 'req-a',
          document_role: 'product_approval',
          sort_order: 10,
        }),
      ],
      documents: [
        {
          id: 'doc-a',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/a.pdf',
          ahj_document_requirement_id: 'req-a',
        },
        {
          id: 'doc-b',
          job_id: 'job-1',
          document_type: 'site_plan',
          file_path: 'jobs/job-1/b.pdf',
          ahj_document_requirement_id: 'req-b',
        },
      ],
      storage: {
        'jobs/job-1/a.pdf': first,
        'jobs/job-1/b.pdf': second,
      },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.ready).toBe(true)
    expect(result.orderedEntries.map(function (row) {
      return row.requirement.id
    })).toEqual(['req-a', 'req-b'])
    expect(result.orderedEntries[0].artifact.bytes.equals(first)).toBe(true)
    expect(result.orderedEntries[1].artifact.bytes.equals(second)).toBe(true)
    expect(result.orderedEntries[0].resolvedValues).toEqual({})
    var rebuilt = buildStoredFingerprint({
      orderedEntries: result.orderedEntries,
      submissionPacketBytes: mock.state.storage['jobs/job-1/generated/submission-packet.pdf'],
      computedAt: result.fingerprint.computed_at,
    })
    expect(result.fingerprint.input_fingerprint).toBe(rebuilt.input_fingerprint)
    expect(result.fingerprint.content_fingerprint).toBe(rebuilt.content_fingerprint)
    expect(mock.state.rpcCalls[0].name).toBe('complete_permit_packet')
    expect(mock.state.rpcCalls[0].args.p_fingerprint).toEqual(result.fingerprint)
    expect(mock.state.rpcCalls.some(function (call) {
      return call.name === 'complete_permit_packet_skeleton'
    })).toBe(false)
    expect(mock.state.jobUpdates[0].job_specs.packet.fingerprint).toBeUndefined()
  })

  test('dart_generated resolvedValues use the same field-map fill values', async function () {
    var template = await makePdf({ fieldNames: [TEXT_FIELD, 'City'] })
    var job = sampleJob({ owner_name: 'Ada Owner', property_city: null })
    var mock = createPacketClient({
      liveJob: job,
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
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
              {
                pdfField: 'City',
                source: 'job.property_city',
                type: 'text',
                required: false,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })
    var result = await runPermitPacket(mock.client, job, { id: 'run-1' })
    expect(result.ready).toBe(true)
    expect(result.orderedEntries[0].resolvedValues).toEqual({
      'job.owner_name': 'Ada Owner',
      'job.property_city': null,
    })
  })

  test('same-fingerprint retry preserves stored B through diagnostics', async function () {
    var pdf = await makePdf()
    var documents = [
      {
        id: 'doc-bound',
        job_id: 'job-1',
        document_type: 'product_approval',
        file_path: 'jobs/job-1/product.pdf',
        ahj_document_requirement_id: 'req-1',
      },
    ]
    var storage = { 'jobs/job-1/product.pdf': pdf }
    var first = await runPermitPacket(
      createPacketClient({ documents: documents, storage: storage }).client,
      sampleJob(),
      { id: 'run-learn' }
    )
    var fingerprintB = first.fingerprint
    var history = [
      {
        version: 1,
        input_fingerprint: 'a'.repeat(64),
        content_fingerprint: 'd'.repeat(64),
        computed_at: '2026-07-01T00:00:00.000Z',
        artifacts: [],
      },
    ]
    var stale = {
      reason: 'input_changed',
      observed_input_fingerprint: 'e'.repeat(64),
      observed_at: '2026-08-19T12:00:00.000Z',
    }
    var mock = createPacketClient({
      documents: documents,
      storage: storage,
      jobSpecs: {
        proof: { transaction_id: 'keep-me' },
        erecord: { provider: 'epn' },
        squares: 24,
        packet: {
          fingerprint: fingerprintB,
          fingerprint_history: history,
          stale: stale,
          complete: true,
        },
      },
      rpc: function (name, args) {
        expect(name).toBe('complete_permit_packet')
        expect(mock.state.jobSpecs.packet.fingerprint).toEqual(fingerprintB)
        expect(mock.state.jobSpecs.packet.fingerprint_history).toEqual(history)
        expect(mock.state.jobSpecs.packet.stale).toEqual(stale)
        expect(args.p_fingerprint.input_fingerprint).toBe(fingerprintB.input_fingerprint)
        expect(args.p_fingerprint.content_fingerprint).toBe(fingerprintB.content_fingerprint)
        return {
          data: {
            ok: true,
            job_id: args.p_job_id,
            action_id: 'action-reused',
            action_created: false,
            job_status: 'ready_for_physical_submission',
          },
          error: null,
        }
      },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), {
      id: 'run-1',
      payload: {
        rebuild_reason: REBUILD_REASON_PACKET_STALE,
        rebuild_for_input_fingerprint: fingerprintB.input_fingerprint,
      },
    })
    expect(result.ready).toBe(true)
    expect(result.jobStatus).toBe('ready_for_physical_submission')
    expect(result.actionId).toBe('action-reused')
    expect(result.actionCreated).toBe(false)
    expect(result.skippedReadyReason).toBeNull()
    expect(mock.state.jobUpdates.length).toBe(1)
    expect(mock.state.jobUpdates[0].job_specs.packet.fingerprint).toEqual(fingerprintB)
    expect(mock.state.jobSpecs.packet.fingerprint).toEqual(fingerprintB)
  })

  test('ready_fingerprint_mismatch preserves stored B and does not claim this run won', async function () {
    var pdf = await makePdf()
    var fingerprintB = {
      version: 1,
      input_fingerprint: 'b'.repeat(64),
      content_fingerprint: 'c'.repeat(64),
      computed_at: '2026-08-01T00:00:00.000Z',
      artifacts: [{ document_id: 'packet-b' }],
    }
    var history = [
      {
        version: 1,
        input_fingerprint: 'a'.repeat(64),
        content_fingerprint: 'd'.repeat(64),
        computed_at: '2026-07-01T00:00:00.000Z',
        artifacts: [],
      },
    ]
    var stale = {
      reason: 'input_changed',
      observed_input_fingerprint: 'e'.repeat(64),
      observed_at: '2026-08-19T12:00:00.000Z',
    }
    var mock = createPacketClient({
      documents: [
        {
          id: 'doc-bound',
          job_id: 'job-1',
          document_type: 'product_approval',
          file_path: 'jobs/job-1/product.pdf',
          ahj_document_requirement_id: 'req-1',
        },
      ],
      storage: { 'jobs/job-1/product.pdf': pdf },
      jobSpecs: {
        proof: { transaction_id: 'keep-me' },
        erecord: { provider: 'epn' },
        squares: 24,
        packet: {
          fingerprint: fingerprintB,
          fingerprint_history: history,
          stale: stale,
          complete: true,
        },
      },
      rpc: function (name, args) {
        expect(name).toBe('complete_permit_packet')
        expect(mock.state.jobSpecs.packet.fingerprint).toEqual(fingerprintB)
        expect(mock.state.jobSpecs.packet.fingerprint_history).toEqual(history)
        expect(mock.state.jobSpecs.packet.stale).toEqual(stale)
        expect(mock.state.jobSpecs.proof.transaction_id).toBe('keep-me')
        expect(mock.state.jobSpecs.erecord.provider).toBe('epn')
        expect(mock.state.jobSpecs.packet.complete).toBe(true)
        expect(args.p_fingerprint.input_fingerprint).not.toBe(fingerprintB.input_fingerprint)
        return {
          data: {
            ok: true,
            job_id: args.p_job_id,
            action_id: 'action-prior',
            action_created: false,
            job_status: 'ready_for_physical_submission',
            noop_reason: READY_FINGERPRINT_MISMATCH,
          },
          error: null,
        }
      },
    })
    var result = await runPermitPacket(mock.client, sampleJob(), { id: 'run-1' })
    expect(result.complete).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.actionId).toBeNull()
    expect(result.noopReason).toBe(READY_FINGERPRINT_MISMATCH)
    expect(result.skippedReadyReason).toBe(READY_FINGERPRINT_MISMATCH)
    expect(mock.state.runUpdates[0].checkpoint_data.ready).toBe(false)
    expect(mock.state.jobUpdates.length).toBe(1)
    expect(mock.state.jobUpdates[0].job_status).toBeUndefined()
    expect(mock.state.jobUpdates[0].job_specs.packet.fingerprint).toEqual(fingerprintB)
    expect(mock.state.jobUpdates[0].job_specs.packet.fingerprint_history).toEqual(history)
    expect(mock.state.jobUpdates[0].job_specs.packet.stale).toEqual(stale)
    expect(mock.state.jobUpdates[0].job_specs.proof.transaction_id).toBe('keep-me')
    expect(mock.state.jobUpdates[0].job_specs.erecord.provider).toBe('epn')
    expect(mock.state.jobSpecs.packet.fingerprint).toEqual(fingerprintB)
    expect(result.fingerprint.input_fingerprint).not.toBe(fingerprintB.input_fingerprint)
  })

  test('live input mismatch skips ready RPC (Phase C seam, no rebuild enqueue)', async function () {
    var template = await makePdf({ fieldName: TEXT_FIELD })
    var fingerprintB = {
      version: 1,
      input_fingerprint: 'b'.repeat(64),
      content_fingerprint: 'c'.repeat(64),
      computed_at: '2026-08-01T00:00:00.000Z',
      artifacts: [],
    }
    var mock = createPacketClient({
      liveJob: sampleJob({
        owner_name: 'Changed Owner',
        job_status: JOB_STATUS_NEEDS_CORRECTION,
      }),
      jobSpecs: {
        proof: { transaction_id: 'keep-me' },
        squares: 24,
        packet: { fingerprint: fingerprintB, stale: { reason: 'input_changed' } },
      },
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
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })
    var result = await runPermitPacket(
      mock.client,
      sampleJob({ owner_name: 'Ada Owner', job_status: JOB_STATUS_NEEDS_CORRECTION }),
      {
        id: 'run-1',
        payload: {
          rebuild_reason: REBUILD_REASON_PACKET_STALE,
          rebuild_for_input_fingerprint: fingerprintB.input_fingerprint,
        },
      }
    )
    expect(result.complete).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.skippedReadyReason).toBe(SKIPPED_READY_INPUT_CHANGED)
    expect(mock.state.rpcCalls.length).toBe(0)
    expect(mock.state.runUpdates[0].run_status).toBe(RUN_STATUS_NEEDS_REVIEW)
    expect(mock.state.jobUpdates[0].job_status).toBeUndefined()
    expect(mock.state.liveJob.job_status).toBe(JOB_STATUS_NEEDS_CORRECTION)
    expect(mock.state.jobSpecs.packet.fingerprint).toEqual(fingerprintB)
    expect(mock.state.jobSpecs.packet.stale).toEqual({ reason: 'input_changed' })
    expect(mock.state.documentInserts.some(function (row) {
      return row.document_type === 'submission_packet'
    })).toBe(true)
  })

  test('completePermitPacket helper never calls the skeleton', async function () {
    var rpcCalls = []
    var client = {
      rpc: async function (name, args) {
        rpcCalls.push({ name: name, args: args })
        return {
          data: {
            ok: true,
            job_status: 'ready_for_physical_submission',
            action_id: 'action-1',
            action_created: true,
          },
          error: null,
        }
      },
    }
    var payload = await completePermitPacket(client, 'job-1', {
      version: 1,
      input_fingerprint: 'a'.repeat(64),
      content_fingerprint: 'b'.repeat(64),
      computed_at: '2026-08-20T00:00:00.000Z',
      artifacts: [],
    })
    expect(rpcCalls).toEqual([
      {
        name: 'complete_permit_packet',
        args: {
          p_job_id: 'job-1',
          p_fingerprint: {
            version: 1,
            input_fingerprint: 'a'.repeat(64),
            content_fingerprint: 'b'.repeat(64),
            computed_at: '2026-08-20T00:00:00.000Z',
            artifacts: [],
          },
        },
      },
    ])
    expect(payload.action_id).toBe('action-1')
  })
})

describe('Phase F packet freshness mutation hooks', function () {
  afterEach(function () {
    if (freshness.evaluatePacketFreshness.mockRestore) {
      freshness.evaluatePacketFreshness.mockRestore()
    }
    if (freshness.reportProvenStaleInvalidationFailure.mockRestore) {
      freshness.reportProvenStaleInvalidationFailure.mockRestore()
    }
  })

  test('default requirement persist invokes the evaluator', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockResolvedValue({
      evaluated: false,
      fresh: null,
      invalidated: false,
      noop_reason: 'not_ready',
    })
    var mock = createPacketClient({ documents: [] })
    var result = await persistRequirementBackedJobDocument(mock.client, {
      jobId: 'job-1',
      requirementId: 'req-app',
      documentType: 'permit_application',
      fileName: 'Permit Application.pdf',
      filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
    })
    expect(result.id).toBeTruthy()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('job-1')
  })

  test('skipPacketFreshness=true skips requirement persist evaluation', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockResolvedValue({
      evaluated: false,
      fresh: null,
      invalidated: false,
      noop_reason: 'not_ready',
    })
    var mock = createPacketClient({ documents: [] })
    await persistRequirementBackedJobDocument(mock.client, {
      jobId: 'job-1',
      requirementId: 'req-app',
      documentType: 'permit_application',
      fileName: 'Permit Application.pdf',
      filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
      skipPacketFreshness: true,
    })
    expect(spy).not.toHaveBeenCalled()
  })

  test('default submission_packet overwrite invokes the evaluator', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockResolvedValue({
      evaluated: true,
      fresh: false,
      invalidated: true,
      reason: 'packet_content_changed',
    })
    var mock = createPacketClient({
      liveJob: sampleJob({ job_status: 'ready_for_physical_submission' }),
      documents: [
        {
          id: 'packet-1',
          job_id: 'job-1',
          document_type: 'submission_packet',
          file_path: 'jobs/job-1/generated/submission-packet.pdf',
        },
      ],
    })
    await persistSubmissionPacketDocument(mock.client, {
      jobId: 'job-1',
      fileName: 'Submission Packet.pdf',
      filePath: 'jobs/job-1/generated/submission-packet.pdf',
      fileSizeBytes: 42,
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('job-1')
  })

  test('worker assembly suppresses submission_packet freshness evaluation', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockResolvedValue({
      evaluated: false,
      fresh: null,
      invalidated: false,
      noop_reason: 'not_ready',
    })
    var mock = createPacketClient({
      liveJob: sampleJob({ job_status: 'ready_for_physical_submission' }),
    })
    var first = await makePdf({ pages: 1, width: 120 })
    await persistAssembledSubmissionPacket(mock.client, sampleJob(), [first])
    expect(spy).not.toHaveBeenCalled()
  })

  test("worker's generated-document + submission-packet writes produce zero evaluations", async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockResolvedValue({
      evaluated: true,
      fresh: true,
      invalidated: false,
    })
    var template = await makePdf({ fieldNames: [TEXT_FIELD] })
    var job = sampleJob({
      job_status: 'ready_for_physical_submission',
      owner_name: 'Ada Owner',
    })
    var mock = createPacketClient({
      liveJob: job,
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
                pdfField: TEXT_FIELD,
                source: 'job.owner_name',
                type: 'text',
                required: true,
              },
            ],
          },
        }),
      ],
      storage: { 'templates/app.pdf': template },
    })
    var result = await runPermitPacket(mock.client, job, { id: 'run-1' })
    expect(result.ready).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  test('external ready document mutation produces exactly one evaluation', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockResolvedValue({
      evaluated: true,
      fresh: false,
      invalidated: true,
    })
    var mock = createPacketClient({
      liveJob: sampleJob({ job_status: 'ready_for_physical_submission' }),
      documents: [],
    })
    await persistRequirementBackedJobDocument(mock.client, {
      jobId: 'job-1',
      requirementId: 'req-1',
      documentType: 'product_approval',
      fileName: 'Product Approval.pdf',
      filePath: 'jobs/job-1/product.pdf',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('transient freshness failure after successful persist does not fail the write', async function () {
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockRejectedValue(
      Object.assign(new Error('packet_freshness_storage_failed: timeout'), {
        errorCode: freshness.STORAGE_FAILED,
        retryable: true,
      })
    )
    var warn = jest.spyOn(console, 'warn').mockImplementation(function () {})
    var mock = createPacketClient({ documents: [] })
    var result = await persistRequirementBackedJobDocument(mock.client, {
      jobId: 'job-1',
      requirementId: 'req-app',
      documentType: 'permit_application',
      fileName: 'Permit Application.pdf',
      filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
    })
    expect(result.id).toBeTruthy()
    expect(result.freshness.ok).toBe(false)
    expect(result.freshness.retryable).toBe(true)
    expect(result.freshness.side_effect_failed).toBe(false)
    expect(result.freshness.status).toBe('transient_failure')
    expect(result.freshness.job_id).toBe('job-1')
    expect(result.freshness.errorCode).toBe(freshness.STORAGE_FAILED)
    expect(spy).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('proven stale invalidation failure after persist is side_effect_failed, write succeeds', async function () {
    jest.spyOn(freshness, 'reportProvenStaleInvalidationFailure').mockResolvedValue({ persisted: false })
    var spy = jest.spyOn(freshness, 'evaluatePacketFreshness').mockRejectedValue(
      Object.assign(new Error('invalidate_permit_packet_readiness failed'), {
        errorCode: 'permit_packet_invalidation_failed',
        sideEffectFailed: true,
        jobId: 'job-1',
        staleReason: 'packet_inputs_changed',
      })
    )
    var logged = jest.spyOn(console, 'error').mockImplementation(function () {})
    var mock = createPacketClient({ documents: [] })
    var result = await persistRequirementBackedJobDocument(mock.client, {
      jobId: 'job-1',
      requirementId: 'req-app',
      documentType: 'permit_application',
      fileName: 'Permit Application.pdf',
      filePath: 'jobs/job-1/generated/req-app/permit_application.pdf',
    })
    expect(result.id).toBeTruthy()
    expect(result.freshness.ok).toBe(false)
    expect(result.freshness.side_effect_failed).toBe(true)
    expect(result.freshness.job_id).toBe('job-1')
    expect(result.freshness.errorCode).toBe('permit_packet_invalidation_failed')
    expect(result.freshness.status).toBe('side_effect_failed')
    expect(freshness.reportProvenStaleInvalidationFailure).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    logged.mockRestore()
  })
})
