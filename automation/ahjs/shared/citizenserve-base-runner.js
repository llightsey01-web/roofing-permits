// automation/ahjs/shared/citizenserve-base-runner.js
// CitizenServe portal scaffold — login and address flows differ from Accela

const { runAutomationLifecycle } = require('./base-runner')

function sel(config, key, fallback) {
  var selectors = config.selectors || {}
  return selectors[key] || fallback || null
}

function stubStep(name) {
  return async function() {
    console.log('[citizenserve-base] TODO: ' + name + ' — implement in county runner')
  }
}

/**
 * CitizenServe workflow scaffold.
 * Login is typically form-based (not Accela iframe). Address search UI differs.
 */
async function runCitizenserveBasePortal(jobData, runId, runnerOptions, portalConfig, hooks) {
  var config = portalConfig

  return runAutomationLifecycle({
    jobData: jobData,
    runId: runId,
    runnerOptions: runnerOptions,
    config: config,
    hooks: hooks,
    executeSteps: async function(ctx) {
      var step = ctx.stepNumber

      // Step 1 — Login (CitizenServe: no Accela iframe / different CAPTCHA rules)
      step = step + 1
      await ctx.runStep(step, 'login', stubStep(
        'login — portalUrl=' + (config.portalUrl || 'TODO') +
        ', loginEmail=' + sel(config, 'loginEmail', sel(config, 'loginUsername', 'TODO'))
      ))

      // Step 2 — Navigate to new permit / application entry
      step = step + 1
      await ctx.runStep(step, 'navigate_new_permit', stubStep(
        'navigate_new_permit — newPermitLink=' + sel(config, 'newPermitLink', 'TODO')
      ))

      // Step 3 — Select permit type / category
      step = step + 1
      await ctx.runStep(step, 'select_permit_type', stubStep(
        'select_permit_type — permitType=' + (config.permitType || 'TODO')
      ))

      // Step 4 — Address search (CitizenServe-specific search form)
      step = step + 1
      var addressCheckpoint = {}
      await ctx.runStep(step, 'search_address', async function() {
        console.log('[citizenserve-base] TODO: search_address')
        console.log('  addressStreetNumber=' + sel(config, 'addressStreetNumber', 'TODO'))
        console.log('  addressStreetName=' + sel(config, 'addressStreetName', 'TODO'))
        console.log('  searchButton=' + sel(config, 'searchButton', 'TODO'))
        addressCheckpoint.parcel = ''
      }, addressCheckpoint)

      // Step 5 — Select parcel / property from results
      step = step + 1
      var parcelCheckpoint = {}
      await ctx.runStep(step, 'select_parcel', async function() {
        console.log('[citizenserve-base] TODO: select_parcel')
        console.log('  parcelField=' + sel(config, 'parcelField', sel(config, 'parcelNo', 'TODO')))
        parcelCheckpoint.parcel = ''
        parcelCheckpoint.owner = ''
      }, parcelCheckpoint)

      // Step 6 — Fill application fields & save draft
      step = step + 1
      await ctx.runStep(step, 'save_draft', stubStep(
        'save_draft — saveResumeButton=' + sel(config, 'saveResumeButton', 'TODO')
      ))

      ctx.stepNumber = step
      console.log('[citizenserve-base] Scaffold complete (' + step + ' steps)')
    },
  })
}

module.exports = { runCitizenserveBasePortal, sel }
