require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { chromium } = require('playwright')
const config = require('./ahjs/configs/polk-county.config')

function waitForEnter(prompt) {
  return new Promise(function(resolve) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, function() {
      rl.close()
      resolve()
    })
  })
}

function collectFieldDiagnostics() {
  function isVisible(el) {
    if (!el) return false
    if (el.type === 'hidden') return false
    var style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    var rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0 && el.tagName !== 'INPUT') return false
    return el.offsetParent !== null || style.position === 'fixed'
  }

  function getLabelText(el) {
    if (el.id) {
      var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (lbl) return (lbl.innerText || lbl.textContent || '').trim()
    }
    var parentLabel = el.closest('label')
    if (parentLabel) return (parentLabel.innerText || parentLabel.textContent || '').trim()
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim()
    return ''
  }

  function getNearbyText(el) {
    var container = el.closest('tr, li, fieldset, div.ACA_Title_Bar, div.ACA_Section, table')
    if (!container) container = el.closest('div')
    if (!container) return ''
    return (container.innerText || container.textContent || '').trim().substring(0, 500)
  }

  function describeElement(el) {
    var tag = el.tagName.toLowerCase()
    var type = el.type || ''
    if (tag === 'select') type = 'select'
    if (tag === 'textarea') type = 'textarea'
    if (tag === 'button') type = type || 'button'
    if (tag === 'a') type = 'anchor'

    var value = ''
    if (tag === 'select') {
      var opt = el.options[el.selectedIndex]
      value = opt ? (opt.value || '') : (el.value || '')
    } else if (tag === 'a') {
      value = el.getAttribute('href') || ''
    } else {
      value = el.value != null ? String(el.value) : (el.innerText || el.textContent || '').trim()
    }

    return {
      tag: tag,
      type: type,
      id: el.id || '',
      name: el.name || '',
      value: value.substring(0, 500),
      checked: el.checked === true,
      placeholder: el.placeholder || el.getAttribute('placeholder') || '',
      label: getLabelText(el),
      nearbyText: getNearbyText(el),
      visibleText: (el.innerText || el.textContent || el.getAttribute('title') || '').trim().substring(0, 300)
    }
  }

  var inputs = []
  var selects = []
  var textareas = []
  var buttons = []
  var anchors = []
  var radios = []
  var checkboxes = []

  document.querySelectorAll('input').forEach(function(el) {
    if (!isVisible(el)) return
    var field = describeElement(el)
    if (el.type === 'radio') radios.push(field)
    else if (el.type === 'checkbox') checkboxes.push(field)
    else inputs.push(field)
  })

  document.querySelectorAll('select').forEach(function(el) {
    if (!isVisible(el)) return
    selects.push(describeElement(el))
  })

  document.querySelectorAll('textarea').forEach(function(el) {
    if (!isVisible(el)) return
    textareas.push(describeElement(el))
  })

  document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]').forEach(function(el) {
    if (!isVisible(el)) return
    buttons.push(describeElement(el))
  })

  document.querySelectorAll('a').forEach(function(el) {
    if (!isVisible(el)) return
    anchors.push(describeElement(el))
  })

  var bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : ''
  var keywords = ['NOC', 'Notice', 'Commencement', 'required', 'upload', 'document', 'owner', 'parcel', 'contractor']
  var keywordMatches = {}

  keywords.forEach(function(kw) {
    var re = new RegExp(kw, 'i')
    var lines = bodyText.split('\n').map(function(line) { return line.trim() }).filter(function(line) {
      return line && re.test(line)
    })
    keywordMatches[kw] = lines.slice(0, 20)
  })

  return {
    bodyTextPreview: bodyText.substring(0, 4000),
    keywordMatches: keywordMatches,
    fields: {
      inputs: inputs,
      selects: selects,
      textareas: textareas,
      buttons: buttons,
      anchors: anchors,
      radios: radios,
      checkboxes: checkboxes
    }
  }
}

function logField(field, index) {
  console.log('  [' + index + '] tag=' + field.tag +
    ' type=' + (field.type || '(none)') +
    ' id=' + (field.id || '(none)') +
    ' name=' + (field.name || '(none)'))
  console.log('      value="' + (field.value || '') + '"')
  if (field.checked) console.log('      checked=true')
  if (field.placeholder) console.log('      placeholder="' + field.placeholder + '"')
  if (field.label) console.log('      label="' + field.label + '"')
  if (field.nearbyText) console.log('      nearby="' + field.nearbyText.substring(0, 200) + '"')
  if (field.visibleText) console.log('      visibleText="' + field.visibleText.substring(0, 200) + '"')
}

function logFieldGroup(title, fields) {
  console.log('\n=== ' + title + ' (' + fields.length + ') ===')
  fields.forEach(function(field, i) { logField(field, i + 1) })
}

async function run() {
  var browser = await chromium.launch({ headless: false, slowMo: 500 })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)

  try {
    console.log('Opening Polk login URL: ' + config.portalUrl)
    await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    console.log('\nNavigate manually through Steps 1-5 and stop at the NOC section, then press Enter here.')
    await waitForEnter('')

    var dir = path.join('automation', 'logs', 'step6-noc-diagnostic-' + Date.now())
    fs.mkdirSync(dir, { recursive: true })
    console.log('\nOutput dir: ' + dir)

    var pngPath = path.join(dir, '01-step6-noc-page.png')
    var htmlPath = path.join(dir, '01-step6-noc-page.html')
    await page.screenshot({ path: pngPath, fullPage: true })
    fs.writeFileSync(htmlPath, await page.content(), 'utf8')
    console.log('Saved screenshot: ' + pngPath)
    console.log('Saved HTML: ' + htmlPath)

    var currentUrl = page.url()
    console.log('\nCurrent URL: ' + currentUrl)

    var diagnostics = await page.evaluate(collectFieldDiagnostics)
    console.log('\n=== body.innerText (first 4000 chars) ===')
    console.log(diagnostics.bodyTextPreview)

    logFieldGroup('inputs', diagnostics.fields.inputs)
    logFieldGroup('selects', diagnostics.fields.selects)
    logFieldGroup('textareas', diagnostics.fields.textareas)
    logFieldGroup('buttons', diagnostics.fields.buttons)
    logFieldGroup('anchors', diagnostics.fields.anchors)
    logFieldGroup('radios', diagnostics.fields.radios)
    logFieldGroup('checkboxes', diagnostics.fields.checkboxes)

    console.log('\n=== keyword search (visible page text) ===')
    Object.keys(diagnostics.keywordMatches).forEach(function(kw) {
      var matches = diagnostics.keywordMatches[kw]
      console.log('  "' + kw + '": ' + matches.length + ' matching line(s)')
      matches.forEach(function(line) { console.log('    - ' + line.substring(0, 200)) })
    })

    var jsonPath = path.join(dir, 'fields.json')
    var payload = {
      capturedAt: new Date().toISOString(),
      url: currentUrl,
      bodyTextPreview: diagnostics.bodyTextPreview,
      keywordMatches: diagnostics.keywordMatches,
      fields: diagnostics.fields
    }
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')
    console.log('\nSaved fields.json: ' + jsonPath)
    console.log('\nStep 6 NOC diagnostic capture complete.')
  } finally {
    await browser.close()
  }
}

run().catch(function(err) {
  console.error('Step 6 NOC diagnosis failed:', err.message)
  process.exit(1)
})
