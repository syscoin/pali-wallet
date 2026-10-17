import { type Locator, type Page, expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const exposed = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
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
      const p = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, p.left + parent.clientLeft);
        clip.right = Math.min(
          clip.right,
          p.left + parent.clientLeft + parent.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, p.top + parent.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          p.top + parent.clientTop + parent.clientHeight
        );
      }
    }
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.left < clip.left - 0.5 ||
      box.top < clip.top - 0.5 ||
      box.right > clip.right + 0.5 ||
      box.bottom > clip.bottom + 0.5
    )
      return false;
    return [
      [box.left + box.width / 2, box.top + 2],
      [box.left + box.width / 2, box.bottom - 2],
      [box.left + 2, box.top + box.height / 2],
      [box.right - 2, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + box.height / 2],
    ].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === element || element.contains(hit));
    });
  });

test('account label validation remains visible at short heights', async ({}, info) => {
  test.setTimeout(90_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLayoutSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('account-label-short-window', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const page = wallet.page;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    for (const height of [360, 480, 620]) {
      await page.setViewportSize({ width: 400, height });
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/manage-accounts');
      await page
        .locator('[data-navigation-scroll="settings-manage-accounts"] li')
        .first()
        .getByRole('button')
        .first()
        .click();
      const label = page.getByPlaceholder(en.settings.accountLabel);
      await wheelTo(page, label);
      const save = page.getByRole('button', {
        name: en.buttons.save,
        exact: true,
      });
      await wheelTo(page, save);
      await save.click();
      const error = page.getByText(
        'Label must be non-empty and different from current label',
        { exact: true }
      );
      await expect(error).toBeVisible();
      await info.attach(`account-label-error-${height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      expect
        .soft(await exposed(error), `Label validation visible at400x${height}`)
        .toBe(true);
      expect
        .soft(await exposed(save), `Save visible at400x${height}`)
        .toBe(true);
    }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('backup and private-key errors remain readable without exporting secrets', async ({}, info) => {
  test.setTimeout(90000);
  const before = { ...E2E_CONFIG },
    server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLayoutSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('account-secrets-short-window', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
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
        const [request, callback] = args;
        if (
          request?.type === 'CONTROLLER_ACTION' &&
          request.data?.methods?.[0] === 'wallet' &&
          ['getSeed', 'getPrivateKeyByAccountId'].includes(
            request.data.methods[1]
          )
        ) {
          const result = { error: 'Invalid password' };
          if (typeof callback === 'function') {
            queueMicrotask(() => callback(result));
            return;
          }
          return Promise.resolve(result);
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    for (const route of ['settings/seed', 'settings/account/private-key'])
      for (const height of [360, 480, 620]) {
        await page.setViewportSize({ width: 400, height });
        await wallet.gotoRoute('#/home');
        await wallet.gotoRoute('#/' + route);
        const password = page.locator('input[type=password]');
        await password.fill('WrongSyntheticPassword');
        const confirm = page.getByRole('button', {
          name: 'Confirm',
          exact: true,
        });
        await wheelTo(page, confirm);
        await confirm.click();
        const error = page.getByText(en.start.wrongPassword, { exact: true });
        await expect(error).toBeVisible();
        await page.mouse.move(0, 0);
        await info.attach(`${route.split('/').pop()}-error-${height}`, {
          body: await page.screenshot({
            animations: 'disabled',
            mask: [page.locator('input,textarea')],
          }),
          contentType: 'image/png',
        });
        expect
          .soft(
            await exposed(error),
            `${route}: authentication error unobscured at400x${height}`
          )
          .toBe(true);
        expect
          .soft(
            await exposed(confirm),
            `${route}: retry authentication control unobscured at400x${height}`
          )
          .toBe(true);
      }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('account management retains access to the last row in short windows', async ({}, info) => {
  test.setTimeout(90000);
  const before = { ...E2E_CONFIG },
    server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLayoutSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('manage-accounts-short-window', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const page = wallet.page;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    for (let n = 0; n < 5; n++) {
      await wallet.gotoRoute('#/settings/account/new');
      await page.locator('#account-name-input').fill('Layout Account ' + n);
      await page.locator('#create-btn').click();
      await page.getByRole('button', { name: 'Ok', exact: true }).click();
      await wallet.ensureOnHome();
    }
    for (const height of [360, 480, 620]) {
      await page.setViewportSize({ width: 400, height });
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/manage-accounts');
      const list = page.locator(
        '[data-navigation-scroll="settings-manage-accounts"]'
      );
      await list.hover({ position: { x: 180, y: 80 } });
      await page.mouse.wheel(0, 1500);
      await page.evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          )
      );
      const row = page.locator('li').filter({ hasText: 'Layout Account 4' });
      await info.attach(`manage-last-row-${height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      expect
        .soft(
          await exposed(row.getByRole('button').first()),
          `Last account edit button reachable after scrolling at400x${height}`
        )
        .toBe(true);
    }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
const wheelTo = async (page: Page, control: Locator) => {
  await page.mouse.move(200, 180);
  for (let n = 0; n < 5 && !(await exposed(control)); n++) {
    const box = await control.boundingBox();
    await page.mouse.wheel(0, box && box.y < 0 ? -300 : 300);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
  }
  expect(await exposed(control)).toBe(true);
};

test('account creation errors keep the action and error exposed in short windows', async ({}, info) => {
  test.setTimeout(90000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AccountLayoutSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('account-creation-short-window', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const page = wallet.page;
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const failure =
      'Account creation failed. Check your connection and try again.';
    await page.evaluate((message) => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [request, callback] = args;
        if (
          request?.type === 'CONTROLLER_ACTION' &&
          request.data?.methods?.[0] === 'wallet' &&
          request.data.methods[1] === 'createAccount'
        ) {
          const result = { error: message };
          if (typeof callback === 'function') {
            queueMicrotask(() => callback(result));
            return;
          }
          return Promise.resolve(result);
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    }, failure);
    for (const height of [360, 480, 620]) {
      await page.setViewportSize({ width: 400, height });
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/account/new');
      await page.locator('#account-name-input').fill('Layout test account');
      const action = page.locator('#create-btn');
      await wheelTo(page, action);
      await action.click();
      const error = page.getByText(failure, { exact: true });
      await expect(error).toBeVisible();
      await expect(action).toBeEnabled();
      await page.mouse.move(0, 0);
      await info.attach(`create-error-${height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await info.attach(`create-geometry-${height}`, {
        body: JSON.stringify(
          {
            height,
            action: await action.boundingBox(),
            error: await error.boundingBox(),
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
      expect
        .soft(
          await exposed(action),
          `Create remains unobscured after failure at400x${height}`
        )
        .toBe(true);
      expect
        .soft(
          await exposed(error),
          `Full error remains unobscured after failure at400x${height}`
        )
        .toBe(true);
    }
    expect(routes.deniedWrites).toEqual([]);
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
