// lib/epn/reopen-doc-inspect.js
// ePN pass 7 — reopen Document 1 after save and inspect Data Entry Incomplete fields

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
  fillMinimumIndexingFields,
  clickSaveButton,
  extractPackageStatus,
  openDocumentOneFromPackageView,
  analyzeIncompleteFields,
  dismissInactivityWarning,
} = require('./data-entry-helpers')

var FORBIDDEN_PACK_IDS = ['50254044']

function countCategories(categorized) {
  return {
    parcel_apn: (categorized.parcel_apn || []).length,
    page_count: (categorized.page_count || []).length,
    return_info: (categorized.return_info || []).length,
    grantor: (categorized.grantor || []).length,
    grantee: (categorized.grantee || []).length,
    consideration_fees: (categorized.consideration_fees || []).length,
    document_name: (categorized.document_name || []).length,
    legal_description: (categorized.legal_description || []).length,
    indexing_other: (categorized.indexing_other || []).length,
  }
}

async function reopenCapture(page, outputDir, stepName, store) {
  await scrollAllPanels(page)
  await dismissInactivityWarning(page)
  var inventory = await collectDeepFieldInventory(page)
  var screenshotPath = join(outputDir, 'reopen-' + slugify(stepName) + '.png')
  var jsonPath = join(outputDir, 'reopen-' + slugify(stepName) + '.json')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  writeFileSync(jsonPath, JSON.stringify(inventory, null, 2))

  var categorized = categorizeMetadataFields(inventory.fields)
  var incomplete = analyzeIncompleteFields(inventory)
  var entry = {
    step: stepName,
    url: inventory.url,
    title: inventory.title,
    screenshot: screenshotPath,
    inventoryFile: jsonPath,
    packId: extractPackIdFromUrl(inventory.url),
    fieldCount: (inventory.fields || []).length,
    validationCount: (inventory.validationMessages || []).length,
    invalidSectionCount: incomplete.invalidSectionCount,
    categorized: categorized,
    categories: countCategories(categorized),
    incomplete: incomplete,
    tabs: inventory.tabs || [],
    sections: (inventory.sections || []).slice(0, 40),
  }
  store.push(entry)
  console.log('Reopen capture: ' + stepName + ' fields=' + entry.fieldCount + ' invalid=' + entry.invalidSectionCount + ' parcel=' + entry.categories.parcel_apn)
  return { inventory: inventory, entry: entry, categorized: categorized, incomplete: incomplete }
}

async function exploreReopenDocInspection(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var dummyPdfPath = ensureDummyPdf(join(outputDir, 'fixtures'), 2)
  var captures = []
  var reopenStore = []
  var packId = null
  var uploadResult = { success: false }
  var fillResult = { success: false }
  var saveResult = { success: false }
  var reopenResult = { success: false }
  var postSaveStatus = null
  var discardResult = { attempted: false, discarded: false, reason: 'not attempted' }

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog: ' + dialog.message())
    await dialog.accept().catch(function() {})
  })

  async function snap(label) {
    var result = await reopenCapture(page, outputDir, label, reopenStore)
    captures.push(result)
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

  console.log('Filling minimum indexing fields...')
  fillResult = await fillMinimumIndexingFields(page, {
    grantorName: 'Test Owner',
    granteeName: 'GAETANO HOME SERVICES',
  })
  console.log('Grantor/grantee fill: ' + (fillResult.success ? 'success' : 'partial') + ' grantor=' + fillResult.values.grantor + ' grantee=' + fillResult.values.grantee)

  console.log('Clicking Save (safe — not submit/record)...')
  saveResult = await clickSaveButton(page)
  console.log('Save: ' + (saveResult.success ? 'clicked (' + (saveResult.clickMethod || 'unknown') + ')' : 'failed — ' + saveResult.reason))

  postSaveStatus = await extractPackageStatus(page)
  await snap('01-package-view-after-save')

  console.log('Opening Document 1 from Package View...')
  reopenResult = await openDocumentOneFromPackageView(page, packId)
  console.log('Document 1 reopen: ' + (reopenResult.success ? 'success (' + reopenResult.method + ')' : 'failed — ' + reopenResult.reason))

  if (!reopenResult.success) {
    throw new Error('Document 1 reopen failed: ' + reopenResult.reason)
  }

  await snap('02-doc-editor-initial')

  console.log('Inspecting indexing tab...')
  await clickWizardTab(page, '#indexing-status')
  await snap('03-indexing-tab')

  console.log('Inspecting image tab...')
  await clickWizardTab(page, '#image-status')
  await snap('04-image-tab')

  await clickWizardTab(page, '#indexing-status')
  await scrollAllPanels(page)
  await snap('05-indexing-scrolled-final')

  var finalCapture = captures[captures.length - 1]
  var inventory = finalCapture.inventory
  var categorized = finalCapture.categorized
  var incompleteAnalysis = finalCapture.incomplete

  var allFields = []
  var seen = new Set()
  captures.forEach(function(c) {
    ;(c.inventory.fields || []).forEach(function(field) {
      var key = field.selector + '|' + (field.labelText || '')
      if (seen.has(key)) return
      seen.add(key)
      allFields.push(field)
    })
  })

  var safeButtons = (inventory.allClickables || []).filter(function(b) { return !b.dangerous })
  var dangerousButtons = (inventory.allClickables || []).filter(function(b) { return b.dangerous })
  var readyButtons = (inventory.allClickables || []).filter(function(b) { return b.readyLike })

  writeFileSync(join(outputDir, 'epn-reopen-doc-selectors.json'), JSON.stringify({
    packageView: {
      documentOneLink: 'a:has-text("Document 1")',
      packIdParam: 'packId',
      packageViewUrl: '/Secure/Packages/PackageView.aspx?packId={packId}&isArchived=false',
    },
    dataEntry: {
      directUrl: '/L2/DataEntry/Index?packId={packId}',
      indexingTab: '#indexing-status',
      imageTab: '#image-status',
      saveButton: 'xpath=//*[normalize-space(.)="Save" and (self::button or self::a or self::input or contains(@class,"btn"))]',
      grantorSection: '#0',
      granteeSection: '#1',
      grantorPersonRadio: '[id="Grantor (Owner/Lessee)-person-0"]',
      granteeCompanyRadio: '[id="Grantee (Contractor)-company-1"]',
    },
    reopenMethod: reopenResult.method,
    reopenUrl: reopenResult.url,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-data-entry-incomplete-fields.json'), JSON.stringify({
    packId: packId,
    packageName: packageName,
    documentStatus: 'Data Entry Incomplete',
    incompleteAnalysis: incompleteAnalysis,
    invalidSections: inventory.invalidSections || [],
    emptyVisibleInputs: inventory.emptyVisibleInputs || [],
    hiddenFields: inventory.hiddenFields || [],
    sections: inventory.sections || [],
    allFields: allFields,
    categorized: categorized,
    categories: countCategories(categorized),
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-reopen-validation-messages.json'), JSON.stringify({
    validationMessages: inventory.validationMessages || [],
    invalidSections: inventory.invalidSections || [],
    statusMatches: inventory.statusMatches || {},
    incompleteReasons: incompleteAnalysis.incompleteReasons || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-reopen-noc-mapping.json'), JSON.stringify({
    documentType: 'Notice Of Commencement',
    uploadResult: uploadResult,
    fillResult: fillResult,
    saveResult: saveResult,
    reopenResult: reopenResult,
    postSaveStatus: postSaveStatus,
    fieldMapping: categorized,
    categories: countCategories(categorized),
    incompleteAnalysis: incompleteAnalysis,
    tabs: inventory.tabs || [],
    pageControls: inventory.pageControls || [],
    headings: inventory.headings || [],
    bodyTextSample: inventory.bodyTextSample || '',
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-reopen-button-inventory.json'), JSON.stringify({
    safe: safeButtons,
    readyLike: readyButtons,
    dangerous_not_clicked: dangerousButtons,
    hasSubmitButton: incompleteAnalysis.hasSubmitButton,
    hasReadyButton: incompleteAnalysis.hasReadyButton,
    controlsFromMetadata: inventory.controls || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-reopen-navigation.json'), JSON.stringify(reopenStore, null, 2))

  var summary = {
    outputDir: outputDir,
    mode: 'reopen-doc',
    inspectedAt: new Date().toISOString(),
    packageName: packageName,
    packId: packId,
    dummyUploadSuccess: uploadResult.success,
    grantorGranteeFillSuccess: fillResult.success,
    saveSuccess: saveResult.success,
    reopenSuccess: reopenResult.success,
    reopenMethod: reopenResult.method,
    fieldsFound: countCategories(categorized),
    totalFieldsCaptured: allFields.length,
    invalidSectionCount: incompleteAnalysis.invalidSectionCount,
    incompleteReasonCount: (incompleteAnalysis.incompleteReasons || []).length,
    hasSubmitButton: incompleteAnalysis.hasSubmitButton,
    hasReadyButton: incompleteAnalysis.hasReadyButton,
    feeSummary: postSaveStatus && postSaveStatus.feeSummary,
    packageStatusAfterSave: postSaveStatus && postSaveStatus.statusGuess,
    primaryIncompleteReasons: (incompleteAnalysis.incompleteReasons || []).slice(0, 12),
  }
  writeFileSync(join(outputDir, 'epn-reopen-summary.json'), JSON.stringify(summary, null, 2))

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

  writeFileSync(join(outputDir, 'epn-reopen-discard-result.json'), JSON.stringify({ currentPackage: discardResult }, null, 2))

  return {
    success: true,
    mode: 'reopen-doc',
    outputDir: outputDir,
    packId: packId,
    dummyUploadSuccess: uploadResult.success,
    grantorGranteeFillSuccess: fillResult.success,
    saveSuccess: saveResult.success,
    reopenSuccess: reopenResult.success,
    reopenResult: reopenResult,
    fieldsFound: countCategories(categorized),
    incompleteAnalysis: incompleteAnalysis,
    hasSubmitButton: incompleteAnalysis.hasSubmitButton,
    hasReadyButton: incompleteAnalysis.hasReadyButton,
    postSaveStatus: postSaveStatus,
    discardResult: discardResult,
    summaryPath: join(outputDir, 'epn-reopen-summary.json'),
    selectorsPath: join(outputDir, 'epn-reopen-doc-selectors.json'),
    incompleteFieldsPath: join(outputDir, 'epn-data-entry-incomplete-fields.json'),
    validationPath: join(outputDir, 'epn-reopen-validation-messages.json'),
    nocMappingPath: join(outputDir, 'epn-reopen-noc-mapping.json'),
    buttonInventoryPath: join(outputDir, 'epn-reopen-button-inventory.json'),
  }
}

module.exports = {
  exploreReopenDocInspection,
}
