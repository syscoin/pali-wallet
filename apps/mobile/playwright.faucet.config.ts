import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/faucet-ui', outputDir: './test-results/faucet', workers: 1,
  use: {
    launchOptions: { chromiumSandbox: true }, baseURL: 'http://127.0.0.1:4186', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/build-native-send-ui.cjs && node scripts/serve-preview.cjs dist-native-send-ui 4186', url: 'http://127.0.0.1:4186', reuseExistingServer: false, timeout: 120000 },
});
