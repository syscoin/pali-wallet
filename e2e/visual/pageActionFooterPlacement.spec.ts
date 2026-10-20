import { chromium, expect, test, type Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';

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
    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.left < 0 ||
      box.top < 0 ||
      box.right > innerWidth ||
      box.bottom > innerHeight
    )
      return false;
    return [
      [box.left + 2, box.top + box.height / 2],
      [box.right - 2, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + 2],
      [box.left + box.width / 2, box.bottom - 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });

test('shared page actions stay bottom-aligned and reachable across wallet screens', async ({}, info) => {
  test.setTimeout(180_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'FooterPlacementSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const directory = path.join(E2E_CONFIG.artifactsDir, 'page-action-footer');
  fs.mkdirSync(directory, { recursive: true });
  const records: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('page-action-footer', {
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
    for (const height of [360, 480, 620]) {
      await page.setViewportSize({ width: 400, height });
      for (const route of [
        'settings/account/new',
        'settings/account/import',
        'settings/manage-accounts',
        'settings/networks/connected-sites',
        'settings/about',
        'settings/remove-eth',
        'settings/advanced',
        'settings/languages',
        'settings/currency',
        'settings/forget-wallet',
        'settings/seed',
        'faucet',
      ]) {
        await wallet.gotoRoute('#/home');
        await wallet.gotoRoute(`#/${route}`);
        const footer = page.locator('[data-page-action-footer]');
        await expect(footer).toHaveCount(1);
        const action = footer.getByRole('button').last();
        await page.mouse.move(200, 180);
        await page.mouse.wheel(0, 4000);
        // Native wheel delivery/compositor updates finish asynchronously.
        await page.waitForTimeout(300);
        for (const button of await footer.getByRole('button').all()) {
          await expect.poll(() => exposed(button)).toBe(true);
        }
        const bounds = (await action.boundingBox())!;
        const gap = height - bounds.y - bounds.height;
        records.push({ route, height, gap, bounds });
        expect
          .soft(gap, `${route}: action retains bottom padding at400x${height}`)
          .toBeGreaterThanOrEqual(16);
        expect
          .soft(gap, `${route}: action stays near the bottom at400x${height}`)
          .toBeLessThanOrEqual(80);
        const screenshot = path.join(
          directory,
          `${route.replaceAll('/', '-')}-${height}.png`
        );
        await page.screenshot({
          path: screenshot,
          animations: 'disabled',
          mask: [page.locator('input[type=password],textarea')],
        });
        await info.attach(`${route}-${height}`, {
          path: screenshot,
          contentType: 'image/png',
        });
      }
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/manage-accounts');
      await page
        .locator('[data-navigation-scroll="settings-manage-accounts"] li')
        .first()
        .getByRole('button')
        .first()
        .click();
      const footer = page.locator('[data-page-action-footer]');
      await expect(footer).toHaveCount(1);
      await page.mouse.move(200, 180);
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(300);
      const save = footer.getByRole('button').last();
      await expect.poll(() => exposed(save)).toBe(true);
      const bounds = (await save.boundingBox())!;
      expect
        .soft(
          height - bounds.y - bounds.height,
          `edit account: bottom at${height}`
        )
        .toBeLessThanOrEqual(80);

      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/account/new');
      const message =
        'The synthetic account could not be created. Please check the account details and try again. No account was created and no transaction was sent.';
      await page.evaluate((fixtureMessage) => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = ((...args: any[]) => {
          if (
            args[0]?.type === 'CONTROLLER_ACTION' &&
            args[0]?.data?.methods?.[1] === 'createAccount'
          ) {
            if (typeof args[1] === 'function') {
              queueMicrotask(() => args[1]({ error: fixtureMessage }));
              return;
            }
            return Promise.resolve({ error: fixtureMessage });
          }
          return (original as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        (window as any).__restoreFooterFixture = () => {
          chrome.runtime.sendMessage = original;
        };
      }, message);
      await page
        .locator('#account-name-input')
        .fill('Synthetic account layout');
      await page.locator('#create-btn').click();
      const error = page.getByRole('alert').filter({ hasText: message });
      await expect(error).toBeVisible();
      await page.mouse.move(200, 180);
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(300);
      await expect.poll(() => exposed(page.locator('#create-btn'))).toBe(true);
      await expect.poll(() => exposed(error)).toBe(true);
      const errorBottom = (await error.boundingBox())!;
      const buttonTop = (await page.locator('#create-btn').boundingBox())!;
      expect(errorBottom.y + errorBottom.height).toBeLessThanOrEqual(
        buttonTop.y
      );
      const screenshot = path.join(directory, `create-error-${height}.png`);
      await page.screenshot({ path: screenshot, animations: 'disabled' });
      await info.attach(`create-error-${height}`, {
        path: screenshot,
        contentType: 'image/png',
      });
      await page.evaluate(() => (window as any).__restoreFooterFixture());
    }
    expect(routes.deniedWrites).toEqual([]);
    if (test.info().errors.length === 0) status = 'passed';
  } finally {
    try {
      await info.attach('footer-geometry', {
        body: JSON.stringify(records, null, 2),
        contentType: 'application/json',
      });
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
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});

test('native toolbar Create action is anchored to the actual Chrome popup bottom', async ({}, info) => {
  test.setTimeout(90_000);
  const directory = path.join(
    E2E_CONFIG.artifactsDir,
    'page-action-footer-native'
  );
  fs.mkdirSync(directory, { recursive: true });
  const profile = fs.mkdtempSync(path.join(directory, 'profile-'));
  const server = await startUtxoFixtureServer();
  const extensionPath =
    process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath;
  const context = await chromium.launchPersistentContext(profile, {
    args: [
      ...(E2E_CONFIG.headless
        ? ['--headless=new', '--screen-info={0,0 1280x900}']
        : []),
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-quic',
      '--window-size=1280,900',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
    ],
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    proxy: { server: server.url, bypass: '<-loopback>' },
    viewport: null,
  });
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).hostname;
    const port = fs
      .readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8')
      .split('\n')[0];
    if (!/^\d{1,5}$/.test(port))
      throw new Error('Invalid owned popup CDP port');
    await worker.evaluate(() => chrome.action.openPopup());
    const adopted = (
      await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    ).contexts()[0];
    const routes = await installUtxoFixtureRoutes(
      adopted,
      createUtxoFixture(),
      server.url
    );
    const page = adopted
      .pages()
      .find((p) => p.url().startsWith(`chrome-extension://${id}/app.html`));
    if (!page) throw new Error('Missing native toolbar popup');
    await page.locator('body.app-loaded').waitFor();
    expect(page.viewportSize()).toBeNull();
    expect(
      await page.evaluate(() =>
        chrome.extension.getViews({ type: 'popup' }).includes(window)
      )
    ).toBe(true);
    await page.locator('#import-wallet-link').click();
    await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
    await page.locator('#import-wallet-action').click();
    await expect(page).toHaveURL(/create-password-import/);
    await page.locator('#create-password').fill('NativeFooterSynthetic!2026');
    await page.locator('#confirm-password').fill('NativeFooterSynthetic!2026');
    await page.locator('#create-password-action').click();
    await expect(page).toHaveURL(/#\/home/, { timeout: 60_000 });
    await page.goto(`chrome-extension://${id}/app.html#/settings/account/new`);
    await expect(page.locator('#create-btn')).toBeVisible();
    await page.mouse.move(200, 180);
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(300);
    await expect.poll(() => exposed(page.locator('#create-btn'))).toBe(true);
    const measured = await page.locator('#create-btn').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        height: innerHeight,
        gap: innerHeight - bounds.bottom,
        top: bounds.top,
        bottom: bounds.bottom,
      };
    });
    const screenshot = path.join(directory, 'native-create-account.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    const afterCapture = await page
      .locator('#create-btn')
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          height: innerHeight,
          gap: innerHeight - bounds.bottom,
          top: bounds.top,
          bottom: bounds.bottom,
          document: document.documentElement.getBoundingClientRect().toJSON(),
          body: document.body.getBoundingClientRect().toJSON(),
          layout: document
            .querySelector('[data-navigation-scroll="wallet-layout"]')!
            .getBoundingClientRect()
            .toJSON(),
          scroll: document.querySelector(
            '[data-navigation-scroll="wallet-layout"]'
          )!.scrollTop,
          windowScroll: scrollY,
          visualViewport: visualViewport && {
            height: visualViewport.height,
            offsetTop: visualViewport.offsetTop,
            pageTop: visualViewport.pageTop,
            scale: visualViewport.scale,
          },
          input: document
            .querySelector('#account-name-input')!
            .getBoundingClientRect()
            .toJSON(),
        };
      });
    fs.writeFileSync(
      path.join(directory, 'native-create-account-geometry.json'),
      JSON.stringify({ beforeCapture: measured, afterCapture }, null, 2)
    );
    await info.attach('native-create-account', {
      path: screenshot,
      contentType: 'image/png',
    });
    await info.attach('native-create-account-geometry', {
      body: JSON.stringify({ beforeCapture: measured, afterCapture }, null, 2),
      contentType: 'application/json',
    });
    expect(measured.height).toBeGreaterThanOrEqual(600);
    expect(measured.gap).toBeGreaterThanOrEqual(16);
    expect(measured.gap).toBeLessThanOrEqual(80);
    expect(afterCapture.gap).toBeLessThanOrEqual(80);
    // A wheel on a sparse page must not escape to the 620px intrinsic
    // document and clip the native popup's header by its 20px size cap.
    expect(afterCapture.windowScroll).toBe(0);
    expect(afterCapture.layout.top).toBe(0);
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
