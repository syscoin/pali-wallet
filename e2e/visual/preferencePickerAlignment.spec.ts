import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
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

// TEMPORARY OUT diagnostic only. One normally imported complete token, then
// actual Languages UI saves EN -> DE -> FR. No product change is proposed here.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RPC = 'https://ethereum-rpc.publicnode.com/';
const EXPLORER =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const MARKET_QUERY =
  'localization=false&tickers=false&market_data=true&community_data=false&developer_data=false';
const localeCases = [
  { code: 'en', text: en, option: 'English English' },
  { code: 'de', text: de, option: 'German Deutsch' },
  { code: 'fr', text: fr, option: 'French Français' },
] as const;
type Locale = (typeof localeCases)[number];
type Translations = Locale['text'];
const variants = [
  {
    key: 'healthy-complete',
    contract: '0x000000000000000000000000000000000000ea41',
    symbol: 'LOC20',
    price: 55.125,
    priceText: '$55.125000',
    cap: 1000,
    volume: 200,
    supply: 20,
    change: 1.25,
    missing: false,
  },
] as const;
const categoryLabels = ['Synthetic finance', 'Synthetic utility'] as const;
const description = 'Synthetic public market metadata for locale readability.';
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
      liveCurrency: state.price.fiat.asset,
      savedCurrency: disk.state?.price?.fiat?.asset,
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

const measureMarket = (card: Locator, translations: Translations) =>
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
      price: translations.tokens.currentPrice,
      metrics: [
        translations.tokens.rank,
        translations.tokens.marketCap,
        translations.tokens.volume24h,
        translations.tokens.circulatingSupply,
      ],
    }
  );

// Read-only ranges from the actual translated renderer. Natural multi-line
// wrapping is allowed; assigned-cell overflow alone is not a defect.
const measureLocalizedCard = (card: Locator, translations: Translations) =>
  card.evaluate(
    (root, text) => {
      const box = (node: Element) => node.getBoundingClientRect().toJSON();
      const rects = (node: Node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()]
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => rect.toJSON());
      };
      const clip = (node: Element) => {
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
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5;
      const find = (label: string) =>
        [...root.querySelectorAll('span')].find(
          (node) => node.textContent === label
        )!;
      const h4 = root.querySelector('h4')!;
      const headingLink = h4.querySelector('a')!;
      const directHeadingText = [...h4.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      );
      const groups: Array<{
        bounds: ReturnType<typeof box>;
        clip: ReturnType<typeof clip>;
        font: string;
        glyphRects: ReturnType<typeof rects>;
        name: string;
        text: string | null;
      }> = [];
      const add = (name: string, node: Element, glyphRects = rects(node)) => {
        groups.push({
          name,
          text: node.textContent,
          bounds: box(node),
          glyphRects,
          clip: clip(node),
          font: getComputedStyle(node).font,
        });
      };
      add('heading-text', h4, directHeadingText.flatMap(rects));
      add('heading-coingecko-link', headingLink);
      for (const [key, label] of Object.entries(text.labels)) {
        const labelNode = find(label);
        add('label:' + key, labelNode);
        if (
          ['rank', 'marketCap', 'volume24h', 'circulatingSupply'].includes(key)
        )
          add('value:' + key, labelNode.parentElement!.lastElementChild!);
      }
      const verificationLabel = find(text.labels.verification);
      const badge = verificationLabel.parentElement!.lastElementChild!;
      add('verification-badge', badge);
      const clippedGroups = groups
        .filter((group) =>
          group.glyphRects.some(
            (line) =>
              line.left < group.clip.left - 0.5 ||
              line.right > group.clip.right + 0.5
          )
        )
        .map((group) => group.name);
      const collisions: Array<{ left: string; right: string }> = [];
      for (let left = 0; left < groups.length; left++)
        for (let right = left + 1; right < groups.length; right++)
          if (
            groups[left].glyphRects.some((a) =>
              groups[right].glyphRects.some((b) =>
                overlap(a as DOMRect, b as DOMRect)
              )
            )
          )
            collisions.push({
              left: groups[left].name,
              right: groups[right].name,
            });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: box(root),
        headingExpected: text.heading,
        headingText: directHeadingText.map((n) => n.textContent).join(''),
        verificationExpected: text.verified,
        verificationText: badge.textContent,
        groups,
        clippedGroups,
        collisions,
        candidate: {
          noHorizontalClipping: clippedGroups.length === 0,
          noTextCollision: collisions.length === 0,
        },
      };
    },
    {
      heading: translations.tokens.marketInformation,
      verified: translations.tokens.verifiedByCoinGecko,
      labels: {
        currentPrice: translations.tokens.currentPrice,
        rank: translations.tokens.rank,
        marketCap: translations.tokens.marketCap,
        volume24h: translations.tokens.volume24h,
        circulatingSupply: translations.tokens.circulatingSupply,
        categories: translations.tokens.categories,
        viewOnCoinGecko: translations.tokens.viewOnCoinGecko,
        verification: translations.tokens.verification,
        about: translations.tokens.about,
      },
    }
  );

// Observe actual closed-language-picker layout only. The SVG box and painted
// V path have distinct centers; do not require the intrinsically asymmetric
// painted path to have zero center offset.
const measureLanguagePicker = (picker: Locator) =>
  picker.evaluate((node) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      };
    };
    const button = box(node);
    const text = Array.from(node.querySelectorAll('span')).map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      return {
        text: span.textContent,
        box: box(span),
        ranges: Array.from(range.getClientRects()).map((r) => ({
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        })),
        font: getComputedStyle(span).font,
      };
    });
    const arrow = node.querySelector('svg');
    const arrowInk = node.querySelector('svg path');
    const style = getComputedStyle(node);
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let parent: Element | null = node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const parentStyle = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(parentStyle.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + parent.clientLeft + parent.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(parentStyle.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + parent.clientTop + parent.clientHeight
        );
      }
    }
    const tolerance = 0.5;
    const insideVisibleClip =
      button.left >= clip.left - tolerance &&
      button.top >= clip.top - tolerance &&
      button.right <= clip.right + tolerance &&
      button.bottom <= clip.bottom + tolerance;
    const points = [
      [button.left + button.width / 2, button.top + button.height / 2],
      [button.left + 2, button.top + button.height / 2],
      [button.right - 2, button.top + button.height / 2],
      [button.left + button.width / 2, button.top + 2],
      [button.left + button.width / 2, button.bottom - 2],
    ].map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        reachesPicker: !!hit && (hit === node || node.contains(hit)),
      };
    });
    return {
      button,
      text,
      labelGroup: node.firstElementChild ? box(node.firstElementChild) : null,
      arrow: arrow ? box(arrow) : null,
      arrowInk: arrowInk ? box(arrowInk) : null,
      padding: [style.paddingTop, style.paddingBottom],
      alignItems: style.alignItems,
      fontStatus: document.fonts.status,
      hitTarget: {
        visibleClip: clip,
        insideVisibleClip,
        points,
        atLeast44: button.width >= 44 && button.height >= 44,
        allFivePointsReachPicker: points.every((point) => point.reachesPicker),
      },
    };
  });

test('ordinary preference pickers retain centered SVG boxes while localized market controls remain correct', async ({}, info) => {
  expect(process.version).toBe('v26.12.1');
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
    localizedMeasurements: [],
    languageTransitions: [],
    nativeCopies: [],
    currencyPickerObservations: [],
    languagePickerObservations: [],
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
    password: 'MarketLocaleSynthetic!2026',
    chainId: 1,
    networkLabel: 'Ethereum Mainnet',
    rpcUrl: server.url,
  });
  const marketBody = (value: Variant) => ({
    id: 'synthetic-' + value.symbol.toLowerCase(),
    symbol: value.symbol,
    name: value.symbol,
    categories: [...categoryLabels],
    description: { en: description },
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
    wallet = await PaliWallet.launch('preference-picker-alignment', {
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
    let currentLocale: Locale = localeCases[0];
    const card = () =>
      page
        .getByRole('heading', {
          // The decorative favicon is hidden; the heading includes the visible link label.
          name: currentLocale.text.tokens.marketInformation + ' CoinGecko',
          exact: true,
        })
        .locator('..');
    const copy = () =>
      page.getByRole('button', {
        name: currentLocale.text.send.copyContractAddress,
        exact: true,
      });
    const close = () =>
      page.locator('#details-view-content').getByRole('button', {
        name: currentLocale.text.buttons.close,
        exact: true,
      });
    const open = (value: Variant) =>
      page.getByRole('button', {
        name: currentLocale.text.tokens.viewTokenDetails.replace(
          '{{symbol}}',
          value.symbol
        ),
        exact: true,
      });
    const unchanged = async () =>
      expect(await publicState(page)).toEqual({
        ...importedBaseline,
        language: currentLocale.code,
      });
    const readNativeCopies = () =>
      page.evaluate(
        () => [...((window as any).__marketLocaleCopies || [])] as string[]
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
        expect(baseline.liveCurrency).toBe('usd');
        expect(baseline.savedCurrency).toBe('usd');
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
          (window as any).__marketLocaleCopies = writes;
          navigator.clipboard.writeText = async (text: string) => {
            await original(text);
            writes.push(text);
          };
        });
      }
    );
    await wallet.step(
      'import one exact complete token through real ABI validation and durable UI save',
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
    const tokenCase = variants[0];
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.step(
        'ordinary Currency form opens the saved USD preference at ' +
          viewport.width,
        async () => {
          await unchanged();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: en.generalMenu.currency,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/currency$/);
          await expect(
            page.getByRole('button', {
              name: en.settings.setYourPreferred,
              exact: true,
            })
          ).toContainText('USD');
          await expect(
            page.getByRole('button', {
              name: en.buttons.save,
              exact: true,
            })
          ).toBeDisabled();
          await unchanged();
        }
      );
      for (const draft of ['USD', 'BCH']) {
        await wallet.step(
          'currency picker actual ' + draft + ' content at ' + viewport.width,
          async (capture) => {
            const picker = page.getByRole('button', {
              name: en.settings.setYourPreferred,
              exact: true,
            });
            if (draft === 'BCH') {
              await picker.click();
              await page
                .getByRole('textbox', {
                  name: en.settings.searchCurrencies,
                  exact: true,
                })
                .fill('bch');
              await page
                .getByRole('button', {
                  name: '💰 BCH',
                  exact: true,
                })
                .click();
              await expect(
                page.getByRole('button', {
                  name: en.buttons.save,
                  exact: true,
                })
              ).toBeEnabled();
            }
            await expect(picker).toContainText(draft);
            await page.mouse.move(2, 2);
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                  )
                )
            );
            observations.currencyPickerObservations.push({
              viewport,
              draft,
              geometry: await picker.evaluate((node) => {
                const box = (element: Element) => {
                  const r = element.getBoundingClientRect();
                  return {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    top: r.top,
                    bottom: r.bottom,
                    left: r.left,
                    right: r.right,
                  };
                };
                const text = Array.from(node.querySelectorAll('span')).map(
                  (span) => {
                    const range = document.createRange();
                    range.selectNodeContents(span);
                    return {
                      text: span.textContent,
                      box: box(span),
                      ranges: Array.from(range.getClientRects()).map((r) => ({
                        top: r.top,
                        bottom: r.bottom,
                        left: r.left,
                        right: r.right,
                      })),
                    };
                  }
                );
                const arrow = node.querySelector('svg');
                const arrowInk = node.querySelector('svg path');
                const style = getComputedStyle(node);
                return {
                  button: box(node),
                  text,
                  arrow: arrow ? box(arrow) : null,
                  arrowInk: arrowInk ? box(arrowInk) : null,
                  padding: [style.paddingTop, style.paddingBottom],
                  alignItems: style.alignItems,
                  fontStatus: document.fonts.status,
                };
              }),
            });
            await unchanged();
            await capture(page);
          }
        );
      }
      await wallet.step(
        'leaving an unsaved BCH currency draft preserves the saved USD records at ' +
          viewport.width,
        async () => {
          const back = page.getByRole('button', {
            name: en.buttons.back,
            exact: true,
          });
          await tabTo(page, back);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged();
          await expect(open(tokenCase)).toHaveCount(1);
        }
      );
    }
    for (const locale of localeCases) {
      if (locale.code !== currentLocale.code) {
        await page.setViewportSize({ width: 400, height: 620 });
        await wallet.step(
          'ordinary Languages form saves ' +
            currentLocale.code +
            ' to ' +
            locale.code +
            ' without changing wallet records',
          async () => {
            await unchanged();
            const previousLocale = currentLocale;
            await page
              .getByRole('button', {
                name: previousLocale.text.generalMenu.generalOptions,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', {
                name: previousLocale.text.generalMenu.languages,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/languages$/);
            await page
              .getByRole('button', {
                name: previousLocale.text.settings.setYourPreferredLanguage,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', { name: locale.option, exact: true })
              .click();
            // Draft selection cannot itself change the stored locale or wallet.
            await unchanged();
            await page
              .getByRole('button', {
                name: previousLocale.text.buttons.save,
                exact: true,
              })
              .click();
            await expect(
              page.getByText(locale.text.settings.languageWasSet, {
                exact: true,
              })
            ).toBeVisible();
            await expect
              .poll(async () => (await publicState(page)).language)
              .toBe(locale.code);
            currentLocale = locale;
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            await unchanged();
            // Reopen the real form to inspect its durable saved selection;
            // never inject storage, i18n, routing state or controller results.
            await page
              .getByRole('button', {
                name: locale.text.generalMenu.generalOptions,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', {
                name: locale.text.generalMenu.languages,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/languages$/);
            await expect(
              page.getByRole('button', {
                name: locale.text.settings.setYourPreferredLanguage,
                exact: true,
              })
            ).toContainText(locale.code === 'de' ? 'Deutsch' : 'Français');
            await expect(
              page.getByRole('button', {
                name: locale.text.buttons.save,
                exact: true,
              })
            ).toBeDisabled();
            for (const viewport of [
              { width: 400, height: 620 },
              { width: 320, height: 360 },
            ]) {
              await page.setViewportSize(viewport);
              await wallet!.step(
                locale.code +
                  '-' +
                  viewport.width +
                  ' settled saved Language picker with native pointer off',
                async (capture) => {
                  const picker = page.getByRole('button', {
                    name: locale.text.settings.setYourPreferredLanguage,
                    exact: true,
                  });
                  await expect(picker).toContainText(
                    locale.code === 'de' ? 'Deutsch' : 'Français'
                  );
                  await expect(
                    page.getByRole('button', {
                      name: locale.text.buttons.save,
                      exact: true,
                    })
                  ).toBeDisabled();
                  await expect(page.getByRole('menu')).toHaveCount(0);
                  const gestures = await reveal(page, picker);
                  // The fixed footer is not a clipping ancestor. A target can
                  // fit inside the viewport yet remain partly behind it.
                  // Reveal through ordinary scrolling until actual hit tests
                  // agree; retain every full-target assertion below.
                  for (let attempt = 0; attempt < 6; attempt += 1) {
                    const current = await measureLanguagePicker(picker);
                    if (current.hitTarget.allFivePointsReachPicker) break;
                    await page.mouse.move(
                      viewport.width / 2,
                      viewport.height / 2
                    );
                    await page.mouse.wheel(0, 32);
                    gestures.push(32);
                    await frame(page);
                  }
                  await page.mouse.move(2, 2);
                  await page.evaluate(async () => {
                    await document.fonts.ready;
                  });
                  await frame(page);
                  const geometry = await measureLanguagePicker(picker);
                  observations.languagePickerObservations.push({
                    locale: locale.code,
                    viewport,
                    gestures,
                    geometry,
                    savedPreferenceVerified: true,
                    noAdditionalPreferenceSave: true,
                  });
                  expect(geometry.fontStatus).toBe('loaded');
                  expect(geometry.button.height).toBe(44);
                  expect(geometry.hitTarget.atLeast44).toBe(true);
                  expect(geometry.hitTarget.insideVisibleClip).toBe(true);
                  expect(geometry.hitTarget.allFivePointsReachPicker).toBe(
                    true
                  );
                  await unchanged();
                  await capture(page);
                }
              );
            }
            await page.setViewportSize({ width: 400, height: 620 });
            const back = page.getByRole('button', {
              name: locale.text.buttons.back,
              exact: true,
            });
            await tabTo(page, back);
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            await unchanged();
            observations.languageTransitions.push({
              from: previousLocale.code,
              to: locale.code,
              savedLanguage: (await publicState(page)).language,
              reopenedFormReflectsSavedSelection: true,
              publicRecordsUnchangedExceptChosenLocale: true,
            });
          }
        );
      }
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        await wallet.step(
          locale.code +
            '-' +
            viewport.width +
            ' ordinary Assets Details retains translated labels exact metadata and native Copy',
          async () => {
            await tabTo(page, open(tokenCase));
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home\/details/);
            await expect(card()).toHaveCount(1);
            await expect(
              card().getByRole('link', { name: 'CoinGecko', exact: true })
            ).toHaveAttribute('href', 'https://www.coingecko.com');
            await expect(
              card().getByText(tokenCase.priceText, { exact: true })
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
              locale.text.tokens.currentPrice,
              locale.text.tokens.rank,
              locale.text.tokens.marketCap,
              locale.text.tokens.volume24h,
              locale.text.tokens.circulatingSupply,
              locale.text.tokens.categories,
              locale.text.tokens.viewOnCoinGecko,
              locale.text.tokens.verification,
              locale.text.tokens.about,
            ])
              await expect(
                card().getByText(label, { exact: true })
              ).toHaveCount(1);
            for (const [label, text] of [
              [
                locale.text.tokens.marketCap,
                '$' + tokenCase.cap.toLocaleString('en-US'),
              ],
              [
                locale.text.tokens.volume24h,
                '$' + tokenCase.volume.toLocaleString('en-US'),
              ],
              [
                locale.text.tokens.circulatingSupply,
                tokenCase.supply.toLocaleString('en-US'),
              ],
            ])
              await expect(
                card().getByText(label, { exact: true }).locator('..')
              ).toHaveText(label + text);
            await expect(
              card().getByText('✓ ' + locale.text.tokens.verifiedByCoinGecko, {
                exact: true,
              })
            ).toHaveCount(1);
            await expect(
              card().getByText(description, { exact: true })
            ).toHaveCount(1);
            for (const category of categoryLabels) {
              const link = card().getByRole('link', {
                name: category,
                exact: true,
              });
              await expect(link).toHaveAttribute(
                'href',
                'https://www.coingecko.com/en/categories/' +
                  category.toLowerCase().replace(/\s+/g, '-')
              );
            }
            await expect(
              card().locator(
                'a[href="https://www.coingecko.com/en/coins/synthetic-loc20"]'
              )
            ).toHaveCount(2);
            await expect(
              card().getByRole('link', {
                name: locale.text.tokens.historicalData,
                exact: true,
              })
            ).toHaveAttribute(
              'href',
              'https://www.coingecko.com/en/coins/synthetic-loc20/historical_data'
            );
            await expect(
              page.locator(
                'a[href="https://etherscan.io/token/' +
                  tokenCase.contract +
                  '"]'
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
            const notice = page.getByText(locale.text.home.contractCopied, {
              exact: true,
            });
            await expect(notice).toBeVisible();
            await expect
              .poll(readNativeCopies)
              .toEqual([...copiesBefore, tokenCase.contract]);
            observations.nativeCopies.push({
              locale: locale.code,
              viewport,
              text: tokenCase.contract,
              completed: true,
            });
            lastCopy = await page.evaluate(() => Date.now());
            await notice.click();
            await expect(notice).toBeHidden();
            await unchanged();
          }
        );
        for (const phase of ['heading', 'metrics', 'verification'] as const) {
          await wallet.step(
            locale.code +
              '-' +
              viewport.width +
              ' settled actual market ' +
              phase +
              ' after ordinary wheel',
            async (capture) => {
              const target =
                phase === 'heading'
                  ? card().getByRole('heading', {
                      name: locale.text.tokens.marketInformation + ' CoinGecko',
                      exact: true,
                    })
                  : phase === 'metrics'
                  ? card()
                      .getByText(locale.text.tokens.volume24h, { exact: true })
                      .locator('..')
                      .locator('..')
                  : card()
                      .getByText(locale.text.tokens.verification, {
                        exact: true,
                      })
                      .locator('..');
              const gestures = await reveal(page, target);
              await page.mouse.move(2, 2);
              const geometry = await measureMarket(card(), locale.text);
              const localized = await measureLocalizedCard(card(), locale.text);
              observations.measurements.push({
                locale: locale.code,
                phase,
                viewport,
                gestures,
                geometry,
              });
              observations.localizedMeasurements.push({
                locale: locale.code,
                phase,
                viewport,
                gestures,
                geometry: localized,
              });
              await unchanged();
              await capture(page);
            }
          );
        }
        await wallet.step(
          locale.code +
            '-' +
            viewport.width +
            ' actual Details Back or Close retains every public record and saved locale',
          async () => {
            const action =
              viewport.width === 400
                ? page.getByRole('button', {
                    name: locale.text.buttons.back,
                    exact: true,
                  })
                : close();
            await tabTo(page, action);
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            await expect(open(tokenCase)).toHaveCount(1);
            await unchanged();
          }
        );
      }
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
        expect(observations.nativeCopies).toHaveLength(6);
        expect(observations.currencyPickerObservations).toHaveLength(4);
        expect(await readNativeCopies()).toEqual(
          localeCases.flatMap(() => [tokenCase.contract, tokenCase.contract])
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
            locale: value.locale,
            phase: value.phase,
            viewport: value.viewport,
            ...value.geometry.candidate,
          })
        );
      }
    );
    await wallet.step(
      'localized geometry candidates are checked only after every healthy UI scope and no-write guard',
      async () => {
        expect(
          observations.languageTransitions.map((entry: any) => [
            entry.from,
            entry.to,
          ])
        ).toEqual([
          ['en', 'de'],
          ['de', 'fr'],
        ]);
        expect(observations.measurements).toHaveLength(18);
        expect(observations.localizedMeasurements).toHaveLength(18);
        expect(
          observations.geometryPredicates.every(
            (entry: any) => entry.noTextCollision
          )
        ).toBe(true);
        expect(
          observations.geometryPredicates.every(
            (entry: any) => entry.noHorizontalClipping
          )
        ).toBe(true);
        for (const measured of observations.localizedMeasurements) {
          const locale = localeCases.find(
            (entry) => entry.code === measured.locale
          )!;
          const geometry = measured.geometry;
          expect(geometry.groups).toHaveLength(16);
          expect(geometry.headingText).toBe(
            locale.text.tokens.marketInformation
          );
          expect(geometry.verificationText).toBe(
            '✓ ' + locale.text.tokens.verifiedByCoinGecko
          );
          expect(geometry.candidate.noTextCollision).toBe(true);
          expect(geometry.candidate.noHorizontalClipping).toBe(true);
        }
      }
    );
    await wallet.step(
      'preference SVG boxes are vertically centered only after all healthy controls and localized geometry',
      async () => {
        expect(observations.currencyPickerObservations).toHaveLength(4);
        expect(observations.languagePickerObservations).toHaveLength(4);
        const selections = [
          ...observations.currencyPickerObservations.map((entry: any) => ({
            kind: 'currency',
            choice: entry.draft,
            viewport: entry.viewport,
            geometry: entry.geometry,
          })),
          ...observations.languagePickerObservations.map((entry: any) => ({
            kind: 'language',
            choice: entry.locale,
            viewport: entry.viewport,
            geometry: entry.geometry,
          })),
        ];
        observations.preferencePickerAlignment = selections.map(
          (entry: any) => {
            const button = entry.geometry.button;
            const arrow = entry.geometry.arrow;
            const buttonCenter = button.top + button.height / 2;
            const svgCenter = arrow ? arrow.top + arrow.height / 2 : null;
            const deltaY = svgCenter === null ? null : svgCenter - buttonCenter;
            return {
              kind: entry.kind,
              choice: entry.choice,
              viewport: entry.viewport,
              buttonCenter,
              svgCenter,
              deltaY,
              svgBoxCenteredWithinHalfPixel:
                deltaY !== null && Math.abs(deltaY) <= 0.5,
            };
          }
        );
        // The path's intrinsic +0.596px painted-center offset is intentionally
        // observational. This contract checks its surrounding SVG box, not ink.
        expect(
          observations.preferencePickerAlignment.every(
            (entry: any) => entry.svgBoxCenteredWithinHalfPixel
          )
        ).toBe(true);
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('preference-picker-alignment-evidence', {
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
