// tests/unit/permit-packet.test.js
// ZIG-8: atomic skeleton transition, idempotency, worker cannot complete actions
'use strict'

const fs = require('fs')
const path = require('path')
const {
  completePermitPacketSkeleton,
  runPermitPacketSkeleton,
  workerCanCompleteJobAction,
  READY_FOR_PHYSICAL_SUBMISSION,
  PHYSICAL_SUBMISSION_ACTION_TYPE,
  PERMIT_PACKET_RUN_TYPE,
} = require('../../lib/automation/permit-packet.js')

function defaultPacketRequirements() {
  return [
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
  ]
}

function mockSupabase(opts) {
  var options = opts || {}
  var rpcCalls = []
  var runUpdates = []
  var jobUpdates = []
  var actionInserts = []
  var requirementRows =
    options.requirementRows !== undefined
      ? options.requirementRows
      : defaultPacketRequirements()

  return {
    rpcCalls: rpcCalls,
    runUpdates: runUpdates,
    jobUpdates: jobUpdates,
    actionInserts: actionInserts,
    client: {
      rpc: async function (name, args) {
        rpcCalls.push({ name: name, args: args })
        if (typeof options.rpc === 'function') {
          return options.rpc(name, args, rpcCalls.length)
        }
        return {
          data: {
            job_id: args.p_job_id,
            company_id: 'company-a',
            action_id: 'action-1',
            action_created: rpcCalls.length === 1,
            job_status: READY_FOR_PHYSICAL_SUBMISSION,
          },
          error: null,
        }
      },
      from: function (table) {
        if (table === 'ahj_document_requirements') {
          var chain = {
            select: function () {
              return chain
            },
            eq: function () {
              return chain
            },
            order: function () {
              return chain
            },
            then: function (resolve, reject) {
              return Promise.resolve({ data: requirementRows, error: null }).then(
                resolve,
                reject
              )
            },
          }
          return chain
        }
        return {
          update: function (payload) {
            if (table === 'automation_runs') runUpdates.push(payload)
            if (table === 'jobs') jobUpdates.push(payload)
            return {
              eq: async function () {
                return { error: null }
              },
            }
          },
          insert: function (payload) {
            if (table === 'job_actions') actionInserts.push(payload)
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  }
}

function sampleJob(overrides) {
  return Object.assign(
    { id: 'job-1', company_id: 'company-a', ahj_id: 'ahj-1' },
    overrides || {}
  )
}

describe('permit-packet skeleton (ZIG-8)', function () {
  test('successful skeleton uses single atomic RPC (job status + pending action together)', async function () {
    var mock = mockSupabase()
    var result = await runPermitPacketSkeleton(
      mock.client,
      sampleJob(),
      { id: 'run-1', run_type: PERMIT_PACKET_RUN_TYPE }
    )

    expect(mock.rpcCalls.length).toBe(1)
    expect(mock.rpcCalls[0].name).toBe('complete_permit_packet_skeleton')
    expect(mock.rpcCalls[0].args).toEqual({ p_job_id: 'job-1' })
    // No separate best-effort job_actions insert or jobs update from JS
    expect(mock.actionInserts.length).toBe(0)
    expect(mock.jobUpdates.length).toBe(0)

    expect(result.jobStatus).toBe(READY_FOR_PHYSICAL_SUBMISSION)
    expect(result.actionType).toBe(PHYSICAL_SUBMISSION_ACTION_TYPE)
    expect(result.actionId).toBe('action-1')
    expect(result.completedBy).toBeNull()
  })

  test('retry / re-execution does not invent a second pending action (RPC idempotent)', async function () {
    var mock = mockSupabase({
      rpc: function (_name, args, callNum) {
        return {
          data: {
            job_id: args.p_job_id,
            company_id: 'company-a',
            action_id: 'action-1',
            action_created: callNum === 1,
            job_status: READY_FOR_PHYSICAL_SUBMISSION,
          },
          error: null,
        }
      },
    })

    var first = await completePermitPacketSkeleton(mock.client, 'job-1')
    var second = await completePermitPacketSkeleton(mock.client, 'job-1')

    expect(mock.rpcCalls.length).toBe(2)
    expect(first.action_id).toBe('action-1')
    expect(second.action_id).toBe('action-1')
    expect(first.action_created).toBe(true)
    expect(second.action_created).toBe(false)
  })

  test('RPC failure leaves no partial JS-side writes (atomicity boundary)', async function () {
    var mock = mockSupabase({
      rpc: function () {
        return { data: null, error: { message: 'simulated mid-transition failure' } }
      },
    })

    await expect(
      runPermitPacketSkeleton(
        mock.client,
        sampleJob(),
        { id: 'run-1' }
      )
    ).rejects.toThrow(/atomic transition failed/)

    expect(mock.actionInserts.length).toBe(0)
    expect(mock.jobUpdates.length).toBe(0)
    expect(mock.runUpdates.length).toBe(0)
  })

  test('worker cannot complete a human action', function () {
    expect(workerCanCompleteJobAction()).toBe(false)
    var src = fs.readFileSync(
      path.join(__dirname, '../../lib/automation/permit-packet.js'),
      'utf8'
    )
    expect(src).not.toMatch(/status:\s*['"]completed['"]/)
    expect(src).not.toMatch(/completed_by\s*:/)
    // RPC name must not be a complete-action API
    expect(src).toMatch(/complete_permit_packet_skeleton/)
    expect(src).not.toMatch(/complete_job_action/)
    expect(src).not.toMatch(/mark.*physical_submission.*completed/i)
  })

  test('worker-created action keeps completed_by null', async function () {
    var mock = mockSupabase()
    var result = await runPermitPacketSkeleton(
      mock.client,
      sampleJob(),
      { id: 'run-1' }
    )
    expect(result.completedBy).toBeNull()
  })

  test('company_id must come from job (server-derived), never invented by packet module args', async function () {
    var mock = mockSupabase()
    await expect(
      runPermitPacketSkeleton(mock.client, { id: 'job-1', ahj_id: 'ahj-1' }, { id: 'run-1' })
    ).rejects.toThrow(/company_id is required/)
    // RPC only receives job id — company_id derived inside SQL from jobs
    await runPermitPacketSkeleton(
      mock.client,
      sampleJob(),
      { id: 'run-1' }
    )
    expect(mock.rpcCalls[0].args).toEqual({ p_job_id: 'job-1' })
    expect(mock.rpcCalls[0].args.p_company_id).toBeUndefined()
  })
})

describe('job_actions migration / RLS shape (ZIG-8)', function () {
  var migration = fs.readFileSync(
    path.join(
      __dirname,
      '../../supabase/migrations/20260817191600_job_actions_and_permit_packet_rpc.sql'
    ),
    'utf8'
  )
  var statusMigration = fs.readFileSync(
    path.join(
      __dirname,
      '../../supabase/migrations/20260817191500_job_status_ready_for_physical_submission.sql'
    ),
    'utf8'
  )

  test('adds exactly ready_for_physical_submission and no packet micro-statuses', function () {
    expect(statusMigration).toMatch(/ready_for_physical_submission/)
    expect(statusMigration).toMatch(/TEXT, not a Postgres enum/i)
    expect(statusMigration).toMatch(/there is no ALTER TYPE/)
    expect(statusMigration).not.toMatch(/^\s*ALTER TYPE/m)
    expect(statusMigration).not.toMatch(/packet_populated|packet_assembled|awaiting_packet/)
  })

  test('RLS enabled with company select + super_admin all; no authenticated insert', function () {
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(migration).toMatch(/job_actions_company_select/)
    expect(migration).toMatch(/dartiq_current_company_id/)
    expect(migration).toMatch(/job_actions_super_admin_all/)
    expect(migration).toMatch(/GRANT SELECT ON public\.job_actions TO authenticated/)
    expect(migration).not.toMatch(/GRANT INSERT ON public\.job_actions TO authenticated/)
    expect(migration).not.toMatch(/GRANT UPDATE ON public\.job_actions TO authenticated/)
  })

  test('partial unique index prevents duplicate pending physical_submission', function () {
    expect(migration).toMatch(/job_actions_one_pending_physical_submission_idx/)
    expect(migration).toMatch(/WHERE action_type = 'physical_submission' AND status = 'pending'/)
  })

  test('atomic RPC derives company_id from jobs and never completes actions', function () {
    expect(migration).toMatch(/complete_permit_packet_skeleton/)
    expect(migration).toMatch(/FROM public\.jobs AS j/)
    expect(migration).toMatch(/ready_for_physical_submission/)
    expect(migration).toMatch(/ON CONFLICT \(job_id\) WHERE/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) TO service_role/)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) FROM anon/)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) FROM authenticated/)
    expect(migration).not.toMatch(/SET status = 'completed'/)
    expect(migration).not.toMatch(/completed_by\s*=/)
  })

  test('RPC SQL contains exactly the approved four-status prior allowlist', function () {
    var allowlist = migration.match(
      /AND j\.job_status IN \(\s*'ready',\s*'automation_running',\s*'needs_review',\s*'needs_correction'\s*\)/
    )
    expect(allowlist).not.toBeNull()
    expect(migration).toMatch(/GET DIAGNOSTICS v_updated = ROW_COUNT/)
    expect(migration).toMatch(/permit_packet_invalid_prior_status/)
    // Rejected statuses must not appear in the allowlist IN (...) clause
    var inClause = migration.match(
      /AND j\.job_status IN \(([\s\S]*?)\)\s*;/
    )
    expect(inClause).not.toBeNull()
    var allowed = inClause[1]
    expect(allowed).toMatch(/'ready'/)
    expect(allowed).toMatch(/'automation_running'/)
    expect(allowed).toMatch(/'needs_review'/)
    expect(allowed).toMatch(/'needs_correction'/)
    expect(allowed).not.toMatch(/'draft'/)
    expect(allowed).not.toMatch(/'cancelled'/)
    expect(allowed).not.toMatch(/'permit_issued'/)
    expect(allowed).not.toMatch(/'ready_for_physical_submission'/)
    expect(allowed).not.toMatch(/'submitted'/)
    expect(allowed).not.toMatch(/'approved'/)
    expect(allowed).not.toMatch(/'on_hold'/)
    expect(allowed).not.toMatch(/'waiting_for_noc'/)
  })

  test('production SQL artifact mirrors staging RPC prior-status guard', function () {
    var prod = fs.readFileSync(
      path.join(__dirname, '../../scripts/sql/zig-8-production-job-actions.sql'),
      'utf8'
    )
    expect(prod).toMatch(
      /AND j\.job_status IN \(\s*'ready',\s*'automation_running',\s*'needs_review',\s*'needs_correction'\s*\)/
    )
    expect(prod).toMatch(/GET DIAGNOSTICS v_updated = ROW_COUNT/)
    expect(prod).toMatch(/permit_packet_invalid_prior_status/)
    expect(prod).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) TO service_role/)
  })

  test('rejected prior statuses abort before job_actions insert (transaction ordering)', function () {
    var updateIdx = migration.indexOf("SET job_status = 'ready_for_physical_submission'")
    var guardIdx = migration.indexOf('permit_packet_invalid_prior_status')
    var insertIdx = migration.indexOf(
      'INSERT INTO public.job_actions (job_id, company_id, action_type, status)'
    )
    expect(updateIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeGreaterThan(updateIdx)
    expect(insertIdx).toBeGreaterThan(guardIdx)
  })
})
