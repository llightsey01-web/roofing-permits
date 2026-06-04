# DART iQ Automation Architecture

## Directory Structure

- `ahjs/` — AHJ-specific runners and configs
- `ahjs/configs/` — Config files per county
- `ahjs/shared/` — Base runners and shared portal abstractions
- `shared/` — Cross-cutting utilities (screenshot, checkpoint, recovery, errors)
- `logs/` — Local debug logs (not committed)
- `test-*.js` — Diagnostic scripts (see below)

## Diagnostic Scripts

| Script | Purpose |
|--------|---------|
| `test-lee-login.js` | Lee County login verification |
| `test-epn-inspect.js` | ePN portal debugging |
| `test-end-to-end-visual.js` | Visual regression / full flow |
| `test-full-run.js` | Full pipeline test |
| `test-proof-placement.js` | Proof signature placement debugging |
| `test-prepare-erecord-package.js` | eRecord package preparation debugging |

## Adding a New AHJ

1. Copy `ahjs/configs/template.config.js` to `ahjs/configs/[county].config.js`
2. Fill in all TODO values
3. Run `node -e "require('./automation/ahjs/config-validator.js').validateAllConfigs()"`
4. Create `ahjs/[county].runner.js`
5. Add county to `automation/runner.js` routing
6. Add county to `worker/runner.js` routing
7. Test login: `node automation/test-[county]-login.js`

## Base Runner Architecture

County runners should eventually extend the base layer instead of duplicating lifecycle code.

| Module | Portal type | Purpose |
|--------|-------------|---------|
| `ahjs/shared/base-runner.js` | All | Config validation, `logRecoveryStart`, preflight, credentials, browser launch/close, `logStep` + checkpoint skips, `handleRunError` |
| `ahjs/shared/accela-base-runner.js` | Accela | Scaffold for login → disclaimer → permit type → address → parcel → legal description → save & resume (config selectors) |
| `ahjs/shared/citizenserve-base-runner.js` | CitizenServe | Scaffold for CitizenServe login and address search (different from Accela) |
| `ahjs/shared/custom-base-runner.js` | Custom | Minimal logging/checkpoint/recovery pattern for bespoke portals |

**Today:** `polk-county.runner.js` and `lee-county.runner.js` still contain full county logic. New counties should start from the matching base runner + `configs/template.config.js`.

```javascript
const { runAccelaBasePortal } = require('./ahjs/shared/accela-base-runner')
// await runAccelaBasePortal(jobData, runId, runnerOptions, config, hooks)
```

## AHJ Login Types

- `accela_legacy` — Traditional Accela with reCAPTCHA (Polk County) → `accela-base-runner`
- `accela_angular` — Angular CommunityView iframe, no CAPTCHA (Lee County) → `accela-base-runner`
- `custom` — Custom portal, needs bespoke runner → `custom-base-runner`
- CitizenServe portals → `citizenserve-base-runner`

## Config Versioning

Each config has a `version` and `lastVerified` field.
When a portal changes, increment `version` and update `lastVerified`.

## Config Validation

```bash
node --check automation/ahjs/config-validator.js
node -e "require('./automation/ahjs/config-validator.js').validateAllConfigs()"
```

Call `validateAllConfigs()` at worker startup to catch missing required fields before any run is claimed.
