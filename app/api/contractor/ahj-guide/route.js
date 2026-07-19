import { createClient } from '../../../../lib/supabase-server.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
}

/**
 * GET /api/contractor/ahj-guide
 * Always returns fresh AHJ data (no cache) so admin edits appear immediately.
 */
export async function GET() {
  try {
    const supabase = createClient()

    const { data: portals, error: ahjError } = await supabase
      .from('ahj_portals')
      .select('*')
      .eq('state', 'FL')
      .eq('is_active', true)
      .order('county_or_city', { ascending: true })

    if (ahjError) throw ahjError

    const ahjs = portals || []
    if (ahjs.length === 0) {
      return new Response(JSON.stringify({ ahjs: [] }), {
        status: 200,
        headers: NO_CACHE_HEADERS,
      })
    }

    const ids = ahjs.map(function (a) { return a.id })

    const [reqsRes, inspRes] = await Promise.all([
      supabase
        .from('ahj_requirements')
        .select('*')
        .in('ahj_id', ids)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true }),
      supabase
        .from('ahj_inspections')
        .select('*')
        .in('ahj_id', ids)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true }),
    ])

    if (reqsRes.error) throw reqsRes.error
    if (inspRes.error) throw inspRes.error

    const requirements = reqsRes.data || []
    const inspections = inspRes.data || []

    const result = ahjs.map(function (ahj) {
      const ahjReqs = requirements.filter(function (r) { return r.ahj_id === ahj.id })
      const ahjInsps = inspections.filter(function (i) { return i.ahj_id === ahj.id })
      return {
        ...ahj,
        // Prefer these for the UI (and keep nested aliases for compatibility)
        requirements: ahjReqs,
        documents: ahjReqs.filter(function (r) { return r.requirement_type === 'document' }),
        inspections: ahjInsps,
        ahj_requirements: ahjReqs,
        ahj_inspections: ahjInsps,
      }
    })

    console.log(
      '[ahj-guide] Fetched',
      ahjs.length,
      'AHJs,',
      requirements.length,
      'requirements,',
      inspections.length,
      'inspections'
    )

    return new Response(JSON.stringify({ ahjs: result }), {
      status: 200,
      headers: NO_CACHE_HEADERS,
    })
  } catch (err) {
    console.error('[ahj-guide] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
