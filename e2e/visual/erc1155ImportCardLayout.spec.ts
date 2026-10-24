import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Exercise ordinary custom-import previews through the genuine SDK ABI boundary,
// not controller replies or renderer state. Verify painted text readability as
// well as collision-free icon/action geometry.
// Add Custom has no Cancel approval: dismiss its actual Details Close and header
// Close, then prove unchanged live/saved inventory. No token is imported.
const CONTRACT = '0x000000000000000000000000000000000000e115';
const SYMBOL = 'IMPORT1155'; // Ten valid ordinary symbol characters.
const NAME = 'Synthetic Responsive Editions';
const QUANTITY = '2'; // Ordinary nonzero quantity; no huge-number assumption.
const selector = (signature: string) => id(signature).slice(0, 10);
const BLACKLIST_FEEDS = new Map<string, unknown>([
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    { blacklist: [], whitelist: [], fuzzylist: [] },
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
    [],
  ],
]);

const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return url.origin + url.pathname + (query.size ? '?' + query : '');
};

const publicInventory = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const reference = state.vault.activeAccount;
    const account = state.vault.accounts[reference.type][reference.id];
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const saved = await chrome.storage.local.get([key]);
    const assets = (value: any) =>
      (value?.[reference.type]?.[reference.id]?.ethereum || []).map(
        (asset: any) => ({
          id: asset.id,
          contractAddress: asset.contractAddress,
          chainId: asset.chainId,
          symbol: asset.tokenSymbol || asset.symbol,
          tokenStandard: asset.tokenStandard,
          tokenId: asset.tokenId,
          balance: asset.balance,
          rawBalance: asset.rawBalance,
        })
      );
    return {
      account: {
        id: reference.id,
        type: reference.type,
        address: account.address,
      },
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      live: assets(state.vault.accountAssets),
      saved: assets(saved[key]?.accountAssets),
    };
  });

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

// Use ordinary bounded wheel gestures, never element.scrollIntoView/scrollTop or
// focus injection. Root must inspect the resulting real screenshot separately.
const revealCard = async (page: Page, row: Locator) => {
  const wheels: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const before = await row.boundingBox();
    expect(before).not.toBeNull();
    const height = page.viewportSize()!.height;
    if (before!.y >= 16 && before!.y + before!.height <= height - 16) break;
    const delta =
      before!.y < 16
        ? Math.floor(before!.y - 16)
        : Math.ceil(before!.y + before!.height - (height - 16));
    await page.mouse.move(page.viewportSize()!.width / 2, height / 2);
    await page.mouse.wheel(0, delta);
    wheels.push(delta);
    await expect
      .poll(async () => {
        const after = await row.boundingBox();
        return delta > 0 ? after!.y < before!.y : after!.y > before!.y;
      })
      .toBe(true);
    await frame(page);
  }
  const after = await row.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y).toBeGreaterThanOrEqual(0);
  expect(after!.y + after!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height
  );
  await page.mouse.move(2, 2);
  return wheels;
};

const inspectCard = (row: Locator) =>
  row.evaluate((element, symbol) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const describe = (node: Element | null) =>
      node
        ? {
            tag: node.tagName,
            role: node.getAttribute('role'),
            classes: typeof node.className === 'string' ? node.className : '',
          }
        : null;
    const main = element.firstElementChild!;
    const icon = main.firstElementChild!;
    const badge = Array.from(element.querySelectorAll('div')).find(
      (node) =>
        node.classList.contains('rounded-full') &&
        node.textContent?.trim() === 'ERC-1155'
    )!;
    const textColumn = Array.from(main.children).find((node) =>
      node.classList.contains('flex-col')
    )!;
    const symbolNode = Array.from(textColumn.querySelectorAll('span')).find(
      (node) =>
        node.classList.contains('underline') &&
        node.textContent?.includes(symbol)
    )!;
    const balanceNode = textColumn.querySelector('p')?.firstElementChild!;
    const identifier = textColumn.querySelector('p.break-all')!;
    const tokenId = textColumn.querySelector('p.font-mono')!;
    const buttons = Array.from(element.querySelectorAll('button'));
    const painted = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      const fragments = Array.from(range.getClientRects())
        .filter((fragment) => fragment.width > 0 && fragment.height > 0)
        .map((fragment) => ({
          left: fragment.left,
          right: fragment.right,
          top: fragment.top,
          bottom: fragment.bottom,
        }));
      const lineTops: number[] = [];
      for (const fragment of fragments)
        if (!lineTops.some((top) => Math.abs(top - fragment.top) <= 1))
          lineTops.push(fragment.top);
      const visible = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
      const clips: any[] = [];
      for (
        let ancestor: Element | null = node;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        const clipX = ['auto', 'scroll', 'hidden', 'clip'].includes(
          style.overflowX
        );
        const clipY = ['auto', 'scroll', 'hidden', 'clip'].includes(
          style.overflowY
        );
        if (clipX) {
          visible.left = Math.max(visible.left, bounds.left);
          visible.right = Math.min(visible.right, bounds.right);
        }
        if (clipY) {
          visible.top = Math.max(visible.top, bounds.top);
          visible.bottom = Math.min(visible.bottom, bounds.bottom);
        }
        if (clipX || clipY)
          clips.push({
            ...describe(ancestor),
            box: box(ancestor),
            clipX,
            clipY,
          });
      }
      return {
        text: node.textContent,
        box: box(node),
        range: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
        fragments,
        lineTops,
        painted: visible,
        clips,
      };
    };
    const pointHits = (node: Element) => {
      const bounds = box(node);
      // Quadrant centers are inside the existing circular icon buttons. Bounding
      // box corners are outside a rounded hit target and would false-fail even
      // the healthy layout; the center alone would miss genuine narrow clipping.
      const insetX = bounds.width / 4,
        insetY = bounds.height / 4;
      return [
        { x: bounds.left + insetX, y: bounds.top + insetY },
        { x: bounds.right - insetX, y: bounds.top + insetY },
        { x: bounds.left + insetX, y: bounds.bottom - insetY },
        { x: bounds.right - insetX, y: bounds.bottom - insetY },
        {
          x: (bounds.left + bounds.right) / 2,
          y: (bounds.top + bounds.bottom) / 2,
        },
      ].map((point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          ...point,
          hit: describe(hit),
          withinTarget: Boolean(hit && node.contains(hit)),
          withinCard: Boolean(hit && element.contains(hit)),
        };
      });
    };
    const texts = {
      balance: painted(balanceNode),
      symbol: painted(symbolNode),
      identifier: painted(identifier),
      tokenId: painted(tokenId),
    };
    const obstacles = [
      { name: 'standard badge', box: box(badge) },
      ...buttons.map((button, index) => ({
        name: button.getAttribute('aria-label') || `button-${index}`,
        box: box(button),
      })),
    ];
    const collisions = Object.entries(texts).flatMap(([name, text]) =>
      obstacles.flatMap((obstacle) => {
        const width =
          Math.min(text.painted.right, obstacle.box.right) -
          Math.max(text.painted.left, obstacle.box.left);
        const height =
          Math.min(text.painted.bottom, obstacle.box.bottom) -
          Math.max(text.painted.top, obstacle.box.top);
        return width > 1 && height > 1
          ? [{ text: name, obstacle: obstacle.name, width, height }]
          : [];
      })
    );
    const rowBox = box(element),
      iconBox = box(icon);
    const iconContained =
      iconBox.width >= 23.5 &&
      iconBox.height >= 23.5 &&
      iconBox.left >= rowBox.left &&
      iconBox.right <= rowBox.right &&
      iconBox.top >= rowBox.top &&
      iconBox.bottom <= rowBox.bottom;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      row: rowBox,
      main: box(main),
      textColumn: box(textColumn),
      texts,
      collisions,
      icon: {
        ...describe(icon),
        box: iconBox,
        hits: pointHits(icon),
        contained: iconContained,
      },
      badge: { box: box(badge), text: badge.textContent },
      buttons: buttons.map((button) => ({
        label: button.getAttribute('aria-label'),
        box: box(button),
        disabled: button.disabled,
        hits: pointHits(button),
      })),
      fullCardInViewport:
        rowBox.left >= 0 &&
        rowBox.right <= innerWidth &&
        rowBox.top >= 0 &&
        rowBox.bottom <= innerHeight,
    };
  }, SYMBOL);

for (const { viewport, tokenId } of [
  { viewport: { width: 400, height: 620 }, tokenId: '7' },
  { viewport: { width: 320, height: 360 }, tokenId: '7' },
  { viewport: { width: 320, height: 360 }, tokenId: '1234567890123456' },
]) {
  const TOKEN_ID = tokenId;
  const caseName = `${viewport.width}x${viewport.height}${
    TOKEN_ID === '7' ? '' : '-id-' + TOKEN_ID
  }`;
  test(`ordinary ERC1155 custom preview keeps identity, badge and actions distinct at ${caseName}`, async ({}, info) => {
    expect(process.version).toBe('v23.11.1');
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
    const fixture = createIsolatedVaultFixture();
    const abi = AbiCoder.defaultAbiCoder();
    const config = getNetworkConfig(57, 'sys');
    const initialXpub = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      config.networks,
      57,
      config.types.zPubType,
      84
    ).getAccountXpub();
    const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
    const addRead = (url: string, body: unknown) =>
      auxiliary.set(requestKey(new URL(url)), body);
    const emptyInventory = {
      address: initialXpub,
      balance: '0',
      unconfirmedBalance: '0',
      totalReceived: '0',
      totalSent: '0',
      txs: 0,
      unconfirmedTxs: 0,
      usedTokens: 0,
      tokens: [],
      tokensAsset: [],
      transactions: [],
    };
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addRead(origin + '/api/v2/tickers/currency', {
        ts: 1,
        rates: { usd: 1, eur: 0.2 },
      });
    for (const query of [
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ])
      addRead(
        'https://blockbook.syscoin.org/api/v2/xpub/' +
          initialXpub +
          '?' +
          query,
        emptyInventory
      );
    addRead(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
      { syscoin: { usd: 0.125, usd_24h_change: 0 } }
    );
    for (const owner of fixture.evmAddresses)
      for (const action of [
        'tokenlist',
        'txlist',
        'pendingtxlist',
        'tokentx',
      ]) {
        const url = new URL('https://explorer.tanenbaum.io/api');
        url.searchParams.set('module', 'account');
        url.searchParams.set('action', action);
        url.searchParams.set('address', owner);
        if (action === 'txlist' || action === 'tokentx')
          url.searchParams.set('sort', 'desc');
        addRead(url.href, {
          status: action === 'tokenlist' ? '1' : '0',
          message: action === 'tokenlist' ? 'OK' : 'No transactions found',
          result: [],
        });
      }
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ImportCardSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const reads: Array<{ method: string; url: string }> = [];
    const contractReads: any[] = [];
    const deniedWrites: string[] = [];
    const malformedContractReads: string[] = [];
    const unsupportedContractReads: string[] = [];
    const failures: Array<{
      method: string;
      url: string;
      error: string | null;
    }> = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = {
      runtime,
      sourceSha256,
      metadata: {
        contract: CONTRACT,
        symbol: SYMBOL,
        name: NAME,
        tokenId: TOKEN_ID,
        quantity: QUANTITY,
      },
    };
    let expectedInventory: Awaited<ReturnType<typeof publicInventory>>;
    try {
      wallet = await PaliWallet.launch(`erc1155-import-card-${caseName}`, {
        offlineHttpProxy: server.url,
        viewport,
      });
      const page = wallet.page;
      const step = (
        name: string,
        action: (capture: (target: Page) => Promise<void>) => Promise<void>
      ) => wallet!.step(`${caseName}: ${name}`, action);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('page', (newPage) =>
        newPage.on('pageerror', (error) => pageErrors.push(error.message))
      );
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          reads.push({ method: request.method(), url: request.url() });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname)) deniedWrites.push('sendtx');
        try {
          const payload = request.postDataJSON();
          for (const call of Array.isArray(payload) ? payload : [payload])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              deniedWrites.push(call.method);
        } catch {
          /* Ordinary GET/local HTML has no RPC body. */
        }
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failures.push({
            method: request.method(),
            url: request.url(),
            error: request.failure()?.errorText || null,
          });
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url,
        (url) =>
          !url.username && !url.password && !url.hash
            ? auxiliary.get(requestKey(url))
            : undefined
      );
      // Public ABI reads only, exactly one target contract and synthetic owner.
      // Detector IDs may be random; only this case's TOKEN_ID owns2, all others0.
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') return route.fallback();
        const rpc = request.postDataJSON();
        const calls = Array.isArray(rpc) ? rpc : [rpc];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          deniedWrites.push('attempted-write-or-sign');
          return route.abort('blockedbyclient');
        }
        if (
          !calls.some(
            (call: any) =>
              ['eth_call', 'eth_getCode'].includes(call?.method) &&
              (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() ===
                CONTRACT
          )
        )
          return route.fallback();
        const replies = calls.map((call: any) => {
          let result: unknown;
          if (call?.method === 'eth_chainId') result = '0x1644';
          const target = (
            call?.params?.[0]?.to || call?.params?.[0]
          )?.toLowerCase();
          if (call?.method === 'eth_getCode' && target === CONTRACT) {
            contractReads.push({ method: call.method, target });
            result = '0x60006000fd';
          }
          if (call?.method === 'eth_call' && target === CONTRACT) {
            try {
              const data = String(call.params[0].data),
                prefix = data.slice(0, 10);
              contractReads.push({
                method: call.method,
                target,
                selector: prefix,
              });
              if (prefix === selector('name()'))
                result = abi.encode(['string'], [NAME]);
              if (prefix === selector('symbol()'))
                result = abi.encode(['string'], [SYMBOL]);
              if (prefix === selector('supportsInterface(bytes4)')) {
                const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
                contractReads.push({ interface: value });
                result = abi.encode(
                  ['bool'],
                  [value === '0xd9b67a26' || value === '0x01ffc9a7']
                );
              }
              if (prefix === selector('balanceOf(address,uint256)')) {
                const [owner, tokenId] = abi.decode(
                  ['address', 'uint256'],
                  `0x${data.slice(10)}`
                );
                if (
                  owner.toLowerCase() === fixture.evmAddresses[0].toLowerCase()
                ) {
                  const token = String(tokenId);
                  contractReads.push({
                    owner,
                    tokenIds: [token],
                    balances: [token === TOKEN_ID ? QUANTITY : '0'],
                  });
                  result = abi.encode(
                    ['uint256'],
                    [token === TOKEN_ID ? QUANTITY : '0']
                  );
                } else
                  malformedContractReads.push(
                    'Unexpected ERC1155 owner:' + owner
                  );
              }
              if (prefix === selector('balanceOfBatch(address[],uint256[])')) {
                const [owners, tokenIds] = abi.decode(
                  ['address[]', 'uint256[]'],
                  `0x${data.slice(10)}`
                );
                if (
                  owners.length === tokenIds.length &&
                  owners.every(
                    (owner: string) =>
                      owner.toLowerCase() ===
                      fixture.evmAddresses[0].toLowerCase()
                  )
                ) {
                  const ids = Array.from(tokenIds, String);
                  const balances = ids.map((token) =>
                    token === TOKEN_ID ? QUANTITY : '0'
                  );
                  contractReads.push({ tokenIds: ids, balances });
                  result = abi.encode(['uint256[]'], [balances]);
                } else
                  malformedContractReads.push(
                    'Unexpected ERC1155 batch owners'
                  );
              }
              if (result === undefined) unsupportedContractReads.push(prefix);
            } catch (error) {
              malformedContractReads.push(String(error));
            }
          }
          return result === undefined
            ? {
                jsonrpc: '2.0',
                id: call.id,
                error: { code: -32000, message: 'Unsupported synthetic read' },
              }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
        });
      });
      const assertInventory = async () => {
        const value = await publicInventory(page);
        expect(value).toEqual(expectedInventory);
        return value;
      };
      await step(
        'onboard a disposable wallet and choose the ordinary built-in EVM network',
        async () => {
          observations.workerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerIdentity = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          expectedInventory = await publicInventory(page);
          expect(expectedInventory.network).toMatchObject({
            kind: 'ethereum',
            chainId: 5700,
            url: 'https://rpc.tanenbaum.io',
          });
          expect(expectedInventory.account.address).toBe(
            fixture.evmAddresses[0]
          );
          expect(expectedInventory.live).toEqual([]);
          expect(expectedInventory.saved).toEqual([]);
          observations.initialInventory = expectedInventory;
        }
      );
      const importName = en.tokens.importNamedToken.replace(
        '{{symbol}}',
        SYMBOL
      );
      const detailsName = en.tokens.viewTokenDetails.replace(
        '{{symbol}}',
        SYMBOL
      );
      const row = () =>
        page.getByRole('listitem').filter({
          has: page.getByRole('button', { name: importName, exact: true }),
        });
      await step(
        'reach Add Custom through Assets and let the real SDK verify the ERC1155 ID',
        async (capture) => {
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
          const field = page.locator('#custom-token-contract');
          const custom = page
            .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
            .first();
          await expect(field.or(custom).first()).toBeVisible();
          if (await custom.isVisible()) await custom.click();
          await field.fill(CONTRACT);
          await expect(page.locator('#custom-token-id')).toBeVisible();
          await page.locator('#custom-token-id').fill(TOKEN_ID);
          await expect(
            page.getByRole('button', { name: importName, exact: true })
          ).toBeEnabled();
          await expect(row()).toHaveCount(1);
          await expect(row()).toContainText(SYMBOL);
          await expect(row()).toContainText('ERC-1155');
          await expect(row()).toContainText('#' + TOKEN_ID);
          expect(contractReads).toContainEqual(
            expect.objectContaining({
              tokenIds: [TOKEN_ID],
              balances: [QUANTITY],
            })
          );
          expect(contractReads).toContainEqual({ interface: '0xd9b67a26' });
          await assertInventory();
          await capture(page);
        }
      );
      await step(
        'reveal the same settled card with ordinary scrolling and retain pixel evidence',
        async (capture) => {
          observations.revealWheels = await revealCard(page, row());
          observations.previewLayout = await inspectCard(row());
          expect(observations.previewLayout.fullCardInViewport).toBe(true);
          expect(observations.previewLayout.buttons).toHaveLength(2);
          expect(observations.previewLayout.texts.symbol.text).toContain(
            SYMBOL
          );
          expect(observations.previewLayout.texts.balance.text).toBe(QUANTITY);
          expect(observations.previewLayout.texts.tokenId.text).toBe(
            '#' + TOKEN_ID
          );
          expect(
            observations.previewLayout.buttons.map(
              (button: any) => button.disabled
            )
          ).toEqual([false, false]);
          await assertInventory();
          await capture(page);
        }
      );
      await step(
        'use the actual native Details action and real Details Close without importing',
        async (capture) => {
          // The ID input retains native focus through scrolling. Its next native
          // stop is the separately named Details button, not the clickable span.
          await expect(page.locator('#custom-token-id')).toBeFocused();
          await page.keyboard.press('Tab');
          const details = row().getByRole('button', {
            name: detailsName,
            exact: true,
          });
          await expect(details).toBeFocused();
          observations.detailsButtonBeforeOpen = await details.evaluate(
            (element) => ({
              focused: element === document.activeElement,
              rect: element.getBoundingClientRect().toJSON(),
            })
          );
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home\/details$/);
          await expect(
            page.locator('[data-navigation-scroll="asset-details"]')
          ).toBeVisible();
          await expect(
            page.getByText('#' + TOKEN_ID, { exact: true })
          ).toBeVisible();
          const publicPreview = await page.evaluate(() => {
            const value = history.state?.usr || {};
            return {
              contractAddress: value.contractAddress,
              tokenId: value.tokenId,
              chainId: value.chainId,
              symbol: value.symbol,
              isImportPreview: value.isImportPreview,
            };
          });
          expect(publicPreview).toEqual({
            contractAddress: CONTRACT,
            tokenId: TOKEN_ID,
            chainId: 5700,
            symbol: SYMBOL,
            isImportPreview: true,
          });
          observations.detailsPreview = publicPreview;
          await assertInventory();
          await capture(page);
          const close = page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .filter({ hasText: en.buttons.close });
          await expect(close).toHaveCount(1);
          await close.click();
          await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
          await expect(page.locator('#custom-token-contract')).toHaveValue(
            CONTRACT
          );
          await expect(page.locator('#custom-token-id')).toHaveValue(TOKEN_ID);
          await expect(
            page.getByRole('button', { name: importName, exact: true })
          ).toBeEnabled();
          await assertInventory();
        }
      );
      await step(
        'dismiss Add Custom through its actual header Close and preserve live and saved inventory',
        async () => {
          // There is no Cancel approval in Add Custom. Do not fabricate4100 or
          // import/Send simply to create a cancellation unrelated to this card.
          const close = page.getByRole('button', {
            name: en.buttons.close,
            exact: true,
          });
          await expect(close).toHaveCount(1);
          await close.click();
          await expect(page).toHaveURL(/#\/home$/);
          observations.finalInventory = await assertInventory();
        }
      );
      await step(
        'finish immutable runtime source and strict no-write read-boundary audits',
        async () => {
          observations.finalWorkerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.finalWorkerIdentity = value;
            }
          );
          expect(routes!.deniedWrites).toEqual([]);
          expect(deniedWrites).toEqual([]);
          expect(malformedContractReads).toEqual([]);
          expect(failures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await step(
        'painted token metadata does not collide with the standard badge or either action',
        async () => {
          // Defer layout assertions until real Close controls and all audits
          // complete; the healthy400 case and suspected320 case keep equal scope.
          const value = observations.previewLayout;
          expect(value.collisions).toEqual([]);
          expect(value.icon.contained).toBe(true);
          expect(
            value.icon.hits.every((point: any) => point.withinTarget)
          ).toBe(true);
          expect(
            value.buttons.every((button: any) =>
              button.hits.every((point: any) => point.withinTarget)
            )
          ).toBe(true);
        }
      );
      await step(
        'ordinary shortened metadata remains readable rather than collapsing into character columns',
        async () => {
          // Exact ordinary fixture only: do not force all localized unavailable
          // labels or large formatted balances into one line. Keep this after
          // actual Details/Close controls and immutable no-write audits.
          const value = observations.previewLayout;
          for (const name of ['identifier', 'symbol', 'tokenId', 'balance']) {
            const text = value.texts[name];
            expect(text.lineTops, name + ' line count').toHaveLength(1);
            expect(
              text.painted.left,
              name + ' left containment'
            ).toBeGreaterThanOrEqual(value.textColumn.left - 1);
            expect(
              text.painted.right,
              name + ' right containment'
            ).toBeLessThanOrEqual(value.textColumn.right + 1);
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('erc1155-import-card-layout-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            reads,
            contractReads,
            unsupportedContractReads,
            malformedContractReads,
            deniedWrites,
            fixtureDeniedWrites: routes?.deniedWrites || [],
            failures,
            pageErrors,
            proxyDeniedConnections: server.blocked.length,
            proxyCountIsPlatformEvidenceOnly: true,
            controllerRepliesReplaced: false,
            runtimeMessagesManufactured: false,
            reduxOrDOMReplaced: false,
            cacheOrAlarmModified: false,
            importActionActivated: false,
            signingOrBroadcastRequested: false,
            actualDismissal:
              'Details Close, then Add Custom header Close; this is not an approval Cancel',
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
}
