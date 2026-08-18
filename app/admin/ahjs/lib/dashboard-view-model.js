// app/admin/ahjs/lib/dashboard-view-model.js
// Pure view-model helpers for ZIG-12 PR B (testable without React).

'use strict'

function display(value, fallback) {
  if (value == null || value === '') return fallback == null ? '—' : fallback
  return String(value)
}

function formatTimestamp(value) {
  if (!value) return '—'
  var d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function deriveSummary(rows) {
  var list = rows || []
  var summary = {
    total: list.length,
    production: 0,
    pilot: 0,
    validation_ready: 0,
    unavailable: 0,
    contractor_visible: 0,
    worker_executable: 0,
  }
  for (var i = 0; i < list.length; i++) {
    var row = list[i] || {}
    if (row.lifecycle_state === 'production') summary.production += 1
    if (row.lifecycle_state === 'pilot') summary.pilot += 1
    if (row.lifecycle_state === 'validation_ready') summary.validation_ready += 1
    if (row.operational_health === 'unavailable') summary.unavailable += 1
    if (row.contractor_visible === true) summary.contractor_visible += 1
    if (row.worker_executable === true) summary.worker_executable += 1
  }
  return summary
}

function matchesSearch(row, query) {
  var q = String(query || '')
    .trim()
    .toLowerCase()
  if (!q) return true
  var name = String((row && row.name) || '').toLowerCase()
  var jurisdiction = String(
    ((row && row.county_or_city) || '') + ' ' + ((row && row.state) || '')
  ).toLowerCase()
  return name.indexOf(q) !== -1 || jurisdiction.indexOf(q) !== -1
}

function matchesFilters(row, filters) {
  var f = filters || {}
  if (f.lifecycle && row.lifecycle_state !== f.lifecycle) return false
  if (f.health && row.operational_health !== f.health) return false
  if (f.workflow_type && row.workflow_type !== f.workflow_type) return false
  if (f.active === 'true' && row.is_active !== true) return false
  if (f.active === 'false' && row.is_active === true) return false
  if (f.contractor_visible === 'true' && row.contractor_visible !== true) return false
  if (f.contractor_visible === 'false' && row.contractor_visible === true) return false
  if (f.worker_executable === 'true' && row.worker_executable !== true) return false
  if (f.worker_executable === 'false' && row.worker_executable === true) return false
  if (f.pilot_ready === 'true' && row.pilot_ready !== true) return false
  if (f.pilot_ready === 'false' && row.pilot_ready === true) return false
  if (f.has_blocker === 'true') {
    if (!row.primary_blocker && !(row.all_blockers && row.all_blockers.length)) return false
  }
  if (f.has_blocker === 'false') {
    if (row.primary_blocker || (row.all_blockers && row.all_blockers.length)) return false
  }
  return true
}

function filterRows(rows, query, filters) {
  return (rows || []).filter(function (row) {
    return matchesSearch(row, query) && matchesFilters(row, filters)
  })
}

function lifecycleBadge(lifecycle) {
  var known = {
    planned: { label: 'Planned', tone: 'neutral' },
    development: { label: 'Development', tone: 'neutral' },
    validation_ready: { label: 'Validation Ready', tone: 'info' },
    dry_run: { label: 'Dry Run', tone: 'info' },
    pilot: { label: 'Pilot', tone: 'warning' },
    production: { label: 'Production', tone: 'success' },
  }
  if (lifecycle && known[lifecycle]) return known[lifecycle]
  return {
    label: lifecycle ? String(lifecycle) : 'Unknown',
    tone: 'unknown',
  }
}

function healthBadge(health) {
  var known = {
    healthy: { label: 'Healthy', tone: 'success' },
    degraded: { label: 'Degraded', tone: 'warning' },
    unavailable: { label: 'Unavailable', tone: 'danger' },
  }
  if (health && known[health]) return known[health]
  return {
    label: health ? String(health) : 'Unknown',
    tone: 'unknown',
  }
}

/**
 * Truthful credential labeling — never imply contractor-specific readiness
 * when credential_scope is platform.
 */
function credentialDisplay(row) {
  var status = row && row.credential_status
  var scope = row && row.credential_scope
  if (status === 'not_required') {
    return {
      label: 'Not required',
      detail: 'Portal login credentials are not required for this workflow type.',
      tone: 'neutral',
    }
  }
  if (status === 'missing') {
    return {
      label: 'Credentials missing',
      detail:
        scope === 'company'
          ? 'This company does not have required credentials for this AHJ.'
          : 'No company has required credentials configured for this AHJ.',
      tone: 'danger',
    }
  }
  if (status === 'unknown') {
    return {
      label: 'Credentials unknown',
      detail: 'Credential presence could not be determined.',
      tone: 'unknown',
    }
  }
  if (status === 'configured') {
    if (scope === 'company') {
      return {
        label: 'Credentials configured',
        detail: 'This company has credentials configured for this AHJ.',
        tone: 'success',
      }
    }
    return {
      label: 'Credentials configured (any company)',
      detail:
        'At least one company has credentials configured for this AHJ. This does not confirm credentials for a specific contractor.',
      tone: 'success',
    }
  }
  return {
    label: display(status, 'Unknown'),
    detail: '',
    tone: 'unknown',
  }
}

function configDisplay(row) {
  var cfg = (row && row.config_status) || {}
  var status = cfg.status || 'unknown'
  var reasons = Array.isArray(cfg.reasons) ? cfg.reasons : []
  return {
    label: status,
    reasons: reasons,
    tone:
      status === 'ready'
        ? 'success'
        : status === 'incomplete'
          ? 'warning'
          : status === 'not_applicable'
            ? 'neutral'
            : 'unknown',
  }
}

function packetDisplay(row) {
  var pkt = (row && row.packet_status) || {}
  var status = pkt.status || 'not_applicable'
  return {
    label: status,
    reason: pkt.reason || null,
    applicable: status !== 'not_applicable',
    tone:
      status === 'ready'
        ? 'success'
        : status === 'missing' || status === 'invalid'
          ? 'danger'
          : 'neutral',
  }
}

function workflowLabel(workflowType) {
  if (workflowType === 'portal') return 'Portal'
  if (workflowType === 'pdf_packet') return 'PDF Packet'
  if (workflowType === 'hybrid') return 'Hybrid'
  if (workflowType === 'email') return 'Email'
  return display(workflowType, 'Unknown')
}

function jurisdictionLabel(row) {
  var city = (row && row.county_or_city) || ''
  var state = (row && row.state) || ''
  if (city && state) return city + ', ' + state
  return display(city || state, '—')
}

function hasMutationControls(markup) {
  // Defensive test helper — PR B UI must not include mutation affordances.
  var text = String(markup || '').toLowerCase()
  return (
    text.indexOf('type="checkbox"') !== -1 ||
    text.indexOf('activate') !== -1 ||
    text.indexOf('retry run') !== -1 ||
    text.indexOf('edit credentials') !== -1 ||
    text.indexOf('method="post"') !== -1 ||
    text.indexOf('method="patch"') !== -1 ||
    text.indexOf('method="delete"') !== -1
  )
}

function containsSecretBearingFields(payload) {
  var json = JSON.stringify(payload || {})
  var forbidden = [
    'encrypted_username',
    'encrypted_password',
    'password_encrypted',
    'portal_password',
    'SUPABASE_SERVICE_ROLE_KEY',
    '"password":',
    '"username":',
  ]
  for (var i = 0; i < forbidden.length; i++) {
    if (json.indexOf(forbidden[i]) !== -1) return true
  }
  return false
}

module.exports = {
  display: display,
  formatTimestamp: formatTimestamp,
  deriveSummary: deriveSummary,
  matchesSearch: matchesSearch,
  matchesFilters: matchesFilters,
  filterRows: filterRows,
  lifecycleBadge: lifecycleBadge,
  healthBadge: healthBadge,
  credentialDisplay: credentialDisplay,
  configDisplay: configDisplay,
  packetDisplay: packetDisplay,
  workflowLabel: workflowLabel,
  jurisdictionLabel: jurisdictionLabel,
  hasMutationControls: hasMutationControls,
  containsSecretBearingFields: containsSecretBearingFields,
}
