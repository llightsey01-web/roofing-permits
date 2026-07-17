import { createClient } from '../../../../lib/supabase-server.js'
import { buildPublicTimeline } from '../../../../lib/track/public-timeline.js'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Public permit tracker — no auth.
 * Returns only address, company name, and timeline (no PII beyond property address).
 */
export async function GET(_request, { params }) {
  try {
    const { jobId } = await params
    if (!jobId || !UUID_RE.test(jobId)) {
      return Response.json({ error: 'Invalid job id' }, { status: 400 })
    }

    const supabase = createClient()

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(`
        id,
        company_id,
        property_address,
        property_city,
        property_state,
        property_zip,
        job_status,
        noc_status,
        noc_file_path,
        parcel_number,
        portal_confirmation,
        created_at,
        updated_at
      `)
      .eq('id', jobId)
      .maybeSingle()

    if (jobError) {
      console.error('[track] job query error:', jobError.message)
      return Response.json({ error: 'Unable to load tracker' }, { status: 500 })
    }

    if (!job) {
      return Response.json({ error: 'Permit not found' }, { status: 404 })
    }

    let companyName = 'Your Contractor'
    if (job.company_id) {
      const { data: company } = await supabase
        .from('companies')
        .select('name, dba_name')
        .eq('id', job.company_id)
        .maybeSingle()
      if (company) {
        companyName = company.dba_name || company.name || companyName
      }
    }

    const { data: runs } = await supabase
      .from('automation_runs')
      .select('run_type, run_status, started_at, completed_at')
      .eq('job_id', jobId)
      .order('started_at', { ascending: true })
      .limit(50)

    const timeline = buildPublicTimeline(job, runs || [])
    const current = timeline.find(function (s) { return s.status === 'current' })
      || timeline.filter(function (s) { return s.status === 'complete' }).slice(-1)[0]
      || timeline[0]

    return Response.json({
      job_id: job.id,
      property_address: job.property_address,
      property_city: job.property_city,
      property_state: job.property_state || 'FL',
      property_zip: job.property_zip,
      company_name: companyName,
      current_step: current ? current.key : null,
      current_label: current ? current.label : null,
      timeline: timeline,
      updated_at: job.updated_at,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    })
  } catch (err) {
    console.error('[track] Error:', err.message)
    return Response.json({ error: 'Unable to load tracker' }, { status: 500 })
  }
}
