import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CHAIN_ID = 31337;
const LABEL = 'Asset Explorer';
const EXPLORER = 'https://asset-explorer.synthetic.invalid';
const CONTRACT = '0x0000000000000000000000000000000000000031';
const SYMBOL = 'LINKFIX';
const ROOT_EXPLORER = `${EXPLORER}/`;
const PATH_EXPLORER = `${EXPLORER}/public/`;
const QUERY_EXPLORER = `${PATH_EXPLORER}?view=compact`;

const publicMetadata = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    // Global network registrations and the active EVM vault are persisted
    // separately; token membership belongs to the slip44-60 vault.
    const storage = await chrome.storage.local.get(['state', 'state-vault-60']);
    const projectNetwork = (network: any) =>
      network
        ? {
            chainId: network.chainId,
            currency: network.currency,
            explorer: network.explorer,
            kind: network.kind,
            label: network.label,
            slip44: network.slip44,
            url: network.url,
          }
        : null;
    const { activeAccount, accounts, accountAssets } = state.vault;
    const projectAssets = (assets: any[]) =>
      (assets || [])
        .filter(
          (asset) =>
            asset.chainId === chainId &&
            asset.contractAddress?.toLowerCase() ===
              '0x0000000000000000000000000000000000000031'
        )
        .map((asset) => ({
          chainId: asset.chainId,
          contractAddress: asset.contractAddress,
          tokenSymbol: asset.tokenSymbol,
          tokenStandard: asset.tokenStandard,
          decimals: asset.decimals,
          balance: asset.balance,
        }));
    return {
      active: projectNetwork(state.vault.activeNetwork),
      account: {
        address: accounts[activeAccount.type]?.[activeAccount.id]?.address,
        id: activeAccount.id,
        type: activeAccount.type,
      },
      live: projectNetwork(state.vaultGlobal.networks.ethereum[chainId]),
      saved: projectNetwork(
        storage.state?.vaultGlobal?.networks?.ethereum?.[chainId]
      ),
      assets: projectAssets(
        accountAssets?.[activeAccount.type]?.[activeAccount.id]?.ethereum
      ),
      savedAssets: projectAssets(
        storage['state-vault-60']?.accountAssets?.[activeAccount.type]?.[
          activeAccount.id
        ]?.ethereum
      ),
      status: state.vaultGlobal.networkStatus,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
      switchingAccount: state.vaultGlobal.isSwitchingAccount,
    };
  }, CHAIN_ID);

test('token details preserve a normally saved explorer subpath and compact query', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  let wallet: PaliWallet | undefined;
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const reads: Array<{ method: string; params: unknown[] }> = [];
  const deniedRequests: string[] = [];
  const pageErrors: string[] = [];
  const explorerRequests: string[] = [];
  const contractReads: string[] = [];
  const observations: Record<string, unknown> = {};
  let phase = 'onboarding';
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'TokenExplorerSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('token-explorer-navigation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const rpc = `${server.url}/asset-rpc`;
    const knownAccounts = fixture.evmAddresses.map((value) =>
      value.toLowerCase()
    );
    const knownCodeTargets = new Set(
      [
        ...fixture.evmAddresses,
        CONTRACT,
        ...getPaliInfrastructureContracts(CHAIN_ID).map(
          (contract) => contract.address
        ),
        PALI_CREATE2_DEPLOYER_ADDRESS,
        PALI_MULTICALL3_CANONICAL_ADDRESS,
      ].map((value) => value.toLowerCase())
    );
    const abi = AbiCoder.defaultAbiCoder();
    const tokenReplies = new Map([
      [id('name()').slice(0, 10), abi.encode(['string'], ['Explorer Token'])],
      [id('symbol()').slice(0, 10), abi.encode(['string'], [SYMBOL])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [6])],
      [
        id('balanceOf(address)').slice(0, 10),
        abi.encode(['uint256'], [2000000]),
      ],
      [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [2000000])],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    await wallet.context.route(`${rpc}**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.href === rpc && request.method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
          },
        });
      if (url.href !== rpc || request.method() !== 'POST') {
        deniedRequests.push(`custom-rpc:${request.method()}:${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        deniedRequests.push('custom-rpc:invalid JSON');
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const replies = calls.map((call) => {
        if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params))
          return undefined;
        let result: unknown;
        switch (call.method) {
          case 'eth_chainId':
          case 'net_version':
          case 'eth_blockNumber':
          case 'eth_gasPrice':
          case 'eth_maxPriorityFeePerGas':
            if (call.params.length !== 0) return undefined;
            result =
              call.method === 'eth_chainId'
                ? `0x${CHAIN_ID.toString(16)}`
                : call.method === 'net_version'
                ? String(CHAIN_ID)
                : call.method === 'eth_blockNumber'
                ? '0x1'
                : '0x3b9aca00';
            break;
          case 'eth_getBalance':
          case 'eth_getTransactionCount':
            if (
              call.params.length !== 2 ||
              !knownAccounts.includes(String(call.params[0]).toLowerCase()) ||
              call.params[1] !== 'latest'
            )
              return undefined;
            result = '0x0';
            break;
          case 'eth_getCode':
            if (
              call.params.length !== 2 ||
              !knownCodeTargets.has(String(call.params[0]).toLowerCase()) ||
              call.params[1] !== 'latest'
            )
              return undefined;
            result =
              String(call.params[0]).toLowerCase() === CONTRACT
                ? '0x60006000fd'
                : '0x';
            break;
          case 'eth_call': {
            const transaction = call.params[0];
            if (
              call.params.length !== 2 ||
              call.params[1] !== 'latest' ||
              transaction?.to?.toLowerCase() !== CONTRACT ||
              typeof transaction.data !== 'string'
            )
              return undefined;
            const selector = transaction.data.slice(0, 10);
            result = tokenReplies.get(selector);
            if (result === undefined) return undefined;
            if (
              selector === id('balanceOf(address)').slice(0, 10) &&
              // The SDK classifies ERC-20 contracts with balanceOf(contract)
              // before it reads the actual selected wallet's token balance.
              ![CONTRACT, ...knownAccounts].includes(
                String(
                  abi.decode(['address'], '0x' + transaction.data.slice(10))[0]
                ).toLowerCase()
              )
            )
              return undefined;
            contractReads.push(selector);
            break;
          }
          case 'eth_getBlockByNumber': {
            if (
              call.params.length !== 2 ||
              !['latest', '0x0', '0x1'].includes(call.params[0]) ||
              typeof call.params[1] !== 'boolean'
            )
              return undefined;
            const genesis = call.params[0] === '0x0';
            result = {
              number: genesis ? '0x0' : '0x1',
              hash: '0x' + (genesis ? '40' : '41').repeat(32),
              parentHash: '0x' + (genesis ? '00' : '40').repeat(32),
              nonce: '0x0000000000000000',
              timestamp: genesis ? '0x0' : '0x1',
              difficulty: '0x0',
              gasLimit: '0x1c9c380',
              gasUsed: '0x0',
              miner: '0x' + '00'.repeat(20),
              extraData: '0x',
              transactions: [],
              baseFeePerGas: '0x3b9aca00',
            };
            break;
          }
          default:
            return undefined;
        }
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (!calls.length || replies.some((reply) => reply === undefined)) {
        deniedRequests.push(
          'custom-rpc:unsupported:' +
            calls.map((call) => call?.method).join(',')
        );
        return route.abort('blockedbyclient');
      }
      reads.push(
        ...calls.map((call) => ({ method: call.method, params: call.params }))
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });

    // Merely observing hrefs must not start an explorer navigation. If an
    // accidental request occurs it is recorded and blocked, never forwarded.
    await wallet.context.route(`${EXPLORER}/**`, async (route) => {
      explorerRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const networkMenu = () =>
      page
        .getByRole('button')
        .filter({ hasText: /UTXO|EVM/ })
        .first();
    const expectedNetwork = (explorer: string) => ({
      chainId: CHAIN_ID,
      currency: 'test',
      explorer,
      kind: 'ethereum',
      label: LABEL,
      slip44: 60,
      url: rpc,
    });
    const expectedAsset = {
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      tokenSymbol: SYMBOL,
      tokenStandard: 'ERC-20',
      decimals: 6,
      balance: 2,
    };
    let address = '';
    const expectRegistry = async (explorer: string) => {
      await expect
        .poll(async () => {
          const current = await publicMetadata(page);
          return { live: current.live, saved: current.saved };
        })
        .toEqual({
          live: expectedNetwork(explorer),
          saved: expectedNetwork(explorer),
        });
    };
    const selectSavedNetwork = async (explorer: string) => {
      await networkMenu().click();
      const menu = page.getByRole('menu');
      const group = menu.getByRole('menuitem', { name: /EVM Networks/i });
      if ((await group.getAttribute('aria-expanded')) !== 'true')
        await group.click();
      await menu.getByRole('menuitem', { name: LABEL, exact: true }).click();
      await expect
        .poll(async () => {
          const current = await publicMetadata(page);
          return {
            active: current.active,
            ready:
              current.status === 'idle' &&
              current.postLoading === false &&
              current.switchingAccount === false,
          };
        })
        .toEqual({ active: expectedNetwork(explorer), ready: true });
      expect((await publicMetadata(page)).account.address).toBe(address);
    };
    const assertTokenHref = async (explorer: string, expected: string) => {
      await expect(page).toHaveURL(/#\/home\/details(?:\?.*)?$/);
      const link = page.getByRole('link', {
        name: en.home.viewOnExplorer,
        exact: true,
      });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', expected);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer');
      await expect(page.getByText('2 LINKFIX', { exact: true })).toBeVisible();
      const actual = new URL((await link.getAttribute('href')) as string);
      expect(actual.pathname).toBe(new URL(expected).pathname);
      expect(actual.search).toBe(new URL(expected).search);
      expect(actual.hash).toBe('');
      await expectRegistry(explorer);
      const current = await publicMetadata(page);
      expect(current.account.address).toBe(address);
      expect(current.assets).toEqual([expectedAsset]);
      expect(current.savedAssets).toEqual([expectedAsset]);
      observations[phase] = {
        href: await link.getAttribute('href'),
        ...current,
      };
    };
    const openAsset = async () => {
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', {
          name: `View details for ${SYMBOL} token`,
          exact: true,
        })
        .click();
    };
    const editExplorer = async (from: string, next: string) => {
      // Global network actions are intentionally disabled on Details.
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await expect(networkMenu()).toBeEnabled();
      await networkMenu().click();
      await page
        .getByRole('menu')
        .getByRole('menuitem', {
          name: en.networkMenu.manageNetworks,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
      const row = page
        .locator('li')
        .filter({ has: page.getByText(LABEL, { exact: true }) });
      await expect(row).toHaveCount(1);
      await row.locator('button').first().click();
      await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
      await expect(page.locator('#rpc_explorer')).toHaveValue(from);
      await expect(page.locator('#rpc_url')).toHaveValue(rpc);
      await page.locator('#rpc_explorer').fill(next);
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
      await expectRegistry(next);
      // The normal header Close returns to Home; no route/state injection.
      await page
        .getByRole('button', { name: en.buttons.close, exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
      await selectSavedNetwork(next);
      await openAsset();
    };
    await wallet.step(
      'token-explorer: open Custom RPC through the normal network menu',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        const before = await publicMetadata(page);
        expect(before.live).toBeNull();
        expect(before.saved).toBeNull();
        address = before.account.address;
        expect(address.toLowerCase()).toBe(knownAccounts[0]);
        observations.before = before;
        await networkMenu().click();
        await page
          .getByRole('menu')
          .getByRole('menuitem', {
            name: en.networkMenu.customRpc,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
      }
    );
    await wallet.step(
      'token-explorer: save and select a healthy root explorer registration',
      async () => {
        phase = 'root-save';
        await page
          .getByRole('combobox', { name: en.settings.label, exact: true })
          .fill(LABEL);
        await page.locator('#rpc_symbol').fill('TEST');
        await page.locator('#rpc_chainId').fill(String(CHAIN_ID));
        await page.locator('#rpc_explorer').fill(ROOT_EXPLORER);
        await page.locator('#rpc_url').fill(rpc);
        await page.locator('#rpc_url').press('Tab');
        await expect
          .poll(() => reads.some((read) => read.method === 'eth_chainId'))
          .toBe(true);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expectRegistry(ROOT_EXPLORER);
        await selectSavedNetwork(ROOT_EXPLORER);
        observations.rootSaved = await publicMetadata(page);
      }
    );
    await wallet.step(
      'token-explorer: import the public synthetic token and open its healthy root link',
      async () => {
        phase = 'root-token';
        await page.locator('#assets-btn').click();
        await page
          .getByRole('button', { name: en.home.importToken, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/tokens\/add(?:\?.*)?$/);
        const custom = page.getByRole('button', {
          name: en.tokens.addCustomTab,
          exact: true,
        });
        // Networks with an API have both a tab and an empty-state action.
        // Without an API the ordinary form already opens on Custom.
        if (await custom.count()) await custom.first().click();
        await page.locator('#custom-token-contract').fill(CONTRACT);
        const importToken = page.getByRole('button', {
          name: `Import ${SYMBOL} token`,
          exact: true,
        });
        await expect(importToken).toBeEnabled();
        await importToken.click();
        await expect(importToken).toBeDisabled();
        await expect
          .poll(async () => (await publicMetadata(page)).savedAssets)
          .toEqual([expectedAsset]);
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await openAsset();
        await assertTokenHref(
          ROOT_EXPLORER,
          `${ROOT_EXPLORER}token/${CONTRACT}`
        );
      }
    );
    await wallet.step(
      'token-explorer: retain a saved public subpath before the token route',
      async () => {
        phase = 'path-token';
        await editExplorer(ROOT_EXPLORER, PATH_EXPLORER);
        await assertTokenHref(
          PATH_EXPLORER,
          `${PATH_EXPLORER}token/${CONTRACT}`
        );
      }
    );
    await wallet.step(
      'token-explorer: retain the exact saved compact query after the token route',
      async () => {
        phase = 'query-token';
        await editExplorer(PATH_EXPLORER, QUERY_EXPLORER);
        await assertTokenHref(
          QUERY_EXPLORER,
          `${PATH_EXPLORER}token/${CONTRACT}?view=compact`
        );
      }
    );
    await wallet.step(
      'token-explorer: retain read-only transport and exact runtime evidence',
      async () => {
        // Normal ERC-20 import classifies the contract, then reads symbol,
        // decimals and balance. Its basic display name reuses the symbol.
        expect(contractReads).toEqual(
          expect.arrayContaining([
            id('supportsInterface(bytes4)').slice(0, 10),
            id('symbol()').slice(0, 10),
            id('decimals()').slice(0, 10),
            id('balanceOf(address)').slice(0, 10),
          ])
        );
        expect(explorerRequests).toEqual([]);
        expect(deniedRequests).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(testSourceSha256);
      }
    );
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await info.attach('token-explorer-navigation-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            status,
            observations,
            reads,
            contractReads,
            explorerRequests,
            deniedRequests,
            deniedWrites: routes?.deniedWrites,
            fixtureReads: routes?.reads,
            proxyBlocked: server?.blocked,
            pageErrors,
            syntheticHttpOnly: true,
            explorerNavigationPerformed: false,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            signaturesOrBroadcastsRequested: false,
          },
          null,
          2
        ),
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server?.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
