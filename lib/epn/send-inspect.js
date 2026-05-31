// lib/epn/send-inspect.js
// ePN pass 9 — read-only #SendPackage metadata (NEVER clicks — one-click live submit)

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const { ensureDummyPdf } = require('../../automation/fixtures/generate-dummy-pdf')
const {
  ensureWorklist,
  createTestPackage,
  trySafeDiscardPackage,
} = require('./worklist-helpers')
const {
  slugify,
  selectDocumentType,
  clickWizardTab,
  uploadDummyPdf,
  fillAndCommitParties,
  clickSaveButton,
  extractPackageStatus,
  extractDocumentRowStatus,
  collectSubmitButtonInventory,
  dismissInactivityWarning,
  inspectSendPackageButton,
  inspectSendPackageBoundary,
} = require('./data-entry-helpers')
const {
  SendPackageSafetyError,
  isTestPackageName,
  isDummyDocumentPath,
  enforceDryRunSubmitBoundary,
  NEVER_DELETE_PACK_IDS,
} = require('./submit-safety')

async function sendCapture(page, outputDir, stepName) {
  await dismissInactivityWarning(page)
  var screenshotPath = join(outputDir, 'send-inspect-' + slugify(stepName) + '.png')
  var jsonPath = join(outputDir, 'send-inspect-' + slugify(stepName) + '.json')
  var snapshot = await page.evaluate(function() {
    return {
      url: location.href,
      title: document.title,
      bodySample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500),
    }
  })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2))
  console.log('Send capture: ' + stepName)
  return { screenshot: screenshotPath, json: jsonPath, snapshot: snapshot }
}

async function exploreSendInspect(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var dummyPdfPath = ensureDummyPdf(join(outputDir, 'fixtures'), 2)
  var packId = null
  var readyConfirmed = false
  var sendInspectResult = null
  var discardResult = { attempted: false, discarded: false, reason: 'not attempted' }

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog (dismissed): ' + dialog.message())
    await dialog.dismiss().catch(function() {})
  })

  await ensureWorklist(page)

  console.log('Creating test package: ' + packageName)
  var createResult = await createTestPackage(page, packageName, 'Polk County, FL')
  if (!createResult.created || !createResult.packId) throw new Error('Failed to create test package')
  packId = createResult.packId
  if (NEVER_DELETE_PACK_IDS.indexOf(String(packId)) >= 0) {
    throw new SendPackageSafetyError('Refusing forbidden packId: ' + packId)
  }
  console.log('Package created: packId=' + packId)

  console.log('Selecting document type: Notice Of Commencement')
  var docTypeResult = await selectDocumentType(page, 'Notice Of Commencement')
  if (!docTypeResult.selected) throw new Error('Document type selection failed')

  console.log('Uploading 2-page dummy PDF: ' + dummyPdfPath)
  if (isDummyDocumentPath(dummyPdfPath)) {
    console.log('Dummy PDF detected (expected for send-inspect dry-run): ' + dummyPdfPath)
  }
  var uploadResult = await uploadDummyPdf(page, dummyPdfPath)
  console.log('Dummy upload: ' + (uploadResult.success ? 'success' : 'failed — ' + uploadResult.reason))

  console.log('Committing parties...')
  await clickWizardTab(page, '#indexing-status')
  var partyResult = await fillAndCommitParties(page, {
    grantorName: 'Test Owner',
    grantorRadio: 'person',
    granteeName: 'GAETANO HOME SERVICES',
    granteeRadio: 'company',
  })
  console.log('Grantor Add: ' + partyResult.grantor.success + ' Grantee Add: ' + partyResult.grantee.success)

  console.log('Saving package...')
  var saveResult = await clickSaveButton(page)
  console.log('Save: ' + (saveResult.success ? 'success' : 'failed'))

  var postSaveStatus = await extractPackageStatus(page)
  var documentRowStatus = await extractDocumentRowStatus(page)
  var submitInventory = await collectSubmitButtonInventory(page)
  var sendButtonMeta = await inspectSendPackageButton(page)

  readyConfirmed = /\bready\b/i.test(postSaveStatus.statusGuess || '') &&
    /ready to send/i.test(documentRowStatus.bodySample || documentRowStatus.documentStatus || '') &&
    submitInventory.hasSubmitButton

  console.log('Ready confirmed: ' + readyConfirmed)
  console.log('Package status: ' + (postSaveStatus.statusGuess || 'unknown'))
  console.log('Document status: ' + (documentRowStatus.documentStatus || 'unknown'))
  console.log('SendPackage found: ' + sendButtonMeta.found)

  await sendCapture(page, outputDir, '01-ready-before-send')

  if (!readyConfirmed) {
    throw new Error('Package not Ready / SendPackage not available — aborting send inspect')
  }

  console.log('Inspecting #SendPackage metadata only — NEVER clicking (one-click live submit)...')
  sendInspectResult = await inspectSendPackageBoundary(page)
  var dryRunBoundary = await enforceDryRunSubmitBoundary(page, { action: 'observe' })

  if (dryRunBoundary.atBoundary && isTestPackageName(packageName)) {
    console.log('Dry-run boundary: #SendPackage visible on test package — metadata captured, no submit attempted')
  }

  console.log('SendPackage clicked: false (hard safety rule)')
  console.log('SendPackage skipped: true')
  console.log('Outcome: ' + (sendInspectResult.outcome || 'unknown'))
  if (sendInspectResult.skipReason) console.log('Skip reason: ' + sendInspectResult.skipReason)

  await sendCapture(page, outputDir, '02-send-boundary-readonly')

  var safetyVerdict = {
    readyConfirmed: readyConfirmed,
    sendPackageClicked: false,
    sendPackageSkipped: true,
    skipReason: sendInspectResult.skipReason,
    outcome: sendInspectResult.outcome,
    openedModal: false,
    immediateSubmit: false,
    safeProbe: true,
    unsafe: false,
    dryRunBoundary: dryRunBoundary,
    automationPlan: [
      'Complete dummy upload + party Add + Save to reach Ready',
      '#SendPackage → $EP.methods.actions.sendDocs($(this), true) submits immediately (no pre-submit modal)',
      'NEVER click #SendPackage in test/dry-run/inspection automation',
      'Production submit requires --live-submit AND EPN_LIVE_SUBMIT_CONFIRM=YES',
      'Production submit requires noc_status=notarized, real NOC PDF, non-test package name',
      'Post-submit safe nav: CLOSE WINDOW, BACK TO WORKLIST',
    ],
  }

  writeFileSync(join(outputDir, 'epn-send-modal-selectors.json'), JSON.stringify({
    sendPackageButton: '#SendPackage',
    preClick: sendInspectResult.preClick || null,
    sendButtonMeta: sendButtonMeta,
    boundary: dryRunBoundary,
    clicked: false,
    note: 'Read-only inspection — no modal opened because #SendPackage was not clicked',
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-send-confirmation-text.json'), JSON.stringify({
    modalTitle: null,
    modalBodyText: null,
    successOverlay: null,
    confirmationMessage: 'Not captured — #SendPackage was not clicked (one-click live submit)',
    boundary: dryRunBoundary,
    outcome: sendInspectResult.outcome || null,
    knownPostSubmitMessage: 'Package Sent Success — This package has been submitted.',
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-send-dangerous-buttons.json'), JSON.stringify({
    notClicked: true,
    sendPackageNeverClicked: true,
    packageViewSubmit: submitInventory.submitLike || [],
    modalDangerous: [],
    finalConfirmSelector: null,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-send-fee-summary.json'), JSON.stringify({
    packageViewFee: postSaveStatus.feeSummary || null,
    documentRowFee: documentRowStatus.rowDetails || null,
    modalFeeSummary: null,
    modalPaymentLanguage: null,
    totalEstimatedFees: postSaveStatus.feeSummary,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-send-safety-verdict.json'), JSON.stringify(safetyVerdict, null, 2))

  writeFileSync(join(outputDir, 'epn-send-inspect-summary.json'), JSON.stringify({
    outputDir: outputDir,
    mode: 'send-inspect',
    inspectedAt: new Date().toISOString(),
    packId: packId,
    packageName: packageName,
    readyConfirmed: readyConfirmed,
    sendInspectResult: sendInspectResult,
    safetyVerdict: safetyVerdict,
    postSaveStatus: postSaveStatus,
    documentRowStatus: documentRowStatus,
  }, null, 2))

  console.log('\nAttempting safe discard of test package: ' + packageName)
  try {
    discardResult = await trySafeDiscardPackage(page, packageName, {
      packId: packId,
      outputDir: outputDir,
      captureModal: false,
    })
    console.log('Cleanup: ' + (discardResult.discarded ? 'deleted (' + discardResult.method + ')' : 'failed — ' + (discardResult.reason || 'unknown')))
  } catch (cleanupErr) {
    discardResult = { attempted: true, discarded: false, reason: cleanupErr.message, packId: packId }
    console.log('Cleanup error: ' + cleanupErr.message)
  }

  writeFileSync(join(outputDir, 'epn-send-discard-result.json'), JSON.stringify({ currentPackage: discardResult }, null, 2))

  return {
    success: true,
    mode: 'send-inspect',
    outputDir: outputDir,
    packId: packId,
    readyConfirmed: readyConfirmed,
    sendPackageClicked: false,
    sendPackageSkipped: true,
    outcome: sendInspectResult.outcome,
    openedModal: false,
    immediateSubmit: false,
    safeProbe: true,
    finalConfirmSelector: null,
    feeSummary: postSaveStatus.feeSummary,
    paymentLanguage: null,
    safetyVerdict: safetyVerdict,
    discardResult: discardResult,
    summaryPath: join(outputDir, 'epn-send-inspect-summary.json'),
    selectorsPath: join(outputDir, 'epn-send-modal-selectors.json'),
    confirmationPath: join(outputDir, 'epn-send-confirmation-text.json'),
    dangerousPath: join(outputDir, 'epn-send-dangerous-buttons.json'),
    feePath: join(outputDir, 'epn-send-fee-summary.json'),
    verdictPath: join(outputDir, 'epn-send-safety-verdict.json'),
  }
}

module.exports = {
  exploreSendInspect,
}
