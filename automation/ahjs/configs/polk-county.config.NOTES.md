# Polk County Accela — Config Notes

Companion to `polk-county.config.js`.  
Batch A discovery (2026-07-30) used Gator Roof Systems live credentials (read-only).

## Disclaimer gating vs CapHome / MyRecords (Batch A clarification)

**Answer: CapHome and MyRecords were opened by direct URL navigation (`page.goto`), not by accepting CapApplyDisclaimer.**

Sequence in Batch A:
1. Login → `Dashboard.aspx`
2. Direct goto → `Cap/CapApplyDisclaimer.aspx?module=Building` (checkbox **not** checked; **Continue Application** not clicked)
3. Direct goto → `Dashboard.aspx?module=Building`
4. Direct goto → `Cap/CapHome.aspx?module=Building&TabName=Building`
5. Direct goto → CapHome search URL variant
6. Later: followed dashboard link → `Cap/MyRecordsCap.aspx`

**Implication for automation sequencing:**  
`CapApplyDisclaimer` only gates the **new application** path (disclaimer → Continue Application → CapType → CapEdit). It does **not** gate authenticated search / my-records surfaces.  
`CapHome.aspx` and `MyRecordsCap.aspx` load while logged in **without** attestation.

Real runner flow for a **new** re-roof still must:  
`login → CapApplyDisclaimer → accept → Continue Application → CapType (Re-Roof) → CapEdit …`  
and stop before submit/pay. Search/resume/my-records can run as separate authenticated entry points that skip the disclaimer.

## Batch A safety

- Submitted / paid / deleted / cancelled / scheduled / emailed / settings changed: **no**
- Attestation accepted: **no**
- Session file: `tmp/polk-batch-a/storageState-polk-gator.json` (gitignored; never commit)

## Batch A pages inventoried (9)

See `tmp/polk-batch-a/batch-a-portal-map.json` for full locator dumps. Summary below for review.

| # | Label | URL | Notes |
|---|--------|-----|--------|
| 1 | 01_dashboard | `/POLKCO/Dashboard.aspx` | Post-login home |
| 2 | 02_disclaimer_page_read_only | `/POLKCO/Cap/CapApplyDisclaimer.aspx?module=Building` | Attestation checkbox present; not accepted |
| 3 | 03_building_module_home | `/POLKCO/Dashboard.aspx?module=Building` | Direct URL |
| 4 | 04_cap_home_building | `/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building` | Direct URL; 76 records listed |
| 5 | 05_cap_search | CapHome TabList variant | Same CapHome family; search form |
| 6 | nav_01_Skip Module Navigation | Dashboard hash anchor | Accessibility skip link |
| 7 | nav_02_Skip to main content | Dashboard `#ACAFrame` | Accessibility skip link |
| 8 | nav_04_Cart (0) | `/POLKCO/ShoppingCart/ShoppingCart.aspx?...` | Empty cart; no pay action |
| 9 | nav_05_View All Records | `/POLKCO/Cap/MyRecordsCap.aspx` | Via dashboard “View All Records” link |

`nav_03_HOME` (`DEFAULT.ASPX`) inventory failed (null `innerText` during evaluate) — noted in run notes; not counted in successful page objects.

## Key locators observed

### Global chrome (most pages)
- `#home-menuitem` HOME
- `#Start-menuitem` APPLY
- `#Search-menuitem` SEARCH
- `#Account-menuitem` ACCOUNT → `/POLKCO/Account/AccountManager.aspx`
- `#logout-buttonitem` / `#ctl00_HeaderNavigation_btnLogout` LOGOUT
- `#ctl00_HeaderNavigation_A1` Cart
- `#search_text_gq` header search

### CapApplyDisclaimer (new-apply gate only)
- `#ctl00_PlaceHolderMain_termAccept` — “I have read and accepted the above terms.”
- Continue Application — present; **not clicked** in Batch A
- Config: `disclaimerCheckbox: #ctl00_PlaceHolderMain_termAccept`, `continueBtn: #ctl00_PlaceHolderMain_btnNextStep` (+ bottom-bar fallback), `disclaimerUrl`

### CapHome / search (`04` / `05`)
- `#ctl00_PlaceHolderMain_ddlSearchType`
- `#ctl00_PlaceHolderMain_chkSearch` — Search my records only
- `#ctl00_PlaceHolderMain_generalSearchForm_txtGSPermitNumber`
- `#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType`
- `#ctl00_PlaceHolderMain_generalSearchForm_txtGSProjectName`
- `#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate` / `txtGSEndDate`
- `#ctl00_PlaceHolderMain_generalSearchForm_ddlGSLicenseType`
- `#ctl00_PlaceHolderMain_generalSearchForm_txtGSLicenseNumber`
- Address search children + street name / direction fields
- Result grid checkboxes: `#ctl00_PlaceHolderMain_PermitList_gdvPermitList_ctlNN_CB_*`
- Breadcrumb showed “Showing 1-10 of 76”, Download results, Add to collection, Add to cart

### MyRecordsCap (`09`)
- Grid `#ctl00_PlaceHolderMain_CapList2_gdvPermitList_*` checkboxes
- Breadcrumb: Building · Showing 1-10 of 76

### Login (confirmed Batch A)
- Vault credentials: `source=vault_or_loader`, `provider=polk_accela`
- Login iframe + 2Captcha reCAPTCHA → `Dashboard.aspx`

## Existing runner alignment

`polk-county.config.js` steps already match new-apply path:  
`login → navigate_to_disclaimer → accept_disclaimer → select_reroof_permit → … → stop_before_submit`  
Batch A confirms CapHome/MyRecords are **orthogonal** authenticated routes and must not be treated as post-disclaimer steps.

---

## Batch B — Phases 3–6 (2026-07-30, read-only)

Artifacts (gitignored): `tmp/polk-batch-b/batch-b-findings.json`, `run.log`, screenshots.  
Safety: attestation **not** accepted; no submit/pay/delete/cancel/schedule/email.

### Phase 3 — Conditional logic (CapHome search)

`#ctl00_PlaceHolderMain_ddlSearchType` swaps the visible field set:

| Search type | Visible field count (approx) |
|-------------|------------------------------|
| General Search | 27 |
| Search by Address | 15 |
| Search by Licensed Professional Information | 10 |
| Search by Record Information | 9 |
| Search for Trade Name | 7 |
| Search by Contact | 23 |

`#ctl00_PlaceHolderMain_chkSearch` (“Search my records only”) toggle did **not** change field count in this session (no conditional fields added/removed).

### Phase 4 — Form field intelligence

- CapHome **Permit Type** dropdown includes **`Re-Roof Permit`** (also many commercial/residential types). Locator: `#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType`.
- License types include **`Roofing`**, `Building/Roof`, `General/Roof`, etc. Locator: `#ctl00_PlaceHolderMain_generalSearchForm_ddlGSLicenseType`.
- CapApplyDisclaimer: checkbox `#ctl00_PlaceHolderMain_termAccept` present/unchecked; Continue = `#ctl00_PlaceHolderMain_btnNextStep` (config also keeps bottom bar continue as fallback).
- **CapEdit app-spec fields** (gateCode, NOC, workType, etc.) were **not** re-probed in Batch B because reaching CapType/CapEdit for a **new** apply requires accepting attestation (forbidden here). Existing CapEdit selectors in config remain from prior verification; Batch C can confirm live after explicit approval.

### Phase 5 — Network observation

Notable Accela paths while navigating (cap IDs redacted in log):

- `/POLKCO/Handlers/SessionTimeOutHandler.ashx` (frequent keep-alive)
- `/POLKCO/api/LabelKey/*`, `/POLKCO/api/Settings/configValue`
- `/POLKCO/Cap/CapHome.aspx`, `/POLKCO/Cap/CapDetail.aspx`
- `/POLKCO/FileUpload/AttachmentsList.aspx` (opened when visiting attachments UI on CapDetail)

### Phase 6 — Document requirements

- **Account-level** (AccountManager): chrome text lists attachments for **Certificate of Insurance, Business Tax Receipt, State License, etc.** — company account docs, not per-job.
- **CapDetail sample** (identity redacted): record type chrome showed Re-Roof Permit; Record Info / Payments / Digital Projects / Expand More Details present. Payments flagged dangerous — not clicked. Attachments surface uses `FileUpload/AttachmentsList.aspx` (no direct `<input type=file>` in main DOM).
- Per-permit NOC / product approval / affidavit upload still expected on CapEdit / attachment steps of **new** apply (not reachable without attestation in Batch B).

### Draft cleanup (required before Batch C)

**Answer: No clean Discard/Delete Draft control observed.**

Scanned: CapHome, MyRecords toolbar (Download / Add to collection / Add to cart only), sample CapDetail actions, Shopping Cart (Checkout / Edit Cart — pay path, not draft discard), AccountManager.  
No Discard / Delete Draft / Abandon Application / Withdraw Application control located.  
Batch A2 shows **0 Incomplete/Draft** records among 76 history rows — no live incomplete draft to inspect further without creating one (would require attestation + Save and Resume Later).

Known draft **create** path remains CapEdit `#ctl00_PlaceHolderMain_actionBarBottom_btnSave` (Save and Resume Later) in config. Cleanup strategy for automation is **unresolved** until Batch C or an incomplete draft appears.

Config: `draftCleanup.discardControlFound: false`.

---

## Batch A2 — Permit history patterns (2026-07-30)

Raw (gitignored, contains PII): `tmp/polk-batch-a2/raw-history.json`  
Aggregate only: `tmp/polk-batch-a2/pattern-summary.json`

Portal reports **76** records. Unique alt IDs scraped: **76**. Incomplete/draft count: **0**.

Combined aggregates (no permit numbers / addresses in summary):

- Status: Closed-Complete ~58, Closed-Inactive ~6, Closed-Withdrawn 2, Closed-Denied 1, Additional Info Required 1, unknown column-layout ~8
- Type: Re-Roof Permit dominant (~66), plus rare renovation/licensing types
- Year span: 2018–2026 (peak ~2022–2024)
- Prefix: mostly `BT`, rare `BR` / `BL`

---

## Correction-flow inspect (2026-07-30) — PROVISIONAL / LICENSE ONLY

> **SCOPE WARNING — READ BEFORE USING**  
> Observed on a **business-license renewal** CapDetail (`BL-…` / Contractor Licensing–MH Parks Renewal) with status **Additional Info Required**.  
> These are **general Accela correction-flow patterns**, **not** confirmed against the **`BT-…` Re-Roof Permit** workflow.  
> **Do not** treat selectors below as permit-validated error-handling until a real roofing permit hits Additional Info Required (Batch C or future live case).  
> Artifacts (gitignored): `tmp/polk-correction-inspect/` (raw may contain PII; `correction-summary.json` is redacted).

### Safety
- View-only CapDetail. **No** Respond / Edit / Resume / Upload / Submit / Pay / Delete / Comments entry.
- Attachment upload controls and Digital Projects were **located only**, not activated.

### How Polk communicates the correction (on this license record)
1. **Record Status** banner: `#ctl00_PlaceHolderMain_lblRecordStatus` inside `#ctl00_PlaceHolderMain_divRecordStatus` → `Additional Info Required`.
2. **Processing Status** workflow panel: `#ctl00_PlaceHolderMain_divProcessStatus`, detail in `#divProcessInfo` / `#divProcessingTable`.
   - Pattern: workflow step marked Additional Info Required with **date + staff comment**.
   - Comment theme (redacted): missing/incomplete license attachment for renewal; staff noted they emailed the contact.
   - **No deadline** field observed on the surfaces scanned.
3. **Not** a discrete form-field highlight / ASI flag in what we saw — status + workflow comment is the communication channel.
4. Page help text: *If Revisions Required — Click on Digital Projects and click on Comments* (Comments **not** clicked).

### Response mechanism (located, not used)
| Control | Locator | Notes |
|---------|---------|--------|
| Dedicated “Respond to Correction” | — | **Not found** |
| Attachments → Select from Account | `#ctl00_PlaceHolderMain_attachmentEdit_btnSelectFromAccount` | Editable surface risk — do not click in discovery |
| Attachments → Add/Browse | `#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse` | Same |
| File input | `#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload` | In DOM; not activated |
| Digital Projects tab | `a[data-control="tab-custom_component"]` | Documented revisions path; not deeply entered |
| Condition detail (script ref) | `/POLKCO/Cap/ConditionOfApprovalDetail.aspx` | Referenced in page JS; not navigated |

**Implication for future automation (provisional):** monitoring may watch `#ctl00_PlaceHolderMain_lblRecordStatus` + parse `#divProcessInfo` comments; response likely goes through **Attachments** and/or **Digital Projects → Comments**, not a single Respond button. **Re-verify on a BT roofing permit before coding permit error-handling.**

### CapDetail tab chrome (license record)
- Expand: `#lnkMoreDetail`
- Tabs via `data-control`: `tab-record_detail`, `tab-processing_status`, `tab-related_records`, `tab-attachments`, `tab-inspections`, `tab-fee`, `tab-custom_component` (Digital Projects)

Config: see `provisionalCorrectionFlowLicenseOnly` — explicitly `validatedForRoofingPermit: false`.
