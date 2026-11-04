import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/recovery-ui', workers: 1,
  outputDir: '/private/tmp/pali-recovery-ui-leaf-proof/test-results',
  use: { baseURL: 'http://127.0.0.1:4188', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve-preview.cjs dist-native-recovery-ui 4188', url: 'http://127.0.0.1:4188', reuseExistingServer: false },
});
