import { resolveAHJ } from '../../../lib/ahj-resolver'
import { authenticateRequest } from '../../../lib/auth/session.js'

export async function POST(request) {
  try {
    const context = await authenticateRequest(request)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { propertyAddress, propertyCity, propertyState, propertyZip } = await request.json()

    if (!propertyAddress || !propertyCity || !propertyState || !propertyZip) {
      return Response.json({ error: 'Missing required address fields' }, { status: 400 })
    }

    const result = await resolveAHJ(
      context.userSupabase,
      propertyAddress,
      propertyCity,
      propertyState,
      propertyZip
    )

    return Response.json(result)

  } catch (error) {
    console.error('Resolve AHJ error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}