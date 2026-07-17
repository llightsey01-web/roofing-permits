import { createClient } from '../../../../lib/supabase-server.js'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const filePath = searchParams.get('path')

  if (!filePath || !filePath.startsWith('ahj-forms/') || filePath.indexOf('..') !== -1) {
    return Response.json({ error: 'Invalid path' }, { status: 400 })
  }

  const supabase = createClient()

  const { data, error } = await supabase.storage
    .from('job-documents')
    .createSignedUrl(filePath, 3600) // 1 hour expiry

  if (error || !data?.signedUrl) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  // Redirect to signed URL
  return Response.redirect(data.signedUrl, 302)
}
