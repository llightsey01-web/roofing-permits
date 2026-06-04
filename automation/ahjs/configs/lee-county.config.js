module.exports = {
  id: 'lee-county',
  name: 'Lee County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/LEECO/Login.aspx',
  loginType: 'accela_angular',
  captchaType: 'none',
  workflowFile: 'lee-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'LEE_COUNTY',
  permitType: 'Re-Roof Permit',
  version: 1,
  lastVerified: '2026-06-03',
  loginWaitMs: 3000,

  selectors: {
    // Login — Angular CommunityView iframe (no reCAPTCHA)
    loginFrameUrlPattern: /login-panel/,
    loginUsername: '[name="username"]',
    loginPassword: '[name="password"]',
    loginSubmit: 'button:has-text("Sign In")',
    loginSuccessUrl: '**/Dashboard.aspx**',

    // Navigation
    disclaimerUrl: 'https://aca-prod.accela.com/LEECO/Cap/CapApplyDisclaimer.aspx?module=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn: '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    permitTypeReRoof: 'text=Re-Roof Permit',

    // Step 1 — Location & People
    streetNo:           '#ctl00_PlaceHolderMain_WorkLocationEdit_txtStreetNo',
    streetName:         '#ctl00_PlaceHolderMain_WorkLocationEdit_txtStreetName',
    streetDirection:    '#ctl00_PlaceHolderMain_WorkLocationEdit_ddlStreetDirection',
    streetType:         '#ctl00_PlaceHolderMain_WorkLocationEdit_ddlStreetSuffix',
    unitNo:             '#ctl00_PlaceHolderMain_WorkLocationEdit_txtUnitNo',
    city:               '#ctl00_PlaceHolderMain_WorkLocationEdit_txtCity',
    state:              '#ctl00_PlaceHolderMain_WorkLocationEdit_txtState_State1',
    zip:                '#ctl00_PlaceHolderMain_WorkLocationEdit_txtZip',
    addressSearchBtn:   '#ctl00_PlaceHolderMain_WorkLocationEdit_btnSearch',
    addressResult:      '#ctl00_PlaceHolderMain_WorkLocationEdit .ACA_Grid_Row',
    saveAndResumeBtn:   '#ctl00_PlaceHolderMain_actionBarBottom_btnSave',

    // Parcel (auto-fills from address search)
    parcelNo:           '#ctl00_PlaceHolderMain_ParcelEdit_txtParcelNo',
    parcelSearchBtn:    '#ctl00_PlaceHolderMain_ParcelEdit_btnSearch',
    legalDescription:   '#ctl00_PlaceHolderMain_ParcelEdit_txtLegalDescription',
    parcelLot:          '#ctl00_PlaceHolderMain_ParcelEdit_txtLot',
    parcelBlock:        '#ctl00_PlaceHolderMain_ParcelEdit_txtBlock',
    parcelTract:        '#ctl00_PlaceHolderMain_ParcelEdit_txtTract',
    parcelSubdivision:  '#ctl00_PlaceHolderMain_ParcelEdit_ddlSubdivision',

    // Owner (auto-fills from address search)
    ownerName:          '#ctl00_PlaceHolderMain_OwnerEdit_txtName',
    ownerAddress1:      '#ctl00_PlaceHolderMain_OwnerEdit_txtAddress1',
    ownerCity:          '#ctl00_PlaceHolderMain_OwnerEdit_txtCity',
    ownerState:         '#ctl00_PlaceHolderMain_OwnerEdit_ddlAppState_State1',
    ownerZip:           '#ctl00_PlaceHolderMain_OwnerEdit_txtZip',

    // Step 2 — Permit Detail (LEECO-specific ASI field IDs — verify on first run)
    gateCode:           '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_txt_0_1',
    nocDropdown:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_0_10',
    crossStreet:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_txt_0_12',
    packetSubmission:   '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_0_13',
    fs119Status:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_0_15',
    workType:           '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_2_0',
    propertyType:       '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_2_1',
    reroofPermitType:   '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_3_0',
    numberOfSquares:    '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_txt_3_1',
    roofType:           '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_ddl_3_2',
    reroofAffidavit:    '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_chk_3_3',
    asbestosStatement:  '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_chk_3_4',

    gateAccessYes:      '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_rdo_0_0_0',
    gateAccessNo:       '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_rdo_0_0_1',
    codeViolationYes:   '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_rdo_0_2_0',
    codeViolationNo:    '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_rdo_0_2_1',
    roofDeckYes:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_rdo_1_0_0',
    roofDeckNo:         '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_LEECO_rdo_1_0_1',
  },

  defaultValues: {
    nocDropdown:      'NOC Exempt - Valuation Less Than$2,500',
    packetSubmission: 'Electronically through the portal',
    fs119Status:      'Not Applicable',
    workType:         'Replacement',
    propertyType:     'Residential',
    reroofPermitType: 'Complete Re-Roof',
  },

  fieldMap: [
    { jobField: 'property_address_number', selector: 'streetNo' },
    { jobField: 'property_address_street', selector: 'streetName' },
    { jobField: 'roof_specs.squares',      selector: 'numberOfSquares' },
    { jobField: 'roof_type',               selector: 'roofType', type: 'select' },
  ],

  requiredDocuments: [
    { docType: 'notice_of_commencement', required: true },
    { docType: 'product_approval',       required: false },
    { docType: 'owners_affidavit',       required: false },
  ],

  steps: [
    'login',
    'navigate_to_disclaimer',
    'accept_disclaimer',
    'select_reroof_permit',
    'fill_address_search',
    'select_address_result',
    'continue_to_permit_detail',
    'fill_permit_detail',
    'check_required_boxes',
    'stop_before_submit',
  ],

  quirks: {
    loginMode:              'angular-community-view',
    addressSearchAutoFills: true,
    hasMultiPageForm:       true,
    captchaRisk:            'none',
    use2Captcha:            false,
    portalDown502:          true,
  },

  preflightChecks: [
    { field: 'owner_name',       message: 'Owner name is required' },
    { field: 'property_address', message: 'Property address is required' },
    { field: 'property_zip',     message: 'Property zip is required' },
    { field: 'valuation',        message: 'Contract value is required' },
    { field: 'company_id',       message: 'Company ID is required' },
    { field: 'ahj_id',           message: 'AHJ must be selected for this job' },
  ],
}
