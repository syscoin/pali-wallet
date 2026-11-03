import {
  expect,
  test,
  type Page,
  type TestInfo,
  type Worker,
} from '@playwright/test';
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

async function exerciseAccountRemoval(
  width: 320 | 400,
  info: TestInfo,
  activation: 'pointer' | 'keyboard' = 'pointer'
) {
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
    wallet = await PaliWallet.launch(
      width === 400
        ? 'account-removal-durability'
        : `account-removal-durability-320-${activation}`,
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
        const dialog = page.getByRole('dialog');
        const remove = dialog.getByRole('button', {
          name: en.buttons.remove,
          exact: true,
        });
        if (activation === 'keyboard') {
          await remove.focus();
          await expect(remove).toBeFocused();
          await page.keyboard.press('Enter');
        } else {
          await remove.click();
        }
        await expect(page.getByText(FAILURE, { exact: true })).toBeVisible();
        if (width === 320) {
          const inlineError = dialog.getByRole('alert');
          await expect(inlineError).toHaveText(FAILURE);
          const immediate = await inlineError.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const body = node.parentElement!.getBoundingClientRect();
            const footer = node
              .closest('[role=dialog]')!
              .querySelector('footer')!
              .getBoundingClientRect();
            return {
              top: box.top,
              bottom: box.bottom,
              bodyTop: body.top,
              bodyBottom: body.bottom,
              footerTop: footer.top,
              viewportTop: 0,
              viewportBottom: innerHeight,
            };
          });
          expect(immediate.top).toBeGreaterThanOrEqual(
            Math.max(immediate.bodyTop, immediate.viewportTop) - 1
          );
          expect(immediate.bottom).toBeLessThanOrEqual(
            Math.min(
              immediate.bodyBottom,
              immediate.footerTop,
              immediate.viewportBottom
            ) + 1
          );
          expect(
            await dialog.evaluate((node) =>
              node.contains(document.activeElement)
            )
          ).toBe(true);
          observations.immediateInlineError = immediate;
          await info.attach('removal-inline-initial-320', {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          const body = inlineError.locator('..');
          const bodyBox = await body.boundingBox();
          if (!bodyBox) throw new Error('Missing dialog body');
          await page.mouse.move(
            bodyBox.x + bodyBox.width / 2,
            bodyBox.y + bodyBox.height / 2
          );
          for (let attempt = 0; attempt < 30; attempt++) {
            if (await body.evaluate((node) => node.scrollTop <= 1)) break;
            await page.mouse.wheel(0, -300);
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
            );
          }
          expect(
            await body.evaluate((node) => node.scrollTop)
          ).toBeLessThanOrEqual(1);
          const question = dialog.locator('p').first();
          await expect(question).toContainText(LABEL);
          const reached = new Set<number>();
          let lineCount = 0;
          for (let attempt = 0; attempt < 30; attempt++) {
            const sample = await question.evaluate((node) => {
              const bodyClip = node.parentElement!.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(node);
              const rects = Array.from(range.getClientRects()).filter(
                (r) => r.width > 0 && r.height > 0
              );
              return {
                count: rects.length,
                visible: rects.flatMap((r, i) =>
                  r.top >= Math.max(bodyClip.top, 0) - 1 &&
                  r.bottom <= Math.min(bodyClip.bottom, innerHeight) + 1
                    ? [i]
                    : []
                ),
              };
            });
            lineCount = sample.count;
            sample.visible.forEach((i) => reached.add(i));
            if (lineCount > 0 && reached.size === lineCount) break;
            const box = await body.boundingBox();
            if (!box) throw new Error('Missing dialog body');
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2
            );
            await page.mouse.wheel(0, 60);
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
            );
          }
          expect(lineCount).toBeGreaterThan(0);
          expect(reached.size).toBe(lineCount);
          observations.questionReachability = {
            lineCount,
            reached: reached.size,
          };
        }
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
        const retryButton = page.getByRole('dialog').getByRole('button', {
          name: en.buttons.remove,
          exact: true,
        });
        if (activation === 'keyboard') {
          for (let attempt = 0; attempt < 12; attempt++) {
            if (
              await retryButton.evaluate(
                (node) => document.activeElement === node
              )
            )
              break;
            await page.keyboard.press('Tab');
          }
          await expect(retryButton).toBeFocused();
          await page.keyboard.press('Enter');
        } else {
          await retryButton.click();
        }
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
}

test('account removal preserves a refused commit and a retry survives a cold worker', async ({}, info) => {
  await exerciseAccountRemoval(400, info);
});

test('narrow account removal reveals its refusal and retains the question and retry', async ({}, info) => {
  await exerciseAccountRemoval(320, info);
});

test('narrow account removal remains reachable after keyboard refusal', async ({}, info) => {
  await exerciseAccountRemoval(320, info, 'keyboard');
});
