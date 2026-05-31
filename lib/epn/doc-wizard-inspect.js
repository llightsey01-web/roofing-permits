// lib/epn/doc-wizard-inspect.js
// ePN pass 3 — Add A Doc / document wizard inspection (no upload, no submit)

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const {
  epnConfig,
  ensureWorklist,
  createTestPackage,
  openPackageEditor,
  trySafeDiscardPackage,
  extractPackIdFromUrl,
} = require('./worklist-helpers')
const {
  collectDeepInventory,
  isDangerousAction,
  buildRequiredFieldsReport,
} = require('./deep-inspect')

function slugify(value) {
  return String(value || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
}

function isSafeWizardNav(text) {
  var value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return false
  if (isDangerousAction(value)) return false
  return /^(next|continue|back|previous|cancel|close|skip|save)$/i.test(value) ||
    /document type|metadata|details|parties|parcel|return|fee|summary|review|index|image|main image|select type|open file|scan image/i.test(value)
}

async function deepCapture(page, outputDir, stepName, store) {
  var inventory = await collectDeepInventory(page)
  var screenshotPath = join(outputDir, stepName + '.png')
  var jsonPath = join(outputDir, stepName + '.json')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  writeFileSync(jsonPath, JSON.stringify(inventory, null, 2))

  var dangerousButtons = (inventory.allButtons || []).filter(function(btn) {
    return isDangerousAction(btn.text)
  })

  var entry = {
    step: stepName,
    url: inventory.url,
    title: inventory.title,
    screenshot: screenshotPath,
    inventoryFile: jsonPath,
    packId: extractPackIdFromUrl(inventory.url),
    dangerousButtons: dangerousButtons,
    uploadSelectors: (inventory.fileInputs || []).concat(inventory.dropzones || []),
    selectCount: (inventory.selects || []).length,
    fieldCount: (inventory.labeledFields || []).length,
  }
  store.push(entry)
  console.log('Doc wizard capture: ' + stepName + ' (' + inventory.url + ')')
  return { inventory: inventory, entry: entry }
}

async function clickAddDocumentButton(page) {
  var btn = await page.$('#AddDocuments')
  if (!btn) {
    var fallback = page.locator('input[type="submit"][value*="Add"], button, a').filter({ hasText: /add a doc/i }).first()
    if (await fallback.count() === 0) {
      throw new Error('Could not find #AddDocuments or Add A Doc control')
    }
    await fallback.click()
  } else {
    await btn.click()
  }
  await page.waitForTimeout(3500)
}

async function openDocumentTypeDropdown(page) {
  var dropdown = page.locator('.doctype-dropdown, [class*="doctype"], .k-dropdownlist').filter({ hasText: /select type/i }).first()
  if (await dropdown.count() > 0) {
    await dropdown.click()
    await page.waitForTimeout(1500)
    return true
  }

  var selectBtn = page.locator('button').filter({ hasText: /^select$/i }).first()
  if (await selectBtn.count() > 0) {
    await selectBtn.click()
    await page.waitForTimeout(1500)
    return true
  }
  return false
}

async function captureDocumentTypeOptions(page) {
  return page.evaluate(function() {
    return Array.from(document.querySelectorAll('.k-list-item, .k-item, [role="option"], li'))
      .map(function(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim()
      })
      .filter(function(text) {
        return text && text.length > 1 && text.length < 120
      })
      .slice(0, 80)
  })
}

async function clickWizardTab(page, tabSelector) {
  var tab = await page.$(tabSelector)
  if (!tab) return false
  await tab.click()
  await page.waitForTimeout(2000)
  return true
}

async function inspectDataEntryWizard(page, outputDir, snap) {
  var documentTypeOptions = []

  await snap('03-data-entry-initial')

  var typeOpened = await openDocumentTypeDropdown(page)
  if (typeOpened) {
    documentTypeOptions = await captureDocumentTypeOptions(page)
    writeFileSync(join(outputDir, 'epn-document-type-options.json'), JSON.stringify(documentTypeOptions, null, 2))
    console.log('Document type options captured: ' + documentTypeOptions.length)
    await snap('04-document-type-dropdown-open')
    await page.keyboard.press('Escape').catch(function() {})
    await page.waitForTimeout(800)
  }

  var tabs = ['#indexing-status', '#image-status']
  for (var i = 0; i < tabs.length; i++) {
    var clicked = await clickWizardTab(page, tabs[i])
    if (clicked) {
      await snap('05-tab-' + tabs[i].replace('#', ''))
    }
  }

  var safeButtons = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('button, input[type="button"], a'))
      .map(function(el) {
        return (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
      })
      .filter(function(text) {
        return text && /cancel|save|add doc|open file|scan image|main image|index|image/i.test(text)
      })
      .slice(0, 20)
  })

  for (var j = 0; j < safeButtons.length; j++) {
    var label = safeButtons[j]
    if (!isSafeWizardNav(label)) continue
    if (/^(save|add doc)$/i.test(label)) {
      console.log('Skipping button (would mutate package): ' + label)
      continue
    }
  }

  await snap('06-data-entry-final')

  return {
    documentTypeOptions: documentTypeOptions,
    uploadControls: {
      openFileButton: 'button:has-text("Open File"), .btn-group.upload button',
      scanImageButton: 'button:has-text("Scan Image")',
      documentNameInput: 'input[placeholder="Document Name"]',
      documentTypeDropdown: '.doctype-dropdown, .k-dropdownlist',
    },
  }
}

async function inspectPackageEditorWizard(page, outputDir, snap) {
  await snap('03-package-editor')
  console.log('Clicking Add A Doc (#AddDocuments)...')
  await clickAddDocumentButton(page)
  await snap('04-add-doc-clicked')
  return inspectDataEntryWizard(page, outputDir, snap)
}

function buildDocWizardReport(captures, documentTypeOptions) {
  var requiredFields = buildRequiredFieldsReport(captures)

  if (documentTypeOptions && documentTypeOptions.length) {
    requiredFields.documentTypeSelectors.push({
      step: 'document-type-dropdown',
      selector: '.doctype-dropdown, .k-dropdownlist',
      label: 'Document Type',
      options: documentTypeOptions.map(function(text) {
        return { value: text, text: text }
      }),
    })
  }

  return {
    requiredFields: requiredFields,
    uploadSelectors: requiredFields.uploadSelectors,
    documentTypeSelectors: requiredFields.documentTypeSelectors,
    categorizedFields: requiredFields.categorized,
    dangerousButtons: requiredFields.dangerousButtons,
    documentTypeOptions: documentTypeOptions || [],
  }
}

async function exploreDocumentWizard(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var captures = []
  var deepStore = []
  var packId = null
  var packageCreated = false
  var editorOpened = false
  var addDocClicked = false
  var wizardInspect = null
  var discardResult = { attempted: false, discarded: false, method: null, reason: 'not attempted' }

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog (auto-dismiss): ' + dialog.message())
    await dialog.accept().catch(function() {})
  })

  async function snap(label) {
    var result = await deepCapture(page, outputDir, 'docwizard-' + slugify(label), deepStore)
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

  await snap('02-after-create')
  console.log('Package created: ' + packageCreated + (packId ? ' (packId=' + packId + ')' : ''))
  if (createResult.alertText) console.log('Create alert: ' + createResult.alertText)

  if (packageCreated && packId) {
    if (createResult.autoNavigated && /DataEntry/i.test(page.url())) {
      console.log('Auto-navigated to data entry wizard — inspecting in place')
      editorOpened = true
      addDocClicked = true
      wizardInspect = await inspectDataEntryWizard(page, outputDir, snap)
    } else if (packId !== '50254044') {
      var openResult = await openPackageEditor(page, packageName)
      editorOpened = openResult.opened
      packId = openResult.packId || packId
      if (editorOpened) {
        wizardInspect = await inspectPackageEditorWizard(page, outputDir, snap)
        addDocClicked = true
      }
    }
  }

  var report = buildDocWizardReport(captures, wizardInspect ? wizardInspect.documentTypeOptions : [])
  var summary = {
    outputDir: outputDir,
    mode: 'doc-wizard',
    inspectedAt: new Date().toISOString(),
    packageName: packageName,
    packageCreated: packageCreated,
    packId: packId,
    editorOpened: editorOpened,
    addDocClicked: addDocClicked,
    dataEntryUrl: /DataEntry/i.test(page.url()) ? page.url() : null,
    uploadSelectorsFound: report.uploadSelectors.length,
    documentTypeOptionsFound: report.documentTypeOptions.length,
    requiredFieldCount: report.requiredFields.allFields.length,
    dangerousButtonsFound: report.dangerousButtons.length,
    uploadControls: wizardInspect ? wizardInspect.uploadControls : null,
    createResult: createResult,
  }

  writeFileSync(join(outputDir, 'epn-doc-wizard-selectors.json'), JSON.stringify({
    addDocumentButton: '#AddDocuments',
    dataEntryUrlPattern: '/L2/DataEntry/Index?packId={packId}',
    uploadControls: wizardInspect ? wizardInspect.uploadControls : null,
    uploadSelectors: report.uploadSelectors,
    documentTypeSelectors: report.documentTypeSelectors,
  }, null, 2))
  writeFileSync(join(outputDir, 'epn-doc-wizard-fields.json'), JSON.stringify(report.categorizedFields, null, 2))
  writeFileSync(join(outputDir, 'epn-doc-wizard-dangerous-buttons.json'), JSON.stringify(report.dangerousButtons, null, 2))
  writeFileSync(join(outputDir, 'epn-doc-wizard-navigation.json'), JSON.stringify(deepStore, null, 2))
  writeFileSync(join(outputDir, 'epn-doc-wizard-summary.json'), JSON.stringify(summary, null, 2))

  if (packageCreated) {
    console.log('\nAttempting safe discard of test package only: ' + packageName)
    discardResult = await trySafeDiscardPackage(page, packageName, { packId: packId })
    if (!discardResult.discarded) {
      console.log('Safe discard not confirmed — leaving test package as draft. ' + (discardResult.reason || ''))
      if (packId) console.log('Test packId left as draft: ' + packId)
    } else {
      console.log('Test package discarded via: ' + discardResult.method)
    }
  }

  writeFileSync(join(outputDir, 'epn-doc-wizard-discard-result.json'), JSON.stringify(discardResult, null, 2))

  return {
    success: true,
    mode: 'doc-wizard',
    outputDir: outputDir,
    packageName: packageName,
    packageCreated: packageCreated,
    packId: packId,
    editorOpened: editorOpened,
    addDocClicked: addDocClicked,
    uploadSelectorsFound: report.uploadSelectors.length,
    documentTypeOptionsFound: report.documentTypeOptions.length,
    requiredFields: report.requiredFields,
    requiredFieldCount: report.requiredFields.allFields.length,
    discardResult: discardResult,
    summaryPath: join(outputDir, 'epn-doc-wizard-summary.json'),
    selectorsPath: join(outputDir, 'epn-doc-wizard-selectors.json'),
    fieldsPath: join(outputDir, 'epn-doc-wizard-fields.json'),
  }
}

module.exports = {
  exploreDocumentWizard,
}
