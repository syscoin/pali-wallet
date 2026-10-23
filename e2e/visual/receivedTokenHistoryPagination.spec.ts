import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { Interface } from 'ethers';
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

for (const mode of ['reload', 'received', 'mixed', 'partial'] as const) {
  const loadMore = mode !== 'reload';
  const mixed = mode === 'mixed';
  const partial = mode === 'partial';
  test(
    partial
      ? 'incomplete received-token history keeps the same older page retryable until both explorer feeds recover'
      : mixed
      ? 'mixed native and received-token history retains both initial explorer windows when loading more'
      : loadMore
      ? 'received-only token history loads the older page through the real explorer controller'
      : 'received-only token history keeps its first thirty rows after ordinary reload',
    async ({}, info) => {
      test.setTimeout(120_000);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const previous = { ...E2E_CONFIG };
      const fixture = createIsolatedVaultFixture();
      // Port 0 allocates a fresh loopback proxy before Chromium starts. It
      // never forwards unhandled requests to public services.
      const server = await startUtxoFixtureServer();
      const recipient = fixture.evmAddresses[0];
      const contract = `0x${'33'.repeat(20)}`;
      const sender = `0x${'44'.repeat(20)}`;
      const transfer = new Interface([
        'function transfer(address to, uint256 value)',
      ]);
      const now = Math.floor(Date.now() / 1000);
      const events = Array.from({ length: partial ? 120 : 60 }, (_, index) => ({
        hash: `0x${(index + 1).toString(16).padStart(64, '0')}`,
        from: sender,
        to: recipient,
        contractAddress: contract,
        value: String(index + 1),
        input: transfer.encodeFunctionData('transfer', [recipient, index + 1]),
        nonce: String(index),
        blockNumber: String((partial ? 200 : 100) - index),
        blockHash: `0x${((partial ? 200 : 100) - index)
          .toString(16)
          .padStart(64, '0')}`,
        timeStamp: String(now - index),
        confirmations: String(index + 1),
        chainId: 5700,
        type: '2',
        gas: '50000',
        gasUsed: '45000',
        gasPrice: '1000000000',
        isError: '0',
        // eslint-disable-next-line camelcase -- Explorer wire field.
        txreceipt_status: '1',
      }));
      const nativeRows =
        mixed || partial
          ? events.slice(0, partial ? 31 : 30).map((row) => ({
              ...row,
              from: recipient,
              to: sender,
              contractAddress: undefined,
              input: '0x',
            }))
          : [];
      const tokenRows = partial
        ? events.slice(60)
        : mixed
        ? events.slice(30)
        : events;
      let failOlderTokenPage = false;
      const explorerReads: Array<{
        action: string | null;
        offset: string | null;
        page: string | null;
        rows: number;
        txhash: string | null;
        unavailable?: boolean;
      }> = [];
      const rpcReads: string[] = [];
      const attemptedWrites: string[] = [];
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      const observations: Record<string, unknown> = {
        syntheticHttpOnly: true,
        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        signingOrBroadcastRequested: false,
        ordinaryTransactionCount: nativeRows.length,
        explorerTokenEvents: tokenRows.length,
      };
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'ReceivedHistorySyntheticOnly!2026',
        rpcUrl: server.url,
        chainId: 5700,
        networkLabel: 'Syscoin NEVM Testnet',
      });
      try {
        wallet = await PaliWallet.launch(
          partial
            ? 'partial-token-history-retry'
            : mixed
            ? 'mixed-native-token-history-paging'
            : loadMore
            ? 'received-token-history-paging'
            : 'received-token-history-initial',
          {
            offlineHttpProxy: server.url,
            viewport: { width: 400, height: 620 },
          }
        );
        observations.runtime = extensionEvidence();
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        await wallet.context.route(
          'https://rpc.tanenbaum.io/',
          async (route) => {
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
                  ? `0x${nativeRows.length.toString(16)}`
                  : call.method === 'eth_blockNumber'
                  ? partial
                    ? '0xc8'
                    : '0x64'
                  : undefined;
              return result === undefined
                ? undefined
                : {
                    jsonrpc: '2.0',
                    id: call.id,
                    result,
                  };
            });
            if (!replies.every((reply) => reply !== undefined))
              return route.fallback();
            rpcReads.push(...calls.map((call: any) => call.method));
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
            });
          }
        );
        // This is the real built-in testnet API URL. Only its HTTP data is
        // synthetic; extension polling, mapping, Redux updates and UI are real.
        await wallet.context.route(
          'https://explorer.tanenbaum.io/api**',
          async (route) => {
            if (route.request().method() !== 'GET') {
              attemptedWrites.push('non-GET-explorer');
              return route.abort('blockedbyclient');
            }
            const url = new URL(route.request().url());
            const action = url.searchParams.get('action');
            const page = url.searchParams.get('page');
            const offset = url.searchParams.get('offset');
            const txhash = url.searchParams.get('txhash');
            const unavailable =
              failOlderTokenPage &&
              action === 'tokentx' &&
              page === '2' &&
              offset === '30';
            let result: unknown = [];
            if (
              ['tokentx', 'txlist'].includes(action || '') &&
              url.searchParams.get('address')?.toLowerCase() ===
                recipient.toLowerCase()
            ) {
              const rows = action === 'tokentx' ? tokenRows : nativeRows;
              const size = Number(offset || Math.max(1, rows.length));
              const pageNumber = Number(page || 1);
              result = rows.slice((pageNumber - 1) * size, pageNumber * size);
            } else if (action === 'gettxinfo') {
              result = events.find((event) => event.hash === txhash) || null;
            } else if (
              ['eth_block_number', 'eth_blockNumber'].includes(action || '')
            ) {
              result = partial ? '0xc8' : '0x64';
            }
            explorerReads.push({
              action,
              page,
              offset,
              txhash,
              rows: unavailable ? 0 : Array.isArray(result) ? result.length : 0,
              ...(unavailable ? { unavailable: true } : {}),
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({
                status:
                  unavailable || (Array.isArray(result) && !result.length)
                    ? '0'
                    : '1',
                message: unavailable
                  ? 'NOTOK'
                  : Array.isArray(result) && !result.length
                  ? 'No transactions found'
                  : 'OK',
                result: unavailable
                  ? 'Synthetic history endpoint unavailable'
                  : result,
              }),
            });
          }
        );
        const page = wallet.page;
        const details = page
          .locator('#activity-panel-list')
          .getByRole('button', {
            name: en.notifications.clickToView,
            exact: true,
          });
        await wallet.step(
          `${mode}: poll the first thirty history rows through normal wallet UI`,
          async (capture) => {
            try {
              await wallet!.importSeedAndCreatePassword();
              await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
              await wallet!.ensureOnHome();
              await page.locator('#activity-btn').click();
              await expect(details).toHaveCount(30);
              expect(
                explorerReads.some(
                  (read) =>
                    read.action === 'tokentx' &&
                    read.rows === (partial ? 30 : tokenRows.length)
                )
              ).toBe(true);
              expect(
                explorerReads
                  .filter((read) => read.action === 'txlist')
                  .every(
                    (read) => read.rows === (partial ? 30 : nativeRows.length)
                  )
              ).toBe(true);
              observations.initialRows = await details.count();
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        if (partial) {
          await wallet.step(
            'keep the original rows and same page retryable after one nonempty explorer feed fails',
            async (capture) => {
              try {
                const start = explorerReads.length;
                failOlderTokenPage = true;
                const more = page.getByRole('button', {
                  name: en.buttons.loadMore,
                  exact: true,
                });
                await more.scrollIntoViewIfNeeded();
                await more.click();
                await expect
                  .poll(() =>
                    explorerReads
                      .slice(start)
                      .some(
                        (read) =>
                          read.action === 'tokentx' &&
                          read.page === '2' &&
                          read.unavailable
                      )
                  )
                  .toBe(true);
                await expect(
                  page.getByText('Synthetic history endpoint unavailable', {
                    exact: true,
                  })
                ).toBeVisible();
                await expect(more).toBeEnabled();
                await expect(details).toHaveCount(30);
                expect(explorerReads.slice(start)).toEqual(
                  expect.arrayContaining([
                    expect.objectContaining({
                      action: 'txlist',
                      page: '2',
                      offset: '30',
                      rows: 1,
                    }),
                    expect.objectContaining({
                      action: 'tokentx',
                      page: '2',
                      offset: '30',
                      unavailable: true,
                    }),
                  ])
                );
                observations.afterIncompletePageRows = await details.count();
                observations.failedPageReads = explorerReads.slice(start);
              } finally {
                observations.incompletePageSnapshot = {
                  renderedRows: await details.count(),
                  loadMoreButtons: await page
                    .getByRole('button', {
                      name: en.buttons.loadMore,
                      exact: true,
                    })
                    .count(),
                  visibleWarning: await page
                    .getByText('Synthetic history endpoint unavailable', {
                      exact: true,
                    })
                    .isVisible(),
                };
                if (!page.isClosed()) await capture(page);
              }
            }
          );
          await wallet.step(
            'retry the unchanged older page after the HTTP endpoint recovers and show every missing row',
            async (capture) => {
              try {
                const start = explorerReads.length;
                failOlderTokenPage = false;
                await page
                  .getByRole('button', {
                    name: en.buttons.loadMore,
                    exact: true,
                  })
                  .click();
                await expect(details).toHaveCount(91);
                const recovered = explorerReads.slice(start);
                for (const action of ['txlist', 'tokentx'])
                  expect(recovered).toEqual(
                    expect.arrayContaining([
                      expect.objectContaining({
                        action,
                        page: '2',
                        offset: '30',
                      }),
                    ])
                  );
                expect(recovered.some((read) => read.page === '3')).toBe(false);
                observations.recoveredRows = await details.count();
                observations.recoveredPageReads = recovered;
                await details.last().click();
                const oldest = events[119].hash;
                await expect
                  .poll(() =>
                    explorerReads.some(
                      (read) =>
                        read.action === 'gettxinfo' && read.txhash === oldest
                    )
                  )
                  .toBe(true);
                observations.openedRecoveredHash = oldest;
              } finally {
                if (!page.isClosed()) await capture(page);
              }
            }
          );
        } else if (loadMore) {
          await wallet.step(
            `${mode}: load more history and open its oldest actual row`,
            async (capture) => {
              try {
                const start = explorerReads.length;
                const more = page.getByRole('button', {
                  name: en.buttons.loadMore,
                  exact: true,
                });
                await more.scrollIntoViewIfNeeded();
                await expect(more).toBeEnabled();
                await more.click();
                await expect(details).toHaveCount(60, { timeout: 10_000 });
                const requested = explorerReads.slice(start);
                for (const action of ['txlist', 'tokentx'])
                  expect(
                    requested.some(
                      (read) =>
                        read.action === action &&
                        read.page === '2' &&
                        read.offset === '30'
                    )
                  ).toBe(true);
                observations.loadedRows = await details.count();
                await details.last().click();
                await expect(page).toHaveURL(/#\/home\/details/);
                const oldest = events[59].hash;
                await expect
                  .poll(() =>
                    explorerReads.some(
                      (read) =>
                        read.action === 'gettxinfo' && read.txhash === oldest
                    )
                  )
                  .toBe(true);
                await expect(
                  page.getByText(en.send.transactionId, { exact: true })
                ).toBeVisible();
                observations.openedOlderHash = oldest;
              } finally {
                if (!page.isClosed()) await capture(page);
              }
            }
          );
          if (mixed) {
            await wallet.step(
              'mixed: retain both explorer windows through browser Back and ordinary document reload',
              async (capture) => {
                try {
                  await page.goBack();
                  await expect(details).toHaveCount(60);
                  await page.reload();
                  await wallet!.ensureOnHome();
                  await page.locator('#activity-btn').click();
                  await expect(details).toHaveCount(60);
                  observations.afterMixedReloadRows = await details.count();
                } finally {
                  if (!page.isClosed()) await capture(page);
                }
              }
            );
          }
        } else {
          await wallet.step(
            'reload the normal document without changing received-token history',
            async (capture) => {
              try {
                await page.reload();
                await wallet!.ensureOnHome();
                await page.locator('#activity-btn').click();
                await expect(details).toHaveCount(30);
                observations.afterReloadRows = await details.count();
              } finally {
                if (!page.isClosed()) await capture(page);
              }
            }
          );
        }
        expect(routes.deniedWrites).toEqual([]);
        expect(attemptedWrites).toEqual([]);
        status = 'passed';
      } finally {
        try {
          const evidence = info.outputPath(
            'received-token-history-evidence.json'
          );
          fs.writeFileSync(
            evidence,
            JSON.stringify(
              {
                ...observations,
                status,
                testSourceSha256: createHash('sha256')
                  .update(fs.readFileSync(__filename))
                  .digest('hex'),
                explorerReads,
                rpcReads,
                deniedWrites: [
                  ...attemptedWrites,
                  ...(routes?.deniedWrites || []),
                ],
                proxyDeniedConnections: server.blocked.length,
              },
              null,
              2
            )
          );
          await info.attach('received-token-history-evidence', {
            path: evidence,
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
    }
  );
}
