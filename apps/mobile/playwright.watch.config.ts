import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/watch-ui',
  workers: 1,
  use: {
    launchOptions: { chromiumSandbox: true },
    baseURL: 'http://127.0.0.1:4182',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-preview.cjs dist-native-watch-ui 4182',
    url: 'http://127.0.0.1:4182',
    reuseExistingServer: false,
  },
});
