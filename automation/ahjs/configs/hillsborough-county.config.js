/**
 * Hillsborough County (HillsGovHub / Accela HCFL) portal config.
 *
 * Public inspection 2026-08-12 (no login):
 * - Login uses Angular CommunityView iframe (same family as Lee, not Polk legacy reCAPTCHA):
 *   https://aca-prod.accela.com/HCFL/AngularUI/CommunityView/login-panel?inLegacyUI=true
 * - Agency path normalizes to /HCFL/ (uppercase) even when seeded as /hcfl
 * - Apply entry: New → "Building & Site Application"
 *   /HCFL/Cap/CapApplyDisclaimer.aspx?Module=Building&TabName=Building
 * - Shell UX is HillsGovHub left-sidebar nav (differs from Polk top-tab chrome);
 *   Accela Cap* pages under /HCFL/Cap/ still use classic ctl00_PlaceHolderMain_* IDs.
 *
 * ASI / permit-detail field IDs below are PLACEHOLDERS — verify after first
 * authenticated CapEdit run (HCFL AppSpec control IDs will differ from LEECO/POLKCO).
 */

module.exports = {
  id: 'hillsborough-county',
  name: 'Hillsborough County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/HCFL/Login.aspx',
  loginType: 'accela_angular',
  captchaType: 'none',
  workflowFile: 'hillsborough-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'HILLSBOROUGH_COUNTY',
  sessionProvider: 'hillsborough_accela',
  // Public New-menu label is "Building & Site"; Accela module param is still Building.
  permitType: 'Re-Roof Permit',
  version: 1,
  lastVerified: '2026-08-12-public-only',
  loginWaitMs: 3000,

  selectors: {
    // Login — Angular CommunityView iframe (no reCAPTCHA observed on public Login.aspx)
    loginFrameUrlPattern: /login-panel/,
    loginUsername: '[name="username"]',
    loginPassword: '[name="password"]',
    loginSubmit: 'button:has-text("Sign In")',
    loginSuccessUrl: '**/Dashboard.aspx**',

    // Navigation — module from public New menu (Building & Site Application)
    disclaimerUrl:
      'https://aca-prod.accela.com/HCFL/Cap/CapApplyDisclaimer.aspx?Module=Building&TabName=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    // TODO: confirm exact Re-Roof permit type label text after authenticated CapType page
    permitTypeReRoof: 'text=Re-Roof Permit',

    myRecordsUrl: 'https://aca-prod.accela.com/HCFL/Cap/MyRecordsCap.aspx',
    capHomeUrl:
      'https://aca-prod.accela.com/HCFL/Cap/CapHome.aspx?module=Building&TabName=Building',
    resultGrid: 'table[id$="gdvPermitList"]',
    attachmentsListUrl: '/HCFL/FileUpload/AttachmentsList.aspx',
    accountManagerUrl: 'https://aca-prod.accela.com/HCFL/Account/AccountManager.aspx',

    // Step 1 — Location & People (shared Accela WorkLocationEdit pattern)
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

    // TODO: HCFL-specific ASI AppSpec control IDs — replace after first authenticated CapEdit
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

  steps: [
    'login',
    'create_application',
    'upload_documents',
    'submit',
  ],

  quirks: {
    loginMode: 'angular-community-view',
    brandedShell: 'HillsGovHub-sidebar',
    addressSearchAutoFills: true,
    hasMultiPageForm: true,
    captchaRisk: 'none',
    use2Captcha: false,
    portalDown502: true,
    // Public nav label differs from Polk ("Building" vs "Building and Site")
    modulePublicLabel: 'Building and Site',
    agencyPath: 'HCFL',
  },

  /**
   * Fail-closed until authenticated AttachmentsList discovery confirms selectors.
   * Same gate pattern as Polk postSubmitAttachments.confirmedForRoofingPermit.
   */
  postSubmitAttachments: {
    confirmedForRoofingPermit: false,
    validatedOn: null,
    notes:
      'HCFL attachment selectors not confirmed — permit_document_upload must fail closed ' +
      'until an authenticated CapDetail/AttachmentsList discovery run updates this block.',
    selectors: {
      attachmentsTab: 'a[data-control="tab-attachments"]',
      browseAdd: '#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse',
      fileInput: '#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload',
      attachmentsListPath: '/HCFL/FileUpload/AttachmentsList.aspx',
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
