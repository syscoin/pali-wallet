import { expect, test, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const savedLanguage = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | undefined>((resolve) => {
        chrome.storage.local.get(['language'], (result) =>
          resolve(result.language)
        );
      })
  );

test('a refused preference read keeps the active language truthful and permits an explicit language save', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'LanguageReadSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('language-preference-read', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    const page = wallet.page;
    await wallet.step(
      'save French through the ordinary language settings',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/languages');
        await page
          .getByRole('button', {
            name: en.settings.setYourPreferredLanguage,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: 'French Français', exact: true })
          .click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect.poll(() => savedLanguage(page)).toBe('fr');
        await expect(
          page.getByText(fr.settings.languageWasSet, { exact: true })
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await wallet!.ensureOnHome();
        observations.healthySavedLanguage = await savedLanguage(page);
      }
    );

    await page.evaluate(() => {
      const originalGet = chrome.storage.local.get;
      const get = originalGet.bind(chrome.storage.local);
      const probe = {
        refusedReads: 0,
        armed: true,
        restore: () => {
          chrome.storage.local.get = originalGet;
        },
      };
      (window as any).__languagePreferenceRead = probe;
      // One browser API callback reports the ordinary runtime.lastError path.
      // Stored preferences, controller messages and all other reads are real.
      chrome.storage.local.get = ((keys: any, callback?: any) => {
        if (
          probe.armed &&
          Array.isArray(keys) &&
          keys.length === 1 &&
          keys[0] === 'language' &&
          typeof callback === 'function'
        ) {
          probe.armed = false;
          probe.refusedReads += 1;
          queueMicrotask(() => {
            const descriptor = Object.getOwnPropertyDescriptor(
              chrome.runtime,
              'lastError'
            );
            Object.defineProperty(chrome.runtime, 'lastError', {
              configurable: true,
              get: () => ({ message: 'Synthetic language read refused' }),
            });
            try {
              callback({});
            } finally {
              if (descriptor)
                Object.defineProperty(chrome.runtime, 'lastError', descriptor);
              else delete (chrome.runtime as any).lastError;
            }
          });
          return;
        }
        return (get as any)(keys, callback);
      }) as typeof chrome.storage.local.get;
    });

    await wallet.step(
      'keep the genuine active French locale after a page preference read refusal',
      async () => {
        await wallet!.gotoRoute('#/settings/languages');
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as any).__languagePreferenceRead?.refusedReads
            )
          )
          .toBe(1);
        const trigger = page.getByRole('button', {
          name: fr.settings.setYourPreferredLanguage,
          exact: true,
        });
        await expect(trigger).toBeVisible();
        observations.afterReadRefusal = {
          triggerText: await trigger.innerText(),
          stored: await savedLanguage(page),
        };
        await expect(trigger).toContainText('French');
        await expect(
          page
            .getByText(fr.settings.currentLanguage, { exact: true })
            .locator('..')
        ).toContainText('Français');
        expect(await savedLanguage(page)).toBe('fr');
      }
    );

    await wallet.step(
      'save an explicit English selection durably after the refused read',
      async () => {
        await page
          .getByRole('button', {
            name: fr.settings.setYourPreferredLanguage,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: 'English English', exact: true })
          .click();
        const save = page.getByRole('button', {
          name: fr.buttons.save,
          exact: true,
        });
        await expect(save).toBeEnabled();
        await save.click();
        await expect.poll(() => savedLanguage(page)).toBe('en');
        await expect(
          page.getByText(en.settings.languageWasSet, { exact: true })
        ).toBeVisible();
        observations.afterExplicitSave = await savedLanguage(page);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    status = 'passed';
  } finally {
    if (wallet && !wallet.page.isClosed())
      await wallet.page.evaluate(() => {
        (window as any).__languagePreferenceRead?.restore();
      });
    await info.attach('language-preference-read-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        status,
        observations,
        storageReadCallbackAdaptedOnce: true,
        controllerStateReplaced: false,
        storageValuesReplaced: false,
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
