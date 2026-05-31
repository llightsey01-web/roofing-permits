// lib/epn/save-dummy-inspect.js
// ePN pass 6 — dummy upload + Save to reveal post-save metadata fields

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const { ensureDummyPdf } = require('../../automation/fixtures/generate-dummy-pdf')
const {
  ensureWorklist,
  createTestPackage,
  trySafeDiscardPackage,
  tryCleanupStaleTestPackages,
  extractPackIdFromUrl,
} = require('./worklist-helpers')
const {
  slugify,
  selectDocumentType,
  clickWizardTab,
  collectMetadataInventory,
  categorizeMetadataFields,
  uploadDummyPdf,
  scrollIndexingPanel,
  fillMinimumIndexingFields,
  clickSaveButton,
  extractPackageStatus,
} = require('./data-entry-helpers')

var FORBIDDEN_PACK_IDS = ['50254044']
var STALE_CLEANUP_PACK_IDS = ['50319689', '50319690', '50319691', '50319692']

function mergeUniqueFields(captures) {
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
  return allFields
}

function countRevealedCategories(categorized) {
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

async function saveCapture(page, outputDir, stepName, store) {
  await scrollIndexingPanel(page)
  var inventory = await collectMetadataInventory(page)
  var screenshotPath = join(outputDir, 'save-' + slugify(stepName) + '.png')
  var jsonPath = join(outputDir, 'save-' + slugify(stepName) + '.json')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  writeFileSync(jsonPath, JSON.stringify(inventory, null, 2))

  var categorized = categorizeMetadataFields(inventory.fields)
  var entry = {
    step: stepName,
    url: inventory.url,
    title: inventory.title,
    screenshot: screenshotPath,
    inventoryFile: jsonPath,
    packId: extractPackIdFromUrl(inventory.url),
    fieldCount: (inventory.fields || []).length,
    validationCount: (inventory.validationMessages || []).length,
    controlCount: (inventory.controls || []).length,
    categorized: categorized,
    revealed: countRevealedCategories(categorized),
  }
  store.push(entry)
  console.log('Save capture: ' + stepName + ' fields=' + entry.fieldCount + ' parcel=' + entry.revealed.parcel_apn + ' pages=' + entry.revealed.page_count)
  return { inventory: inventory, entry: entry, categorized: categorized }
}

async function exploreSaveDummyInspection(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var dummyPdfPath = ensureDummyPdf(join(outputDir, 'fixtures'), 2)
  var captures = []
  var saveStore = []
  var packId = null
  var uploadResult = { success: false }
  var fillResult = { success: false }
  var saveResult = { success: false }
  var postSaveStatus = null
  var discardResult = { attempted: false, discarded: false, reason: 'not attempted' }
  var staleCleanupResults = []

  page.on('dialog', async function(dialog) {
    var message = dialog.message()
    console.log('Browser dialog: ' + message)
    if (/delete|remove|sure|confirm|ok/i.test(message) || message === '') {
      await dialog.accept().catch(function() {})
    } else {
      await dialog.accept().catch(function() {})
    }
  })

  async function snap(label) {
    var result = await saveCapture(page, outputDir, label, saveStore)
    captures.push(result)
    if (!packId && result.entry.packId) packId = result.entry.packId
    return result
  }

  await ensureWorklist(page)
  await snap('01-worklist-before-create')

  console.log('Creating test package: ' + packageName)
  var createResult = await createTestPackage(page, packageName, 'Polk County, FL')
  if (!createResult.created || !createResult.packId) {
    throw new Error('Failed to create test package')
  }
  packId = createResult.packId
  if (FORBIDDEN_PACK_IDS.indexOf(String(packId)) >= 0) {
    throw new Error('Refusing forbidden packId: ' + packId)
  }

  console.log('Package created: packId=' + packId)
  await snap('02-before-doc-type')

  console.log('Selecting document type: Notice Of Commencement')
  var docTypeResult = await selectDocumentType(page, 'Notice Of Commencement')
  if (!docTypeResult.selected) throw new Error('Document type selection failed')

  console.log('Uploading 2-page dummy PDF: ' + dummyPdfPath)
  uploadResult = await uploadDummyPdf(page, dummyPdfPath)
  console.log('Dummy upload: ' + (uploadResult.success ? 'success' : 'failed — ' + uploadResult.reason))
  await snap('03-after-upload')

  console.log('Filling minimum indexing fields...')
  fillResult = await fillMinimumIndexingFields(page, {
    grantorName: 'Test Owner',
    granteeName: 'GAETANO HOME SERVICES',
  })
  console.log('Grantor/grantee fill: ' + (fillResult.success ? 'success' : 'partial') + ' grantor=' + fillResult.values.grantor + ' grantee=' + fillResult.values.grantee)
  await snap('04-after-indexing-fill')

  console.log('Clicking Save (safe — not submit/record)...')
  saveResult = await clickSaveButton(page)
  console.log('Save: ' + (saveResult.success ? 'clicked (' + (saveResult.clickMethod || 'unknown') + ')' : 'failed — ' + saveResult.reason))
  if (!saveResult.success && saveResult.debug) {
    console.log('Save debug candidates: ' + JSON.stringify(saveResult.debug))
  }

  await clickWizardTab(page, '#indexing-status')
  await snap('05-after-save-indexing-tab')

  await clickWizardTab(page, '#image-status')
  postSaveStatus = await extractPackageStatus(page)
  await snap('06-after-save-final')

  var finalCapture = captures[captures.length - 1]
  var inventory = finalCapture.inventory
  var categorized = categorizeMetadataFields(inventory.fields)
  var allFields = mergeUniqueFields(captures)
  var requiredFields = allFields.filter(function(f) {
    return f.required || /\*|required/i.test(f.labelText || '')
  })
  var fieldsRevealed = countRevealedCategories(categorized)

  var safeControls = (inventory.controls || []).filter(function(c) { return !c.dangerous })
  var dangerousControls = (inventory.controls || []).filter(function(c) { return c.dangerous })

  writeFileSync(join(outputDir, 'epn-save-selectors.json'), JSON.stringify({
    worklist: { packageName: '#package-name', jurisdiction: '#stateCounty-search' },
    dataEntry: {
      documentTypeDropdown: '.doctype-dropdown.k-dropdownlist',
      openFileButton: 'button:has-text("Open File")',
      saveButton: 'xpath=//*[normalize-space(.)="Save" and (self::button or self::a or self::input or contains(@class,"btn"))]',
      indexingTab: '#indexing-status',
      grantorPersonRadio: '[id="Grantor (Owner/Lessee)-person-0"]',
      granteeCompanyRadio: '[id="Grantee (Contractor)-company-1"]',
      grantorInput: '.parent:has-text("Grantor") .k-input-inner',
      granteeInput: '.parent:has-text("Grantee") .k-input-inner',
    },
    dummyPdfPath: dummyPdfPath,
    dummyPdfPages: 2,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-post-save-required-fields.json'), JSON.stringify({
    requiredFields: requiredFields,
    allFields: allFields,
    categorized: categorized,
    fieldsRevealed: fieldsRevealed,
    validationMessages: inventory.validationMessages || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-post-save-status.json'), JSON.stringify({
    packId: packId,
    packageName: packageName,
    uploadResult: uploadResult,
    fillResult: fillResult,
    saveResult: saveResult,
    postSaveStatus: postSaveStatus,
    feeSummary: postSaveStatus && postSaveStatus.feeSummary,
    statusGuess: postSaveStatus && postSaveStatus.statusGuess,
    dataEntryUrl: inventory.url,
    controls: { safe: safeControls, dangerous_not_clicked: dangerousControls },
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-save-noc-mapping.json'), JSON.stringify({
    documentType: 'Notice Of Commencement',
    dummyUpload: uploadResult,
    indexingFill: fillResult,
    save: saveResult,
    postSaveStatus: postSaveStatus,
    fieldMapping: categorized,
    validationMessages: inventory.validationMessages || [],
    headings: inventory.headings || [],
    bodyTextSample: inventory.bodyTextSample || '',
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-save-navigation.json'), JSON.stringify(saveStore, null, 2))

  var summary = {
    outputDir: outputDir,
    mode: 'save-dummy',
    inspectedAt: new Date().toISOString(),
    packageName: packageName,
    packId: packId,
    dummyUploadSuccess: uploadResult.success,
    grantorGranteeFillSuccess: fillResult.success,
    saveSuccess: saveResult.success,
    fieldsRevealed: fieldsRevealed,
    feeSummary: postSaveStatus && postSaveStatus.feeSummary,
    packageStatusAfterSave: postSaveStatus && postSaveStatus.statusGuess,
    totalFieldsCaptured: allFields.length,
    requiredFieldCount: requiredFields.length,
  }
  writeFileSync(join(outputDir, 'epn-save-summary.json'), JSON.stringify(summary, null, 2))

  console.log('\nCleaning stale test packages: ' + STALE_CLEANUP_PACK_IDS.join(', '))
  try {
    staleCleanupResults = await tryCleanupStaleTestPackages(page, STALE_CLEANUP_PACK_IDS, { outputDir: outputDir })
    staleCleanupResults.forEach(function(r) {
      console.log('  packId ' + r.packId + ': ' + (r.discarded ? 'deleted (' + r.method + ')' : (r.skipped ? 'skipped — ' + r.reason : 'failed — ' + (r.reason || 'unknown'))))
    })
  } catch (staleErr) {
    console.log('Stale cleanup error: ' + staleErr.message)
  }

  console.log('\nAttempting safe discard of current test package: ' + packageName)
  try {
    discardResult = await trySafeDiscardPackage(page, packageName, {
      packId: packId,
      outputDir: outputDir,
      captureModal: !staleCleanupResults.some(function(r) { return r.discarded }),
    })
    console.log('Current package cleanup: ' + (discardResult.discarded ? 'deleted (' + discardResult.method + ')' : 'failed — ' + (discardResult.reason || 'unknown')))
  } catch (cleanupErr) {
    discardResult = { attempted: true, discarded: false, reason: cleanupErr.message, packId: packId }
    console.log('Current package cleanup error: ' + cleanupErr.message)
  }

  writeFileSync(join(outputDir, 'epn-save-discard-result.json'), JSON.stringify({
    currentPackage: discardResult,
    stalePackages: staleCleanupResults,
  }, null, 2))

  return {
    success: true,
    mode: 'save-dummy',
    outputDir: outputDir,
    packId: packId,
    dummyUploadSuccess: uploadResult.success,
    grantorGranteeFillSuccess: fillResult.success,
    fillResult: fillResult,
    saveSuccess: saveResult.success,
    saveResult: saveResult,
    fieldsRevealed: fieldsRevealed,
    postSaveStatus: postSaveStatus,
    feeSummary: postSaveStatus && postSaveStatus.feeSummary,
    packageStatusAfterSave: postSaveStatus && postSaveStatus.statusGuess,
    totalFieldsCaptured: allFields.length,
    requiredFieldCount: requiredFields.length,
    discardResult: discardResult,
    staleCleanupResults: staleCleanupResults,
    summaryPath: join(outputDir, 'epn-save-summary.json'),
    selectorsPath: join(outputDir, 'epn-save-selectors.json'),
    requiredFieldsPath: join(outputDir, 'epn-post-save-required-fields.json'),
    statusPath: join(outputDir, 'epn-post-save-status.json'),
    nocMappingPath: join(outputDir, 'epn-save-noc-mapping.json'),
  }
}

module.exports = {
  exploreSaveDummyInspection,
}
