import { createClient } from '@supabase/supabase-js'
import { resolveAHJ } from '../../../lib/ahj-resolver'

export async function POST(request) {
  try {
    const { propertyAddress, propertyCity, propertyState, propertyZip } = await request.json()

    if (!propertyAddress || !propertyCity || !propertyState || !propertyZip) {
      return Response.json({ error: 'Missing required address fields' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const result = await resolveAHJ(supabase, propertyAddress, propertyCity, propertyState, propertyZip)

    return Response.json(result)

  } catch (error) {
    console.error('Resolve AHJ error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}