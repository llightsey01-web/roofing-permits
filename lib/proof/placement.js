// lib/proof/placement.js
// PDF ↔ Proof viewer coordinate helpers and field placement
// Uses frozen production coordinates only — no anchor tags, no fallback placement.

const proofConfig = require('../../automation/ahjs/configs/proof.config')
const REQUIRED_PROOF_FIELD_COUNT = proofConfig.REQUIRED_PROOF_FIELD_COUNT
const FROZEN_PROOF_PLACEMENT = proofConfig.FROZEN_PROOF_PLACEMENT
const FROZEN_FIELD_TOOLS = proofConfig.FROZEN_FIELD_TOOLS
const FROZEN_OWNER_SIGNATURE = proofConfig.FROZEN_OWNER_SIGNATURE

const DEFAULT_PAGE_SIZE = { width: 612, height: 792 }

function pdfPointToViewport(pageRect, pageSize, pdfX, pdfY) {
  var width = pageSize.width || DEFAULT_PAGE_SIZE.width
  var height = pageSize.height || DEFAULT_PAGE_SIZE.height
  var scale = pageRect.width / width
  return {
    x: pageRect.left + pdfX * scale,
    y: pageRect.top + (height - pdfY) * scale,
    scale: scale,
  }
}

function pdfRectToViewport(pageRect, pageSize, placement) {
  var width = pageSize.width || DEFAULT_PAGE_SIZE.width
  var height = pageSize.height || DEFAULT_PAGE_SIZE.height
  var scale = pageRect.width / width
  var topPdfY = placement.y
  var bottomPdfY = placement.y - (placement.height || 0)
  return {
    left: pageRect.left + placement.x * scale,
    top: pageRect.top + (height - topPdfY) * scale,
    right: pageRect.left + (placement.x + (placement.width || 0)) * scale,
    bottom: pageRect.top + (height - bottomPdfY) * scale,
    centerX: pageRect.left + (placement.x + (placement.width || 0) / 2) * scale,
    centerY: pageRect.top + (height - (topPdfY + bottomPdfY) / 2) * scale,
    scale: scale,
  }
}

async function findScrollContainer(page) {
  return page.evaluate(function() {
    var candidates = Array.from(document.querySelectorAll('*')).filter(function(el) {
      if (el.scrollHeight <= el.clientHeight + 20) return false
      var rect = el.getBoundingClientRect()
      return rect.width > 200 && rect.height > 200
    })
    candidates.sort(function(a, b) {
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
    })
    if (candidates.length === 0) return null
    var el = candidates[0]
    var rect = el.getBoundingClientRect()
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
  })
}

async function findPdfPageElements(page, pageSize) {
  return page.evaluate(function(args) {
    function isVisible(el) {
      if (!el) return false
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 80 && rect.height > 80 &&
        style.display !== 'none' && style.visibility !== 'hidden'
    }

    var maxPageHeightPx = args.pageHeight * (args.pageWidth ? 1.35 : 1.35)
    var selectors = [
      '[data-page-number]',
      '[class*="page" i]',
      'canvas',
      '[class*="Page" i]',
    ]

    var seen = new Set()
    var nodes = []

    selectors.forEach(function(selector) {
      document.querySelectorAll(selector).forEach(function(el) {
        if (seen.has(el)) return
        seen.add(el)
        if (!isVisible(el)) return
        var rect = el.getBoundingClientRect()
        if (rect.height > maxPageHeightPx * 2) return
        nodes.push({
          pageNumber: Number(el.getAttribute('data-page-number')) || null,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          right: rect.right,
          scrollTop: rect.top + window.scrollY,
        })
      })
    })

    nodes.sort(function(a, b) { return a.top - b.top })

    // Deduplicate overlapping nodes — keep the smallest height per vertical band
    var filtered = []
    nodes.forEach(function(node) {
      var duplicate = filtered.find(function(existing) {
        return Math.abs(existing.top - node.top) < 8 && Math.abs(existing.left - node.left) < 8
      })
      if (!duplicate) {
        filtered.push(node)
      } else if (node.height < duplicate.height) {
        var idx = filtered.indexOf(duplicate)
        filtered[idx] = node
      }
    })

    return filtered.map(function(node, index) {
      return Object.assign({}, node, { index: index })
    })
  }, {
    pageWidth: pageSize.width,
    pageHeight: pageSize.height,
  })
}

async function findPdfPageRect(page, targetPage, pageSize) {
  var pages = await findPdfPageElements(page, pageSize)
  if (pages.length === 0) return null

  var byNumber = pages.filter(function(p) { return p.pageNumber === targetPage })
  if (byNumber.length) {
    byNumber.sort(function(a, b) { return a.height - b.height })
    return byNumber[0]
  }

  var distinct = []
  pages.forEach(function(p) {
    var exists = distinct.find(function(d) { return Math.abs(d.top - p.top) < 40 })
    if (!exists) distinct.push(p)
  })
  distinct.sort(function(a, b) { return a.top - b.top })
  if (distinct.length >= targetPage) {
    return distinct[targetPage - 1]
  }
  return null
}

async function scrollPdfPageIntoView(page, targetPage, pageSize) {
  var scrolled = await page.evaluate(function(args) {
    var numbered = document.querySelector('[data-page-number="' + args.targetPage + '"]')
    if (numbered) {
      numbered.scrollIntoView({ block: 'start', inline: 'nearest' })
      return 'data-page-number'
    }

    function isVisible(el) {
      var rect = el.getBoundingClientRect()
      var style = window.getComputedStyle(el)
      return rect.width > 80 && rect.height > 80 &&
        style.display !== 'none' && style.visibility !== 'hidden'
    }

    var pageNodes = Array.from(document.querySelectorAll('[data-page-number], canvas, [class*="page" i], [class*="Page" i]'))
      .filter(isVisible)
      .filter(function(el) {
        var rect = el.getBoundingClientRect()
        return rect.height < args.pageHeight * 2.5
      })
      .sort(function(a, b) {
        return a.getBoundingClientRect().top - b.getBoundingClientRect().top
      })

    var distinct = []
    pageNodes.forEach(function(el) {
      var top = el.getBoundingClientRect().top
      if (!distinct.some(function(d) { return Math.abs(d.getBoundingClientRect().top - top) < 40 })) {
        distinct.push(el)
      }
    })

    if (distinct[args.targetPage - 1]) {
      distinct[args.targetPage - 1].scrollIntoView({ block: 'start', inline: 'nearest' })
      return 'distinct-page'
    }

    var scrollers = Array.from(document.querySelectorAll('*')).filter(function(el) {
      return el.scrollHeight > el.clientHeight + 20
    })
    scrollers.sort(function(a, b) {
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
    })

    if (scrollers[0]) {
      var scroller = scrollers[0]
      var scale = scroller.clientWidth / args.pageWidth
      var pageHeightPx = args.pageHeight * scale
      scroller.scrollTop = Math.max(0, (args.targetPage - 1) * pageHeightPx - 20)
      return 'scroller'
    }

    return 'none'
  }, {
    targetPage: targetPage,
    pageWidth: pageSize.width,
    pageHeight: pageSize.height,
  })

  await page.waitForTimeout(1400)
  return scrolled
}

async function navigateToPdfPage(page, targetPage, pageSize) {
  await scrollPdfPageIntoView(page, targetPage, pageSize)

  var rect = await findPdfPageRect(page, targetPage, pageSize)
  if (!rect) {
    throw new Error('Could not locate PDF page ' + targetPage + ' in Proof viewer')
  }

  // If the page top is below the fold, nudge the scroll container
  if (rect.top > 140) {
    await page.evaluate(function(topOffset) {
      var scrollers = Array.from(document.querySelectorAll('*')).filter(function(el) {
        return el.scrollHeight > el.clientHeight + 20
      })
      if (scrollers[0]) {
        scrollers[0].scrollTop += topOffset - 100
      }
    }, rect.top)
    await page.waitForTimeout(900)
    rect = await findPdfPageRect(page, targetPage, pageSize)
  }

  return rect
}

async function clickToolbarButton(page, label) {
  await page.waitForFunction(function(text) {
    return Array.from(document.querySelectorAll('button')).some(function(b) {
      return (b.textContent || '').includes(text)
    })
  }, label, { timeout: 15000 })
  await page.evaluate(function(text) {
    var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
      return (b.textContent || '').includes(text)
    })
    if (btn) btn.click()
  }, label)
  await page.waitForTimeout(700)
}

async function activateFieldTool(page, toolConfig) {
  if (!toolConfig || !toolConfig.label) {
    throw new Error('Missing field tool config')
  }
  await clickToolbarButton(page, toolConfig.label)
}

async function countSignatureFieldsInEditor(page) {
  return page.evaluate(function() {
    function isProofSignatureWidget(el) {
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!/sign here/i.test(text)) return false
      var rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.width > 500 || rect.height < 14 || rect.height > 120) return false
      // Ignore sidebar toolbar buttons — only count fields placed on the PDF canvas
      if (rect.left > 870) return false
      var childHasSignHere = Array.from(el.querySelectorAll('*')).some(function(child) {
        if (child === el) return false
        var childText = (child.textContent || '').replace(/\s+/g, ' ').trim()
        return /sign here/i.test(childText)
      })
      return !childHasSignHere
    }

    var matches = []
    document.querySelectorAll('div, span, button, a, [draggable="true"]').forEach(function(el) {
      if (!isProofSignatureWidget(el)) return
      var rect = el.getBoundingClientRect()
      matches.push({
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    })
    return matches
  })
}

async function placeFieldAtPdfCoords(page, placement, pageSize, toolConfig) {
  if (!placement || !placement.page) {
    throw new Error('Invalid placement config')
  }

  var pageRect = await navigateToPdfPage(page, placement.page, pageSize)
  if (!pageRect) {
    throw new Error('Could not locate PDF page ' + placement.page + ' in Proof viewer')
  }

  await activateFieldTool(page, toolConfig)

  var viewport = pdfRectToViewport(pageRect, pageSize, placement)
  var startX = viewport.left + 4
  var startY = viewport.top + 4
  var endX = viewport.right - 4
  var endY = viewport.bottom - 4

  if ((placement.width || 0) > 0 && (placement.height || 0) > 0) {
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 8 })
    await page.mouse.up()
  } else {
    await page.mouse.click(viewport.centerX, viewport.centerY)
  }

  await page.waitForTimeout(900)
  return {
    placement: placement,
    pageRect: pageRect,
    viewport: viewport,
    tool: toolConfig,
  }
}

function assertProofFieldPlacementCount(fieldsPlaced) {
  console.log('Placed Proof fields: ' + fieldsPlaced)
  if (fieldsPlaced !== REQUIRED_PROOF_FIELD_COUNT) {
    throw new Error(
      'Proof placement aborted: expected ' + REQUIRED_PROOF_FIELD_COUNT +
      ' field(s), placed ' + fieldsPlaced
    )
  }
}

async function placeAllConfiguredFields(page, proofConfigInput) {
  var pageSize = (proofConfigInput && proofConfigInput.pdfPageSize) || DEFAULT_PAGE_SIZE
  var placement = FROZEN_PROOF_PLACEMENT
  var tools = FROZEN_FIELD_TOOLS
  var configuredFieldNames = Object.keys(placement).filter(function(fieldName) {
    return placement[fieldName] && tools[fieldName]
  })

  if (configuredFieldNames.length !== REQUIRED_PROOF_FIELD_COUNT) {
    throw new Error(
      'Proof placement config invalid: expected exactly ' + REQUIRED_PROOF_FIELD_COUNT +
      ' configured field(s), found ' + configuredFieldNames.length
    )
  }

  var fieldsBefore = await countSignatureFieldsInEditor(page)
  if (fieldsBefore.length > 0) {
    throw new Error(
      'Proof placement aborted: editor already has ' + fieldsBefore.length +
      ' signature field(s) before placement (anchor tags or stale fields not allowed)'
    )
  }

  var results = []

  for (var i = 0; i < configuredFieldNames.length; i++) {
    var fieldName = configuredFieldNames[i]
    var fieldPlacement = placement[fieldName]
    var fieldTool = tools[fieldName]
    console.log('Placing ' + fieldName + ' on page ' + fieldPlacement.page +
      ' at pdf(' + fieldPlacement.x + ',' + fieldPlacement.y + ')...')
    var result = await placeFieldAtPdfCoords(page, fieldPlacement, pageSize, fieldTool)
    results.push({ fieldName: fieldName, result: result })
  }

  await navigateToPdfPage(page, FROZEN_OWNER_SIGNATURE.page, pageSize)
  var fieldsAfter = await countSignatureFieldsInEditor(page)
  assertProofFieldPlacementCount(results.length)

  if (fieldsAfter.length !== REQUIRED_PROOF_FIELD_COUNT) {
    console.log('Note: visible signature widgets on page ' + FROZEN_OWNER_SIGNATURE.page + ': ' + fieldsAfter.length)
  }

  return {
    results: results,
    fieldsPlaced: results.length,
    fieldsVisibleAfter: fieldsAfter.length,
    fieldNames: configuredFieldNames,
    frozenPlacement: FROZEN_PROOF_PLACEMENT,
  }
}

async function capturePdfViewerScreenshot(page, outputPath) {
  var viewer = await page.$('[class*="document" i], [class*="Document" i], [class*="editor" i], [class*="Editor" i]')
  if (viewer) {
    await viewer.screenshot({ path: outputPath })
    return outputPath
  }
  await page.screenshot({ path: outputPath, fullPage: false })
  return outputPath
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  pdfPointToViewport,
  pdfRectToViewport,
  findScrollContainer,
  findPdfPageElements,
  findPdfPageRect,
  scrollPdfPageIntoView,
  navigateToPdfPage,
  activateFieldTool,
  placeFieldAtPdfCoords,
  countSignatureFieldsInEditor,
  assertProofFieldPlacementCount,
  placeAllConfiguredFields,
  REQUIRED_PROOF_FIELD_COUNT,
  FROZEN_PROOF_PLACEMENT,
  capturePdfViewerScreenshot,
}
