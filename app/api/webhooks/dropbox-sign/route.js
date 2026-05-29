// app/api/webhooks/dropbox-sign/route.js
// Dropbox Sign removed from NOC workflow — using Proof.com for signing + notarization
// Keeping this file to avoid 404 errors if old webhooks fire

export async function POST(request) {
  return new Response('Hello API Event Received', { status: 200 })
}
