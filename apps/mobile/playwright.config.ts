import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: [{
    command: 'node scripts/serve-preview.cjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  }, {
    command: 'node scripts/build-native-send-ui.cjs && node scripts/serve-preview.cjs dist-native-send-ui 4179',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 120000,
  }],
});
