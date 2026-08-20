// lib/permits/packet-assembly.js
// ZIG-17 PR 3: deterministic merge + durable submission_packet persist.
'use strict'

var { mergePdfBuffers } = require('../documents/packet-merge')
var {
  persistSubmissionPacketDocument,
  submissionPacketStoragePath,
  uploadStorageBytes,
  isLoadablePdf,
} = require('./packet-documents')

async function persistAssembledSubmissionPacket(supabase, job, orderedBytes) {
  var pdfBytes = await mergePdfBuffers(orderedBytes)
  if (!(await isLoadablePdf(pdfBytes))) {
    throw Object.assign(new Error('assembled submission packet failed PDF reload'), {
      errorCode: 'packet_assembly_invalid_pdf',
    })
  }

  var filePath = submissionPacketStoragePath(job.id)
  await uploadStorageBytes(supabase, filePath, pdfBytes)
  var persisted = await persistSubmissionPacketDocument(supabase, {
    jobId: job.id,
    fileName: 'Submission Packet.pdf',
    filePath: filePath,
    fileSizeBytes: pdfBytes.length,
    mimeType: 'application/pdf',
  })

  return {
    documentId: persisted.id,
    filePath: filePath,
    fileName: 'Submission Packet.pdf',
    reused: persisted.reused === true,
    bytes: pdfBytes,
  }
}

module.exports = {
  persistAssembledSubmissionPacket: persistAssembledSubmissionPacket,
}
