import { expect, test } from '@playwright/test';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const locales = [
  { code: 'en', translations: en, mismatch: 'Passwords do not match' },
  {
    code: 'de',
    translations: de,
    mismatch: 'Die Passwörter stimmen nicht überein.',
  },
] as const;

for (const { code, translations, mismatch } of locales) {
  test(`recovery password confirmation explains mismatches in the selected language: ${code}`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'LocaleExistingSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, unknown> = {};
    let deniedWrites: string[] = [];
    try {
      wallet = await PaliWallet.launch(`password-confirmation-locale-${code}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installUtxoFixtureRoutes(
        wallet.context,
        createUtxoFixture(),
        server.url
      );
      deniedWrites = routes.deniedWrites;
      const page = wallet.page;
      await wallet.step(
        `${code} prepare a disposable wallet and select the language through settings`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          if (code === 'de') {
            await wallet!.gotoRoute('#/settings/languages');
            await page
              .getByRole('button', {
                name: en.settings.setYourPreferredLanguage,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', { name: 'German Deutsch', exact: true })
              .click();
            await page
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(
              page.getByText(de.settings.languageWasSet, { exact: true })
            ).toBeVisible();
            const saved = await page.evaluate(
              () =>
                new Promise<string | undefined>((resolve) =>
                  chrome.storage.local.get(['language'], (value) =>
                    resolve(value.language)
                  )
                )
            );
            expect(saved).toBe('de');
            observations.savedLanguage = saved;
            await page.keyboard.press('Escape');
            await wallet!.ensureOnHome();
          }
        }
      );
      await wallet.step(
        `${code} open ordinary recovery password setup without submitting a recovery`,
        async () => {
          await page.locator('#general-settings-button').click();
          await page
            .getByRole('menuitem', {
              name: translations.generalMenu.lock,
              exact: true,
            })
            .click();
          await expect(page.locator('#password')).toBeVisible();
          await page.locator('#import-wallet-link').click();
          await page.locator('#confirm-import-btn').click();
          await expect(page.locator('#import-wallet-input')).toBeVisible();
          await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
          await expect(page.locator('#import-wallet-action')).toBeEnabled();
          await page.locator('#import-wallet-action').click();
          await expect(page.locator('#create-password')).toHaveAttribute(
            'placeholder',
            translations.components.newPassword
          );
          await expect(page.locator('#confirm-password')).toHaveAttribute(
            'placeholder',
            translations.components.confirmPassword
          );
          await page.evaluate(() => {
            const original = chrome.runtime.sendMessage;
            const calls: string[] = [];
            (window as any).__passwordLocale = {
              calls,
              restore: () => {
                chrome.runtime.sendMessage = original;
              },
            };
            (chrome.runtime.sendMessage as any) = (...args: any[]) => {
              const message = args[0];
              if (message?.type === 'CONTROLLER_ACTION')
                calls.push((message.data?.methods || []).join('.'));
              return (original as any).apply(chrome.runtime, args);
            };
          });
        }
      );
      await wallet.step(
        `${code} explain a mismatch without submitting a recovery`,
        async (capture) => {
          try {
            await page
              .locator('#create-password')
              .fill('UnsubmittedSynthetic!2026');
            await page
              .locator('#confirm-password')
              .fill('DifferentSynthetic!2026');
            const feedback = page.locator('.ant-form-item-explain-error');
            await expect(feedback).toHaveCount(1);
            await expect(feedback).toBeVisible();
            observations.mismatchText = await feedback.innerText();
            await expect(
              page.locator('#create-password-action')
            ).toBeDisabled();
            await expect(feedback).toHaveText(mismatch);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        `${code} retain matching, cleared and weak-password validation controls`,
        async (capture) => {
          try {
            const feedback = page.locator('.ant-form-item-explain-error');
            await page
              .locator('#confirm-password')
              .fill('UnsubmittedSynthetic!2026');
            await expect(page.locator('#create-password-action')).toBeEnabled();
            await expect(feedback).toHaveCount(0);
            await page.locator('#confirm-password').clear();
            await expect(
              page.locator('#create-password-action')
            ).toBeDisabled();
            await page.locator('#create-password').fill('weak');
            await page.locator('#confirm-password').fill('weak');
            await expect(
              page.locator('#create-password-action')
            ).toBeDisabled();
            observations.validationControlsPassed = true;
            const calls = await page.evaluate(
              () => (window as any).__passwordLocale.calls as string[]
            );
            observations.forbiddenCalls = calls.filter((method) =>
              /(?:createWallet|recoverWalletFromSeed|export|getSeed|getPrivateKey)/.test(
                method
              )
            );
            expect(observations.forbiddenCalls).toEqual([]);
            expect(routes.deniedWrites).toEqual([]);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      status = 'passed';
    } finally {
      if (wallet && !wallet.page.isClosed()) {
        observations.trackedControllerMethods = await wallet.page.evaluate(
          () => (window as any).__passwordLocale?.calls ?? []
        );
        await wallet.page.evaluate(() =>
          (window as any).__passwordLocale?.restore()
        );
      }
      await info.attach('password-confirmation-locale-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          code,
          observations,
          deniedWrites,
          controllerResultsReplaced: false,
          storedPreferencesReplaced: false,
          recoveryPasswordSubmitted: false,
          syntheticWalletOnly: true,
        }),
      });
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
