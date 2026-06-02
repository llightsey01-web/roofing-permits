// lib/proof/records-scanner.js
// Scan Proof transaction records for completed/signed/notarized transactions

const { chromium } = require('playwright')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const proofConfig = require('../../automation/ahjs/configs/proof.config')
const { login } = require('./proof-session')
const { validateProofCredentials } = require('./send-noc-to-proof')
const { extractProofTransactionIdFromUrl } = require('./transaction-id')
const {
  getSupabase,
  buildProofJobSpecs,
  checkProofCompletionForJob,
  buildTransactionSummaryUrl,
  buildTransactionDocumentUrl,
} = require('./completion')
const {
  evaluateProofJobMatch,
  buildProofMatchMeta,
} = require('./job-identity')

const COMPLETED_RECORD_STATUSES = ['complete', 'completed', 'notarized', 'signed', 'recorded']

const STATUS_WORDS = ['Complete', 'Completed', 'Notarized', 'Signed', 'Recorded', 'Sent', 'Draft', 'Incomplete', 'Canceled', 'Cancelled']

const SKIP_LINK_TEXTS = {
  'Untitled Transaction': true,
  'Notarize': true,
  'Transaction menu': true,
}

function isCompletedStatus(status) {
  if (!status) return false
  var lower = String(status).toLowerCase()
  return COMPLETED_RECORD_STATUSES.some(function(word) {
    return lower.indexOf(word) >= 0
  })
}

function parseRecordRowLinks(links) {
  var parsed = {
    transactionName: null,
    type: null,
    status: null,
    organization: null,
    recipientName: null,
    senderName: null,
    dateCreated: null,
    dateCompleted: null,
    rowUrl: null,
    transactionId: null,
  }

  var summaryLink = null
  ;(links || []).forEach(function(link) {
    if (!link || !link.href) return
    if ((link.href || '').indexOf('/transaction/records/') >= 0 && !summaryLink) {
      summaryLink = link
    }
  })

  if (summaryLink) {
    parsed.rowUrl = summaryLink.href
    parsed.transactionId = extractProofTransactionIdFromUrl(summaryLink.href)
  }

  var dates = []
  ;(links || []).forEach(function(link) {
    var text = (link.text || '').trim()
    if (!text || SKIP_LINK_TEXTS[text]) return
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
      dates.push(text)
      return
    }
    if (STATUS_WORDS.indexOf(text) >= 0 || STATUS_WORDS.some(function(w) { return w.toLowerCase() === text.toLowerCase() })) {
      if (!parsed.status) parsed.status = text
      return
    }
    if (text === 'Notarize') {
      parsed.type = text
      return
    }
    if (text.indexOf('(') >= 0 && text.indexOf('Logan Lightsey') === 0) {
      parsed.organization = text
      return
    }
    if (!parsed.transactionName && text !== parsed.status && text !== parsed.type) {
      if (!parsed.recipientName) {
        parsed.recipientName = text
        return
      }
      if (!parsed.senderName && text !== parsed.recipientName) {
        parsed.senderName = text
        return
      }
    }
  })

  if (!parsed.transactionName) parsed.transactionName = 'Untitled Transaction'
  if (dates.length > 0) parsed.dateCreated = dates[0]
  if (dates.length > 1) parsed.dateCompleted = dates[1]
  else if (dates.length === 1) parsed.dateCompleted = dates[0]

  return parsed
}

async function openProofRecordsPage(page) {
  var recordsUrl = proofConfig.portalUrl + '/transaction/records?configId=notarization'
  await page.goto(recordsUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('tr')).some(function(tr) {
      var text = (tr.textContent || '').replace(/\s+/g, ' ').trim()
      return text.indexOf('Transaction name') === 0 ||
        (text.indexOf('Notarize') >= 0 && (text.indexOf('Sent') >= 0 || text.indexOf('Draft') >= 0 || text.indexOf('Complete') >= 0))
    })
  }, { timeout: 15000 }).catch(function() {})
  await page.waitForTimeout(1500)
}

async function scrapeAllRecordRows(page) {
  return page.evaluate(function() {
    function extractId(href) {
      if (!href) return null
      var m = href.match(/\/transaction\/records\/([a-z0-9]+)/i) || href.match(/\/transaction\/update\/([a-z0-9]+)/i)
      return m ? m[1] : null
    }

    var rows = []
    Array.from(document.querySelectorAll('tr')).forEach(function(tr, index) {
      var text = (tr.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || text.indexOf('Transaction name') === 0) return

      var links = Array.from(tr.querySelectorAll('a[href*="/transaction/"]')).map(function(a) {
        return {
          text: (a.textContent || '').trim(),
          href: a.getAttribute('href'),
        }
      })

      var summaryHref = null
      links.forEach(function(link) {
        if ((link.href || '').indexOf('/transaction/records/') >= 0 && !summaryHref) {
          summaryHref = link.href
        }
      })

      rows.push({
        rowIndex: index,
        text: text.slice(0, 300),
        links: links,
        rowUrl: summaryHref,
        transactionId: extractId(summaryHref),
      })
    })
    return rows
  })
}

async function enrichTransactionRow(page, row) {
  var enriched = Object.assign({}, parseRecordRowLinks(row.links), {
    rowIndex: row.rowIndex,
    rawText: row.text,
  })

  if (!enriched.transactionId) return enriched

  var recipientsUrl = proofConfig.portalUrl + '/transaction/records/' + enriched.transactionId + '/user?configId=notarization'
  await page.goto(recipientsUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  var recipientInfo = await page.evaluate(function() {
    var emails = Array.from(document.querySelectorAll('a[href^="mailto:"], input[type="email"], [data-testid*="email" i]'))
      .map(function(el) {
        if (el.tagName === 'A') return (el.getAttribute('href') || '').replace(/^mailto:/i, '')
        return (el.value || el.textContent || '').trim()
      })
      .filter(Boolean)

    var body = (document.body.innerText || '').replace(/\s+/g, ' ')
    var emailMatch = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
    var names = Array.from(document.querySelectorAll('h1, h2, h3, h4, strong, td, th, span, div, p'))
      .map(function(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim() })
      .filter(function(text) {
        return text && text.length >= 3 && text.length <= 60 && !/recipient|signer|email|phone|identity|summary|document/i.test(text)
      })

    return {
      recipientEmail: emails[0] || emailMatch[0] || null,
      emails: emailMatch.slice(0, 5),
      recipientPageText: body.slice(0, 500),
    }
  })

  enriched.recipientEmail = recipientInfo.recipientEmail
  enriched.recipientEmails = recipientInfo.emails

  var documentUrl = buildTransactionDocumentUrl(enriched.transactionId)
  await page.goto(documentUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  var documentInfo = await page.evaluate(function() {
    var pdfButtons = Array.from(document.querySelectorAll('button, a'))
      .map(function(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim() })
      .filter(function(text) { return /\.pdf/i.test(text) || /noc|notice|commencement/i.test(text) })

    return {
      documentName: pdfButtons[0] || null,
      documentNames: pdfButtons.slice(0, 5),
    }
  })

  enriched.documentName = documentInfo.documentName
  enriched.documentNames = documentInfo.documentNames
  enriched.summaryUrl = buildTransactionSummaryUrl(enriched.transactionId)
  enriched.rowUrl = enriched.rowUrl || ('/transaction/records/' + enriched.transactionId + '/summary?configId=notarization')

  return enriched
}

async function scanCompletedProofTransactions(page, options) {
  var opts = options || {}
  await openProofRecordsPage(page)
  var rawRows = await scrapeAllRecordRows(page)

  var parsedRows = rawRows.map(function(row) {
    var parsed = parseRecordRowLinks(row.links)
    return Object.assign({}, row, parsed, {
      summaryUrl: parsed.transactionId ? buildTransactionSummaryUrl(parsed.transactionId) : null,
    })
  })

  var completedRows = parsedRows.filter(function(row) {
    return row.transactionId && isCompletedStatus(row.status)
  })

  if (opts.enrich) {
    var enriched = []
    for (var i = 0; i < completedRows.length; i++) {
      console.log('Enriching completed transaction ' + (i + 1) + '/' + completedRows.length + ': ' + completedRows[i].transactionId)
      enriched.push(await enrichTransactionRow(page, completedRows[i]))
    }
    completedRows = enriched
  }

  return {
    totalRows: rawRows.length,
    completedRows: completedRows,
  }
}

function printCompletedTransactions(completedRows) {
  if (!completedRows.length) {
    console.log('No completed/signed/notarized transactions found.')
    return
  }

  console.log('\nCompleted Proof transactions:\n')
  completedRows.forEach(function(row, index) {
    console.log('[' + (index + 1) + '] ' + row.transactionId)
    console.log('    status:          ' + (row.status || 'unknown'))
    console.log('    recipient name:  ' + (row.recipientName || 'unknown'))
    console.log('    recipient email: ' + (row.recipientEmail || row.recipientEmails?.[0] || 'not visible in records'))
    console.log('    date created:    ' + (row.dateCreated || 'unknown'))
    console.log('    date completed:  ' + (row.dateCompleted || 'unknown'))
    console.log('    document name:   ' + (row.documentName || 'unknown'))
    console.log('    row URL:         ' + (row.summaryUrl || row.rowUrl || 'unknown'))
    console.log('')
  })
}

function evaluateScannerMatch(job, jobId, selectedRow, manualOverride) {
  return evaluateProofJobMatch(job, jobId, selectedRow, { manualOverride: manualOverride })
}

async function saveProofTransactionIdToJob(jobId, transactionId, scannerMeta, matchResult) {
  var supabase = getSupabase()
  var { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) throw new Error('Job not found: ' + jobId)

  var existingProof = job.job_specs && job.job_specs.proof ? job.job_specs.proof : {}
  var now = new Date().toISOString()
  var proofMeta = Object.assign({}, existingProof, {
    transaction_id: transactionId,
    transaction_id_source: matchResult && matchResult.manualOverride ? 'records_scanner_manual_override' : 'records_scanner',
    transaction_id_linked_at: now,
    transaction_id_scanner: scannerMeta || null,
    proofPlacement: existingProof.proofPlacement || proofConfig.proofPlacement,
  })

  if (matchResult) {
    Object.assign(proofMeta, buildProofMatchMeta(matchResult))
    if (matchResult.manualOverride) {
      proofMeta.proof_match_method = 'manual_override+' + (matchResult.proof_match_method || 'none')
    }
  }

  var updatePayload = {
    job_specs: buildProofJobSpecs(job.job_specs, proofMeta),
  }

  if (matchResult && !matchResult.acceptedForScannerApply) {
    updatePayload.job_status = 'needs_review'
    console.log('Proof transaction found but does not strongly match this job.')
  }

  var { error: updateError } = await supabase.from('jobs').update(updatePayload).eq('id', jobId)

  if (updateError) throw new Error('Failed to save transaction ID: ' + updateError.message)

  var { data: updatedJob } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  return { job: updatedJob, matchResult: matchResult }
}

async function runProofRecordsScanner(options) {
  var opts = options || {}
  var credentialError = await validateProofCredentials(opts.companyId || null)
  if (credentialError) {
    return { success: false, skipped: true, reason: credentialError }
  }

  var outputDir = opts.outputDir || join('automation', 'logs', 'proof-records-scan-' + Date.now())
  mkdirSync(outputDir, { recursive: true })

  var browser = await chromium.launch({ headless: true, slowMo: opts.slowMo || 400 })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)

  try {
    await login(page, { companyId: opts.companyId || null })
    await openProofRecordsPage(page)
    await page.screenshot({ path: join(outputDir, '01-records-page.png'), fullPage: true })

    var scan = await scanCompletedProofTransactions(page, { enrich: opts.enrich !== false })
    writeFileSync(join(outputDir, 'completed-transactions.json'), JSON.stringify(scan, null, 2))
    printCompletedTransactions(scan.completedRows)

    var result = {
      success: true,
      outputDir: outputDir,
      totalRows: scan.totalRows,
      completedCount: scan.completedRows.length,
      completedRows: scan.completedRows,
    }

    if (opts.selectIndex != null) {
      var idx = Number(opts.selectIndex) - 1
      if (idx < 0 || idx >= scan.completedRows.length) {
        throw new Error('Invalid selection index: ' + opts.selectIndex)
      }
      result.selected = scan.completedRows[idx]
    } else if (opts.transactionId) {
      result.selected = scan.completedRows.find(function(row) {
        return row.transactionId === opts.transactionId
      })
      if (!result.selected) {
        throw new Error('Transaction ID not found among completed rows: ' + opts.transactionId)
      }
    }

    if (opts.jobId && result.selected) {
      var supabase = getSupabase()
      var { data: targetJob, error: jobError } = await supabase.from('jobs').select('*').eq('id', opts.jobId).single()
      if (jobError || !targetJob) throw new Error('Job not found: ' + opts.jobId)

      var matchResult = evaluateScannerMatch(targetJob, opts.jobId, result.selected, !!opts.manualOverride)
      result.matchResult = matchResult

      console.log('\nMatch evaluation for transaction ' + result.selected.transactionId + ':')
      console.log('  score:      ' + matchResult.score)
      console.log('  confidence: ' + matchResult.proof_match_confidence)
      console.log('  reasons:    ' + (matchResult.reasons.join(', ') || 'none'))
      console.log('  accepted:   ' + matchResult.acceptedForScannerApply)

      if (!matchResult.acceptedForScannerApply) {
        console.log('\nRefusing to link — no strong job match. Use --manual-override to force link.')
        result.linkRejected = true
        result.rejectionReason = 'Proof transaction found but does not strongly match this job.'
      } else {
        console.log('\nLinking transaction ' + result.selected.transactionId + ' to job ' + opts.jobId)
        var saveResult = await saveProofTransactionIdToJob(opts.jobId, result.selected.transactionId, result.selected, matchResult)
        result.linkedJobId = opts.jobId
        var updatedJob = saveResult.job

        if (opts.download && matchResult.acceptedForNotarization) {
          console.log('\nRunning completion downloader...')
          var jobOutputDir = join(outputDir, 'download-' + opts.jobId)
          mkdirSync(jobOutputDir, { recursive: true })
          var downloadResult = await checkProofCompletionForJob(page, updatedJob, { outputDir: jobOutputDir })
          result.download = downloadResult
        } else if (opts.download && !matchResult.acceptedForNotarization) {
          console.log('\nSkipping notarization download — match is not strong enough for auto-notarize.')
          result.downloadSkipped = true
        }
      }
    }

    writeFileSync(join(outputDir, 'scanner-result.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    await browser.close()
  }
}

module.exports = {
  COMPLETED_RECORD_STATUSES,
  isCompletedStatus,
  parseRecordRowLinks,
  openProofRecordsPage,
  scrapeAllRecordRows,
  enrichTransactionRow,
  scanCompletedProofTransactions,
  printCompletedTransactions,
  evaluateScannerMatch,
  saveProofTransactionIdToJob,
  runProofRecordsScanner,
}
