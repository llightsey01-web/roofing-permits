module.exports = {
  id: 'polk-county',
  name: 'Polk County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/POLKCO/Login.aspx',
  loginType: 'accela_legacy',
  captchaType: 'recaptcha_v2',
  captchaSiteKey: '6LcsG08UAAAAANjzx4qNeHD3__8lwLWcwfnrpWln',
  workflowFile: 'polk-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'POLK_COUNTY',
  permitType: 'Re-Roof Permit',
  version: 1,
  lastVerified: '2026-06-03',

  selectors: {
    // Login
    loginIframe:        'iframe',
    loginUsername:      '[name="username"]',
    loginPassword:      '[name="password"]',
    loginSubmit:        'button:has-text("Sign In")',
    loginSiteKey:       '6LcsG08UAAAAANjzx4qNeHD3__8lwLWcwfnrpWln',

    // Navigation
    disclaimerUrl:      'https://aca-prod.accela.com/POLKCO/Cap/CapApplyDisclaimer.aspx?module=Building',
    disclaimerCheckbox: 'input[type="checkbox"]',
    continueBtn:        '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    permitTypeReRoof:   'text=Re-Roof Permit',

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

    // Step 2 — Permit Detail
    gateCode:           '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_1',
    nocDropdown:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_0_10',
    crossStreet:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_12',
    packetSubmission:   '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_0_13',
    fs119Status:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_0_15',
    workType:           '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_2_0',
    propertyType:       '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_2_1',
    reroofPermitType:   '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_3_0',
    numberOfSquares:    '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_3_1',
    roofType:           '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_3_2',
    reroofAffidavit:    '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_chk_3_3',
    asbestosStatement:  '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_chk_3_4',

    // Yes/No radio buttons
    gateAccessYes:      '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_0_0',
    gateAccessNo:       '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_0_1',
    codeViolationYes:   '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_2_0',
    codeViolationNo:    '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_2_1',
    roofDeckYes:        '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_1_0_0',
    roofDeckNo:         '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_1_0_1',
  },

  // Default values for required dropdowns
  defaultValues: {
    nocDropdown:      'NOC Exempt - Valuation Less Than$2,500',
    packetSubmission: 'Electronically through the portal',
    fs119Status:      'Not Applicable',
    workType:         'Replacement',
    propertyType:     'Residential',
    reroofPermitType: 'Complete Re-Roof',
  },

  // Field mapping — job data → portal field
  fieldMap: [
    { jobField: 'property_address_number', selector: 'streetNo' },
    { jobField: 'property_address_street', selector: 'streetName' },
    { jobField: 'roof_specs.squares',      selector: 'numberOfSquares' },
    { jobField: 'roof_type',               selector: 'roofType', type: 'select' },
  ],

  // Required documents — insurance cert is company-level, not per-job
  requiredDocuments: [
    { docType: 'notice_of_commencement', required: true },
    { docType: 'product_approval',       required: false },
    { docType: 'owners_affidavit',       required: false },
  ],

  // Automation steps in order
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
    addressSearchAutoFills: true,
    hasMultiPageForm:       true,
    captchaRisk:            'high',
    use2Captcha:            true,
    portalDown502:          true,
  },

  // Preflight checks — runs before automation starts
  // Insurance cert is company-level — checked in Settings, not here
  // NOC must be recorded before permit can be submitted
  preflightChecks: [
    { field: 'owner_name',       message: 'Owner name is required' },
    { field: 'property_address', message: 'Property address is required' },
    { field: 'property_zip',     message: 'Property zip is required' },
    { field: 'valuation',        message: 'Contract value is required' },
    { field: 'company_id',       message: 'Company ID is required' },
    { field: 'ahj_id',           message: 'AHJ must be selected for this job' },
  ],
}