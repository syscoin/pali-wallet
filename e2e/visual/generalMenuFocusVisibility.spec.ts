import { expect, test, type Locator, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 35; index++) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const appearance = (control: Locator) =>
  control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      outline: `${style.outlineWidth} ${style.outlineStyle}`,
      boxShadow: style.boxShadow,
      state: element.getAttribute('data-headlessui-state'),
    };
  });

test('ordinary menu actions show their keyboard selection in narrow and standard windows', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'MenuFocusSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('general-menu-focus', {
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
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ]) {
      for (const action of [
        {
          name: en.generalMenu.advanced,
          route: '/settings/advanced',
          last: true,
        },
        {
          name: en.accountMenu.createNewAccount,
          route: '/settings/account/new',
          last: false,
        },
        {
          name: en.sentry.sentryOperators,
          route: '/settings/sentry',
          last: false,
        },
      ]) {
        await wallet.step(
          `visible ${action.name} selection ${width}x${height}`,
          async () => {
            await page.setViewportSize({ width, height });
            const toggle = page.getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            });
            await toggle.click();
            const menu = page.getByRole('menu');
            const target = menu.getByRole('menuitem', {
              name: action.name,
              exact: true,
            });
            await target.hover();
            await info.attach(`mouse-menu-selection-${width}x${height}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            const mouse = await appearance(target);
            expect(mouse.background).not.toBe('rgba(0, 0, 0, 0)');
            await page.keyboard.press('Escape');
            await page.mouse.move(0, 0);
            await tabTo(page, toggle);
            await page.keyboard.press('ArrowDown');
            // Menu.Button schedules focus after opening; do not send End to the
            // still-focused toggle or sample the previous pointer selection.
            await expect(menu).toBeFocused();
            const first = menu.getByRole('menuitem').first();
            await expect(first).toHaveAttribute(
              'data-headlessui-state',
              'active'
            );
            await expect(first).toHaveCSS(
              'background-color',
              'rgba(30, 54, 92, 0.3)'
            );
            if (action.last) await page.keyboard.press('End');
            else {
              for (
                let index = 0;
                index < (await menu.getByRole('menuitem').count());
                index++
              ) {
                if (
                  (await target.getAttribute('data-headlessui-state')) ===
                  'active'
                )
                  break;
                await page.keyboard.press('ArrowDown');
              }
            }
            await expect
              .poll(
                async () =>
                  (await menu.getAttribute('aria-activedescendant')) ===
                  (await target.getAttribute('id'))
              )
              .toBe(true);
            await expect(target).toHaveAttribute(
              'data-headlessui-state',
              'active'
            );
            await info.attach(`keyboard-menu-selection-${width}x${height}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            const keyboard = await appearance(target);
            expect(keyboard.state).toBe('active');
            await info.attach(`menu-selection-styles-${width}x${height}`, {
              body: JSON.stringify({ mouse, keyboard }, null, 2),
              contentType: 'application/json',
            });
            expect.soft(keyboard.background).toBe(mouse.background);
            expect(keyboard.outline).toBe('2px solid');
            await page.keyboard.press('Enter');
            await expect
              .poll(() => new URL(page.url()).hash)
              .toBe(`#${action.route}`);
            await wallet!.gotoRoute('#/home');
          }
        );
      }
    }
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
