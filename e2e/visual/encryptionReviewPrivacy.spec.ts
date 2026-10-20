import { expect, test, type Locator, type Page } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const fitsHorizontally = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return (
      box.left >= 0 &&
      box.right <= innerWidth &&
      element.scrollWidth <= element.clientWidth + 1
    );
  });

const expectToastAboveActions = async (page: Page, message: string) => {
  const toast = page.locator('.Toastify__toast').filter({ hasText: message });
  await expect(toast).toBeVisible();
  await toast.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
  const toastBottom = await toast.evaluate(
    (node) => node.getBoundingClientRect().bottom
  );
  for (const name of ['Cancel', 'Confirm']) {
    const action = page.getByRole('button', { name, exact: true });
    const geometry = await action.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const footer = node.closest('.fixed')!.getBoundingClientRect();
      const accessible = [
        [rect.left + 2, rect.top + rect.height / 2],
        [rect.right - 2, rect.top + rect.height / 2],
        [rect.left + rect.width / 2, rect.top + 2],
        [rect.left + rect.width / 2, rect.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (node === hit || node.contains(hit));
      });
      return { accessible, footerTop: footer.top };
    });
    expect(geometry.accessible, `${name} is not covered by ${message}`).toBe(
      true
    );
    expect(toastBottom).toBeLessThanOrEqual(geometry.footerTop - 8);
  }
};

test('encryption review wraps long identifiers and announces successful or denied address copy once', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'EncryptionReviewSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('qa116-encryption', {
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
    const page = await wallet.context.newPage();
    const label = 'SyntheticAccount'.repeat(4);
    const address = `0x${'11'.repeat(20)}`;
    const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.example.invalid`;
    await page.addInitScript(
      ({ accountLabel, accountAddress }) => {
        const transform = (original: any) => {
          if (!original?.vault) return original;
          const state = structuredClone(original);
          const active = state.vault.activeAccount;
          state.vault.accounts[active.type][active.id] = {
            ...state.vault.accounts[active.type][active.id],
            address: accountAddress,
            label: accountLabel,
            balances: { ethereum: 0, syscoin: 0 },
          };
          state.vault.isBitcoinBased = false;
          return state;
        };
        (window as any).__encryptionQa = {
          copied: [],
          writes: [],
          previews: [],
          plaintext: '',
          rejectCopy: false,
        };
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true,
          value: async (value: string) => {
            const qa = (window as any).__encryptionQa;
            if (qa.rejectCopy) throw new Error('Synthetic clipboard denial');
            qa.copied.push(value);
          },
        });
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
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
            request.data?.methods?.[1] === 'ethereumTransaction'
          ) {
            if (request.data.methods[2] === 'decryptMessage') {
              const qa = (window as any).__encryptionQa;
              qa.previews.push(request.data.params);
              if (typeof callback === 'function')
                return queueMicrotask(() => callback(qa.plaintext));
              return Promise.resolve(qa.plaintext);
            }
            (window as any).__encryptionQa.writes.push(request.data.methods);
            const failure = {
              error: 'Synthetic review blocks approval actions',
            };
            if (typeof callback === 'function')
              return queueMicrotask(() => callback(failure));
            return Promise.resolve(failure);
          }
          return (send as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        const add = chrome.runtime.onMessage.addListener.bind(
          chrome.runtime.onMessage
        );
        chrome.runtime.onMessage.addListener = ((listener: any) => {
          add((message: any, ...args: any[]) =>
            listener(
              message?.type === 'CONTROLLER_STATE_CHANGE'
                ? { ...message, data: transform(message.data) }
                : message,
              ...args
            )
          );
        }) as typeof chrome.runtime.onMessage.addListener;
      },
      { accountLabel: label, accountAddress: address }
    );
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of ['tx/decrypt', 'tx/encryptKey']) {
        await page.goto(
          `chrome-extension://${
            wallet.extensionId
          }/external.html?route=${route}&data=${encodeURIComponent(
            JSON.stringify({
              host,
              eventName: 'synthetic-encryption-review',
              0: route === 'tx/decrypt' ? 'synthetic-ciphertext' : address,
              1: address,
            })
          )}`
        );
        await expect(page.locator('body.app-loaded')).toBeVisible();
        const account = page.getByText(label, { exact: true });
        await expect(account).toBeVisible();
        expect(await fitsHorizontally(account), `${route}: account label`).toBe(
          true
        );
        const origin = page.locator('p').filter({ hasText: host });
        expect(await fitsHorizontally(origin), `${route}: full origin`).toBe(
          true
        );
        const copy = page.getByRole('button', {
          name: 'Copy address',
          exact: true,
        });
        await expect(copy).toBeAttached();
        for (let step = 0; step < 20; step++) {
          await page.keyboard.press('Tab');
          if (await copy.evaluate((node) => node === document.activeElement))
            break;
        }
        await expect(copy).toBeFocused();
        const box = (await copy.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        await page.keyboard.press('Enter');
        await expect(
          page.getByText('Address successfully copied', { exact: true })
        ).toBeVisible();
        await expectToastAboveActions(page, 'Address successfully copied');
        expect(
          await page.evaluate(() => (window as any).__encryptionQa.copied)
        ).toEqual([address]);
        await page.evaluate(() => {
          (window as any).__encryptionQa.rejectCopy = true;
        });
        await page.keyboard.press('Enter');
        await expect(
          page.getByText('Could not copy to clipboard. Please try again.', {
            exact: true,
          })
        ).toBeVisible();
        await expectToastAboveActions(
          page,
          'Could not copy to clipboard. Please try again.'
        );
        expect(
          await page.evaluate(() => (window as any).__encryptionQa.copied)
        ).toEqual([address]);
        expect(
          await page.evaluate(() => (window as any).__encryptionQa.writes)
        ).toEqual([]);
        if (route === 'tx/decrypt') {
          const plaintext =
            viewport.width === 320 ? '' : 'Synthetic decrypted message';
          await page.evaluate((value) => {
            const qa = (window as any).__encryptionQa;
            qa.rejectCopy = false;
            qa.plaintext = value;
          }, plaintext);
          const preview = page.getByRole('button', {
            name: 'Decrypt message',
            exact: true,
          });
          for (let step = 0; step < 24; step++) {
            await page.keyboard.press('Tab');
            if (
              await preview.evaluate((node) => node === document.activeElement)
            )
              break;
          }
          await expect(preview).toBeFocused();
          await page.keyboard.press('Enter');
          const copyMessage = page.getByRole('button', {
            name: 'Copy message',
            exact: true,
          });
          await expect(copyMessage).toBeAttached();
          await expect(preview).toHaveCount(0);
          for (let step = 0; step < 24; step++) {
            await page.keyboard.press('Tab');
            if (
              await copyMessage.evaluate(
                (node) => node === document.activeElement
              )
            )
              break;
          }
          await expect(copyMessage).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(
            page.getByText('Message successfully copied', { exact: true })
          ).toBeVisible();
          await expectToastAboveActions(page, 'Message successfully copied');
          expect(
            await page.evaluate(() => (window as any).__encryptionQa.copied)
          ).toEqual([address, plaintext]);
          expect(
            await page.evaluate(() => (window as any).__encryptionQa.previews)
          ).toEqual([[['synthetic-ciphertext', address]]]);
          expect(
            await page.evaluate(() => (window as any).__encryptionQa.writes)
          ).toEqual([]);
        }
        await info.attach(`${route.replace('/', '-')}-${viewport.width}`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
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
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
