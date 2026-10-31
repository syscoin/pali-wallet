import { expect, test, type Page, type Worker } from '@playwright/test';
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
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const LABEL = 'Durable retry watch account';
const FAILURE = 'Synthetic watch import storage refusal';

async function projection(page: Page) {
  return page.evaluate(async (label) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const records = await chrome.storage.local.get(storageKey);
    const account = (accounts: any) => {
      const value: any = Object.values(accounts?.Imported || {}).find(
        (entry: any) => entry.label === label
      );
      return value
        ? {
            id: value.id,
            address: value.address,
            label: value.label,
            watchOnly: value.isImported === true && !value.xprv,
          }
        : null;
    };
    return {
      active: state.vault.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      live: account(state.vault.accounts),
      saved: account(records[storageKey]?.accounts),
    };
  }, LABEL);
}

async function refuseFirstImport(worker: Worker, slip44: number) {
  await worker.evaluate(
    ({ label, message, storageKey }) => {
      const local = chrome.storage.local;
      const original = local.set;
      const probe = {
        failures: 0,
        attempts: 0,
        restore: () => {
          local.set = original;
          delete (globalThis as any).__watchImportStorageProbe;
        },
      };
      (globalThis as any).__watchImportStorageProbe = probe;
      local.set = ((items: Record<string, any>, ...args: any[]) => {
        if (
          Object.values(items[storageKey]?.accounts?.Imported || {}).some(
            (account: any) => account.label === label
          )
        ) {
          probe.attempts += 1;
          if (probe.failures === 0) {
            probe.failures += 1;
            // Reject just the real vault commit containing the candidate.
            // All reads, controller operations and other writes stay real.
            throw new Error(message);
          }
        }
        return (original as any).call(local, items, ...args);
      }) as typeof local.set;
    },
    { label: LABEL, message: FAILURE, storageKey: `state-vault-${slip44}` }
  );
}

async function watchImportDurability(
  width: 320 | 400,
  info: import('@playwright/test').TestInfo
) {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ImportDurabilitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch(
      width === 400
        ? 'account-import-durability'
        : 'account-import-durability-320',
      {
        offlineHttpProxy: server.url,
        viewport: { width, height: width === 320 ? 360 : 620 },
      }
    );
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    await wallet.step(
      'prepare a real watch-only import in the disposable wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/account/import');
        await page.locator('#account-name-input').fill(LABEL);
        await page.locator('#import-account-watch-only').check();
        await page
          .locator('#import-account-identifier')
          .fill(fixture.watchAddress);
        await expect(
          page.getByRole('button', { name: en.buttons.import, exact: true })
        ).toBeEnabled();
      }
    );
    const before = await projection(page);
    expect(before).toEqual({
      active: { id: 0, type: 'HDAccount' },
      slip44: 1,
      live: null,
      saved: null,
    });
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await refuseFirstImport(worker!, before.slip44);
    observations.before = before;

    await wallet.step(
      'refuse the first commit without publishing an account or selection',
      async () => {
        await page
          .getByRole('button', { name: en.buttons.import, exact: true })
          .click();
        await expect(page.getByText(FAILURE, { exact: true })).toBeVisible();
        if (width === 320) {
          const alert = page.getByRole('alert').filter({ hasText: FAILURE });
          await expect(alert).toHaveText(FAILURE);
          await expect(alert).toBeInViewport({ ratio: 1 });
          const position = await page.evaluate(() => {
            const field = document.querySelector<HTMLElement>(
              '#import-account-identifier'
            )!;
            const footer = document.querySelector<HTMLElement>(
              '[data-page-action-footer]'
            )!;
            const fieldRect = field.getBoundingClientRect();
            const footerRect = footer.getBoundingClientRect();
            return {
              top: fieldRect.top,
              bottom: fieldRect.bottom,
              footerTop: footerRect.top,
            };
          });
          expect(position.top).toBeGreaterThanOrEqual(0);
          expect(position.bottom).toBeLessThanOrEqual(position.footerTop + 1);
        }
        await expect(page).toHaveURL(/#\/settings\/account\/import$/);
        await expect(page.locator('#import-account-identifier')).toHaveValue(
          fixture.watchAddress
        );
        await expect(
          page.getByRole('button', { name: en.buttons.import, exact: true })
        ).toBeEnabled();
        await expect(
          page.getByText(en.settings.accountImported, { exact: true })
        ).toHaveCount(0);
        const refused = await projection(page);
        expect(refused).toEqual(before);
        const probe = await worker!.evaluate(() => {
          const value = (globalThis as any).__watchImportStorageProbe;
          return { failures: value.failures, attempts: value.attempts };
        });
        expect(probe).toEqual({ failures: 1, attempts: 1 });
        observations.refused = { state: refused, probe };
      }
    );

    await wallet.step(
      'retry the same form and acknowledge the durably accepted watch account',
      async () => {
        const retry = page.getByRole('button', {
          name: en.buttons.import,
          exact: true,
        });
        if (width === 320) {
          for (
            let count = 0;
            count < 48 &&
            !(await retry.evaluate((node) => node === document.activeElement));
            count++
          )
            await page.keyboard.press('Tab');
          await expect(retry).toBeFocused();
          await page.keyboard.press('Enter');
        } else {
          await retry.click();
        }
        await expect(
          page.getByText(en.settings.accountImported, { exact: true })
        ).toBeVisible();
        const imported = await projection(page);
        expect(imported.live).toMatchObject({
          label: LABEL,
          address: fixture.watchAddress,
          watchOnly: true,
        });
        expect(imported.saved).toEqual(imported.live);
        expect(imported.active).toEqual({
          id: imported.live!.id,
          type: 'Imported',
        });
        const probe = await worker!.evaluate(() => {
          const value = (globalThis as any).__watchImportStorageProbe;
          const result = { failures: value.failures, attempts: value.attempts };
          value.restore();
          return result;
        });
        expect(probe.failures).toBe(1);
        expect(probe.attempts).toBeGreaterThanOrEqual(2);
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        observations.imported = { state: imported, probe };
      }
    );

    await wallet.step(
      'restore the imported identity and selection in a fresh MV3 worker',
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
        const restored = await projection(page);
        expect(restored.live).toMatchObject({
          label: LABEL,
          address: fixture.watchAddress,
          watchOnly: true,
        });
        expect(restored.saved).toEqual(restored.live);
        expect(restored.active).toEqual({
          id: restored.live!.id,
          type: 'Imported',
        });
        observations.restored = restored;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('account-import-durability', {
      contentType: 'application/json',
      body: JSON.stringify({
        runtime: extensionEvidence(),
        sourceSha256: createHash('sha256')
          .update(fs.readFileSync(__filename))
          .digest('hex'),
        observations,
        simulated: true,
        controllerStateReplaced: false,
        deniedWrites: routes.deniedWrites,
        fixtureReads: routes.reads,
        proxyDeniedConnections: server.blocked.length,
      }),
    });
    status = 'passed';
  } finally {
    await worker
      ?.evaluate(() => (globalThis as any).__watchImportStorageProbe?.restore())
      .catch(() => undefined);
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
}

test('a refused watch import remains retryable and its accepted retry survives a cold worker', async ({}, info) => {
  await watchImportDurability(400, info);
});

test('a narrow watch import keeps its identifier clear of the refusal and permits keyboard retry', async ({}, info) => {
  await watchImportDurability(320, info);
});
