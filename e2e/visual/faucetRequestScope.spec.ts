import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
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

const ORIGINAL_HASH = '0x' + 'ad'.repeat(32);
const CURRENT_HASH = '0x' + 'be'.repeat(32);
const ROLLUX_RPC = 'https://rpc.rollux.com';
const CLAIM_ORIGIN = 'https://chains.tools';
const state = (page: Page) =>
  page.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const { activeAccount, activeNetwork, accounts } = current.vault;
    return {
      chainId: activeNetwork.chainId,
      kind: activeNetwork.kind,
      url: activeNetwork.url,
      address: accounts[activeAccount.type][activeAccount.id].address,
      status: current.vaultGlobal.networkStatus,
      loading: current.vaultGlobal.isPostNetworkSwitchLoading,
      switching: current.vaultGlobal.isSwitchingAccount,
    };
  });

// The second ordinary app document uses the same actual menu as PaliWallet.
// Do not assign wallet.page or call a controller mutation from evaluate().
async function switchOther(
  page: Page,
  label: string,
  group: 'EVM' | 'UTXO',
  chainId: number
) {
  const header = page
    .getByRole('button')
    .filter({ hasText: /UTXO|EVM/ })
    .first();
  await expect(header).toBeEnabled();
  await header.click();
  const menu = page.getByRole('menu');
  const section = menu
    .getByRole('menuitem', { name: new RegExp(`${group} Networks`, 'i') })
    .first();
  if ((await section.getAttribute('aria-expanded')) !== 'true')
    await section.click();
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
  const faucetTitle = en.faucet.firstAccessTitle
    .replace('{{token}}', chainId === 570 ? 'SYS' : 'TSYS')
    .replace('{{network}}', label);
  const prompt = page.getByRole('dialog', { name: faucetTitle, exact: true });
  let previouslyReady = false;
  await expect
    .poll(async () => {
      const current = await state(page);
      if (
        current.chainId !== chainId ||
        current.kind !== (group === 'EVM' ? 'ethereum' : 'syscoin') ||
        current.status !== 'idle' ||
        current.loading ||
        current.switching
      ) {
        previouslyReady = false;
        return false;
      }
      if (await prompt.isVisible()) {
        await prompt
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        previouslyReady = false;
        return false;
      }
      const ready =
        (await header.isVisible()) &&
        (await page.locator('#home-balance').isVisible());
      const settled = ready && previouslyReady;
      previouslyReady = ready;
      return settled;
    })
    .toBe(true);
}

test('faucet feedback and eligibility follow a network switch in another normal wallet document', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  expect(runtime.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(runtime.bundleHashes).toEqual({
    background: expect.stringMatching(/^[a-f0-9]{64}$/),
    external: expect.stringMatching(/^[a-f0-9]{64}$/),
    inpage: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(__filename))
    .digest('hex');
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let other: Page | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const claims: Array<{ address: string; networkKey: string }> = [];
  const releases: Array<(success: boolean) => Promise<void>> = [];
  const deniedClaims: string[] = [];
  const deniedRollux: unknown[] = [];
  const rolluxReads: string[] = [];
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'FaucetScopeSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('faucet-request-scope', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Exact additional ordinary Rollux endpoint. Every value is synthetic;
    // the launch proxy continues to deny all unhandled public traffic.
    await wallet.context.route(ROLLUX_RPC + '/**', async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        payload = null;
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const replies = calls.map((call) => {
        if (
          route.request().method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          !Array.isArray(call.params)
        )
          return undefined;
        let result: unknown;
        switch (call.method) {
          case 'eth_chainId':
            result = '0x23a';
            break;
          case 'net_version':
            result = '570';
            break;
          case 'eth_blockNumber':
            result = '0x1';
            break;
          case 'eth_gasPrice':
          case 'eth_maxPriorityFeePerGas':
            result = '0x3b9aca00';
            break;
          case 'eth_getBalance':
          case 'eth_getTransactionCount':
            if (
              !fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() === String(call.params[0]).toLowerCase()
              )
            )
              return undefined;
            result = '0x0';
            break;
          case 'eth_getCode':
            if (!/^0x[0-9a-f]{40}$/i.test(String(call.params[0])))
              return undefined;
            result = '0x';
            break;
          case 'eth_getLogs':
            result = [];
            break;
          case 'eth_getBlockByNumber': {
            if (
              !['latest', '0x0', '0x1'].includes(call.params[0]) ||
              typeof call.params[1] !== 'boolean'
            )
              return undefined;
            const genesis = call.params[0] === '0x0';
            result = {
              number: genesis ? '0x0' : '0x1',
              hash: '0x' + (genesis ? '30' : '31').repeat(32),
              parentHash: '0x' + (genesis ? '00' : '30').repeat(32),
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
        rolluxReads.push(call.method);
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (!calls.length || replies.some((reply) => reply === undefined)) {
        deniedRollux.push(payload);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    // Never forwards a faucet request: this handler owns each exact GET and
    // resolves it only with a locally authored response after the UI action.
    await wallet.context.route(
      CLAIM_ORIGIN + '/api/faucet/claim?*',
      async (route) => {
        const url = new URL(route.request().url());
        const networkKey = url.searchParams.get('networkKey') || '';
        const address = url.searchParams.get('walletAddress') || '';
        if (
          route.request().method() !== 'GET' ||
          [...url.searchParams.keys()].sort().join(',') !==
            'networkKey,walletAddress' ||
          !['nevm-testnet', 'rollux-mainnet'].includes(networkKey) ||
          !fixture.evmAddresses.includes(address)
        ) {
          deniedClaims.push(route.request().url());
          return route.abort('blockedbyclient');
        }
        const index = claims.length;
        claims.push({ networkKey, address });
        let resolve!: (success: boolean) => void;
        const response = new Promise<boolean>((done) => {
          resolve = done;
        });
        let completed!: () => void;
        const completion = new Promise<void>((done) => {
          completed = done;
        });
        releases.push(async (success) => {
          resolve(success);
          await completion;
        });
        const success = await response;
        try {
          await route.fulfill({
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              data: {
                status: success,
                hash: index === 0 ? ORIGINAL_HASH : CURRENT_HASH,
                message: 'Synthetic cancelled response',
              },
            }),
          });
        } finally {
          completed();
        }
      }
    );

    await wallet.step(
      'faucet-scope: onboard and enter the eligible faucet through its normal Home action',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        const before = await state(wallet!.page);
        expect(before).toMatchObject({
          chainId: 5700,
          kind: 'ethereum',
          status: 'idle',
        });
        expect(fixture.evmAddresses).toContain(before.address);
        await wallet!.page
          .getByText(en.faucet.grabTextTwo.replace('{{token}}', 'TSYS'), {
            exact: true,
          })
          .click();
        await expect(wallet!.page).toHaveURL(/#\/faucet$/);
        await expect(
          wallet!.page.getByRole('button', {
            name: en.faucet.requestNow,
            exact: true,
          })
        ).toBeEnabled();
        observations.initial = before;
        await wallet!.page.evaluate((hash) => {
          const observed = { oldHashSeen: false };
          (window as any).__faucetDomObservation = observed;
          const observe = () => {
            if (document.body.textContent?.includes(hash))
              observed.oldHashSeen = true;
          };
          new MutationObserver(observe).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }, ORIGINAL_HASH);
      }
    );
    await wallet.step(
      'faucet-scope: start one synthetic request and open a second ordinary wallet document',
      async (capture) => {
        await wallet!.page
          .getByRole('button', { name: en.faucet.requestNow, exact: true })
          .click();
        await expect.poll(() => claims.length).toBe(1);
        expect(claims[0]).toEqual({
          networkKey: 'nevm-testnet',
          address: (observations.initial as any).address,
        });
        await expect(
          wallet!.page.getByText(en.faucet.pleaseWait, { exact: true })
        ).toBeVisible();
        other = await wallet!.context.newPage();
        await other.goto(wallet!.appUrl('#/home'));
        await expect(other.locator('#home-balance')).toBeVisible();
        await expect(wallet!.page).toHaveURL(/#\/faucet$/);
        await capture(other);
      }
    );
    await wallet.step(
      'faucet-scope: change the selected network using only the second document menu',
      async (capture) => {
        await switchOther(other!, 'Rollux', 'EVM', 570);
        await expect
          .poll(() => state(wallet!.page))
          .toMatchObject({ chainId: 570, kind: 'ethereum', status: 'idle' });
        await expect(wallet!.page).toHaveURL(/#\/faucet$/);
        await expect(
          wallet!.page.getByRole('button', {
            name: en.faucet.requestNow,
            exact: true,
          })
        ).toBeEnabled();
        observations.afterSwitch = await state(wallet!.page);
        await capture(other!);
      }
    );
    await wallet.step(
      'faucet-scope: retire the old response and complete a healthy current-network request',
      async () => {
        await releases[0](true);
        await wallet!.page
          .getByRole('button', { name: en.faucet.requestNow, exact: true })
          .click();
        await expect.poll(() => claims.length).toBe(2);
        expect(claims[1]).toEqual({
          networkKey: 'rollux-mainnet',
          address: (observations.afterSwitch as any).address,
        });
        await releases[1](true);
        await expect(
          wallet!.page.getByText(CURRENT_HASH, { exact: true })
        ).toBeVisible();
        await expect(
          wallet!.page.getByText(
            'Some $SYS has just been sent to your Rollux wallet.',
            { exact: true }
          )
        ).toBeVisible();
        await expect(
          wallet!.page.getByText(ORIGINAL_HASH, { exact: true })
        ).toHaveCount(0);
        observations.dom = await wallet!.page.evaluate(
          () => (window as any).__faucetDomObservation
        );
        expect(observations.dom).toEqual({ oldHashSeen: false });
      }
    );
    await wallet.step(
      'faucet-scope: a normal UTXO switch removes unsupported faucet actions',
      async (capture) => {
        await switchOther(other!, 'Syscoin Testnet', 'UTXO', 5700);
        await expect(wallet!.page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(
          wallet!.page.getByRole('button', {
            name: en.faucet.requestNow,
            exact: true,
          })
        ).toHaveCount(0);
        await expect(
          wallet!.page.getByText(CURRENT_HASH, { exact: true })
        ).toHaveCount(0);
        expect(claims).toHaveLength(2);
        observations.unsupported = await state(wallet!.page);
        expect(observations.unsupported).toMatchObject({
          chainId: 5700,
          kind: 'syscoin',
          status: 'idle',
        });
        await capture(other!);
      }
    );
    await wallet.step(
      'faucet-scope: retain exact public-target and unchanged-runtime evidence',
      async () => {
        expect(deniedClaims).toEqual([]);
        expect(deniedRollux).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(rolluxReads).toContain('eth_chainId');
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
        ).toBe(testSourceSha256);
      }
    );
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await info.attach('faucet-request-scope-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            status,
            syntheticResponsesOnly: true,
            faucetRequestsForwarded: false,
            controllerMutationsInjected: false,
            controllerResultsReplaced: false,
            chromeApisReplaced: false,
            observations,
            claims,
            deniedClaims,
            rolluxReads,
            deniedRollux,
            deniedWrites: routes?.deniedWrites,
            proxyBlocked: server?.blocked,
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
        await Promise.all(
          releases.map((release) => release(false).catch(() => undefined))
        );
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
  }
});
