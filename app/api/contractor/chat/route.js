import { authenticateRequest, requireCompanyUser } from '../../../../lib/auth/session.js'

function buildSystemPrompt(company, job, recentJobs, ahjRequirements, products) {
  const companyName = company?.name || 'a roofing company'
  const licenseLine = company?.license_number
    ? 'Their license number is ' + company.license_number + '.'
    : ''
  const qualifierLine = company?.qualifier_name
    ? 'Their qualifier is ' + company.qualifier_name + '.'
    : ''

  const ahjLines = (ahjRequirements || [])
    .map(function (r) {
      const portal = r.ahj_portals || {}
      const county = portal.county_or_city || portal.name || 'Unknown county'
      const req = r.is_required ? 'Required' : 'Optional'
      const notes = r.notes ? ' — ' + r.notes : ''
      const tips = portal.portal_tips ? ' Tips: ' + portal.portal_tips : ''
      const days = portal.avg_approval_days != null
        ? ' Avg approval: ' + portal.avg_approval_days + ' business days.'
        : ''
      return county + ': ' + r.name + ' (' + req + ')' + notes + tips + days
    })
    .join('\n')

  const productLines = (products || [])
    .slice(0, 30)
    .map(function (p) {
      const num = p.approval_number || p.fl_approval_number || 'n/a'
      return (p.manufacturer || '') + ' ' + (p.product_name || '') +
        ' — FL# ' + num + ' (' + (p.layer_type || 'material') + ')'
    })
    .join('\n')

  const jobBlock = job
    ? [
        'CURRENT JOB CONTEXT:',
        'Address: ' + (job.property_address || '') + ', ' + (job.property_city || '') + ', ' + (job.property_state || 'FL'),
        'Owner: ' + (job.owner_name || ''),
        'Status: ' + (job.job_status || ''),
        'Parcel: ' + (job.parcel_number || 'Not set'),
        'Scope: ' + (job.scope_of_work || 'Not set'),
      ].join('\n')
    : ''

  const recentBlock = recentJobs && recentJobs.length
    ? 'CONTRACTOR\'S RECENT JOBS:\n' + recentJobs.map(function (j) {
      return '- ' + (j.property_address || 'Unknown') + ' | Status: ' + (j.job_status || '')
    }).join('\n')
    : ''

  return [
    'You are the DART iQ AI assistant — a helpful, knowledgeable permit assistant for Florida roofing contractors.',
    'You are talking to a contractor from ' + companyName + '.',
    licenseLine,
    qualifierLine,
    '',
    'DART iQ automates Florida roofing permits. You help contractors with:',
    '- Understanding permit requirements for each county',
    '- Checking their permit status',
    '- Understanding required documents',
    '- Product approval questions',
    '- Inspection scheduling guidance',
    '- General permit process questions',
    '',
    'AVAILABLE COUNTY INFORMATION:',
    ahjLines || 'No county data available',
    '',
    'AVAILABLE PRODUCT APPROVALS (sample):',
    productLines || 'No product data available',
    '',
    jobBlock,
    '',
    recentBlock,
    '',
    'IMPORTANT RULES:',
    '- Only share this contractor\'s own job information — never other contractors',
    '- Never make up county requirements — only cite what is in the system',
    '- If you don\'t know something say so and suggest they contact the county directly',
    '- Never submit permits or take actions — only provide information',
    '- Be concise and helpful — contractors are busy',
    '- Use simple language — not legal jargon',
    '- If asked about a county not in the system say DART iQ does not currently support that county',
    '- Always be encouraging and professional',
  ].filter(Boolean).join('\n')
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[chat] ANTHROPIC_API_KEY is not configured')
      return Response.json({ error: 'AI service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const messages = Array.isArray(body.messages) ? body.messages : []
    const jobId = body.jobId || null

    if (!messages.length) {
      return Response.json({ error: 'messages required' }, { status: 400 })
    }

    // Cap conversation length sent to the model
    const trimmed = messages
      .filter(function (m) {
        return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      })
      .slice(-20)
      .map(function (m) {
        return { role: m.role, content: String(m.content).slice(0, 4000) }
      })

    if (!trimmed.length || trimmed[trimmed.length - 1].role !== 'user') {
      return Response.json({ error: 'Last message must be from user' }, { status: 400 })
    }

    const supabase = context.supabase

    const { data: company } = await supabase
      .from('companies')
      .select('name, license_number, qualifier_name, state, city')
      .eq('id', context.companyId)
      .single()

    let job = null
    if (jobId) {
      const { data: jobData } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .eq('company_id', context.companyId)
        .single()
      job = jobData || null
    }

    const { data: recentJobs } = await supabase
      .from('jobs')
      .select('id, owner_name, property_address, job_status, ahj_id, created_at')
      .eq('company_id', context.companyId)
      .order('created_at', { ascending: false })
      .limit(5)

    const { data: ahjRequirements } = await supabase
      .from('ahj_requirements')
      .select('*, ahj_portals(name, county_or_city, portal_url, avg_approval_days, portal_tips)')
      .eq('is_active', true)

    const { data: products } = await supabase
      .from('product_approvals')
      .select('manufacturer, product_name, approval_number, fl_approval_number, layer_type')
      .eq('is_active', true)
      .eq('is_expired', false)
      .limit(100)

    const systemPrompt = buildSystemPrompt(
      company,
      job,
      recentJobs || [],
      ahjRequirements || [],
      products || []
    )

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: trimmed,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('[chat] Claude API error:', data)
      return Response.json({ error: 'AI service unavailable' }, { status: 500 })
    }

    const reply = data.content?.[0]?.text || 'Sorry I could not process that request.'

    console.log('[chat] contractor_chat', {
      company_id: context.companyId,
      job_id: jobId || null,
      message_count: trimmed.length,
      last_user_message: trimmed[trimmed.length - 1]?.content?.slice(0, 100),
    })

    return Response.json({ reply })
  } catch (err) {
    console.error('[chat] Unexpected error:', err.message)
    return Response.json({ error: err.message || 'Chat failed' }, { status: 500 })
  }
}
