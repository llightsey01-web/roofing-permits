// automation/ahjs/shared/custom-base-runner.js
// Minimal scaffold for non-Accela, non-CitizenServe portals

const { runAutomationLifecycle } = require('./base-runner')

function stubStep(name) {
  return async function() {
    console.log('[custom-base] TODO: ' + name + ' — implement bespoke county runner')
  }
}

/**
 * Custom portal scaffold — enforces logging, checkpoints, recovery, browser lifecycle only.
 * County runners define their own step sequence inside executeSteps override or wrap this.
 */
async function runCustomBasePortal(jobData, runId, runnerOptions, portalConfig, hooks) {
  var config = portalConfig

  return runAutomationLifecycle({
    jobData: jobData,
    runId: runId,
    runnerOptions: runnerOptions,
    config: config,
    hooks: hooks,
    executeSteps: async function(ctx) {
      var step = ctx.stepNumber

      // Step 1 — Login (portal-specific)
      step = step + 1
      await ctx.runStep(step, 'login', stubStep('login — custom portal'))

      // Step 2 — Primary workflow action (placeholder)
      step = step + 1
      var checkpoint = {}
      await ctx.runStep(step, 'primary_action', async function() {
        console.log('[custom-base] TODO: primary_action — define steps in county runner')
        console.log('  config.notes:', config.notes || '(none)')
        checkpoint.status = 'stub'
      }, checkpoint)

      ctx.stepNumber = step
      console.log('[custom-base] Scaffold complete (' + step + ' steps)')
    },
  })
}

module.exports = { runCustomBasePortal }
