import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
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

test('a connected-account approval cannot select an account id reused by a different vault', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ConnectedAccountSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const pageErrors: string[] = [];
  const observation: Record<string, unknown> = {
    runtime: extensionEvidence(),
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
    finalSigningApproved: false,
  };
  const selection = () =>
    wallet!.page.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const ref = state.vault.activeAccount;
      const project = (row: any) => ({
        id: row.id,
        address: row.address,
        label: row.label,
      });
      return {
        active: {
          ...project(state.vault.accounts[ref.type][ref.id]),
          type: ref.type,
        },
        network: {
          kind: state.vault.activeNetwork.kind,
          chainId: state.vault.activeNetwork.chainId,
        },
        switching: state.vaultGlobal.isSwitchingAccount,
        accounts: Object.values(state.vault.accounts.HDAccount).map(project),
      };
    });
  const capture = async (name: string, page: Page) => {
    await info.attach(name, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
  };
  const createSecond = async (label: string) => {
    await wallet!.gotoRoute('#/settings/account/new');
    await wallet!.page.locator('#account-name-input').fill(label);
    await wallet!.page.locator('#create-btn').click();
    await wallet!.page
      .getByRole('button', { name: en.buttons.ok, exact: true })
      .click();
    await wallet!.ensureOnHome();
    await expect
      .poll(selection)
      .toMatchObject({ active: { id: 1 }, switching: false });
  };
  const select = async (id: number) => {
    await wallet!.gotoRoute('#/home');
    await wallet!.ensureOnHome();
    const state = await selection();
    const account = state.accounts.find((row: any) => row.id === id)!;
    await wallet!.page
      .locator('#general-settings-button')
      .locator('..')
      .click();
    await wallet!.page
      .getByRole('menuitem', {
        name: `${account.label} (${account.address})`,
        exact: true,
      })
      .click();
    await expect.poll(selection).toMatchObject({
      active: { id, address: account.address },
      switching: false,
    });
  };
  try {
    wallet = await PaliWallet.launch('connected-account-context', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => pageErrors.push(error.message))
    );
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step(
      'create distinct accounts in both synthetic vaults',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await createSecond('Synthetic UTXO second');
        observation.utxo = await selection();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await createSecond('Synthetic EVM second');
        await select(0);
      }
    );
    const evm = await selection();
    const target = evm.active.address;
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.step('connect the dapp to the first EVM account', async () => {
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
        await confirm.click();
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
      const connected = await settle(dapp, id);
      expect(
        connected.result.map((address: string) => address.toLowerCase())
      ).toEqual([target.toLowerCase()]);
    });
    await wallet.step(
      'a current approval selects exactly its displayed EVM account',
      async () => {
        await select(1);
        const id = await startRequest(dapp, 'personal_sign', [
          '0x73746174652d7161',
          target,
        ]);
        const popup = await popupFor(wallet!.context, dapp, id);
        await popup
          .getByRole('button', {
            name: en.connections.switchAccount,
            exact: true,
          })
          .click();
        await expect.poll(() => popup.isClosed()).toBe(true);
        await expect
          .poll(selection)
          .toMatchObject({ active: { id: 0, address: target } });
        const signing = await popupFor(wallet!.context, dapp, id);
        await capture('healthy-signing-review', signing);
        const result = await dismissRejectedApproval({
          click: () =>
            signing
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => signing.isClosed(),
          settle: () => settle(dapp, id),
        });
        expect(result.error?.code).toBe(4001);
        expect(result.result).toBeUndefined();
        await expect.poll(() => signing.isClosed()).toBe(true);
      }
    );
    await wallet.step(
      'a vault change rejects the stale displayed address without selecting or acknowledging it',
      async () => {
        await select(1);
        const id = await startRequest(dapp, 'personal_sign', [
          '0x73746174652d716132',
          target,
        ]);
        const popup = await popupFor(wallet!.context, dapp, id);
        const switchAccount = popup.getByRole('button', {
          name: en.connections.switchAccount,
          exact: true,
        });
        await expect(switchAccount).toBeEnabled();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        const before = await selection();
        expect(before.network.kind).toBe('syscoin');
        expect(before.active.id).toBe(1);
        observation.beforeRejectedApproval = before;
        await capture('stale-displayed-account', popup);
        for (let attempt = 0; attempt < 2; attempt++) {
          await switchAccount.click();
          await expect(popup.getByRole('alert')).toHaveText(
            'Account context changed. Please cancel and retry the request.'
          );
          await expect(switchAccount).toBeEnabled();
          expect(popup.isClosed()).toBe(false);
          expect(await selection()).toEqual(before);
          expect((await rpcObservation(dapp, id)).settled).not.toBe(true);
        }
        await capture('stale-context-rejection', popup);
        const result = await dismissRejectedApproval({
          click: () =>
            popup
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => popup.isClosed(),
          settle: () => settle(dapp, id),
        });
        expect(result.error?.code).toBe(4100);
        expect(result.result).toBeUndefined();
        expect(await selection()).toEqual(before);
        observation.afterRejectedApproval = await selection();
        observation.dappRejection = result;
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    observation.status = status;
    observation.deniedWrites = routes?.deniedWrites;
    observation.pageErrors = pageErrors;
    await info.attach('connected-account-context', {
      body: JSON.stringify(observation, null, 2),
      contentType: 'application/json',
    });
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
