# DART iQ Automation Architecture

## Directory Structure

- `ahjs/` — AHJ-specific runners and configs
- `ahjs/configs/` — Config files per county
- `ahjs/shared/` — Shared utilities
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

## AHJ Login Types

- `accela_legacy` — Traditional Accela with reCAPTCHA (Polk County)
- `accela_angular` — Angular CommunityView iframe, no CAPTCHA (Lee County)
- `custom` — Custom portal, needs bespoke runner

## Config Versioning

Each config has a `version` and `lastVerified` field.
When a portal changes, increment `version` and update `lastVerified`.

## Config Validation

```bash
node --check automation/ahjs/config-validator.js
node -e "require('./automation/ahjs/config-validator.js').validateAllConfigs()"
```

Call `validateAllConfigs()` at worker startup to catch missing required fields before any run is claimed.
