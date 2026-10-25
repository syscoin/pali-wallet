import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import net from 'net';
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
const balanceVariants = [
  {
    ...variants[0],
    key: 'balance-short',
    contract: '0x000000000000000000000000000000000000eb41',
    symbol: 'BALS',
  },
  {
    ...variants[0],
    key: 'balance-32',
    contract: '0x000000000000000000000000000000000000eb42',
    symbol: 'B'.repeat(32),
  },
  {
    ...variants[0],
    key: 'balance-64',
    contract: '0x000000000000000000000000000000000000eb43',
    symbol: 'C'.repeat(64),
  },
] as const;
type BalanceVariant = (typeof balanceVariants)[number];
type ReadVariant = Variant | BalanceVariant;
const balanceContracts: readonly string[] = balanceVariants.map(
  (value) => value.contract
);
const readContracts: readonly string[] = [...contracts, ...balanceContracts];
const byContract = new Map<string, ReadVariant>(
  [...variants, ...balanceVariants].map((value) => [value.contract, value])
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

async function proxyDenial(
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) {
  const proxy = new URL(server.url);
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
  const before = server.blocked.length;
  const result = await new Promise<{
    connectionClosed: boolean;
    statusCode: number;
  }>((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0),
      ended = false,
      settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2000, () =>
      fail(new Error('Loopback denial probe timed out'))
    );
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(
        `${method} ${
          method === 'GET'
            ? 'http://balance-symbol-denied.invalid/'
            : 'balance-symbol-denied.invalid:443'
        } HTTP/1.0\r\nHost: balance-symbol-denied.invalid\r\nConnection: close\r\n\r\n`
      )
    );
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Unexpected denial response size'));
    });
    socket.once('end', () => {
      ended = true;
    });
    socket.once('close', (hadError) => {
      if (settled) return;
      settled = true;
      try {
        expect(hadError).toBe(false);
        expect(ended).toBe(true);
        const text = bytes.toString('utf8'),
          separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        expect(text.slice(0, separator).split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(text.slice(0, separator)).toMatch(
          /\r\nConnection: close(?:\r\n|$)/i
        );
        expect(text.slice(separator + 4)).toBe(
          method === 'GET' ? 'Offline fixture only' : ''
        );
        resolve({ statusCode: 403, connectionClosed: true });
      } catch (error) {
        reject(error);
      }
    });
  });
  const blockedDelta = server.blocked.slice(before);
  expect(blockedDelta).toEqual([method]);
  return { method, ...result, blockedDelta };
}

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
const balanceTargets = (
  state: PublicState,
  side: 'liveAssets' | 'savedAssets'
) =>
  state[side]
    .flatMap((group) =>
      group.ethereum.map((asset) => ({
        ...asset,
        accountKind: group.kind,
        accountId: group.id,
      }))
    )
    .filter(
      (asset: any) =>
        asset.chainId === 1 && balanceContracts.includes(asset.contract)
    )
    .sort((a: any, b: any) => a.contract.localeCompare(b.contract));
const withoutBalanceTargets = (state: PublicState) => ({
  ...state,
  liveAssets: state.liveAssets.map((group) => ({
    ...group,
    ethereum: group.ethereum.filter(
      (asset: any) =>
        !(
          group.kind === state.active.type &&
          group.id === state.active.id &&
          asset.chainId === 1 &&
          balanceContracts.includes(asset.contract)
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
          balanceContracts.includes(asset.contract)
        )
    ),
  })),
});

// Read actual paint only. No DOM, native Selection, scroll or focus setter.
const measureBalanceSymbol = (row: Locator) =>
  row.evaluate((root) => {
    const box = (node: Element) => node.getBoundingClientRect().toJSON();
    const parts = root.querySelectorAll(':scope > p');
    if (parts.length !== 2) throw new Error('Actual Balance row shape changed');
    const label = parts[0];
    const value = parts[1].querySelector('span');
    if (!value) throw new Error('Actual Balance value span is missing');
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const ancestors: any[] = [];
    for (let node: Element | null = value; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      ancestors.push({
        tag: node.tagName,
        scrollKey: node.getAttribute('data-navigation-scroll'),
        box: box(node),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      });
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + node.clientLeft + node.clientWidth
        );
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + node.clientTop + node.clientHeight
        );
      }
    }
    const ranges = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => rect.toJSON());
    };
    const glyphs: any[] = [];
    const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const content = text.textContent || '';
      for (let index = 0; index < content.length; index += 1) {
        if (/\s/.test(content[index])) continue;
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        for (const rect of [...range.getClientRects()]) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          const hit = document.elementFromPoint(
            (rect.left + rect.right) / 2,
            (rect.top + rect.bottom) / 2
          );
          glyphs.push({
            character: content[index],
            rect: rect.toJSON(),
            centerHit: !!hit && (hit === value || value.contains(hit)),
          });
        }
      }
    }
    const tolerance = 0.5;
    const within = (a: any, b: typeof clip) =>
      a.left >= b.left - tolerance &&
      a.right <= b.right + tolerance &&
      a.top >= b.top - tolerance &&
      a.bottom <= b.bottom + tolerance;
    const overlap = (a: any, b: any) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    const labelRects = ranges(label);
    const neighbors = [
      root.previousElementSibling,
      root.nextElementSibling,
      ...(root.parentElement?.querySelectorAll('button') || []),
    ]
      .filter((node): node is Element => !!node)
      .map((node) => ({
        tag: node.tagName,
        text: node.textContent,
        box: box(node),
      }))
      .filter((node) => node.box.width > 0 && node.box.height > 0);
    const collisions = neighbors.filter((neighbor) =>
      glyphs.some((glyph) => overlap(glyph.rect, neighbor.box))
    );
    const rowBox = box(root);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      fontStatus: document.fonts.status,
      font: getComputedStyle(value).font,
      text: value.textContent,
      label: { text: label.textContent, box: box(label), rects: labelRects },
      row: rowBox,
      value: box(value),
      clip,
      ancestors,
      glyphs,
      neighbors,
      collisions,
      labelCollision: glyphs.some((glyph) =>
        labelRects.some((rect) => overlap(glyph.rect, rect))
      ),
      allGlyphsPainted:
        glyphs.length > 0 &&
        glyphs.every((glyph) => within(glyph.rect, clip) && glyph.centerHit),
      // Assigned row overflow is observational, not a standalone defect.
      exceedsAssignedRow: glyphs.some((glyph) => !within(glyph.rect, rowBox)),
    };
  });

const revealBalanceSymbolRow = async (
  page: Page,
  row: Locator,
  pane: Locator,
  gestures: any[]
) => {
  await expect(pane).toHaveCount(1);
  const geometry = () =>
    row.evaluate((root) => {
      const owner = root.closest<HTMLElement>(
        '[data-navigation-scroll="asset-details"]'
      );
      if (!owner) throw new Error('Actual asset-details owner is missing');
      const bounds = owner.getBoundingClientRect();
      const clip = {
        left: Math.max(0, bounds.left + owner.clientLeft),
        right: Math.min(
          innerWidth,
          bounds.left + owner.clientLeft + owner.clientWidth
        ),
        top: Math.max(0, bounds.top + owner.clientTop),
        bottom: Math.min(
          innerHeight,
          bounds.top + owner.clientTop + owner.clientHeight
        ),
      };
      for (let node = owner.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
          clip.left = Math.max(clip.left, rect.left + node.clientLeft);
          clip.right = Math.min(
            clip.right,
            rect.left + node.clientLeft + node.clientWidth
          );
        }
        if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
          clip.top = Math.max(clip.top, rect.top + node.clientTop);
          clip.bottom = Math.min(
            clip.bottom,
            rect.top + node.clientTop + node.clientHeight
          );
        }
      }
      return {
        row: root.getBoundingClientRect().toJSON(),
        owner: bounds.toJSON(),
        clip,
        scrollTop: owner.scrollTop,
        max: Math.max(0, owner.scrollHeight - owner.clientHeight),
        scrolls: [
          ...document.querySelectorAll<HTMLElement>('[data-navigation-scroll]'),
        ].map((node) => ({
          key: node.dataset.navigationScroll,
          left: node.scrollLeft,
          top: node.scrollTop,
        })),
      };
    });
  for (let count = 0; count < 8; count += 1) {
    await frame(page);
    const before = await geometry();
    const availableHeight = before.clip.bottom - before.clip.top;
    expect(
      availableHeight,
      'Balance reveal control: actual pane cannot contain the row plus margins'
    ).toBeGreaterThan(before.row.height + 24);
    if (
      before.row.top >= before.clip.top + 12 &&
      before.row.bottom <= before.clip.bottom - 12
    )
      return;
    const delta = Math.max(
      -160,
      Math.min(
        160,
        before.row.top < before.clip.top + 12
          ? Math.floor(before.row.top - (before.clip.top + 12))
          : Math.ceil(before.row.bottom - (before.clip.bottom - 12))
      )
    );
    const point = {
      x: Math.max(
        before.clip.left + 4,
        Math.min(before.clip.right - 4, before.owner.right - 8)
      ),
      y: (before.clip.top + before.clip.bottom) / 2,
    };
    expect(before.clip.right - before.clip.left).toBeGreaterThan(8);
    const ownerHit = await pane.evaluate((node, target) => {
      const hit = document.elementFromPoint(target.x, target.y);
      return !!hit && (hit === node || node.contains(hit));
    }, point);
    expect(
      ownerHit,
      'Balance reveal control: physical pointer must hit the actual owner'
    ).toBe(true);
    await page.mouse.move(point.x, point.y);
    const entry: any = { delta, point, ownerHit, before };
    gestures.push(entry);
    await page.mouse.wheel(0, delta);
    const signature = (value: typeof before) =>
      JSON.stringify({
        top: value.row.top,
        bottom: value.row.bottom,
        clip: value.clip,
        scrolls: value.scrolls,
      });
    await expect
      .poll(
        async () => {
          entry.after = await geometry();
          return signature(entry.after);
        },
        {
          message:
            'Balance reveal control: a real bounded wheel must change actual scroll or row position',
        }
      )
      .not.toBe(signature(before));
    await expect(page).toHaveURL(/#\/home\/details/);
  }
  const final = await geometry();
  expect(
    final.row.top >= final.clip.top + 12 &&
      final.row.bottom <= final.clip.bottom - 12,
    'Balance reveal control: row remained outside actual owner after eight physical gestures'
  ).toBe(true);
};

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
    ...balanceContracts,
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
  const marketBody = (value: ReadVariant) => ({
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
    // Node socket probes run before launch; they never enter Playwright's
    // requestfailed array, which is never cleared or filtered for this probe.
    observations.denialCanaries = [
      await proxyDenial(server, 'GET'),
      await proxyDenial(server, 'CONNECT'),
    ];
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

    // Shadow the shared fixture's permissive Tanenbaum fallback in this test.
    // Source-backed provider/network identity checks use only eth_chainId[].
    // An unexpected owner/code/call read is refused for source triage, not
    // answered by a generic empty result or added silently to an allowlist.
    observations.balanceStartupRpcReads = [];
    await wallet.context.route(
      (url) => url.origin === 'https://rpc.tanenbaum.io',
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const refuse = (reason: string, calls: any[] = []) => {
          unsupported.push({
            kind: 'strict-startup-rpc',
            reason,
            url: url.href,
            method: request.method(),
            calls: calls.map((call: any) => ({
              id: call?.id,
              jsonrpc: call?.jsonrpc,
              method: call?.method,
              params: call?.params,
            })),
          });
          return route.abort('blockedbyclient');
        };
        if (
          url.href !== 'https://rpc.tanenbaum.io/' ||
          request.method() !== 'POST'
        )
          return refuse('origin path query credentials or HTTP method');
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          return refuse('invalid JSON');
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        if (
          calls.length === 0 ||
          calls.some(
            (call: any) =>
              !call ||
              typeof call !== 'object' ||
              Array.isArray(call) ||
              Object.keys(call).sort().join(',') !==
                'id,jsonrpc,method,params' ||
              call.jsonrpc !== '2.0' ||
              !Number.isSafeInteger(call.id) ||
              call.id < 0 ||
              call.method !== 'eth_chainId' ||
              !Array.isArray(call.params) ||
              call.params.length !== 0
          )
        )
          return refuse(
            'unrecognized identity envelope method or params',
            calls
          );
        observations.balanceStartupRpcReads.push(
          ...calls.map((call: any) => ({
            url: url.href,
            id: call.id,
            method: call.method,
            params: call.params,
          }))
        );
        const replies = calls.map((call: any) => ({
          jsonrpc: '2.0',
          id: call.id,
          result: '0x1644',
        }));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
        });
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
          result = readContracts.includes(String(params[0]).toLowerCase())
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
          // New symbols use the same SDK read producer but only this exact
          // transaction object; original four-contract guards stay unchanged.
          const balanceTransactionIsExact =
            !balanceContracts.includes(target) ||
            (params[0] &&
              typeof params[0] === 'object' &&
              !Array.isArray(params[0]) &&
              Object.keys(params[0]).sort().join(',') === 'data,to' &&
              typeof params[0].to === 'string' &&
              typeof params[0].data === 'string');
          if (token && balanceTransactionIsExact) {
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
              if (
                [...owners, target].includes(requested) &&
                (!balanceContracts.includes(target) ||
                  data ===
                    selector + abi.encode(['address'], [requested]).slice(2))
              )
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
                ].includes(requested) &&
                (!balanceContracts.includes(target) ||
                  data ===
                    selector + abi.encode(['bytes4'], [requested]).slice(2))
              )
                result = abi.encode(['bool'], [false]);
            }
            if (result !== undefined)
              reads.push({ kind: 'token', contract: target, selector, params });
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
        reads.push({ kind: 'rpc', method: call.method, params });
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
          // The decorative favicon is hidden; the heading includes the visible link label.
          name: en.tokens.marketInformation + ' CoinGecko',
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
              card().getByRole('link', { name: 'CoinGecko', exact: true })
            ).toHaveAttribute('href', 'https://www.coingecko.com');
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

    // Diagnostic-only extension. Keep the original four-token/eight-Copy
    // and market predicates above unchanged before importing these controls.
    let balanceImportedBaseline!: PublicState;
    observations.balanceMeasurements = [];
    observations.balanceNativeCopies = [];
    const openBalance = (value: BalanceVariant) =>
      page.getByRole('button', {
        name: en.tokens.viewTokenDetails.replace('{{symbol}}', value.symbol),
        exact: true,
      });
    const unchangedBalance = async () =>
      expect(await publicState(page)).toEqual(balanceImportedBaseline);
    await wallet.step(
      'import short 32 and 64 character symbols through real SDK reads and durable saves',
      async () => {
        await page.setViewportSize({ width: 400, height: 620 });
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .and(page.locator('button[aria-pressed]'))
          .click();
        for (const value of balanceVariants) {
          await page.locator('#custom-token-contract').fill(value.contract);
          const add = page.getByRole('button', {
            name: en.tokens.importNamedToken.replace(
              '{{symbol}}',
              value.symbol
            ),
            exact: true,
          });
          await expect(add).toBeEnabled();
          for (const signature of ['symbol()', 'decimals()']) {
            const expectedData = id(signature).slice(0, 10);
            expect(
              reads.some(
                (read) =>
                  read.kind === 'token' &&
                  read.contract === value.contract &&
                  read.params?.[1] === 'latest' &&
                  read.params?.[0]?.data === expectedData
              )
            ).toBe(true);
          }
          expect(
            reads.some(
              (read) =>
                read.kind === 'token' &&
                read.contract === value.contract &&
                read.params?.[1] === 'latest' &&
                read.params?.[0]?.data ===
                  id('balanceOf(address)').slice(0, 10) +
                    abi.encode(['address'], [owner]).slice(2)
            )
          ).toBe(true);
          expect(
            reads.some(
              (read) =>
                read.kind === 'token' &&
                read.contract === value.contract &&
                read.selector === id('supportsInterface(bytes4)').slice(0, 10)
            )
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
              balanceTargets(await publicState(page), 'savedAssets').map(
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
        balanceImportedBaseline = await publicState(page);
        expect(withoutBalanceTargets(balanceImportedBaseline)).toEqual(
          importedBaseline
        );
        const live = balanceTargets(balanceImportedBaseline, 'liveAssets');
        expect(live.map((value: any) => value.contract)).toEqual(
          [...balanceContracts].sort()
        );
        expect(balanceTargets(balanceImportedBaseline, 'savedAssets')).toEqual(
          live
        );
        for (const value of balanceVariants)
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
        observations.balanceImportedBaseline = balanceImportedBaseline;
      }
    );
    for (const value of balanceVariants)
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        await page.setViewportSize(viewport);
        await wallet.step(
          value.key +
            '-' +
            viewport.width +
            ' actual Balance paint before native controls',
          async (capture) => {
            await reveal(page, openBalance(value));
            await tabTo(page, openBalance(value));
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home\/details/);
            const pane = page.locator(
              '#details-view-content [data-navigation-scroll="asset-details"]'
            );
            const row = pane
              .getByText(en.send.balance, { exact: true })
              .locator('..');
            await expect(row).toHaveCount(1);
            await expect(row.locator(':scope > p').nth(1)).toHaveText(
              '12 ' + value.symbol
            );
            await expect
              .poll(() =>
                row.evaluate((node) => {
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
            await expect
              .poll(() => page.evaluate(() => document.fonts.status))
              .toBe('loaded');
            const gestures: any[] = [];
            observations.balancePendingReveal = {
              key: value.key,
              viewport,
              gestures,
            };
            await revealBalanceSymbolRow(page, row, pane, gestures);
            observations.balancePendingReveal = null;
            await page.mouse.move(2, 2);
            await frame(page);
            const geometry = await measureBalanceSymbol(row);
            expect(geometry.text).toBe('12 ' + value.symbol);
            expect(geometry.fontStatus).toBe('loaded');
            expect(
              geometry.glyphs.map((glyph: any) => glyph.character).join('')
            ).toBe(('12 ' + value.symbol).replace(/\s/g, ''));
            observations.balanceMeasurements.push({
              key: value.key,
              viewport,
              gestures,
              geometry,
              fullSymbolPaintRequired: true,
            });
            await unchangedBalance();
            await capture(page);
          }
        );
        await wallet.step(
          value.key +
            '-' +
            viewport.width +
            ' genuine Copy and Back or Close preserve full public identity',
          async () => {
            if (lastCopy)
              await expect
                .poll(() => page.evaluate(() => Date.now()))
                .toBeGreaterThanOrEqual(lastCopy + 2000);
            const copiesBefore = await readNativeCopies();
            await tabTo(page, copy());
            await page.keyboard.press(
              viewport.width === 400 ? 'Enter' : 'Space'
            );
            const notice = page.getByText(en.home.contractCopied, {
              exact: true,
            });
            await expect(notice).toBeVisible();
            await expect
              .poll(readNativeCopies)
              .toEqual([...copiesBefore, value.contract]);
            observations.balanceNativeCopies.push({
              key: value.key,
              viewport,
              text: value.contract,
              completed: true,
            });
            lastCopy = await page.evaluate(() => Date.now());
            await notice.click();
            await expect(notice).toBeHidden();
            await unchangedBalance();
            const action =
              viewport.width === 400
                ? page.getByRole('button', {
                    name: en.buttons.back,
                    exact: true,
                  })
                : close();
            await tabTo(page, action);
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            await expect(openBalance(value)).toHaveCount(1);
            await unchangedBalance();
          }
        );
      }
    await wallet.step(
      'additional symbols retain exact state source worker native writes and physical deny fences',
      async () => {
        await unchangedBalance();
        expect(withoutBalanceTargets(balanceImportedBaseline)).toEqual(
          importedBaseline
        );
        observations.balanceWorkerAfter = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            observations.balanceWorkerAfter = value;
          }
        );
        // Every Tanenbaum request is handled by the stricter local route;
        // no permissive shared synthetic-evm fallback may answer any call.
        expect(
          routes!.reads.some((read) => read.startsWith('synthetic-evm:'))
        ).toBe(false);
        expect(observations.balanceMeasurements).toHaveLength(6);
        expect(observations.balanceNativeCopies).toHaveLength(6);
        expect(await readNativeCopies()).toEqual([
          ...variants.flatMap((value) => [value.contract, value.contract]),
          ...balanceVariants.flatMap((value) => [
            value.contract,
            value.contract,
          ]),
        ]);
        expect(observations.denialCanaries).toHaveLength(2);
        expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
        expect(
          server.blocked.every(
            (method) => method === 'GET' || method === 'CONNECT'
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
        observations.balancePaintCandidates =
          observations.balanceMeasurements.map((entry: any) => ({
            key: entry.key,
            viewport: entry.viewport,
            fullPaint: entry.geometry.allGlyphsPainted,
            labelCollision: entry.geometry.labelCollision,
            neighborCollisionCount: entry.geometry.collisions.length,
            exceedsAssignedRow: entry.geometry.exceedsAssignedRow,
          }));
      }
    );
    await wallet.step(
      'short and long Balance symbols remain fully painted without label or neighboring control collisions',
      async () => {
        const healthy = observations.balancePaintCandidates.filter(
          (entry: any) => entry.key === 'balance-short'
        );
        expect(healthy).toHaveLength(2);
        for (const value of healthy) {
          expect(value.fullPaint).toBe(true);
          expect(value.labelCollision).toBe(false);
          expect(value.neighborCollisionCount).toBe(0);
        }
        // All old market and new identity, native-control, worker and scope
        // gates complete before the confirmed visual regression predicate.
        expect(observations.balancePaintCandidates).toHaveLength(6);
        expect(
          observations.balancePaintCandidates.map(
            (entry: any) => entry.key + ':' + entry.viewport.width
          )
        ).toEqual(
          balanceVariants.flatMap((value) => [
            value.key + ':400',
            value.key + ':320',
          ])
        );
        for (const value of observations.balancePaintCandidates) {
          expect(value.fullPaint).toBe(true);
          expect(value.labelCollision).toBe(false);
          expect(value.neighborCollisionCount).toBe(0);
        }
        observations.balanceFullPaintRequired = true;
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
          balanceVariants,
          balanceSymbolFullPaintRequired: true,
          additionalNativeClipboardWritesExpected: 6,
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
          actualPixelReviewRequired: true,
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
