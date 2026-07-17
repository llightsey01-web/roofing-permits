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

  const fullAddress = [job.property_address, job.property_city, job.property_state, job.property_zip]
    .filter(Boolean)
    .join(', ')

  const legal = job.legal_description ? String(job.legal_description).trim() : ''
  const propertyLine1 = [job.parcel_number, legal].filter(Boolean).join(' ')
  const propertyLine2 = fullAddress

  const generalDescription = getNocScopeOfWork(job)

  let companyAddress = ''
  if (company) {
    companyAddress = [company.address, company.city, company.state, company.zip].filter(Boolean).join(', ')
  }

  let contractorLine1 = company ? String(company.name || '') : ''
  let contractorLine2 = companyAddress
  if (company && company.license_number) {
    contractorLine2 = (contractorLine2 ? contractorLine2 + ' · ' : '') + 'Lic: ' + company.license_number
  }
  // Qualifier has no dedicated line on this form — keep on contractor line 2, truncated safely
  if (company && company.qualifier_name) {
    const qualBit = 'Qual: ' + company.qualifier_name +
      (company.qualifier_license ? ' ' + company.qualifier_license : '')
    const combined = (contractorLine2 ? contractorLine2 + ' · ' : '') + qualBit
    contractorLine2 = combined.length > 95 ? combined.slice(0, 92) + '…' : combined
  }

  // County from AHJ record
  let county = ''
  if (job.ahj_id) {
    try {
      const { data: ahj } = await supabase
        .from('ahj_portals')
        .select('county_or_city')
        .eq('id', job.ahj_id)
        .single()
      county = ahj?.county_or_city || ''
    } catch (ahjErr) {
      console.warn('NOC county lookup failed: ' + ahjErr.message)
    }
  }
  if (!county && job.property_county) county = job.property_county
  // Form already says "COUNTY OF" — prefer short name
  county = String(county || '').replace(/\s+County$/i, '').trim()

  // Prepared By
  safeSetField(form, 'prepared_by_name', company?.name || '')
  safeSetField(form, 'prepared_by_address', companyAddress)
  safeSetField(form, 'permit_number', job.permit_number || job.permit_no || '')

  safeSetField(form, 'county', county)

  // 1. Property
  safeSetField(form, 'property_description', propertyLine1 || propertyLine2)
  if (propertyLine1) safeSetField(form, 'property_description_line2', propertyLine2)

  // 2. Improvement
  safeSetField(form, 'general_description', generalDescription)
  let generalDescriptionInForm = generalDescription
  try {
    generalDescriptionInForm = form.getTextField('general_description').getText() || generalDescription
  } catch (e) {}
  console.log('NOC general description: ' + generalDescriptionInForm)

  // 3. Owner
  safeSetField(form, 'owner_name_address', job.owner_name || '')
  safeSetField(form, 'owner_name_address_line2', fullAddress)
  safeSetField(form, 'interest_in_property', 'Fee Simple')

  // 4. Contractor (+ qualifier on line 2)
  safeSetField(form, 'contractor_name_address', contractorLine1)
  safeSetField(form, 'contractor_name_address_line2', contractorLine2)
  safeSetField(form, 'contractor_phone', company?.phone || '')

  // 5. Surety / bond
  if (job.surety_name || job.surety_address) {
    safeSetField(
      form,
      'surety_name_address',
      [job.surety_name, job.surety_address].filter(Boolean).join(', ')
    )
  } else {
    safeSetField(form, 'surety_name_address', 'N/A')
  }
  safeSetField(form, 'bond_amount', job.bond_amount || job.amount_of_bond || '')
  safeSetField(form, 'surety_phone', job.surety_phone || '')

  // 6. Lender
  if (job.lender_name || job.lender_address) {
    safeSetField(
      form,
      'lender_name_address',
      [job.lender_name, job.lender_address].filter(Boolean).join(', ')
    )
  } else {
    safeSetField(form, 'lender_name_address', 'N/A')
  }
  safeSetField(form, 'lender_phone', job.lender_phone || '')

  // Owner printed name for signature block
  safeSetField(form, 'owner_printed_name', job.owner_name || '')

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
