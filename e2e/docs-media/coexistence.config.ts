import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.join(__dirname, 'out', 'coexistence', 'test-output'),
  reporter: [['list']],
  retries: 0,
  testDir: __dirname,
  testMatch: 'coexistence.spec.ts',
  timeout: 240_000,
  use: { actionTimeout: 20_000 },
  workers: 1,
});
