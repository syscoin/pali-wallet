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

const exposed = (control: Locator) =>
  control.evaluate((node) => {
    const box = node.getBoundingClientRect();
    if (
      box.left < 0 ||
      box.top < 0 ||
      box.right > innerWidth ||
      box.bottom > innerHeight ||
      !box.width ||
      !box.height
    )
      return false;
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    return !!hit && (node === hit || node.contains(hit));
  });

const reveal = async (page: Page, control: Locator) => {
  for (const delta of [0, -3000, 120, 120, 120, 120, 120, 120, 3000]) {
    if (await exposed(control)) return;
    await page.mouse.move(page.viewportSize()!.width - 8, 180);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(100);
  }
  expect(await exposed(control)).toBe(true);
};

const focusWithKeyboard = async (page: Page, control: Locator) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await control.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

test('NFT detail ownership follows the latest edit and cancels reads on Back in short windows', async ({}, info) => {
  test.setTimeout(120_000);
  const original = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa117NftSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('qa117-nft-details', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 600 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = await wallet.context.newPage();
    await page.addInitScript(() => {
      const contract = `0x${'ab'.repeat(20)}`;
      const nft = {
        id: `${contract}-57057`,
        contractAddress: contract,
        chainId: 57057,
        tokenSymbol: 'QA117NFT',
        symbol: 'QA117NFT',
        name: 'Synthetic NFT Ownership Review',
        tokenStandard: 'ERC-721',
        decimals: 0,
        balance: 2,
        isNft: true,
        // eslint-disable-next-line camelcase
        market_data: { current_price: { usd: 0 } },
      };
      const transform = (originalState: any) => {
        if (!originalState?.vault) return originalState;
        const state = structuredClone(originalState);
        state.vault.activeNetwork = {
          ...state.vault.activeNetwork,
          kind: 'ethereum',
          chainId: 57057,
          currency: 'TSYS',
          label: 'Synthetic NFT Test',
          url: 'http://127.0.0.1:1',
          apiUrl: 'http://127.0.0.1:1',
          explorer: 'https://synthetic.example/',
        };
        state.vault.isBitcoinBased = false;
        const { type, id } = state.vault.activeAccount;
        state.vault.accounts[type][id].address = `0x${'11'.repeat(20)}`;
        state.vault.accountAssets[type] ||= {};
        state.vault.accountAssets[type][id] = {
          ethereum: [nft],
          syscoin: [],
          nfts: [],
        };
        return state;
      };
      const qa = {
        reads: [] as string[],
        copied: [] as string[],
        rejectCopy: false,
        pending: new Map<string, (value: any) => void>(),
        resolve: (id: string, owned: boolean) => {
          const reply = qa.pending.get(id);
          if (!reply) throw new Error(`No pending read for ${id}`);
          qa.pending.delete(id);
          reply([{ tokenId: id, verified: owned, balance: owned ? 1 : 0 }]);
        },
      };
      (window as any).__qa117Nft = qa;
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (value: string) => {
          if (qa.rejectCopy) throw new Error('Synthetic clipboard denial');
          qa.copied.push(value);
        },
      });
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const [message, callback] = args;
        const reply = (value: any) => {
          if (typeof callback === 'function') {
            queueMicrotask(() => callback(value));
            return;
          }
          return Promise.resolve(value);
        };
        if (message?.type === 'getCurrentState') {
          return typeof callback === 'function'
            ? (send as any)(message, (state: any) => callback(transform(state)))
            : (send as any)(message).then(transform);
        }
        if (message?.type === 'CONTROLLER_ACTION') {
          const method = message.data?.methods?.[1];
          if (method === 'getOnlyMarketData') return reply(null);
          if (method === 'fetchNftTokenIds') return reply([]);
          if (method === 'verifyERC721Ownership') {
            const id = message.data.params[2][0];
            qa.reads.push(id);
            if (typeof callback === 'function') {
              qa.pending.set(id, callback);
              return;
            }
            return new Promise((resolve) => qa.pending.set(id, resolve));
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
      const wrapped = new Map<any, any>();
      chrome.runtime.onMessage.addListener = (listener: any) => {
        const wrapper = (message: any, ...args: any[]) => {
          if (message?.type === 'CONTROLLER_STATE_CHANGE')
            return listener(
              { ...message, data: transform(message.data) },
              ...args
            );
          if (
            [
              'CONTROLLER_NETWORK_CHANGE',
              'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
            ].includes(message?.type)
          )
            return false;
          return listener(message, ...args);
        };
        wrapped.set(listener, wrapper);
        add(wrapper);
      };
      chrome.runtime.onMessage.removeListener = (listener: any) => {
        remove(wrapped.get(listener) || listener);
        wrapped.delete(listener);
      };
    });
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(wallet.appUrl('#/home'));
      await page.locator('#assets-btn').click();
      const nftToggle = page.locator('div.w-14.h-8 span.cursor-pointer').last();
      await reveal(page, nftToggle);
      await nftToggle.click();
      const details = page.getByRole('button', {
        name: 'View details for QA117NFT collection',
      });
      await reveal(page, details);
      await details.click();
      const collection = page.getByRole('button', {
        name: en.send.viewCollectionItems,
      });
      await reveal(page, collection);
      await collection.click();
      const input = page.getByPlaceholder(en.send.enterTokenId, {
        exact: true,
      });
      await expect(input).toBeEnabled();
      expect(
        await page.evaluate(() => (window as any).__qa117Nft.pending.size)
      ).toBe(0);
      await page.evaluate(() => {
        const qa = (window as any).__qa117Nft;
        qa.reads = [];
        qa.copied = [];
        qa.rejectCopy = false;
      });
      await reveal(page, input);
      await input.fill('1');
      await expect
        .poll(() => page.evaluate(() => (window as any).__qa117Nft.reads))
        .toEqual(['1']);
      await input.fill('2');
      await expect
        .poll(() => page.evaluate(() => (window as any).__qa117Nft.reads))
        .toEqual(['1', '2']);
      await page.evaluate(() => (window as any).__qa117Nft.resolve('2', false));
      const notOwned = page.getByText(en.send.youDontOwnThisToken, {
        exact: false,
      });
      await expect(notOwned).toBeVisible();
      await page.evaluate(() => (window as any).__qa117Nft.resolve('1', true));
      await page.waitForTimeout(100);
      await info.attach(`latest-nft-ownership-${viewport.width}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await expect(notOwned).toBeVisible();
      await input.fill('');
      await input.pressSequentially('345', { delay: 80 });
      await expect
        .poll(() => page.evaluate(() => (window as any).__qa117Nft.reads))
        .toEqual(['1', '2', '345']);
      await page.evaluate(() =>
        (window as any).__qa117Nft.resolve('345', true)
      );
      await expect(notOwned).toHaveCount(0);
      expect(await exposed(input)).toBe(true);

      const tokenCopy = page.getByRole('button', {
        name: `${en.buttons.copy} ${en.send.tokenId}`,
        exact: true,
      });
      await focusWithKeyboard(page, tokenCopy);
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(en.components.copied, { exact: true })
      ).toBeVisible();
      expect(
        await page.evaluate(() => (window as any).__qa117Nft.copied)
      ).toEqual(['345']);
      await page.locator('.Toastify__toast').waitFor({ state: 'hidden' });
      await page.evaluate(() => {
        (window as any).__qa117Nft.rejectCopy = true;
      });
      const contractCopy = page.getByRole('button', {
        name: en.send.copyContractAddress,
        exact: true,
      });
      await focusWithKeyboard(page, contractCopy);
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(en.transactions.copyFailed, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(en.home.contractCopied, { exact: true })
      ).toHaveCount(0);
      await page.locator('.Toastify__toast').waitFor({ state: 'hidden' });
      await info.attach(`nft-public-copy-${viewport.width}`, {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await reveal(page, input);
      await input.fill('456');
      const back = page.getByRole('button', {
        name: en.buttons.back,
        exact: true,
      });
      await back.click();
      await page.waitForTimeout(700);
      expect(
        await page.evaluate(() => (window as any).__qa117Nft.reads)
      ).toEqual(['1', '2', '345']);
    }
    expect(routes.deniedWrites).toEqual([]);
    await page.close();
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, original);
  }
});
