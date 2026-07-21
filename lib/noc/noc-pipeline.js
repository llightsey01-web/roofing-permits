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

/**
 * Fill a single-line AcroForm text field with pdf-lib auto-shrink.
 * Template DA defaults to Helvetica 10 — long values hard-clip at that size.
 * setFontSize(0) sets /Tf 0 so flatten() runs layoutSinglelineText auto-fit
 * (pdf-lib floors around ~4pt). Still leave blank rather than invent data.
 */
function safeSetFieldAutoFit(form, fieldName, value) {
  if (value == null || value === '') return
  try {
    var field = form.getTextField(fieldName)
    field.setFontSize(0)
    field.setText(String(value))
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
 * Approx max chars that fit at pdf-lib's ~4pt auto-shrink floor (single-line Helvetica).
 * Measured against templates/noc-template.pdf field widths — see prior autofit audit.
 */
var NOC_AUTOFIT_MAX_CHARS = {
  legal_description: 122,
  street_address: 148,
  general_description: 148,
  owner_name_address: 148,
  contractor_name_address: 177,
}

var NOC_MANUAL_REVIEW_TYPE = 'noc_manual_completion'

function exceedsAutofitCapacity(value, maxChars) {
  if (value == null || value === '') return false
  return String(value).length > maxChars
}

/**
 * Detect fields that would still truncate after setFontSize(0) auto-shrink.
 * Returns overflow descriptors; empty array means safe to generate.
 */
function detectNocAutofitOverflows(job, company) {
  var fullAddress = buildFullAddress(job)
  var legalDescription = job.legal_description ? String(job.legal_description).trim() : ''
  var streetAddress = fullAddress
  var generalDescription = getNocScopeOfWork(job)
  var ownerLine = (job.owner_name || '') + (fullAddress ? ', ' + fullAddress : '')
  var contractorAddress = buildContractorAddress(company)

  var candidates = [
    {
      field: 'legal_description',
      value: legalDescription || streetAddress,
      maxChars: NOC_AUTOFIT_MAX_CHARS.legal_description,
      message: 'Legal description exceeds template capacity — manual NOC completion required',
    },
    {
      field: 'street_address',
      value: streetAddress,
      maxChars: NOC_AUTOFIT_MAX_CHARS.street_address,
      message: 'Street/job address exceeds template capacity — manual NOC completion required',
    },
    {
      field: 'general_description',
      value: generalDescription,
      maxChars: NOC_AUTOFIT_MAX_CHARS.general_description,
      message: 'General description exceeds template capacity — manual NOC completion required',
    },
    {
      field: 'owner_name_address',
      value: ownerLine,
      maxChars: NOC_AUTOFIT_MAX_CHARS.owner_name_address,
      message: 'Owner name/address exceeds template capacity — manual NOC completion required',
    },
    {
      field: 'contractor_name_address',
      value: contractorAddress,
      maxChars: NOC_AUTOFIT_MAX_CHARS.contractor_name_address,
      message: 'Contractor name/address exceeds template capacity — manual NOC completion required',
    },
  ]

  return candidates.filter(function (c) {
    return exceedsAutofitCapacity(c.value, c.maxChars)
  }).map(function (c) {
    return {
      field: c.field,
      maxChars: c.maxChars,
      length: String(c.value).length,
      message: c.message,
    }
  })
}

/**
 * Route overflow to manual review via existing review_requests + needs_review pattern.
 * Does not generate a truncated PDF.
 */
async function flagNocTemplateCapacityReview(supabase, job, overflows) {
  var primary = overflows[0] || {}
  var message = primary.message || 'NOC field exceeds template capacity — manual NOC completion required'
  var specs = Object.assign({}, job.job_specs || {})
  specs.noc = Object.assign({}, specs.noc || {}, {
    capacity_overflow: true,
    overflow_fields: overflows.map(function (o) { return o.field }),
    overflows: overflows,
    message: message,
    flagged_at: new Date().toISOString(),
  })

  await supabase.from('jobs').update({
    job_status: 'needs_review',
    noc_status: 'error',
    job_specs: specs,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id)

  if (job.company_id) {
    var { data: existing } = await supabase
      .from('review_requests')
      .select('id')
      .eq('job_id', job.id)
      .eq('review_type', NOC_MANUAL_REVIEW_TYPE)
      .eq('review_status', 'pending')
      .maybeSingle()

    if (!existing) {
      var { error: insertErr } = await supabase.from('review_requests').insert({
        job_id: job.id,
        company_id: job.company_id,
        review_type: NOC_MANUAL_REVIEW_TYPE,
        review_status: 'pending',
      })
      if (insertErr) {
        console.warn('[noc] review_requests insert failed:', insertErr.message)
      }
    }
  }

  console.warn('[noc] ' + message + ' (fields: ' + overflows.map(function (o) { return o.field }).join(', ') + ')')
  return { needsManualReview: true, message: message, overflows: overflows }
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
  // Long legal / address / contractor lines: auto-shrink (were hard-clipping at Helv 10)
  safeSetFieldAutoFit(form, '1 Description of property legal description of property', legalDescription || streetAddress)
  safeSetFieldAutoFit(form, 'a Street job Address', streetAddress)
  safeSetFieldAutoFit(form, '2 General description of improvements', generalDescription)

  safeSetFieldAutoFit(form, 'a Name and address', (job.owner_name || '') + (fullAddress ? ', ' + fullAddress : ''))
  safeSetField(form, 'b Interest in property', 'Fee Simple')
  // fee simple titleholder if other than owner — no separate data source; leave blank

  safeSetFieldAutoFit(form, 'a Name and address_2', contractorAddress)
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

  // Char-length approx of 4pt floor truncation (pdf-lib does not expose fit result)
  var overflows = detectNocAutofitOverflows(job, company)
  if (overflows.length > 0) {
    if (supabase && !opts.skipCapacityCheck) {
      return flagNocTemplateCapacityReview(supabase, job, overflows)
    }
    return {
      needsManualReview: true,
      message: overflows[0].message,
      overflows: overflows,
    }
  }

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
    var generated = await generateNOC(jobId, job, company, { supabase: supabase })

    if (generated.needsManualReview) {
      console.warn('NOC generation blocked — template capacity: ' + generated.message)
      return {
        success: false,
        needsManualReview: true,
        message: generated.message,
        overflows: generated.overflows,
        nocStatus: 'error',
      }
    }

    console.log('NOC generated')

    await supabase.from('jobs').update({
      noc_status: 'queued_for_notarization',
    }).eq('id', jobId)

    console.log('NOC pipeline complete — notarization send handled by noc-proof-erecord chain')
    return {
      success: true,
      filePath: generated.filePath,
      nocStatus: 'queued_for_notarization',
      pdfBytes: generated.pdfBytes,
    }

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
  detectNocAutofitOverflows,
  flagNocTemplateCapacityReview,
  NOC_AUTOFIT_MAX_CHARS,
  NOC_MANUAL_REVIEW_TYPE,
}
