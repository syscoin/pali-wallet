import { defineConfig } from '@playwright/test';
import path from 'path';

// Explicit opt-in: the ordinary docs capture still owns its existing suite.
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.join(__dirname, 'out', 'store-listing', 'test-output'),
  reporter: [['list']],
  retries: 0,
  testDir: __dirname,
  testMatch: 'store-listing.spec.ts',
  timeout: 180_000,
  use: { actionTimeout: 20_000 },
  workers: 1,
});
