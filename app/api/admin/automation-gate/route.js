import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data, error } = await context.supabase
      .from('platform_settings')
      .select('value, updated_at, updated_by')
      .eq('key', 'automation_enabled')
      .maybeSingle()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({
      enabled: data?.value === 'true',
      updatedAt: data?.updated_at || null,
      updatedBy: data?.updated_by || null,
    })
  } catch (err) {
    console.error('[admin/automation-gate] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const enabled = Boolean(body?.enabled)

    const { error } = await context.supabase
      .from('platform_settings')
      .upsert({
        key: 'automation_enabled',
        value: enabled ? 'true' : 'false',
        description:
          'When false workers will not pick up new runs. Set to true to enable automation.',
        updated_at: new Date().toISOString(),
        updated_by: context.userData.id,
      })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    console.log(
      '[automation-gate]',
      enabled ? 'ENABLED' : 'PAUSED',
      'by',
      context.userData.id
    )

    return Response.json({
      success: true,
      enabled,
      message: enabled
        ? 'Automation enabled — workers will now pick up runs'
        : 'Automation paused — workers will skip new runs',
    })
  } catch (err) {
    console.error('[admin/automation-gate] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
