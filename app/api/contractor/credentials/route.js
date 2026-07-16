import { authenticateRequest, requireCompanyUser } from '../../../../lib/auth/session.js'
import secureCredentialService from '../../../../lib/credentials/secure-credential-service.js'
import { isEncryptionConfigured } from '../../../../lib/crypto/credential-encryption.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const [credentials, vaultCredentials] = await Promise.all([
      secureCredentialService.listCredentialsForCompany(context.companyId),
      secureCredentialService.listVaultCredentialsForCompany(context.companyId),
    ])

    return Response.json({
      credentials,
      vaultCredentials,
      encryptionConfigured: isEncryptionConfigured(),
    })
  } catch (err) {
    console.error('List credentials error:', err.message)
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
    const { ahj_id, username, password, notes } = body

    if (!ahj_id || !username || !password) {
      return Response.json({ error: 'ahj_id, username, and password are required' }, { status: 400 })
    }

    const credential = await secureCredentialService.createCredential({
      companyId: context.companyId,
      ahjId: ahj_id,
      username,
      password,
      notes,
    })

    return Response.json({ credential }, { status: 201 })
  } catch (err) {
    const status = err.status || 500
    console.error('Create credential error:', err.message)
    return Response.json({ error: err.message }, { status })
  }
}
