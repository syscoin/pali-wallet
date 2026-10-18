import { expect, test, type Locator, type Page } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
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
      b.height >= 38 &&
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
      const copyOriginal = menu.getByRole('menuitem', {
        name: `${en.buttons.copy}: ${original.label}`,
        exact: true,
      });
      await expect.poll(() => exposed(copyOriginal)).toBe(true);
      const activeSelection = menu.locator('button[aria-current="true"]');
      await expect(activeSelection).toHaveCount(1);
      const alignment = await activeSelection.evaluate((button) => {
        const row = button.closest('li')!;
        const badge = button.querySelector('span.rounded-full')!;
        const check = badge.querySelector('svg')!;
        const badgeBounds = badge.getBoundingClientRect();
        const checkBounds = check.getBoundingClientRect();
        const textNodes = document.createTreeWalker(
          badge,
          NodeFilter.SHOW_TEXT
        );
        let label: Node | null = null;
        while ((label = textNodes.nextNode())) {
          if (label.textContent?.trim()) break;
        }
        if (!label) throw new Error('Account badge has no visible label');
        const range = document.createRange();
        range.selectNodeContents(label);
        const labelBounds = range.getBoundingClientRect();
        const center = (bounds: DOMRect) => bounds.top + bounds.height / 2;
        return {
          rowHeight: row.getBoundingClientRect().height,
          checkOffset: center(checkBounds) - center(badgeBounds),
          labelOffset: center(labelBounds) - center(badgeBounds),
          checkToLabelOffset: center(checkBounds) - center(labelBounds),
        };
      });
      expect.soft(alignment.rowHeight).toBeCloseTo(38, 1);
      expect.soft(Math.abs(alignment.checkOffset)).toBeLessThanOrEqual(0.25);
      // Text ink has font-specific ascender/descender metrics; keep it
      // optically close without imposing a fractional-pixel translation.
      expect.soft(Math.abs(alignment.labelOffset)).toBeLessThanOrEqual(1);
      expect
        .soft(Math.abs(alignment.checkToLabelOffset))
        .toBeLessThanOrEqual(1);
      await info.attach(`account-menu-alignment-${width}x360`, {
        body: JSON.stringify(alignment, null, 2),
        contentType: 'application/json',
      });
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
      await page.keyboard.press('Home');
      await expect.poll(() => isActiveMenuItem(menu, firstAccount)).toBe(true);
      await expect.poll(() => exposed(firstAccount)).toBe(true);
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

test('a long smart-account menu keeps bottom actions reachable by keyboard and scrolling', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'LongSmartMenuSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('qa117-long-smart-menu', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 480 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const address = (id: number) =>
        `0x${(id + 1).toString(16).padStart(40, '0')}`;
      const metadata = {
        auth: { validator: address(99), module: 'ecdsa', data: '0x' },
        chainId: 5700,
        isDeployed: true,
        installedModules: [],
      };
      (window as any).__qa117MenuMutations = [];
      const transform = (state: any) => {
        if (!state?.vault) return state;
        const value = structuredClone(state);
        value.vault.accounts.SmartAccount = Object.fromEntries(
          Array.from({ length: 24 }, (_, id) => [
            id,
            {
              id,
              type: 'SmartAccount',
              isSmartAccount: true,
              address: address(id),
              label: `Synthetic smart account ${id + 1} with a long label`,
              smartAccount: metadata,
              balances: { ethereum: 0, syscoin: 0 },
            },
          ])
        );
        value.vault.activeAccount = { id: 0, type: 'SmartAccount' };
        value.vault.activeNetwork = {
          chainId: 5700,
          kind: 'ethereum',
          currency: 'TSYS',
          label: 'Synthetic',
          url: 'https://rpc.tanenbaum.io',
          slip44: 60,
        };
        value.vault.isBitcoinBased = false;
        value.vaultGlobal.activeSlip44 = 60;
        value.vaultGlobal.networkStatus = 'connected';
        value.vaultGlobal.isSwitchingAccount = false;
        return value;
      };
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        const reply = (value: any) =>
          typeof callback === 'function'
            ? queueMicrotask(() => callback(value))
            : Promise.resolve(value);
        if (message?.type === 'getCurrentState')
          return typeof callback === 'function'
            ? (send as any)(message, (state: any) => callback(transform(state)))
            : (send as any)(message).then(transform);
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.[0] === 'wallet'
        ) {
          const method = message.data.methods[1];
          if (method === 'hydrateSmartAccount') return reply(metadata);
          if (
            /^(?:setAccount|sign|send|deploy|install|uninstall|rotate|add|remove|register|start|finalize|prepare)/i.test(
              method
            )
          ) {
            (window as any).__qa117MenuMutations.push(method);
            return reply({ error: 'Synthetic menu fixture forbids mutation' });
          }
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
      const add = chrome.runtime.onMessage.addListener.bind(
        chrome.runtime.onMessage
      );
      const remove = chrome.runtime.onMessage.removeListener.bind(
        chrome.runtime.onMessage
      );
      const wrappers = new Map<any, any>();
      chrome.runtime.onMessage.addListener = (listener: any) => {
        const wrapper = (message: any, ...rest: any[]) => {
          if (message?.type === 'CONTROLLER_STATE_CHANGE')
            return listener(
              { ...message, data: transform(message.data) },
              ...rest
            );
          if (
            [
              'CONTROLLER_ACCOUNTS_CHANGE',
              'CONTROLLER_ACTIVE_ACCOUNT_CHANGE',
              'CONTROLLER_NETWORK_CHANGE',
              'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
            ].includes(message?.type)
          )
            return false;
          return listener(message, ...rest);
        };
        wrappers.set(listener, wrapper);
        add(wrapper);
      };
      chrome.runtime.onMessage.removeListener = (listener: any) => {
        remove(wrappers.get(listener) || listener);
        wrappers.delete(listener);
      };
    });
    await page.reload();
    await wallet.ensureOnHome();
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await page.mouse.move(0, 0);
      const menuButton = page.locator('#general-settings-button').locator('..');
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      const first = menu.getByRole('menuitem').first();
      await expect.poll(() => isActiveMenuItem(menu, first)).toBe(true);
      await expect(menu.locator('[id^="account-SmartAccount-"]')).toHaveCount(
        24
      );
      await expect(first).toHaveAccessibleName(/Smart Account$/);
      const smartBadge = first.getByTitle('Smart Account', { exact: true });
      await expect(smartBadge).toHaveText('Smart');
      expect(
        await smartBadge.evaluate((node) => {
          const style = getComputedStyle(node);
          const label = node.previousElementSibling!;
          return (
            style.fontSize === '12px' &&
            style.paddingLeft === '4px' &&
            style.paddingRight === '4px' &&
            node.getBoundingClientRect().width < 80 &&
            label.getBoundingClientRect().width >= 100
          );
        })
      ).toBe(true);
      expect(
        await menu.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const scrollport = node.firstElementChild!;
          return (
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            scrollport.scrollHeight > scrollport.clientHeight * 3 &&
            scrollport.scrollWidth <= scrollport.clientWidth
          );
        })
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(
          `24-smart-accounts-top-${viewport.width}x${viewport.height}.png`
        ),
        animations: 'disabled',
      });
      await page.keyboard.press('End');
      const advanced = menu.getByRole('menuitem', {
        name: en.generalMenu.advanced,
        exact: true,
      });
      await expect.poll(() => isActiveMenuItem(menu, advanced)).toBe(true);
      await expect
        .poll(() =>
          advanced.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2
            );
            return (
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              !!hit &&
              (hit === node || node.contains(hit))
            );
          })
        )
        .toBe(true);
      await info.attach(
        `24-smart-accounts-keyboard-end-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        }
      );
      await page.keyboard.press('Home');
      await expect.poll(() => isActiveMenuItem(menu, first)).toBe(true);
      await first.hover();
      await page.mouse.wheel(0, 8000);
      await expect
        .poll(() =>
          menu.evaluate((node) => {
            const scrollport = node.firstElementChild!;
            return (
              scrollport.scrollTop + scrollport.clientHeight >=
              scrollport.scrollHeight - 2
            );
          })
        )
        .toBe(true);
      await advanced.click();
      await expect(page).toHaveURL(/#\/settings\/advanced$/);
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
      await page.mouse.move(0, 0);
      await tabTo(page, menuButton);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => isActiveMenuItem(menu, first)).toBe(true);
      await page.keyboard.type('Import');
      const importAccount = menu.getByRole('menuitem', {
        name: en.accountMenu.importAccount,
        exact: true,
      });
      await expect.poll(() => isActiveMenuItem(menu, importAccount)).toBe(true);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#\/settings\/account\/import$/);
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
    }
    expect(
      await page.evaluate(() => (window as any).__qa117MenuMutations)
    ).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
