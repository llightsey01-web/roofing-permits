// lib/epn/worklist-helpers.js
// Shared ePN worklist / package creation helpers for inspection scripts

const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')
const { isNeverDeletePackId, NEVER_DELETE_PACK_IDS } = require('./submit-safety')

function extractPackIdFromUrl(url) {
  if (!url) return null
  var match = String(url).match(/packId=(\d+)/i)
  return match ? match[1] : null
}

function resolveEpnUrl(href, baseUrl) {
  if (!href) return null
  if (href.startsWith('http')) {
    var parsed = new URL(href)
    if (parsed.hostname === 'apps.erecording.com') {
      parsed.hostname = 'ep.erecording.com'
      parsed.pathname = parsed.pathname.replace(/^\/Quickstart/i, '')
    }
    return parsed.toString()
  }
  return new URL(href, baseUrl || epnConfig.portalUrl).toString()
}

async function ensureWorklist(page) {
  if (!page.url().includes('/Worklist')) {
    await page.goto(epnConfig.portalUrl + '/Worklist', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
  }
}

async function dismissAlertIfPresent(page) {
  var dismissed = await page.evaluate(function() {
    var buttons = Array.from(document.querySelectorAll('button, input[type="button"], a'))
    var okBtn = buttons.find(function(el) {
      var text = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
      return /^ok$/i.test(text)
    })
    if (okBtn) {
      okBtn.click()
      return true
    }
    return false
  })
  if (dismissed) await page.waitForTimeout(800)
  return dismissed
}

async function fillPackageName(page, packageName) {
  var nameInput = await page.$('#package-name')
  if (!nameInput) throw new Error('Could not find #package-name on Worklist')
  await nameInput.click({ clickCount: 3 })
  await nameInput.fill(packageName)
  await page.waitForTimeout(400)
}

async function selectJurisdiction(page, jurisdiction) {
  var countyInput = page.locator('#stateCounty-search')
  if (await countyInput.count() === 0) throw new Error('Could not find #stateCounty-search on Worklist')

  await countyInput.click({ clickCount: 3 })
  await countyInput.fill('')
  await page.waitForTimeout(400)

  await countyInput.pressSequentially('Polk', { delay: 120 })
  await page.waitForTimeout(2200)

  var autocompleteOptions = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('.ui-autocomplete li, .ui-menu-item, [role="option"], .autocomplete-suggestion'))
      .map(function(el) {
        return {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          className: el.className,
          visible: el.offsetParent !== null,
        }
      })
      .filter(function(item) { return item.text && item.visible })
  })
  console.log('Jurisdiction autocomplete options: ' + JSON.stringify(autocompleteOptions.map(function(o) { return o.text })))

  var picked = false
  var optionLocators = [
    page.locator('.ui-autocomplete li').filter({ hasText: /Polk County,\s*FL/i }),
    page.locator('.ui-menu-item').filter({ hasText: /Polk County,\s*FL/i }),
    page.locator('[role="listbox"] [role="option"]').filter({ hasText: /Polk County,\s*FL/i }),
    page.locator('li').filter({ hasText: /^Polk County,\s*FL$/i }),
  ]

  for (var i = 0; i < optionLocators.length && !picked; i++) {
    var option = optionLocators[i].first()
    if (await option.count() > 0) {
      await option.click()
      picked = true
      await page.waitForTimeout(900)
      break
    }
  }

  if (!picked) {
    await countyInput.press('ArrowDown').catch(function() {})
    await page.waitForTimeout(400)
    await countyInput.press('Enter').catch(function() {})
    await page.waitForTimeout(900)
  }

  var currentValue = await countyInput.inputValue().catch(function() { return '' })
  if (!/,\s*FL/i.test(currentValue)) {
    await countyInput.click({ clickCount: 3 })
    await countyInput.fill(jurisdiction)
    await page.waitForTimeout(600)
    await countyInput.press('Tab').catch(function() {})
    await page.waitForTimeout(500)
    currentValue = await countyInput.inputValue().catch(function() { return '' })
  }

  if (!/,\s*FL/i.test(currentValue)) {
    await countyInput.click({ clickCount: 3 })
    await countyInput.fill('')
    await countyInput.pressSequentially(jurisdiction, { delay: 60 })
    await page.waitForTimeout(1200)
    await countyInput.press('Tab').catch(function() {})
    currentValue = await countyInput.inputValue().catch(function() { return '' })
  }

  return {
    picked: picked,
    value: currentValue,
    jurisdiction: jurisdiction,
    valid: /polk/i.test(currentValue) && /,\s*FL/i.test(currentValue),
    autocompleteOptions: autocompleteOptions,
  }
}

async function clickAddPackage(page) {
  var btn = await page.$('#AddPackage-button')
  if (!btn) throw new Error('Could not find #AddPackage-button')
  await btn.click()
  await page.waitForTimeout(1200)

  await page.waitForFunction(function() {
    var text = document.body ? document.body.innerText || '' : ''
    return /creating package/i.test(text)
  }, { timeout: 8000 }).catch(function() {})

  await page.waitForFunction(function() {
    var text = document.body ? document.body.innerText || '' : ''
    return !/creating package/i.test(text)
  }, { timeout: 45000 }).catch(function() {})

  await page.waitForTimeout(2000)
}

async function waitForPackageCreation(page, packageName, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 45000)
  while (Date.now() < deadline) {
    var urlPackId = extractPackIdFromUrl(page.url())
    if (urlPackId && (/DataEntry/i.test(page.url()) || /PackageView/i.test(page.url()))) {
      return {
        found: true,
        packId: urlPackId,
        navigatedTo: page.url(),
        method: 'url_navigation',
      }
    }

    var rowInfo = await findPackageRowInfo(page, packageName)
    if (rowInfo.found) {
      rowInfo.method = 'worklist_row'
      return rowInfo
    }

    await page.waitForTimeout(1500)
  }
  return { found: false, method: null }
}

async function findPackageRowInfo(page, packageName) {
  return page.evaluate(function(name) {
    function rowText(row) {
      return (row.textContent || '').replace(/\s+/g, ' ').trim()
    }

    var rows = Array.from(document.querySelectorAll('[role="row"], tr, .ag-row'))
    var targetRow = rows.find(function(row) {
      return rowText(row).indexOf(name) >= 0
    })

    if (!targetRow) return { found: false }

    var link = targetRow.querySelector('a[href*="PackageView"], a[href*="packId"]')
    return {
      found: true,
      rowText: rowText(targetRow).slice(0, 240),
      href: link ? link.getAttribute('href') : null,
      packId: link && link.getAttribute('href') ? (link.getAttribute('href').match(/packId=(\d+)/i) || [])[1] : null,
    }
  }, packageName)
}

async function openPackageEditor(page, packageName) {
  var rowInfo = await findPackageRowInfo(page, packageName)
  if (rowInfo.found && rowInfo.href) {
    var editorUrl = resolveEpnUrl(rowInfo.href, page.url())
    console.log('Opening package editor via row link: ' + editorUrl)
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    return {
      opened: !/cannot be found|404/i.test(await page.title()),
      packId: extractPackIdFromUrl(page.url()) || rowInfo.packId,
      editorUrl: page.url(),
      method: 'row_href',
    }
  }

  var openedByClick = await page.evaluate(function(name) {
    var rows = Array.from(document.querySelectorAll('[role="row"], tr, .ag-row'))
    var targetRow = rows.find(function(row) {
      return (row.textContent || '').indexOf(name) >= 0
    })
    if (!targetRow) return false
    var link = targetRow.querySelector('a[href*="PackageView"], a[href*="packId"], a')
    if (!link) return false
    link.click()
    return true
  }, packageName)

  if (openedByClick) {
    await page.waitForTimeout(3500)
    return {
      opened: !/cannot be found|404/i.test(await page.title()),
      packId: extractPackIdFromUrl(page.url()),
      editorUrl: page.url(),
      method: 'row_click',
    }
  }

  return { opened: false, packId: null, editorUrl: null, method: null }
}

async function createTestPackage(page, packageName, jurisdiction) {
  await ensureWorklist(page)
  await fillPackageName(page, packageName)
  var jurisdictionResult = await selectJurisdiction(page, jurisdiction)

  if (!jurisdictionResult.valid) {
    console.log('Jurisdiction not valid after first attempt — retrying autocomplete pick')
    await dismissAlertIfPresent(page)
    jurisdictionResult = await selectJurisdiction(page, jurisdiction)
  }

  if (!jurisdictionResult.valid) {
    return {
      created: false,
      alertText: 'Jurisdiction not set to valid County, ST format (value: ' + jurisdictionResult.value + ')',
      jurisdictionResult: jurisdictionResult,
    }
  }

  await clickAddPackage(page)

  var alertText = await page.evaluate(function() {
    var headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, .modal-title, .alert, [role="alert"]'))
    var alertEl = headings.find(function(el) {
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      return /valid county|format county|alert/i.test(text)
    })
    return alertEl ? alertEl.textContent.replace(/\s+/g, ' ').trim() : null
  })

  if (alertText) {
    await dismissAlertIfPresent(page)
    return {
      created: false,
      alertText: alertText,
      jurisdictionResult: jurisdictionResult,
    }
  }

  await page.waitForTimeout(1500)

  var urlPackId = extractPackIdFromUrl(page.url())
  var onDataEntry = /DataEntry/i.test(page.url())
  if (urlPackId && (onDataEntry || /PackageView/i.test(page.url()))) {
    return {
      created: true,
      packId: urlPackId,
      rowInfo: { found: true, packId: urlPackId, navigatedTo: page.url() },
      jurisdictionResult: jurisdictionResult,
      alertText: null,
      autoNavigated: true,
    }
  }

  var rowInfo = await waitForPackageCreation(page, packageName, 45000)
  return {
    created: rowInfo.found,
    packId: rowInfo.packId || urlPackId,
    rowInfo: rowInfo,
    jurisdictionResult: jurisdictionResult,
    alertText: null,
    autoNavigated: !!(rowInfo.navigatedTo && /DataEntry/i.test(rowInfo.navigatedTo)),
  }
}

async function createProductionPackage(page, packageName, jurisdiction) {
  var submitSafety = require('./submit-safety')
  if (submitSafety.isTestPackageName(packageName)) {
    throw new submitSafety.SendPackageSafetyError('Refusing production package with test name: ' + packageName)
  }
  return createTestPackage(page, packageName, jurisdiction)
}

async function captureDeleteModal(page, outputDir) {
  var result = {
    captured: false,
    html: '',
    buttons: [],
    confirmSelector: null,
  }

  await page.waitForSelector('#modal', { state: 'visible', timeout: 8000 }).catch(function() {})

  var modal = page.locator('#modal')
  if (await modal.count() === 0) return result

  result.html = await modal.evaluate(function(el) { return el.outerHTML })
  result.captured = true

  result.buttons = await modal.evaluate(function(el) {
    return Array.from(el.querySelectorAll('button, input, a, span[role="button"], .btn, li.modal-button')).map(function(node) {
      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || null,
        className: node.className || null,
        text: (node.textContent || node.value || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        value: node.value || null,
        selector: node.id ? ('#' + CSS.escape(node.id)) : null,
      }
    }).filter(function(item) { return item.text || item.value })
  })

  if (outputDir) {
    var join = require('path').join
    var writeFileSync = require('fs').writeFileSync
    writeFileSync(join(outputDir, 'epn-delete-modal.html'), result.html)
    writeFileSync(join(outputDir, 'epn-delete-confirm-selectors.json'), JSON.stringify({
      buttons: result.buttons,
      suggestedSelectors: [
        '#modal-submit',
        '#modal li.modal-button.delete',
        '#modal li.modal-primary',
        '#modal .modal-nav-buttons li:not(.modal-cancel)',
        '#modal .contents-inner button',
        '#modal button:has-text("Delete")',
      ],
    }, null, 2))
  }

  return result
}

async function confirmDeleteDialog(page, options) {
  var opts = options || {}
  await page.waitForTimeout(1200)

  var modalCapture = null
  if (opts.captureModal && opts.outputDir) {
    modalCapture = await captureDeleteModal(page, opts.outputDir)
  }

  var strategies = [
    page.locator('#modal-submit'),
    page.locator('#modal li.modal-button.delete, #modal li.modal-primary.delete'),
    page.locator('#modal .modal-nav-buttons li:not(.modal-cancel)'),
    page.locator('#modal .contents-inner button').filter({ hasText: /^ok$/i }),
    page.locator('#modal .contents-inner input[type="button"][value="OK"], #modal .contents-inner input[type="submit"][value="OK"]'),
    page.locator('#modal input[type="button"][value="OK"], #modal input[type="submit"][value="OK"]'),
    page.locator('#modal button, #modal input[type="button"], #modal input[type="submit"]').filter({ hasText: /^ok$/i }),
    page.locator('#modal button, #modal li.modal-button').filter({ hasText: /^delete$/i }),
    page.locator('#modal .btn-primary, #modal .btn-danger, #modal .confirm, #modal .modal-footer button').last(),
    page.locator('.bootbox.modal.in button.btn-primary, .bootbox.show button.btn-primary, .bootbox-accept'),
    page.locator('.modal.in button, .modal.show button').filter({ hasText: /^(ok|yes|delete|confirm)$/i }),
    page.locator('[role="dialog"] button').filter({ hasText: /^(ok|yes|delete|confirm)$/i }),
  ]

  for (var i = 0; i < strategies.length; i++) {
    var btn = strategies[i].first()
    if (await btn.count() > 0) {
      var text = ((await btn.textContent().catch(function() { return '' })) || (await btn.getAttribute('value')) || '').trim()
      if (/cancel|close|no/i.test(text)) continue
      await btn.click({ force: true })
      await page.waitForTimeout(3000)
      return { confirmed: true, strategy: 'locator_' + i, buttonText: text, modalCapture: modalCapture }
    }
  }

  var clicked = await page.evaluate(function() {
    var modalEl = document.querySelector('#modal, .bootbox.modal.in, .bootbox.show, .modal.in, .modal.show, .k-dialog, [role="dialog"]')
    if (!modalEl) return { clicked: false, reason: 'no modal found', buttons: [] }

    var scopes = [modalEl.querySelector('.modal-buttons'), modalEl.querySelector('.contents-inner'), modalEl]
    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s]
      if (!scope) continue
      var buttons = Array.from(scope.querySelectorAll('button, input[type="button"], input[type="submit"], a, .btn, li.modal-button'))
      var buttonInfo = buttons.map(function(el) {
        return {
          tag: el.tagName,
          text: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim(),
          id: el.id || null,
          className: el.className || null,
        }
      })

      var confirmBtn = buttons.find(function(el) {
        if (el.id === 'DeletePkgBtn') return false
        var text = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
        if (/cancel|close|no/i.test(text)) return false
        if (el.id === 'modal-submit') return true
        return /^ok$/i.test(text) || /^(delete|remove|yes|confirm)$/i.test(text) || /delete package|remove package/i.test(text)
      })
      if (confirmBtn) {
        confirmBtn.click()
        return { clicked: true, buttonText: (confirmBtn.textContent || confirmBtn.value || '').trim(), buttons: buttonInfo, scope: s === 0 ? 'contents-inner' : 'modal-root' }
      }
    }

    return { clicked: false, reason: 'no confirm button in modal', buttons: [] }
  })

  await page.waitForTimeout(3000)
  return {
    confirmed: !!(clicked && clicked.clicked),
    strategy: clicked && clicked.clicked ? 'evaluate_modal_ok' : 'none',
    buttonText: clicked && clicked.buttonText,
    detail: clicked,
    modalCapture: modalCapture,
  }
}

async function findPackageNameByPackId(page, packId) {
  await ensureWorklist(page)
  await page.waitForTimeout(1500)
  return page.evaluate(function(id) {
    var links = Array.from(document.querySelectorAll('a[href*="packId=' + id + '"], a[href*="packId=' + id + '&"]'))
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      var row = link.closest('[role="row"], tr, .ag-row')
      var rowText = row ? (row.textContent || '').replace(/\s+/g, ' ').trim() : ''
      var match = rowText.match(/AHJ-IQ TEST DO NOT SUBMIT \d+/)
      if (match) return match[0]
    }

    var rows = Array.from(document.querySelectorAll('[role="row"], tr, .ag-row'))
    var target = rows.find(function(row) {
      var href = row.querySelector('a[href*="packId=' + id + '"]')
      return !!href
    })
    if (!target) return null
    var nameMatch = (target.textContent || '').match(/AHJ-IQ TEST DO NOT SUBMIT \d+/)
    return nameMatch ? nameMatch[0] : null
  }, String(packId))
}

async function tryCleanupStaleTestPackages(page, packIds, options) {
  var opts = options || {}
  var results = []

  for (var i = 0; i < packIds.length; i++) {
    var packId = String(packIds[i])
    if (isNeverDeletePackId(packId)) {
      results.push({ packId: packId, skipped: true, reason: 'forbidden packId — no automated cleanup' })
      continue
    }

    var packageName = await findPackageNameByPackId(page, packId)
    if (!packageName) {
      results.push({ packId: packId, skipped: true, reason: 'test package name not found on worklist' })
      continue
    }

    console.log('Cleaning stale test package: ' + packageName + ' (packId=' + packId + ')')
    var discardResult = await trySafeDiscardPackage(page, packageName, {
      packId: packId,
      outputDir: opts.outputDir,
      captureModal: i === 0 && !!opts.outputDir,
    })
    results.push(Object.assign({ packId: packId, packageName: packageName }, discardResult))
  }

  return results
}

async function trySafeDiscardPackage(page, packageName, options) {
  var opts = options || {}

  if (opts.packId && isNeverDeletePackId(opts.packId)) {
    return {
      attempted: false,
      discarded: false,
      method: null,
      reason: 'Refusing delete — packId ' + opts.packId + ' is on never-delete list (accidental submit or forbidden)',
      packId: opts.packId,
    }
  }

  if (!/^AHJ-IQ TEST DO NOT SUBMIT /i.test(packageName)) {
    return {
      attempted: false,
      discarded: false,
      method: null,
      reason: 'Refusing delete — package name does not match test pattern',
      packId: opts.packId || null,
    }
  }

  var result = {
    attempted: true,
    discarded: false,
    method: null,
    reason: null,
    packId: opts.packId || null,
    confirmResult: null,
  }

  if (opts.packId) {
    var editorUrl = epnConfig.portalUrl + '/Secure/Packages/PackageView.aspx?packId=' + opts.packId + '&isArchived=false'
    console.log('Navigating to test package editor for cleanup: ' + editorUrl)
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    result.packId = opts.packId

    var deleteBtn = await page.$('#DeletePkgBtn')
    if (deleteBtn) {
      console.log('Attempting package editor delete via #DeletePkgBtn')
      await deleteBtn.click()
      result.confirmResult = await confirmDeleteDialog(page, {
        outputDir: opts.outputDir,
        captureModal: !!opts.captureModal,
      })

      await ensureWorklist(page)
      var stillThere = (await findPackageRowInfo(page, packageName)).found
      if (!stillThere) {
        result.discarded = true
        result.method = 'editor_delete_pkg_btn_by_packId'
        return result
      }

      var editorStillLoads = false
      try {
        await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
        editorStillLoads = !/cannot be found|404|error/i.test(await page.title())
      } catch (e) {
        editorStillLoads = false
      }
      if (!editorStillLoads) {
        result.discarded = true
        result.method = 'editor_delete_pkg_btn_by_packId_verify_gone'
        return result
      }
    }
  }

  await ensureWorklist(page)
  await page.waitForTimeout(1500)

  var rowInfo = await findPackageRowInfo(page, packageName)
  if (!rowInfo.found) {
    result.reason = 'Test package row not found on worklist'
    return result
  }
  result.packId = rowInfo.packId

  var editorUrl = rowInfo.href ? resolveEpnUrl(rowInfo.href, page.url()) : null
  if (editorUrl && rowInfo.packId) {
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    var deleteBtn = await page.$('#DeletePkgBtn')
    if (deleteBtn) {
      console.log('Attempting package editor delete via #DeletePkgBtn')
      await deleteBtn.click()
      result.confirmResult = await confirmDeleteDialog(page, {
        outputDir: opts.outputDir,
        captureModal: !!opts.captureModal,
      })

      await ensureWorklist(page)
      var stillThere = (await findPackageRowInfo(page, packageName)).found
      if (!stillThere) {
        result.discarded = true
        result.method = 'editor_delete_pkg_btn'
        return result
      }
    }
  }

  await ensureWorklist(page)
  var trashClicked = await page.evaluate(function(name) {
    var rows = Array.from(document.querySelectorAll('[role="row"], tr, .ag-row'))
    var targetRow = rows.find(function(row) {
      return (row.textContent || '').indexOf(name) >= 0
    })
    if (!targetRow) return false

    var trash = Array.from(targetRow.querySelectorAll('button, a, [aria-label], svg, i')).find(function(el) {
      var label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase()
      return /delete|remove|trash/.test(label)
    })
    if (!trash) return false
    trash.click()
    return true
  }, packageName)

  if (!trashClicked) {
    result.reason = result.reason || 'No trash/delete control found for test package row'
    return result
  }

  await page.waitForTimeout(1200)
  result.confirmResult = await confirmDeleteDialog(page, {
    outputDir: opts.outputDir,
    captureModal: !!opts.captureModal,
  })
  await page.waitForTimeout(1500)

  var stillVisible = (await findPackageRowInfo(page, packageName)).found
  if (!stillVisible) {
    result.discarded = true
    result.method = 'worklist_trash_delete'
    return result
  }

  result.reason = 'Delete attempted but package still visible'
  return result
}

module.exports = {
  epnConfig,
  extractPackIdFromUrl,
  resolveEpnUrl,
  ensureWorklist,
  dismissAlertIfPresent,
  fillPackageName,
  selectJurisdiction,
  clickAddPackage,
  findPackageRowInfo,
  openPackageEditor,
  createTestPackage,
  createProductionPackage,
  trySafeDiscardPackage,
  waitForPackageCreation,
  confirmDeleteDialog,
  captureDeleteModal,
  findPackageNameByPackId,
  tryCleanupStaleTestPackages,
  NEVER_DELETE_PACK_IDS,
}
