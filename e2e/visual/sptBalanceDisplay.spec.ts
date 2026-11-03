import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { SPT_GUID, SPT_SYMBOL, sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const value of [
  { units: '42', decimals: 0, exact: '42', label: '42' },
  { units: '1234567', decimals: 0, exact: '1234567', label: '1.235M' },
  { units: '123456789', decimals: 0, exact: '123456789', label: '123.457M' },
  {
    units: '18446744073709551615',
    decimals: 8,
    exact: '184467440737.09551615',
    label: '184.467B',
  },
]) {
  test(`SPT list and Details preserve the exact balance ${value.exact} with readable compact labels`, async ({}, info) => {
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const before = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SptBalanceSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    const reads: {
      details: string | null;
      path: string;
      tokens: string | null;
    }[] = [];
    const geometry: unknown[] = [];
    try {
      wallet = await PaliWallet.launch(
        `spt-balance-${value.decimals}-${value.units}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      // Only synthetic explorer responses vary. Discovery, import, persistence,
      // controller replies, Redux publication and rendering are the real paths.
      await wallet.context.route(
        (url) =>
          [
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin) &&
          [
            `/api/v2/asset/${SPT_GUID}`,
            `/api/v2/xpub/${fixture.utxo.userXpub}`,
            `/api/v2/address/${fixture.utxo.userAddress}`,
          ].includes(url.pathname),
        async (route) => {
          const request = route.request();
          if (request.method() !== 'GET') return route.fallback();
          const original = sptFixtureRead(
            fixture.utxo,
            request.url(),
            'GET'
          ) as any;
          if (!original) return route.fallback();
          const override = (asset: any) => ({
            ...asset,
            balance: value.units,
            totalReceived: value.units,
            totalSent: '0',
            unconfirmedBalance: '0',
            decimals: value.decimals,
          });
          const url = new URL(request.url());
          reads.push({
            path: url.pathname,
            details: url.searchParams.get('details'),
            tokens: url.searchParams.get('tokens'),
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(
              original.asset
                ? { ...original, asset: override(original.asset) }
                : {
                    ...original,
                    tokensAsset: original.tokensAsset.map(override),
                  }
            ),
          });
        }
      );
      const page = wallet.page;
      await wallet.step(
        'discover and import the public synthetic SPT through the ordinary UI',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          const importButton = page.getByRole('button', {
            name: `Import ${SPT_SYMBOL} token`,
            exact: true,
          });
          await expect(importButton).toBeEnabled();
          await importButton.click();
          const notice = page
            .getByRole('status')
            .getByText(
              en.tokens.hasBeenAddedToYourWallet.replace(
                '{{token}}',
                SPT_SYMBOL
              ),
              { exact: true }
            );
          await expect(notice).toBeVisible();
          await page.getByRole('button', { name: 'Back', exact: true }).click();
          await wallet!.ensureOnHome();
          await expect(notice).toBeHidden();
          await page.locator('#assets-btn').click();
        }
      );
      await wallet.step(
        'retain the exact decimal title and a readable label at short and normal widths',
        async () => {
          const row = page.getByRole('listitem').filter({
            has: page.getByRole('button', {
              name: `View details for ${SPT_SYMBOL} token`,
              exact: true,
            }),
          });
          const amount = row.locator('span.font-semibold');
          await expect(amount).toHaveText(value.label);
          await expect(amount).toHaveAttribute('title', value.exact);
          const balances = await page.evaluate(async () => {
            const state = await chrome.runtime.sendMessage({
              type: 'getCurrentState',
            });
            const selected = state.vault.activeAccount;
            return state.vault.accountAssets[selected.type][
              selected.id
            ].syscoin.map((asset: any) => ({
              guid: String(asset.assetGuid),
              balance: asset.balance,
            }));
          });
          expect(balances).toContainEqual({
            guid: SPT_GUID,
            balance: value.exact,
          });
          for (const viewport of [
            { width: 320, height: 360 },
            { width: 400, height: 620 },
          ]) {
            await page.setViewportSize(viewport);
            await amount.scrollIntoViewIfNeeded();
            await expect(amount).toBeVisible();
            const bounds = await amount.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                documentWidth: document.documentElement.scrollWidth,
              };
            });
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(viewport.width);
            expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
            expect(bounds.documentWidth).toBe(viewport.width);
            geometry.push({ ...viewport, ...bounds });
            await info.attach(`spt-${viewport.width}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
          await row
            .getByRole('button', {
              name: `View details for ${SPT_SYMBOL} token`,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/home\/details/);
        }
      );
      await wallet.step(
        'refresh the real Details totals and retain their exact values at both widths',
        async () => {
          const totals = [
            { name: 'Balance', exact: value.exact, label: value.label },
            { name: 'Total Received', exact: value.exact, label: value.label },
            {
              name: 'Total Sent',
              exact: value.decimals === 0 ? '0' : '0.0',
              label: '0',
            },
          ];
          for (const viewport of [
            { width: 320, height: 360 },
            { width: 400, height: 620 },
          ]) {
            await page.setViewportSize(viewport);
            for (const total of totals) {
              const row = page
                .getByRole('listitem')
                .filter({ has: page.getByText(total.name, { exact: true }) });
              const amount = row.locator('span.text-brand-white');
              await expect(amount).toHaveText(total.label);
              await expect(amount).toHaveAttribute('title', total.exact);
              await amount.scrollIntoViewIfNeeded();
              await expect(amount).toBeVisible();
              const bounds = await amount.evaluate((element) => {
                const box = element.getBoundingClientRect();
                return {
                  left: box.left,
                  right: box.right,
                  documentWidth: document.documentElement.scrollWidth,
                };
              });
              expect(bounds.left).toBeGreaterThanOrEqual(0);
              expect(bounds.right).toBeLessThanOrEqual(viewport.width);
              expect(bounds.documentWidth).toBe(viewport.width);
              geometry.push({
                view: 'details',
                field: total.name,
                ...viewport,
                ...bounds,
              });
            }
            await info.attach(`spt-details-${viewport.width}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
          const publicTotals = await page.evaluate(async (guid) => {
            const state = await chrome.runtime.sendMessage({
              type: 'getCurrentState',
            });
            const selected = state.vault.activeAccount;
            const asset = state.vault.accountAssets[selected.type][
              selected.id
            ].syscoin.find((entry: any) => String(entry.assetGuid) === guid);
            return {
              balance: asset.balance,
              totalSent: asset.totalSent,
              totalReceived: asset.totalReceived,
            };
          }, SPT_GUID);
          expect(publicTotals).toEqual({
            balance: value.exact,
            totalReceived: value.exact,
            totalSent: value.decimals === 0 ? '0' : '0.0',
          });
        }
      );
      // Owned-token discovery already carries metadata. Normal import saves
      // that admitted record without requiring a separate asset metadata read.
      for (const tokens of ['nonzero', 'used']) {
        expect(reads).toContainEqual({
          path: `/api/v2/xpub/${fixture.utxo.userXpub}`,
          details: 'tokenBalances',
          tokens,
        });
      }
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
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
              value,
              reads,
              geometry,
              deniedWrites: routes?.deniedWrites,
              proxyDeniedConnections: server.blocked.length,
            },
            null,
            2
          )
        );
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
  });
}
