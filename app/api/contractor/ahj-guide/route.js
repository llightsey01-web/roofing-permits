import { createClient } from '../../../../lib/supabase-server.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/contractor/ahj-guide
 * Fresh AHJ reference data — no caching so admin edits show immediately.
 */
export async function GET() {
  try {
    const supabase = createClient()

    const { data: portals, error: portalsError } = await supabase
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
        office_hours
      `
      )
      .eq('state', 'FL')
      .eq('is_active', true)
      .order('county_or_city', { ascending: true })

    if (portalsError) {
      console.error('[ahj-guide] Fetch failed:', portalsError.message)
      return Response.json({ error: portalsError.message }, { status: 500 })
    }

    const ahjs = portals || []
    if (ahjs.length === 0) {
      return Response.json(
        { ahjs: [] },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
          },
        }
      )
    }

    const ids = ahjs.map(function (a) {
      return a.id
    })

    const [reqsRes, inspRes] = await Promise.all([
      supabase
        .from('ahj_requirements')
        .select(
          'id, ahj_id, requirement_type, name, description, is_required, sequence_order, when_needed, download_url, notes, is_active'
        )
        .in('ahj_id', ids)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true }),
      supabase
        .from('ahj_inspections')
        .select(
          'id, ahj_id, inspection_name, description, sequence_order, when_to_schedule, typical_wait_days, notes, is_active'
        )
        .in('ahj_id', ids)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true }),
    ])

    if (reqsRes.error) {
      console.error('[ahj-guide] Requirements fetch failed:', reqsRes.error.message)
      return Response.json({ error: reqsRes.error.message }, { status: 500 })
    }
    if (inspRes.error) {
      console.error('[ahj-guide] Inspections fetch failed:', inspRes.error.message)
      return Response.json({ error: inspRes.error.message }, { status: 500 })
    }

    const reqsByAhj = {}
    const inspByAhj = {}
    ;(reqsRes.data || []).forEach(function (r) {
      if (!reqsByAhj[r.ahj_id]) reqsByAhj[r.ahj_id] = []
      reqsByAhj[r.ahj_id].push(r)
    })
    ;(inspRes.data || []).forEach(function (i) {
      if (!inspByAhj[i.ahj_id]) inspByAhj[i.ahj_id] = []
      inspByAhj[i.ahj_id].push(i)
    })

    const result = ahjs.map(function (ahj) {
      const requirements = reqsByAhj[ahj.id] || []
      return {
        ...ahj,
        requirements: requirements,
        documents: requirements.filter(function (r) {
          return r.requirement_type === 'document'
        }),
        inspections: inspByAhj[ahj.id] || [],
      }
    })

    return Response.json(
      { ahjs: result },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    )
  } catch (err) {
    console.error('[contractor/ahj-guide] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
