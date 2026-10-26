import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { HDNodeWallet } from 'ethers';
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
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Observe the actual request view only. Request Now is never activated; every
// faucet claim and transaction/signing operation is denied and audited.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const NETWORK = 'Syscoin NEVM Testnet';
const RPC = 'https://rpc.tanenbaum.io/';
const API = 'https://explorer.tanenbaum.io/api';
const LABEL = 'Family savings — travel and rainy-day fund 2026';
const BANNER = en.faucet.grabTextTwo.replace('{{token}}', 'TSYS');
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
const initialQueries = new Set([
  'details=tokenBalances&tokens=used',
  'details=tokenBalances&tokens=nonzero',
  'details=txsummary&pageSize=30',
  'details=txslight&pageSize=30',
]);

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
            ? 'http://faucet-label-denied.invalid/'
            : 'faucet-label-denied.invalid:443'
        } HTTP/1.0\r\nHost: faucet-label-denied.invalid\r\nConnection: close\r\n\r\n`
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
    const disk = await chrome.storage.local.get([key, 'state']);
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
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, families]: [string, any]) => ({
            kind,
            id: Number(id),
            ethereum: families?.ethereum || [],
            syscoin: families?.syscoin || [],
            nfts: families?.nfts || [],
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const network = state.vault.activeNetwork;
    const active = state.vault.activeAccount;
    return {
      active,
      savedActive: saved?.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: network.kind,
        chainId: network.chainId,
        label: network.label,
        url: network.url,
        apiUrl: network.apiUrl,
      },
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(saved),
      liveAssets: assets(state.vault),
      savedAssets: assets(saved),
      grants: Object.keys(state.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
      balance: state.vault.accounts[active.type][active.id].balances?.ethereum,
      firstAccess: Boolean(
        state.vault.shouldShowFaucetModal?.[network.chainId]
      ),
      lifecycle: {
        status: state.vaultGlobal.networkStatus,
        loading: state.vaultGlobal.isPostNetworkSwitchLoading,
        switching: state.vaultGlobal.isSwitchingAccount,
      },
    };
  });
const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
const settledLayout = async (page: Page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity
        )
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
  await frame(page);
};
async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 40; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

const measureCard = (card: Locator) =>
  card.evaluate((root) => {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const cardBox = rect(root),
      style = getComputedStyle(root);
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const ancestors: any[] = [];
    for (let node = root.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node),
        r = node.getBoundingClientRect();
      ancestors.push({
        tag: node.tagName,
        scrollKey: node.getAttribute('data-navigation-scroll'),
        box: rect(node),
        overflowX: s.overflowX,
        overflowY: s.overflowY,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      });
      if (/auto|scroll|hidden|clip/.test(s.overflowX)) {
        clip.left = Math.max(clip.left, r.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          r.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(s.overflowY)) {
        clip.top = Math.max(clip.top, r.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          r.top + node.clientTop + node.clientHeight
        );
      }
    }
    const neighbors = [...(root.parentElement?.children || [])]
      .filter((node) => node !== root)
      .filter((node) => {
        const s = getComputedStyle(node),
          b = node.getBoundingClientRect();
        return (
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          Number(s.opacity) !== 0 &&
          b.width > 0 &&
          b.height > 0
        );
      })
      .map((node) => ({
        tag: node.tagName,
        footer: node.hasAttribute('data-page-action-footer'),
        text: node.textContent,
        box: rect(node),
      }));
    const overlays = [...document.querySelectorAll('[data-page-action-footer]')]
      .filter((node) => !node.contains(root))
      .flatMap((node) => {
        const s = getComputedStyle(node),
          r = node.getBoundingClientRect();
        if (
          !['sticky', 'fixed'].includes(s.position) ||
          s.visibility === 'hidden' ||
          Number(s.opacity) === 0 ||
          r.width <= 0 ||
          r.height <= 0 ||
          r.top >= clip.bottom ||
          r.bottom <= clip.top
        )
          return [];
        clip.bottom = Math.min(clip.bottom, r.top);
        return [{ position: s.position, box: rect(node) }];
      });
    const within = (
      r: { bottom: number; left: number; right: number; top: number },
      boundary: typeof clip
    ) =>
      r.left >= boundary.left - 0.5 &&
      r.right <= boundary.right + 0.5 &&
      r.top >= boundary.top - 0.5 &&
      r.bottom <= boundary.bottom + 0.5;
    const intersects = (a: typeof clip, b: typeof clip) =>
      a.left < b.right - 0.5 &&
      a.right > b.left + 0.5 &&
      a.top < b.bottom - 0.5 &&
      a.bottom > b.top + 0.5;
    const part = (node: Element | null) => {
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const glyphs = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        }));
      return {
        text: node.textContent,
        box: rect(node),
        glyphs,
        insideCard:
          glyphs.length > 0 && glyphs.every((r) => within(r, cardBox)),
        exposed: glyphs.length > 0 && glyphs.every((r) => within(r, clip)),
        collisions: neighbors.flatMap((neighbor, index) =>
          glyphs.some((r) => intersects(r, neighbor.box)) ? [index] : []
        ),
        hits: glyphs.map((r) => {
          const x = (r.left + r.right) / 2,
            y = (r.top + r.bottom) / 2,
            hit = document.elementFromPoint(x, y);
          return {
            x,
            y,
            reachesText: !!hit && (hit === node || node.contains(hit)),
          };
        }),
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      fontStatus: document.fonts.status,
      card: cardBox,
      cardStyle: {
        height: style.height,
        padding: style.padding,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      },
      clip,
      ancestors,
      overlays,
      neighbors,
      label: part(root.querySelector('h1')),
      address: part(root.querySelector('p')),
      icon: root.querySelector('.add-identicon svg')
        ? rect(root.querySelector('.add-identicon svg')!)
        : null,
      cardExposed: within(cardBox, clip),
    };
  });
async function revealCard(page: Page, card: Locator, gestures: any[]) {
  const owner = page.locator('[data-navigation-scroll="wallet-layout"]');
  await expect(owner).toHaveCount(1);
  await settledLayout(page);
  for (let count = 0; count < 12; count += 1) {
    const geometry = await measureCard(card);
    if (geometry.cardExposed) break;
    const delta = geometry.card.top < geometry.clip.top ? -64 : 64;
    const scroll = await owner.evaluate((node) => ({
      top: node.scrollTop,
      max: Math.max(0, node.scrollHeight - node.clientHeight),
    }));
    const target = Math.max(0, Math.min(scroll.max, scroll.top + delta));
    if (Math.abs(target - scroll.top) < 0.5) break;
    await page.mouse.move(
      page.viewportSize()!.width - 8,
      (geometry.clip.top + geometry.clip.bottom) / 2
    );
    await page.mouse.wheel(0, delta);
    await expect
      .poll(() => owner.evaluate((node) => node.scrollTop))
      .toBeCloseTo(target, 0);
    await frame(page);
    gestures.push({ delta, scroll, target });
  }
  await frame(page);
}

// Measure the genuine request text without changing its DOM or native selection.
const measureFaucetContract = (page: Page, expectedText: string) =>
  page.evaluate((expected) => {
    const entry = history.state as { idx?: number; key?: string } | null;
    const route = {
      url: location.href,
      idx: entry?.idx ?? null,
      key: entry?.key ?? null,
    };
    // Route and optional real P are read atomically. A native Back must not
    // turn an allowed Home observation into a stale Faucet locator wait.
    const matches = [...document.querySelectorAll('p')].filter(
      (node) => node.textContent === expected
    );
    if (matches.length !== 1) {
      return { available: false as const, matchCount: matches.length, route };
    }
    const element = matches[0];
    const rect = (node: Element) => {
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const ancestors: any[] = [];
    // Include the P itself: its own overflow:hidden is material here.
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node),
        box = node.getBoundingClientRect();
      ancestors.push({
        tag: node.tagName,
        box: rect(node),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      });
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          box.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          box.top + node.clientTop + node.clientHeight
        );
      }
    }
    const glyphs: any[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      const value = text.textContent || '';
      for (let i = 0; i < value.length; i += 1) {
        // Detached measurement Ranges do not change native Selection.
        const range = document.createRange();
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        for (const box of [...range.getClientRects()]) {
          if (box.width <= 0 || box.height <= 0) continue;
          const hit = document.elementFromPoint(
            (box.left + box.right) / 2,
            (box.top + box.bottom) / 2
          );
          glyphs.push({
            character: value[i],
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            centerHit: !!hit && (hit === element || element.contains(hit)),
          });
        }
      }
    }
    const tolerance = 0.5;
    const contained = (r: any) =>
      r.left >= clip.left - tolerance &&
      r.right <= clip.right + tolerance &&
      r.top >= clip.top - tolerance &&
      r.bottom <= clip.bottom + tolerance;
    const textStyle = getComputedStyle(element);
    const feedback = element.parentElement!;
    const feedbackStyle = getComputedStyle(feedback);
    const neighbors = [
      element.previousElementSibling,
      feedback.nextElementSibling,
      ...document.querySelectorAll('[data-page-action-footer]'),
    ]
      .filter((node): node is Element => !!node)
      .map(rect);
    return {
      available: true as const,
      matchCount: 1,
      route,
      text: element.textContent,
      tag: element.tagName,
      role: element.getAttribute('role'),
      tabIndex: (element as HTMLElement).tabIndex,
      href: element.getAttribute('href'),
      title: element.getAttribute('title'),
      interactiveAncestor: element.closest('a,button')?.tagName || null,
      fontStatus: document.fonts.status,
      font: textStyle.font,
      userSelect: textStyle.userSelect,
      box: rect(element),
      feedbackBox: rect(feedback),
      feedbackPadding: {
        left: parseFloat(feedbackStyle.paddingLeft) + feedback.clientLeft,
        right: parseFloat(feedbackStyle.paddingRight) + feedback.clientLeft,
        bottom: parseFloat(feedbackStyle.paddingBottom) + feedback.clientTop,
      },
      neighborCollisions: neighbors.filter((neighbor) =>
        glyphs.some(
          (glyph) =>
            Math.min(glyph.right, neighbor.right) -
              Math.max(glyph.left, neighbor.left) >
              tolerance &&
            Math.min(glyph.bottom, neighbor.bottom) -
              Math.max(glyph.top, neighbor.top) >
              tolerance
        )
      ),
      clip,
      ancestors,
      glyphs,
      allGlyphsPainted:
        glyphs.length > 0 && glyphs.every((r) => contained(r) && r.centerHit),
    };
  }, expectedText);

// Exercise physical selection and scrolling after the account controls, before
// the final worker/fence gate. Only the exact saved Home/Faucet entries qualify.
const observeFaucetContractRecovery = async ({
  wallet,
  page,
  prefix,
  banner,
  back,
  requestNow,
  contract,
  expectedContract,
  unchanged,
  historyEntry,
  reveal,
  observations,
}: {
  back: Locator;
  banner: Locator;
  contract: Locator;
  expectedContract: string;
  historyEntry: () => Promise<{
    idx: number | null;
    key: string | null;
    url: string;
  }>;
  observations: Record<string, any>;
  page: Page;
  prefix: string;
  requestNow: Locator;
  reveal: () => Promise<void>;
  unchanged: () => Promise<void>;
  wallet: PaliWallet;
}) => {
  const record: Record<string, any> = {
    measurements: [],
    selection: [],
    wheels: [],
    reopenings: [],
    unexpectedEntries: [],
  };
  observations.contractRecovery = record;
  const measure = async (phase: string) => {
    const value = await measureFaucetContract(page, expectedContract);
    record.measurements.push({ phase, value });
    expect(value.route).toEqual(record.faucet);
    expect(value.available).toBe(true);
    if (!value.available) throw new Error('Real Faucet contract P is absent');
    return value;
  };
  const readSelection = () =>
    page.evaluate(() => ({
      // This route contains only public fixture text. No clipboard read is
      // attempted: a failed copy must not expose an unrelated system clipboard.
      text: window.getSelection()?.toString() || '',
      anchorTag:
        window.getSelection()?.anchorNode?.parentElement?.tagName || null,
      focusTag:
        window.getSelection()?.focusNode?.parentElement?.tagName || null,
    }));

  await wallet.step(
    prefix + ' real idle contract data and native route controls',
    async (capture) => {
      const entry = await historyEntry();
      if (/#\/faucet$/.test(entry.url)) await back.click();
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await unchanged();
      await tabTo(page, banner);
      record.home = await historyEntry();
      await page.keyboard.press('Space');
      await expect(page).toHaveURL(/#\/faucet$/);
      record.faucet = await historyEntry();
      expect(Number.isSafeInteger(record.home.idx)).toBe(true);
      expect(Number.isSafeInteger(record.faucet.idx)).toBe(true);
      expect(record.faucet.idx).toBe(record.home.idx + 1);
      expect(record.home.key).toEqual(expect.any(String));
      expect(record.faucet.key).toEqual(expect.any(String));
      expect(record.home.key).not.toBe('');
      expect(record.faucet.key).not.toBe(record.home.key);
      await expect(contract).toHaveCount(1);
      await expect(contract).toHaveText(expectedContract);
      await expect(requestNow).toBeEnabled();
      const owner = page.locator('[data-navigation-scroll="wallet-layout"]');
      await expect(owner).toHaveCount(1);
      const ownerBox = await owner.boundingBox();
      expect(ownerBox).not.toBeNull();
      const viewport = page.viewportSize()!;
      const wheelPoint = {
        x: Math.min(viewport.width - 4, ownerBox!.x + ownerBox!.width - 4),
        y: Math.max(
          ownerBox!.y + 4,
          Math.min(viewport.height / 2, ownerBox!.y + ownerBox!.height - 4)
        ),
      };
      const ownerHit = await owner.evaluate((node, point) => {
        const target = document.elementFromPoint(point.x, point.y);
        return !!target && node.contains(target);
      }, wheelPoint);
      expect(ownerHit).toBe(true);
      await page.mouse.move(wheelPoint.x, wheelPoint.y);
      await page.mouse.wheel(0, -96);
      await frame(page);
      record.verticalWheel = { deltaY: -96, point: wheelPoint, ownerHit };
      await reveal();
      await page.mouse.move(2, 2);
      await settledLayout(page);
      const initial = await measure('initial');
      expect(initial.tag).toBe('P');
      expect(initial.role).toBeNull();
      expect(initial.tabIndex).toBe(-1);
      expect(initial.href).toBeNull();
      expect(initial.title).toBeNull();
      expect(initial.interactiveAncestor).toBeNull();
      await expect(
        page.getByRole('button', { name: en.buttons.copy, exact: true })
      ).toHaveCount(0);
      expect(initial.fontStatus).toBe('loaded');
      expect(initial.glyphs.map((glyph: any) => glyph.character).join('')).toBe(
        expectedContract
      );
      await unchanged();
      await capture(page);
    }
  );

  await wallet.step(
    prefix +
      ' genuine native double click and drag observe full-value selection',
    async (capture) => {
      const point = async () => {
        const value = await measure('selection-pointer-target');
        // A native pointer needs a real visible hit point, not the complete
        // font line rectangle. Full-glyph paint remains measured separately.
        const glyph = value.glyphs.find(
          (r: any) =>
            (r.left + r.right) / 2 >= value.clip.left &&
            (r.left + r.right) / 2 <= value.clip.right &&
            (r.top + r.bottom) / 2 >= value.clip.top &&
            (r.top + r.bottom) / 2 <= value.clip.bottom &&
            r.centerHit
        );
        expect(glyph).toBeDefined();
        return {
          x: (glyph.left + glyph.right) / 2,
          y: (glyph.top + glyph.bottom) / 2,
        };
      };
      const start = await point();
      await page.mouse.click(start.x, start.y, { clickCount: 2 });
      record.selection.push({
        phase: 'double-click',
        value: await readSelection(),
      });
      await measure('after-double-click');
      await wallet.shot(
        prefix + ' native double click selection without a setter'
      );
      // Read the physical drag start again after double-click native selection.
      const dragStart = await point();
      await page.mouse.click(dragStart.x, dragStart.y);
      await page.mouse.move(dragStart.x, dragStart.y);
      await page.mouse.down();
      try {
        const width = page.viewportSize()!.width;
        await page.mouse.move(width - 2, dragStart.y, { steps: 8 });
      } finally {
        await page.mouse.up();
      }
      record.selection.push({ phase: 'drag', value: await readSelection() });
      await measure('after-drag');
      expect(await historyEntry()).toEqual(record.faucet);
      await expect(requestNow).toBeEnabled();
      await unchanged();
      await capture(page);
    }
  );

  await wallet.step(
    prefix +
      ' terminal real horizontal wheels retain exact native history and public scope',
    async (capture) => {
      const sameEntry = (a: any, b: any) =>
        a.url === b.url && a.idx === b.idx && a.key === b.key;
      const atomic = async (phase: string) => {
        const value = await measureFaucetContract(page, expectedContract);
        if (
          !sameEntry(value.route, record.home) &&
          !sameEntry(value.route, record.faucet)
        ) {
          record.unexpectedEntries.push({ phase, value });
        }
        return value;
      };
      const settledAtomic = async (phase: string) => {
        let previous = '',
          stable = 0;
        let value = await atomic(phase);
        await expect
          .poll(async () => {
            value = await atomic(phase);
            const signature = JSON.stringify({
              route: value.route,
              available: value.available,
              matchCount: value.matchCount,
              positions: value.available
                ? value.ancestors.map((node: any) => [
                    node.scrollLeft,
                    node.scrollTop,
                  ])
                : [],
            });
            stable = signature === previous ? stable + 1 : 0;
            previous = signature;
            const known =
              sameEntry(value.route, record.home) ||
              sameEntry(value.route, record.faucet);
            // Observe actual Home/no-P, rather than inventing contract glyphs.
            const routeMatchesDom = sameEntry(value.route, record.home)
              ? !value.available && value.matchCount === 0
              : value.available;
            return known && routeMatchesDom && stable >= 2;
          })
          .toBe(true);
        expect(record.unexpectedEntries).toEqual([]);
        record.measurements.push({ phase, value });
        return value;
      };
      const reopenFromExactHome = async (phase: string) => {
        const before = await settledAtomic(phase + '-home');
        expect(before.route).toEqual(record.home);
        expect(before.available).toBe(false);
        await expect(banner).toHaveCount(1);
        await unchanged();
        await wallet.shot(
          prefix + ' actual Home after native traversal ' + phase
        );
        await tabTo(page, banner);
        expect(await historyEntry()).toEqual(record.home);
        await page.keyboard.press('Space');
        await expect(page).toHaveURL(/#\/faucet$/);
        const next = await historyEntry();
        expect(next.idx).toBe(record.home.idx + 1);
        expect(next.key).toEqual(expect.any(String));
        expect(next.key).not.toBe('');
        expect(next.key).not.toBe(record.home.key);
        expect(next.key).not.toBe(record.faucet.key);
        record.reopenings.push({ phase, home: record.home, faucet: next });
        record.faucet = next;
        await expect(contract).toHaveCount(1);
        await expect(contract).toHaveText(expectedContract);
        await expect(requestNow).toBeEnabled();
        await unchanged();
        await reveal();
        await settledLayout(page);
        const fresh = await settledAtomic(phase + '-reopened');
        expect(fresh.route).toEqual(next);
        expect(fresh.available).toBe(true);
      };
      // The first reveal has no new pending horizontal gesture. Subsequent
      // observations use only the atomic callback, including after mouse move.
      await reveal();
      for (const deltaX of [240, -240]) {
        let point: { x: number; y: number } | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let value = await settledAtomic('before-wheel-' + deltaX);
          if (sameEntry(value.route, record.home)) {
            await reopenFromExactHome('before-wheel-' + deltaX + '-' + attempt);
            value = await settledAtomic('fresh-wheel-' + deltaX);
          }
          expect(value.route).toEqual(record.faucet);
          expect(value.available).toBe(true);
          if (!value.available)
            throw new Error('Real Faucet wheel target absent');
          // Retain exact paint geometry; use only its genuinely hittable
          // center as the physical gesture target.
          const glyph = value.glyphs.find(
            (r: any) =>
              (r.left + r.right) / 2 >= value.clip.left &&
              (r.left + r.right) / 2 <= value.clip.right &&
              (r.top + r.bottom) / 2 >= value.clip.top &&
              (r.top + r.bottom) / 2 <= value.clip.bottom &&
              r.centerHit
          );
          expect(glyph).toBeDefined();
          point = {
            x: (glyph.left + glyph.right) / 2,
            y: (glyph.top + glyph.bottom) / 2,
          };
          await page.mouse.move(point.x, point.y);
          // Native traversal may commit when the pointer leaves its former
          // target. Read the route and optional P together before dispatch.
          const aimed = await settledAtomic('aimed-wheel-' + deltaX);
          if (sameEntry(aimed.route, record.faucet)) break;
          point = undefined;
          await reopenFromExactHome('aimed-wheel-' + deltaX + '-' + attempt);
        }
        expect(point).toBeDefined();
        if (!point) throw new Error('No stable real Faucet wheel target');
        await page.mouse.wheel(deltaX, 0);
        const after = await settledAtomic('wheel-' + deltaX);
        record.wheels.push({ deltaX, point, targetWasRealGlyph: true, after });
        await wallet.shot(
          prefix + ' genuine contract horizontal wheel ' + deltaX
        );
        await unchanged();
      }
      await page.mouse.move(2, 2);
      await settledLayout(page);
      const final = await settledAtomic('after-terminal-pointer-move');
      record.afterWheels = final.route;
      expect([record.faucet, record.home]).toContainEqual(final.route);
      expect(record.wheels.map((wheel: any) => wheel.deltaX)).toEqual([
        240, -240,
      ]);
      await unchanged();
      record.observed = {
        initiallyFullyPainted: record.measurements[0].value.allGlyphsPainted,
        nativeDoubleClickSelectedFullValue:
          record.selection[0].value.text === expectedContract,
        nativeDragSelectedFullValue:
          record.selection[1].value.text === expectedContract,
        clipboardVerified: false,
      };
      await capture(page);
    }
  );
};

for (const viewport of [
  { width: 800, height: 620 },
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`Faucet account and contract text remain readable with native controls at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    expect(process.version).toBe('v26.12.1');
    expect(info.config.workers).toBe(1);
    expect(info.config.fullyParallel).toBe(false);
    expect(info.project.timeout).toBe(8 * 60 * 1000);
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
    const prefix = `${viewport.width}x${viewport.height}`;
    const owner = HDNodeWallet.fromPhrase(
      UTXO_FIXTURE_SEED,
      undefined,
      "m/44'/60'/0'/0/0"
    ).address;
    const ownerLower = owner.toLowerCase();
    expect(owner).toMatch(/^0x[0-9a-f]{40}$/i);
    const config = getNetworkConfig(57, 'sys');
    const signer = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      config.networks,
      57,
      config.types.zPubType,
      84
    );
    const initialXpub = signer.getAccountXpub();
    const codeTargets = new Set([
      ownerLower,
      ...getPaliInfrastructureContracts(5700).map((value) =>
        value.address.toLowerCase()
      ),
      PALI_CREATE2_DEPLOYER_ADDRESS.toLowerCase(),
      PALI_MULTICALL3_CANONICAL_ADDRESS.toLowerCase(),
    ]);
    const httpReads: string[] = [],
      rpcReads: any[] = [],
      unsupported: any[] = [],
      forbidden: any[] = [],
      failedRequests: any[] = [],
      pageErrors: string[] = [];
    const observations: Record<string, any> = {
      viewport,
      runtime,
      sourceSha256,
      measurements: [],
      gestures: [],
      publicOwner: owner,
    };
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const denialCanaries: any[] = [];
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let baseline!: Awaited<ReturnType<typeof publicState>>,
      renamed!: Awaited<ReturnType<typeof publicState>>;
    try {
      expect(server.blocked).toEqual([]);
      denialCanaries.push(await proxyDenial(server, 'GET'));
      denialCanaries.push(await proxyDenial(server, 'CONNECT'));
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'FaucetLabelSynthetic!2026',
        rpcUrl: server.url,
        networkLabel: NETWORK,
        chainId: 5700,
      });
      wallet = await PaliWallet.launch(
        `faucet-contract-native-recovery-${prefix}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      await wallet.context.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol))
          return route.continue();
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* Ordinary GET. */
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        if (
          url.pathname.startsWith('/api/faucet/claim') ||
          /\/sendtx(?:\/|$)/i.test(url.pathname) ||
          calls.some((call) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          forbidden.push({ method: request.method(), url: url.href });
          return route.abort('blockedbyclient');
        }
        if (url.username || url.password || url.hash) {
          unsupported.push({ kind: 'url', url: url.href });
          return route.abort('blockedbyclient');
        }
        if (url.href === RPC) {
          if (
            request.method() !== 'POST' ||
            !calls.length ||
            calls.length > 20
          ) {
            unsupported.push({ kind: 'rpc-method', method: request.method() });
            return route.abort('blockedbyclient');
          }
          const replies = calls.map((call: any) => {
            if (
              !call ||
              call.jsonrpc !== '2.0' ||
              !Array.isArray(call.params) ||
              !['number', 'string'].includes(typeof call.id)
            ) {
              unsupported.push({ kind: 'rpc-envelope' });
              return undefined;
            }
            const params = call.params;
            let result: unknown;
            if (params.length === 0) {
              if (call.method === 'eth_chainId') result = '0x1644';
              if (call.method === 'net_version') result = '5700';
              if (call.method === 'eth_blockNumber') result = '0x1';
              if (
                ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(
                  call.method
                )
              )
                result = '0x3b9aca00';
            }
            if (
              ['eth_getBalance', 'eth_getTransactionCount'].includes(
                call.method
              ) &&
              params.length === 2 &&
              typeof params[0] === 'string' &&
              params[0].toLowerCase() === ownerLower &&
              ['latest', 'pending'].includes(params[1])
            )
              result = '0x0';
            if (
              call.method === 'eth_getCode' &&
              params.length === 2 &&
              params[1] === 'latest' &&
              typeof params[0] === 'string' &&
              codeTargets.has(params[0].toLowerCase())
            )
              result = '0x';
            if (
              call.method === 'eth_getBlockByNumber' &&
              params.length === 2 &&
              ((['latest', '0x1'].includes(params[0]) && params[1] === false) ||
                (['0x0', '0x1'].includes(params[0]) && params[1] === true))
            )
              result = {
                number: params[0] === '0x0' ? '0x0' : '0x1',
                hash: '0x' + (params[0] === '0x0' ? '11' : '12').repeat(32),
                parentHash:
                  '0x' + (params[0] === '0x0' ? '00' : '11').repeat(32),
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
            if (result === undefined) {
              unsupported.push({
                kind: 'rpc-read',
                method: call.method,
                params,
              });
              return undefined;
            }
            rpcReads.push({ method: call.method, params });
            return { jsonrpc: '2.0', id: call.id, result };
          });
          if (replies.some((reply: any) => reply === undefined))
            return route.abort('blockedbyclient');
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
          });
        }
        if (request.method() !== 'GET') {
          unsupported.push({
            kind: 'http-method',
            method: request.method(),
            url: url.href,
          });
          return route.abort('blockedbyclient');
        }
        let body: unknown;
        if (feeds.has(url.href)) body = feeds.get(url.href);
        if (
          url.href === 'https://blockbook.syscoin.org/api/v2/tickers/currency'
        )
          body = { ts: 1, rates: { usd: 1 } };
        if (
          url.origin === 'https://blockbook.syscoin.org' &&
          url.pathname === '/api/v2/xpub/' + initialXpub &&
          initialQueries.has(url.searchParams.toString())
        )
          body = {
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
        const exactKeys = (keys: string[]) =>
          [...url.searchParams.keys()].length === keys.length &&
          keys.every((key) => url.searchParams.getAll(key).length === 1);
        if (
          url.origin === 'https://api.coingecko.com' &&
          url.pathname === '/api/v3/simple/price' &&
          exactKeys(['ids', 'vs_currencies', 'include_24hr_change']) &&
          url.searchParams.get('ids') === 'syscoin' &&
          url.searchParams.get('vs_currencies') === 'usd' &&
          url.searchParams.get('include_24hr_change') === 'true'
        )
          body = { syscoin: { usd: 1, ['usd_24h_change']: 0 } };
        if (url.origin + url.pathname === API) {
          const action = url.searchParams.get('action') || '',
            pending = action === 'pendingtxlist',
            paged = url.searchParams.has('page');
          const address = (url.searchParams.get('address') || '').toLowerCase();
          if (
            ['txlist', 'tokentx', 'pendingtxlist'].includes(action) &&
            address === ownerLower &&
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
            body = { status: '1', message: 'OK', result: [] };
          if (
            action === 'tokenlist' &&
            address === ownerLower &&
            url.searchParams.get('module') === 'account' &&
            exactKeys(['module', 'action', 'address'])
          )
            body = { status: '1', message: 'OK', result: [] };
          if (
            exactKeys(['module', 'action']) &&
            ((action === 'eth_block_number' &&
              url.searchParams.get('module') === 'block') ||
              (action === 'eth_blockNumber' &&
                url.searchParams.get('module') === 'proxy'))
          )
            body = { status: '1', message: 'OK', result: '0x1' };
        }
        if (body === undefined) {
          unsupported.push({ kind: 'http-read', url: url.href });
          return route.abort('blockedbyclient');
        }
        httpReads.push(url.href);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(body),
        });
      });
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
      const banner = page.getByRole('button', { name: BANNER, exact: true });
      const back = page.getByRole('button', {
        name: en.buttons.back,
        exact: true,
      });
      const requestNow = page.getByRole('button', {
        name: en.faucet.requestNow,
        exact: true,
      });
      const openManager = async () => {
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', {
            name: en.accountMenu.manageAccounts,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
      };
      const unchanged = async (
        expected: Awaited<ReturnType<typeof publicState>>
      ) => expect(await publicState(page)).toEqual(expected);
      const nativeHistoryEntry = () =>
        page.evaluate(() => {
          const entry = history.state as { idx?: number; key?: string } | null;
          return {
            url: location.href,
            idx: entry?.idx ?? null,
            key: entry?.key ?? null,
          };
        });
      const cardFor = (label: string) =>
        page
          .getByRole('heading', { name: label, exact: true, level: 1 })
          .locator('xpath=../..');
      const observe = async (
        state: 'healthy' | 'renamed',
        label: string,
        expected: Awaited<ReturnType<typeof publicState>>
      ) => {
        const card = cardFor(label);
        await expect(card).toHaveCount(1);
        await expect(
          card.getByText(`${owner.slice(0, 8)}...${owner.slice(-8)}`, {
            exact: true,
          })
        ).toHaveCount(1);
        await expect(card.locator('.add-identicon svg')).toHaveCount(1);
        await expect(requestNow).toBeEnabled();
        const before = await measureCard(card);
        await revealCard(page, card, observations.gestures);
        await page.mouse.move(2, 2);
        const after = await measureCard(card);
        observations.measurements.push({ state, before, after });
        await unchanged(expected);
        return { card, after };
      };
      await wallet.step(
        `${prefix} genuine zero-balance network eligibility has one public account and no grants`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork(NETWORK, 'EVM');
          await wallet!.ensureOnHome();
          await expect(banner).toBeEnabled();
          await expect
            .poll(() => publicState(page))
            .toMatchObject({
              active: { id: 0, type: 'HDAccount' },
              slip44: 60,
              balance: '0.0',
              firstAccess: false,
              lifecycle: { status: 'idle', loading: false, switching: false },
            });
          baseline = await publicState(page);
          expect(baseline.savedActive).toEqual(baseline.active);
          expect(baseline.network).toMatchObject({
            kind: 'ethereum',
            chainId: 5700,
            label: NETWORK,
            url: RPC.slice(0, -1),
            apiUrl: API,
          });
          expect(baseline.liveAccounts).toHaveLength(1);
          expect(baseline.liveAccounts[0]).toMatchObject({
            kind: 'HDAccount',
            id: 0,
            address: owner,
          });
          expect(baseline.liveAccounts[0].label.length).toBeGreaterThan(0);
          expect(baseline.liveAccounts[0].label.length).toBeLessThan(24);
          expect(baseline.savedAccounts).toEqual(baseline.liveAccounts);
          expect(baseline.liveAssets).toEqual([
            { kind: 'HDAccount', id: 0, ethereum: [], syscoin: [], nfts: [] },
          ]);
          expect(baseline.savedAssets).toEqual(baseline.liveAssets);
          expect(baseline.grants).toEqual([]);
          expect(baseline.savedGrants).toEqual([]);
          observations.before = baseline;
          await page.setViewportSize(viewport);
        }
      );
      const shortLabel = baseline.liveAccounts[0].label;
      await wallet.step(
        `${prefix} healthy generated label is readable in the real Faucet request view`,
        async (capture) => {
          await banner.click();
          await expect(page).toHaveURL(/#\/faucet$/);
          const { after } = await observe('healthy', shortLabel, baseline);
          expect(after.cardExposed).toBe(true);
          for (const part of [after.label, after.address]) {
            expect(part).not.toBeNull();
            expect(
              part!.insideCard &&
                part!.exposed &&
                part!.collisions.length === 0 &&
                part!.hits.every((point) => point.reachesText),
              JSON.stringify(after)
            ).toBe(true);
          }
          await capture(page);
        }
      );
      await wallet.step(
        `${prefix} native Back and Space reopen healthy Faucet without requesting anything`,
        async () => {
          await tabTo(page, back);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await tabTo(page, banner);
          await page.keyboard.press('Space');
          await expect(page).toHaveURL(/#\/faucet$/);
          await expect(requestNow).toBeEnabled();
          await unchanged(baseline);
          await back.click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        }
      );
      await wallet.step(
        `${prefix} ordinary edit Back discards a draft and genuine Enter Save changes only the public label`,
        async () => {
          await openManager();
          const edit = () =>
            page.getByRole('button', {
              name: `${en.buttons.edit}: ${shortLabel} (${owner})`,
              exact: true,
            });
          await edit().click();
          await expect(page).toHaveURL(/#\/settings\/edit-account$/);
          const input = page.getByPlaceholder(en.settings.accountLabel, {
            exact: true,
          });
          await expect(input).toHaveValue(shortLabel);
          await input.fill('Unsaved family draft');
          await back.click();
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          await unchanged(baseline);
          await edit().click();
          await expect(input).toHaveValue(shortLabel);
          await input.fill(LABEL);
          await input.press('Enter');
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          const accounts = baseline.liveAccounts.map((account) => ({
            ...account,
            label: LABEL,
          }));
          renamed = {
            ...baseline,
            liveAccounts: accounts,
            savedAccounts: accounts,
          };
          await expect.poll(() => publicState(page)).toEqual(renamed);
          await expect(
            page.getByRole('button', {
              name: `${en.buttons.edit}: ${LABEL} (${owner})`,
              exact: true,
            })
          ).toHaveCount(1);
          observations.renamed = renamed;
          const savedNotice = page.getByText(
            en.settings.accountLabelEditedSuccessfully,
            { exact: true }
          );
          await expect(savedNotice).toBeVisible();
          await expect(savedNotice).toBeHidden();
          const headerClose = page.getByLabel(en.buttons.close, {
            exact: true,
          });
          await expect(headerClose).toHaveCount(1);
          await headerClose.click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged(renamed);
        }
      );
      let candidate!: Awaited<ReturnType<typeof measureCard>>;
      let renamedHomeEntry!: Awaited<ReturnType<typeof nativeHistoryEntry>>,
        renamedFaucetEntry!: Awaited<ReturnType<typeof nativeHistoryEntry>>;
      await wallet.step(
        `${prefix} real renamed Faucet card records glyphs border neighbors and clip bounds`,
        async (capture) => {
          await banner.click();
          await expect(page).toHaveURL(/#\/faucet$/);
          const observed = await observe('renamed', LABEL, renamed);
          candidate = observed.after;
          await capture(page);
        }
      );
      await wallet.step(
        `${prefix} native Back and Space preserve the renamed identity and leave Request Now idle`,
        async () => {
          await tabTo(page, back);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await tabTo(page, banner);
          renamedHomeEntry = await nativeHistoryEntry();
          observations.renamedHistory = { homeBeforeSpace: renamedHomeEntry };
          await page.keyboard.press('Space');
          await expect(page).toHaveURL(/#\/faucet$/);
          renamedFaucetEntry = await nativeHistoryEntry();
          observations.renamedHistory.faucetAfterReopen = renamedFaucetEntry;
          await expect(requestNow).toBeEnabled();
          await expect(cardFor(LABEL)).toHaveCount(1);
          await unchanged(renamed);
          expect(renamedHomeEntry.url).toMatch(/#\/home(?:\?.*)?$/);
          expect(renamedFaucetEntry.url).toMatch(/#\/faucet$/);
          for (const entry of [renamedHomeEntry, renamedFaucetEntry]) {
            expect(Number.isSafeInteger(entry.idx)).toBe(true);
            expect(entry.key).toEqual(expect.any(String));
            expect(entry.key).not.toBe('');
          }
          expect(renamedFaucetEntry.idx).toBe(renamedHomeEntry.idx! + 1);
          expect(renamedFaucetEntry.key).not.toBe(renamedHomeEntry.key);
        }
      );
      await wallet.step(
        `${prefix} ordinary wheels attempt text reveal without replacing label or scroll state`,
        async (capture) => {
          const card = cardFor(LABEL);
          for (const { deltaX, deltaY } of [
            { deltaX: 0, deltaY: 96 },
            { deltaX: 0, deltaY: -96 },
            { deltaX: 240, deltaY: 0 },
            { deltaX: -240, deltaY: 0 },
          ]) {
            await revealCard(page, card, observations.gestures);
            const geometry = await measureCard(card);
            const x = Math.max(
              geometry.clip.left + 4,
              Math.min(
                geometry.clip.right - 4,
                (geometry.card.left + geometry.card.right) / 2
              )
            );
            const y = Math.max(
              geometry.clip.top + 4,
              Math.min(
                geometry.clip.bottom - 4,
                (geometry.card.top + geometry.card.bottom) / 2
              )
            );
            const cardHit = await card.evaluate(
              (node, point) => {
                const hit = document.elementFromPoint(point.x, point.y);
                return !!hit && (hit === node || node.contains(hit));
              },
              { x, y }
            );
            expect(cardHit).toBe(true);
            await page.mouse.move(x, y);
            await page.mouse.wheel(deltaX, deltaY);
            let last = '',
              stable = 0;
            await expect
              .poll(async () => {
                const signature = await card.evaluate((node) => {
                  const positions: number[] = [];
                  for (
                    let parent: Element | null = node;
                    parent;
                    parent = parent.parentElement
                  )
                    positions.push(parent.scrollLeft, parent.scrollTop);
                  return JSON.stringify(positions);
                });
                stable = signature === last ? stable + 1 : 0;
                last = signature;
                return stable >= 2;
              })
              .toBe(true);
            await frame(page);
            observations.measurements.push({
              state: deltaY
                ? `renamed-vertical-${deltaY}`
                : `renamed-wheel-${deltaX}`,
              after: await measureCard(card),
            });
            observations.gestures.push({
              deltaX,
              deltaY,
              point: { x, y },
              cardHit,
            });
            if (deltaY)
              await wallet!.shot(
                `${prefix} renamed vertical-wheel-${deltaY} genuine Faucet identity`
              );
            await unchanged(renamed);
          }
          await page.mouse.move(2, 2);
          await settledLayout(page);
          const afterWheelsEntry = await nativeHistoryEntry();
          observations.renamedHistory.afterWheels = afterWheelsEntry;
          await unchanged(renamed);
          expect([renamedFaucetEntry, renamedHomeEntry]).toContainEqual(
            afterWheelsEntry
          );
          await capture(page);
        }
      );
      const contract = page
        .getByRole('heading', { name: en.send.smartContract, exact: true })
        .locator('xpath=following-sibling::p');
      observations.contractRevealGestures = [];
      await observeFaucetContractRecovery({
        wallet,
        page,
        prefix,
        banner,
        back,
        requestNow,
        contract,
        // Exact supported-network public constant; never injected into the UI.
        expectedContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
        unchanged: () => unchanged(renamed),
        historyEntry: nativeHistoryEntry,
        reveal: () =>
          revealCard(
            page,
            contract.locator('xpath=..'),
            observations.contractRevealGestures
          ),
        observations,
      });
      await wallet.step(
        `${prefix} public label-only scope worker runtime and finite physical fences complete before candidate`,
        async () => {
          await unchanged(renamed);
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerAfter = value;
            }
          );
          expect(denialCanaries).toHaveLength(2);
          expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
          expect(
            server.blocked.every(
              (method) => method === 'GET' || method === 'CONNECT'
            )
          ).toBe(true);
          expect(
            rpcReads.some(
              (call) =>
                call.method === 'eth_getBalance' &&
                String(call.params[0]).toLowerCase() === ownerLower
            )
          ).toBe(true);
          expect(
            observations.measurements.map((entry: any) => entry.state)
          ).toEqual([
            'healthy',
            'renamed',
            'renamed-vertical-96',
            'renamed-vertical--96',
            'renamed-wheel-240',
            'renamed-wheel--240',
          ]);
          expect(unsupported).toEqual([]);
          expect(forbidden).toEqual([]);
          expect(failedRequests).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await wallet.step(
        `${prefix} actual renamed label and public address remain readable inside the Faucet identity card`,
        async () => {
          expect(candidate.cardExposed, JSON.stringify(candidate)).toBe(true);
          expect(
            [candidate.label, candidate.address].every(
              (part) =>
                !!part &&
                part.insideCard &&
                part.exposed &&
                part.collisions.length === 0 &&
                part.hits.every((point) => point.reachesText)
            ),
            JSON.stringify(candidate)
          ).toBe(true);
        }
      );
      await wallet.step(
        `${prefix} full idle contract is painted inside its padded feedback card without collisions`,
        async () => {
          const initial = observations.contractRecovery.measurements.find(
            (entry: any) => entry.phase === 'initial'
          ).value;
          expect(initial.allGlyphsPainted, JSON.stringify(initial)).toBe(true);
          expect(initial.neighborCollisions).toEqual([]);
          expect(
            initial.glyphs.every(
              (glyph: any) =>
                glyph.left >=
                  initial.feedbackBox.left +
                    initial.feedbackPadding.left -
                    0.5 &&
                glyph.right <=
                  initial.feedbackBox.right -
                    initial.feedbackPadding.right +
                    0.5 &&
                glyph.bottom <=
                  initial.feedbackBox.bottom -
                    initial.feedbackPadding.bottom +
                    0.5
            ),
            JSON.stringify(initial)
          ).toBe(true);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('faucet-contract-native-recovery-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            runtime,
            sourceSha256,
            observations,
            httpReads,
            rpcReads,
            unsupported,
            forbidden,
            failedRequests,
            pageErrors,
            denialCanaries,
            proxyDeniedConnections: server.blocked.length,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            rendererLabelReplaced: false,
            focusOrScrollSetterUsed: false,
            faucetClaimsRequested: false,
            signingOrBroadcastRequested: false,
            tracesAndVideosDisabled: true,
          }),
        });
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
    }
  });
}
