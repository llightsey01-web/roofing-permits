'use strict'

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function isMissingSelector(value) {
  return value === null || value === undefined || value === ''
}

function collectNullSelectors(selectors, prefix, out) {
  var source = selectors || {}
  var base = prefix || 'selectors'
  var results = out || []
  Object.keys(source).forEach(function (key) {
    var value = source[key]
    var path = base + '.' + key
    if (isMissingSelector(value)) {
      results.push({
        type: 'null_selector',
        path: path,
        field: key,
        message: path + ' is null/unconfirmed',
      })
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp)) {
      collectNullSelectors(value, path, results)
    }
  })
  return results
}

function collectUnconfirmedFieldMap(fieldMap, selectors) {
  var results = []
  var mappings = Array.isArray(fieldMap) ? fieldMap : []
  mappings.forEach(function (entry, index) {
    if (!entry) return
    var selectorKey = entry.selector
    var selectorValue = selectorKey && selectors ? selectors[selectorKey] : undefined
    if (entry.selectorConfirmed === false) {
      results.push({
        type: 'unconfirmed_field_map',
        path: 'fieldMap[' + index + ']',
        field: entry.jobField || selectorKey || ('index_' + index),
        selector: selectorKey || null,
        message:
          'fieldMap[' + index + '] ' +
          (entry.jobField || selectorKey || 'unknown') +
          ' has selectorConfirmed=false',
      })
    }
    if (selectorKey && isMissingSelector(selectorValue)) {
      results.push({
        type: 'field_map_null_selector',
        path: 'fieldMap[' + index + '].selector -> selectors.' + selectorKey,
        field: entry.jobField || selectorKey,
        selector: selectorKey,
        message:
          'fieldMap[' + index + '] ' +
          (entry.jobField || selectorKey) +
          ' points to null/unconfirmed selector selectors.' + selectorKey,
      })
    }
  })
  return results
}

function collectExplicitUnconfirmedSelectors(config) {
  var cfg = config || {}
  var selectors = cfg.selectors || {}
  var entries = Array.isArray(cfg.unconfirmedSelectors) ? cfg.unconfirmedSelectors : []
  return entries.map(function (entry, index) {
    var selectorKey = typeof entry === 'string' ? entry : entry.selector
    var selectorValue = selectorKey ? selectors[selectorKey] : undefined
    return {
      type: 'explicit_unconfirmed_selector',
      path: 'unconfirmedSelectors[' + index + '] -> selectors.' + selectorKey,
      field: selectorKey || ('index_' + index),
      selector: selectorKey || null,
      selectorValue: selectorValue || null,
      message:
        'selectors.' + selectorKey +
        ' is explicitly marked unconfirmed' +
        (entry && entry.reason ? ': ' + entry.reason : ''),
    }
  })
}

function collectUnconfirmedSelectors(config, fieldMap) {
  var cfg = config || {}
  var selectors = cfg.selectors || {}
  var map = fieldMap || cfg.fieldMap || []
  var issues = []
  issues = issues.concat(collectNullSelectors(selectors, 'selectors', []))
  issues = issues.concat(collectUnconfirmedFieldMap(map, selectors))
  issues = issues.concat(collectExplicitUnconfirmedSelectors(cfg))

  var seen = {}
  return issues.filter(function (issue) {
    var key = issue.type + '|' + issue.path + '|' + (issue.field || '')
    if (seen[key]) return false
    seen[key] = true
    return true
  })
}

async function logSelectorPreflightBlock(options, issues, message) {
  var opts = options || {}
  var supabase = getSupabase()
  if (!supabase) return

  var metadata = {
    ahj_id: opts.config && opts.config.id,
    issue_count: issues.length,
    issues: issues,
  }

  try {
    await supabase.from('automation_logs').insert({
      run_id: opts.runId || null,
      step_number: 0,
      step_name: 'preflight_unconfirmed_selectors',
      success: false,
      notes: message,
      raw_error: JSON.stringify(metadata),
      logged_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[selector-preflight] automation_logs insert failed:', err.message)
  }

  try {
    await supabase.from('run_actions').insert({
      run_id: opts.runId || null,
      job_id: opts.jobData && opts.jobData.id ? opts.jobData.id : null,
      company_id: opts.jobData && opts.jobData.company_id ? opts.jobData.company_id : null,
      action: 'selector_preflight',
      status: 'blocked',
      step_number: 0,
      step_name: 'preflight_unconfirmed_selectors',
      error_message: message,
      metadata: metadata,
      created_at: new Date().toISOString(),
    })
  } catch (err2) {
    console.warn('[selector-preflight] run_actions insert failed:', err2.message)
  }
}

async function preflightCheckSelectors(config, fieldMap, options) {
  var issues = collectUnconfirmedSelectors(config, fieldMap)
  if (issues.length === 0) return { ok: true, issues: [] }

  var names = issues.map(function (issue) {
    return issue.message
  })
  var message = 'blocked — unconfirmed selectors: [' + names.join('; ') + ']'
  await logSelectorPreflightBlock(Object.assign({}, options || {}, { config: config }), issues, message)
  throw Object.assign(new Error(message), {
    errorCode: 'unconfirmed_selectors',
    issues: issues,
  })
}

module.exports = {
  collectUnconfirmedSelectors,
  preflightCheckSelectors,
}
