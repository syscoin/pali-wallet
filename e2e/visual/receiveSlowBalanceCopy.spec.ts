import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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

// Real-UI regression for slow-status paint clearance and native Receive Copy.
// Real Advanced Save, Home Refresh, Home Receive, native Tab/Enter and Back.
// Only the exact owned balance HTTP read is held; release falls through to the
// existing synthetic fixture. No app state/reply/DOM/clock/focus is replaced.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RPC = 'https://rpc.tanenbaum.io/';
const PROVIDER_READ_CACHE_MS = 250;
const COPY_SUCCESS_DEDUP_MS = 2000;
const SLOW_OVERLAY_MS = 2000;
const slowMessage = en.networkConnection.operationSlow.replace(
  '{{operation}}',
  en.networkConnection.updatingBalances
);
const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return `${url.origin}${url.pathname}${query.size ? `?${query}` : ''}`;
};
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get(['state', key]);
    const account = (vault: any) => {
      const ref = vault?.activeAccount;
      const value = ref && vault?.accounts?.[ref.type]?.[ref.id];
      return ref && value
        ? { id: ref.id, type: ref.type, address: value.address }
        : null;
    };
    const network = (value: any) => ({
      kind: value.kind,
      chainId: value.chainId,
      slip44: value.slip44,
      url: value.url,
    });
    return {
      identity: {
        account: account(state.vault),
        savedAccount: account(disk[key]),
        network: network(state.vault.activeNetwork),
        savedNetwork: network(disk[key].activeNetwork),
        slip44: state.vaultGlobal.activeSlip44,
        grants: Object.keys(state.dapp?.dapps || {}).sort(),
        savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
        refresh: state.vaultGlobal.advancedSettings.refresh,
        savedRefresh: disk.state?.vaultGlobal?.advancedSettings?.refresh,
      },
      readiness: {
        networkStatus: state.vaultGlobal.networkStatus,
        switchingAccount: state.vaultGlobal.isSwitchingAccount,
        postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
        polling: state.vaultGlobal.isPollingUpdate,
        loadingBalances: state.vaultGlobal.loadingStates.isLoadingBalances,
      },
    };
  });
const focusWithKeyboard = async (page: Page, target: Locator) => {
  for (let count = 0; count < 40; count++) {
    if (await target.evaluate((element) => element === document.activeElement))
      break;
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
// Same native wheel/settled scroll-owner approach as the qualified Receive
// context proof. Read-only measurements never assign layout or scroll state.
const reveal = async (page: Page, target: Locator) => {
  const gestures: unknown[] = [];
  const port = page.locator('[data-navigation-scroll="wallet-layout"]');
  await expect(port).toHaveCount(1);
  for (let count = 0; count < 4; count++) {
    const bounds = (await target.boundingBox())!;
    expect(bounds).not.toBeNull();
    const viewport = page.viewportSize()!;
    if (bounds.y >= 16 && bounds.y + bounds.height <= viewport.height - 16)
      break;
    const delta =
      bounds.y < 16
        ? Math.floor(bounds.y - 16)
        : Math.ceil(bounds.y + bounds.height - (viewport.height - 16));
    const before = await port.evaluate((element) => ({
      top: element.scrollTop,
      max: element.scrollHeight - element.clientHeight,
    }));
    const expected = Math.max(0, Math.min(before.max, before.top + delta));
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, delta);
    await expect
      .poll(async () =>
        Math.abs((await port.evaluate((node) => node.scrollTop)) - expected)
      )
      .toBeLessThanOrEqual(1);
    await frame(page);
    gestures.push({ delta, before, expected });
  }
  await page.mouse.move(2, 2);
  await frame(page);
  const bounds = (await target.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width
  );
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    page.viewportSize()!.height
  );
  return { gestures, bounds };
};
const qrPaths = (address: string) =>
  Array.from(
    renderToStaticMarkup(
      React.createElement(QRCodeSVG, { value: address })
    ).matchAll(/\bd="([^"]+)"/g),
    (match) => match[1]
  );
const observeClipboard = () => {
  if ((window as any).__receiveSlowClipboardObserved) return;
  const write = navigator.clipboard.writeText.bind(navigator.clipboard);
  (window as any).__receiveSlowCopies = [];
  (window as any).__receiveSlowClipboardObserved = true;
  navigator.clipboard.writeText = async (value) => {
    await write(value);
    (window as any).__receiveSlowCopies.push(value);
  };
};
const copyPaint = (copy: Locator) =>
  copy.evaluate((element) => {
    const label = element.querySelector('span')!;
    const range = document.createRange();
    range.selectNodeContents(label);
    const glyphs = Array.from(range.getClientRects()).map((box) =>
      box.toJSON()
    );
    const statuses = Array.from(document.querySelectorAll('[role="status"]'));
    const banners = statuses.map((node) => ({
      text: node.textContent,
      box: node.getBoundingClientRect().toJSON(),
      position: getComputedStyle(node).position,
      pointerEvents: getComputedStyle(node).pointerEvents,
      zIndex: getComputedStyle(node).zIndex,
    }));
    const overlaps = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
      Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    const blocker = banners.find((banner) =>
      glyphs.some((glyph) => overlaps(glyph, banner.box))
    );
    const bounds = element.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      button: bounds.toJSON(),
      labelText: label.textContent,
      glyphs,
      banners,
      glyphClearOfStatus: !blocker,
      overlappingStatus: blocker || null,
      focused: element === document.activeElement,
      hitPoints: [0.25, 0.5, 0.75].map((fraction) => {
        const target = document.elementFromPoint(
          bounds.left + bounds.width * fraction,
          bounds.top + bounds.height / 2
        );
        return Boolean(target && element.contains(target));
      }),
    };
  });

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`Receive Copy stays visible during an ordinary slow balance refresh at ${viewport.width}x${viewport.height}`, async ({}, info) => {
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
    const owner = fixture.evmAddresses[0];
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
    const inventory = {
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
    const auxiliary = new Map<string, unknown>();
    for (const url of [
      'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
      'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
      'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
      'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
    ])
      auxiliary.set(url, []);
    auxiliary.set(
      'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
      { blacklist: [], whitelist: [], fuzzylist: [] }
    );
    const addRead = (url: string, body: unknown) =>
      auxiliary.set(requestKey(new URL(url)), body);
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addRead(origin + '/api/v2/tickers/currency', {
        ts: 1,
        rates: { usd: 1 },
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
        inventory
      );
    addRead('https://api.coingecko.com/api/v3/asset_platforms', []);
    addRead(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      {
        // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
        syscoin: { usd: 1, usd_24h_change: 0 },
      }
    );
    for (const action of ['tokenlist', 'txlist', 'pendingtxlist', 'tokentx']) {
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
      password: 'ReceiveSlowSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase = 'setup',
      hold = false,
      lastCopySuccessAt: number | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const balanceReads: Array<{
      at: number;
      completedAt?: number;
      held: boolean;
      params: unknown[];
      phase: string;
    }> = [];
    const rpcReads: Array<{ method: string; params: unknown[] }> = [];
    const forbidden: string[] = [],
      pageErrors: string[] = [],
      httpFailures: string[] = [];
    const observations: Record<string, any> = {
      runtime,
      sourceSha256,
      viewport,
    };
    try {
      wallet = await PaliWallet.launch(
        `receive-slow-balance-copy-${viewport.width}x${viewport.height}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      const page = wallet.page;
      await wallet.context.addInitScript(observeClipboard);
      await page.evaluate(observeClipboard);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          httpFailures.push(request.method() + ' ' + request.url());
      });
      wallet.context.on('request', (request) => {
        if (/\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname))
          forbidden.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbidden.push(call.method);
        } catch {
          /* Ordinary GET. */
        }
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
      // Exact RPC boundary from the qualified same-label Receive fixture, now
      // for the existing 5700 network. Unknown methods/targets fail closed.
      await wallet.context.route(RPC, async (route) => {
        let payload: any;
        try {
          payload = route.request().postDataJSON();
        } catch {
          forbidden.push('malformed RPC JSON');
          return route.abort('blockedbyclient');
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        const ownRead = (params: any[]) =>
          params.length === 2 &&
          typeof params[0] === 'string' &&
          params[0].toLowerCase() === owner.toLowerCase() &&
          ['latest', 'pending'].includes(params[1]);
        const allowed = (call: any) => {
          if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return false;
          const p = call.params;
          switch (call.method) {
            case 'eth_chainId':
            case 'net_version':
            case 'eth_blockNumber':
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              return p.length === 0;
            case 'eth_getBalance':
            case 'eth_getTransactionCount':
            case 'eth_getCode':
              return ownRead(p);
            case 'eth_getBlockByNumber':
              return (
                p.length === 2 &&
                ['latest', '0x0', '0x1'].includes(p[0]) &&
                (p[1] === false ||
                  (p[1] === true && ['0x0', '0x1'].includes(p[0])))
              );
            default:
              return false;
          }
        };
        if (
          route.request().method() !== 'POST' ||
          !calls.length ||
          calls.some((call) => !allowed(call))
        ) {
          forbidden.push(
            'unexpected RPC: ' + calls.map((call) => call?.method).join(',')
          );
          return route.abort('blockedbyclient');
        }
        rpcReads.push(
          ...calls.map((call) => ({ method: call.method, params: call.params }))
        );
        const balances = calls.filter(
          (call) => call.method === 'eth_getBalance'
        );
        if (balances.length) {
          // A mixed batch is not silently broadened into this latency fixture.
          if (
            balances.length !== calls.length ||
            balances.some((call) => call.params[1] !== 'latest')
          ) {
            forbidden.push('unexpected balance batch');
            return route.abort('blockedbyclient');
          }
          const rows = balances.map(
            (call) =>
              ({
                phase,
                at: Date.now(),
                held: hold,
                params: call.params,
              } as (typeof balanceReads)[number])
          );
          balanceReads.push(...rows);
          if (hold) await gate;
          // Reply/data production remains the unchanged inherited fixture.
          await route.fallback();
          rows.forEach((row) => {
            row.completedAt = Date.now();
          });
          return;
        }
        return route.fallback();
      });
      const step: PaliWallet['step'] = (name, action) =>
        wallet!.step(`${viewport.width}x${viewport.height}: ${name}`, action);
      const refresh = page.getByRole('button', {
        name: en.header.refresh,
        exact: true,
      });
      const slow = page.getByRole('status').filter({ hasText: slowMessage });
      const assertIdentity = async () => {
        const current = await publicState(page);
        expect(current.identity).toEqual(observations.baseline.identity);
        expect(current.readiness.networkStatus).toBe('idle');
        expect(current.readiness.switchingAccount).toBe(false);
        expect(current.readiness.postLoading).toBe(false);
        return current;
      };
      const enterReceive = async () => {
        await expect(page).toHaveURL(/#\/home$/);
        const receive = page.locator('#receive-btn');
        const homeReveal = await reveal(page, receive);
        await receive.click();
        await expect(page).toHaveURL(/#\/receive$/);
        await expect(page.locator('#qr-code + div p')).toHaveText(owner);
        const actual = await page
          .locator('#qr-code svg path')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('d'))
          );
        expect(actual).toEqual(qrPaths(owner));
        const copy = page.locator('#copy-address-receive-btn button');
        await expect(copy).toBeEnabled();
        await focusWithKeyboard(page, copy);
        const copyReveal = await reveal(page, copy);
        await expect(copy).toBeFocused();
        return { homeReveal, copyReveal, copy };
      };
      const copyNative = async (copy: Locator) => {
        if (lastCopySuccessAt !== undefined) {
          const preceding = lastCopySuccessAt;
          await expect
            .poll(() => Date.now() - preceding)
            .toBeGreaterThanOrEqual(COPY_SUCCESS_DEDUP_MS);
        }
        const before = await page.evaluate(
          () => (window as any).__receiveSlowCopies as string[]
        );
        await expect(copy).toBeFocused();
        await page.keyboard.press('Enter');
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).__receiveSlowCopies as string[])
          )
          .toEqual([...before, owner]);
        await expect(
          page.getByText(en.home.addressCopied, { exact: true })
        ).toBeVisible();
        lastCopySuccessAt = Date.now();
        await expect(
          page.getByText(en.transactions.copyFailed, { exact: true })
        ).toHaveCount(0);
        return {
          before,
          after: [...before, owner],
          successObservedAt: lastCopySuccessAt,
        };
      };
      const backHome = async () => {
        const before = (await publicState(page)).identity;
        const back = page.getByRole('button', {
          name: en.buttons.back,
          exact: true,
        });
        await focusWithKeyboard(page, back);
        await reveal(page, back);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/home$/);
        expect((await publicState(page)).identity).toEqual(before);
        await expect(
          page.getByText(en.home.addressCopied, { exact: true })
        ).toHaveCount(0);
      };
      await step(
        'enable Refresh through ordinary Advanced confirmation and Save on UTXO',
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
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: en.generalMenu.advanced,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/advanced$/);
          await page.locator('#advanced-refresh').click();
          await page.getByRole('dialog').locator('#confirm-btn').click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(
            page.getByText(en.settings.advancedSettingsWasSet, { exact: true })
          ).toBeVisible();
          await page
            .getByRole('dialog')
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          await expect(refresh).toBeEnabled();
          await expect
            .poll(async () => (await publicState(page)).readiness)
            .toEqual({
              networkStatus: 'idle',
              switchingAccount: false,
              postLoading: false,
              polling: false,
              loadingBalances: false,
            });
          observations.baseline = await publicState(page);
          expect(observations.baseline.identity.account).toEqual({
            id: 0,
            type: 'HDAccount',
            address: owner,
          });
          expect(observations.baseline.identity.savedAccount).toEqual(
            observations.baseline.identity.account
          );
          expect(observations.baseline.identity.network).toEqual({
            kind: 'ethereum',
            chainId: 5700,
            slip44: 60,
            url: 'https://rpc.tanenbaum.io',
          });
          expect(observations.baseline.identity.savedNetwork).toEqual(
            observations.baseline.identity.network
          );
          expect(observations.baseline.identity.grants).toEqual([]);
          expect(observations.baseline.identity.savedGrants).toEqual([]);
          expect(observations.baseline.identity.refresh).toBe(true);
          expect(observations.baseline.identity.savedRefresh).toBe(true);
          await page.setViewportSize(viewport);
        }
      );
      await step(
        'healthy settled Receive has the exact QR and fully exposed native Copy',
        async (capture) => {
          phase = 'healthy';
          const controls = await enterReceive();
          await expect(page.getByRole('status')).toHaveCount(0);
          observations.healthy = {
            ...controls,
            copy: undefined,
            paint: await copyPaint(controls.copy),
            state: await assertIdentity(),
          };
          expect(observations.healthy.paint.glyphClearOfStatus).toBe(true);
          expect(observations.healthy.paint.labelText).toBe(en.buttons.copy);
          expect(observations.healthy.paint.glyphs.length).toBeGreaterThan(0);
          expect(
            observations.healthy.paint.glyphs.every(
              (glyph) => glyph.width > 0 && glyph.height > 0
            )
          ).toBe(true);
          expect(observations.healthy.paint.hitPoints).toEqual([
            true,
            true,
            true,
          ]);
          await capture(page);
          observations.healthy.native = await copyNative(controls.copy);
          await assertIdentity();
        }
      );
      await step(
        'actual Back retains account and network before the held operation',
        async () => {
          await backHome();
          await assertIdentity();
        }
      );
      await step(
        'ordinary Refresh starts the exact owned latest balance read and real slow state',
        async () => {
          const preceding = balanceReads.at(-1)?.completedAt ?? Date.now();
          await expect
            .poll(() => Date.now() - preceding)
            .toBeGreaterThanOrEqual(PROVIDER_READ_CACHE_MS);
          phase = 'held';
          hold = true;
          await reveal(page, refresh);
          await refresh.click();
          await expect
            .poll(() =>
              balanceReads.some(
                (row) =>
                  row.phase === 'held' &&
                  row.held &&
                  row.completedAt === undefined
              )
            )
            .toBe(true);
          await expect
            .poll(async () => (await publicState(page)).readiness)
            .toEqual({
              networkStatus: 'idle',
              switchingAccount: false,
              postLoading: false,
              polling: false,
              loadingBalances: true,
            });
          observations.heldObservedAt = Date.now();
          // Loading begins just before the physical HTTP read arrives. Wait
          // conservatively from that observed request so scheduler skew cannot
          // turn a valid source-backed threshold into a setup failure.
          const heldReadAt = balanceReads.find(
            (row) => row.phase === 'held'
          )!.at;
          await expect
            .poll(() => Date.now() - heldReadAt)
            .toBeGreaterThanOrEqual(SLOW_OVERLAY_MS);
          await expect(slow).toBeVisible();
          observations.homeSlow = {
            state: await assertIdentity(),
            observedAt: Date.now(),
          };
        }
      );
      await step(
        'ordinary Receive and native Copy remain correct while the same read is held',
        async (capture) => {
          const controls = await enterReceive();
          // Route remounts may start their own genuine overlay timer. Observe
          // the real localized slow state rather than fabricating elapsed time.
          await expect(slow).toHaveCount(1);
          await expect(slow).toBeVisible();
          const state = await assertIdentity();
          expect(state.readiness.loadingBalances).toBe(true);
          expect(state.readiness.polling).toBe(false);
          expect(
            balanceReads
              .filter((row) => row.phase === 'held')
              .every((row) => row.held && row.completedAt === undefined)
          ).toBe(true);
          observations.held = {
            ...controls,
            copy: undefined,
            paint: await copyPaint(controls.copy),
            state,
          };
          expect(observations.held.paint.focused).toBe(true);
          expect(observations.held.paint.labelText).toBe(en.buttons.copy);
          expect(observations.held.paint.glyphs.length).toBeGreaterThan(0);
          expect(
            observations.held.paint.glyphs.every(
              (glyph) => glyph.width > 0 && glyph.height > 0
            )
          ).toBe(true);
          // Pointer transparency is not paint visibility; retain both measures.
          expect(observations.held.paint.hitPoints).toEqual([true, true, true]);
          await capture(page);
          observations.held.native = await copyNative(controls.copy);
          await assertIdentity();
        }
      );
      await step(
        'ordinary wheel reveals the same real slow status and returns to native Copy',
        async (capture) => {
          // Let the genuine Copy feedback finish before recording the status.
          // The status is allowed to scroll with ordinary wallet page content.
          await expect(
            page.getByText(en.home.addressCopied, { exact: true })
          ).toHaveCount(0);
          await expect(slow).toHaveCount(1);
          const copy = page.locator('#copy-address-receive-btn button');
          await expect(copy).toBeFocused();
          observations.visibleSlowStatus = {
            reveal: await reveal(page, slow),
            metadata: await slow.evaluate((element) => ({
              text: element.textContent,
              role: element.getAttribute('role'),
              live: element.getAttribute('aria-live'),
              position: getComputedStyle(element).position,
              pointerEvents: getComputedStyle(element).pointerEvents,
              owner: element
                .closest('[data-navigation-scroll]')
                ?.getAttribute('data-navigation-scroll'),
              insideInert: Boolean(element.closest('[inert]')),
            })),
            state: await assertIdentity(),
          };
          expect(observations.visibleSlowStatus.metadata.text).toBe(
            slowMessage
          );
          expect(observations.visibleSlowStatus.metadata.role).toBe('status');
          expect(observations.visibleSlowStatus.metadata.live).toBe('polite');
          expect(observations.visibleSlowStatus.metadata.pointerEvents).toBe(
            'none'
          );
          expect(observations.visibleSlowStatus.metadata.owner).toBe(
            'wallet-layout'
          );
          expect(observations.visibleSlowStatus.metadata.insideInert).toBe(
            false
          );
          expect(
            observations.visibleSlowStatus.state.readiness.loadingBalances
          ).toBe(true);
          expect(observations.visibleSlowStatus.state.readiness.polling).toBe(
            false
          );
          expect(
            balanceReads
              .filter((row) => row.phase === 'held')
              .every((row) => row.held && row.completedAt === undefined)
          ).toBe(true);
          await expect(copy).toBeFocused();
          await capture(page);
          observations.copyAfterStatusReveal = {
            reveal: await reveal(page, copy),
            paint: await copyPaint(copy),
            state: await assertIdentity(),
          };
          expect(observations.copyAfterStatusReveal.paint.focused).toBe(true);
          expect(observations.copyAfterStatusReveal.paint.labelText).toBe(
            en.buttons.copy
          );
          expect(observations.copyAfterStatusReveal.paint.hitPoints).toEqual([
            true,
            true,
            true,
          ]);
        }
      );
      await step(
        'release only that HTTP read and recover the same rendered Copy without state edits',
        async (capture) => {
          phase = 'released';
          hold = false;
          release();
          await expect
            .poll(() =>
              balanceReads
                .filter((row) => row.phase === 'held')
                .every((row) => row.completedAt !== undefined)
            )
            .toBe(true);
          await expect
            .poll(async () => (await publicState(page)).readiness)
            .toEqual({
              networkStatus: 'idle',
              switchingAccount: false,
              postLoading: false,
              polling: false,
              loadingBalances: false,
            });
          await expect(slow).toHaveCount(0);
          await expect(
            page.getByText(en.home.addressCopied, { exact: true })
          ).toHaveCount(0);
          const copy = page.locator('#copy-address-receive-btn button');
          await expect(copy).toBeEnabled();
          await focusWithKeyboard(page, copy);
          observations.released = {
            reveal: await reveal(page, copy),
            paint: await copyPaint(copy),
            state: await assertIdentity(),
          };
          expect(observations.released.paint.glyphClearOfStatus).toBe(true);
          expect(observations.released.paint.hitPoints).toEqual([
            true,
            true,
            true,
          ]);
          await capture(page);
          observations.released.native = await copyNative(copy);
          await assertIdentity();
        }
      );
      await step(
        'actual Back and complete source/runtime/network/no-grant controls',
        async () => {
          await backHome();
          await assertIdentity();
          expect(
            await page.evaluate(() => (window as any).__receiveSlowCopies)
          ).toEqual([owner, owner, owner]);
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerAfter = value;
            }
          );
          expect(
            balanceReads.some((row) => row.phase === 'held' && row.held)
          ).toBe(true);
          expect(forbidden).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(httpFailures).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await step(
        'Copy label glyphs stay clear of the actual slow-status paint after all controls',
        async () => {
          // All actual copy/address/QR/identity/release/fence controls run first.
          expect(observations.healthy.paint.glyphClearOfStatus).toBe(true);
          expect(observations.released.paint.glyphClearOfStatus).toBe(true);
          expect(observations.held.paint.glyphClearOfStatus).toBe(true);
          expect(observations.visibleSlowStatus.metadata.position).toBe(
            'static'
          );
          expect(
            observations.copyAfterStatusReveal.paint.glyphClearOfStatus
          ).toBe(true);
        }
      );
      status = 'passed';
    } finally {
      hold = false;
      release();
      try {
        await info.attach('receive-slow-balance-copy-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              status,
              observations,
              balanceReads,
              rpcReads,
              forbidden,
              pageErrors,
              httpFailures,
              deniedWrites: routes?.deniedWrites || [],
              proxyDeniedConnections: server.blocked.length,
              proxyCountsArePlatformEvidenceOnly: true,
              HTTPReadHeldWithoutReplyReplacement: true,
              controllerStateReplaced: false,
              controllerRepliesReplaced: false,
              DOMOrScrollOrFocusInjected: false,
              signingOrBroadcastRequested: false,
              connectionGranted: false,
              nativeClipboardForwardedUnchanged: true,
            },
            null,
            2
          ),
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
