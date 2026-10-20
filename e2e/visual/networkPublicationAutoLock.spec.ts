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
import {
  approve,
  extensionEvidence,
  providerRequest,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const NETWORK_A = 'Syscoin NEVM Testnet';
const NETWORK_B = 'Public Network Publication B';
const RPC_B = 'https://network-publication-b.invalid/';
const ALARM = 'pali_auto_lock_timer';
const FIVE_MINUTES = 5 * 60 * 1000;

// Only public Chrome reads: never replace, clear, create or fire an alarm.
const alarmSnapshot = (page: Page) =>
  page.evaluate(
    (name) =>
      new Promise<{
        alarm: { name: string; scheduledTime: number } | null;
        observedAt: number;
      }>((resolve, reject) => {
        chrome.alarms.get(name, (alarm) => {
          if (chrome.runtime.lastError)
            reject(new Error(chrome.runtime.lastError.message));
          else
            resolve({
              observedAt: Date.now(),
              alarm: alarm
                ? { name: alarm.name, scheduledTime: alarm.scheduledTime }
                : null,
            });
        });
      }),
    ALARM
  );

const backgroundNetwork = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return {
      chainId: state.vault.activeNetwork.chainId,
      kind: state.vault.activeNetwork.kind,
      url: state.vault.activeNetwork.url,
      isBitcoinBased: state.vault.isBitcoinBased,
    };
  });

const publicNetwork = (page: Page) =>
  page.evaluate(async () => {
    const ethereum = (window as any).ethereum;
    const pali = (window as any).pali;
    return {
      sameProvider: ethereum === (window as any).__publicationProvider,
      chainId: ethereum.chainId,
      rpcChainId: await ethereum.request({ method: 'eth_chainId' }),
      networkVersion: Number(ethereum.networkVersion),
      isBitcoinBased: ethereum.isBitcoinBased(),
      sysIsBitcoinBased: pali.isBitcoinBased(),
      explorer: await pali.activeExplorer(),
      accounts: (await ethereum.request({ method: 'eth_accounts' })).map(
        (address: string) => address.toLowerCase()
      ),
      chainEvents: [...(window as any).__publicationChainEvents],
      networkNotifications: [
        ...(window as any).__publicationNetworkNotifications,
      ],
    };
  });

async function openAdvanced(wallet: PaliWallet) {
  await wallet.page.locator('#general-settings-button').click();
  await wallet.page.getByText(en.generalMenu.advanced, { exact: true }).click();
  await expect(wallet.page).toHaveURL(/#\/settings\/advanced$/);
  await expect(wallet.page.locator('#advanced-autolock')).toBeVisible();
}

test('normal connected network publication and route activity preserve the auto-lock policy', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const originalConfig = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkAlarmSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const secondNetworkReads: Array<{ method: string; params: unknown[] }> = [];
  const deniedSecondNetwork: unknown[] = [];
  const observations: Record<string, unknown> = {
    syntheticPublicRpcOnly: true,
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
    chromeApiReplaced: false,
    directControllerWrites: false,
    waitedForRealExpiry: false,
  };
  try {
    // CI loads raw webpack output; local qualification loads the release ZIP.
    // Fingerprint every member before launch instead of assuming package count.
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(runtime.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.bundleHashes).toEqual({
      background: expect.stringMatching(/^[a-f0-9]{64}$/),
      external: expect.stringMatching(/^[a-f0-9]{64}$/),
      inpage: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    observations.runtime = runtime;
    wallet = await PaliWallet.launch('network-publication-auto-lock', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    expect(extensionEvidence()).toEqual(runtime);
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // One explicit second EVM endpoint, not a blanket successful RPC stub.
    await wallet.context.route(RPC_B, async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        deniedSecondNetwork.push('invalid JSON');
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const replies = calls.map((call) => {
        if (
          route.request().method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          !Array.isArray(call.params)
        )
          return undefined;
        let result: unknown;
        switch (call.method) {
          case 'eth_chainId':
            result = '0x1645';
            break;
          case 'net_version':
            result = '5701';
            break;
          case 'eth_blockNumber':
            result = '0x1';
            break;
          case 'eth_gasPrice':
          case 'eth_maxPriorityFeePerGas':
            result = '0x3b9aca00';
            break;
          case 'eth_getBalance':
          case 'eth_getTransactionCount':
            if (
              !fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() === String(call.params[0]).toLowerCase()
              )
            )
              return undefined;
            result = '0x0';
            break;
          case 'eth_getCode':
            if (!/^0x[0-9a-f]{40}$/i.test(String(call.params[0])))
              return undefined;
            result = '0x';
            break;
          case 'eth_getLogs':
            result = [];
            break;
          case 'eth_getBlockByNumber': {
            if (
              !['latest', '0x0', '0x1'].includes(call.params[0]) ||
              typeof call.params[1] !== 'boolean'
            )
              return undefined;
            // The normal empty-history scan includes genesis at head one.
            const genesis = call.params[0] === '0x0';
            result = {
              number: genesis ? '0x0' : '0x1',
              hash: '0x' + (genesis ? '90' : '91').repeat(32),
              parentHash: '0x' + (genesis ? '00' : '90').repeat(32),
              nonce: '0x0000000000000000',
              timestamp: genesis ? '0x0' : '0x1',
              difficulty: '0x0',
              gasLimit: '0x1c9c380',
              gasUsed: '0x0',
              miner: '0x' + '00'.repeat(20),
              extraData: '0x',
              transactions: [],
              baseFeePerGas: '0x3b9aca00',
            };
            break;
          }
          default:
            return undefined;
        }
        secondNetworkReads.push({ method: call.method, params: call.params });
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (!calls.length || replies.some((reply) => reply === undefined)) {
        deniedSecondNetwork.push(payload);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });

    await wallet.step(
      'publication-alarm: prepare normal custom network',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork(NETWORK_A, 'EVM');
        const page = wallet!.page;
        await page
          .getByRole('button')
          .filter({ hasText: /EVM/ })
          .first()
          .click();
        await page.getByText(en.networkMenu.customRpc, { exact: true }).click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await page
          .getByRole('combobox', { name: en.settings.label, exact: true })
          .fill(NETWORK_B);
        await page.locator('#rpc_chainId').fill('5701');
        await page.locator('#rpc_symbol').fill('PUB');
        await page.locator('#rpc_url').fill(RPC_B);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await wallet!.ensureOnHome();
        await wallet!.switchNetwork(NETWORK_A, 'EVM');
      }
    );

    const dapp = await wallet.context.newPage();
    await dapp.addInitScript(() => {
      const notifications: unknown[] = [];
      (window as any).__publicationNetworkNotifications = notifications;
      window.addEventListener('paliNotification', (event) => {
        const parsed = JSON.parse((event as CustomEvent).detail);
        const message = parsed?.data || parsed;
        if (
          [
            'pali_chainChanged',
            'pali_isBitcoinBased',
            'pali_blockExplorerChanged',
          ].includes(message?.method)
        ) {
          notifications.push({
            sequence: notifications.length,
            method: message.method,
            hasParams: Object.prototype.hasOwnProperty.call(message, 'params'),
            params: message.params,
          });
        }
      });
    });
    await dapp.goto(server.url);
    await dapp.waitForFunction(() =>
      Boolean((window as any).ethereum?.request)
    );
    let connectedAccounts: string[] = [];
    await wallet.step(
      'publication-alarm: approve ordinary dapp connection',
      async (capture) => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const result = await approve(wallet!.context, dapp, id, capture);
        expect(result.error).toBeUndefined();
        connectedAccounts = result.result.map((address: string) =>
          address.toLowerCase()
        );
        expect(connectedAccounts).toHaveLength(1);
        expect(
          fixture.evmAddresses.map((address) => address.toLowerCase())
        ).toContain(connectedAccounts[0]);
        await dapp.evaluate(() => {
          (window as any).__publicationProvider = (window as any).ethereum;
          (window as any).__publicationChainEvents = [];
          (window as any).ethereum.on('chainChanged', (chainId: string) => {
            (window as any).__publicationChainEvents.push(chainId);
          });
        });
      }
    );

    await wallet.step(
      'publication-alarm: normal network menu updates the same connected provider',
      async () => {
        const publication = [];
        const initialNotifications = (await publicNetwork(dapp))
          .networkNotifications.length;
        for (const [label, chainId, url] of [
          [NETWORK_B, 5701, RPC_B],
          [NETWORK_A, 5700, 'https://rpc.tanenbaum.io'],
        ] as const) {
          const notificationOffset = (await publicNetwork(dapp))
            .networkNotifications.length;
          await wallet!.switchNetwork(label, 'EVM');
          const expected = {
            chainId,
            kind: 'ethereum',
            url,
            isBitcoinBased: false,
          };
          await expect
            .poll(() => backgroundNetwork(wallet!.page))
            .toEqual(expected);
          const hex = '0x' + chainId.toString(16);
          await expect
            .poll(() => publicNetwork(dapp))
            .toMatchObject({
              sameProvider: true,
              chainId: hex,
              rpcChainId: hex,
              networkVersion: chainId,
              isBitcoinBased: false,
              sysIsBitcoinBased: false,
              explorer: null,
              accounts: connectedAccounts,
            });
          const explorerNotifications = async () =>
            (await publicNetwork(dapp)).networkNotifications
              .slice(notificationOffset)
              .filter(
                (notice) => notice.method === 'pali_blockExplorerChanged'
              );
          await expect.poll(explorerNotifications).toHaveLength(1);
          expect((await explorerNotifications())[0]).toMatchObject({
            method: 'pali_blockExplorerChanged',
            hasParams: true,
            params: null,
          });
          publication.push({
            background: await backgroundNetwork(wallet!.page),
            provider: await publicNetwork(dapp),
          });
        }
        const final = await publicNetwork(dapp);
        expect(final.chainEvents).toContain('0x1645');
        expect(final.chainEvents.at(-1)).toBe('0x1644');
        const explorerNotifications = final.networkNotifications
          .slice(initialNotifications)
          .filter((notice) => notice.method === 'pali_blockExplorerChanged');
        expect(explorerNotifications).toHaveLength(2);
        expect(
          new Set(explorerNotifications.map((notice) => notice.sequence)).size
        ).toBe(2);
        observations.publication = publication;
      }
    );

    await wallet.step(
      'publication-alarm: normal Advanced Save arms five minutes',
      async () => {
        await openAdvanced(wallet!);
        await wallet!.page.locator('#advanced-autolock').fill('5');
        await wallet!.page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(
          wallet!.page.getByRole('dialog', {
            name: en.settings.advancedSettingsWasSet,
          })
        ).toBeVisible();
        await wallet!.page.keyboard.press('Escape');
        await expect(wallet!.page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect
          .poll(async () => (await alarmSnapshot(wallet!.page)).alarm?.name)
          .toBe(ALARM);
        observations.afterSave = await alarmSnapshot(wallet!.page);
      }
    );

    await wallet.step(
      'publication-alarm: normal route activity advances the real alarm',
      async () => {
        const before = await alarmSnapshot(wallet!.page);
        expect(before.alarm?.name).toBe(ALARM);
        const routeStartedAt = Date.now();
        // No document reload: use the header's real SPA route navigation.
        await openAdvanced(wallet!);
        await expect(wallet!.page.locator('#advanced-autolock')).toHaveValue(
          '5'
        );
        await expect
          .poll(
            async () => (await alarmSnapshot(wallet!.page)).alarm!.scheduledTime
          )
          .toBeGreaterThan(before.alarm!.scheduledTime);
        const after = await alarmSnapshot(wallet!.page);
        expect(after.alarm!.scheduledTime).toBeGreaterThanOrEqual(
          routeStartedAt + FIVE_MINUTES - 1000
        );
        expect(after.alarm!.scheduledTime).toBeLessThanOrEqual(
          after.observedAt + FIVE_MINUTES + 1000
        );
        observations.routeActivity = { before, routeStartedAt, after };
      }
    );

    await wallet.step(
      'publication-alarm: normal disabling clears the alarm and audits public boundaries',
      async () => {
        await wallet!.page.locator('#advanced-autolock').fill('0');
        await wallet!.page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(
          wallet!.page.getByRole('dialog', {
            name: en.settings.advancedSettingsWasSet,
          })
        ).toBeVisible();
        await expect
          .poll(async () => (await alarmSnapshot(wallet!.page)).alarm)
          .toBeNull();
        observations.disabled = await alarmSnapshot(wallet!.page);
        expect(
          (await providerRequest(dapp, 'eth_accounts')).map((address: string) =>
            address.toLowerCase()
          )
        ).toEqual(connectedAccounts);
        expect(routes!.deniedWrites).toEqual([]);
        expect(deniedSecondNetwork).toEqual([]);
        expect(
          secondNetworkReads.some((read) => read.method === 'eth_chainId')
        ).toBe(true);
        expect(extensionEvidence()).toEqual(runtime);
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('network-publication-auto-lock-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            ...observations,
            status,
            secondNetworkReads,
            deniedSecondNetwork,
            deniedWrites: routes?.deniedWrites,
            proxyDeniedConnections: server.blocked.length,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
          },
          null,
          2
        ),
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
          Object.assign(E2E_CONFIG, originalConfig);
        }
      }
    }
  }
});
