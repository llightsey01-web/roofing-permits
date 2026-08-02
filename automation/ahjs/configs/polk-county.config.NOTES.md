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

---

## Batch C — Manual wizard field map (2026-08-02)

**Source:** Logan manual walkthrough on live draft **`26TMP-043760`** (Re-Roof Permit).  
**Test job site:** 4405 Glenns Landing, Winter Haven, FL 33884 (authorized test property).  
**Artifacts (gitignored):** `tmp/polk-batch-c/screenshots/` (13 walkthrough PNGs + earlier Batch C automation captures), `batch-c-step1-2.json`.

**Safety (confirmed):** No submit, no payment data entered, no delete/cancel/schedule. Payment modal (Forte) opened and closed empty. Draft remains incomplete.

**Config status:** Findings documented here only — **`polk-county.config.js` not updated** pending review.

### Wizard structure (5 top-level steps)

Accela CapEdit progress bar labels:

| Step | UI label | Sub-pages observed |
|------|----------|-------------------|
| 1 | **Location & People** | Location Information → Permit Information (Custom Fields) → Contact Information (Primary LP) → Contact Information Cont. (Subcontractors) |
| 2 | **Permit Detail** | Work Description |
| 3 | **Documents** | Plan upload acknowledgement only (no file picker at apply time) |
| 4 | **Review** | Read-only summary of all prior steps |
| 5 | **Record Issuance** | Fee estimate screen titled **“Step 5: Pay Fees”** → Checkout → cart/payment sub-flow |

Global action buttons on every wizard page: **Save and resume later** (`#ctl00_PlaceHolderMain_actionBarBottom_btnSave`), **Continue Application »** (bottom bar continue).

CapEdit URL pattern on resume:  
`/POLKCO/Cap/CapEdit.aspx?permitType=resume&Module=Building&isFeeEstimator=N&stepNumber=…&pageNumber=…`

---

### Resume Application page-flow modal (headless gap — now confirmed)

After clicking **Resume Application** on My Records for an incomplete draft, Accela shows a modal **before** CapEdit loads:

| Property | Value |
|----------|-------|
| Title | **Resume Application: Select Application Page Flow Step** |
| Container | `#dvACADialogLayer` |
| Option 1 | **Start from the beginning** (radio) |
| Option 2 | **Pick up where I left off** (radio — **default selected**) |
| Actions | **OK**, **Cancel**, close **×** |

**Automation implication:** Headless resume failures (Batch C scripts) stopped on MyRecords because this modal was never handled. Production flow must: click Resume → wait for `#dvACADialogLayer` → select “Pick up where I left off” → OK → then expect CapEdit.

Screenshot: `tmp/polk-batch-c/modal-inspect.png`.

---

### Step 1 — Location & People

#### 1a. Location Information (`Step 1: Location & People > Location Information`)

**Job Site Address** — search populates parcel + owner.

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Street No. | text | yes | `4405` | `streetNo` |
| Street Name | text | yes | `GLENNS` | `streetName` |
| Direction | dropdown | no | `--Select--` | `streetDirection` |
| Street Type | dropdown | yes | `LNDG` | `streetType` |
| Unit No. | text | no | (empty) | `unitNo` |
| City | text | yes | `WINTER HAVEN` | `city` |
| State | text | yes | `FL` | `state` |
| Zip | text | yes | `33884` | `zip` |
| Search / Clear | buttons | — | Search used | `addressSearchBtn` |

**Address search quirk (Batch C Step 1 automation):** Street name **`GLENNS`** + street type **`LNDG`** works; single field value **`GLENNS LANDING`** did not resolve.

Help text: *“If the job site address does not exist, please use the job site parcel number”*.

**Parcel**

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Parcel Number | text | yes | `262901663566000410` | `parcelNo` |
| Search / Clear | buttons | — | auto-filled from address | `parcelSearchBtn` |

Help text: license renewal path uses 18 zeros — not applicable to re-roof.

**Owner** (auto-populated from parcel; editable via Search)

| Label | Type | Test value | Config selector |
|-------|------|------------|-----------------|
| Owner Name | text | `LIGHTSEY LOGAN R` | `ownerName` |
| Address Line 1 | text | `2204 BEAR RUN N` | `ownerAddress1` |
| City | text | `FROSTPROOF` | `ownerCity` |
| State | text | `FL` | `ownerState` |
| Zip | text | `33843` | `ownerZip` |
| OWNER | text (repeat) | `LIGHTSEY LOGAN R` | — |

> **NOC / owner-of-record flag:** Owner mailing address (**2204 BEAR RUN N, FROSTPROOF FL 33843**) differs from job site (**4405 GLENNS LNDG, WINTER HAVEN FL 33884**). Review step shows both explicitly. DART iQ must treat **owner of record** (parcel-derived) separately from **job site address** when generating Notice of Commencement and related owner fields.

#### 1b. Permit Information (`Step 1: Location & People > Permit Information`)

Section header: **Custom Fields**. Subsections below.

##### GENERAL INFORMATION

| Label | Type | Required | Test value (Review) | Config selector / notes |
|-------|------|----------|---------------------|-------------------------|
| Is a Gate Code Required for Access | Y/N radio | yes | **No** | `gateAccessYes` / `gateAccessNo` |
| Gate Code | text | conditional | (empty) | `gateCode` — shown when gate = Yes |
| Is this Application a result of a Code Violation | Y/N radio | yes | **No** | `codeViolationYes` / `codeViolationNo` |
| Code Violation Case Number | text | conditional | (empty) | — when violation = Yes |
| Is the Applicant the Owner | Y/N radio | yes | **No** | — **no config selector yet** (see open items) |
| Construction Waste Acknowledgement | dropdown | no | (blank / `--Select--`) | — **not in config; skip entirely** (see business rules below) |
| Commercial Franchise Holder Name | text | no | (empty) | — |
| Commercial Franchise Holder Phone | text | no | (empty) | — |
| Disposal Equipment | text | no | (empty) | — |
| Disposal Frequency | text | no | (empty) | — |
| Notice of Commencement (NOC) | dropdown | yes | **Recorded** | `nocDropdown` — see confirmed enums |
| Nearest cross street or special instructions needed to find jobsite | textarea | yes | (blank — test used `BATCH-C-TEST-DO-NOT-SUBMIT`) | `crossStreet` — **leave blank by default** |
| How is the permit packet (plans, supporting documents, FL product approval, etc.) submitted? | dropdown | yes | **Electronically** | `packetSubmission` — full enum still open |
| Would you like inspections to be performed virtually if required criteria is met? | Y/N radio | no | **No** | — |
| FS 119 Status | dropdown + **help (?) icon** | yes | **Non-Exempt** | `fs119Status` — see tooltip + default review below |

##### PRIVATE PROVIDER INFORMATION

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Will a Private Provider be conducting Plans Review or Inspections for this Record? | Y/N radio | yes | **No** | `roofDeckYes` / `roofDeckNo` *(config IDs use `rdo_1_0_*` — verify label mapping before production use)* |

##### TRADE INFORMATION

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Work Type | dropdown | yes | **New** | `workType` — see confirmed enums |
| Property Type | dropdown | yes | **Residential** | `propertyType` — see confirmed enums |

##### REROOF INFORMATION

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Reroof Permit Type | dropdown | yes | **Reroof** | `reroofPermitType` — see confirmed enums |
| Number of Squares | numeric text | yes | **25** | `numberOfSquares` |
| Roof Type | dropdown | yes | **Composition or Wood Shingles** | `roofType` |
| Re-Roof Affidavit acknowledgment | checkbox | yes | checked → Review shows **Yes** | `reroofAffidavit` |
| Asbestos Notification Statement (FS 469.003) | checkbox | yes | checked → Review shows **Yes** | `asbestosStatement` |

**Roof Type — full option list** (confirmed Batch C Step 1 automation scrape + manual walkthrough):

1. Built-up  
2. Composition or Wood Shingles  
3. **Metal**  
4. Tile  
5. TPO  

**Affidavit checkbox label (exact):**  
*“I understand Re-Roof Affidavits must be on jobsite when inspection is scheduled.”*

**Asbestos checkbox label (exact):**  
*“Asbestos Notification Statement: As the applicant, I certify that I will comply with the provisions of Section 469.003, Florida Statutes regarding asbestos abatement and will notify the Department of Environmental Protection of any intentions to remove asbestos, when applicable, in accordance with state and Federal law.”*

#### Confirmed dropdown enums (2026-08-02 — verbatim portal order)

##### Notice of Commencement (NOC) — `#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_0_10`

1. `--Select--`
2. `N/A`
3. `Needed`
4. `Recorded`

**Config mismatch:** Current config `defaultValues.nocDropdown` is `NOC Exempt - Valuation Less Than$2,500` — **not present in portal enum**. DART iQ should map job NOC state to one of the four values above (typically **Recorded** when NOC is on file, **Needed** when pending).

##### Work Type — `#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_2_0`

1. `--Select--`
2. `Addition`
3. `Alteration`
4. `New`
5. `Repair`

**Config mismatch:** Current config default `Replacement` — **not in portal enum**. Standard re-roof tear-off/replace likely maps to **`New`** (confirmed in test data).

##### Property Type — `#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_2_1`

1. `--Select--`
2. `Commercial`
3. `Residential`

##### Reroof Permit Type — `#ctl00_PlaceHolderMain_AppSpecC11AD441Edit_POLKCO_ddl_3_0`

1. `--Select--`
2. `Reroof`
3. `Roof Cover 3 inches or Less`
4. `Roof Over More Than 3 inches`

**Config mismatch:** Current config default `Complete Re-Roof` — **not in portal enum**. Default **`Reroof`** (~99%); admin override for roof-over/recover variants.
##### FS 119 Status — help tooltip (verbatim)

> *“Is the property owner's information protected from public record (police officers, inspectors, etc.)?”*

**Meaning:** FS 119 Status is about **public-records exemption eligibility** (e.g., law enforcement, inspectors, other protected professions under Florida Statute 119) — **not** a generic compliance or NOC field.

**Default review (resolved):** **Non-Exempt** is the automation fallback for typical residential jobs. Rare exceptions (protected-profession homeowner) use **admin-only job override** — not contractor intake. See *Automation defaults & override policy* below.

#### Automation defaults & override policy (confirmed 2026-08-02)

**Policy:** Values are **typically the same unless otherwise noted** (~99% case). Hardcode sensible defaults for config merge; rare exceptions use **admin-only job overrides** — not contractor intake, not flat unoverridable constants.

**Do not add contractor intake fields** for any item in the tables below.

##### Hardcode as portal defaults (→ `defaultValues` / field-fill on merge)

| Portal field | Default | Config selector (existing) |
|--------------|---------|------------------------------|
| Re-Roof Affidavit acknowledgment | **always checked** | `reroofAffidavit` |
| Asbestos Notification (FS 469.003) | **always checked** | `asbestosStatement` |
| Plan Upload Acknowledgement (Step 3) | **always checked** | — *(add selector on merge)* |
| Virtual Inspections | **No** | — *(selector TBD)* |
| Private Provider Plans Review/Inspections | **No** | `roofDeckNo` *(verify DOM — open item)* |
| Packet submission method | **Electronically** | `packetSubmission` |
| Is the Applicant the Owner | **No** | — *(selector TBD)* |
| **Reroof Permit Type** | **`Reroof`** (~99% full tear-off) | `reroofPermitType` |

##### Leave blank / unset (field-fill skips)

| Portal field | Rule |
|--------------|------|
| Construction Waste Acknowledgement | `--Select--` / blank — never set |
| Commercial Franchise Holder Name / Phone | blank |
| Disposal Equipment / Disposal Frequency | blank |
| Nearest cross street / special instructions | blank — geocoding deferred |

##### Admin-only job overrides (`job_specs.portal_overrides` — proposed storage)

Visible only on **`/admin/jobs/[id]`** (`AdminJobDetailPage`). Blank by default. Automation: **if override set → use it; else → hardcoded default**.

| Override key(s) | Portal field(s) | Fallback default |
|-----------------|-----------------|------------------|
| `gate_code_required` (bool) + `gate_code` (text) | Gate Code Required / Gate Code | **No** + blank |
| `code_violation` (bool) + `code_violation_case_number` (text) | Code Violation / Case Number | **No** + blank |
| `fs119_status` (string) | FS 119 Status | **Non-Exempt** |
| `reroof_permit_type` (string) | Reroof Permit Type | **`Reroof`** — for rare roof-over/recover (`Roof Cover 3 inches or Less`, `Roof Over More Than 3 inches`) |

**Not an override (job-driven, not constant):** NOC dropdown → map from `noc_status` / `noc_option` (`Recorded`, `Needed`, `N/A`).

---

#### Admin override UI — placement spec (planning only, not built yet)

**Extend existing admin job detail** — do not duplicate contractor intake or legacy `/jobs/new`.

| Surface | Path | Role |
|---------|------|------|
| Contractor intake | `app/contractor/jobs/new/page.js` | **No new fields** — unchanged |
| Admin job detail | `app/admin/jobs/[id]/page.js` | **Add portal override panel here** |
| Legacy intake (reference only) | `app/jobs/new/page.js` | Has `job_specs.gate_code`, `cross_street` on old admin-layout form — **do not revive on contractor path** |

**Proposed panel:** New section **“Portal field overrides”** on `AdminJobDetailPage`, inserted **after “Job info”** and **before “Automation runs”** (~line 232 in current file). Keep existing **“Manual overrides”** panel (ops buttons: reset status, queue runs) separate — that panel is workflow control, not portal field values.

**Panel layout (admin-only, collapsible or always visible):**

```
Portal field overrides
  Subtext: "Rare exceptions only. Blank = automation uses Polk defaults."
  
  Gate access
    [ ] Gate code required    Gate code: [________]
  
  Code violation
    [ ] Application is code-violation driven    Case number: [________]
  
  FS 119 Status (public records exemption)
    [dropdown: -- use default (Non-Exempt) -- | Exempt | Non-Exempt | …]
    Help: tooltip text from portal
  
  Reroof permit type
    [dropdown: -- use default (Reroof) -- | Reroof | Roof Cover 3 inches or Less | Roof Over More Than 3 inches]
  
  [Save overrides]  → PATCH job.job_specs.portal_overrides via patchJob()
```

**Storage:** Nested JSON on existing `job_specs` column (no migration required for MVP):

```json
{
  "portal_overrides": {
    "gate_code_required": true,
    "gate_code": "1234",
    "code_violation": false,
    "fs119_status": null,
    "reroof_permit_type": "Roof Over More Than 3 inches"
  }
}
```

Null/absent keys → use fallback default. Follows existing pattern (`job_specs.proof`, `job_specs.erecord`, `job_specs.noc`).

**Read-only context in same panel:** Show current intake values automation will send (roof type, work type, squares, scope) so admin knows what the run will use without editing intake.

---

#### Contractor intake — explicit portal fields (implemented 2026-08-02)

**Decision:** Drop mapping/inference layer. Roof Type and Work Type are contractor intake dropdowns storing portal-exact values. Automation will pass through via `fieldMap` on config merge (`roof_type` → `roofType`, `work_type` → `workType`).

**Source of truth:** `lib/intake/portal-field-options.js` — includes Lee unverified comment at top of file.

**Lee enum status:** **Not independently verified** (no Lee credentials/portal access at implementation time). Global enum assumes Polk's five roof types apply to Lee's Accela ASI block — **verify before Lee Phase 2**. Do not treat Lee parity as confirmed fact.

##### Roof Type — `jobs.roof_type` (global portal-exact enum, Option A)

| Stored value | Intake label / hint |
|--------------|---------------------|
| `Built-up` | Built-up — low-slope BUR |
| `Composition or Wood Shingles` | Composition or Wood Shingles — asphalt shingle or wood shake |
| `Metal` | Metal |
| `Tile` | Tile |
| `TPO` | TPO — single-ply membrane |

**Retired intake values:** `Shingle`, `Flat`, `Modified Bitumen`.

##### Work Type — `jobs.work_type` (migration `20260802_jobs_work_type.sql`)

| Stored value | Intake label |
|--------------|--------------|
| `New` | New — full replacement |
| `Repair` | Repair |
| `Addition` | Addition |
| `Alteration` | Alteration |

No scope-of-work regex inference. `scope_of_work` = portal job description only.

##### Implementation files

- `lib/intake/portal-field-options.js`
- `app/contractor/jobs/new/page.js`
- `app/api/contractor/jobs/route.js`
- `app/contractor/jobs/[id]/page.js`, `review/page.js`, `app/admin/jobs/[id]/page.js`

**AHJ scoping:** Global enum — not gated on resolved AHJ. Revisit only if Lee DOM shows a different list (Option B).

##### Automation pass-through (config merge pending — `polk-county.config.js` untouched)

| Job field | Portal selector | Transform |
|-----------|-----------------|-----------|
| `roof_type` | `roofType` | none |
| `work_type` | `workType` | none |
| `scope_of_work` | job description | free text |

##### Reroof Permit Type — unchanged

Default **`Reroof`** + admin override for roof-over/recover — not on contractor intake.

##### Property Type

Still default **`Residential`** hardcoded (not on intake) until commercial jobs appear.

---

#### Post-submit document upload — distinct automation phase

**Finding (Batch C Step 3):** Polk's Re-Roof wizard **does not accept plan/file uploads during apply**. Step 3 is acknowledgement-only; on-page copy states uploads happen **after submitting** the application. Digitally signed/sealed docs void when printed.

**Architecture implication:** Document upload is **not** an inline wizard step. Split automation into phases:

| Phase | Scope | Stop boundary |
|-------|--------|---------------|
| **A — Application wizard** | Disclaimer → CapType → CapEdit Steps 1–4 → submit (when approved) | Stop before pay unless ops explicitly runs payment phase |
| **B — Post-submit attachments** | CapDetail / `FileUpload/AttachmentsList.aspx` (or post-issuance attachment surface) | Separate run type or post-submit step after record exists |
| **C — Payment** | Cart → Forte | Existing payment boundary |

**Runner / config merge action:** Do not add `upload_documents` to the same step array as `fill_permit_detail`. Add a documented **`post_submit_upload`** phase (new run step or run type) with its own selectors discovered from CapDetail attachments tab (Batch B located `AttachmentsList.aspx`, no file input in main CapEdit DOM).

**DART iQ prep requirements** (from Step 3 guidance): filename sanitization, approved digital-signature CAs, unique sheet numbers, TOC/bookmark order (C/B/G/S/A/E/M/P/L/I/T).

#### 1c. Contact Information — Primary Licensed Professional

Sub-heading: *“Select the Primary Contractor Only. Please click continue to select the Sub-Contractors on the next screen.”* (red instructional text)

Auto-populated from logged-in account — **not editable inline**; **Edit** / **Remove** links present.

| Field | Test value |
|-------|------------|
| Name | Matthew Robert Craig |
| Company | GATOR ROOF SYSTEMS AND CONSTRUCTION, INC. |
| License | Roofing — **CCC1331510** |
| Address | 406 4TH AVE, MELBOURNE BEACH, 32951 |
| Fax | 5057801756 |
| Email | roofing@gator-industries.com |

Logged-in display name elsewhere: **Matthew Craig** (portal header).

#### 1d. Contact Information Cont. — Subcontractors

Optional. Empty by default.

| Control | Notes |
|---------|-------|
| **Select from Account** | button |
| **Look Up** | button |
| Grid columns | License Number, License Type, Contact Name, Business Name, Action |
| State | “Showing 0-0 of 0” / No records found |

Instruction: *“Select all known Sub-Contractors.”*

---

### Step 2 — Permit Detail (`Step 2: Permit Detail > Work Description`)

##### Detail Information

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Job Description (Enter brief description of work being done) | textarea | yes | `tear off existing shingle roof and replace with new shingle roof` | — **not in config yet** |

##### Additional Information

| Label | Type | Required | Test value | Config selector |
|-------|------|----------|------------|-----------------|
| Job Value($) | numeric text | yes | `13000` (Review: **13,000.00**) | — maps to job `valuation` / preflight |

---

### Step 3 — Documents (`Step 3: Documents`)

**No file upload control at apply time.** On-page instructions state plans/supporting documents are uploaded **after submitting** the application.

##### On-page guidance (plan-set prep — relevant for DART iQ document packaging)

- Avoid special characters in filenames (download issues).
- **Accepted digital signature CAs** (engineer/architect sealed docs): IdenTrust, Entrust, DigiCert, GlobalSign, Notarius Inc., Sectigo, DocuSign *(Digital Certificates Only)*, Adobe *(Digital Certificates Only)*.
- Each plan sheet number must be unique; table of contents / PDF bookmarks recommended.
- **Suggested sheet order:** C (cover/construction), B (boundary survey), G (general notes), S (structural/survey), A (architectural), E (electrical), M (mechanical), P (plumbing/preliminary plat), L (landscaping), I (irrigation), T (topo).
- Tutorial link: `https://www.polk-county.net/services/building/`

##### Upload Plans and Documents

| Label | Type | Required | Test value |
|-------|------|----------|------------|
| PLAN UPLOAD ACKNOWLEDGEMENT | checkbox | yes | checked → Review **Yes** |

Checkbox text (exact):  
*“I acknowledge that I will upload plans, supporting documents and attachments after submitting my application. Digitally signed and sealed documents are void when printed.”*

---

### Step 4 — Review (`Step 4: Review`)

Read-only summary with per-section **Edit** links. Confirms all applicant-entered values plus system-derived fields:

| Section | Key read-only values |
|---------|---------------------|
| Record Type | Re-Roof Permit |
| Job Site Address | 4405 GLENNS LNDG, WINTER HAVEN FL 33884 |
| Parcel | 262901663566000410 |
| Owner | LIGHTSEY LOGAN R — 2204 BEAR RUN N, FROSTPROOF FL 33843 |
| Custom Fields | All General / Private Provider / Trade / Reroof values (see 1b) |
| Primary Licensed Professional | Gator account (see 1c) |
| Subcontractors | (empty) |
| Detail Information | Job description text |
| Additional Information | Job Value $13,000.00 |
| Upload Plans and Documents | Acknowledgement Yes |

Instruction: *“Please review all information below. Click the ‘Edit’ buttons to make changes to sections or ‘Continue Application’ to move on.”*

---

### Step 5 — Pay Fees / Record Issuance (payment boundary — documented only)

#### 5a. Fee estimate (`Step 5: Pay Fees`)

**Exception (red text):**  
*“If your permit was issued by The Town of Dundee, Fort Meade or Polk City you cannot pay any fees online. Please contact their office for payment.”*

| Fee line | Qty | Amount |
|----------|-----|--------|
| B Surcharge BCAIB 1.5% | 1 | $2.00 |
| B Surcharge FBC 1% | 1 | $2.00 |
| B Re_Roof | 90.75 | $90.75 |
| **Total Fees** | | **$94.75** |

Note on screen: *“This does not include additional inspection fees which may be assessed later.”*

**Fee observation:** For **25 squares**, `B Re_Roof` qty and amount both show **90.75** — likely square-footage-derived base fee; exact formula not confirmed.

Action: **Check Out »** → Shopping Cart.

#### 5b. Cart sub-flow (3 steps)

| Sub-step | UI label | Test state |
|----------|----------|------------|
| 1 | **Select item to pay** | Cart (1) — 26TMP-043760 Re-Roof Permit @ 4405 GLENNS LNDG — **$94.75** |
| 2 | **Payment information** | Amount $94.75; **Pay with Credit Card** / **Pay with Bank Account** radios |
| 3 | **Receipt/Record issuance** | not reached |

Cart actions: **Checkout »**, **Edit Cart »**, **Continue Shopping »**.  
Config refs: `shoppingCartUrl`, `cartCheckoutBtn`, `cartEditBtn`.

Payment information page notes payment methods: Credit Card, Bank Account, **Trust Account**. Red warning: *“When paying with Credit Card or Bank Account be sure to select the correct department (Building Division or Land Development) on the next screen.”*

#### 5c. Third-party payment modal (Forte — boundary confirmed, not used)

Triggered from Payment information → **Submit Payment »**:

| Property | Value |
|----------|-------|
| Provider | **CSG Forte Payments, Inc.** (“Powered by CSG Forte Payments, Inc.”) |
| Header | POLK CO BLDG PERMITS WEB — PAYMENT METHOD |
| Method | Credit or debit card (radio) |
| Fields | Card number, Exp date (MM YYYY), Security code (CVV) |
| Cards shown | Visa, Mastercard, Discover, American Express |
| Action | **Next** (disabled until fields filled) |

**Automation stop rule:** Do not proceed past this modal in discovery runs.

---

### Config cross-check — values that differ from current `defaultValues`

Documented for review; **not changed in config** until deliberate merge. Planned overrides per *Automation defaults & job data model*:

| Field | Current config `defaultValues` | Planned portal value |
|-------|-------------------------------|----------------------|
| `nocDropdown` | `NOC Exempt - Valuation Less Than$2,500` | Job-driven: `Recorded` / `Needed` / `N/A` (not hardcoded constant) |
| `packetSubmission` | `Electronically through the portal` | **`Electronically`** (hardcode) |
| `fs119Status` | `Not Applicable` | **`Non-Exempt`** fallback; admin override when set |
| `workType` | `Replacement` | **`New`** default removed from inference — use **`jobs.work_type`** from intake |
| `reroofPermitType` | `Complete Re-Roof` | **`Reroof`** default; admin override for roof-over/recover |

---

### Open items — resolve via DOM inspection on next portal access

No further manual screenshots needed from Logan for these:

1. **Private Provider radio** — Confirm whether config selectors `roofDeckYes` / `roofDeckNo` (`AppSpecC11AD441Edit_POLKCO_rdo_1_0_*`) actually map to *“Will a Private Provider be conducting Plans Review or Inspections for this Record?”* or if that ID block is a leftover/incorrect mapping from another field (config naming suggests “roof deck”).
2. **B Re_Roof fee math** — Confirm qty **90.75** vs **25 squares** relationship (per-square rate, tiered schedule, or flat fee). Check Polk's public fee schedule (`https://www.polk-county.net/services/building/` or fee schedule linked from Batch B portal surfaces) rather than inferring from one data point.
3. **Trust Account payment** — Payment information copy lists Credit Card, Bank Account, and Trust Account, but only Credit Card / Bank Account radios appeared for Gator's account. Confirm whether Trust Account is role-gated (certain account types only) or not implemented on Polk's Forte integration.
4. **Applicant-is-Owner** — Confirm DOM selector for the Yes/No radio (*“Is the Applicant the Owner”*); add to config if missing. Business default for contractor-filed jobs likely **No**.

**Still open (lower priority):**

5. **Packet submission dropdown** — full enum + exact stored value for Review display **Electronically** vs config string **Electronically through the portal** (automation will hardcode **Electronically** regardless).
6. **FS 119 Status dropdown** — full option list (tooltip confirmed; enum values not yet captured; fallback **Non-Exempt** + admin override documented).

---

### Batch C — live Polk test drafts (Gator account artifacts)

**Not real customer permits.** Incomplete portal drafts created during Batch C discovery on Gator Roof Systems' live Polk Accela account. Do not treat as production work, do not submit/pay, do not reuse for customer jobs without explicit cleanup review.

| Record # | Created | How | Status at last check | Test property |
|----------|---------|-----|----------------------|---------------|
| **26TMP-043760** | 2026-07-31 (Batch C Step 1 automation + manual walkthrough 2026-08-02) | CapEdit Save and Resume Later — **only draft intentionally created** (Batch C rule: one draft max) | Incomplete — wizard walked through Step 5 Pay Fees boundary; **not submitted, not paid** | 4405 GLENNS LNDG, Winter Haven FL 33884 (authorized test) |

**No other `26TMP-*` drafts were created** in Batch C runs. Batch A/B/correction inspect did not create incomplete re-roof drafts (Batch A: disclaimer not accepted; Batch B: no CapEdit entry; correction inspect: BL license record only, view-only).

**Headless automation note:** Resume Application on **26TMP-043760** was confirmed manually; automated resume remained blocked on page-flow modal handling (deferred Phase 2).

---

### Batch C automation status (unchanged)

- **Draft create + Save and Resume Later:** succeeded (26TMP-043760).
- **Headless Resume Application:** failed — page-flow modal not handled; deferred to Phase 2.
- **Reuse test (shingle → metal):** deferred until resume automation or manual re-run.
- **Screenshots index:** `tmp/polk-batch-c/screenshots/` — walkthrough ordered ~1:05 PM (Step 1 custom fields) through ~1:12 PM (Forte modal).
