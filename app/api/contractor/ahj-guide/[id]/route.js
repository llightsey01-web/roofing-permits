import { createClient } from '../../../../../lib/supabase-server.js'

/**
 * GET /api/contractor/ahj-guide/[id]
 * Public reference data — single AHJ with full requirements, inspections, portal info.
 */
export async function GET(_request, { params }) {
  try {
    const { id } = await params
    if (!id) {
      return Response.json({ error: 'AHJ id is required' }, { status: 400 })
    }

    const supabase = createClient()

    const { data: ahj, error: ahjError } = await supabase
      .from('ahj_portals')
      .select(
        `
        id,
        name,
        county_or_city,
        state,
        portal_url,
        submission_method,
        avg_approval_days,
        permit_fee_info,
        portal_tips,
        phone,
        email,
        office_address,
        office_hours,
        is_active
      `
      )
      .eq('id', id)
      .single()

    if (ahjError || !ahj) {
      return Response.json({ error: 'AHJ not found' }, { status: 404 })
    }

    const [reqsRes, inspRes] = await Promise.all([
      supabase
        .from('ahj_requirements')
        .select(
          'id, ahj_id, requirement_type, name, description, is_required, sequence_order, when_needed, download_url, notes, is_active'
        )
        .eq('ahj_id', id)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true }),
      supabase
        .from('ahj_inspections')
        .select(
          'id, ahj_id, inspection_name, description, sequence_order, when_to_schedule, typical_wait_days, notes, is_active'
        )
        .eq('ahj_id', id)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true }),
    ])

    if (reqsRes.error) {
      return Response.json({ error: reqsRes.error.message }, { status: 500 })
    }
    if (inspRes.error) {
      return Response.json({ error: inspRes.error.message }, { status: 500 })
    }

    const requirements = reqsRes.data || []

    return Response.json({
      ahj: {
        ...ahj,
        requirements: requirements,
        documents: requirements.filter(function (r) {
          return r.requirement_type === 'document'
        }),
        inspections: inspRes.data || [],
      },
    })
  } catch (err) {
    console.error('[contractor/ahj-guide/[id]] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
