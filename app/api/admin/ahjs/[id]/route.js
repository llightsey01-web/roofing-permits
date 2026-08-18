import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

const { loadAhjDashboardRow } = require('../../../../../lib/ahj/ahj-readiness-dashboard.js')

/** GET /api/admin/ahjs/[id] — derived AHJ pilot readiness detail (no secrets). */
export async function GET(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const row = await loadAhjDashboardRow(context.supabase, id)
    if (!row || !row.id) {
      return Response.json({ error: 'AHJ not found' }, { status: 404 })
    }

    return Response.json({ ahj: row })
  } catch (err) {
    console.error('[admin/ahjs/[id]] GET error:', err && err.message)
    return Response.json({ error: 'Failed to load AHJ readiness' }, { status: 500 })
  }
}
