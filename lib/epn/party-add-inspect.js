// lib/epn/party-add-inspect.js
// ePN pass 8 — commit grantor/grantee via Add, Save, inspect status transition

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const { ensureDummyPdf } = require('../../automation/fixtures/generate-dummy-pdf')
const {
  ensureWorklist,
  createTestPackage,
  trySafeDiscardPackage,
  extractPackIdFromUrl,
} = require('./worklist-helpers')
const {
  slugify,
  selectDocumentType,
  clickWizardTab,
  collectDeepFieldInventory,
  categorizeMetadataFields,
  uploadDummyPdf,
  scrollAllPanels,
  fillAndCommitParties,
  clickSaveButton,
  extractPackageStatus,
  extractDocumentRowStatus,
  collectSubmitButtonInventory,
  openDocumentOneFromPackageView,
  analyzeIncompleteFields,
  dismissInactivityWarning,
  inspectSendPackageBoundary,
} = require('./data-entry-helpers')
const {
  NEVER_DELETE_PACK_IDS,
  enforceDryRunSubmitBoundary,
} = require('./submit-safety')

var FORBIDDEN_PACK_IDS = NEVER_DELETE_PACK_IDS

async function partyCapture(page, outputDir, stepName, store) {
  await scrollAllPanels(page)
  await dismissInactivityWarning(page)
  var inventory = await collectDeepFieldInventory(page)
  var screenshotPath = join(outputDir, 'party-add-' + slugify(stepName) + '.png')
  var jsonPath = join(outputDir, 'party-add-' + slugify(stepName) + '.json')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  writeFileSync(jsonPath, JSON.stringify(inventory, null, 2))

  var incomplete = analyzeIncompleteFields(inventory)
  var entry = {
    step: stepName,
    url: inventory.url,
    title: inventory.title,
    screenshot: screenshotPath,
    inventoryFile: jsonPath,
    packId: extractPackIdFromUrl(inventory.url),
    fieldCount: (inventory.fields || []).length,
    invalidSectionCount: incomplete.invalidSectionCount,
    incomplete: incomplete,
  }
  store.push(entry)
  console.log('Party capture: ' + stepName + ' invalid=' + entry.invalidSectionCount)
  return { inventory: inventory, entry: entry, incomplete: incomplete }
}

async function explorePartyAddInspection(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var dummyPdfPath = ensureDummyPdf(join(outputDir, 'fixtures'), 2)
  var captures = []
  var packId = null
  var uploadResult = { success: false }
  var partyResult = { success: false }
  var saveResult = { success: false }
  var postSaveStatus = null
  var documentRowStatus = null
  var submitInventory = null
  var reopenResult = null
  var reopenIncomplete = null
  var discardResult = { attempted: false, discarded: false, reason: 'not attempted' }

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog: ' + dialog.message())
    await dialog.accept().catch(function() {})
  })

  async function snap(label) {
    var result = await partyCapture(page, outputDir, label, captures)
    if (!packId && result.entry.packId) packId = result.entry.packId
    return result
  }

  await ensureWorklist(page)

  console.log('Creating test package: ' + packageName)
  var createResult = await createTestPackage(page, packageName, 'Polk County, FL')
  if (!createResult.created || !createResult.packId) throw new Error('Failed to create test package')
  packId = createResult.packId
  if (FORBIDDEN_PACK_IDS.indexOf(String(packId)) >= 0) throw new Error('Refusing forbidden packId: ' + packId)
  console.log('Package created: packId=' + packId)

  console.log('Selecting document type: Notice Of Commencement')
  var docTypeResult = await selectDocumentType(page, 'Notice Of Commencement')
  if (!docTypeResult.selected) throw new Error('Document type selection failed')

  console.log('Uploading 2-page dummy PDF: ' + dummyPdfPath)
  uploadResult = await uploadDummyPdf(page, dummyPdfPath)
  console.log('Dummy upload: ' + (uploadResult.success ? 'success' : 'failed — ' + uploadResult.reason))
  await snap('01-after-upload')

  console.log('Committing Grantor party (Person, Test Owner, Add)...')
  await clickWizardTab(page, '#indexing-status')
  partyResult = await fillAndCommitParties(page, {
    grantorName: 'Test Owner',
    grantorRadio: 'person',
    granteeName: 'GAETANO HOME SERVICES',
    granteeRadio: 'company',
  })
  console.log('Grantor Add: ' + (partyResult.grantor.success ? 'success' : 'failed — ' + (partyResult.grantor.reason || 'unknown')))
  console.log('Grantee Add: ' + (partyResult.grantee.success ? 'success' : 'failed — ' + (partyResult.grantee.reason || 'unknown')))
  console.log('Party rows/chips appeared: ' + partyResult.partyRowsAppeared)
  if (partyResult.grantor.afterState) {
    console.log('  Grantor entries: ' + partyResult.grantor.afterState.entryCount + ' invalid=' + partyResult.grantor.afterState.invalid)
  }
  if (partyResult.grantee.afterState) {
    console.log('  Grantee entries: ' + partyResult.grantee.afterState.entryCount + ' invalid=' + partyResult.grantee.afterState.invalid)
  }
  await snap('02-after-party-add')

  console.log('Clicking Save (safe — not submit/record)...')
  saveResult = await clickSaveButton(page)
  console.log('Save: ' + (saveResult.success ? 'clicked (' + (saveResult.clickMethod || 'unknown') + ')' : 'failed — ' + saveResult.reason))

  postSaveStatus = await extractPackageStatus(page)
  documentRowStatus = await extractDocumentRowStatus(page)
  submitInventory = await collectSubmitButtonInventory(page)
  await snap('03-package-view-after-save')

  var dryRunBoundary = await enforceDryRunSubmitBoundary(page, { action: 'observe' })
  if (dryRunBoundary.atBoundary) {
    console.log('DRY-RUN BOUNDARY: #SendPackage visible — metadata only, no click attempted')
    await inspectSendPackageBoundary(page)
  }

  console.log('Document row status: ' + (documentRowStatus.documentStatus || 'unknown'))
  console.log('Submit/Send/Record buttons: ' + (submitInventory.hasSubmitButton ? submitInventory.submitLike.map(function(b) { return b.text }).join(', ') : 'none'))
  console.log('Ready-like buttons: ' + (submitInventory.hasReadyButton ? submitInventory.readyLike.map(function(b) { return b.text }).join(', ') : 'none'))

  var stillIncomplete = /data entry incomplete/i.test(documentRowStatus.documentStatus || '') ||
    /data entry incomplete/i.test(documentRowStatus.bodySample || '')

  if (stillIncomplete) {
    console.log('Still incomplete — reopening Document 1 for field capture...')
    reopenResult = await openDocumentOneFromPackageView(page, packId)
    if (reopenResult.success) {
      await clickWizardTab(page, '#indexing-status')
      var reopenCapture = await snap('04-reopened-still-incomplete')
      reopenIncomplete = reopenCapture.incomplete
    } else {
      console.log('Reopen failed: ' + reopenResult.reason)
    }
  }

  writeFileSync(join(outputDir, 'epn-party-add-selectors.json'), JSON.stringify({
    grantorSection: '#0',
    granteeSection: '#1',
    grantorPersonRadio: '[id="Grantor (Owner/Lessee)-person-0"]',
    grantorCompanyRadio: '[id="Grantor (Owner/Lessee)-company-0"]',
    granteePersonRadio: '[id="Grantee (Contractor)-person-1"]',
    granteeCompanyRadio: '[id="Grantee (Contractor)-company-1"]',
    grantorAddButton: '#0 button.add, #0 button.clone.add',
    granteeAddButton: '#1 button.add, #1 button.clone.add',
    saveButton: '#save-button, xpath=//*[normalize-space(.)="Save"]',
    documentOneLink: 'a:has-text("Document 1")',
    deletePackage: '#DeletePkgBtn',
    deleteConfirm: '#modal-submit',
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-party-add-result.json'), JSON.stringify({
    packId: packId,
    packageName: packageName,
    uploadResult: uploadResult,
    partyResult: partyResult,
    grantorAddSuccess: partyResult.grantor.success,
    granteeAddSuccess: partyResult.grantee.success,
    partyRowsAppeared: partyResult.partyRowsAppeared,
    saveResult: saveResult,
    saveSuccess: saveResult.success,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-post-party-save-status.json'), JSON.stringify({
    packId: packId,
    packageName: packageName,
    postSaveStatus: postSaveStatus,
    documentRowStatus: documentRowStatus,
    feeSummary: postSaveStatus && postSaveStatus.feeSummary,
    packageStatus: postSaveStatus && postSaveStatus.statusGuess,
    documentStatus: documentRowStatus.documentStatus,
    stillIncomplete: stillIncomplete,
    reopenResult: reopenResult,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-submit-button-inventory.json'), JSON.stringify(submitInventory, null, 2))

  writeFileSync(join(outputDir, 'epn-incomplete-after-party-add.json'), JSON.stringify({
    stillIncomplete: stillIncomplete,
    documentRowStatus: documentRowStatus,
    reopenIncomplete: reopenIncomplete,
    reopenResult: reopenResult,
    partyResult: partyResult,
    finalCapture: captures.length ? captures[captures.length - 1].entry : null,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-party-add-navigation.json'), JSON.stringify(captures.map(function(c) { return c.entry }), null, 2))

  var summary = {
    outputDir: outputDir,
    mode: 'party-add',
    inspectedAt: new Date().toISOString(),
    packId: packId,
    packageName: packageName,
    grantorAddSuccess: partyResult.grantor.success,
    granteeAddSuccess: partyResult.grantee.success,
    partyRowsAppeared: partyResult.partyRowsAppeared,
    saveSuccess: saveResult.success,
    documentStatus: documentRowStatus.documentStatus,
    packageStatus: postSaveStatus && postSaveStatus.statusGuess,
    stillIncomplete: stillIncomplete,
    hasSubmitButton: submitInventory.hasSubmitButton,
    hasReadyButton: submitInventory.hasReadyButton,
    submitButtons: submitInventory.submitLike,
    readyButtons: submitInventory.readyLike,
    dryRunBoundary: dryRunBoundary,
  }
  writeFileSync(join(outputDir, 'epn-party-add-summary.json'), JSON.stringify(summary, null, 2))

  console.log('\nAttempting safe discard of current test package: ' + packageName)
  try {
    discardResult = await trySafeDiscardPackage(page, packageName, {
      packId: packId,
      outputDir: outputDir,
      captureModal: false,
    })
    console.log('Current package cleanup: ' + (discardResult.discarded ? 'deleted (' + discardResult.method + ')' : 'failed — ' + (discardResult.reason || 'unknown')))
  } catch (cleanupErr) {
    discardResult = { attempted: true, discarded: false, reason: cleanupErr.message, packId: packId }
    console.log('Current package cleanup error: ' + cleanupErr.message)
  }

  writeFileSync(join(outputDir, 'epn-party-add-discard-result.json'), JSON.stringify({ currentPackage: discardResult }, null, 2))

  return {
    success: true,
    mode: 'party-add',
    outputDir: outputDir,
    packId: packId,
    grantorAddSuccess: partyResult.grantor.success,
    granteeAddSuccess: partyResult.grantee.success,
    partyRowsAppeared: partyResult.partyRowsAppeared,
    partyResult: partyResult,
    saveSuccess: saveResult.success,
    documentStatus: documentRowStatus.documentStatus,
    packageStatus: postSaveStatus && postSaveStatus.statusGuess,
    stillIncomplete: stillIncomplete,
    hasSubmitButton: submitInventory.hasSubmitButton,
    hasReadyButton: submitInventory.hasReadyButton,
    submitInventory: submitInventory,
    discardResult: discardResult,
    summaryPath: join(outputDir, 'epn-party-add-summary.json'),
    selectorsPath: join(outputDir, 'epn-party-add-selectors.json'),
    resultPath: join(outputDir, 'epn-party-add-result.json'),
    statusPath: join(outputDir, 'epn-post-party-save-status.json'),
    submitPath: join(outputDir, 'epn-submit-button-inventory.json'),
    incompletePath: join(outputDir, 'epn-incomplete-after-party-add.json'),
  }
}

module.exports = {
  explorePartyAddInspection,
}
