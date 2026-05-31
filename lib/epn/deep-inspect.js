// lib/epn/deep-inspect.js
// ePN pass 2 — package editor deep inspection (no submit/record/upload)

const { writeFileSync, mkdirSync, readFileSync } = require('fs')
const { join } = require('path')
const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')
const { collectPageInventory, annotateInventory } = require('./inspect')

function isDangerousAction(text) {
  return epnConfig.dangerousPatterns.some(function(pattern) {
    return pattern.test(String(text || ''))
  }) || /^(submit|send|record|finalize|pay|confirm)/i.test(String(text || '').trim())
}

function isSafeDiscardAction(text) {
  var value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return false
  if (isDangerousAction(value)) return false
  return /^(delete|remove|discard|cancel|close|abandon)$/i.test(value) ||
    /delete package|remove package|discard package|cancel package/i.test(value)
}

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

async function collectDeepInventory(page) {
  var base = annotateInventory(await collectPageInventory(page))
  var extra = await page.evaluate(function() {
    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden'
    }

    function selectorFor(el) {
      if (el.id) return '#' + CSS.escape(el.id)
      if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]'
      return el.tagName.toLowerCase()
    }

    function labelFor(el) {
      if (el.id) {
        var byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
        if (byFor) return (byFor.textContent || '').replace(/\s+/g, ' ').trim()
      }
      var parentLabel = el.closest('label')
      if (parentLabel) return (parentLabel.textContent || '').replace(/\s+/g, ' ').trim()
      return null
    }

    var fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(visible).map(function(el) {
      return {
        selector: selectorFor(el),
        name: el.getAttribute('name'),
        id: el.id || null,
        accept: el.getAttribute('accept'),
        label: labelFor(el),
      }
    })

    var dropzones = Array.from(document.querySelectorAll('[class*="drop" i], [class*="upload" i], [data-testid*="upload" i], [aria-label*="upload" i]'))
      .filter(visible)
      .slice(0, 30)
      .map(function(el) {
        return {
          selector: selectorFor(el),
          className: el.className,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          ariaLabel: el.getAttribute('aria-label'),
        }
      })

    var selects = Array.from(document.querySelectorAll('select')).filter(visible).map(function(el) {
      var options = Array.from(el.options || []).map(function(opt) {
        return { value: opt.value, text: (opt.textContent || '').trim() }
      }).slice(0, 50)
      return {
        selector: selectorFor(el),
        name: el.getAttribute('name'),
        id: el.id || null,
        label: labelFor(el),
        options: options,
      }
    })

    var labeledFields = Array.from(document.querySelectorAll('input, select, textarea')).filter(visible).map(function(el) {
      var type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase()
      if (type === 'hidden') return null
      return {
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        type: type,
        name: el.getAttribute('name'),
        id: el.id || null,
        placeholder: el.getAttribute('placeholder'),
        label: labelFor(el),
        ariaLabel: el.getAttribute('aria-label'),
        value: el.value ? String(el.value).slice(0, 80) : null,
      }
    }).filter(Boolean)

    var allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
      .filter(visible)
      .map(function(el) {
        var text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
        if (!text) return null
        return {
          selector: selectorFor(el),
          text: text.slice(0, 120),
          tag: el.tagName.toLowerCase(),
          href: el.getAttribute('href'),
        }
      }).filter(Boolean)

    return {
      fileInputs: fileInputs,
      dropzones: dropzones,
      selects: selects,
      labeledFields: labeledFields,
      allButtons: allButtons,
    }
  })

  return Object.assign({}, base, extra)
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
  console.log('Deep capture: ' + stepName + ' (' + inventory.url + ')')
  return { inventory: inventory, entry: entry }
}

async function ensureWorklist(page) {
  if (!page.url().includes('/Worklist')) {
    await page.goto(epnConfig.portalUrl + '/Worklist', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
  }
}

async function fillPackageName(page, packageName) {
  var nameInput = await page.$('#package-name')
  if (!nameInput) throw new Error('Could not find #package-name on Worklist')
  await nameInput.fill(packageName)
  await page.waitForTimeout(400)
}

async function selectJurisdiction(page, jurisdiction) {
  var countyInput = await page.$('#stateCounty-search')
  if (!countyInput) throw new Error('Could not find #stateCounty-search on Worklist')
  await countyInput.click()
  await countyInput.fill('')
  await countyInput.fill(jurisdiction)
  await page.waitForTimeout(1200)

  var picked = await page.evaluate(function(jurisdictionText) {
    var candidates = Array.from(document.querySelectorAll('[role="option"], li, .dropdown-item, .autocomplete-item, a, span, div'))
      .map(function(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim() })
      .filter(function(text) { return text && text.toLowerCase().indexOf('polk') >= 0 })
    var exact = candidates.find(function(text) {
      return text.toLowerCase() === jurisdictionText.toLowerCase()
    })
    return exact || candidates[0] || null
  }, jurisdiction)

  if (picked) {
    await page.evaluate(function(text) {
      var el = Array.from(document.querySelectorAll('[role="option"], li, .dropdown-item, .autocomplete-item, a, span, div')).find(function(node) {
        return (node.textContent || '').replace(/\s+/g, ' ').trim() === text
      })
      if (el) el.click()
    }, picked)
    await page.waitForTimeout(800)
  } else {
    await page.keyboard.press('ArrowDown').catch(function() {})
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter').catch(function() {})
    await page.waitForTimeout(800)
  }
}

async function clickAddPackage(page) {
  var btn = await page.$('#AddPackage-button')
  if (!btn) throw new Error('Could not find #AddPackage-button')
  await btn.click()
  await page.waitForTimeout(2500)
}

async function openPackageByName(page, packageName) {
  var opened = await page.evaluate(function(name) {
    var link = Array.from(document.querySelectorAll('a, [role="gridcell"], td, span')).find(function(el) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim() === name
    })
    if (!link) return false
    link.click()
    return true
  }, packageName)

  if (!opened) {
    throw new Error('Could not find package row/link for: ' + packageName)
  }

  await page.waitForTimeout(3500)
}

async function openExistingPackageOnEpnHost(page, packId) {
  var url = epnConfig.portalUrl + '/Secure/Packages/PackageView.aspx?packId=' + packId + '&isArchived=false'
  console.log('Opening existing package on ep.erecording.com: ' + url)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  return url
}

async function trySafeDiscardPackage(page, packageName) {
  var result = {
    attempted: true,
    discarded: false,
    method: null,
    reason: null,
  }

  await ensureWorklist(page)
  await page.waitForTimeout(1500)

  var trashClicked = await page.evaluate(function(name) {
    var rows = Array.from(document.querySelectorAll('[role="row"], tr'))
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
    result.reason = 'No trash/delete control found for test package row'
    return result
  }

  await page.waitForTimeout(1200)

  var confirmClicked = await page.evaluate(function() {
    var safe = Array.from(document.querySelectorAll('button, input[type="button"], a')).find(function(el) {
      var text = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
      if (/cancel/i.test(text)) return false
      return /^(delete|remove|yes|ok|confirm)$/i.test(text) || /delete package|remove package/i.test(text)
    })
    if (!safe) return false
    safe.click()
    return true
  })

  await page.waitForTimeout(2000)

  if (confirmClicked) {
    var stillVisible = await page.evaluate(function(name) {
      return (document.body.innerText || '').indexOf(name) >= 0
    }, packageName)

    if (!stillVisible) {
      result.discarded = true
      result.method = 'worklist_trash_delete'
      return result
    }
  }

  result.reason = 'Delete clicked but package still visible or confirm not found'
  return result
}

function buildRequiredFieldsReport(captures) {
  var fields = []
  var documentTypes = []
  var uploadSelectors = []
  var dangerousButtons = []

  captures.forEach(function(capture) {
    var inv = capture.inventory
    ;(inv.labeledFields || []).forEach(function(field) {
      var label = [field.label, field.name, field.id, field.placeholder, field.ariaLabel].filter(Boolean).join(' ')
      fields.push(Object.assign({}, field, {
        step: capture.entry.step,
        url: inv.url,
        labelText: label,
      }))
    })
    ;(inv.selects || []).forEach(function(sel) {
      var label = [sel.label, sel.name, sel.id].filter(Boolean).join(' ')
      if (/document|type|instrument|noc|commencement|notice/i.test(label)) {
        documentTypes.push({
          step: capture.entry.step,
          selector: sel.selector,
          label: label,
          options: sel.options,
        })
      }
    })
    uploadSelectors = uploadSelectors.concat(capture.entry.uploadSelectors || [])
    dangerousButtons = dangerousButtons.concat((capture.entry.dangerousButtons || []).map(function(btn) {
      return Object.assign({}, btn, { step: capture.entry.step, url: inv.url, clicked: false })
    }))
  })

  var uniqueFields = []
  var seen = new Set()
  fields.forEach(function(field) {
    var key = field.selector + '|' + (field.labelText || '')
    if (seen.has(key)) return
    seen.add(key)
    uniqueFields.push(field)
  })

  var categorized = {
    county_jurisdiction: uniqueFields.filter(function(f) { return /county|jurisdiction|state/i.test(f.labelText || '') }),
    document_type: uniqueFields.filter(function(f) { return /document|type|instrument|noc|commencement|notice/i.test(f.labelText || '') }),
    parcel_apn: uniqueFields.filter(function(f) { return /parcel|apn|folio|tax|pin/i.test(f.labelText || '') }),
    party_grantor_grantee: uniqueFields.filter(function(f) { return /party|grantor|grantee|owner|submitter|preparer|name/i.test(f.labelText || '') }),
    return_info: uniqueFields.filter(function(f) { return /return|mail|address|email|recipient/i.test(f.labelText || '') }),
    fees_summary: uniqueFields.filter(function(f) { return /fee|cost|amount|total|payment|summary/i.test(f.labelText || '') }),
    other: uniqueFields.filter(function(f) {
      var text = f.labelText || ''
      return !/county|jurisdiction|state|document|type|instrument|noc|commencement|notice|parcel|apn|folio|tax|pin|party|grantor|grantee|owner|submitter|preparer|name|return|mail|address|email|recipient|fee|cost|amount|total|payment|summary/i.test(text)
    }),
  }

  return {
    categorized: categorized,
    allFields: uniqueFields,
    documentTypeSelectors: documentTypes,
    uploadSelectors: uploadSelectors,
    dangerousButtons: dangerousButtons,
  }
}

function buildPackageEditorSelectors(captures) {
  var editorCaptures = captures.filter(function(c) {
    return /editor|package|upload|metadata|fee|validation|existing/i.test(c.entry.step)
  })

  return {
    worklist: {
      addPackageButton: '#AddPackage-button',
      packageNameInput: '#package-name',
      jurisdictionSearch: '#stateCounty-search',
      packageSearch: '#TextSearchAng',
    },
    editorPages: editorCaptures.map(function(c) {
      return {
        step: c.entry.step,
        url: c.entry.url,
        packId: c.entry.packId,
        uploadSelectors: c.entry.uploadSelectors,
        selects: c.inventory.selects || [],
        dangerousButtons: c.entry.dangerousButtons || [],
      }
    }),
  }
}

async function explorePackageEditorDeep(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var timestamp = Date.now()
  var packageName = 'AHJ-IQ TEST DO NOT SUBMIT ' + timestamp
  var captures = []
  var deepStore = []
  var packId = null
  var editorOpened = false
  var discardResult = { attempted: false, discarded: false, method: null, reason: 'not attempted' }

  async function snap(label) {
    var result = await deepCapture(page, outputDir, 'deep-' + slugify(label), deepStore)
    captures.push(result)
    if (!packId && result.entry.packId) packId = result.entry.packId
    return result
  }

  function slugify(value) {
    return String(value || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
  }

  await ensureWorklist(page)
  await snap('01-worklist-before-create')

  console.log('Creating test package: ' + packageName)
  await fillPackageName(page, packageName)
  await selectJurisdiction(page, 'Polk County, FL')
  await snap('02-worklist-filled-create-form')
  await clickAddPackage(page)
  await snap('03-worklist-after-add-package')

  try {
    await openPackageByName(page, packageName)
    editorOpened = true
    packId = extractPackIdFromUrl(page.url()) || packId
    await snap('04-package-editor-opened')
  } catch (openErr) {
    console.log('Could not open package by name click: ' + openErr.message)
    var rowHref = await page.evaluate(function(name) {
      var row = Array.from(document.querySelectorAll('a[href*="PackageView"], a[href*="packId"]')).find(function(a) {
        return (a.textContent || '').indexOf(name) >= 0 || (a.closest('[role="row"]') && (a.closest('[role="row"]').textContent || '').indexOf(name) >= 0)
      })
      return row ? row.getAttribute('href') : null
    }, packageName)

    if (rowHref) {
      var editorUrl = resolveEpnUrl(rowHref, page.url())
      console.log('Opening package editor via resolved URL: ' + editorUrl)
      await page.goto(editorUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
      editorOpened = !page.url().includes('404') && !/cannot be found/i.test(await page.title())
      packId = extractPackIdFromUrl(page.url()) || packId
      await snap('04-package-editor-opened-url')
    }
  }

  if (editorOpened) {
    await snap('05-package-editor-upload-area')
    await page.waitForTimeout(1500)
    await snap('06-package-editor-metadata-fields')

    var tabsClicked = await page.evaluate(function() {
      var tabs = Array.from(document.querySelectorAll('button, a, [role="tab"]')).filter(function(el) {
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim()
        return /fee|summary|document|party|parcel|return|validation|ready|details|metadata/i.test(text)
      })
      return tabs.slice(0, 6).map(function(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim()
      })
    })

    for (var i = 0; i < tabsClicked.length; i++) {
      var tabLabel = tabsClicked[i]
      if (isDangerousAction(tabLabel)) continue
      console.log('Inspecting tab/section: ' + tabLabel)
      await page.evaluate(function(label) {
        var tab = Array.from(document.querySelectorAll('button, a, [role="tab"]')).find(function(el) {
          return (el.textContent || '').replace(/\s+/g, ' ').trim() === label
        })
        if (tab) tab.click()
      }, tabLabel)
      await page.waitForTimeout(1800)
      await snap('07-tab-' + slugify(tabLabel))
    }

    await snap('08-package-editor-validation-ready')
  }

  console.log('Opening existing package on ep.erecording.com host (read-only)...')
  await openExistingPackageOnEpnHost(page, '50254044')
  var existingOpened = !/cannot be found|404/i.test(await page.title())
  await snap('09-existing-package-ep-host')

  var requiredFields = buildRequiredFieldsReport(captures)
  var editorSelectors = buildPackageEditorSelectors(captures)
  var deepNav = {
    portal: epnConfig.name,
    mode: 'deep',
    inspectedAt: new Date().toISOString(),
    packageName: packageName,
    packId: packId,
    editorOpened: editorOpened,
    existingPackageOpenedOnEpnHost: existingOpened,
    pages: deepStore,
  }

  writeFileSync(join(outputDir, 'epn-package-editor-selectors.json'), JSON.stringify(editorSelectors, null, 2))
  writeFileSync(join(outputDir, 'epn-required-fields.json'), JSON.stringify(requiredFields, null, 2))
  writeFileSync(join(outputDir, 'epn-deep-navigation-map.json'), JSON.stringify(deepNav, null, 2))
  writeFileSync(join(outputDir, 'epn-deep-summary.json'), JSON.stringify({
    outputDir: outputDir,
    packageName: packageName,
    packId: packId,
    editorOpened: editorOpened,
    editorUrl: editorOpened ? (deepStore.find(function(s) { return s.step.indexOf('editor') >= 0 }) || {}).url : null,
    uploadSelectorsFound: requiredFields.uploadSelectors.length,
    documentTypeOptionsFound: requiredFields.documentTypeSelectors.reduce(function(sum, s) { return sum + (s.options || []).length }, 0),
    requiredFieldCount: requiredFields.allFields.length,
    dangerousButtonsFound: requiredFields.dangerousButtons.length,
    packageEditorSelectorsPath: join(outputDir, 'epn-package-editor-selectors.json'),
    requiredFieldsPath: join(outputDir, 'epn-required-fields.json'),
    deepNavigationMapPath: join(outputDir, 'epn-deep-navigation-map.json'),
  }, null, 2))

  console.log('\nAttempting safe discard of test package...')
  discardResult = await trySafeDiscardPackage(page, packageName)
  if (!discardResult.discarded) {
    console.log('Safe discard not confirmed — leaving test package as draft. ' + (discardResult.reason || ''))
  } else {
    console.log('Test package discarded via: ' + discardResult.method)
  }

  writeFileSync(join(outputDir, 'epn-deep-discard-result.json'), JSON.stringify(discardResult, null, 2))

  return {
    success: true,
    mode: 'deep',
    outputDir: outputDir,
    packageName: packageName,
    packId: packId,
    editorOpened: editorOpened,
    editorUrl: deepNav.pages.find(function(p) { return /editor/.test(p.step) })?.url || null,
    requiredFields: requiredFields,
    editorSelectors: editorSelectors,
    discardResult: discardResult,
    summaryPath: join(outputDir, 'epn-deep-summary.json'),
    packageEditorSelectorsPath: join(outputDir, 'epn-package-editor-selectors.json'),
    requiredFieldsPath: join(outputDir, 'epn-required-fields.json'),
    deepNavigationMapPath: join(outputDir, 'epn-deep-navigation-map.json'),
  }
}

module.exports = {
  explorePackageEditorDeep,
  collectDeepInventory,
  isDangerousAction,
  extractPackIdFromUrl,
  resolveEpnUrl,
  buildRequiredFieldsReport,
}
