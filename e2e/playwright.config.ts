import { defineConfig } from '@playwright/test';
import path from 'path';

import { E2E_CONFIG } from './harness/config';

// Dedicated config for the agent e2e harness (journeys against live testnet).
// Run with: yarn e2e:harness  (or playwright test --config e2e/playwright.config.ts)
export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: path.join(E2E_CONFIG.artifactsDir, 'test-output'),
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: path.join(E2E_CONFIG.artifactsDir, 'playwright.json') },
    ],
    [
      'html',
      {
        open: 'never',
        outputFolder: path.join(E2E_CONFIG.artifactsDir, 'html-report'),
      },
    ],
  ],
  retries: 0,
  testDir: path.join(__dirname, 'journeys'),
  // Journeys wait on real testnet confirmations; keep this generous.
  timeout: 15 * 60 * 1000,
  use: {
    // Fail fast on stuck locators instead of burning the whole journey
    // timeout; slow on-chain waits pass explicit timeouts where needed.
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
  },
  // One worker: journeys share the same on-chain test seed and must not race
  // each other's nonces.
  workers: 1,
});
