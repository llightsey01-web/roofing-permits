// lib/proof/transaction-id.js
// Capture Proof transaction IDs from records list after send (strict job matching)

const { join } = require('path')
const { writeFileSync } = require('fs')
const proofConfig = require('../../automation/ahjs/configs/proof.config')
const {
  buildExpectedDocumentName,
  evaluateProofJobMatch,
  buildProofMatchMeta,
} = require('./job-identity')

function extractProofTransactionIdFromUrl(url) {
  if (!url) return null
  var value = String(url)
  var patterns = [
    /\/transaction\/records\/([a-z0-9]+)(?:\/|$|\?)/i,
    /\/transaction\/update\/([a-z0-9]+)(?:\/|$|\?)/i,
    /\/transaction\/([a-f0-9-]{8,})(?:\/|$|\?)/i,
  ]
  for (var i = 0; i < patterns.length; i++) {
    var match = value.match(patterns[i])
    if (match && match[1] && match[1] !== 'records' && match[1] !== 'new') {
      return match[1]
    }
  }
  return null
}

function splitOwnerName(ownerName) {
  var parts = String(ownerName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: 'Homeowner', lastName: 'Homeowner', fullName: 'Homeowner Homeowner' }
  var firstName = parts[0]
  var lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  return {
    firstName: firstName,
    lastName: lastName,
    fullName: firstName + ' ' + lastName,
  }
}

async function openProofRecordsPage(page) {
  var recordsUrl = proofConfig.portalUrl + '/transaction/records?configId=notarization'
  if (!page.url().includes('/transaction/records')) {
    await page.goto(recordsUrl, { waitUntil: 'domcontentloaded' })
  }
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('tr')).some(function(tr) {
      var text = (tr.textContent || '').replace(/\s+/g, ' ').trim()
      return text.indexOf('Transaction name') === 0 ||
        (text.indexOf('Notarize') >= 0 && (text.indexOf('Sent') >= 0 || text.indexOf('Draft') >= 0))
    })
  }, { timeout: 15000 }).catch(function() {})
  await page.waitForTimeout(1500)
}

async function scrapeSentTransactionsFromRecords(page, criteria) {
  return page.evaluate(function(args) {
    function parseDate(text) {
      var match = String(text || '').match(/(\d{2}\/\d{2}\/\d{4})/)
      return match ? match[1] : null
    }

    function extractId(href) {
      if (!href) return null
      var patterns = [
        /\/transaction\/records\/([a-z0-9]+)/i,
        /\/transaction\/update\/([a-z0-9]+)/i,
      ]
      for (var i = 0; i < patterns.length; i++) {
        var m = href.match(patterns[i])
        if (m) return m[1]
      }
      return null
    }

    var rows = []
    Array.from(document.querySelectorAll('tr')).forEach(function(tr, index) {
      var text = (tr.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || text.indexOf('Transaction name') === 0) return

      var links = Array.from(tr.querySelectorAll('a[href*="/transaction/"]'))
      var summaryLink = links.find(function(a) {
        return (a.getAttribute('href') || '').indexOf('/transaction/records/') >= 0
      })
      var href = summaryLink ? summaryLink.getAttribute('href') : null
      var isSent = text.indexOf('Sent') >= 0 && !!href
      if (!isSent) return

      var transactionName = null
      var recipientText = null
      links.forEach(function(a) {
        var linkText = (a.textContent || '').trim()
        if (!linkText || linkText === 'Sent' || linkText === 'Notarize') return
        if (linkText.indexOf('Logan Lightsey') === 0 || linkText.indexOf('(') >= 0) return
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(linkText)) return
        if (!transactionName && linkText !== 'Untitled Transaction') {
          transactionName = linkText
          return
        }
        if (!recipientText) recipientText = linkText
      })

      rows.push({
        rowIndex: index,
        text: text.slice(0, 300),
        href: href,
        transactionId: extractId(href),
        transactionName: transactionName,
        recipient: recipientText,
        status: 'Sent',
        dateCreated: parseDate(text),
      })
    })

    return rows
  }, criteria)
}

function scoreAndRankRows(rows, job, jobId, options) {
  var opts = options || {}
  return rows.map(function(row) {
    var matchResult = evaluateProofJobMatch(job, jobId, row, {
      sentAt: opts.sentAt,
      nowMs: opts.nowMs,
    })
    return Object.assign({}, row, { matchResult: matchResult })
  }).sort(function(a, b) {
    if (b.matchResult.score !== a.matchResult.score) {
      return b.matchResult.score - a.matchResult.score
    }
    return a.rowIndex - b.rowIndex
  })
}

async function captureProofTransactionId(page, job, options) {
  var opts = options || {}
  var outputDir = opts.outputDir
  var jobId = opts.jobId
  if (!jobId) throw new Error('jobId is required for strict Proof transaction matching')

  var fromUrl = extractProofTransactionIdFromUrl(page.url())
  if (fromUrl) {
    var urlMatch = evaluateProofJobMatch(job, jobId, { href: page.url() }, { sentAt: opts.sentAt })
    if (urlMatch.acceptedForPostSendCapture) {
      return {
        transactionId: fromUrl,
        transaction_id_source: 'page_url',
        href: page.url(),
        matchResult: urlMatch,
      }
    }
  }

  await openProofRecordsPage(page)
  if (outputDir) {
    await page.screenshot({ path: join(outputDir, 'transaction-records-before-match.png') })
  }

  var rows = await scrapeSentTransactionsFromRecords(page, {})
  var ranked = scoreAndRankRows(rows, job, jobId, { sentAt: opts.sentAt })
  var best = ranked[0]

  if (outputDir) {
    writeFileSync(join(outputDir, 'transaction-id-candidates.json'), JSON.stringify(ranked.map(function(r) {
      return {
        transactionId: r.transactionId,
        transactionName: r.transactionName,
        recipient: r.recipient,
        score: r.matchResult.score,
        confidence: r.matchResult.proof_match_confidence,
        reasons: r.matchResult.reasons,
        accepted: r.matchResult.acceptedForPostSendCapture,
      }
    }), null, 2))
  }

  if (!best || !best.transactionId) {
    throw new Error('Could not find any sent Proof transaction on records page')
  }

  if (!best.matchResult.acceptedForPostSendCapture) {
    console.log('Proof transaction found but does not strongly match this job.')
    console.log('  Best candidate: ' + best.transactionId + ' (score=' + best.matchResult.score + ', confidence=' + best.matchResult.proof_match_confidence + ')')
    console.log('  Expected document: ' + buildExpectedDocumentName(jobId))
    return {
      transactionId: best.transactionId,
      transaction_id_source: 'records_row_href_rejected',
      href: best.href,
      matchResult: best.matchResult,
      matchRejected: true,
      rejectionReason: 'Proof transaction found but does not strongly match this job.',
      matchedRows: ranked,
    }
  }

  var result = {
    transactionId: best.transactionId,
    transaction_id_source: 'records_row_href',
    href: best.href,
    recipient: best.recipient,
    transactionName: best.transactionName,
    status: best.status,
    rowText: best.text,
    matchResult: best.matchResult,
    matchedRows: ranked,
  }

  if (opts.openDetailPage) {
    var detailUrl = best.href.indexOf('http') === 0
      ? best.href
      : proofConfig.portalUrl.replace(/\/$/, '') + best.href
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    var detailId = extractProofTransactionIdFromUrl(page.url())
    if (detailId) {
      result.transactionId = detailId
      result.transaction_id_source = 'records_detail_url'
      result.detailUrl = page.url()
    }
    if (outputDir) {
      await page.screenshot({ path: join(outputDir, 'transaction-detail-after-open.png') })
    }
  } else if (outputDir) {
    await page.screenshot({ path: join(outputDir, 'transaction-id-captured.png') })
  }

  if (outputDir) {
    writeFileSync(join(outputDir, 'transaction-id-capture.json'), JSON.stringify(result, null, 2))
  }

  return result
}

module.exports = {
  extractProofTransactionIdFromUrl,
  splitOwnerName,
  openProofRecordsPage,
  scrapeSentTransactionsFromRecords,
  scoreAndRankRows,
  captureProofTransactionId,
  buildProofMatchMeta,
}
