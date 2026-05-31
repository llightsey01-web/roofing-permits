// lib/epn/prepare-package.js
// Production ePN save-only package preparation — NEVER clicks #SendPackage

const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')
const {
  ensureWorklist,
  createProductionPackage,
  extractPackIdFromUrl,
} = require('./worklist-helpers')
const {
  selectDocumentType,
  clickWizardTab,
  uploadDocumentPdf,
  fillAndCommitParties,
  clickSaveButton,
  extractPackageStatus,
  extractDocumentRowStatus,
  collectSubmitButtonInventory,
  dismissInactivityWarning,
  inspectSendPackageBoundary,
} = require('./data-entry-helpers')
const {
  SendPackageSafetyError,
  isTestPackageName,
  isDummyDocumentPath,
  enforceDryRunSubmitBoundary,
  installDryRunSendPackageGuard,
} = require('./submit-safety')

function buildProductionPackageName(jobId, propertyAddress) {
  var address = String(propertyAddress || 'Unknown Address')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return 'AHJ-IQ NOC - ' + jobId + ' - ' + address
}

function buildPackageViewUrl(packId) {
  return epnConfig.portalUrl + '/Secure/Packages/PackageView.aspx?packId=' + packId + '&isArchived=false'
}

async function runPrepareEpnPackage(page, context) {
  var ctx = context || {}
  var job = ctx.job
  var jobId = ctx.jobId || (job && job.id)
  var localPdfPath = ctx.localPdfPath
  var outputDir = ctx.outputDir || join('automation', 'logs', 'epn-prepare-' + (jobId || Date.now()))
  mkdirSync(outputDir, { recursive: true })

  if (!jobId) throw new Error('jobId required')
  if (!localPdfPath) throw new Error('localPdfPath required')
  if (!job || !job.owner_name) throw new Error('job.owner_name required')
  if (!ctx.granteeName) throw new Error('granteeName (company) required')

  if (isDummyDocumentPath(localPdfPath)) {
    throw new SendPackageSafetyError('Refusing to upload dummy/test PDF path: ' + localPdfPath)
  }

  var packageName = buildProductionPackageName(jobId, job.property_address)
  if (isTestPackageName(packageName)) {
    throw new SendPackageSafetyError('Refusing production package with test name: ' + packageName)
  }

  await installDryRunSendPackageGuard(page)

  var result = {
    success: false,
    jobId: jobId,
    packageName: packageName,
    notarizedFilePath: ctx.notarizedFilePath || null,
    localPdfPath: localPdfPath,
    outputDir: outputDir,
  }

  page.on('dialog', async function(dialog) {
    console.log('Browser dialog (dismissed): ' + dialog.message())
    await dialog.dismiss().catch(function() {})
  })

  await ensureWorklist(page)

  console.log('Creating ePN package: ' + packageName)
  var createResult = await createProductionPackage(page, packageName, 'Polk County, FL')
  if (!createResult.created || !createResult.packId) {
    throw new Error('Failed to create ePN package: ' + (createResult.alertText || 'unknown error'))
  }
  result.packId = createResult.packId
  result.packageUrl = buildPackageViewUrl(createResult.packId)
  console.log('Package created: packId=' + result.packId)

  console.log('Selecting document type: Notice Of Commencement')
  var docTypeResult = await selectDocumentType(page, 'Notice Of Commencement')
  if (!docTypeResult.selected) throw new Error('Document type selection failed')
  result.documentTypeSelected = true

  console.log('Uploading notarized NOC: ' + localPdfPath)
  var uploadResult = await uploadDocumentPdf(page, localPdfPath)
  result.uploadResult = uploadResult
  if (!uploadResult.success) throw new Error('Notarized PDF upload failed: ' + (uploadResult.reason || 'unknown'))
  result.uploadSuccess = true
  console.log('Upload success')

  console.log('Committing parties...')
  await clickWizardTab(page, '#indexing-status')
  var partyResult = await fillAndCommitParties(page, {
    grantorName: job.owner_name,
    grantorRadio: 'person',
    granteeName: ctx.granteeName,
    granteeRadio: 'company',
  })
  result.partyResult = partyResult
  result.grantorAddSuccess = partyResult.grantor.success
  result.granteeAddSuccess = partyResult.grantee.success
  console.log('Grantor Add: ' + partyResult.grantor.success + ' Grantee Add: ' + partyResult.grantee.success)

  if (!partyResult.grantor.success || !partyResult.grantee.success) {
    throw new Error('Party commit failed — grantor=' + partyResult.grantor.success + ' grantee=' + partyResult.grantee.success)
  }

  console.log('Saving package (save-only — no submit)...')
  var saveResult = await clickSaveButton(page)
  result.saveResult = saveResult
  if (!saveResult.success) throw new Error('Save failed: ' + (saveResult.reason || 'unknown'))
  result.saveSuccess = true
  console.log('Save success')

  await dismissInactivityWarning(page)
  var postSaveStatus = await extractPackageStatus(page)
  var documentRowStatus = await extractDocumentRowStatus(page)
  var submitInventory = await collectSubmitButtonInventory(page)
  var sendBoundary = await inspectSendPackageBoundary(page)
  var dryRunBoundary = await enforceDryRunSubmitBoundary(page, { action: 'observe' })

  result.packageStatus = postSaveStatus.statusGuess || null
  result.documentStatus = documentRowStatus.documentStatus || null
  result.estimatedFees = postSaveStatus.feeSummary || null
  result.sendPackageVisible = submitInventory.hasSubmitButton
  result.sendPackageClicked = false
  result.sendBoundary = sendBoundary
  result.dryRunBoundary = dryRunBoundary

  var readyConfirmed = /\bready\b/i.test(result.packageStatus || '') &&
    /ready to send/i.test(documentRowStatus.bodySample || result.documentStatus || '') &&
    submitInventory.hasSubmitButton

  result.readyConfirmed = readyConfirmed

  if (dryRunBoundary.atBoundary) {
    console.log('Ready to Send reached. Live submit blocked for review.')
  }

  if (!readyConfirmed) {
    throw new Error('Package not Ready / Ready to Send — package=' + result.packageStatus + ' document=' + result.documentStatus)
  }

  writeFileSync(join(outputDir, 'epn-prepare-result.json'), JSON.stringify(result, null, 2))

  result.success = true
  return result
}

module.exports = {
  buildProductionPackageName,
  buildPackageViewUrl,
  runPrepareEpnPackage,
}
