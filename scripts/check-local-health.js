const PORT = process.env.PORT || process.env.HEALTH_PORT || 3000
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 5000)

async function main() {
  try {
    const res = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.json().catch(() => null)

    if (res.ok && body?.ok) {
      console.log(`✓ Healthy — ${HEALTH_URL}`)
      console.log(JSON.stringify(body, null, 2))
      process.exit(0)
    }

    console.error(`✗ Unhealthy — HTTP ${res.status}`)
    if (body) console.error(JSON.stringify(body, null, 2))
    process.exit(1)
  } catch (err) {
    console.error(`✗ Down — ${err.message}`)
    console.error(`  ${HEALTH_URL}`)
    process.exit(1)
  }
}

main()
