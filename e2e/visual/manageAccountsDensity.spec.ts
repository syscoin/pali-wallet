import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('account lists remain compact with 44px actions and seven accounts', async ({}, info) => {
  test.setTimeout(180_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa123DensitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('account-list-density', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    const page = wallet.page;
    for (let index = 1; index <= 6; index += 1) {
      await wallet.gotoRoute('#/settings/account/new');
      await page
        .locator('#account-name-input')
        .fill(`Density account ${index}`);
      await page.locator('#create-btn').click();
      await page.getByRole('button', { name: /^ok$/i }).first().click();
      await wallet.ensureOnHome();
    }
    await wallet.gotoRoute('#/settings/manage-accounts');
    const list = page.locator(
      '[data-navigation-scroll="settings-manage-accounts"]'
    );
    await expect(list.locator('li')).toHaveCount(7);
    const observations: unknown[] = [];
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await page.setViewportSize(viewport);
      await list.evaluate((node) => (node.scrollTop = 0));
      await page.waitForTimeout(650);
      const measure = await list.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const rows = Array.from(node.querySelectorAll('li')).map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            y: rect.y,
            height: rect.height,
            fullyVisible:
              rect.top >= bounds.top && rect.bottom <= bounds.bottom,
          };
        });
        return {
          viewport: { width: innerWidth, height: innerHeight },
          height: bounds.height,
          scrollHeight: node.scrollHeight,
          visibleRows: rows.filter((row) => row.fullyVisible).length,
          rowPitch: rows[1].y - rows[0].y,
          rows,
        };
      });
      observations.push(measure);
      expect(measure.rowPitch).toBeGreaterThanOrEqual(44);
      expect(measure.rowPitch).toBeLessThanOrEqual(53);
      expect(measure.visibleRows).toBeGreaterThanOrEqual(
        viewport.height === 360 ? 2 : 6
      );
      const screenshot = info.outputPath(
        `density-${viewport.width}x${viewport.height}.png`
      );
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach(`density-${viewport.width}`, {
        path: screenshot,
        contentType: 'image/png',
      });
      const last = page.getByRole('button', {
        name: 'Edit: Density account 6',
        exact: true,
      });
      await last.scrollIntoViewIfNeeded();
      await page.waitForTimeout(650);
      const target = await last.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        );
        return {
          width: rect.width,
          height: rect.height,
          inViewport:
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            rect.left >= 0 &&
            rect.right <= innerWidth,
          centerHit: hit !== null && node.contains(hit),
        };
      });
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.inViewport).toBe(true);
      expect(target.centerHit).toBe(true);
    }
    expect(routes.deniedWrites).toEqual([]);
    const evidence = {
      ...extensionEvidence(),
      observations,
      deniedWrites: routes.deniedWrites,
    };
    fs.writeFileSync(
      info.outputPath('density-observations.json'),
      JSON.stringify(evidence, null, 2)
    );
    console.log('account-density', JSON.stringify(observations));
    await info.attach('density-observations', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
