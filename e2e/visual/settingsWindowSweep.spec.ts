import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import es from '../../source/assets/locales/es.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const exposed = (control: Locator) =>
  control.evaluate((element) => {
    const b = element.getBoundingClientRect();
    if (
      b.width <= 0 ||
      b.height <= 0 ||
      b.left < 0 ||
      b.top < 0 ||
      b.right > innerWidth + 0.5 ||
      b.bottom > innerHeight + 0.5
    )
      return false;
    return [
      [b.left + 2, b.top + b.height / 2],
      [b.right - 2, b.top + b.height / 2],
      [b.left + b.width / 2, b.top + 2],
      [b.left + b.width / 2, b.bottom - 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });

const reveal = async (page: Page, control: Locator) => {
  await page.mouse.move(page.viewportSize()!.width / 2, 180);
  for (const delta of [0, -3000, 100, 100, 100, 100, 100, 100, 100, 3000]) {
    if (delta) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(80);
    }
    if (await exposed(control)) return true;
  }
  return false;
};

const labelFits = (control: Locator) =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].every(
      (line) =>
        line.left >= box.left &&
        line.right <= box.right &&
        line.top >= box.top &&
        line.bottom <= box.bottom
    );
  });

test('settings, navigation menus and token search fit small localized windows', async ({}, info) => {
  test.setTimeout(240_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SettingsWindowSweepSynthetic!2026',
    rpcUrl: server.url,
  });
  const output = path.join(E2E_CONFIG.artifactsDir, 'settings-window-sweep');
  fs.mkdirSync(output, { recursive: true });
  const records: unknown[] = [];
  const failures: string[] = [];
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const capture = async (page: Page, name: string) => {
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    await info.attach(name, { path: file, contentType: 'image/png' });
    const record = {
      name,
      geometry: await page.evaluate(() => ({
        viewport: [innerWidth, innerHeight],
        overflow: document.documentElement.scrollWidth - innerWidth,
        visibleOverflow: [
          ...document.querySelectorAll('input,button,[role=menu],h1,h2,p'),
        ]
          .map((element) => ({
            element,
            bounds: element.getBoundingClientRect(),
          }))
          .filter(({ element, bounds }) => {
            for (
              let parent: Element | null = element;
              parent;
              parent = parent.parentElement
            ) {
              const style = getComputedStyle(parent);
              if (style.visibility === 'hidden' || Number(style.opacity) === 0)
                return false;
            }
            return (
              bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.top < innerHeight &&
              bounds.bottom > 0 &&
              (bounds.left < -0.5 || bounds.right > innerWidth + 0.5)
            );
          })
          .map(({ element, bounds }) => ({
            tag: element.tagName,
            id: element.id,
            text: element.textContent?.slice(0, 80),
            x: bounds.x,
            right: bounds.right,
          })),
      })),
    };
    records.push(record);
    expect
      .soft(
        record.geometry.overflow,
        `${name}: no document horizontal overflow`
      )
      .toBe(0);
    expect
      .soft(
        record.geometry.visibleOverflow,
        `${name}: visible controls fit the viewport`
      )
      .toEqual([]);
  };
  try {
    wallet = await PaliWallet.launch('settings-window-sweep', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 600 },
    });
    const page = wallet.page;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    for (const [locale, translations] of [
      ['en', en],
      ['de', de],
      ['es', es],
    ] as const) {
      await page.evaluate(
        async (language) => chrome.storage.local.set({ language }),
        locale
      );
      await page.reload();
      await wallet.ensureOnHome();
      for (const [width, height] of [
        [320, 360],
        [400, 360],
        [400, 480],
        [400, 600],
      ]) {
        await page.setViewportSize({ width, height });
        const suffix = `${locale}-${width}x${height}`;
        for (const route of [
          'settings/networks/custom-rpc',
          'settings/networks/edit',
          'settings/networks/trusted-sites',
          'tokens/add',
        ]) {
          await wallet.gotoRoute(`#/${route}`);
          await page.waitForTimeout(120);
          await page.mouse.move(width / 2, 180);
          await page.mouse.wheel(0, -3000);
          await page.waitForTimeout(80);
          await capture(page, `${route.replaceAll('/', '-')}-${suffix}-top`);
          if (route === 'tokens/add') {
            for (const name of [
              translations.tokens.yourTokens,
              translations.tokens.addCustomTab,
            ]) {
              const tab = page.getByRole('button', { name, exact: true });
              expect
                .soft(await exposed(tab), `${suffix}: token tab fits`)
                .toBe(true);
              expect
                .soft(
                  await labelFits(tab),
                  `${suffix}: full token tab label fits`
                )
                .toBe(true);
            }
          }
          if (route.endsWith('trusted-sites')) {
            const search = page.getByRole('textbox', {
              name: translations.settings.searchTrustedSites,
            });
            await reveal(page, search);
            await search.fill(
              'https://this-is-a-long-unlisted-synthetic-origin.example'
            );
            await capture(page, `trusted-search-${suffix}`);
            if (!(await exposed(search)))
              failures.push(`trusted search clipped ${suffix}`);
          } else if (route.endsWith('custom-rpc')) {
            const save = page.locator('form#rpc').getByRole('button').last();
            if (!(await reveal(page, save)))
              failures.push(`RPC save clipped ${suffix}`);
            await save.click(); // empty-field validation only; no network mutation.
            await capture(page, `rpc-required-errors-${suffix}`);
          }
          await page.mouse.move(width / 2, 180);
          await page.mouse.wheel(0, 3000);
          await page.waitForTimeout(120);
          await capture(page, `${route.replaceAll('/', '-')}-${suffix}-bottom`);
        }
        await wallet.gotoRoute('#/home');
        await page.locator('#general-settings-button').click();
        await page.waitForTimeout(120);
        await capture(page, `general-menu-${suffix}-top`);
        const menu = page.locator(
          '[role="menu"][data-headlessui-state="open"]'
        );
        await menu.hover({ position: { x: 100, y: 100 } });
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(120);
        await capture(page, `general-menu-${suffix}-bottom`);
        if (
          !(await exposed(
            menu.getByRole('menuitem', {
              name: translations.generalMenu.advanced,
              exact: true,
            })
          ))
        )
          failures.push(`Advanced settings row clipped ${suffix}`);
        await page.keyboard.press('Escape');
        await expect(
          page
            .locator('#general-settings-button')
            .locator('xpath=ancestor::button[1]')
        ).toBeFocused();
        await page.locator('#network-settings-btn').first().click();
        await page.waitForTimeout(120);
        await capture(page, `network-menu-${suffix}-top`);
        await page.mouse.move(width / 2, 180);
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(120);
        await capture(page, `network-menu-${suffix}-bottom`);
        const networkMenu = page.locator(
          '[role="menu"][data-headlessui-state="open"]'
        );
        const manageNetworks = networkMenu.getByRole('menuitem', {
          name: translations.networkMenu.manageNetworks,
        });
        if (!(await exposed(manageNetworks)))
          failures.push(`Manage networks row clipped ${suffix}`);
        await page.keyboard.press('Escape');
      }
    }
    const evmPage = await wallet.context.newPage();
    // The EVM token renderer shares the responsive tabs. This local display
    // fixture enables them without switching a real network or adding assets.
    await evmPage.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const fixture = (original: any) => {
        if (!original?.vault?.activeNetwork) return original;
        const state = structuredClone(original);
        state.vault.activeNetwork = {
          ...state.vault.activeNetwork,
          kind: 'ethereum',
          chainId: 57057,
          label: 'Synthetic EVM',
          apiUrl: 'http://127.0.0.1:1',
        };
        state.vault.isBitcoinBased = false;
        return state;
      };
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        if (message?.type === 'getCurrentState') {
          if (typeof callback === 'function')
            return (send as any)(message, (state: any) =>
              callback(fixture(state))
            );
          return (send as any)(message).then(fixture);
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    for (const [locale, translations] of [
      ['en', en],
      ['de', de],
      ['es', es],
    ] as const) {
      await page.evaluate(
        async (language) => chrome.storage.local.set({ language }),
        locale
      );
      await evmPage.goto(wallet.appUrl('#/tokens/add'));
      // Reusing the same hash route is not a document navigation. Reload so
      // this renderer reads the new persisted locale before checking labels.
      await evmPage.reload();
      for (const [width, height] of [
        [320, 360],
        [400, 360],
        [400, 600],
      ]) {
        await evmPage.setViewportSize({ width, height });
        for (const name of [
          translations.tokens.yourTokens,
          translations.tokens.addCustomTab,
        ]) {
          const tab = evmPage
            .getByRole('button', { name, exact: true })
            .first();
          await expect(tab).toBeVisible();
          expect
            .soft(await exposed(tab), `EVM ${locale} ${width}: token tab fits`)
            .toBe(true);
          expect
            .soft(
              await labelFits(tab),
              `EVM ${locale} ${width}: token label fits`
            )
            .toBe(true);
        }
        await capture(evmPage, `evm-tokens-${locale}-${width}x${height}`);
      }
    }
    await evmPage.close();
    expect(routes.deniedWrites).toEqual([]);
    expect(failures).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
  } finally {
    try {
      fs.writeFileSync(
        path.join(output, 'geometry.json'),
        JSON.stringify(records, null, 2)
      );
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, before);
        }
      }
    }
  }
});

test('long network labels and populated menus stay bounded and keyboard reachable', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkLabelsSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const output = path.join(E2E_CONFIG.artifactsDir, 'network-labels');
  fs.mkdirSync(output, { recursive: true });
  try {
    wallet = await PaliWallet.launch('network-labels', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 360 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = await wallet.context.newPage();
    // Renderer-only public metadata fixture. Never add networks to the wallet
    // controller or connect to any of these synthetic RPC addresses.
    await page.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const fixture = (original: any) => {
        if (!original?.vault?.activeNetwork || !original?.vaultGlobal?.networks)
          return original;
        const state = structuredClone(original);
        state.vaultGlobal.advancedSettings = {
          ...state.vaultGlobal.advancedSettings,
          refresh: true,
        };
        state.vault.activeNetwork.label =
          'Synthetic regional development network with a very long localized display name';
        for (let index = 0; index < 18; index += 1) {
          state.vaultGlobal.networks.syscoin[`synthetic-${index}`] = {
            chainId: 91000 + index,
            kind: 'syscoin',
            slip44: 1,
            default: false,
            key: `synthetic-${index}`,
            label: `Synthetic ${index} regional development network with a very long display name`,
            currency: 'TSYS',
            url: `https://synthetic-${index}.example/rpc`,
          };
        }
        return state;
      };
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        if (message?.type === 'getCurrentState') {
          if (typeof callback === 'function')
            return (send as any)(message, (state: any) =>
              callback(fixture(state))
            );
          return (send as any)(message).then(fixture);
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    await page.goto(wallet.appUrl('#/home'));
    await page
      .locator('#home-balance, #home-balance-pending')
      .first()
      .waitFor();
    for (const [width, height] of [
      [320, 360],
      [400, 360],
      [400, 480],
      [400, 600],
    ]) {
      await page.setViewportSize({ width, height });
      const button = page
        .locator('#network-settings-btn')
        .first()
        .locator('xpath=ancestor::button[1]');
      await expect(button).toContainText(
        'Synthetic regional development network'
      );
      const screenshot = path.join(output, `header-${width}x${height}.png`);
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach(`long-label-header-${width}x${height}`, {
        path: screenshot,
        contentType: 'image/png',
      });
      expect
        .soft(
          await exposed(button),
          'Long network name never obscures the menu trigger or right-hand actions'
        )
        .toBe(true);
      await button.focus();
      await page.keyboard.press('Space');
      const menu = page.locator('[role="menu"][data-headlessui-state="open"]');
      await expect(menu).toBeVisible();
      await menu
        .getByRole('menuitem', { name: en.networkMenu.utxoNetworks })
        .click();
      await menu.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(150);
      const last = menu.getByRole('menuitem', {
        name: en.networkMenu.manageNetworks,
      });
      expect
        .soft(
          await exposed(last),
          'Last menu action fits below a populated network list'
        )
        .toBe(true);
      const menuScreenshot = path.join(
        output,
        `expanded-${width}x${height}.png`
      );
      await page.screenshot({ path: menuScreenshot, animations: 'disabled' });
      await info.attach(`populated-network-menu-${width}x${height}`, {
        path: menuScreenshot,
        contentType: 'image/png',
      });
      await page.keyboard.press('Escape');
      await expect(button).toBeFocused();
    }
    await page.setViewportSize({ width: 320, height: 360 });
    await page.goto(wallet.appUrl('#/settings/networks/edit'));
    const networkList = page.locator(
      '[data-navigation-scroll="settings-manage-networks"]'
    );
    const remove = networkList
      .locator('li')
      .filter({ hasText: 'Synthetic 17 regional' })
      .getByRole('button')
      .last();
    await networkList.hover({ position: { x: 100, y: 50 } });
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(150);
    await remove.click(); // Opens confirmation only; never confirm removal.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirmationScreenshot = path.join(
      output,
      'remove-long-network-320x360.png'
    );
    await page.screenshot({
      path: confirmationScreenshot,
      animations: 'disabled',
    });
    await info.attach('remove-long-network-320x360', {
      path: confirmationScreenshot,
      contentType: 'image/png',
    });
    for (const action of await dialog.getByRole('button').all()) {
      await expect
        .poll(() => exposed(action), {
          message: 'Long-network removal confirmation actions fit',
        })
        .toBe(true);
    }
    const title = dialog.getByRole('heading');
    await expect(title).toContainText(
      'Synthetic 17 regional development network with a very long display name'
    );
    await wallet.step(
      'network-labels: review compact title and full body identity',
      async (capture) => {
        const name =
          'Synthetic 17 regional development network with a very long display name';
        const chain = `UTXO · ${en.settings.chainNumber.replace(
          '{{chainId}}',
          '91017'
        )}`;
        await expect(dialog).toHaveAccessibleName(
          en.settings.confirmRemoveNetwork.replace(
            '{{networkName}}',
            `${name} (${chain})`
          )
        );
        const visibleTitle = title.locator('[aria-hidden="true"]');
        await expect(visibleTitle).toHaveText(en.buttons.remove);
        const body = dialog.locator('header + div');
        const identity = body.locator(':scope > p');
        await expect(identity).toHaveText([name, chain]);
        const textExposure = (target: Locator) =>
          target.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const lines = [...range.getClientRects()].filter(
              (line) => line.width > 0 && line.height > 0
            );
            const clip = {
              left: 0,
              right: innerWidth,
              top: 0,
              bottom: innerHeight,
            };
            for (
              let node: Element | null = element;
              node;
              node = node.parentElement
            ) {
              const style = getComputedStyle(node);
              const box = node.getBoundingClientRect();
              if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
                clip.left = Math.max(clip.left, box.left + node.clientLeft);
                clip.right = Math.min(
                  clip.right,
                  box.left + node.clientLeft + node.clientWidth
                );
              }
              if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
                clip.top = Math.max(clip.top, box.top + node.clientTop);
                clip.bottom = Math.min(
                  clip.bottom,
                  box.top + node.clientTop + node.clientHeight
                );
              }
            }
            const vertical = (line: DOMRect) =>
              line.top >= clip.top - 0.5 && line.bottom <= clip.bottom + 0.5;
            return {
              horizontal:
                lines.length > 0 &&
                lines.every(
                  (line) =>
                    line.left >= clip.left - 0.5 &&
                    line.right <= clip.right + 0.5
                ),
              allVisible: lines.length > 0 && lines.every(vertical),
              firstVisible: lines.length > 0 && vertical(lines[0]),
              lastVisible:
                lines.length > 0 && vertical(lines[lines.length - 1]),
            };
          });
        const fixedControlsFit = async () => {
          expect(await exposed(visibleTitle)).toBe(true);
          expect(await textExposure(visibleTitle)).toMatchObject({
            horizontal: true,
            allVisible: true,
          });
          for (const action of await dialog.getByRole('button').all())
            expect(await exposed(action)).toBe(true);
        };
        await fixedControlsFit();
        // The long identity is in the body, not the compact visible heading.
        expect(
          await title.evaluate(
            (element) => element.scrollHeight <= element.clientHeight + 1
          )
        ).toBe(true);
        const geometry = await body.evaluate((element) => ({
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }));
        for (const paragraph of await identity.all())
          expect((await textExposure(paragraph)).horizontal).toBe(true);
        if (geometry.scrollHeight > geometry.clientHeight + 1) {
          await expect(body).toHaveAttribute('tabindex', '0');
          for (
            let index = 0;
            index < 8 &&
            !(await body.evaluate(
              (element) => element === document.activeElement
            ));
            index += 1
          )
            await page.keyboard.press('Tab');
          await expect(body).toBeFocused();
          await page.keyboard.press('End');
          await expect
            .poll(() =>
              body.evaluate(
                (element) =>
                  element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop
              )
            )
            .toBeLessThanOrEqual(1);
          expect((await textExposure(identity.last())).lastVisible).toBe(true);
          await fixedControlsFit();
          await page.keyboard.press('Home');
          await expect
            .poll(() => body.evaluate((element) => element.scrollTop))
            .toBe(0);
          expect((await textExposure(identity.first())).firstVisible).toBe(
            true
          );
          await fixedControlsFit();
        } else {
          for (const paragraph of await identity.all())
            expect((await textExposure(paragraph)).allVisible).toBe(true);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth
          )
        ).toBe(0);
        await info.attach('network-labels-confirmation-body-geometry', {
          body: JSON.stringify(geometry),
          contentType: 'application/json',
        });
        await capture(page);
      }
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.close();
    expect(routes.deniedWrites).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
      }
    }
  }
});
