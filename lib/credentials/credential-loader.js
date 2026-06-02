// lib/credentials/credential-loader.js
// Unified credential loader for all workers and automation modules
// Currently reads from process.env — future: reads from Supabase company_credentials table
'use strict'

/**
 * Load credentials for a given provider/company/AHJ combination.
 *
 * @param {object} opts
 * @param {string} opts.provider - 'epn' | 'proof' | 'twocaptcha' | 'supabase' | 'polk_county' | 'lee_county' | etc
 * @param {string} [opts.companyId] - UUID of the roofing company (for AHJ portal creds)
 * @param {string} [opts.ahjId] - UUID of the AHJ portal (for AHJ portal creds)
 * @returns {object} credentials object — shape depends on provider
 */
async function getCredential({ provider, companyId, ahjId }) {
  switch (provider) {
    case 'epn':
      return {
        email: process.env.EPN_EMAIL,
        password: process.env.EPN_PASSWORD,
      }
    case 'proof':
      return {
        email: process.env.PROOF_EMAIL,
        password: process.env.PROOF_PASSWORD,
      }
    case 'twocaptcha':
      return {
        apiKey: process.env.TWOCAPTCHA_API_KEY,
      }
    case 'supabase':
      return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      }
    case 'polk_county':
      // Future: load from company_ahj_credentials by companyId + ahjId
      return {
        username: process.env.POLK_COUNTY_USERNAME,
        password: process.env.POLK_COUNTY_PASSWORD,
      }
    case 'lee_county':
      // Future: load from company_ahj_credentials by companyId + ahjId
      return {
        username: process.env.LEE_COUNTY_USERNAME,
        password: process.env.LEE_COUNTY_PASSWORD,
      }
    default:
      throw new Error('Unknown credential provider: ' + provider)
  }
}

module.exports = { getCredential }
