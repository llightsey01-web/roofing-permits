import { authenticateRequest, requireCompanyUser, assertJobAccess } from '../../../../../lib/auth/session.js'

async function authorizeJobReview(context, jobId) {
  if (context.error) return context

  if (context.isSuperAdmin) {
    const { data: job, error } = await context.supabase
      .from('jobs')
      .select('id, company_id')
      .eq('id', jobId)
      .maybeSingle()

    if (error) return { error: 'Job lookup failed', status: 500 }
    if (!job) return { error: 'Job not found', status: 404 }
    return { ...context, job }
  }

  let companyContext = await requireCompanyUser(context)
  if (companyContext.error) return companyContext

  const access = await assertJobAccess(companyContext.supabase, jobId, companyContext.companyId)
  if (access.error) return { error: access.error, status: access.status }

  return { ...companyContext, job: access.job }
}

export async function GET(request, { params }) {
  try {
    const { id: jobId } = await params
    if (!jobId) {
      return Response.json({ error: 'Job ID required' }, { status: 400 })
    }

    const context = await authorizeJobReview(await authenticateRequest(request), jobId)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: review, error } = await context.supabase
      .from('review_requests')
      .select('id, review_type, review_status, created_at, reviewer_notes')
      .eq('job_id', jobId)
      .eq('review_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({
      review: review
        ? {
            id: review.id,
            review_type: review.review_type,
            review_status: review.review_status,
            created_at: review.created_at,
          }
        : null,
    })
  } catch (err) {
    console.error('Get job review error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { id: jobId } = await params
    if (!jobId) {
      return Response.json({ error: 'Job ID required' }, { status: 400 })
    }

    const context = await authorizeJobReview(await authenticateRequest(request), jobId)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const decision = body?.decision
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : ''

    if (decision !== 'approved' && decision !== 'rejected') {
      return Response.json({ error: 'decision must be approved or rejected' }, { status: 400 })
    }

    const { data: review, error: reviewError } = await context.supabase
      .from('review_requests')
      .select('id, review_type, review_status')
      .eq('job_id', jobId)
      .eq('review_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (reviewError) {
      return Response.json({ error: reviewError.message }, { status: 500 })
    }

    if (!review) {
      return Response.json({ error: 'No pending review request for this job' }, { status: 404 })
    }

    const { error: updateReviewError } = await context.supabase
      .from('review_requests')
      .update({
        review_status: decision,
        reviewer_id: context.userData.id,
        reviewer_notes: notes || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', review.id)

    if (updateReviewError) {
      return Response.json({ error: updateReviewError.message }, { status: 500 })
    }

    if (decision === 'rejected') {
      await context.supabase
        .from('jobs')
        .update({ job_status: 'needs_correction' })
        .eq('id', jobId)
      return Response.json({ success: true })
    }

    if (review.review_type === 'noc_before_send') {
      await context.supabase
        .from('jobs')
        .update({
          job_status: 'automation_running',
          noc_status: 'queued_for_notarization',
        })
        .eq('id', jobId)

      await context.supabase.from('automation_runs').insert({
        job_id: jobId,
        run_status: 'queued',
        started_at: new Date().toISOString(),
      })
    } else if (review.review_type === 'permit_before_submit') {
      await context.supabase
        .from('jobs')
        .update({ job_status: 'automation_running' })
        .eq('id', jobId)

      await context.supabase.from('automation_runs').insert({
        job_id: jobId,
        run_status: 'queued',
        run_type: 'permit_submit',
        started_at: new Date().toISOString(),
      })
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('Submit job review error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
