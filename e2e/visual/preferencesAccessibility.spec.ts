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
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let parent: Element | null = element;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0)
        return false;
      if (parent === element) continue;
      const parentBounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, parentBounds.left + parent.clientLeft);
        clip.right = Math.min(
          clip.right,
          parentBounds.left + parent.clientLeft + parent.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, parentBounds.top + parent.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          parentBounds.top + parent.clientTop + parent.clientHeight
        );
      }
    }
    const tolerance = 0.5; // Subpixel rounding only, not a partial-visibility allowance.
    if (
      bounds.left < clip.left - tolerance ||
      bounds.top < clip.top - tolerance ||
      bounds.right > clip.right + tolerance ||
      bounds.bottom > clip.bottom + tolerance
    )
      return false;
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const points = [
      [x, y],
      [bounds.left + 2, y],
      [bounds.right - 2, y],
      [x, bounds.top + 2],
      [x, bounds.bottom - 2],
    ];
    return points.every(([left, top]) => {
      const hit = document.elementFromPoint(left, top);
      return !!hit && (hit === element || element.contains(hit));
    });
  });
const revealWithWheel = async (page: Page, locator: Locator) => {
  const viewport = page.viewportSize()!;
  await page.mouse.move(
    viewport.width / 2,
    Math.min(350, viewport.height - 20)
  );
  await page.mouse.wheel(0, 900);
  await expect.poll(() => hitTarget(locator)).toBe(true);
};
const assertReadableError = async (locator: Locator) => {
  const contrast = await locator.evaluate((element) => {
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const luminance = (channels: number[]) =>
      channels.reduce((total, value, index) => {
        const channel = value / 255;
        return (
          total +
          (channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]
        );
      }, 0);
    let ancestor: Element | null = element;
    let background = 'rgb(255, 255, 255)';
    while (ancestor) {
      const candidate = getComputedStyle(ancestor).backgroundColor;
      if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') {
        background = candidate;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    const foreground = luminance(rgb(getComputedStyle(element).color));
    const behind = luminance(rgb(background));
    return (
      (Math.max(foreground, behind) + 0.05) /
      (Math.min(foreground, behind) + 0.05)
    );
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
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
    const layout = page.locator('[data-navigation-scroll="wallet-layout"]');
    await page.setViewportSize({ width: 400, height: 800 });
    await expect
      .poll(() => layout.evaluate((element) => element.clientHeight))
      .toBe(620);
    await capture(page, 'language-normal-400x800');
    await page.setViewportSize({ width: 400, height: 480 });
    await expect
      .poll(() => layout.evaluate((element) => element.clientHeight))
      .toBe(480);
    await expect(page.getByRole('menu')).toHaveCount(0);
    const language = page.getByRole('button', {
      name: en.settings.setYourPreferredLanguage,
    });
    await language.focus();
    await page.keyboard.press('Enter');
    const languageMenu = page.getByRole('menu');
    await expect(languageMenu).toBeFocused();
    const activeLanguage = () =>
      languageMenu.evaluate((menu) =>
        document
          .getElementById(menu.getAttribute('aria-activedescendant') || '')
          ?.getAttribute('aria-label')
      );
    // Keyboard opening schedules the initial selection after menu focus. Wait
    // for it before typeahead so it cannot replace the requested language.
    await expect.poll(activeLanguage).toBe('English English');
    await page.keyboard.type('ger');
    await expect.poll(activeLanguage).toBe('German Deutsch');
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
          ['saveFiatCurrency', 'setAdvancedSettings'].includes(
            message.data.methods[1]
          )
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
    await assertReadableError(page.getByRole('alert'));
    expect(
      await hitTarget(page.getByRole('alert')),
      'Currency error remains fully visible and unobscured without scrolling'
    ).toBe(true);
    expect(
      await hitTarget(saveCurrency),
      'Currency Save remains fully visible after its error without scrolling'
    ).toBe(true);
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
    await assertReadableError(page.getByRole('alert'));
    expect(
      await hitTarget(page.getByRole('alert')),
      'Advanced error remains fully visible and unobscured without scrolling'
    ).toBe(true);
    expect(
      await hitTarget(saveAdvanced),
      'Advanced Save remains fully visible after its error without scrolling'
    ).toBe(true);
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

    await wallet.gotoRoute('#/settings/account/import');
    const watchOnly = page.getByRole('checkbox', {
      name: 'Watch-only',
      exact: true,
    });
    await expect(watchOnly).toHaveAttribute('id', 'import-account-watch-only');
    await expect(
      page.getByRole('textbox', {
        name: `${de.settings.label} (${de.settings.optional})`,
      })
    ).toHaveAttribute('id', 'account-name-input');
    await expect(
      page.getByRole('textbox', { name: de.settings.yourPrivateKey })
    ).toHaveAttribute('id', 'import-account-identifier');
    expect(await page.locator('#account-name-input').count()).toBe(1);
    await page.locator('label[for="import-account-watch-only"]').click();
    await expect(watchOnly).toBeChecked();
    await expect(
      page.getByRole('textbox', { name: 'Address / XPUB / Descriptor' })
    ).toHaveAttribute('id', 'import-account-identifier');
    await capture(page, 'import-account-named-german-400x480');
    expect(pageErrors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
  } catch (error) {
    if (wallet) {
      await capture(wallet.page, 'failure').catch(() => undefined);
      const geometry = await wallet.page
        .evaluate(() =>
          [
            ...document.querySelectorAll(
              'body, #app-root, [data-navigation-scroll], form, button'
            ),
          ].map((element) => ({
            tag: element.tagName,
            id: element.id,
            text: element.tagName === 'BUTTON' ? element.textContent : '',
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            scrollTop: element.scrollTop,
            overflow: getComputedStyle(element).overflowY,
            bounds: element.getBoundingClientRect().toJSON(),
          }))
        )
        .catch(() => []);
      await info.attach('failure-geometry', {
        body: JSON.stringify(geometry, null, 2),
        contentType: 'application/json',
      });
    }
    throw error;
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('preference visibility rejects clipped or edge-obscured controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 480 });
  await page.route('**/*', (route) => route.abort('blockedbyclient'));
  const fixtures = [
    { name: 'fully visible', style: 'left:20px;top:20px', visible: true },
    { name: 'below viewport', style: 'left:20px;top:452px', visible: false },
    {
      name: 'outside right edge',
      style: 'left:300px;top:20px',
      visible: false,
    },
    { name: 'outside left edge', style: 'left:-20px;top:20px', visible: false },
    {
      name: 'clipped ancestor',
      style: 'left:20px;top:20px',
      parent:
        'position:absolute;left:0;top:0;width:400px;height:52px;overflow:hidden',
      visible: false,
    },
    {
      name: 'obscured bottom edge',
      style: 'left:20px;top:20px',
      overlay:
        '<div style="position:absolute;left:20px;top:64px;width:160px;height:8px;z-index:2;background:black"></div>',
      visible: false,
    },
  ];
  for (const fixture of fixtures) {
    await page.setContent(
      `<div style="${fixture.parent || ''}"><button style="position:absolute;${
        fixture.style
      };width:160px;height:48px">Save</button></div>${fixture.overlay || ''}`
    );
    expect(await hitTarget(page.getByRole('button')), fixture.name).toBe(
      fixture.visible
    );
  }
});

test('open preference menu options stay clickable above the sticky action at short heights', async ({}, info) => {
  test.setTimeout(60_000);
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
  try {
    wallet = await PaliWallet.launch('preferences-menu-overlap', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 480 },
    });
    const page = wallet.page;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    for (const height of [480, 360]) {
      await page.setViewportSize({ width: 400, height });
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/languages');
      const language = page.getByRole('button', {
        name: en.settings.setYourPreferredLanguage,
      });
      await language.click();
      await expect(page.getByRole('menu')).toBeVisible();
      const label = `language-menu-footer-400x${height}`;
      const file = path.join(E2E_CONFIG.artifactsDir, `${label}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      await info.attach(label, { path: file, contentType: 'image/png' });
      // Choose a real option at the geometric intersection, not by scrolling it
      // above the footer. The click must reach that exact visible overlap.
      const overlap = await page.getByRole('menuitem').evaluateAll((items) => {
        const footer = document
          .querySelector('[data-page-action-footer]')!
          .getBoundingClientRect();
        const menu = document
          .querySelector('[role=menu]')!
          .getBoundingClientRect();
        for (const item of items) {
          const bounds = item.getBoundingClientRect();
          const left = Math.max(bounds.left, footer.left, menu.left, 0);
          const right = Math.min(
            bounds.right,
            footer.right,
            menu.right,
            innerWidth
          );
          const top = Math.max(bounds.top, footer.top, menu.top, 0);
          const bottom = Math.min(
            bounds.bottom,
            footer.bottom,
            menu.bottom,
            innerHeight
          );
          if (right - left < 4 || bottom - top < 4) continue;
          const x = (left + right) / 2;
          const y = (top + bottom) / 2;
          const hit = document.elementFromPoint(x, y);
          return {
            label: item.getAttribute('aria-label')!,
            x,
            y,
            reachable: !!hit && (item === hit || item.contains(hit)),
            bounds: bounds.toJSON(),
            footer: footer.toJSON(),
          };
        }
        return null;
      });
      await info.attach(`${label}-geometry`, {
        body: JSON.stringify(overlap, null, 2),
        contentType: 'application/json',
      });
      expect(
        overlap,
        'a language option must exercise actual footer overlap'
      ).not.toBeNull();
      expect.soft(overlap!.reachable, `${label}: ${overlap!.label}`).toBe(true);
      if (overlap!.reachable) {
        await page.mouse.move(overlap!.x, overlap!.y);
        await page.mouse.down();
        const heldClick = await page.evaluate(
          async ({ x, y }) => {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
            return {
              target: document
                .elementFromPoint(x, y)
                ?.closest('[role=menuitem]')
                ?.getAttribute('aria-label'),
              focusRole: document.activeElement?.getAttribute('role'),
              scrollTop: document.querySelector(
                '[data-navigation-scroll="wallet-layout"]'
              )?.scrollTop,
            };
          },
          { x: overlap!.x, y: overlap!.y }
        );
        await page.mouse.up();
        await info.attach(`${label}-held-click`, {
          body: JSON.stringify(heldClick, null, 2),
          contentType: 'application/json',
        });
        expect(heldClick.target, 'focus must not move the pointer target').toBe(
          overlap!.label
        );
        expect(heldClick.focusRole).toBe('menu');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(language).toContainText(overlap!.label.split(' ')[0]);
        const save = page.getByRole('button', {
          name: en.buttons.save,
          exact: true,
        });
        if (overlap!.label === 'English English') {
          await expect(save).toBeDisabled();
        } else {
          await expect(save).toBeEnabled();
        }
      } else {
        await page.keyboard.press('Escape');
      }
    }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('preference Save remains fully visible after errors at supported short heights', async ({}, info) => {
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
  try {
    wallet = await PaliWallet.launch('preferences-short-window', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 480 },
    });
    const page = wallet.page;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.[0] === 'wallet' &&
          message.data.methods[1] === 'setAdvancedSettings'
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
    for (const [locale, copy] of [
      ['en', en],
      ['de', de],
    ] as const) {
      if (locale === 'de') {
        await wallet.gotoRoute('#/settings/languages');
        const language = page.getByRole('button', {
          name: en.settings.setYourPreferredLanguage,
        });
        await language.click();
        await page.keyboard.type('ger');
        await page.keyboard.press('Enter');
        await revealWithWheel(
          page,
          page.getByRole('button', { name: en.buttons.save, exact: true })
        );
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
      }
      for (const height of [480, 360, 620, 800]) {
        await page.setViewportSize({ width: 400, height });
        await wallet.gotoRoute('#/home');
        await wallet.gotoRoute('#/settings/advanced');
        const layout = page.locator('[data-navigation-scroll="wallet-layout"]');
        await expect
          .poll(() => layout.evaluate((element) => element.clientHeight))
          .toBe(Math.min(height, 620));
        const autolock = page.getByRole('spinbutton', {
          name: copy.settings.enableAutolock,
        });
        await autolock.fill(
          (await autolock.inputValue()) === '10' ? '11' : '10'
        );
        const save = page.getByRole('button', {
          name: copy.buttons.save,
          exact: true,
        });
        await revealWithWheel(page, save);
        await save.click();
        await expect(page.getByRole('alert')).toContainText(
          copy.settings.preferencesSaveFailed
        );
        await expect(save).toBeEnabled();
        // Do not focus, click or scroll after the error: these would mask the
        // exact regression where inserted text pushes the Save action away.
        await page.mouse.move(0, 0);
        const label = `advanced-${locale}-400x${height}-error`;
        const file = path.join(E2E_CONFIG.artifactsDir, `${label}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        await info.attach(label, { path: file, contentType: 'image/png' });
        const bounds = await save.boundingBox();
        expect
          .soft(
            await hitTarget(save),
            `${label}: complete Save bounds and edges remain visible; bounds=${JSON.stringify(
              bounds
            )}`
          )
          .toBe(true);
        expect
          .soft(
            await hitTarget(page.getByRole('alert')),
            `${label}: complete error remains visible and unobscured without scrolling`
          )
          .toBe(true);
        await assertReadableError(page.getByRole('alert'));
        // The Save control is disabled during the request, which may return
        // focus to the document. Traverse normally rather than forcing focus.
        for (
          let tab = 0;
          tab < 8 &&
          !(await autolock.evaluate(
            (element) => document.activeElement === element
          ));
          tab++
        ) {
          await page.keyboard.press('Shift+Tab');
        }
        await expect(autolock).toBeFocused();
        const focusFile = path.join(
          E2E_CONFIG.artifactsDir,
          `${label}-focus.png`
        );
        await page.screenshot({ path: focusFile, animations: 'disabled' });
        await info.attach(`${label}-focus`, {
          path: focusFile,
          contentType: 'image/png',
        });
        const focusGeometry = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '[data-navigation-scroll], form, [data-page-action-footer], #advanced-autolock, #advanced-autolock-hint'
            ),
          ].map((element) => ({
            tag: element.tagName,
            id: element.id,
            bounds: element.getBoundingClientRect().toJSON(),
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          }))
        );
        await info.attach(`${label}-focus-geometry`, {
          body: JSON.stringify(focusGeometry, null, 2),
          contentType: 'application/json',
        });
        expect
          .soft(
            await hitTarget(autolock),
            `${label}: keyboard focus must not remain hidden under the footer`
          )
          .toBe(true);
        const hint = page.locator('#advanced-autolock-hint');
        for (
          let attempt = 0;
          attempt < 5 &&
          !((await hitTarget(autolock)) && (await hitTarget(hint)));
          attempt++
        ) {
          const inputBounds = await autolock.boundingBox();
          const hintBounds = await hint.boundingBox();
          const footerBounds = await page
            .locator('[data-page-action-footer]')
            .boundingBox();
          await page.mouse.move(200, Math.min(180, height / 2));
          await page.mouse.wheel(
            0,
            Math.max(
              (inputBounds?.y || 0) + (inputBounds?.height || 0),
              (hintBounds?.y || 0) + (hintBounds?.height || 0)
            ) > (footerBounds?.y || height)
              ? 80
              : -80
          );
          // Let the dispatched native wheel scroll reach the next paint before
          // deciding whether another user scroll is needed.
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve())
                )
              )
          );
        }
        expect(
          await hitTarget(autolock),
          `${label}: ordinary wheel scrolling can fully reveal the input`
        ).toBe(true);
        expect(
          await hitTarget(hint),
          `${label}: ordinary wheel scrolling can fully reveal the hint`
        ).toBe(true);
      }
    }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
