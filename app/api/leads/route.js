// POST /api/leads
// Accepts form submission from marketing site
// Saves to leads table
// Sends notification email (stubbed for now)
import { createClient as createServiceClient } from '../../../lib/supabase-server.js'

export async function POST(request) {
  try {
    const body = await request.json()
    const { name, company, email, phone, monthly_volume } = body

    if (!name || !email) {
      return Response.json({ error: 'Name and email required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase.from('leads').insert({
      name,
      company,
      email,
      phone,
      monthly_volume,
      source: 'marketing_site',
    })

    if (error) throw new Error(error.message)

    // TODO: Send email notification when Resend is configured
    console.log('[leads] New lead:', name, email, company)

    return Response.json({ success: true })
  } catch (err) {
    console.error('[leads] Error:', err.message)
    return Response.json({ error: 'Failed to save lead' }, { status: 500 })
  }
}
