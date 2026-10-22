import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { SPT_GUID, SPT_SYMBOL, sptFixtureRead } from '../harness/sptFixture';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const value of [
  {
    name: 'confirmed-only healthy holding',
    delta: '0',
    expected: '100.0',
    display: '100',
  },
  {
    name: 'pending incoming holding',
    delta: '2500',
    expected: '125.0',
    display: '125',
  },
  {
    name: 'pending outgoing holding',
    delta: '-7500',
    expected: '25.0',
    display: '25',
  },
]) {
  test(`manual SPT import previews and saves the current ${value.name}`, async ({}, info) => {
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ManualSptSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const reads: string[] = [];
    try {
      wallet = await PaliWallet.launch(`manual-spt-${value.delta}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 320, height: 360 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      // Vary only public Blockbook data; real validation, import controller,
      // durable storage and Redux publication are not replaced.
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
          const original = sptFixtureRead(
            fixture.utxo,
            request.url(),
            request.method()
          ) as any;
          if (!original || request.method() !== 'GET') return route.fallback();
          reads.push(new URL(request.url()).pathname);
          const change = (asset: any) => ({
            ...asset,
            decimals: 2,
            balance: '10000',
            unconfirmedBalance: value.delta,
            totalReceived: '10000',
            totalSent: '0',
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(
              original.asset
                ? { ...original, asset: change(original.asset) }
                : { ...original, tokensAsset: original.tokensAsset.map(change) }
            ),
          });
        }
      );
      const page = wallet.page;
      await wallet.step(
        'open ordinary Add Custom SPT and inspect its holdings preview',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await page
            .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
            .click();
          await page
            .getByLabel(en.tokens.assetGuid, { exact: true })
            .fill(SPT_GUID);
          const action = page.getByRole('button', {
            name: `Import ${SPT_SYMBOL} token`,
            exact: true,
          });
          await expect(action).toBeEnabled();
          await expect(
            action
              .locator('xpath=ancestor::li')
              .locator('span.text-brand-white.font-medium')
          ).toHaveText(value.display);
          await info.attach('manual-spt-preview', {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
        }
      );
      await wallet.step(
        'import through the real controller and retain the displayed holdings',
        async () => {
          await page
            .getByRole('button', {
              name: `Import ${SPT_SYMBOL} token`,
              exact: true,
            })
            .click();
          await expect(
            page.getByText(
              en.tokens.hasBeenAddedToYourWallet.replace(
                '{{token}}',
                SPT_SYMBOL
              ),
              { exact: true }
            )
          ).toBeVisible();
          const snapshot = () =>
            page.evaluate(async (guid) => {
              const state = await chrome.runtime.sendMessage({
                type: 'getCurrentState',
              });
              const selected = state.vault.activeAccount;
              return state.vault.accountAssets[selected.type][
                selected.id
              ].syscoin
                .filter((asset: any) => String(asset.assetGuid) === guid)
                .map((asset: any) => ({
                  guid: String(asset.assetGuid),
                  balance: asset.balance,
                }));
            }, SPT_GUID);
          await expect
            .poll(snapshot)
            .toEqual([{ guid: SPT_GUID, balance: value.expected }]);
          expect(reads).toContain(`/api/v2/asset/${SPT_GUID}`);
          expect(reads).toContain(`/api/v2/xpub/${fixture.utxo.userXpub}`);
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
