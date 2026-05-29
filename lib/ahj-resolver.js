// lib/ahj-resolver.js
// Takes a property address and returns the correct AHJ from the database
// Uses Google Maps Geocoding API to get municipality, then matches to ahj_portals table

export async function resolveAHJ(supabase, propertyAddress, propertyCity, propertyState, propertyZip) {
    try {
      // Step 1: Geocode the address to get municipality details
      const fullAddress = `${propertyAddress}, ${propertyCity}, ${propertyState} ${propertyZip}`
      const encodedAddress = encodeURIComponent(fullAddress)
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  
      const geoResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`
      )
      const geoData = await geoResponse.json()
  
      if (geoData.status !== 'OK' || !geoData.results.length) {
        return { ahj: null, method: 'geocode_failed', municipality: null }
      }
  
      // Step 2: Extract municipality name from Google's response
      const components = geoData.results[0].address_components
      let municipality = null
      let county = null
  
      for (const component of components) {
        if (component.types.includes('locality')) {
          municipality = component.long_name
        }
        if (component.types.includes('administrative_area_level_2')) {
          county = component.long_name
        }
      }
  
      // Step 3: Try to find a city-level AHJ first
      // If the address is inside an incorporated city, the city AHJ takes priority
      if (municipality) {
        const { data: cityAHJ } = await supabase
          .from('ahj_portals')
          .select('*')
          .eq('is_active', true)
          .ilike('county_or_city', `%${municipality}%`)
          .not('county_or_city', 'ilike', '%County%')
          .single()
  
        if (cityAHJ) {
          return {
            ahj: cityAHJ,
            method: 'city_match',
            municipality,
            county,
          }
        }
      }
  
      // Step 4: Fall back to county-level AHJ
      // Address is in unincorporated county land
      if (county) {
        const { data: countyAHJ } = await supabase
          .from('ahj_portals')
          .select('*')
          .eq('is_active', true)
          .ilike('county_or_city', `%${county}%`)
          .single()
  
        if (countyAHJ) {
          return {
            ahj: countyAHJ,
            method: 'county_match',
            municipality,
            county,
          }
        }
      }
  
      // Step 5: No match found — needs manual selection
      return {
        ahj: null,
        method: 'no_match',
        municipality,
        county,
      }
  
    } catch (error) {
      console.error('AHJ resolver error:', error)
      return { ahj: null, method: 'error', error: error.message }
    }
  }