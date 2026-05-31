require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const proofConfig = require('./ahjs/configs/proof.config')
const { validateProofCredentials } = require('../lib/proof/send-noc-to-proof')
const {
  withProofSession,
  saveAndCloseEditor,
  runPlacementCalibration,
} = require('../lib/proof/proof-session')
const { placeAllConfiguredFields, capturePdfViewerScreenshot } = require('../lib/proof/placement')
const { extractProofTransactionIdFromUrl, captureProofTransactionId } = require('../lib/proof/transaction-id')
const { buildProofIdentity, buildProofMatchMeta } = require('../lib/proof/job-identity')
const { fillSignerMessage } = require('../lib/proof/transaction-setup')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function splitOwnerName(ownerName) {
  var parts = String(ownerName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: 'Homeowner', lastName: 'Homeowner' }
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : parts[0],
  }
}

function extractProofTransactionId(url) {
  return extractProofTransactionIdFromUrl(url)
}

function buildProofJobSpecs(existingSpecs, proofMeta) {
  var specs = existingSpecs && typeof existingSpecs === 'object' ? existingSpecs : {}
  return Object.assign({}, specs, { proof: proofMeta })
}

async function removeOverlays(page) {
  await page.evaluate(function() {
    document.querySelectorAll('[class*="Modal"], [class*="overlay"], [class*="Overlay"], nav').forEach(function(el) {
      var style = window.getComputedStyle(el)
      if (style.position === 'fixed' || style.position === 'absolute') {
        el.style.pointerEvents = 'none'
      }
    })
  })
  await page.waitForTimeout(300)
}

async function fillSignerInfo(page, job, identity) {
  var owner = splitOwnerName(job.owner_name)
  console.log('Assigning homeowner signer: ' + job.owner_name + ' <' + job.owner_email + '>')
  await page.waitForSelector('input[name="recipients.0.firstName"]', { timeout: 10000 })
  await page.fill('input[name="recipients.0.firstName"]', owner.firstName)
  await page.waitForTimeout(300)
  await page.fill('input[name="recipients.0.lastName"]', owner.lastName)
  await page.waitForTimeout(300)
  await page.fill('input[name="recipients.0.emailWithRecipientId.email"]', job.owner_email)
  await page.waitForTimeout(300)
  if (job.owner_phone) {
    await page.fill('input[name="recipients.0.phoneNumber"]', job.owner_phone.replace(/\D/g, ''))
    await page.waitForTimeout(300)
  }
  var smsCheckbox = await page.$('input[name="transactionSmsAuthRequired"]')
  if (smsCheckbox) {
    var isChecked = await smsCheckbox.isChecked()
    if (!isChecked) await smsCheckbox.check()
  }
  if (identity && identity.signer_message) {
    await fillSignerMessage(page, identity.signer_message)
  }
}

async function sendTransaction(page) {
  await removeOverlays(page)
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('button')).some(function(b) {
      return b.textContent.includes('Send transaction')
    })
  }, { timeout: 10000 }).catch(function() {})
  await page.evaluate(function() {
    var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
      return b.textContent.includes('Send transaction')
    })
    if (btn) btn.click()
  })
  await page.waitForTimeout(4000)
}

async function calibrateProofPlacement(pdfBytes, options) {
  return withProofSession(pdfBytes, async function(page) {
    return runPlacementCalibration(page, options)
  }, { headless: false, slowMo: 500 })
}

async function startProofNotarization(jobId, job, nocPdfBytes, options) {
  console.log('Starting Proof notarization for job ' + jobId)

  var credentialError = validateProofCredentials()
  if (credentialError) {
    console.error('Proof send aborted: ' + credentialError)
    return { success: false, skipped: true, reason: credentialError }
  }

  if (!job.owner_email || !String(job.owner_email).trim()) {
    console.error('Proof send aborted: owner_email is required')
    return { success: false, skipped: true, reason: 'owner_email is missing' }
  }

  if (!job.legal_description || !String(job.legal_description).trim()) {
    console.error('Proof send aborted: legal_description is required')
    return { success: false, skipped: true, reason: 'legal_description is missing' }
  }

  if (options && options.calibrate) {
    return calibrateProofPlacement(nocPdfBytes, options)
  }

  var identity = buildProofIdentity(job, jobId)
  var supabase = getSupabase()
  var outputDir = join('automation', 'logs', 'proof-placement-' + Date.now())
  mkdirSync(outputDir, { recursive: true })
  var sentAt = new Date().toISOString()

  return withProofSession(nocPdfBytes, async function(page) {
    console.log('Proof identity:')
    console.log('  expected_document_name: ' + identity.expected_document_name)
    console.log('  expected_transaction_title: ' + identity.expected_transaction_title)

    console.log('Placing frozen production ownerSignature from proof.config...')
    var placementOutcome = await placeAllConfiguredFields(page, proofConfig)
    await capturePdfViewerScreenshot(page, join(outputDir, 'production-all-fields-placed.png'))
    writeFileSync(join(outputDir, 'production-placement.json'), JSON.stringify({
      proofPlacement: proofConfig.FROZEN_PROOF_PLACEMENT,
      fieldsPlaced: placementOutcome.fieldsPlaced,
      fieldsVisibleAfter: placementOutcome.fieldsVisibleAfter,
      placementResults: placementOutcome.results,
    }, null, 2))

    console.log('Saving document editor...')
    await saveAndCloseEditor(page)

    await fillSignerInfo(page, job, identity)

    console.log('Sending Proof transaction to homeowner...')
    var urlBeforeSend = page.url()
    await sendTransaction(page)
    await page.screenshot({ path: join(outputDir, 'production-sent.png') })

    var finalUrl = page.url()
    var transactionId = extractProofTransactionId(finalUrl) || extractProofTransactionId(urlBeforeSend)
    var transactionIdSource = transactionId ? 'page_url' : null
    var matchResult = null
    var capture = null

    if (!transactionId) {
      console.log('Transaction ID not in URL — scraping Proof records list with strict job matching...')
      try {
        capture = await captureProofTransactionId(page, job, {
          jobId: jobId,
          outputDir: outputDir,
          sentAt: sentAt,
        })
        transactionId = capture.transactionId
        transactionIdSource = capture.transaction_id_source
        matchResult = capture.matchResult
        console.log('Captured Proof transaction ID: ' + transactionId + ' (' + transactionIdSource + ')')
        console.log('Match confidence: ' + (matchResult && matchResult.proof_match_confidence))
      } catch (captureErr) {
        console.error('Failed to capture Proof transaction ID: ' + captureErr.message)
        writeFileSync(join(outputDir, 'transaction-id-capture-error.txt'), captureErr.message)
        await page.screenshot({ path: join(outputDir, 'transaction-id-capture-failed.png') })
      }
    } else {
      console.log('Proof transaction ID from URL: ' + transactionId)
    }

    console.log('Final URL: ' + finalUrl)

    var proofMeta = {
      transaction_id: transactionId,
      transaction_id_source: transactionIdSource,
      transaction_id_captured_at: transactionId ? new Date().toISOString() : null,
      document_id: job.noc_file_path,
      sent_at: sentAt,
      signer_name: job.owner_name,
      signer_email: job.owner_email,
      signature_placement: 'configured',
      proofPlacement: proofConfig.proofPlacement,
      placement_output_dir: outputDir,
      expected_document_name: identity.expected_document_name,
      expected_transaction_title: identity.expected_transaction_title,
      signer_message: identity.signer_message,
    }

    if (matchResult) {
      Object.assign(proofMeta, buildProofMatchMeta(matchResult))
    }

    if (capture && capture.matchRejected) {
      proofMeta.transaction_id = null
      proofMeta.transaction_id_capture_rejected = true
      proofMeta.transaction_id_rejection_reason = capture.rejectionReason
    }

    var nextNocStatus = 'sent_to_homeowner'
    var nextJobStatus = job.job_status

    if (capture && capture.matchRejected) {
      nextNocStatus = job.noc_status === 'queued_for_notarization' ? 'queued_for_notarization' : job.noc_status
      nextJobStatus = 'needs_review'
      console.log('Proof transaction found but does not strongly match this job.')
    } else if (!transactionId) {
      nextJobStatus = 'needs_review'
      console.log('Proof transaction ID not captured — job marked needs_review')
    }

    var updatePayload = {
      noc_status: nextNocStatus,
      job_specs: buildProofJobSpecs(job.job_specs, proofMeta),
    }
    if (transactionId && !capture?.matchRejected) {
      updatePayload.noc_sent_at = sentAt
    }
    if (nextJobStatus !== job.job_status) {
      updatePayload.job_status = nextJobStatus
    }

    var { error: updateError } = await supabase.from('jobs').update(updatePayload).eq('id', jobId)

    if (updateError) {
      throw new Error('Failed to save Proof transaction metadata: ' + updateError.message)
    }

    console.log('Proof transaction sent — noc_status: ' + nextNocStatus)
    return {
      success: !capture?.matchRejected && !!transactionId,
      transactionId: proofMeta.transaction_id,
      nocStatus: nextNocStatus,
      jobStatus: nextJobStatus,
      identity: identity,
      matchResult: matchResult,
      outputDir: outputDir,
    }
  }, Object.assign({
    headless: false,
    slowMo: 500,
    uploadFilename: identity.expected_document_name,
    identity: identity,
  }, options || {}))
}

module.exports = { startProofNotarization, calibrateProofPlacement }
