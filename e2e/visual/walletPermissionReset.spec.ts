import { expect, test } from '@playwright/test';
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
  providerRequest,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Another public fixture only; never use either phrase on a public chain.
const REPLACEMENT_SEED =
  'test test test test test test test test test test test junk';

test('forgetting a wallet removes site permissions before a different wallet reuses account zero', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const origin = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'PermissionResetSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {
    runtime: extensionEvidence(),
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
    signingOrBroadcastRequested: false,
  };
  try {
    wallet = await PaliWallet.launch('wallet-permission-reset', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const snapshot = () =>
      wallet!.page.evaluate(async () => {
        const state = await chrome.runtime.sendMessage({
          type: 'getCurrentState',
        });
        const ref = state.vault.activeAccount;
        const persisted = await chrome.storage.local.get('state');
        return {
          active: {
            ...ref,
            address: state.vault.accounts[ref.type]?.[ref.id]?.address,
          },
          grants: Object.keys(state.dapp.dapps),
          persistedGrants: Object.keys(persisted.state?.dapp?.dapps || {}),
        };
      });
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await wallet.ensureOnHome();
    const original = await snapshot();
    const dapp = await wallet.context.newPage();
    await dapp.goto(origin);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    const connect = async () => {
      const id = await startRequest(dapp, 'eth_requestAccounts');
      return approve(wallet!.context, dapp, id);
    };
    await wallet.step(
      'grant access to the original synthetic wallet',
      async () => {
        expect((await connect()).result).toEqual([original.active.address]);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          original.active.address,
        ]);
        expect(await snapshot()).toMatchObject({
          grants: [origin],
          persistedGrants: [origin],
        });
      }
    );
    await wallet.step(
      'forget through the real password-validated view',
      async () => {
        await wallet!.gotoRoute('#/settings/forget-wallet');
        const password = wallet!.page.locator('#forget_password');
        await password.fill(E2E_CONFIG.password);
        await password.press('Enter');
        const forget = wallet!.page.getByRole('button', {
          name: en.buttons.forget,
          exact: true,
        });
        await expect(forget).toBeEnabled();
        await forget.click();
        await expect(wallet!.page.locator('#import-wallet-link')).toBeVisible();
        observations.afterForget = await snapshot();
      }
    );
    await wallet.step(
      'restore a different public fixture without inheriting access',
      async () => {
        E2E_CONFIG.seedPhrase = REPLACEMENT_SEED;
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        const replacement = await snapshot();
        expect(replacement.active.id).toBe(0);
        expect(replacement.active.address).not.toBe(original.active.address);
        const accounts = await providerRequest(dapp, 'eth_accounts');
        observations.replacement = replacement;
        observations.unapprovedAccounts = accounts;
        expect(accounts).toEqual([]);
        expect(replacement.grants).toEqual([]);
        expect(replacement.persistedGrants).toEqual([]);
        await wallet!.page.reload();
        await wallet!.ensureOnHome();
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        expect(await snapshot()).toEqual(replacement);
        expect((await connect()).result).toEqual([replacement.active.address]);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          replacement.active.address,
        ]);
        expect(await snapshot()).toMatchObject({
          grants: [origin],
          persistedGrants: [origin],
        });
        await info.attach('new-wallet-requires-fresh-permission', {
          body: await wallet!.page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    await info.attach('permission-reset-observations', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
    if (wallet) await wallet.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
