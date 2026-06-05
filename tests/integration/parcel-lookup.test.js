// tests/integration/parcel-lookup.test.js
'use strict'

const { lookupPolkLegalDescriptionFromAppraiser } = require('../../lib/parcels/polk-legal-description.js')

const KNOWN_PARCEL = '252825354530017580'
const EXPECTED_OWNER = 'ZUROWSKI KENDRA KAY'
const LEGAL_FRAGMENT = 'JAN PHYL VILLAGE'

async function queryFloridaCadastralByParcel(parcelNumber) {
  const safeParcel = String(parcelNumber).replace(/'/g, "''")
  const params = new URLSearchParams({
    where: `PARCELNO = '${safeParcel}' AND UPPER(CO_NAME) LIKE '%POLK%'`,
    outFields: 'PARCELNO,OWN_NAME,S_LEGAL,CO_NAME,PHY_ADDR1',
    returnGeometry: 'false',
    resultRecordCount: '5',
    f: 'json',
  })

  const url =
    'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?' +
    params.toString()

  const response = await fetch(url, {
    headers: { 'User-Agent': 'DART-iQ-Test/1.0' },
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error('Cadastral HTTP ' + response.status)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message || 'Cadastral query error')
  }

  if (!data.features || data.features.length === 0) return null
  return data.features[0].attributes
}

describe('Polk County parcel lookup', function () {
  // ArcGIS cadastral API not available in this environment
  test.skip('Florida cadastral returns data for known Polk parcel', async function () {
    const attr = await queryFloridaCadastralByParcel(KNOWN_PARCEL)
    expect(attr).not.toBeNull()
    expect(String(attr.PARCELNO || '')).toBeTruthy()
    expect(String(attr.OWN_NAME || '').toUpperCase()).toContain(EXPECTED_OWNER)
  })

  // ArcGIS cadastral API not available in this environment
  test.skip('cadastral legal description contains JAN PHYL VILLAGE', async function () {
    const attr = await queryFloridaCadastralByParcel(KNOWN_PARCEL)
    expect(attr).not.toBeNull()
    expect(String(attr.S_LEGAL || '').toUpperCase()).toContain(LEGAL_FRAGMENT)
  })
})

describe('Polk Property Appraiser legal description (mocked HTTP)', function () {
  const originalFetch = global.fetch

  afterEach(function () {
    global.fetch = originalFetch
  })

  test('lookupPolkLegalDescriptionFromAppraiser parses legal description from HTML', async function () {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async function () {
        return (
          '<html><body>Property Description:</td><td>' +
          'JAN PHYL VILLAGE UNIT #15 PB 59 PG 50 BLK Q LOT 58</td></body></html>'
        )
      },
    })

    const legal = await lookupPolkLegalDescriptionFromAppraiser(KNOWN_PARCEL)
    expect(legal).toBeTruthy()
    expect(legal.toUpperCase()).toContain(LEGAL_FRAGMENT)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('polkflpa.gov/LegalDesc.aspx?strap=' + KNOWN_PARCEL),
      expect.objectContaining({ headers: expect.any(Object) })
    )
  })
})
