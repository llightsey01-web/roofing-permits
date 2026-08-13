/**
 * Sarasota County Citizen Access Portal (Accela SARASOTACO) config.
 *
 * Public inspection 2026-08-13 (no login):
 * - Login: Angular CommunityView iframe (Lee/Hillsborough/Pinellas/Pasco family):
 *   https://aca-prod.accela.com/SARASOTACO/AngularUI/CommunityView/login-panel?inLegacyUI=true
 * - Shell: classic Accela top tabs (Home / Building / Community Development / …)
 * - Building apply redirects unauthenticated users to Login with ReturnUrl:
 *   /SARASOTACO/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building
 * - Public notes: payment processor change Nov 2025 (seed metadata) — not relevant to Phase 1
 *
 * ASI CapEdit field IDs are PLACEHOLDERS until authenticated CapEdit discovery.
 */

module.exports = {
  id: 'sarasota-county',
  name: 'Sarasota County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/SARASOTACO/Login.aspx',
  loginType: 'accela_angular',
  captchaType: 'none',
  workflowFile: 'sarasota-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'SARASOTA_COUNTY',
  sessionProvider: 'sarasota_accela',
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
      'https://aca-prod.accela.com/SARASOTACO/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    // TODO: confirm exact Re-Roof permit type label after authenticated CapType page
    permitTypeReRoof: 'text=Re-Roof Permit',

    myRecordsUrl: 'https://aca-prod.accela.com/SARASOTACO/Cap/MyRecordsCap.aspx',
    capHomeUrl:
      'https://aca-prod.accela.com/SARASOTACO/Cap/CapHome.aspx?module=Building&TabName=Building',
    resultGrid: 'table[id$="gdvPermitList"]',
    attachmentsListUrl: '/SARASOTACO/FileUpload/AttachmentsList.aspx',
    accountManagerUrl: 'https://aca-prod.accela.com/SARASOTACO/Account/AccountManager.aspx',

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

    // TODO: SARASOTACO-specific ASI AppSpec control IDs — replace after authenticated CapEdit
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
    brandedShell: 'classic-top-tabs',
    addressSearchAutoFills: true,
    hasMultiPageForm: true,
    captchaRisk: 'none',
    use2Captcha: false,
    portalDown502: true,
    agencyPath: 'SARASOTACO',
  },

  postSubmitAttachments: {
    confirmedForRoofingPermit: false,
    validatedOn: null,
    notes:
      'SARASOTACO attachment selectors not confirmed — permit_document_upload must fail closed ' +
      'until an authenticated CapDetail/AttachmentsList discovery run updates this block.',
    selectors: {
      attachmentsTab: 'a[data-control="tab-attachments"]',
      browseAdd: '#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse',
      fileInput: '#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload',
      attachmentsListPath: '/SARASOTACO/FileUpload/AttachmentsList.aspx',
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
