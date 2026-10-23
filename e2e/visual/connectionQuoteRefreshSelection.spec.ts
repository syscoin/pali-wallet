import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import {
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Normal preference Save produces the genuine delayed
// quote/full-state delivery. No controller, Redux, runtime response or cache is
// replaced. Neither approval is accepted; the sole candidate assertion is last.
const EUR_QUOTE =
  'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=eur&include_24hr_change=true';
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

const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return url.origin + url.pathname + (query.size ? '?' + query : '');
};

const tabTo = async (page: Page, target: Locator) => {
  for (let index = 0; index < 30; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const publicState = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const saved = await chrome.storage.local.get(['state', key]);
    const reference = state.vault.activeAccount;
    const accounts = (value: any) =>
      Object.values(value?.HDAccount || {})
        .map((account: any) => ({
          id: account.id,
          label: account.label,
          address: account.address,
        }))
        .sort((a, b) => a.id - b.id);
    const grant = (value: any) =>
      value
        ? {
            host: value.host,
            accountId: value.accountId,
            accountType: value.accountType,
          }
        : null;
    const network = state.vault.activeNetwork;
    return {
      identity: {
        active: {
          id: reference.id,
          type: reference.type,
          address: state.vault.accounts[reference.type][reference.id].address,
        },
        network: {
          chainId: network.chainId,
          kind: network.kind,
          url: network.url,
          slip44: network.slip44,
        },
        accounts: accounts(state.vault.accounts),
        savedAccounts: accounts(saved[key]?.accounts),
        grant: grant(state.dapp.dapps[origin]),
        savedGrant: grant(saved.state?.dapp?.dapps?.[origin]),
      },
      coingeckoId:
        state.vaultGlobal.networks.ethereum[network.chainId]?.coingeckoId,
      fiat: {
        asset: state.price.fiat.asset,
        price: state.price.fiat.price,
        savedAsset: saved.state?.price?.fiat?.asset,
      },
    };
  }, host);

const selection = async (first: Locator, second: Locator) => ({
  first: await first.evaluate((element) =>
    element.classList.contains('shadow-md')
  ),
  second: await second.evaluate((element) =>
    element.classList.contains('shadow-md')
  ),
});

const installMessageObservation = (page: Page) =>
  page.evaluate(() => {
    const messages: any[] = [];
    const listener = (message: any) => {
      if (message?.type !== 'CONTROLLER_STATE_CHANGE' || !message.data) return;
      const state = message.data;
      const reference = state.vault?.activeAccount;
      const network = state.vault?.activeNetwork;
      messages.push({
        receivedAt: Date.now(),
        type: message.type,
        fiat: {
          asset: state.price?.fiat?.asset,
          price: state.price?.fiat?.price,
        },
        active: reference
          ? {
              id: reference.id,
              type: reference.type,
              address:
                state.vault.accounts?.[reference.type]?.[reference.id]?.address,
            }
          : null,
        network: network
          ? {
              chainId: network.chainId,
              kind: network.kind,
              url: network.url,
              slip44: network.slip44,
            }
          : null,
      });
      // Observation only: no return value, sendResponse or event replacement.
    };
    chrome.runtime.onMessage.addListener(listener);
    (window as any).__quoteSelectionObservation = {
      messages,
      remove: () => chrome.runtime.onMessage.removeListener(listener),
    };
  });

const messageObservation = (page: Page) =>
  page.evaluate(
    () => (window as any).__quoteSelectionObservation?.messages || []
  );

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`connection account choice survives a genuine background quote refresh at ${viewport.width}x${viewport.height} before Cancel`, async ({}, info) => {
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
    const emptyInventory = {
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
    const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
    const addRead = (url: string, body: unknown) =>
      auxiliary.set(requestKey(new URL(url)), body);
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addRead(origin + '/api/v2/tickers/currency', {
        ts: 1,
        rates: { usd: 1, eur: 0.2 },
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
        emptyInventory
      );
    addRead(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
      { syscoin: { usd: 0.125, usd_24h_change: 0 } }
    );
    for (const owner of fixture.evmAddresses)
      for (const action of [
        'tokenlist',
        'txlist',
        'pendingtxlist',
        'tokentx',
      ]) {
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
      password: 'QuoteSelectionSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let popup: Page | undefined;
    let dapp: Page | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let quotePhase = 'setup';
    let releaseQuote!: () => void;
    let gateReleased = false;
    const gate = new Promise<void>((resolve) => {
      releaseQuote = () => {
        gateReleased = true;
        resolve();
      };
    });
    const quoteCompletions: Promise<void>[] = [];
    const quotes: Array<{
      phase: string;
      receivedAt: number;
      releasedAt?: number;
      fulfilledAt?: number;
      error?: string;
    }> = [];
    const reads: Array<{ method: string; url: string }> = [];
    const unexpectedWalletHttpFailures: Array<{
      method: string;
      url: string;
      failure: string | null;
    }> = [];
    const forbiddenRequests: string[] = [];
    const unsupportedQuoteRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = {
      runtime,
      sourceSha256,
    };
    let expectedIdentity: Awaited<ReturnType<typeof publicState>>['identity'];
    let first: { id: number; label: string; address: string };
    let second: { id: number; label: string; address: string };
    let afterQuoteSelection: { first: boolean; second: boolean } | undefined;
    try {
      wallet = await PaliWallet.launch(
        `connection-quote-refresh-selection-${viewport.width}x${viewport.height}`,
        { offlineHttpProxy: server.url, viewport }
      );
      const page = wallet.page;
      const step = (
        name: string,
        action: (capture: (target: Page) => Promise<void>) => Promise<void>
      ) =>
        wallet!.step(`${viewport.width}x${viewport.height}: ${name}`, action);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('page', (newPage) =>
        newPage.on('pageerror', (error) => pageErrors.push(error.message))
      );
      // Register audits before the first read route so no route-installation gap
      // can hide an aborted startup feed.
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          reads.push({ method: request.method(), url: request.url() });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname))
          forbiddenRequests.push('sendtx');
        try {
          const payload = request.postDataJSON();
          for (const call of Array.isArray(payload) ? payload : [payload])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          /* Read-only GETs and local HTML have no JSON body. */
        }
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          unexpectedWalletHttpFailures.push({
            method: request.method(),
            url: request.url(),
            failure: request.failure()?.errorText || null,
          });
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
      await wallet.context.route(
        'https://api.coingecko.com/api/v3/simple/price?*',
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (requestKey(url) !== requestKey(new URL(EUR_QUOTE)))
            return route.fallback();
          if (
            request.method() !== 'GET' ||
            url.username ||
            url.password ||
            url.hash
          ) {
            unsupportedQuoteRequests.push(
              request.method() + ' ' + request.url()
            );
            return route.abort('blockedbyclient');
          }
          const row: (typeof quotes)[number] = {
            phase: quotePhase,
            receivedAt: Date.now(),
          };
          quotes.push(row);
          let complete!: () => void;
          quoteCompletions.push(
            new Promise<void>((resolve) => {
              complete = resolve;
            })
          );
          try {
            await gate;
            row.releasedAt = Date.now();
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              // eslint-disable-next-line camelcase -- canonical wire field.
              body: JSON.stringify({
                syscoin: { eur: 0.2, eur_24h_change: 0 },
              }),
            });
            row.fulfilledAt = Date.now();
          } catch (error) {
            row.error = String(error);
            throw error;
          } finally {
            complete();
          }
        }
      );
      const assertIdentity = async () => {
        const state = await publicState(page, server.url);
        expect(state.identity).toEqual(expectedIdentity);
        expect(state.identity.grant).toBeNull();
        expect(state.identity.savedGrant).toBeNull();
        return state;
      };
      const rowFor = (approval: Page, label: string) =>
        approval.locator('[role="button"][tabindex="0"]').filter({
          has: approval.getByText(label, { exact: true }),
        });
      const assertPending = async (id: number) => {
        expect((await rpcObservation(dapp!, id)).settled).not.toBe(true);
        await assertIdentity();
      };
      const cancel = async (approval: Page, id: number) => {
        const result = await dismissRejectedApproval({
          click: () =>
            approval
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => approval.isClosed(),
          settle: () => settle(dapp!, id),
        });
        expect(result.error?.code).toBe(4100);
        expect(result.error?.message).toBe('Connection required');
        expect(result.result).toBeUndefined();
        await assertIdentity();
        return result;
      };
      await step(
        'verify runtime and create the second HD account through ordinary UI',
        async () => {
          observations.workerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerIdentity = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.gotoRoute('#/settings/account/new');
          await page
            .locator('#account-name-input')
            .fill('Quote selection Beta');
          await page.locator('#create-btn').click();
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await wallet!.ensureOnHome();
          const state = await publicState(page, server.url);
          expect(state.identity.network).toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
            url: 'https://rpc.tanenbaum.io',
          });
          expect(state.coingeckoId).toBe('syscoin');
          expect(state.identity.accounts).toHaveLength(2);
          expect(state.identity.savedAccounts).toEqual(state.identity.accounts);
          expect(state.identity.active).toMatchObject({
            id: 1,
            type: 'HDAccount',
          });
          expect(
            state.identity.accounts.map((account) => account.address)
          ).toEqual(fixture.evmAddresses);
          first = state.identity.accounts.find((account) => account.id === 0)!;
          second = state.identity.accounts.find((account) => account.id === 1)!;
          expect(second.label).toBe('Quote selection Beta');
          expect(first.address).not.toBe(second.address);
          expect(state.identity.grant).toBeNull();
          expect(state.identity.savedGrant).toBeNull();
          expectedIdentity = state.identity;
          observations.initial = state;
        }
      );
      await step(
        'healthy native pointer and keyboard selection then exact Cancel',
        async (capture) => {
          dapp = await wallet!.context.newPage();
          await dapp.goto(server.url);
          await dapp.waitForFunction(() =>
            Boolean(
              (window as any).__paliConformanceProvider && (window as any).pali
            )
          );
          const id = await startRequest(dapp, 'eth_requestAccounts');
          popup = await popupFor(wallet!.context, dapp, id);
          await popup.setViewportSize(viewport);
          const firstRow = rowFor(popup, first.label);
          const secondRow = rowFor(popup, second.label);
          await expect(firstRow).toHaveCount(1);
          await expect(secondRow).toHaveCount(1);
          await expect(secondRow).toHaveClass(/shadow-md/);
          await expect(firstRow).not.toHaveClass(/shadow-md/);
          await firstRow.click();
          await expect(firstRow).toHaveClass(/shadow-md/);
          await expect(secondRow).not.toHaveClass(/shadow-md/);
          await assertPending(id);
          await tabTo(popup, secondRow);
          await popup.keyboard.press('Space');
          await expect(secondRow).toHaveClass(/shadow-md/);
          await expect(firstRow).not.toHaveClass(/shadow-md/);
          await assertPending(id);
          await tabTo(popup, firstRow);
          await popup.keyboard.press('Enter');
          await expect(firstRow).toHaveClass(/shadow-md/);
          await expect(secondRow).not.toHaveClass(/shadow-md/);
          await assertPending(id);
          observations.healthySelection = await selection(firstRow, secondRow);
          await capture(popup);
          observations.healthyCancel = await cancel(popup, id);
          popup = undefined;
        }
      );
      await step(
        'ordinary durable EUR Save starts one held genuine quote',
        async (capture) => {
          quotePhase = 'currency-save';
          expect(quotes).toHaveLength(0);
          await page.locator('#general-settings-button').locator('..').click();
          await page
            .getByRole('menuitem', {
              name: en.generalMenu.currency,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/currency$/);
          await page
            .getByRole('button', {
              name: en.settings.setYourPreferred,
              exact: true,
            })
            .click();
          await page
            .getByRole('textbox', {
              name: en.settings.searchCurrencies,
              exact: true,
            })
            .fill('eur');
          const eur = page.getByRole('button', { name: /\bEUR\b/ });
          await expect(eur).toHaveCount(1);
          await eur.click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect.poll(() => quotes.length).toBe(1);
          const success = page.getByRole('dialog');
          await expect(success).toContainText(
            en.settings.fiatCurrencySetSuccessfully
          );
          await expect(page.getByRole('alert')).toHaveCount(0);
          const state = await assertIdentity();
          expect(state.fiat.asset).toBe('eur');
          expect(state.fiat.savedAsset).toBe('eur');
          expect(gateReleased).toBe(false);
          expect(quotes[0].fulfilledAt).toBeUndefined();
          observations.durableEurBeforeRelease = state;
          await capture(page);
          await success
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
        }
      );
      await step(
        'choose the nonactive account before releasing the real quote',
        async (capture) => {
          quotePhase = 'approval-pending';
          const id = await startRequest(dapp!, 'eth_requestAccounts');
          observations.candidateRequestId = id;
          popup = await popupFor(wallet!.context, dapp!, id);
          await popup.setViewportSize(viewport);
          await installMessageObservation(popup);
          const firstRow = rowFor(popup, first.label);
          const secondRow = rowFor(popup, second.label);
          await expect(firstRow).toHaveCount(1);
          await expect(secondRow).toHaveClass(/shadow-md/);
          await tabTo(popup, firstRow);
          await popup.keyboard.press('Enter');
          await expect(firstRow).toHaveClass(/shadow-md/);
          await expect(secondRow).not.toHaveClass(/shadow-md/);
          await assertPending(id);
          expect(quotes[0].fulfilledAt).toBeUndefined();
          observations.beforeRelease = {
            selection: await selection(firstRow, secondRow),
            state: await publicState(page, server.url),
            messages: await messageObservation(popup),
            firstAX: await firstRow.ariaSnapshot(),
            secondAX: await secondRow.ariaSnapshot(),
          };
          await capture(popup);
        }
      );
      await step(
        'observe genuine EUR full-state delivery and retain public choice evidence',
        async (capture) => {
          quotePhase = 'release';
          observations.releasedAt = Date.now();
          releaseQuote();
          await expect.poll(() => Boolean(quotes[0].fulfilledAt)).toBe(true);
          await expect
            .poll(async () =>
              (
                await messageObservation(popup!)
              ).some(
                (message: any) =>
                  message.fiat.asset === 'eur' && message.fiat.price === 0.2
              )
            )
            .toBe(true);
          const delivered = (await messageObservation(popup!)).find(
            (message: any) =>
              message.fiat.asset === 'eur' && message.fiat.price === 0.2
          );
          expect(delivered.type).toBe('CONTROLLER_STATE_CHANGE');
          expect(delivered.receivedAt).toBeGreaterThanOrEqual(
            observations.releasedAt
          );
          expect(delivered.active).toEqual(expectedIdentity.active);
          expect(delivered.network).toEqual(expectedIdentity.network);
          // Full-state rehydration dispatches synchronously. Allow its ordinary
          // React render/effect frames and normal dapp.get reply to complete.
          // No timeout, clock, store or runtime message is manufactured here.
          await popup!.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve())
                )
              )
          );
          const firstRow = rowFor(popup!, first.label);
          const secondRow = rowFor(popup!, second.label);
          await expect(firstRow).toBeVisible();
          await expect(secondRow).toBeVisible();
          afterQuoteSelection = await selection(firstRow, secondRow);
          observations.afterQuote = {
            selection: afterQuoteSelection,
            state: await assertIdentity(),
            delivered,
            messages: await messageObservation(popup!),
            firstAX: await firstRow.ariaSnapshot(),
            secondAX: await secondRow.ariaSnapshot(),
            recordedAt: Date.now(),
          };
          await assertPending(observations.candidateRequestId);
          await capture(popup!);
        }
      );
      await step(
        'healthy reselect and Cancel complete regardless of retained choice',
        async (capture) => {
          const firstRow = rowFor(popup!, first.label);
          const secondRow = rowFor(popup!, second.label);
          await firstRow.click();
          await expect(firstRow).toHaveClass(/shadow-md/);
          await expect(secondRow).not.toHaveClass(/shadow-md/);
          await assertPending(observations.candidateRequestId);
          observations.recoverySelection = await selection(firstRow, secondRow);
          observations.finalMessages = await messageObservation(popup!);
          await capture(popup!);
          await popup!.evaluate(() =>
            (window as any).__quoteSelectionObservation.remove()
          );
          observations.candidateCancel = await cancel(
            popup!,
            observations.candidateRequestId
          );
          popup = undefined;
          const state = await assertIdentity();
          expect(state.fiat).toMatchObject({
            asset: 'eur',
            price: 0.2,
            savedAsset: 'eur',
          });
          observations.finalPublicState = state;
        }
      );
      await step(
        'retain unchanged runtime and strict no-write HTTP audits',
        async () => {
          observations.finalWorkerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.finalWorkerIdentity = value;
            }
          );
          expect(routes!.deniedWrites).toEqual([]);
          expect(forbiddenRequests).toEqual([]);
          expect(unsupportedQuoteRequests).toEqual([]);
          expect(unexpectedWalletHttpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(quotes).toHaveLength(1);
          expect(quotes[0].error).toBeUndefined();
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await step(
        'retain the chosen account across the unrelated quote refresh',
        async () => {
          // This is deliberately last. Before-fix failure must not prevent either
          // actual Cancel, unchanged public/durable identities or safety controls.
          expect(afterQuoteSelection).toEqual({ first: true, second: false });
        }
      );
      status = 'passed';
    } finally {
      quotePhase = 'cleanup';
      releaseQuote();
      await Promise.all(quoteCompletions);
      try {
        if (popup && !popup.isClosed())
          await popup
            .evaluate(() =>
              (window as any).__quoteSelectionObservation?.remove()
            )
            .catch(() => undefined);
        await info.attach('connection-quote-refresh-selection-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            quotes,
            reads,
            unexpectedWalletHttpFailures,
            unsupportedQuoteRequests,
            forbiddenRequests,
            pageErrors,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            proxyCountIsPlatformEvidenceOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            runtimeMessagesManufactured: false,
            reduxOrDOMReplaced: false,
            cacheOrAlarmModified: false,
            emitterTimeoutChanged: false,
            networkTimeoutChanged: false,
            connectionGranted: false,
            signingOrBroadcastRequested: false,
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
