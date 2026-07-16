import { authenticateRequest, requireCompanyUser } from '../../../../lib/auth/session.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: company, error } = await context.userSupabase
      .from('companies')
      .select('id, name, address, city, state, zip, phone, primary_email, license_number, qualifer_name, qualifer_license, qualifier_name, qualifier_license, covered_counties')
      .eq('id', context.companyId)
      .single()

    if (error || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    return Response.json({ company })
  } catch (err) {
    console.error('Get company error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const updates = {
      name: body.name,
      address: body.address,
      city: body.city,
      state: body.state || 'FL',
      zip: body.zip,
      phone: body.phone,
      primary_email: body.primary_email,
      license_number: body.license_number,
      qualifer_name: body.qualifer_name,
      qualifer_license: body.qualifer_license,
      updated_at: new Date().toISOString(),
    }

    const { data: company, error } = await context.userSupabase
      .from('companies')
      .update(updates)
      .eq('id', context.companyId)
      .select('id, name, address, city, state, zip, phone, primary_email, license_number, qualifer_name, qualifer_license')
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ company })
  } catch (err) {
    console.error('Update company error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
