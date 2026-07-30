import { authenticateRequest, requireCompanyUser, assertJobAccess } from '../../../../../lib/auth/session.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Re-evaluate combined packet merge after a document upload.
 * No-op unless job is permit_issued/approved and all required docs are present.
 */
export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const access = await assertJobAccess(context.userSupabase, id, context.companyId)
    if (access.error) {
      return Response.json({ error: access.error }, { status: access.status })
    }

    const { tryPacketMergeForJob } = require('../../../../../lib/documents/try-packet-merge')
    // Service role so storage download/upload for merge works under RLS
    const result = await tryPacketMergeForJob(context.supabase, id)

    return Response.json({ success: true, packetMerge: result })
  } catch (err) {
    console.error('[try-packet-merge]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
