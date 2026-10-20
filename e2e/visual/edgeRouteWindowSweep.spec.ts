import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function exposed(locator: Locator) {
  return locator.evaluate((element) => {
    const b = element.getBoundingClientRect();
    return (
      b.width > 0 &&
      b.height > 0 &&
      b.left >= 0 &&
      b.top >= 0 &&
      b.right <= innerWidth &&
      b.bottom <= innerHeight &&
      [
        [b.left + 2, b.top + b.height / 2],
        [b.right - 2, b.top + b.height / 2],
        [b.left + b.width / 2, b.top + 2],
        [b.left + b.width / 2, b.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (hit === element || element.contains(hit));
      })
    );
  });
}

async function reveal(page: Page, locator: Locator) {
  await page.mouse.move(page.viewportSize()!.width / 2, 150);
  for (let step = 0; step < 18; step++) {
    if (await exposed(locator)) return true;
    const b = await locator.boundingBox();
    await page.mouse.wheel(0, b && b.y < 0 ? -180 : 180);
    await page.waitForTimeout(80);
  }
  return exposed(locator);
}

test('network recovery, spam warning and batch status retain reachable controls', async ({}, info) => {
  test.setTimeout(150_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'EdgeRoutesSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let page: Page | undefined;
  const directory = path.join(E2E_CONFIG.artifactsDir, 'edge-route-windows');
  fs.mkdirSync(directory, { recursive: true });
  const capture = async (name: string) => {
    const file = path.join(directory, `${name}.png`);
    await page!.screenshot({ path: file, animations: 'disabled' });
    await info.attach(name, { path: file, contentType: 'image/png' });
  };
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('edge-route-windows', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    page = await wallet.context.newPage();
    const host = `${'a'.repeat(63)}.example.invalid`;
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      const size = `${viewport.width}x${viewport.height}`;
      for (const fixture of [
        {
          route: 'spam-warning',
          data: { requestCount: 999, eventName: 'synthetic-layout-spam' },
          actions: [en.spamWarning.blockTemporarily, en.buttons.continue],
          readable: [en.spamWarning.title, en.spamWarning.description],
        },
        {
          route: 'tx/calls-status',
          data: {
            callsStatus: {
              status: 200,
              chainId: '0x539',
              version: '2.0.0',
              atomic: false,
              id: `0x${'12'.repeat(32)}`,
              receipts: Array.from({ length: 8 }, (_, i) => ({
                transactionHash: `0x${String(i + 1).padStart(64, '0')}`,
                blockHash: `0x${'34'.repeat(32)}`,
                blockNumber: '0x12345',
                gasUsed: '0x12345',
                status: '0x1',
                logs: [],
              })),
            },
          },
          actions: [en.buttons.close],
          readable: [en.send.batchStatus],
        },
      ]) {
        await page.goto(
          `chrome-extension://${wallet.extensionId}/external.html?route=${
            fixture.route
          }&data=${encodeURIComponent(
            JSON.stringify({ host, ...fixture.data })
          )}`
        );
        await expect(page.locator('body.app-loaded')).toBeVisible();
        for (const label of fixture.readable) {
          const content = page.getByText(label, { exact: true });
          expect
            .soft(
              await reveal(page, content),
              `${fixture.route} ${size}: readable ${label}`
            )
            .toBe(true);
        }
        if (fixture.route === 'tx/calls-status') {
          const hostFits = await page
            .getByText(host, { exact: true })
            .evaluate((element) => element.scrollWidth <= element.clientWidth);
          expect.soft(hostFits, `batch origin wraps at ${size}`).toBe(true);
        }
        for (const label of fixture.actions) {
          const action = page.getByRole('button', { name: label, exact: true });
          await expect(action).toBeAttached();
          expect
            .soft(
              await reveal(page, action),
              `${fixture.route} ${size}: ${label}`
            )
            .toBe(true);
        }
        await capture(`${fixture.route.replaceAll('/', '-')}-${size}`);
      }
      await page.goto(
        `chrome-extension://${wallet.extensionId}/app.html#/chain-fail-to-connect`
      );
      for (const label of [
        en.chainError.goToAnotherNetwork,
        en.buttons.retryConnect,
      ]) {
        const action = page.getByRole('button', { name: label, exact: true });
        await expect(action).toBeAttached();
        expect
          .soft(await reveal(page, action), `network error ${size}: ${label}`)
          .toBe(true);
      }
      await capture(`network-error-${size}`);
      await page
        .getByRole('button', {
          name: en.chainError.goToAnotherNetwork,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/#\/switch-network/);
      const connect = page.getByRole('button', {
        name: en.buttons.connect,
        exact: true,
      });
      expect
        .soft(await reveal(page, connect), `network picker ${size}: Connect`)
        .toBe(true);
      await capture(`network-picker-${size}`);
    }
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    try {
      await page?.close().catch(() => undefined);
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
