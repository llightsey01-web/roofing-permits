function getPortalOverrides(job) {
  return (job && job.job_specs && job.job_specs.portal_overrides) || {}
}

function valueOrFallback(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value
}

function resolveNocStatus(job) {
  if (!job) return 'Needed'
  if (job.noc_status === 'recorded' || job.noc_option === 'upload_recorded' || job.noc_recorded_at) return 'Recorded'
  if (job.noc_option === 'manual_download') return 'Needed'
  if (job.noc_option === 'not_required') return 'N/A'
  return 'Needed'
}

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
  sessionProvider: 'polk_accela',
  permitType: 'Re-Roof Permit',
  version: 2,
  lastVerified: '2026-08-02',

  selectors: {
    // Login
    loginIframe:        'iframe',
    loginUsername:      '[name="username"]',
    loginPassword:      '[name="password"]',
    loginSubmit:        'button:has-text("Sign In")',
    loginSiteKey:       '6LcsG08UAAAAANjzx4qNeHD3__8lwLWcwfnrpWln',

    // Navigation
    disclaimerUrl:      'https://aca-prod.accela.com/POLKCO/Cap/CapApplyDisclaimer.aspx?module=Building',
    disclaimerCheckbox: '#ctl00_PlaceHolderMain_termAccept',
    continueBtn:        '#ctl00_PlaceHolderMain_btnNextStep, #ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
    permitTypeReRoof:   'text=Re-Roof Permit',

    // CapHome / MyRecords search (Batch B)
    searchMyRecordsOnly: '#ctl00_PlaceHolderMain_chkSearch',
    searchType:         '#ctl00_PlaceHolderMain_ddlSearchType',
    searchPermitType:   '#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType',
    searchLicenseType:  '#ctl00_PlaceHolderMain_generalSearchForm_ddlGSLicenseType',
    searchPermitNumber: '#ctl00_PlaceHolderMain_generalSearchForm_txtGSPermitNumber',
    myRecordsUrl:       'https://aca-prod.accela.com/POLKCO/Cap/MyRecordsCap.aspx',
    capHomeUrl:         'https://aca-prod.accela.com/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building',
    resultGrid:         'table[id$="gdvPermitList"]',
    attachmentsListUrl: '/POLKCO/FileUpload/AttachmentsList.aspx',
    accountManagerUrl:  'https://aca-prod.accela.com/POLKCO/Account/AccountManager.aspx',
    shoppingCartUrl:    'https://aca-prod.accela.com/POLKCO/ShoppingCart/ShoppingCart.aspx?TabName=Home&stepNumber=2',
    cartCheckoutBtn:    '#ctl00_PlaceHolderMain_btnCheckOut',
    cartEditBtn:        '#ctl00_PlaceHolderMain_btnEditCart',
    cartPayNowBtn:      'text=PAY NOW',
    cartPaymentInfoStep: 'text=Payment information',
    fortePaymentModal:  'text=POLK CO BLDG PERMITS WEB',
    fortePaymentProviderText: 'text=Powered by CSG Forte Payments, Inc.',
    paymentBoundaryText: 'text=Step 5: Pay Fees',

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

    // Step 1 — Location & People > Permit Information (ASI custom fields)
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

    // Resume Application page-flow modal (Batch C)
    resumePageFlowModal: '#dvACADialogLayer',
    resumePickUpWhereLeftOffText: 'Pick up where I left off',
    resumeStartFromBeginningText: 'Start from the beginning',
    resumeModalOkText: 'OK',
    resumeModalCancelText: 'Cancel',

    // Step 2 — Permit Detail / Work Description
    jobDescription: '#ctl00_PlaceHolderMain_DetailInfoEdit_txtDescriptionDetail',
    jobValue:       '#ctl00_PlaceHolderMain_DescriptionEdit_txtJobValue',

    // Step 3 — Documents (acknowledgement-only; uploads happen post-submit)
    planUploadAcknowledgement: '#ctl00_PlaceHolderMain_AppSpec8B96C3A4Edit_POLKCO_chk_0_0',

    // Confirmed Batch C selector pass on draft 26TMP-043760
    applicantOwnerYes: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_4_0',
    applicantOwnerNo:  '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_4_1',
    virtualInspectionYes: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_14_0',
    virtualInspectionNo:  '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_0_14_1',
    privateProviderYes: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_1_0_0',
    privateProviderNo:  '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_rdo_1_0_1',
    codeViolationCaseNumber: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_3',
    constructionWasteAcknowledgement: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_0_5',
    commercialFranchiseHolderName: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_6',
    commercialFranchiseHolderPhone: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_7',
    disposalEquipment: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_8',
    disposalFrequency: '#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_txt_0_9',
  },

  // Confirmed portal enums (Batch C, 2026-08-02)
  enums: {
    nocDropdown: ['--Select--', 'N/A', 'Needed', 'Recorded'],
    workType: ['--Select--', 'Addition', 'Alteration', 'New', 'Repair'],
    propertyType: ['--Select--', 'Commercial', 'Residential'],
    reroofPermitType: ['--Select--', 'Reroof', 'Roof Cover 3 inches or Less', 'Roof Over More Than 3 inches'],
    roofType: ['Built-up', 'Composition or Wood Shingles', 'Metal', 'Tile', 'TPO'],
  },

  /**
   * Portal defaults that are constant for DART iQ's normal Polk re-roof use case.
   * Rare exceptions come through `job.job_specs.portal_overrides`.
   */
  defaultValues: {
    packetSubmission: 'Electronically',
    fs119Status:      'Non-Exempt',
    propertyType:     'Residential',
    reroofPermitType: 'Reroof',
    gateCodeRequired: false,
    codeViolation: false,
    applicantIsOwner: false,
    virtualInspections: false,
    privateProvider: false,
    reroofAffidavit: true,
    asbestosStatement: true,
    planUploadAcknowledgement: true,
    crossStreet: '',
    constructionWasteAcknowledgement: null,
    commercialFranchiseHolderName: '',
    commercialFranchiseHolderPhone: '',
    disposalEquipment: '',
    disposalFrequency: '',
  },

  // Dynamic defaults / overrides. These are data-only helpers for the runner to call later.
  resolvePortalDefaults: function resolvePortalDefaults(job) {
    var overrides = getPortalOverrides(job)
    return {
      nocDropdown: resolveNocStatus(job),
      gateCodeRequired: Boolean(valueOrFallback(overrides.gate_code_required, false)),
      gateCode: valueOrFallback(overrides.gate_code, ''),
      codeViolation: Boolean(valueOrFallback(overrides.code_violation, false)),
      codeViolationCaseNumber: valueOrFallback(overrides.code_violation_case_number, ''),
      fs119Status: valueOrFallback(overrides.fs119_status, 'Non-Exempt'),
      reroofPermitType: valueOrFallback(overrides.reroof_permit_type, 'Reroof'),
      packetSubmission: 'Electronically',
      applicantIsOwner: false,
      virtualInspections: false,
      privateProvider: false,
      propertyType: 'Residential',
      crossStreet: '',
      constructionWasteAcknowledgement: null,
      commercialFranchiseHolderName: '',
      commercialFranchiseHolderPhone: '',
      disposalEquipment: '',
      disposalFrequency: '',
      reroofAffidavit: true,
      asbestosStatement: true,
      planUploadAcknowledgement: true,
    }
  },

  adminOverridePath: 'job_specs.portal_overrides',
  adminOverrideFields: [
    { key: 'gate_code_required', portalField: 'gateCodeRequired', fallback: false },
    { key: 'gate_code', portalField: 'gateCode', fallback: '' },
    { key: 'code_violation', portalField: 'codeViolation', fallback: false },
    { key: 'code_violation_case_number', portalField: 'codeViolationCaseNumber', fallback: '' },
    { key: 'fs119_status', portalField: 'fs119Status', fallback: 'Non-Exempt' },
    { key: 'reroof_permit_type', portalField: 'reroofPermitType', fallback: 'Reroof' },
  ],

  // Field mapping — job data → portal field
  fieldMap: [
    { jobField: 'property_address_number', selector: 'streetNo' },
    { jobField: 'property_address_street', selector: 'streetName' },
    { jobField: 'roof_specs.squares',      selector: 'numberOfSquares' },
    { jobField: 'roof_type',               selector: 'roofType', type: 'select' },
    { jobField: 'work_type',               selector: 'workType', type: 'select' },
    { jobField: 'scope_of_work',           selector: 'jobDescription', type: 'textarea', selectorConfirmed: true },
    { jobField: 'valuation',               selector: 'jobValue', type: 'currency', selectorConfirmed: true },
  ],

  fieldFillPolicy: {
    leaveUnset: [
      'constructionWasteAcknowledgement',
      'commercialFranchiseHolderName',
      'commercialFranchiseHolderPhone',
      'disposalEquipment',
      'disposalFrequency',
      'crossStreet',
    ],
    noRegexInference: ['roof_type', 'work_type'],
    portalExactIntakeFields: ['roof_type', 'work_type'],
    leeRoofTypeEnumVerified: false,
    leeRoofTypeEnumNote:
      'Assumes Lee Accela roofType matches Polk because the same ASI block is configured; verify before Lee Phase 2.',
  },

  // Required documents — upload is post-submit, not inline with the application wizard.
  requiredDocuments: [
    { docType: 'notice_of_commencement', required: true, uploadPhase: 'post_submit_upload' },
    { docType: 'product_approval',       required: false, uploadPhase: 'post_submit_upload' },
    { docType: 'owners_affidavit',       required: false, uploadPhase: 'post_submit_upload' },
  ],

  wizard: {
    steps: [
      {
        step: 1,
        label: 'Location & People',
        pages: ['Location Information', 'Permit Information', 'Contact Information', 'Contact Information Cont.'],
      },
      { step: 2, label: 'Permit Detail', pages: ['Work Description'] },
      { step: 3, label: 'Documents', pages: ['Plan Upload Acknowledgement'] },
      { step: 4, label: 'Review', pages: ['Read-only Summary'] },
      { step: 5, label: 'Record Issuance', pages: ['Pay Fees'] },
    ],
    paymentBoundaryStep: 5,
    stopBeforePaymentEntry: true,
  },

  resumeApplication: {
    modalSelector: 'resumePageFlowModal',
    defaultChoiceText: 'Pick up where I left off',
    alternateChoiceText: 'Start from the beginning',
    okText: 'OK',
    cancelText: 'Cancel',
  },

  phases: {
    applicationWizard: {
      name: 'Phase A — Application Wizard',
      scope: 'Disclaimer → CapType → CapEdit Location & People → Permit Detail → Documents acknowledgement → Review → Pay Fees boundary',
      stopAt: 'payment_boundary',
    },
    postSubmitUpload: {
      name: 'Phase B — Post-submit attachments',
      scope: 'CapDetail / FileUpload/AttachmentsList.aspx after a record exists',
      inlineWithWizard: false,
    },
    payment: {
      name: 'Phase C — Payment',
      scope: 'Shopping Cart → payment information → Forte modal',
      stopAt: 'forte_payment_modal',
    },
  },

  paymentBoundary: {
    payFeesStepTitle: 'Step 5: Pay Fees',
    feeLinesObserved: [
      { label: 'B Surcharge BCAIB 1.5%', qty: 1, amount: 2.00 },
      { label: 'B Surcharge FBC 1%', qty: 1, amount: 2.00 },
      { label: 'B Re_Roof', qty: 90.75, amount: 90.75 },
    ],
    observedTotalForBatchC: 94.75,
    noOnlinePaymentMunicipalities: ['Town of Dundee', 'Fort Meade', 'Polk City'],
    forteProvider: 'CSG Forte Payments, Inc.',
  },

  // Account-level attachments observed on AccountManager (Batch B) — not per-permit
  accountLevelAttachments: [
    'Certificate of Insurance',
    'Business Tax Receipt',
    'State License',
  ],

  // CapHome search-type modes (Batch B Phase 3) — each swaps visible field set
  searchTypes: [
    'General Search',
    'Search by Address',
    'Search by Licensed Professional Information',
    'Search by Record Information',
    'Search for Trade Name',
    'Search by Contact',
  ],

  // Draft cleanup (Batch B) — located, not used
  draftCleanup: {
    discardControlFound: false,
    notes:
      'No Discard/Delete Draft/Abandon Application control on CapHome, MyRecords toolbar, sample CapDetail, Cart, or Account. CapEdit Save-and-Resume Later remains the known draft creator; cleanup path for automation is unresolved pending Batch C / incomplete-draft sample.',
  },

  /**
   * PROVISIONAL — observed on BL license CapDetail (Additional Info Required) only.
   * NOT validated for BT Re-Roof Permit workflow. Do not wire runner steps to this
   * until a real roofing permit hits this status and NOTES are updated.
   */
  provisionalCorrectionFlowLicenseOnly: {
    validatedForRoofingPermit: false,
    observedOn: 'business_license_renewal_BL',
    recordStatusSelector: '#ctl00_PlaceHolderMain_lblRecordStatus',
    recordStatusWrapper: '#ctl00_PlaceHolderMain_divRecordStatus',
    expectedStatusText: 'Additional Info Required',
    processingStatusSection: '#ctl00_PlaceHolderMain_divProcessStatus',
    processingStatusInfo: '#divProcessInfo',
    processingStatusTable: '#divProcessingTable',
    attachmentsTab: 'a[data-control="tab-attachments"]',
    digitalProjectsTab: 'a[data-control="tab-custom_component"]',
    attachmentSelectFromAccount: '#ctl00_PlaceHolderMain_attachmentEdit_btnSelectFromAccount',
    attachmentBrowseAdd: '#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse',
    dedicatedRespondButtonFound: false,
    revisionsHelpTextPattern: /If Revisions Required.*Digital Projects.*Comments/i,
  },

  // Automation steps in order (config declaration only; runner wiring remains separate)
  steps: [
    'login',
    'navigate_to_disclaimer',
    'accept_disclaimer',
    'select_reroof_permit',
    'location_people_location_information',
    'location_people_permit_information',
    'location_people_primary_licensed_professional',
    'location_people_subcontractors',
    'permit_detail_work_description',
    'documents_plan_upload_acknowledgement',
    'review_application',
    'pay_fees_boundary',
  ],

  resumeSteps: [
    'login',
    'navigate_to_my_records',
    'click_resume_application',
    'handle_resume_page_flow_modal',
    'continue_application_wizard',
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