// app/api/parcel-lookup/route.js
// Looks up parcel number from Florida Statewide Cadastral open data
// Free public API — no auth required

export async function POST(request) {
    try {
      const { address, city, zip } = await request.json()
      if (!address) return Response.json({ error: 'Address required' }, { status: 400 })
  
      const cleanAddress = address.trim().toUpperCase()
  
      // Try exact address first
      let result = await queryParcels(cleanAddress, zip)
      if (result) return Response.json(result)
  
      // Try looser match with just street number and name
      const parts = cleanAddress.split(' ')
      if (parts.length >= 2) {
        const looseAddress = parts.slice(0, 2).join(' ')
        result = await queryParcels(looseAddress, zip)
        if (result) return Response.json(result)
      }
  
      return Response.json({ found: false, message: 'No parcel found for this address' })
  
    } catch (err) {
      console.error('Parcel lookup error:', err.message)
      return Response.json({ error: err.message, found: false }, { status: 500 })
    }
  }
  
  async function queryParcels(addressSearch, zip) {
    try {
      // Florida Statewide Cadastral — public open data from FL Dept of Revenue
      // Layer 0 contains all parcels statewide
      let whereClause = `UPPER(PHY_ADDR1) LIKE '${addressSearch.replace(/'/g, "''")}%'`
      if (zip) {
        whereClause += ` AND PHY_ZIPCD = '${zip}'`
      }
  
      const params = new URLSearchParams({
        where: whereClause,
        outFields: 'PARCELNO,OWN_NAME,PHY_ADDR1,PHY_CITY,PHY_ZIPCD,S_LEGAL,CO_NAME',
        returnGeometry: 'false',
        resultRecordCount: '3',
        f: 'json',
      })
  
      const url = `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?${params}`
      console.log('Parcel query:', whereClause)
  
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AHJ-iQ/1.0' },
        signal: AbortSignal.timeout(15000),
      })
  
      if (!response.ok) {
        console.error('Parcel service HTTP error:', response.status)
        return null
      }
  
      const data = await response.json()
  
      if (data.error) {
        console.error('Parcel service error:', data.error.message)
        return null
      }
  
      console.log('Parcel results count:', data.features?.length || 0)
  
      if (!data.features || data.features.length === 0) return null
  
      const attr = data.features[0].attributes
      return {
        found: true,
        parcel_number: attr.PARCELNO || '',
        owner_name: attr.OWN_NAME || '',
        site_address: attr.PHY_ADDR1 || '',
        site_city: attr.PHY_CITY || '',
        site_zip: attr.PHY_ZIPCD || '',
        legal_description: attr.S_LEGAL || '',
        county: attr.CO_NAME || '',
      }
    } catch (err) {
      console.error('Query error:', err.message)
      return null
    }
  }