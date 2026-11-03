import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import ledgerEn from '../../source/scripts/ledger/locales/en.json';
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
  let device: Page | undefined;
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
        importResults: [] as { failed: boolean }[],
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
        ) {
          evidence.importMethods.push([...request.data.methods]);
          const callback = args.at(-1);
          if (typeof callback === 'function')
            args[args.length - 1] = (...replies: any[]) => {
              const response = replies[0];
              evidence.importResults.push({
                failed: Boolean(
                  response &&
                    (response.error ||
                      (response.success === false &&
                        Object.prototype.hasOwnProperty.call(
                          response,
                          'error'
                        )))
                ),
              });
              return callback(...replies);
            };
        }
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

    const accountSnapshot = () =>
      wallet!.page.evaluate(async () => {
        const state: any = await new Promise((resolve) =>
          chrome.runtime.sendMessage({ type: 'getCurrentState' }, resolve)
        );
        const stored: Record<string, any> = await new Promise((resolve) =>
          chrome.storage.local.get(null, resolve)
        );
        const ledger = (value: any) => {
          const accounts = value?.vault?.accounts || value?.accounts;
          return accounts?.Ledger ? Object.keys(accounts.Ledger).sort() : null;
        };
        return {
          live: ledger(state),
          durable: Object.fromEntries(
            Object.entries(stored)
              .filter(
                ([key]) => key === 'state' || /^state-vault-\d+$/.test(key)
              )
              .map(([key, value]) => [key, ledger(value)])
              .sort(([a], [b]) => String(a).localeCompare(String(b)))
          ),
        };
      });
    const originalAccounts = await accountSnapshot();
    expect(originalAccounts.live).toEqual([]);
    expect(Object.values(originalAccounts.durable)).toContainEqual([]);
    observations.originalAccounts = originalAccounts;

    let imports = 0;
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await wallet.step(
        `cancel and retry the dedicated Ledger chooser at ${viewport.width}px`,
        async (capture) => {
          try {
            await hardware!.setViewportSize(viewport);
            // Import admission now belongs to the real background controller.
            // The owned device page, rather than this setup page, opens WebHID.
            if (imports > 0) await hardware!.locator('#ledger-btn').click();
            const opened = wallet!.context.waitForEvent('page');
            await hardware!.locator('#connect-btn').click();
            imports += 1;
            device = await opened;
            await device.setViewportSize(viewport);
            await expect(device).toHaveURL(/\/ledger\.html#[0-9a-f]{48}$/);
            const connect = device.locator('#connect');
            await expect(connect).toBeEnabled();
            await expect(hardware!.locator('#connect-btn')).toBeDisabled();
            let chooserCount = 0;
            for (const boundaryError of [false, false, true]) {
              await device.evaluate((fail) => {
                (window as any).__hardwareChooserForceError = fail;
              }, boundaryError);
              await connect.scrollIntoViewIfNeeded();
              await connect.click();
              chooserCount += 1;
              // Await the actual device-page error, not the initiating request.
              await expect(device.locator('#status')).toHaveText(
                ledgerEn.ledgerHost.connectFailed
              );
              await expect(connect).toBeEnabled();
              const evidence = await device.evaluate(
                () => (window as any).__hardwareChooserCancellation
              );
              expect(evidence.chooserFilters).toHaveLength(chooserCount);
              expect(evidence.chooserFilters.at(-1)).toEqual({
                filters: [{ vendorId: 0x2c97 }],
              });
              expect(evidence.importMethods).toEqual([]);
              await expect(device.locator('#review')).toBeHidden();
              expect(await accountSnapshot()).toEqual(originalAccounts);
              observations[`chooser-${viewport.width}-${chooserCount}`] =
                evidence;
            }
            await capture(device);
            // Closing the owned host must settle the original controller call
            // as an error and leave both live and durable account maps intact.
            await device.close();
            device = undefined;
            await expect
              .poll(() =>
                hardware!.evaluate(
                  () =>
                    (window as any).__hardwareChooserCancellation.importResults
                )
              )
              .toEqual(
                Array.from({ length: imports }, () => ({ failed: true }))
              );
            const evidence = await hardware!.evaluate(
              () => (window as any).__hardwareChooserCancellation
            );
            expect(evidence.importMethods).toEqual(
              Array.from({ length: imports }, () => [
                'wallet',
                'importLedgerAccountFromController',
              ])
            );
            expect(evidence.chooserFilters).toEqual([]);
            observations[`controller-${viewport.width}`] = evidence;
            expect(await accountSnapshot()).toEqual(originalAccounts);
            await expect(hardware!.getByRole('dialog')).toHaveCount(0);
            await expect(
              hardware!.getByText(en.settings.walletSelected, { exact: true })
            ).toHaveCount(0);
            await expect(hardware!.locator('#ledger-btn')).toBeVisible();
            await expect(
              hardware!.getByText(en.settings.errorCreatingHardWallet, {
                exact: true,
              })
            ).toBeVisible();
            const cancel = hardware!.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            });
            await expect(cancel).toBeEnabled();
            await cancel.scrollIntoViewIfNeeded();
            await expect
              .poll(() =>
                cancel.evaluate((element, errorText) => {
                  const rect = element.getBoundingClientRect();
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
                      !!hit && (element === hit || element.contains(hit)),
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
                }, en.settings.errorCreatingHardWallet)
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
            // Let the real notification finish before the next operation.
            // The generic harness screenshot fast-forwards finite animations,
            // which would otherwise skip the UI's duplicate-message interval.
            await expect(
              hardware!.getByText(en.settings.errorCreatingHardWallet, {
                exact: true,
              })
            ).toHaveCount(0, { timeout: 10000 });
          } finally {
            if (device && !device.isClosed()) await device.close();
            device = undefined;
            if (hardware && !hardware.isClosed()) await capture(hardware);
          }
        }
      );
    }

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
      if (device && !device.isClosed()) await device.close();
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
