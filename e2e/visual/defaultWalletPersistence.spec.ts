import { expect, test, type Page, type Worker } from '@playwright/test';
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
  popupFor,
  providerRequest,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const readPermission = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const live = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    return {
      livePermission: Boolean(live.dapp.dapps[origin]),
      savedPermission: Boolean(saved.state?.dapp?.dapps[origin]),
      liveProvider: live.vaultGlobal.hasEthProperty,
      savedProvider: saved.state?.vaultGlobal?.hasEthProperty,
    };
  }, host);

test('a refused default-wallet permission write stays visible and retries without disabling the provider', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const origin = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'DefaultWalletPersistenceSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('default-wallet-persistence', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step('prepare a connected disposable EVM wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet!.ensureOnHome();
    });
    const dapp = await wallet.context.newPage();
    await dapp.goto(origin);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    let originalAddress = '';
    await wallet.step(
      'approve the ordinary dapp connection',
      async (capture) => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        try {
          const response = await approve(wallet!.context, dapp, id, capture);
          expect(response.result).toHaveLength(1);
          originalAddress = response.result[0];
        } finally {
          if (!popup.isClosed()) await capture(popup);
        }
      }
    );
    const page = wallet.page;
    await wallet.gotoRoute('#/settings/remove-eth');
    const disable = page.getByRole('button', {
      name: en.settings.disablePaliProvider,
      exact: true,
    });
    const enable = page.getByRole('button', {
      name: en.settings.enablePaliProvider,
      exact: true,
    });
    const footer = page.locator('[data-page-action-footer]');
    await expect(disable).toBeEnabled();
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      // The footer is in the page's scroll flow, so short windows do not
      // cover the explanation; bring the action into view before inspecting it.
      await disable.scrollIntoViewIfNeeded();
      await expect(
        footer.getByText(en.settings.disablePaliProviderWarning, {
          exact: true,
        })
      ).toBeInViewport({ ratio: 1 });
      await expect(disable).toBeInViewport({ ratio: 1 });
      await info.attach(`default-provider-warning-${viewport.width}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
    }
    expect(await readPermission(page, origin)).toEqual({
      livePermission: true,
      savedPermission: true,
      liveProvider: true,
      savedProvider: true,
    });
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await worker!.evaluate((host) => {
      const local = chrome.storage.local;
      const original = local.set;
      const probe = {
        failures: 0,
        attempts: 0,
        restore: () => {
          local.set = original;
          delete (globalThis as any).__defaultWalletStorage;
        },
      };
      (globalThis as any).__defaultWalletStorage = probe;
      local.set = ((items: Record<string, any>, ...args: any[]) => {
        if (
          items.state?.dapp?.dapps &&
          !Object.prototype.hasOwnProperty.call(items.state.dapp.dapps, host)
        ) {
          probe.attempts += 1;
          if (probe.failures === 0) {
            probe.failures += 1;
            // Refuse only the first matching native storage call. Controller
            // methods, replies, Redux and later writes remain unmodified.
            throw new Error('Synthetic default-wallet permission refusal');
          }
        }
        return (original as any).call(local, items, ...args);
      }) as typeof local.set;
    }, origin);
    await wallet.step(
      'show the refused write beside the same retry action',
      async () => {
        await disable.click();
        const failure = footer.getByRole('alert');
        await expect(failure).toHaveText(en.settings.disablePaliProviderFailed);
        const help = page.getByText(en.settings.otherDefaultWalletHelp, {
          exact: true,
        });
        // Exercise the native scroll path to expose the complete help text.
        await page.mouse.move(160, 180);
        await page.mouse.wheel(0, -1000);
        const scroller = page.locator(
          '[data-navigation-scroll="wallet-layout"]'
        );
        await expect
          .poll(() => scroller.evaluate((node) => node.scrollTop))
          .toBe(0);
        await page.mouse.wheel(0, 180);
        await expect(help).toBeInViewport({ ratio: 1 });
        const helpBox = (await help.boundingBox())!;
        const footerBox = (await footer.boundingBox())!;
        expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(footerBox.y);
        await expect(footer).toHaveCSS('position', 'static');
        await info.attach('default-wallet-help-visible-320x360', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        await page.mouse.wheel(0, 1000);
        await expect(failure).toBeInViewport({ ratio: 1 });
        await expect(disable).toBeEnabled();
        await expect(disable).toBeInViewport();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        observations.refused = await readPermission(page, origin);
        expect(observations.refused).toEqual({
          livePermission: true,
          savedPermission: true,
          liveProvider: true,
          savedProvider: true,
        });
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          originalAddress,
        ]);
        expect(
          await worker!.evaluate(
            () => (globalThis as any).__defaultWalletStorage.failures
          )
        ).toBe(1);
        await info.attach('default-wallet-refusal-320x360', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    );
    await wallet.step(
      'retry the same visible action and commit the provider change',
      async () => {
        await disable.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(
          page.getByText(en.settings.paliProviderDisabled, { exact: true })
        ).toBeVisible();
        await expect(
          footer.getByRole('alert', { includeHidden: true })
        ).toHaveCount(0);
        observations.retried = await readPermission(page, origin);
        expect(observations.retried).toEqual({
          livePermission: false,
          savedPermission: false,
          liveProvider: false,
          savedProvider: false,
        });
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        observations.probe = await worker!.evaluate(() => {
          const probe = (globalThis as any).__defaultWalletStorage;
          const result = { failures: probe.failures, attempts: probe.attempts };
          probe.restore();
          return result;
        });
        expect(observations.probe).toMatchObject({ failures: 1 });
        expect(
          (observations.probe as { attempts: number }).attempts
        ).toBeGreaterThanOrEqual(2);
        await page.keyboard.press('Escape');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/remove-eth');
        await expect(enable).toBeEnabled();
        await expect(enable).toBeInViewport();
        await expect(footer.getByRole('alert')).toHaveCount(0);
        await info.attach('default-wallet-recovery-320x360', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    );
    await wallet.step(
      'reenable the provider without restoring the revoked permission',
      async () => {
        await expect(enable).toBeEnabled();
        await expect(enable).toBeInViewport();
        await enable.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        observations.reenabled = await readPermission(page, origin);
        expect(observations.reenabled).toEqual({
          livePermission: false,
          savedPermission: false,
          liveProvider: true,
          savedProvider: true,
        });
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('default-wallet-persistence-evidence', {
        body: JSON.stringify({
          runtime: extensionEvidence(),
          observations,
          controllerStateReplaced: false,
          nativeStorageFailuresRequested: 1,
        }),
        contentType: 'application/json',
      });
    } finally {
      await worker
        ?.evaluate(() => (globalThis as any).__defaultWalletStorage?.restore())
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
