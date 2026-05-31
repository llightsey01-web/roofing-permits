// lib/epn/submit-safety.js
// Hard safety guards — #SendPackage is a one-click live submit. Never click in tests.

const { writeFileSync, readFileSync, existsSync, mkdirSync } = require('fs')
const { join } = require('path')

var DUMMY_PDF_PATTERNS = [
  /AHJ-IQ-TEST-DO-NOT-SUBMIT/i,
  /DO-NOT-SUBMIT/i,
  /dummy/i,
  /test\.pdf$/i,
]

var TEST_PACKAGE_NAME_PATTERNS = [
  /^AHJ-IQ TEST DO NOT SUBMIT/i,
  /\bTEST\b/i,
  /\bDO NOT SUBMIT\b/i,
]

var ALLOWED_LIVE_SUBMIT_NOC_STATUSES = ['notarized']

var ACCIDENTAL_SUBMIT_LOG = join('automation', 'logs', 'epn-accidental-submits.json')

var NEVER_DELETE_PACK_IDS = ['50254044', '50319700']

class SendPackageSafetyError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'SendPackageSafetyError'
    this.details = details || null
  }
}

function isTestPackageName(name) {
  var value = String(name || '')
  return TEST_PACKAGE_NAME_PATTERNS.some(function(pattern) { return pattern.test(value) })
}

function isDummyDocumentPath(filePath) {
  var value = String(filePath || '')
  return DUMMY_PDF_PATTERNS.some(function(pattern) { return pattern.test(value) })
}

function assertInspectionDryRun(opts) {
  if (opts && opts.liveSubmit) {
    throw new SendPackageSafetyError(
      'test-epn-inspect.js is inspection-only. --live-submit is forbidden here. Use production erecord submit path with full safety validation.',
      { liveSubmit: true }
    )
  }
}

function validateLiveSubmit(context) {
  var ctx = context || {}
  var errors = []

  if (!ctx.liveSubmit) {
    errors.push('Missing --live-submit flag')
  }
  if (process.env.EPN_LIVE_SUBMIT_CONFIRM !== 'YES') {
    errors.push('EPN_LIVE_SUBMIT_CONFIRM must be YES')
  }
  if (!ctx.job) {
    errors.push('Job context required for live submit')
  } else {
    var nocStatus = ctx.job.noc_status || ''
    if (ALLOWED_LIVE_SUBMIT_NOC_STATUSES.indexOf(nocStatus) < 0) {
      errors.push('job.noc_status must be notarized (current: ' + nocStatus + ')')
    }
  }
  if (isTestPackageName(ctx.packageName)) {
    errors.push('package name contains TEST / DO NOT SUBMIT markers')
  }
  if (isDummyDocumentPath(ctx.documentPath)) {
    errors.push('document path looks like dummy/test PDF')
  }
  if (ctx.dryRun !== false) {
    errors.push('dryRun must be false for live submit')
  }

  if (errors.length) {
    throw new SendPackageSafetyError('Live submit blocked: ' + errors.join('; '), { errors: errors })
  }

  return { allowed: true, validatedAt: new Date().toISOString() }
}

function forbidSendPackageClick(reason) {
  throw new SendPackageSafetyError(
    reason || '#SendPackage is a one-click live submit — NEVER click in inspection/dry-run/test scripts',
    { selector: '#SendPackage', forbidden: true }
  )
}

async function inspectSendPackageReadOnly(page) {
  return page.evaluate(function() {
    var btn = document.querySelector('#SendPackage')
    if (!btn) return { found: false }

    return {
      found: true,
      id: btn.id,
      tag: btn.tagName.toLowerCase(),
      type: btn.type || null,
      text: (btn.textContent || btn.value || '').replace(/\s+/g, ' ').trim(),
      className: btn.className || null,
      disabled: !!btn.disabled,
      onclick: btn.getAttribute('onclick'),
      warning: 'READ ONLY — do not click. sendDocs submits immediately with no confirmation.',
      outerHTML: btn.outerHTML.slice(0, 800),
    }
  })
}

async function enforceDryRunSubmitBoundary(page, options) {
  var opts = options || {}
  var meta = await inspectSendPackageReadOnly(page)

  if (!meta.found) {
    return { atBoundary: false, sendPackage: meta, action: opts.action || 'observe' }
  }

  if (opts.action === 'click') {
    forbidSendPackageClick('Dry-run boundary: attempted #SendPackage click')
  }

  return {
    atBoundary: true,
    sendPackage: meta,
    action: opts.action || 'observe',
    message: '#SendPackage visible — dry-run stops here (no click)',
  }
}

async function installDryRunSendPackageGuard(page) {
  await page.addInitScript(function() {
    function blockSendPackageClick(event) {
      var target = event.target
      var btn = target && target.closest ? target.closest('#SendPackage') : null
      if (!btn) return
      event.preventDefault()
      event.stopImmediatePropagation()
      console.error('[AHJ-IQ SAFETY] Blocked #SendPackage click in dry-run mode')
    }

    function guardExisting() {
      var btn = document.querySelector('#SendPackage')
      if (!btn || btn.__ahjIqSendGuard) return
      btn.__ahjIqSendGuard = true
      btn.addEventListener('click', blockSendPackageClick, true)
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', guardExisting)
    } else {
      guardExisting()
    }

    new MutationObserver(guardExisting).observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  })
}

async function clickSendPackageLive(page, context) {
  validateLiveSubmit(context)
  forbidSendPackageClick('clickSendPackageLive is not implemented — wire only after production review')
}

function loadAccidentalSubmits() {
  if (!existsSync(ACCIDENTAL_SUBMIT_LOG)) return []
  try {
    return JSON.parse(readFileSync(ACCIDENTAL_SUBMIT_LOG, 'utf8'))
  } catch (e) {
    return []
  }
}

function logAccidentalSubmit(entry) {
  mkdirSync(join('automation', 'logs'), { recursive: true })
  var records = loadAccidentalSubmits()
  var record = Object.assign({
    loggedAt: new Date().toISOString(),
    doNotCleanupViaAutomation: true,
  }, entry)

  var exists = records.some(function(r) { return String(r.packId) === String(record.packId) })
  if (!exists) records.push(record)
  writeFileSync(ACCIDENTAL_SUBMIT_LOG, JSON.stringify(records, null, 2))
  return record
}

function isNeverDeletePackId(packId) {
  return NEVER_DELETE_PACK_IDS.indexOf(String(packId)) >= 0
}

function ensureAccidentalSubmitLogged() {
  return logAccidentalSubmit({
    packId: '50319700',
    packageName: 'AHJ-IQ TEST DO NOT SUBMIT 1780214731252',
    incident: 'Pass 9 send-inspect accidentally clicked #SendPackage — package submitted live',
    submittedAt: '2026-05-31T08:06:31.000Z',
    note: 'Do not attempt cleanup/delete through automation',
  })
}

module.exports = {
  SendPackageSafetyError,
  DUMMY_PDF_PATTERNS,
  TEST_PACKAGE_NAME_PATTERNS,
  ALLOWED_LIVE_SUBMIT_NOC_STATUSES,
  ACCIDENTAL_SUBMIT_LOG,
  NEVER_DELETE_PACK_IDS,
  isTestPackageName,
  isDummyDocumentPath,
  assertInspectionDryRun,
  validateLiveSubmit,
  forbidSendPackageClick,
  inspectSendPackageReadOnly,
  enforceDryRunSubmitBoundary,
  installDryRunSendPackageGuard,
  clickSendPackageLive,
  loadAccidentalSubmits,
  logAccidentalSubmit,
  isNeverDeletePackId,
  ensureAccidentalSubmitLogged,
}
