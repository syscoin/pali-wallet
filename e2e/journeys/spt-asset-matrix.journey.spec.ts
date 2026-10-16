import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createSptAssetMatrixFixture,
  installSptAssetMatrixRoutes,
  ISptAssetMatrixCase,
  SPT_ASSET_MATRIX,
} from '../harness/sptAssetMatrixFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function inspectAssetCase(
  c: ISptAssetMatrixCase,
  missingContract = false
) {
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG },
    fixture = createSptAssetMatrixFixture(
      c.id,
      missingContract ? 'missing-contract' : undefined
    ),
    server = await startUtxoFixtureServer();
  const name = `offline-spt-matrix-${c.id}${
    missingContract ? '-missing-contract' : ''
  }`;
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const reviewedAmounts: string[] = [],
    pageErrors: string[] = [];
  try {
    wallet = await PaliWallet.launch(name, { offlineHttpProxy: server.url });
    const routes = await installSptAssetMatrixRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // Install renderer timers before the tested app document, not halfway
    // through React's existing timers. This neutral entry has no wallet yet.
    await page.goto('about:blank');
    await page.clock.install();
    await wallet.gotoRoute('#/');
    const amount = page.getByPlaceholder('Amount', { exact: true }),
      recipient = page.getByPlaceholder('Receiver', { exact: true }),
      fee = page.locator('#fee-input'),
      selected = page
        .getByRole('button', { name: c.symbol, exact: true })
        .and(page.locator('[aria-haspopup="menu"]'));
    const restored = async (expected: string) => {
      await expect(page).toHaveURL(/#\/send\/sys$/);
      await expect(selected).toBeVisible();
      // Drive the existing restoration timer, not a guessed wall-clock delay.
      // The page clock never replaces controller state, metadata or estimates.
      await page.clock.runFor(100);
      await expect(amount).toHaveValue(expected);
      await expect(recipient).toHaveValue(fixture.recipientAddress);
      await expect.poll(async () => Number(await fee.inputValue())).toBe(2e-8);
    };
    const prepare = async (expected: string) => {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page).toHaveURL(/#\/send\/confirm$/);
      await expect(page.locator('p.text-2xl')).toHaveText(
        `${expected} ${c.symbol}`
      );
    };
    const confirm = async (expected: string) => {
      await prepare(expected);
      const confirmButton = page.getByRole('button', {
        name: 'Confirm',
        exact: true,
      });
      await expect(confirmButton).toBeEnabled();
      await expect(
        page.getByText('Decimals', { exact: true }).locator('..')
      ).toHaveText(`Decimals${c.decimals}`);
      await page
        .getByRole('button', { name: 'Advanced Details', exact: true })
        .click();
      await expect(
        page.getByText('Transaction outputs', { exact: true })
      ).toBeVisible();
      // The input may retain ethers' whole-token "2.0" while the decoded
      // allocation display trims redundant fractional zeros. Neither uses Number.
      const decodedAmount = expected.includes('.')
        ? expected.replace(/\.?0+$/, '')
        : expected;
      const outputAmount = `${decodedAmount} ${c.symbol}`;
      const output = page
        .getByText('Amount:', { exact: true })
        .locator('..')
        .filter({ has: page.getByText(outputAmount, { exact: true }) });
      await expect(output).toHaveCount(1);
      await expect(
        output.getByText(outputAmount, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText('Standard:', { exact: true }).locator('..')
      ).toContainText(c.assetType);
      await expect(
        page.getByText('Origin contract:', { exact: true })
      ).toBeVisible();
      if (c.tokenId)
        await expect(
          page.getByText('Token ID:', { exact: true })
        ).toBeVisible();
      await expect(confirmButton).toBeEnabled();
      expect(
        await page.getByText(/^Unable to verify/).allTextContents()
      ).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      reviewedAmounts.push(expected);
    };
    await wallet.step(
      'normal synthetic onboarding, asset import and currency label',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('0.001');
        await page.locator('#assets-btn').click();
        await page.getByText('Import Token', { exact: true }).click();
        const importButton = page.getByRole('button', {
          name: `Import ${c.symbol} token`,
          exact: true,
        });
        await expect(importButton).toBeVisible();
        await importButton.click();
        await expect(importButton).toBeDisabled();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await wallet!.ensureOnHome();
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await page
          .getByRole('button', { name: /^TSYS$/i })
          .first()
          .click();
        // The controlled renderer clock must also complete Ant Design's
        // dropdown transition before its menu is exposed to role locators.
        await page.clock.runFor(500);
        await expect(
          page.getByRole('menuitem', { name: 'TSYS Native', exact: true })
        ).toContainText('TSYS');
        await page.getByRole('menuitem').filter({ hasText: c.symbol }).click();
        await expect(selected).toBeVisible();
        await recipient.fill(fixture.recipientAddress);
        await fee.fill('0.00000002');
      }
    );
    const adjacent = c.belowMaxDisplay ?? c.balanceDisplay;
    const max =
      c.decimals === 8 && !c.balanceDisplay.includes('.')
        ? `${c.balanceDisplay}.0`
        : c.balanceDisplay;
    if (missingContract) {
      await wallet.step(
        'incomplete origin metadata blocks ordinary Confirm',
        async () => {
          await amount.fill(adjacent);
          await prepare(adjacent);
          await expect(
            page.getByText(
              `Unable to verify origin contract for asset ${c.assetGuid}`,
              { exact: true }
            )
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Confirm', exact: true })
          ).toBeDisabled();
          expect(routes.deniedWrites).toEqual([]);
          await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
          await restored(adjacent);
        }
      );
    } else {
      await wallet.step(
        'adjacent valid amount survives Confirm and Cancel exactly',
        async () => {
          await amount.fill(adjacent);
          await confirm(adjacent);
          await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
          await restored(adjacent);
        }
      );
      await wallet.step(
        'adjacent amount survives Confirm and header Back exactly',
        async () => {
          await confirm(adjacent);
          await page.getByRole('button', { name: 'Back', exact: true }).click();
          await restored(adjacent);
        }
      );
      await wallet.step(
        'explicit MAX preserves exact asset quantity through review',
        async () => {
          await page.getByText('MAX', { exact: true }).click();
          await expect(amount).toHaveValue(max);
          await confirm(max);
          await page.getByRole('button', { name: 'Back', exact: true }).click();
          await restored(max);
        }
      );
      await wallet.step(
        'precision and adjacent over-balance errors remain in Send',
        async () => {
          for (const value of [
            c.invalidPrecisionAmount,
            c.overBalanceDisplay,
            ...(c.assetType === 'ERC721' ? ['0'] : []),
          ]) {
            await amount.fill(value);
            await page
              .getByRole('button', { name: 'Next', exact: true })
              .click();
            await expect(page).toHaveURL(/#\/send\/sys$/);
            await expect(
              page
                .getByText(
                  /invalid amount|insufficient funds|amount is required/i
                )
                .first()
            ).toBeVisible();
          }
        }
      );
      await wallet.step(
        'sufficient tokens cannot substitute for missing native fees',
        async () => {
          await amount.fill(adjacent);
          await fee.fill('0.00001');
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(
            page.getByText(/insufficient funds/i).first()
          ).toBeVisible();
          await expect(page).toHaveURL(/#\/send\/sys$/);
          expect(routes.deniedWrites).toEqual([]);
          await fee.fill('0.00000002');
          await confirm(adjacent);
          await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
          await restored(adjacent);
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    const sourceHashes = Object.fromEntries(
      [
        __filename,
        path.resolve(__dirname, '../harness/sptAssetMatrixFixture.ts'),
      ].map((file) => [
        path.basename(file),
        createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      ])
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, name + '.json'),
      JSON.stringify(
        {
          ...evidence,
          sourceHashes,
          fixtureAsset: c,
          missingContract,
          simulated: true,
          syntheticNEVMRegistryMetadata: true,
          independentUTXOIssuanceClaimed: false,
          liveContractProvenanceClaimed: false,
          liveSPTSendTested: false,
          normalUiImportAndUnsignedReview: true,
          confirmationClicked: false,
          rendererRestorationClockAdvanced: true,
          erc721HasNoPositiveAdjacentBelowOne: c.assetType === 'ERC721',
          reviewedAmounts,
          pageErrors,
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
}

for (const asset of SPT_ASSET_MATRIX) {
  test(`fenced SPT matrix: ${asset.id} exact unsigned UI`, async () => {
    test.setTimeout(180000);
    await inspectAssetCase(asset);
  });
}

test('fenced SPT matrix: missing NEVM origin contract blocks review', async () => {
  test.setTimeout(180000);
  await inspectAssetCase(SPT_ASSET_MATRIX[0], true);
});
