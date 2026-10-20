import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('standalone wallet pages fit narrow windows without clipping controls', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NarrowWindowSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('wallet-narrow-windows', {
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
    const page = wallet.page;
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 320, height: 620 },
      { width: 360, height: 480 },
      { width: 400, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of ['home', 'receive', 'send/sys']) {
        await wallet.gotoRoute(`#/${route}`);
        await expect(
          page.locator('[data-navigation-scroll="wallet-layout"]')
        ).toBeVisible();
        const geometry = await page.evaluate(() => {
          const root = document.querySelector('#app-root')!;
          const layout = document.querySelector(
            '[data-navigation-scroll="wallet-layout"]'
          )!;
          const clipped = [
            ...document.querySelectorAll('button,input,textarea,select,a'),
          ]
            .filter(
              (element) => !element.closest('[aria-hidden="true"],[inert]')
            )
            .filter((element) => {
              const style = getComputedStyle(element);
              return style.visibility !== 'hidden' && style.display !== 'none';
            })
            .map((element) => ({
              box: element.getBoundingClientRect(),
              text: element.getAttribute('aria-label') || element.textContent,
            }))
            .filter(({ box }) => box.width > 0 && box.height > 0)
            .filter(({ box }) => box.left < -1 || box.right > innerWidth + 1)
            .map(({ box, text }) => ({ text, box: box.toJSON() }));
          return {
            width: innerWidth,
            root: root.getBoundingClientRect().toJSON(),
            layout: layout.getBoundingClientRect().toJSON(),
            clipped,
          };
        });
        await info.attach(`${route}-${viewport.width}x${viewport.height}`, {
          body: JSON.stringify(geometry, null, 2),
          contentType: 'application/json',
        });
        expect.soft(geometry.root.width).toBe(viewport.width);
        expect.soft(geometry.layout.width).toBe(viewport.width);
        expect.soft(geometry.clipped).toEqual([]);
        const directory = path.join(E2E_CONFIG.artifactsDir, 'wallet-width');
        fs.mkdirSync(directory, { recursive: true });
        await page.screenshot({
          path: path.join(
            directory,
            `${route.replaceAll('/', '-')}-${viewport.width}x${
              viewport.height
            }.png`
          ),
          animations: 'disabled',
        });
      }
    }
    expect(routes.deniedWrites).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
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
});
