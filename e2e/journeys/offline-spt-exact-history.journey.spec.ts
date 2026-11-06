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
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Public synthetic backend quantities. No signer, transaction or amount helper
// is mocked: these rows travel through the normal account reader and real UI.
test('offline SPT history preserves large quantities, one-atom direction and unavailable values', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('10000000');
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  const large = '9007199254740993';
  const token = { token: '777', symbol: 'BIG', decimals: 0 };
  const base = (marker: string) => ({
    txid: marker.repeat(32),
    tokenType: 'SPTAssetAllocationSend',
    fees: '226',
    confirmations: 1,
    blockHeight: 1,
    blockHash: 'ab'.repeat(32),
    blockTime: 1700000000,
    addressValueIn: '100000000',
    addressValueOut: '90000000',
    valueIn: '100000000',
    value: '90000000',
    tokenTransfers: [token],
    vin: [],
    vout: [],
  });
  const compact = {
    ...base('a1'),
    accountAssetTransfers: [
      { ...token, assetGuid: '777', value: large, direction: 'received' },
    ],
  };
  const bridge = {
    ...base('b2'),
    tokenType: 'SPTAssetAllocationBurnToNEVM',
  };
  const near = {
    ...base('c3'),
    vin: [
      {
        isOwn: true,
        addresses: [fixture.userAddress],
        value: '100000000',
        assetInfo: { assetGuid: '777', value: '9007199254740992' },
      },
    ],
    vout: [
      {
        isOwn: true,
        addresses: [fixture.userAddress],
        value: '90000000',
        assetInfo: { assetGuid: '777', value: large },
      },
    ],
  };
  const invalid = {
    ...base('d4'),
    accountAssetTransfers: [
      { ...token, assetGuid: '777', value: '9'.repeat(79), direction: 'sent' },
    ],
  };
  const rawTransactions = {
    [compact.txid]: {
      ...compact,
      vin: [{ addresses: [fixture.userAddress], value: '100000000' }],
      vout: [
        {
          addresses: [fixture.recipientAddress],
          value: '90000000',
          assetInfo: { assetGuid: '777', value: large },
        },
      ],
    },
    [bridge.txid]: {
      ...bridge,
      vin: [{ addresses: [fixture.userAddress], value: '100000000' }],
      vout: [
        {
          addresses: ['OP_RETURN'],
          value: '0',
          assetInfo: { assetGuid: '777', value: large },
        },
      ],
    },
    [near.txid]: near,
    [invalid.txid]: invalid,
  };
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('offline-spt-exact-history', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      {
        readState: () => ({
          unconfirmedBalance: '0',
          unconfirmedTxs: 0,
          transactions: [compact, bridge, near, invalid],
          rawTransactions,
        }),
      }
    );
    const page = wallet.page;
    const row = (id: string) =>
      page
        .getByText(`${id.slice(0, 4)}...${id.slice(-14)}`, { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    const fullReads = () =>
      routes.reads.filter((read) => /^\/api\/v2\/tx\//.test(read));
    const screenshot = (name: string) =>
      page.screenshot({
        animations: 'disabled',
        path: path.join(E2E_CONFIG.artifactsDir, 'screenshots', name),
      });
    const openDetails = async (id: string) => {
      await row(id).locator('svg.cursor-pointer').last().click();
      await expect(page).toHaveURL(/#\/home\/details/);
      await expect
        .poll(() => routes.reads.includes('/api/v2/tx/' + id))
        .toBe(true);
    };
    const back = async () => {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/#\/home/);
      await page.locator('#activity-btn').click();
    };
    await wallet.step(
      'compact exact amount and one-atom direction before any detail fetch',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        await expect(
          row(compact.txid).locator('[title="' + large + ' SPT"]')
        ).toBeVisible();
        await expect(
          row(compact.txid).locator('[title="' + large + ' SPT"]')
        ).toContainText('+' + large + ' SPT');
        await expect(row(near.txid).locator('[title="1 SPT"]')).toContainText(
          '+1 SPT'
        );
        await expect(
          row(bridge.txid).getByText('Bridge to NEVM', { exact: true })
        ).toBeVisible();
        for (const id of [bridge.txid, invalid.txid]) {
          await expect(row(id).getByText(/\d\s+(?:SPT|TSYS)\b/)).toHaveCount(0);
        }
        await expect(
          page.getByText('9007199254740992 SPT', { exact: true })
        ).toHaveCount(0);
        await expect(page.getByText(/\bBIG\b/)).toHaveCount(0);
        expect(fullReads()).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        await screenshot('spt-exact-activity-400.png');
      }
    );
    await wallet.step(
      'full bridge quantity is exact and native funding remains separately labelled',
      async () => {
        await openDetails(bridge.txid);
        await expect(
          page.getByText(`${large} SPT`, { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText('Native account balance change: -0.1 TSYS', {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page.getByText('9007199254740992 SPT', { exact: true })
        ).toHaveCount(0);
        await expect(page.getByText(/\bBIG\b/)).toHaveCount(0);
        await screenshot('spt-exact-bridge-details-400.png');
        await page.setViewportSize({ width: 320, height: 620 });
        await expect(
          page.getByText(`${large} SPT`, { exact: true })
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true);
        await screenshot('spt-exact-bridge-details-320.png');
        await back();
        await expect(
          row(bridge.txid).getByText(`${large} SPT`, { exact: true })
        ).toBeVisible();
        await expect(row(near.txid).locator('[title="1 SPT"]')).toContainText(
          '+1 SPT'
        );
        await expect(
          row(invalid.txid).getByText(/\d\s+(?:SPT|TSYS)\b/)
        ).toHaveCount(0);
        await screenshot('spt-exact-activity-320.png');
        expect(fullReads()).toEqual(['/api/v2/tx/' + bridge.txid]);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'ordinary full details preserve the same canonical amount',
      async () => {
        await openDetails(compact.txid);
        await expect(
          page.getByText(`${large} SPT`, { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText('Native account balance change: -0.1 TSYS', {
            exact: true,
          })
        ).toBeVisible();
        expect(fullReads()).toEqual([
          '/api/v2/tx/' + bridge.txid,
          '/api/v2/tx/' + compact.txid,
        ]);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'spt-exact-history.json'),
      JSON.stringify(
        {
          ...evidence,
          simulated: true,
          rawQuantity: large,
          nearInput: '9007199254740992',
          expectedNet: '1',
          reads: routes.reads,
          deniedWrites: routes.deniedWrites,
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    if (wallet) await wallet.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
