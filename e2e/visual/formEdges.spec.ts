import { expect, test, type Locator } from '@playwright/test';

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
    const bounds = element.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= innerWidth &&
      bounds.bottom <= innerHeight &&
      [
        [bounds.left + 2, bounds.top + bounds.height / 2],
        [bounds.right - 2, bounds.top + bounds.height / 2],
        [bounds.left + bounds.width / 2, bounds.top + 2],
        [bounds.left + bounds.width / 2, bounds.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === element || element.contains(hit));
      })
    );
  });

test('forget-wallet failure stays readable and retryable without erasing the offline fixture', async ({}, info) => {
  test.setTimeout(90_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'FormEdgeSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('form-error-edge', {
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
    const failure =
      'The offline synthetic wallet could not be removed. No account was erased. Please try again.';
    await page.evaluate(
      ({ message, seed }) => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        (window as any).__forgetCalls = 0;
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [request, callback] = args;
          const method = request?.data?.methods;
          if (
            request?.type === 'CONTROLLER_ACTION' &&
            method?.[0] === 'wallet' &&
            ['getSeed', 'forgetWallet'].includes(method[1])
          ) {
            // Only this disposable profile is used. No removal reaches the
            // background, even if a frontend regression changes the flow.
            if (method[1] === 'forgetWallet')
              (window as any).__forgetCalls += 1;
            const result = method[1] === 'getSeed' ? seed : { error: message };
            if (typeof callback === 'function') {
              queueMicrotask(() => callback(result));
              return;
            }
            return Promise.resolve(result);
          }
          return (original as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
      },
      { message: failure, seed: UTXO_FIXTURE_SEED }
    );
    for (const [width, height] of [
      [320, 360],
      [400, 480],
    ]) {
      await page.setViewportSize({ width, height });
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/forget-wallet');
      const password = page.locator('#forget_password');
      await password.fill('FormEdgeSyntheticOnly!2026');
      await password.press('Enter');
      const forget = page.getByRole('button', {
        name: 'Forget',
        exact: true,
      });
      await expect(forget).toBeEnabled();
      await page.mouse.move(width / 2, height - 35);
      await page.mouse.wheel(0, 4000);
      await expect.poll(() => exposed(forget)).toBe(true);
      await forget.click();
      const error = page.getByRole('alert').filter({ hasText: failure });
      await expect(error).toBeVisible();
      await expect(forget).toBeEnabled();
      await expect(page.locator('input[type=password]')).toHaveValue(
        'FormEdgeSyntheticOnly!2026'
      );
      await page.mouse.wheel(0, 4000);
      await expect.poll(() => exposed(error)).toBe(true);
      await expect.poll(() => exposed(forget)).toBe(true);
      const errorBox = (await error.boundingBox())!;
      const buttonBox = (await forget.boundingBox())!;
      expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(buttonBox.y);
      await info.attach(`forget-error-${width}x${height}`, {
        body: await page.screenshot({
          animations: 'disabled',
          mask: [page.locator('input,textarea')],
        }),
        contentType: 'image/png',
      });
      // A retry is explicit; rejection must not auto-retry or report success.
      const calls = await page.evaluate(() => (window as any).__forgetCalls);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => (window as any).__forgetCalls)).toBe(
        calls
      );
      expect(page.url()).toContain('/settings/forget-wallet');
    }
    expect(await page.evaluate(() => (window as any).__forgetCalls)).toBe(2);
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
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
});

test('edited account Copy remains keyboard-operable and fully exposed in narrow short windows', async ({}, info) => {
  test.setTimeout(90_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createUtxoFixture();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'FormCopySyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('form-copy-edge', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
    const page = wallet.page;
    await page.evaluate(() => {
      // Never modify the operating system clipboard during fixture QA.
      (window as any).__copiedPublicAddresses = [];
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (value: string) => {
          (window as any).__copiedPublicAddresses.push(value);
        },
      });
    });
    const expectedAddresses: string[] = [];
    for (const [width, height] of [
      [320, 360],
      [400, 480],
    ]) {
      await page.setViewportSize({ width, height });
      await wallet.gotoRoute('#/home');
      await wallet.gotoRoute('#/settings/manage-accounts');
      await page
        .locator('[data-navigation-scroll="settings-manage-accounts"] li')
        .first()
        .getByRole('button')
        .first()
        .click();
      const expectedAddress = await page.evaluate(async () => {
        const state: any = await chrome.runtime.sendMessage({
          type: 'getCurrentState',
        });
        const { accountType, id } = window.history.state.usr;
        return state.vault.accounts[accountType][id].address as string;
      });
      expect(expectedAddress).toBeTruthy();
      await expect(
        page.locator('p[title]').filter({ hasText: '(' })
      ).toHaveAttribute('title', expectedAddress);
      expectedAddresses.push(expectedAddress);
      const copy = page.getByRole('button', { name: 'Copy', exact: true });
      await expect(copy).toHaveCount(1);
      // Focus the form using a harmless click, then reach Copy by real Tab
      // presses. No direct focus()/scrollIntoView() hides an unreachable link.
      await page.locator('form#edit-account').click({
        position: { x: 2, y: 2 },
      });
      for (let attempt = 0; attempt < 16; attempt++) {
        await page.keyboard.press('Tab');
        if (
          await copy.evaluate((element) => element === document.activeElement)
        )
          break;
      }
      await expect(copy).toBeFocused();
      await expect.poll(() => exposed(copy)).toBe(true);
      const box = (await copy.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Enter');
      await expect(copy).toContainText('Copied!');
      await expect(copy).toBeFocused();
      await expect.poll(() => exposed(copy)).toBe(true);
      await info.attach(`account-copy-${width}x${height}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(width);
    }
    const copied = await page.evaluate(
      () => (window as any).__copiedPublicAddresses
    );
    expect(copied).toEqual(expectedAddresses);
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
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
});
