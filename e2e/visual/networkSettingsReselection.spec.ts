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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const label = 'Syscoin NEVM Testnet';
const oldApi = 'https://explorer.tanenbaum.io/api';
const editedApi = 'https://edited-network-api.invalid/api';

for (const roundTrip of [false, true]) {
  test(
    roundTrip
      ? 'a normal vault round trip activates an edited explorer API'
      : 'reselecting the current network activates its edited explorer API',
    async ({}, info) => {
      test.setTimeout(120_000);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const previous = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      const reads: Array<{
        action: string | null;
        endpoint: string;
        module: string | null;
        phase: string;
      }> = [];
      const writes: string[] = [];
      let phase = 'onboarding';
      let wallet: PaliWallet | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      const observations: Record<string, unknown> = {
        syntheticHttpOnly: true,
        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        signingOrBroadcastRequested: false,
        roundTrip,
      };
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'NetworkSettingsSyntheticOnly!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: label,
      });
      try {
        wallet = await PaliWallet.launch(
          roundTrip
            ? 'network-settings-round-trip'
            : 'network-settings-reselect',
          {
            offlineHttpProxy: server.url,
            viewport: { width: 400, height: 620 },
          }
        );
        observations.runtime = extensionEvidence();
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          createIsolatedVaultFixture(),
          server.url
        );
        for (const endpoint of [oldApi, editedApi]) {
          await wallet.context.route(`${endpoint}**`, async (route) => {
            if (route.request().method() !== 'GET') {
              writes.push(route.request().method());
              return route.abort('blockedbyclient');
            }
            const url = new URL(route.request().url());
            const action = url.searchParams.get('action');
            const module = url.searchParams.get('module');
            reads.push({ endpoint, action, module, phase });
            if (!['block', 'proxy', 'account'].includes(module || ''))
              return route.abort('blockedbyclient');
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: '1',
                message: 'OK',
                result: module === 'account' ? [] : '0x1',
              }),
            });
          });
        }
        await wallet.context.route(
          'https://api.coingecko.com/api/v3/simple/price**',
          (route) =>
            route.request().method() === 'GET'
              ? route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify({ syscoin: { usd: 1 } }),
                })
              : route.abort('blockedbyclient')
        );
        const page = wallet.page;
        await wallet.step(
          `${
            roundTrip ? 'round-trip' : 'reselect'
          }: open the real testnet wallet and its network editor`,
          async (capture) => {
            try {
              await wallet!.importSeedAndCreatePassword();
              await wallet!.ensureOnHome();
              await wallet!.switchNetwork(label, 'EVM');
              await expect
                .poll(() =>
                  reads.some(
                    (read) =>
                      read.endpoint === oldApi && read.module === 'account'
                  )
                )
                .toBe(true);
              await wallet!.gotoRoute('#/settings/networks/edit');
              const row = page.locator('li').filter({
                has: page.getByText(label, { exact: true }),
              });
              await expect(row).toHaveCount(1);
              await row.locator('button').first().click();
              await expect(page).toHaveURL(
                /#\/settings\/networks\/custom-rpc$/
              );
              await expect(page.locator('#rpc_apiUrl')).toHaveValue(oldApi);
              observations.originalRpc = await page
                .locator('#rpc_url')
                .inputValue();
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        await wallet.step(
          `${
            roundTrip ? 'round-trip' : 'reselect'
          }: save an API-only edit through the normal form`,
          async (capture) => {
            try {
              phase = 'edit-validation';
              // The add/edit ACK can precede the debounced frontend registry
              // broadcast. Observe that real public field before reopening a
              // form that intentionally initializes its draft only once.
              await page.evaluate((api) => {
                const observation = window as typeof window & {
                  networkSettingsSavedApi?: string;
                };
                const listener = (message: any) => {
                  const savedApi =
                    message.type === 'CONTROLLER_STATE_CHANGE'
                      ? message.data?.vaultGlobal?.networks?.ethereum?.[5700]
                          ?.apiUrl
                      : undefined;
                  if (savedApi !== api) return;
                  chrome.runtime.onMessage.removeListener(listener);
                  requestAnimationFrame(() => {
                    observation.networkSettingsSavedApi = savedApi;
                  });
                };
                chrome.runtime.onMessage.addListener(listener);
              }, editedApi);
              await page.locator('#rpc_apiUrl').fill(editedApi);
              await page
                .getByRole('button', { name: en.buttons.save, exact: true })
                .click();
              await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
              await page.waitForFunction(
                (api) =>
                  (
                    window as typeof window & {
                      networkSettingsSavedApi?: string;
                    }
                  ).networkSettingsSavedApi === api,
                editedApi
              );
              observations.savedRegistryBroadcastApi = editedApi;
              expect(
                reads.some(
                  (read) =>
                    read.endpoint === editedApi && read.module !== 'account'
                )
              ).toBe(true);
              // Reopen the actual saved registry entry rather than relying on a toast.
              const row = page
                .locator('li')
                .filter({ has: page.getByText(label, { exact: true }) });
              await row.locator('button').first().click();
              await expect(page.locator('#rpc_apiUrl')).toHaveValue(editedApi);
              await expect(page.locator('#rpc_url')).toHaveValue(
                observations.originalRpc as string
              );
              await page
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click();
              await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        await wallet.step(
          roundTrip
            ? 'activate the saved API through a normal vault round trip'
            : 'reselect the same network and require its saved API to be used',
          async (capture) => {
            try {
              await wallet!.gotoRoute('#/home');
              await wallet!.ensureOnHome();
              phase = 'activation';
              if (roundTrip) {
                await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
                await wallet!.switchNetwork(label, 'EVM');
              } else {
                // The driver intentionally skips an unchanged label; exercise the
                // real menu item here instead of bypassing it with a controller call.
                await page
                  .getByRole('button')
                  .filter({ hasText: /EVM/ })
                  .first()
                  .click();
                const menu = page.getByRole('menu');
                const group = menu.getByRole('menuitem', {
                  name: /EVM Networks/i,
                });
                if ((await group.getAttribute('aria-expanded')) !== 'true')
                  await group.click();
                await menu
                  .getByRole('menuitem', { name: label, exact: true })
                  .click();
              }
              await expect
                .poll(
                  () =>
                    reads.some(
                      (read) =>
                        read.phase === 'activation' &&
                        read.endpoint === editedApi &&
                        read.module === 'account' &&
                        ['txlist', 'tokentx'].includes(read.action || '')
                    ),
                  { timeout: 20_000 }
                )
                .toBe(true);
              expect(routes!.deniedWrites).toEqual([]);
              expect(writes).toEqual([]);
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        status = 'passed';
      } finally {
        try {
          const file = info.outputPath('network-settings-evidence.json');
          fs.writeFileSync(
            file,
            JSON.stringify(
              {
                ...observations,
                status,
                reads,
                deniedWrites: [...writes, ...(routes?.deniedWrites || [])],
                proxyDeniedConnections: server.blocked.length,
                testSourceSha256: createHash('sha256')
                  .update(fs.readFileSync(__filename))
                  .digest('hex'),
              },
              null,
              2
            )
          );
          await info.attach('network-settings-evidence', {
            path: file,
            contentType: 'application/json',
          });
        } finally {
          try {
            await wallet?.dispose(status);
          } finally {
            try {
              await server.close();
            } finally {
              Object.assign(E2E_CONFIG, previous);
            }
          }
        }
      }
    }
  );
}
