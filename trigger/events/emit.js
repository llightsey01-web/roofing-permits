import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/** Re-export durable event names for Trigger tasks. */
export function getEventNames() {
  const { EVENT_NAMES } = require('../../lib/workflow/constants.js')
  return EVENT_NAMES
}

export async function emitDomainEvent(input) {
  const { createWorkflowEngine } = require('../../lib/workflow')
  const engine = createWorkflowEngine()
  return engine.events.emitEvent(input || {})
}
