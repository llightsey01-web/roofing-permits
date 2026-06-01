/**
 * Shared guard for server routes callable by automation (internal key) or logged-in users.
 */

export function isInternalApiRequest(request) {
  const expected = process.env.INTERNAL_API_KEY?.trim()
  if (!expected) return false
  const provided = request.headers.get('x-internal-api-key')?.trim()
  return !!provided && provided === expected
}
