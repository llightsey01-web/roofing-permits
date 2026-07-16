export async function GET() {
  return Response.json(
    {
      ok: true,
      service: 'roofing-permits',
      timestamp: new Date().toISOString(),
      env: process.env.ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    },
    { status: 200 }
  )
}
