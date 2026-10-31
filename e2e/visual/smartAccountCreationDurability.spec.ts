import { expect, test, type Page, type Worker } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

const LABEL = 'Durable smart savings';
const FAILURE = 'Synthetic creation persistence refusal';

const publicAccounts = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const records = await chrome.storage.local.get('state-vault-60');
    const accounts = (vault: any) =>
      Object.values(vault.accounts.SmartAccount).map((account: any) => ({
        id: account.id,
        address: account.address,
        label: account.label,
        chainId: account.smartAccount.chainId,
        accountIndex: account.smartAccount.descriptor.accountIndex,
        deploymentSalt: account.smartAccount.deploymentSalt,
        factoryAddress: account.smartAccount.factoryAddress,
      }));
    return {
      live: accounts(state.vault),
      saved: accounts(records['state-vault-60']),
      active: state.vault.activeAccount,
      savedActive: records['state-vault-60'].activeAccount,
      chainId: state.vault.activeNetwork.chainId,
    };
  });

test('a refused smart-account creation retries the same descriptor and survives a cold worker', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const fixture = createVisualFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'SmartCreationDurabilitySynthetic!2026',
    rpcUrl: server.url,
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
  });
  let wallet: PaliWallet | undefined;
  let worker: Worker | undefined;
  let routes:
    | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('smart-account-creation-durability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installVisualFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    const nameInput = page.locator('input#account-name-input');
    const createSmart = page.getByRole('button', {
      name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
    });
    await wallet.step(
      'open ordinary smart-account creation behind the read-only network fence',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await wallet!.ensureOnHome();
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', {
            name: en.accountMenu.createNewAccount,
            exact: true,
          })
          .click();
        await expect(nameInput).toBeVisible();
        await nameInput.fill(LABEL);
        await expect(createSmart).toBeEnabled();
      }
    );
    const before = await publicAccounts(page);
    expect(before).toMatchObject({
      live: [],
      saved: [],
      chainId: VISUAL_FIXTURE_CHAIN_ID,
    });
    expect(before.active).toEqual(before.savedActive);
    observations.before = before;
    worker = wallet.context
      .serviceWorkers()
      .find((candidate) =>
        candidate.url().startsWith(`chrome-extension://${wallet!.extensionId}/`)
      );
    expect(worker).toBeDefined();
    await worker!.evaluate(
      ({ address, failure }) => {
        const local = chrome.storage.local;
        const original = local.set;
        const probe = {
          failures: 0,
          attempts: 0,
          restore: () => {
            local.set = original;
            delete (globalThis as any).__smartCreationStorage;
          },
        };
        (globalThis as any).__smartCreationStorage = probe;
        local.set = ((items: Record<string, any>, ...args: any[]) => {
          const account = items['state-vault-60']?.accounts?.SmartAccount?.[0];
          if (account?.address?.toLowerCase() === address.toLowerCase()) {
            probe.attempts += 1;
            if (!probe.failures) {
              probe.failures += 1;
              // Fail only the matching native vault write, not the controller,
              // allocator, factory reads, Redux or response delivery.
              throw new Error(failure);
            }
          }
          return (original as any).call(local, items, ...args);
        }) as typeof local.set;
      },
      { address: fixture.smartAccountAddress, failure: FAILURE }
    );
    await wallet.step(
      'refuse the first vault write without exposing a new account or selection',
      async () => {
        await createSmart.click();
        const error = page
          .locator('[data-page-action-footer]')
          .getByRole('alert');
        await expect(error).toHaveText(FAILURE);
        await expect(error).toBeInViewport();
        await expect(createSmart).toBeEnabled();
        await expect(nameInput).toHaveValue(LABEL);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await publicAccounts(page)).toEqual(before);
        observations.refused = await publicAccounts(page);
        expect(
          await worker!.evaluate(
            () => (globalThis as any).__smartCreationStorage.failures
          )
        ).toBe(1);
      }
    );
    await wallet.step(
      'retry the same UI action and persist the intended first descriptor',
      async () => {
        await createSmart.click();
        const dialog = page
          .getByRole('dialog')
          .filter({ hasText: en.settings.yourNewAccount });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByText(fixture.smartAccountAddress, { exact: true })
        ).toBeVisible();
        const expected = {
          id: 0,
          address: fixture.smartAccountAddress,
          label: LABEL,
          chainId: VISUAL_FIXTURE_CHAIN_ID,
          accountIndex: 0,
          deploymentSalt: fixture.deploymentSalt,
          factoryAddress: fixture.factory.address,
        };
        await expect
          .poll(() => publicAccounts(page))
          .toEqual({
            live: [expected],
            saved: [expected],
            active: { id: 0, type: 'SmartAccount' },
            savedActive: { id: 0, type: 'SmartAccount' },
            chainId: VISUAL_FIXTURE_CHAIN_ID,
          });
        observations.accepted = await publicAccounts(page);
        observations.storage = await worker!.evaluate(() => {
          const probe = (globalThis as any).__smartCreationStorage;
          const result = { failures: probe.failures, attempts: probe.attempts };
          probe.restore();
          return result;
        });
        expect(observations.storage).toMatchObject({ failures: 1 });
        expect(
          (observations.storage as { attempts: number }).attempts
        ).toBeGreaterThanOrEqual(2);
        await dialog.locator('#account-created-ok-btn').click();
        await expect(dialog).toHaveCount(0);
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'restore the same accepted smart account after a genuine worker restart',
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
        expect(await publicAccounts(page)).toEqual(observations.accepted);
        await page.locator('#general-settings-button').click();
        const accountRow = page.locator('#account-SmartAccount-0');
        await expect(accountRow).toBeVisible();
        await expect(accountRow).toContainText(LABEL);
        observations.restored = await publicAccounts(page);
        const menuBadge = accountRow.getByText(en.smartAccountHub.badge, {
          exact: true,
        });
        for (const width of [400, 320]) {
          await page.setViewportSize({
            width,
            height: width === 400 ? 620 : 360,
          });
          const contrast = await captureForegroundContrast(
            menuBadge,
            info,
            `smart-account-menu-badge-${width}`
          );
          expect(contrast.disabled).toBe(false);
        }
        await page
          .getByRole('menuitem', {
            name: en.accountMenu.manageAccounts,
            exact: true,
          })
          .click();
        const managerBadge = page
          .locator('ul[data-navigation-scroll="settings-manage-accounts"]')
          .getByText(en.receive.smartAccount, { exact: true });
        for (const width of [400, 320]) {
          await page.setViewportSize({
            width,
            height: width === 400 ? 620 : 360,
          });
          const contrast = await captureForegroundContrast(
            managerBadge,
            info,
            `smart-account-manager-badge-${width}`
          );
          expect(contrast.disabled).toBe(false);
        }
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('smart-account-creation-durability-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: extensionEvidence(),
          observations,
          reads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
        }),
      });
    } finally {
      await worker
        ?.evaluate(() => (globalThis as any).__smartCreationStorage?.restore())
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
