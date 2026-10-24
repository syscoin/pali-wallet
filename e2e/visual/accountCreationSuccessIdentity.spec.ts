import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// The real local HD creation flow supplies its own address. Only exact public
// HTTP reads are synthetic. No wallet state, controller result or address is
// injected into the renderer. Onboarding's existing masking is sanitization.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const LABEL = 'Travel';
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
const accountQueries = new Set([
  'details=basic',
  'details=basic&pageSize=0',
  'details=tokenBalances&tokens=used',
  'details=tokenBalances&tokens=nonzero',
  'details=txsummary&pageSize=30',
  'details=txslight&pageSize=30',
  // The locked SDK's real new receiving/change-address index read.
  'tokens=used&details=tokens',
]);

const proxyDenial = async (
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) => {
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
            ? 'http://creation-denied.invalid/'
            : 'creation-denied.invalid:443'
        } HTTP/1.0\r\nHost: creation-denied.invalid\r\nConnection: close\r\n\r\n`
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
};

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
    return {
      active: state.vault.activeAccount,
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
    };
  });

// Public route identity only: no navigation, history, DOM or controller writes.
const publicNavigationState = (page: Page) =>
  page.evaluate(() => ({
    url: window.location.href,
    hash: window.location.hash,
    historyIndex:
      typeof window.history.state?.idx === 'number'
        ? window.history.state.idx
        : null,
    historyKey:
      typeof window.history.state?.key === 'string'
        ? window.history.state.key
        : null,
  }));

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
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 20; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};
const measureAddress = (address: Locator) =>
  address.evaluate((element) => {
    const box = (node: Element) => {
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
    const range = document.createRange();
    range.selectNodeContents(element);
    const glyphs = [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      }));
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const ancestors: any[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node),
        r = node.getBoundingClientRect();
      const horizontalClip = /auto|scroll|hidden|clip/.test(style.overflowX);
      const verticalClip = /auto|scroll|hidden|clip/.test(style.overflowY);
      ancestors.push({
        tag: node.tagName,
        role: node.getAttribute('role'),
        box: box(node),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
        tabIndex: node.getAttribute('tabindex'),
      });
      if (horizontalClip) {
        clip.left = Math.max(clip.left, r.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          r.left + node.clientLeft + node.clientWidth
        );
      }
      if (verticalClip) {
        clip.top = Math.max(clip.top, r.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          r.top + node.clientTop + node.clientHeight
        );
      }
    }
    const tolerance = 0.5;
    const visibleGlyphs = glyphs.filter(
      (r) =>
        r.left >= clip.left - tolerance &&
        r.right <= clip.right + tolerance &&
        r.top >= clip.top - tolerance &&
        r.bottom <= clip.bottom + tolerance
    );
    return {
      text: element.textContent,
      viewport: { width: innerWidth, height: innerHeight },
      fontStatus: document.fonts.status,
      font: getComputedStyle(element).font,
      box: box(element),
      glyphs,
      clip,
      ancestors,
      noGlyphClip: glyphs.length > 0 && visibleGlyphs.length === glyphs.length,
      noHorizontalScrollNeeded: ancestors.every(
        (node) =>
          !/auto|scroll/.test(node.overflowX) ||
          node.scrollWidth <= node.clientWidth + 1
      ),
    };
  });
const controlGeometry = (button: Locator) =>
  button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      points: [
        [box.left + 2, box.top + box.height / 2],
        [box.right - 2, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + 2],
        [box.left + box.width / 2, box.bottom - 2],
        [box.left + box.width / 2, box.top + box.height / 2],
      ].map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          reachesControl: !!hit && (hit === element || element.contains(hit)),
        };
      }),
    };
  });

for (const viewport of [
  { width: 480, height: 620 },
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`new account success preserves readable public identity with ordinary controls at ${viewport.width}x${viewport.height}`, async ({}, info) => {
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
    // Keep each viewport's original eight-minute case budget. Keyboard
    // lifecycle and native-history reveal use independent synthetic profiles.
    for (const lane of ['keyboard', 'reveal'] as const) {
      const prefix = `${viewport.width}x${viewport.height}-${lane}`;
      const main = getNetworkConfig(57, 'sys');
      const mainSigner = new sys.HDSigner(
        UTXO_FIXTURE_SEED,
        '',
        false,
        main.networks,
        57,
        main.types.zPubType,
        84
      );
      const initialXpub = mainSigner.getAccountXpub();
      const signer = new sys.HDSigner(UTXO_FIXTURE_SEED, '', true);
      const firstXpub = signer.getAccountXpub();
      const firstAddress = sys.bitcoinjs.payments.p2wpkh({
        pubkey: signer.deriveKeypair("m/84'/1'/0'/0/0").publicKey,
        network: sys.syscoinNetworks.testnet,
      }).address!;
      signer.createAccountAtIndex(1, 84);
      const created = {
        kind: 'HDAccount',
        id: 1,
        label: LABEL,
        address: sys.bitcoinjs.payments.p2wpkh({
          pubkey: signer.deriveKeypair("m/84'/1'/1'/0/0").publicKey,
          network: sys.syscoinNetworks.testnet,
        }).address!,
        xpub: signer.getAccountXpub(),
      };
      const publicIdentifiers = new Set([
        firstXpub,
        firstAddress,
        created.xpub,
        created.address,
      ]);
      expect(publicIdentifiers.size).toBe(4);
      const reads: string[] = [],
        unsupported: any[] = [],
        forbidden: string[] = [],
        failedRequests: any[] = [],
        pageErrors: string[] = [];
      const observations: Record<string, any> = {
        viewport,
        lane,
        runtime,
        sourceSha256,
        created,
        geometries: [],
        controls: {},
        gestures: [],
      };
      const previous = { ...E2E_CONFIG };
      const server = await startUtxoFixtureServer();
      const denialCanaries: any[] = [];
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      let baseline!: Awaited<ReturnType<typeof publicState>>;
      let accepted!: Awaited<ReturnType<typeof publicState>>;
      try {
        expect(server.blocked).toEqual([]);
        denialCanaries.push(await proxyDenial(server, 'GET'));
        denialCanaries.push(await proxyDenial(server, 'CONNECT'));
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: 'CreationIdentitySynthetic!2026',
          rpcUrl: server.url,
        });
        // Fresh profiles onboard in the established toolbar geometry; only the
        // actual ordinary form/success UI uses the case's requested viewport.
        wallet = await PaliWallet.launch(`account-created-identity-${prefix}`, {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        });
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
            /\/sendtx(?:\/|$)/i.test(url.pathname) ||
            calls.some((call) =>
              /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
          ) {
            forbidden.push(request.method() + ' ' + url.href);
            return route.abort('blockedbyclient');
          }
          // This UTXO-only route needs no JSON-RPC. The finite RPC allowlist is
          // empty: every POST/method/params envelope is refused and retained.
          if (
            request.method() !== 'GET' ||
            url.username ||
            url.password ||
            url.hash
          ) {
            unsupported.push({
              method: request.method(),
              url: url.href,
              rpc: calls
                .filter(Boolean)
                .map((call) => ({ method: call.method, params: call.params })),
            });
            return route.abort('blockedbyclient');
          }
          let body: unknown;
          if (feeds.has(url.href)) body = feeds.get(url.href);
          if (
            [
              'https://blockbook.syscoin.org/api/v2/tickers/currency',
              'https://blockbook-dev.syscoin.org/api/v2/tickers/currency',
            ].includes(url.href)
          )
            body = { ts: 1, rates: { usd: 1 } };
          const match = url.pathname.match(
            /^\/api\/v2\/(xpub|address|utxo)\/([^/]+)$/
          );
          const testOrigin = [
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin);
          if (
            testOrigin &&
            ['/api/v2', '/api/v2/'].includes(url.pathname) &&
            !url.search
          )
            body = {
              blockbook: {
                coin: 'Syscoin Testnet',
                inSync: true,
                bestHeight: 1,
              },
              backend: { chain: 'test', blocks: 1 },
            };
          if (match) {
            const identifier = decodeURIComponent(match[2]);
            const initial =
              url.origin === 'https://blockbook.syscoin.org' &&
              match[1] === 'xpub' &&
              identifier === initialXpub;
            const selected = testOrigin && publicIdentifiers.has(identifier);
            if (
              (initial || selected) &&
              ((match[1] === 'utxo' && !url.search) ||
                (match[1] !== 'utxo' &&
                  accountQueries.has(url.searchParams.toString())))
            ) {
              body =
                match[1] === 'utxo'
                  ? []
                  : {
                      address: identifier,
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
            }
          }
          if (
            url.origin === 'https://api.coingecko.com' &&
            url.pathname === '/api/v3/simple/price' &&
            [...url.searchParams.keys()].length === 3 &&
            ['ids', 'vs_currencies', 'include_24hr_change'].every(
              (key) => url.searchParams.getAll(key).length === 1
            ) &&
            url.searchParams.get('ids') === 'syscoin' &&
            url.searchParams.get('vs_currencies') === 'usd' &&
            url.searchParams.get('include_24hr_change') === 'true'
          )
            body = { syscoin: { usd: 1, ['usd_24h_change']: 0 } };
          if (body === undefined) {
            unsupported.push({ method: request.method(), url: url.href });
            return route.abort('blockedbyclient');
          }
          reads.push(url.href);
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
            failedRequests.push({
              method: request.method(),
              url: request.url(),
            });
        });
        const open = async (action: string) => {
          await wallet!.ensureOnHome();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: action, exact: true })
            .click();
        };
        await wallet.step(
          `${prefix} real onboarding retains one public HD account and no inventory or grants`,
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
            await wallet!.ensureOnHome();
            baseline = await publicState(page);
            expect(baseline.active).toEqual({ id: 0, type: 'HDAccount' });
            expect(baseline.savedActive).toEqual(baseline.active);
            expect(baseline.slip44).toBe(1);
            expect(baseline.network).toMatchObject({
              kind: 'syscoin',
              chainId: 5700,
              label: 'Syscoin Testnet',
              url: 'https://blockbook-dev.syscoin.org/',
            });
            expect(baseline.liveAccounts).toEqual([
              {
                kind: 'HDAccount',
                id: 0,
                label: 'SYS-T 1',
                address: firstAddress,
                xpub: firstXpub,
              },
            ]);
            expect(baseline.savedAccounts).toEqual(baseline.liveAccounts);
            expect(baseline.liveAssets).toEqual([
              { kind: 'HDAccount', id: 0, ethereum: [], syscoin: [], nfts: [] },
            ]);
            expect(baseline.savedAssets).toEqual(baseline.liveAssets);
            expect(baseline.grants).toEqual([]);
            expect(baseline.savedGrants).toEqual([]);
            observations.before = baseline;
          }
        );
        await wallet.step(
          `${prefix} ordinary form Close discards only an unsaved name`,
          async () => {
            await open(en.accountMenu.createNewAccount);
            await expect(page).toHaveURL(/#\/settings\/account\/new$/);
            await page.setViewportSize(viewport);
            await page.locator('#account-name-input').fill('Unsaved draft');
            const close = page.getByRole('button', {
              name: en.buttons.close,
              exact: true,
            });
            await expect(close).toHaveCount(1);
            await close.click();
            await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
            expect(await publicState(page)).toEqual(baseline);
          }
        );
        const dialog = page.getByRole('dialog', {
          name: en.settings.yourNewAccount,
          exact: true,
        });
        const address = dialog.getByText(created.address, { exact: true });
        const close = dialog.getByRole('button', {
          name: en.buttons.close,
          exact: true,
        });
        const ok = dialog.getByRole('button', {
          name: en.buttons.ok,
          exact: true,
        });
        await wallet.step(
          `${prefix} ordinary Create produces the independently derived public account and genuine success address`,
          async (capture) => {
            await wallet!.ensureOnHome();
            observations.priorHomeRoute = await publicNavigationState(page);
            expect(observations.priorHomeRoute.hash).toMatch(
              /^#\/home(?:\?.*)?$/
            );
            expect(observations.priorHomeRoute.historyIndex).not.toBeNull();
            expect(observations.priorHomeRoute.historyKey).not.toBeNull();
            await open(en.accountMenu.createNewAccount);
            await expect(page).toHaveURL(/#\/settings\/account\/new$/);
            await page.locator('#account-name-input').fill(LABEL);
            await page.locator('#create-btn').click();
            await expect(dialog).toBeVisible();
            await expect(address).toHaveCount(1);
            await expect(address).toHaveText(created.address);
            const assets = [
              ...baseline.liveAssets,
              { kind: 'HDAccount', id: 1, ethereum: [], syscoin: [], nfts: [] },
            ];
            const accounts = [...baseline.liveAccounts, created];
            accepted = {
              ...baseline,
              active: { id: 1, type: 'HDAccount' },
              savedActive: { id: 1, type: 'HDAccount' },
              liveAccounts: accounts,
              savedAccounts: accounts,
              liveAssets: assets,
              savedAssets: assets,
            };
            await expect.poll(() => publicState(page)).toEqual(accepted);
            observations.accepted = accepted;
            observations.createdRoute = await publicNavigationState(page);
            expect(observations.createdRoute.hash).toBe(
              '#/settings/account/new'
            );
            expect(observations.createdRoute.historyIndex).toBe(
              observations.priorHomeRoute.historyIndex + 1
            );
            expect(observations.createdRoute.historyKey).not.toBeNull();
            expect(observations.createdRoute.historyKey).not.toBe(
              observations.priorHomeRoute.historyKey
            );
            await settledLayout(page);
            await page.mouse.move(2, 2);
            observations.geometries.push({
              mode: 'initial',
              geometry: await measureAddress(address),
            });
            for (const [name, button] of [
              ['Close', close],
              ['OK', ok],
            ] as const) {
              const geometry = await controlGeometry(button);
              observations.controls[name] = geometry;
              expect(geometry.width).toBeGreaterThanOrEqual(44);
              expect(geometry.height).toBeGreaterThanOrEqual(44);
              expect(
                geometry.points.every((point) => point.reachesControl)
              ).toBe(true);
            }
            await capture(page);
          }
        );
        if (lane === 'keyboard') {
          await wallet.step(
            `${prefix} native Tab reaches both success controls and Enter Close preserves accepted identity`,
            async () => {
              await tabTo(page, ok);
              await expect(ok).toBeFocused();
              await tabTo(page, close);
              await expect(close).toBeFocused();
              expect(await publicState(page)).toEqual(accepted);
              await page.keyboard.press('Enter');
              await expect(dialog).toHaveCount(0);
              await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
              expect(await publicState(page)).toEqual(accepted);
              await open(en.accountMenu.manageAccounts);
              await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
              const exactAction = `${en.buttons.edit}: ${created.label} (${created.address})`;
              await expect(
                page.getByRole('button', { name: exactAction, exact: true })
              ).toHaveCount(1);
              expect(await publicState(page)).toEqual(accepted);
            }
          );
        } else {
          await wallet.step(
            `${prefix} ordinary wheels test vertical and horizontal reveal without moving DOM or focus`,
            async (capture) => {
              expect(await publicNavigationState(page)).toEqual(
                observations.createdRoute
              );
              const scrollSignature = () =>
                address.evaluate((node) => {
                  const positions: number[] = [];
                  for (
                    let parent: Element | null = node;
                    parent;
                    parent = parent.parentElement
                  )
                    positions.push(parent.scrollLeft, parent.scrollTop);
                  return positions;
                });
              const settleScroll = async () => {
                let previousSignature = '',
                  stable = 0;
                await frame(page);
                await expect
                  .poll(async () => {
                    const signature = JSON.stringify(await scrollSignature());
                    stable = signature === previousSignature ? stable + 1 : 0;
                    previousSignature = signature;
                    return stable >= 2;
                  })
                  .toBe(true);
                await frame(page);
              };
              for (const gesture of [
                { x: 0, y: 96 },
                { x: 0, y: -96 },
                { x: 240, y: 0 },
                { x: -240, y: 0 },
              ]) {
                // No earlier gesture may silently move to another route.
                expect(await publicNavigationState(page)).toEqual(
                  observations.createdRoute
                );
                const geometry = await measureAddress(address);
                const x = Math.max(
                  geometry.clip.left + 4,
                  Math.min(
                    geometry.clip.right - 4,
                    (geometry.box.left + geometry.box.right) / 2
                  )
                );
                const y = Math.max(
                  geometry.clip.top + 4,
                  Math.min(
                    geometry.clip.bottom - 4,
                    (geometry.box.top + geometry.box.bottom) / 2
                  )
                );
                expect(x).toBeGreaterThanOrEqual(0);
                expect(y).toBeGreaterThanOrEqual(0);
                const bodyHit = await address.evaluate(
                  (node, point) => {
                    const hit = document.elementFromPoint(point.x, point.y);
                    return !!hit && !!node.parentElement?.contains(hit);
                  },
                  { x, y }
                );
                expect(bodyHit).toBe(true);
                await page.mouse.move(x, y);
                await page.mouse.wheel(gesture.x, gesture.y);
                await settleScroll();
                observations.gestures.push({
                  gesture,
                  point: { x, y },
                  bodyHit,
                });
                observations.geometries.push({
                  mode: `wheel-${gesture.x}-${gesture.y}`,
                  geometry: await measureAddress(address),
                });
                if (gesture.x !== 0) {
                  observations.revealScreenshots ??= [];
                  observations.revealScreenshots.push(
                    await wallet!.shot(
                      `${prefix} horizontal-wheel-${gesture.x} genuine success identity`
                    )
                  );
                }
                expect(await publicState(page)).toEqual(accepted);
              }
              await page.mouse.move(2, 2);
              await settledLayout(page);
              const afterWheels = await publicNavigationState(page);
              const remainedOnCreatedRoute =
                JSON.stringify(afterWheels) ===
                JSON.stringify(observations.createdRoute);
              const traversedToExactPriorHome =
                JSON.stringify(afterWheels) ===
                JSON.stringify(observations.priorHomeRoute);
              observations.navigationAfterWheels = {
                before: observations.createdRoute,
                priorHome: observations.priorHomeRoute,
                after: afterWheels,
                remainedOnCreatedRoute,
                traversedToExactPriorHome,
              };
              // A native horizontal history gesture may restore precisely the
              // preceding Home entry. It must never mutate the accepted wallet.
              expect(remainedOnCreatedRoute || traversedToExactPriorHome).toBe(
                true
              );
              if (remainedOnCreatedRoute) {
                await expect(dialog).toBeVisible();
                await expect(address).toHaveText(created.address);
              } else {
                await expect(dialog).toHaveCount(0);
                await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
              }
              expect(await publicState(page)).toEqual(accepted);
              await capture(page);
            }
          );
        }
        await wallet.step(
          `${prefix} worker runtime physical fences and exact public scope complete before the presentation predicate`,
          async () => {
            expect(await publicState(page)).toEqual(accepted);
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
            expect(unsupported).toEqual([]);
            expect(forbidden).toEqual([]);
            expect(failedRequests).toEqual([]);
            expect(pageErrors).toEqual([]);
            expect(
              reads.some((url) =>
                url.includes(encodeURIComponent(created.xpub))
              )
            ).toBe(true);
            expect(extensionEvidence()).toEqual(runtime);
            expect(
              createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex')
            ).toBe(sourceSha256);
          }
        );
        if (lane === 'reveal') {
          await wallet.step(
            `${prefix} accepted success address is readable without horizontal scrolling`,
            async () => {
              const initial = observations.geometries.find(
                (entry: any) => entry.mode === 'initial'
              ).geometry;
              // All ordinary reveal attempts and identity/fence controls above run
              // first. This final assertion is the only presentation candidate.
              expect(
                initial.noGlyphClip && initial.noHorizontalScrollNeeded,
                JSON.stringify({
                  initial,
                  reveal: observations.geometries.slice(1),
                })
              ).toBe(true);
            }
          );
        }
        status = 'passed';
      } finally {
        try {
          await info.attach(
            `account-creation-success-identity-${lane}-evidence`,
            {
              contentType: 'application/json',
              body: JSON.stringify({
                status,
                runtime,
                sourceSha256,
                observations,
                reads,
                unsupported,
                forbidden,
                failedRequests,
                pageErrors,
                denialCanaries,
                proxyDeniedConnections: server.blocked.length,
                controllerStateReplaced: false,
                controllerResultsReplaced: false,
                chromeApiReplaced: false,
                addressInjected: false,
                focusOrScrollSetterUsed: false,
                privateKeyImportOrRevealRequested: false,
                signingOrBroadcastRequested: false,
                tracesAndVideosDisabled: true,
              }),
            }
          );
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
    }
  });
}
