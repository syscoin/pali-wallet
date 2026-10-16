import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from '../../source/pages/Home/Panel/components/Transactions/UTXO/history.fixtures';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('offline UTXO history: bridge value, native account change and pending detail units', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG },
    fixture = createUtxoFixture('10000000');
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  const pending = {
    txid: '36'.repeat(32),
    direction: 'sent',
    fees: '226',
    confirmations: 0,
    blockHeight: 0,
    blockTime: 1791600000,
    addressValueIn: '10000000',
    addressValueOut: '9999774',
    valueIn: '10000000',
    value: '9999774',
    vin: [],
    vout: [],
  };
  // Compact account fields are captured public evidence; addresses and full
  // transaction shapes below are synthetic. No observed-chain send is claimed.
  const fullBridge = (
    compact: typeof compactBridgeNativeOffset,
    value: string
  ) => ({
    txid: compact.txid,
    tokenType: compact.tokenType,
    fees: compact.fees,
    confirmations: 1,
    blockHeight: 1,
    blockHash: 'ab'.repeat(32),
    blockTime: 1700000000,
    vin: [{ addresses: [fixture.userAddress], value: compact.addressValueIn }],
    vout: [
      {
        addresses: ['OP_RETURN'],
        value: '0',
        assetInfo: { assetGuid: '123456', value },
      },
    ],
    tokenTransfers: [{ token: '123456', symbol: 'SYSX', decimals: 8 }],
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('offline-utxo-history', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      {
        readState: () => ({
          unconfirmedBalance: '-226',
          unconfirmedTxs: 1,
          transactions: [
            pending,
            compactBridgeWithAccountAsset,
            compactBridgeNativeOffset,
          ],
          rawTransactions: {
            [pending.txid]: {
              ...pending,
              blockHash: undefined,
              vin: [{ addresses: [fixture.userAddress], value: '10000000' }],
              vout: [{ addresses: [fixture.userAddress], value: '9999774' }],
            },
            [compactBridgeNativeOffset.txid]: fullBridge(
              compactBridgeNativeOffset,
              '100000000'
            ),
            [compactBridgeWithAccountAsset.txid]: fullBridge(
              compactBridgeWithAccountAsset,
              '10000000'
            ),
          },
        }),
      }
    );
    const page = wallet.page;
    const row = (id: string) =>
      page
        .getByText(`${id.slice(0, 4)}...${id.slice(-14)}`, { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    const openDetails = async (id: string) => {
      await row(id).locator('svg.cursor-pointer').last().click();
      await expect(page).toHaveURL(/#\/home\/details/);
      await expect
        .poll(() => routes.reads.includes('/api/v2/tx/' + id))
        .toBe(true);
      await expect(
        page
          .getByText('From', { exact: true })
          .locator('..')
          .getByText(
            `${fixture.userAddress.slice(0, 2)}...${fixture.userAddress.slice(
              -4
            )}`,
            { exact: true }
          )
      ).toBeVisible();
    };
    const back = async () => {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/#\/home/);
      await page.locator('#activity-btn').click();
    };
    await wallet.step(
      'normal Activity shows bridge values separately from native funding',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect(
          row(compactBridgeNativeOffset.txid).getByText('Bridge to NEVM')
        ).toBeVisible();
        await expect(
          row(compactBridgeNativeOffset.txid).getByText('1.0000 SYSX')
        ).toBeVisible();
        await expect(
          row(compactBridgeNativeOffset.txid).getByText(
            'Native account balance change: -29.5985194 TSYS',
            { exact: true }
          )
        ).toBeVisible();
        await expect(
          row(compactBridgeNativeOffset.txid).getByText('29.5985 TSYS', {
            exact: true,
          })
        ).toHaveCount(0);
        await expect(
          row(compactBridgeWithAccountAsset.txid).getByText('Bridge to NEVM')
        ).toBeVisible();
        await expect(
          row(compactBridgeWithAccountAsset.txid).getByText('0.100000 SYSX')
        ).toBeVisible();
        await expect(
          row(pending.txid).getByText('0.099998 TSYS', { exact: true })
        ).toBeVisible();
        await expect(
          row(pending.txid).getByText(
            'Native account balance change: -0.00000226 TSYS',
            { exact: true }
          )
        ).toBeVisible();
        await expect(
          row(pending.txid).getByText('Fee: 0.00000226 TSYS', { exact: true })
        ).toBeVisible();
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'full transaction details preserve bridge value and separately label native account change',
      async () => {
        await openDetails(compactBridgeNativeOffset.txid);
        await expect(
          page.getByText('1.0000 SYSX', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText('Native account balance change: -29.5985194 TSYS', {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page.getByText('Transaction value', { exact: true })
        ).toBeVisible();
        await back();
        await openDetails(compactBridgeWithAccountAsset.txid);
        await expect(
          page.getByText('0.100000 SYSX', { exact: true })
        ).toBeVisible();
        await back();
        for (const bridge of [
          compactBridgeNativeOffset,
          compactBridgeWithAccountAsset,
        ])
          expect(
            routes.reads.filter((read) => read === '/api/v2/tx/' + bridge.txid)
          ).toHaveLength(1);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'pending self-transfer details show fee units and pending block fields',
      async () => {
        await openDetails(pending.txid);
        await expect(
          page.getByText('Transaction value', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText('0.09999774 TSYS', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText('Native account balance change: -0.00000226 TSYS', {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page
            .getByText('Fees', { exact: true })
            .locator('..')
            .getByText('0.00000226 TSYS', { exact: true })
        ).toBeVisible();
        for (const label of ['Block Hash', 'Block Time'])
          await expect(
            page
              .getByText(label, { exact: true })
              .locator('..')
              .getByText('Pending', { exact: true })
          ).toBeVisible();
        await expect(page.getByText('undefined', { exact: true })).toHaveCount(
          0
        );
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'offline-utxo-history.json'),
      JSON.stringify(
        {
          ...evidence,
          simulated: true,
          liveHistoryTested: false,
          signingRequested: false,
          confirmationClicked: false,
          capturedAccountFieldsWithSyntheticAddresses: true,
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
