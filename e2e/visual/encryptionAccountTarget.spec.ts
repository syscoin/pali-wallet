// Use the same pinned encryption helper as the SDK; only public fixture keys.
// eslint-disable-next-line import/no-extraneous-dependencies
import { encrypt, getEncryptionPublicKey } from '@metamask/eth-sig-util';
import { expect, test } from '@playwright/test';
import { Wallet } from 'ethers';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  extensionEvidence,
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('encryption requests preserve the requested account and require selection consent', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'EncryptionTargetSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('encryption-account-target', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await wallet.ensureOnHome();
    const fixture = Wallet.fromPhrase(UTXO_FIXTURE_SEED);
    const plaintext = 'Public synthetic requested-account message';
    const ciphertext = `0x${Buffer.from(
      JSON.stringify(
        encrypt({
          publicKey: getEncryptionPublicKey(fixture.privateKey.slice(2)),
          data: plaintext,
          version: 'x25519-xsalsa20-poly1305',
        })
      )
    ).toString('hex')}`;
    await wallet.gotoRoute('#/settings/account/new');
    await wallet.page
      .locator('#account-name-input')
      .fill('Other encryption account');
    await wallet.page.locator('#create-btn').click();
    await wallet.page
      .getByRole('button', { name: en.buttons.ok, exact: true })
      .click();
    await wallet.ensureOnHome();
    const other = await wallet.page.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      return state.vault.accounts.HDAccount[1].address as string;
    });
    await wallet.page.locator('#general-settings-button').locator('..').click();
    await wallet.page
      .getByRole('menuitem', { name: new RegExp(fixture.address, 'i') })
      .click();
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    const connection = await startRequest(dapp, 'eth_requestAccounts');
    const connect = await popupFor(wallet.context, dapp, connection);
    await clickClosingPopup({
      click: () =>
        connect
          .getByRole('button', {
            name: /(?:^|\s)(confirm|approve|connect|proceed)$/i,
          })
          .last()
          .click(),
      isClosed: () => connect.isClosed(),
    });
    expect(
      (await settle(dapp, connection)).result.map((address: string) =>
        address.toLowerCase()
      )
    ).toEqual([fixture.address.toLowerCase()]);

    for (const method of ['eth_getEncryptionPublicKey', 'eth_decrypt']) {
      const params = (address: string) =>
        method === 'eth_decrypt' ? [ciphertext, address] : [address];
      await wallet.step(
        `${method} rejects an unknown target without approval`,
        async () => {
          const request = await startRequest(
            dapp,
            method,
            params(`0x${'33'.repeat(20)}`)
          );
          expect((await settle(dapp, request)).error?.code).toBe(4100);
        }
      );
      await wallet.step(
        `${method} requires account selection before another target`,
        async () => {
          const request = await startRequest(dapp, method, params(other));
          const popup = await popupFor(wallet!.context, dapp, request);
          await expect(
            popup.getByRole('button', {
              name: en.connections.switchAccount,
              exact: true,
            })
          ).toBeEnabled();
          const result = await dismissRejectedApproval({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(dapp, request),
          });
          expect(result.error?.code).toBe(4100);
          expect(result.result).toBeUndefined();
        }
      );
      await wallet.step(
        `${method} preserves the healthy requested account`,
        async () => {
          const request = await startRequest(
            dapp,
            method,
            params(fixture.address)
          );
          const popup = await popupFor(wallet!.context, dapp, request);
          await clickClosingPopup({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.confirm, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
          });
          const result = await settle(dapp, request);
          expect(result.error).toBeUndefined();
          expect(result.result).toBe(
            method === 'eth_decrypt'
              ? plaintext
              : getEncryptionPublicKey(fixture.privateKey.slice(2))
          );
        }
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('encryption-account-target', {
      body: JSON.stringify({
        ...extensionEvidence(),
        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        deniedWrites: routes.deniedWrites,
      }),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
