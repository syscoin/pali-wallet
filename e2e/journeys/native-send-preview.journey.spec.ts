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

test('offline native Send: edited fees survive Confirm, Cancel and Back', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe('4.0.91');
  const before = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  const server = await startUtxoFixtureServer();
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
    wallet = await PaliWallet.launch('offline-native-send-preview', {
      offlineHttpProxy: server.url,
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    const feeInput = page.locator('#fee-input');
    const recipientInput = page.getByPlaceholder('Receiver', { exact: true });
    const amountInput = page.getByPlaceholder('Amount', { exact: true });
    const assertRestored = async (rate: number) => {
      await expect(page).toHaveURL(/#\/send\/sys$/);
      await expect(recipientInput).toHaveValue(fixture.recipientAddress);
      await expect(amountInput).toHaveValue('0.0005');
      await expect
        .poll(async () => Number(await feeInput.inputValue()))
        .toBe(rate);
      // Allow the normal mount-time recommended-fee response to settle as well.
      await page.waitForTimeout(500);
      expect(Number(await feeInput.inputValue())).toBe(rate);
    };
    const readConfirmFee = async () => {
      await expect(page).toHaveURL(/#\/send\/confirm$/);
      // Inspect the ordinary confirmation card; never activate Confirm.
      await expect(
        page.getByRole('button', { name: 'Confirm', exact: true })
      ).toBeEnabled();
      const value = page
        .locator('xpath=//div[text()[normalize-space(.)="Estimated GasFee"]]')
        .locator('span')
        .filter({ hasText: /^\d+(?:\.\d+)? TSYS$/ })
        .last();
      await expect(value).toBeVisible();
      const text = (await value.innerText()).trim();
      const satoshis = BigInt(
        Math.round(Number(text.replace(/ TSYS$/, '')) * 1e8)
      );
      expect(satoshis).toBeGreaterThan(BigInt(0));
      return { text, satoshis };
    };

    await wallet.step(
      'import synthetic wallet with fixture-funded native balance',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('0.001');
      }
    );

    let recommendedRate = 0;
    let firstFee = { text: '', satoshis: BigInt(0) };
    let secondFee = { text: '', satoshis: BigInt(0) };
    await wallet.step(
      'edit native Send fee and prepare an unsigned confirmation',
      async () => {
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await expect
          .poll(async () => Number(await feeInput.inputValue()))
          .toBeGreaterThan(0);
        recommendedRate = Number(await feeInput.inputValue());
        expect(recommendedRate).not.toBe(0.00000002);
        await recipientInput.fill(fixture.recipientAddress);
        await amountInput.fill('0.0005');
        await feeInput.fill('0.00000002');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        firstFee = await readConfirmFee();
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    await wallet.step(
      'Cancel restores the exact selected fee, recipient and amount',
      async () => {
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await assertRestored(0.00000002);
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    await wallet.step(
      'a second fee edit updates the ordinary confirmation fee',
      async () => {
        await feeInput.fill('0.00000003');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        secondFee = await readConfirmFee();
        expect(secondFee.satoshis * BigInt(2)).toBe(
          firstFee.satoshis * BigInt(3)
        );
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    await wallet.step(
      'Back restores the second selected fee without submitting',
      async () => {
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await assertRestored(0.00000003);
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect(page.locator('#home-balance')).toHaveText('0.001');
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'native-send-preview.json'),
      JSON.stringify(
        {
          ...evidence,
          simulated: true,
          liveBridgeTested: false,
          confirmationClicked: false,
          recommendedRate,
          selectedRates: [0.00000002, 0.00000003],
          confirmationFees: [firstFee, secondFee].map(({ text, satoshis }) => ({
            text,
            satoshis: satoshis.toString(),
          })),
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
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
