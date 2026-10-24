import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// The generated phrase is deliberately confined to this disposable document.
// Neither DOM traces nor video nor screenshots are permitted while it is shown.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const PASSWORD = 'LockedResetSyntheticOnly!2026';
const NEW_PASSWORD = 'NewLockedResetSyntheticOnly!2026';
const beforeOnly = process.env.PALI_RESET_BEFORE === '1';
const viewports = [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
];

async function publicState(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const unlocked = await chrome.runtime.sendMessage({
      type: 'CONTROLLER_ACTION',
      data: { methods: ['wallet', 'isUnlocked'], params: [] },
    });
    if (typeof unlocked !== 'boolean')
      throw new Error('Expected boolean lock state');
    const active = state.vault.activeAccount;
    const account = state.vault.accounts[active.type]?.[active.id];
    return {
      hasVault: state.vaultGlobal.hasEncryptedVault === true,
      unlocked,
      active: {
        id: active.id,
        type: active.type,
        address: account?.address ?? null,
      },
      grants: Object.keys(state.dapp?.dapps || {}),
    };
  });
}

async function screenshot(page: Page, info: TestInfo, label: string) {
  // Callers must only invoke this on the lock screen or reset warning.
  expect(page.url()).not.toContain('#/phrase');
  expect(await page.locator('button.min-w-xs').count()).toBe(0);
  for (const field of await page
    .locator('input[type="password"], textarea')
    .all()) {
    expect(
      await field.evaluate(
        (element) => (element as HTMLInputElement).value.length === 0
      )
    ).toBe(true);
  }
  const file = info.outputPath(`${label}.png`);
  await page.screenshot({
    path: file,
    animations: 'disabled',
  });
  await info.attach(label, { path: file, contentType: 'image/png' });
}

async function reachable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  expect(box!.width).toBeGreaterThanOrEqual(40);
  expect(
    await locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      return !!hit && element.contains(hit);
    })
  ).toBe(true);
  return box;
}

test('locked wallet can explicitly erase and create a different wallet without its old password', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  if (process.env.PALI_RESET_EXPECTED_VERSION) {
    expect(runtime.version).toBe(process.env.PALI_RESET_EXPECTED_VERSION);
  }
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: PASSWORD,
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let pageErrorCount = 0;
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch(
      `locked-wallet-reset-${beforeOnly ? 'before' : 'after'}`,
      {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: viewports[0],
      }
    );
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    page.on('pageerror', () => {
      pageErrorCount += 1;
    });
    const locked = async () => {
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.locator('#login #password')).toBeVisible();
      await expect(page.locator('#unlock-btn')).toBeEnabled();
      expect((await publicState(page)).unlocked).toBe(false);
    };
    const lock = async () => {
      await wallet!.ensureOnHome();
      await page.locator('#general-settings-button').click();
      await page.getByText(en.generalMenu.lock, { exact: true }).click();
      await locked();
    };
    await wallet.step(
      'import disposable synthetic wallet and verify healthy password control',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        observations.original = await publicState(page);
        expect(
          (observations.original as any).active.address.toLowerCase()
        ).toBe(fixture.evmAddresses[0].toLowerCase());
        await lock();
        await page
          .locator('#login #password')
          .fill('WrongLockedResetSyntheticOnly!2026');
        await page.locator('#unlock-btn').click();
        await expect(
          page.locator('#login').getByText('Invalid password', { exact: true })
        ).toBeVisible();
        expect(await publicState(page)).toEqual({
          ...(observations.original as any),
          unlocked: false,
        });
        await page.locator('#login #password').fill(PASSWORD);
        await page.locator('#unlock-btn').click();
        await expect(page).toHaveURL(/#\/home$/, { timeout: 30000 });
        await wallet!.ensureOnHome();
        expect(await publicState(page)).toEqual(observations.original);
        await lock();
        await page.locator('#login #password').fill('');
      }
    );
    await wallet.step(
      'capture matching ordinary locked screens before entering reset',
      async () => {
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await locked();
          if (beforeOnly)
            await expect(page.locator('#erase-wallet-link')).toHaveCount(0);
          else await expect(page.locator('#erase-wallet-link')).toBeVisible();
          await screenshot(
            page,
            info,
            `locked-${beforeOnly ? 'before' : 'after'}-${viewport.width}x${
              viewport.height
            }`
          );
        }
      }
    );
    if (!beforeOnly) {
      await wallet.step(
        'Cancel and fresh reopening preserve the original locked wallet',
        async () => {
          for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            await page.locator('#erase-wallet-link').click();
            const dialog = page.getByRole('dialog', {
              name: en.start.eraseConfirm,
              exact: true,
            });
            await expect(dialog).toBeVisible();
            const cancel = dialog.locator('#cancel-erase-wallet');
            const confirm = dialog.locator('#confirm-erase-wallet');
            await expect(cancel).toBeFocused();
            await expect(confirm).toBeDisabled();
            await expect(dialog.getByRole('checkbox')).not.toBeChecked();
            await expect(dialog.getByRole('textbox')).toHaveValue('');
            await expect(page.locator('#login #password')).toBeDisabled();
            await expect(page.locator('#unlock-btn')).toBeDisabled();
            await expect(page.locator('#import-wallet-link')).toBeDisabled();
            await reachable(cancel);
            const confirmBox = await reachable(confirm);
            expect(confirmBox!.height).toBeGreaterThanOrEqual(44);
            expect(
              await dialog.evaluate((element) => {
                const box = element.getBoundingClientRect();
                return (
                  box.left >= 0 &&
                  box.right <= innerWidth &&
                  document.documentElement.scrollWidth <= innerWidth
                );
              })
            ).toBe(true);
            await screenshot(
              page,
              info,
              `reset-warning-${viewport.width}x${viewport.height}`
            );
            await dialog.getByRole('checkbox').check();
            await expect(confirm).toBeDisabled();
            await dialog.getByRole('textbox').fill('erase');
            await expect(confirm).toBeDisabled();
            await dialog.getByRole('textbox').fill('ERASE');
            await expect(confirm).toBeEnabled();
            await cancel.click();
            await expect(dialog).toHaveCount(0);
            await expect(page.locator('#erase-wallet-link')).toBeFocused();
            expect(await publicState(page)).toEqual({
              ...(observations.original as any),
              unlocked: false,
            });
          }
        }
      );
      await wallet.step(
        'explicit acknowledgement and ERASE return through real bootstrap',
        async () => {
          await page.setViewportSize(viewports[0]);
          await page.locator('#erase-wallet-link').click();
          const dialog = page.getByRole('dialog', {
            name: en.start.eraseConfirm,
            exact: true,
          });
          await expect(dialog.getByRole('checkbox')).not.toBeChecked();
          await expect(dialog.getByRole('textbox')).toHaveValue('');
          await dialog.getByRole('checkbox').check();
          await dialog.getByRole('textbox').fill('ERASE');
          // A random document token proves a real reload, without installing a
          // controller shim or using a navigation helper to manufacture success.
          await page.evaluate(() => {
            (window as any).__resetDocumentProbe = true;
          });
          await dialog.locator('#confirm-erase-wallet').click();
          await page.waitForFunction(
            () => !(window as any).__resetDocumentProbe
          );
          await wallet!.waitAppReady();
          await expect(page.locator('#unlock-btn')).toHaveText(
            en.start.getStarted
          );
          await expect(page.locator('#login')).toHaveCount(0);
          await expect(page.locator('#erase-wallet-link')).toHaveCount(0);
          const empty = await publicState(page);
          expect(empty.hasVault).toBe(false);
          expect(empty.unlocked).toBe(false);
          expect(empty.active.address).toBeNull();
          expect(empty.grants).toEqual([]);
          observations.emptyAfterReload = empty;
        }
      );
      await wallet.step(
        'create a genuinely new seed privately through ordinary confirmation',
        async (capture) => {
          await page.locator('#unlock-btn').click();
          await page.locator('#create-password').fill(NEW_PASSWORD);
          await page.locator('#confirm-password').fill(NEW_PASSWORD);
          // Capture only the masked password view. step() retains this safe shot
          // on success AND failure; it must never auto-capture a phrase screen.
          await capture(page);
          await page.locator('#create-password-action').click();
          await expect(page).toHaveURL(/#\/phrase$/);
          await expect(page.getByRole('checkbox')).toBeEnabled();
          await page
            .getByRole('button', {
              name: en.import.showSeedPhrase,
              exact: true,
            })
            .click();
          await expect(page.locator('div.select-none > p')).toHaveCount(12);
          const count = await page.evaluate(() => {
            const words = Array.from(
              document.querySelectorAll('div.select-none > p')
            ).map((node) => node.textContent?.trim() || '');
            if (
              words.length !== 12 ||
              words.some((word) => !/^[a-z]+$/.test(word))
            )
              throw new Error('Fresh phrase was not ready');
            (window as any).__privateResetWords = words;
            return words.length;
          });
          expect(count).toBe(12);
          await page.getByRole('checkbox').check();
          await page.locator('#unlock-btn').click();
          await expect(page.locator('button.min-w-xs')).toHaveCount(12);
          // Only public pointer coordinates cross the page boundary; no mnemonic
          // word, selector containing a word, or secret is emitted to artifacts.
          for (let index = 0; index < count; index++) {
            const point = await page.evaluate((wordIndex) => {
              const word = (window as any).__privateResetWords[wordIndex];
              const candidate = Array.from(
                document.querySelectorAll<HTMLButtonElement>('button.min-w-xs')
              ).find(
                (button) =>
                  button.textContent?.trim() === word &&
                  button.classList.contains('bg-transparent')
              );
              if (!candidate)
                throw new Error('Expected unselected confirmation word');
              candidate.scrollIntoView({ block: 'center' });
              const box = candidate.getBoundingClientRect();
              return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            }, index);
            await page.mouse.click(point.x, point.y);
          }
          await page
            .getByRole('button', { name: en.buttons.validate, exact: true })
            .click();
          const ready = page.getByRole('dialog', {
            name: en.seedConfirm.yourWalletIsReady,
            exact: true,
          });
          await expect(ready).toBeVisible();
          await page.evaluate(() => {
            delete (window as any).__privateResetWords;
          });
          await ready.locator('#unlock-btn').click();
          await expect(page).toHaveURL(/#\/home$/, { timeout: 30_000 });
          // Subsequent healthy-control unlocks must use the newly created wallet.
          Object.assign(E2E_CONFIG, { password: NEW_PASSWORD });
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          const created = await publicState(page);
          expect(created.hasVault).toBe(true);
          expect(created.unlocked).toBe(true);
          expect(created.active.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
          expect(created.active.address).not.toBe(
            (observations.original as any).active.address
          );
          expect(created.grants).toEqual([]);
          observations.created = created;
        }
      );
      await wallet.step(
        'new wallet identity survives reload and healthy new-password unlock',
        async () => {
          await page.reload();
          await wallet!.waitAppReady();
          await wallet!.ensureOnHome();
          expect(await publicState(page)).toEqual(observations.created);
          await lock();
          await page.locator('#login #password').fill(NEW_PASSWORD);
          await page.locator('#unlock-btn').click();
          await expect(page).toHaveURL(/#\/home$/, { timeout: 30000 });
          await wallet!.ensureOnHome();
          expect(await publicState(page)).toEqual(observations.created);
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrorCount).toBe(0);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    try {
      await info.attach('locked-wallet-reset-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            runtime,
            status,
            beforeOnly,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            observations,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            pageErrorCount,
            normalUIOnly: true,
            controllerStateOrResultsReplaced: false,
            generatedMnemonicRemainsInDisposablePageOnly: true,
            tracesAndVideoDisabled: true,
            phraseScreenshotsCaptured: false,
            broadcastRequested: false,
          },
          null,
          2
        ),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
