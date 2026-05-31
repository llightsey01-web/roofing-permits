// lib/epn/inspect.js
// Discover ePN portal structure — inspect only, no submissions

const { writeFileSync, mkdirSync, readFileSync } = require('fs')
const { join } = require('path')
const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')

function slugify(value) {
  return String(value || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'page'
}

function classifyElement(text, href) {
  var haystack = (text + ' ' + (href || '')).toLowerCase()
  var tags = []
  if (/new|create|start/.test(haystack)) tags.push('new_submission_entry')
  if (/county|jurisdiction|state/.test(haystack)) tags.push('county_jurisdiction')
  if (/upload|document|attach|file/.test(haystack)) tags.push('document_upload')
  if (/fee|cost|price|payment|summary|total/.test(haystack)) tags.push('fees_summary')
  if (/history|status|search|track|queue|list/.test(haystack)) tags.push('status_history')
  if (/download|recorded|stamped|receipt|return/.test(haystack)) tags.push('download_recorded')
  if (/submit|record|finalize|pay/.test(haystack)) tags.push('submit_button_candidate')
  if (/parcel|folio|legal|party|grantor|grantee|return/.test(haystack)) tags.push('metadata_field')
  return tags
}

async function collectPageInventory(page) {
  return page.evaluate(function(args) {
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
      if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]'
      return el.tagName.toLowerCase()
    }

    var links = []
    Array.from(document.querySelectorAll('a[href]')).forEach(function(a) {
      if (!visible(a)) return
      var text = (a.textContent || '').replace(/\s+/g, ' ').trim()
      var href = a.getAttribute('href') || ''
      if (!text && !href) return
      links.push({
        type: 'link',
        text: text.slice(0, 120),
        href: href,
        selector: selectorFor(a),
      })
    })

    var buttons = []
    Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).forEach(function(el) {
      if (!visible(el)) return
      var text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      if (!text) return
      buttons.push({
        type: el.tagName.toLowerCase(),
        text: text.slice(0, 120),
        selector: selectorFor(el),
        inputType: el.getAttribute('type') || null,
      })
    })

    var inputs = []
    Array.from(document.querySelectorAll('input, select, textarea')).forEach(function(el) {
      if (!visible(el)) return
      var type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase()
      if (type === 'hidden') return
      inputs.push({
        tag: el.tagName.toLowerCase(),
        type: type,
        name: el.getAttribute('name'),
        id: el.id || null,
        placeholder: el.getAttribute('placeholder'),
        label: el.getAttribute('aria-label'),
        selector: selectorFor(el),
      })
    })

    var headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
      .filter(visible)
      .map(function(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      })
      .filter(Boolean)

    return {
      url: location.href,
      title: document.title,
      headings: headings.slice(0, 20),
      links: links.slice(0, 100),
      buttons: buttons.slice(0, 80),
      inputs: inputs.slice(0, 120),
      bodyTextSample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
    }
  }, {})
}

function annotateInventory(inventory) {
  var annotatedLinks = (inventory.links || []).map(function(link) {
    return Object.assign({}, link, { tags: classifyElement(link.text, link.href) })
  })
  var annotatedButtons = (inventory.buttons || []).map(function(btn) {
    return Object.assign({}, btn, { tags: classifyElement(btn.text, null) })
  })
  var annotatedInputs = (inventory.inputs || []).map(function(input) {
    var label = [input.name, input.id, input.placeholder, input.label].filter(Boolean).join(' ')
    return Object.assign({}, input, { tags: classifyElement(label, null) })
  })
  return Object.assign({}, inventory, {
    links: annotatedLinks,
    buttons: annotatedButtons,
    inputs: annotatedInputs,
  })
}

function isDangerousAction(text) {
  return epnConfig.dangerousPatterns.some(function(pattern) {
    return pattern.test(String(text || ''))
  })
}

function isSafeExploreLink(link) {
  if (!link || !link.text) return false
  if (isDangerousAction(link.text)) return false
  var haystack = (link.text + ' ' + (link.href || '')).toLowerCase()
  if (/logout|sign out|delete|remove|cancel package/.test(haystack)) return false
  return epnConfig.safeLinkPatterns.some(function(pattern) {
    return pattern.test(haystack)
  })
}

async function captureStep(page, outputDir, stepName, inventoryStore, navigationMap) {
  var inventory = annotateInventory(await collectPageInventory(page))
  var screenshotPath = join(outputDir, stepName + '.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  writeFileSync(join(outputDir, stepName + '.json'), JSON.stringify(inventory, null, 2))

  inventoryStore.push({
    step: stepName,
    url: inventory.url,
    title: inventory.title,
    screenshot: screenshotPath,
    inventoryFile: join(outputDir, stepName + '.json'),
    headings: inventory.headings,
    linkCount: inventory.links.length,
    buttonCount: inventory.buttons.length,
    inputCount: inventory.inputs.length,
  })

  navigationMap.pages.push({
    step: stepName,
    url: inventory.url,
    title: inventory.title,
    tags: summarizeTags(inventory),
  })

  return inventory
}

function summarizeTags(inventory) {
  var tags = new Set()
  ;(inventory.links || []).concat(inventory.buttons || []).concat(inventory.inputs || []).forEach(function(item) {
    ;(item.tags || []).forEach(function(tag) { tags.add(tag) })
  })
  return Array.from(tags)
}

function buildSelectorsMap(pages) {
  var selectors = {
    login: epnConfig.selectors,
    discovered: {
      new_submission_entry: [],
      county_jurisdiction: [],
      document_upload: [],
      fees_summary: [],
      status_history: [],
      submit_button_candidate: [],
      download_recorded: [],
      metadata_field: [],
    },
  }

  pages.forEach(function(page) {
    var dataFile = page.inventoryFile
    if (!dataFile) return
    try {
      var inventory = JSON.parse(readFileSync(dataFile, 'utf8'))
      ;['links', 'buttons', 'inputs'].forEach(function(group) {
        ;(inventory[group] || []).forEach(function(item) {
          ;(item.tags || []).forEach(function(tag) {
            if (!selectors.discovered[tag]) selectors.discovered[tag] = []
            selectors.discovered[tag].push({
              step: page.step,
              url: inventory.url,
              selector: item.selector,
              text: item.text || item.name || item.placeholder || null,
              type: item.type || item.tag || null,
            })
          })
        })
      })
    } catch (e) {}
  })

  return selectors
}

function buildNavigationMap(inventoryStore) {
  return {
    portal: epnConfig.name,
    loginUrl: epnConfig.loginUrl,
    inspectedAt: new Date().toISOString(),
    pages: inventoryStore.map(function(page) {
      return {
        step: page.step,
        url: page.url,
        title: page.title,
        screenshot: page.screenshot,
        inventoryFile: page.inventoryFile,
        headings: page.headings,
      }
    }),
  }
}

function buildAutomationPlan() {
  return {
    goal: 'Automate notarized NOC recording through ePN',
    portal: 'ePN / eRecording Partners Network',
    portalUrl: epnConfig.loginUrl,
    status: 'planned',
    phases: [
      {
        step: 1,
        name: 'Upload notarized NOC',
        input: 'jobs/{jobId}/notarized/noc-notarized.pdf from Supabase',
        action: 'Use ePN new submission entry + document upload flow',
        output: 'Draft package with uploaded NOC PDF',
      },
      {
        step: 2,
        name: 'Fill recording metadata',
        fields: ['county', 'document_type', 'parcel', 'recording_party', 'return_info'],
        action: 'Populate required ePN metadata from job record',
      },
      {
        step: 3,
        name: 'Review fees/summary',
        action: 'Capture fee quote and summary screen; do not pay/submit until approved',
      },
      {
        step: 4,
        name: 'Submit recording',
        action: 'Click submit only in approved production runner',
        output: 'submission_id / package_id stored in job_specs.erecord',
      },
      {
        step: 5,
        name: 'Poll status',
        action: 'Check ePN status/history until recorded or rejected',
        output: 'job_specs.erecord.submission_status',
      },
      {
        step: 6,
        name: 'Download recorded/stamped document',
        action: 'Download from ePN recorded document path',
        output: 'jobs/{jobId}/recorded/noc-recorded.pdf in Supabase',
      },
      {
        step: 7,
        name: 'Finalize job',
        action: 'Update noc_status = recorded, save recording_number + timestamps',
      },
    ],
    manualBridge: {
      available: true,
      endpoint: 'POST /api/jobs/[id]/record-noc',
      useWhen: 'noc_status = notarized and admin records manually in ePN portal',
    },
    safety: {
      inspectOnly: true,
      liveSubmitBlocked: true,
    },
  }
}

async function explorePortal(page, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  var inventoryStore = []
  var navigationMap = { portal: epnConfig.name, loginUrl: epnConfig.loginUrl, pages: [] }
  var stepCounter = 1

  async function snap(label) {
    var stepName = String(stepCounter).padStart(2, '0') + '-' + slugify(label)
    stepCounter++
    console.log('Capturing: ' + stepName + ' (' + page.url() + ')')
    return captureStep(page, outputDir, stepName, inventoryStore, navigationMap)
  }

  await snap('dashboard-after-login')

  var dashboardInventory = inventoryStore[inventoryStore.length - 1]
  var firstInventory = JSON.parse(readFileSync(dashboardInventory.inventoryFile, 'utf8'))
  var exploreTargets = (firstInventory.links || []).filter(isSafeExploreLink).slice(0, 8)

  for (var i = 0; i < exploreTargets.length; i++) {
    var target = exploreTargets[i]
    console.log('Exploring safe link: ' + target.text)
    try {
      if ((target.href || '').startsWith('http')) {
        await page.goto(target.href, { waitUntil: 'domcontentloaded' })
      } else if (target.href) {
        await page.goto(new URL(target.href, page.url()).toString(), { waitUntil: 'domcontentloaded' })
      } else {
        continue
      }
      await page.waitForTimeout(2500)
      await snap('explore-' + slugify(target.text))
    } catch (err) {
      console.log('Explore skipped for "' + target.text + '": ' + err.message)
    }
  }

  var selectorsMap = buildSelectorsMap(inventoryStore)
  var navMap = buildNavigationMap(inventoryStore)
  var buildPlan = buildAutomationPlan()

  buildPlan.discovery = {
    pagesInspected: inventoryStore.length,
    candidateAreas: Object.keys(selectorsMap.discovered).reduce(function(acc, key) {
      acc[key] = (selectorsMap.discovered[key] || []).length
      return acc
    }, {}),
  }

  writeFileSync(join(outputDir, 'epn-selectors.json'), JSON.stringify(selectorsMap, null, 2))
  writeFileSync(join(outputDir, 'epn-navigation-map.json'), JSON.stringify(navMap, null, 2))
  writeFileSync(join(outputDir, 'epn-build-plan.json'), JSON.stringify(buildPlan, null, 2))
  writeFileSync(join(outputDir, 'epn-inspect-summary.json'), JSON.stringify({
    outputDir: outputDir,
    pagesInspected: inventoryStore.length,
    selectorsFile: join(outputDir, 'epn-selectors.json'),
    navigationMapFile: join(outputDir, 'epn-navigation-map.json'),
    buildPlanFile: join(outputDir, 'epn-build-plan.json'),
    safetyNote: 'Inspect only — no packages submitted, no recordings finalized',
  }, null, 2))

  return {
    success: true,
    outputDir: outputDir,
    pagesInspected: inventoryStore.length,
    selectorsPath: join(outputDir, 'epn-selectors.json'),
    navigationMapPath: join(outputDir, 'epn-navigation-map.json'),
    buildPlanPath: join(outputDir, 'epn-build-plan.json'),
    summaryPath: join(outputDir, 'epn-inspect-summary.json'),
    buildPlan: buildPlan,
  }
}

module.exports = {
  collectPageInventory,
  annotateInventory,
  explorePortal,
  buildAutomationPlan,
}
