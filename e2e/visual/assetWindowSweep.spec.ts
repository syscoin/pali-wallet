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

const exposed = (control: Locator) =>
  control.evaluate((element) => {
    const b = element.getBoundingClientRect();
    if (
      b.width <= 0 ||
      b.height <= 0 ||
      b.left < 0 ||
      b.top < 0 ||
      b.right > innerWidth + 0.5 ||
      b.bottom > innerHeight + 0.5
    )
      return false;
    const hit = document.elementFromPoint(
      b.left + b.width / 2,
      b.top + b.height / 2
    );
    return !!hit && (hit === element || element.contains(hit));
  });
const reveal = async (page: Page, control: Locator) => {
  for (const delta of [0, -3000, 100, 100, 100, 100, 100, 100, 100, 3000]) {
    if (await exposed(control)) return;
    await page.mouse.move(page.viewportSize()!.width - 8, 180);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(100);
  }
};

const importScroll = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-navigation-scroll="wallet-layout"],[data-navigation-scroll="token-import"]'
      ),
    ].map((element) => ({
      pane: element.dataset.navigationScroll,
      top: element.scrollTop,
    }))
  );

async function editImportWithoutScrollJump(
  page: Page,
  input: Locator,
  text: string,
  label: string,
  info: any,
  replaceLastDigit = false
) {
  // Use ordinary wheel movement to reveal the field once, then type through
  // the keyboard. Re-revealing per character would hide replace-state jumps.
  await reveal(page, input);
  expect(await exposed(input), `${label}: input exposed before typing`).toBe(
    true
  );
  if (replaceLastDigit) {
    // Move away from the restored snapshot using a normal, small wheel gesture.
    // A later field-state replace must not replay that older scroll position.
    const box = (await input.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 12);
    await page.waitForTimeout(200);
  }
  await input.click();
  await page.waitForTimeout(200);
  const before = await importScroll(page);
  if (page.viewportSize()!.height === 360)
    expect(
      before.some(({ top }) => top > 0),
      `${label}: genuinely scrolled before editing`
    ).toBe(true);
  if (replaceLastDigit) {
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
    );
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text.slice(-1));
  } else {
    await page.keyboard.type(text, { delay: 60 });
  }
  // Let same-page navigation persistence and token-id validation both settle.
  await expect(input).toHaveValue(text);
  await page.waitForTimeout(700);
  await expect(input).toBeFocused();
  const after = await importScroll(page);
  await info.attach(`${label}-edit-scroll`, {
    body: JSON.stringify(
      {
        before,
        after,
        saved: await page.evaluate(
          () => window.history.state?.usr?.scrollPositions || null
        ),
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
  expect.soft(after, `${label}: field edits preserve scroll`).toEqual(before);
  expect
    .soft(await exposed(input), `${label}: typed field remains exposed`)
    .toBe(true);
}

test('long ERC20 and NFT metadata stays readable in lists, details and import previews', async ({}, info) => {
  test.setTimeout(180_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AssetWindowSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const output = path.join(E2E_CONFIG.artifactsDir, 'asset-window-sweep');
  fs.mkdirSync(output, { recursive: true });
  const capture = async (page: Page, name: string) => {
    const file = path.join(output, `${name}.png`);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: file, animations: 'disabled' });
    await info.attach(name, { path: file, contentType: 'image/png' });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('button,input,a,h2,h3,p,span')].flatMap(
        (element) => {
          const b = element.getBoundingClientRect();
          if (
            b.width <= 0 ||
            b.height <= 0 ||
            b.top >= innerHeight ||
            b.bottom <= 0
          )
            return [];
          for (let p: Element | null = element; p; p = p.parentElement) {
            const style = getComputedStyle(p);
            if (style.visibility === 'hidden' || Number(style.opacity) === 0)
              return [];
          }
          return b.left < -0.5 || b.right > innerWidth + 0.5
            ? [
                {
                  tag: element.tagName,
                  text: element.textContent?.slice(0, 120),
                  left: b.left,
                  right: b.right,
                },
              ]
            : [];
        }
      )
    );
    await info.attach(`${name}-overflow`, {
      body: JSON.stringify(overflow, null, 2),
      contentType: 'application/json',
    });
    expect.soft(overflow, `${name}: visible metadata fits`).toEqual([]);
  };
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('asset-window-sweep', {
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
      const token = {
        id: '0x' + '31'.repeat(20),
        contractAddress: '0x' + '31'.repeat(20),
        chainId: 57057,
        decimals: 18,
        tokenSymbol: 'QUALITYTOKEN',
        symbol: 'QUALITYTOKEN',
        name: 'LongNamedSyntheticPaymentAssetForResponsiveWalletQualityAssurance',
        balance: 123456789.1234,
        isNft: false,
        tokenStandard: 'ERC-20',
        market_data: { current_price: { usd: 0 } },
      };
      const nft = {
        ...token,
        id: '0x' + '32'.repeat(20),
        contractAddress: '0x' + '32'.repeat(20),
        tokenSymbol: 'QUALITYNFT',
        symbol: 'QUALITYNFT',
        name: 'LongNamedSyntheticCollectibleCollectionForResponsiveWalletQualityAssurance',
        isNft: true,
        tokenStandard: 'ERC-1155',
        decimals: 0,
        balance: 2,
        tokenId:
          '12345678901234567890123456789012345678901234567890123456789012345678901234567',
      };
      const extra = {
        ...nft,
        id: '0x' + '33'.repeat(20),
        contractAddress: '0x' + '33'.repeat(20),
        tokenSymbol: 'IMPORTNFT',
        symbol: 'IMPORTNFT',
        name: 'LongNamedSyntheticImportCollectionForResponsiveWalletQualityAssurance',
      };
      const fixture = (original: any) => {
        if (!original?.vault?.activeNetwork) return original;
        const state = structuredClone(original);
        state.vault.activeNetwork = {
          ...state.vault.activeNetwork,
          kind: 'ethereum',
          chainId: 57057,
          currency: 'TSYS',
          label: 'Synthetic EVM',
          url: 'http://127.0.0.1:1',
          apiUrl: 'http://127.0.0.1:1',
          explorer: 'https://synthetic.example/',
        };
        state.vault.isBitcoinBased = false;
        const { type, id } = state.vault.activeAccount;
        state.vault.accountAssets[type] ||= {};
        state.vault.accountAssets[type][id] = {
          ...state.vault.accountAssets[type][id],
          ethereum: [token, nft],
        };
        return state;
      };
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
          if (typeof callback === 'function')
            return (send as any)(message, (state: any) =>
              callback(fixture(state))
            );
          return (send as any)(message).then(fixture);
        }
        if (message?.type === 'CONTROLLER_ACTION') {
          const method = message.data?.methods?.[1];
          if (method === 'getUserOwnedTokens') return reply([extra]);
          if (method === 'getOnlyMarketData') return reply(null);
          if (method === 'getTokenDetailsWithMarketData') return reply(extra);
          if (method === 'verifyERC1155Ownership')
            return reply([
              {
                tokenId: message.data.params[2][0],
                balance: 2,
                rawBalance: '2',
                verified: true,
              },
            ]);
        }
        return (send as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
      // Keep the same synthetic EVM context on asynchronous controller reads.
      // The real disposable vault remains UTXO; its polling must not silently
      // replace these renderer-only metadata fixtures halfway through typing.
      const add = chrome.runtime.onMessage.addListener.bind(
        chrome.runtime.onMessage
      );
      const remove = chrome.runtime.onMessage.removeListener.bind(
        chrome.runtime.onMessage
      );
      const wrapped = new Map<any, any>();
      chrome.runtime.onMessage.addListener = (listener: any) => {
        const wrapper = (message: any, ...rest: any[]) => {
          if (message?.type === 'CONTROLLER_STATE_CHANGE')
            return listener(
              { ...message, data: fixture(message.data) },
              ...rest
            );
          if (
            [
              'CONTROLLER_NETWORK_CHANGE',
              'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
            ].includes(message?.type)
          )
            return false;
          return listener(message, ...rest);
        };
        wrapped.set(listener, wrapper);
        add(wrapper);
      };
      chrome.runtime.onMessage.removeListener = (listener: any) => {
        remove(wrapped.get(listener) || listener);
        wrapped.delete(listener);
      };
    });
    for (const [width, height] of [
      [320, 360],
      [400, 360],
      [400, 600],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(wallet.appUrl('#/home'));
      await page.locator('#assets-btn').click();
      const tokenDetails = page.getByRole('button', {
        name: 'View details for QUALITYTOKEN token',
      });
      await reveal(page, tokenDetails);
      await capture(page, `erc20-list-${width}x${height}`);
      await tokenDetails.click();
      await page.locator('[data-navigation-scroll="asset-details"]').waitFor();
      await capture(page, `erc20-details-${width}x${height}-top`);
      const close = page
        .getByRole('button', { name: en.buttons.close, exact: true })
        .last();
      await reveal(page, close);
      await capture(page, `erc20-details-${width}x${height}-bottom`);
      expect.soft(await exposed(close)).toBe(true);
      await close.click();
      const nftToggle = page.getByRole('button', {
        name: en.tooltip.viewNFTs,
      });
      await reveal(page, nftToggle);
      await nftToggle.click();
      const nftDetails = page.getByRole('button', {
        name: 'View details for QUALITYNFT collection',
      });
      await reveal(page, nftDetails);
      await capture(page, `nft-list-${width}x${height}`);
      await nftDetails.click();
      await page.locator('[data-navigation-scroll="asset-details"]').waitFor();
      await capture(page, `nft-details-${width}x${height}-top`);
      const collection = page.getByRole('button', {
        name: en.send.viewCollectionItems,
      });
      await reveal(page, collection);
      await collection.click();
      await page
        .getByRole('heading', {
          name: 'LongNamedSyntheticCollectibleCollectionForResponsiveWalletQualityAssurance',
        })
        .waitFor();
      await expect
        .poll(() =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-navigation-scroll]'
              ),
            ]
              .map((element) => element.scrollTop)
              .every((top) => top === 0)
          )
        )
        .toBe(true);
      await capture(page, `nft-collection-${width}x${height}-top`);
      await page.mouse.move(width - 8, 180);
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(150);
      await capture(page, `nft-collection-${width}x${height}-bottom`);
      await page.goto(wallet.appUrl('#/tokens/add'));
      await page
        .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
        .first()
        .click();
      await page.locator('#custom-token-contract').fill('0x' + '33'.repeat(20));
      const tokenId = page.locator('#custom-token-id');
      await tokenId.waitFor();
      // Both the original and last-digit replacement fit uint256.
      const initialTokenId =
        '12345678901234567890123456789012345678901234567890123456789012345678901234567';
      await editImportWithoutScrollJump(
        page,
        tokenId,
        initialTokenId,
        `initial-import-${width}x${height}`,
        info
      );
      await capture(page, `nft-import-${width}x${height}-top`);

      // Visit the real import preview and use its Back action, so the second
      // edit carries a captured return-scroll snapshot as normal users do.
      const preview = page.getByRole('button', {
        name: en.tokens.viewTokenDetails.replace('{{symbol}}', 'IMPORTNFT'),
        exact: true,
      });
      await reveal(page, preview);
      await preview.click();
      await expect(page).toHaveURL(/#\/home\/details/);
      const back = page.getByRole('button', {
        name: en.buttons.back,
        exact: true,
      });
      await reveal(page, back);
      await back.click();
      await expect(page).toHaveURL(/#\/tokens\/add/);
      await expect(tokenId).toHaveValue(initialTokenId);
      expect(
        await page.evaluate(() =>
          Object.keys(window.history.state?.usr?.scrollPositions || {})
        ),
        'Back restores a real captured import-scroll snapshot'
      ).toContain('token-import');
      const editedTokenId = initialTokenId.slice(0, -1) + '9';
      await editImportWithoutScrollJump(
        page,
        tokenId,
        editedTokenId,
        `restored-import-${width}x${height}`,
        info,
        true
      );
      await capture(page, `nft-import-${width}x${height}-restored-edit`);
      await page.mouse.move(width - 8, 180);
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(150);
      await capture(page, `nft-import-${width}x${height}-bottom`);
    }
    expect(routes.deniedWrites).toEqual([]);
    await page.close();
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
