// lib/proof/completion.js
// Detect Proof transaction completion and download notarized NOC PDF

const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const { writeFileSync, mkdirSync, readFileSync, copyFileSync, readdirSync, mkdtempSync, unlinkSync } = require('fs')
const { join } = require('path')
const { execSync } = require('child_process')
const { tmpdir } = require('os')
const proofConfig = require('../../automation/ahjs/configs/proof.config')
const { login } = require('./proof-session')
const { validateProofCredentials } = require('./send-noc-to-proof')
const { evaluateProofJobMatch, buildProofMatchMeta } = require('./job-identity')
const { buildErecordJobSpecs, mergeErecordMeta } = require('../erecord/job-specs')
const { ERECORD_PROVIDERS } = require('../erecord/constants')
const { getProofTransactionId } = require('./proof-job-meta')

const COMPLETE_STATUS_WORDS = ['completed', 'complete', 'notarized', 'recorded']
const INCOMPLETE_STATUS_WORDS = ['sent', 'draft', 'incomplete', 'in progress', 'pending', 'waiting', 'scheduled', 'canceled', 'cancelled']

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function buildProofJobSpecs(existingSpecs, proofMeta) {
  var specs = existingSpecs && typeof existingSpecs === 'object' ? existingSpecs : {}
  return Object.assign({}, specs, { proof: proofMeta })
}

function buildTransactionSummaryUrl(transactionId) {
  return proofConfig.portalUrl + '/transaction/records/' + transactionId + '/summary?configId=notarization'
}

function buildTransactionDocumentUrl(transactionId) {
  return proofConfig.portalUrl + '/transaction/records/' + transactionId + '/document?configId=notarization'
}

function notarizedStoragePath(jobId) {
  return 'jobs/' + jobId + '/notarized/noc-notarized.pdf'
}

async function loadJobsAwaitingProofCompletion(supabase, jobId) {
  if (jobId) {
    var { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
    if (error || !job) throw new Error('Job not found: ' + jobId)
    if (!getProofTransactionId(job)) {
      return []
    }
    return [job]
  }

  var { data: jobs, error: listError } = await supabase
    .from('jobs')
    .select('*')
    .eq('noc_status', 'sent_to_homeowner')

  if (listError) throw new Error('Failed to load jobs: ' + listError.message)

  return (jobs || []).filter(function(job) {
    return !!getProofTransactionId(job)
  })
}

function normalizeStatusText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function pickPrimaryStatus(statuses) {
  if (!statuses || !statuses.length) return null
  var lower = statuses.map(function(s) { return s.toLowerCase() })
  for (var i = 0; i < COMPLETE_STATUS_WORDS.length; i++) {
    var idx = lower.findIndex(function(s) { return s.indexOf(COMPLETE_STATUS_WORDS[i]) >= 0 })
    if (idx >= 0) return statuses[idx]
  }
  for (var j = 0; j < INCOMPLETE_STATUS_WORDS.length; j++) {
    var idx2 = lower.findIndex(function(s) { return s.indexOf(INCOMPLETE_STATUS_WORDS[j]) >= 0 })
    if (idx2 >= 0) return statuses[idx2]
  }
  return statuses[0]
}

function isProofTransactionComplete(statusInfo) {
  if (!statusInfo) return false

  var candidates = []
  if (statusInfo.primaryStatus) candidates.push(statusInfo.primaryStatus)
  if (statusInfo.summaryStatus) candidates.push(statusInfo.summaryStatus)
  if (statusInfo.documentStatus) candidates.push(statusInfo.documentStatus)
  ;(statusInfo.statuses || []).forEach(function(s) { candidates.push(s) })

  var normalized = candidates.map(function(s) { return normalizeStatusText(s).toLowerCase() }).filter(Boolean)
  if (!normalized.length) return false

  var hasComplete = normalized.some(function(s) {
    return COMPLETE_STATUS_WORDS.some(function(word) { return s.indexOf(word) >= 0 })
  })
  if (hasComplete) return true

  var hasIncomplete = normalized.some(function(s) {
    return INCOMPLETE_STATUS_WORDS.some(function(word) { return s.indexOf(word) >= 0 })
  })
  if (hasIncomplete) return false

  return false
}

async function readProofTransactionStatus(page, transactionId) {
  var summaryUrl = buildTransactionSummaryUrl(transactionId)
  await page.goto(summaryUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  var summaryInfo = await page.evaluate(function() {
    function findStatusWords(text) {
      var known = ['Completed', 'Complete', 'Notarized', 'Recorded', 'Sent', 'Draft', 'Incomplete', 'In progress', 'Pending', 'Waiting', 'Scheduled', 'Canceled', 'Cancelled']
      var found = []
      known.forEach(function(word) {
        if (new RegExp('\\b' + word + '\\b', 'i').test(text)) found.push(word)
      })
      return found
    }

    var bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    var headerMatch = bodyText.match(/Untitled Transaction[\s\S]{0,250}/i)
    var headerText = headerMatch ? headerMatch[0] : bodyText.slice(0, 500)
    var statuses = findStatusWords(headerText)
    var statusNodes = Array.from(document.querySelectorAll('[class*="status" i], [data-testid*="status" i], span, div, p'))
      .map(function(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim() })
      .filter(function(text) {
        return text && text.length < 40 && /^(Sent|Complete|Completed|Notarized|Draft|Incomplete|In progress|Pending|Canceled|Cancelled)$/i.test(text)
      })

    statusNodes.forEach(function(text) {
      if (statuses.indexOf(text) < 0) statuses.push(text)
    })

    return {
      url: location.href,
      headerText: headerText.slice(0, 300),
      statuses: statuses,
      summaryStatus: statuses[0] || null,
    }
  })

  var documentUrl = buildTransactionDocumentUrl(transactionId)
  await page.goto(documentUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  var documentInfo = await page.evaluate(function() {
    var docStatuses = Array.from(document.querySelectorAll('button, span, div'))
      .map(function(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim() })
      .filter(function(text) {
        return text && text.length < 40 && /^(Complete|Completed|Notarized|Incomplete|Sent|Draft)$/i.test(text)
      })

    var downloadCandidates = Array.from(document.querySelectorAll('button, a'))
      .map(function(el) {
        return {
          tag: el.tagName,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          href: el.getAttribute('href'),
        }
      })
      .filter(function(item) {
        return /download/i.test(item.text) || (item.href && /\.pdf|download/i.test(item.href))
      })

    return {
      url: location.href,
      documentStatus: docStatuses[0] || null,
      downloadCandidates: downloadCandidates.slice(0, 10),
    }
  })

  var allStatuses = summaryInfo.statuses.slice()
  if (documentInfo.documentStatus && allStatuses.indexOf(documentInfo.documentStatus) < 0) {
    allStatuses.push(documentInfo.documentStatus)
  }

  return {
    transactionId: transactionId,
    summaryUrl: summaryInfo.url,
    documentUrl: documentInfo.url,
    headerText: summaryInfo.headerText,
    statuses: allStatuses,
    summaryStatus: summaryInfo.summaryStatus,
    documentStatus: documentInfo.documentStatus,
    primaryStatus: pickPrimaryStatus(allStatuses),
    downloadCandidates: documentInfo.downloadCandidates,
    isComplete: false,
  }
}

async function clickTransactionAction(page, labelPattern) {
  await page.evaluate(function() {
    var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
      return (b.textContent || '').indexOf('Transaction actions') >= 0
    })
    if (btn) btn.click()
  })
  await page.waitForTimeout(800)

  var clicked = await page.evaluate(function(patternSource) {
    var pattern = new RegExp(patternSource, 'i')
    var item = Array.from(document.querySelectorAll('button, a, [role="menuitem"]')).find(function(el) {
      return pattern.test((el.textContent || '').replace(/\s+/g, ' ').trim())
    })
    if (!item) return false
    item.click()
    return true
  }, labelPattern)

  await page.waitForTimeout(1000)
  return clicked
}

function isPdfBuffer(buf) {
  return buf && buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
}

function isZipBuffer(buf) {
  return buf && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
}

function findPdfFilesRecursive(dir, base) {
  var root = base || dir
  var results = []
  readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
    var fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(findPdfFilesRecursive(fullPath, root))
    } else if (/\.pdf$/i.test(entry.name)) {
      results.push(fullPath)
    }
  })
  return results
}

function normalizeDownloadedFile(downloadedPath, outputPath) {
  var buf = readFileSync(downloadedPath)
  if (isPdfBuffer(buf)) {
    if (downloadedPath !== outputPath) copyFileSync(downloadedPath, outputPath)
    return { format: 'pdf', outputPath: outputPath }
  }

  if (isZipBuffer(buf)) {
    var tempDir = mkdtempSync(join(tmpdir(), 'proof-dl-'))
    try {
      execSync('unzip -o ' + JSON.stringify(downloadedPath) + ' -d ' + JSON.stringify(tempDir), { stdio: 'pipe' })
      var pdfFiles = findPdfFilesRecursive(tempDir)
      if (!pdfFiles.length) throw new Error('ZIP download did not contain a PDF')
      pdfFiles.sort(function(a, b) {
        return b.length - a.length
      })
      copyFileSync(pdfFiles[0], outputPath)
      return { format: 'zip', outputPath: outputPath, extractedFrom: pdfFiles[0], zipMembers: pdfFiles }
    } finally {
      try { execSync('rm -rf ' + JSON.stringify(tempDir)) } catch (e) {}
    }
  }

  throw new Error('Downloaded file is neither PDF nor ZIP: ' + downloadedPath)
}

async function saveDownloadAsPdf(download, outputPath) {
  var tempPath = outputPath + '.download'
  await download.saveAs(tempPath)
  var normalized = normalizeDownloadedFile(tempPath, outputPath)
  try { unlinkSync(tempPath) } catch (e) {}
  return normalized
}

async function downloadNotarizedPdf(page, transactionId, outputPath) {
  var errors = []

  async function attempt(label, fn) {
    try {
      var result = await fn()
      if (result) return result
      errors.push(label + ': no download triggered')
    } catch (err) {
      errors.push(label + ': ' + err.message)
    }
    return null
  }

  var saved = await attempt('document_pdf_button', async function() {
    await page.goto(buildTransactionDocumentUrl(transactionId), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    var downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    var clicked = await page.evaluate(function() {
      var el = Array.from(document.querySelectorAll('button, a')).find(function(node) {
        return /\.pdf/i.test((node.textContent || '').trim())
      })
      if (!el) return false
      el.click()
      return true
    })
    if (!clicked) return null
    var download = await downloadPromise
    var normalized = await saveDownloadAsPdf(download, outputPath)
    return { source: 'document_pdf_button', suggestedFilename: download.suggestedFilename(), normalized: normalized }
  })

  if (saved) return saved

  saved = await attempt('document_page_download', async function() {
    await page.goto(buildTransactionDocumentUrl(transactionId), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    var downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    var clicked = await page.evaluate(function() {
      var el = Array.from(document.querySelectorAll('button, a')).find(function(node) {
        var text = (node.textContent || '').trim()
        return /download/i.test(text) && !/download all/i.test(text)
      })
      if (!el) return false
      el.click()
      return true
    })
    if (!clicked) return null
    var download = await downloadPromise
    var normalized = await saveDownloadAsPdf(download, outputPath)
    return { source: 'document_page_download', suggestedFilename: download.suggestedFilename(), normalized: normalized }
  })

  if (saved) return saved

  saved = await attempt('transaction_actions_download', async function() {
    await page.goto(buildTransactionSummaryUrl(transactionId), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    var downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    var clicked = await clickTransactionAction(page, 'download')
    if (!clicked) return null
    var download = await downloadPromise
    var normalized = await saveDownloadAsPdf(download, outputPath)
    return { source: 'transaction_actions_download', suggestedFilename: download.suggestedFilename(), normalized: normalized }
  })

  if (saved) return saved

  saved = await attempt('document_page_download_all_zip', async function() {
    await page.goto(buildTransactionDocumentUrl(transactionId), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    var downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    var clicked = await page.evaluate(function() {
      var el = Array.from(document.querySelectorAll('button, a')).find(function(node) {
        return /download all/i.test((node.textContent || '').trim())
      })
      if (!el) return false
      el.click()
      return true
    })
    if (!clicked) return null
    var download = await downloadPromise
    var normalized = await saveDownloadAsPdf(download, outputPath)
    return { source: 'document_page_download_all_zip', suggestedFilename: download.suggestedFilename(), normalized: normalized }
  })

  if (saved) return saved

  throw new Error('Could not download notarized PDF. Attempts: ' + errors.join('; '))
}

async function uploadNotarizedNocToStorage(supabase, jobId, localPath) {
  var storagePath = notarizedStoragePath(jobId)
  var pdfBytes = readFileSync(localPath)
  var { error } = await supabase.storage.from('job-documents').upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw new Error('Failed to upload notarized NOC: ' + error.message)
  return storagePath
}

async function checkProofCompletionForJob(page, job, options) {
  var opts = options || {}
  var outputDir = opts.outputDir
  var transactionId = getProofTransactionId(job)
  if (!transactionId) {
    throw new Error('Job missing job_specs.proof.transaction_id')
  }

  console.log('Checking Proof transaction ' + transactionId + ' for job ' + job.id)

  var statusInfo = await readProofTransactionStatus(page, transactionId)
  statusInfo.isComplete = isProofTransactionComplete(statusInfo)

  var matchRecord = Object.assign({}, statusInfo, {
    transactionName: statusInfo.headerText,
    text: statusInfo.headerText,
  })
  var matchResult = evaluateProofJobMatch(job, job.id, matchRecord, {
    sentAt: job.job_specs && job.job_specs.proof ? job.job_specs.proof.sent_at : null,
  })

  if (outputDir) {
    writeFileSync(join(outputDir, 'proof-status.json'), JSON.stringify(statusInfo, null, 2))
    writeFileSync(join(outputDir, 'proof-match.json'), JSON.stringify(matchResult, null, 2))
    await page.goto(buildTransactionSummaryUrl(transactionId), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(outputDir, '01-summary-status.png') })
    await page.goto(buildTransactionDocumentUrl(transactionId), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(outputDir, '02-document-status.png') })
  }

  if (!matchResult.acceptedForNotarization) {
    console.log('Proof transaction found but does not strongly match this job.')
    console.log('  Match confidence: ' + matchResult.proof_match_confidence + ' (' + matchResult.proof_match_method + ')')

    var supabaseWeak = getSupabase()
    var existingProofWeak = job.job_specs && job.job_specs.proof ? job.job_specs.proof : {}
    var weakProofMeta = Object.assign({}, existingProofWeak, buildProofMatchMeta(matchResult), {
      completion_match_rejected: true,
      completion_match_rejected_at: new Date().toISOString(),
    })

    await supabaseWeak.from('jobs').update({
      job_status: 'needs_review',
      job_specs: buildProofJobSpecs(job.job_specs, weakProofMeta),
    }).eq('id', job.id)

    return {
      success: true,
      complete: statusInfo.isComplete,
      matchRejected: true,
      jobId: job.id,
      transactionId: transactionId,
      status: statusInfo,
      matchResult: matchResult,
      outputDir: outputDir || null,
    }
  }

  if (!statusInfo.isComplete) {
    console.log('Proof transaction not complete — status: ' + (statusInfo.primaryStatus || statusInfo.summaryStatus || 'unknown'))
    return {
      success: true,
      complete: false,
      jobId: job.id,
      transactionId: transactionId,
      status: statusInfo,
      outputDir: outputDir || null,
    }
  }

  console.log('Proof transaction complete — downloading notarized PDF...')
  var workDir = outputDir || join(tmpdir(), 'proof-completion-' + job.id)
  mkdirSync(workDir, { recursive: true })
  var localPdfPath = join(workDir, 'noc-notarized.pdf')

  var downloadInfo = await downloadNotarizedPdf(page, transactionId, localPdfPath)
  if (outputDir) {
    await page.screenshot({ path: join(outputDir, '03-after-download.png') })
    writeFileSync(join(outputDir, 'download-info.json'), JSON.stringify(downloadInfo, null, 2))
  }

  var supabase = getSupabase()
  var storagePath = await uploadNotarizedNocToStorage(supabase, job.id, localPdfPath)
  console.log('Uploaded notarized NOC: ' + storagePath)

  var now = new Date().toISOString()
  var existingProof = job.job_specs && job.job_specs.proof ? job.job_specs.proof : {}
  var proofMeta = Object.assign({}, existingProof, buildProofMatchMeta(matchResult), {
    notarized_file_path: storagePath,
    completed_at: now,
    downloaded_at: now,
    completion_status: statusInfo.primaryStatus || statusInfo.summaryStatus || 'complete',
    completion_download_source: downloadInfo.source,
    completion_output_dir: outputDir || null,
    proofPlacement: existingProof.proofPlacement || proofConfig.proofPlacement,
  })

  var proofSpecs = buildProofJobSpecs(job.job_specs, proofMeta)
  var erecordQueued = mergeErecordMeta({ job_specs: proofSpecs }, {
    provider: ERECORD_PROVIDERS.EPN,
    status: 'queued',
    queued_at: now,
  })
  var queuedSpecs = buildErecordJobSpecs(proofSpecs, erecordQueued)

  var { error: updateError } = await supabase.from('jobs').update({
    noc_status: 'notarized',
    job_specs: queuedSpecs,
  }).eq('id', job.id)

  if (updateError) throw new Error('Failed to update job: ' + updateError.message)

  var erecordPrepResult = null
  var erecordPrepError = null
  try {
    var chainMod = await import('../automation/noc-proof-erecord-chain.js')
    var chainFns = chainMod.default || chainMod
    erecordPrepResult = await chainFns.continueToErecordPrep(job.id, {
      outputDir: outputDir ? join(outputDir, 'epn-prepare') : undefined,
      headless: true,
    })
    console.log('ePN package prepared: packId=' + (erecordPrepResult.packId || 'unknown'))
  } catch (prepErr) {
    erecordPrepError = prepErr.message
    console.error('ePN package preparation failed (job remains queued_for_erecord): ' + prepErr.message)
  }

  return {
    success: true,
    complete: true,
    jobId: job.id,
    transactionId: transactionId,
    nocStatus: erecordPrepResult ? 'ready_for_erecord_review' : 'notarized',
    notarizedFilePath: storagePath,
    status: statusInfo,
    downloadInfo: downloadInfo,
    outputDir: outputDir || null,
    erecordPrepResult: erecordPrepResult,
    erecordPrepError: erecordPrepError,
  }
}

async function runProofCompletionCheck(options) {
  var opts = options || {}
  var supabase = getSupabase()
  var jobs = await loadJobsAwaitingProofCompletion(supabase, opts.jobId)
  if (!jobs.length) {
    return { success: true, processed: 0, results: [], message: 'No jobs awaiting Proof completion' }
  }

  var companyId = opts.companyId || jobs[0].company_id || null
  var credentialError = await validateProofCredentials(companyId)
  if (credentialError) {
    return { success: false, skipped: true, reason: credentialError }
  }

  var outputDir = opts.outputDir || join(tmpdir(), 'proof-completion-' + Date.now())
  mkdirSync(outputDir, { recursive: true })

  var browser = await chromium.launch({
    headless: true,
    slowMo: opts.slowMo || 400,
  })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)

  var results = []
  try {
    await login(page, { companyId: companyId })
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i]
      var requireSentStatus = !opts.jobId
      if (requireSentStatus && job.noc_status !== 'sent_to_homeowner') {
        results.push({ jobId: job.id, skipped: true, reason: 'noc_status is ' + job.noc_status })
        continue
      }
      if (!getProofTransactionId(job)) {
        results.push({ jobId: job.id, skipped: true, reason: 'missing transaction_id' })
        continue
      }

      var jobOutputDir = jobs.length > 1 ? join(outputDir, job.id) : outputDir
      mkdirSync(jobOutputDir, { recursive: true })
      var result = await checkProofCompletionForJob(page, job, { outputDir: jobOutputDir })
      results.push(result)
    }
  } finally {
    await browser.close()
  }

  writeFileSync(join(outputDir, 'completion-results.json'), JSON.stringify(results, null, 2))
  return { success: true, processed: results.length, outputDir: outputDir, results: results }
}

module.exports = {
  COMPLETE_STATUS_WORDS,
  INCOMPLETE_STATUS_WORDS,
  getSupabase,
  buildProofJobSpecs,
  getProofTransactionId,
  buildTransactionSummaryUrl,
  buildTransactionDocumentUrl,
  notarizedStoragePath,
  loadJobsAwaitingProofCompletion,
  isProofTransactionComplete,
  readProofTransactionStatus,
  downloadNotarizedPdf,
  uploadNotarizedNocToStorage,
  checkProofCompletionForJob,
  runProofCompletionCheck,
}
