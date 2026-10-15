import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createSptFixture,
  installSptFixtureRoutes,
  SPT_BALANCE,
  SPT_BELOW_MAX,
  SPT_SYMBOL,
} from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('offline SPT: exact adjacent amount, MAX, Cancel/Back and draft reopen without signing', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG },
    fixture = createSptFixture(),
    server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('offline-spt-send-preview', {
      offlineHttpProxy: server.url,
    });
    const routes = await installSptFixtureRoutes(
        wallet.context,
        fixture,
        server.url
      ),
      page = wallet.page;
    const amount = page.getByPlaceholder('Amount', { exact: true }),
      recipient = page.getByPlaceholder('Receiver', { exact: true }),
      fee = page.locator('#fee-input');
    const restored = async (expected: string) => {
      await expect(page).toHaveURL(/#\/send\/sys$/);
      await expect(amount).toHaveValue(expected);
      await expect(recipient).toHaveValue(fixture.recipientAddress);
      await expect
        .poll(async () => Number(await fee.inputValue()))
        .toBe(0.00000002);
      await page.waitForTimeout(350);
      await expect(amount).toHaveValue(expected);
    };
    const confirm = async (expectedAmount: string) => {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page).toHaveURL(/#\/send\/confirm$/);
      await expect(
        page.getByRole('button', { name: 'Confirm', exact: true })
      ).toBeEnabled();
      const expected = `${expectedAmount} ${SPT_SYMBOL}`;
      await expect(page.locator('p.text-2xl')).toHaveText(expected);
      // This existing UI decodes the actual prepared PSBT, independently of
      // the typed amount retained in navigation/return context.
      await page
        .getByRole('button', { name: 'Advanced Details', exact: true })
        .click();
      await expect(
        page.getByText('Transaction outputs', { exact: true })
      ).toBeVisible();
      const allocation = page
        .getByText('Amount:', { exact: true })
        .locator('..')
        .filter({ has: page.getByText(expected, { exact: true }) });
      await expect(allocation).toHaveCount(1);
      await expect(
        allocation.getByText(expected, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Confirm', exact: true })
      ).toBeEnabled();
      const reviewErrors = await page
        .getByText(/^Unable to verify the origin type for asset /)
        .allTextContents();
      await test.info().attach('spt-review-state', {
        body: JSON.stringify({ expected, confirmEnabled: true, reviewErrors }),
        contentType: 'application/json',
      });
      expect(reviewErrors).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
    };
    await wallet.step(
      'onboard synthetic account and discover exact large SPT',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('0.001');
        await page.locator('#assets-btn').click();
        await page.getByText('Import Token', { exact: true }).click();
        await expect(page).toHaveURL(/#\/tokens\/add/);
        const importToken = page.getByRole('button', {
          name: `Import ${SPT_SYMBOL} token`,
          exact: true,
        });
        await importToken.click();
        await expect(importToken).toBeDisabled();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await wallet!.ensureOnHome();
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await page
          .getByRole('button', { name: /^(TSYS|SYS)$/i })
          .first()
          .click();
        await page
          .getByRole('menuitem')
          .filter({ hasText: SPT_SYMBOL })
          .click();
        await recipient.fill(fixture.recipientAddress);
        await amount.fill(SPT_BELOW_MAX);
        await fee.fill('0.00000002');
      }
    );
    await wallet.step(
      'one atomic unit below MAX survives normal Confirm and Cancel',
      async () => {
        await confirm(SPT_BELOW_MAX);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await restored(SPT_BELOW_MAX);
      }
    );
    await wallet.step(
      'adjacent non-MAX survives normal Confirm and header Back',
      async () => {
        await confirm(SPT_BELOW_MAX);
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await restored(SPT_BELOW_MAX);
      }
    );
    await wallet.step(
      'genuine MAX remains the exact token balance through Confirm and Back',
      async () => {
        await page.getByText('MAX', { exact: true }).click();
        await expect(amount).toHaveValue(SPT_BALANCE);
        await confirm(SPT_BALANCE);
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await restored(SPT_BALANCE);
      }
    );
    await wallet.step(
      'insufficient native fee blocks SPT preparation without signing',
      async () => {
        await amount.fill(SPT_BELOW_MAX);
        await fee.fill('0.00001');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(
          page.getByText(/insufficient funds/i).first()
        ).toBeVisible();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'adjacent non-MAX survives a fresh neutral app entry',
      async () => {
        await amount.fill(SPT_BELOW_MAX);
        await fee.fill('0.00000002');
        await restored(SPT_BELOW_MAX);
        // Leave the document, then use the normal popup entry. A hash-only
        // navigation would not rerun mount-time persisted-state restoration.
        await page.goto('about:blank');
        await wallet!.gotoRoute('#/');
        if (await page.locator('#unlock-btn').isVisible()) {
          await page.locator('#password').fill(E2E_CONFIG.password);
          await page.locator('#unlock-btn').click();
        }
        await restored(SPT_BELOW_MAX);
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'spt-preview.json'),
      JSON.stringify(
        {
          ...evidence,
          simulated: true,
          liveSPTSendTested: false,
          confirmationClicked: false,
          belowMax: SPT_BELOW_MAX,
          max: SPT_BALANCE,
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
          deniedUnknown: routes.deniedUnknown,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
