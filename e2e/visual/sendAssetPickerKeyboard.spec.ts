import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const tokens = [
  {
    contract: '0x000000000000000000000000000000000000ba11',
    symbol: 'LONGCOIN',
    decimals: 18,
    rawBalance: '999999999999999999',
    amount: '0.999999999999999999',
  },
  {
    contract: '0x000000000000000000000000000000000000ba12',
    symbol: 'SIXDEC',
    decimals: 6,
    rawBalance: '1234567',
    amount: '1.234567',
  },
] as const;
const RPC = 'https://rpc.tanenbaum.io/';

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 40; index += 1) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const isActive = async (menu: Locator, item: Locator) => {
  const activeId = await menu.getAttribute('aria-activedescendant');
  return Boolean(activeId) && activeId === (await item.getAttribute('id'));
};

// Inspect the actual painted SVG without changing DOM, styles or wallet state.
async function collapsedPickerGeometry(picker: Locator) {
  return picker.evaluate((button) => {
    const svg = button.querySelector('svg');
    const arrow = svg?.querySelector('path');
    if (!svg || !arrow) throw new Error('Actual picker ArrowDownSvg missing');
    const rect = (value: DOMRect) => ({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
    });
    const buttonBox = button.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const paintedBox = arrow.getBoundingClientRect();
    const rawBox = arrow.getBBox();
    const matrix = arrow.getScreenCTM();
    let sample: DOMPoint | undefined;
    // The bounding-box center can be the transparent opening of the V shape.
    // Find an actual interior filled point before testing screen occlusion.
    for (let row = 1; row < 8 && !sample; row++) {
      for (let column = 1; column < 8 && !sample; column++) {
        const point = new DOMPoint(
          rawBox.x + (rawBox.width * column) / 8,
          rawBox.y + (rawBox.height * row) / 8
        );
        if (arrow.isPointInFill(point)) sample = point;
      }
    }
    const screenPoint =
      sample && matrix ? sample.matrixTransform(matrix) : null;
    const hit = screenPoint
      ? document.elementFromPoint(screenPoint.x, screenPoint.y)
      : null;
    const ancestors = [];
    for (let node: Element | null = arrow; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      ancestors.push({
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      });
    }
    const within = (inner: DOMRect, outer: DOMRect) =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;
    const paintFullyVisible =
      paintedBox.width > 0 &&
      paintedBox.height > 0 &&
      within(paintedBox, svgBox) &&
      within(paintedBox, buttonBox) &&
      paintedBox.left >= 0 &&
      paintedBox.right <= window.innerWidth &&
      paintedBox.top >= 0 &&
      paintedBox.bottom <= window.innerHeight &&
      ancestors.every(
        (style) =>
          style.display !== 'none' &&
          !['hidden', 'collapse'].includes(style.visibility) &&
          Number(style.opacity) > 0
      ) &&
      Boolean(hit && svg.contains(hit));
    const viewBox = svg.viewBox.baseVal;
    return {
      text: button.textContent?.trim(),
      expanded: button.getAttribute('aria-expanded'),
      button: rect(buttonBox),
      svg: rect(svgBox),
      paint: rect(paintedBox),
      viewBox: [viewBox.x, viewBox.y, viewBox.width, viewBox.height],
      rawPathBox: {
        x: rawBox.x,
        y: rawBox.y,
        width: rawBox.width,
        height: rawBox.height,
      },
      screenPoint: screenPoint ? { x: screenPoint.x, y: screenPoint.y } : null,
      sampleHitsActualSvg: Boolean(hit && svg.contains(hit)),
      ancestors,
      paintFullyVisible,
    };
  });
}

const publicTokens = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const account = state.vault.activeAccount;
    return {
      account,
      chainId: state.vault.activeNetwork.chainId,
      tokens: state.vault.accountAssets[account.type][account.id].ethereum.map(
        (token: any) => ({
          contract: token.contractAddress.toLowerCase(),
          symbol: token.tokenSymbol,
          decimals: token.decimals,
          chainId: token.chainId,
        })
      ),
    };
  });

test('Send asset picker has one keyboard stop per asset and excludes its closed menu from Tab order', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SendAssetKeyboardSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const deniedWrites: string[] = [];
  const tokenReads: string[] = [];
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('send-asset-picker-keyboard', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const abi = AbiCoder.defaultAbiCoder();
    const selector = (signature: string) => id(signature).slice(0, 10);
    await wallet.context.route(RPC, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      const body = request.postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push('write-or-sign');
        return route.abort('blockedbyclient');
      }
      const findToken = (call: any) =>
        tokens.find(
          (token) =>
            token.contract ===
            String(call.params?.[0]?.to || call.params?.[0]).toLowerCase()
        );
      const knownBalance = (call: any) =>
        call.method === 'eth_getBalance' &&
        fixture.evmAddresses.some(
          (address) =>
            address.toLowerCase() === String(call.params?.[0]).toLowerCase()
        );
      if (!calls.some((call: any) => findToken(call) || knownBalance(call)))
        return route.fallback();
      const replies = calls.map((call: any) => {
        const token = findToken(call);
        let result: unknown;
        if (call.method === 'eth_chainId') result = '0x1644';
        if (knownBalance(call)) result = '0xde0b6b3a7640000';
        if (call.method === 'eth_getCode' && token) result = '0x60006000fd';
        if (call.method === 'eth_call' && token) {
          const prefix = String(call.params[0].data).slice(0, 10);
          tokenReads.push(token.symbol + ':' + prefix);
          if (prefix === selector('name()'))
            result = abi.encode(
              ['string'],
              [token.symbol + ' synthetic token']
            );
          if (prefix === selector('symbol()'))
            result = abi.encode(['string'], [token.symbol]);
          if (prefix === selector('decimals()'))
            result = abi.encode(['uint8'], [token.decimals]);
          if (
            prefix === selector('balanceOf(address)') ||
            prefix === selector('totalSupply()')
          )
            result = abi.encode(['uint256'], [token.rawBalance]);
          if (prefix === selector('supportsInterface(bytes4)'))
            result = abi.encode(['bool'], [false]);
        }
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message: 'Unsupported synthetic read' },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const menu = page.getByRole('menu');
    const max = page.getByRole('button', { name: 'MAX', exact: true });
    const amount = page.locator('#with-max-button');
    const picker = (symbol: string) =>
      page.getByRole('button', { name: symbol, exact: true });
    const item = (symbol: string) =>
      menu.getByRole('menuitem').filter({ hasText: symbol });
    await wallet.step(
      'import two precision-distinct tokens through the ordinary import UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        for (const token of tokens) {
          await wallet!.gotoRoute('#/tokens/add?tab=custom');
          await page
            .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
            .click();
          await page.locator('#custom-token-contract').fill(token.contract);
          const add = page.getByRole('button', {
            name: `Import ${token.symbol} token`,
            exact: true,
          });
          await expect(add).toBeEnabled();
          await add.click();
          await expect(add).toBeDisabled();
        }
        const saved = await publicTokens(page);
        expect(saved).toMatchObject({
          account: { id: 0, type: 'HDAccount' },
          chainId: 5700,
        });
        expect(saved.tokens).toEqual(
          tokens.map((token) => ({
            contract: token.contract,
            symbol: token.symbol,
            decimals: token.decimals,
            chainId: 5700,
          }))
        );
        observations.imported = saved;
        await wallet!.gotoRoute('#/send/eth');
        await expect(picker('TSYS')).toBeVisible();
      }
    );
    await wallet.step(
      'Home and ArrowDown move one real menuitem per asset before Enter selection',
      async (capture) => {
        await page.mouse.move(0, 0);
        await tabTo(page, picker('TSYS'));
        await page.keyboard.press('ArrowDown');
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(3);
        await expect.poll(() => isActive(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('Home');
        await expect.poll(() => isActive(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('ArrowDown');
        await expect
          .poll(() => isActive(menu, item(tokens[0].symbol)))
          .toBe(true);
        expect(
          await item(tokens[0].symbol).evaluate((element) => element.tagName)
        ).toBe('BUTTON');
        await page.keyboard.press('ArrowDown');
        await expect
          .poll(() => isActive(menu, item(tokens[1].symbol)))
          .toBe(true);
        expect(
          await item(tokens[1].symbol).evaluate((element) => element.tagName)
        ).toBe('BUTTON');
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(picker(tokens[0].symbol)).toBeVisible();
        await expect(menu).toHaveCount(0);
        await expect(max).toBeEnabled();
        await max.click();
        await expect(amount).toHaveValue(tokens[0].amount);
        observations.enterSelection = {
          symbol: tokens[0].symbol,
          max: await amount.inputValue(),
        };
        await capture(page);
      }
    );
    await wallet.step(
      'Space selects the next token and uses that token precise MAX',
      async (capture) => {
        await tabTo(page, picker(tokens[0].symbol));
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await expect.poll(() => isActive(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect
          .poll(() => isActive(menu, item(tokens[1].symbol)))
          .toBe(true);
        await page.keyboard.press('Space');
        await expect(picker(tokens[1].symbol)).toBeVisible();
        await expect(menu).toHaveCount(0);
        await expect(max).toBeEnabled();
        await max.click();
        await expect(amount).toHaveValue(tokens[1].amount);
        observations.spaceSelection = {
          symbol: tokens[1].symbol,
          max: await amount.inputValue(),
        };
        await capture(page);
      }
    );
    await wallet.step(
      'Escape preserves selection and Tab bypasses the closed menu for MAX',
      async () => {
        const current = picker(tokens[1].symbol);
        await tabTo(page, current);
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await expect.poll(() => isActive(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('Home');
        await expect.poll(() => isActive(menu, item('TSYS'))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(current).toBeFocused();
        await expect(menu).toHaveCount(0);
        await expect(amount).toHaveValue(tokens[1].amount);
        await page.keyboard.press('Tab');
        await expect(max).toBeFocused();
        await expect(page).toHaveURL(/#\/send\/eth$/);
      }
    );
    await wallet.step(
      'pointer token selection and switching back to native remain working',
      async (capture) => {
        await picker(tokens[1].symbol).click();
        await item(tokens[0].symbol).click();
        await expect(picker(tokens[0].symbol)).toBeVisible();
        await expect(max).toBeEnabled();
        await max.click();
        await expect(amount).toHaveValue(tokens[0].amount);
        await picker(tokens[0].symbol).click();
        await item('TSYS').click();
        await expect(picker('TSYS')).toBeVisible();
        await expect(max).toBeEnabled();
        await max.click();
        await expect(amount).toHaveValue('1.0');
        observations.nativeMax = await amount.inputValue();
        await expect(page).toHaveURL(/#\/send\/eth$/);
        expect(
          wallet!.context
            .pages()
            .some((candidate) => candidate.url().includes('/external'))
        ).toBe(false);
        await capture(page);
      }
    );
    await wallet.step(
      'short-window pointer selection reaches the second token above the send footer',
      async (capture) => {
        await page.setViewportSize({ width: 320, height: 360 });
        await expect(picker('TSYS')).toBeVisible();
        await picker('TSYS').click();
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(3);
        await item(tokens[1].symbol).click();
        await expect(picker(tokens[1].symbol)).toBeVisible();
        await expect(menu).toHaveCount(0);
        await expect(max).toBeEnabled();
        await max.click();
        await expect(amount).toHaveValue(tokens[1].amount);
        const tokenMax = await amount.inputValue();
        await picker(tokens[1].symbol).click();
        await item('TSYS').click();
        await expect(picker('TSYS')).toBeVisible();
        await expect(menu).toHaveCount(0);
        await expect(max).toBeEnabled();
        await max.click();
        await expect(amount).toHaveValue('1.0');
        observations.shortWindowPointerSelection = {
          viewport: page.viewportSize(),
          token: tokens[1].symbol,
          tokenMax,
          nativeMax: await amount.inputValue(),
        };
        await expect(page).toHaveURL(/#\/send\/eth$/);
        await capture(page);
      }
    );
    const geometryObservations: {
      chosen: Awaited<ReturnType<typeof collapsedPickerGeometry>>;
      short: Awaited<ReturnType<typeof collapsedPickerGeometry>>;
      width: number;
    }[] = [];
    observations.collapsedPickerGeometry = geometryObservations;
    try {
      for (const width of [320, 400]) {
        await wallet.step(
          `erc20-long-symbol-${width}px: record collapsed picker arrow`,
          async (capture) => {
            await page.setViewportSize({ width, height: 620 });
            const before = await publicTokens(page);
            await expect(picker('TSYS')).toBeVisible();
            await expect(menu).toHaveCount(0);
            await expect(amount).toHaveValue('1.0');
            const short = await collapsedPickerGeometry(picker('TSYS'));
            // Hard setup control: the native short-symbol arrow is painted.
            expect(short.viewBox).toEqual([0, 0, 24, 25]);
            expect(short.paintFullyVisible).toBe(true);
            expect(short.expanded).toBe('false');

            await picker('TSYS').click();
            await item(tokens[0].symbol).click();
            await expect(picker(tokens[0].symbol)).toBeVisible();
            await expect(menu).toHaveCount(0);
            await expect(max).toBeEnabled();
            await max.click();
            await expect(amount).toHaveValue(tokens[0].amount);
            const chosen = await collapsedPickerGeometry(
              picker(tokens[0].symbol)
            );
            expect(chosen.viewBox).toEqual(short.viewBox);
            expect(chosen.text).toBe(tokens[0].symbol);
            expect(chosen.expanded).toBe('false');
            geometryObservations.push({ width, short, chosen });
            await capture(page);

            // Restore the exact healthy native selection through the real menu.
            await picker(tokens[0].symbol).click();
            await item('TSYS').click();
            await expect(picker('TSYS')).toBeVisible();
            await expect(menu).toHaveCount(0);
            await expect(max).toBeEnabled();
            await max.click();
            await expect(amount).toHaveValue('1.0');
            expect(await publicTokens(page)).toEqual(before);
          }
        );
      }
    } finally {
      await wallet.step(
        'erc20-long-symbol-320-and-400px: restore the original viewport',
        async () => {
          await page.setViewportSize({ width: 400, height: 620 });
        }
      );
    }
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    await wallet.step(
      'erc20-long-symbol-320-and-400px: verify arrows after all healthy controls',
      async () => {
        expect(
          geometryObservations.map(({ width, short, chosen }) => ({
            width,
            paintFullyVisible: chosen.paintFullyVisible,
            svgNoNarrowerThanShort: chosen.svg.width >= short.svg.width - 0.5,
            paintNoNarrowerThanShort:
              chosen.paint.width >= short.paint.width - 0.5,
            paintNoShorterThanShort:
              chosen.paint.height >= short.paint.height - 0.5,
          }))
        ).toEqual(
          [320, 400].map((width) => ({
            width,
            paintFullyVisible: true,
            svgNoNarrowerThanShort: true,
            paintNoNarrowerThanShort: true,
            paintNoShorterThanShort: true,
          }))
        );
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('send-asset-picker-keyboard-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          tokenReads,
          deniedWrites,
          fixtureDeniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultReplaced: false,
          signingOrBroadcastRequested: false,
        }),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
