import { expect, test } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { createGuardianRecoveryFixture } from '../harness/guardianRecoveryFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  VISUAL_FIXTURE_SEED,
  VISUAL_FIXTURE_CHAIN_ID,
} from '../harness/visualFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// Real account-menu entry and read-only synthetic chain deployment; no controller/state replacement.
for (const width of [400, 320]) {
  test(`smart-account Hub refreshes an externally deployed account at ${width}`, async ({}, info) => {
    test.setTimeout(120000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    await info.attach('runtime', {
      body: JSON.stringify(extensionEvidence()),
      contentType: 'application/json',
    });
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createGuardianRecoveryFixture();
    Object.assign(E2E_CONFIG, {
      seedPhrase: VISUAL_FIXTURE_SEED,
      password: 'HubDiagnosisSynthetic!2026',
      rpcUrl: server.url,
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase = 'setup';
    const inFlight = new Set<unknown>();
    const reads: Array<{ address?: string; method: string; phase: string }> =
      [];
    const snapshot = async () =>
      wallet!.page.evaluate(async () => {
        const s = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
        const ref = s.vault.activeAccount;
        const a = s.vault.accounts[ref.type][ref.id];
        return {
          account: { ...ref, address: a.address },
          isDeployed: a.smartAccount?.isDeployed,
          network: {
            chainId: s.vault.activeNetwork.chainId,
            url: s.vault.activeNetwork.url,
          },
          networkStatus: s.vaultGlobal.networkStatus,
          postLoading: s.vaultGlobal.isPostNetworkSwitchLoading,
          balanceLoading: s.vaultGlobal.loadingStates.isLoadingBalances,
        };
      });
    const settleReads = async () => {
      let previousCount = -1,
        stable = 0;
      await expect
        .poll(
          async () => {
            const state = await snapshot();
            stable =
              reads.length === previousCount &&
              inFlight.size === 0 &&
              state.networkStatus === 'idle' &&
              !state.postLoading &&
              !state.balanceLoading
                ? stable + 1
                : 0;
            previousCount = reads.length;
            return stable;
          },
          { intervals: [100] }
        )
        .toBeGreaterThanOrEqual(3);
      await wallet!.page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
    };
    try {
      wallet = await PaliWallet.launch(`hub-deployment-refresh-${width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 320 ? 360 : 620 },
      });
      await fixture.install(wallet.context, server.url);
      wallet.context.on('request', (request) => {
        if (!request.url().startsWith('https://rpc-zk.tanenbaum.io')) return;
        inFlight.add(request);
        try {
          const raw = request.postDataJSON();
          for (const call of Array.isArray(raw) ? raw : [raw])
            reads.push({
              phase,
              method: call.method,
              ...(typeof call.params?.[0] === 'string'
                ? { address: call.params[0] }
                : {}),
            });
        } catch {
          /* Only record valid observed RPC payloads. */
        }
      });
      wallet.context.on('requestfinished', (request) =>
        inFlight.delete(request)
      );
      wallet.context.on('requestfailed', (request) => inFlight.delete(request));
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('zkTanenbaum', 'EVM');
      await wallet.ensureOnHome();
      await wallet.page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await wallet.page
        .getByRole('menuitem', {
          name: en.accountMenu.createNewAccount,
          exact: true,
        })
        .click();
      await wallet.page
        .locator('#account-name-input')
        .fill('Public remote-deployment account');
      await wallet.page
        .getByRole('button', {
          name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
        })
        .click();
      const dialog = wallet.page
        .getByRole('dialog')
        .filter({ hasText: en.settings.yourNewAccount });
      await expect(
        dialog.getByText(fixture.base.smartAccountAddress, { exact: true })
      ).toBeVisible();
      await dialog.locator('#account-created-ok-btn').click();
      await wallet.ensureOnHome();
      await settleReads();
      expect((await snapshot()).isDeployed).toBe(false);
      phase = 'healthy-undeployed';
      await wallet.step(
        'undeployed chain state stays conservatively labelled',
        async (capture) => {
          await wallet!.page.locator('#smart-account-hub-badge').click();
          await expect(wallet!.page).toHaveURL(/#\/home\/smart-account$/);
          await settleReads();
          await wallet!.page.mouse.move(100, 180);
          await wallet!.page.mouse.wheel(0, -2000);
          await wallet!.page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              )
          );
          await expect(
            wallet!.page.getByText(en.smartAccountHub.notDeployed, {
              exact: true,
            })
          ).toBeVisible();
          expect((await snapshot()).isDeployed).toBe(false);
          await info.attach(`hub-undeployed-${width}`, {
            body: await wallet!.page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await capture(wallet!.page);
          await wallet!.page.goBack();
          await wallet!.ensureOnHome();
        }
      );
      fixture.hydrationState.deployed = true;
      fixture.hydrationState.guardianInstalled = true;
      phase = 'hub-first-open';
      await wallet.step(
        'open Hub after the remote account becomes deployed',
        async (capture) => {
          await wallet!.page.locator('#smart-account-hub-badge').click();
          await expect(wallet!.page).toHaveURL(/#\/home\/smart-account$/);
          await expect
            .poll(async () => (await snapshot()).isDeployed)
            .toBe(true);
          await settleReads();
          const state = await snapshot();
          const stale = await wallet!.page
            .getByText(en.smartAccountHub.notDeployed, { exact: true })
            .count();
          await info.attach(`hub-first-${width}`, {
            body: await wallet!.page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await info.attach(`hub-first-${width}-observation`, {
            body: JSON.stringify({
              state,
              stale,
              reads: reads.filter((r) => r.phase === phase),
              inFlight: inFlight.size,
            }),
            contentType: 'application/json',
          });
          await capture(wallet!.page);
          expect(state.isDeployed).toBe(true);
          expect(stale).toBe(0);
          expect(
            reads.some(
              (r) =>
                r.phase === phase &&
                r.method === 'eth_getCode' &&
                r.address?.toLowerCase() ===
                  fixture.base.smartAccountAddress.toLowerCase()
            )
          ).toBe(true);
        }
      );
      phase = 'policy-control';
      await wallet.step(
        'Policy observes deployment of the same account and Back updates Hub',
        async (capture) => {
          const policy = wallet!.page.getByRole('button').filter({
            has: wallet!.page.getByText(
              en.settings.smartAccountGuardianRecoveryTitle,
              { exact: true }
            ),
          });
          await policy.scrollIntoViewIfNeeded();
          fixture.armBarrier();
          await policy.click();
          await expect(wallet!.page).toHaveURL(
            /#\/settings\/account\/smart-account-policy$/
          );
          await fixture.waitForRead(1);
          await expect(wallet!.page.getByRole('status')).toHaveText(
            en.buttons.loading
          );
          await info.attach(`policy-loading-${width}`, {
            body: await wallet!.page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          fixture.releaseAll();
          await expect(
            wallet!.page.getByText(en.buttons.loading, { exact: true })
          ).toHaveCount(0);
          await expect
            .poll(async () => (await snapshot()).isDeployed)
            .toBe(true);
          await settleReads();
          await info.attach(`policy-control-${width}`, {
            body: await wallet!.page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          const policyState = await snapshot();
          phase = 'hub-after-policy';
          await wallet!.page.goBack();
          await expect(wallet!.page).toHaveURL(/#\/home\/smart-account$/);
          await settleReads();
          await expect(
            wallet!.page.getByText(en.smartAccountHub.notDeployed, {
              exact: true,
            })
          ).toHaveCount(0);
          const state = await snapshot();
          expect(state.account).toEqual(policyState.account);
          expect(state.network).toEqual(policyState.network);
          await wallet!.page.mouse.move(100, 180);
          await wallet!.page.mouse.wheel(0, -2000);
          await wallet!.page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              )
          );
          await info.attach(`hub-after-policy-${width}`, {
            body: await wallet!.page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await info.attach(`hub-after-policy-${width}-observation`, {
            body: JSON.stringify({
              state,
              policyState,
              reads,
              inFlight: inFlight.size,
            }),
            contentType: 'application/json',
          });
          await capture(wallet!.page);
        }
      );
      expect(fixture.audit.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      fixture.releaseAll();
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
