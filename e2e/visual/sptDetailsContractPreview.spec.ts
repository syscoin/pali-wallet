import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { SPT_GUID } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Exercise real preview and imported contract actions in a disposable wallet.
// Compare rendered targets only after the native lifecycle and exact-state guards.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const GUID = '123458';
const SYMBOL = 'PREVSPT';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const EXPECTED_BRIDGE_URL = 'https://explorer.tanenbaum.io/token/' + CONTRACT;
const ORIGINS = new Set([
  'https://blockbook-dev.syscoin.org',
  'https://explorer-blockbook-dev.syscoin.org',
]);
const COPY_SUCCESS_DEDUP_MS = 2000;
const FEEDS = new Map<string, unknown>([
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

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const storage = await chrome.storage.local.get([key, 'language']);
    const saved = storage[key];
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((account: any) => ({
            kind,
            id: account.id,
            label: account.label,
            address: account.address,
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const token = (asset: any) => ({
      id: asset.id ?? null,
      guid: asset.assetGuid === undefined ? null : String(asset.assetGuid),
      chainId: asset.chainId ?? null,
      symbol: asset.symbol ?? asset.tokenSymbol ?? null,
      name: asset.name ?? null,
      decimals: asset.decimals ?? null,
      contract: asset.contract ?? asset.contractAddress ?? null,
      originDecimals: asset.originDecimals ?? null,
      tokenId: asset.tokenId ?? null,
      assetType: asset.assetType ?? null,
      type: asset.type ?? null,
      balance: asset.balance === undefined ? null : String(asset.balance),
    });
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, families]: [string, any]) => ({
            kind,
            id: Number(id),
            ethereum: (families?.ethereum || []).map(token),
            syscoin: (families?.syscoin || []).map(token),
            nfts: (families?.nfts || []).map(token),
          }))
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
      },
      language: storage.language || 'en',
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(saved),
      liveAssets: assets(state.vault),
      savedAssets: assets(saved),
    };
  });

// The imported Details effect requests the source-owned complete asset refresh.
// Observe its exact target counters before comparing either viewport's pixels.
const hydratedTargetCounters = (page: Page) =>
  page.evaluate(async (guid) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const active = state.vault.activeAccount;
    const chainId = state.vault.activeNetwork.chainId;
    const asset = state.vault.accountAssets[active.type][
      active.id
    ].syscoin.find(
      (value: any) =>
        String(value.assetGuid) === guid && value.chainId === chainId
    );
    return {
      active,
      guid: asset?.assetGuid,
      chainId: asset?.chainId,
      contract: asset?.contract,
      balance: asset?.balance === undefined ? null : String(asset.balance),
      unconfirmedBalance:
        asset?.unconfirmedBalance === undefined
          ? null
          : String(asset.unconfirmedBalance),
      totalReceived:
        asset?.totalReceived === undefined ? null : String(asset.totalReceived),
      totalSent:
        asset?.totalSent === undefined ? null : String(asset.totalSent),
      transfers: asset?.transfers ?? null,
    };
  }, GUID);

type PublicState = Awaited<ReturnType<typeof publicState>>;
const target = (state: PublicState, side: 'liveAssets' | 'savedAssets') =>
  state[side].flatMap((group) =>
    group.syscoin
      .filter((asset) => asset.guid === GUID)
      .map((asset) => ({ kind: group.kind, accountId: group.id, ...asset }))
  );
const withoutTarget = (state: PublicState): PublicState => ({
  ...state,
  liveAssets: state.liveAssets.map((group) => ({
    ...group,
    syscoin: group.syscoin.filter((asset) => asset.guid !== GUID),
  })),
  savedAssets: state.savedAssets.map((group) => ({
    ...group,
    syscoin: group.syscoin.filter((asset) => asset.guid !== GUID),
  })),
});

const tabTo = async (page: Page, control: Locator) => {
  await expect(control).toHaveCount(1);
  for (let index = 0; index < 48; index += 1) {
    if (await control.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

// Only native wheel input reveals a real target in its current scroll owner.
const reveal = async (page: Page, control: Locator) => {
  const gestures: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const observed = await control.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const scrollable = (element: Element) => {
        const style = getComputedStyle(element);
        return (
          /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight
        );
      };
      let owner = node.parentElement;
      while (owner && !scrollable(owner)) owner = owner.parentElement;
      const clip = owner?.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        owner: clip
          ? {
              left: Math.max(0, clip.left + owner!.clientLeft),
              right: Math.min(
                innerWidth,
                clip.left + owner!.clientLeft + owner!.clientWidth
              ),
              top: Math.max(0, clip.top + owner!.clientTop),
              bottom: Math.min(
                innerHeight,
                clip.top + owner!.clientTop + owner!.clientHeight
              ),
            }
          : { left: 0, right: innerWidth, top: 0, bottom: innerHeight },
      };
    });
    if (
      observed.bounds.top >= observed.owner.top &&
      observed.bounds.bottom <= observed.owner.bottom &&
      observed.bounds.left >= observed.owner.left &&
      observed.bounds.right <= observed.owner.right
    )
      return gestures;
    const delta =
      observed.bounds.bottom > observed.owner.bottom
        ? Math.min(240, observed.bounds.bottom - observed.owner.bottom + 8)
        : -Math.min(240, observed.owner.top - observed.bounds.top + 8);
    await page.mouse.move(
      Math.max(1, (observed.owner.left + observed.owner.right) / 2),
      Math.max(1, (observed.owner.top + observed.owner.bottom) / 2)
    );
    gestures.push(delta);
    await page.mouse.wheel(0, delta);
    // Observe real frames, never assign scrolling or focus.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
  }
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  return gestures;
};

const copyGeometry = (copy: Locator) =>
  copy.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const glyph = node.querySelector('svg');
    const points = [
      [bounds.left + bounds.width / 4, bounds.top + bounds.height / 4],
      [bounds.right - bounds.width / 4, bounds.top + bounds.height / 4],
      [bounds.left + bounds.width / 4, bounds.bottom - bounds.height / 4],
      [bounds.right - bounds.width / 4, bounds.bottom - bounds.height / 4],
      [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
    ];
    return {
      box: bounds.toJSON(),
      glyph: glyph?.getBoundingClientRect().toJSON() ?? null,
      focused: node === document.activeElement,
      padding: [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ],
      outline: {
        style: style.outlineStyle,
        width: style.outlineWidth,
        color: style.outlineColor,
      },
      boxShadow: style.boxShadow,
      title: node.getAttribute('title'),
      ariaLabel: node.getAttribute('aria-label'),
      hits: points.map(([x, y]) => ({
        x,
        y,
        inside: node.contains(document.elementFromPoint(x, y)),
      })),
      meets44: bounds.width >= 44 && bounds.height >= 44,
    };
  });

test('SPT details retain known preview contract metadata and expose a consistent native Copy target', async ({}, info) => {
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
  const sourceHash = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  expect(GUID).not.toBe(SPT_GUID);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const mainnet = getNetworkConfig(57, 'sys');
  const signer = new sys.HDSigner(
    UTXO_FIXTURE_SEED,
    '',
    false,
    mainnet.networks,
    57,
    mainnet.types.zPubType,
    84
  );
  const initialXpub = signer.getAccountXpub();
  const initialQueries = new Set([
    'details=tokenBalances&tokens=used',
    'details=txsummary&pageSize=30',
    'details=tokenBalances&tokens=nonzero',
    'details=txslight&pageSize=30',
  ]);
  const metadata = {
    assetGuid: GUID,
    symbol: SYMBOL,
    name: SYMBOL,
    decimals: 8,
    assetType: 'ERC20',
    type: 'SPTAllocated',
    contract: CONTRACT,
    originDecimals: 18,
    maxSupply: '18446744073709551615',
    balance: '0',
    totalReceived: '0',
    totalSent: '0',
    transfers: 0,
  };
  const metadataReads: Array<{ href: string; payloadSha256: string }> = [];
  const unknownHttpFailures: Array<{ href: string; method: string }> = [];
  const forbidden: string[] = [];
  const pageErrors: string[] = [];
  const httpReads: Array<{ href: string; method: string }> = [];
  const observations: Record<string, any> = {
    runtime,
    sourceHash,
    guid: GUID,
    symbol: SYMBOL,
    contract: CONTRACT,
    previews: [],
    imported: [],
    nativeCopies: [],
  };
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SptContractPreviewSynthetic!2026',
    rpcUrl: server.url,
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
  });
  try {
    wallet = await PaliWallet.launch('spt-details-contract-preview', {
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
        if (FEEDS.has(url.href)) return FEEDS.get(url.href);
        if (
          [
            'https://blockbook.syscoin.org/api/v2/tickers/currency',
            'https://blockbook-dev.syscoin.org/api/v2/tickers/currency',
          ].includes(url.href)
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
          ORIGINS.has(url.origin) &&
          url.pathname === '/api/v2/asset/' + GUID &&
          url.searchParams.toString() === 'details=basic'
        ) {
          const payload = { asset: metadata };
          metadataReads.push({
            href: url.href,
            payloadSha256: createHash('sha256')
              .update(JSON.stringify(payload))
              .digest('hex'),
          });
          return payload;
        }
        return undefined;
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('requestfailed', (request) => {
      if (['http:', 'https:'].includes(new URL(request.url()).protocol))
        unknownHttpFailures.push({
          method: request.method(),
          href: request.url(),
        });
    });
    wallet.context.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol))
        httpReads.push({ method: request.method(), href: url.href });
      if (/\/sendtx(?:\/|$)/i.test(url.pathname)) forbidden.push('sendtx');
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
        // Read-only REST has no JSON body.
      }
    });
    const copyButton = () =>
      page.getByTitle(en.send.copyContractAddress, { exact: true });
    const detailsClose = () =>
      page
        .locator('#details-view-content')
        .getByRole('button', { name: en.buttons.close, exact: true });
    const detailsAction = () =>
      page.getByRole('button', {
        name: en.tokens.viewTokenDetails.replace('{{symbol}}', SYMBOL),
        exact: true,
      });
    let baseline!: PublicState;
    let importedBaseline!: PublicState;
    let lastCopySuccessAt = 0;
    const unchanged = async (expected: PublicState) =>
      expect(await publicState(page)).toEqual(expected);
    const readCopies = () =>
      page.evaluate(
        () => [...((window as any).__sptPreviewNativeCopies || [])] as string[]
      );
    const nativeCopy = async (phase: string) => {
      if (lastCopySuccessAt)
        await expect
          .poll(() => page.evaluate(() => Date.now()))
          .toBeGreaterThanOrEqual(lastCopySuccessAt + COPY_SUCCESS_DEDUP_MS);
      const before = await readCopies();
      await tabTo(page, copyButton());
      await page.keyboard.press('Enter');
      await expect.poll(readCopies).toEqual([...before, CONTRACT]);
      const notice = page.getByText(en.home.contractCopied, { exact: true });
      await expect(notice).toBeVisible();
      lastCopySuccessAt = await page.evaluate(() => Date.now());
      observations.nativeCopies.push({
        phase,
        completed: true,
        text: CONTRACT,
        successAt: lastCopySuccessAt,
      });
      await notice.click();
      await expect(notice).toBeHidden();
    };

    await wallet.step(
      'create the disposable wallet and prove the metadata-only GUID is absent from both inventories',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        observations.workerBefore = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            observations.workerBefore = value;
          }
        );
        baseline = await publicState(page);
        expect(baseline.active).toEqual({ id: 0, type: 'HDAccount' });
        expect(baseline.slip44).toBe(1);
        expect(baseline.network).toMatchObject({
          kind: 'syscoin',
          chainId: 5700,
        });
        expect(baseline.language).toBe('en');
        expect(
          baseline.liveAccounts.find(
            (account) =>
              account.kind === baseline.active.type &&
              account.id === baseline.active.id
          )?.address
        ).toBe(fixture.utxo.userAddress);
        expect(target(baseline, 'liveAssets')).toEqual([]);
        expect(target(baseline, 'savedAssets')).toEqual([]);
        observations.baseline = baseline;
        // Observe completion only after the real native clipboard write resolves.
        // This does not replace success, contents, DOM, wallet transport or state.
        await page.evaluate(() => {
          const original = navigator.clipboard.writeText.bind(
            navigator.clipboard
          );
          (window as any).__sptPreviewNativeCopies = [];
          navigator.clipboard.writeText = async (text) => {
            await original(text);
            (window as any).__sptPreviewNativeCopies.push(text);
          };
        });
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .click();
        await page.getByLabel(en.tokens.assetGuid, { exact: true }).fill(GUID);
        await expect(
          page.getByRole('button', {
            name: en.tokens.importNamedToken.replace('{{symbol}}', SYMBOL),
            exact: true,
          })
        ).toBeEnabled();
        expect(metadataReads.length).toBeGreaterThan(0);
        await unchanged(baseline);
      }
    );

    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.step(
        viewport.width +
          'px ordinary unimported Details exposes its real preview state',
        async (capture) => {
          await tabTo(page, detailsAction());
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect(
            page.getByText(SYMBOL + ' (Syscoin Testnet)', { exact: true })
          ).toBeAttached();
          const route = await page.evaluate(() => {
            const value = window.history.state?.usr;
            return {
              id: value?.id,
              guid: value?.assetGuid,
              contract: value?.contract,
              symbol: value?.symbol,
              chainId: value?.chainId ?? null,
              preview: value?.isImportPreview,
            };
          });
          expect(route).toMatchObject({
            id: GUID,
            guid: GUID,
            contract: CONTRACT,
            symbol: SYMBOL,
            preview: true,
          });
          const count = await copyButton().count();
          const bridgeCount = await page
            .locator('a[href="' + EXPECTED_BRIDGE_URL + '"]')
            .count();
          let geometry = null;
          let gestures: number[] = [];
          if (count === 1) {
            gestures = await reveal(page, copyButton());
            await tabTo(page, copyButton());
            await page.mouse.move(2, 2);
            geometry = await copyGeometry(copyButton());
          } else {
            gestures = await reveal(page, detailsClose());
            await tabTo(page, detailsClose());
          }
          observations.previews.push({
            viewport,
            route,
            copyCount: count,
            bridgeCount,
            geometry,
            gestures,
          });
          await unchanged(baseline);
          await capture(page);
          if (count === 1) {
            await nativeCopy('preview-' + viewport.width);
            await unchanged(baseline);
          }
        }
      );
      await wallet.step(
        viewport.width +
          'px actual Details Back or Close restores the same custom GUID without an import',
        async () => {
          const back =
            viewport.width === 400
              ? page.getByRole('button', { name: 'Back', exact: true })
              : detailsClose();
          await tabTo(page, back);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/tokens\/add\?[^#]*tab=custom/);
          await expect(
            page.getByLabel(en.tokens.assetGuid, { exact: true })
          ).toHaveValue(GUID);
          await expect(
            page.getByRole('button', {
              name: en.tokens.importNamedToken.replace('{{symbol}}', SYMBOL),
              exact: true,
            })
          ).toBeEnabled();
          await unchanged(baseline);
        }
      );
    }

    await wallet.step(
      'import only the same metadata GUID through the real local mutation and verify exact durable membership',
      async () => {
        await page.setViewportSize({ width: 400, height: 620 });
        const action = page.getByRole('button', {
          name: en.tokens.importNamedToken.replace('{{symbol}}', SYMBOL),
          exact: true,
        });
        await tabTo(page, action);
        await page.keyboard.press('Enter');
        await expect(
          page.getByText(
            en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', SYMBOL),
            { exact: true }
          )
        ).toBeVisible();
        await expect
          .poll(async () => {
            const state = await publicState(page);
            return {
              baseline: withoutTarget(state),
              live: target(state, 'liveAssets'),
              saved: target(state, 'savedAssets'),
            };
          })
          .toEqual({
            baseline,
            live: [
              {
                kind: 'HDAccount',
                accountId: 0,
                id: null,
                guid: GUID,
                chainId: 5700,
                symbol: SYMBOL,
                name: SYMBOL,
                decimals: 8,
                contract: CONTRACT,
                originDecimals: 18,
                tokenId: null,
                assetType: 'ERC20',
                type: 'SPTAllocated',
                balance: '0',
              },
            ],
            saved: [
              {
                kind: 'HDAccount',
                accountId: 0,
                id: null,
                guid: GUID,
                chainId: 5700,
                symbol: SYMBOL,
                name: SYMBOL,
                decimals: 8,
                contract: CONTRACT,
                originDecimals: 18,
                tokenId: null,
                assetType: 'ERC20',
                type: 'SPTAllocated',
                balance: '0',
              },
            ],
          });
        importedBaseline = await publicState(page);
        observations.importedBaseline = importedBaseline;
        observations.localImportCompleted = true;
        const notice = page.getByText(
          en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', SYMBOL),
          { exact: true }
        );
        await notice.click();
        await expect(notice).toBeHidden();
        const back = page.getByRole('button', { name: 'Back', exact: true });
        await tabTo(page, back);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await unchanged(importedBaseline);
      }
    );

    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await wallet.step(
        viewport.width +
          'px imported Assets Details is the healthy exact-contract control',
        async (capture) => {
          await page.locator('#assets-btn').click();
          await tabTo(page, detailsAction());
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect(copyButton()).toHaveCount(1);
          await expect(
            page.locator('a[href="' + EXPECTED_BRIDGE_URL + '"]')
          ).toHaveCount(1);
          await expect
            .poll(() => hydratedTargetCounters(page))
            .toEqual({
              active: { id: 0, type: 'HDAccount' },
              guid: GUID,
              chainId: 5700,
              contract: CONTRACT,
              balance: '0',
              unconfirmedBalance: '0',
              totalReceived: '0',
              totalSent: '0',
              transfers: 0,
            });
          const counters = await hydratedTargetCounters(page);
          // The worker can publish before the renderer's store update commits.
          // Match the actual hydrated rows as well as their public source data.
          await expect(
            page.getByText(en.transactionDisplay.totalSent, { exact: true })
          ).toHaveCount(1);
          await expect(
            page.getByText(en.transactionDisplay.totalReceived, { exact: true })
          ).toHaveCount(1);
          const gestures = await reveal(page, copyButton());
          await tabTo(page, copyButton());
          await page.mouse.move(2, 2);
          const geometry = await copyGeometry(copyButton());
          expect(geometry.focused).toBe(true);
          expect(geometry.hits.every((point) => point.inside)).toBe(true);
          observations.imported.push({
            viewport,
            counters,
            copyCount: 1,
            bridgeCount: 1,
            geometry,
            gestures,
          });
          await unchanged(importedBaseline);
          await capture(page);
          await nativeCopy('imported-' + viewport.width);
          await unchanged(importedBaseline);
        }
      );
      await wallet.step(
        viewport.width +
          'px actual imported Details Close returns to Assets with only the intended import',
        async () => {
          await tabTo(page, detailsClose());
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await unchanged(importedBaseline);
        }
      );
    }
    await wallet.step(
      'complete all exact-record source-worker and network fences before independent contract regression checks',
      async () => {
        await unchanged(importedBaseline);
        expect(withoutTarget(importedBaseline)).toEqual(baseline);
        observations.workerAfter = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (value) => {
            observations.workerAfter = value;
          }
        );
        expect(metadataReads.length).toBeGreaterThan(0);
        expect(routes!.deniedWrites).toEqual([]);
        expect(forbidden).toEqual([]);
        expect(unknownHttpFailures).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(sourceHash);
        observations.contractChecks = {
          previewContractRetained: observations.previews.every(
            (value: any) =>
              value.route.contract === CONTRACT &&
              value.copyCount === 1 &&
              value.bridgeCount === 1
          ),
          importedContractCopyMeets44: observations.imported.every(
            (value: any) => value.geometry.meets44
          ),
        };
      }
    );
    await wallet.step(
      'verify preview retention and native Copy target after healthy controls',
      async () => {
        expect(observations.contractChecks).toEqual({
          previewContractRetained: true,
          importedContractCopyMeets44: true,
        });
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('spt-details-contract-preview-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          observations,
          metadataReads,
          httpReads,
          unknownHttpFailures,
          forbidden,
          pageErrors,
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedConnections: server.blocked.length,
          controllerStateReplaced: false,
          controllerRepliesReplaced: false,
          runtimeTransportReplaced: false,
          DOMScrollOrFocusInjectedByProbe: false,
          nativeClipboardObserverDelegatesOriginal: true,
          importedLocallyThroughOrdinaryUI:
            observations.localImportCompleted === true,
          signingDeploymentOrBroadcastRequested: false,
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
