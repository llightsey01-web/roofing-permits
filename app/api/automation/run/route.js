// app/api/automation/run/route.js
// Queues automation run — worker service picks it up and executes Playwright
import { createClient } from '../../../../lib/supabase-server'

export async function POST(request) {
  try {
    const { jobId } = await request.json()
    if (!jobId) return Response.json({ error: 'Job ID required' }, { status: 400 })

    const supabase = createClient()

    const authHeader = request.headers.get('authorization')
    if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: job, error: jobError } = await supabase
      .from('jobs').select('*').eq('id', jobId).single()
    if (jobError || !job) return Response.json({ error: 'Job not found' }, { status: 404 })

    if (job.job_status !== 'ready') {
      return Response.json({ error: 'Job must be marked as ready before running automation' }, { status: 400 })
    }

    // Create queued run — worker service picks this up and executes
    const { data: run, error: runError } = await supabase
      .from('automation_runs')
      .insert({
        job_id: jobId,
        run_status: 'queued',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (runError) {
      console.error('Failed to queue automation run:', runError.message)
      return Response.json({ error: 'Failed to queue automation: ' + runError.message }, { status: 500 })
    }

    // Update job status
    await supabase.from('jobs')
      .update({ job_status: 'automation_running' })
      .eq('id', jobId)

    console.log('Automation queued — run ID:', run.id, 'worker will pick up within 30s')

    return Response.json({ success: true, runId: run.id, status: 'queued' })

  } catch (err) {
    console.error('Queue automation error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}