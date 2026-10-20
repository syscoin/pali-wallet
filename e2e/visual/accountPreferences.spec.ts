import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('ordinary account creation freezes its label and rejects duplicate form submissions in short windows', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa117AccountFixture!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa117-account-pending', {
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
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      (window as any).__qa117Creates = [];
      (window as any).__qa117FinishCreates = () => {
        const qa = (window as any).__qa117Creates;
        for (const item of qa) item.callback({ address: 'synthetic-account' });
      };
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [request, callback] = args;
        if (
          request?.type === 'CONTROLLER_ACTION' &&
          request.data?.methods?.join('.') === 'wallet.createAccount'
        ) {
          (window as any).__qa117Creates.push({
            params: request.data.params,
            callback,
          });
          return;
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.gotoRoute('#/settings/account/new');
      const name = page.locator('#account-name-input');
      await name.fill(`QA ${viewport.width}`);
      await name.press('Enter');
      await expect
        .poll(() => page.evaluate(() => (window as any).__qa117Creates.length))
        .toBe(1);
      // Exercise both ordinary repeated Enter and a native submit-event race.
      // No fixture request reaches the real controller or creates an account.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.locator('#newaccount').evaluate((form) => {
        (form as HTMLFormElement).requestSubmit();
        (form as HTMLFormElement).requestSubmit();
      });
      expect(
        await page.evaluate(() => (window as any).__qa117Creates.length)
      ).toBe(1);
      await expect(name).toBeDisabled();
      await page.evaluate(() => (window as any).__qa117FinishCreates());
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(
        page.getByText('synthetic-account', { exact: true })
      ).toBeVisible();
      await info.attach(
        `account-created-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        }
      );
      await page
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await page.evaluate(() => ((window as any).__qa117Creates = []));
    }
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
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

test('account public-address copy reports clipboard refusal and stays retryable', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa117ClipboardFixture!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa117-account-copy', {
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
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as any).__qa117Copies = [];
      (window as any).__qa117RefuseCopy = true;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            if ((window as any).__qa117RefuseCopy)
              throw new Error('Synthetic clipboard refusal');
            (window as any).__qa117Copies.push(value);
          },
        },
      });
    });
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.gotoRoute('#/settings/manage-accounts');
      // Keep viewport cases independent of the alert layer's intentional
      // short duplicate-message suppression window.
      await page.reload();
      await wallet.waitAppReady();
      await page
        .locator('[data-navigation-scroll="settings-manage-accounts"] li')
        .first()
        .getByRole('button')
        .first()
        .click();
      const copy = page.getByRole('button', {
        name: en.buttons.copy,
        exact: true,
      });
      await copy.scrollIntoViewIfNeeded();
      await copy.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(en.transactions.copyFailed, { exact: true })
      ).toBeVisible();
      const notice = page.locator('.Toastify__toast').filter({
        hasText: en.transactions.copyFailed,
      });
      await notice.evaluate((element) =>
        Promise.all(
          element
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined))
        )
      );
      await expect(notice).toBeInViewport({ ratio: 1 });
      await info.attach(
        `account-copy-refused-${viewport.width}x${viewport.height}`,
        {
          // Do not fast-forward Toastify's progress animation: that dismisses
          // the error before the evidence frame can record it.
          body: await page.screenshot({ animations: 'allow' }),
          contentType: 'image/png',
        }
      );
      await page.evaluate(() => ((window as any).__qa117RefuseCopy = false));
      await copy.focus();
      await page.keyboard.press('Space');
      await expect(
        page.getByText(en.components.copied, { exact: true })
      ).toBeVisible();
      expect(
        await page.evaluate(() => (window as any).__qa117Copies.length)
      ).toBeGreaterThan(0);
      await expect(copy).toBeVisible();
      await page.evaluate(() => ((window as any).__qa117RefuseCopy = true));
      await expect(
        page.getByText(en.transactions.copyFailed, { exact: true })
      ).toBeHidden();
    }
    expect(errors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
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

test('fiat updates preserve an edited and submitted currency draft in small windows', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa117CurrencyFixture!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa117-currency-draft', {
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
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      const page = await wallet.context.newPage();
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        const qa = ((window as any).__qa117Fiat = {
          asset: 'usd',
          state: null as any,
          listeners: [] as any[],
          saves: [] as any[],
          update: null as null | ((asset: string) => void),
        });
        const transform = (state: any) => {
          if (!state?.price) return state;
          qa.state = state;
          return {
            ...state,
            price: {
              ...state.price,
              fiat: { ...state.price.fiat, asset: qa.asset },
            },
          };
        };
        qa.update = (asset: string) => {
          qa.asset = asset;
          for (const listener of qa.listeners)
            listener({
              type: 'CONTROLLER_STATE_CHANGE',
              data: transform(qa.state),
            });
        };
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [request, callback] = args;
          if (request?.type === 'getCurrentState')
            return typeof callback === 'function'
              ? (send as any)(request, (state: any) =>
                  callback(transform(state))
                )
              : (send as any)(request).then(transform);
          if (
            request?.type === 'CONTROLLER_ACTION' &&
            request.data?.methods?.join('.') === 'wallet.saveFiatCurrency'
          ) {
            qa.saves.push({ params: request.data.params, callback });
            return;
          }
          return (send as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        const add = chrome.runtime.onMessage.addListener.bind(
          chrome.runtime.onMessage
        );
        chrome.runtime.onMessage.addListener = ((listener: any) => {
          qa.listeners.push(listener);
          add((message: any, ...args: any[]) =>
            listener(
              message?.type === 'CONTROLLER_STATE_CHANGE'
                ? { ...message, data: transform(message.data) }
                : message,
              ...args
            )
          );
        }) as typeof chrome.runtime.onMessage.addListener;
      });
      await page.goto(wallet.appUrl('#/settings/currency'));
      const trigger = page.getByRole('button', {
        name: en.settings.setYourPreferred,
        exact: true,
      });
      await trigger.click();
      await page
        .getByRole('textbox', { name: en.settings.searchCurrencies })
        .fill('eur');
      await page.getByRole('button', { name: /EUR/ }).click();
      await page.evaluate(() => (window as any).__qa117Fiat.update('gbp'));
      await expect(trigger).toContainText('EUR');
      const save = page.getByRole('button', {
        name: en.buttons.save,
        exact: true,
      });
      await save.click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__qa117Fiat.saves.length)
        )
        .toBe(1);
      await page.evaluate(() => (window as any).__qa117Fiat.update('cad'));
      await expect(trigger).toContainText('EUR');
      await page.evaluate(() =>
        (window as any).__qa117Fiat.saves[0].callback()
      );
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText('EUR');
      expect(
        await page.evaluate(() =>
          (window as any).__qa117Fiat.saves.map((item: any) => item.params)
        )
      ).toEqual([['eur']]);
      await info.attach(
        `currency-draft-preserved-${viewport.width}x${viewport.height}`,
        {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        }
      );
      await page.close();
    }
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
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
