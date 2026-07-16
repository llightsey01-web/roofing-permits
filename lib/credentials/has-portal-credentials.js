// lib/credentials/has-portal-credentials.js
// Check whether a company has portal credentials for a given AHJ

import { createClient } from '../supabase-server.js'

/**
 * Returns true if vault or legacy credentials exist for this company + AHJ.
 */
export async function hasPortalCredentialsForAhj(companyId, ahjId, provider) {
  if (!companyId || !ahjId) return false
  const supabase = createClient()

  let vaultQuery = supabase
    .from('company_credentials')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('ahj_id', ahjId)
    .limit(1)

  const { data: byAhj } = await vaultQuery.maybeSingle()
  if (byAhj?.id) return true

  if (provider) {
    const { data: byProvider } = await supabase
      .from('company_credentials')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .eq('provider', provider)
      .limit(1)
      .maybeSingle()
    if (byProvider?.id) return true
  }

  const { data: legacy } = await supabase
    .from('company_ahj_credentials')
    .select('id')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  return Boolean(legacy?.id)
}
