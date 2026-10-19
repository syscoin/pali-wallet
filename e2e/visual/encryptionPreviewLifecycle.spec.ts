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
import { extensionEvidence } from '../harness/testDappConformance';
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
    const review = await wallet.context.newPage();
    await wallet.step(
      'decrypt a standalone read-only review with the real keyring',
      async (capture) => {
        await review.goto(
          `chrome-extension://${
            wallet!.extensionId
          }/external.html?route=tx/decrypt&data=${encodeURIComponent(
            JSON.stringify({
              host: 'synthetic-encryption.invalid',
              eventName: 'synthetic-preview-only',
              0: ciphertext,
              1: Wallet.fromPhrase(UTXO_FIXTURE_SEED).address,
            })
          )}`
        );
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
      'verify the previous plaintext is not attributed to the new account',
      async (capture) => {
        try {
          await expect(
            review.getByText('Second encryption account', { exact: true })
          ).toBeVisible();
          await expect(
            review.getByText(plaintext, { exact: true })
          ).toHaveCount(0);
          await expect(
            review.getByRole('button', {
              name: en.transactions.copyMessage,
              exact: true,
            })
          ).toHaveCount(0);
          await expect(
            review.getByRole('button', {
              name: en.transactions.decryptMessage,
              exact: true,
            })
          ).toBeEnabled();
          await expect(
            review.getByRole('button', { name: en.buttons.cancel, exact: true })
          ).toBeEnabled();
        } finally {
          await capture(review);
        }
      }
    );
    await info.attach('runtime-evidence', {
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          standalonePreviewOnly: true,
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
    await review.close();
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
