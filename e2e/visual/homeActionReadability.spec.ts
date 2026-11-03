import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';

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

for (const width of [400, 320]) {
  test(`Home and empty-token actions retain readable enabled text and icons at ${width}px`, async ({}, info) => {
    test.setTimeout(90_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ReadableActionsSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    const denied: string[] = [];
    const observations: unknown[] = [];
    const ownedReads: string[] = [];
    try {
      wallet = await PaliWallet.launch('home-action-readability-' + width, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 400 ? 620 : 360 },
      });
      routes = await installIsolatedVaultRoutes(
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
          ownedReads.push(url.href);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: '1', result: [] }),
          });
        }
      );
      const page = wallet.page;
      const projection = () =>
        page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const ref = state.vault.activeAccount;
          return {
            account: {
              ...ref,
              address: state.vault.accounts[ref.type][ref.id].address,
            },
            network: {
              chainId: state.vault.activeNetwork.chainId,
              kind: state.vault.activeNetwork.kind,
              url: state.vault.activeNetwork.url,
            },
            assets: (
              state.vault.accountAssets[ref.type]?.[ref.id]?.ethereum ?? []
            ).map((asset: any) => asset.contractAddress),
          };
        });
      let baseline: Awaited<ReturnType<typeof projection>>;
      await wallet.step(
        'Import a disposable wallet and select the normal EVM testnet',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          baseline = await projection();
          expect(baseline.account.address.toLowerCase()).toBe(
            fixture.evmAddresses[0].toLowerCase()
          );
          expect(baseline.assets).toEqual([]);
        }
      );
      await wallet.step(
        'Measure actual Home action labels and arrow paths at rest and hover',
        async () => {
          for (const name of ['send', 'receive']) {
            const action = page.locator('#' + name + '-btn');
            await expect(action).toBeEnabled();
            for (const state of ['rest', 'hover']) {
              if (state === 'hover') await action.hover();
              else await page.mouse.move(0, 0);
              const text = await captureForegroundContrast(
                action,
                info,
                name + '-' + state + '-' + width
              );
              const paths = action.locator('svg path');
              expect(await paths.count()).toBeGreaterThan(0);
              for (let index = 0; index < (await paths.count()); index++) {
                const shape = paths.nth(index);
                const fill = await shape.evaluate((node) => ({
                  fill: getComputedStyle(node).fill,
                  color: getComputedStyle(node).color,
                }));
                expect(fill.fill).toBe(text.foreground);
                expect(fill.color).toBe(text.foreground);
                observations.push({
                  name,
                  state,
                  index,
                  text,
                  icon: await captureForegroundContrast(
                    shape,
                    info,
                    name + '-icon-' + index + '-' + state + '-' + width,
                    'currentColor-icon'
                  ),
                });
              }
            }
          }
          await page.mouse.move(0, 0);
        }
      );
      await wallet.step(
        'Normal Send and Receive entries return without a signing action',
        async () => {
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
          await page.locator('#receive-btn').click();
          await expect(page).toHaveURL(/#\/receive(?:[?#]|$)/);
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
          expect(await projection()).toEqual(baseline);
        }
      );
      await wallet.step(
        'Healthy empty discovery exposes a readable Add Custom action that opens the real input',
        async () => {
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await page
            .getByRole('button', { name: en.tokens.yourTokens, exact: true })
            .click();
          await expect(
            page.getByText(en.tokens.noAdditionalTokensFound, { exact: true })
          ).toBeVisible();
          expect(ownedReads.length).toBeGreaterThan(0);
          const add = page
            .locator('button.h-10')
            .filter({ hasText: en.tokens.addCustomTab });
          await expect(add).toBeEnabled();
          await page.mouse.move(0, 0);
          await captureForegroundContrast(
            add,
            info,
            'add-custom-rest-' + width
          );
          await add.hover();
          await captureForegroundContrast(
            add,
            info,
            'add-custom-hover-' + width
          );
          await add.click();
          await expect(page.locator('#custom-token-contract')).toBeVisible();
          await expect(page.locator('#custom-token-contract')).toHaveValue('');
          expect(await projection()).toEqual(baseline);
          expect(denied).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      await info.attach('home-action-readability-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            ...runtime,
            width,
            observations,
            denied,
            ownedReads,
            deniedWrites: routes?.deniedWrites ?? [],
            sourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
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
