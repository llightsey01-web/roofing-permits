// app/api/jobs/[id]/record-noc/route.js
// Manual eRecording bridge — mark notarized NOC as recorded

import { recordNocForJob, uploadRecordedNocPdf } from '../../../../../lib/noc/record-noc'
import { authenticateRequest, assertJobAccess } from '../../../../../lib/auth/session.js'

export async function POST(request, { params }) {
  try {
    const { id: jobId } = await params
    if (!jobId) return Response.json({ error: 'Job ID required' }, { status: 400 })

    const context = await authenticateRequest(request)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    if (!context.isSuperAdmin) {
      const access = await assertJobAccess(context.supabase, jobId, context.companyId)
      if (access.error) {
        return Response.json({ error: access.error }, { status: access.status })
      }
    }

    const user = context.user

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
