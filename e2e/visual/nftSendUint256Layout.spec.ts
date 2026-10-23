import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';

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

// Controlled raw network reads drive the real import/discovery/Send/Confirm
// and Cancel paths. Preserve full uint256 display and exact unsigned values;
// never click Confirm, replace controller results or broadcast.
const UINT256_MAX =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const RPC = 'https://rpc.tanenbaum.io/';
const viewports = [
  { width: 320, height: 360 },
  { width: 400, height: 620 },
] as const;
type Standard = 'ERC-721' | 'ERC-1155';
type Asset = {
  contract: string;
  control: 'small' | 'uint256';
  quantity: string;
  symbol: string;
  tokenId: string;
};
const scenarios: { assets: Asset[]; standard: Standard }[] = [
  {
    standard: 'ERC-721',
    assets: [
      {
        contract: '0x000000000000000000000000000000000000ca71',
        symbol: 'SMALLID',
        tokenId: '7',
        quantity: '1',
        control: 'small',
      },
      {
        contract: '0x000000000000000000000000000000000000ca72',
        symbol: 'FULLID',
        tokenId: UINT256_MAX,
        quantity: '1',
        control: 'uint256',
      },
    ],
  },
  {
    standard: 'ERC-1155',
    assets: [
      {
        contract: '0x000000000000000000000000000000000000cb71',
        symbol: 'SMALLQTY',
        tokenId: '7',
        quantity: '42',
        control: 'small',
      },
      {
        contract: '0x000000000000000000000000000000000000cb72',
        symbol: 'FULLQTY',
        tokenId: '7',
        quantity: UINT256_MAX,
        control: 'uint256',
      },
    ],
  },
];

async function publicState(page: Page) {
  return page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const ref = vault.activeAccount;
    const account = vault.accounts[ref.type][ref.id];
    return {
      account: { id: ref.id, type: ref.type, address: account.address },
      network: {
        kind: vault.activeNetwork.kind,
        chainId: vault.activeNetwork.chainId,
        url: vault.activeNetwork.url,
      },
    };
  });
}

async function publicConfirmState(page: Page) {
  return page.evaluate(() => {
    const tx = history.state?.usr?.tx;
    return tx
      ? {
          sender: tx.sender,
          receivingAddress: tx.receivingAddress,
          amount: String(tx.amount),
          transactionType: tx.transactionType,
          token: tx.token
            ? {
                contract: tx.token.contractAddress.toLowerCase(),
                tokenId: String(tx.token.tokenId),
                tokenStandard: tx.token.tokenStandard,
                isNft: tx.token.isNft,
              }
            : null,
        }
      : null;
  });
}

async function tabTo(page: Page, target: Locator) {
  // Native sequential focus, never element.focus(), forced clicks or style edits.
  for (let count = 0; count < 32; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => document.activeElement === element))
      break;
  }
  await expect(target).toBeFocused();
}

// Measure real text fragments as well as element boxes. A container can fit
// while its unbroken text is clipped by a horizontal-overflow ancestor.
async function geometry(target: Locator) {
  return target.evaluate((element) => {
    const describe = (node: Element) => {
      const html = node as HTMLElement;
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        id: node.id,
        className: node.getAttribute('class'),
        bounds: node.getBoundingClientRect().toJSON(),
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
        clientHeight: html.clientHeight,
        scrollHeight: html.scrollHeight,
        scrollLeft: html.scrollLeft,
        scrollTop: html.scrollTop,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
        whiteSpace: style.whiteSpace,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        flexShrink: style.flexShrink,
      };
    };
    const bounds = element.getBoundingClientRect();
    const textRange = document.createRange();
    textRange.selectNodeContents(element);
    const textRects = Array.from(textRange.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.toJSON());
    const hit = (x: number, y: number) => {
      const found = document.elementFromPoint(x, y);
      return {
        x,
        y,
        exposed: Boolean(
          found && (found === element || element.contains(found))
        ),
        tag: found?.tagName || null,
        id: found?.id || null,
      };
    };
    const ancestors = [];
    let ancestor = element.parentElement;
    for (let depth = 0; ancestor && depth < 9; depth++) {
      ancestors.push(describe(ancestor));
      ancestor = ancestor.parentElement;
    }
    return {
      text: element.textContent,
      textRects,
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      target: describe(element),
      parent: element.parentElement ? describe(element.parentElement) : null,
      ancestors,
      hits: [
        hit(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
        hit(bounds.left + 1, bounds.top + bounds.height / 2),
        hit(bounds.right - 1, bounds.top + bounds.height / 2),
        hit(bounds.left + bounds.width / 2, bounds.top + 1),
        hit(bounds.left + bounds.width / 2, bounds.bottom - 1),
      ],
    };
  });
}

function assertFullTextGeometry(
  measured: Awaited<ReturnType<typeof geometry>>,
  fullText: string
) {
  expect(measured.text).toBe(fullText);
  expect(measured.target.bounds.width).toBeGreaterThan(0);
  expect(measured.target.bounds.height).toBeGreaterThan(0);
  expect(measured.parent).not.toBeNull();
  const parent = measured.parent!;
  const left = Math.max(0, parent.bounds.left);
  const right = Math.min(measured.viewport.width, parent.bounds.right);
  expect(measured.documentWidth).toBeLessThanOrEqual(
    measured.viewport.width + 1
  );
  expect(measured.target.bounds.left).toBeGreaterThanOrEqual(left - 1);
  expect(measured.target.bounds.right).toBeLessThanOrEqual(right + 1);
  expect(measured.target.bounds.top).toBeGreaterThanOrEqual(0);
  expect(measured.target.bounds.bottom).toBeLessThanOrEqual(
    measured.viewport.height
  );
  expect(measured.target.scrollWidth).toBeLessThanOrEqual(
    measured.target.clientWidth + 1
  );
  expect(parent.scrollWidth).toBeLessThanOrEqual(parent.clientWidth + 1);
  expect(measured.textRects.length).toBeGreaterThan(0);
  for (const line of measured.textRects) {
    expect(line.left).toBeGreaterThanOrEqual(left - 1);
    expect(line.right).toBeLessThanOrEqual(right + 1);
    expect(line.top).toBeGreaterThanOrEqual(measured.target.bounds.top - 1);
    expect(line.bottom).toBeLessThanOrEqual(measured.target.bounds.bottom + 1);
  }
  expect(measured.hits.map((point) => point.exposed)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
}

for (const { standard, assets } of scenarios) {
  for (const viewport of viewports) {
    test(
      standard +
        ' Send and Confirm retain full uint256 text at ' +
        viewport.width +
        'px',
      async ({}, info) => {
        test.setTimeout(120_000);
        expect(info.config.workers).toBe(1);
        expect(info.retry).toBe(0);
        expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
        expect(E2E_CONFIG.extensionPath).toBe(
          process.env.PALI_TEST_DAPP_EXTENSION_PATH
        );
        const previous = { ...E2E_CONFIG };
        const runtime = extensionEvidence();
        const fixture = createIsolatedVaultFixture();
        const server = await startUtxoFixtureServer();
        const observations: unknown[] = [];
        const reads: unknown[] = [];
        const unknownReads: {
          contract: string | null;
          method: string;
          selector: string | null;
          supported: boolean;
          tokenId: string | null;
        }[] = [];
        const deniedWrites: string[] = [];
        const pageErrors: string[] = [];
        let routes:
          | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
          | undefined;
        let wallet: PaliWallet | undefined;
        let status: 'passed' | 'failed' = 'failed';
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'NftUint256LayoutSynthetic!2026',
          rpcUrl: server.url,
        });
        try {
          wallet = await PaliWallet.launch(
            'nft-uint256-layout-' + standard + '-' + viewport.width,
            {
              offlineHttpProxy: server.url,
              viewport: { width: 400, height: 620 },
            }
          );
          routes = await installIsolatedVaultRoutes(
            wallet.context,
            fixture,
            server.url
          );
          const page = wallet.page;
          page.on('pageerror', (error) => pageErrors.push(error.message));
          const abi = AbiCoder.defaultAbiCoder();
          const selector = (signature: string) => id(signature).slice(0, 10);
          const isOwner = (address: unknown) =>
            typeof address === 'string' &&
            address.toLowerCase() === fixture.evmAddresses[0].toLowerCase();
          const knownAddress = (address: unknown) =>
            typeof address === 'string' &&
            fixture.evmAddresses.some(
              (candidate) => candidate.toLowerCase() === address.toLowerCase()
            );
          const findAsset = (address: unknown) =>
            typeof address === 'string'
              ? assets.find((asset) => asset.contract === address.toLowerCase())
              : undefined;
          await wallet.context.route(RPC, async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            const body = route.request().postDataJSON();
            const calls = Array.isArray(body) ? body : [body];
            if (
              calls.some((call: any) =>
                /^(eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
                  call?.method || ''
                )
              )
            ) {
              deniedWrites.push('RPC write/sign attempt');
              return route.abort('blockedbyclient');
            }
            const replies = calls.map((call: any) => {
              const params = call?.params;
              const asset = findAsset(params?.[0]?.to || params?.[0]);
              let result: unknown;
              if (call?.jsonrpc === '2.0' && Array.isArray(params)) {
                if (call.method === 'eth_chainId') result = '0x1644';
                if (call.method === 'net_version') result = '5700';
                if (call.method === 'eth_blockNumber') result = '0x1';
                if (
                  call.method === 'eth_gasPrice' ||
                  call.method === 'eth_maxPriorityFeePerGas'
                )
                  result = '0x3b9aca00';
                if (call.method === 'eth_getBalance' && knownAddress(params[0]))
                  result = '0xde0b6b3a7640000';
                if (
                  call.method === 'eth_getTransactionCount' &&
                  knownAddress(params[0])
                )
                  result = '0x0';
                if (call.method === 'eth_getCode' && asset)
                  result = '0x60006000fd';
                if (call.method === 'eth_getLogs') result = [];
                if (
                  call.method === 'eth_estimateGas' &&
                  isOwner(params[0]?.from) &&
                  findAsset(params[0]?.to)
                )
                  result = '0x186a0';
                if (call.method === 'eth_getBlockByNumber')
                  result = {
                    number: '0x1',
                    hash: '0x' + '12'.repeat(32),
                    parentHash: '0x' + '11'.repeat(32),
                    nonce: '0x0000000000000000',
                    timestamp: '0x1',
                    difficulty: '0x0',
                    gasLimit: '0x1c9c380',
                    gasUsed: '0x0',
                    miner: '0x' + '00'.repeat(20),
                    extraData: '0x',
                    transactions: [],
                    baseFeePerGas: '0x3b9aca00',
                  };
                if (call.method === 'eth_call' && asset) {
                  const data = String(params[0]?.data || '');
                  const prefix = data.slice(0, 10);
                  const decode = (types: string[]) =>
                    abi.decode(types, '0x' + data.slice(10));
                  if (
                    prefix === selector('name()') ||
                    prefix === selector('symbol()')
                  )
                    result = abi.encode(['string'], [asset.symbol]);
                  if (prefix === selector('supportsInterface(bytes4)')) {
                    const [value] = decode(['bytes4']);
                    const interfaces =
                      standard === 'ERC-721'
                        ? ['0x80ac58cd', '0x780e9d63', '0x01ffc9a7']
                        : ['0xd9b67a26', '0x01ffc9a7'];
                    result = abi.encode(['bool'], [interfaces.includes(value)]);
                  }
                  if (standard === 'ERC-721') {
                    if (prefix === selector('balanceOf(address)')) {
                      const [owner] = decode(['address']);
                      result = abi.encode(
                        ['uint256'],
                        [isOwner(owner) ? 1 : 0]
                      );
                    }
                    if (
                      prefix ===
                      selector('tokenOfOwnerByIndex(address,uint256)')
                    ) {
                      const [owner, index] = decode(['address', 'uint256']);
                      if (isOwner(owner) && index === BigInt(0))
                        result = abi.encode(['uint256'], [asset.tokenId]);
                    }
                    if (prefix === selector('ownerOf(uint256)')) {
                      const [tokenId] = decode(['uint256']);
                      // Unknown IDs must revert, including the actual random
                      // fake-contract negative probe. Do not fake all ownership.
                      if (tokenId === BigInt(asset.tokenId))
                        result = abi.encode(
                          ['address'],
                          [fixture.evmAddresses[0]]
                        );
                    }
                    if (prefix === selector('totalSupply()'))
                      result = abi.encode(['uint256'], [1]);
                  } else {
                    if (prefix === selector('balanceOf(address,uint256)')) {
                      const [owner, tokenId] = decode(['address', 'uint256']);
                      result = abi.encode(
                        ['uint256'],
                        [
                          isOwner(owner) && tokenId === BigInt(asset.tokenId)
                            ? asset.quantity
                            : '0',
                        ]
                      );
                    }
                    if (
                      prefix === selector('balanceOfBatch(address[],uint256[])')
                    ) {
                      const [owners, ids] = decode(['address[]', 'uint256[]']);
                      result = abi.encode(
                        ['uint256[]'],
                        [
                          owners.map((owner: string, index: number) =>
                            isOwner(owner) &&
                            ids[index] === BigInt(asset.tokenId)
                              ? asset.quantity
                              : '0'
                          ),
                        ]
                      );
                    }
                  }
                }
              }
              const observation = {
                method: String(call?.method),
                contract: asset?.contract || null,
                selector:
                  call?.method === 'eth_call'
                    ? String(params?.[0]?.data || '').slice(0, 10)
                    : null,
                tokenId:
                  call?.method === 'eth_call' &&
                  String(params?.[0]?.data || '').slice(0, 10) ===
                    selector('ownerOf(uint256)')
                    ? abi
                        .decode(
                          ['uint256'],
                          '0x' + String(params[0].data).slice(10)
                        )[0]
                        .toString()
                    : null,
                supported: result !== undefined,
              };
              reads.push(observation);
              if (result === undefined) unknownReads.push(observation);
              return result === undefined
                ? {
                    jsonrpc: '2.0',
                    id: call?.id,
                    error: {
                      code: -32000,
                      message: 'Unsupported synthetic read',
                    },
                  }
                : { jsonrpc: '2.0', id: call.id, result };
            });
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
            });
          });
          if (standard === 'ERC-1155') {
            await wallet.context.route(
              'https://explorer.tanenbaum.io/api?**',
              async (route) => {
                const url = new URL(route.request().url());
                if (
                  route.request().method() !== 'GET' ||
                  url.searchParams.get('module') !== 'account' ||
                  url.searchParams.get('action') !== 'tokenlist' ||
                  !isOwner(url.searchParams.get('address'))
                )
                  return route.fallback();
                reads.push({
                  method: 'explorer-owned-erc1155',
                  owner: fixture.evmAddresses[0],
                });
                await route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify({
                    status: '1',
                    result: assets.map((asset) => ({
                      contractAddress: asset.contract,
                      type: standard,
                      id: asset.tokenId,
                      name: asset.symbol,
                      symbol: asset.symbol,
                      decimals: '0',
                      balance: asset.quantity,
                    })),
                  }),
                });
              }
            );
          }
          await wallet.step(
            'ordinary isolated onboarding and NFT import',
            async () => {
              await wallet!.importSeedAndCreatePassword();
              await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
              if (standard === 'ERC-721') {
                for (const asset of assets) {
                  await wallet!.gotoRoute('#/tokens/add?tab=custom');
                  const tab = page.getByRole('button', {
                    name: en.tokens.addCustomTab,
                    exact: true,
                  });
                  if (await tab.count()) await tab.first().click();
                  await page
                    .locator('#custom-token-contract')
                    .fill(asset.contract);
                  const importButton = page.getByRole('button', {
                    name: 'Import ' + asset.symbol + ' token',
                    exact: true,
                  });
                  await expect(importButton).toBeEnabled();
                  await importButton.click();
                  await expect(importButton).toBeDisabled();
                }
              } else {
                await wallet!.ensureOnHome();
                await page.locator('#assets-btn').click();
                await page
                  .getByRole('button', {
                    name: en.home.importToken,
                    exact: true,
                  })
                  .click();
                await page
                  .getByRole('button', {
                    name: en.tokens.yourTokens,
                    exact: true,
                  })
                  .click();
                for (const asset of assets) {
                  const importButton = page.getByRole('button', {
                    name: 'Import ' + asset.symbol + ' token',
                    exact: true,
                  });
                  await expect(importButton).toBeEnabled();
                  await importButton.click();
                  await expect(importButton).toBeDisabled();
                }
              }
            }
          );
          const baseline = await publicState(page);
          expect(baseline.account.address.toLowerCase()).toBe(
            fixture.evmAddresses[0].toLowerCase()
          );
          expect(baseline.network).toMatchObject({
            chainId: 5700,
            url: RPC.slice(0, -1),
          });
          for (const asset of assets) {
            await wallet.step(
              'review ' +
                standard +
                ' ' +
                asset.control +
                ' through real Send/Confirm/Cancel',
              async () => {
                await page.setViewportSize({ width: 400, height: 620 });
                await wallet!.gotoRoute('#/send/eth');
                const trigger = page.getByRole('button', {
                  name: new RegExp(
                    '^(TSYS|' +
                      assets.map((entry) => entry.symbol).join('|') +
                      ')$'
                  ),
                });
                await expect(trigger).toBeVisible();
                await trigger.click();
                await page
                  .locator('button[role="menuitem"]')
                  .filter({ hasText: asset.symbol })
                  .click();
                await page
                  .getByPlaceholder(en.send.receiver)
                  .fill(fixture.evmAddresses[1]);
                await page.setViewportSize(viewport);
                let sendObservation: unknown;
                if (standard === 'ERC-721') {
                  const quickId = page.getByRole('button', {
                    name: '#' + asset.tokenId,
                    exact: true,
                  });
                  await expect(quickId).toBeVisible();
                  sendObservation = { initial: await geometry(quickId) };
                  await quickId.scrollIntoViewIfNeeded();
                  const afterNativeScroll = await geometry(quickId);
                  assertFullTextGeometry(
                    afterNativeScroll,
                    '#' + asset.tokenId
                  );
                  await info.attach(
                    asset.control + '-erc721-send-' + viewport.width,
                    {
                      contentType: 'image/png',
                      body: await page.screenshot({ animations: 'disabled' }),
                    }
                  );
                  await tabTo(page, quickId);
                  await page.keyboard.press('Enter');
                  await expect(page.locator('#nftTokenId')).toHaveValue(
                    asset.tokenId
                  );
                  const afterNativeKeyboardSelection = await geometry(quickId);
                  assertFullTextGeometry(
                    afterNativeKeyboardSelection,
                    '#' + asset.tokenId
                  );
                  sendObservation = {
                    ...(sendObservation as object),
                    afterNativeScroll,
                    afterNativeKeyboardSelection,
                    exactSelectedTokenId: await page
                      .locator('#nftTokenId')
                      .inputValue(),
                  };
                } else {
                  const max = page.getByRole('button', {
                    name: en.send.max,
                    exact: true,
                  });
                  await expect(max).toBeEnabled();
                  await tabTo(page, max);
                  await page.keyboard.press('Enter');
                  await expect(page.locator('#with-max-button')).toHaveValue(
                    asset.quantity
                  );
                  sendObservation = {
                    exactSelectedQuantity: await page
                      .locator('#with-max-button')
                      .inputValue(),
                    amountInput: await geometry(
                      page.locator('#with-max-button')
                    ),
                  };
                  await info.attach(
                    asset.control + '-erc1155-send-' + viewport.width,
                    {
                      contentType: 'image/png',
                      body: await page.screenshot({ animations: 'disabled' }),
                    }
                  );
                }
                const next = page.getByRole('button', {
                  name: en.buttons.next,
                  exact: true,
                });
                await expect(next).toBeEnabled();
                await next.click();
                await expect(page).toHaveURL(/#\/send\/confirm$/);
                const tx = await publicConfirmState(page);
                expect(tx).toMatchObject({
                  sender: baseline.account.address,
                  receivingAddress: fixture.evmAddresses[1],
                  // ERC721 omits its amount Form.Item; only its exact tokenId
                  // identifies the singleton. ERC1155 keeps exact quantity.
                  amount: standard === 'ERC-721' ? 'undefined' : asset.quantity,
                  token: {
                    contract: asset.contract,
                    tokenId: asset.tokenId,
                    tokenStandard: standard,
                    isNft: true,
                  },
                });
                expect(await publicState(page)).toEqual(baseline);
                const confirm = page.getByRole('button', {
                  name: en.buttons.confirm,
                  exact: true,
                });
                await expect(confirm).toBeEnabled();
                let confirmObservation: unknown = null;
                if (standard === 'ERC-1155') {
                  const amountRow = page
                    .getByText(en.send.amount, { exact: true })
                    .locator('..');
                  const amountValue = amountRow.locator('p').nth(1);
                  await expect(amountValue).toHaveText(asset.quantity);
                  confirmObservation = { initial: await geometry(amountValue) };
                  await amountValue.scrollIntoViewIfNeeded();
                  const afterNativeScroll = await geometry(amountValue);
                  assertFullTextGeometry(afterNativeScroll, asset.quantity);
                  confirmObservation = {
                    ...(confirmObservation as object),
                    afterNativeScroll,
                  };
                }
                await info.attach(
                  asset.control + '-confirm-' + viewport.width,
                  {
                    contentType: 'image/png',
                    body: await page.screenshot({ animations: 'disabled' }),
                  }
                );
                observations.push({
                  standard,
                  control: asset.control,
                  viewport,
                  publicAsset: asset,
                  send: sendObservation,
                  confirm: confirmObservation,
                  exactUnsignedRoute: tx,
                  identityBeforeCancel: await publicState(page),
                  confirmClicked: false,
                });
                const cancel = page.getByRole('button', {
                  name: en.buttons.cancel,
                  exact: true,
                });
                await cancel.click();
                await expect(page).toHaveURL(/#\/send\/eth$/);
                if (standard === 'ERC-721')
                  await expect(page.locator('#nftTokenId')).toHaveValue(
                    asset.tokenId
                  );
                else
                  await expect(page.locator('#with-max-button')).toHaveValue(
                    asset.quantity
                  );
                await expect(
                  page.getByPlaceholder(en.send.receiver)
                ).toHaveValue(fixture.evmAddresses[1]);
                expect(await publicState(page)).toEqual(baseline);
                expect(deniedWrites).toEqual([]);
                expect(routes!.deniedWrites).toEqual([]);
                expect(pageErrors).toEqual([]);
                // Unknown reads are never broadly accepted: only the genuine
                // ERC721 fake-contract negative ownerOf probe may revert.
                if (standard === 'ERC-1155') expect(unknownReads).toEqual([]);
                else {
                  expect(unknownReads.length).toBeGreaterThan(0);
                  for (const read of unknownReads) {
                    const probed = assets.find(
                      (entry) => entry.contract === read.contract
                    );
                    expect(probed).toBeDefined();
                    expect(read).toMatchObject({
                      method: 'eth_call',
                      selector: selector('ownerOf(uint256)'),
                      supported: false,
                    });
                    expect(read.tokenId).toMatch(/^\d+$/);
                    expect(read.tokenId).not.toBe(probed!.tokenId);
                  }
                }
              }
            );
          }
          status = 'passed';
        } finally {
          try {
            await info.attach(
              'nft-uint256-layout-public-measurements-' +
                standard +
                '-' +
                viewport.width,
              {
                contentType: 'application/json',
                body: JSON.stringify(
                  {
                    simulated: true,
                    runtime,
                    specSha256: createHash('sha256')
                      .update(fs.readFileSync(info.file))
                      .digest('hex'),
                    simulatedReadFixtures: true,
                    noControllerOrSdkResultReplacement: true,
                    confirmClicked: false,
                    signingOrBroadcastingPermitted: false,
                    standard,
                    viewport,
                    observations,
                    reads,
                    unknownReads,
                    deniedWrites,
                    fixtureDeniedWrites: routes?.deniedWrites || [],
                    fixtureReads: routes?.reads || [],
                    proxyDeniedConnections: server.blocked.length,
                    pageErrors,
                  },
                  null,
                  2
                ),
              }
            );
          } finally {
            try {
              await wallet?.dispose(status);
            } finally {
              await server.close();
              Object.assign(E2E_CONFIG, previous);
            }
          }
        }
      }
    );
  }
}
