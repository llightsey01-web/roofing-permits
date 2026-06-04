// automation/ahjs/shared/accela-base-runner.js
// Accela portal step scaffold — config-driven selectors, county runners fill in logic

const { runAutomationLifecycle } = require('./base-runner')

function sel(config, key, fallback) {
  var selectors = config.selectors || {}
  return selectors[key] || fallback || null
}

function stubStep(name) {
  return async function() {
    console.log('[accela-base] TODO: ' + name + ' — implement in county runner or extend accela-base')
    // Scaffold only — no portal interaction
  }
}

/**
 * Accela workflow scaffold (legacy + angular login types).
 * Steps map to standard Phase 1 permit application flow.
 */
async function runAccelaBasePortal(jobData, runId, runnerOptions, portalConfig, hooks) {
  var config = portalConfig

  return runAutomationLifecycle({
    jobData: jobData,
    runId: runId,
    runnerOptions: runnerOptions,
    config: config,
    hooks: hooks,
    executeSteps: async function(ctx) {
      var step = ctx.stepNumber

      // Step 1 — Login (accela_legacy: reCAPTCHA iframe | accela_angular: CommunityView)
      step = step + 1
      await ctx.runStep(step, 'login', stubStep(
        'login — config.loginType=' + (config.loginType || 'unknown') +
        ', selectors.loginUsername=' + sel(config, 'loginUsername', 'TODO')
      ))

      // Step 2 — Navigate to disclaimer
      step = step + 1
      await ctx.runStep(step, 'navigate_to_disclaimer', stubStep(
        'navigate_to_disclaimer — config.selectors.disclaimerUrl=' + sel(config, 'disclaimerUrl', 'TODO')
      ))

      // Step 3 — Accept disclaimer
      step = step + 1
      await ctx.runStep(step, 'accept_disclaimer', stubStep(
        'accept_disclaimer — checkbox=' + sel(config, 'disclaimerCheckbox', 'TODO')
      ))

      // Step 4 — Select permit type
      step = step + 1
      await ctx.runStep(step, 'select_permit_type', stubStep(
        'select_permit_type — permitType=' + (config.permitType || 'TODO') +
        ', selector=' + sel(config, 'permitTypeReRoof', 'TODO')
      ))

      // Step 5 — Fill address search
      step = step + 1
      var step5Checkpoint = {}
      await ctx.runStep(step, 'fill_address_search', async function() {
        console.log('[accela-base] TODO: fill_address_search')
        console.log('  streetNo=' + sel(config, 'streetNo', 'TODO'))
        console.log('  streetName=' + sel(config, 'streetName', 'TODO'))
        console.log('  addressSearchBtn=' + sel(config, 'addressSearchBtn', 'TODO'))
        step5Checkpoint.parcel = ''
      }, step5Checkpoint)

      // Step 6 — Select address result / confirm parcel on form
      step = step + 1
      var step6Checkpoint = {}
      await ctx.runStep(step, 'select_address_result', async function() {
        console.log('[accela-base] TODO: select_address_result')
        console.log('  addressResult=' + sel(config, 'addressResult', 'TODO'))
        console.log('  parcelNo=' + sel(config, 'parcelNo', 'TODO'))
        step6Checkpoint.parcel = ''
        step6Checkpoint.owner = ''
      }, step6Checkpoint)

      // Step 7 — Legal description (property appraiser / portal field)
      step = step + 1
      await ctx.runStep(step, 'fill_legal_description', stubStep(
        'fill_legal_description — legalDescription=' + sel(config, 'legalDescription', 'TODO') +
        ', legalDescriptionType=' + (config.legalDescriptionType || 'TODO')
      ))

      // Step 8 — Save & resume later (Phase 1 stop)
      step = step + 1
      var step7Checkpoint = {}
      await ctx.runStep(step, 'save_and_resume', async function() {
        console.log('[accela-base] TODO: save_and_resume')
        console.log('  saveAndResumeBtn=' + sel(config, 'saveAndResumeBtn', 'TODO'))
        step7Checkpoint.parcel = ''
        step7Checkpoint.owner = ''
        step7Checkpoint.portal_confirmation = null
      }, step7Checkpoint)

      ctx.stepNumber = step
      console.log('[accela-base] Scaffold complete (' + step + ' steps)')
    },
  })
}

module.exports = { runAccelaBasePortal, sel }
