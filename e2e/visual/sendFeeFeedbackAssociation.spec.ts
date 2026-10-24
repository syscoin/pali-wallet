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

// Real ordinary UTXO fee-field association regression.
// The default synthetic UTXO wallet never reaches a transaction preview. Every
// Next activation has amount0 and an invalid receiver; no PSBT/UTXO/signing read
// is admitted. Transport data is simulated, not controller/store/renderer data.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const RECEIVER = '#send-form input#receiver';
const AMOUNT = '#with-max-button';
const FEE = '#fee-input';
const MALFORMED = 'not-a-syscoin-address';
// Exercise permitted focused fractions and the blocking safety-card reason.
// Nonblocking advisory warnings must stay valid; their description is optional.
const LOW_WARNING = '0.00001';
const HIGH_SAFETY = '0.00005';
const lowWarningMessage = en.send.feeRateNormal
  .replace('{{value}}', Number(LOW_WARNING).toFixed(8))
  .replace('{{currency}}', 'SYS');
const highSafetyMessage = en.send.feeRateSafetyLimit
  .replace('{{value}}', Number(HIGH_SAFETY).toFixed(8))
  .replace(/\{\{currency\}\}/g, 'SYS')
  .replace('{{limit}}', '0.00005000');
const ORIGIN = 'https://blockbook.syscoin.org';
const FEE_URL = ORIGIN + '/api/v2/estimatefee/1';
const sha = (file: string) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const keyOf = (url: URL) => {
  const query = new URLSearchParams(url.search);
  query.sort();
  return url.origin + url.pathname + (query.size ? '?' + query : '');
};

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

const proxyDenial = async (
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) => {
  const proxy = new URL(server.url);
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
  const before = server.blocked.length;
  const target =
    method === 'GET'
      ? 'http://send-fee-denied.invalid/'
      : 'send-fee-denied.invalid:443';
  const result = await new Promise<{
    body: string;
    connectionClosed: boolean;
    statusCode: number;
  }>((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0);
    let ended = false;
    let settled = false;
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
    socket.once('connect', () => {
      socket.write(
        `${method} ${target} HTTP/1.0\r\nHost: send-fee-denied.invalid\r\nConnection: close\r\n\r\n`
      );
    });
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Unexpectedly large denial response'));
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
        const text = bytes.toString('utf8');
        const separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        const header = text.slice(0, separator);
        expect(header.split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(header).toMatch(/\r\nConnection: close(?:\r\n|$)/i);
        const body = text.slice(separator + 4);
        expect(body).toBe(method === 'GET' ? 'Offline fixture only' : '');
        resolve({ statusCode: 403, body, connectionClosed: true });
      } catch (error) {
        reject(error);
      }
    });
  });
  const blockedDelta = server.blocked.slice(before);
  expect(blockedDelta).toEqual([method]);
  return { method, ...result, blockedDelta };
};

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
const settle = async (page: Page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().every((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            timing?.iterations === Infinity ||
            (animation.playState !== 'running' && !animation.pending)
          );
        })
      )
    )
    .toBe(true);
  await frame(page);
};
const tabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 80; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const live = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + live.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state', 'language']);
    const saved = disk[key];
    const network = (value: any) =>
      value && {
        kind: value.kind,
        chainId: value.chainId,
        slip44: value.slip44,
        label: value.label,
        currency: value.currency,
        url: value.url,
        explorer: value.explorer,
        apiUrl: value.apiUrl,
      };
    const networks = (value: any) =>
      Object.entries(value || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, entry]) => ({
            kind,
            id,
            network: network(entry),
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, account]: [string, any]) => ({
            kind,
            id,
            label: account.label,
            address: account.address,
            xpub: account.xpub || null,
            balances: Object.entries(account.balances || {})
              .map(([family, value]) => ({
                family,
                value: String(value),
              }))
              .sort((a, b) => a.family.localeCompare(b.family)),
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).flatMap(
            ([accountId, families]: [string, any]) =>
              Object.entries(families || {}).map(
                ([family, entries]: [string, any]) => ({
                  kind,
                  accountId,
                  family,
                  values: (entries || []).map((asset: any) => ({
                    id: asset.id,
                    assetGuid: asset.assetGuid,
                    chainId: asset.chainId,
                    symbol: asset.symbol || asset.tokenSymbol,
                    balance: asset.balance,
                    decimals: asset.decimals,
                    address: asset.contractAddress || asset.contract,
                    standard: asset.tokenStandard,
                    tokenId: asset.tokenId,
                    isNft: asset.isNft,
                  })),
                })
              )
          )
        )
        .sort((a, b) =>
          (a.kind + ':' + a.accountId + ':' + a.family).localeCompare(
            b.kind + ':' + b.accountId + ':' + b.family
          )
        );
    // Canonical public rows cover every account/family/chain. Empty history-map
    // initialization is not an added transaction; any actual row changes scope.
    const history = (vault: any) =>
      Object.entries(vault?.accountTransactions || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).flatMap(
            ([accountId, families]: [string, any]) =>
              Object.entries(families || {}).flatMap(
                ([family, chains]: [string, any]) =>
                  Object.entries(chains || {}).flatMap(
                    ([chainId, rows]: [string, any]) =>
                      (rows || []).map((row: any) => ({
                        kind,
                        accountId,
                        family,
                        chainId,
                        id: row.txid || row.hash,
                        from: row.from,
                        to: row.to,
                        value: row.value,
                        input: row.input,
                        blockNumber: row.blockNumber,
                        confirmations: row.confirmations,
                      }))
                  )
              )
          )
        )
        .sort((a, b) =>
          (
            a.kind +
            ':' +
            a.accountId +
            ':' +
            a.family +
            ':' +
            a.chainId +
            ':' +
            a.id
          ).localeCompare(
            b.kind +
              ':' +
              b.accountId +
              ':' +
              b.family +
              ':' +
              b.chainId +
              ':' +
              b.id
          )
        );
    const preferences = (value: any) => ({
      refresh: value?.refresh,
      autolock: value?.autolock,
    });
    return {
      ready:
        live.vaultGlobal.networkStatus === 'idle' &&
        !live.vaultGlobal.isPostNetworkSwitchLoading &&
        !live.vaultGlobal.isSwitchingAccount &&
        !live.vaultGlobal.loadingStates?.isLoadingBalances,
      stable: {
        active: live.vault.activeAccount,
        savedActive: saved?.activeAccount,
        slip44: live.vaultGlobal.activeSlip44,
        network: network(live.vault.activeNetwork),
        savedNetwork: network(saved?.activeNetwork),
        networks: networks(live.vaultGlobal.networks),
        savedNetworks: networks(disk.state?.vaultGlobal?.networks),
        accounts: accounts(live.vault),
        savedAccounts: accounts(saved),
        assets: assets(live.vault),
        savedAssets: assets(saved),
        history: history(live.vault),
        savedHistory: history(saved),
        grants: Object.keys(live.dapp?.dapps || {}).sort(),
        savedGrants: Object.keys(disk.state?.dapp?.dapps || {}).sort(),
        preferences: preferences(live.vaultGlobal.advancedSettings),
        savedPreferences: preferences(
          disk.state?.vaultGlobal?.advancedSettings
        ),
        language: disk.language || 'en',
        currency: live.price.fiat.asset,
        savedCurrency: disk.state?.price?.fiat?.asset,
      },
    };
  });

// Live read caches and the last durable snapshot can differ. Compare identity
// across them, but retain both complete balance arrays in the scoped baseline.
const accountIdentities = (
  accounts: Awaited<ReturnType<typeof publicState>>['stable']['accounts']
) =>
  accounts.map(({ kind, id, label, address, xpub }) => ({
    kind,
    id,
    label,
    address,
    xpub,
  }));

const fieldEvidence = async (page: Page, selector: string) => {
  const input = page.locator(selector);
  await expect(input).toHaveCount(1);
  const dom = await input.evaluate((node) => {
    const field = node as HTMLInputElement;
    const item = field.closest('.ant-form-item')!;
    const content = item.querySelector('.ant-form-item-control-input-content');
    const wrapper = content?.firstElementChild;
    const visible = (element: Element) => {
      const r = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      return (
        r.width > 0 &&
        r.height > 0 &&
        css.display !== 'none' &&
        css.visibility !== 'hidden'
      );
    };
    const attributes = (element: Element) => ({
      tag: element.tagName,
      id: element.id,
      invalid: element.getAttribute('aria-invalid'),
      required: element.getAttribute('aria-required'),
      describedBy: element.getAttribute('aria-describedby'),
      errorMessage: element.getAttribute('aria-errormessage'),
    });
    return {
      ...attributes(field),
      value: field.value,
      type: field.type,
      focused: field === document.activeElement,
      defaultValue: field.defaultValue,
      valueAttribute: field.getAttribute('value'),
      step: field.getAttribute('step'),
      min: field.getAttribute('min'),
      max: field.getAttribute('max'),
      formNoValidate: field.form?.noValidate ?? null,
      validationMessage: field.validationMessage,
      validity: {
        badInput: field.validity.badInput,
        customError: field.validity.customError,
        rangeOverflow: field.validity.rangeOverflow,
        rangeUnderflow: field.validity.rangeUnderflow,
        stepMismatch: field.validity.stepMismatch,
        valid: field.validity.valid,
        valueMissing: field.validity.valueMissing,
      },
      placeholder: field.placeholder,
      labels: Array.from(field.labels || []).map((label) =>
        label.textContent?.trim()
      ),
      wrapper: wrapper ? attributes(wrapper) : null,
      box: field.getBoundingClientRect().toJSON(),
      nearbyText: (item as HTMLElement).innerText,
      references: ['aria-describedby', 'aria-errormessage'].flatMap(
        (attribute) =>
          (field.getAttribute(attribute) || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => {
              const element = document.getElementById(id);
              return {
                attribute,
                id,
                text: element?.textContent?.trim() || '',
                visible: !!element && visible(element),
              };
            })
      ),
      liveNodes: Array.from(item.querySelectorAll('[role="alert"],[aria-live]'))
        .filter(visible)
        .map((element) => ({
          role: element.getAttribute('role'),
          live: element.getAttribute('aria-live'),
          text: element.textContent?.trim() || '',
        })),
    };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    expect(nodeId).toBeGreaterThan(0);
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    });
    const field = nodes.find(
      (node) =>
        ['textbox', 'spinbutton'].includes(String(node.role?.value)) &&
        !node.ignored
    );
    expect(field).toBeDefined();
    return {
      dom,
      native: {
        role: field!.role?.value,
        name: field!.name?.value || '',
        description: field!.description?.value || '',
        properties: Object.fromEntries(
          (field!.properties || []).map((property) => [
            property.name,
            property.value?.value ?? null,
          ])
        ),
      },
    };
  } finally {
    await cdp.detach();
  }
};
const feedbackGeometry = (target: Locator) =>
  target.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const css = getComputedStyle(node),
        box = node.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          box.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          box.top + node.clientTop + node.clientHeight
        );
      }
    }
    const footer = document
      .querySelector('#send-form button[type=submit]')
      ?.closest('.fixed');
    if (footer)
      clip.bottom = Math.min(clip.bottom, footer.getBoundingClientRect().top);
    const center = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    return {
      box: r.toJSON(),
      clip,
      visible:
        r.width > 0 &&
        r.height > 0 &&
        r.left >= clip.left - 0.5 &&
        r.right <= clip.right + 0.5 &&
        r.top >= clip.top - 0.5 &&
        r.bottom <= clip.bottom + 0.5 &&
        !!center &&
        (center === element || element.contains(center)),
    };
  });
const revealFeedback = async (page: Page, target: Locator) => {
  await settle(page);
  for (let count = 0; count < 16; count += 1) {
    const current = await feedbackGeometry(target);
    if (current.visible) return current;
    const viewport = page.viewportSize()!;
    const delta = current.box.top < current.clip.top ? -80 : 80;
    const point = await page.evaluate(() => {
      const owner = document.querySelector(
        '[data-navigation-scroll="wallet-layout"]'
      );
      const x = innerWidth - 8,
        y = innerHeight / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        owned: !!owner && !!hit && (hit === owner || owner.contains(hit)),
      };
    });
    expect(point.owned).toBe(true);
    expect(point.x).toBeLessThan(viewport.width);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, delta);
    await settle(page);
  }
  const geometry = await feedbackGeometry(target);
  expect(geometry.visible).toBe(true);
  return geometry;
};

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`observes ordinary UTXO fee validation on the actual native field at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    test.setTimeout(180_000);
    expect(process.version).toBe('v23.11.1');
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence(),
      sourceSha256 = sha(info.file);
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    expect(runtime.version).toBe(packageJson.version);
    expect(runtime.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(runtime.bundleHashes).sort()).toEqual([
      'background',
      'external',
      'inpage',
    ]);
    for (const hash of Object.values(runtime.bundleHashes))
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

    const previous = { ...E2E_CONFIG },
      config = getNetworkConfig(57, 'sys');
    const signer = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      config.networks,
      57,
      config.types.zPubType,
      84
    );
    const xpub = signer.getAccountXpub();
    const inventory = {
      address: xpub,
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
    const replies = new Map(feeds);
    replies.set('https://api.coingecko.com/api/v3/asset_platforms', []);
    replies.set(ORIGIN + '/api/v2/tickers/currency', {
      ts: 1,
      rates: { usd: 1 },
    });
    // Exact SendSys -> MainController -> SDK getRecommendedFee:
    // fetchEstimateFee(activeNetwork.url,1), positive coin/KB result /1024.
    // No transaction estimate, UTXO, parent transaction or PSBT read is admitted.
    replies.set(FEE_URL, { result: '0.00001' });
    for (const query of [
      'details=tokenBalances&tokens=used',
      'details=tokenBalances&tokens=nonzero',
      'details=txsummary&pageSize=30',
      'details=txslight&pageSize=30',
    ])
      replies.set(
        keyOf(new URL(ORIGIN + '/api/v2/xpub/' + xpub + '?' + query)),
        inventory
      );

    const server = await startUtxoFixtureServer();
    const physicalCanaries: unknown[] = [],
      reads: string[] = [],
      unsupported: string[] = [],
      writes: string[] = [],
      httpFailures: string[] = [],
      pageErrors: string[] = [];
    const observations: Record<string, any> = {
      runtime,
      sourceSha256,
      viewport,
      fields: [],
      originals: [],
      routes: [],
      nativeFeeAssociationMeasured: true,
      nativeSafetyReasonAndFractionalValidityMeasured: true,
    };
    let wallet: PaliWallet | undefined,
      status: 'passed' | 'failed' = 'failed';
    let baseline!: Awaited<ReturnType<typeof publicState>>['stable'];
    try {
      expect(server.blocked).toEqual([]);
      physicalCanaries.push(await proxyDenial(server, 'GET'));
      physicalCanaries.push(await proxyDenial(server, 'CONNECT'));
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'SendFeeFeedbackSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        `send-fee-feedback-${viewport.width}x${viewport.height}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('framenavigated', (navigationFrame) => {
        if (navigationFrame === page.mainFrame())
          observations.routes.push(new URL(navigationFrame.url()).hash);
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          httpFailures.push(request.method() + ' ' + request.url());
      });
      await wallet.context.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol))
          return route.continue();
        const label = request.method() + ' ' + url.origin + url.pathname;
        // A complete handler: no fallback into the broader isolated fixture.
        // This untouched UTXO-only producer has no admitted EVM RPC or write.
        if (
          request.method() !== 'GET' ||
          /\/sendtx(?:\/|$)/i.test(url.pathname)
        ) {
          writes.push(label);
          return route.abort('blockedbyclient');
        }
        const reply =
          !url.username && !url.password && !url.hash
            ? replies.get(keyOf(url))
            : undefined;
        if (reply === undefined) {
          unsupported.push(label);
          return route.abort('blockedbyclient');
        }
        reads.push(keyOf(url));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(reply),
        });
      });
      const receiver = page.locator(RECEIVER),
        amount = page.locator(AMOUNT),
        fee = page.locator(FEE),
        next = page.locator('#send-form button[type=submit]');
      const unchanged = async () => {
        await expect
          .poll(async () => (await publicState(page)).ready)
          .toBe(true);
        expect((await publicState(page)).stable).toEqual(baseline);
      };
      const requireZeroAmount = async () => {
        await expect(amount).toHaveValue('0');
        await expect(page).toHaveURL(/#\/send\/sys(?:\?.*)?$/);
      };
      const screenshot = async (label: string) => {
        await page.mouse.move(2, 2);
        await settle(page);
        const file = info.outputPath(
          `${viewport.width}x${viewport.height}-${label}.png`
        );
        const png = await page.screenshot({
          path: file,
          fullPage: false,
          caret: 'initial',
        });
        expect({
          width: png.readUInt32BE(16),
          height: png.readUInt32BE(20),
        }).toEqual(viewport);
        observations.originals.push({
          label,
          path: file,
          sha256: createHash('sha256').update(png).digest('hex'),
          viewport,
          fullPage: false,
          caret: 'initial',
        });
      };
      const invalidNext = async () => {
        await requireZeroAmount();
        await expect(receiver).toHaveValue(MALFORMED);
        await expect(next).toHaveCount(1);
        await expect(next).toBeEnabled();
        await next.click();
        await requireZeroAmount();
      };
      const associated = (
        field: Awaited<ReturnType<typeof fieldEvidence>>,
        message: string
      ) => {
        expect(
          field.dom.references.some(
            (ref) => ref.visible && ref.text.includes(message)
          )
        ).toBe(true);
        expect(field.native.description).toContain(message);
        expect(field.dom.invalid).toBe('true');
        expect(field.native.properties.invalid).toBe('true');
      };
      const observeFeeError = async (phase: string) => {
        const error = page.getByText(en.send.invalidFeeRate, { exact: true });
        await expect(error).toHaveCount(1);
        await expect(error).toBeVisible();
        const geometry = await revealFeedback(page, error);
        const field = await fieldEvidence(page, FEE);
        expect(geometry.visible).toBe(true);
        expect(field.dom.value).toBe('-1');
        expect(field.dom.nearbyText).toContain(en.send.invalidFeeRate);
        expect(field.dom.labels).toContain(
          en.components.feeRateLabel.replace('{{currency}}', 'SYS')
        );
        observations.fields.push({
          phase,
          message: en.send.invalidFeeRate,
          field,
          geometry,
        });
        await requireZeroAmount();
        await screenshot(phase + '-fee-error-and-native-field');
        await unchanged();
      };

      await wallet.step(
        `${viewport.width}x${viewport.height}: ordinary onboarding preserves default UTXO scope`,
        async () => {
          observations.workerBefore = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (identity) => {
              observations.workerBefore = identity;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          await expect
            .poll(async () => {
              const current = await publicState(page);
              observations.setupBoundary = current;
              return (
                current.ready &&
                JSON.stringify(accountIdentities(current.stable.accounts)) ===
                  JSON.stringify(
                    accountIdentities(current.stable.savedAccounts)
                  ) &&
                JSON.stringify(current.stable.assets) ===
                  JSON.stringify(current.stable.savedAssets) &&
                JSON.stringify(current.stable.history) ===
                  JSON.stringify(current.stable.savedHistory)
              );
            })
            .toBe(true);
          baseline = (await publicState(page)).stable;
          expect(baseline.active).toEqual({ id: 0, type: 'HDAccount' });
          expect(baseline.savedActive).toEqual(baseline.active);
          expect(baseline.slip44).toBe(57);
          expect(baseline.network).toMatchObject({
            kind: 'syscoin',
            chainId: 57,
            slip44: 57,
            url: ORIGIN + '/',
          });
          expect(baseline.savedNetwork).toEqual(baseline.network);
          expect(baseline.accounts).toHaveLength(1);
          expect(baseline.accounts[0].xpub).toBe(xpub);
          expect(accountIdentities(baseline.savedAccounts)).toEqual(
            accountIdentities(baseline.accounts)
          );
          expect(baseline.accounts[0].balances).toEqual([
            { family: 'ethereum', value: '-1' },
            { family: 'syscoin', value: '0' },
          ]);
          expect(baseline.savedAccounts[0].balances).toEqual([
            { family: 'ethereum', value: '-1' },
            { family: 'syscoin', value: '-1' },
          ]);
          for (const family of baseline.assets)
            expect(family.values).toEqual([]);
          expect(baseline.savedAssets).toEqual(baseline.assets);
          expect(baseline.history).toEqual([]);
          expect(baseline.savedHistory).toEqual([]);
          expect(baseline.networks).toEqual(baseline.savedNetworks);
          expect(baseline.grants).toEqual([]);
          expect(baseline.savedGrants).toEqual([]);
          expect(baseline.preferences).toEqual({ refresh: false, autolock: 0 });
          expect(baseline.savedPreferences).toEqual(baseline.preferences);
          expect(baseline.currency).toBe('usd');
          expect(baseline.savedCurrency).toBe('usd');
          expect(baseline.language).toBe('en');
          observations.baseline = baseline;
        }
      );
      let recommendation = '';
      await wallet.step(
        `${viewport.width}x${viewport.height}: real Send bootstrap and direct native Receiver/Amount establish associated-error controls`,
        async () => {
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/sys(?:\?.*)?$/);
          for (const input of [receiver, amount, fee])
            await expect(input).toHaveCount(1);
          await page.setViewportSize(viewport);
          await amount.fill('0');
          await expect
            .poll(async () => Number(await fee.inputValue()))
            .toBeGreaterThan(0);
          expect(reads).toContain(FEE_URL);
          recommendation = await fee.inputValue();
          observations.recommendation = recommendation;
          expect(Number(recommendation)).toBeCloseTo(0.00001 / 1024, 18);
          observations.healthyFee = await fieldEvidence(page, FEE);
          expect(observations.healthyFee.dom.invalid).not.toBe('true');
          await receiver.fill(MALFORMED);
          await invalidNext();
          for (const [selector, message] of [
            [RECEIVER, en.send.invalidSysAddress],
            [AMOUNT, en.send.invalidAmount],
          ]) {
            const error = page.getByText(message, { exact: true });
            await expect(error).toHaveCount(1);
            await expect(error).toBeVisible();
            const geometry = await revealFeedback(page, error);
            const field = await fieldEvidence(page, selector);
            expect(geometry.visible).toBe(true);
            associated(field, message);
            observations[
              selector === RECEIVER
                ? 'receiverPositiveControl'
                : 'amountPositiveControl'
            ] = { field, geometry, message };
            await screenshot(
              selector === RECEIVER
                ? 'direct-receiver-control'
                : 'direct-amount-control'
            );
          }
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: ordinary native fee edit shows local invalid guidance without transaction preparation`,
        async () => {
          await tabTo(page, fee);
          await fee.fill('-1');
          await observeFeeError('negative');
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: native fee correction clears only its local error`,
        async () => {
          await fee.fill(recommendation);
          await expect(
            page.getByText(en.send.invalidFeeRate, { exact: true })
          ).toHaveCount(0);
          observations.correctedFee = await fieldEvidence(page, FEE);
          expect(observations.correctedFee.dom.value).toBe(recommendation);
          expect(observations.correctedFee.dom.invalid).not.toBe('true');
          await requireZeroAmount();
          await revealFeedback(page, fee);
          await screenshot('positive-fee-correction');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: a normal lower advisory rate remains nonblocking without an association mandate`,
        async () => {
          await tabTo(page, fee);
          await fee.fill(LOW_WARNING);
          const advisory = page.getByText(lowWarningMessage, { exact: true });
          await expect(advisory).toHaveCount(1);
          await expect(advisory).toBeVisible();
          await revealFeedback(page, advisory);
          observations.lowerAdvisoryFocused = await fieldEvidence(page, FEE);
          await screenshot('lower-advisory-fee-focused-before-native-blur');
          await page.keyboard.press('Tab');
          await settle(page);
          const geometry = await revealFeedback(page, advisory);
          const field = await fieldEvidence(page, FEE);
          observations.lowerAdvisoryControl = {
            message: lowWarningMessage,
            field,
            geometry,
          };
          expect(geometry.visible).toBe(true);
          expect(field.dom.value).toBe(LOW_WARNING);
          expect(field.dom.nearbyText).toContain(lowWarningMessage);
          expect(field.dom.invalid).not.toBe('true');
          expect(field.native.properties.invalid).not.toBe('true');
          await requireZeroAmount();
          await expect(receiver).toHaveValue(MALFORMED);
          await screenshot('lower-advisory-fee-control');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: observe the ordinary blocking safety-rate reason on the actual input`,
        async () => {
          await fee.fill(HIGH_SAFETY);
          const reason = page.getByText(highSafetyMessage, { exact: true });
          await expect(reason).toHaveCount(1);
          await expect(reason).toBeVisible();
          await expect(
            page.getByText(lowWarningMessage, { exact: true })
          ).toHaveCount(0);
          // Installed rc-component/form converts the intentional empty rejection
          // into a blank error. Invalid state is a source-backed control; whether
          // its meaningful reason is actually associated remains the last gate.
          await expect(fee).toHaveAttribute('aria-invalid', 'true');
          observations.highSafetyFocused = await fieldEvidence(page, FEE);
          await page.keyboard.press('Tab');
          await settle(page);
          const geometry = await revealFeedback(page, reason);
          const field = await fieldEvidence(page, FEE);
          expect(geometry.visible).toBe(true);
          expect(field.dom.value).toBe(HIGH_SAFETY);
          expect(field.dom.nearbyText).toContain(highSafetyMessage);
          expect(field.native.properties.invalid).toBe('true');
          observations.highSafety = {
            value: HIGH_SAFETY,
            message: highSafetyMessage,
            field,
            geometry,
            reasonNode: await reason.evaluate((element) => ({
              tag: element.tagName,
              id: element.id,
              role: element.getAttribute('role'),
              live: element.getAttribute('aria-live'),
              text: element.textContent?.trim(),
            })),
          };
          await requireZeroAmount();
          await expect(receiver).toHaveValue(MALFORMED);
          await screenshot('blocking-safety-fee-reason-and-native-field');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: ordinary positive correction removes only the current safety card`,
        async () => {
          await fee.fill(recommendation);
          await expect(
            page.getByText(highSafetyMessage, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(lowWarningMessage, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(en.send.invalidFeeRate, { exact: true })
          ).toHaveCount(0);
          await expect(fee).not.toHaveAttribute('aria-invalid', 'true');
          await page.keyboard.press('Tab');
          await settle(page);
          const field = await fieldEvidence(page, FEE);
          expect(field.dom.value).toBe(recommendation);
          expect(field.dom.invalid).not.toBe('true');
          expect(field.native.description).not.toContain(highSafetyMessage);
          observations.afterSafetyCorrection = field;
          await requireZeroAmount();
          await expect(receiver).toHaveValue(MALFORMED);
          await revealFeedback(page, fee);
          await screenshot('positive-correction-after-safety-card');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: real Close and Send reentry retain usable local validation`,
        async () => {
          const close = page.getByRole('button', {
            name: en.buttons.close,
            exact: true,
          });
          await expect(close).toHaveCount(1);
          await close.click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged();
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/sys(?:\?.*)?$/);
          observations.reopenedBeforeEditing = {
            receiver: await receiver.inputValue(),
            amount: await amount.inputValue(),
            fee: await fee.inputValue(),
          };
          // Observe restored draft honestly, then establish each local control
          // through ordinary native edits rather than assuming a restore policy.
          await amount.fill('0');
          await receiver.fill(MALFORMED);
          await fee.fill('-1');
          await invalidNext();
          await observeFeeError('reentered-negative');
          await unchanged();
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: full public scope actual worker source and finite-wire gates precede candidate`,
        async () => {
          await unchanged();
          observations.workerAfter = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (identity) => {
              observations.workerAfter = identity;
            }
          );
          expect(observations.fields).toHaveLength(2);
          expect(reads).toContain(FEE_URL);
          expect(
            reads.some((url) => url.includes('/api/v2/xpub/' + xpub))
          ).toBe(true);
          expect(physicalCanaries).toHaveLength(2);
          expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
          expect(
            server.blocked.every(
              (method) => method === 'GET' || method === 'CONNECT'
            )
          ).toBe(true);
          expect(unsupported).toEqual([]);
          expect(writes).toEqual([]);
          expect(httpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(
            observations.routes.some((route: string) =>
              /\/send\/confirm/.test(route)
            )
          ).toBe(false);
          expect(reads.some((url) => /\/api\/v2\/(utxo|tx)\//.test(url))).toBe(
            false
          );
          expect(extensionEvidence()).toEqual(runtime);
          expect(sha(info.file)).toBe(sourceSha256);
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: observe whether native Fee exposes its current error association`,
        async () => {
          for (const observed of observations.fields)
            associated(observed.field, observed.message);
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: only after all original controls judge the blocking safety reason association`,
        async () => {
          expect(observations.highSafety).toBeDefined();
          expect(observations.lowerAdvisoryControl).toBeDefined();
          expect(observations.afterSafetyCorrection).toBeDefined();
          associated(
            observations.highSafety.field,
            observations.highSafety.message
          );
        }
      );
      await wallet.step(
        `${viewport.width}x${viewport.height}: a permitted focused fraction has no native whole-number constraint error`,
        async () => {
          const focused = observations.lowerAdvisoryFocused;
          expect(focused.dom.focused).toBe(true);
          expect(focused.dom.step).toBe('any');
          expect(focused.dom.validity.stepMismatch).toBe(false);
          expect(focused.dom.validity.valid).toBe(true);
          expect(focused.dom.validationMessage).toBe('');
          expect(focused.dom.invalid).not.toBe('true');
          expect(focused.native.properties.invalid).not.toBe('true');
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('send-fee-native-feedback-observations', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            physicalCanaries,
            reads,
            unsupported,
            writes,
            httpFailures,
            pageErrors,
            proxyDeniedMethods: server.blocked,
            syntheticHttpOnly: true,
            controllerStoreRendererOrControllerRepliesReplaced: false,
            runtimeTransportReplaced: false,
            nativeStateSettersUsed: false,
            signingApprovalBroadcastOrAssetImportRequested: false,
            connectionGranted: false,
            successfulNextOrPreviewRequested: false,
            transactionEstimateRequested: false,
            amountAlwaysZeroWhenNextActivated: true,
            primaryAXDescriptionReadDirectly: true,
            auditoryScreenReaderClaim: false,
            originals:
              'explicit natural fullPage:false caret:initial; existing step captures separate',
            nativeFieldMetadataMeasured: true,
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
