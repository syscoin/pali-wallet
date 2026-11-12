import { expect, test } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('local passkey enrolls, unlocks the same wallet and can be removed with password fallback', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the built extension');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createUtxoFixture();
  const password = 'PublicPasskeyFixture!2026';
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('local-passkey-unlock', {
      offlineHttpProxy: server.url,
      recordVideo: false,
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    const cdp = await wallet.context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    });
    await wallet.step('import a public synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet!.ensureOnHome();
    });
    await wallet.step(
      'enroll the browser PRF passkey through the real protected Port',
      async () => {
        await wallet!.gotoRoute('#/settings/local-passkey');
        await page.locator('#local-passkey-password').fill(password);
        await page
          .getByRole('button', { name: en.localPasskey.setUp, exact: true })
          .click();
        await expect(page.getByRole('status')).toHaveText(
          en.localPasskey.enabled
        );
        await expect(page.locator('#local-passkey-password')).toHaveValue('');
      }
    );
    await wallet.step(
      'render the passkey settings at the small extension width',
      async () => {
        await page.setViewportSize({ width: 320, height: 568 });
        await expect(
          page.getByRole('button', {
            name: en.localPasskey.turnOff,
            exact: true,
          })
        ).toBeVisible();
        const disableButton = page.getByRole('button', {
          name: en.localPasskey.turnOff,
          exact: true,
        });
        const expectReadableButton = async () => {
          const contrast = await disableButton.evaluate((button) => {
            const luminance = (color: string) => {
              const values = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number);
              const linear = values.map((value) => {
                const scaled = value / 255;
                return scaled <= 0.04045
                  ? scaled / 12.92
                  : Math.pow((scaled + 0.055) / 1.055, 2.4);
              });
              return (
                linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
              );
            };
            const style = getComputedStyle(button);
            const foreground = luminance(style.color);
            const background = luminance(style.backgroundColor);
            return (
              (Math.max(foreground, background) + 0.05) /
              (Math.min(foreground, background) + 0.05)
            );
          });
          expect(contrast).toBeGreaterThanOrEqual(4.5);
        };
        await expect(disableButton).toBeDisabled();
        await expectReadableButton();
        await page.locator('#local-passkey-password').fill(password);
        await expect(disableButton).toBeEnabled();
        await expectReadableButton();
        await page.locator('#local-passkey-password').fill('');
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        await page.screenshot({
          path: path.join(
            E2E_CONFIG.artifactsDir,
            'local-passkey-settings-320.png'
          ),
        });
        await page.setViewportSize({ width: 390, height: 700 });
      }
    );
    const lock = async () => {
      await wallet!.ensureOnHome();
      await page.locator('#general-settings-button').click();
      await page.getByText(en.generalMenu.lock, { exact: true }).click();
      await expect(page.locator('#password')).toBeVisible();
    };
    await wallet.step(
      'unlock using the browser assertion and preserve the selected wallet',
      async () => {
        await lock();
        await page.screenshot({
          path: path.join(E2E_CONFIG.artifactsDir, 'local-passkey-unlock.png'),
        });
        await page
          .getByRole('button', { name: en.localPasskey.unlock, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        await wallet!.gotoRoute('#/receive');
        await expect(
          page.getByText(fixture.userAddress, { exact: true })
        ).toBeVisible();
      }
    );
    await wallet.step(
      'remove local passkey enrollment and retain password unlock',
      async () => {
        await wallet!.gotoRoute('#/settings/local-passkey');
        await page.locator('#local-passkey-password').fill(password);
        await page
          .getByRole('button', { name: en.localPasskey.turnOff, exact: true })
          .click();
        await expect(page.getByRole('status')).toHaveText(
          en.localPasskey.disabled
        );
        await lock();
        await expect(
          page.getByRole('button', {
            name: en.localPasskey.unlock,
            exact: true,
          })
        ).toHaveCount(0);
        await page.locator('#password').fill(password);
        await page.locator('#unlock-btn').click();
        await expect(page).toHaveURL(/#\/home$/);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    wallet = undefined;
    throw error;
  } finally {
    await wallet?.dispose('failed');
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
