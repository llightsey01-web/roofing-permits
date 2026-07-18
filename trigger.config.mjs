/**
 * Trigger.dev project config (JavaScript — no TypeScript).
 *
 * Set TRIGGER_PROJECT_REF in the environment (Dashboard → Project settings).
 * Playwright stays on Railway; Trigger only orchestrates durable control-plane steps.
 *
 * Dev:  npm run trigger:dev
 * Deploy: npm run trigger:deploy
 */

import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || 'proj_replace_me',
  dirs: ['./trigger'],
  runtime: 'node',
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 60 * 1000,
      factor: 2,
      randomize: true,
    },
  },
  // Keep Playwright / browser packages out of Trigger cloud builds
  build: {
    external: [
      'playwright',
      'playwright-core',
      '@playwright/test',
      'ws',
    ],
  },
})
