// app/api/webhooks/epn/recording/route.js
// Durable ePN recording webhook → RecordingFinished

export const dynamic = 'force-dynamic'

function loadWebhooks() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../lib/workflow/webhooks.js')
}

export async function GET() {
  return Response.json({
    ok: true,
    provider: 'epn',
    event: 'RecordingFinished',
    path: '/api/webhooks/epn/recording',
  })
}

export async function POST(request) {
  try {
    const { handleEpnRecording } = loadWebhooks()
    const result = await handleEpnRecording(request)
    return Response.json(result.body, { status: result.status })
  } catch (err) {
    console.error('[webhooks/epn/recording]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
