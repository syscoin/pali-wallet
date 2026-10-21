import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
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
const LABEL = 'Activity Explorer Fixture';
const EXPLORER = 'https://activity-explorer.synthetic.invalid';
const ROOT_EXPLORER = `${EXPLORER}/public/`;
// Preserve the original slash-valued query regression control.
const QUERY_EXPLORER = `${ROOT_EXPLORER}?returnPath=/`;
// This raw query does not end in '/': SDK 1.0.110 must preserve it exactly.
const COMPACT_QUERY_EXPLORER = `${ROOT_EXPLORER}?view=compact`;

const publicMetadata = (page: Page) =>
  page.evaluate(async (chainId) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const storage = await chrome.storage.local.get('state');
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
    const { activeAccount, accounts } = state.vault;
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
      status: state.vaultGlobal.networkStatus,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
      switchingAccount: state.vaultGlobal.isSwitchingAccount,
    };
  }, CHAIN_ID);

test('Activity explorer navigation preserves a normally saved custom-network query', async ({}, info) => {
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
  const navigationAttempts: Array<{
    isNavigationRequest: boolean;
    method: string;
    phase: string;
    resourceType: string;
    url: string;
  }> = [];
  const popupObservations: Array<{
    mainFrameIsTopLevel: boolean;
    newPages: number;
    openerMatches: boolean;
    phase: string;
    popupEvents: number;
  }> = [];
  const observations: Record<string, unknown> = {};
  let phase = 'onboarding';
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ActivityExplorerSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('activity-explorer-navigation', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const rpc = `${server.url}/activity-rpc`;
    const knownAccounts = fixture.evmAddresses.map((value) =>
      value.toLowerCase()
    );
    const knownCodeTargets = new Set(
      [
        ...fixture.evmAddresses,
        ...getPaliInfrastructureContracts(CHAIN_ID).map(
          (contract) => contract.address
        ),
        PALI_CREATE2_DEPLOYER_ADDRESS,
        PALI_MULTICALL3_CANONICAL_ADDRESS,
      ].map((value) => value.toLowerCase())
    );
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
            result = '0x';
            break;
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
    // Capture the real window.open navigation at the browser routing boundary.
    // Nothing from this origin is fulfilled or forwarded to an external server.
    await wallet.context.route(`${EXPLORER}/**`, async (route) => {
      const request = route.request();
      // A popup's first navigation can arrive before Playwright creates its
      // Frame. Inspect the request here; verify the actual popup frame below.
      const isNavigationRequest = request.isNavigationRequest();
      const resourceType = request.resourceType();
      navigationAttempts.push({
        isNavigationRequest,
        method: request.method(),
        phase,
        resourceType,
        url: request.url(),
      });
      if (
        request.method() !== 'GET' ||
        !isNavigationRequest ||
        resourceType !== 'document'
      )
        deniedRequests.push('explorer:unexpected non-navigation request');
      await route.abort('blockedbyclient');
    });
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const expectedNetwork = (explorer: string) => ({
      chainId: CHAIN_ID,
      currency: 'test',
      explorer,
      kind: 'ethereum',
      label: LABEL,
      slip44: 60,
      url: rpc,
    });
    const expectActive = async (explorer: string) => {
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
    };
    const clickExplorer = async (expectedUrl: string) => {
      const before = navigationAttempts.length;
      const previousPages = new Set(wallet!.context.pages());
      const popups: Page[] = [];
      const onPopup = (popup: Page) => popups.push(popup);
      page.on('popup', onPopup);
      try {
        const [popup] = await Promise.all([
          page.waitForEvent('popup'),
          page
            .getByRole('button', { name: en.home.seeAllTxs, exact: true })
            .click(),
        ]);
        await expect.poll(() => navigationAttempts.length).toBe(before + 1);
        expect(navigationAttempts[before]).toEqual({
          isNavigationRequest: true,
          method: 'GET',
          phase,
          resourceType: 'document',
          url: expectedUrl,
        });
        expect(popups).toEqual([popup]);
        expect(popup).not.toBe(page);
        expect(previousPages.has(popup)).toBe(false);
        const newPages = wallet!.context
          .pages()
          .filter((candidate) => !previousPages.has(candidate));
        expect(newPages).toEqual([popup]);
        const openerMatches = (await popup.opener()) === page;
        const mainFrame = popup.mainFrame();
        const mainFrameIsTopLevel =
          mainFrame.parentFrame() === null && mainFrame.page() === popup;
        expect(openerMatches).toBe(true);
        expect(mainFrameIsTopLevel).toBe(true);
        popupObservations.push({
          mainFrameIsTopLevel,
          newPages: newPages.length,
          openerMatches,
          phase,
          popupEvents: popups.length,
        });
      } finally {
        page.off('popup', onPopup);
        for (const popup of popups) if (!popup.isClosed()) await popup.close();
        if (!page.isClosed()) await page.bringToFront();
      }
    };
    let address = '';
    await wallet.step(
      'activity-explorer: open the ordinary custom network form',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        const before = await publicMetadata(page);
        expect(before.live).toBeNull();
        expect(before.saved).toBeNull();
        expect(before.account.id).toBe(0);
        expect(before.account.address).toMatch(/^0x[0-9a-f]{40}$/i);
        expect(before.account.address.toLowerCase()).toBe(knownAccounts[0]);
        address = before.account.address;
        observations.before = before;
        await wallet!.gotoRoute('#/settings/networks/custom-rpc');
        await expect(
          page.getByRole('combobox', { name: en.settings.label, exact: true })
        ).toBeVisible();
      }
    );
    await wallet.step(
      'activity-explorer: add and durably save a healthy root explorer',
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
        await expect(
          page.getByRole('button', { name: en.buttons.save, exact: true })
        ).toBeEnabled();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect
          .poll(async () => {
            const current = await publicMetadata(page);
            return { live: current.live, saved: current.saved };
          })
          .toEqual({
            live: expectedNetwork(ROOT_EXPLORER),
            saved: expectedNetwork(ROOT_EXPLORER),
          });
        observations.rootSaved = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: select the saved network and verify healthy root navigation',
      async (capture) => {
        phase = 'root-navigation';
        await wallet!.switchNetwork(LABEL, 'EVM');
        await expectActive(ROOT_EXPLORER);
        await page.locator('#activity-btn').click();
        await expect(
          page.getByRole('button', { name: en.home.seeAllTxs, exact: true })
        ).toBeVisible();
        await capture(page);
        await clickExplorer(
          `${ROOT_EXPLORER}address/${encodeURIComponent(address)}`
        );
        expect((await publicMetadata(page)).account.address).toBe(address);
        observations.rootActive = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: save the accepted query through the existing network editor',
      async () => {
        phase = 'query-save';
        await wallet!.gotoRoute('#/settings/networks/edit');
        // Manage Networks appends an ellipsis at this label's 25-character cutoff.
        const row = page
          .locator('li')
          .filter({ has: page.getByText(`${LABEL} ...`, { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(page.locator('#rpc_explorer')).toHaveValue(ROOT_EXPLORER);
        await page.locator('#rpc_explorer').fill(QUERY_EXPLORER);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
        await expect
          .poll(async () => {
            const current = await publicMetadata(page);
            return { live: current.live, saved: current.saved };
          })
          .toEqual({
            live: expectedNetwork(QUERY_EXPLORER),
            saved: expectedNetwork(QUERY_EXPLORER),
          });
        observations.querySaved = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: reselect the edited registration through the real menu',
      async () => {
        phase = 'query-selection';
        await wallet!.gotoRoute('#/home');
        await wallet!.ensureOnHome();
        // switchNetwork intentionally skips an unchanged label, so use the real
        // menu item to activate this same label's newly saved explorer metadata.
        await page
          .getByRole('button')
          .filter({ hasText: /EVM/ })
          .first()
          .click();
        const menu = page.getByRole('menu');
        const group = menu.getByRole('menuitem', { name: /EVM Networks/i });
        if ((await group.getAttribute('aria-expanded')) !== 'true')
          await group.click();
        await menu.getByRole('menuitem', { name: LABEL, exact: true }).click();
        await expectActive(QUERY_EXPLORER);
        expect((await publicMetadata(page)).account.address).toBe(address);
        await page.locator('#activity-btn').click();
        await expect(
          page.getByRole('button', { name: en.home.seeAllTxs, exact: true })
        ).toBeVisible();
        observations.queryActive = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: retain the address route before the saved query',
      async (capture) => {
        phase = 'query-navigation';
        await capture(page);
        await clickExplorer(
          `${ROOT_EXPLORER}address/${encodeURIComponent(address)}?returnPath=/`
        );
        expect(navigationAttempts).toHaveLength(2);
        expect(popupObservations).toHaveLength(2);
        expect(new URL(navigationAttempts[1].url).search).toBe('?returnPath=/');
        expect((await publicMetadata(page)).account.address).toBe(address);
        expect(reads.some((read) => read.method === 'eth_getBalance')).toBe(
          true
        );
        expect(deniedRequests).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(pageErrors).toEqual([]);
        observations.queryAfterClick = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: save a non-slash query without changing its value',
      async () => {
        phase = 'compact-query-save';
        await wallet!.gotoRoute('#/settings/networks/edit');
        const row = page
          .locator('li')
          .filter({ has: page.getByText(`${LABEL} ...`, { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(page.locator('#rpc_explorer')).toHaveValue(QUERY_EXPLORER);
        await page.locator('#rpc_explorer').fill(COMPACT_QUERY_EXPLORER);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
        await expect
          .poll(async () => {
            const current = await publicMetadata(page);
            return { live: current.live, saved: current.saved };
          })
          .toEqual({
            live: expectedNetwork(COMPACT_QUERY_EXPLORER),
            saved: expectedNetwork(COMPACT_QUERY_EXPLORER),
          });
        observations.compactQuerySaved = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: reselect the exact non-slash query registration',
      async () => {
        phase = 'compact-query-selection';
        await wallet!.gotoRoute('#/home');
        await wallet!.ensureOnHome();
        await page
          .getByRole('button')
          .filter({ hasText: /EVM/ })
          .first()
          .click();
        const menu = page.getByRole('menu');
        const group = menu.getByRole('menuitem', { name: /EVM Networks/i });
        if ((await group.getAttribute('aria-expanded')) !== 'true')
          await group.click();
        await menu.getByRole('menuitem', { name: LABEL, exact: true }).click();
        await expectActive(COMPACT_QUERY_EXPLORER);
        expect((await publicMetadata(page)).account.address).toBe(address);
        await page.locator('#activity-btn').click();
        await expect(
          page.getByRole('button', { name: en.home.seeAllTxs, exact: true })
        ).toBeVisible();
        observations.compactQueryActive = await publicMetadata(page);
      }
    );
    await wallet.step(
      'activity-explorer: retain the address route and exact compact query value',
      async (capture) => {
        phase = 'compact-query-navigation';
        await capture(page);
        await clickExplorer(
          `${ROOT_EXPLORER}address/${encodeURIComponent(address)}?view=compact`
        );
        expect(navigationAttempts).toHaveLength(3);
        expect(popupObservations).toHaveLength(3);
        expect(new URL(navigationAttempts[2].url).search).toBe('?view=compact');
        expect((await publicMetadata(page)).account.address).toBe(address);
        expect(reads.some((read) => read.method === 'eth_getBalance')).toBe(
          true
        );
        expect(deniedRequests).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(pageErrors).toEqual([]);
        observations.compactQueryAfterClick = await publicMetadata(page);
      }
    );
    status = 'passed';
  } catch (error) {
    observations.failure =
      error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      await info.attach('activity-explorer-navigation-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime,
          status,
          testSourceSha256,
          observations,
          reads,
          navigationAttempts,
          popupObservations,
          deniedRequests,
          deniedWrites: routes?.deniedWrites || [],
          proxyDeniedConnections: server?.blocked.length || 0,
          pageErrors,
          syntheticHttpOnly: true,
          explorerRequestsAborted: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signaturesOrBroadcastsRequested: false,
          separateSdkQuerySuffixBehaviorExercised: true,
        }),
      });
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
