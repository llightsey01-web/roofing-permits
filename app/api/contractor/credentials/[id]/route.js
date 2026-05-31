import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'
import secureCredentialService from '../../../../../lib/credentials/secure-credential-service.js'
import { isEncryptionConfigured } from '../../../../../lib/crypto/credential-encryption.js'

export async function PUT(request, { params }) {
  try {
    if (!isEncryptionConfigured()) {
      return Response.json({ error: 'Credential encryption is not configured on the server' }, { status: 503 })
    }

    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const body = await request.json()
    const { username, password, notes } = body

    const credential = await secureCredentialService.updateCredential({
      credentialId: id,
      companyId: context.companyId,
      username,
      password: password || undefined,
      notes,
    })

    return Response.json({ credential })
  } catch (err) {
    const status = err.status || 500
    console.error('Update credential error:', err.message)
    return Response.json({ error: err.message }, { status })
  }
}

export async function DELETE(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    await secureCredentialService.deleteCredential(id, context.companyId)
    return Response.json({ success: true })
  } catch (err) {
    console.error('Delete credential error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
