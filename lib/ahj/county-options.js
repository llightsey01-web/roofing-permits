// lib/ahj/county-options.js
// Shared county / AHJ coverage helpers for onboarding + settings

const COUNTY_OPTIONS = [
  { id: 'polk', label: 'Polk County', provider: 'polk_accela' },
  { id: 'lee', label: 'Lee County', provider: 'lee_accela' },
  { id: 'manatee', label: 'Manatee County', provider: 'manatee_accela' },
  { id: 'sarasota', label: 'Sarasota County', provider: 'sarasota_accela' },
]

function normalizeCountyIds(raw) {
  const list = Array.isArray(raw) ? raw : []
  const allowed = new Set(COUNTY_OPTIONS.map(function (c) { return c.id }))
  const out = []
  for (let i = 0; i < list.length; i++) {
    const id = String(list[i] || '').toLowerCase().trim()
    if (allowed.has(id) && out.indexOf(id) === -1) out.push(id)
  }
  return out
}

function getCountyById(id) {
  return COUNTY_OPTIONS.find(function (c) { return c.id === id }) || null
}

function providerForCountyId(id) {
  const county = getCountyById(id)
  return county ? county.provider : null
}

function matchPortalToCounty(portal, countyId) {
  if (!portal || !countyId) return false
  const hay = ((portal.name || '') + ' ' + (portal.county_or_city || '') + ' ' + (portal.credential_key || '')).toLowerCase()
  return hay.includes(countyId)
}

function inferCountyIdFromPortal(portal) {
  if (!portal) return null
  for (let i = 0; i < COUNTY_OPTIONS.length; i++) {
    if (matchPortalToCounty(portal, COUNTY_OPTIONS[i].id)) return COUNTY_OPTIONS[i].id
  }
  return null
}

function providerForPortal(portal) {
  const countyId = inferCountyIdFromPortal(portal)
  if (countyId) return providerForCountyId(countyId)
  const key = String(portal?.credential_key || '').toLowerCase()
  if (key.includes('polk')) return 'polk_accela'
  if (key.includes('lee')) return 'lee_accela'
  if (key.includes('manatee')) return 'manatee_accela'
  if (key.includes('sarasota')) return 'sarasota_accela'
  return null
}

module.exports = {
  COUNTY_OPTIONS,
  normalizeCountyIds,
  getCountyById,
  providerForCountyId,
  matchPortalToCounty,
  inferCountyIdFromPortal,
  providerForPortal,
}
