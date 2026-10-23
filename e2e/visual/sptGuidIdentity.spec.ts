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

const PADDED_GUID = `000${SPT_GUID}`;
const ZERO_GUID = '456';
const ZERO_SYMBOL = 'ZERO';
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
          balance: String(asset.balance),
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

const numericHolding = (
  assets: Array<{ guid: string; balance: string; chainId: number }>
) => assets.filter((asset) => BigInt(asset.guid).toString() === SPT_GUID);

for (const mode of ['padded first', 'canonical first'] as const) {
  test(`SPT custom import preserves numeric GUID identity with ${mode}`, async ({}, info) => {
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
      password: 'SptGuidSynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
    });
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
      runtime,
      sourceSha256,
      canonicalGuid: SPT_GUID,
      paddedGuid: PADDED_GUID,
      expectedHolding: '25.0',
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
      wallet = await PaliWallet.launch(`spt-guid-${mode.replace(' ', '-')}`, {
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
      // Change only the public Blockbook DTO. The real server parses uint64
      // from a decimal path but echoes the raw path in metadata; holdings use
      // canonical decimal GUIDs. Do not simulate normalization in this fixture.
      await wallet.context.route(
        (url) =>
          origins.includes(url.origin) &&
          (/^\/api\/v2\/asset\/\d+$/.test(url.pathname) ||
            [
              `/api/v2/xpub/${fixture.utxo.userXpub}`,
              `/api/v2/address/${fixture.utxo.userAddress}`,
            ].includes(url.pathname)),
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() !== 'GET') return route.fallback();
          const match = url.pathname.match(/^\/api\/v2\/asset\/(\d+)$/);
          if (match) {
            const rawGuid = match[1];
            const numericGuid = BigInt(rawGuid).toString();
            if (![SPT_GUID, ZERO_GUID].includes(numericGuid))
              return route.fallback();
            expect(url.searchParams.get('details')).toBe('basic');
            const base = sptFixtureRead(
              fixture.utxo,
              `${url.origin}/api/v2/asset/${SPT_GUID}`,
              'GET'
            ) as { asset: Record<string, unknown> };
            const asset = {
              ...base.asset,
              assetGuid: rawGuid,
              symbol: numericGuid === SPT_GUID ? SPT_SYMBOL : ZERO_SYMBOL,
              decimals: 2,
              balance: numericGuid === SPT_GUID ? '2500' : '0',
              unconfirmedBalance: '0',
              totalReceived: numericGuid === SPT_GUID ? '2500' : '0',
              totalSent: '0',
            };
            reads.push({
              at: Date.now(),
              path: url.pathname,
              query: url.search,
              rawGuid,
              numericGuid,
              returnedGuid: asset.assetGuid,
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({ asset }),
            });
          }
          const base = sptFixtureRead(
            fixture.utxo,
            request.url(),
            request.method()
          ) as { tokensAsset?: Array<Record<string, unknown>> } | undefined;
          if (!base?.tokensAsset) return route.fallback();
          reads.push({
            at: Date.now(),
            path: url.pathname,
            query: url.search,
            holdingGuids: [SPT_GUID],
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              ...base,
              tokensAsset: base.tokensAsset.map((asset) => ({
                ...asset,
                assetGuid: SPT_GUID,
                decimals: 2,
                balance: '2500',
                unconfirmedBalance: '0',
                totalReceived: '2500',
                totalSent: '0',
              })),
            }),
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
      observations.initial = await publicAssets(page);
      expect(observations.initial.network).toMatchObject({ chainId: 5700 });
      expect(numericHolding(observations.initial.live)).toEqual([]);
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.home.importToken, exact: true })
        .click();
      await page
        .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
        .click();
      const input = page.getByRole('textbox', {
        name: en.tokens.assetGuid,
        exact: true,
      });
      const action = (symbol = SPT_SYMBOL) =>
        page.getByRole('button', {
          name: en.tokens.importNamedToken.replace('{{symbol}}', symbol),
          exact: true,
        });
      const preview = (symbol = SPT_SYMBOL) =>
        action(symbol)
          .locator('xpath=ancestor::li')
          .locator('span.text-brand-white.font-medium');
      const waitForStoredCount = (count: number) =>
        expect
          .poll(async () => {
            const state = await publicAssets(page);
            return {
              live: numericHolding(state.live).length,
              persisted: numericHolding(state.persisted).length,
            };
          })
          .toEqual({ live: count, persisted: count });
      const expectedHolding = [
        { guid: SPT_GUID, balance: '25.0', chainId: 5700 },
      ];

      if (mode === 'canonical first') {
        await input.fill(SPT_GUID);
        await expect(action()).toBeEnabled();
        await expect(preview()).toHaveText('25');
        await action().click();
        await expect(action()).toBeDisabled();
        await waitForStoredCount(1);
        const canonical = await publicAssets(page);
        expect(numericHolding(canonical.live)).toEqual(expectedHolding);
        expect(numericHolding(canonical.persisted)).toEqual(expectedHolding);
        observations.canonicalHealthy = canonical;
        observations.milestones.canonicalHealthy = true;
      }

      await input.fill(PADDED_GUID);
      await expect(action()).toBeVisible();
      await expect(page.locator('#custom-spt-guid')).toHaveValue(PADDED_GUID);
      observations.paddedPreview = {
        balance: await preview().innerText(),
        disabled: await action().isDisabled(),
      };
      // Candidate assertions are soft: retain actual import/rejection, unowned
      // healthy control and reload proof even when the baseline is incorrect.
      await expect.soft(preview()).toHaveText('25');
      if (mode === 'canonical first')
        await expect.soft(action()).toBeDisabled();
      else await expect(action()).toBeEnabled();
      const importsAlias = await action().isEnabled();
      if (importsAlias) {
        await action().click();
        await expect(action()).toBeDisabled();
      }
      await waitForStoredCount(
        mode === 'canonical first' && importsAlias ? 2 : 1
      );
      observations.afterAlias = await publicAssets(page);
      expect
        .soft(numericHolding(observations.afterAlias.live))
        .toEqual(expectedHolding);
      expect
        .soft(numericHolding(observations.afterAlias.persisted))
        .toEqual(expectedHolding);
      observations.milestones.aliasActualOutcomeRecorded = true;

      await input.fill(ZERO_GUID);
      await expect(action(ZERO_SYMBOL)).toBeEnabled();
      await expect(preview(ZERO_SYMBOL)).toHaveText('0');
      await action(ZERO_SYMBOL).click();
      await expect(action(ZERO_SYMBOL)).toBeDisabled();
      const zero = [{ guid: ZERO_GUID, balance: '0', chainId: 5700 }];
      await expect
        .poll(async () => {
          const state = await publicAssets(page);
          return {
            live: state.live.filter((asset: any) => asset.guid === ZERO_GUID),
            persisted: state.persisted.filter(
              (asset: any) => asset.guid === ZERO_GUID
            ),
          };
        })
        .toEqual({ live: zero, persisted: zero });
      observations.milestones.unownedZeroHealthy = true;
      const beforeReload = await publicAssets(page);
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await wallet.ensureOnHome();
      await page.reload();
      await wallet.ensureOnHome();
      observations.afterReload = await publicAssets(page);
      // This is a durability control for the ACTUAL outcome, not an assumption
      // that the intended GUID normalization already occurred.
      expect(observations.afterReload).toEqual(beforeReload);
      observations.milestones.reloadPreservedActualState = true;
      expect(reads.some((read) => read.numericGuid === SPT_GUID)).toBe(true);
      expect(reads.some((read) => read.numericGuid === ZERO_GUID)).toBe(true);
      expect(reads.some((read) => Array.isArray(read.holdingGuids))).toBe(true);
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
        await info.attach('spt-guid-identity-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            ...observations,
            status,
            reads,
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
