import { createRequire } from 'module'
import { authenticateRequest, requireCompanyUser, filterJobsByCompany } from '../../../../lib/auth/session.js'
import { createClient } from '../../../../lib/supabase-server.js'
import { resolveAHJ } from '../../../../lib/ahj-resolver.js'
import { hasPortalCredentialsForAhj } from '../../../../lib/credentials/has-portal-credentials.js'

const require = createRequire(import.meta.url)
const {
  NOC_OPTIONS,
  UPLOADED_NOC_PATH,
  MAX_NOC_UPLOAD_BYTES,
  isValidNocOption,
  requiresUpload,
  buildJobUpdateForUploadedNoc,
} = require('../../../../lib/noc/noc-options.js')
const { providerForPortal } = require('../../../../lib/ahj/county-options.js')

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: jobs, error } = await context.userSupabase
      .from('jobs')
      .select('id, company_id, owner_name, property_address, property_city, property_state, property_zip, job_status, noc_status, roof_type, valuation, created_at')
      .eq('company_id', context.companyId)
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const scopedJobs = filterJobsByCompany(jobs, context.companyId)

    return Response.json({
      jobs: scopedJobs,
      companyId: context.companyId,
    })
  } catch (err) {
    console.error('List contractor jobs error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const nocOption = isValidNocOption(body.noc_option) ? body.noc_option : NOC_OPTIONS.AUTO_GENERATE

    let resolvedAhj = null
    if (body.property_address && body.property_city && body.property_zip) {
      try {
        const resolveResult = await resolveAHJ(
          context.supabase,
          body.property_address,
          body.property_city,
          body.property_state || 'FL',
          body.property_zip
        )
        resolvedAhj = resolveResult?.ahj || null
      } catch (resolveErr) {
        console.warn('[contractor/jobs] AHJ resolve failed:', resolveErr.message)
      }
    }

    const ahjId = body.ahj_id || resolvedAhj?.id || null
    if (ahjId) {
      let portal = resolvedAhj
      if (!portal || portal.id !== ahjId) {
        const { data: portalRow } = await context.supabase
          .from('ahj_portals')
          .select('id, name, county_or_city, credential_key')
          .eq('id', ahjId)
          .maybeSingle()
        portal = portalRow
      }
      const provider = providerForPortal(portal)
      const hasCreds = await hasPortalCredentialsForAhj(context.companyId, ahjId, provider)
      if (!hasCreds) {
        const ahjName = portal?.name || resolvedAhj?.name || 'this county'
        return Response.json({
          error: 'No portal credentials found for this county. Please add your credentials in Settings before submitting a permit in this area.',
          ahj: ahjName,
          settingsUrl: '/contractor/settings',
        }, { status: 400 })
      }
    }

    const { data: job, error: jobError } = await context.userSupabase
      .from('jobs')
      .insert({
        owner_name: body.owner_name,
        owner_email: body.owner_email || null,
        owner_phone: body.owner_phone || null,
        property_address: body.property_address,
        property_city: body.property_city,
        property_state: body.property_state || 'FL',
        property_zip: body.property_zip,
        scope_of_work: body.scope_of_work || null,
        roof_type: body.roof_type || null,
        valuation: body.valuation ? parseFloat(body.valuation) : null,
        internal_notes: body.notes || body.internal_notes || null,
        ahj_id: ahjId,
        company_id: context.companyId,
        created_by: context.user.id,
        job_status: 'ready',
        noc_status: 'not_started',
        noc_option: nocOption,
        material_manufacturer: body.roof_specs?.primary_material?.manufacturer || null,
        material_model: body.roof_specs?.primary_material?.product_name || null,
        material_approval_num: body.roof_specs?.primary_material?.approval_number || null,
        roof_specs: body.roof_specs || {},
        job_specs: {
          ...(body.job_specs || {}),
          squares: body.squares || body.job_specs?.squares || null,
        },
      })
      .select()
      .single()

    if (jobError) {
      console.error('Contractor job save error:', jobError.message)
      return Response.json({ error: jobError.message }, { status: 500 })
    }

    if (job.company_id !== context.companyId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    let savedJob = job
    if (requiresUpload(nocOption) && body.noc_upload_base64) {
      const buffer = Buffer.from(body.noc_upload_base64, 'base64')
      if (buffer.length > MAX_NOC_UPLOAD_BYTES) {
        return Response.json({ error: 'NOC PDF must be 10MB or smaller' }, { status: 400 })
      }
      const supabase = createClient()
      const storagePath = UPLOADED_NOC_PATH(job.id)
      const { error: uploadError } = await supabase.storage
        .from('job-documents')
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true })
      if (uploadError) {
        return Response.json({ error: 'NOC upload failed: ' + uploadError.message }, { status: 500 })
      }
      const update = buildJobUpdateForUploadedNoc(job, nocOption, storagePath)
      const { data: updated, error: updateError } = await supabase
        .from('jobs')
        .update(update)
        .eq('id', job.id)
        .select('*')
        .single()
      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 })
      }
      savedJob = updated
    }

    const { error: runError } = await context.supabase
      .from('automation_runs')
      .insert({
        job_id: savedJob.id,
        run_status: 'queued',
        started_at: new Date().toISOString(),
      })

    if (runError) {
      console.error('AUTOMATION QUEUE FAILED:', runError.message)
    }

    const { error: statusError } = await context.supabase
      .from('jobs')
      .update({ job_status: 'automation_running' })
      .eq('id', savedJob.id)

    if (statusError) {
      console.error('Failed to update job status:', statusError.message)
    }

    return Response.json({
      success: true,
      job: { ...savedJob, job_status: 'automation_running' },
    }, { status: 201 })
  } catch (err) {
    console.error('Contractor job creation error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
