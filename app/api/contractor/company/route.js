import { authenticateRequest, requireCompanyUser } from '../../../../lib/auth/session.js'

const COMPANY_FIELDS = [
  'name',
  'dba_name',
  'address',
  'city',
  'state',
  'zip',
  'phone',
  'primary_email',
  'license_number',
  'qualifier_name',
  'qualifier_license',
  'qualifer_name',
  'qualifer_license',
]

function pickUpdates(body) {
  const updates = { updated_at: new Date().toISOString() }
  for (let i = 0; i < COMPANY_FIELDS.length; i++) {
    const key = COMPANY_FIELDS[i]
    if (body[key] !== undefined) {
      const val = body[key]
      updates[key] = val === '' || val === null ? null : String(val).trim()
    }
  }
  // Keep typo + correct columns in sync when either is sent
  if (body.qualifier_name !== undefined || body.qualifer_name !== undefined) {
    const qn = body.qualifier_name !== undefined ? body.qualifier_name : body.qualifer_name
    updates.qualifier_name = qn === '' || qn == null ? null : String(qn).trim()
    updates.qualifer_name = updates.qualifier_name
  }
  if (body.qualifier_license !== undefined || body.qualifer_license !== undefined) {
    const ql = body.qualifier_license !== undefined ? body.qualifier_license : body.qualifer_license
    updates.qualifier_license = ql === '' || ql == null ? null : String(ql).trim()
    updates.qualifer_license = updates.qualifier_license
  }
  if (body.state !== undefined && !updates.state) updates.state = 'FL'
  return updates
}

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    // select('*') avoids hard failures when only one of qualifier_/qualifer_ exists
    const { data: company, error } = await context.userSupabase
      .from('companies')
      .select('*')
      .eq('id', context.companyId)
      .single()

    if (error || !company) {
      return Response.json({ error: error?.message || 'Company not found' }, { status: 404 })
    }

    return Response.json({ company })
  } catch (err) {
    console.error('Get company error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

async function updateCompany(request) {
  let context = await authenticateRequest(request)
  context = await requireCompanyUser(context)
  if (context.error) {
    return Response.json({ error: context.error }, { status: context.status })
  }

  const body = await request.json()
  const updates = pickUpdates(body)

  let { data: company, error } = await context.userSupabase
    .from('companies')
    .update(updates)
    .eq('id', context.companyId)
    .select('*')
    .single()

  // Retry without possibly-missing synonym columns
  if (error && /column|schema cache/i.test(error.message || '')) {
    const fallback = Object.assign({}, updates)
    delete fallback.qualifer_name
    delete fallback.qualifer_license
    delete fallback.qualifier_name
    delete fallback.qualifier_license
    if (body.qualifier_name !== undefined || body.qualifer_name !== undefined) {
      const qn = body.qualifier_name !== undefined ? body.qualifier_name : body.qualifer_name
      fallback.qualifier_name = qn === '' || qn == null ? null : String(qn).trim()
    }
    if (body.qualifier_license !== undefined || body.qualifer_license !== undefined) {
      const ql = body.qualifier_license !== undefined ? body.qualifier_license : body.qualifer_license
      fallback.qualifier_license = ql === '' || ql == null ? null : String(ql).trim()
    }
    const second = await context.userSupabase
      .from('companies')
      .update(fallback)
      .eq('id', context.companyId)
      .select('*')
      .single()
    company = second.data
    error = second.error

    if (error && /column|schema cache/i.test(error.message || '')) {
      delete fallback.qualifier_name
      delete fallback.qualifier_license
      fallback.qualifer_name =
        body.qualifer_name !== undefined
          ? (body.qualifer_name === '' ? null : String(body.qualifer_name).trim())
          : (body.qualifier_name === '' || body.qualifier_name == null
            ? null
            : String(body.qualifier_name || '').trim())
      fallback.qualifer_license =
        body.qualifer_license !== undefined
          ? (body.qualifer_license === '' ? null : String(body.qualifer_license).trim())
          : (body.qualifier_license === '' || body.qualifier_license == null
            ? null
            : String(body.qualifier_license || '').trim())
      const third = await context.userSupabase
        .from('companies')
        .update(fallback)
        .eq('id', context.companyId)
        .select('*')
        .single()
      company = third.data
      error = third.error
    }
  }

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({
    company,
    message: 'Company information updated successfully',
  })
}

export async function PATCH(request) {
  try {
    return await updateCompany(request)
  } catch (err) {
    console.error('PATCH company error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    return await updateCompany(request)
  } catch (err) {
    console.error('PUT company error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
