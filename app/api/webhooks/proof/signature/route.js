// app/api/webhooks/proof/signature/route.js
// Durable Proof.com signature-complete webhook → SignatureCompleted

export const dynamic = 'force-dynamic'

function loadWebhooks() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../lib/workflow/webhooks.js')
}

export async function GET() {
  return Response.json({
    ok: true,
    provider: 'proof',
    event: 'SignatureCompleted',
    path: '/api/webhooks/proof/signature',
  })
}

export async function POST(request) {
  try {
    const { handleProofSignature } = loadWebhooks()
    const result = await handleProofSignature(request)
    return Response.json(result.body, { status: result.status })
  } catch (err) {
    console.error('[webhooks/proof/signature]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
