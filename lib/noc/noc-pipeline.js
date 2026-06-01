// lib/noc/noc-pipeline.js
// NOC pipeline — generates filled NOC PDF and sends to Proof for signing + notarization

const { PDFDocument } = require('pdf-lib')
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function safeSetField(form, fieldName, value) {
  if (!value) return
  try {
    form.getTextField(fieldName).setText(String(value))
  } catch (e) {}
}

function getNocScopeOfWork(job) {
  const scope = job?.scope_of_work ? String(job.scope_of_work).trim() : ''
  return scope || 'Residential re-roof'
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
  const generalDescription = getNocScopeOfWork(job)
  safeSetField(form, 'General description of improvement', generalDescription)
  let generalDescriptionInForm = generalDescription
  try {
    generalDescriptionInForm = form.getTextField('General description of improvement').getText()
  } catch (e) {}
  console.log('NOC general description: ' + generalDescriptionInForm)
  safeSetField(form, 'Name and address', job.owner_name + ', ' + fullAddress)
  safeSetField(form, 'Interest in property', 'Fee Simple')
  safeSetField(form, 'Contractor Name and Address', contractorAddress)
  safeSetField(form, 'Contractors phone number', company && company.phone ? company.phone : '')

  form.flatten()

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
  return { filePath, pdfBytes, generalDescription: generalDescriptionInForm }
}

async function startNOCPipeline(jobId) {
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
  console.log('Scope of work: ' + getNocScopeOfWork(job))
  console.log('Company: ' + (company ? company.name : 'not found'))
  if (company) console.log('License: ' + (company.license_number || 'not set'))

  if (!job.owner_name) throw new Error('Owner name required')
  if (!job.property_address) throw new Error('Property address required')

  if ((!job.legal_description || !String(job.legal_description).trim()) && job.parcel_number) {
    try {
      const { lookupPolkLegalDescriptionFromAppraiser } = require('../parcels/polk-legal-description.js')
      const legalDescription = await lookupPolkLegalDescriptionFromAppraiser(job.parcel_number)
      if (legalDescription) {
        job.legal_description = legalDescription
        await supabase.from('jobs').update({ legal_description: legalDescription }).eq('id', jobId)
        console.log('Legal description loaded from Polk Property Appraiser: ' + legalDescription)
      }
    } catch (lookupErr) {
      console.error('Legal description fallback lookup failed: ' + lookupErr.message)
    }
  }

  try {
    console.log('Step 1: Generating NOC PDF...')
    const { filePath, pdfBytes } = await generateNOC(jobId, job, company)
    console.log('NOC generated')

    await supabase.from('jobs').update({
      noc_status: 'queued_for_notarization',
    }).eq('id', jobId)

    console.log('NOC pipeline complete — Proof send handled by noc-proof-erecord chain')
    return { success: true, filePath, nocStatus: 'queued_for_notarization' }

  } catch (err) {
    console.error('NOC pipeline failed: ' + err.message)
    await supabase.from('jobs').update({ noc_status: 'error' }).eq('id', jobId)
    throw err
  }
}

module.exports = {
  getNocScopeOfWork,
  generateNOC,
  startNOCPipeline,
}
