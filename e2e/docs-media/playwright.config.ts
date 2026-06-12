import { defineConfig } from '@playwright/test';
import path from 'path';

// Dedicated config for the docs media capture suite. Produces the raw
// screenshots and screen recordings under e2e/docs-media/out/ that
// compose.mjs turns into the branded cards + mp4s shipped with the docs
// portal (docs/portal/static).
//
// Run with: yarn docs:media:capture  (then yarn docs:media:compose)
export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: path.join(__dirname, 'out', 'test-output'),
  reporter: [['list']],
  retries: 0,
  testDir: __dirname,
  testMatch: /(capture|debug-[a-z-]+)\.spec\.ts/,
  // The suite drives live-testnet flows (smart account ops); keep generous.
  timeout: 30 * 60 * 1000,
  use: {
    actionTimeout: 30_000,
  },
  workers: 1,
});
