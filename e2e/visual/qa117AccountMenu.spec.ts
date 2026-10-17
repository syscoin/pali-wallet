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

const activeAccount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{
        address: string;
        id: number;
        label: string;
        switching: boolean;
      }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'getCurrentState' },
          ({ vault, vaultGlobal }) => {
            const ref = vault.activeAccount;
            const account = vault.accounts[ref.type][ref.id];
            resolve({
              id: ref.id,
              label: account.label,
              address: account.address,
              switching: !!vaultGlobal.isSwitchingAccount,
            });
          }
        );
      })
  );

const isActiveMenuItem = async (menu: Locator, item: Locator) => {
  // Account refreshes can replace menu nodes. Compare both current IDs in
  // the same poll rather than retaining an ID from an earlier render.
  const activeId = await menu.getAttribute('aria-activedescendant');
  return !!activeId && activeId === (await item.getAttribute('id'));
};

const tabTo = async (page: Page, control: Locator) => {
  for (let i = 0; i < 35; i++) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const exposed = (control: Locator) =>
  control.evaluate((element) => {
    const b = element.getBoundingClientRect();
    return (
      b.width >= 44 &&
      b.height >= 44 &&
      b.left >= 0 &&
      b.top >= 0 &&
      b.right <= innerWidth &&
      b.bottom <= innerHeight &&
      [
        [b.left + 2, b.top + b.height / 2],
        [b.right - 2, b.top + b.height / 2],
        [b.left + b.width / 2, b.top + 2],
        [b.left + b.width / 2, b.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || element.contains(hit);
      })
    );
  });

test('account dropdown supports keyboard selection and separate copy actions in narrow windows', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountMenuSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('qa117-account-menu', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 480 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    const page = wallet.page;
    const original = await activeAccount(page);
    await wallet.gotoRoute('#/settings/account/new');
    await page.locator('#account-name-input').fill('Beta keyboard account');
    await page.locator('#create-btn').click();
    await page.getByRole('button', { name: /^ok$/i }).click();
    await wallet.ensureOnHome();
    await expect
      .poll(() => activeAccount(page))
      .toMatchObject({ id: 1, switching: false });
    await page.evaluate(() => {
      (window as any).__qa117Copied = [];
      (window as any).__qa117DenyCopy = true;
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (text: string) => {
          (window as any).__qa117Copied.push(text);
          if ((window as any).__qa117DenyCopy)
            throw new DOMException(
              'Synthetic clipboard denial',
              'NotAllowedError'
            );
        },
      });
    });
    for (const width of [320, 400]) {
      await page.setViewportSize({ width, height: 360 });
      // Keep this a keyboard-only journey: the previous setup click leaves
      // the pointer where an animated menu row would otherwise appear.
      await page.mouse.move(0, 0);
      const menuButton = page.locator('#general-settings-button').locator('..');
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      const firstAccount = menu.getByRole('menuitem', {
        name: `${original.label} (${original.address})`,
        exact: true,
      });
      await expect(firstAccount).toBeVisible();
      await expect
        .poll(() =>
          menu.evaluate(
            (element) => element.getBoundingClientRect().bottom <= innerHeight
          )
        )
        .toBe(true);
      await expect(menuButton).toHaveAccessibleName(
        en.generalMenu.generalOptions
      );
      await expect.poll(() => isActiveMenuItem(menu, firstAccount)).toBe(true);
      await expect.poll(() => exposed(firstAccount)).toBe(true);
      await info.attach(`account-menu-keyboard-${width}x360`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await page.keyboard.press('Enter');
      await expect
        .poll(() => activeAccount(page))
        .toMatchObject({ id: 0, switching: false });
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => isActiveMenuItem(menu, firstAccount)).toBe(true);
      await page.keyboard.type('Beta');
      const beta = menu.getByRole('menuitem', {
        name: /^Beta keyboard account \(/,
      });
      await expect.poll(() => isActiveMenuItem(menu, beta)).toBe(true);
      await page.keyboard.press('Enter');
      await expect
        .poll(() => activeAccount(page))
        .toMatchObject({ id: 1, switching: false });
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => isActiveMenuItem(menu, firstAccount)).toBe(true);
      await page.keyboard.press('End');
      const lastAction = menu.getByRole('menuitem', {
        name: en.generalMenu.advanced,
        exact: true,
      });
      await expect.poll(() => isActiveMenuItem(menu, lastAction)).toBe(true);
      await expect
        .poll(() =>
          lastAction.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2
            );
            return (
              bounds.top >= 0 &&
              bounds.bottom <= innerHeight &&
              !!hit &&
              (hit === element || element.contains(hit))
            );
          })
        )
        .toBe(true);
      await info.attach(`account-menu-last-action-${width}x360`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await page.keyboard.press('Escape');
      if (width !== 320) continue;
      // Copy is an independent menu action, not a click on the account row.
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => isActiveMenuItem(menu, firstAccount)).toBe(true);
      await page.keyboard.press('ArrowDown');
      const copyFirst = menu.getByRole('menuitem', {
        name: `${en.buttons.copy}: ${original.label}`,
        exact: true,
      });
      await expect.poll(() => isActiveMenuItem(menu, copyFirst)).toBe(true);
      await expect.poll(() => exposed(copyFirst)).toBe(true);
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(en.transactions.copyFailed, { exact: true })
      ).toBeVisible();
      expect((await activeAccount(page)).id).toBe(1);
      await page.evaluate(() => {
        (window as any).__qa117DenyCopy = false;
      });
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => isActiveMenuItem(menu, firstAccount)).toBe(true);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(en.home.addressCopied, { exact: true })
      ).toBeVisible();
      expect((await activeAccount(page)).id).toBe(1);
      expect(
        await page.evaluate(() => (window as any).__qa117Copied.slice(-2))
      ).toEqual([original.address, original.address]);
      await page.evaluate(() => {
        (window as any).__qa117DenyCopy = true;
      });
    }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
