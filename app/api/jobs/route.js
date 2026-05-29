// app/api/jobs/route.js
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function POST(request) {
  try {
    const body = await request.json()
    const supabase = getSupabase()

    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        owner_name: body.owner_name,
        owner_email: body.owner_email,
        owner_phone: body.owner_phone,
        property_address: body.property_address,
        property_city: body.property_city,
        property_state: body.property_state || 'FL',
        property_zip: body.property_zip,
        property_type: body.property_type,
        scope_of_work: body.scope_of_work,
        roof_type: body.roof_type,
        valuation: body.valuation ? parseFloat(body.valuation) : null,
        internal_notes: body.internal_notes,
        ahj_id: body.ahj_id || null,
        company_id: body.company_id,
        created_by: user.id,
        job_status: 'draft',
        noc_status: 'not_started',
        parcel_number: body.parcel_number || null,
        legal_description: body.legal_description || null,
        material_manufacturer: body.roof_specs?.primary_material?.manufacturer,
        material_model: body.roof_specs?.primary_material?.product_name,
        material_approval_num: body.roof_specs?.primary_material?.approval_number,
        roof_specs: body.roof_specs || {},
        job_specs: body.job_specs || {},
      })
      .select()
      .single()

    if (jobError) {
      console.error('Job save error:', jobError)
      return Response.json({ error: jobError.message }, { status: 500 })
    }

    console.log('Job saved: ' + job.id + ' — NOC starts after portal gets parcel number')

    return Response.json({ success: true, job })

  } catch (err) {
    console.error('Job creation error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
