/**
 * Osceola County Citizen Access (self-hosted Accela) config.
 *
 * Jurisdiction verification 2026-08-13 (hard gate — 2+ FL signals):
 * 1. Official county page
 *    https://www.osceola.org/Doing-Business/Building-and-Permits/Apply-for-a-Building-Permit
 *    links permits.osceola.org; lists Building & Permitting Office
 *    1 Courthouse Square, Suite 1400, Kissimmee, FL 34741; phone 407-742-0200
 * 2. Portal email permitting@osceola.org + "Osceola County Permit Center" branding
 *
 * Platform: Accela Citizen Access, SELF-HOSTED at permits.osceola.org/CitizenAccess.
 * agency_code=OSCEOLA (Customization/OSCEOLA, agencyCode=OSCEOLA).
 * Do NOT target aca-prod.accela.com/OSCEOLA for filings (TEST/sample environment markers).
 *
 * Login family (public 2026-08-13): LEGACY Accela LoginBox (E-mail / Password / Login »).
 * NOT Angular CommunityView; NOT Polk outer reCAPTCHA. Use performLogin hook.
 *
 * Apply: /CitizenAccess/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building
 * CapType (official county guide): "Roofing Permit" for re-roof / roof replacement.
 *
 * ASI CapEdit field IDs are PLACEHOLDERS until authenticated CapEdit discovery.
 */

module.exports = {
  id: 'osceola-county',
  name: 'Osceola County Building Department',
  state: 'FL',
  portalUrl: 'https://permits.osceola.org/CitizenAccess/Login.aspx',
  loginType: 'accela_legacy',
  captchaType: 'none',
  workflowFile: 'osceola-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'OSCEOLA_COUNTY',
  sessionProvider: 'osceola_accela',
  permitType: 'Roofing Permit',
  version: 1,
  lastVerified: '2026-08-13-public-only',
  loginWaitMs: 3000,
  notes:
    'Self-hosted ACA. Never use aca-prod.accela.com/OSCEOLA for production filings.',

  selectors: {
    // Legacy LoginBox (page-level — no CommunityView iframe)
    loginUsername: '#ctl00_PlaceHolderMain_LoginBox_txtUserId',
    loginPassword: '#ctl00_PlaceHolderMain_LoginBox_txtPassword',
    loginSubmit: '#ctl00_PlaceHolderMain_LoginBox_btnLogin',
    loginSuccessUrl: '**/Welcome.aspx**',

    disclaimerUrl:
      'https://permits.osceola.org/CitizenAccess/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    permitTypeReRoof: 'text=Roofing Permit',

    myRecordsUrl: 'https://permits.osceola.org/CitizenAccess/Cap/MyRecordsCap.aspx',
    capHomeUrl:
      'https://permits.osceola.org/CitizenAccess/Cap/CapHome.aspx?module=Building&TabName=Building',
    resultGrid: 'table[id$="gdvPermitList"]',
    attachmentsListUrl: '/CitizenAccess/FileUpload/AttachmentsList.aspx',
    accountManagerUrl: 'https://permits.osceola.org/CitizenAccess/Account/AccountManager.aspx',

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

    // TODO: OSCEOLA-specific ASI AppSpec control IDs — replace after authenticated CapEdit
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
    loginMode: 'legacy-loginbox-email-password',
    brandedShell: 'legacy-module-tabs-self-hosted',
    hosting: 'self-hosted',
    agencyPath: 'CitizenAccess',
    agencyCode: 'OSCEOLA',
    neverUseAcaProdOsceola: true,
    addressSearchAutoFills: true,
    hasMultiPageForm: true,
    captchaRisk: 'none',
    use2Captcha: false,
    portalDown502: true,
  },

  postSubmitAttachments: {
    confirmedForRoofingPermit: false,
    validatedOn: null,
    notes:
      'OSCEOLA attachment selectors not confirmed — permit_document_upload must fail closed ' +
      'until an authenticated CapDetail/AttachmentsList discovery run updates this block.',
    selectors: {
      attachmentsTab: 'a[data-control="tab-attachments"]',
      browseAdd: '#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse',
      fileInput: '#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload',
      attachmentsListPath: '/CitizenAccess/FileUpload/AttachmentsList.aspx',
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
