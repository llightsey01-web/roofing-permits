// app/api/webhooks/proof/notarization/route.js
// Durable Proof.com notarization-complete webhook → NotaryCompleted

export const dynamic = 'force-dynamic'

function loadWebhooks() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../lib/workflow/webhooks.js')
}

export async function GET() {
  return Response.json({
    ok: true,
    provider: 'proof',
    event: 'NotaryCompleted',
    path: '/api/webhooks/proof/notarization',
  })
}

export async function POST(request) {
  try {
    const { handleProofNotarization } = loadWebhooks()
    const result = await handleProofNotarization(request)
    return Response.json(result.body, { status: result.status })
  } catch (err) {
    console.error('[webhooks/proof/notarization]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
