/**
 * Manatee County Citizen Access (Accela MANATEE) config.
 *
 * Public inspection 2026-08-13 (no login):
 * - County CMS entry https://www.mymanatee.org/.../accela-online-services
 *   301 → https://aca-prod.accela.com/MANATEE/Default.aspx
 * - Custom domain does NOT host Accela; runtime portal is still aca-prod.
 * - Agency / tenant code (confirmed in page source + CSS handlers): MANATEE
 * - Login: Angular CommunityView iframe:
 *   /MANATEE/AngularUI/CommunityView/login-panel?inLegacyUI=true
 *   No outer reCAPTCHA on Login.aspx
 * - Shell: modern Accela top icon nav (Home / My Records / Search / New / Request)
 *   plus legacy module tabs (Home / Building / Planning / …)
 * - Building apply (New → Building Permit; unauth CapApplyDisclaimer redirects to Login):
 *   /MANATEE/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building
 * - CapHome Building record types include Residential Roof Express / Roof Standard
 *   (exact re-roof CapType label TODO after authenticated CapType page)
 *
 * ASI CapEdit field IDs are PLACEHOLDERS until authenticated CapEdit discovery.
 */

module.exports = {
  id: 'manatee-county',
  name: 'Manatee County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/MANATEE/Login.aspx',
  loginType: 'accela_angular',
  captchaType: 'none',
  workflowFile: 'manatee-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'MANATEE_COUNTY',
  sessionProvider: 'manatee_accela',
  // TODO: confirm exact CapType label (Residential Roof Express vs Roof Standard vs other)
  permitType: 'Residential Roof Express',
  version: 1,
  lastVerified: '2026-08-13-public-only',
  loginWaitMs: 3000,
  notes:
    'agency_code=MANATEE confirmed. Seed portal_url was county CMS; automation uses aca-prod MANATEE.',

  selectors: {
    loginFrameUrlPattern: /login-panel/,
    loginUsername: '[name="username"]',
    loginPassword: '[name="password"]',
    loginSubmit: 'button:has-text("Sign In")',
    loginSuccessUrl: '**/Dashboard.aspx**',

    disclaimerUrl:
      'https://aca-prod.accela.com/MANATEE/Cap/CapApplyDisclaimer.aspx?module=Building&TabName=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    // TODO: confirm exact Re-Roof / Roof Express CapType label after authenticated CapType page
    permitTypeReRoof: 'text=Residential Roof Express',

    myRecordsUrl: 'https://aca-prod.accela.com/MANATEE/Cap/MyRecordsCap.aspx',
    capHomeUrl:
      'https://aca-prod.accela.com/MANATEE/Cap/CapHome.aspx?module=Building&TabName=Building',
    resultGrid: 'table[id$="gdvPermitList"]',
    attachmentsListUrl: '/MANATEE/FileUpload/AttachmentsList.aspx',
    accountManagerUrl: 'https://aca-prod.accela.com/MANATEE/Account/AccountManager.aspx',

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

    // TODO: MANATEE-specific ASI AppSpec control IDs — replace after authenticated CapEdit
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
    brandedShell: 'modern-top-icon-nav-plus-legacy-module-tabs',
    countyCmsEntry:
      'https://www.mymanatee.org/community/businesses/building-and-land-development/accela-online-services',
    countyCmsRedirectsToAccela: true,
    addressSearchAutoFills: true,
    hasMultiPageForm: true,
    captchaRisk: 'none',
    use2Captcha: false,
    portalDown502: true,
    agencyPath: 'MANATEE',
    agencyCodeConfirmed: 'MANATEE',
    contractorLicenseMustBeAttached: true,
  },

  postSubmitAttachments: {
    confirmedForRoofingPermit: false,
    validatedOn: null,
    notes:
      'MANATEE attachment selectors not confirmed — permit_document_upload must fail closed ' +
      'until an authenticated CapDetail/AttachmentsList discovery run updates this block.',
    selectors: {
      attachmentsTab: 'a[data-control="tab-attachments"]',
      browseAdd: '#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse',
      fileInput: '#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload',
      attachmentsListPath: '/MANATEE/FileUpload/AttachmentsList.aspx',
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
