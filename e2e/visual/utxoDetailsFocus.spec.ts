import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

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

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 30; index += 1) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const publicContext = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const selected = state.vault.activeAccount;
    const account = state.vault.accounts[selected.type][selected.id];
    const network = state.vault.activeNetwork;
    return {
      account: { ...selected, address: account.address },
      network: {
        chainId: network.chainId,
        kind: network.kind,
        url: network.url,
      },
    };
  });

test('UTXO Details keeps the focused Txid Copy control when its full HTTP read completes', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('100000000');
  const server = await startUtxoFixtureServer();
  const hash = 'd1'.repeat(32);
  const summary = {
    txid: hash,
    version: 2,
    blockHash: 'b1'.repeat(32),
    blockHeight: 100,
    blockTime: 1700000000,
    confirmations: 4,
    fees: '1000',
    valueIn: '100001000',
    value: '100000000',
    direction: 'received',
    addressValueIn: '0',
    addressValueOut: '100000000',
    vin: [
      {
        txid: 'e1'.repeat(32),
        vout: 0,
        n: 0,
        addresses: [fixture.recipientAddress],
        isAddress: true,
        isOwn: false,
        value: '100001000',
        sequence: 0xffffffff,
      },
    ],
    vout: [
      {
        n: 0,
        addresses: [fixture.userAddress],
        isAddress: true,
        isOwn: true,
        value: '100000000',
      },
    ],
  };
  // A newer full read may observe the next confirmation of this same hash.
  // This provides a real rendered hydration marker without replacing any
  // controller reply or reaching into the component's state/cache.
  const fullTransaction = {
    ...summary,
    confirmations: 5,
    vin: summary.vin.map((input) =>
      Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'isOwn')
      )
    ),
    vout: summary.vout.map((output) =>
      Object.fromEntries(
        Object.entries(output).filter(([key]) => key !== 'isOwn')
      )
    ),
  };
  const fixturePayloadSha256 = createHash('sha256')
    .update(JSON.stringify({ summary, fullTransaction }))
    .digest('hex');
  let releaseRead!: () => void;
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const transport = { requests: 0, released: false, forwarded: 0 };
  const observations: Record<string, unknown> = {};
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'UtxoDetailsFocusSynthetic!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('utxo-details-focus', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      {
        readState: () => ({
          transactions: [summary],
          rawTransactions: { [hash]: fullTransaction },
        }),
      }
    );
    // Delay only this genuine HTTP request, then let the existing fixture
    // transport deliver its unchanged payload to the real SDK/controller.
    await wallet.context.route(
      (url) =>
        [
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin) && url.pathname === `/api/v2/tx/${hash}`,
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        transport.requests += 1;
        await heldRead;
        await route.fallback();
        transport.forwarded += 1;
      }
    );
    const page = wallet.page;
    const field = (label: string) =>
      page.getByText(label, { exact: true }).locator('..');
    const copy = field('Txid').getByRole('button');
    const clipboard = () =>
      page.evaluate(() => (window as any).__utxoDetailsCopyAudit.snapshot());
    let baseline: Awaited<ReturnType<typeof publicContext>>;

    await wallet.step(
      'open ordinary Activity and hold its first full transaction HTTP read',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        baseline = await publicContext(page);
        expect(baseline.network.chainId).toBe(5700);
        expect(baseline.network.kind).toBe('syscoin');
        await page.locator('#activity-btn').click();
        const row = page
          .getByText(`${hash.slice(0, 4)}...${hash.slice(-14)}`, {
            exact: true,
          })
          .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
        await expect(row).toBeVisible();
        expect(transport.requests).toBe(0);
        await row
          .getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/home\/details/);
        await expect.poll(() => transport.requests).toBe(1);
        await expect(
          field('Confirmations').getByText('4', { exact: true })
        ).toBeVisible();
        await expect(copy).toBeVisible();
        expect(transport.released).toBe(false);
        expect(
          routes!.reads.filter((read) => read === `/api/v2/tx/${hash}`)
        ).toHaveLength(0);
        await page.evaluate(() => {
          const descriptor = Object.getOwnPropertyDescriptor(
            navigator.clipboard,
            'writeText'
          );
          const original = navigator.clipboard.writeText.bind(
            navigator.clipboard
          );
          const audit = { writes: [] as string[], failures: 0 };
          Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async (text: string) => {
              try {
                await original(text);
                audit.writes.push(text);
              } catch (error) {
                audit.failures += 1;
                throw error;
              }
            },
          });
          (window as any).__utxoDetailsCopyAudit = {
            snapshot: () => ({ ...audit, writes: [...audit.writes] }),
            restore: () => {
              if (descriptor)
                Object.defineProperty(
                  navigator.clipboard,
                  'writeText',
                  descriptor
                );
              else delete (navigator.clipboard as any).writeText;
            },
          };
        });
        observations.beforeRead = await publicContext(page);
      }
    );
    await wallet.step(
      'native keyboard copy works while the real full read remains pending',
      async (capture) => {
        await page.mouse.move(0, 0);
        await tabTo(page, copy);
        await expect(copy).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(clipboard).toEqual({ writes: [hash], failures: 0 });
        await expect(copy).toBeFocused();
        expect(transport.released).toBe(false);
        observations.pendingCopy = await clipboard();
        await capture(page);
      }
    );
    await wallet.step(
      'the same focused Txid node survives completion of the actual HTTP read',
      async (capture) => {
        const originalButton = await copy.elementHandle();
        expect(originalButton).not.toBeNull();
        transport.released = true;
        releaseRead();
        await expect(
          field('Confirmations').getByText('5', { exact: true })
        ).toBeVisible();
        await expect.poll(() => transport.forwarded).toBe(1);
        await expect(copy).toBeFocused();
        const identity = await originalButton!.evaluate((element) => ({
          connected: element.isConnected,
          focused: element === document.activeElement,
        }));
        expect(identity).toEqual({ connected: true, focused: true });
        expect(
          routes!.reads.filter((read) => read === `/api/v2/tx/${hash}`)
        ).toHaveLength(1);
        expect(await publicContext(page)).toEqual(baseline!);
        observations.afterHydration = {
          identity,
          context: await publicContext(page),
          confirmations: await field('Confirmations').innerText(),
        };
        await page.keyboard.press('Enter');
        await expect.poll(clipboard).toEqual({
          writes: [hash, hash],
          failures: 0,
        });
        await expect(copy).toBeFocused();
        await capture(page);
        await originalButton!.dispose();
      }
    );
    await wallet.step(
      'pointer copy and stable completed Details remain healthy',
      async (capture) => {
        await copy.click();
        await expect.poll(clipboard).toEqual({
          writes: [hash, hash, hash],
          failures: 0,
        });
        await expect(
          field('Fees').getByText('0.00001 TSYS', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText(en.send.confirmed, { exact: true })
        ).toBeVisible();
        expect(transport.requests).toBe(1);
        expect(await publicContext(page)).toEqual(baseline!);
        observations.completedCopy = await clipboard();
        await capture(page);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    expect(
      createHash('sha256')
        .update(JSON.stringify({ summary, fullTransaction }))
        .digest('hex')
    ).toBe(fixturePayloadSha256);
    status = 'passed';
  } finally {
    releaseRead();
    try {
      await info.attach('utxo-details-focus-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          hash,
          fixturePayloadSha256,
          transport,
          observations,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          syntheticBroadcasts: routes?.syntheticBroadcasts ?? [],
          proxyDeniedConnections: server.blocked.length,
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          clipboardObservedThroughOriginalMethod: true,
          clipboardReadRequested: false,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        if (wallet && !wallet.page.isClosed())
          await wallet.page
            .evaluate(() => (window as any).__utxoDetailsCopyAudit?.restore())
            .catch(() => undefined);
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
