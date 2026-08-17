// lib/ahj/contractor-credential-ahjs.js
// Contractor settings credential-entry AHJ visibility.
// Gate: is_active (validated/readiness) AND workflow_file (runner present).
// Not a Phase-1 lifecycle_state / operational_health gate.

'use strict'

/**
 * Pure visibility predicate matching the credential-entry list query.
 * Used by unit tests; production path applies the same rules via Supabase filters.
 */
function isVisibleForCredentialEntry(row) {
  if (!row) return false
  return row.is_active === true && row.workflow_file != null
}

/**
 * Fetch AHJs shown in contractor Settings → Add AHJ Credentials.
 * @param {object} supabase - browser or server Supabase client
 * @returns {Promise<{ data: Array|null, error: object|null }>}
 */
function fetchContractorCredentialAhjs(supabase) {
  return supabase
    .from('ahj_portals')
    .select('id, name, county_or_city, portal_url')
    .eq('is_active', true)
    .not('workflow_file', 'is', null)
    .order('name')
}

module.exports = {
  fetchContractorCredentialAhjs,
  isVisibleForCredentialEntry,
}
