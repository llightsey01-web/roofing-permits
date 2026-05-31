// lib/epn/metadata-inspect.js
// ePN pass 4 — Notice Of Commencement metadata/indexing inspection (no upload, no submit)

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
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
  collectMetadataInventory,
  categorizeMetadataFields,
  revealFileInputSelector,
} = require('./data-entry-helpers')
const { isDangerousAction } = require('./deep-inspect')

var STALE_TEST_PACK_IDS = ['50254044', '50319687', '50319688']

function buildNoticeOfCommencementMapping(categorized, inventory, docTypeResult) {
  return {
    documentType: 'Notice Of Commencement',
    documentTypeSelected: !!(docTypeResult && docTypeResult.selected),
    dataEntryUrl: inventory.url,
    fieldMapping: {
      document_name: categorized.document_name,
      parcel_apn: categorized.parcel_apn,
      grantor: categorized.grantor,
      grantee: categorized.grantee,
      recording_party: categorized.recording_party,
      return_info: categorized.return_info,
      consideration_fees: categorized.consideration_fees,
      page_count: categorized.page_count,
      legal_description: categorized.legal_description,
      indexing_other: categorized.indexing_other,
    },
    validationMessages: inventory.validationMessages || [],
    kendoDropdowns: inventory.kendoDropdowns || [],
    headings: inventory.headings || [],
  }
}

async function metadataCapture(page, outputDir, stepName, store) {
  var inventory = await collectMetadataInventory(page)
  var screenshotPath = join(outputDir, 'metadata-' + slugify(stepName) + '.png')
  var jsonPath = join(outputDir, 'metadata-' + slugify(stepName) + '.json')
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
    categorized: categorized,
  }
  store.push(entry)
  console.log('Metadata capture: ' + stepName + ' (' + inventory.url + ') fields=' + entry.fieldCount)
  return { inventory: inventory, entry: entry, categorized: categorized }
}

async function exploreMetadataInspection(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var captures = []
  var metadataStore = []
  var packId = null
  var packageCreated = false
  var docTypeSelected = false
  var fileUploadInspect = null
  var discardResult = { attempted: false, discarded: false, method: null, reason: 'not attempted' }

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog (auto-dismiss): ' + dialog.message())
    await dialog.accept().catch(function() {})
  })

  async function snap(label) {
    var result = await metadataCapture(page, outputDir, label, metadataStore)
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
    throw new Error('Failed to create test package for metadata inspection (created=' + packageCreated + ', packId=' + packId + ', alert=' + (createResult.alertText || 'none') + ', jurisdiction=' + (createResult.jurisdictionResult && createResult.jurisdictionResult.value) + ')')
  }

  if (STALE_TEST_PACK_IDS.indexOf(String(packId)) >= 0) {
    throw new Error('Refusing to inspect stale/forbidden packId: ' + packId)
  }

  await snap('02-data-entry-before-doc-type')
  console.log('Package created: packId=' + packId)

  console.log('Selecting document type: Notice Of Commencement')
  var docTypeResult = await selectDocumentType(page, 'Notice Of Commencement')
  docTypeSelected = docTypeResult.selected
  if (!docTypeSelected) {
    console.log('Document type selection failed: ' + (docTypeResult.reason || 'unknown'))
  } else {
    console.log('Document type selected: Notice Of Commencement')
  }

  await snap('03-after-notice-of-commencement-selected')

  await clickWizardTab(page, '#indexing-status')
  await snap('04-indexing-tab')

  await clickWizardTab(page, '#image-status')
  await snap('05-image-tab-after-doc-type')

  console.log('Revealing file input selector (Open File — no upload)...')
  fileUploadInspect = await revealFileInputSelector(page)
  await snap('06-after-open-file-reveal')

  var finalCapture = captures[captures.length - 1]
  var inventory = finalCapture.inventory
  var categorized = categorizeMetadataFields(inventory.fields)
  var nocMapping = buildNoticeOfCommencementMapping(categorized, inventory, docTypeResult)

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

  var requiredFields = allFields.filter(function(f) {
    return f.required || /\*|required/i.test(f.labelText || '')
  })

  var metadataFieldCount = Object.keys(categorized).reduce(function(sum, key) {
    return sum + (categorized[key] || []).length
  }, 0)

  var summary = {
    outputDir: outputDir,
    mode: 'metadata',
    inspectedAt: new Date().toISOString(),
    packageName: packageName,
    packId: packId,
    packageCreated: packageCreated,
    docTypeSelected: docTypeSelected,
    documentType: 'Notice Of Commencement',
    dataEntryUrl: inventory.url,
    metadataFieldCount: metadataFieldCount,
    totalFieldsCaptured: allFields.length,
    requiredFieldCount: requiredFields.length,
    fileInputSelectorFound: !!(fileUploadInspect && (
      (fileUploadInspect.fileInputs && fileUploadInspect.fileInputs.length > 0) ||
      fileUploadInspect.fileChooserTriggered
    )),
    fileUploadInspect: fileUploadInspect,
    stalePackIdsSkipped: STALE_TEST_PACK_IDS,
  }

  writeFileSync(join(outputDir, 'epn-metadata-selectors.json'), JSON.stringify({
    worklist: {
      packageName: '#package-name',
      jurisdiction: '#stateCounty-search',
    },
    dataEntry: {
      documentName: 'input[placeholder="Document Name"]',
      documentTypeDropdown: '.doctype-dropdown.k-dropdownlist',
      documentTypeTarget: 'Notice Of Commencement',
      uploadArea: 'div.btn-group.upload',
      openFileButton: 'button:has-text("Open File")',
      indexingTab: '#indexing-status',
      imageTab: '#image-status',
      safeButtons: ['Save', 'Add Doc +', 'Cancel'],
      deletePackage: '#DeletePkgBtn',
    },
    fileUpload: fileUploadInspect,
    kendoDropdowns: inventory.kendoDropdowns || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-metadata-required-fields.json'), JSON.stringify({
    requiredFields: requiredFields,
    allFields: allFields,
    categorized: categorized,
    validationMessages: inventory.validationMessages || [],
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-file-upload-selectors.json'), JSON.stringify({
    uploadArea: 'div.btn-group.upload',
    openFileButton: 'button:has-text("Open File")',
    scanImageButton: 'button:has-text("Scan Image")',
    fileInputs: fileUploadInspect ? fileUploadInspect.fileInputs : [],
    fileChooserTriggered: fileUploadInspect ? fileUploadInspect.fileChooserTriggered : false,
    clickedOpenFile: fileUploadInspect ? fileUploadInspect.clickedOpenFile : false,
  }, null, 2))

  writeFileSync(join(outputDir, 'epn-notice-of-commencement-mapping.json'), JSON.stringify(nocMapping, null, 2))
  writeFileSync(join(outputDir, 'epn-metadata-summary.json'), JSON.stringify(summary, null, 2))
  writeFileSync(join(outputDir, 'epn-metadata-navigation.json'), JSON.stringify(metadataStore, null, 2))

  if (packageCreated && packId && STALE_TEST_PACK_IDS.indexOf(String(packId)) < 0) {
    console.log('\nAttempting safe discard of test package only: ' + packageName + ' (packId=' + packId + ')')
    try {
      discardResult = await trySafeDiscardPackage(page, packageName, { packId: packId })
      if (!discardResult.discarded) {
        console.log('Safe discard not confirmed — leaving test package as draft. ' + (discardResult.reason || ''))
        console.log('Manual cleanup packId: ' + packId)
      } else {
        console.log('Test package discarded via: ' + discardResult.method)
      }
    } catch (cleanupErr) {
      discardResult = {
        attempted: true,
        discarded: false,
        method: null,
        reason: cleanupErr.message,
        packId: packId,
      }
      console.log('Cleanup error (inspection outputs preserved): ' + cleanupErr.message)
      console.log('Manual cleanup packId: ' + packId)
    }
  }

  writeFileSync(join(outputDir, 'epn-metadata-discard-result.json'), JSON.stringify(discardResult, null, 2))

  return {
    success: true,
    mode: 'metadata',
    outputDir: outputDir,
    packId: packId,
    packageCreated: packageCreated,
    docTypeSelected: docTypeSelected,
    metadataFieldCount: metadataFieldCount,
    totalFieldsCaptured: allFields.length,
    requiredFieldCount: requiredFields.length,
    fileInputSelectorFound: summary.fileInputSelectorFound,
    categorized: categorized,
    fileUploadInspect: fileUploadInspect,
    discardResult: discardResult,
    summaryPath: join(outputDir, 'epn-metadata-summary.json'),
    selectorsPath: join(outputDir, 'epn-metadata-selectors.json'),
    requiredFieldsPath: join(outputDir, 'epn-metadata-required-fields.json'),
    fileUploadPath: join(outputDir, 'epn-file-upload-selectors.json'),
    nocMappingPath: join(outputDir, 'epn-notice-of-commencement-mapping.json'),
  }
}

module.exports = {
  exploreMetadataInspection,
  STALE_TEST_PACK_IDS,
}
