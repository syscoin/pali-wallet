import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('module request structural validation rejects malformed fields without opening approvals', async ({}, info) => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ModuleShapeSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const errors: string[] = [];
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('module-request-structural-validation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => errors.push(error.message))
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await wallet.ensureOnHome();
    const selection = () =>
      wallet!.page.evaluate(async () => {
        const state = await chrome.runtime.sendMessage({
          type: 'getCurrentState',
        });
        const selected = state.vault.activeAccount;
        return {
          accountType: selected.type,
          id: selected.id,
          address: state.vault.accounts[selected.type][selected.id].address,
          chainId: state.vault.activeNetwork.chainId,
        };
      });
    const initial = await selection();
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.step(
      'connect the real injected provider to the synthetic EVM account',
      async () => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        for (let attempt = 0; attempt < 3 && !popup.isClosed(); attempt++) {
          if ((await rpcObservation(dapp, id)).settled) break;
          const confirm = popup
            .getByRole('button', {
              name: /(?:^|\s)(confirm|approve|connect|proceed)$/i,
            })
            .last();
          await expect(confirm).toBeEnabled();
          await clickClosingPopup({
            click: () => confirm.click(),
            isClosed: () => popup.isClosed(),
          });
          await expect
            .poll(
              async () =>
                popup.isClosed() ||
                (
                  await rpcObservation(dapp, id)
                ).settled ||
                (await confirm.isEnabled().catch(() => false))
            )
            .toBe(true);
        }
        const result = await settle(dapp, id);
        expect(
          result.result.map((address: string) => address.toLowerCase())
        ).toEqual([initial.address.toLowerCase()]);
      }
    );
    for (const method of [
      'wallet_requestSmartAccountModuleInstall',
      'wallet_requestSmartAccountModuleUninstall',
    ]) {
      await wallet.step(
        `${method} rejects malformed field types before any consent window`,
        async () => {
          for (const module of [
            { address: 123 },
            { name: { label: 'invalid' } },
            { initData: { bytes: '0x' } },
          ]) {
            const pages = new Set(wallet!.context.pages());
            const id = await startRequest(dapp, method, [module]);
            // A broken old build opens a popup instead of settling; detect that
            // directly rather than waiting for a timeout or approving anything.
            await expect
              .poll(
                async () =>
                  (await rpcObservation(dapp, id)).settled ||
                  wallet!.context.pages().some((page) => !pages.has(page))
              )
              .toBe(true);
            expect(
              wallet!.context.pages().filter((page) => !pages.has(page))
            ).toEqual([]);
            const result = await settle(dapp, id);
            expect(result.error?.code).toBe(-32602);
            expect(result.result).toBeUndefined();
            observations.push({ method, module, error: result.error });
            expect(await selection()).toEqual(initial);
          }
        }
      );
      await wallet.step(
        `${method} still renders valid strings and permits ordinary cancellation`,
        async () => {
          const id = await startRequest(dapp, method, [
            {
              address: '0x1111111111111111111111111111111111111111',
              name: 'Public synthetic module',
              initData: '0x',
            },
          ]);
          const popup = await popupFor(wallet!.context, dapp, id);
          const cancel = popup.getByRole('button', {
            name: en.buttons.cancel,
            exact: true,
          });
          await expect(
            popup.getByText('Public synthetic module', { exact: true })
          ).toBeVisible();
          const origin = new URL(server.url).origin;
          const prompt = (
            method.endsWith('Uninstall')
              ? en.smartAccountHub.dappUninstallPrompt
              : en.smartAccountHub.dappInstallPrompt
          ).replace('{{host}}', origin);
          await expect(popup.getByText(prompt, { exact: true })).toBeVisible();
          await expect(popup.locator('body')).not.toContainText('&#x2F;');
          await expect(cancel).toBeEnabled();
          // This is an ordinary HD account: render/cancel is the healthy
          // control, not authorization to install a smart-account validator.
          await expect(
            popup.getByRole('button', { name: en.buttons.confirm, exact: true })
          ).toBeDisabled();
          await info.attach(`${method}-healthy-consent`, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await clickClosingPopup({
            click: () => cancel.click(),
            isClosed: () => popup.isClosed(),
          });
          const result = await settle(dapp, id);
          expect(result.error?.code).toBe(4001);
          observations.push({ method, healthyCancellation: result.error });
          expect(await selection()).toEqual(initial);
        }
      );
    }
    expect(errors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('module-request-boundary-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            noSigningApproved: true,
            observations,
            errors,
            deniedWrites: routes?.deniedWrites,
            proxyDeniedConnections: server.blocked.length,
          },
          null,
          2
        ),
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
