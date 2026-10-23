import { expect, test, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { SPT_GUID, SPT_SYMBOL, sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// fetchBackendAccountWrapper retains a request until completion +100ms, and
// removes any older request at its existing 5s CACHE_TTL. Hold only fixture
// metadata past that source-owned upper bound; never mutate a wallet cache.
const ACCOUNT_REQUEST_CACHE_TTL_MS = 5000;
const origins = [
  'https://blockbook-dev.syscoin.org',
  'https://explorer-blockbook-dev.syscoin.org',
];
// Real late-startup advisory reads, with their exact canonical URLs and the
// same empty public data shapes used by other fenced wallet fixtures.
const BLACKLIST_FEEDS = new Map<string, unknown>([
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

// Read only public account, network and imported-token projections. Neither
// runtime/controller replies nor live or persisted wallet state are replaced.
const publicAssets = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const active = state.vault.activeAccount;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get(key);
    const project = (vault: any) =>
      (vault?.accountAssets?.[active.type]?.[active.id]?.syscoin || [])
        .filter((asset: any) => asset.assetGuid !== undefined)
        .map((asset: any) => ({
          guid: String(asset.assetGuid),
          hasBalance: Object.prototype.hasOwnProperty.call(asset, 'balance'),
          balance: asset.balance === undefined ? null : String(asset.balance),
          chainId: asset.chainId,
        }));
    return {
      active,
      address: state.vault.accounts[active.type][active.id].address,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      live: project(state.vault),
      persisted: project(saved[key]),
    };
  });

const targetHoldings = (
  assets: Array<{
    balance: string | null;
    chainId: number;
    guid: string;
    hasBalance: boolean;
  }>
) => assets.filter((asset) => asset.guid === SPT_GUID);

const previewEvidence = async (page: Page) => {
  const row = page
    .getByRole('button', {
      name: en.tokens.importNamedToken.replace('{{symbol}}', SPT_SYMBOL),
      exact: true,
    })
    .locator('xpath=ancestor::li');
  const dom = await row.evaluate((element) => ({
    text: (element as HTMLElement).innerText,
    titles: Array.from(element.querySelectorAll('[title]')).map((node) =>
      node.getAttribute('title')
    ),
    accessibility: Array.from(
      element.querySelectorAll('[role], [aria-label], [aria-description]')
    ).map((node) => ({
      role: node.getAttribute('role'),
      label: node.getAttribute('aria-label'),
      description: node.getAttribute('aria-description'),
    })),
  }));
  const alerts = await page.getByRole('alert').allTextContents();
  const cdp = await page.context().newCDPSession(page);
  try {
    const tree = await cdp.send('Accessibility.getFullAXTree');
    return {
      ...dom,
      alerts,
      nativeAx: tree.nodes
        .filter((node: any) => !node.ignored)
        .map((node: any) => ({
          nodeId: node.nodeId,
          role: node.role?.value,
          name: node.name?.value,
          description: node.description?.value,
          properties: node.properties,
          childIds: node.childIds,
        })),
    };
  } finally {
    await cdp.detach();
  }
};

for (const scenario of [
  { mode: 'held', recovery: 'held' },
  { mode: 'empty', recovery: 'empty' },
  { mode: 'unavailable', recovery: 'held' },
  { mode: 'unavailable', recovery: 'empty' },
] as const) {
  const { mode, recovery } = scenario;
  test(`SPT custom import reports ${mode} inventory and ${recovery} recovery`, async ({}, info) => {
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
    // A newly created wallet briefly reads its default mainnet account before
    // ordinary Settings switches to testnet. Derive only that synthetic public
    // account, using the installed keyring's network and HDSigner parameters.
    const mainnetConfig = getNetworkConfig(57, 'sys');
    const mainnetSigner = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      mainnetConfig.networks,
      57,
      mainnetConfig.types.zPubType,
      84
    );
    const initialXpub = mainnetSigner.getAccountXpub();
    const initialMainnetQueries = new Set([
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ]);
    const tickerUrls = new Set([
      'https://blockbook.syscoin.org/api/v2/tickers/currency',
      'https://blockbook-dev.syscoin.org/api/v2/tickers/currency',
    ]);
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'SptAvailabilitySynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
    });
    let inventoryMode: 'setup' | 'held' | 'empty' | 'unavailable' = 'setup';
    let lastSetupInventoryAt = 0;
    let scenarioArmedAt = 0;
    const actualHttpResponses: Array<{
      at: number;
      path: string;
      query: string;
      status: number;
    }> = [];
    const reads: Array<Record<string, unknown>> = [];
    const blacklistReads: string[] = [];
    const walletHttpReads: Array<{ method: string; url: string }> = [];
    const unexpectedWalletHttpFailures: Array<{
      method: string;
      url: string;
    }> = [];
    const forbiddenRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = {
      mode,
      recovery,
      runtime,
      sourceSha256,
      canonicalGuid: SPT_GUID,
      expectedKnownHolding:
        mode === 'held' ? '25.0' : mode === 'empty' ? '0' : null,
      accountRequestCacheTtlMs: ACCOUNT_REQUEST_CACHE_TTL_MS,
      syntheticHttpOnly: true,
      replacementBoundaries: [],
      milestones: {},
    };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`spt-balance-${mode}-${recovery}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          walletHttpReads.push({
            method: request.method(),
            url: request.url(),
          });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname))
          forbiddenRequests.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          // Ordinary read-only REST requests have no JSON body.
        }
      });
      // Browser/platform connections caught by the launch-time deny proxy are
      // evidence-only. Unfulfilled HTTP from this wallet context is a distinct
      // fixture failure and is asserted absent, never silently allowlisted.
      wallet.context.on('requestfailed', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          unexpectedWalletHttpFailures.push({
            method: request.method(),
            url: request.url(),
          });
      });
      wallet.context.on('response', (response) => {
        const url = new URL(response.url());
        if (
          origins.includes(url.origin) &&
          url.searchParams.get('details') === 'tokenBalances' &&
          [
            `/api/v2/xpub/${fixture.utxo.userXpub}`,
            `/api/v2/address/${fixture.utxo.userAddress}`,
          ].includes(url.pathname)
        )
          actualHttpResponses.push({
            at: Date.now(),
            path: url.pathname,
            query: url.search,
            status: response.status(),
          });
      });
      await wallet.context.route(
        (url) => BLACKLIST_FEEDS.has(url.href),
        async (route) => {
          const request = route.request();
          if (request.method() !== 'GET') return route.abort('blockedbyclient');
          blacklistReads.push(request.url());
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(BLACKLIST_FEEDS.get(request.url())),
          });
        }
      );
      await wallet.context.route(
        (url) =>
          tickerUrls.has(url.href) ||
          (url.origin === 'https://blockbook.syscoin.org' &&
            url.pathname === `/api/v2/xpub/${initialXpub}` &&
            initialMainnetQueries.has(url.searchParams.toString())),
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() !== 'GET') return route.fallback();
          const ticker = tickerUrls.has(url.href);
          reads.push({
            at: Date.now(),
            family: ticker ? 'native-fiat-ticker' : 'initial-mainnet-account',
            path: url.pathname,
            query: url.search,
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(
              ticker
                ? { ts: 1, rates: { usd: 1 } }
                : {
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
                  }
            ),
          });
        }
      );
      // Startup holdings are always complete and EMPTY. The held value of 25
      // does not exist in any response until the explicit scenario is armed.
      await wallet.context.route(
        (url) =>
          origins.includes(url.origin) &&
          (url.pathname === `/api/v2/asset/${SPT_GUID}` ||
            [
              `/api/v2/xpub/${fixture.utxo.userXpub}`,
              `/api/v2/address/${fixture.utxo.userAddress}`,
            ].includes(url.pathname)),
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() !== 'GET') return route.fallback();
          if (url.pathname === `/api/v2/asset/${SPT_GUID}`) {
            expect(url.searchParams.get('details')).toBe('basic');
            const requestedAt = Date.now();
            // Request-cache insertion precedes its HTTP arrival at this route.
            // At release, cleanupCache in the actual validator's subsequent
            // holdings read cannot reuse any pre-arm successful entry.
            const expiryAt =
              lastSetupInventoryAt + ACCOUNT_REQUEST_CACHE_TTL_MS + 1;
            await new Promise((resolve) =>
              setTimeout(resolve, Math.max(0, expiryAt - Date.now()))
            );
            const releasedAt = Date.now();
            expect(releasedAt - lastSetupInventoryAt).toBeGreaterThan(
              ACCOUNT_REQUEST_CACHE_TTL_MS
            );
            const base = sptFixtureRead(fixture.utxo, request.url(), 'GET') as {
              asset: Record<string, unknown>;
            };
            reads.push({
              family: 'metadata',
              requestedAt,
              releasedAt,
              lastSetupInventoryAt,
              phase: inventoryMode,
              path: url.pathname,
              status: 200,
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({
                asset: {
                  ...base.asset,
                  assetGuid: SPT_GUID,
                  symbol: SPT_SYMBOL,
                  decimals: 2,
                  balance: '2500',
                  unconfirmedBalance: '0',
                  totalReceived: '2500',
                  totalSent: '0',
                },
              }),
            });
          }
          const base = sptFixtureRead(
            fixture.utxo,
            request.url(),
            request.method()
          ) as { tokensAsset?: Array<Record<string, unknown>> } | undefined;
          if (!base?.tokensAsset) return route.fallback();
          const isInventory =
            url.searchParams.get('details') === 'tokenBalances';
          const responseMode = inventoryMode;
          const at = Date.now();
          if (isInventory && responseMode === 'setup')
            lastSetupInventoryAt = at;
          const failed = isInventory && responseMode === 'unavailable';
          const statusCode = failed ? 500 : 200;
          reads.push({
            family: isInventory ? 'inventory' : 'account-summary',
            at,
            phase: responseMode,
            path: url.pathname,
            query: url.search,
            status: statusCode,
            holdingGuids:
              isInventory && responseMode === 'held' ? [SPT_GUID] : [],
          });
          return route.fulfill({
            status: statusCode,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(
              failed
                ? { error: 'Synthetic inventory temporarily unavailable' }
                : {
                    ...base,
                    tokensAsset:
                      isInventory && responseMode === 'held'
                        ? base.tokensAsset.map((asset) => ({
                            ...asset,
                            assetGuid: SPT_GUID,
                            decimals: 2,
                            balance: '2500',
                            unconfirmedBalance: '0',
                            totalReceived: '2500',
                            totalSent: '0',
                          }))
                        : [],
                  }
            ),
          });
        }
      );
      observations.workerIdentity = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (value) => {
          observations.workerIdentity = value;
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet.ensureOnHome();
      // Enable the existing manual Refresh control through ordinary settings.
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page
        .getByRole('menuitem', { name: en.generalMenu.advanced, exact: true })
        .click();
      await page.locator('#advanced-refresh').click();
      await page.getByRole('dialog').locator('#confirm-btn').click();
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await wallet.ensureOnHome();
      const refresh = page.getByRole('button', {
        name: en.header.refresh,
        exact: true,
      });
      await expect(refresh).toBeEnabled();
      observations.initial = await publicAssets(page);
      expect(observations.initial.network).toMatchObject({ chainId: 5700 });
      expect(targetHoldings(observations.initial.live)).toEqual([]);
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.home.importToken, exact: true })
        .click();
      await page
        .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
        .click();
      await expect.poll(() => lastSetupInventoryAt).toBeGreaterThan(0);
      const input = page.getByRole('textbox', {
        name: en.tokens.assetGuid,
        exact: true,
      });
      const action = page.getByRole('button', {
        name: en.tokens.importNamedToken.replace('{{symbol}}', SPT_SYMBOL),
        exact: true,
      });
      const preview = action
        .locator('xpath=ancestor::li')
        .locator('span.text-brand-white.font-medium');
      const project = async () => {
        const state = await publicAssets(page);
        return {
          live: targetHoldings(state.live),
          persisted: targetHoldings(state.persisted),
        };
      };
      inventoryMode = mode;
      scenarioArmedAt = Date.now();
      observations.scenarioArmedAt = scenarioArmedAt;
      observations.lastSetupInventoryAt = lastSetupInventoryAt;
      await input.fill(SPT_GUID);
      // The only added delay is the real fixture HTTP metadata response above.
      // Keep the harness's existing action/expect budgets unchanged.
      await action.waitFor({ state: 'visible' });
      await expect(action).toBeEnabled();
      await expect
        .poll(() =>
          actualHttpResponses.some(
            (response) =>
              response.at >= scenarioArmedAt &&
              response.status === (mode === 'unavailable' ? 500 : 200) &&
              response.query.includes('tokens=nonzero')
          )
        )
        .toBe(true);
      expect(
        reads.some(
          (read) =>
            read.family === 'metadata' &&
            read.phase === mode &&
            Number(read.releasedAt) - Number(read.lastSetupInventoryAt) >
              ACCOUNT_REQUEST_CACHE_TTL_MS
        )
      ).toBe(true);
      observations.preview = {
        balance: await preview.innerText(),
        ...(await previewEvidence(page)),
      };
      observations.beforeImport = await project();
      expect(observations.beforeImport).toEqual({ live: [], persisted: [] });

      if (mode === 'held') await expect(preview).toHaveText('25');
      else if (mode === 'empty') await expect(preview).toHaveText('0');
      else {
        await expect(preview).toHaveText(en.settings.unavailable);
        await wallet.step(
          `${recovery}: unavailable custom preview`,
          async (capture) => {
            await capture(page);
          }
        );
      }

      await action.click();
      await expect(action).toBeDisabled();
      await expect
        .poll(async () => {
          const state = await project();
          return { live: state.live.length, persisted: state.persisted.length };
        })
        .toEqual({ live: 1, persisted: 1 });
      observations.afterImport = await project();
      const expectedInitial = [
        {
          guid: SPT_GUID,
          hasBalance: true,
          balance: mode === 'held' ? '25.0' : '0',
          chainId: 5700,
        },
      ];
      if (mode !== 'unavailable') {
        expect(observations.afterImport).toEqual({
          live: expectedInitial,
          persisted: expectedInitial,
        });
      } else {
        expect(observations.afterImport.live).toEqual([
          { guid: SPT_GUID, hasBalance: false, balance: null, chainId: 5700 },
        ]);
        expect(observations.afterImport.persisted).toEqual(
          observations.afterImport.live
        );
      }
      observations.milestones.manualImportPreserved = true;
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await wallet.ensureOnHome();

      if (mode === 'unavailable') {
        await page.locator('#assets-btn').click();
        const homeRow = page
          .getByText(SPT_SYMBOL, { exact: true })
          .locator('xpath=ancestor::li');
        await expect(
          homeRow.getByText(en.settings.unavailable, { exact: true })
        ).toBeVisible();
        await homeRow.getByText(SPT_SYMBOL, { exact: true }).click();
        await expect(page).toHaveURL(/#\/home\/details/);
        await expect(
          page.getByText(en.settings.unavailable, { exact: true })
        ).toBeVisible();
        await wallet.step(
          `${recovery}: unavailable saved details`,
          async (capture) => {
            await capture(page);
          }
        );
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await wallet.ensureOnHome();
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        const picker = page.locator('#send-form button[aria-haspopup="menu"]');
        await picker.click();
        await page
          .getByRole('menuitem')
          .filter({ hasText: SPT_SYMBOL })
          .click();
        const amount = page.locator('#with-max-button');
        const max = page.getByRole('button', {
          name: en.send.max,
          exact: true,
        });
        await expect(max).toBeDisabled();
        await expect(
          page.getByText(en.settings.unavailable, { exact: true })
        ).toBeVisible();
        await amount.fill('1');
        await page
          .getByPlaceholder(en.send.receiver, { exact: true })
          .fill(fixture.utxo.userAddress);
        const next = page.getByRole('button', {
          name: en.buttons.next,
          exact: true,
        });
        await next.click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await expect(amount).toHaveValue('1');
        await amount.press('Enter');
        await expect(page).toHaveURL(/#\/send\/sys$/);
        expect(
          wallet.context
            .pages()
            .some((candidate) => candidate.url().includes('/external'))
        ).toBe(false);
        await wallet.step(
          `${recovery}: unavailable Send refuses progression`,
          async (capture) => {
            await capture(page);
          }
        );
        const lastFailure = [...reads]
          .reverse()
          .find((read) => read.family === 'inventory' && read.status === 500);
        expect(lastFailure).toBeDefined();
        const failedReadAt = Number(lastFailure!.at);
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(
              0,
              failedReadAt + ACCOUNT_REQUEST_CACHE_TTL_MS + 1 - Date.now()
            )
          )
        );
        // Do not let a cached failed reply stand in for the fresh healthy read.
        // A new background failure during this wait is a fixture precondition
        // failure, not a reason to retry or alter the wallet cache.
        expect(
          [...reads]
            .reverse()
            .find((read) => read.family === 'inventory' && read.status === 500)
            ?.at
        ).toBe(failedReadAt);
        expect(Date.now() - failedReadAt).toBeGreaterThan(
          ACCOUNT_REQUEST_CACHE_TTL_MS
        );
        const recoveredAt = Date.now();
        inventoryMode = recovery;
        observations.recoveredAt = recoveredAt;
        await refresh.click();
        await expect
          .poll(() =>
            actualHttpResponses.some(
              (response) =>
                response.at >= recoveredAt &&
                response.status === 200 &&
                response.query.includes('tokens=used')
            )
          )
          .toBe(true);
        const recovered = [
          {
            guid: SPT_GUID,
            hasBalance: true,
            balance: recovery === 'held' ? '25.0' : '0',
            chainId: 5700,
          },
        ];
        await expect
          .poll(async () => (await project()).live)
          .toEqual(recovered);
        observations.afterNormalRefresh = await project();
        await expect(amount).toHaveValue('1');
        await expect(max).toBeEnabled();
        await expect(
          page.getByText(en.settings.unavailable, { exact: true })
        ).toHaveCount(0);
        // Refreshing availability must not turn a retained manual amount into
        // a live MAX draft. A user can choose MAX explicitly after recovery.
        await max.click();
        await expect(amount).toHaveValue(recovery === 'held' ? '25.0' : '0');
        observations.milestones.normalRefreshRecoveredBalance = true;
      }
      const beforeReload = await project();
      // Refresh publishes balances to the live store without a vault write.
      // Reload ends MainApp's real popup-connection port; its background
      // disconnect handler persists the live vault through emergencySave.
      // Check durability after that ordinary lifecycle boundary, not before it.
      await page.reload();
      await wallet.ensureOnHome();
      await expect.poll(project).toEqual({
        live: beforeReload.live,
        persisted: beforeReload.live,
      });
      observations.afterReload = await project();
      observations.milestones.reloadPreservedActualState = true;
      expect(reads.some((read) => read.family === 'metadata')).toBe(true);
      expect(reads.some((read) => read.family === 'inventory')).toBe(true);
      expect(routes.deniedWrites).toEqual([]);
      expect(forbiddenRequests).toEqual([]);
      expect(unexpectedWalletHttpFailures).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(sourceSha256);
      observations.milestones.safetyHealthy = true;
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        await info.attach('spt-balance-availability-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            ...observations,
            status,
            reads,
            actualHttpResponses,
            blacklistReads,
            walletHttpReads,
            unexpectedWalletHttpFailures,
            forbiddenRequests,
            pageErrors,
            fixtureReadCount: routes?.reads.length,
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedConnections: server.blocked.length,
            proxyDeniedConnectionsArePlatformEvidenceOnly: true,
            noSendUiOpened: true,
            noControllerOrStateReplacement: true,
            noCacheMutationOrClockReplacement: true,
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
}
