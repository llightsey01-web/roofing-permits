// lib/ahj/contractor-credential-ahjs.js
// Contractor settings credential-entry AHJ visibility (ZIG-5 + ZIG-6).
// Query pushdown must match contractorCanSeeAhj() — never broad-fetch + client filter.

'use strict'

var readiness = require('./ahj-readiness.js')

/**
 * @deprecated Prefer contractorCanSeeAhj from ahj-readiness.js.
 * Kept as a thin alias so ZIG-5 import sites/tests keep working.
 */
function isVisibleForCredentialEntry(row) {
  return readiness.contractorCanSeeAhj(row)
}

/**
 * Fetch AHJs shown in contractor Settings → Add AHJ Credentials.
 * Predicate pushed into PostgREST filters (fail-closed at network boundary).
 * @param {object} supabase
 * @returns {Promise<{ data: Array|null, error: object|null }>}
 */
function fetchContractorCredentialAhjs(supabase) {
  return supabase
    .from('ahj_portals')
    .select('id, name, county_or_city, portal_url')
    .eq('is_active', true)
    .in('lifecycle_state', ['pilot', 'production'])
    .neq('operational_health', 'unavailable')
    .or('workflow_type.neq.portal,workflow_file.not.is.null')
    .order('name')
}

module.exports = {
  fetchContractorCredentialAhjs,
  isVisibleForCredentialEntry,
  contractorCanSeeAhj: readiness.contractorCanSeeAhj,
}
