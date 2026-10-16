import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_PATH,
  UTXO_FIXTURE_SEED,
  UtxoFixtureReadState,
} from '../harness/utxoFixture';

test('offline native Send: edited fees survive Confirm, Cancel and Back', async () => {
  test.setTimeout(240000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('10000000');
  let readState: UtxoFixtureReadState = {};
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
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      { readState: () => readState }
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
        .locator('xpath=//div[text()[normalize-space(.)="Network Fee"]]')
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
        await expect(page.locator('#home-balance')).toHaveText('0.1');
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
        await page
          .getByRole('button', { name: 'Advanced Details', exact: true })
          .click();
        const unsignedSize = page
          .getByText('Size before signing:', { exact: true })
          .first();
        await expect(unsignedSize).toBeVisible();
        await expect(
          unsignedSize.locator('..').getByText(/^\d+ vbytes$/)
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Advanced Details', exact: true })
          .click();
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
        await expect(page.locator('#home-balance')).toHaveText('0.1');
        expect(routes.deniedWrites).toEqual([]);
      }
    );

    const coin = (satoshis: bigint) =>
      `${satoshis / BigInt(100000000)}.${(satoshis % BigInt(100000000))
        .toString()
        .padStart(8, '0')}`.replace(/\.?0+$/, '');
    const reopenDraft = async () => {
      // Let the ordinary draft writer settle before destroying its document.
      await page.waitForTimeout(350);
      await page.goto('about:blank');
      await wallet!.gotoRoute('#/');
      if (await page.locator('#unlock-btn').isVisible()) await wallet!.unlock();
      await expect(page).toHaveURL(/#\/send\/sys$/);
    };
    const pendingBalance = (feeTotal: number) => {
      const pending = createUtxoFixture(String(10000000 - feeTotal));
      const parent = pending.parentTxs[0];
      readState = {
        balance: '10000000',
        unconfirmedBalance: String(-feeTotal),
        unconfirmedTxs: 1,
        utxos: [
          {
            txid: parent.getId(),
            vout: 0,
            value: String(10000000 - feeTotal),
            confirmations: 0,
            height: 0,
            address: fixture.userAddress,
            path: UTXO_FIXTURE_PATH,
          },
        ],
        rawTransactions: {
          [parent.getId()]: {
            txid: parent.getId(),
            hex: parent.toHex(),
            confirmations: 0,
            vin: [],
            vout: [],
          },
        },
      };
    };
    await wallet.step(
      'pending balance preserves manual amount and rebases explicit native MAX',
      async () => {
        await page.locator('#send-btn').click();
        await recipientInput.fill(fixture.recipientAddress);
        await amountInput.fill('0.09');
        await feeInput.fill('0.00000002');
        pendingBalance(226);
        await reopenDraft();
        await expect(page.getByText(/^0\.09999774\s+TSYS$/i)).toBeVisible();
        await expect(amountInput).toHaveValue('0.09');
        await page.getByText('MAX', { exact: true }).click();
        await expect(amountInput).toHaveValue('0.09999774');
        pendingBalance(452);
        await reopenDraft();
        await expect(amountInput).toHaveValue('0.09999548');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        const maxFee = await readConfirmFee();
        await expect(page.locator('p.text-2xl')).toHaveText(
          `${coin(BigInt(9999548) - maxFee.satoshis)} TSYS`
        );
        await expect(
          page.getByText('0.09999548 TSYS', { exact: true })
        ).toBeVisible();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(amountInput).toHaveValue('0.09999548');
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'unsafe fee rate is blocked and a sub-limit warning still permits unsigned review',
      async () => {
        await amountInput.fill('0.09');
        await feeInput.fill('0.0001');
        await expect(
          page.getByText(/exceeds the wallet safety limit/)
        ).toBeVisible();
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await feeInput.fill('0.00001');
        await expect(page.getByText(/higher than normal/)).toBeVisible();
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        const highFee = await readConfirmFee();
        expect(highFee.satoshis).toBeGreaterThan(secondFee.satoshis);
        await expect(page.locator('p.text-2xl')).toHaveText('0.09 TSYS');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(amountInput).toHaveValue('0.09');
        expect(Number(await feeInput.inputValue())).toBe(0.00001);
        // At popup size the fixed Next footer must not make the last option
        // unreachable. Exercise ordinary wheel scrolling, not auto-scroll click.
        await page.mouse.move(200, 450);
        await page.mouse.wheel(0, 400);
        await expect
          .poll(() =>
            page.getByRole('switch').evaluate((button) => {
              const box = button.getBoundingClientRect();
              const target = document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2
              );
              return (
                box.top >= 0 &&
                box.bottom <= innerHeight &&
                Boolean(
                  target && (target === button || button.contains(target))
                )
              );
            })
          )
          .toBe(true);
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
          nativeMaxPendingDeltaTested: true,
          manualAmountPreserved: '0.09',
          unsafeFeeRateBlocked: '0.0001',
          subLimitWarningReviewed: '0.00001',
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
