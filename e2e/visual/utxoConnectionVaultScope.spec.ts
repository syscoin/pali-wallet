import { expect, test, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { ellipsis } from '../../source/utils/format';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const SYS_LABEL = 'Syscoin public watch account';
const BTC_LABEL = 'Bitcoin public watch account';
const BTC_ORIGIN = 'https://btc1.trezor.io';

// Only public identity and permission metadata leave the extension here.
// Each account is imported through the real UI; no vault/grant is substituted.
const publicState = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get(['state', storageKey]);
    const ref = state.vault.activeAccount;
    const account = (accounts: any) => {
      const value = accounts?.[ref.type]?.[ref.id];
      return value
        ? {
            ...ref,
            address: value.address,
            xpub: value.xpub,
            label: value.label,
            isImported: value.isImported,
          }
        : null;
    };
    const grant = (value: any) =>
      value
        ? {
            host: value.host,
            accountType: value.accountType,
            accountId: value.accountId,
            chain: value.chain,
            chainId: value.chainId,
            utxoAccount: value.utxoAccount,
          }
        : null;
    const network = state.vault.activeNetwork;
    return {
      active: account(state.vault.accounts),
      savedAccount: account(saved[storageKey]?.accounts),
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: network.kind,
        chainId: network.chainId,
        slip44: network.slip44,
        url: network.url,
      },
      grant: grant(state.dapp.dapps[origin]),
      savedGrant: grant(saved.state?.dapp?.dapps?.[origin]),
    };
  }, host);

test('UTXO connection grants do not follow an equal Imported account slot into another coin vault', async ({}, info) => {
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
  const bitcoinConfig = getNetworkConfig(0, 'btc');
  const bitcoinSigner = new sys.HDSigner(
    UTXO_FIXTURE_SEED,
    '',
    false,
    bitcoinConfig.networks,
    0,
    bitcoinConfig.types.zPubType,
    84
  );
  const bitcoinWatchPayment = sys.bitcoinjs.payments.p2wpkh({
    hash: Buffer.from('11223344556677889900aabbccddeeff00112233', 'hex'),
    network: bitcoinConfig.networks.mainnet,
  });
  const bitcoinWatchScript = bitcoinWatchPayment.output!;
  const bitcoinWatch = bitcoinWatchPayment.address!;
  expect(
    Buffer.from(bitcoinWatchScript).equals(
      Buffer.from(
        sys.bitcoinjs.address.toOutputScript(
          fixture.watchAddress,
          sys.syscoinNetworks.testnet
        )
      )
    )
  ).toBe(false);
  // Exact public identifiers from the disposable seed plus the unrelated fixed
  // watch-only hash. The Bitcoin endpoint is named mainnet, but every response
  // is local and empty; this never accesses that service or a funded account.
  const bitcoinIdentifiers = new Set<string>([
    bitcoinSigner.getAccountXpub(),
    bitcoinWatch,
  ]);
  for (const change of [0, 1]) {
    for (const index of [0, 1]) {
      bitcoinIdentifiers.add(
        sys.bitcoinjs.payments.p2wpkh({
          pubkey: bitcoinSigner.deriveKeypair(`m/84'/0'/0'/${change}/${index}`)
            .publicKey,
          network: bitcoinConfig.networks.mainnet,
        }).address!
      );
    }
  }
  const server = await startUtxoFixtureServer();
  const host = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'UtxoGrantVaultSynthetic!2026',
    rpcUrl: server.url,
  });
  const bitcoinReads: string[] = [];
  const deniedBitcoin: string[] = [];
  const observations: Record<string, unknown> = {};
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('utxo-connection-vault-scope', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // An additional exact-origin, exact-identifier HTTP fixture. Other
    // requests keep the existing deny route and launch-time proxy fence.
    await wallet.context.route(`${BTC_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let body: unknown;
      if (request.method() === 'GET' && url.origin === BTC_ORIGIN) {
        const match = url.pathname.match(
          /^\/api\/v2\/(xpub|address|utxo)\/(.+)$/
        );
        if (url.pathname === '/api/v2' || url.pathname === '/api/v2/') {
          body = {
            blockbook: { coin: 'Bitcoin', inSync: true, bestHeight: 1 },
            backend: { chain: 'main', blocks: 1 },
          };
        } else if (
          match &&
          bitcoinIdentifiers.has(decodeURIComponent(match[2]))
        ) {
          body =
            match[1] === 'utxo'
              ? []
              : {
                  address: decodeURIComponent(match[2]),
                  balance: '0',
                  unconfirmedBalance: '0',
                  totalReceived: '0',
                  totalSent: '0',
                  txs: 0,
                  unconfirmedTxs: 0,
                  usedTokens: 0,
                  tokens: [],
                  tokensAsset: [],
                  ...(url.searchParams.get('details')?.startsWith('txs')
                    ? { transactions: [] }
                    : {}),
                };
        } else if (/^\/api\/v2\/estimatefee\/\d+$/.test(url.pathname)) {
          body = { result: '0.00001' };
        } else if (url.pathname === '/api/v2/tickers') {
          body = { ts: 1, rates: { usd: 1 } };
        }
      }
      if (body === undefined) {
        deniedBitcoin.push(`${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      bitcoinReads.push(url.pathname);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    const page = wallet.page;
    const importWatch = async (label: string, identifier: string) => {
      await page
        .getByRole('button', {
          name: en.generalMenu.generalOptions,
          exact: true,
        })
        .click();
      await page
        .getByRole('menu')
        .getByRole('menuitem', {
          name: en.accountMenu.importAccount,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/#\/settings\/account\/import$/);
      await page.locator('#account-name-input').fill(label);
      await page.locator('#import-account-watch-only').check();
      await page.locator('#import-account-identifier').fill(identifier);
      const submit = page.getByRole('button', {
        name: en.buttons.import,
        exact: true,
      });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(
        page.getByText(en.settings.accountImported, { exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await wallet!.ensureOnHome();
      await expect
        .poll(async () => (await publicState(page, host)).savedAccount)
        .toMatchObject({
          type: 'Imported',
          id: 0,
          label,
          address: identifier,
          xpub: identifier,
          isImported: true,
        });
      const state = await publicState(page, host);
      expect(state.active).toEqual(state.savedAccount);
      return state;
    };
    let syscoin: Awaited<ReturnType<typeof publicState>>;
    let bitcoin: Awaited<ReturnType<typeof publicState>>;
    await wallet.step(
      'import distinct public watch accounts into the same Imported zero slot of each UTXO vault',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        syscoin = await importWatch(SYS_LABEL, fixture.watchAddress);
        expect(syscoin.slip44).toBe(1);
        expect(syscoin.network.chainId).toBe(5700);
        await wallet!.switchNetwork('Bitcoin', 'UTXO');
        bitcoin = await importWatch(BTC_LABEL, bitcoinWatch);
        expect(bitcoin.slip44).toBe(0);
        expect(bitcoin.network.chainId).toBe(0);
        expect(bitcoin.active?.id).toBe(syscoin.active?.id);
        expect(bitcoin.active?.type).toBe(syscoin.active?.type);
        expect(bitcoin.active?.address).not.toBe(syscoin.active?.address);
        expect(bitcoin.grant).toBeNull();
        observations.imported = { syscoin, bitcoin };
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        expect((await publicState(page, host)).active).toEqual(syscoin.active);
      }
    );

    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() =>
      Boolean((window as any).__paliConformanceProvider && (window as any).pali)
    );
    await dapp.evaluate(() => {
      const changes: string[][] = [];
      (window as any).__utxoGrantAccountChanges = changes;
      (window as any).pali.on('accountsChanged', (accounts: string[]) => {
        changes.push([...accounts]);
      });
    });
    const providerState = () =>
      providerRequest(dapp, 'wallet_getSysProviderState');
    const connectedXpub = () =>
      dapp.evaluate(() => (window as any).pali._sys.getConnectedAccountXpub());
    const connect = async (label: string, address: string, slip44: number) => {
      const id = await startRequest(dapp, 'sys_requestAccounts');
      const popup = await popupFor(wallet!.context, dapp, id);
      const selected = popup
        .locator('[role="button"][tabindex="0"]')
        .filter({ has: popup.getByText(label, { exact: true }) });
      await expect(selected).toHaveCount(1);
      await selected.click();
      const result = await approve(wallet!.context, dapp, id);
      expect(result.result).toEqual([address]);
      await expect
        .poll(async () => (await publicState(page, host)).savedGrant)
        .toMatchObject({
          host,
          accountType: 'Imported',
          accountId: 0,
          chain: 'syscoin',
          utxoAccount: { slip44, xpub: address },
        });
      const state = await publicState(page, host);
      expect(state.grant).toEqual(state.savedGrant);
      expect(await providerState()).toMatchObject({
        accounts: [address],
        xpub: address,
        isBitcoinBased: true,
        isUnlocked: true,
      });
      expect(await providerRequest(dapp, 'sys_isConnected')).toBe(true);
      await expect.poll(connectedXpub).toBe(address);
      return state;
    };
    let sourceGrant: Awaited<ReturnType<typeof publicState>>;
    await wallet.step(
      'approve the Syscoin watch account through the real Connect request',
      async () => {
        sourceGrant = await connect(SYS_LABEL, fixture.watchAddress, 1);
        observations.sourceGrant = sourceGrant;
      }
    );

    await wallet.step(
      'switch to Bitcoin and keep the old Syscoin grant from exposing Imported zero there',
      async (capture) => {
        await wallet!.switchNetwork('Bitcoin', 'UTXO');
        const current = await publicState(page, host);
        expect(current.active).toEqual(bitcoin!.active);
        expect(current.grant).toEqual(sourceGrant!.grant);
        expect(current.savedGrant).toEqual(sourceGrant!.savedGrant);
        expect(await providerState()).toMatchObject({
          accounts: [],
          xpub: null,
          isBitcoinBased: true,
          isUnlocked: true,
        });
        expect(await providerRequest(dapp, 'sys_isConnected')).toBe(false);
        await expect.poll(connectedXpub).toBeNull();
        const changes: string[][] = await dapp.evaluate(
          () => (window as any).__utxoGrantAccountChanges
        );
        expect(changes.flat()).not.toContain(bitcoinWatch);
        await page
          .getByRole('button', {
            name: en.settings.connectedSites,
            exact: true,
          })
          .click();
        await expect(page.getByTitle(host, { exact: true })).toBeVisible();
        await expect(
          page.getByText('Connected to: Account 1', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText(`Connected to: ${BTC_LABEL}`, { exact: true })
        ).toHaveCount(0);
        await page
          .getByRole('button', {
            name: en.settings.editConnection,
            exact: true,
          })
          .click();
        const review = page.getByRole('dialog', {
          name: en.settings.editConnection,
          exact: true,
        });
        await expect(
          review.getByText(en.settings.unavailable, { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText('Account 1', { exact: true })
        ).toBeVisible();
        for (const text of [
          SYS_LABEL,
          BTC_LABEL,
          ellipsis(bitcoinWatch),
          ellipsis(fixture.watchAddress),
        ])
          await expect(review.getByText(text, { exact: true })).toHaveCount(0);
        expect(await publicState(page, host)).toEqual(current);
        observations.foreignGrant = {
          state: current,
          provider: await providerState(),
          changes,
        };
        await capture(page);
        await review
          .locator('footer')
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await page
          .locator('[data-page-action-footer]')
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'returning to the original coin restores only its original consented identity',
      async () => {
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        expect((await publicState(page, host)).grant).toEqual(
          sourceGrant!.grant
        );
        expect(await providerState()).toMatchObject({
          accounts: [fixture.watchAddress],
          xpub: fixture.watchAddress,
        });
        expect(await providerRequest(dapp, 'sys_isConnected')).toBe(true);
        expect(await providerRequest(dapp, 'sys_requestAccounts')).toEqual([
          fixture.watchAddress,
        ]);
        expect(
          wallet!.context
            .pages()
            .filter((candidate) => candidate.url().includes('/external'))
        ).toHaveLength(0);
        observations.returnToSource = await publicState(page, host);
      }
    );
    await wallet.step(
      'explicit Bitcoin reapproval creates its own durable binding and does not authorize the Syscoin slot',
      async (capture) => {
        await wallet!.switchNetwork('Bitcoin', 'UTXO');
        expect(await providerState()).toMatchObject({
          accounts: [],
          xpub: null,
        });
        const targetGrant = await connect(BTC_LABEL, bitcoinWatch, 0);
        expect(targetGrant.grant?.utxoAccount).not.toEqual(
          sourceGrant!.grant?.utxoAccount
        );
        observations.reapprovedTarget = targetGrant;
        await capture(page);
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        expect((await publicState(page, host)).grant).toEqual(
          targetGrant.grant
        );
        expect(await providerState()).toMatchObject({
          accounts: [],
          xpub: null,
        });
        expect(await providerRequest(dapp, 'sys_isConnected')).toBe(false);
        await expect.poll(connectedXpub).toBeNull();
        observations.reverseIsolation = await publicState(page, host);
      }
    );
    expect(
      bitcoinReads.some(
        (read) =>
          read.includes(encodeURIComponent(bitcoinWatch)) ||
          read.includes(bitcoinWatch)
      )
    ).toBe(true);
    expect(deniedBitcoin).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(sourceSha256);
    status = 'passed';
  } finally {
    try {
      await info.attach('utxo-connection-vault-scope-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          sourceSha256,
          observations,
          bitcoinReads,
          deniedBitcoin,
          fixtureReads: routes?.reads ?? [],
          deniedWrites: routes?.deniedWrites ?? [],
          proxyDeniedConnections: server.blocked.length,
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          storageReplaced: false,
          signingOrBroadcastRequested: false,
          endpointVariation:
            'Separate native pipeline coverage; this browser case changes real coin vaults through NetworkMenu.',
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
