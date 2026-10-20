import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function withWallet(
  name: string,
  info: TestInfo,
  run: (wallet: PaliWallet) => Promise<void>
) {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa121HomeAccountSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch(name, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture('99999999990000'),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.ensureOnHome();
    await run(wallet);
    expect(routes.deniedWrites).toEqual([]);
    fs.writeFileSync(
      info.outputPath('runtime-evidence.json'),
      JSON.stringify(
        {
          ...extensionEvidence(),
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          simulated: true,
          publicSyntheticOnly: true,
          controllerStateReplaced: false,
          deniedWrites: routes.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      )
    );
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
}

async function capture(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({
    path: file,
    animations: 'disabled',
    mask: [
      page.locator(
        'input[type=password], #import-account-identifier, textarea'
      ),
    ],
  });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

test('full native balance and symbol remain readable at320 and400', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa121-balance-regression', info, async (wallet) => {
    const page = wallet.page;
    await expect(page.locator('#home-balance')).toHaveText('999999.9999');
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('#home-balance')).toHaveCSS(
        'font-size',
        viewport.width < 400 ? '36px' : '48px'
      );
      const geometry = await page
        .locator('.balance-account')
        .evaluate((row) => {
          const entries = [...row.querySelectorAll('p')].map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              text: element.textContent,
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              visibleWidth: element.clientWidth,
              contentWidth: element.scrollWidth,
            };
          });
          return {
            entries,
            documentWidth: document.documentElement.scrollWidth,
          };
        });
      expect(geometry.entries.map(({ text }) => text)).toEqual([
        '999999.9999',
        'TSYS',
      ]);
      for (const bounds of geometry.entries) {
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(viewport.width);
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
        expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.visibleWidth);
      }
      expect(geometry.documentWidth).toBe(viewport.width);
      await info.attach(`balance-geometry-${viewport.width}`, {
        body: JSON.stringify(geometry),
        contentType: 'application/json',
      });
      await capture(page, info, `balance-${viewport.width}`);
    }
  });
});

test('Enter imports a valid private key and a watch-only address exactly once', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa121-import-enter-regression', info, async (wallet) => {
    const page = wallet.page;
    const accountCount = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) =>
            chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) =>
              resolve(Object.keys(state.vault.accounts.Imported).length)
            )
          )
      );
    const hd = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
    const fixture = createUtxoFixture();
    // The base fixture permits only its sending account. Watch-only import
    // independently checks this different public address with Blockbook.
    let watchLookups = 0;
    for (const origin of [
      'https://blockbook-dev.syscoin.org',
      'https://explorer-blockbook-dev.syscoin.org',
    ]) {
      await wallet.context.route(
        `${origin}/api/v2/address/${fixture.recipientAddress}?details=basic`,
        async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          watchLookups += 1;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              address: fixture.recipientAddress,
              balance: '0',
              unconfirmedBalance: '0',
              totalReceived: '0',
              totalSent: '0',
              txs: 0,
              unconfirmedTxs: 0,
              usedTokens: 0,
              tokens: [],
              tokensAsset: [],
            }),
          });
        }
      );
    }
    for (const { width, label, value, watchOnly } of [
      {
        width: 320,
        label: 'Keyboard private import',
        value: hd.deriveKeypair("m/84'/1'/7'/0/0").toWIF(),
        watchOnly: false,
      },
      {
        width: 400,
        label: 'Keyboard watch-only import',
        value: fixture.recipientAddress,
        watchOnly: true,
      },
    ]) {
      await page.setViewportSize({ width, height: width === 320 ? 360 : 620 });
      const before = await accountCount();
      await wallet.gotoRoute('#/settings/account/import');
      await page.addStyleTag({
        content:
          '#import-account-identifier { -webkit-text-security: disc !important; }',
      });
      await page.locator('#account-name-input').fill(label);
      if (watchOnly) await page.locator('#import-account-watch-only').check();
      const field = page.locator('#import-account-identifier');
      await field.fill(value);
      await expect(
        page.getByRole('button', { name: en.buttons.import, exact: true })
      ).toBeEnabled();
      await field.press('Enter');
      await expect(
        page.getByText(en.settings.accountImported, { exact: true })
      ).toBeVisible();
      await capture(page, info, `import-success-${width}`);
      expect(await accountCount()).toBe(before + 1);
      await page
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await wallet.ensureOnHome();
    }
    expect(watchLookups).toBeGreaterThan(0);
  });
});
