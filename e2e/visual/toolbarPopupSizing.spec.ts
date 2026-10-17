import { chromium, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { startUtxoFixtureServer } from '../harness/utxoFixture';

test('native toolbar popup has its normal intrinsic size without an emulated viewport', async ({}, info) => {
  test.setTimeout(60_000);
  const extensionPath =
    process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath;
  const directory = path.join(E2E_CONFIG.artifactsDir, 'toolbar-popup-sizing');
  fs.mkdirSync(directory, { recursive: true });
  const server = await startUtxoFixtureServer();
  const profile = fs.mkdtempSync(path.join(directory, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    args: [
      ...(E2E_CONFIG.headless
        ? ['--headless=new', '--screen-info={0,0 1280x900}']
        : []),
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-quic',
      '--window-size=1280,900',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--enable-unsafe-extension-debugging',
    ],
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    proxy: { server: server.url, bypass: '<-loopback>' },
    // Toolbar popups choose their own dimensions from the document. A fixed
    // Playwright viewport masks intrinsic-sizing regressions in Chrome.
    viewport: null,
  });
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const extensionId = worker.url().split('/')[2];
    const port = fs
      .readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8')
      .split('\n')[0];
    if (!/^\d{1,5}$/.test(port)) throw new Error('Invalid owned CDP port');
    for (const opening of ['cold', 'reopened', 'reopened-again']) {
      await worker.evaluate(() => chrome.action.openPopup());
      // The initial Playwright connection does not adopt Chrome's toolbar
      // popup. Attach publicly over this owned browser's loopback CDP endpoint.
      const adopted = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const popup = adopted
        .contexts()[0]
        .pages()
        .find((page) =>
          page.url().startsWith(`chrome-extension://${extensionId}/app.html`)
        );
      if (!popup) throw new Error('Native Chrome action popup not discovered');
      await popup.waitForURL(`chrome-extension://${extensionId}/app.html*`);
      await popup.locator('body.app-loaded').waitFor();
      await expect(popup.locator('#initial-loader')).toHaveCSS('opacity', '0');
      const measurements = await popup.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return {
          isNativePopup: chrome.extension
            .getViews({ type: 'popup' })
            .includes(window),
          viewClassification: document.documentElement.dataset.paliView,
          viewport: { width: innerWidth, height: innerHeight },
          body: {
            width: document.body.getBoundingClientRect().width,
            height: document.body.getBoundingClientRect().height,
          },
          root: {
            width: document.querySelector('#app-root')!.getBoundingClientRect()
              .width,
            height: document.querySelector('#app-root')!.getBoundingClientRect()
              .height,
          },
          screen: { width: screen.availWidth, height: screen.availHeight },
        };
      });
      await info.attach(`native-toolbar-popup-${opening}-measurements`, {
        body: JSON.stringify(measurements, null, 2),
        contentType: 'application/json',
      });
      const screenshot = path.join(
        directory,
        `native-toolbar-popup-${opening}.png`
      );
      await popup.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach(`native-toolbar-popup-${opening}`, {
        path: screenshot,
        contentType: 'image/png',
      });
      expect(popup.viewportSize()).toBeNull();
      expect(measurements.isNativePopup).toBe(true);
      expect(measurements.viewport.width).toBe(400);
      // Native Chromium may cap extension popups at 600px. Never impose a
      // viewport to achieve these dimensions: that hid the 25px regression.
      expect(measurements.viewport.height).toBeGreaterThanOrEqual(600);
      expect(measurements.viewport.height).toBeLessThanOrEqual(620);
      expect(measurements.viewClassification).toBe('toolbar-popup');
      expect(measurements.body.height).toBe(620);
      expect(measurements.root.height).toBe(620);
      const importLink = popup.locator('#import-wallet-link');
      await expect(importLink).toBeVisible();
      const bounds = (await importLink.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        measurements.viewport.height
      );
      await popup.close();
    }
  } finally {
    await context.close();
    await server.close();
  }
});
