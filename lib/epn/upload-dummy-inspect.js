// lib/epn/upload-dummy-inspect.js
// ePN pass 5 — dummy PDF upload to reveal post-upload metadata fields

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
} = require('./data-entry-helpers')

var FORBIDDEN_PACK_IDS = ['50254044']
var STALE_CLEANUP_PACK_IDS = ['50319689', '50319690']

function buildNocUploadMapping(categorized, inventory, uploadResult, docTypeResult) {
  var safeControls = (inventory.controls || []).filter(function(c) { return !c.dangerous })
  var dangerousControls = (inventory.controls || []).filter(function(c) { return c.dangerous })

  return {
    documentType: 'Notice Of Commencement',
    documentTypeSelected: !!(docTypeResult && docTypeResult.selected),
    dummyUpload: uploadResult,
    dataEntryUrl: inventory.url,
    fieldMapping: categorized,
    validationMessages: inventory.validationMessages || [],
    controls: {
      safe: safeControls,
      dangerous_not_clicked: dangerousControls,
    },
    headings: inventory.headings || [],
    bodyTextSample: inventory.bodyTextSample || '',
  }
}

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

async function uploadCapture(page, outputDir, stepName, store) {
  var inventory = await collectMetadataInventory(page)
  var screenshotPath = join(outputDir, 'upload-' + slugify(stepName) + '.png')
  var jsonPath = join(outputDir, 'upload-' + slugify(stepName) + '.json')
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
    fileInputCount: (inventory.fileInputs || []).length,
    validationCount: (inventory.validationMessages || []).length,
    controlCount: (inventory.controls || []).length,
    categorized: categorized,
    revealed: countRevealedCategories(categorized),
  }
  store.push(entry)
  console.log('Upload capture: ' + stepName + ' fields=' + entry.fieldCount + ' parcel=' + entry.revealed.parcel_apn + ' pages=' + entry.revealed.page_count)
  return { inventory: inventory, entry: entry, categorized: categorized }
}

async function exploreUploadDummyInspection(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var dummyPdfPath = ensureDummyPdf(join(outputDir, 'fixtures'))
  var captures = []
  var uploadStore = []
  var packId = null
  var packageCreated = false
  var docTypeSelected = false
  var uploadResult = { success: false }
  var discardResult = { attempted: false, discarded: false, method: null, reason: 'not attempted' }
  var staleCleanupResults = []

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog (auto-dismiss): ' + dialog.message())
    await dialog.accept().catch(function() {})
  })

  async function snap(label) {
    var result = await uploadCapture(page, outputDir, label, uploadStore)
    captures.push(result)
    if (!packId && result.entry.packId) packId = result.entry.packId
    return result
  }

  await ensureWorklist(page)
  await snap('01-worklist-before-create')

  console.log('Creating test package: ' + packageName)
  var createResult = await createTestPackage(page, packageName, 'Polk County, FL')
  packageCreated = createResult.created
  packId = createResult.packId || packId

  if (!packageCreated || !packId) {
    throw new Error('Failed to create test package (created=' + packageCreated + ', packId=' + packId + ')')
  }
  if (FORBIDDEN_PACK_IDS.indexOf(String(packId)) >= 0) {
    throw new Error('Refusing forbidden packId: ' + packId)
  }

  await snap('02-data-entry-before-doc-type')
  console.log('Package created: packId=' + packId)

  console.log('Selecting document type: Notice Of Commencement')
  var docTypeResult = await selectDocumentType(page, 'Notice Of Commencement')
  docTypeSelected = docTypeResult.selected
  if (!docTypeSelected) throw new Error('Document type selection failed: ' + (docTypeResult.reason || 'unknown'))
  await snap('03-after-doc-type-selected')

  console.log('Uploading dummy PDF: ' + dummyPdfPath)
  uploadResult = await uploadDummyPdf(page, dummyPdfPath)
  console.log('Dummy upload: ' + (uploadResult.success ? 'success' : 'failed — ' + uploadResult.reason))

  await snap('04-after-dummy-upload-image-tab')

  await clickWizardTab(page, '#indexing-status')
  await snap('05-after-upload-indexing-tab')

  await clickWizardTab(page, '#image-status')
  await snap('06-after-upload-final')

  var finalCapture = captures[captures.length - 1]
  var inventory = finalCapture.inventory
  var categorized = categorizeMetadataFields(inventory.fields)
  var allFields = mergeUniqueFields(captures)
  var requiredFields = allFields.filter(function(f) {
    return f.required || /\*|required/i.test(f.labelText || '') || /invalid/i.test(f.className || '')
  })

  var fieldsRevealed = countRevealedCategories(categorized)
  var nocMapping = buildNocUploadMapping(categorized, inventory, uploadResult, docTypeResult)

  writeFileSync(join(outputDir, 'epn-upload-selectors.json'), JSON.stringify({
    worklist: { packageName: '#package-name', jurisdiction: '#stateCounty-search' },
    dataEntry: {
      documentName: 'input[placeholder="Document Name"]',
      documentTypeDropdown: '.doctype-dropdown.k-dropdownlist',
      documentTypeTarget: 'Notice Of Commencement',
      uploadArea: 'div.btn-group.upload',
      openFileButton: 'button:has-text("Open File")',
      indexingTab: '#indexing-status',
      imageTab: '#image-status',
    },
    dummyPdf: dummyPdfPath,
    uploadResult: uploadResult,
    fileInputs: inventory.fileInputs || [],
    controls: inventory.controls || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-post-upload-required-fields.json'), JSON.stringify({
    requiredFields: requiredFields,
    allFields: allFields,
    categorized: categorized,
    fieldsRevealed: fieldsRevealed,
    validationMessages: inventory.validationMessages || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-noc-upload-mapping.json'), JSON.stringify(nocMapping, null, 2))
  writeFileSync(join(outputDir, 'epn-upload-navigation.json'), JSON.stringify(uploadStore, null, 2))

  var summary = {
    outputDir: outputDir,
    mode: 'upload-dummy',
    inspectedAt: new Date().toISOString(),
    packageName: packageName,
    packId: packId,
    packageCreated: packageCreated,
    docTypeSelected: docTypeSelected,
    dummyUploadSuccess: uploadResult.success,
    dummyUploadResult: uploadResult,
    dummyPdfPath: dummyPdfPath,
    fieldsRevealed: fieldsRevealed,
    totalFieldsCaptured: allFields.length,
    requiredFieldCount: requiredFields.length,
    dataEntryUrl: inventory.url,
  }
  writeFileSync(join(outputDir, 'epn-upload-summary.json'), JSON.stringify(summary, null, 2))

  console.log('\nCleaning stale test packages: ' + STALE_CLEANUP_PACK_IDS.join(', '))
  try {
    staleCleanupResults = await tryCleanupStaleTestPackages(page, STALE_CLEANUP_PACK_IDS)
    staleCleanupResults.forEach(function(r) {
      console.log('  packId ' + r.packId + ': ' + (r.discarded ? 'deleted (' + r.method + ')' : (r.skipped ? 'skipped — ' + r.reason : 'failed — ' + (r.reason || 'unknown'))))
    })
  } catch (staleErr) {
    console.log('Stale cleanup error: ' + staleErr.message)
  }

  if (packageCreated && packId) {
    console.log('\nAttempting safe discard of current test package: ' + packageName + ' (packId=' + packId + ')')
    try {
      discardResult = await trySafeDiscardPackage(page, packageName, { packId: packId })
      if (!discardResult.discarded) {
        console.log('Current package cleanup failed: ' + (discardResult.reason || 'unknown'))
        console.log('Manual cleanup packId: ' + packId)
      } else {
        console.log('Current package discarded via: ' + discardResult.method)
      }
    } catch (cleanupErr) {
      discardResult = { attempted: true, discarded: false, reason: cleanupErr.message, packId: packId }
      console.log('Current package cleanup error: ' + cleanupErr.message)
    }
  }

  writeFileSync(join(outputDir, 'epn-upload-discard-result.json'), JSON.stringify({
    currentPackage: discardResult,
    stalePackages: staleCleanupResults,
  }, null, 2))

  return {
    success: true,
    mode: 'upload-dummy',
    outputDir: outputDir,
    packId: packId,
    packageCreated: packageCreated,
    docTypeSelected: docTypeSelected,
    dummyUploadSuccess: uploadResult.success,
    dummyUploadResult: uploadResult,
    fieldsRevealed: fieldsRevealed,
    totalFieldsCaptured: allFields.length,
    requiredFieldCount: requiredFields.length,
    categorized: categorized,
    discardResult: discardResult,
    staleCleanupResults: staleCleanupResults,
    summaryPath: join(outputDir, 'epn-upload-summary.json'),
    selectorsPath: join(outputDir, 'epn-upload-selectors.json'),
    requiredFieldsPath: join(outputDir, 'epn-post-upload-required-fields.json'),
    nocMappingPath: join(outputDir, 'epn-noc-upload-mapping.json'),
  }
}

module.exports = {
  exploreUploadDummyInspection,
}
