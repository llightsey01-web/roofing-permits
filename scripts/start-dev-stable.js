const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

require('dotenv').config({ path: '.env.local' })

const PORT = Number(process.env.PORT || 3000)
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`
const HEALTH_INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS || 10000)
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 5000)
const MAX_CONSECUTIVE_FAILURES = Number(process.env.HEALTH_MAX_FAILURES || 3)
const RESTART_DELAY_MS = Number(process.env.RESTART_DELAY_MS || 2000)

let child = null
let restarting = false
let consecutiveFailures = 0
let healthTimer = null
let shutdownRequested = false
let restartCount = 0

function log(message) {
  console.log(`[dev:stable ${new Date().toISOString()}] ${message}`)
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function checkHealth() {
  try {
    const res = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (!res.ok) return false
    const body = await res.json()
    return body.ok === true
  } catch {
    return false
  }
}

async function ensureNoDuplicate() {
  const healthy = await checkHealth()
  if (healthy) {
    log(`Server already healthy at ${HEALTH_URL}. Not starting a duplicate.`)
    log('Use npm run health to verify, or stop the existing server first.')
    process.exit(0)
  }

  const inUse = await isPortInUse(PORT)
  if (inUse) {
    log(`Port ${PORT} is in use but the health check failed.`)
    log('See docs/local-dev-stability.md for freeing a stuck port.')
    process.exit(1)
  }
}

function startDev() {
  const projectRoot = path.join(__dirname, '..')

  log(restartCount === 0 ? 'Starting Next.js dev server...' : `Restarting dev server (restart #${restartCount})...`)

  child = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT) },
    shell: process.platform === 'win32',
  })

  child.on('exit', (code, signal) => {
    child = null
    if (shutdownRequested) {
      log('Dev server stopped.')
      return
    }

    restartCount += 1
    log(
      `Dev server crashed or exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}). ` +
        `Restarting in ${RESTART_DELAY_MS}ms...`
    )
    setTimeout(startDev, RESTART_DELAY_MS)
  })

  child.on('error', (err) => {
    log(`Failed to spawn dev server: ${err.message}`)
  })
}

async function restartDev() {
  if (restarting || shutdownRequested) return

  restarting = true
  restartCount += 1
  log(`Health checks failed ${MAX_CONSECUTIVE_FAILURES} times. Restarting unresponsive server...`)

  if (child) {
    child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 2000))
    if (child) {
      child.kill('SIGKILL')
    }
  } else {
    startDev()
  }

  restarting = false
}

async function pollHealth() {
  if (shutdownRequested) return

  const ok = await checkHealth()
  if (ok) {
    if (consecutiveFailures > 0) {
      log('Health recovered.')
    }
    consecutiveFailures = 0
    return
  }

  if (!child) return

  consecutiveFailures += 1
  log(`Health check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`)

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    consecutiveFailures = 0
    await restartDev()
  }
}

function shutdown() {
  if (shutdownRequested) return
  shutdownRequested = true
  log('Shutting down...')
  clearInterval(healthTimer)
  if (child) {
    child.kill('SIGTERM')
  } else {
    process.exit(0)
  }
}

async function main() {
  await ensureNoDuplicate()
  startDev()
  healthTimer = setInterval(pollHealth, HEALTH_INTERVAL_MS)

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`)
  process.exit(1)
})
