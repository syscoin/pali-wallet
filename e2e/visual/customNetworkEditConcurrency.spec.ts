import { expect, test, type Page } from '@playwright/test';
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

test('a delayed inactive-network edit cannot replace another window saved registration', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkEditConcurrencySynthetic!2026',
    rpcUrl: server.url,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
  });
  const label = 'Syscoin NEVM Testnet';
  const oldApi = 'https://old-editor.synthetic.invalid/api';
  const replacementApi = 'https://replacement-editor.synthetic.invalid/api';
  const retryApi = 'https://fresh-editor.synthetic.invalid/api';
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let heldRead = false;
  let released = false;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const writes: string[] = [];
  const reads: string[] = [];
  const observations: unknown[] = [];
  const publicState = (page: Page) =>
    page.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      return {
        api: state.vaultGlobal.networks.ethereum[5700].apiUrl,
        active: {
          chainId: state.vault.activeNetwork.chainId,
          kind: state.vault.activeNetwork.kind,
        },
      };
    });
  const openEditor = async (page: Page) => {
    const row = page.locator('li').filter({
      has: page.getByText(label, { exact: true }),
    });
    await expect(row).toHaveCount(1);
    await row.locator('button').first().click();
    await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
    await expect(page.locator('#rpc_apiUrl')).toBeVisible();
  };
  try {
    wallet = await PaliWallet.launch('custom-network-edit-concurrency', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    for (const endpoint of [oldApi, replacementApi, retryApi]) {
      await wallet.context.route(`${endpoint}**`, async (route) => {
        const request = route.request();
        if (request.method() !== 'GET') {
          writes.push(request.method());
          return route.abort('blockedbyclient');
        }
        const url = new URL(request.url());
        const module = url.searchParams.get('module');
        if (!['block', 'proxy', 'account'].includes(module || ''))
          return route.abort('blockedbyclient');
        reads.push(endpoint);
        if (endpoint === oldApi && !released) {
          heldRead = true;
          await held;
        }
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
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    await wallet.ensureOnHome();
    const page = wallet.page;
    const initial = await publicState(page);
    await wallet.step(
      'open two real editors for the same inactive EVM registration',
      async () => {
        await wallet!.gotoRoute('#/settings/networks/edit');
        await openEditor(page);
      }
    );
    const other = await wallet.context.newPage();
    await other.goto(`${page.url().split('#')[0]}#/settings/networks/edit`);
    await openEditor(other);
    await expect(other.locator('#rpc_apiUrl')).toHaveValue(initial.api);
    await expect(page.locator('#rpc_apiUrl')).toHaveValue(initial.api);
    await wallet.step(
      'hold the old validation while the second window saves a newer API',
      async () => {
        await page.locator('#rpc_apiUrl').fill(oldApi);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect.poll(() => heldRead).toBe(true);
        await other.locator('#rpc_apiUrl').fill(replacementApi);
        await other
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(other).toHaveURL(/#\/settings\/networks\/edit$/);
        await expect
          .poll(() => publicState(other))
          .toEqual({
            api: replacementApi,
            active: initial.active,
          });
        observations.push({
          phase: 'newer-window-saved',
          ...(await publicState(other)),
        });
      }
    );
    await wallet.step(
      'refuse the stale reply without changing the accepted registry or active vault',
      async () => {
        released = true;
        release();
        // Wait for either the fixed conflict or the old build's erroneous
        // success navigation, then inspect the real background registry.
        await expect
          .poll(
            async () =>
              !page.url().endsWith('#/settings/networks/custom-rpc') ||
              (await page
                .getByText('Network changed. Please save it again.', {
                  exact: true,
                })
                .isVisible())
          )
          .toBe(true);
        const afterOldReply = await publicState(page);
        observations.push({ phase: 'stale-reply-finished', ...afterOldReply });
        expect(afterOldReply).toEqual({
          api: replacementApi,
          active: initial.active,
        });
        await expect(
          page.getByText('Network changed. Please save it again.', {
            exact: true,
          })
        ).toBeVisible();
        await expect(page.locator('#rpc_apiUrl')).toHaveValue(replacementApi);
        expect(await publicState(page)).toEqual({
          api: replacementApi,
          active: initial.active,
        });
        await info.attach('network-edit-conflict', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        await page.keyboard.press('Escape');
        await expect(
          page.getByText('Network changed. Please save it again.', {
            exact: true,
          })
        ).not.toBeVisible();
      }
    );
    await wallet.step(
      'save a fresh edit after conflict and reopen the accepted record',
      async () => {
        await page.locator('#rpc_apiUrl').fill(retryApi);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
        await expect
          .poll(() => publicState(page))
          .toEqual({ api: retryApi, active: initial.active });
        await openEditor(page);
        await expect(page.locator('#rpc_apiUrl')).toHaveValue(retryApi);
        observations.push({
          phase: 'fresh-edit-reopened',
          ...(await publicState(page)),
        });
        await info.attach('network-edit-fresh-retry', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    );
    expect(writes).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    released = true;
    release();
    try {
      await info.attach('network-edit-concurrency-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            signingOrBroadcastRequested: false,
            heldRead,
            reads,
            observations,
            deniedWrites: [...writes, ...(routes?.deniedWrites || [])],
            proxyDeniedConnections: server.blocked.length,
            status,
          },
          null,
          2
        ),
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
});
