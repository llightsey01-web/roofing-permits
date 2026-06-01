// app/api/jobs/[id]/erecord-provider/route.js

import { setJobErecordProvider } from '../../../../../lib/erecord/service'
import { authenticateRequest, assertJobAccess } from '../../../../../lib/auth/session.js'

export async function POST(request, { params }) {
  try {
    const { id: jobId } = await params
    if (!jobId) return Response.json({ error: 'Job ID required' }, { status: 400 })

    const context = await authenticateRequest(request)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    if (!context.isSuperAdmin) {
      const access = await assertJobAccess(context.supabase, jobId, context.companyId)
      if (access.error) {
        return Response.json({ error: access.error }, { status: access.status })
      }
    }

    const body = await request.json()
    const provider = body.provider
    if (!provider) return Response.json({ error: 'provider is required' }, { status: 400 })

    const result = await setJobErecordProvider(jobId, provider)
    return Response.json(result)
  } catch (err) {
    console.error('eRecord provider update error:', err)
    return Response.json({ error: err.message }, { status: 400 })
  }
}
