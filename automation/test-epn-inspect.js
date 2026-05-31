require('dotenv').config({ path: '.env.local' })
const { join } = require('path')
const { withEpnSession } = require('../lib/epn/epn-session')
const { validateEpnCredentials } = require('../lib/epn/validate-credentials')
const { explorePortal } = require('../lib/epn/inspect')
const { explorePackageEditorDeep } = require('../lib/epn/deep-inspect')
const { exploreDocumentWizard } = require('../lib/epn/doc-wizard-inspect')
const { exploreMetadataInspection } = require('../lib/epn/metadata-inspect')
const { exploreUploadDummyInspection } = require('../lib/epn/upload-dummy-inspect')
const { exploreSaveDummyInspection } = require('../lib/epn/save-dummy-inspect')
const { exploreReopenDocInspection } = require('../lib/epn/reopen-doc-inspect')
const { explorePartyAddInspection } = require('../lib/epn/party-add-inspect')
const { exploreSendInspect } = require('../lib/epn/send-inspect')
const {
  assertInspectionDryRun,
  ensureAccidentalSubmitLogged,
  installDryRunSendPackageGuard,
  SendPackageSafetyError,
} = require('../lib/epn/submit-safety')
const epnConfig = require('./ahjs/configs/epn.config')

function parseArgs(argv) {
  return {
    deep: argv.includes('--deep'),
    docWizard: argv.includes('--doc-wizard'),
    metadata: argv.includes('--metadata'),
    uploadDummy: argv.includes('--upload-dummy'),
    saveDummy: argv.includes('--save-dummy'),
    reopenDoc: argv.includes('--reopen-doc'),
    partyAdd: argv.includes('--party-add'),
    sendInspect: argv.includes('--send-inspect'),
    liveSubmit: argv.includes('--live-submit'),
    dryRun: !argv.includes('--live-submit'),
  }
}

function modeLabel(opts) {
  if (opts.sendInspect) return ' (PASS 9 — SEND PACKAGE INSPECTION)'
  if (opts.partyAdd) return ' (PASS 8 — COMMIT PARTIES + SAVE)'
  if (opts.reopenDoc) return ' (PASS 7 — REOPEN DOCUMENT 1 AFTER SAVE)'
  if (opts.saveDummy) return ' (PASS 6 — SAVE AFTER DUMMY UPLOAD)'
  if (opts.uploadDummy) return ' (PASS 5 — DUMMY PDF UPLOAD)'
  if (opts.metadata) return ' (PASS 4 — METADATA / NOC FIELDS)'
  if (opts.docWizard) return ' (PASS 3 — DOC WIZARD)'
  if (opts.deep) return ' (DEEP PASS 2)'
  return ''
}

async function main() {
  var opts = parseArgs(process.argv.slice(2))

  assertInspectionDryRun(opts)
  ensureAccidentalSubmitLogged()

  console.log('========================================')
  console.log('ePN PORTAL INSPECTION' + modeLabel(opts))
  console.log('========================================')
  console.log('Portal: ' + epnConfig.loginUrl)
  console.log('DRY-RUN mode: ' + opts.dryRun)
  console.log('Does NOT submit or record anything live.')
  console.log('HARD RULE: #SendPackage is NEVER clicked in this script.')
  if (opts.sendInspect) {
    console.log('Send inspect mode: read-only #SendPackage metadata — no click, no submit, no record, no payment.')
  } else if (opts.partyAdd) {
    console.log('Party add mode: commit grantor/grantee via Add, Save, inspect status — no submit, no record.')
  } else if (opts.reopenDoc) {
    console.log('Reopen doc mode: save dummy package, reopen Document 1, inspect incomplete fields — no submit, no record.')
  } else if (opts.saveDummy) {
    console.log('Save dummy mode: upload test PDF, fill indexing, Save only — no submit, no record.')
  } else if (opts.uploadDummy) {
    console.log('Upload dummy mode: test PDF only — no real NOC, no submit, no record.')
  } else if (opts.metadata) {
    console.log('Metadata mode: Notice Of Commencement field inspection — no uploads, no submit.')
  } else if (opts.docWizard) {
    console.log('Doc wizard mode: Add A Doc inspection only — no uploads, no submit.')
  } else if (opts.deep) {
    console.log('Deep mode: package editor inspection only — no uploads, no submit.')
  }
  console.log('========================================\n')

  var credentialError = validateEpnCredentials()
  if (credentialError) {
    console.error('Inspection aborted: ' + credentialError)
    process.exit(1)
  }

  var outputDir = join('automation', 'logs', 'epn-inspect-' + Date.now())

  var result = await withEpnSession(async function(page) {
    await installDryRunSendPackageGuard(page)

    if (opts.sendInspect) {
      return exploreSendInspect(page, outputDir)
    }
    if (opts.partyAdd) {
      return explorePartyAddInspection(page, outputDir)
    }
    if (opts.reopenDoc) {
      return exploreReopenDocInspection(page, outputDir)
    }
    if (opts.saveDummy) {
      return exploreSaveDummyInspection(page, outputDir)
    }
    if (opts.uploadDummy) {
      return exploreUploadDummyInspection(page, outputDir)
    }
    if (opts.metadata) {
      return exploreMetadataInspection(page, outputDir)
    }
    if (opts.docWizard) {
      return exploreDocumentWizard(page, outputDir)
    }
    if (opts.deep) {
      return explorePackageEditorDeep(page, outputDir)
    }
    return explorePortal(page, outputDir)
  }, { headless: false, slowMo: 400 })

  if (!result || result.skipped) {
    console.error(result?.reason || 'Inspection skipped')
    process.exit(1)
  }

  if (opts.sendInspect) {
    console.log('\nSend inspect complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Ready status confirmed: ' + result.readyConfirmed)
    console.log('SendPackage clicked: false (hard safety rule)')
    console.log('SendPackage skipped: true')
    console.log('Outcome: ' + (result.outcome || 'unknown'))
    console.log('Opened modal: false')
    console.log('Immediate submit: false')
    console.log('Final confirm selector: ' + (result.finalConfirmSelector ? JSON.stringify(result.finalConfirmSelector) : 'none captured'))
    console.log('Fee summary: ' + (result.feeSummary || 'unknown'))
    console.log('Payment language: ' + (result.paymentLanguage || 'none'))
    console.log('Cleanup: ' + (result.discardResult.discarded ? 'deleted (' + result.discardResult.method + ')' : result.discardResult.reason || 'failed'))
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Confirmation text: ' + result.confirmationPath)
    console.log('Dangerous buttons: ' + result.dangerousPath)
    console.log('Fee summary file: ' + result.feePath)
    console.log('Safety verdict: ' + result.verdictPath)
    return
  }

  if (opts.partyAdd) {
    console.log('\nParty add inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Grantor Add success: ' + result.grantorAddSuccess)
    console.log('Grantee Add success: ' + result.granteeAddSuccess)
    console.log('Party rows/chips appeared: ' + result.partyRowsAppeared)
    console.log('Save success: ' + result.saveSuccess)
    console.log('Document status after Save: ' + (result.documentStatus || 'unknown'))
    console.log('Package status: ' + (result.packageStatus || 'unknown'))
    console.log('Still incomplete: ' + result.stillIncomplete)
    console.log('Submit/Send/Record button visible: ' + result.hasSubmitButton)
    console.log('Ready button visible: ' + result.hasReadyButton)
    console.log('Current package cleanup: ' + (result.discardResult.discarded ? 'deleted (' + result.discardResult.method + ')' : 'failed — ' + (result.discardResult.reason || 'unknown')))
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Party add result: ' + result.resultPath)
    console.log('Post-save status: ' + result.statusPath)
    console.log('Submit inventory: ' + result.submitPath)
    console.log('Incomplete after party add: ' + result.incompletePath)
    return
  }

  if (opts.reopenDoc) {
    console.log('\nReopen doc inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Save success: ' + result.saveSuccess)
    console.log('Document 1 reopen success: ' + result.reopenSuccess + (result.reopenResult && result.reopenResult.method ? ' (' + result.reopenResult.method + ')' : ''))
    console.log('Fields found after reopen: ' + JSON.stringify(result.fieldsFound))
    console.log('Incomplete reasons: ' + ((result.incompleteAnalysis && result.incompleteAnalysis.incompleteReasons) || []).length)
    ;((result.incompleteAnalysis && result.incompleteAnalysis.incompleteReasons) || []).slice(0, 8).forEach(function(r) {
      console.log('  - [' + r.type + '] ' + (r.heading || r.text || r.parentText || r.selector || ''))
    })
    console.log('Submit button visible: ' + result.hasSubmitButton)
    console.log('Ready button visible: ' + result.hasReadyButton)
    console.log('Current package cleanup: ' + (result.discardResult.discarded ? 'deleted (' + result.discardResult.method + ')' : 'failed — ' + (result.discardResult.reason || 'unknown')))
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Incomplete fields: ' + result.incompleteFieldsPath)
    console.log('Validation: ' + result.validationPath)
    console.log('NOC mapping: ' + result.nocMappingPath)
    console.log('Button inventory: ' + result.buttonInventoryPath)
    return
  }

  if (opts.saveDummy) {
    console.log('\nSave dummy inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Dummy upload success: ' + result.dummyUploadSuccess)
    console.log('Grantor/grantee fill success: ' + result.grantorGranteeFillSuccess)
    console.log('Save success: ' + result.saveSuccess)
    console.log('Fields revealed after save: ' + JSON.stringify(result.fieldsRevealed))
    console.log('Package status after save: ' + (result.packageStatusAfterSave || 'unknown'))
    console.log('Fee summary: ' + (result.feeSummary || 'unknown'))
    console.log('Required fields: ' + result.requiredFieldCount)
    console.log('Current package cleanup: ' + (result.discardResult.discarded ? 'deleted (' + result.discardResult.method + ')' : 'failed — ' + (result.discardResult.reason || 'unknown')))
    if (result.staleCleanupResults && result.staleCleanupResults.length) {
      console.log('Stale cleanup:')
      result.staleCleanupResults.forEach(function(r) {
        console.log('  ' + r.packId + ': ' + (r.discarded ? 'deleted' : (r.skipped ? 'skipped' : 'failed')))
      })
    }
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Required fields: ' + result.requiredFieldsPath)
    console.log('Status: ' + result.statusPath)
    console.log('NOC mapping: ' + result.nocMappingPath)
    return
  }

  if (opts.uploadDummy) {
    console.log('\nUpload dummy inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Doc type selected: ' + result.docTypeSelected)
    console.log('Dummy upload success: ' + result.dummyUploadSuccess)
    console.log('Fields revealed after upload: ' + JSON.stringify(result.fieldsRevealed))
    console.log('Total fields captured: ' + result.totalFieldsCaptured)
    console.log('Required fields: ' + result.requiredFieldCount)
    console.log('Current package cleanup: ' + (result.discardResult.discarded ? 'discarded (' + result.discardResult.method + ')' : 'failed — ' + (result.discardResult.reason || 'unknown')))
    if (result.staleCleanupResults && result.staleCleanupResults.length) {
      console.log('Stale cleanup:')
      result.staleCleanupResults.forEach(function(r) {
        console.log('  ' + r.packId + ': ' + (r.discarded ? 'deleted' : (r.skipped ? 'skipped' : 'failed')))
      })
    }
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Required fields: ' + result.requiredFieldsPath)
    console.log('NOC upload mapping: ' + result.nocMappingPath)
    return
  }

  if (opts.metadata) {
    console.log('\nMetadata inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Doc type selected: ' + result.docTypeSelected)
    console.log('Metadata fields found: ' + result.metadataFieldCount)
    console.log('Total fields captured: ' + result.totalFieldsCaptured)
    console.log('Required fields: ' + result.requiredFieldCount)
    console.log('File input selector found: ' + result.fileInputSelectorFound)
    console.log('Cleanup: ' + (result.discardResult.discarded ? 'discarded (' + result.discardResult.method + ')' : 'left as draft — ' + (result.discardResult.reason || 'unknown')))
    if (!result.discardResult.discarded && result.packId) {
      console.log('Manual cleanup packId: ' + result.packId)
    }
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Required fields: ' + result.requiredFieldsPath)
    console.log('File upload selectors: ' + result.fileUploadPath)
    console.log('NOC mapping: ' + result.nocMappingPath)
    return
  }

  if (opts.docWizard) {
    console.log('\nDoc wizard inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package created: ' + result.packageCreated)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Editor opened: ' + result.editorOpened)
    console.log('Add A Doc clicked: ' + result.addDocClicked)
    console.log('Upload selectors found: ' + result.uploadSelectorsFound)
    console.log('Document type options found: ' + result.documentTypeOptionsFound)
    console.log('Required fields found: ' + result.requiredFieldCount)
    console.log('Dangerous buttons found (not clicked): ' + (result.requiredFields.dangerousButtons || []).length)
    ;(result.requiredFields.dangerousButtons || []).slice(0, 5).forEach(function(btn) {
      console.log('  - [' + btn.text + '] ' + btn.selector)
    })
    console.log('Cleanup: ' + (result.discardResult.discarded ? 'discarded (' + result.discardResult.method + ')' : 'left as draft — ' + (result.discardResult.reason || 'unknown')))
    console.log('Summary: ' + result.summaryPath)
    console.log('Selectors: ' + result.selectorsPath)
    console.log('Fields: ' + result.fieldsPath)
    return
  }

  if (opts.deep) {
    console.log('\nDeep inspection complete')
    console.log('Output dir: ' + result.outputDir)
    console.log('Package editor opened: ' + result.editorOpened)
    console.log('Package ID: ' + (result.packId || 'not captured'))
    console.log('Editor URL: ' + (result.editorUrl || 'n/a'))
    console.log('Upload selectors found: ' + result.requiredFields.uploadSelectors.length)
    console.log('Required fields found: ' + result.requiredFields.allFields.length)
    console.log('Document type options found: ' + result.requiredFields.documentTypeSelectors.reduce(function(sum, s) {
      return sum + (s.options || []).length
    }, 0))
    console.log('Dangerous buttons found (not clicked): ' + result.requiredFields.dangerousButtons.length)
    if (result.requiredFields.dangerousButtons.length) {
      result.requiredFields.dangerousButtons.slice(0, 5).forEach(function(btn) {
        console.log('  - [' + btn.text + '] ' + btn.selector)
      })
    }
    console.log('Discard result: ' + (result.discardResult.discarded ? 'discarded (' + result.discardResult.method + ')' : 'left as test draft — ' + (result.discardResult.reason || 'unknown')))
    console.log('Package editor selectors: ' + result.packageEditorSelectorsPath)
    console.log('Required fields: ' + result.requiredFieldsPath)
    console.log('Deep navigation map: ' + result.deepNavigationMapPath)
    return
  }

  console.log('\nInspection complete')
  console.log('Output dir: ' + result.outputDir)
  console.log('Pages inspected: ' + result.pagesInspected)
  console.log('Selectors: ' + result.selectorsPath)
  console.log('Navigation map: ' + result.navigationMapPath)
  console.log('Build plan: ' + result.buildPlanPath)
  console.log('\nPlanned automation path:')
  ;(result.buildPlan.phases || []).forEach(function(phase) {
    console.log('  ' + phase.step + '. ' + phase.name)
  })
}

main().catch(function(err) {
  if (err instanceof SendPackageSafetyError) {
    console.error('ePN safety violation:', err.message)
    if (err.details) console.error('Details:', JSON.stringify(err.details, null, 2))
    process.exit(2)
  }
  console.error('ePN inspection failed:', err.message)
  process.exit(1)
})
