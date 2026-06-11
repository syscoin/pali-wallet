import { defineConfig } from '@playwright/test';
import path from 'path';

import { E2E_CONFIG } from './harness/config';

// Visual regression suite: pixel baselines for the core screens.
//
// Baselines are committed per-platform under e2e/visual/__screenshots__/.
// Dynamic regions (balances, fiat, fees, tx history) are masked inside the
// spec, so the suite must stay stable against live-chain drift.
//
// Run:    yarn e2e:visual
// Update: yarn e2e:visual:update   (after an intentional UI change)
export default defineConfig({
  expect: {
    toHaveScreenshot: {
      // Allow tiny anti-aliasing drift; anything visible fails.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: path.join(E2E_CONFIG.artifactsDir, 'visual-output'),
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: path.join(E2E_CONFIG.artifactsDir, 'visual-report'),
      },
    ],
  ],
  retries: 0,
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  testDir: path.join(__dirname, 'visual'),
  // Single onboarding + walk; generous for live network switch, but far
  // below the journey timeout since no on-chain confirmations are awaited.
  timeout: 8 * 60 * 1000,
  use: {
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
  },
  workers: 1,
});
