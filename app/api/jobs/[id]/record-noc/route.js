// app/api/jobs/[id]/record-noc/route.js
// Manual eRecording bridge — mark notarized NOC as recorded

import { createClient } from '../../../../../lib/supabase-server'
import { recordNocForJob, uploadRecordedNocPdf } from '../../../../../lib/noc/record-noc'

export async function POST(request, { params }) {
  try {
    const { id: jobId } = await params
    if (!jobId) return Response.json({ error: 'Job ID required' }, { status: 400 })

    const supabase = createClient()
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const contentType = request.headers.get('content-type') || ''
    let recordingNumber = null
    let recordingNumberOnly = false
    let recordedFilePath = null
    let uploadedFile = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      recordingNumber = formData.get('recording_number')
      recordingNumberOnly = formData.get('recording_number_only') === 'true'
      uploadedFile = formData.get('recorded_noc_file')
      recordedFilePath = formData.get('recorded_file_path')
    } else {
      const body = await request.json()
      recordingNumber = body.recording_number
      recordingNumberOnly = !!body.recording_number_only
      recordedFilePath = body.recorded_file_path
    }

    if (uploadedFile && typeof uploadedFile.arrayBuffer === 'function') {
      const fileBuffer = Buffer.from(await uploadedFile.arrayBuffer())
      recordedFilePath = await uploadRecordedNocPdf(
        jobId,
        fileBuffer,
        uploadedFile.type || 'application/pdf'
      )
    }

    const result = await recordNocForJob(jobId, {
      recordingNumber,
      recordingNumberOnly,
      recordedFilePath,
      recordedBy: user.id,
    })

    return Response.json(result)
  } catch (err) {
    console.error('Record NOC error:', err)
    return Response.json({ error: err.message }, { status: 400 })
  }
}
