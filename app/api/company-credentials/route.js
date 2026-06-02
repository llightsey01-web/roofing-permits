import { authenticateRequest, requireCompanyUser } from '../../../lib/auth/session.js'
import secureCredentialService from '../../../lib/credentials/secure-credential-service.js'
import { isEncryptionConfigured } from '../../../lib/crypto/credential-encryption.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const credentials = await secureCredentialService.listVaultCredentialsForCompany(context.companyId)
    return Response.json({
      credentials,
      encryptionConfigured: isEncryptionConfigured(),
      vaultEnabled: process.env.CREDENTIAL_VAULT_ENABLED === 'true',
    })
  } catch (err) {
    console.error('List company credentials error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

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
    const { provider, ahj_id, username, password, credential_type, extra } = body

    if (!provider) {
      return Response.json({ error: 'provider is required' }, { status: 400 })
    }
    if (!username && !password && !extra) {
      return Response.json({ error: 'username, password, or extra is required' }, { status: 400 })
    }

    const credential = await secureCredentialService.saveCredential({
      companyId: context.companyId,
      provider,
      ahjId: ahj_id || null,
      username: username || null,
      password: password || null,
      extra: extra || null,
      credentialType: credential_type || null,
    })

    return Response.json({ credential }, { status: 201 })
  } catch (err) {
    const status = err.status || 500
    console.error('Save company credential error:', err.message)
    return Response.json({ error: err.message }, { status })
  }
}
