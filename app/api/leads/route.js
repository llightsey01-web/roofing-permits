// POST /api/leads
// Accepts form submission from marketing site
// Saves to leads table and sends notification email
import { createClient } from '../../../lib/supabase-server.js'

const ALLOWED_ORIGINS = new Set([
  'https://www.dartiq.dev',
  'https://dartiq.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

function corsHeaders(request) {
  const origin = request.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  }
  return {}
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

async function sendLeadNotification(lead) {
  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.warn('[leads] RESEND_API_KEY not set — skipping email notification')
      return
    }

    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: 'DART iQ <hello@dartiq.dev>',
      to: 'logan@dartiq.dev',
      subject: 'New Lead: ' + lead.name + ' — ' + (lead.company || 'No company'),
      html: `
        <h2>New Early Access Request</h2>
        <p><strong>Name:</strong> ${lead.name}</p>
        <p><strong>Company:</strong> ${lead.company || 'Not provided'}</p>
        <p><strong>Email:</strong> ${lead.email}</p>
        <p><strong>Phone:</strong> ${lead.phone || 'Not provided'}</p>
        <p><strong>Monthly Volume:</strong> ${lead.monthly_volume || 'Not provided'}</p>
        <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
      `,
    })
  } catch (err) {
    console.error('[leads] Email failed:', err.message)
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { name, company, email, phone, monthly_volume } = body

    if (!name || !email) {
      return Response.json({ error: 'Name and email required' }, { status: 400 })
    }

    const supabase = createClient()
    const { error } = await supabase.from('leads').insert({
      name,
      company,
      email,
      phone,
      monthly_volume,
      source: 'marketing_site',
    })

    if (error) throw new Error(error.message)

    await sendLeadNotification({ name, company, email, phone, monthly_volume })

    return Response.json({ success: true }, { headers: corsHeaders(request) })
  } catch (err) {
    console.error('[leads] Error:', err.message)
    return Response.json({ error: 'Failed to save lead' }, { status: 500, headers: corsHeaders(request) })
  }
}
