// app/api/jobs/[id]/erecord-provider/route.js

import { createClient } from '../../../../../lib/supabase-server'
import { setJobErecordProvider } from '../../../../../lib/erecord/service'

export async function POST(request, { params }) {
  try {
    const { id: jobId } = await params
    if (!jobId) return Response.json({ error: 'Job ID required' }, { status: 400 })

    const supabase = createClient()
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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
