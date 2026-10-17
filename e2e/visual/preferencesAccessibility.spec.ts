import { type Locator, type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

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

const hitTarget = (locator: Locator) =>
  locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.y >= 0 &&
      bounds.bottom <= innerHeight &&
      !!hit &&
      (hit === element || element.contains(hit))
    );
  });
const revealWithWheel = async (page: Page, locator: Locator) => {
  await page.mouse.move(200, 350);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => hitTarget(locator)).toBe(true);
};

test('offline onboarding and preferences remain keyboard accessible with localized failures', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    ...(process.env.PALI_TEST_DAPP_EXTENSION_PATH
      ? { extensionPath: process.env.PALI_TEST_DAPP_EXTENSION_PATH }
      : {}),
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'PreferencesSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const pageErrors: string[] = [];
  const directory =
    process.env.PALI_PREFERENCES_VISUAL_OUTPUT ||
    path.join(E2E_CONFIG.artifactsDir, 'preferences-accessibility');
  const capture = async (page: Page, name: string) => {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${name}.png`);
    await page.screenshot({
      path: file,
      animations: 'disabled',
      mask: [page.locator('#import-wallet-input, input[type=password]')],
    });
    await info.attach(name, { path: file, contentType: 'image/png' });
  };
  try {
    wallet = await PaliWallet.launch('preferences-accessibility', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 480 },
    });
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await page.locator('#import-wallet-link').click();
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      (window as any).__seedValidationTypes = [];
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const message = args[0];
        if (message?.data?.methods?.[1] === 'isSeedValid')
          (window as any).__seedValidationTypes.push(
            typeof message.data.params[0]
          );
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    const seed = page.getByRole('textbox', {
      name: en.import.pasteYourWalletSeed,
    });
    await seed.fill('one two');
    await seed.blur();
    await expect(
      page.getByRole('dialog', { name: en.import.importModalWordMissing })
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).__seedValidationTypes)
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Correct the invalid phrase before leaving its field; invalid blur
    // deliberately reopens the word-count warning.
    await seed.fill(UTXO_FIXTURE_SEED);
    const importButton = page.locator('#import-wallet-action');
    await expect(importButton).toBeEnabled();
    const hide = page.getByRole('button', { name: en.import.hideSeedPhrase });
    await hide.focus();
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('button', { name: en.import.showSeedPhrase })
    ).toBeVisible();
    await page.keyboard.press('Space');
    await revealWithWheel(page, importButton);
    await capture(page, 'import-keyboard-400x480');
    await importButton.click();
    await page.locator('#create-password').fill(E2E_CONFIG.password);
    await page.locator('#confirm-password').fill(E2E_CONFIG.password);
    await page.locator('#create-password-action').click();
    await wallet.ensureOnHome();

    await wallet.gotoRoute('#/settings/languages');
    await expect(page.getByRole('menu')).toHaveCount(0);
    const language = page.getByRole('button', {
      name: en.settings.setYourPreferredLanguage,
    });
    await language.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('ger');
    await page.keyboard.press('Enter');
    await expect(language).toContainText('Deutsch');
    await expect(page.getByRole('menu')).toHaveCount(0);
    const saveLanguage = page.getByRole('button', {
      name: en.buttons.save,
      exact: true,
    });
    await revealWithWheel(page, saveLanguage);
    await saveLanguage.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await wallet.gotoRoute('#/settings/languages');
    await expect(
      page.getByText(de.settings.currentLanguage, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: de.buttons.save, exact: true })
    ).toBeDisabled();
    await capture(page, 'language-german-400x480');

    // Inject only the specific local preference failure responses. This exercises
    // the real error UI and prevents any preference mutation in those cases.
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.[0] === 'wallet' &&
          ['setFiat', 'setAdvancedSettings'].includes(message.data.methods[1])
        ) {
          const response = { error: 'Synthetic preference failure' };
          if (typeof callback === 'function') {
            queueMicrotask(() => callback(response));
            return;
          }
          return Promise.resolve(response);
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    await wallet.gotoRoute('#/settings/currency');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    const currency = page.getByRole('button', {
      name: de.settings.setYourPreferred,
    });
    await currency.focus();
    await page.keyboard.press('Enter');
    const search = page.getByRole('textbox', {
      name: de.settings.searchCurrencies,
    });
    await expect(search).toBeFocused();
    await search.fill('no-such-currency');
    await expect(page.getByRole('status')).toContainText(
      de.settings.noCurrenciesFound
    );
    await search.fill('eur');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(currency).toContainText('EUR');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    const saveCurrency = page.getByRole('button', {
      name: de.buttons.save,
      exact: true,
    });
    await revealWithWheel(page, saveCurrency);
    await saveCurrency.click();
    await expect(page.getByRole('alert')).toContainText(
      de.settings.preferencesSaveFailed
    );
    await capture(page, 'currency-failure-german-400x480');

    await wallet.gotoRoute('#/settings/advanced');
    await expect(
      page.getByRole('switch', { name: de.settings.enableRefresh })
    ).toBeVisible();
    const autolock = page.getByRole('spinbutton', {
      name: de.settings.enableAutolock,
    });
    await autolock.fill('');
    await expect(autolock).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('button', { name: de.buttons.save, exact: true })
    ).toBeDisabled();
    await autolock.fill('10');
    const saveAdvanced = page.getByRole('button', {
      name: de.buttons.save,
      exact: true,
    });
    await revealWithWheel(page, saveAdvanced);
    await saveAdvanced.click();
    await expect(page.getByRole('alert')).toContainText(
      de.settings.preferencesSaveFailed
    );
    await capture(page, 'advanced-failure-german-400x480');
    await wallet.gotoRoute('#/settings/networks/trusted-sites');
    const trustedSearch = page.getByRole('textbox', {
      name: de.settings.searchTrustedSites,
    });
    await trustedSearch.fill('bridge');
    await expect(
      page.getByText(de.settings.unlistedSite, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(de.settings.trustedSiteMatch, { exact: true })
    ).toHaveCount(0);
    await trustedSearch.fill('https://bridge.syscoin.org');
    await expect(
      page.getByText(de.settings.trustedSiteMatch, { exact: true })
    ).toBeVisible();
    await capture(page, 'trusted-exact-german-400x480');
    expect(pageErrors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
  } catch (error) {
    if (wallet) await capture(wallet.page, 'failure').catch(() => undefined);
    throw error;
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
