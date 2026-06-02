// lib/proof/proof-session.js
// Shared Proof.com browser session helpers

const { chromium } = require('playwright')
const { writeFileSync, unlinkSync, mkdirSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')
const proofConfig = require('../../automation/ahjs/configs/proof.config')
const {
  placeAllConfiguredFields,
  capturePdfViewerScreenshot,
  navigateToPdfPage,
  findPdfPageElements,
} = require('./placement')
const { validateProofCredentials } = require('./send-noc-to-proof')
const { getCredential } = require('../credentials/credential-loader')
const { configureProofTransactionIdentity } = require('./transaction-setup')

async function login(page, options) {
  var opts = options || {}
  var creds = await getCredential({ provider: 'proof', companyId: opts.companyId || null })

  console.log('Logging into Proof...')
  await page.goto(proofConfig.loginUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await (await page.waitForSelector(proofConfig.selectors.loginEmail, { timeout: 10000 })).fill(creds.email)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  await (await page.waitForSelector(proofConfig.selectors.loginPassword, { timeout: 10000 })).fill(creds.password)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(5000)
  console.log('Logged in: ' + page.url())
}

async function uploadPdfToNewTransaction(page, pdfPath) {
  console.log('Creating Proof notarization transaction...')
  await page.goto(proofConfig.newTransactionUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  console.log('Uploading NOC PDF to Proof...')
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('button')).some(function(b) {
      return b.textContent.includes('Upload a document')
    })
  })
  await page.evaluate(function() {
    Array.from(document.querySelectorAll('button')).find(function(b) {
      return b.textContent.includes('Upload a document')
    }).click()
  })
  await page.waitForTimeout(800)
  var fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 })
  await fileInput.setInputFiles(pdfPath)
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('button')).some(function(b) {
      return b.textContent.includes('Add') && b.textContent.includes('document to transaction')
    })
  }, { timeout: 30000 })
  await page.waitForTimeout(400)
  await page.evaluate(function() {
    Array.from(document.querySelectorAll('button')).find(function(b) {
      return b.textContent.includes('Add') && b.textContent.includes('document to transaction')
    }).click()
  })
  await page.waitForTimeout(1800)
  console.log('Document uploaded to Proof')
}

async function openDocumentEditor(page) {
  console.log('Opening document editor...')
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('button')).some(function(b) {
      return b.textContent.includes('Upload a document')
    })
  })
  await page.evaluate(function() {
    Array.from(document.querySelectorAll('button')).find(function(b) {
      return b.textContent.includes('Upload a document')
    }).click()
  })
  await page.waitForTimeout(3500)
}

async function saveAndCloseEditor(page) {
  await page.waitForFunction(function() {
    return Array.from(document.querySelectorAll('button')).some(function(b) {
      return b.textContent.includes('Save') && b.textContent.includes('Close')
    })
  }, { timeout: 10000 })
  await page.evaluate(function() {
    Array.from(document.querySelectorAll('button')).find(function(b) {
      return b.textContent.includes('Save') && b.textContent.includes('Close')
    }).click()
  })
  await page.waitForTimeout(2500)
}

function createPlacementOutputDir(baseDir) {
  var dir = baseDir || join('automation', 'logs', 'proof-placement-' + Date.now())
  mkdirSync(dir, { recursive: true })
  return dir
}

async function runPlacementCalibration(page, options) {
  var outputDir = createPlacementOutputDir(options && options.outputDir)
  var config = options && options.config ? options.config : proofConfig
  var pageSize = config.pdfPageSize

  console.log('Calibration output dir: ' + outputDir)
  await capturePdfViewerScreenshot(page, join(outputDir, '01-editor-open.png'))

  var pageElements = await findPdfPageElements(page, pageSize)
  console.log('Detected PDF page elements: ' + pageElements.length)

  var targetPage = proofConfig.FROZEN_OWNER_SIGNATURE.page
  await navigateToPdfPage(page, targetPage, pageSize)
  await capturePdfViewerScreenshot(page, join(outputDir, '02-page-' + targetPage + '-before-placement.png'))

  var placementResults = await placeAllConfiguredFields(page, config)
  await capturePdfViewerScreenshot(page, join(outputDir, '03-all-fields-placed.png'))

  for (var i = 0; i < placementResults.results.length; i++) {
    var item = placementResults.results[i]
    await navigateToPdfPage(page, item.result.placement.page, pageSize)
    await page.waitForTimeout(500)
    await capturePdfViewerScreenshot(page, join(outputDir, '04-' + item.fieldName + '.png'))
  }

  var manifest = {
    mode: 'calibration',
    created_at: new Date().toISOString(),
    proofPlacement: proofConfig.FROZEN_PROOF_PLACEMENT,
    fieldTools: proofConfig.FROZEN_FIELD_TOOLS,
    pdfPageSize: config.pdfPageSize,
    pageElements: pageElements,
    fieldsPlaced: placementResults.fieldsPlaced,
    fieldsVisibleAfter: placementResults.fieldsVisibleAfter,
    placementResults: placementResults.results.map(function(item) {
      return {
        fieldName: item.fieldName,
        placement: item.result.placement,
        pageRect: item.result.pageRect,
        viewport: item.result.viewport,
        tool: item.result.tool,
      }
    }),
    notes: 'Frozen production placement — ownerSignature page 2 only. Do not edit without re-calibration.',
  }

  writeFileSync(join(outputDir, 'placement-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('Calibration complete — screenshots saved to ' + outputDir)
  console.log('NOT sending transaction (calibration mode)')
  return {
    success: true,
    calibration: true,
    outputDir: outputDir,
    manifest: manifest,
    fieldsPlaced: placementResults.fieldsPlaced,
    fieldsVisibleAfter: placementResults.fieldsVisibleAfter,
  }
}

async function withProofSession(pdfBytes, handler, options) {
  var opts = options || {}
  var credentialError = await validateProofCredentials(opts.companyId || null)
  if (credentialError) {
    console.error('Proof session aborted: ' + credentialError)
    return { success: false, skipped: true, reason: credentialError }
  }

  mkdirSync('automation/logs', { recursive: true })
  var browser = await chromium.launch({
    headless: true,
    slowMo: opts.slowMo || 500,
  })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)
  var uploadFilename = opts.uploadFilename || ('noc-proof-' + Date.now() + '.pdf')
  var tempPath = join(tmpdir(), uploadFilename)
  writeFileSync(tempPath, Buffer.from(pdfBytes))

  try {
    await login(page, { companyId: opts.companyId || null })
    await uploadPdfToNewTransaction(page, tempPath)
    if (opts.identity) {
      await configureProofTransactionIdentity(page, opts.identity)
    }
    await openDocumentEditor(page)
    return await handler(page)
  } finally {
    try { unlinkSync(tempPath) } catch (e) {}
    await browser.close()
  }
}

module.exports = {
  proofConfig,
  login,
  uploadPdfToNewTransaction,
  openDocumentEditor,
  saveAndCloseEditor,
  createPlacementOutputDir,
  runPlacementCalibration,
  withProofSession,
}
