import { expect, test, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CONTRACT = '0x000000000000000000000000000000000000e721';
const SYMBOL = 'READ721';
const RPC_URL = 'https://rpc.tanenbaum.io/';
const CHAIN_ID = 5700;
const abi = AbiCoder.defaultAbiCoder();
const selector = (signature: string) => id(signature).slice(0, 10);
const balanceSelector = selector('balanceOf(address)');
const importName = en.tokens.importNamedToken.replace('{{symbol}}', SYMBOL);
const detailsName = en.tokens.viewTokenDetails.replace('{{symbol}}', SYMBOL);

// Exact advisory feeds used by the shipped wallet, with the same safe empty
// public responses as the strict SPT fixture. Unknown URLs still fail closed.
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

// Ignore query ordering and EVM address letter-case, not endpoint/parameters.
const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  const serialized = query.toString();
  return `${url.origin}${url.pathname}${serialized ? `?${serialized}` : ''}`;
};

// Public metadata only. No keys, wallet secrets, controller substitution or
// storage writes are used by the observation side of this fixture.
const publicAssets = (page: Page) =>
  page.evaluate(async (contract) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const active = state.vault.activeAccount;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const stored = await chrome.storage.local.get(key);
    const project = (vault: any) =>
      (vault?.accountAssets?.[active.type]?.[active.id]?.ethereum || [])
        .filter(
          (asset: any) => asset.contractAddress?.toLowerCase() === contract
        )
        .map((asset: any) => ({
          id: asset.id,
          contract: asset.contractAddress.toLowerCase(),
          chainId: asset.chainId,
          symbol: asset.tokenSymbol,
          isNft: asset.isNft,
          standard: asset.tokenStandard,
          hasBalance: Object.prototype.hasOwnProperty.call(asset, 'balance'),
          balanceType: typeof asset.balance,
          balance: asset.balance ?? null,
        }));
    return {
      active,
      owner: state.vault.accounts[active.type][active.id].address,
      chainId: state.vault.activeNetwork.chainId,
      live: project(state.vault),
      persisted: project(stored[key]),
    };
  }, CONTRACT);

const snapshotOwned = async (page: Page) => {
  const owned = page
    .getByText(en.nftDetails.owned, { exact: true })
    .locator('..');
  await expect(owned).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  try {
    const tree = await cdp.send('Accessibility.getFullAXTree');
    return {
      ownedText: await owned.innerText(),
      alerts: await page.getByRole('alert').allTextContents(),
      bodyText: await page.locator('body').innerText(),
      nativeAx: tree.nodes
        .filter((node: any) => !node.ignored)
        .map((node: any) => ({
          nodeId: node.nodeId,
          name: node.name?.value,
          role: node.role?.value,
          description: node.description?.value,
          childIds: node.childIds,
        })),
    };
  } finally {
    await cdp.detach();
  }
};

const availabilityCases = (
  ['zero', 'positive', 'unavailable'] as const
).flatMap((mode) => [320, 400].map((width) => ({ mode, width })));

for (const { mode, width } of availabilityCases) {
  test(`ERC721 custom import distinguishes ${mode} balance availability at ${width}px`, async ({}, info) => {
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
    const owner = fixture.evmAddresses[0].toLowerCase();
    // New-wallet startup briefly reads its default mainnet UTXO account before
    // ordinary Settings chooses EVM. Derive only its public fixture identity.
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
    const auxiliaryReplies = new Map<
      string,
      { body: unknown; family: string }
    >();
    for (const query of [
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ]) {
      auxiliaryReplies.set(
        requestKey(
          new URL(
            `https://blockbook.syscoin.org/api/v2/xpub/${initialXpub}?${query}`
          )
        ),
        {
          family: 'initial-mainnet-account',
          body: {
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
          },
        }
      );
    }
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      auxiliaryReplies.set(`${origin}/api/v2/tickers/currency`, {
        family: 'native-utxo-fiat-ticker',
        body: { ts: 1, rates: { usd: 1 } },
      });
    auxiliaryReplies.set(
      requestKey(
        new URL(
          'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true'
        )
      ),
      {
        family: 'native-evm-fiat-price',
        // eslint-disable-next-line camelcase -- CoinGecko wire field.
        body: { syscoin: { usd: 1, usd_24h_change: 0 } },
      }
    );
    // The zero-native-balance fixture requests the initial, unpaged history
    // endpoints. Discovery is independent of the custom contract under test.
    for (const action of ['tokenlist', 'txlist', 'pendingtxlist', 'tokentx']) {
      const url = new URL('https://explorer.tanenbaum.io/api');
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', action);
      url.searchParams.set('address', owner);
      if (action === 'txlist' || action === 'tokentx')
        url.searchParams.set('sort', 'desc');
      auxiliaryReplies.set(requestKey(url), {
        family: `evm-account-${action}`,
        body: {
          status: action === 'tokenlist' ? '1' : '0',
          message: action === 'tokenlist' ? 'OK' : 'No transactions found',
          result: [],
        },
      });
    }
    const server = await startUtxoFixtureServer();
    const reads: Array<Record<string, unknown>> = [];
    const actualBalanceResponses: Array<Record<string, unknown>> = [];
    const unsupported: Array<Record<string, unknown>> = [];
    const forbidden: string[] = [];
    const pageErrors: string[] = [];
    const responseErrors: string[] = [];
    const walletHttpReads: Array<{ method: string; url: string }> = [];
    const walletHttpFailures: Array<{
      error: string | undefined;
      method: string;
      url: string;
    }> = [];
    const auxiliaryReads: Array<{
      family: string;
      method: string;
      url: string;
    }> = [];
    let failureEnabled = mode === 'unavailable';
    const quantity = mode === 'zero' ? '0' : '3';
    let phase = 'setup';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, any> = {
      mode,
      width,
      runtime,
      sourceSha256,
      milestones: {},
    };
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'Erc721AvailabilitySynthetic!2026',
      chainId: CHAIN_ID,
      networkLabel: 'Syscoin NEVM Testnet',
      rpcUrl: server.url,
    });
    try {
      wallet = await PaliWallet.launch(
        `erc721-balance-availability-${mode}-${width}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width, height: 620 },
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          walletHttpReads.push({
            method: request.method(),
            url: request.url(),
          });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname)) forbidden.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body]) {
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbidden.push(call.method);
          }
        } catch {
          /* GET/static requests */
        }
      });
      // JSON-RPC errors under test are handled HTTP200 responses, not transport
      // failures. Any unmatched/cancelled HTTP in the wallet context is separate
      // fixture evidence and must not be silently excused by the deny proxy.
      wallet.context.on('requestfailed', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          walletHttpFailures.push({
            method: request.method(),
            url: request.url(),
            error: request.failure()?.errorText,
          });
      });
      wallet.context.on('response', async (response) => {
        if (
          response.url() !== RPC_URL ||
          response.request().method() !== 'POST'
        )
          return;
        let calls: any[];
        try {
          const input = response.request().postDataJSON();
          calls = (Array.isArray(input) ? input : [input]).filter(
            (call) =>
              call?.method === 'eth_call' &&
              call.params?.[0]?.to?.toLowerCase() === CONTRACT &&
              String(call.params?.[0]?.data).slice(0, 10) === balanceSelector
          );
        } catch {
          return;
        }
        if (!calls.length) return;
        try {
          const body = await response.json();
          const replies = Array.isArray(body) ? body : [body];
          for (const call of calls) {
            const reply = replies.find((item: any) => item.id === call.id);
            if (!reply) throw new Error('Missing genuine balanceOf reply');
            const [account] = abi.decode(
              ['address'],
              `0x${call.params[0].data.slice(10)}`
            );
            actualBalanceResponses.push({
              at: Date.now(),
              httpStatus: response.status(),
              target: CONTRACT,
              owner: String(account).toLowerCase(),
              error: reply?.error ?? null,
              result: reply?.result ?? null,
            });
          }
        } catch (error) {
          responseErrors.push(String(error));
        }
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url,
        (url) => {
          const reply = BLACKLIST_FEEDS.has(url.href)
            ? { family: 'blacklist-feed', body: BLACKLIST_FEEDS.get(url.href) }
            : auxiliaryReplies.get(requestKey(url));
          if (!reply) return undefined;
          auxiliaryReads.push({
            family: reply.family,
            method: 'GET',
            url: url.href,
          });
          return reply.body;
        }
      );
      // The shipped Contract/SDK/controller receive genuine JSON-RPC replies.
      // Only this allowlisted NFT's eth_call balance read can fail by scenario.
      await wallet.context.route(RPC_URL, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const rpc = route.request().postDataJSON();
        const calls = Array.isArray(rpc) ? rpc : [rpc];
        const targetOf = (call: any) =>
          String(call.params?.[0]?.to || call.params?.[0] || '').toLowerCase();
        if (
          !calls.some(
            (call: any) =>
              ['eth_call', 'eth_getCode'].includes(call?.method) &&
              targetOf(call) === CONTRACT
          )
        )
          return route.fallback();
        const replies = calls.map((call: any) => {
          const target = targetOf(call);
          let result: unknown;
          let error: { code: number; message: string } | undefined;
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'eth_getCode' && target === CONTRACT)
            result = '0x60006000fd';
          if (call.method === 'eth_call' && target === CONTRACT) {
            const data = String(call.params[0].data);
            const prefix = data.slice(0, 10);
            if (prefix === selector('name()'))
              result = abi.encode(['string'], ['Synthetic Read Collection']);
            if (prefix === selector('symbol()'))
              result = abi.encode(['string'], [SYMBOL]);
            if (prefix === selector('supportsInterface(bytes4)')) {
              const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
              result = abi.encode(
                ['bool'],
                [value === '0x80ac58cd' || value === '0x01ffc9a7']
              );
            }
            if (prefix === balanceSelector) {
              const [account] = abi.decode(['address'], `0x${data.slice(10)}`);
              if (String(account).toLowerCase() === owner) {
                error = failureEnabled
                  ? {
                      code: -32000,
                      message: 'Synthetic NFT balance temporarily unavailable',
                    }
                  : undefined;
                if (!error) result = abi.encode(['uint256'], [quantity]);
                reads.push({
                  at: Date.now(),
                  phase,
                  method: 'balanceOf',
                  target,
                  owner,
                  error: error ?? null,
                  quantity: error ? null : quantity,
                });
              }
            }
            if (result !== undefined && prefix !== balanceSelector)
              reads.push({
                at: Date.now(),
                phase,
                method: 'eth_call',
                target,
                selector: prefix,
              });
          }
          if (result === undefined && !error) {
            unsupported.push({ method: call.method, target });
            error = { code: -32000, message: 'Unsupported synthetic read' };
          }
          return error
            ? { jsonrpc: '2.0', id: call.id, error }
            : { jsonrpc: '2.0', id: call.id, result };
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
        });
      });

      observations.workerIdentity = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (value) => {
          observations.workerIdentity = value;
        }
      );

      const openImport = async () => {
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/tokens\/add(?:\?|$)/);
        const custom = page
          .getByRole('button', { name: en.tokens.addCustomTab, exact: true })
          .and(page.locator('button[aria-pressed]'));
        await expect(custom).toHaveCount(1);
        await custom.click();
        await expect(custom).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#custom-token-contract').fill(CONTRACT);
        await expect(
          page.getByRole('button', { name: importName, exact: true })
        ).toBeEnabled();
      };
      const nftRow = () =>
        page.getByRole('listitem').filter({
          has: page.getByRole('button', {
            name: en.nftDetails.viewNamedCollection.replace(
              '{{symbol}}',
              SYMBOL
            ),
            exact: true,
          }),
        });
      const showNfts = async () => {
        await page.locator('#assets-btn').click();
        const nfts = page.getByRole('button', {
          name: en.tooltip.viewNFTs,
          exact: true,
        });
        await nfts.click();
        await expect(nfts).toHaveAttribute('aria-pressed', 'true');
      };

      await wallet.step(
        `${mode}-${width}px: create the isolated wallet and enable normal Refresh`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
          const initial = await publicAssets(page);
          expect(initial.owner.toLowerCase()).toBe(owner);
          expect(initial.chainId).toBe(CHAIN_ID);
          expect(initial.live).toEqual([]);
          expect(initial.persisted).toEqual([]);
          observations.initial = initial;
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
          await page.locator('#advanced-refresh').click();
          await page.getByRole('dialog').locator('#confirm-btn').click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await page
            .getByRole('dialog')
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await wallet!.ensureOnHome();
          await expect(
            page.getByRole('button', { name: en.header.refresh, exact: true })
          ).toBeEnabled();
        }
      );
      phase = 'preview';
      await wallet.step(
        `${mode}-${width}px: use ordinary manual import and read its real preview`,
        async (capture) => {
          await openImport();
          await expect
            .poll(() => actualBalanceResponses.length)
            .toBeGreaterThan(0);
          expect(
            actualBalanceResponses.every(
              (read) =>
                read.target === CONTRACT &&
                read.owner === owner &&
                read.httpStatus === 200
            )
          ).toBe(true);
          expect(
            actualBalanceResponses.some((read) => Boolean(read.error))
          ).toBe(mode === 'unavailable');
          if (mode === 'unavailable') {
            expect(actualBalanceResponses).toContainEqual(
              expect.objectContaining({
                error: {
                  code: -32000,
                  message: 'Synthetic NFT balance temporarily unavailable',
                },
              })
            );
          } else {
            expect(actualBalanceResponses).toContainEqual(
              expect.objectContaining({
                result: abi.encode(['uint256'], [quantity]),
              })
            );
          }
          await page
            .getByRole('button', { name: detailsName, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
          observations.preview = await snapshotOwned(page);
          await capture(page);
          if (mode !== 'unavailable')
            expect(observations.preview.ownedText).toContain(`${quantity} NFT`);
          const footerClose = page
            .getByRole('button', { name: en.buttons.close, exact: true })
            .and(page.getByText(en.buttons.close, { exact: true }));
          await expect(footerClose).toHaveCount(1);
          await footerClose.click();
          await expect(page.locator('#custom-token-contract')).toHaveValue(
            CONTRACT
          );
          await expect(
            page.getByRole('button', { name: importName, exact: true })
          ).toBeEnabled();
          // Merely inspecting and backing out must not add anything.
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
          expect((await publicAssets(page)).live).toEqual([]);
          expect((await publicAssets(page)).persisted).toEqual([]);
          observations.milestones.previewReturnAndCancelPreservedState = true;
        }
      );
      phase = 'import';
      await wallet.step(
        `${mode}-${width}px: import through the real wallet and preserve exact identity on disk`,
        async () => {
          await openImport();
          const add = page.getByRole('button', {
            name: importName,
            exact: true,
          });
          await add.click();
          await expect(add).toBeDisabled();
          await expect
            .poll(async () => (await publicAssets(page)).persisted.length)
            .toBe(1);
          observations.imported = await publicAssets(page);
          expect(observations.imported.live).toEqual(
            observations.imported.persisted
          );
          expect(observations.imported.live[0]).toMatchObject({
            id: `${CONTRACT}-${CHAIN_ID}`,
            contract: CONTRACT,
            chainId: CHAIN_ID,
            symbol: SYMBOL,
            isNft: true,
            standard: 'ERC-721',
          });
          if (mode !== 'unavailable')
            expect(observations.imported.live[0]).toMatchObject({
              hasBalance: true,
              balanceType: 'number',
              balance: Number(quantity),
            });
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
          await showNfts();
          await expect(nftRow()).toHaveCount(1);
          observations.homeRowText = await nftRow().innerText();
          if (mode !== 'unavailable')
            expect(observations.homeRowText).toContain(
              `${quantity} ${en.nftDetails.items}`
            );
          // Let the normal success toast finish before the recorded Home view.
          await expect(page.locator('.Toastify__toast')).toHaveCount(0);
          observations.milestones.manualImportPersisted = true;
        }
      );
      if (mode === 'unavailable') {
        phase = 'recovery';
        await wallet.step(
          `${mode}-${width}px: recover by normal Refresh then persist at the real popup reload boundary`,
          async () => {
            const recoveryAt = Date.now();
            failureEnabled = false;
            observations.recoveryAt = recoveryAt;
            await page
              .getByRole('button', { name: en.header.refresh, exact: true })
              .click();
            await expect
              .poll(() =>
                actualBalanceResponses.some(
                  (read) =>
                    Number(read.at) >= recoveryAt &&
                    read.error === null &&
                    read.owner === owner
                )
              )
              .toBe(true);
            await expect
              .poll(async () => (await publicAssets(page)).live[0]?.balance)
              .toBe(3);
            await expect(nftRow()).toContainText(`3 ${en.nftDetails.items}`);
            observations.afterRefresh = await publicAssets(page);
            expect(observations.afterRefresh.live[0]).toMatchObject({
              contract: CONTRACT,
              chainId: CHAIN_ID,
              balance: 3,
            });
            observations.milestones.normalRefreshRecovered = true;
          }
        );
      }
      await wallet.step(
        `${mode}-${width}px: reload preserves the recovered or healthy imported collection`,
        async () => {
          const beforeReload = await publicAssets(page);
          // MainApp disconnect triggers the existing emergency vault save.
          await page.reload();
          await wallet!.ensureOnHome();
          await expect.poll(publicAssets.bind(null, page)).toEqual({
            ...beforeReload,
            persisted: beforeReload.live,
          });
          observations.afterReload = await publicAssets(page);
          observations.milestones.reloadPersistedExactState = true;
        }
      );
      await wallet.step(
        `${mode}-${width}px: verify read-only fences and immutable runtime`,
        async () => {
          expect(unsupported).toEqual([]);
          expect(forbidden).toEqual([]);
          expect(routes.deniedWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(responseErrors).toEqual([]);
          expect(walletHttpFailures).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
          observations.milestones.safetyHealthy = true;
        }
      );
      if (mode === 'unavailable') {
        await wallet.step(
          `${mode}-${width}px: failed balance reads never claim known zero holdings`,
          async () => {
            const previewClaimsZero =
              /\b0 NFTs\b/.test(observations.preview.ownedText) &&
              !observations.preview.bodyText.includes(en.settings.unavailable);
            const homeClaimsZero =
              new RegExp(`\\b0 ${en.nftDetails.items}\\b`).test(
                observations.homeRowText
              ) && !observations.homeRowText.includes(en.settings.unavailable);
            observations.claimsKnownZero = {
              preview: previewClaimsZero,
              home: homeClaimsZero,
            };
            expect(
              observations.claimsKnownZero,
              'failed ERC721 balance reads must not claim a known zero holding'
            ).toEqual({ preview: false, home: false });
            expect(observations.preview.ownedText).toContain(
              en.settings.unavailable
            );
            expect(observations.homeRowText).toContain(en.settings.unavailable);
            expect(observations.imported.live[0]).toMatchObject({
              hasBalance: false,
              balance: null,
            });
            expect(observations.imported.persisted[0]).toEqual(
              observations.imported.live[0]
            );
          }
        );
      }
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        await info.attach('erc721-balance-availability-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            ...observations,
            status,
            reads,
            actualBalanceResponses,
            unsupported,
            forbidden,
            pageErrors,
            responseErrors,
            walletHttpReads,
            walletHttpFailures,
            auxiliaryReads,
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            proxyDeniedConnectionsArePlatformEvidenceOnly: true,
            syntheticHttpRpcOnly: true,
            noControllerOrStateReplacement: true,
            noSendUiOpened: true,
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
