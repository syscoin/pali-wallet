import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const PASSWORD = 'Qa123AccountSynthetic!2026';
type Observations = Record<string, unknown>;

async function withWallet(
  name: string,
  info: TestInfo,
  run: (wallet: PaliWallet, observations: Observations) => Promise<void>
) {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: PASSWORD,
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Observations = {};
  try {
    wallet = await PaliWallet.launch(name, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step('import the disposable public fixture', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.ensureOnHome();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
    });
    await run(wallet, observations);
    expect(routes.deniedWrites).toEqual([]);
    fs.writeFileSync(
      info.outputPath('runtime-evidence.json'),
      JSON.stringify(
        {
          ...extensionEvidence(),
          observations,
          deniedWrites: routes.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
          simulated: true,
          publicSyntheticOnly: true,
          controllerStateReplaced: false,
        },
        null,
        2
      )
    );
    status = 'passed';
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
        'input[type=password],textarea,p.font-mono,#import-account-identifier'
      ),
    ],
  });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function authenticate(page: Page) {
  await page.locator('#phraseview_password').fill(PASSWORD);
  await page
    .getByRole('button', { name: en.buttons.confirm, exact: true })
    .click();
}

test('backup and private key require fresh reveal after reauthentication', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet(
    'qa123-account-private-views',
    info,
    async (wallet, observations) => {
      const page = wallet.page;
      await wallet.step(
        'backup hide and reauthenticate never exports phrase to the report',
        async () => {
          await wallet.gotoRoute('#/settings/seed');
          await page.addStyleTag({
            content:
              'textarea,p.font-mono{-webkit-text-security:disc!important}',
          });
          await authenticate(page);
          await page.getByRole('button', { name: 'Show', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Hide', exact: true })
          ).toBeVisible();
          await page.locator('#phraseview_password').fill('');
          await expect(
            page.getByRole('button', { name: 'Hide', exact: true })
          ).toHaveCount(0);
          await authenticate(page);
          await expect(
            page.getByRole('button', { name: 'Show', exact: true })
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Hide', exact: true })
          ).toHaveCount(0);
          await expect(page.locator('textarea')).toHaveClass(/blur-sm/);
          observations.backupHiddenAfterReauthentication =
            (await page
              .getByRole('button', { name: 'Show', exact: true })
              .count()) === 1;
          await capture(page, info, 'backup-after-reauthentication');
        }
      );
      await wallet.step(
        'private key hide and reauthenticate never exports key to the report',
        async () => {
          await wallet.gotoRoute('#/settings/account/private-key');
          await page.addStyleTag({
            content: 'p.font-mono{-webkit-text-security:disc!important}',
          });
          await authenticate(page);
          await page.getByRole('button', { name: 'Show', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Hide', exact: true })
          ).toBeVisible();
          await page.locator('#phraseview_password').fill('');
          await expect(
            page.getByRole('button', { name: 'Hide', exact: true })
          ).toHaveCount(0);
          await authenticate(page);
          await expect(
            page.getByRole('button', { name: 'Show', exact: true })
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Hide', exact: true })
          ).toHaveCount(0);
          await expect(page.locator('p.font-mono')).toHaveCount(0);
          observations.privateKeyHiddenAfterReauthentication =
            (await page
              .getByRole('button', { name: 'Show', exact: true })
              .count()) === 1;
          await capture(page, info, 'private-key-after-reauthentication');
        }
      );
    }
  );
});

test('watch-only public address remains available without requesting a private-key password', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet(
    'qa123-account-watch-only',
    info,
    async (wallet, observations) => {
      const page = wallet.page;
      await wallet.step(
        'a public watch-only account must not have an exportable private key',
        async () => {
          const fixture = createIsolatedVaultFixture();
          await wallet.gotoRoute('#/settings/account/import');
          await page
            .locator('#account-name-input')
            .fill('QA123 public watch-only');
          await page.locator('#import-account-watch-only').check();
          await page
            .locator('#import-account-identifier')
            .fill(fixture.watchAddress);
          await page
            .getByRole('button', { name: en.buttons.import, exact: true })
            .click();
          await expect(
            page.getByText(en.settings.accountImported, { exact: true })
          ).toBeVisible();
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await wallet.ensureOnHome();
          await page.locator('#general-settings-button').click();
          observations.watchOnlyOffersYourKeys =
            (await page
              .getByText(en.accountMenu.yourKeys, { exact: true })
              .count()) === 1;
          await page
            .getByText(en.accountMenu.yourKeys, { exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/private-key$/);
          await expect(
            page.getByText(en.settings.watchOnlyNoPrivateKey, { exact: true })
          ).toBeVisible();
          await expect(page.locator('#phraseview_password')).toHaveCount(0);
          await expect(
            page.getByText(en.settings.yourPublicAddress, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(en.settings.yourXpub, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(en.settings.forgetWarning, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(en.start.wrongPassword, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByTitle(fixture.watchAddress, { exact: true })
          ).toHaveText(
            fixture.watchAddress.slice(0, 4) +
              '...' +
              fixture.watchAddress.slice(-16)
          );
          await expect(
            page.getByRole('link', {
              name: en.settings.seeOnExplorer,
              exact: true,
            })
          ).toHaveAttribute(
            'href',
            new RegExp(`/address/${fixture.watchAddress}$`)
          );
          observations.watchOnlyPasswordRequested = false;
          observations.watchOnlyHasReveal =
            (await page
              .getByRole('button', { name: /^(Show|Hide)$/ })
              .count()) > 0;
          await expect(
            page.getByRole('button', { name: /^(Show|Hide)$/ })
          ).toHaveCount(0);
          for (const viewport of [
            { width: 320, height: 360 },
            { width: 400, height: 620 },
          ]) {
            await page.setViewportSize(viewport);
            const publicAddress = page.getByTitle(fixture.watchAddress, {
              exact: true,
            });
            await publicAddress.scrollIntoViewIfNeeded();
            await capture(
              page,
              info,
              `watch-only-public-address-${viewport.width}`
            );
          }
        }
      );
    }
  );
});
