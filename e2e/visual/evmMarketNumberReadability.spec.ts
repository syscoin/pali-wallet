import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
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

// Four ordinary imported tokens avoid cache mutation and isolate healthy,
// high-price, high-supply and missing-optional-data HTTP inputs.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RPC = 'https://ethereum-rpc.publicnode.com/';
const EXPLORER =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const MARKET_QUERY =
  'localization=false&tickers=false&market_data=true&community_data=false&developer_data=false';
const variants = [
  {
    key: 'healthy-small',
    contract: '0x000000000000000000000000000000000000ea31',
    symbol: 'MKSMALL',
    price: 55.125,
    priceText: '$55.125000',
    cap: 1000,
    volume: 200,
    supply: 20,
    change: 1.25,
    missing: false,
  },
  {
    key: 'large-price',
    contract: '0x000000000000000000000000000000000000ea32',
    symbol: 'MKPRICE',
    price: 123456.789012,
    priceText: '$123,456.789012',
    cap: 1524157763908,
    volume: 123456789012,
    supply: 12345678,
    change: 12.34,
    missing: false,
  },
  {
    key: 'large-supply',
    contract: '0x000000000000000000000000000000000000ea33',
    symbol: 'MKSUPPLY',
    price: 0.012345678901,
    priceText: '$0.012346',
    cap: 1524157875171,
    volume: 123456789012,
    supply: 123456789012345,
    change: -12.34,
    missing: false,
  },
  {
    key: 'missing-optionals',
    contract: '0x000000000000000000000000000000000000ea34',
    symbol: 'MKPART',
    price: 55.125,
    priceText: '$55.125000',
    cap: null,
    volume: null,
    supply: 20,
    change: null,
    missing: true,
  },
] as const;
type Variant = (typeof variants)[number];
const contracts: readonly string[] = variants.map((value) => value.contract);
const byContract = new Map<string, Variant>(
  variants.map((value) => [value.contract, value])
);
const feeds = new Map<string, unknown>([
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
// A static transparent PNG is only the finite CoinGecko favicon HTTP input;
// this numeric-layout suite makes no claim about icon artwork or branding.
const favicon = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state', 'language']);
    const saved = disk[key];
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
            xpub: account.xpub ?? null,
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const token = (asset: any) => ({
      id: asset.id ?? null,
      chainId: asset.chainId ?? null,
      contract: asset.contractAddress?.toLowerCase() ?? asset.contract ?? null,
      guid: asset.assetGuid ?? null,
      symbol: asset.tokenSymbol ?? asset.symbol ?? null,
      name: asset.name ?? null,
      decimals: asset.decimals ?? null,
      balance: asset.balance === undefined ? null : String(asset.balance),
      isNft: asset.isNft ?? null,
      standard: asset.tokenStandard ?? null,
      tokenId: asset.tokenId ?? null,
    });
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(
            ([accountId, families]: [string, any]) => ({
              kind,
              id: Number(accountId),
              ethereum: (families?.ethereum || []).map(token),
              syscoin: (families?.syscoin || []).map(token),
              nfts: (families?.nfts || []).map(token),
            })
          )
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    return {
      active: state.vault.activeAccount,
      savedActive: saved?.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
        apiUrl: state.vault.activeNetwork.apiUrl,
      },
      language: disk.language || 'en',
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(saved),
      liveAssets: assets(state.vault),
      savedAssets: assets(saved),
      grants: Object.keys(state.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
    };
  });
type PublicState = Awaited<ReturnType<typeof publicState>>;
const targetTokens = (state: PublicState, side: 'liveAssets' | 'savedAssets') =>
  state[side]
    .flatMap((group) =>
      group.ethereum.map((asset) => ({
        ...asset,
        accountKind: group.kind,
        accountId: group.id,
      }))
    )
    .filter(
      (asset: any) => asset.chainId === 1 && contracts.includes(asset.contract)
    )
    .sort((a: any, b: any) => a.contract.localeCompare(b.contract));
const withoutTargets = (state: PublicState) => ({
  ...state,
  liveAssets: state.liveAssets.map((group) => ({
    ...group,
    ethereum: group.ethereum.filter(
      (asset: any) =>
        !(
          group.kind === state.active.type &&
          group.id === state.active.id &&
          asset.chainId === 1 &&
          contracts.includes(asset.contract)
        )
    ),
  })),
  savedAssets: state.savedAssets.map((group) => ({
    ...group,
    ethereum: group.ethereum.filter(
      (asset: any) =>
        !(
          group.kind === state.active.type &&
          group.id === state.active.id &&
          asset.chainId === 1 &&
          contracts.includes(asset.contract)
        )
    ),
  })),
});
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 56; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};
const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
// Bounded real wheel only; measurements never assign scroll or focus.
const reveal = async (page: Page, target: Locator) => {
  const gestures: number[] = [];
  for (let count = 0; count < 6; count += 1) {
    const rect = await target.boundingBox();
    expect(rect).not.toBeNull();
    const viewport = page.viewportSize()!;
    if (rect!.y >= 12 && rect!.y + rect!.height <= viewport.height - 12)
      return gestures;
    const delta =
      rect!.y < 12
        ? Math.floor(rect!.y - 12)
        : Math.ceil(rect!.y + rect!.height - (viewport.height - 12));
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, Math.max(-240, Math.min(240, delta)));
    gestures.push(Math.max(-240, Math.min(240, delta)));
    await frame(page);
  }
  const rect = await target.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height
  );
  return gestures;
};

const measureMarket = (card: Locator) =>
  card.evaluate(
    (root, labels) => {
      const box = (node: Element) => node.getBoundingClientRect().toJSON();
      const rects = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()]
          .map((rect) => rect.toJSON())
          .filter((rect) => rect.width > 0 && rect.height > 0);
      };
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5;
      const clips = (node: Element) => {
        let left = 0,
          right = innerWidth;
        for (
          let current: Element | null = node;
          current;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
            const bounds = current.getBoundingClientRect();
            left = Math.max(left, bounds.left + current.clientLeft);
            right = Math.min(
              right,
              bounds.left + current.clientLeft + current.clientWidth
            );
          }
        }
        return { left, right };
      };
      const find = (text: string) =>
        [...root.querySelectorAll('span')].find(
          (node) => node.textContent === text
        );
      const fields = labels.metrics.flatMap((text) => {
        const label = find(text);
        if (!label) return [];
        const cell = label.parentElement!;
        const value = cell.lastElementChild!;
        const ranges = rects(value),
          bounds = cell.getBoundingClientRect();
        const clip = clips(value);
        return [
          {
            label: text,
            text: value.textContent,
            cell: box(cell),
            value: box(value),
            labelRects: rects(label),
            valueRects: ranges,
            font: getComputedStyle(value).font,
            clip,
            exceedsAssignedCell: ranges.some(
              (rect) =>
                rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5
            ),
            horizontallyClipped: ranges.some(
              (rect) =>
                rect.left < clip.left - 0.5 || rect.right > clip.right + 0.5
            ),
          },
        ];
      });
      const fieldCollisions: { left: string; right: string }[] = [];
      for (let a = 0; a < fields.length; a += 1)
        for (let b = a + 1; b < fields.length; b += 1) {
          if (fields[a].cell.top !== fields[b].cell.top) continue;
          if (
            fields[a].valueRects.some((left) =>
              [...fields[b].valueRects, ...fields[b].labelRects].some((right) =>
                overlap(left as DOMRect, right as DOMRect)
              )
            ) ||
            fields[b].valueRects.some((right) =>
              fields[a].labelRects.some((left) =>
                overlap(left as DOMRect, right as DOMRect)
              )
            )
          )
            fieldCollisions.push({
              left: fields[a].label,
              right: fields[b].label,
            });
        }
      const priceLabel = find(labels.price)!;
      const priceRow = priceLabel.parentElement!.lastElementChild!;
      const priceValues = [...priceRow.children].map((node) => ({
        text: node.textContent,
        bounds: box(node),
        rects: rects(node),
        font: getComputedStyle(node).font,
        clip: clips(node),
      }));
      const priceCollides =
        priceValues.length === 2 &&
        priceValues[0].rects.some((a) =>
          priceValues[1].rects.some((b) => overlap(a as DOMRect, b as DOMRect))
        );
      const priceClipped = priceValues.some((value) =>
        value.rects.some(
          (rect) =>
            rect.left < value.clip.left - 0.5 ||
            rect.right > value.clip.right + 0.5
        )
      );
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: box(root),
        fields,
        fieldCollisions,
        price: {
          row: box(priceRow),
          values: priceValues,
          collides: priceCollides,
          clipped: priceClipped,
        },
        // Assigned-cell overflow alone is observational: it is not automatically
        // a visible defect when neighboring text does not overlap or get clipped.
        candidate: {
          noTextCollision: fieldCollisions.length === 0 && !priceCollides,
          noHorizontalClipping:
            !fields.some((value) => value.horizontallyClipped) && !priceClipped,
        },
      };
    },
    {
      price: en.tokens.currentPrice,
      metrics: [
        en.tokens.rank,
        en.tokens.marketCap,
        en.tokens.volume24h,
        en.tokens.circulatingSupply,
      ],
    }
  );

test('ordinary ERC20 market numbers retain readable geometry across valid numeric scales', async ({}, info) => {
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
  expect(runtime.version).toBe(packageJson.version);
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const owner = fixture.evmAddresses[0].toLowerCase();
  const owners = fixture.evmAddresses.map((value) => value.toLowerCase());
  const abi = AbiCoder.defaultAbiCoder();
  const mainnet = getNetworkConfig(57, 'sys');
  const initialSigner = new sys.HDSigner(
    UTXO_FIXTURE_SEED,
    '',
    false,
    mainnet.networks,
    57,
    mainnet.types.zPubType,
    84
  );
  const initialXpub = initialSigner.getAccountXpub();
  const initialQueries = new Set([
    'details=tokenBalances&tokens=used',
    'details=tokenBalances&tokens=nonzero',
    'details=txsummary&pageSize=30',
    'details=txslight&pageSize=30',
  ]);
  const codeTargets = new Set([
    ...owners,
    ...contracts,
    ...getPaliInfrastructureContracts(1).map((value) =>
      value.address.toLowerCase()
    ),
    PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase(),
    PALI_MULTICALL3_CANONICAL_ADDRESS.toLowerCase(),
  ]);
  const reads: any[] = [],
    marketReads: any[] = [],
    unsupported: any[] = [];
  const unknownHttpFailures: any[] = [],
    forbidden: string[] = [],
    pageErrors: string[] = [];
  const observations: Record<string, any> = {
    runtime,
    sourceSha256,
    measurements: [],
    nativeCopies: [],
  };
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let baseline!: PublicState, importedBaseline!: PublicState;
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'MarketNumbersSynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: server.url,
  });
  const marketBody = (value: Variant) => ({
    id: 'synthetic-' + value.symbol.toLowerCase(),
    symbol: value.symbol,
    name: value.symbol,
    categories: [],
    // eslint-disable-next-line camelcase -- CoinGecko wire fields.
    market_cap_rank: value.missing ? null : 7,
    // eslint-disable-next-line camelcase -- CoinGecko wire fields.
    market_data: {
      // eslint-disable-next-line camelcase -- CoinGecko wire fields.
      current_price: { usd: value.price },
      // eslint-disable-next-line camelcase -- CoinGecko wire fields.
      market_cap: { usd: value.cap },
      // eslint-disable-next-line camelcase -- CoinGecko wire fields.
      total_volume: { usd: value.volume },
      // eslint-disable-next-line camelcase -- CoinGecko wire fields.
      circulating_supply: value.missing ? null : value.supply,
      // eslint-disable-next-line camelcase -- CoinGecko wire fields.
      price_change_percentage_24h: value.change,
    },
  });
  try {
    wallet = await PaliWallet.launch('evm-market-number-readability', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url,
      (url) => {
        if (url.username || url.password || url.hash) return undefined;
        if (feeds.has(url.href)) return feeds.get(url.href);
        if (
          url.href === 'https://blockbook.syscoin.org/api/v2/tickers/currency'
        )
          return { ts: 1, rates: { usd: 1 } };
        if (
          url.origin === 'https://blockbook.syscoin.org' &&
          url.pathname === '/api/v2/xpub/' + initialXpub &&
          initialQueries.has(url.searchParams.toString())
        )
          return {
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
        if (
          url.origin === 'https://api.coingecko.com' &&
          url.pathname === '/api/v3/simple/price' &&
          ['syscoin', 'ethereum'].includes(url.searchParams.get('ids') || '') &&
          url.searchParams.get('vs_currencies') === 'usd' &&
          url.searchParams.get('include_24hr_change') === 'true' &&
          [...url.searchParams.keys()].every((key) =>
            ['ids', 'vs_currencies', 'include_24hr_change'].includes(key)
          )
        ) {
          return {
            [url.searchParams.get('ids')!]: { usd: 1, ['usd_24h_change']: 0 },
          };
        }
        if (url.href.startsWith(EXPLORER + '?')) {
          const action = url.searchParams.get('action') || '';
          const address = (url.searchParams.get('address') || '').toLowerCase();
          const exactKeys = (keys: string[]) =>
            [...url.searchParams.keys()].length === keys.length &&
            keys.every((key) => url.searchParams.getAll(key).length === 1);
          const pending = action === 'pendingtxlist';
          const paged = url.searchParams.has('page');
          if (
            ['txlist', 'tokentx', 'pendingtxlist'].includes(action) &&
            owners.includes(address) &&
            url.searchParams.get('module') === 'account' &&
            (pending || url.searchParams.get('sort') === 'desc') &&
            (!paged ||
              (url.searchParams.get('page') === '1' &&
                url.searchParams.get('offset') === '30')) &&
            exactKeys([
              'module',
              'action',
              'address',
              ...(pending ? [] : ['sort']),
              ...(paged ? ['page', 'offset'] : []),
            ])
          )
            return { status: '1', message: 'OK', result: [] };
          if (
            exactKeys(['module', 'action']) &&
            ((action === 'eth_block_number' &&
              url.searchParams.get('module') === 'block') ||
              (action === 'eth_blockNumber' &&
                url.searchParams.get('module') === 'proxy'))
          )
            return { status: '1', message: 'OK', result: '0x1' };
        }
        const holding = url.pathname.match(
          /^\/v2\/network\/mainnet\/evm\/1\/address\/(0x[0-9a-f]{40})\/(erc20|erc721|erc1155)-holdings$/i
        );
        if (
          url.origin === 'https://api.routescan.io' &&
          holding &&
          owners.includes(holding[1].toLowerCase()) &&
          url.searchParams.toString() === 'limit=100'
        )
          return { items: [] };
        const market = url.pathname.match(
          /^\/api\/v3\/coins\/ethereum\/contract\/(0x[0-9a-f]{40})$/i
        );
        const variant = market && byContract.get(market[1].toLowerCase());
        if (
          url.origin === 'https://api.coingecko.com' &&
          variant &&
          url.searchParams.toString() === MARKET_QUERY
        ) {
          const body = marketBody(variant);
          marketReads.push({
            contract: variant.contract,
            key: variant.key,
            payloadSha256: createHash('sha256')
              .update(JSON.stringify(body))
              .digest('hex'),
          });
          return body;
        }
        return undefined;
      }
    );
    await wallet.context.route(
      'https://www.coingecko.com/favicon-96x96.png',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'image/png',
              body: favicon,
            })
          : route.abort('blockedbyclient')
    );
    await wallet.context.route(RPC, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        unsupported.push({ kind: 'rpc-method', method: request.method() });
        return route.abort('blockedbyclient');
      }
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        unsupported.push({ kind: 'rpc-json' });
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const replies = calls.map((call: any) => {
        if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params)) {
          unsupported.push({ kind: 'rpc-envelope' });
          return undefined;
        }
        let result: unknown;
        const params = call.params;
        if (
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
            call.method || ''
          )
        )
          forbidden.push(call.method);
        if (params.length === 0) {
          if (call.method === 'eth_chainId') result = '0x1';
          if (call.method === 'net_version') result = '1';
          if (call.method === 'eth_blockNumber') result = '0x1';
          if (
            ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(call.method)
          )
            result = '0x3b9aca00';
        }
        if (
          ['eth_getBalance', 'eth_getTransactionCount'].includes(call.method) &&
          params.length === 2 &&
          owners.includes(String(params[0]).toLowerCase()) &&
          ['latest', 'pending'].includes(params[1])
        )
          result = '0x0';
        if (
          call.method === 'eth_getCode' &&
          params.length === 2 &&
          params[1] === 'latest' &&
          codeTargets.has(String(params[0]).toLowerCase())
        )
          result = contracts.includes(String(params[0]).toLowerCase())
            ? '0x60006000fd'
            : '0x';
        if (
          call.method === 'eth_getBlockByNumber' &&
          params.length === 2 &&
          ((['latest', '0x1'].includes(params[0]) && params[1] === false) ||
            (['0x0', '0x1'].includes(params[0]) && params[1] === true))
        )
          result = {
            number: params[0] === '0x0' ? '0x0' : '0x1',
            hash: '0x' + (params[0] === '0x0' ? '11' : '12').repeat(32),
            parentHash: '0x' + (params[0] === '0x0' ? '00' : '11').repeat(32),
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
        if (
          call.method === 'eth_call' &&
          params.length === 2 &&
          params[1] === 'latest'
        ) {
          const target = String(params[0]?.to || '').toLowerCase();
          const token = byContract.get(target);
          const data = String(params[0]?.data || '');
          const selector = data.slice(0, 10);
          if (token) {
            const noArgument = [
              ['name()', 'string', token.symbol],
              ['symbol()', 'string', token.symbol],
              ['decimals()', 'uint8', 6],
              [
                'totalSupply()',
                'uint256',
                (BigInt(token.supply) * BigInt(1000000)).toString(),
              ],
            ] as const;
            const match =
              data.length === 10 &&
              noArgument.find(
                ([signature]) => id(signature).slice(0, 10) === selector
              );
            if (match) result = abi.encode([match[1]], [match[2]]);
            if (
              data.length === 74 &&
              selector === id('balanceOf(address)').slice(0, 10)
            ) {
              const requested = String(
                abi.decode(['address'], '0x' + data.slice(10))[0]
              ).toLowerCase();
              if ([...owners, target].includes(requested))
                result = abi.encode(
                  ['uint256'],
                  [requested === target ? '0' : '12000000']
                );
            }
            if (
              data.length === 74 &&
              selector === id('supportsInterface(bytes4)').slice(0, 10)
            ) {
              const requested = String(
                abi.decode(['bytes4'], '0x' + data.slice(10))[0]
              ).toLowerCase();
              if (
                [
                  '0x01ffc9a7',
                  '0x80ac58cd',
                  '0xd9b67a26',
                  '0x5b5e139f',
                  '0xffffffff',
                ].includes(requested)
              )
                result = abi.encode(['bool'], [false]);
            }
            if (result !== undefined)
              reads.push({ kind: 'token', contract: target, selector });
          }
        }
        if (result === undefined) {
          unsupported.push({
            kind: 'rpc-read',
            method: call.method,
            target: String(params[0]?.to || params[0] || ''),
          });
          return undefined;
        }
        reads.push({ kind: 'rpc', method: call.method });
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (replies.some((reply: any) => reply === undefined))
        return route.abort('blockedbyclient');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('requestfailed', (request) => {
      if (/^https?:/.test(request.url()))
        unknownHttpFailures.push({
          method: request.method(),
          url: request.url(),
        });
    });
    wallet.context.on('request', (request) => {
      if (/\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname))
        forbidden.push('sendtx');
      try {
        const body = request.postDataJSON();
        for (const call of Array.isArray(body) ? body : [body])
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
            forbidden.push(call.method);
      } catch {
        /* Static/GET inputs have no JSON body. */
      }
    });
    const card = () =>
      page
        .getByRole('heading', {
          // The real h4 includes both the favicon alt and visible link label.
          name: en.tokens.marketInformation + ' CoinGecko CoinGecko',
          exact: true,
        })
        .locator('..');
    const copy = () =>
      page.getByRole('button', {
        name: en.send.copyContractAddress,
        exact: true,
      });
    const close = () =>
      page
        .locator('#details-view-content')
        .getByRole('button', { name: en.buttons.close, exact: true });
    const open = (value: Variant) =>
      page.getByRole('button', {
        name: en.tokens.viewTokenDetails.replace('{{symbol}}', value.symbol),
        exact: true,
      });
    const unchanged = async () =>
      expect(await publicState(page)).toEqual(importedBaseline);
    const readNativeCopies = () =>
      page.evaluate(
        () => [...((window as any).__marketNumberCopies || [])] as string[]
      );
    let lastCopy = 0;
    await wallet.step(
      'create the disposable wallet and select ordinary Ethereum Mainnet behind the deny proxy',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await wallet!.ensureOnHome();
        baseline = await publicState(page);
        expect(baseline.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(baseline.network).toMatchObject({
          chainId: 1,
          url: RPC.slice(0, -1),
        });
        expect(baseline.slip44).toBe(60);
        expect(
          baseline.liveAccounts.some(
            (value) => value.address?.toLowerCase() === owner
          )
        ).toBe(true);
        expect(targetTokens(baseline, 'liveAssets')).toEqual([]);
        expect(targetTokens(baseline, 'savedAssets')).toEqual([]);
        expect(baseline.grants).toEqual([]);
        expect(baseline.savedGrants).toEqual([]);
        observations.baseline = baseline;
        observations.workerBefore = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            observations.workerBefore = value;
          }
        );
        // Observe only completed real native writes; delegate the identical text
        // to the original Clipboard API and preserve its genuine result.
        await page.evaluate(() => {
          const original = navigator.clipboard.writeText.bind(
            navigator.clipboard
          );
          const writes: string[] = [];
          (window as any).__marketNumberCopies = writes;
          navigator.clipboard.writeText = async (text: string) => {
            await original(text);
            writes.push(text);
          };
        });
      }
    );
    await wallet.step(
      'import four exact tokens through real ABI validation and durable UI saves',
      async () => {
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .and(page.locator('button[aria-pressed]'))
          .click();
        for (const value of variants) {
          await page.locator('#custom-token-contract').fill(value.contract);
          const add = page.getByRole('button', {
            name: en.tokens.importNamedToken.replace(
              '{{symbol}}',
              value.symbol
            ),
            exact: true,
          });
          await expect(add).toBeEnabled();
          expect(
            reads.some(
              (read) =>
                read.contract === value.contract &&
                read.selector === id('balanceOf(address)').slice(0, 10)
            )
          ).toBe(true);
          expect(
            marketReads.some((read) => read.contract === value.contract)
          ).toBe(true);
          await add.click();
          const notice = page.getByText(
            en.tokens.hasBeenAddedToYourWallet.replace(
              '{{token}}',
              value.symbol
            ),
            { exact: true }
          );
          await expect(notice).toBeVisible();
          await notice.click();
          await expect(notice).toBeHidden();
          await expect
            .poll(async () =>
              targetTokens(await publicState(page), 'savedAssets').map(
                (asset: any) => asset.contract
              )
            )
            .toContain(value.contract);
          await expect(add).toBeDisabled();
        }
        const back = page.getByRole('button', {
          name: en.buttons.back,
          exact: true,
        });
        await tabTo(page, back);
        await page.keyboard.press('Enter');
        await wallet!.ensureOnHome();
        await page.locator('#assets-btn').click();
        importedBaseline = await publicState(page);
        expect(withoutTargets(importedBaseline)).toEqual(baseline);
        const live = targetTokens(importedBaseline, 'liveAssets');
        expect(live.map((value: any) => value.contract)).toEqual(
          [...contracts].sort()
        );
        expect(targetTokens(importedBaseline, 'savedAssets')).toEqual(live);
        for (const value of variants)
          expect(
            live.find((asset: any) => asset.contract === value.contract)
          ).toMatchObject({
            accountKind: baseline.active.type,
            accountId: baseline.active.id,
            chainId: 1,
            symbol: value.symbol,
            decimals: 6,
            balance: '12',
            isNft: false,
            standard: 'ERC-20',
          });
        observations.importedBaseline = importedBaseline;
      }
    );
    for (const value of variants)
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        await wallet.step(
          value.key +
            '-' +
            viewport.width +
            ' ordinary Assets Details retains exact contract and native Copy',
          async () => {
            await tabTo(page, open(value));
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home\/details/);
            await expect(card()).toHaveCount(1);
            await expect(
              card().getByText(value.priceText, { exact: true })
            ).toBeAttached();
            await expect
              .poll(() =>
                card().evaluate((node) => {
                  let opacity = 1;
                  for (
                    let current: Element | null = node;
                    current;
                    current = current.parentElement
                  )
                    opacity *= Number(getComputedStyle(current).opacity);
                  return opacity;
                })
              )
              .toBe(1);
            for (const label of [
              en.tokens.rank,
              en.tokens.marketCap,
              en.tokens.volume24h,
              en.tokens.circulatingSupply,
            ])
              await expect(
                card().getByText(label, { exact: true })
              ).toHaveCount(value.missing ? 0 : 1);
            if (!value.missing) {
              for (const [label, text] of [
                [en.tokens.marketCap, '$' + value.cap.toLocaleString('en-US')],
                [
                  en.tokens.volume24h,
                  '$' + value.volume.toLocaleString('en-US'),
                ],
                [
                  en.tokens.circulatingSupply,
                  value.supply.toLocaleString('en-US'),
                ],
              ])
                await expect(
                  card().getByText(label, { exact: true }).locator('..')
                ).toHaveText(label + text);
            }
            await expect(
              page.locator(
                'a[href="https://etherscan.io/token/' + value.contract + '"]'
              )
            ).toHaveCount(1);
            await expect(copy()).toHaveCount(1);
            if (lastCopy)
              await expect
                .poll(() => page.evaluate(() => Date.now()))
                .toBeGreaterThanOrEqual(lastCopy + 2000);
            const copiesBefore = await readNativeCopies();
            expect(copiesBefore).toEqual(
              observations.nativeCopies.map((entry: any) => entry.text)
            );
            await tabTo(page, copy());
            await page.keyboard.press('Enter');
            const notice = page.getByText(en.home.contractCopied, {
              exact: true,
            });
            await expect(notice).toBeVisible();
            await expect
              .poll(readNativeCopies)
              .toEqual([...copiesBefore, value.contract]);
            const writes = await readNativeCopies();
            expect(writes.at(-1)).toBe(value.contract);
            observations.nativeCopies.push({
              key: value.key,
              viewport,
              text: value.contract,
              completed: true,
            });
            lastCopy = await page.evaluate(() => Date.now());
            await notice.click();
            await expect(notice).toBeHidden();
            await unchanged();
          }
        );
        await wallet.step(
          value.key +
            '-' +
            viewport.width +
            ' reveal actual price and 24-hour change using ordinary wheel',
          async (capture) => {
            const price = card()
              .getByText(en.tokens.currentPrice, { exact: true })
              .locator('..');
            const gestures = await reveal(page, price);
            await page.mouse.move(2, 2);
            const geometry = await measureMarket(card());
            observations.measurements.push({
              key: value.key,
              phase: 'price',
              viewport,
              gestures,
              geometry,
            });
            await unchanged();
            await capture(page);
          }
        );
        await wallet.step(
          value.key +
            '-' +
            viewport.width +
            ' reveal actual grouped market rows with the same settled metadata',
          async (capture) => {
            const target = value.missing
              ? card()
                  .getByText(en.tokens.currentPrice, { exact: true })
                  .locator('..')
              : card()
                  .getByText(en.tokens.volume24h, { exact: true })
                  .locator('..')
                  .locator('..');
            const gestures = await reveal(page, target);
            await page.mouse.move(2, 2);
            const geometry = await measureMarket(card());
            observations.measurements.push({
              key: value.key,
              phase: 'metrics',
              viewport,
              gestures,
              geometry,
            });
            await unchanged();
            await capture(page);
          }
        );
        await wallet.step(
          value.key +
            '-' +
            viewport.width +
            ' real Details Back or Close retains all exact public records',
          async () => {
            const action =
              viewport.width === 400
                ? page.getByRole('button', { name: 'Back', exact: true })
                : close();
            await tabTo(page, action);
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            await expect(open(value)).toHaveCount(1);
            await unchanged();
          }
        );
      }
    await wallet.step(
      'complete every exact inventory worker source and no-write fence before geometry predicates',
      async () => {
        await unchanged();
        expect(withoutTargets(importedBaseline)).toEqual(baseline);
        observations.workerAfter = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            observations.workerAfter = value;
          }
        );
        expect(observations.nativeCopies).toHaveLength(8);
        expect(await readNativeCopies()).toEqual(
          variants.flatMap((value) => [value.contract, value.contract])
        );
        expect(
          variants.every((value) =>
            marketReads.some((read) => read.contract === value.contract)
          )
        ).toBe(true);
        expect(unsupported).toEqual([]);
        expect(forbidden).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(unknownHttpFailures).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(sourceSha256);
        observations.geometryPredicates = observations.measurements.map(
          (value: any) => ({
            key: value.key,
            phase: value.phase,
            viewport: value.viewport,
            ...value.geometry.candidate,
          })
        );
      }
    );
    await wallet.step(
      'market text remains unclipped without collisions after healthy controls',
      async () => {
        // These final checks are deliberately separate from assigned-cell
        // overflow and cannot replace actual rendered-image review by root.
        expect(
          observations.geometryPredicates.every(
            (value: any) => value.noTextCollision
          )
        ).toBe(true);
        expect(
          observations.geometryPredicates.every(
            (value: any) => value.noHorizontalClipping
          )
        ).toBe(true);
        for (const measured of observations.measurements) {
          if (measured.key === 'missing-optionals') continue;
          const volume = measured.geometry.fields.find(
            (field: any) => field.label === en.tokens.volume24h
          );
          const supply = measured.geometry.fields.find(
            (field: any) => field.label === en.tokens.circulatingSupply
          );
          expect(supply.text).toBe(
            variants
              .find((value) => value.key === measured.key)!
              .supply.toLocaleString('en-US')
          );
          // This ordinary large value fits a full row without splitting digits.
          expect(supply.valueRects).toHaveLength(1);
          if (
            measured.key === 'large-supply' &&
            measured.viewport.width === 320
          )
            expect(supply.cell.top).toBeGreaterThanOrEqual(volume.cell.bottom);
          else expect(supply.cell.top).toBe(volume.cell.top);
        }
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('evm-market-number-readability-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          observations,
          variants,
          reads,
          marketReads,
          unsupported,
          forbidden,
          pageErrors,
          unknownHttpFailures,
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedConnections: server.blocked.length,
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerRepliesReplaced: false,
          runtimeTransportReplaced: false,
          DOMScrollOrFocusInjected: false,
          nativeClipboardObserverDelegatesOriginal: true,
          signingDeploymentOrBroadcastRequested: false,
          candidateNotConfirmedUntilActualPixelReview: true,
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
