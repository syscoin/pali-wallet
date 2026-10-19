import { expect, test } from '@playwright/test';
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

for (const malformedStatus of [404, 200]) {
  test(`pending history HTTP ${malformedStatus} malformed JSON preserves confirmed rows and recovers on the next poll`, async ({}, info) => {
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const owner = fixture.evmAddresses[0];
    const other = `0x${'44'.repeat(20)}`;
    const contract = `0x${'33'.repeat(20)}`;
    const hash = (digit: string) => `0x${digit.repeat(64)}`;
    const now = Math.floor(Date.now() / 1000);
    const native = {
      hash: hash('a'),
      from: other,
      to: owner,
      value: '1000000000000000000',
      input: '0x',
      nonce: '8',
      blockNumber: '100',
      blockHash: hash('d'),
      timeStamp: String(now - 2),
      confirmations: '1',
      type: '2',
      gas: '21000',
      gasPrice: '1000000000',
      isError: '0',
      // eslint-disable-next-line camelcase -- Explorer wire field.
      txreceipt_status: '1',
    };
    const token = {
      ...native,
      hash: hash('b'),
      contractAddress: contract,
      // These are two distinct mined transactions from the same sender, not
      // competing replacements. The real sorter keys them by sender + nonce.
      nonce: '9',
      value: '2',
      tokenDecimal: '0',
      tokenSymbol: 'HISTORY',
      timeStamp: String(now - 1),
    };
    const pending = {
      ...native,
      hash: hash('c'),
      from: owner,
      to: other,
      value: '3000000000000000000',
      nonce: '9',
      blockNumber: null,
      blockHash: null,
      timeStamp: String(now),
      confirmations: '0',
    };
    let pendingUnavailable = true;
    const explorerReads: Array<{
      action: string | null;
      malformed: boolean;
      status: number;
    }> = [];
    const attemptedWrites: string[] = [];
    const observations: Record<string, unknown> = {
      malformedStatus,
      controllerStateReplaced: false,
      controllerResultsReplaced: false,
      syntheticHttpOnly: true,
      signingOrBroadcastRequested: false,
    };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PendingHistorySyntheticOnly!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    try {
      wallet = await PaliWallet.launch(`pending-history-${malformedStatus}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      observations.runtime = extensionEvidence();
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          attemptedWrites.push(...calls.map((call: any) => call.method));
          return route.abort('blockedbyclient');
        }
        const replies = calls.map((call: any) => {
          const result =
            call.method === 'eth_getTransactionCount'
              ? '0x9'
              : call.method === 'eth_blockNumber'
              ? '0x64'
              : undefined;
          return result === undefined
            ? undefined
            : { jsonrpc: '2.0', id: call.id, result };
        });
        if (!replies.every((reply) => reply !== undefined))
          return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      });
      await wallet.context.route(
        'https://explorer.tanenbaum.io/api**',
        async (route) => {
          if (route.request().method() !== 'GET') {
            attemptedWrites.push('non-GET-explorer');
            return route.abort('blockedbyclient');
          }
          const url = new URL(route.request().url());
          const action = url.searchParams.get('action');
          const address = url.searchParams.get('address');
          const matchedOwner = address?.toLowerCase() === owner.toLowerCase();
          const malformed =
            matchedOwner && action === 'pendingtxlist' && pendingUnavailable;
          explorerReads.push({
            action,
            malformed,
            status: malformed ? malformedStatus : 200,
          });
          if (malformed)
            return route.fulfill({
              status: malformedStatus,
              contentType: 'text/html',
              headers: { 'access-control-allow-origin': '*' },
              body: '<html>Optional pending endpoint unavailable</html>',
            });
          const result = matchedOwner
            ? action === 'txlist'
              ? [native]
              : action === 'tokentx'
              ? [token]
              : action === 'pendingtxlist'
              ? [pending]
              : []
            : ['eth_block_number', 'eth_blockNumber'].includes(action || '')
            ? '0x64'
            : [];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              status: Array.isArray(result) && !result.length ? '0' : '1',
              message:
                Array.isArray(result) && !result.length
                  ? 'No transactions found'
                  : 'OK',
              result,
            }),
          });
        }
      );
      const page = wallet.page;
      const activity = page.locator('#activity-panel-list');
      const confirmed = activity.getByText(en.send.confirmed, { exact: true });
      const pendingLabel = activity.getByText(en.send.pending, { exact: true });
      const storedHistory = () =>
        page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const { activeAccount, activeNetwork, accountTransactions } =
            state.vault;
          const rows =
            accountTransactions[activeAccount.type]?.[activeAccount.id]
              ?.ethereum?.[activeNetwork.chainId] || [];
          return rows.map((row: any) => ({
            hash: row.hash,
            blockNumber: row.blockNumber,
            from: row.from,
            nonce: row.nonce,
            historySource: row.historySource,
          }));
        });
      await wallet.step(
        'malformed optional pending response retains native and token Activity rows',
        async (capture) => {
          try {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await wallet!.ensureOnHome();
            await page.locator('#activity-btn').click();
            observations.beforeInitialUiAssertion = await storedHistory();
            await expect(confirmed).toHaveCount(2);
            await expect(pendingLabel).toHaveCount(0);
            await expect(activity).toContainText('2 HISTORY');
            expect(explorerReads.some((read) => read.malformed)).toBe(true);
            observations.beforeRecovery = await storedHistory();
            expect(observations.beforeRecovery).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  hash: native.hash,
                  blockNumber: 100,
                }),
                expect.objectContaining({ hash: token.hash, blockNumber: 100 }),
              ])
            );
          } finally {
            if (!page.isClosed()) {
              observations.initialStepFinalHistory = await storedHistory();
              await capture(page);
            }
          }
        }
      );
      await wallet.step(
        'real read-only follow-up poll recovers the pending row without losing confirmed rows',
        async (capture) => {
          const firstRecoveryRead = explorerReads.length;
          pendingUnavailable = false;
          // Exercise the actual polling controller from the trusted extension
          // page. forceRefresh bypasses only its read cache, not mapping/state.
          observations.poll = await page.evaluate(async () => {
            const state = await chrome.runtime.sendMessage({
              type: 'getCurrentState',
            });
            if (
              state.vault.isBitcoinBased ||
              state.vault.activeNetwork.chainId !== 5700
            )
              throw new Error('Expected synthetic EVM network');
            const result = await chrome.runtime.sendMessage({
              type: 'CONTROLLER_ACTION',
              data: {
                methods: ['wallet', 'updateUserTransactionsState'],
                params: [
                  {
                    activeNetwork: state.vault.activeNetwork,
                    isBitcoinBased: false,
                    isPolling: true,
                    forceRefresh: true,
                  },
                ],
              },
            });
            if (result?.error || result?.success === false)
              throw new Error(`History poll failed: ${JSON.stringify(result)}`);
            return {
              operation: 'wallet.updateUserTransactionsState',
              successful: true,
            };
          });
          await expect(confirmed).toHaveCount(2);
          await expect(pendingLabel).toHaveCount(1);
          await expect(activity).toContainText('2 HISTORY');
          expect(explorerReads.slice(firstRecoveryRead)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: 'pendingtxlist',
                malformed: false,
              }),
              expect.objectContaining({ action: 'txlist' }),
              expect.objectContaining({ action: 'tokentx' }),
            ])
          );
          observations.afterRecovery = await storedHistory();
          expect(observations.afterRecovery).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ hash: native.hash, blockNumber: 100 }),
              expect.objectContaining({ hash: token.hash, blockNumber: 100 }),
              expect.objectContaining({
                hash: pending.hash,
                blockNumber: null,
              }),
            ])
          );
          await capture(page);
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await info.attach('pending-history-evidence', {
          body: JSON.stringify(
            {
              ...observations,
              status,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(__filename))
                .digest('hex'),
              explorerReads,
              deniedWrites: [
                ...attemptedWrites,
                ...(routes?.deniedWrites || []),
              ],
              proxyDeniedConnections: server.blocked.length,
            },
            null,
            2
          ),
          contentType: 'application/json',
        });
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
  });
}
