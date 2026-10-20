import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('public explorer transaction links preserve a saved query', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('100000000');
  const server = await startUtxoFixtureServer();
  const hash = 'ab'.repeat(32);
  const explorer = 'https://explorer.synthetic.invalid/public/?view=compact';
  const expected = `https://explorer.synthetic.invalid/public/tx/${hash}?view=compact`;
  const transaction = {
    txid: hash,
    blockHash: 'cd'.repeat(32),
    blockTime: 1700000000,
    blockHeight: 100,
    confirmations: 3,
    fees: '1000',
    valueIn: '100001000',
    value: '100000000',
    addressValueIn: '0',
    addressValueOut: '100000000',
    version: 2,
    vin: [
      {
        txid: 'ef'.repeat(32),
        vout: 0,
        addresses: [fixture.recipientAddress],
        isOwn: false,
        value: '100001000',
      },
    ],
    vout: [
      {
        n: 0,
        addresses: [fixture.userAddress],
        isOwn: true,
        value: '100000000',
      },
    ],
  };
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ExplorerUrlSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const openedRequests: string[] = [];
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('transaction-explorer-link', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      {
        readState: () => ({
          transactions: [transaction],
          rawTransactions: { [hash]: transaction },
        }),
      }
    );
    // Observe the real popup request and abort before any external HTTP I/O.
    // No window.open, controller, provider or Chrome API is replaced.
    await wallet.context.route(
      'https://explorer.synthetic.invalid/**',
      async (route) => {
        openedRequests.push(route.request().url());
        await route.abort('blockedbyclient');
      }
    );
    const page = wallet.page;
    const step = (name: string, run: () => Promise<void>) =>
      wallet!.step(`explorer-query-route: ${name}`, async (capture) => {
        try {
          await run();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    const openEditor = async () => {
      const row = page
        .locator('li')
        .filter({ has: page.getByText('Syscoin Testnet', { exact: true }) });
      await expect(row).toHaveCount(1);
      await row.locator('button').first().click();
      await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
      await expect(page.locator('#rpc_explorer')).toBeVisible();
    };
    await step('open the real inactive network editor', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.ensureOnHome();
      await wallet!.gotoRoute('#/settings/networks/edit');
      await openEditor();
    });
    await step('save and reopen the public explorer URL', async () => {
      await page.locator('#rpc_explorer').fill(explorer);
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
      await openEditor();
      await expect(page.locator('#rpc_explorer')).toHaveValue(explorer);
      observations.savedExplorer = await page
        .locator('#rpc_explorer')
        .inputValue();
    });
    await step(
      'open ordinary UTXO Activity details on the edited network',
      async () => {
        await wallet!.gotoRoute('#/home');
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        const row = page
          .getByText(`${hash.slice(0, 4)}...${hash.slice(-14)}`, {
            exact: true,
          })
          .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
        await row
          .getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/home\/details/);
        await expect(page.getByText('Txid', { exact: true })).toBeVisible();
        const publicState = await page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          return {
            explorer: state.vault.activeNetwork.explorer,
            kind: state.vault.activeNetwork.kind,
          };
        });
        expect(publicState).toEqual({ explorer, kind: 'syscoin' });
        observations.activeNetwork = publicState;
      }
    );
    await step(
      'activate the native explorer button without leaving the network fence',
      async () => {
        const popupPromise = page.waitForEvent('popup');
        await page
          .getByRole('button', { name: 'View on Explorer', exact: true })
          .click();
        const popup = await popupPromise;
        await expect.poll(() => openedRequests).toEqual([expected]);
        observations.openedRequest = openedRequests[0];
        await popup.close();
        await expect(page).toHaveURL(/#\/home\/details/);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(testSourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('transaction-explorer-link-evidence', {
        body: JSON.stringify(
          {
            status,
            runtime,
            testSourceSha256,
            explorer,
            expected,
            openedRequests,
            observations,
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedMethods: server.blocked.slice(),
            syntheticHttpOnly: true,
            externalHttpRequestsFulfilled: 0,
            controllerOrApiReplaced: false,
            signingOrBroadcast: false,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      status = 'failed';
      throw error;
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
