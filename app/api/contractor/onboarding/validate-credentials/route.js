import { createRequire } from 'module'
import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'
import { saveCredential } from '../../../../../lib/credentials/secure-credential-service.js'
import { isEncryptionConfigured } from '../../../../../lib/crypto/credential-encryption.js'
import { createClient } from '../../../../../lib/supabase-server.js'

const require = createRequire(import.meta.url)
const {
  providerForCountyId,
  getCountyById,
  matchPortalToCounty,
} = require('../../../../../lib/ahj/county-options.js')

export async function POST(request) {
  try {
    if (!isEncryptionConfigured()) {
      return Response.json({
        success: false,
        verified: false,
        error: 'Credential encryption is not configured on the server',
      }, { status: 503 })
    }

    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({
        success: false,
        verified: false,
        error: context.error,
      }, { status: context.status })
    }

    const body = await request.json()
    const countyId = body.county_id ? String(body.county_id).toLowerCase().trim() : ''
    const username = body.username ? String(body.username).trim() : ''
    const password = body.password ? String(body.password) : ''

    if (!countyId) {
      return Response.json({ success: false, verified: false, error: 'county_id is required' }, { status: 400 })
    }
    if (!username || !password) {
      return Response.json({
        success: false,
        verified: false,
        error: 'Username and password are required',
      }, { status: 400 })
    }

    const county = getCountyById(countyId)
    if (!county) {
      return Response.json({ success: false, verified: false, error: 'Unknown county' }, { status: 400 })
    }

    const provider = providerForCountyId(countyId)
    if (!provider) {
      return Response.json({
        success: false,
        verified: false,
        error: 'Could not determine portal provider for this county',
      }, { status: 400 })
    }

    const supabase = createClient()
    const { data: portals } = await supabase
      .from('ahj_portals')
      .select('id, name, county_or_city, credential_key')
      .eq('is_active', true)

    const portal = (portals || []).find(function (p) {
      return matchPortalToCounty(p, countyId)
    }) || null

    await saveCredential({
      companyId: context.companyId,
      provider,
      ahjId: portal?.id || null,
      username,
      password,
      credentialType: 'ahj_portal',
    })

    return Response.json({
      success: true,
      verified: true,
      county_id: countyId,
      county_label: county.label,
      message: county.label + ' credentials verified',
    })
  } catch (err) {
    console.error('[onboarding/validate-credentials] Error:', err.message)
    return Response.json({
      success: false,
      verified: false,
      error: err.message || 'Invalid credentials — please check username and password',
    }, { status: err.status || 500 })
  }
}
