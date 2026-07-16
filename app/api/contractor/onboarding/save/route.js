import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'
import { saveCredential } from '../../../../../lib/credentials/secure-credential-service.js'
import { isEncryptionConfigured } from '../../../../../lib/crypto/credential-encryption.js'

const AHJ_PROVIDERS = {
  polk: 'polk_accela',
  lee: 'lee_accela',
  manatee: 'manatee_accela',
  sarasota: 'sarasota_accela',
}

function normalizeReviewGates(raw) {
  const gates = raw && typeof raw === 'object' ? raw : {}
  return {
    noc_before_send: !!gates.noc_before_send,
    permit_before_submit: !!gates.permit_before_submit,
    auto_approve_all: gates.auto_approve_all !== false,
  }
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const step = Number(body.step)
    if (![1, 2, 3, 4].includes(step)) {
      return Response.json({ error: 'step must be 1-4' }, { status: 400 })
    }

    const { data: company, error: companyError } = await context.supabase
      .from('companies')
      .select('id, onboarding_status')
      .eq('id', context.companyId)
      .single()

    if (companyError || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    if (company.onboarding_status === 'active' || company.onboarding_status === 'complete') {
      return Response.json({ error: 'Onboarding already complete' }, { status: 400 })
    }

    const updates = {
      updated_at: new Date().toISOString(),
      onboarding_status: company.onboarding_status === 'needs_changes' ? 'needs_changes' : 'in_progress',
    }

    if (step === 1) {
      if (!body.name || !String(body.name).trim()) {
        return Response.json({ error: 'Company legal name is required' }, { status: 400 })
      }
      if (!body.phone || !body.primary_email) {
        return Response.json({ error: 'Phone and primary email are required' }, { status: 400 })
      }
      updates.name = String(body.name).trim()
      updates.dba_name = body.dba_name ? String(body.dba_name).trim() : null
      updates.address = body.address ? String(body.address).trim() : null
      updates.city = body.city ? String(body.city).trim() : null
      updates.state = body.state ? String(body.state).trim() : 'FL'
      updates.zip = body.zip ? String(body.zip).trim() : null
      updates.phone = String(body.phone).trim()
      updates.primary_email = String(body.primary_email).trim()
    }

    if (step === 2) {
      if (!body.license_number || !body.qualifier_name || !body.qualifier_license) {
        return Response.json({ error: 'License number, qualifier name, and qualifier license are required' }, { status: 400 })
      }
      updates.license_number = String(body.license_number).trim()
      updates.qualifier_name = String(body.qualifier_name).trim()
      updates.qualifier_license = String(body.qualifier_license).trim()
    }

    if (step === 3) {
      updates.review_gates = normalizeReviewGates(body.review_gates || body)
    }

    if (step === 4) {
      const selected = Array.isArray(body.ahjs) ? body.ahjs : []
      if (selected.length === 0) {
        return Response.json({ error: 'Select at least one county' }, { status: 400 })
      }

      const { data: portals } = await context.supabase
        .from('ahj_portals')
        .select('id, name, county_or_city')

      for (const ahj of selected) {
        const key = String(ahj.id || '').toLowerCase()
        const provider = AHJ_PROVIDERS[key] || ahj.provider
        if (!provider) {
          return Response.json({ error: 'Invalid AHJ selection' }, { status: 400 })
        }
        if (!ahj.username || !ahj.password) {
          return Response.json({ error: 'Username and password required for each selected county' }, { status: 400 })
        }

        const label = String(ahj.label || key).toLowerCase()
        const portal = (portals || []).find(function (p) {
          const hay = ((p.name || '') + ' ' + (p.county_or_city || '')).toLowerCase()
          return hay.includes(label.split(' ')[0]) || hay.includes(key)
        })

        if (isEncryptionConfigured()) {
          await saveCredential({
            companyId: context.companyId,
            provider,
            ahjId: portal?.id || null,
            username: String(ahj.username).trim(),
            password: String(ahj.password),
            credentialType: 'ahj_portal',
          })
        } else {
          // Store placeholders when encryption is not configured yet
          await context.supabase.from('company_credentials').upsert({
            company_id: context.companyId,
            provider,
            ahj_id: portal?.id || null,
            credential_type: 'ahj_portal',
            is_active: true,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'company_id,provider,ahj_id', ignoreDuplicates: false })
        }
      }
    }

    const { data: updated, error: updateError } = await context.supabase
      .from('companies')
      .update(updates)
      .eq('id', context.companyId)
      .select('*')
      .single()

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    return Response.json({ success: true, step, company: updated })
  } catch (err) {
    console.error('[onboarding/save] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
