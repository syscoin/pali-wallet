import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  retries: 0,
  testDir: '.',
  testMatch: 'proverRuntime.spec.ts',
  workers: 1,
});
