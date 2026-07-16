import { createRequire } from 'module'
import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'
import { saveCredential } from '../../../../../lib/credentials/secure-credential-service.js'
import { isEncryptionConfigured } from '../../../../../lib/crypto/credential-encryption.js'
import { createClient } from '../../../../../lib/supabase-server.js'

const require = createRequire(import.meta.url)
const { providerForPortal, providerForCountyId, getCountyById } = require('../../../../../lib/ahj/county-options.js')

export async function POST(request) {
  try {
    if (!isEncryptionConfigured()) {
      return Response.json({ error: 'Credential encryption is not configured on the server' }, { status: 503 })
    }

    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const username = body.username ? String(body.username).trim() : ''
    const password = body.password ? String(body.password) : ''
    const ahjId = body.ahj_id || null
    const countyId = body.county_id ? String(body.county_id).toLowerCase() : null

    if (!username || !password) {
      return Response.json({ error: 'Portal username and password are required' }, { status: 400 })
    }
    if (!ahjId && !countyId) {
      return Response.json({ error: 'ahj_id or county_id is required' }, { status: 400 })
    }

    const supabase = createClient()
    let portal = null
    if (ahjId) {
      const { data } = await supabase
        .from('ahj_portals')
        .select('id, name, county_or_city, credential_key')
        .eq('id', ahjId)
        .maybeSingle()
      portal = data
    }

    let provider = null
    if (countyId) {
      provider = providerForCountyId(countyId)
    }
    if (!provider && portal) {
      provider = providerForPortal(portal)
    }
    if (!provider) {
      return Response.json({ error: 'Could not determine portal provider for this county' }, { status: 400 })
    }

    const county = countyId ? getCountyById(countyId) : null
    const credential = await saveCredential({
      companyId: context.companyId,
      provider,
      ahjId: portal?.id || ahjId || null,
      username,
      password,
      credentialType: 'ahj_portal',
    })

    return Response.json({
      success: true,
      credential,
      county: county || null,
      ahj_name: portal?.name || county?.label || provider,
    })
  } catch (err) {
    console.error('[credentials/save] Error:', err.message)
    return Response.json({ error: err.message }, { status: err.status || 500 })
  }
}
