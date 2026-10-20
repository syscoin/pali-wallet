import { expect, test, type Page, type Worker } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import {
  extensionEvidence,
  popupFor,
  providerRequest,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const projection = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const live = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = (await chrome.storage.local.get('state')).state;
    const ref = live.vault.activeAccount;
    const grant = (state: any) => {
      const value = state?.dapp?.dapps?.[origin];
      return value
        ? {
            chain: value.chain,
            accountId: value.accountId,
            accountType: value.accountType,
          }
        : null;
    };
    return {
      liveGrant: grant(live),
      savedGrant: grant(saved),
      liveSlip44: live.vaultGlobal.activeSlip44,
      savedSlip44: saved?.vaultGlobal?.activeSlip44,
      postLoading: live.vaultGlobal.isPostNetworkSwitchLoading,
      address: live.vault.accounts[ref.type]?.[ref.id]?.address,
    };
  }, host);

async function installOutage(worker: Worker, host: string) {
  await worker.evaluate((origin) => {
    const local = chrome.storage.local;
    const original = local.set;
    const probe = {
      targetCommits: 0,
      disconnectFailures: 0,
      repairFailures: 0,
      attempts: [] as {
        at: number;
        grant: string | null;
        keys: string[];
        postLoading?: boolean;
        refused: boolean;
      }[],
      restore: () => {
        local.set = original;
        delete (globalThis as any).__typeSwitchStorage;
      },
    };
    (globalThis as any).__typeSwitchStorage = probe;
    local.set = ((items: Record<string, any>, ...args: any[]) => {
      const main = items.state;
      const attempt = {
        at: Date.now(),
        keys: Object.keys(items).sort(),
        grant: main?.dapp?.dapps?.[origin]?.chain || null,
        postLoading: main?.vaultGlobal?.isPostNetworkSwitchLoading,
        refused: false,
      };
      if (probe.attempts.length < 100) probe.attempts.push(attempt);
      if (
        main?.vaultGlobal?.activeSlip44 === 60 &&
        main.dapp?.dapps?.[origin]?.chain === 'syscoin' &&
        items['state-vault-60']
      ) {
        // The test separately reads storage to establish this write committed.
        probe.targetCommits += 1;
      }
      if (
        probe.targetCommits &&
        main?.dapp?.dapps &&
        !main.dapp.dapps[origin]
      ) {
        attempt.refused = true;
        if (items['state-vault-60']) probe.repairFailures += 1;
        else probe.disconnectFailures += 1;
        // Only native writes after the target network commit are refused.
        // Controller methods, Redux, transport and replies are not replaced.
        throw new Error('Synthetic type-switch permission storage outage');
      }
      return (original as any).call(local, items, ...args);
    }) as typeof local.set;
  }, host);
}

const outageCounts = (worker: Worker) =>
  worker.evaluate(() => {
    const probe = (globalThis as any).__typeSwitchStorage;
    return {
      targetCommits: probe.targetCommits,
      disconnectFailures: probe.disconnectFailures,
      repairFailures: probe.repairFailures,
      attempts: probe.attempts,
    };
  });

async function approveConnection(
  wallet: PaliWallet,
  dapp: Page,
  requestId: number
) {
  const popup = await popupFor(wallet.context, dapp, requestId);
  for (let step = 0; step < 3 && !popup.isClosed(); step += 1) {
    if ((await rpcObservation(dapp, requestId)).settled) break;
    const confirm = popup
      .getByRole('button', {
        name: /(?:^|\s)(confirm|approve|connect|proceed)$/i,
      })
      .last();
    await expect(confirm).toBeEnabled();
    await clickClosingPopup({
      click: () => confirm.click(),
      isClosed: () => popup.isClosed(),
    });
    await expect
      .poll(
        async () =>
          popup.isClosed() ||
          (
            await rpcObservation(dapp, requestId)
          ).settled ||
          (await confirm.isEnabled().catch(() => false))
      )
      .toBe(true);
  }
  const result = await settle(dapp, requestId);
  expect(result.error).toBeUndefined();
  return result.result as string[];
}

test('a failed type-switch permission removal cannot expose the target account after a cold worker', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const origin = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TypeSwitchIsolationSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let releaseRefresh: (() => void) | undefined;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('type-switch-permission-isolation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const page = wallet.page;
    let targetAddress = '';
    await wallet.step(
      'prepare both real account vaults and return to UTXO',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        targetAddress = (await projection(page, origin)).address;
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
      }
    );
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.step('approve only the original UTXO account', async () => {
      const id = await startRequest(dapp, 'sys_requestAccounts');
      const accounts = await approveConnection(wallet!, dapp, id);
      const state = await projection(page, origin);
      expect(accounts).toEqual([state.address]);
      expect(state.liveGrant?.chain).toBe('syscoin');
      expect(state.savedGrant).toEqual(state.liveGrant);
      expect(state.liveSlip44).toBe(1);
      observations.original = state;
    });
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await installOutage(worker!, origin);
    // Realistic slow public balance I/O keeps the normal post-switch refresh
    // pending until the actual disconnect has failed. It never blocks the
    // initial network commit, changes a reply, or replaces a controller method.
    let heldRefreshReads = 0;
    let refreshReleased = false;
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = () => {
        refreshReleased = true;
        resolve();
      };
    });
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      let rpc: any;
      try {
        rpc = route.request().postDataJSON();
      } catch {
        return route.fallback();
      }
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (
        !refreshReleased &&
        calls.some((call) => call?.method === 'eth_getBalance') &&
        (await outageCounts(worker!)).targetCommits > 0
      ) {
        heldRefreshReads += 1;
        observations.refreshRead = {
          heldReads: heldRefreshReads,
          at: Date.now(),
        };
        await refreshHeld;
      }
      return route.fallback();
    });
    await wallet.step(
      'approve the network switch but reject a new EVM account connection',
      async () => {
        const id = await startRequest(dapp, 'eth_changeUTXOEVM', [
          { chainId: 5700 },
        ]);
        const switching = await popupFor(wallet!.context, dapp, id);
        const change = switching.getByRole('button', {
          name: en.buttons.change,
          exact: true,
        });
        await expect(change).toBeEnabled();
        await clickClosingPopup({
          click: () => change.click(),
          isClosed: () => switching.isClosed(),
        });
        await expect.poll(() => switching.isClosed()).toBe(true);
        const connecting = await popupFor(wallet!.context, dapp, id);
        const cancel = connecting
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .last();
        await expect(cancel).toBeEnabled();
        const result = await dismissRejectedApproval({
          click: () => cancel.click(),
          isClosed: () => connecting.isClosed(),
          settle: () => settle(dapp, id),
        });
        expect(result.error?.code).toBe(4100);
        expect(result.result).toBeUndefined();
        await expect
          .poll(async () => (await outageCounts(worker!)).targetCommits)
          .toBeGreaterThan(0);
        await expect
          .poll(async () => (await outageCounts(worker!)).disconnectFailures)
          .toBeGreaterThan(0);
        await expect.poll(() => heldRefreshReads).toBeGreaterThan(0);
        expect((await projection(page, origin)).postLoading).toBe(true);
        observations.beforeRefreshRelease = await outageCounts(worker!);
        releaseRefresh!();
        await expect
          .poll(async () => (await outageCounts(worker!)).repairFailures)
          .toBeGreaterThan(0);
        const state = await projection(page, origin);
        expect(state).toMatchObject({
          liveGrant: null,
          liveSlip44: 60,
          savedSlip44: 60,
          address: targetAddress,
        });
        expect(state.savedGrant?.chain).toBe('syscoin');
        observations.failedRemoval = {
          state,
          writes: await outageCounts(worker!),
        };
      }
    );
    await wallet.step(
      'cold restart reads the saved foreign grant without granting EVM access',
      async () => {
        const cdp = await wallet!.context.newCDPSession(page);
        try {
          const { targetInfos } = await cdp.send('Target.getTargets');
          const target = targetInfos.find(
            (entry) =>
              entry.type === 'service_worker' &&
              entry.url.startsWith(`chrome-extension://${wallet!.extensionId}/`)
          );
          expect(target).toBeDefined();
          expect(
            (
              await cdp.send('Target.closeTarget', {
                targetId: target!.targetId,
              })
            ).success
          ).toBe(true);
        } finally {
          await cdp.detach();
        }
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#unlock-btn').isVisible())
          await wallet!.unlock();
        await wallet!.ensureOnHome();
        await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (identity) => {
            observations.restartedWorker = identity;
          }
        );
        const state = await projection(page, origin);
        expect(state.liveGrant?.chain).toBe('syscoin');
        expect(state.liveSlip44).toBe(60);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        expect(await providerRequest(dapp, 'wallet_getPermissions')).toEqual(
          []
        );
        observations.cold = state;
      }
    );
    await wallet.step(
      'fresh EVM consent creates the correct new permission',
      async () => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const accounts = await approveConnection(wallet!, dapp, id);
        expect(accounts.map((value) => value.toLowerCase())).toEqual([
          targetAddress.toLowerCase(),
        ]);
        const state = await projection(page, origin);
        expect(state.liveGrant?.chain).toBe('ethereum');
        expect(state.savedGrant).toEqual(state.liveGrant);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual(accounts);
        observations.reconnected = state;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    releaseRefresh?.();
    if (worker)
      observations.outage = await outageCounts(worker).catch(() => undefined);
    try {
      await info.attach('type-switch-permission-isolation', {
        body: JSON.stringify({
          runtime: extensionEvidence(),
          observations,
          fixtureReads: routes?.reads,
          deniedWrites: routes?.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          simulated: true,
          signingApproved: false,
        }),
        contentType: 'application/json',
      });
    } finally {
      await worker
        ?.evaluate(() => (globalThis as any).__typeSwitchStorage?.restore())
        .catch(() => undefined);
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
