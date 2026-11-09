// Use the same lockfile-pinned encryption helper as the keyring and conformance suite.
// eslint-disable-next-line import/no-extraneous-dependencies
import { encrypt, getEncryptionPublicKey } from '@metamask/eth-sig-util';
import { expect, test } from '@playwright/test';
import { Wallet } from 'ethers';

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
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('decryption preview is cleared when the displayed wallet account changes', async ({}, info) => {
  test.setTimeout(120000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'EncryptionPreviewSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('encryption-preview-account-scope', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step(
      'import the synthetic wallet and select the EVM fixture',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    // The public deterministic fixture is never used with real funds. Use the
    // real keyring to decrypt locally; do not replace a controller or its state.
    const fixtureKey = Wallet.fromPhrase(UTXO_FIXTURE_SEED).privateKey.slice(2);
    const plaintext = 'Public synthetic encryption preview';
    const encrypted = encrypt({
      publicKey: getEncryptionPublicKey(fixtureKey),
      data: plaintext,
      version: 'x25519-xsalsa20-poly1305',
    });
    const ciphertext = `0x${Buffer.from(JSON.stringify(encrypted)).toString(
      'hex'
    )}`;
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    const connection = await startRequest(dapp, 'eth_requestAccounts');
    expect(
      (await approve(wallet.context, dapp, connection)).result.map(
        (address: string) => address.toLowerCase()
      )
    ).toEqual([Wallet.fromPhrase(UTXO_FIXTURE_SEED).address.toLowerCase()]);
    const request = await startRequest(dapp, 'eth_decrypt', [
      ciphertext,
      Wallet.fromPhrase(UTXO_FIXTURE_SEED).address,
    ]);
    const review = await popupFor(wallet.context, dapp, request);
    expect(new URL(review.url()).pathname).toBe('/external/tx/decrypt');
    await wallet.step(
      'preview the bound provider request with the real keyring',
      async (capture) => {
        try {
          await review
            .getByRole('button', {
              name: en.transactions.decryptMessage,
              exact: true,
            })
            .click();
          await expect(
            review.getByText(plaintext, { exact: true })
          ).toBeVisible();
        } finally {
          await capture(review);
        }
      }
    );
    await wallet.step(
      'create and select another account through the wallet UI',
      async () => {
        await wallet!.gotoRoute('#/settings/account/new');
        await wallet!.page
          .locator('#account-name-input')
          .fill('Second encryption account');
        await wallet!.page.locator('#create-btn').click();
        await wallet!.page
          .getByRole('button', { name: /^ok$/i })
          .first()
          .click();
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'retire the old approval without returning its plaintext to the dapp',
      async (capture) => {
        try {
          await expect.poll(() => review.isClosed()).toBe(true);
          const result = await settle(dapp, request);
          expect(result.error?.code).toBe(4001);
          expect(result.result).toBeUndefined();
          await wallet!.ensureOnHome();
          await expect(
            wallet!.page.getByText(plaintext, { exact: true })
          ).toHaveCount(0);
        } finally {
          await capture(wallet!.page);
        }
      }
    );
    await info.attach('runtime-evidence', {
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          standalonePreviewOnly: false,
          boundProviderRequest: true,
          realKeyringDecryption: true,
          controllerStateReplaced: false,
          deniedWrites: routes.deniedWrites,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, before);
    }
  }
});
