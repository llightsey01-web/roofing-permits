import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const circuit = require('../../../../lib/automation/circuit-breaker.js')

function startOfTodayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const supabase = context.supabase
    const today = startOfTodayIso()

    const [
      activeRunsRes,
      queuedPermitRes,
      queuedNocRes,
      queuedOpsRes,
      completedTodayRes,
      failedTodayRes,
      heartbeatsRes,
    ] = await Promise.all([
      supabase
        .from('automation_runs')
        .select('id, job_id, run_type, run_status, attempts, error_message, started_at, payload, created_at')
        .in('run_status', ['running', 'error', 'queued'])
        .order('started_at', { ascending: false })
        .limit(50),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('run_status', 'queued')
        .or('run_type.in.(permit_phase_1,permit_resume,permit_submit),run_type.is.null'),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('run_status', 'queued')
        .in('run_type', ['noc_generate', 'proof_send', 'proof_check', 'erecord_prepare', 'erecord_submit']),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('run_status', 'queued')
        .in('run_type', ['notify_admin', 'build_packet', 'status_reconcile']),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('run_status', 'complete')
        .gte('completed_at', today),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('run_status', 'error')
        .gte('completed_at', today),
      supabase
        .from('worker_heartbeats')
        .select('worker_name, last_poll_at')
        .order('last_poll_at', { ascending: false })
        .limit(20),
    ])

    const activeRuns = activeRunsRes.data || []
    const jobIds = [...new Set(activeRuns.map(function (r) { return r.job_id }).filter(Boolean))]

    let jobsById = {}
    let companiesById = {}
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, company_id, property_address, property_city, property_state, property_zip, job_status, noc_status')
        .in('id', jobIds)
      ;(jobs || []).forEach(function (j) { jobsById[j.id] = j })

      const companyIds = [...new Set((jobs || []).map(function (j) { return j.company_id }).filter(Boolean))]
      if (companyIds.length > 0) {
        const { data: companies } = await supabase
          .from('companies')
          .select('id, name')
          .in('id', companyIds)
        ;(companies || []).forEach(function (c) { companiesById[c.id] = c })
      }
    }

    // Latest forensics screenshot per job from run_actions
    let screenshotsByJob = {}
    if (jobIds.length > 0) {
      const { data: actions } = await supabase
        .from('run_actions')
        .select('job_id, screenshot_path, created_at')
        .in('job_id', jobIds)
        .not('screenshot_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100)
      ;(actions || []).forEach(function (a) {
        if (a.screenshot_path && !screenshotsByJob[a.job_id]) {
          screenshotsByJob[a.job_id] = a.screenshot_path
        }
      })
    }

    const enrichedRuns = activeRuns.map(function (run) {
      const job = jobsById[run.job_id] || null
      const company = job && job.company_id ? companiesById[job.company_id] : null
      const startedAt = run.started_at || run.created_at
      const elapsedMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0
      return {
        ...run,
        job: job,
        company_name: company ? company.name : null,
        elapsed_ms: elapsedMs,
        screenshot_path: screenshotsByJob[run.job_id] || null,
        worker: inferWorker(run.run_type),
      }
    })

    const circuits = await circuit.getAllCircuitStates()
    const heartbeats = heartbeatsRes.data || []

    // Today's permit / NOC counts from completed runs
    const { data: todayComplete } = await supabase
      .from('automation_runs')
      .select('run_type')
      .eq('run_status', 'complete')
      .gte('completed_at', today)
      .limit(500)

    let permitsSubmitted = 0
    let nocsGenerated = 0
    ;(todayComplete || []).forEach(function (r) {
      if (r.run_type === 'permit_submit' || r.run_type === 'permit_phase_1') permitsSubmitted += 1
      if (r.run_type === 'noc_generate') nocsGenerated += 1
    })

    return Response.json({
      circuits: circuits,
      heartbeats: heartbeats,
      activeRuns: enrichedRuns,
      queue: {
        permit: queuedPermitRes.count || 0,
        nocProof: queuedNocRes.count || 0,
        ops: queuedOpsRes.count || 0,
      },
      today: {
        completedRuns: completedTodayRes.count || 0,
        failedRuns: failedTodayRes.count || 0,
        permitsSubmitted: permitsSubmitted,
        nocsGenerated: nocsGenerated,
      },
      checkedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[admin/operations]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

function inferWorker(runType) {
  if (!runType) return 'permit'
  if (['noc_generate', 'proof_send', 'proof_check', 'erecord_prepare', 'erecord_submit'].indexOf(runType) >= 0) {
    return 'noc-proof-erecord'
  }
  if (['notify_admin', 'build_packet', 'status_reconcile'].indexOf(runType) >= 0) return 'ops'
  return 'permit'
}
