import { expect, test, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import es from '../../source/assets/locales/es.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('a delayed startup in another document cannot overwrite a saved language', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'LanguagePersistenceSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let delayed: Page | undefined;
  let reopened: Page | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const readLanguage = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<string | undefined>((resolve) => {
          chrome.storage.local.get(['language'], (result) =>
            resolve(result.language)
          );
        })
    );
  const select = async (
    page: Page,
    triggerName: string,
    optionName: string,
    saveName: string
  ) => {
    await page.getByRole('button', { name: triggerName, exact: true }).click();
    await page.getByRole('menuitem', { name: optionName, exact: true }).click();
    await page.getByRole('button', { name: saveName, exact: true }).click();
  };
  try {
    wallet = await PaliWallet.launch('language-preference-persistence', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    await wallet.gotoRoute('#/settings/languages');
    await select(
      page,
      en.settings.setYourPreferredLanguage,
      'Spanish Español',
      en.buttons.save
    );
    await expect.poll(() => readLanguage(page)).toBe('es');
    await expect(
      page.getByText(es.settings.languageWasSet, { exact: true })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
    await wallet.gotoRoute('#/settings/languages');

    delayed = await wallet.context.newPage();
    // Delay only the real callback for this document's first language read.
    // All storage values and every controller response remain unmodified.
    await delayed.addInitScript(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      const probe = {
        held: false,
        released: false,
        snapshot: null as string | null,
        writes: [] as string[],
        release: (() => undefined) as () => void,
      };
      (window as any).__languageStartup = probe;
      chrome.storage.local.get = ((keys: any, callback?: any) => {
        if (
          !probe.held &&
          Array.isArray(keys) &&
          keys.length === 1 &&
          keys[0] === 'language' &&
          typeof callback === 'function'
        ) {
          probe.held = true;
          return get(keys, (result) => {
            probe.snapshot = result.language;
            probe.release = () => {
              probe.released = true;
              callback(result);
            };
          });
        }
        return (get as any)(keys, callback);
      }) as typeof chrome.storage.local.get;
      chrome.storage.local.set = ((items: any, callback?: any) => {
        if (Object.prototype.hasOwnProperty.call(items, 'language'))
          probe.writes.push(items.language);
        return (set as any)(items, callback);
      }) as typeof chrome.storage.local.set;
    });
    await delayed.goto(page.url());
    await expect
      .poll(() =>
        delayed!.evaluate(() => (window as any).__languageStartup?.snapshot)
      )
      .toBe('es');
    await select(
      page,
      es.settings.setYourPreferredLanguage,
      'French Français',
      es.buttons.save
    );
    await expect.poll(() => readLanguage(page)).toBe('fr');
    await expect(
      page.getByText(fr.settings.languageWasSet, { exact: true })
    ).toBeVisible();
    await delayed.evaluate(() => (window as any).__languageStartup.release());
    await expect(
      delayed.getByRole('button', {
        name: es.settings.setYourPreferredLanguage,
        exact: true,
      })
    ).toBeVisible();
    observations.delayedStartup = await delayed.evaluate(() => {
      const { snapshot, released, writes } = (window as any).__languageStartup;
      return { snapshot, released, writes };
    });
    observations.savedLanguage = await readLanguage(page);
    expect(observations.delayedStartup).toEqual({
      snapshot: 'es',
      released: true,
      writes: [],
    });
    expect(observations.savedLanguage).toBe('fr');

    reopened = await wallet.context.newPage();
    await reopened.goto(page.url());
    await expect(
      reopened.getByRole('button', {
        name: fr.settings.setYourPreferredLanguage,
        exact: true,
      })
    ).toBeVisible();
    observations.reopenedLanguage = await readLanguage(reopened);
    expect(observations.reopenedLanguage).toBe('fr');
    await info.attach('saved-language-after-delayed-startup', {
      body: await reopened.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    observations.runtime = extensionEvidence();
    await info.attach('language-preference-evidence', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
    await reopened?.close().catch(() => undefined);
    await delayed?.close().catch(() => undefined);
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
