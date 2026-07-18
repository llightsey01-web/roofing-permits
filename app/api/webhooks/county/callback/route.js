// app/api/webhooks/county/callback/route.js
// Durable county portal callback → CountySubmissionCompleted

export const dynamic = 'force-dynamic'

function loadWebhooks() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../lib/workflow/webhooks.js')
}

export async function GET() {
  return Response.json({
    ok: true,
    provider: 'county',
    event: 'CountySubmissionCompleted',
    path: '/api/webhooks/county/callback',
  })
}

export async function POST(request) {
  try {
    const { handleCountyCallback } = loadWebhooks()
    const result = await handleCountyCallback(request)
    return Response.json(result.body, { status: result.status })
  } catch (err) {
    console.error('[webhooks/county/callback]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
