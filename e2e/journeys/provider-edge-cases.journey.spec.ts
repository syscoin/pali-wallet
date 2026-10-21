import { type Page, expect, test } from '@playwright/test';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import {
  EDGE_PENDING_HASH,
  EDGE_RPC_READS,
  EDGE_TOKEN,
  createEdgeTokenRuntime,
  edgeRpcOverride,
} from '../harness/providerEdgeFixture';
import {
  LOCAL_CHAINS,
  approve,
  extensionEvidence,
  installConformanceInstrumentation,
  launchConformanceWallet,
  localRpc,
  popupFor,
  providerRequest,
  settle,
  startLocalChains,
  startRequest,
} from '../harness/testDappConformance';

test('provider edges: exact RPC results, capabilities and ordinary asset watch', async () => {
  test.setTimeout(6 * 60 * 1000);
  const stopChains = await startLocalChains();
  const wallet = await launchConformanceWallet('provider-edge-cases').catch(
    (error) => {
      stopChains();
      throw error;
    }
  );
  const server = await startDappServer().catch(async (error) => {
    try {
      await wallet.dispose('failed');
    } finally {
      stopChains();
    }
    throw error;
  });
  const checks: any[] = [];
  const reads: Array<{ method: string; override: boolean }> = [];
  const deniedReads: string[] = [];
  const deniedWrites: string[] = [];
  const createdPages: Page[] = [];
  let onboarded = false;
  let status = 'failed';
  let address: string | undefined;
  let nonceBefore: string | undefined;
  let nonceAfter: string | undefined;
  const evidence = extensionEvidence();
  const reportPath = path.join(
    E2E_CONFIG.artifactsDir,
    'provider-edge-cases.json'
  );
  wallet.context.on('page', (page) => createdPages.push(page));

  const record = async (name: string, body: () => Promise<any>) => {
    const started = Date.now();
    try {
      const result = await wallet.step(name, body);
      checks.push({
        name,
        status: 'passed',
        durationMs: Date.now() - started,
        result,
      });
    } catch (error: any) {
      checks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - started,
        error: error.message,
      });
      throw error;
    }
  };
  try {
    const { forbiddenBroadcasts, broadcastGuardCanary } =
      await installConformanceInstrumentation(wallet.context);
    // Stronger than the shared conformance guard: this journey needs no
    // browser write at all, not even to Anvil. Unknown/public reads stay denied.
    await wallet.context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.fallback();
      if (
        url.origin === new URL(server.url).origin &&
        request.method() === 'GET'
      )
        return route.fallback();
      // A new wallet starts on UTXO. Let its explicitly synthetic zero
      // summary settle before normal Settings selects the local EVM chain;
      // a denied initial balance otherwise leaves the network gate non-idle.
      if (
        request.method() === 'GET' &&
        url.origin === 'https://blockbook.syscoin.org' &&
        /^\/api\/v2\/xpub\/[a-z]pub[1-9A-HJ-NP-Za-km-z]+$/.test(url.pathname)
      ) {
        reads.push({
          method: 'synthetic-initial-utxo-summary',
          override: true,
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            address: url.pathname.split('/').pop(),
            balance: '0',
            unconfirmedBalance: '0',
            unconfirmedTxs: 0,
            totalReceived: '0',
            totalSent: '0',
            txs: 0,
            usedTokens: 0,
            tokens: [],
            transactions: [],
          }),
        });
      }
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        /* Ordinary HTTP. */
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const local = LOCAL_CHAINS.find(
        (chain) => url.origin === chain.url && url.pathname === '/'
      );
      if (calls.some((call) => typeof call?.method === 'string')) {
        if (
          !local ||
          request.method() !== 'POST' ||
          calls.some((call) => !EDGE_RPC_READS.has(call?.method))
        ) {
          const write = calls.some((call) =>
            /^(?:eth_send|wallet_send|anvil_|evm_|personal_)/.test(
              call?.method || ''
            )
          );
          (write ? deniedWrites : deniedReads).push(
            `${url.origin}:${calls.map((call) => call?.method).join(',')}`
          );
          return route.abort('blockedbyclient');
        }
        const replies = await Promise.all(
          calls.map(async (call) => {
            const override = edgeRpcOverride(call.method, call.params || []);
            reads.push({ method: call.method, override: override.matched });
            try {
              const result = override.matched
                ? override.result
                : await localRpc(local.url, call.method, call.params || []);
              return { jsonrpc: '2.0', id: call.id, result };
            } catch {
              return {
                jsonrpc: '2.0',
                id: call.id,
                error: { code: -32603, message: 'Local read fixture failed' },
              };
            }
          })
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
        });
      }
      (['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        ? deniedReads
        : deniedWrites
      ).push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    });

    await record(
      'import public disposable fixture and install read-only token code',
      async () => {
        await wallet.importSeedAndCreatePassword();
        await wallet.ensureOnHome();
        onboarded = true;
        await wallet.gotoRoute('#/settings/networks/custom-rpc');
        await wallet.page
          .getByRole('combobox', { name: en.settings.label, exact: true })
          .fill('Pali provider edge fixture');
        await wallet.page.locator('#rpc_url').fill(LOCAL_CHAINS[0].url);
        await wallet.page
          .locator('#rpc_chainId')
          .fill(String(LOCAL_CHAINS[0].chainId));
        await wallet.page.locator('#rpc_symbol').fill('ETH');
        await wallet.page
          .getByRole('button', { name: /^(save|add)$/i })
          .click();
        await expect(
          wallet.page.getByText(en.settings.rpcSuccessfullyAdded, {
            exact: true,
          })
        ).toBeVisible();
        await wallet.gotoRoute('#/home');
        await wallet.switchNetwork('Pali provider edge fixture', 'EVM');
        const runtime = createEdgeTokenRuntime();
        // Administrative fixture state only: no deployment, signature, nonce or fee.
        await localRpc(LOCAL_CHAINS[0].url, 'anvil_setCode', [
          EDGE_TOKEN.address,
          runtime,
        ]);
        expect(
          await localRpc(LOCAL_CHAINS[0].url, 'eth_getCode', [
            EDGE_TOKEN.address,
            'latest',
          ])
        ).toBe(runtime);
        const decimals = await localRpc(LOCAL_CHAINS[0].url, 'eth_call', [
          { to: EDGE_TOKEN.address, data: id('decimals()').slice(0, 10) },
          'latest',
        ]);
        expect(
          AbiCoder.defaultAbiCoder().decode(['uint256'], decimals)[0]
        ).toBe(BigInt(EDGE_TOKEN.decimals));
        await wallet.page.goto('about:blank');
        return {
          syntheticToken: EDGE_TOKEN,
          installedBy: 'anvil_setCode',
          transaction: false,
        };
      }
    );

    const page = await wallet.context.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() =>
      Boolean((window as any).__paliConformanceProvider)
    );
    await record(
      'connect ordinary provider to the isolated local chain',
      async () => {
        expect(await providerRequest(page, 'eth_chainId')).toBe(
          LOCAL_CHAINS[0].hexId
        );
        const connection = await approve(
          wallet.context,
          page,
          await startRequest(page, 'eth_requestAccounts')
        );
        expect(connection.result).toHaveLength(1);
        [address] = connection.result;
        expect(address).toMatch(/^0x[\da-f]{40}$/i);
        expect(await providerRequest(page, 'eth_chainId')).toBe(
          LOCAL_CHAINS[0].hexId
        );
        nonceBefore = await localRpc(
          LOCAL_CHAINS[0].url,
          'eth_getTransactionCount',
          [address, 'latest']
        );
        return { address, chainId: LOCAL_CHAINS[0].hexId, nonceBefore };
      }
    );

    const withoutPopup = async (method: string, params?: any) => {
      const before = createdPages.length;
      const response = await settle(
        page,
        await startRequest(page, method, params)
      );
      expect(createdPages).toHaveLength(before);
      return response;
    };
    await record(
      'preserve valid false, zero, empty and pending-null RPC results',
      async () => {
        const values = [
          ['eth_syncing', undefined, false],
          ['net_listening', undefined, false],
          ['net_peerCount', undefined, '0x0'],
          ['web3_clientVersion', undefined, ''],
          ['eth_getTransactionReceipt', [EDGE_PENDING_HASH], null],
        ] as const;
        for (const [method, params, expected] of values) {
          const response = await withoutPopup(method, params);
          expect(response.error).toBeUndefined();
          expect(response.result).toBe(expected);
        }
        return values.map(([method, , result]) => ({ method, result }));
      }
    );

    await record(
      'malformed receipt requests return invalid-params without RPC or popup',
      async () => {
        const before = reads.filter(
          (read) => read.method === 'eth_getTransactionReceipt'
        ).length;
        const bad = [
          [],
          [null],
          [{}],
          ['0x1234'],
          [`0x${'z'.repeat(64)}`],
          [EDGE_PENDING_HASH, 'extra'],
        ];
        for (const params of bad) {
          const response = await withoutPopup(
            'eth_getTransactionReceipt',
            params
          );
          expect(response.error?.code).toBe(-32602);
          expect(response.result).toBeUndefined();
        }
        expect(
          reads.filter((read) => read.method === 'eth_getTransactionReceipt')
        ).toHaveLength(before);
        return { refused: bad.length, code: -32602, additionalRpcReads: 0 };
      }
    );

    await record(
      'capabilities use the connected address and requested chain filter',
      async () => {
        const own = await withoutPopup('wallet_getCapabilities', [
          address,
          [LOCAL_CHAINS[0].hexId],
        ]);
        expect(own.result).toEqual({
          [LOCAL_CHAINS[0].hexId]: { atomic: { status: 'unsupported' } },
        });
        expect(
          (
            await withoutPopup('wallet_getCapabilities', [
              address,
              [LOCAL_CHAINS[1].hexId],
            ])
          ).result
        ).toEqual({});
        expect(
          (await withoutPopup('wallet_getCapabilities', [address, []])).result
        ).toEqual({});
        expect(
          (
            await withoutPopup('wallet_getCapabilities', [
              '0x1111111111111111111111111111111111111111',
            ])
          ).error?.code
        ).toBe(4100);
        return {
          own: own.result,
          unsupportedChainOmitted: true,
          unauthorizedCode: 4100,
        };
      }
    );

    const baseBatch = {
      version: '2.0.0',
      from: address,
      chainId: LOCAL_CHAINS[0].hexId,
      atomicRequired: false,
      calls: [{ to: EDGE_TOKEN.address, value: '0x0' }],
    };
    await record(
      'unsupported required batch capabilities fail before opening approval',
      async () => {
        for (const request of [
          {
            ...baseBatch,
            capabilities: {
              paymasterService: { url: 'https://not-used.invalid' },
            },
          },
          {
            ...baseBatch,
            calls: [
              {
                ...baseBatch.calls[0],
                capabilities: { unknown: { optional: false } },
              },
            ],
          },
        ]) {
          const response = await withoutPopup('wallet_sendCalls', [request]);
          expect(response.error?.code).toBe(5700);
          expect(response.result).toBeUndefined();
        }
        return {
          requiredTopAndCallLevelRefused: true,
          code: 5700,
          popupOpened: false,
        };
      }
    );

    const ordinaryPopup = async (requestId: number) => {
      let popup = await popupFor(wallet.context, page, requestId);
      const warning = popup.getByRole('heading', {
        name: en.spamWarning.title,
        exact: true,
      });
      if (await warning.count()) {
        await expect(warning).toBeVisible();
        const closed = popup.waitForEvent('close', { timeout: 5000 });
        await clickClosingPopup({
          click: () =>
            popup
              .getByRole('button', { name: en.buttons.continue, exact: true })
              .click(),
          isClosed: () => popup.isClosed(),
        });
        await closed;
        checks.push({
          name: 'ordinary Continue after rapid deliberate QA rejections',
          status: 'passed',
          requestId,
        });
        popup = await popupFor(wallet.context, page, requestId);
      }
      return popup;
    };
    const rejectPopup = async (requestId: number, button: RegExp) => {
      const popup = await ordinaryPopup(requestId);
      await popup.screenshot({
        path: path.join(
          E2E_CONFIG.artifactsDir,
          `provider-edge-reject-${requestId}.png`
        ),
      });
      const response = await dismissRejectedApproval({
        click: () => popup.getByRole('button', { name: button }).click(),
        isClosed: () => popup.isClosed(),
        settle: () => settle(page, requestId),
      });
      expect(response.error?.code).toBe(4001);
      return response;
    };
    await record(
      'optional unknown capability reaches ordinary approval and user rejection',
      async () => {
        const requestId = await startRequest(page, 'wallet_sendCalls', [
          { ...baseBatch, capabilities: { unknown: { optional: true } } },
        ]);
        await rejectPopup(requestId, /^reject$/i);
        return { code: 4001, signed: false, broadcast: false };
      }
    );

    const watch = {
      type: 'ERC20',
      options: {
        address: EDGE_TOKEN.address,
        symbol: EDGE_TOKEN.symbol,
        decimals: EDGE_TOKEN.decimals,
      },
    };
    const matchingTokens = async () =>
      ((await providerRequest(page, 'wallet_getTokens')).ethereum || []).filter(
        (token: any) =>
          token.contractAddress?.toLowerCase() === EDGE_TOKEN.address
      );
    await record(
      'standard object asset watch can be cancelled without adding the token',
      async () => {
        const requestId = await startRequest(page, 'wallet_watchAsset', watch);
        const popup = await ordinaryPopup(requestId);
        await expect(
          popup.getByText(EDGE_TOKEN.symbol, { exact: true }).first()
        ).toBeVisible();
        await rejectPopup(requestId, /^cancel$/i);
        expect(await matchingTokens()).toEqual([]);
        return { code: 4001, tokenAdded: false };
      }
    );
    await record(
      'asset watch approval imports chain metadata and duplicate adds no popup',
      async () => {
        const requestId = await startRequest(page, 'wallet_watchAsset', watch);
        const popup = await ordinaryPopup(requestId);
        await expect(
          popup.getByText(EDGE_TOKEN.symbol, { exact: true }).first()
        ).toBeVisible();
        await popup.screenshot({
          path: path.join(
            E2E_CONFIG.artifactsDir,
            'provider-edge-watch-approve.png'
          ),
        });
        await popup.getByRole('button', { name: /^add token$/i }).click();
        const accepted = await settle(page, requestId, 30_000);
        expect(accepted.error).toBeUndefined();
        expect(accepted.result).toBe(true);
        const tokens = await matchingTokens();
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({
          tokenSymbol: EDGE_TOKEN.symbol,
          decimals: EDGE_TOKEN.decimals,
          chainId: LOCAL_CHAINS[0].chainId,
        });
        expect((await withoutPopup('wallet_watchAsset', watch)).result).toBe(
          true
        );
        expect(await matchingTokens()).toHaveLength(1);
        return {
          accepted: true,
          duplicatePopup: false,
          token: {
            symbol: tokens[0].tokenSymbol,
            decimals: tokens[0].decimals,
            chainId: tokens[0].chainId,
          },
        };
      }
    );
    await record(
      'malformed asset requests show a bounded error and can close normally',
      async () => {
        for (const asset of [
          { type: 'ERC20' },
          { type: 'ERC20', options: { address: 'not-an-address' } },
        ]) {
          const requestId = await startRequest(
            page,
            'wallet_watchAsset',
            asset
          );
          const popup = await ordinaryPopup(requestId);
          await expect(
            popup.getByRole('heading', {
              name: /^(invalid request format|asset not found)$/i,
            })
          ).toBeVisible();
          await expect(
            popup.getByRole('button', { name: /^add token$/i })
          ).toHaveCount(0);
          await rejectPopup(requestId, /^close$/i);
        }
        expect(await matchingTokens()).toHaveLength(1);
        return {
          malformed: 2,
          approvalUnavailable: true,
          closedWithCode: 4001,
        };
      }
    );

    nonceAfter = await localRpc(
      LOCAL_CHAINS[0].url,
      'eth_getTransactionCount',
      [address, 'latest']
    );
    expect(nonceAfter).toBe(nonceBefore);
    expect(forbiddenBroadcasts).toEqual([]);
    expect(deniedWrites).toEqual([]);
    checks.push({
      name: 'no signing or broadcast',
      status: 'passed',
      nonceBefore,
      nonceAfter,
      forbiddenBroadcasts,
      broadcastGuardCanary,
      deniedWrites,
    });
    await wallet.dispose('passed');
    status = 'passed';
  } catch (error) {
    status = 'failed';
    if (onboarded) {
      for (const popup of wallet.context
        .pages()
        .filter((candidate) => candidate.url().includes('/external'))) {
        await popup
          .screenshot({
            path: path.join(
              E2E_CONFIG.artifactsDir,
              'provider-edge-failure-popup.png'
            ),
          })
          .catch(() => undefined);
        checks.push({
          phase: 'failure',
          popup: popup.url(),
          body: await popup
            .locator('body')
            .innerText()
            .catch(() => ''),
        });
      }
    }
    await wallet.dispose('failed');
    throw error;
  } finally {
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          ...evidence,
          status,
          scope:
            'synthetic local Anvil; public provider and ordinary UI; zero transactions',
          checks,
          reads,
          deniedReads,
          deniedWrites,
          nonceBefore,
          nonceAfter,
        },
        null,
        2
      )
    );
    await server.close();
    stopChains();
  }
});
