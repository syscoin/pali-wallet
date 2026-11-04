import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('offline wallet lifecycle: lock, backup reauthentication and seed recovery', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  const server = await startUtxoFixtureServer();
  const originalPassword = 'OfflineSyntheticOnly!2026';
  const recoveredPassword = 'RecoveredSyntheticOnly!2026';
  const seedHash = createHash('sha256').update(UTXO_FIXTURE_SEED).digest('hex');
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: originalPassword,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('offline-wallet-lifecycle', {
      offlineHttpProxy: server.url,
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    const locked = async () => {
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('#unlock-btn')).toBeVisible();
      await expect(page.locator('#home-balance')).toHaveCount(0);
    };
    const lock = async () => {
      await wallet!.ensureOnHome();
      await page.locator('#general-settings-button').click();
      await page.getByText(en.generalMenu.lock, { exact: true }).click();
      await locked();
    };
    const unlock = async (password: string) => {
      await page.locator('#password').fill(password);
      await page.locator('#unlock-btn').click();
    };
    const sameAccount = async () => {
      // Let the submitted authentication finish; do not navigate/re-unlock it.
      await expect(page).toHaveURL(/#\/home$/, { timeout: 30000 });
      await wallet!.ensureOnHome();
      await expect(page.locator('#home-balance')).toHaveText('0.001');
      await wallet!.gotoRoute('#/receive');
      await expect(page.locator('#qr-code')).toBeVisible();
      await expect(
        page.getByText(fixture.userAddress, { exact: true })
      ).toBeVisible();
      await wallet!.gotoRoute('#/home');
      expect(routes.deniedWrites).toEqual([]);
    };
    const backupMatchesFixture = () =>
      page.locator('textarea').evaluate(async (field, expectedHash) => {
        const bytes = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode((field as HTMLTextAreaElement).value)
        );
        return (
          Array.from(new Uint8Array(bytes), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join('') === expectedHash
        );
      }, seedHash);

    await wallet.step(
      'import the public synthetic seed and verify its UTXO address',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await sameAccount();
      }
    );
    await wallet.step(
      'Lock rejects the wrong password and a full reload stays locked',
      async () => {
        await lock();
        await unlock('WrongSyntheticOnly!2026');
        await expect(
          page.locator('#login').getByText('Invalid password', { exact: true })
        ).toBeVisible();
        await locked();
        await page.reload();
        await wallet!.waitAppReady();
        await locked();
      }
    );
    await wallet.step(
      'correct unlock restores the same account and address',
      async () => {
        await unlock(originalPassword);
        await sameAccount();
      }
    );
    await wallet.step(
      'backup requires reauthentication and clears when its password changes',
      async () => {
        await page.locator('#general-settings-button').click();
        await page.locator('#wallet-seed-phrase-btn').click();
        await expect(page).toHaveURL(/#\/settings\/seed$/);
        // Extra video masking as well as the driver's normal textarea screenshot mask.
        await page.addStyleTag({
          content: 'textarea { -webkit-text-security: disc !important; }',
        });
        expect(await backupMatchesFixture()).toBe(false);
        const password = page.locator('#phraseview_password');
        const confirm = page.getByRole('button', {
          name: en.buttons.confirm,
          exact: true,
        });
        await password.fill('WrongSyntheticOnly!2026');
        await confirm.click();
        await expect(
          page.getByText(en.start.wrongPassword, { exact: true })
        ).toBeVisible();
        expect(await backupMatchesFixture()).toBe(false);
        await password.fill(originalPassword);
        await confirm.click();
        const show = page.getByRole('button', {
          name: en.import.showSeedPhrase,
          exact: true,
        });
        await expect(show).toBeEnabled();
        // Authentication permits an explicit reveal; it does not reveal the
        // phrase into the DOM until the user chooses Show.
        expect(await backupMatchesFixture()).toBe(false);
        await show.click();
        // Read only a digest comparison; never return the phrase into the report.
        await expect.poll(backupMatchesFixture).toBe(true);
        await page
          .getByRole('button', { name: en.import.hideSeedPhrase, exact: true })
          .click();
        await expect.poll(backupMatchesFixture).toBe(false);
        await show.click();
        await expect.poll(backupMatchesFixture).toBe(true);
        await password.fill('');
        await expect.poll(backupMatchesFixture).toBe(false);
        await page
          .getByRole('button', { name: en.buttons.close, exact: true })
          // The header has a separate aria-labelled Close icon, without text.
          .filter({ hasText: new RegExp(`^${en.buttons.close}$`) })
          .click();
        await sameAccount();
      }
    );
    await wallet.step(
      'Cancel leaves the recovery warning on the original locked wallet',
      async () => {
        await lock();
        await page.locator('#import-wallet-link').click();
        await expect(
          page.getByText(en.settings.recoveryLimitations, { exact: true })
        ).toBeVisible();
        await page.locator('#cancel-import-btn').click();
        await locked();
        await unlock(originalPassword);
        await sameAccount();
      }
    );
    await wallet.step(
      'normal recovery restores only this disposable fixture with a new password',
      async () => {
        await lock();
        await page.locator('#import-wallet-link').click();
        await expect(
          page.getByText(en.settings.recoveryLimitations, { exact: true })
        ).toBeVisible();
        await page.locator('#confirm-import-btn').click();
        await expect(page).toHaveURL(/#\/import$/);
        await page.addStyleTag({
          content:
            '#import-wallet-input { -webkit-text-security: disc !important; }',
        });
        await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
        await page.locator('#import-wallet-action').click();
        await expect(page).toHaveURL(/#\/create-password-import$/);
        await page.locator('#create-password').fill(recoveredPassword);
        await page.locator('#confirm-password').fill(recoveredPassword);
        await page.locator('#create-password-action').click();
        await expect(page).toHaveURL(/#\/home$/, { timeout: 30000 });
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await sameAccount();
      }
    );
    await wallet.step(
      'the old password cannot unlock the restored wallet',
      async () => {
        await lock();
        await unlock(originalPassword);
        await expect(
          page.locator('#login').getByText('Invalid password', { exact: true })
        ).toBeVisible();
        await locked();
        await unlock(recoveredPassword);
        await sameAccount();
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'offline-wallet-lifecycle.json'),
      JSON.stringify(
        {
          ...evidence,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          simulated: true,
          publicSyntheticSeedOnly: true,
          normalUIOnly: true,
          destructiveRecoveryLimitedToFreshFixture: true,
          backupReauthenticationVerified: true,
          seedOrPrivateKeyReported: false,
          signaturesRequested: false,
          chainBroadcast: false,
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
