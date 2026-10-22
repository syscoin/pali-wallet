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
    if (await control.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const selectByKeyboard = async (page: Page, menu: Locator, target: Locator) => {
  await expect(menu).toBeFocused();
  const first = menu.getByRole('menuitem').first();
  await expect(first).toHaveAttribute('data-headlessui-state', 'active');
  for (
    let index = 0;
    index < (await menu.getByRole('menuitem').count());
    index++
  ) {
    if ((await target.getAttribute('data-headlessui-state')) === 'active')
      break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(target).toHaveAttribute('data-headlessui-state', 'active');
  await expect
    .poll(
      async () =>
        (await menu.getAttribute('aria-activedescendant')) ===
        (await target.getAttribute('id'))
    )
    .toBe(true);
};

for (const feature of ['network', 'language'] as const) {
  test(`${feature} menu actions visibly identify keyboard selection without changing the selected value`, async ({}, info) => {
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NetworkLanguageFocusSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`${feature}-menu-focus`, {
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
        await page.setViewportSize({ width, height });
        const actions =
          feature === 'network'
            ? [
                {
                  name: en.networkMenu.noConnected,
                  route: '/settings/networks/connected-sites',
                },
                {
                  name: en.networkMenu.trustedSites,
                  route: '/settings/networks/trusted-sites',
                },
                {
                  name: en.networkMenu.customRpc,
                  route: '/settings/networks/custom-rpc',
                },
                {
                  name: en.networkMenu.manageNetworks,
                  route: '/settings/networks/edit',
                },
              ]
            : [{ name: 'Spanish Español', route: '' }];
        for (const action of actions) {
          await wallet.step(
            `keyboard ${feature} ${action.name} ${width}x${height}`,
            async () => {
              // Re-enter the language form from Home so an earlier unsaved
              // preview is not mistaken for a durable saved preference.
              if (feature === 'language') await wallet!.gotoRoute('#/home');
              await wallet!.gotoRoute(
                feature === 'network' ? '#/home' : '#/settings/languages'
              );
              const toggle =
                feature === 'network'
                  ? page.getByRole('button').filter({
                      has: page.locator('#network-settings-btn'),
                    })
                  : page.getByRole('button', {
                      name: en.settings.setYourPreferredLanguage,
                      exact: true,
                    });
              await toggle.click();
              const menu = page.getByRole('menu');
              const target =
                feature === 'network'
                  ? menu.getByRole('menuitem').filter({
                      has: page.getByText(action.name, { exact: true }),
                    })
                  : menu.getByRole('menuitem', {
                      name: action.name,
                      exact: true,
                    });
              await target.hover();
              await info.attach(`pointer-${feature}-${action.name}-${width}`, {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              await page.keyboard.press('Escape');
              await page.mouse.move(0, 0);
              await tabTo(page, toggle);
              await page.keyboard.press('ArrowDown');
              if (
                feature === 'network' &&
                action.name === en.networkMenu.noConnected
              ) {
                const group = menu.getByRole('menuitem', {
                  name: en.networkMenu.utxoNetworks,
                  exact: true,
                });
                await selectByKeyboard(page, menu, group);
                await expect(group).toHaveCSS(
                  'background-color',
                  'rgba(30, 54, 92, 0.3)'
                );
                await page.keyboard.press('Home');
              }
              await selectByKeyboard(page, menu, target);
              const originalBackground =
                feature === 'network' &&
                action.name === en.networkMenu.noConnected
                  ? 'rgb(215, 0, 0)'
                  : feature === 'network' &&
                    action.name === en.networkMenu.trustedSites
                  ? 'rgb(76, 161, 207)'
                  : 'rgba(0, 0, 0, 0)';
              await expect(target).toHaveCSS(
                'background-color',
                originalBackground
              );
              if (feature === 'language') {
                const selected = menu.getByRole('menuitem', {
                  name: 'English English',
                  exact: true,
                });
                await expect(selected).toHaveCSS(
                  'background-color',
                  'rgba(30, 54, 92, 0.2)'
                );
                await expect(selected).toContainText('✓');
                await expect(target).not.toContainText('✓');
              }
              await info.attach(`keyboard-${feature}-${action.name}-${width}`, {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              await info.attach(
                `active-style-${feature}-${action.name}-${width}`,
                {
                  body: JSON.stringify(
                    await target.evaluate((node) => {
                      const css = getComputedStyle(node);
                      return {
                        background: css.backgroundColor,
                        outline: css.outline,
                        state: node.getAttribute('data-headlessui-state'),
                      };
                    }),
                    null,
                    2
                  ),
                  contentType: 'application/json',
                }
              );
              await expect.soft
                .poll(() =>
                  target.evaluate((node) => {
                    const css = getComputedStyle(node);
                    return `${css.outlineWidth} ${css.outlineStyle}`;
                  })
                )
                .toBe('2px solid');
              await page.keyboard.press('Enter');
              if (feature === 'network') {
                await expect
                  .poll(() => new URL(page.url()).hash)
                  .toBe(`#${action.route}`);
              } else {
                await expect(toggle).toContainText('Spanish');
                await expect(
                  page.getByRole('button', {
                    name: en.buttons.save,
                    exact: true,
                  })
                ).toBeEnabled();
                await expect
                  .poll(() =>
                    page.evaluate(
                      () =>
                        new Promise((resolve) =>
                          chrome.storage.local.get(['language'], (value) =>
                            resolve(value.language ?? 'en')
                          )
                        )
                    )
                  )
                  .toBe('en');
              }
            }
          );
        }
      }
      expect(routes.deniedWrites).toEqual([]);
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
