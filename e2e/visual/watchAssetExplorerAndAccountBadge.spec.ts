import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
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
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function returnHomeThroughControls(wallet: PaliWallet) {
  if (!/#\/home(?:\?.*)?$/.test(wallet.page.url())) {
    await wallet.page
      .getByRole('button', { name: en.buttons.close, exact: true })
      .first()
      .click();
  }
  await expect(wallet.page).toHaveURL(/#\/home(?:\?.*)?$/);
}
async function openGeneralSettings(wallet: PaliWallet, label: string) {
  await returnHomeThroughControls(wallet);
  await wallet.page
    .getByRole('button', { name: en.generalMenu.generalOptions, exact: true })
    .click();
  await wallet.page.getByRole('menuitem', { name: label, exact: true }).click();
}

const CHAIN = 10; // Production intentionally uses explorer history, not RPC block scans.
const LABEL = 'Synthetic Explorer Review';
const RPC = 'https://rpc.explorer-review.synthetic.invalid/';
const API = 'https://explorer-review.synthetic.invalid/api';
const EXPLORER =
  'https://explorer-review.synthetic.invalid/public/?view=compact/';
const TOKEN = '0x000000000000000000000000000000000000ed57';
const HASH = '0x' + 'a7'.repeat(32);
const PEER = '0x' + '33'.repeat(20);
const abi = AbiCoder.defaultAbiCoder();
// Exact public infrastructure addresses probed by the normal network setup.
const infrastructureTargets = new Set(
  [
    PALI_CREATE2_DEPLOYER_ADDRESS,
    ...getPaliInfrastructureContracts(CHAIN).map(
      (contract) => contract.address
    ),
  ].map((address) => address.toLowerCase())
);

const publicState = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const account = state.vault.accounts[ref.type][ref.id];
    const network = state.vault.activeNetwork;
    return {
      active: { ...ref, address: account.address, label: account.label },
      switching: state.vaultGlobal.isSwitchingAccount,
      network: {
        chainId: network.chainId,
        kind: network.kind,
        url: network.url,
        explorer: network.explorer,
        apiUrl: network.apiUrl,
      },
      accounts: Object.values(state.vault.accounts.HDAccount).map(
        (row: any) => ({
          id: row.id,
          address: row.address,
          label: row.label,
        })
      ),
      history: (
        state.vault.accountTransactions[ref.type]?.[ref.id]?.ethereum?.[
          chainId
        ] || []
      ).map((row: any) => ({
        hash: row.hash,
        blockNumber: row.blockNumber,
        confirmations: row.confirmations,
      })),
    };
  }, CHAIN);

// Read the actual extension-wide badge. Never replace Chrome callbacks or setters.
const badgeText = async (wallet: PaliWallet) => {
  const worker = wallet.context
    .serviceWorkers()
    .find((item) =>
      item.url().startsWith('chrome-extension://' + wallet.extensionId + '/')
    );
  expect(worker).toBeDefined();
  return worker!.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        chrome.action.getBadgeText({}, (text) => {
          if (chrome.runtime.lastError)
            reject(new Error(chrome.runtime.lastError.message));
          else resolve(text);
        });
      })
  );
};

async function selectAccount(wallet: PaliWallet, accountId: number) {
  await wallet.ensureOnHome();
  const state = await publicState(wallet.page);
  const account = state.accounts.find((row) => row.id === accountId);
  expect(account).toBeDefined();
  await wallet.page.locator('#general-settings-button').locator('..').click();
  await wallet.page
    .getByRole('menuitem', {
      name: account!.label + ' (' + account!.address + ')',
      exact: true,
    })
    .click();
  await expect
    .poll(() => publicState(wallet.page))
    .toMatchObject({
      active: { id: accountId, address: account!.address },
      switching: false,
    });
}

async function withFixture(
  scenario: string,
  info: TestInfo,
  run: (
    wallet: PaliWallet,
    fixture: ReturnType<typeof createIsolatedVaultFixture>,
    audit: {
      history: Array<{ action: string; address: string; rows: number }>;
      observations: Record<string, unknown>;
      pending: boolean;
    }
  ) => Promise<void>
) {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const owners = fixture.evmAddresses.map((address) => address.toLowerCase());
  const audit = {
    pending: scenario === 'pending-account-badge',
    history: [] as Array<{ action: string; address: string; rows: number }>,
    observations: {} as Record<string, unknown>,
  };
  const rpcReads: Array<{ method: string; params: unknown[] }> = [];
  const apiValidation: string[] = [];
  const deniedWrites: string[] = [];
  const unknownReads: string[] = [];
  const pageErrors: string[] = [];
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ExplorerBadgeSyntheticOnly!2026',
    rpcUrl: server.url,
    chainId: CHAIN,
    networkLabel: LABEL,
  });
  try {
    wallet = await PaliWallet.launch(scenario, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => pageErrors.push(error.message))
    );
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route(RPC, async (route) => {
      if (route.request().method() !== 'POST')
        return route.abort('blockedbyclient');
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      const replies = calls.map((call: any) => {
        const params = call?.params;
        if (
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        ) {
          deniedWrites.push(String(call.method));
          return {
            jsonrpc: '2.0',
            id: call.id,
            error: { code: -32601, message: 'Writes forbidden' },
          };
        }
        let result: unknown;
        const owner =
          typeof params?.[0] === 'string' &&
          owners.includes(params[0].toLowerCase());
        const atLatest = ['latest', 'pending'].includes(params?.[1]);
        if (call?.jsonrpc === '2.0' && Array.isArray(params)) {
          if (params.length === 0) {
            if (call.method === 'eth_chainId') result = '0xa';
            if (call.method === 'net_version') result = '10';
            if (call.method === 'eth_blockNumber') result = '0x1';
            if (
              ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(call.method)
            )
              result = '0x3b9aca00';
          }
          if (owner && atLatest && params.length === 2) {
            if (call.method === 'eth_getBalance') result = '0x0';
            if (call.method === 'eth_getTransactionCount') result = '0x0';
          }
          if (
            call.method === 'eth_getCode' &&
            params.length === 2 &&
            atLatest &&
            (owner ||
              params[0]?.toLowerCase() === TOKEN ||
              infrastructureTargets.has(params[0]?.toLowerCase()))
          ) {
            result = params[0].toLowerCase() === TOKEN ? '0x60006000fd' : '0x';
          }
          if (
            call.method === 'eth_getBlockByNumber' &&
            params.length === 2 &&
            ['latest', '0x1', '0x0'].includes(params[0]) &&
            params[1] === false
          ) {
            const genesis = params[0] === '0x0';
            result = {
              number: genesis ? '0x0' : '0x1',
              hash: '0x' + (genesis ? '11' : '12').repeat(32),
              parentHash: '0x' + (genesis ? '00' : '11').repeat(32),
              nonce: '0x0000000000000000',
              timestamp: '0x1',
              difficulty: '0x0',
              gasLimit: '0x1c9c380',
              gasUsed: '0x0',
              miner: '0x' + '00'.repeat(20),
              extraData: '0x',
              transactions: [],
              baseFeePerGas: '0x3b9aca00',
            };
          }
          if (
            call.method === 'eth_call' &&
            params.length === 2 &&
            params[0]?.to?.toLowerCase() === TOKEN &&
            params[1] === 'latest'
          ) {
            const data = params[0].data;
            const fields = [
              ['name()', 'string', 'Synthetic Explorer Token'],
              ['symbol()', 'string', 'EXPLORER'],
              ['decimals()', 'uint8', 6],
              ['balanceOf(address)', 'uint256', 12000000],
              ['totalSupply()', 'uint256', 12000000],
              ['supportsInterface(bytes4)', 'bool', false],
            ] as const;
            const field = fields.find(
              ([signature]) =>
                typeof data === 'string' &&
                data.slice(0, 10) === id(signature).slice(0, 10)
            );
            if (field) {
              const ownerArgument =
                field[0] !== 'balanceOf(address)' ||
                owners.some(
                  (address) =>
                    data.slice(10).toLowerCase() ===
                    address.slice(2).padStart(64, '0')
                );
              // The real SDK classifies ERC20 with balanceOf(contractAddress).
              const selfBalance =
                field[0] === 'balanceOf(address)' &&
                data.slice(10).toLowerCase() ===
                  TOKEN.slice(2).padStart(64, '0');
              if (ownerArgument || selfBalance)
                result = abi.encode([field[1]], [selfBalance ? 0 : field[2]]);
            }
          }
        }
        if (result === undefined)
          unknownReads.push(JSON.stringify({ method: call?.method, params }));
        else rpcReads.push({ method: call.method, params });
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call?.id,
              error: { code: -32601, message: 'Unsupported synthetic read' },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    await wallet.context.route(API + '**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.pathname !== '/api')
        return route.abort('blockedbyclient');
      const module = url.searchParams.get('module');
      const action = url.searchParams.get('action') || '';
      let result: unknown;
      if (
        (module === 'block' && action === 'eth_block_number') ||
        (module === 'proxy' && action === 'eth_blockNumber')
      ) {
        result = '0x1';
        apiValidation.push(module + ':' + action);
      }
      if (
        module === 'account' &&
        ['txlist', 'pendingtxlist', 'tokentx'].includes(action)
      ) {
        const address = (url.searchParams.get('address') || '').toLowerCase();
        if (owners.includes(address)) {
          const rows =
            audit.pending && address === owners[0] && action === 'pendingtxlist'
              ? [
                  {
                    hash: HASH,
                    from: fixture.evmAddresses[0],
                    to: PEER,
                    value: '1',
                    nonce: '0',
                    input: '0x',
                    timeStamp: '1700000000',
                    blockNumber: '0',
                    blockHash: null,
                    confirmations: '0',
                    gas: '21000',
                    gasPrice: '1000000000',
                  },
                ]
              : [];
          result = rows;
          audit.history.push({ action, address, rows: rows.length });
        }
      }
      if (result === undefined) {
        unknownReads.push(url.href);
        return route.abort('blockedbyclient');
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: '1', message: 'OK', result }),
      });
    });
    await wallet.step(
      scenario + ': configure the ordinary wallet and saved network',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.page
          .getByRole('button')
          .filter({ hasText: /UTXO|EVM/ })
          .first()
          .click();
        await wallet!.page
          .getByText(en.networkMenu.customRpc, { exact: true })
          .click();
        await expect(wallet!.page).toHaveURL(
          /#\/settings\/networks\/custom-rpc$/
        );
        const page = wallet!.page;
        await page
          .getByRole('combobox', { name: en.settings.label, exact: true })
          .fill(LABEL);
        await page.locator('#rpc_symbol').fill('ETH');
        await page.locator('#rpc_chainId').fill(String(CHAIN));
        await page.locator('#rpc_explorer').fill(EXPLORER);
        await page.locator('#rpc_apiUrl').fill(API);
        await page.locator('#rpc_url').fill(RPC);
        await page.locator('#rpc_url').press('Tab');
        await expect
          .poll(() => rpcReads.some((read) => read.method === 'eth_chainId'))
          .toBe(true);
        await expect(
          page.getByRole('button', { name: en.buttons.save, exact: true })
        ).toBeEnabled();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).not.toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        expect(apiValidation).toContain('block:eth_block_number');
        // Normal menu activation also waits for the registry's debounced UI publication.
        await returnHomeThroughControls(wallet!);
        await wallet!.switchNetwork(LABEL, 'EVM');
        await expect
          .poll(() => publicState(page))
          .toMatchObject({
            active: {
              id: 0,
              type: 'HDAccount',
              address: fixture.evmAddresses[0],
            },
            network: {
              chainId: CHAIN,
              kind: 'ethereum',
              url: RPC,
              explorer: EXPLORER,
              apiUrl: API,
            },
            switching: false,
          });
      }
    );
    await run(wallet, fixture, audit);
    expect([...deniedWrites, ...routes.deniedWrites]).toEqual([]);
    expect(unknownReads).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach(scenario + '-runtime-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeBadgeSettersReplaced: false,
            rpcReads,
            apiValidation,
            pageErrors,
            explorerReads: audit.history,
            observations: audit.observations,
            deniedWrites: [...deniedWrites, ...(routes?.deniedWrites || [])],
            unknownReads,
            proxyDeniedConnections: server.blocked.length,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      status = 'failed';
      throw error;
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

test('pending transaction badges follow ordinary account selection and empty-history reads', async ({}, info) => {
  test.setTimeout(150_000);
  await withFixture(
    'pending-account-badge',
    info,
    async (wallet, fixture, audit) => {
      const page = wallet.page;
      await wallet.step(
        'badge: enable normal Refresh and show the first account pending history',
        async () => {
          await openGeneralSettings(wallet, en.generalMenu.advanced);
          await expect(page).toHaveURL(/#\/settings\/advanced$/);
          await page.locator('#advanced-refresh').click();
          await page.getByRole('dialog').locator('#confirm-btn').click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await page
            .getByRole('dialog')
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await returnHomeThroughControls(wallet);
          await wallet.ensureOnHome();
          await page
            .getByRole('button', { name: en.header.refresh, exact: true })
            .click();
          await expect
            .poll(async () => ({
              state: await publicState(page),
              badge: await badgeText(wallet),
            }))
            .toMatchObject({
              state: {
                active: { id: 0 },
                history: [{ hash: HASH, confirmations: 0 }],
              },
              badge: '1',
            });
          await page.locator('#activity-btn').click();
          await expect(page.locator('#activity-panel-list')).toBeVisible();
          await expect(
            page
              .locator('#activity-panel-list')
              .getByText(en.send.pending, { exact: true })
          ).toHaveCount(1);
          audit.observations.firstPending = {
            state: await publicState(page),
            badge: await badgeText(wallet),
          };
        }
      );
      await wallet.step(
        'badge: a same-account empty response preserves locally known pending history',
        async () => {
          const before = audit.history.filter(
            (read) =>
              read.address === fixture.evmAddresses[0].toLowerCase() &&
              read.action === 'pendingtxlist'
          ).length;
          audit.pending = false;
          await page
            .getByRole('button', { name: en.header.refresh, exact: true })
            .click();
          await expect
            .poll(
              () =>
                audit.history.filter(
                  (read) =>
                    read.address === fixture.evmAddresses[0].toLowerCase() &&
                    read.action === 'pendingtxlist'
                ).length
            )
            .toBeGreaterThan(before);
          await expect
            .poll(async () => ({
              state: await publicState(page),
              badge: await badgeText(wallet),
            }))
            .toMatchObject({
              state: {
                active: { id: 0 },
                history: [{ hash: HASH, confirmations: 0 }],
              },
              badge: '1',
            });
          audit.observations.sameAccountEmpty = {
            state: await publicState(page),
            badge: await badgeText(wallet),
          };
        }
      );
      await wallet.step(
        'badge: create and select an ordinary empty account without inheriting the badge',
        async () => {
          await openGeneralSettings(wallet, en.accountMenu.createNewAccount);
          await expect(page).toHaveURL(/#\/settings\/account\/new$/);
          await page
            .locator('#account-name-input')
            .fill('Empty synthetic account');
          await page.locator('#create-btn').click();
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await wallet.ensureOnHome();
          await page
            .getByRole('button', { name: en.header.refresh, exact: true })
            .click();
          await expect
            .poll(() =>
              audit.history.some(
                (read) =>
                  read.address === fixture.evmAddresses[1].toLowerCase() &&
                  read.action === 'pendingtxlist' &&
                  read.rows === 0
              )
            )
            .toBe(true);
          await expect
            .poll(async () => ({
              state: await publicState(page),
              badge: await badgeText(wallet),
            }))
            .toMatchObject({
              state: {
                active: { id: 1, address: fixture.evmAddresses[1] },
                history: [],
                switching: false,
              },
              badge: '',
            });
          await page.locator('#activity-btn').click();
          await expect(
            page.locator('#activity-panel-list').getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            })
          ).toHaveCount(0);
          await expect(page.locator('#activity-panel-empty')).toBeVisible();
          audit.observations.emptyAccount = {
            state: await publicState(page),
            badge: await badgeText(wallet),
          };
        }
      );
      await wallet.step(
        'badge: return to the first account and restore its own pending badge',
        async () => {
          audit.pending = true;
          await selectAccount(wallet, 0);
          await page
            .getByRole('button', { name: en.header.refresh, exact: true })
            .click();
          await expect
            .poll(async () => ({
              state: await publicState(page),
              badge: await badgeText(wallet),
            }))
            .toMatchObject({
              state: {
                active: { id: 0, address: fixture.evmAddresses[0] },
                history: [{ hash: HASH, confirmations: 0 }],
                switching: false,
              },
              badge: '1',
            });
          await page.locator('#activity-btn').click();
          await expect(page.locator('#activity-panel-list')).toBeVisible();
          await expect(
            page
              .locator('#activity-panel-list')
              .getByText(en.send.pending, { exact: true })
          ).toHaveCount(1);
          audit.observations.returnedPending = {
            state: await publicState(page),
            badge: await badgeText(wallet),
          };
        }
      );
    }
  );
});

test('incoming watch-asset review opens the exact contract path before a configured explorer query', async ({}, info) => {
  test.setTimeout(150_000);
  await withFixture(
    'watch-asset-explorer-url',
    info,
    async (wallet, fixture, audit) => {
      let dapp: Page;
      await wallet.step(
        'watch-asset: connect the ordinary provider to the local fixture document',
        async (capture) => {
          dapp = await wallet.context.newPage();
          const origin = E2E_CONFIG.rpcUrl;
          await dapp.goto(origin);
          await dapp.waitForFunction(() =>
            Boolean((window as any).pali?.request)
          );
          const request = await startRequest(dapp, 'eth_requestAccounts');
          const result = await approve(wallet.context, dapp, request, capture);
          expect(
            result.result.map((address: string) => address.toLowerCase())
          ).toEqual([fixture.evmAddresses[0].toLowerCase()]);
          expect(await providerRequest(dapp, 'eth_chainId')).toBe('0xa');
        }
      );
      let request = -1;
      let popup: Page;
      await wallet.step(
        'watch-asset: inspect the real token review and capture its exact external navigation request',
        async (capture) => {
          request = await startRequest(dapp!, 'wallet_watchAsset', {
            type: 'ERC20',
            options: { address: TOKEN, symbol: 'EXPLORER', decimals: 6 },
          });
          popup = await popupFor(wallet.context, dapp!, request);
          await expect(
            popup.getByRole('button', {
              name: en.buttons.addToken,
              exact: true,
            })
          ).toBeEnabled();
          const contract = popup.getByRole('button', {
            name: TOKEN,
            exact: true,
          });
          await expect(contract).toBeVisible();
          const tokenName = popup
            .locator('p')
            .filter({ hasText: en.settings.tokenName })
            .locator('span');
          await expect(tokenName).toHaveText('EXPLORER');
          await expect(tokenName).toBeVisible();
          // This is only the public navigation boundary: the real UI handler runs,
          // but no extra window or public explorer request is created.
          await popup.evaluate(() => {
            const observed = window as typeof window & {
              explorerOpenRequests?: Array<{ target?: string; url: string }>;
            };
            observed.explorerOpenRequests = [];
            window.open = ((url?: string | URL, target?: string) => {
              observed.explorerOpenRequests!.push({ url: String(url), target });
              return null;
            }) as typeof window.open;
          });
          await contract.click();
          const requests = await popup.evaluate(
            () =>
              (
                window as typeof window & {
                  explorerOpenRequests?: Array<{
                    target?: string;
                    url: string;
                  }>;
                }
              ).explorerOpenRequests
          );
          expect(requests).toEqual([
            {
              url:
                'https://explorer-review.synthetic.invalid/public/address/' +
                TOKEN +
                '?view=compact/',
              target: '_blank',
            },
          ]);
          audit.observations.navigationBoundaryOnly = true;
          audit.observations.explorerOpenRequests = requests;
          audit.observations.reviewNetwork = (
            await publicState(wallet.page)
          ).network;
          await capture(popup);
        }
      );
      await wallet.step(
        'watch-asset: cancel the reviewed request without importing the public token',
        async (capture) => {
          await capture(popup!);
          const rejected = await dismissRejectedApproval({
            click: () =>
              popup!
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click(),
            isClosed: () => popup!.isClosed(),
            settle: () => settle(dapp!, request),
          });
          expect(rejected.error?.code).toBe(4001);
          const tokens = await providerRequest(dapp!, 'wallet_getTokens');
          expect(
            (tokens.ethereum || []).filter(
              (token: any) => token.contractAddress.toLowerCase() === TOKEN
            )
          ).toEqual([]);
          audit.observations.cancelled = {
            code: rejected.error?.code,
            matchingTokens: 0,
          };
        }
      );
    }
  );
});
