import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/activity-ui', workers: 1,
  use: {
    launchOptions: { chromiumSandbox: true }, baseURL: 'http://127.0.0.1:4181', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve-preview.cjs dist-native-activity-ui 4181', url: 'http://127.0.0.1:4181', reuseExistingServer: false },
});
