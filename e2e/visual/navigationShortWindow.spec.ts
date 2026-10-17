import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// A centered hit test misses a footer covering only the bottom of a control.
const fullyExposed = (control: Locator) =>
  control.evaluate((element) => {
    const b = element.getBoundingClientRect();
    if (
      b.width <= 0 ||
      b.height <= 0 ||
      b.left < 0 ||
      b.top < 0 ||
      b.right > innerWidth ||
      b.bottom > innerHeight
    )
      return false;
    return [
      [b.left + 2, b.top + b.height / 2],
      [b.right - 2, b.top + b.height / 2],
      [b.left + b.width / 2, b.top + 2],
      [b.left + b.width / 2, b.bottom - 2],
      [b.left + b.width / 2, b.top + b.height / 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });
const reveal = async (page: Page, control: Locator) => {
  await page.mouse.move(200, 140);
  for (const delta of [0, -4000, 120, 120, 120, 120, 120, 4000]) {
    if (delta) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(100);
    }
    if (await fullyExposed(control)) return;
  }
  expect(
    await fullyExposed(control),
    `Covered after native scrolling: ${await control.innerText()}`
  ).toBe(true);
};

test('short-window navigation keeps actions, instructions and errors unobscured', async ({}, info) => {
  test.setTimeout(180_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NavigationSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const output = path.join(E2E_CONFIG.artifactsDir, 'navigation-short-window');
  fs.mkdirSync(output, { recursive: true });
  const records: unknown[] = [];
  const capture = async (page: Page, name: string) => {
    const file = path.join(output, `${name}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    await info.attach(name, { path: file, contentType: 'image/png' });
    records.push({
      name,
      state: await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        scrolls: [...document.querySelectorAll('*')]
          .filter(
            (e) =>
              e.scrollHeight > e.clientHeight + 2 &&
              /auto|scroll/.test(getComputedStyle(e).overflowY)
          )
          .map((e) => ({
            tag: e.tagName,
            id: e.id,
            cls: e.className,
            y: e.scrollTop,
            client: e.clientHeight,
            scroll: e.scrollHeight,
          })),
        controls: [...document.querySelectorAll('button, input, a')]
          .map((e) => {
            const r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(
              r.left + r.width / 2,
              r.top + r.height / 2
            );
            return {
              tag: e.tagName,
              text: e.textContent,
              id: e.id,
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              exposed: !!hit && (e === hit || e.contains(hit)),
            };
          })
          .filter((e) => e.w > 0 && e.h > 0),
      })),
    });
  };
  try {
    wallet = await PaliWallet.launch('navigation-short-window', {
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
    for (const route of [
      'settings/about',
      'settings/remove-eth',
      'settings/networks/connected-sites',
      'receive',
      'settings/networks/custom-rpc',
      'settings/networks/edit',
      'settings/networks/trusted-sites',
      'external/settings/account/hardware',
    ]) {
      await wallet.gotoRoute(`#/${route}`);
      await wallet.page.waitForTimeout(350);
      for (const height of [360, 480, 620]) {
        await wallet.page.setViewportSize({ width: 400, height });
        await wallet.page.mouse.move(200, 180);
        await wallet.page.mouse.wheel(0, -4000);
        await wallet.page.waitForTimeout(100);
        await capture(
          wallet.page,
          `${route.replaceAll('/', '-')}-${height}-top`
        );
        if (route.endsWith('/hardware')) {
          expect(
            await fullyExposed(
              wallet.page.getByText(en.settings.optimalExperience, {
                exact: true,
              })
            ),
            'Top hardware instructions are reachable without negative overflow'
          ).toBe(true);
        }
        await wallet.page.mouse.wheel(0, 4000);
        await wallet.page.waitForTimeout(150);
        await capture(
          wallet.page,
          `${route.replaceAll('/', '-')}-${height}-bottom`
        );
        if (route === 'settings/about') {
          await reveal(
            wallet.page,
            wallet.page.getByRole('button', { name: 'Pali API', exact: true })
          );
          await reveal(
            wallet.page,
            wallet.page.locator('#copy-address-btn').locator('..')
          );
          await reveal(
            wallet.page,
            wallet.page.getByRole('link', { name: 'Token data by Routescan' })
          );
        } else if (route === 'settings/remove-eth') {
          await reveal(
            wallet.page,
            wallet.page.getByRole('button', {
              name: 'Set Metamask as default wallet',
              exact: true,
            })
          );
        } else if (route === 'receive') {
          await reveal(wallet.page, wallet.page.locator('#qr-code'));
          await reveal(
            wallet.page,
            wallet.page.getByRole('button', {
              name: en.buttons.copy,
              exact: true,
            })
          );
        } else if (route.endsWith('/hardware')) {
          await reveal(wallet.page, wallet.page.locator('#trezor-btn'));
          await reveal(wallet.page, wallet.page.locator('#ledger-btn'));
          await reveal(
            wallet.page,
            wallet.page.getByRole('button', {
              name: en.buttons.cancel,
              exact: true,
            })
          );
        }
      }
    }
    await wallet.gotoRoute('#/home');
    await wallet.page.setViewportSize({ width: 400, height: 360 });
    await wallet.page.locator('#network-settings-btn').first().click();
    await wallet.page.mouse.move(200, 180);
    await wallet.page.mouse.wheel(0, 4000);
    await wallet.page.waitForTimeout(150);
    await capture(wallet.page, 'network-menu-360-bottom');
    await wallet.page.keyboard.press('Escape');
    // Renderer-only fixture: a long public connected-site list. Nothing is
    // connected or disconnected in the background wallet.
    const listPage = await wallet.context.newPage();
    await listPage.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const fixture = (state: any) => {
        if (!state?.dapp) return state;
        const result = structuredClone(state);
        result.dapp.dapps = Object.fromEntries(
          Array.from({ length: 24 }, (_, id) => {
            const host = `https://synthetic-${String(id).padStart(
              2,
              '0'
            )}.example`;
            return [
              host,
              {
                host,
                accountId: 0,
                accountType: 'HDAccount',
                chain: 'syscoin',
                chainId: 57,
                date: 0,
              },
            ];
          })
        );
        if (location.hash === '#/faucet') {
          result.vault.activeNetwork = {
            chainId: 5700,
            currency: 'TSYS',
            kind: 'ethereum',
            label: 'Offline faucet layout',
            slip44: 60,
            url: 'http://127.0.0.1:1',
          };
          result.vault.isBitcoinBased = false;
          result.vaultGlobal.activeSlip44 = 60;
        }
        return result;
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
    await listPage.goto(wallet.appUrl('#/settings/networks/connected-sites'));
    await expect(
      listPage.getByText('24 sites are connected to Pali Wallet')
    ).toBeVisible();
    for (const height of [360, 480, 620]) {
      await listPage.setViewportSize({ width: 400, height });
      const list = listPage.locator(
        '[data-navigation-scroll="settings-connected-sites"]'
      );
      await list.hover();
      await listPage.mouse.wheel(0, 4000);
      await listPage.waitForTimeout(150);
      const lastEdit = list
        .getByRole('button', { name: en.settings.editConnection })
        .last();
      await reveal(listPage, lastEdit);
      expect(
        await fullyExposed(lastEdit),
        'Last site Edit stays above the Close footer'
      ).toBe(true);
      await lastEdit.click();
      const dialog = listPage.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(
        await fullyExposed(
          dialog
            .getByRole('button', { name: en.buttons.close, exact: true })
            .last()
        )
      ).toBe(true);
      await listPage.keyboard.press('Escape');
      await reveal(
        listPage,
        listPage
          .getByRole('button', { name: en.buttons.close, exact: true })
          .last()
      );
      await capture(listPage, `connected-populated-${height}`);
    }
    await wallet.context.route(
      'https://chains.tools/api/faucet/claim?**',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              status: false,
              message:
                'The synthetic faucet is temporarily unavailable. Please try again later. No tokens were requested and no network transaction was submitted.',
            },
          }),
        })
    );
    for (const height of [360, 480, 620]) {
      await listPage.goto('about:blank');
      await listPage.goto(wallet.appUrl('#/faucet'));
      await listPage.setViewportSize({ width: 400, height });
      const request = listPage.getByRole('button', {
        name: en.faucet.requestNow,
        exact: true,
      });
      await reveal(listPage, request);
      await request.click();
      const feedback = listPage.getByText(
        'The synthetic faucet is temporarily unavailable.',
        { exact: false }
      );
      await expect(feedback).toBeVisible();
      await reveal(listPage, feedback);
      await reveal(
        listPage,
        listPage.getByRole('button', {
          name: en.faucet.grabTokens,
          exact: true,
        })
      );
      await capture(listPage, `faucet-error-${height}`);
    }
    await listPage.close();
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    fs.writeFileSync(
      path.join(output, 'audit.json'),
      JSON.stringify(records, null, 2)
    );
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
