import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { getAddress } from 'ethers';
import fs from 'fs';
import net from 'net';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { ellipsis } from '../../source/utils/format';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountFactoryInterface,
} from '../../source/utils/smartAccount/contracts';
import {
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  visualFixtureRead,
  VISUAL_FIXTURE_RPC,
  VISUAL_FIXTURE_ADDRESS,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

// Exercise real off-chain creation and native Edit/Back/Remove/Cancel actions.
// No removal confirmation, label Save, signing, deployment or broadcast is used.
// Keep only explicit sanitized step screenshots; disable automatic recordings.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const SMART_LABEL = 'Daily';
const MANAGE = '[data-navigation-scroll="settings-manage-accounts"]';

const publicSnapshot = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const saved = await chrome.storage.local.get([key, 'language']);
    const accounts = (value: any) =>
      Object.entries(value || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
            chainId: account.smartAccount?.chainId ?? null,
            accountIndex:
              account.smartAccount?.descriptor?.accountIndex ?? null,
          }))
        )
        .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    return {
      active: state.vault.activeAccount,
      savedActive: saved[key]?.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      language: saved.language || 'en',
      live: accounts(state.vault.accounts),
      saved: accounts(saved[key]?.accounts),
    };
  });

const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let index = 0; index < 48; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

// No scrollTop assignment, element.focus or scrollIntoView. Point real wheel
// gestures inside the actual list scroll owner and retain their deltas.
const revealRow = async (page: Page, row: Locator) => {
  const wheels: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const state = await row.evaluate((node) => {
      const rowBounds = node.getBoundingClientRect();
      const owner = node.closest('[data-navigation-scroll]')!;
      const clip = owner.getBoundingClientRect();
      return {
        row: rowBounds.toJSON(),
        clip: {
          left: Math.max(0, clip.left + owner.clientLeft),
          right: Math.min(
            innerWidth,
            clip.left + owner.clientLeft + owner.clientWidth
          ),
          top: Math.max(0, clip.top + owner.clientTop),
          bottom: Math.min(
            innerHeight,
            clip.top + owner.clientTop + owner.clientHeight
          ),
        },
      };
    });
    if (
      state.row.top >= state.clip.top &&
      state.row.bottom <= state.clip.bottom
    )
      break;
    const delta =
      state.row.top < state.clip.top
        ? Math.floor(state.row.top - state.clip.top - 2)
        : Math.ceil(state.row.bottom - state.clip.bottom + 2);
    await page.mouse.move(
      (state.clip.left + state.clip.right) / 2,
      (state.clip.top + state.clip.bottom) / 2
    );
    await page.mouse.wheel(0, delta);
    wheels.push(delta);
    await expect
      .poll(async () => {
        const after = await row.boundingBox();
        return delta > 0 ? after!.y < state.row.y : after!.y > state.row.y;
      })
      .toBe(true);
    await row.evaluate(
      (node) =>
        new Promise<void>((resolve, reject) => {
          let previous = node.getBoundingClientRect().y,
            stable = 0,
            frames = 0;
          const settle = () => {
            frames += 1;
            const current = node.getBoundingClientRect().y;
            stable = Math.abs(current - previous) < 0.5 ? stable + 1 : 0;
            previous = current;
            if (stable >= 2) resolve();
            else if (frames >= 120)
              reject(new Error('Manage Accounts wheel did not settle'));
            else requestAnimationFrame(settle);
          };
          requestAnimationFrame(settle);
        })
    );
  }
  await page.mouse.move(2, 2);
  return wheels;
};

const inspectRow = (row: Locator, label: string) =>
  row.evaluate((element, expectedLabel) => {
    const box = (node: Element) => node.getBoundingClientRect().toJSON();
    const identity = element.firstElementChild!;
    const nameGroup = identity.firstElementChild!;
    const icon = nameGroup.firstElementChild!;
    const text = nameGroup.querySelector('span.truncate')!;
    const badge = Array.from(identity.children).find(
      (node) =>
        node.tagName === 'SPAN' && node.classList.contains('rounded-full')
    )!;
    const activeCheck = identity.querySelector('img[alt="greenCheck"]');
    const checkBox = activeCheck?.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    const style = getComputedStyle(text);
    const textBox = text.getBoundingClientRect();
    const clip = {
      left: Math.max(0, textBox.left),
      right: Math.min(innerWidth, textBox.right),
      top: Math.max(0, textBox.top),
      bottom: Math.min(innerHeight, textBox.bottom),
    };
    for (let node = text.parentElement; node; node = node.parentElement) {
      const css = getComputedStyle(node),
        bounds = node.getBoundingClientRect();
      if (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          bounds.left + node.clientLeft + node.clientWidth
        );
      }
      if (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          bounds.top + node.clientTop + node.clientHeight
        );
      }
    }
    // Range coordinates include overflowed text even when CSS ellipsis hides it.
    // Measure that native font's ellipsis in a detached OffscreenCanvas; no DOM
    // content is created/replaced. Keep this model separate from pixel approval.
    const metrics = new OffscreenCanvas(1, 1).getContext('2d');
    if (!metrics) throw new Error('Native font metrics unavailable');
    metrics.font = style.font;
    const truncated = text.scrollWidth > text.clientWidth;
    const ellipsisWidth =
      truncated && style.textOverflow === 'ellipsis'
        ? metrics.measureText('…').width
        : 0;
    const contentRight = clip.right - ellipsisWidth;
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let current: Node | null;
    while ((current = walker.nextNode())) textNodes.push(current as Text);
    const fullText = textNodes.map((node) => node.data).join('');
    if (!fullText.startsWith(expectedLabel))
      throw new Error('Unexpected row identity text');
    const prefix = document.createRange();
    prefix.setStart(textNodes[0], 0);
    let remaining = expectedLabel.length;
    for (const node of textNodes) {
      if (remaining <= node.data.length) {
        prefix.setEnd(node, remaining);
        break;
      }
      remaining -= node.data.length;
    }
    const prefixBox = prefix.getBoundingClientRect();
    const hit = (button: Element) => {
      const bounds = button.getBoundingClientRect();
      return [
        [bounds.left + bounds.width / 4, bounds.top + bounds.height / 4],
        [bounds.right - bounds.width / 4, bounds.top + bounds.height / 4],
        [bounds.left + bounds.width / 4, bounds.bottom - bounds.height / 4],
        [bounds.right - bounds.width / 4, bounds.bottom - bounds.height / 4],
        [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      ].map(([x, y]) => {
        const target = document.elementFromPoint(x, y);
        return {
          x,
          y,
          withinTarget: Boolean(target && button.contains(target)),
        };
      });
    };
    const bounds = element.getBoundingClientRect();
    const owner = element.closest('[data-navigation-scroll]')!;
    const ownerBox = owner.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      row: box(element),
      identity: box(identity),
      icon: box(icon),
      badge: { text: badge.textContent, box: box(badge) },
      activeCheck:
        activeCheck && checkBox
          ? {
              box: checkBox.toJSON(),
              wrapper: box(activeCheck.parentElement!),
              badgeCenterY: (badgeBox.top + badgeBox.bottom) / 2,
              checkCenterY: (checkBox.top + checkBox.bottom) / 2,
              sharesBadgeRow:
                Math.abs(
                  (badgeBox.top +
                    badgeBox.bottom -
                    checkBox.top -
                    checkBox.bottom) /
                    2
                ) <= 1,
            }
          : null,
      label: {
        text: fullText,
        title: text.getAttribute('title'),
        box: box(text),
        prefix: expectedLabel,
        prefixBox: prefixBox.toJSON(),
        clip,
        scrollWidth: text.scrollWidth,
        clientWidth: text.clientWidth,
        direction: style.direction,
        font: style.font,
        textOverflow: style.textOverflow,
        ellipsisWidth,
        contentRight,
        prefixFitsNonEllipsisRegion:
          prefixBox.left >= clip.left - 1 &&
          prefixBox.right <= contentRight + 1 &&
          prefixBox.top >= clip.top - 1 &&
          prefixBox.bottom <= clip.bottom + 1,
      },
      buttons: Array.from(element.querySelectorAll('button')).map((button) => ({
        name: button.getAttribute('aria-label'),
        box: box(button),
        disabled: button.disabled,
        hits: hit(button),
      })),
      wholeRowExposed:
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= Math.max(0, ownerBox.top) &&
        bounds.bottom <=
          Math.min(
            innerHeight,
            ownerBox.top + owner.clientTop + owner.clientHeight
          ),
      scroll: {
        top: owner.scrollTop,
        clientHeight: owner.clientHeight,
        scrollHeight: owner.scrollHeight,
      },
    };
  }, label);

const publicHubSnapshot = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state']);
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
            metadata: account.smartAccount
              ? {
                  chainId: account.smartAccount.chainId,
                  isDeployed: account.smartAccount.isDeployed,
                  descriptor: {
                    accountIndex: account.smartAccount.descriptor?.accountIndex,
                    accountVersion:
                      account.smartAccount.descriptor?.accountVersion,
                    anchor: account.smartAccount.descriptor?.anchor,
                    anchorHash: account.smartAccount.descriptor?.anchorHash,
                    chainId: account.smartAccount.descriptor?.chainId,
                    deploymentSalt:
                      account.smartAccount.descriptor?.deploymentSalt,
                    factoryAddress:
                      account.smartAccount.descriptor?.factoryAddress,
                  },
                  deploymentSalt: account.smartAccount.deploymentSalt,
                  factoryAddress: account.smartAccount.factoryAddress,
                  auth: {
                    data: account.smartAccount.auth?.data,
                    module: account.smartAccount.auth?.module,
                    scheme: account.smartAccount.auth?.scheme,
                    validator: account.smartAccount.auth?.validator,
                  },
                  modules: (account.smartAccount.installedModules || []).map(
                    (m: any) => ({
                      id: m.id,
                      type: m.type,
                      address: m.address,
                      data: m.data,
                      owners: m.config?.owners,
                      threshold: m.config?.threshold,
                    })
                  ),
                }
              : null,
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
            families: Object.entries(families || {}).map(
              ([family, values]) => ({
                family,
                values: (values as any[]).map((asset) => ({
                  id: asset.id,
                  chainId: asset.chainId,
                  address: asset.contractAddress,
                  symbol: asset.tokenSymbol || asset.symbol,
                  balance: asset.balance,
                  decimals: asset.decimals,
                  standard: asset.tokenStandard,
                })),
              })
            ),
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    return {
      active: state.vault.activeAccount,
      savedActive: disk[key]?.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      slip44: state.vaultGlobal.activeSlip44,
      live: accounts(state.vault),
      saved: accounts(disk[key]),
      liveAssets: assets(state.vault),
      savedAssets: assets(disk[key]),
      grants: Object.keys(state.dapp?.dapps || {}).sort(),
      savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
    };
  });

// The method/parameter gate runs before the shared fixture's fulfill handler.
// The pure fixture then independently checks the canonical ABI and log result.
const allowsHubCarrierRpc = (
  call: any,
  fixture: ReturnType<typeof createVisualFixture>
) => {
  if (
    !call ||
    typeof call !== 'object' ||
    Array.isArray(call) ||
    call.jsonrpc !== '2.0' ||
    !Number.isSafeInteger(call.id) ||
    call.id < 0 ||
    typeof call.method !== 'string' ||
    !Array.isArray(call.params) ||
    Object.keys(call).some(
      (key) => !['id', 'jsonrpc', 'method', 'params'].includes(key)
    )
  )
    return false;
  const p = call.params;
  const lower = (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : '';
  const owners = [fixture.address, fixture.smartAccountAddress].map(lower);
  const code = [
    ...owners,
    ...fixture.infrastructure.map((c) => lower(c.address)),
    lower(PALI_CREATE2_DEPLOYER_ADDRESS),
    lower(PALI_MULTICALL3_CANONICAL_ADDRESS),
  ];
  const block = (value: unknown) =>
    typeof value === 'string' &&
    /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value) &&
    BigInt(value) <= BigInt(43);
  if (
    [
      'eth_chainId',
      'net_version',
      'eth_blockNumber',
      'eth_gasPrice',
      'eth_maxPriorityFeePerGas',
    ].includes(call.method)
  )
    return p.length === 0;
  if (['eth_getBalance', 'eth_getTransactionCount'].includes(call.method))
    return (
      p.length === 2 &&
      owners.includes(lower(p[0])) &&
      ['latest', 'pending'].includes(p[1])
    );
  if (call.method === 'eth_getCode')
    return p.length === 2 && code.includes(lower(p[0])) && p[1] === 'latest';
  if (call.method === 'eth_call') {
    const tx = p[0];
    const calls = [
      paliSmartAccountFactoryInterface.encodeFunctionData('implementation()'),
      paliSmartAccountFactoryInterface.encodeFunctionData(
        'getInitData(address,bytes)',
        [fixture.validator.address, fixture.authenticatorData]
      ),
      paliSmartAccountFactoryInterface.encodeFunctionData(
        'getAddress(bytes32,bytes)',
        [fixture.deploymentSalt, fixture.initCode]
      ),
    ].map(lower);
    return (
      p.length === 2 &&
      p[1] === 'latest' &&
      tx &&
      typeof tx === 'object' &&
      !Array.isArray(tx) &&
      Object.keys(tx).every((key) => ['to', 'data', 'from'].includes(key)) &&
      lower(tx.to) === lower(fixture.factory.address) &&
      calls.includes(lower(tx.data)) &&
      (tx.from === undefined || owners.includes(lower(tx.from)))
    );
  }
  if (
    ['eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(
      call.method
    )
  )
    return (
      p.length === 1 && fixture.transactions.some((row) => row.hash === p[0])
    );
  if (call.method === 'eth_getBlockByNumber')
    return (
      p.length === 2 &&
      ((p[1] === true && block(p[0])) ||
        (p[1] === false &&
          ['latest', 'pending', '0x2a', '0x2b'].includes(p[0])))
    );
  if (call.method === 'eth_getBlockByHash')
    return (
      p.length === 2 &&
      p[1] === false &&
      [fixture.transaction.blockHash, '0x' + '74'.repeat(32)].includes(p[0])
    );
  if (call.method === 'eth_getLogs') {
    const f = p[0];
    const topics = [
      paliEntryPointInterface.getEvent('UserOperationEvent')!.topicHash,
      null,
      '0x' + lower(fixture.smartAccountAddress).slice(2).padStart(64, '0'),
    ];
    return (
      p.length === 1 &&
      f &&
      typeof f === 'object' &&
      !Array.isArray(f) &&
      Object.keys(f).every((key) =>
        ['address', 'fromBlock', 'toBlock', 'topics'].includes(key)
      ) &&
      lower(f.address) ===
        lower(getPaliEntryPointAddress(VISUAL_FIXTURE_CHAIN_ID)) &&
      block(f.fromBlock) &&
      block(f.toBlock) &&
      BigInt(f.fromBlock) <= BigInt(f.toBlock) &&
      JSON.stringify(f.topics) === JSON.stringify(topics)
    );
  }
  return false;
};

async function installHubCarrierGate(
  context: PaliWallet['context'],
  fixture: ReturnType<typeof createVisualFixture>
) {
  const reads: any[] = [],
    denied: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== VISUAL_FIXTURE_RPC) return route.fallback();
    let payload: unknown;
    try {
      payload = request.postDataJSON();
    } catch {
      /* Rejected below. */
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    const reject = async (reason: string) => {
      denied.push(reason);
      await route.abort('blockedbyclient');
    };
    if (
      request.method() !== 'POST' ||
      url.pathname !== '/' ||
      url.search ||
      url.username ||
      url.password ||
      url.hash ||
      !calls.length ||
      !calls.every((call) => allowsHubCarrierRpc(call, fixture))
    )
      return reject('rpc-envelope-or-params');
    const reply = visualFixtureRead(
      fixture,
      request.url(),
      request.method(),
      payload
    );
    const responses = Array.isArray(reply?.body) ? reply.body : [reply?.body];
    if (
      !reply ||
      reply.unsupported?.length ||
      responses.some((item: any) => !item || item.error)
    )
      return reject('rpc-unsupported-or-error');
    reads.push(
      ...calls.map((call: any) => ({
        method: call.method,
        params: call.params,
      }))
    );
    return route.fallback();
  });
  return { reads, denied };
}

async function hubProxyDenial(
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) {
  const proxy = new URL(server.url),
    before = server.blocked.length;
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
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
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(error);
      }
    };
    socket.setTimeout(2000, () =>
      fail(new Error('Physical Hub proxy canary timed out'))
    );
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(
        `${method} ${
          method === 'GET'
            ? 'http://hub-disclosure-denied.invalid/'
            : 'hub-disclosure-denied.invalid:443'
        } HTTP/1.0\r\nHost: hub-disclosure-denied.invalid\r\nConnection: close\r\n\r\n`
      )
    );
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Physical canary response too large'));
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
        resolve({ connectionClosed: true, statusCode: 403 });
      } catch (error) {
        reject(error);
      }
    });
  });
  expect(server.blocked.slice(before)).toEqual([method]);
  return { method, ...result };
}

// Extraction only: the host must provide an already-qualified finite, physically
// fenced real-create carrier and freeze its full accepted public live/disk scope.
// This block adds no fixture route, controller request, state or DOM mutation.
async function inspectHubModuleAddressDisclosure({
  assertUnchanged,
  expectedSmartAddress,
  expectedValidator,
  page,
  reveal,
  tabTo: reachTarget,
  wallet,
}: {
  assertUnchanged: () => Promise<void>;
  expectedSmartAddress: string;
  expectedValidator: string;
  page: Page;
  reveal: (targetPage: Page, node: Locator) => Promise<number[]>;
  tabTo: (targetPage: Page, node: Locator) => Promise<void>;
  wallet: PaliWallet;
}) {
  const observations: any[] = [];
  const short = ellipsis(expectedValidator, 4, 4);
  const tooltip = () =>
    page.getByRole('tooltip').filter({ hasText: expectedValidator });
  const settledTooltip = async () => {
    await expect(tooltip()).toHaveCount(1);
    await expect(tooltip()).toBeVisible();
    await expect(tooltip()).toHaveText(expectedValidator);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .poll(() =>
        tooltip().evaluate((node) => {
          const box = node.closest('.tippy-box')!;
          const style = getComputedStyle(box);
          return (
            box.getAttribute('data-state') === 'visible' &&
            style.opacity === '1' &&
            (style.transform === 'none' ||
              style.transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
            box
              .getAnimations()
              .every((animation) =>
                ['finished', 'idle'].includes(animation.playState)
              )
          );
        })
      )
      .toBe(true);
    const geometry = await tooltip().evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = node.getBoundingClientRect();
      const textRects = Array.from(range.getClientRects(), (rect) =>
        rect.toJSON()
      );
      return {
        text: node.textContent,
        box: box.toJSON(),
        textRects,
        viewport: { width: innerWidth, height: innerHeight },
        allGlyphsInsideViewport: textRects.every(
          (rect) =>
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight
        ),
      };
    });
    expect(geometry.allGlyphsInsideViewport).toBe(true);
    return geometry;
  };
  const sections = [
    en.smartAccountHub.signInMethod,
    en.smartAccountHub.installedModules,
  ];
  const section = (heading: string) =>
    page
      .getByRole('heading', { name: heading, exact: true })
      .locator('xpath=ancestor::section[1]');
  const references = () =>
    sections.map((heading) =>
      section(heading).getByText(short, { exact: true }).locator('..')
    );
  const closeHub = async () => {
    const close = page.getByLabel(en.buttons.close, { exact: true });
    await expect(close).toHaveCount(1);
    await reachTarget(page, close);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
    await assertUnchanged();
  };
  for (const viewport of [
    { width: 400, height: 620 },
    { width: 320, height: 360 },
  ]) {
    const caseName = `hub-disclosure-${viewport.width}x${viewport.height}`;
    const result: any = { viewport, hover: [], keyboard: [] };
    observations.push(result);
    await wallet.step(
      caseName + ': open the genuine undeployed Hub',
      async () => {
        await page.setViewportSize(viewport);
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        const badge = page.locator('button#smart-account-hub-badge');
        await expect(badge).toBeEnabled();
        await badge.click();
        await expect(page).toHaveURL(/#\/home\/smart-account$/);
        await expect(
          page.getByText(en.smartAccountHub.notDeployed, { exact: true })
        ).toBeVisible();
        const identity = page
          .getByText(en.smartAccountHub.accountAddress, { exact: true })
          .locator('..');
        await expect(identity).toContainText(
          ellipsis(expectedSmartAddress, 7, 4)
        );
        for (const reference of references()) {
          await expect(reference).toHaveCount(1);
          await expect(reference).toHaveText(short);
          await expect(reference.locator('button, a')).toHaveCount(0);
        }
        await assertUnchanged();
      }
    );
    for (let index = 0; index < sections.length; index += 1) {
      await wallet.step(
        caseName + ': genuine full-address hover ' + sections[index],
        async (capture) => {
          const reference = references()[index];
          const wheels = await reveal(page, reference);
          const bounds = await reference.boundingBox();
          expect(bounds).not.toBeNull();
          await page.mouse.move(
            bounds!.x + bounds!.width / 2,
            bounds!.y + bounds!.height / 2
          );
          result.hover.push({
            section: sections[index],
            wheels,
            reference: bounds,
            tooltip: await settledTooltip(),
          });
          await assertUnchanged();
          await capture(page);
          await page.mouse.move(2, 2);
          await expect(tooltip()).toBeHidden();
        }
      );
    }
    await wallet.step(
      caseName +
        ': real keyboard disclosure cycle with healthy existing controls',
      async (capture) => {
        const identity = page
          .getByText(en.smartAccountHub.accountAddress, { exact: true })
          .locator('..');
        const copy = identity.getByRole('button', {
          name: en.buttons.copy,
          exact: true,
        });
        const manage = section(en.smartAccountHub.signInMethod).getByRole(
          'button',
          { name: en.smartAccountHub.manage, exact: true }
        );
        await reachTarget(page, copy);
        await expect(copy).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(manage).toBeFocused();
        for (const key of ['Tab', 'Shift+Tab']) {
          await reachTarget(page, manage);
          const seen = [false, false],
            focus: any[] = [],
            disclosures: any[] = [];
          let completed = false;
          for (let count = 0; count < 48; count += 1) {
            await page.keyboard.press(key);
            const matched = await Promise.all(
              references().map((reference) =>
                reference.evaluate((node) => node === document.activeElement)
              )
            );
            focus.push(
              await page.evaluate(() => ({
                tag: document.activeElement?.tagName,
                id: document.activeElement?.id,
                role: document.activeElement?.getAttribute('role'),
                label: document.activeElement?.getAttribute('aria-label'),
              }))
            );
            for (let index = 0; index < matched.length; index += 1) {
              if (!matched[index]) continue;
              seen[index] = true;
              const geometry = await settledTooltip();
              const described = await references()[index].evaluate((node) => {
                const id = node.getAttribute('aria-describedby');
                return id ? document.getElementById(id)?.textContent : null;
              });
              expect(described).toBe(expectedValidator);
              disclosures.push({
                section: sections[index],
                geometry,
                described,
              });
              await capture(page);
              await page.keyboard.press('Escape');
              await expect(tooltip()).toBeHidden();
              await expect(references()[index]).toBeFocused();
            }
            if (
              await manage.evaluate((node) => node === document.activeElement)
            ) {
              completed = true;
              break;
            }
          }
          result.keyboard.push({ key, seen, completed, focus, disclosures });
          expect(completed).toBe(true);
          await assertUnchanged();
        }
        await capture(page);
      }
    );
    await wallet.step(
      caseName + ': native Close and Smart badge reopening keep exact identity',
      async () => {
        await closeHub();
        const badge = page.locator('button#smart-account-hub-badge');
        await reachTarget(page, badge);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/home\/smart-account$/);
        await expect(
          page.getByText(en.smartAccountHub.notDeployed, { exact: true })
        ).toBeVisible();
        await assertUnchanged();
        await closeHub();
      }
    );
  }
  return observations;
}

for (const locale of [
  { code: 'en', copy: en },
  { code: 'fr', copy: fr },
] as const) {
  test(`managed Smart Account identity stays readable through ordinary actions in ${locale.code}`, async ({}, info) => {
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
    const sourceHash = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG },
      fixture = createVisualFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: VISUAL_FIXTURE_SEED,
      password: 'ManagedIdentitySynthetic!2026',
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
      | undefined;
    let strictGate:
      | Awaited<ReturnType<typeof installHubCarrierGate>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, any> = {
      runtime,
      sourceHash,
      locale: locale.code,
    };
    const forbidden: string[] = [],
      pageErrors: string[] = [];
    try {
      observations.physicalCanaries = [
        await hubProxyDenial(server, 'GET'),
        await hubProxyDenial(server, 'CONNECT'),
      ];
      wallet = await PaliWallet.launch(
        'managed-label-readability-' + locale.code,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installVisualFixtureRoutes(
        wallet.context,
        fixture,
        server.url
      );
      strictGate = await installHubCarrierGate(wallet.context, fixture);
      const page = wallet.page,
        copy = locale.copy;
      page.on('pageerror', (error) => pageErrors.push(error.message));
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
          /* Ordinary extension documents and fixture GETs have no RPC body. */
        }
      });
      const openMenu = async (translations: typeof en | typeof fr) => {
        await page
          .getByRole('button', {
            name: translations.generalMenu.generalOptions,
            exact: true,
          })
          .click();
      };
      await wallet.step(
        `${locale.code}: create one ordinary off-chain smart record behind the read-only fence`,
        async () => {
          observations.workerBefore = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerBefore = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('zkTanenbaum', 'EVM');
          await wallet!.ensureOnHome();
          await openMenu(en);
          await page
            .getByRole('menuitem', {
              name: en.accountMenu.createNewAccount,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/new$/);
          await page.locator('#account-name-input').fill(SMART_LABEL);
          const create = page.getByRole('button', {
            name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
          });
          await expect(create).toBeEnabled();
          await create.click();
          const dialog = page
            .getByRole('dialog')
            .filter({ hasText: en.settings.yourNewAccount });
          await expect(dialog).toBeVisible();
          await expect(
            dialog.getByText(fixture.smartAccountAddress, { exact: true })
          ).toBeVisible();
          await dialog.locator('#account-created-ok-btn').click();
          await expect(dialog).toHaveCount(0);
          await wallet!.ensureOnHome();
          await expect
            .poll(async () => (await publicSnapshot(page)).active)
            .toEqual({ id: 0, type: 'SmartAccount' });
          const createdSnapshot = await publicSnapshot(page);
          expect(createdSnapshot).toMatchObject({
            active: { id: 0, type: 'SmartAccount' },
            savedActive: { id: 0, type: 'SmartAccount' },
            slip44: 60,
            network: { kind: 'ethereum', chainId: VISUAL_FIXTURE_CHAIN_ID },
          });
          expect(createdSnapshot.live).toEqual(createdSnapshot.saved);
          observations.created = createdSnapshot;
          if (locale.code === 'en') {
            const hubBaseline = await publicHubSnapshot(page);
            expect(hubBaseline.live).toEqual(hubBaseline.saved);
            expect(hubBaseline.liveAssets).toEqual(hubBaseline.savedAssets);
            expect(hubBaseline.grants).toEqual([]);
            expect(hubBaseline.savedGrants).toEqual([]);
            expect(hubBaseline).toMatchObject({
              active: { id: 0, type: 'SmartAccount' },
              savedActive: { id: 0, type: 'SmartAccount' },
              slip44: 60,
              network: {
                kind: 'ethereum',
                chainId: VISUAL_FIXTURE_CHAIN_ID,
                url: VISUAL_FIXTURE_RPC,
              },
            });
            const smart = hubBaseline.live.find(
              (account) => account.kind === 'SmartAccount'
            )!;
            expect(smart.address).toBe(fixture.smartAccountAddress);
            expect(smart.metadata).toMatchObject({
              chainId: VISUAL_FIXTURE_CHAIN_ID,
              isDeployed: false,
              deploymentSalt: fixture.deploymentSalt,
              factoryAddress: fixture.factory.address,
              descriptor: { accountIndex: 0, chainId: VISUAL_FIXTURE_CHAIN_ID },
              auth: {
                module: 'ecdsa',
                validator: fixture.validator.address,
                data: fixture.authenticatorData,
              },
            });
            expect(smart.metadata!.modules).toEqual([
              {
                id: 'ecdsa',
                type: 'validator',
                address: getAddress(fixture.validator.address),
                data: fixture.authenticatorData,
                owners: [fixture.address],
                threshold: 1,
              },
            ]);
            observations.hubBaseline = hubBaseline;
            observations.hubDisclosure =
              await inspectHubModuleAddressDisclosure({
                assertUnchanged: async () =>
                  expect(await publicHubSnapshot(page)).toEqual(hubBaseline),
                expectedSmartAddress: fixture.smartAccountAddress,
                expectedValidator: getAddress(fixture.validator.address),
                page,
                reveal: revealRow,
                tabTo,
                wallet: wallet!,
              });
            expect(await publicHubSnapshot(page)).toEqual(hubBaseline);
          }
          await openMenu(en);
          await page
            .locator('#account-HDAccount-0')
            .getByRole('menuitem')
            .first()
            .click();
          await expect
            .poll(async () => (await publicSnapshot(page)).active)
            .toEqual({ id: 0, type: 'HDAccount' });
          await wallet!.ensureOnHome();
          // Ordinary setAccount(sync=false) changes session selection only.
          // Creation durably selected Smart0; require that disk baseline to
          // remain intact instead of forcing an unrelated persistence action.
          const selectedSnapshot = await publicSnapshot(page);
          expect(selectedSnapshot).toEqual({
            ...createdSnapshot,
            active: { id: 0, type: 'HDAccount' },
          });
          observations.afterSessionSelection = selectedSnapshot;
        }
      );
      if (locale.code === 'fr') {
        await wallet.step(
          'fr: choose and persist French through the actual Languages form',
          async () => {
            const before = await publicSnapshot(page);
            await openMenu(en);
            await page
              .getByRole('menuitem', {
                name: en.generalMenu.languages,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/settings\/languages$/);
            await page
              .getByRole('button', {
                name: en.settings.setYourPreferredLanguage,
                exact: true,
              })
              .click();
            await page
              .getByRole('menuitem', { name: 'French Français', exact: true })
              .click();
            await page
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(
              page.getByText(fr.settings.languageWasSet, { exact: true })
            ).toBeVisible();
            await expect
              .poll(async () => (await publicSnapshot(page)).language)
              .toBe('fr');
            await page.keyboard.press('Escape');
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            expect(await publicSnapshot(page)).toEqual({
              ...before,
              language: 'fr',
            });
          }
        );
      }
      const baseline = await publicSnapshot(page);
      expect(baseline).toMatchObject({
        active: { id: 0, type: 'HDAccount' },
        savedActive: observations.created.savedActive,
        slip44: 60,
        network: { kind: 'ethereum', chainId: VISUAL_FIXTURE_CHAIN_ID },
        language: locale.code,
      });
      expect(baseline.live).toEqual(baseline.saved);
      expect(baseline.live).toHaveLength(2);
      const hd = baseline.live.find((account) => account.kind === 'HDAccount')!;
      const smart = baseline.live.find(
        (account) => account.kind === 'SmartAccount'
      )!;
      expect(hd).toMatchObject({ id: 0, address: VISUAL_FIXTURE_ADDRESS });
      expect(smart).toEqual({
        kind: 'SmartAccount',
        id: 0,
        label: SMART_LABEL,
        address: fixture.smartAccountAddress,
        chainId: VISUAL_FIXTURE_CHAIN_ID,
        accountIndex: 0,
      });
      observations.baseline = baseline;
      const unchanged = async () =>
        expect(await publicSnapshot(page)).toEqual(baseline);
      const actionName = (action: string, account: typeof smart) =>
        `${action}: ${account.label} (${account.address})`;
      const rowFor = (account: typeof smart) =>
        page
          .locator(MANAGE)
          .locator('li')
          .filter({
            has: page.getByRole('button', {
              name: actionName(copy.buttons.edit, account),
              exact: true,
            }),
          });
      const sizes: any[] = [];
      observations.sizes = sizes;
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        const caseName = `${locale.code}-${viewport.width}x${viewport.height}`;
        await wallet.step(
          `${caseName}: inspect real managed HD and Smart Account rows`,
          async (capture) => {
            await page.setViewportSize(viewport);
            if (!/#\/settings\/manage-accounts$/.test(page.url())) {
              await wallet!.ensureOnHome();
              await openMenu(copy);
              await page
                .getByRole('menuitem', {
                  name: copy.accountMenu.manageAccounts,
                  exact: true,
                })
                .click();
            }
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await expect(page.locator(MANAGE).locator('li')).toHaveCount(2);
            const hdWheels = await revealRow(page, rowFor(hd));
            const hdLayout = await inspectRow(rowFor(hd), hd.label);
            const smartWheels = await revealRow(page, rowFor(smart));
            const smartLayout = await inspectRow(rowFor(smart), smart.label);
            sizes.push({
              viewport,
              hdWheels,
              smartWheels,
              hd: hdLayout,
              smart: smartLayout,
            });
            expect(hdLayout.badge.text).toBe('Pali');
            expect(smartLayout.badge.text).toBe(copy.receive.smartAccount);
            expect(hdLayout.wholeRowExposed).toBe(true);
            expect(smartLayout.wholeRowExposed).toBe(true);
            expect(hdLayout.buttons).toHaveLength(1);
            expect(smartLayout.buttons).toHaveLength(2);
            expect(
              smartLayout.buttons.every(
                (button) =>
                  !button.disabled &&
                  button.hits.every((hit) => hit.withinTarget)
              )
            ).toBe(true);
            await unchanged();
            await capture(page);
          }
        );
        await wallet.step(
          `${caseName}: native Edit and actual header Back retain the precise Smart Account`,
          async (capture) => {
            const edit = rowFor(smart).getByRole('button', {
              name: actionName(copy.buttons.edit, smart),
              exact: true,
            });
            await tabTo(page, edit);
            await expect(edit).toBeFocused();
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/settings\/edit-account$/);
            await expect(
              page.getByPlaceholder(copy.settings.accountLabel, { exact: true })
            ).toHaveValue(SMART_LABEL);
            expect(
              await page.evaluate(() => ({
                id: history.state?.usr?.id,
                type: history.state?.usr?.accountType,
              }))
            ).toEqual({ id: 0, type: 'SmartAccount' });
            await unchanged();
            await capture(page);
            const back = page.getByRole('button', {
              name: copy.buttons.back,
              exact: true,
            });
            await tabTo(page, back);
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await unchanged();
          }
        );
        await wallet.step(
          `${caseName}: native Remove opens the exact public identity and Cancel keeps both records`,
          async (capture) => {
            const remove = rowFor(smart).getByRole('button', {
              name: actionName(copy.buttons.remove, smart),
              exact: true,
            });
            await tabTo(page, remove);
            await expect(remove).toBeFocused();
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog');
            await expect(dialog).toHaveCount(1);
            await expect(dialog).toContainText(SMART_LABEL);
            await expect(dialog).toContainText(smart.address);
            await unchanged();
            await capture(page);
            const cancel = dialog.getByRole('button', {
              name: copy.buttons.cancel,
              exact: true,
            });
            await tabTo(page, cancel);
            await page.keyboard.press('Enter');
            await expect(dialog).toHaveCount(0);
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await unchanged();
          }
        );
      }
      observations.sizes = sizes;
      const activeSizes: any[] = [];
      observations.activeSizes = activeSizes;
      const activeBaseline = {
        ...baseline,
        active: { id: smart.id, type: smart.kind },
      };
      const closeManagedAccounts = async () => {
        const close = page
          .locator('[data-page-action-footer]')
          .getByRole('button', {
            name: copy.buttons.close,
            exact: true,
          });
        await tabTo(page, close);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      };
      const chooseExistingAccount = async (account: typeof smart) => {
        await wallet!.ensureOnHome();
        await openMenu(copy);
        await page
          .locator('#account-' + account.kind + '-' + account.id)
          .getByRole('menuitem')
          .first()
          .click();
        await expect
          .poll(async () => (await publicSnapshot(page)).active)
          .toEqual({ id: account.id, type: account.kind });
        await wallet!.ensureOnHome();
      };
      await wallet.step(
        locale.code +
          ': select the existing Smart Account through its actual account-menu row',
        async () => {
          await unchanged();
          await closeManagedAccounts();
          await unchanged();
          await chooseExistingAccount(smart);
          // This ordinary account-menu selection changes only live session
          // identity. The previously observed durable Smart0 stays unchanged.
          expect(await publicSnapshot(page)).toEqual(activeBaseline);
        }
      );
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 320, height: 360 },
      ]) {
        const caseName =
          locale.code + '-active-' + viewport.width + 'x' + viewport.height;
        await wallet.step(
          caseName +
            ': inspect the selected Smart label badge and same-row active check',
          async (capture) => {
            await page.setViewportSize(viewport);
            if (!/#\/settings\/manage-accounts$/.test(page.url())) {
              await openMenu(copy);
              await page
                .getByRole('menuitem', {
                  name: copy.accountMenu.manageAccounts,
                  exact: true,
                })
                .click();
            }
            await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
            await expect(page.locator(MANAGE).locator('li')).toHaveCount(2);
            const wheels = await revealRow(page, rowFor(smart));
            const layout = await inspectRow(rowFor(smart), smart.label);
            activeSizes.push({ viewport, wheels, smart: layout });
            expect(layout.wholeRowExposed).toBe(true);
            expect(layout.badge.text).toBe(copy.receive.smartAccount);
            expect(layout.activeCheck).not.toBeNull();
            expect(layout.activeCheck!.sharesBadgeRow).toBe(true);
            expect(layout.buttons).toHaveLength(1);
            const edit = rowFor(smart).getByRole('button', {
              name: actionName(copy.buttons.edit, smart),
              exact: true,
            });
            await expect(edit).toBeEnabled();
            await expect(
              rowFor(smart).getByRole('button', {
                name: actionName(copy.buttons.remove, smart),
                exact: true,
              })
            ).toHaveCount(0);
            expect(
              layout.buttons.every(
                (button) =>
                  button.box.width >= 44 &&
                  button.box.height >= 44 &&
                  !button.disabled &&
                  button.hits.every((point) => point.withinTarget)
              )
            ).toBe(true);
            expect(await publicSnapshot(page)).toEqual(activeBaseline);
            await capture(page);
          }
        );
      }
      await wallet.step(
        locale.code +
          ': select the HD anchor normally and restore the exact earlier session and disk baseline',
        async () => {
          expect(await publicSnapshot(page)).toEqual(activeBaseline);
          await closeManagedAccounts();
          expect(await publicSnapshot(page)).toEqual(activeBaseline);
          await chooseExistingAccount(hd);
          await unchanged();
          await openMenu(copy);
          await page
            .getByRole('menuitem', {
              name: copy.accountMenu.manageAccounts,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          await unchanged();
        }
      );
      await wallet.step(
        `${locale.code}: ordinary Close then popup reload commits session selection without changing account records`,
        async () => {
          const close = page
            .locator('[data-page-action-footer]')
            .getByRole('button', { name: copy.buttons.close, exact: true });
          await tabTo(page, close);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged();
          // Reload disconnects MainApp's real popup-connection port. Its normal
          // onDisconnect emergency save commits the existing live HD selection.
          // Bind exactly that transition; every record/context field stays equal.
          const expectedAfterReload = {
            ...baseline,
            savedActive: baseline.active,
          };
          observations.expectedAfterPopupDisconnect = expectedAfterReload;
          await page.reload();
          await wallet!.waitAppReady();
          await wallet!.ensureOnHome();
          await expect
            .poll(() => publicSnapshot(page))
            .toEqual(expectedAfterReload);
          observations.afterReload = await publicSnapshot(page);
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerAfter = value;
            }
          );
          expect(routes!.deniedWrites).toEqual([]);
          expect(
            routes!.deniedUnknown.filter((read) => read.startsWith('rpc:'))
          ).toEqual([]);
          expect(forbidden).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(strictGate!.denied).toEqual([]);
          // Bind each physical canary exactly at launch, then retain and
          // reject unexpected proxy methods without mistaking additional
          // refused background GET/CONNECT traffic for forwarded reads.
          expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
          expect(
            server.blocked.every(
              (method) => method === 'GET' || method === 'CONNECT'
            )
          ).toBe(true);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
        }
      );
      await wallet.step(
        `${locale.code}: short ordinary account labels fit their actual non-ellipsis text region`,
        async () => {
          // All real Edit/Back/Remove/Cancel/persistence/fence controls run first.
          // These hard label-fit assertions complement the genuine UI screenshots.
          for (const value of sizes) {
            expect(
              value.hd.label.prefixFitsNonEllipsisRegion,
              `HD control at${value.viewport.width}`
            ).toBe(true);
            expect(
              value.smart.label.prefixFitsNonEllipsisRegion,
              `Smart Daily at${value.viewport.width}`
            ).toBe(true);
          }
          for (const value of activeSizes) {
            expect(
              value.smart.label.prefixFitsNonEllipsisRegion,
              `Active Smart Daily at${value.viewport.width}`
            ).toBe(true);
          }
        }
      );
      await wallet.step(
        `${locale.code}: Hub module addresses disclose their full value through native forward and reverse focus`,
        async () => {
          // Keep this gate after every original action, persistence, worker,
          // label-fit and network-fence control, including on the before build.
          if (locale.code !== 'en') return;
          expect(observations.hubDisclosure).toHaveLength(2);
          for (const viewport of observations.hubDisclosure) {
            expect(viewport.hover).toHaveLength(2);
            expect(viewport.keyboard).toHaveLength(2);
            for (const cycle of viewport.keyboard) {
              expect(cycle.completed).toBe(true);
              expect(cycle.seen).toEqual([true, true]);
              expect(cycle.disclosures).toHaveLength(2);
            }
          }
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('managed-account-label-readability-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            forbidden,
            pageErrors,
            strictRpc: strictGate,
            reads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            deniedUnknown: routes?.deniedUnknown || [],
            proxyDeniedConnections: server.blocked.length,
            proxyDeniedMethods: [...server.blocked],
            controllerStateReplaced: false,
            controllerRepliesReplaced: false,
            runtimeTransportReplaced: false,
            DOMOrScrollOrFocusInjected: false,
            signingDeploymentOrBroadcastRequested: false,
            removalConfirmed: false,
            labelSaveActivated: false,
            localSmartAccountCreation: true,
            languageChangedThroughRealForm: locale.code === 'fr',
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
