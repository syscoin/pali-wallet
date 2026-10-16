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

const SYSX_LOGO_URL =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/syscoin/info/logo.png';
// Synthetic local pixels distinguish the canonical identity lookup from an
// initial/Pali fallback. No public logo bytes or network request are needed.
const SYSX_FIXTURE_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  '<circle cx="12" cy="12" r="12" fill="#0082c6"/>' +
  '<path d="M17 6H9a4 4 0 0 0 0 8h6a1 1 0 0 1 0 2H7v3h8a4 4 0 0 0 0-8H9a1 1 0 0 1 0-2h8z" fill="#fff"/>' +
  '</svg>';
const SYSX_FIXTURE_DATA_URL =
  'data:image/svg+xml;base64,' +
  Buffer.from(SYSX_FIXTURE_LOGO).toString('base64');

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
  const fixtureLogoReads: string[] = [];
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
    // The later, exact-match handler wins only for this read. Everything else
    // remains behind the fixture's deny route and the launch-time HTTP proxy.
    await wallet.context.route(
      (url) => url.href === SYSX_LOGO_URL,
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        fixtureLogoReads.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          headers: { 'access-control-allow-origin': '*' },
          body: SYSX_FIXTURE_LOGO,
        });
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
    const expectSysxDetailsIcon = async (amountText: string) => {
      const amount = page.getByText(amountText, { exact: true });
      // The decorative icon is aria-hidden; the adjacent amount already names
      // SYSX for assistive technology. Inspect its pixels, not its ARIA role.
      const icon = page.locator('img[alt="SYSX"]');
      expect(page.viewportSize()).toEqual({ width: 400, height: 620 });
      await expect(amount).toBeVisible();
      await expect(icon).toHaveCount(1);
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('src', SYSX_FIXTURE_DATA_URL);
      await expect
        .poll(() =>
          icon.evaluate((element) => {
            const image = element as HTMLImageElement;
            return {
              complete: image.complete,
              width: image.naturalWidth,
              height: image.naturalHeight,
            };
          })
        )
        .toEqual({ complete: true, width: 24, height: 24 });
      const iconBounds = await icon.boundingBox();
      const amountBounds = await amount.boundingBox();
      expect(iconBounds).not.toBeNull();
      expect(amountBounds).not.toBeNull();
      expect(iconBounds!.width).toBe(24);
      expect(iconBounds!.height).toBe(24);
      for (const bounds of [iconBounds!, amountBounds!]) {
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(400);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(620);
      }
      expect(iconBounds!.x + iconBounds!.width).toBeLessThanOrEqual(
        amountBounds!.x
      );
      expect(Math.max(iconBounds!.y, amountBounds!.y)).toBeLessThan(
        Math.min(
          iconBounds!.y + iconBounds!.height,
          amountBounds!.y + amountBounds!.height
        )
      );
      const decoration = icon.locator('..');
      const shine = decoration.locator('span');
      await expect(decoration).toHaveAttribute('aria-hidden', 'true');
      expect(await decoration.getAttribute('tabindex')).toBeNull();
      await expect(decoration.locator('button, a, [tabindex]')).toHaveCount(0);
      const originalShadow = await icon.evaluate(
        (element) => getComputedStyle(element).boxShadow
      );
      await icon.hover();
      await expect
        .poll(async () => (await icon.boundingBox())!.width)
        .toBeGreaterThan(26);
      await expect
        .poll(() =>
          icon.evaluate((element) => getComputedStyle(element).boxShadow)
        )
        .not.toBe(originalShadow);
      await expect(shine).toHaveCSS('opacity', '1');
      // Scaling is a paint-only effect: the amount never changes position.
      const hoveredAmountBounds = await amount.boundingBox();
      expect(hoveredAmountBounds!.x).toBe(amountBounds!.x);
      expect(hoveredAmountBounds!.y).toBe(amountBounds!.y);
      if (amountText === '1.0000 SYSX') {
        await page.screenshot({
          animations: 'disabled',
          path: path.join(
            E2E_CONFIG.artifactsDir,
            'screenshots',
            'sysx-transaction-details-hover.png'
          ),
        });
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(icon).toHaveCSS('transform', 'none');
      await expect(icon).toHaveCSS('transition-property', 'none');
      await expect(shine).toHaveCSS('transition-property', 'none');
      expect((await icon.boundingBox())!.width).toBe(24);
      await page.mouse.move(0, 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(shine).toHaveCSS('opacity', '0');
      await expect(icon).toHaveCSS('transform', 'none');
    };
    await wallet.step(
      'compact Activity keeps operation tags and transfer values without the Details breakdown',
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
        for (const txid of [
          compactBridgeNativeOffset.txid,
          compactBridgeWithAccountAsset.txid,
          pending.txid,
        ]) {
          await expect(
            row(txid).getByText(/^Native account balance change:/)
          ).toHaveCount(0);
          await expect(row(txid).getByText(/^Fee:/)).toHaveCount(0);
          const bounds = await row(txid).boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.height).toBeLessThanOrEqual(90);
        }
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
        await expectSysxDetailsIcon('1.0000 SYSX');
        await expect(
          page.getByText('Native account balance change: -29.5985194 TSYS', {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page.getByText('Transaction value', { exact: true })
        ).toBeVisible();
        await page.screenshot({
          animations: 'disabled',
          path: path.join(
            E2E_CONFIG.artifactsDir,
            'screenshots',
            'sysx-transaction-details.png'
          ),
        });
        await back();
        await openDetails(compactBridgeWithAccountAsset.txid);
        await expect(
          page.getByText('0.100000 SYSX', { exact: true })
        ).toBeVisible();
        await expectSysxDetailsIcon('0.100000 SYSX');
        await back();
        for (const bridge of [
          compactBridgeNativeOffset,
          compactBridgeWithAccountAsset,
        ])
          expect(
            routes.reads.filter((read) => read === '/api/v2/tx/' + bridge.txid)
          ).toHaveLength(1);
        expect(fixtureLogoReads.length).toBeGreaterThan(0);
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
        await expect(page.locator('img[alt="SYSX"]')).toHaveCount(0);
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
          fixtureLogoReads,
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
