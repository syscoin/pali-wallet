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

const NETWORK = 'Syscoin NEVM Testnet';
const RPC = 'https://rpc.tanenbaum.io/';

// Read only the public network/account/loading projection, not vault secrets.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    return {
      chainId: state.vault.activeNetwork.chainId,
      rpc: state.vault.activeNetwork.url,
      account: {
        ...ref,
        address: state.vault.accounts[ref.type][ref.id].address,
      },
      status: state.vaultGlobal.networkStatus,
      loadingBalances: state.vaultGlobal.loadingStates.isLoadingBalances,
      polling: state.vaultGlobal.isPollingUpdate,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
    };
  });

for (const leaveView of [false, true]) {
  const mode = leaveView ? 'leave' : 'current';
  test(
    leaveView
      ? 'late successful network retry preserves the editor opened while its RPC was pending'
      : 'current network retry completes normally after its real RPC succeeds',
    async ({}, info) => {
      test.setTimeout(120_000);
      expect(info.config.workers).toBe(1);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const runtime = extensionEvidence();
      expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
      const previousConfig = { ...E2E_CONFIG };
      let server:
        | Awaited<ReturnType<typeof startUtxoFixtureServer>>
        | undefined;
      let wallet: PaliWallet | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      let holdBalances = false;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const heldReads: Array<{ fulfilled: boolean; methods: string[] }> = [];
      const deniedRequests: string[] = [];
      const observations: Record<string, unknown> = {};
      try {
        server = await startUtxoFixtureServer();
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'NetworkRetrySyntheticOnly!2026',
          rpcUrl: server.url,
        });
        wallet = await PaliWallet.launch(`network-retry-${mode}`, {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        });
        const fixture = createIsolatedVaultFixture();
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        // Only a real native-balance HTTP read is held. All other traffic keeps
        // the existing isolated fixture's exact endpoint/method allowlist.
        await wallet.context.route(RPC, async (route) => {
          let payload: any;
          try {
            payload = route.request().postDataJSON();
          } catch {
            deniedRequests.push('invalid JSON');
            return route.abort('blockedbyclient');
          }
          const calls = Array.isArray(payload) ? payload : [payload];
          if (
            route.request().method() !== 'POST' ||
            calls.some((call) =>
              /^(?:eth_send|personal_|eth_sign|wallet_)/i.test(
                call?.method || ''
              )
            )
          ) {
            deniedRequests.push('non-read RPC');
            return route.abort('blockedbyclient');
          }
          if (
            !holdBalances ||
            !calls.some((call) => call?.method === 'eth_getBalance')
          )
            return route.fallback();
          const replies = calls.map((call) => {
            if (
              call?.jsonrpc !== '2.0' ||
              !Array.isArray(call.params) ||
              call.method !== 'eth_getBalance' ||
              call.params.length !== 2 ||
              !fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() === String(call.params[0]).toLowerCase()
              ) ||
              call.params[1] !== 'latest'
            )
              return undefined;
            return { jsonrpc: '2.0', id: call.id, result: '0x0' };
          });
          if (!calls.length || replies.some((reply) => !reply)) {
            deniedRequests.push('unexpected held balance request');
            return route.abort('blockedbyclient');
          }
          const read = {
            methods: calls.map((call) => call.method),
            fulfilled: false,
          };
          heldReads.push(read);
          await held;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
          });
          read.fulfilled = true;
        });
        const page = wallet.page;
        await wallet.step(
          `network-retry-${mode}: prepare the current network`,
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork(NETWORK, 'EVM');
            await wallet!.ensureOnHome();
            const initial = await publicState(page);
            expect(initial.chainId).toBe(5700);
            expect(initial.status).toBe('idle');
            observations.initial = initial;
          }
        );
        await wallet.step(
          `network-retry-${mode}: open the real recovery route`,
          async () => {
            // Normal extension navigation mounts the actual recovery page; no
            // controller, Redux state, IPC result or Chrome API is replaced.
            await wallet!.gotoRoute('#/chain-fail-to-connect');
            await expect(page).toHaveURL(/#\/chain-fail-to-connect$/);
            await expect(
              page.getByRole('button', {
                name: en.buttons.retryConnect,
                exact: true,
              })
            ).toBeEnabled();
            // Mounting recovery changes the popup's Redux state only. This
            // fixture's healthy background remains idle until the real retry.
            await expect(
              page.getByText(en.chainError.connectionTooLong, { exact: true })
            ).toBeVisible();
            await expect
              .poll(async () => (await publicState(page)).status)
              .toBe('idle');
          }
        );
        await wallet.step(
          `network-retry-${mode}: hold the pending real balance read`,
          async () => {
            holdBalances = true;
            await page
              .getByRole('button', {
                name: en.buttons.retryConnect,
                exact: true,
              })
              .click();
            await expect.poll(() => heldReads.length).toBeGreaterThan(0);
            await expect(
              page.getByRole('button', {
                name: en.buttons.retryConnect,
                exact: true,
              })
            ).toBeDisabled();
            expect(heldReads.every((read) => !read.fulfilled)).toBe(true);
            observations.pending = await publicState(page);
          }
        );
        if (leaveView) {
          await wallet.step(
            'network-retry-leave: leave through the enabled Edit action',
            async () => {
              const edit = page.getByRole('button', {
                name: en.chainError.editCurrentRpc,
                exact: true,
              });
              await expect(edit).toBeEnabled();
              await edit.click();
              await expect(page).toHaveURL(
                /#\/settings\/networks\/custom-rpc$/
              );
              await expect(page.locator('#rpc_chainId')).toHaveValue('5700');
              expect(heldReads.every((read) => !read.fulfilled)).toBe(true);
              observations.leftBeforeRelease = {
                route: new URL(page.url()).hash,
                heldReads: heldReads.length,
              };
            }
          );
        }
        await wallet.step(
          `network-retry-${mode}: release the successful HTTP read`,
          async () => {
            holdBalances = false;
            release();
            await expect
              .poll(() => heldReads.filter((read) => read.fulfilled).length)
              .toBeGreaterThan(0);
            await expect
              .poll(async () => {
                const state = await publicState(page);
                return (
                  state.status === 'idle' &&
                  !state.loadingBalances &&
                  !state.polling &&
                  !state.postLoading
                );
              })
              .toBe(true);
            if (leaveView) {
              // Observe the completed HTTP/readiness boundary across a bounded
              // UI interval. This does not instrument or delay a Chrome IPC reply.
              const settledAt = Date.now();
              await expect
                .poll(async () => {
                  expect(page.url()).toMatch(
                    /#\/settings\/networks\/custom-rpc$/
                  );
                  await expect(page.locator('#rpc_chainId')).toHaveValue(
                    '5700'
                  );
                  await expect(
                    page.getByText(en.networkConnection.operationCompleted, {
                      exact: true,
                    })
                  ).toHaveCount(0);
                  return Date.now() - settledAt >= 1000;
                })
                .toBe(true);
            } else {
              await expect(page).toHaveURL(/#\/home$/);
              await expect(page.locator('#home-balance')).toBeVisible();
              await expect(
                page.getByText(en.networkConnection.operationCompleted, {
                  exact: true,
                })
              ).toBeVisible();
            }
            const final = await publicState(page);
            expect(heldReads.every((read) => read.fulfilled)).toBe(true);
            expect(final.account).toEqual(
              (observations.initial as any).account
            );
            expect(final.chainId).toBe(5700);
            observations.final = { ...final, route: new URL(page.url()).hash };
          }
        );
        expect(deniedRequests).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        status = 'passed';
      } finally {
        holdBalances = false;
        release();
        try {
          await info.attach(`network-retry-${mode}-evidence`, {
            contentType: 'application/json',
            body: JSON.stringify({
              runtime,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex'),
              mode,
              status,
              syntheticHttpOnly: true,
              controllerStateReplaced: false,
              controllerResultsReplaced: false,
              chromeApiReplaced: false,
              cancellationIpcRaceClaimed: false,
              heldReads,
              observations,
              deniedRequests,
              deniedWrites: routes?.deniedWrites || [],
              reads: routes?.reads || [],
              proxyDeniedRequests: server?.blocked || [],
            }),
          });
        } catch (error) {
          status = 'failed';
          throw error;
        } finally {
          try {
            await wallet?.dispose(status);
          } finally {
            try {
              await server?.close();
            } finally {
              Object.assign(E2E_CONFIG, previousConfig);
            }
          }
        }
      }
    }
  );
}
