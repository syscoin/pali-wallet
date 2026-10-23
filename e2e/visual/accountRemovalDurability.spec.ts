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

const LABEL = 'Removal durability watch account';
const FAILURE = 'Synthetic account removal storage refusal';

async function accountProjection(page: Page) {
  return page.evaluate(async (label) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get(storageKey);
    const publicAccount = (accounts: any) => {
      const account: any = Object.values(accounts?.Imported || {}).find(
        (entry: any) => entry.label === label
      );
      return account
        ? {
            id: account.id,
            address: account.address,
            label: account.label,
            watchOnly: account.isImported === true && !account.xprv,
          }
        : null;
    };
    return {
      active: state.vault.activeAccount,
      chainId: state.vault.activeNetwork.chainId,
      kind: state.vault.activeNetwork.kind,
      slip44: state.vaultGlobal.activeSlip44,
      switching: state.vaultGlobal.isSwitchingAccount,
      live: publicAccount(state.vault.accounts),
      saved: publicAccount(saved[storageKey]?.accounts),
    };
  }, LABEL);
}

async function installRemovalFailure(
  worker: Worker,
  accountId: number,
  slip44: number
) {
  await worker.evaluate(
    ({ targetId, storageKey, message }) => {
      const local = chrome.storage.local;
      const originalSet = local.set;
      const probe = {
        armed: true,
        failures: 0,
        attempts: 0,
        restore: () => {
          local.set = originalSet;
          delete (globalThis as any).__accountRemovalStorageProbe;
        },
      };
      (globalThis as any).__accountRemovalStorageProbe = probe;
      local.set = ((items: Record<string, any>, ...args: any[]) => {
        const vault = items[storageKey];
        // Refuse only the real combined removal commit for this exact account.
        // Ordinary polling, onboarding and repair writes keep their real API.
        if (
          items.state &&
          vault?.accounts?.Imported &&
          !Object.prototype.hasOwnProperty.call(
            vault.accounts.Imported,
            targetId
          )
        ) {
          probe.attempts += 1;
          if (probe.armed) {
            probe.armed = false;
            probe.failures += 1;
            // The real storage adapter's Promise executor propagates this
            // synchronous API failure without replacing controller results.
            throw new Error(message);
          }
        }
        return (originalSet as any).call(local, items, ...args);
      }) as typeof local.set;
    },
    {
      targetId: accountId,
      storageKey: `state-vault-${slip44}`,
      message: FAILURE,
    }
  );
}

test('account removal preserves a refused commit and a retry survives a cold worker', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountRemovalSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('account-removal-durability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    await wallet.step('import a disposable public watch account', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet!.gotoRoute('#/settings/account/import');
      await page.locator('#account-name-input').fill(LABEL);
      await page.locator('#import-account-watch-only').check();
      await page
        .locator('#import-account-identifier')
        .fill(fixture.watchAddress);
      await page
        .getByRole('button', { name: en.buttons.import, exact: true })
        .click();
      await expect(
        page.getByText(en.settings.accountImported, { exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await wallet!.ensureOnHome();
      await expect
        .poll(async () => (await accountProjection(page)).saved)
        .toMatchObject({
          label: LABEL,
          address: fixture.watchAddress,
          watchOnly: true,
        });
      await page.locator('#general-settings-button').click();
      await page
        .locator('#account-HDAccount-0')
        .getByRole('menuitem')
        .first()
        .click();
      await expect
        .poll(async () => {
          const state = await accountProjection(page);
          return { active: state.active, switching: state.switching };
        })
        .toEqual({ active: { id: 0, type: 'HDAccount' }, switching: false });
      await wallet!.ensureOnHome();
    });

    const before = await accountProjection(page);
    expect(before.live).toEqual(before.saved);
    expect(before.live?.watchOnly).toBe(true);
    expect(before.kind).toBe('syscoin');
    expect(before.slip44).toBe(1);
    observations.before = before;
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await installRemovalFailure(worker!, before.live!.id, before.slip44);

    await wallet.step(
      'a refused removal retains the account and reports failure',
      async () => {
        await wallet!.gotoRoute('#/settings/manage-accounts');
        await page
          .getByRole('button', {
            name: `${en.buttons.remove}: ${LABEL} (${fixture.watchAddress})`,
            exact: true,
          })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: en.buttons.remove,
            exact: true,
          })
          .click();
        await expect(page.getByText(FAILURE, { exact: true })).toBeVisible();
        const afterFailure = await accountProjection(page);
        expect(afterFailure.live).toEqual(before.live);
        expect(afterFailure.saved).toEqual(before.saved);
        expect(afterFailure.active).toEqual(before.active);
        await expect(page.getByRole('dialog')).toBeVisible();
        const refusal = await worker!.evaluate(() => {
          const probe = (globalThis as any).__accountRemovalStorageProbe;
          return { failures: probe.failures, attempts: probe.attempts };
        });
        expect(refusal).toEqual({ failures: 1, attempts: 1 });
        observations.refusal = { ...refusal, state: afterFailure };
      }
    );

    await wallet.step(
      'retry commits the removal through the same confirmation',
      async () => {
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: en.buttons.remove,
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(
          page.getByText(en.settings.accountRemovedSuccessfully, {
            exact: true,
          })
        ).toBeVisible();
        await expect
          .poll(async () => {
            const state = await accountProjection(page);
            return { live: state.live, saved: state.saved };
          })
          .toEqual({ live: null, saved: null });
        await expect(
          page.getByRole('button', {
            name: `${en.buttons.remove}: ${LABEL} (${fixture.watchAddress})`,
            exact: true,
          })
        ).toHaveCount(0);
        const retry = await worker!.evaluate(() => {
          const probe = (globalThis as any).__accountRemovalStorageProbe;
          const result = { failures: probe.failures, attempts: probe.attempts };
          probe.restore();
          return result;
        });
        expect(retry).toEqual({ failures: 1, attempts: 2 });
        observations.retry = retry;
      }
    );

    await wallet.step(
      'a fresh background worker restores the durable removal',
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
        const restored = await accountProjection(page);
        expect(restored.live).toBeNull();
        expect(restored.saved).toBeNull();
        expect(restored.active).toEqual(before.active);
        await wallet!.gotoRoute('#/settings/manage-accounts');
        await expect(
          page.getByRole('button', {
            name: `${en.buttons.remove}: ${LABEL} (${fixture.watchAddress})`,
            exact: true,
          })
        ).toHaveCount(0);
        observations.restored = restored;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('account-removal-durability', {
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
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await worker
      ?.evaluate(() =>
        (globalThis as any).__accountRemovalStorageProbe?.restore()
      )
      .catch(() => undefined);
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
