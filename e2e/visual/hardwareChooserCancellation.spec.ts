import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// The chooser adapter returns the browser's no-device result. All controller
// messages and replies remain real and are only observed, never replaced.
test('cancelling the Ledger chooser never imports and leaves retry and close usable', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'HardwareChooserSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let hardware: Page | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {
    hardwareDeviceExercised: false,
    browserChooserResultAdapted: true,
    controllerStateReplaced: false,
    controllerRepliesReplaced: false,
    publicSyntheticOnly: true,
  };
  try {
    wallet = await PaliWallet.launch('hardware-chooser-cancellation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    observations.deniedWrites = routes.deniedWrites;
    observations.runtime = extensionEvidence();
    await wallet.step('import a disposable synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet!.ensureOnHome();
    });

    await wallet.context.addInitScript(() => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
      const evidence = {
        chooserFilters: [] as unknown[],
        importMethods: [] as string[][],
      };
      (window as any).__hardwareChooserCancellation = evidence;
      const hid = (navigator as any).hid || {};
      Object.defineProperty(hid, 'requestDevice', {
        configurable: true,
        value: async (options: unknown) => {
          evidence.chooserFilters.push(options);
          if ((window as any).__hardwareChooserForceError)
            throw new Error('synthetic boundary fault 0x5a6b');
          return [];
        },
      });
      Object.defineProperty(navigator, 'hid', {
        configurable: true,
        value: hid,
      });
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const request = args[0];
        if (
          request?.type === 'CONTROLLER_ACTION' &&
          request.data?.methods?.join('.') ===
            'wallet.importLedgerAccountFromController'
        )
          evidence.importMethods.push([...request.data.methods]);
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });

    await wallet.step(
      'open real hardware setup from the account menu',
      async (capture) => {
        try {
          await wallet!.page.locator('#general-settings-button').click();
          const opened = wallet!.context.waitForEvent('page');
          await wallet!.page
            .getByText(en.accountMenu.connectTrezor, { exact: true })
            .click();
          hardware = await opened;
          await expect(hardware.locator('#ledger-btn')).toBeVisible();
          await expect(hardware).toHaveURL(
            /\/external\/settings\/account\/hardware$/
          );
          await hardware.locator('#ledger-btn').click();
        } finally {
          if (hardware && !hardware.isClosed()) await capture(hardware);
        }
      }
    );

    let chooserCount = 0;
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await wallet.step(
        `cancel and retry without importing at ${viewport.width}px`,
        async (capture) => {
          try {
            await hardware!.setViewportSize(viewport);
            const connect = hardware!.locator('#connect-btn');
            for (let attempt = 0; attempt < 2; attempt += 1) {
              await expect(connect).toBeEnabled();
              await connect.scrollIntoViewIfNeeded();
              await connect.click();
              chooserCount += 1;
              // Observe completion or an actual import admission, rather than
              // mistaking a pre-await render for successful cancellation.
              await expect
                .poll(() =>
                  hardware!.evaluate((expected) => {
                    const evidence = (window as any)
                      .__hardwareChooserCancellation;
                    const button = document.querySelector(
                      '#connect-btn'
                    ) as HTMLButtonElement;
                    return (
                      evidence.importMethods.length > 0 ||
                      (evidence.chooserFilters.length === expected &&
                        !button.disabled)
                    );
                  }, chooserCount)
                )
                .toBe(true);
              const evidence = await hardware!.evaluate(
                () => (window as any).__hardwareChooserCancellation
              );
              observations[`chooser-${viewport.width}-${attempt}`] = evidence;
              expect(evidence.importMethods).toEqual([]);
              expect(evidence.chooserFilters).toHaveLength(chooserCount);
              expect(evidence.chooserFilters.at(-1)).toEqual({
                filters: [{ vendorId: 0x2c97 }],
              });
              await expect(connect).toBeEnabled();
              await expect(connect).not.toHaveAttribute('aria-busy', 'true');
              await expect(
                hardware!.getByText(en.settings.walletSelected, {
                  exact: true,
                })
              ).toHaveCount(0);
              await expect(hardware!.getByRole('dialog')).toHaveCount(0);
            }
            const cancel = hardware!.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            });
            await expect(cancel).toBeEnabled();
            await cancel.scrollIntoViewIfNeeded();
            const reachable = await cancel.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2
              );
              return (
                rect.top >= 0 &&
                rect.bottom <= innerHeight &&
                rect.left >= 0 &&
                rect.right <= innerWidth &&
                !!hit &&
                (element === hit || element.contains(hit))
              );
            });
            expect(reachable).toBe(true);
          } finally {
            if (hardware && !hardware.isClosed()) await capture(hardware);
          }
        }
      );
    }

    await wallet.step(
      'live connection error leaves Cancel reachable at both viewports',
      async () => {
        // Exercise the ordinary browser boundary; no toast timer is held or
        // modified, and no controller result or wallet state is replaced.
        await hardware!.evaluate(() => {
          (window as any).__hardwareChooserForceError = true;
        });
        for (const viewport of [
          { width: 320, height: 360 },
          { width: 400, height: 620 },
        ]) {
          await hardware!.setViewportSize(viewport);
          const connect = hardware!.locator('#connect-btn');
          await expect(connect).toBeEnabled();
          await connect.scrollIntoViewIfNeeded();
          await connect.click();
          chooserCount += 1;
          const error = hardware!.getByText(
            en.settings.errorCreatingHardWallet,
            {
              exact: true,
            }
          );
          await expect(error).toBeVisible();
          const cancel = hardware!.getByRole('button', {
            name: en.buttons.cancel,
            exact: true,
          });
          await expect(cancel).toBeEnabled();
          await cancel.scrollIntoViewIfNeeded();
          const inspectCancel = () =>
            cancel.evaluate((button, errorText) => {
              const rect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2
              );
              const toast = Array.from(
                document.querySelectorAll('.Toastify__toast')
              ).find((node) => node.textContent?.includes(errorText));
              const bounds = toast?.getBoundingClientRect();
              const style = toast ? getComputedStyle(toast) : undefined;
              return {
                cancelInViewport:
                  rect.top >= 0 &&
                  rect.bottom <= innerHeight &&
                  rect.left >= 0 &&
                  rect.right <= innerWidth,
                cancelReceivesCenter:
                  !!hit && (hit === button || button.contains(hit)),
                toastVisible:
                  !!toast &&
                  !!bounds &&
                  bounds.width > 0 &&
                  bounds.height > 0 &&
                  style?.display !== 'none' &&
                  style?.visibility !== 'hidden' &&
                  Number(style?.opacity) > 0,
                toastInViewport:
                  !!bounds &&
                  bounds.top >= 0 &&
                  bounds.bottom <= innerHeight &&
                  bounds.left >= 0 &&
                  bounds.right <= innerWidth,
              };
            }, en.settings.errorCreatingHardWallet);
          await expect
            .poll(
              async () => {
                const proof = await inspectCancel();
                observations[`error-cancel-${viewport.width}`] = proof;
                return proof;
              },
              { timeout: 1500 }
            )
            .toEqual({
              cancelInViewport: true,
              cancelReceivesCenter: true,
              toastVisible: true,
              toastInViewport: true,
            });
          await info.attach(`hardware-error-cancel-${viewport.width}`, {
            body: await hardware!.screenshot({ animations: 'allow' }),
            contentType: 'image/png',
          });
          const evidence = await hardware!.evaluate(
            () => (window as any).__hardwareChooserCancellation
          );
          expect(evidence.importMethods).toEqual([]);
          expect(evidence.chooserFilters).toHaveLength(chooserCount);
          expect(evidence.chooserFilters.at(-1)).toEqual({
            filters: [{ vendorId: 0x2c97 }],
          });
          await expect(error).toHaveCount(0, { timeout: 10000 });
          await expect(hardware!.locator('#ledger-btn')).toBeVisible();
          await hardware!.locator('#ledger-btn').click();
        }
      }
    );

    await wallet.step(
      'close idle hardware setup and keep the wallet usable',
      async (capture) => {
        await capture(hardware!);
        const cancel = hardware!.getByRole('button', {
          name: en.buttons.cancel,
          exact: true,
        });
        await Promise.all([
          hardware!.waitForEvent('close'),
          clickClosingPopup({
            click: () => cancel.click(),
            isClosed: () => hardware!.isClosed(),
          }),
        ]);
        expect(wallet!.page.isClosed()).toBe(false);
        await wallet!.ensureOnHome();
        await expect(
          wallet!.page.locator('#home-balance, #home-balance-pending').first()
        ).toBeVisible();
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    observations.deniedWrites = routes.deniedWrites;
    observations.proxyDeniedConnections = server.blocked.length;
    status = 'passed';
  } finally {
    try {
      observations.proxyDeniedConnections = server.blocked.length;
      const evidencePath = info.outputPath('hardware-chooser-evidence.json');
      fs.writeFileSync(evidencePath, JSON.stringify(observations, null, 2));
      await info.attach('hardware-chooser-evidence', {
        path: evidencePath,
        contentType: 'application/json',
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, before);
        }
      }
    }
  }
});
