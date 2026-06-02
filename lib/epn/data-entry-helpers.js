// lib/epn/data-entry-helpers.js
// Shared ePN data entry wizard helpers

function slugify(value) {
  return String(value || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
}

async function waitForDocumentTypeDropdown(page) {
  await dismissInactivityWarning(page)

  await page.waitForFunction(function() {
    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    var dropdown = document.querySelector('.doctype-dropdown, kendo-dropdownlist.doctype-dropdown')
    if (dropdown && visible(dropdown)) return true

    var inner = document.querySelector('.doctype-dropdown .k-input-inner, kendo-dropdownlist.doctype-dropdown .k-input-inner')
    return !!(inner && visible(inner) && /select type/i.test((inner.textContent || '').trim()))
  }, { timeout: 45000 }).catch(function() {})

  await dismissInactivityWarning(page)
  await page.waitForTimeout(400)
}

async function openDocumentTypeDropdown(page) {
  await waitForDocumentTypeDropdown(page)

  var strategies = [
    page.locator('.doctype-dropdown .k-input-inner').filter({ hasText: /select type/i }).first(),
    page.locator('.doctype-dropdown.k-dropdownlist').first(),
    page.locator('kendo-dropdownlist.doctype-dropdown').first(),
    page.locator('.doctype-dropdown').first(),
    page.locator('.doctype-dropdown, [class*="doctype"], .k-dropdownlist').filter({ hasText: /select type/i }).first(),
  ]

  for (var i = 0; i < strategies.length; i++) {
    var dropdown = strategies[i]
    if (await dropdown.count() === 0) continue

    await dropdown.scrollIntoViewIfNeeded().catch(function() {})
    await dropdown.click({ timeout: 8000 })
    await page.waitForTimeout(1500)

    var listOpened = await page.locator('.k-list-ul, .k-list-container, [role="listbox"]').first().isVisible().catch(function() { return false })
    if (listOpened) return true

    var currentValue = await page.locator('.doctype-dropdown .k-input-inner, kendo-dropdownlist.doctype-dropdown .k-input-inner').first().textContent().catch(function() { return '' })
    if (currentValue && !/select type/i.test(String(currentValue).trim())) return true
  }

  var selectBtn = page.locator('button').filter({ hasText: /^select$/i }).first()
  if (await selectBtn.count() > 0) {
    await selectBtn.click()
    await page.waitForTimeout(1500)
    return true
  }

  return false
}

async function selectDocumentType(page, typeName) {
  var opened = await openDocumentTypeDropdown(page)
  if (!opened) return { selected: false, reason: 'Could not open document type dropdown' }

  await page.locator('.k-list-ul, .k-list-container, [role="listbox"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(function() {})

  var escaped = typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  var exactPattern = new RegExp('^\\s*' + escaped + '\\s*$', 'i')
  var loosePattern = new RegExp(escaped, 'i')

  var optionStrategies = [
    page.getByRole('option', { name: exactPattern }).first(),
    page.getByRole('option', { name: loosePattern }).first(),
    page.locator('.k-list-item, .k-item, .k-list-ul li, [role="option"]').filter({ hasText: exactPattern }).first(),
    page.locator('.k-list-item, .k-item, .k-list-ul li, [role="option"]').filter({ hasText: loosePattern }).first(),
  ]

  var option = null
  for (var j = 0; j < optionStrategies.length; j++) {
    if (await optionStrategies[j].count() > 0) {
      option = optionStrategies[j]
      break
    }
  }

  if (!option) {
    await page.keyboard.press('Escape').catch(function() {})
    return { selected: false, reason: 'Document type option not found: ' + typeName }
  }

  await option.click()
  await page.waitForTimeout(3000)

  var selectedValue = await page.locator('.doctype-dropdown .k-input-inner, kendo-dropdownlist.doctype-dropdown .k-input-inner').first().textContent().catch(function() { return '' })
  if (selectedValue && loosePattern.test(String(selectedValue).trim())) {
    return { selected: true, documentType: typeName }
  }

  return { selected: true, documentType: typeName }
}

async function clickWizardTab(page, tabSelector) {
  var tab = await page.$(tabSelector)
  if (!tab) return false
  await tab.click()
  await page.waitForTimeout(2200)
  return true
}

async function collectMetadataInventory(page) {
  return page.evaluate(function() {
    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    function selectorFor(el) {
      if (el.id) return '#' + CSS.escape(el.id)
      if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name.replace(/"/g, '\\"') + '"]'
      if (el.getAttribute('data-field')) return '[data-field="' + el.getAttribute('data-field') + '"]'
      return el.tagName.toLowerCase()
    }

    function labelFor(el) {
      if (el.id) {
        var byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
        if (byFor) return (byFor.textContent || '').replace(/\s+/g, ' ').trim()
      }
      var parentLabel = el.closest('label')
      if (parentLabel) return (parentLabel.textContent || '').replace(/\s+/g, ' ').trim()

      var fieldGroup = el.closest('.form-group, .field-group, .k-form-field, tr, .row, .index-field, [class*="field"]')
      if (fieldGroup) {
        var legend = fieldGroup.querySelector('label, .control-label, .field-label, th, h3, h4, span.label')
        if (legend) return (legend.textContent || '').replace(/\s+/g, ' ').trim()
      }
      return null
    }

    function nearbyText(el) {
      var parent = el.closest('.form-group, .field-group, .k-form-field, tr, .row, div')
      if (!parent) return null
      return (parent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    }

    var allInputs = Array.from(document.querySelectorAll('input, select, textarea, [contenteditable="true"], .k-input-inner, .k-dropdownlist'))
    var fields = allInputs.map(function(el) {
      var tag = el.tagName ? el.tagName.toLowerCase() : 'div'
      var type = (el.getAttribute && el.getAttribute('type')) || tag
      if (type === 'hidden') return null

      var label = labelFor(el)
      var nearby = nearbyText(el)
      var labelText = [label, el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), nearby].filter(Boolean).join(' ')

      return {
        selector: selectorFor(el),
        tag: tag,
        type: String(type).toLowerCase(),
        name: el.getAttribute ? el.getAttribute('name') : null,
        id: el.id || null,
        placeholder: el.getAttribute ? el.getAttribute('placeholder') : null,
        label: label,
        ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
        className: el.className || null,
        value: el.value ? String(el.value).slice(0, 120) : ((el.textContent || '').trim().slice(0, 120) || null),
        required: !!(el.required || el.getAttribute('aria-required') === 'true'),
        visible: visible(el),
        labelText: labelText,
      }
    }).filter(Boolean)

    var fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(function(el) {
      return {
        selector: selectorFor(el),
        name: el.getAttribute('name'),
        id: el.id || null,
        accept: el.getAttribute('accept'),
        visible: visible(el),
        hidden: !visible(el),
        label: labelFor(el),
      }
    })

    var selects = Array.from(document.querySelectorAll('select')).filter(visible).map(function(el) {
      return {
        selector: selectorFor(el),
        label: labelFor(el),
        options: Array.from(el.options || []).map(function(opt) {
          return { value: opt.value, text: (opt.textContent || '').trim() }
        }).slice(0, 80),
      }
    })

    var kendoDropdowns = Array.from(document.querySelectorAll('.k-dropdownlist, .doctype-dropdown')).filter(visible).map(function(el) {
      return {
        selector: selectorFor(el),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        className: el.className,
      }
    })

    var validationMessages = Array.from(document.querySelectorAll(
      '.validation-message, .field-validation-error, .error, .alert, .alert-danger, .text-danger, [class*="invalid"], [role="alert"], .k-form-error'
    )).filter(visible).map(function(el) {
      return {
        selector: selectorFor(el),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        className: el.className,
      }
    })

    var headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, legend, .section-title, .panel-title')).map(function(el) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim()
    }).filter(Boolean)

    var controls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a')).filter(visible).map(function(el) {
      var text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      if (!text) return null
      return {
        selector: selectorFor(el),
        text: text.slice(0, 120),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || null,
        id: el.id || null,
        dangerous: /^(submit|send|record|finalize|pay|confirm)$/i.test(text) || /submit|record now|pay now/i.test(text),
      }
    }).filter(Boolean)

    return {
      url: location.href,
      title: document.title,
      headings: headings,
      fields: fields,
      fileInputs: fileInputs,
      selects: selects,
      kendoDropdowns: kendoDropdowns,
      validationMessages: validationMessages,
      controls: controls,
      bodyTextSample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
    }
  })
}

function categorizeMetadataFields(fields) {
  function bucket(list, test) {
    return list.filter(function(f) { return test(f.labelText || '') })
  }

  var all = fields || []
  var matched = new Set()

  function take(name, test) {
    var items = bucket(all, test)
    items.forEach(function(f) { matched.add(f.selector + '|' + f.labelText) })
    return items
  }

  var categorized = {
    document_name: take('document_name', function(t) { return /document name|doc name|instrument name/i.test(t) }),
    parcel_apn: take('parcel_apn', function(t) { return /parcel|apn|folio|tax id|property id|pin/i.test(t) }),
    grantor: take('grantor', function(t) { return /grantor/i.test(t) }),
    grantee: take('grantee', function(t) { return /grantee/i.test(t) }),
    recording_party: take('recording_party', function(t) { return /recording party|submitter|preparer|party/i.test(t) && !/grantor|grantee/i.test(t) }),
    return_info: take('return_info', function(t) { return /return|mail|recipient|email|address/i.test(t) }),
    consideration_fees: take('consideration_fees', function(t) { return /consideration|fee|amount|cost|tax|payment|total/i.test(t) }),
    page_count: take('page_count', function(t) { return /page count|pages|number of pages|# pages/i.test(t) }),
    legal_description: take('legal_description', function(t) { return /legal description|legal desc|description/i.test(t) && !/document name/i.test(t) }),
    indexing_other: [],
  }

  all.forEach(function(f) {
    var key = f.selector + '|' + f.labelText
    if (!matched.has(key)) categorized.indexing_other.push(f)
  })

  return categorized
}

async function scrollIndexingPanel(page) {
  await page.evaluate(function() {
    var selectors = [
      '.indexing-panel', '.sidebar', '.left-panel', '.document-info',
      '.document-editor', '[class*="sidebar"]', '[class*="index"]', 'aside',
    ]
    selectors.forEach(function(sel) {
      Array.from(document.querySelectorAll(sel)).forEach(function(el) {
        el.scrollTop = el.scrollHeight
      })
    })
    window.scrollTo(0, document.body.scrollHeight)
  })
  await page.waitForTimeout(800)
}

async function dismissInactivityWarning(page) {
  await page.evaluate(function() {
    var text = document.body ? document.body.innerText || '' : ''
    if (!/inactivity warning/i.test(text)) return
    var links = Array.from(document.querySelectorAll('a, button, span'))
    var cancel = links.find(function(el) {
      return /click here to cancel/i.test(el.textContent || '')
    })
    if (cancel) cancel.click()
  }).catch(function() {})
  await page.waitForTimeout(400)
}

async function fillMinimumIndexingFields(page, options) {
  var opts = options || {}
  var grantorName = opts.grantorName || 'Test Owner'
  var granteeName = opts.granteeName || 'GAETANO HOME SERVICES'

  await clickWizardTab(page, '#indexing-status')
  await page.waitForTimeout(1200)
  await dismissInactivityWarning(page)

  var grantorPerson = page.locator('[id="Grantor (Owner/Lessee)-person-0"]')
  if (await grantorPerson.count() > 0) {
    await grantorPerson.click()
    await page.waitForTimeout(400)
  }

  var granteeCompany = page.locator('[id="Grantee (Contractor)-company-1"]')
  if (await granteeCompany.count() > 0) {
    await granteeCompany.click()
    await page.waitForTimeout(400)
  } else {
    var granteePerson = page.locator('[id="Grantee (Contractor)-person-1"]')
    if (await granteePerson.count() > 0) await granteePerson.click()
  }

  var grantorFilled = false
  var granteeFilled = false

  var grantorSection = page.locator('#\\30, .parent.invalid').filter({ hasText: /Grantor \(Owner\/Lessee\)/ }).first()
  if (await grantorSection.count() === 0) {
    grantorSection = page.locator('.parent').filter({ hasText: /^Grantor \(Owner\/Lessee\)/ }).first()
  }
  var grantorInput = grantorSection.locator('.k-input-inner, input[type="text"]').first()
  if (await grantorInput.count() > 0) {
    await grantorInput.click()
    await grantorInput.fill(grantorName)
    grantorFilled = true
  }

  var granteeSection = page.locator('#\\31, .parent.invalid').filter({ hasText: /Grantee \(Contractor\)/ }).first()
  if (await granteeSection.count() === 0) {
    granteeSection = page.locator('.parent').filter({ hasText: /^Grantee \(Contractor\)/ }).first()
  }
  var granteeInput = granteeSection.locator('.k-input-inner, input[type="text"]').first()
  if (await granteeInput.count() > 0) {
    var existing = await granteeInput.inputValue().catch(function() { return '' })
    if (!existing || !String(existing).trim()) {
      await granteeInput.click()
      await granteeInput.fill(granteeName)
    }
    granteeFilled = true
  }

  await page.waitForTimeout(1000)

  var values = await page.evaluate(function() {
    function sectionValue(id, label) {
      var section = document.getElementById(id)
      if (!section) {
        section = Array.from(document.querySelectorAll('.parent')).find(function(el) {
          return (el.textContent || '').indexOf(label) === 0 || (el.textContent || '').trim().indexOf(label) === 0
        })
      }
      if (!section) return null
      var input = section.querySelector('.k-input-inner, input[type="text"]')
      return input ? input.value : null
    }
    return {
      grantor: sectionValue('0', 'Grantor (Owner/Lessee)'),
      grantee: sectionValue('1', 'Grantee (Contractor)'),
    }
  })

  return {
    success: grantorFilled && granteeFilled,
    grantorFilled: grantorFilled,
    granteeFilled: granteeFilled,
    grantorName: grantorName,
    granteeName: values.grantee || granteeName,
    values: values,
  }
}

function partySectionLocator(page, sectionId) {
  return page.locator('[id="' + sectionId + '"]').first()
}

async function clickPartyAddButton(page, sectionId) {
  var section = partySectionLocator(page, sectionId)
  var addInSection = section.locator('button.add, button.clone.add, button.btn-info.add').filter({ hasText: /^add$/i })
  if (await addInSection.count() > 0) {
    await addInSection.first().click()
    return { method: 'section_scoped', index: null }
  }

  var parent = section.locator('xpath=ancestor-or-self::*[1]/..')
  var addInParent = parent.locator('button.add, button.clone.add').filter({ hasText: /^add$/i })
  if (await addInParent.count() > 0) {
    await addInParent.first().click()
    return { method: 'parent_scoped', index: null }
  }

  var index = sectionId === '0' ? 0 : 1
  var globalAdd = page.locator('button.clone.add, button.add.btn-info').filter({ hasText: /^add$/i }).nth(index)
  if (await globalAdd.count() > 0) {
    await globalAdd.scrollIntoViewIfNeeded().catch(function() {})
    await globalAdd.click()
    return { method: 'global_index_' + index, index: index }
  }

  var clicked = await page.evaluate(function(id) {
    var section = document.getElementById(id)
    if (!section) return { clicked: false, reason: 'section not found' }

    function findAdd(scope) {
      if (!scope) return null
      var btn = scope.querySelector('button.add, button.clone.add, button.btn-info.add')
      if (btn && /^add$/i.test((btn.textContent || '').trim())) return btn
      return null
    }

    var node = section
    for (var depth = 0; depth < 4 && node; depth++) {
      var addBtn = findAdd(node)
      if (addBtn) {
        addBtn.click()
        return { clicked: true, method: 'evaluate_depth_' + depth }
      }
      node = node.parentElement
    }

    var adds = Array.from(document.querySelectorAll('button.add, button.clone.add, button.btn-info.add'))
      .filter(function(btn) { return /^add$/i.test((btn.textContent || '').trim()) })
    var idx = id === '0' ? 0 : 1
    if (adds[idx]) {
      adds[idx].click()
      return { clicked: true, method: 'evaluate_global_' + idx }
    }
    return { clicked: false, reason: 'no add button found', addCount: adds.length }
  }, sectionId)

  if (!clicked || !clicked.clicked) {
    return { method: null, error: clicked && clicked.reason, detail: clicked }
  }
  return { method: clicked.method, index: sectionId === '0' ? 0 : 1 }
}

async function collectPartySectionState(page, sectionId) {
  return page.evaluate(function(id) {
    var section = document.getElementById(id)
    if (!section) return { found: false, sectionId: id, entries: [], invalid: null }

    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    var entries = []
    var seen = new Set()
    var nodes = Array.from(section.querySelectorAll('ul li, ol li, .chip, .tag, .party-row, .list-group-item, table tr, .name-list li, .added-name, [class*="party"]'))
    nodes.forEach(function(node) {
      var text = (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || text.length < 2) return
      if (/^(person|company|add)$/i.test(text)) return
      if (/person company add/i.test(text)) return
      if (seen.has(text)) return
      seen.add(text)
      if (visible(node)) {
        entries.push({
          text: text.slice(0, 120),
          tag: node.tagName.toLowerCase(),
          className: node.className || null,
        })
      }
    })

    var radios = Array.from(section.querySelectorAll('input[type="radio"]')).map(function(r) {
      return {
        id: r.id || null,
        value: r.value || null,
        checked: r.checked,
        label: r.labels && r.labels[0] ? (r.labels[0].textContent || '').trim() : null,
      }
    })

    var input = section.querySelector('.k-input-inner, input[type="text"]')
    return {
      found: true,
      sectionId: id,
      invalid: /\binvalid\b/i.test(section.className || ''),
      heading: (section.querySelector('h3, h4, h5, label') || {}).textContent
        ? (section.querySelector('h3, h4, h5, label').textContent || '').replace(/\s+/g, ' ').trim()
        : null,
      inputValue: input ? String(input.value || '').trim() : null,
      radios: radios,
      entries: entries,
      entryCount: entries.length,
      hasList: !!section.querySelector('ul li, ol li, table tr'),
    }
  }, sectionId)
}

async function commitPartySection(page, sectionId, options) {
  var opts = options || {}
  var name = opts.name
  var radioType = opts.radioType || 'person'
  var partyLabel = opts.partyLabel || (sectionId === '0' ? 'Grantor' : 'Grantee')

  await clickWizardTab(page, '#indexing-status')
  await page.waitForTimeout(800)
  await dismissInactivityWarning(page)

  var section = partySectionLocator(page, sectionId)
  if (await section.count() === 0) {
    return { success: false, sectionId: sectionId, partyLabel: partyLabel, reason: 'Party section not found: #' + sectionId }
  }

  var beforeState = await collectPartySectionState(page, sectionId)

  if (sectionId === '0') {
    var grantorRadio = radioType === 'company'
      ? page.locator('[id="Grantor (Owner/Lessee)-company-0"]')
      : page.locator('[id="Grantor (Owner/Lessee)-person-0"]')
    if (await grantorRadio.count() > 0) {
      await grantorRadio.click()
      await page.waitForTimeout(400)
    }
  } else {
    var granteeRadio = radioType === 'company'
      ? page.locator('[id="Grantee (Contractor)-company-1"]')
      : page.locator('[id="Grantee (Contractor)-person-1"]')
    if (await granteeRadio.count() > 0) {
      await granteeRadio.click()
      await page.waitForTimeout(400)
    }
  }

  var input = section.locator('.k-input-inner, input[type="text"]').first()
  if (await input.count() === 0) {
    return { success: false, sectionId: sectionId, partyLabel: partyLabel, reason: 'Party name input not found in section #' + sectionId }
  }

  await input.click()
  await input.fill(name)
  await page.waitForTimeout(500)

  var addClick = await clickPartyAddButton(page, sectionId)
  if (!addClick || !addClick.method) {
    return {
      success: false,
      sectionId: sectionId,
      partyLabel: partyLabel,
      reason: 'Add button not found in section #' + sectionId,
      addClick: addClick,
      beforeState: beforeState,
    }
  }

  await page.waitForTimeout(2000)

  var afterState = await collectPartySectionState(page, sectionId)
  var entryAdded = afterState.entryCount > beforeState.entryCount ||
    afterState.entries.some(function(e) { return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(e.text) })
  var invalidCleared = beforeState.invalid && !afterState.invalid
  var stillInvalid = !!afterState.invalid

  return {
    success: entryAdded || invalidCleared || (!stillInvalid && afterState.entryCount > 0),
    sectionId: sectionId,
    partyLabel: partyLabel,
    name: name,
    radioType: radioType,
    addClicked: true,
    addClickMethod: addClick.method,
    entryAdded: entryAdded,
    invalidCleared: invalidCleared,
    stillInvalid: stillInvalid,
    beforeState: beforeState,
    afterState: afterState,
  }
}

async function fillAndCommitParties(page, options) {
  var opts = options || {}
  var grantorResult = await commitPartySection(page, '0', {
    name: opts.grantorName || 'Test Owner',
    radioType: opts.grantorRadio || 'person',
    partyLabel: 'Grantor (Owner/Lessee)',
  })
  var granteeResult = await commitPartySection(page, '1', {
    name: opts.granteeName || 'GAETANO HOME SERVICES',
    radioType: opts.granteeRadio || 'company',
    partyLabel: 'Grantee (Contractor)',
  })

  return {
    success: grantorResult.success && granteeResult.success,
    grantor: grantorResult,
    grantee: granteeResult,
    partyRowsAppeared: (grantorResult.afterState && grantorResult.afterState.entryCount > 0) ||
      (granteeResult.afterState && granteeResult.afterState.entryCount > 0) ||
      grantorResult.entryAdded || granteeResult.entryAdded,
  }
}

async function extractDocumentRowStatus(page) {
  return page.evaluate(function() {
    var text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    var docRowMatch = text.match(/Document 1[^]*?(Data Entry Incomplete|Complete|Ready|Valid|Indexed|Pending Review|Rejected)/i)
    var rows = Array.from(document.querySelectorAll('tr, [role="row"], .ag-row')).filter(function(row) {
      return /document 1/i.test(row.textContent || '')
    })

    var rowDetails = rows.map(function(row) {
      var cells = Array.from(row.querySelectorAll('td, [role="gridcell"], .ag-cell')).map(function(cell) {
        return (cell.textContent || '').replace(/\s+/g, ' ').trim()
      }).filter(Boolean)
      return {
        text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        cells: cells,
      }
    })

    var statusGuess = null
    if (/data entry incomplete/i.test(text)) statusGuess = 'Data Entry Incomplete'
    else if (/data entry complete/i.test(text)) statusGuess = 'Data Entry Complete'
    else if (/\bready\b/i.test(text)) statusGuess = 'Ready'
    else if (/\bvalid\b/i.test(text)) statusGuess = 'Valid'
    else if (docRowMatch) statusGuess = docRowMatch[1]

    return {
      url: location.href,
      documentStatus: statusGuess,
      docRowMatch: docRowMatch ? docRowMatch[1] : null,
      rowDetails: rowDetails,
      bodySample: text.slice(0, 1800),
    }
  })
}

async function collectSubmitButtonInventory(page) {
  return page.evaluate(function() {
    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    function normalizedText(el) {
      return (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
    }

    var nodes = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, span.btn, div.btn, #save-button, #NextButton'))
    var all = nodes.filter(visible).map(function(el) {
      var text = normalizedText(el)
      if (!text) return null
      var isSubmitLike = /\b(submit|send package|record now|record|finalize|pay now|e-?record)\b/i.test(text) &&
        !/send us feedback|email notification/i.test(text)
      var isReadyLike = /ready|mark package as completed|complete package/i.test(text)
      var isPackageNameLink = /AHJ-IQ TEST DO NOT SUBMIT/i.test(text)
      return {
        selector: el.id ? ('#' + el.id) : el.tagName.toLowerCase(),
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 120),
        className: el.className || null,
        submitLike: isSubmitLike && !isPackageNameLink,
        readyLike: isReadyLike,
        dangerous: isSubmitLike && !isPackageNameLink,
      }
    }).filter(Boolean)

    return {
      submitLike: all.filter(function(b) { return b.submitLike }),
      readyLike: all.filter(function(b) { return b.readyLike }),
      safe: all.filter(function(b) { return !b.submitLike && !b.readyLike }),
      hasSubmitButton: all.some(function(b) { return b.submitLike }),
      hasReadyButton: all.some(function(b) { return b.readyLike }),
      all: all,
    }
  })
}

async function clickSaveButton(page) {
  await dismissInactivityWarning(page)

  await page.evaluate(function() {
    window.scrollTo(0, document.body.scrollHeight)
    var footer = document.querySelector('.footer, .toolbar, .btn-toolbar, .action-bar, .bottom-bar')
    if (footer) footer.scrollIntoView({ block: 'end' })
  })
  await page.waitForTimeout(600)

  var beforeText = await page.evaluate(function() {
    return (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800)
  })

  var strategies = [
    page.locator('#save-button'),
    page.locator('xpath=//*[normalize-space(.)="Save" and (self::button or self::a or self::input or contains(@class,"btn"))]'),
    page.getByRole('button', { name: 'Save', exact: true }),
    page.locator('button.btn-primary').filter({ hasText: /^save$/i }),
    page.locator('button').filter({ hasText: /^save$/i }),
    page.locator('a.btn, div.btn, span.btn, input.btn').filter({ hasText: /^save$/i }),
    page.locator('[class*="btn-primary"], [class*="btn-save"]').filter({ hasText: /^save$/i }),
    page.locator('.btn-toolbar button, .toolbar button, .footer button, .footer a, .footer div.btn').filter({ hasText: /^save$/i }),
  ]

  var saveBtn = null
  var clickMethod = null
  var clickTarget = null
  for (var i = 0; i < strategies.length; i++) {
    var candidate = strategies[i].first()
    if (await candidate.count() > 0) {
      saveBtn = candidate
      clickMethod = 'locator_' + i
      break
    }
  }

  if (!saveBtn) {
    var clicked = await page.evaluate(function() {
      function normalizedText(el) {
        return (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      }

      function isVisible(el) {
        var rect = el.getBoundingClientRect()
        var style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
      }

      var selectors = 'button, input[type="button"], input[type="submit"], a, div.btn, span.btn, li.btn, [class*="btn-primary"], [class*="btn-save"], [ng-click*="save"], [onclick*="save"]'
      var nodes = Array.from(document.querySelectorAll(selectors))
      var save = nodes.find(function(el) {
        if (!isVisible(el)) return false
        var text = normalizedText(el)
        if (!/^save$/i.test(text) && !/\bsave\b/i.test(text)) return false
        if (text.length > 20) return false
        if (/submit|record|send|finalize|pay/i.test(text)) return false
        return true
      })

      if (!save) {
        var debug = nodes.filter(isVisible).map(function(el) {
          return { tag: el.tagName, className: el.className || null, text: normalizedText(el).slice(0, 40), id: el.id || null }
        }).filter(function(item) { return /save|add doc|cancel/i.test(item.text) })
        return { found: false, debug: debug.slice(0, 20) }
      }

      save.click()
      return {
        found: true,
        tag: save.tagName,
        className: save.className || null,
        text: normalizedText(save),
        id: save.id || null,
      }
    })
    if (!clicked || !clicked.found) {
      return { success: false, reason: 'Save button not found', debug: clicked && clicked.debug }
    }
    clickMethod = 'evaluate_clickable'
    clickTarget = clicked
    await page.waitForTimeout(3000)
  } else {
    await saveBtn.scrollIntoViewIfNeeded().catch(function() {})
    await saveBtn.click()
    clickMethod = clickMethod || 'locator'
    await page.waitForTimeout(3000)
  }

  await page.waitForFunction(function() {
    var text = document.body ? document.body.innerText || '' : ''
    return /saved|success|complete|ready|updated/i.test(text) || text.length > 0
  }, { timeout: 15000 }).catch(function() {})

  await page.waitForTimeout(2000)

  var afterText = await page.evaluate(function() {
    return (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
  })

  return {
    success: true,
    clickMethod: clickMethod,
    clickTarget: clickTarget,
    beforeText: beforeText,
    afterText: afterText,
    changed: beforeText !== afterText,
  }
}

async function extractPackageStatus(page) {
  return page.evaluate(function() {
    var text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    var feeMatch = text.match(/Estimated Fees:\s*\$[\d,.]+/i)
    var statusMatch = text.match(/\b(Preparing|Ready|Pending|Rejected|Recorded|Empty|Draft)\b/i)
    return {
      url: location.href,
      title: document.title,
      feeSummary: feeMatch ? feeMatch[0] : null,
      statusGuess: statusMatch ? statusMatch[1] : null,
      bodySample: text.slice(0, 1500),
    }
  })
}

async function uploadDocumentPdf(page, pdfPath) {
  return uploadDummyPdf(page, pdfPath)
}

async function uploadDummyPdf(page, pdfPath) {
  var openFileBtn = page.locator('button').filter({ hasText: /^open file$/i }).first()
  if (await openFileBtn.count() === 0) {
    return { success: false, reason: 'Open File button not found' }
  }

  try {
    var fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 })
    await openFileBtn.click()
    var fileChooser = await fileChooserPromise
    await fileChooser.setFiles(pdfPath)

    await page.waitForFunction(function() {
      var text = document.body ? document.body.innerText || '' : ''
      var hasCanvas = !!document.querySelector('canvas')
      var hasImageTab = /main image/i.test(text)
      var hasPages = /page/i.test(text) && /1\s*page|pages?\s*:/i.test(text)
      return hasCanvas || hasImageTab || hasPages || /pdf|uploaded|image loaded/i.test(text)
    }, { timeout: 60000 }).catch(function() {})

    await page.waitForTimeout(4000)

    var uploadState = await page.evaluate(function() {
      return {
        bodySample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        hasCanvas: !!document.querySelector('canvas'),
        fileInputCount: document.querySelectorAll('input[type="file"]').length,
      }
    })

    return {
      success: true,
      pdfPath: pdfPath,
      uploadState: uploadState,
    }
  } catch (err) {
    return { success: false, reason: err.message }
  }
}

async function scrollAllPanels(page) {
  await scrollIndexingPanel(page)
  await page.evaluate(function() {
    var selectors = [
      '.main-content', '.content', '.panel-body', '.tab-content', '.wizard',
      '.document-viewer', '.image-panel', '.right-panel', '[class*="scroll"]',
      'main', 'section', '.k-tabstrip-content', '.k-content',
    ]
    selectors.forEach(function(sel) {
      Array.from(document.querySelectorAll(sel)).forEach(function(el) {
        el.scrollTop = el.scrollHeight
        el.scrollLeft = el.scrollWidth
      })
    })
    window.scrollTo(0, 0)
    window.scrollTo(0, document.body.scrollHeight)
  })
  await page.waitForTimeout(1000)
  await scrollIndexingPanel(page)
}

async function openDocumentOneFromPackageView(page, packId) {
  await dismissInactivityWarning(page)
  await page.waitForTimeout(1500)

  var beforeUrl = page.url()
  var strategies = [
    page.locator('a').filter({ hasText: /^document 1$/i }).first(),
    page.locator('a[href*="DataEntry"], a[href*="dataentry"]').filter({ hasText: /document 1/i }).first(),
    page.locator('tr, [role="row"]').filter({ hasText: /document 1/i }).locator('a').first(),
  ]

  for (var i = 0; i < strategies.length; i++) {
    var link = strategies[i]
    if (await link.count() > 0) {
      await link.click()
      await page.waitForTimeout(3500)
      var afterUrl = page.url()
      if (/DataEntry|dataentry/i.test(afterUrl) || afterUrl !== beforeUrl) {
        return { success: true, method: 'click_document_1_link_' + i, url: afterUrl }
      }
    }
  }

  if (packId) {
    var directUrl = 'https://ep.erecording.com/L2/DataEntry/Index?packId=' + packId
    await page.goto(directUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    if (/DataEntry|dataentry/i.test(page.url())) {
      return { success: true, method: 'direct_data_entry_url', url: page.url() }
    }
  }

  return { success: false, reason: 'Could not open Document 1 from package view', url: page.url() }
}

async function collectDeepFieldInventory(page) {
  var base = await collectMetadataInventory(page)
  var deep = await page.evaluate(function() {
    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    function selectorFor(el) {
      if (el.id) return '#' + CSS.escape(el.id)
      return el.tagName.toLowerCase()
    }

    var sections = Array.from(document.querySelectorAll('.parent, .form-group, .index-field, section, fieldset')).map(function(el) {
      var heading = (el.querySelector('h3, h4, h5, label, legend, .section-title') || {}).textContent || ''
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)
      var inputs = Array.from(el.querySelectorAll('input, select, textarea, .k-input-inner')).map(function(input) {
        return {
          selector: selectorFor(input),
          type: input.type || input.tagName.toLowerCase(),
          value: input.value ? String(input.value).slice(0, 120) : ((input.textContent || '').trim().slice(0, 120) || null),
          visible: visible(input),
        }
      })
      return {
        selector: selectorFor(el),
        id: el.id || null,
        className: el.className || null,
        heading: heading.replace(/\s+/g, ' ').trim(),
        text: text,
        invalid: /\binvalid\b/i.test(el.className || ''),
        visible: visible(el),
        inputs: inputs,
      }
    }).filter(function(s) { return s.text && s.visible })

    var invalidSections = sections.filter(function(s) { return s.invalid })
    var tabs = Array.from(document.querySelectorAll('#indexing-status, #image-status, .wizard-tab, .nav-tabs a, .k-tabstrip-item, [role="tab"]')).map(function(el) {
      return {
        selector: selectorFor(el),
        id: el.id || null,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        className: el.className || null,
        active: /\bactive\b|\bselected\b|\bcurrent\b/i.test(el.className || '') || el.getAttribute('aria-selected') === 'true',
        visible: visible(el),
      }
    }).filter(function(t) { return t.text || t.id })

    var hiddenFields = Array.from(document.querySelectorAll('input, select, textarea')).filter(function(el) {
      return el.type !== 'hidden' && !visible(el)
    }).map(function(el) {
      return {
        selector: selectorFor(el),
        id: el.id || null,
        name: el.name || null,
        type: el.type || el.tagName.toLowerCase(),
        value: el.value ? String(el.value).slice(0, 120) : null,
        className: el.className || null,
      }
    })

    var emptyVisibleInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea, .k-input-inner')).filter(function(el) {
      if (!visible(el)) return false
      var val = el.value != null ? String(el.value).trim() : String(el.textContent || '').trim()
      return !val
    }).map(function(el) {
      var parent = el.closest('.parent, .form-group, div')
      return {
        selector: selectorFor(el),
        id: el.id || null,
        placeholder: el.placeholder || null,
        parentText: parent ? (parent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null,
        className: el.className || null,
      }
    })

    var allClickables = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, div.btn, span.btn, li.modal-button, [class*="btn"]')).filter(visible).map(function(el) {
      var text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      if (!text) return null
      return {
        selector: selectorFor(el),
        text: text.slice(0, 120),
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        dangerous: /submit|send|record|finalize|pay now|confirm/i.test(text),
        readyLike: /ready|complete|finish|mark package|send package/i.test(text),
      }
    }).filter(Boolean)

    var bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    var statusMatches = {
      dataEntryIncomplete: /data entry incomplete/i.test(bodyText),
      preparing: /\bpreparing\b/i.test(bodyText),
      ready: /\bready\b/i.test(bodyText),
      draft: /\bdraft\b/i.test(bodyText),
    }

    return {
      sections: sections,
      invalidSections: invalidSections,
      tabs: tabs,
      hiddenFields: hiddenFields,
      emptyVisibleInputs: emptyVisibleInputs,
      allClickables: allClickables,
      statusMatches: statusMatches,
      pageControls: Array.from(document.querySelectorAll('[class*="page"], .page-count, .thumbnail')).filter(visible).slice(0, 20).map(function(el) {
        return {
          selector: selectorFor(el),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          className: el.className || null,
        }
      }),
    }
  })

  return Object.assign({}, base, deep)
}

function analyzeIncompleteFields(inventory) {
  var reasons = []
  ;(inventory.invalidSections || []).forEach(function(section) {
    reasons.push({
      type: 'invalid_section',
      selector: section.selector,
      id: section.id,
      heading: section.heading,
      text: section.text,
      inputs: section.inputs,
    })
  })

  ;(inventory.emptyVisibleInputs || []).forEach(function(field) {
    if (/grantor|grantee|document name|parcel|apn|legal|return|mail|address|consideration|page/i.test(field.parentText || field.placeholder || '')) {
      reasons.push({
        type: 'empty_visible_input',
        selector: field.selector,
        id: field.id,
        placeholder: field.placeholder,
        parentText: field.parentText,
      })
    }
  })

  ;(inventory.validationMessages || []).forEach(function(msg) {
    if (/invalid|required|error|must|missing|incomplete/i.test(msg.text || '') || /\binvalid\b/i.test(msg.className || '')) {
      reasons.push({
        type: 'validation_message',
        selector: msg.selector,
        text: msg.text,
        className: msg.className,
      })
    }
  })

  if (inventory.statusMatches && inventory.statusMatches.dataEntryIncomplete) {
    reasons.push({
      type: 'status_text',
      text: 'Data Entry Incomplete',
    })
  }

  var submitReadyButtons = (inventory.allClickables || []).filter(function(btn) {
    return btn.dangerous || btn.readyLike
  })

  return {
    incompleteReasons: reasons,
    invalidSectionCount: (inventory.invalidSections || []).length,
    emptyInputCount: (inventory.emptyVisibleInputs || []).length,
    submitReadyButtons: submitReadyButtons,
    hasSubmitButton: submitReadyButtons.some(function(b) { return b.dangerous }),
    hasReadyButton: submitReadyButtons.some(function(b) { return b.readyLike }),
  }
}

async function revealFileInputSelector(page) {
  var before = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('input[type="file"]')).map(function(el) {
      return {
        selector: el.id ? ('#' + el.id) : 'input[type="file"]',
        name: el.getAttribute('name'),
        id: el.id || null,
        accept: el.getAttribute('accept'),
      }
    })
  })

  if (before.length > 0) {
    return { clickedOpenFile: false, fileInputs: before, fileChooserTriggered: false }
  }

  var openFileBtn = page.locator('button').filter({ hasText: /^open file$/i }).first()
  if (await openFileBtn.count() === 0) {
    return { clickedOpenFile: false, fileInputs: [], fileChooserTriggered: false, reason: 'Open File button not found' }
  }

  var fileChooserTriggered = false
  var chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 }).then(function() {
    fileChooserTriggered = true
    return true
  }).catch(function() { return false })

  await openFileBtn.click({ noWaitAfter: true })
  await chooserPromise
  await page.waitForTimeout(1200)

  var after = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('input[type="file"]')).map(function(el) {
      return {
        selector: el.id ? ('#' + el.id) : 'input[type="file"]',
        name: el.getAttribute('name'),
        id: el.id || null,
        accept: el.getAttribute('accept'),
      }
    })
  })

  await page.keyboard.press('Escape').catch(function() {})

  return {
    clickedOpenFile: true,
    fileInputs: after.length ? after : before,
    fileChooserTriggered: fileChooserTriggered,
    openFileButton: 'button:has-text("Open File")',
    uploadArea: 'div.btn-group.upload',
  }
}

async function inspectSendPackageButton(page) {
  return page.evaluate(function() {
    var btn = document.querySelector('#SendPackage')
    if (!btn) return { found: false }

    var form = btn.closest('form') || btn.form
    return {
      found: true,
      id: btn.id,
      tag: btn.tagName.toLowerCase(),
      type: btn.type || null,
      text: (btn.textContent || btn.value || '').replace(/\s+/g, ' ').trim(),
      className: btn.className || null,
      disabled: !!btn.disabled,
      onclick: btn.getAttribute('onclick'),
      href: btn.getAttribute('href'),
      name: btn.name || null,
      formAction: form ? (form.action || null) : null,
      formMethod: form ? (form.method || null) : null,
      outerHTML: btn.outerHTML.slice(0, 800),
    }
  })
}

async function assessSendPackagePreClick(page) {
  var button = await inspectSendPackageButton(page)
  if (!button.found) {
    return { safeToClick: false, skipped: true, reason: 'SendPackage button not found', button: button }
  }

  var onclick = String(button.onclick || '')
  var sendDocs = /sendDocs/i.test(onclick)

  return {
    safeToClick: false,
    skipped: true,
    reason: sendDocs
      ? 'sendDocs onclick submits package immediately — NEVER click #SendPackage in inspection/dry-run'
      : '#SendPackage is forbidden in inspection/dry-run scripts',
    unsafeHints: ['one-click live submit', 'no pre-submit confirmation modal'],
    button: button,
    signals: { sendDocs: sendDocs, disabled: !!button.disabled },
  }
}

async function captureSendModal(page) {
  await page.waitForSelector('#modal, .modal.in, .modal.show, .bootbox.show, [role="dialog"]', { state: 'visible', timeout: 8000 }).catch(function() {})

  return page.evaluate(function() {
    function visible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }

    function selectorFor(el) {
      if (el.id) return '#' + CSS.escape(el.id)
      return el.tagName.toLowerCase()
    }

    function classifyButton(el) {
      var text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      var dangerous = /\b(submit|send|confirm|authorize|pay|record|finalize|yes)\b/i.test(text) &&
        !/\b(cancel|close|no|back)\b/i.test(text)
      var safe = /\b(cancel|close|no|back)\b/i.test(text)
      return { text: text, dangerous: dangerous, safe: safe }
    }

    var modal = document.querySelector('#modal, .modal.in, .modal.show, .bootbox.show, [role="dialog"]')
    if (!modal || !visible(modal)) {
      return { captured: false, reason: 'No visible modal/dialog found' }
    }

    var buttons = Array.from(modal.querySelectorAll('button, input[type="button"], input[type="submit"], a, li.modal-button, .btn')).map(function(node) {
      var cls = classifyButton(node)
      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || null,
        className: node.className || null,
        text: cls.text,
        value: node.value || null,
        selector: node.id ? ('#' + CSS.escape(node.id)) : null,
        dangerous: cls.dangerous,
        safe: cls.safe,
      }
    }).filter(function(item) { return item.text || item.value })

    var text = (modal.textContent || '').replace(/\s+/g, ' ').trim()
    var feeMatch = text.match(/(?:total|estimated)\s*fees?\s*:?\s*\$[\d,.]+/i)
    var paymentMatch = text.match(/(?:payment|authorize|credit card|billing|charge)[^.]{0,120}/i)

    return {
      captured: true,
      html: modal.outerHTML,
      title: (modal.querySelector('h1, h2, h3, h4, h5, .modal-title') || {}).textContent
        ? (modal.querySelector('h1, h2, h3, h4, h5, .modal-title').textContent || '').replace(/\s+/g, ' ').trim()
        : null,
      bodyText: text.slice(0, 3000),
      feeSummary: feeMatch ? feeMatch[0] : null,
      paymentLanguage: paymentMatch ? paymentMatch[0] : null,
      buttons: buttons,
      dangerousButtons: buttons.filter(function(b) { return b.dangerous }),
      safeButtons: buttons.filter(function(b) { return b.safe }),
      confirmButton: buttons.find(function(b) { return b.dangerous }) || null,
      cancelButton: buttons.find(function(b) { return b.safe }) || null,
    }
  })
}

async function dismissSendModal(page) {
  var strategies = [
    page.locator('#modal .modal-cancel, #modal li.modal-cancel'),
    page.locator('#modal button, #modal li.modal-button, #modal input[type="button"]').filter({ hasText: /cancel|close|no|back/i }),
    page.locator('.bootbox button, [role="dialog"] button').filter({ hasText: /cancel|close|no|back/i }),
    page.locator('#modal-close'),
  ]

  for (var i = 0; i < strategies.length; i++) {
    var btn = strategies[i].first()
    if (await btn.count() > 0) {
      await btn.click({ force: true }).catch(function() {})
      await page.waitForTimeout(1500)
      return { dismissed: true, strategy: 'locator_' + i }
    }
  }

  var dismissed = await page.evaluate(function() {
    var modal = document.querySelector('#modal, .bootbox.show, [role="dialog"]')
    if (!modal) return { dismissed: false, reason: 'no modal' }
    var buttons = Array.from(modal.querySelectorAll('button, input[type="button"], li.modal-button, a, .btn'))
    var cancel = buttons.find(function(el) {
      var text = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
      return /cancel|close|no|back/i.test(text)
    })
    if (cancel) {
      cancel.click()
      return { dismissed: true, buttonText: (cancel.textContent || cancel.value || '').trim() }
    }
    var close = modal.querySelector('#modal-close, .close, [title="Close Window"]')
    if (close) {
      close.click()
      return { dismissed: true, buttonText: 'close icon' }
    }
    return { dismissed: false, reason: 'no cancel button' }
  })

  await page.waitForTimeout(1500)
  return dismissed
}

async function classifySendClickOutcome(page, before) {
  await page.waitForTimeout(3000)

  return page.evaluate(function(beforeState) {
    var text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    var modal = document.querySelector('#modal, .modal.in, .modal.show, .bootbox.show, [role="dialog"]')
    var modalVisible = !!(modal && modal.offsetWidth > 0 && modal.offsetHeight > 0 &&
      window.getComputedStyle(modal).display !== 'none')

    var submitted = /\b(submitted|recorded|sent successfully|confirmation number|receipt number|package has been sent)\b/i.test(text)
    var stillReady = /\bready to send\b/i.test(text) || (/\bready\b/i.test(text) && /send package/i.test(text))
    var paymentPage = /\b(payment|authorize|credit card|billing information)\b/i.test(text)

    return {
      url: location.href,
      title: document.title,
      modalVisible: modalVisible,
      submitted: submitted,
      stillReady: stillReady,
      paymentPage: paymentPage,
      urlChanged: beforeState && beforeState.url !== location.href,
      bodySample: text.slice(0, 2000),
    }
  }, before)
}

async function inspectSendPackageBoundary(page) {
  var submitSafety = require('./submit-safety')
  var preClick = await assessSendPackagePreClick(page)
  var boundary = await submitSafety.enforceDryRunSubmitBoundary(page, { action: 'observe' })

  return {
    clicked: false,
    skipped: true,
    skipReason: 'Hard safety rule: #SendPackage is never clicked in inspection/dry-run scripts',
    preClick: preClick,
    boundary: boundary,
    sendPackage: boundary.sendPackage,
    outcome: boundary.atBoundary ? 'dry_run_boundary_send_package_visible' : 'send_package_not_visible',
    safe: true,
    unsafe: false,
    modalCapture: null,
    note: boundary.atBoundary
      ? 'One-click live submit — metadata captured only; no click attempted'
      : 'SendPackage not on page',
  }
}

async function clickSendPackageForInspection(page) {
  var submitSafety = require('./submit-safety')
  submitSafety.forbidSendPackageClick('clickSendPackageForInspection is disabled — use inspectSendPackageBoundary')
}

module.exports = {
  slugify,
  openDocumentTypeDropdown,
  selectDocumentType,
  clickWizardTab,
  collectMetadataInventory,
  categorizeMetadataFields,
  revealFileInputSelector,
  uploadDummyPdf,
  uploadDocumentPdf,
  scrollIndexingPanel,
  scrollAllPanels,
  openDocumentOneFromPackageView,
  collectDeepFieldInventory,
  analyzeIncompleteFields,
  dismissInactivityWarning,
  fillMinimumIndexingFields,
  partySectionLocator,
  collectPartySectionState,
  commitPartySection,
  fillAndCommitParties,
  extractDocumentRowStatus,
  collectSubmitButtonInventory,
  clickSaveButton,
  extractPackageStatus,
  inspectSendPackageButton,
  assessSendPackagePreClick,
  captureSendModal,
  dismissSendModal,
  classifySendClickOutcome,
  inspectSendPackageBoundary,
  clickSendPackageForInspection,
}
