import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
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

for (const failed of [true, false]) {
  for (const width of [400, 320]) {
    test(`owned EVM token discovery ${
      failed
        ? 'failure retains readable Retry'
        : 'healthy empty response stays distinct'
    } at ${width}px`, async ({}, info) => {
      test.setTimeout(90_000);
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const runtime = extensionEvidence();
      const sourceHash = createHash('sha256')
        .update(fs.readFileSync(info.file))
        .digest('hex');
      const previous = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      const fixture = createIsolatedVaultFixture();
      const reads: string[] = [];
      const denied: string[] = [];
      let armed = false;
      const heldReleases: Array<() => void> = [];
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'OwnedDiscoverySynthetic!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: 'Syscoin NEVM Testnet',
      });
      try {
        wallet = await PaliWallet.launch(
          `owned-token-discovery-${failed}-${width}`,
          {
            offlineHttpProxy: server.url,
            viewport: { width, height: width === 400 ? 620 : 360 },
            recordVideo: false,
          }
        );
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        await wallet.context.route(
          'https://explorer.tanenbaum.io/api?**',
          async (route) => {
            const url = new URL(route.request().url());
            if (
              url.searchParams.get('module') !== 'account' ||
              url.searchParams.get('action') !== 'tokenlist'
            )
              return route.fallback();
            if (
              route.request().method() !== 'GET' ||
              url.searchParams.get('address')?.toLowerCase() !==
                fixture.evmAddresses[0].toLowerCase()
            ) {
              denied.push(url.href);
              return route.abort('blockedbyclient');
            }
            reads.push(url.href);
            if (armed && !failed)
              await new Promise<void>((resolve) => heldReleases.push(resolve));
            await route.fulfill({
              status: armed && failed ? 503 : 200,
              contentType: 'application/json',
              body: JSON.stringify(
                armed && failed
                  ? { error: 'Synthetic discovery unavailable' }
                  : { status: '1', result: [] }
              ),
            });
          }
        );
        const page = wallet.page;
        const state = () =>
          page.evaluate(async () => {
            const value = await chrome.runtime.sendMessage({
              type: 'getCurrentState',
            });
            const active = value.vault.activeAccount;
            return {
              active,
              address: value.vault.accounts[active.type][active.id].address,
              network: {
                chainId: value.vault.activeNetwork.chainId,
                url: value.vault.activeNetwork.url,
              },
              assets:
                value.vault.accountAssets[active.type]?.[active.id]?.ethereum ??
                [],
            };
          });
        let before: Awaited<ReturnType<typeof state>>;
        await wallet.step(
          'onboard the isolated wallet and select its real healthy network',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await wallet!.ensureOnHome();
            before = await state();
            expect(before.address.toLowerCase()).toBe(
              fixture.evmAddresses[0].toLowerCase()
            );
            expect(before.assets).toEqual([]);
            armed = true;
          }
        );
        await wallet.step(
          'open ordinary owned-token discovery and distinguish its actual response',
          async (capture) => {
            await page.locator('#assets-btn').click();
            await page
              .getByRole('button', { name: en.home.importToken, exact: true })
              .click();
            await page
              .getByRole('button', { name: en.tokens.yourTokens, exact: true })
              .click();
            if (!failed) {
              await expect.poll(() => heldReleases.length).toBeGreaterThan(0);
              const loader = page.locator(
                '[data-navigation-scroll="token-import"] .animate-spin.border-t-2.border-b-2'
              );
              await expect(loader).toBeVisible();
              await expect(
                page.getByText(en.tokens.noAdditionalTokensFound, {
                  exact: true,
                })
              ).toHaveCount(0);
              await captureForegroundContrast(
                loader,
                info,
                `owned-inline-spinner-${width}`,
                'border'
              );
              heldReleases.splice(0).forEach((release) => release());
              await expect(loader).toBeHidden();
            }
            const retry = page.getByRole('button', {
              name: en.receive.retry,
              exact: true,
            });
            if (failed) {
              await expect(page.getByRole('alert')).toContainText(
                en.settings.apiConnectionError,
                { timeout: 25000 }
              );
              await expect(retry).toBeEnabled();
              await expect(
                page.getByText(en.tokens.noAdditionalTokensFound, {
                  exact: true,
                })
              ).toHaveCount(0);
              await captureForegroundContrast(
                retry,
                info,
                `owned-evm-retry-${width}`
              );
            } else {
              await expect(
                page.getByText(en.tokens.noAdditionalTokensFound, {
                  exact: true,
                })
              ).toBeVisible();
              await expect(retry).toHaveCount(0);
            }
            expect(reads.length).toBeGreaterThan(0);
            await capture(page);
          }
        );
        await wallet.step(
          'manual import and Close remain available without importing an asset',
          async (capture) => {
            await page
              .getByRole('button', {
                name: en.tokens.addCustomTab,
                exact: true,
              })
              .and(page.locator('[aria-pressed]'))
              .click();
            await expect(page.locator('#custom-token-contract')).toBeEditable();
            await capture(page);
            await page
              .getByRole('button', { name: en.buttons.close, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
            expect(await state()).toEqual(before!);
            expect(denied).toEqual([]);
            expect(routes.deniedWrites).toEqual([]);
            expect(extensionEvidence()).toEqual(runtime);
            expect(
              createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex')
            ).toBe(sourceHash);
          }
        );
        status = 'passed';
      } finally {
        heldReleases.splice(0).forEach((release) => release());
        await info.attach('owned-token-discovery-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              status,
              runtime,
              sourceHash,
              width,
              failed,
              reads,
              denied,
              controllerStateReplaced: false,
              signingOrBroadcastRequested: false,
            },
            null,
            2
          ),
        });
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    });
  }
}
