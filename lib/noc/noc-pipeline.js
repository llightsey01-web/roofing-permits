// lib/noc/noc-pipeline.js
// NOC pipeline — generates filled NOC PDF and sends to Proof for signing + notarization

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function safeSetField(form, fieldName, value) {
  if (!value) return
  try {
    form.getTextField(fieldName).setText(String(value))
  } catch (e) {}
}

async function generateNOC(jobId, job, company) {
  const supabase = getSupabase()

  const { data: templateData, error: templateError } = await supabase
    .storage.from('job-documents').download('templates/noc-template.pdf')

  if (templateError) throw new Error('NOC template not found: ' + templateError.message)

  const pdfDoc = await PDFDocument.load(await templateData.arrayBuffer())
  const form = pdfDoc.getForm()

  const fullAddress = job.property_address + ', ' + job.property_city + ', ' + job.property_state + ' ' + job.property_zip
  const propertyDescription = job.legal_description
    ? job.legal_description + '; ' + fullAddress
    : fullAddress

  // Build contractor address with license number
  let contractorAddress = ''
  if (company) {
    contractorAddress = company.name + ', ' + company.address + ', ' + company.city + ', ' + company.state + ' ' + company.zip
    if (company.license_number) {
      contractorAddress += ' License: ' + company.license_number
    }
  }

  safeSetField(form, 'Tax Folio No', job.parcel_number || '')
  safeSetField(form, '1', propertyDescription)
  safeSetField(form, 'General description of improvement', job.scope_of_work || 'Re-roof replacement')
  safeSetField(form, 'Name and address', job.owner_name + ', ' + fullAddress)
  safeSetField(form, 'Interest in property', 'Fee Simple')
  safeSetField(form, 'Contractor Name and Address', contractorAddress)
  safeSetField(form, 'Contractors phone number', company && company.phone ? company.phone : '')

  form.flatten()

  // Embed white text tag for Proof signature auto-placement
  const pages = pdfDoc.getPages()
  if (pages.length >= 2) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    pages[1].drawText('[sig|req|signer1                    ]', {
      x: 72,
      y: 539,
      size: 12,
      font,
      color: rgb(1, 1, 1),
    })
  }

  const pdfBytes = await pdfDoc.save()

  const filePath = 'jobs/' + jobId + '/generated/noc-filled.pdf'
  const { error: uploadError } = await supabase.storage
    .from('job-documents')
    .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadError) throw new Error('Failed to upload NOC: ' + uploadError.message)

  await supabase.from('jobs').update({
    noc_status: 'generated',
    noc_generated_at: new Date().toISOString(),
    noc_file_path: filePath,
  }).eq('id', jobId)

  console.log('NOC generated: ' + filePath)
  return { filePath, pdfBytes }
}

export async function startNOCPipeline(jobId) {
  console.log('Starting NOC pipeline for job ' + jobId)
  const supabase = getSupabase()

  const { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', jobId).single()

  if (jobError || !job) {
    console.error('Job query error:', jobError)
    throw new Error('Job not found: ' + jobId)
  }

  // Load company using correct column names
  let company = null
  if (job.company_id) {
    const { data: companyData } = await supabase
      .from('companies')
      .select('id, name, address, city, state, zip, phone, license_number, qualifier_name, qualifier_license')
      .eq('id', job.company_id)
      .single()
    company = companyData
  }

  console.log('Job: ' + job.owner_name + ' — ' + job.property_address)
  console.log('Company: ' + (company ? company.name : 'not found'))
  if (company) console.log('License: ' + (company.license_number || 'not set'))

  if (!job.owner_name) throw new Error('Owner name required')
  if (!job.property_address) throw new Error('Property address required')

  try {
    console.log('Step 1: Generating NOC PDF...')
    const { filePath, pdfBytes } = await generateNOC(jobId, job, company)
    console.log('NOC generated')

    console.log('Step 2: Sending to Proof for notarization...')
    await supabase.from('jobs').update({
      noc_status: 'queued_for_notarization',
    }).eq('id', jobId)

    const { startProofNotarization } = await import('../../automation/proof-runner.js')
    startProofNotarization(jobId, job, pdfBytes)
      .then(function() { console.log('Proof notarization sent for job ' + jobId) })
      .catch(function(err) { console.error('Proof error for job ' + jobId + ': ' + err.message) })

    console.log('NOC pipeline started')
    return { success: true, filePath }

  } catch (err) {
    console.error('NOC pipeline failed: ' + err.message)
    await supabase.from('jobs').update({ noc_status: 'error' }).eq('id', jobId)
    throw err
  }
}