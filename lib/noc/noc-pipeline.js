// lib/noc/noc-pipeline.js
// NOC pipeline — generates filled NOC PDF and queues for notarization

const fs = require('fs')
const path = require('path')
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
  if (value == null || value === '') return
  try {
    form.getTextField(fieldName).setText(String(value))
  } catch (e) {}
}

function safeCheck(form, fieldName) {
  try {
    form.getCheckBox(fieldName).check()
  } catch (e) {}
}

function safeUncheck(form, fieldName) {
  try {
    form.getCheckBox(fieldName).uncheck()
  } catch (e) {}
}

function getNocScopeOfWork(job) {
  const scope = job?.scope_of_work ? String(job.scope_of_work).trim() : ''
  return scope || 'Residential re-roof'
}

function buildFullAddress(job) {
  var cityStateZip = [job.property_city, [job.property_state, job.property_zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [job.property_address, cityStateZip].filter(Boolean).join(', ')
}

function buildContractorAddress(company) {
  if (!company) return ''
  var parts = [company.name, company.address, company.city, company.state, company.zip]
    .filter(Boolean)
  var line = parts.join(', ')
  if (company.license_number) line += ' License: ' + company.license_number
  return line
}

/**
 * Resolve one-page Florida NOC fillable template bytes.
 * Prefer bundled templates/noc-template.pdf (repo + Docker); fall back to Supabase Storage.
 */
async function loadNocTemplateBytes(supabase) {
  var candidates = [
    path.join(__dirname, '..', '..', 'templates', 'noc-template.pdf'),
    path.join(process.cwd(), 'templates', 'noc-template.pdf'),
  ]
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      console.log('NOC template loaded from disk: ' + candidates[i])
      return fs.readFileSync(candidates[i])
    }
  }

  if (!supabase) {
    throw new Error('NOC template not found on disk and no Supabase client available')
  }

  var { data: templateData, error: templateError } = await supabase
    .storage.from('job-documents').download('templates/noc-template.pdf')
  if (templateError) throw new Error('NOC template not found: ' + templateError.message)
  console.log('NOC template loaded from Supabase Storage templates/noc-template.pdf')
  return Buffer.from(await templateData.arrayBuffer())
}

/**
 * Fill AcroForm fields on the one-page §713.13 template (notice-of-commencement-2023).
 * Unmapped legal fields (surety, lender, §713.13 designates, etc.) are left blank intentionally.
 */
async function fillNocForm(pdfDoc, job, company) {
  var form = pdfDoc.getForm()
  var fullAddress = buildFullAddress(job)
  var legalDescription = job.legal_description ? String(job.legal_description).trim() : ''
  var streetAddress = fullAddress
  var generalDescription = getNocScopeOfWork(job)
  var contractorAddress = buildContractorAddress(company)

  // Permit No. — DART iQ does not currently store AHJ permit # at NOC generation time
  safeSetField(form, 'Permit No', job.permit_number || job.ahj_permit_number || '')

  safeSetField(form, 'Tax Folio No', job.parcel_number || '')
  safeSetField(form, '1 Description of property legal description of property', legalDescription || streetAddress)
  safeSetField(form, 'a Street job Address', streetAddress)
  safeSetField(form, '2 General description of improvements', generalDescription)

  safeSetField(form, 'a Name and address', (job.owner_name || '') + (fullAddress ? ', ' + fullAddress : ''))
  safeSetField(form, 'b Interest in property', 'Fee Simple')
  // fee simple titleholder if other than owner — no separate data source; leave blank

  safeSetField(form, 'a Name and address_2', contractorAddress)
  safeSetField(form, 'b Phone number', company && company.phone ? company.phone : '')
  // Fax No Opt — no fax field in company model; leave blank

  // Surety / lender / §713.13(1)(a)7 / §713.13(1)(b) / expiration override — no data; leave blank

  // Online notarization checkbox (right of "physical presence or ☐ online notarization")
  // Acrobat named the online box "physical presence or"; physical is the other checkbox.
  safeUncheck(form, 'The foregoing instrument was acknowledged before me by means of')
  safeCheck(form, 'physical presence or')

  var generalDescriptionInForm = generalDescription
  try {
    generalDescriptionInForm = form.getTextField('2 General description of improvements').getText()
  } catch (e) {}

  return { form: form, generalDescriptionInForm: generalDescriptionInForm }
}

async function generateNOC(jobId, job, company, options) {
  var opts = options || {}
  var skipUpload = !!opts.skipUpload
  var supabase = opts.supabase || null
  if (!supabase && !skipUpload) supabase = getSupabase()

  var templateBytes = await loadNocTemplateBytes(supabase)
  var pdfDoc = await PDFDocument.load(templateBytes)

  if (pdfDoc.getPageCount() !== 1) {
    console.warn('NOC template page count is ' + pdfDoc.getPageCount() + ' (expected 1)')
  }

  var filled = await fillNocForm(pdfDoc, job, company)
  console.log('NOC general description: ' + filled.generalDescriptionInForm)

  filled.form.flatten()

  var pdfBytes = await pdfDoc.save()
  var filePath = 'jobs/' + jobId + '/generated/noc-filled.pdf'

  if (!skipUpload) {
    if (!supabase) supabase = getSupabase()
    var { error: uploadError } = await supabase.storage
      .from('job-documents')
      .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) throw new Error('Failed to upload NOC: ' + uploadError.message)

    await supabase.from('jobs').update({
      noc_status: 'generated',
      noc_generated_at: new Date().toISOString(),
      noc_file_path: filePath,
    }).eq('id', jobId)
  }

  console.log('NOC generated: ' + filePath + ' (' + pdfDoc.getPageCount() + ' page(s), ' + pdfBytes.length + ' bytes)')
  return {
    filePath: filePath,
    pdfBytes: pdfBytes,
    generalDescription: filled.generalDescriptionInForm,
    pageCount: pdfDoc.getPageCount(),
  }
}

async function startNOCPipeline(jobId) {
  console.log('Starting NOC pipeline for job ' + jobId)
  var supabase = getSupabase()

  var { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', jobId).single()

  if (jobError || !job) {
    console.error('Job query error:', jobError)
    throw new Error('Job not found: ' + jobId)
  }

  var company = null
  if (job.company_id) {
    var { data: companyData } = await supabase
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
      var { lookupPolkLegalDescriptionFromAppraiser } = require('../parcels/polk-legal-description.js')
      var legalDescription = await lookupPolkLegalDescriptionFromAppraiser(job.parcel_number)
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
    var { filePath, pdfBytes } = await generateNOC(jobId, job, company, { supabase: supabase })
    console.log('NOC generated')

    await supabase.from('jobs').update({
      noc_status: 'queued_for_notarization',
    }).eq('id', jobId)

    console.log('NOC pipeline complete — notarization send handled by noc-proof-erecord chain')
    return { success: true, filePath: filePath, nocStatus: 'queued_for_notarization', pdfBytes: pdfBytes }

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
  loadNocTemplateBytes,
  fillNocForm,
}
