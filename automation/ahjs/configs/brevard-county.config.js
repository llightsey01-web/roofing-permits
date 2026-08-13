/**
 * Brevard County Citizen Access (Accela BREVARD / BASS) config.
 *
 * Jurisdiction verification 2026-08-13 (hard gate — 2+ FL signals):
 * 1. Portal phone 321-633-2068 (Brevard / Space Coast FL area code) on Default.aspx
 * 2. Official emails @BrevardFL.gov / noreply@brevardcounty.us on portal
 * 3. Official county page
 *    https://www.brevardfl.gov/PlanningAndDevelopment/BuildingPermits/OnlinePermittingBASS
 *    documents BASS and links https://acaweb.brevardcounty.us/citizenaccess
 *
 * Public inspection (no login):
 * - Login: Angular CommunityView iframe
 *   /BREVARD/AngularUI/CommunityView/login-panel?inLegacyUI=true
 * - Shell: county-branded BASS + legacy module tabs (Home/Building/Development/Enforcement)
 * - Apply: /BREVARD/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building
 * - Agency code: BREVARD (AgencyCode = 'BREVARD' in page source)
 * - Runtime seed URL aca-prod.accela.com/BREVARD is Accela-hosted; county also
 *   advertises acaweb.brevardcounty.us/citizenaccess as the BASS entry alias.
 *
 * ASI CapEdit field IDs are PLACEHOLDERS until authenticated CapEdit discovery.
 */

module.exports = {
  id: 'brevard-county',
  name: 'Brevard County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/BREVARD/Login.aspx',
  loginType: 'accela_angular',
  captchaType: 'none',
  workflowFile: 'brevard-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'BREVARD_COUNTY',
  sessionProvider: 'brevard_accela',
  // TODO: confirm exact CapType label after authenticated CapType page
  permitType: 'Re-Roof Permit',
  version: 1,
  lastVerified: '2026-08-13-public-only',
  loginWaitMs: 3000,

  selectors: {
    loginFrameUrlPattern: /login-panel/,
    loginUsername: '[name="username"]',
    loginPassword: '[name="password"]',
    loginSubmit: 'button:has-text("Sign In")',
    loginSuccessUrl: '**/Dashboard.aspx**',

    disclaimerUrl:
      'https://aca-prod.accela.com/BREVARD/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    // TODO: confirm exact Re-Roof CapType label after authenticated CapType page
    permitTypeReRoof: 'text=Re-Roof Permit',

    myRecordsUrl: 'https://aca-prod.accela.com/BREVARD/Cap/MyRecordsCap.aspx',
    capHomeUrl:
      'https://aca-prod.accela.com/BREVARD/Cap/CapHome.aspx?module=Building&TabName=Building',
    resultGrid: 'table[id$="gdvPermitList"]',
    attachmentsListUrl: '/BREVARD/FileUpload/AttachmentsList.aspx',
    accountManagerUrl: 'https://aca-prod.accela.com/BREVARD/Account/AccountManager.aspx',

    streetNo: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtStreetNo',
    streetName: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtStreetName',
    streetDirection: '#ctl00_PlaceHolderMain_WorkLocationEdit_ddlStreetDirection',
    streetType: '#ctl00_PlaceHolderMain_WorkLocationEdit_ddlStreetSuffix',
    unitNo: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtUnitNo',
    city: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtCity',
    state: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtState_State1',
    zip: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtZip',
    addressSearchBtn: '#ctl00_PlaceHolderMain_WorkLocationEdit_btnSearch',
    addressResult: '#ctl00_PlaceHolderMain_WorkLocationEdit .ACA_Grid_Row',
    saveAndResumeBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnSave',

    parcelNo: '#ctl00_PlaceHolderMain_ParcelEdit_txtParcelNo',
    parcelSearchBtn: '#ctl00_PlaceHolderMain_ParcelEdit_btnSearch',
    legalDescription: '#ctl00_PlaceHolderMain_ParcelEdit_txtLegalDescription',
    parcelLot: '#ctl00_PlaceHolderMain_ParcelEdit_txtLot',
    parcelBlock: '#ctl00_PlaceHolderMain_ParcelEdit_txtBlock',
    parcelTract: '#ctl00_PlaceHolderMain_ParcelEdit_txtTract',
    parcelSubdivision: '#ctl00_PlaceHolderMain_ParcelEdit_ddlSubdivision',

    ownerName: '#ctl00_PlaceHolderMain_OwnerEdit_txtName',
    ownerAddress1: '#ctl00_PlaceHolderMain_OwnerEdit_txtAddress1',
    ownerCity: '#ctl00_PlaceHolderMain_OwnerEdit_txtCity',
    ownerState: '#ctl00_PlaceHolderMain_OwnerEdit_ddlAppState_State1',
    ownerZip: '#ctl00_PlaceHolderMain_OwnerEdit_txtZip',

    // TODO: BREVARD-specific ASI AppSpec control IDs — replace after authenticated CapEdit
    numberOfSquares: '#ctl00_PlaceHolderMain_AppSpecInfoEdit_txt_TODO_squares',
    roofType: '#ctl00_PlaceHolderMain_AppSpecInfoEdit_ddl_TODO_roofType',
  },

  defaultValues: {},

  fieldMap: [
    { jobField: 'property_address_number', selector: 'streetNo' },
    { jobField: 'property_address_street', selector: 'streetName' },
  ],

  requiredDocuments: [
    { docType: 'notice_of_commencement', required: true },
    { docType: 'product_approval', required: false },
    { docType: 'owners_affidavit', required: false },
  ],

  steps: ['login', 'create_application', 'upload_documents', 'submit'],

  quirks: {
    loginMode: 'angular-community-view',
    brandedShell: 'bass-county-header-plus-legacy-module-tabs',
    brandName: 'BASS',
    countyAliasHost: 'acaweb.brevardcounty.us',
    addressSearchAutoFills: true,
    hasMultiPageForm: true,
    captchaRisk: 'none',
    use2Captcha: false,
    portalDown502: true,
    agencyPath: 'BREVARD',
    contractorLicenseMustBeAttached: true,
  },

  postSubmitAttachments: {
    confirmedForRoofingPermit: false,
    validatedOn: null,
    notes:
      'BREVARD attachment selectors not confirmed — permit_document_upload must fail closed ' +
      'until an authenticated CapDetail/AttachmentsList discovery run updates this block.',
    selectors: {
      attachmentsTab: 'a[data-control="tab-attachments"]',
      browseAdd: '#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse',
      fileInput: '#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload',
      attachmentsListPath: '/BREVARD/FileUpload/AttachmentsList.aspx',
    },
  },

  preflightChecks: [
    { field: 'owner_name', message: 'Owner name is required' },
    { field: 'property_address', message: 'Property address is required' },
    { field: 'property_zip', message: 'Property zip is required' },
    { field: 'valuation', message: 'Contract value is required' },
    { field: 'company_id', message: 'Company ID is required' },
    { field: 'ahj_id', message: 'AHJ must be selected for this job' },
  ],
}
