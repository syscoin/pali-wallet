import { expect, test } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  visualFixtureRead,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_RPC,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

test('ordinary Load more retains readable replaced Activity with its mined winner', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  if (process.env.PALI_FOREGROUND_CONTRAST_MODE === 'before') {
    expect(process.env.CI).toBeFalsy();
    expect(runtime.sourceRevision).toBe(
      '9bdf263ed621f6755f97ad55cdb34d9337c68a86'
    );
  }

  const previous = { ...E2E_CONFIG };
  const fixture = createVisualFixture();
  const timestamp = Math.floor(Date.now() / 1000);
  const healthy = {
    ...fixture.transactions[1],
    from: fixture.address,
    to: fixture.transactions[1].from,
    value: '2000000000000000000',
    nonce: '8',
    type: '2',
    timeStamp: String(timestamp - 60),
  };
  const original = {
    ...fixture.transactions[0],
    from: fixture.address,
    to: fixture.transactions[0].from,
    nonce: '9',
    type: '2',
    blockNumber: null,
    blockHash: null,
    transactionIndex: null,
    confirmations: '0',
    timeStamp: String(timestamp),
    gasUsed: null,
    // eslint-disable-next-line camelcase -- Explorer wire spelling.
    txreceipt_status: null,
  };
  const winner = {
    ...fixture.transactions[0],
    hash: `0x${'73'.repeat(32)}`,
    from: original.from,
    to: original.to,
    nonce: original.nonce,
    type: '2',
    blockNumber: '43',
    blockHash: `0x${'74'.repeat(32)}`,
    transactionIndex: '0',
    timeStamp: String(timestamp + 1),
  };
  let phase: 'pending' | 'mined' = 'pending';
  fixture.transactions = [healthy];
  const rpcTransaction = (row: any) => ({
    ...row,
    value: `0x${BigInt(row.value).toString(16)}`,
    gas: '0x5208',
    gasPrice: '0x3b9aca00',
    maxFeePerGas: '0x77359400',
    maxPriorityFeePerGas: '0x3b9aca00',
    nonce: `0x${BigInt(row.nonce).toString(16)}`,
    blockNumber: row.blockNumber
      ? `0x${BigInt(row.blockNumber).toString(16)}`
      : null,
    transactionIndex:
      row.transactionIndex === null
        ? null
        : `0x${BigInt(row.transactionIndex).toString(16)}`,
    chainId: '0xdee1',
    type: '0x2',
    accessList: [],
    r: `0x${'01'.repeat(32)}`,
    s: `0x${'02'.repeat(32)}`,
    v: '0x0',
    yParity: '0x0',
  });
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'ReplacedActivitySynthetic!2026',
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
    rpcUrl: server.url,
  });
  // Exact intentionally blocked bootstrap reads for the public VISUAL seed.
  // This is not a fetch allowlist: matching requests still abort locally.
  const bootstrapXpub =
    'zpub6rDVW1mjUwdMmUohC7sHcrLWbSP369R9vM9bFqz8C8e9c2rUSoqXZxFuVZpMh17cmmQxdnp8kAPxrsJ7xSdDGupY5PCnuYzNxezLyo3CRV9';
  const expectedBlockedReads = new Set([
    ...[
      'details=tokenBalances&tokens=nonzero',
      'details=tokenBalances&tokens=used',
      'details=txslight&pageSize=30',
      'details=txsummary&pageSize=30',
    ].map(
      (query) =>
        `https://blockbook.syscoin.org/api/v2/xpub/${bootstrapXpub}?${query}`
    ),
    'https://blockbook.syscoin.org/api/v2/tickers/currency',
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
  ]);
  const audit = {
    expectedBlocked: [] as string[],
    reads: [] as string[],
    receipts: [] as Array<{ hash: string; status: string | null }>,
    pages: [] as Array<{
      phase: string;
      action: string;
      page: string | null;
      hashes: string[];
    }>,
    denied: [] as string[],
    writes: [] as string[],
  };
  const evidence: Record<string, unknown> = { runtime };
  let wallet: PaliWallet | undefined;
  let outcome: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('replaced-activity-readability', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    await wallet.context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (
        url.origin === server.url &&
        url.pathname === '/' &&
        request.method() === 'GET'
      )
        return route.continue();
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        // Ordinary GET is handled by the shared public HTTP fixture.
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const writes = calls.filter((call) =>
        /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
          call?.method || ''
        )
      );
      if (writes.length || /\/sendtx(?:\/|$)/i.test(url.pathname)) {
        audit.writes.push(
          ...writes.map((call) => call.method),
          ...(writes.length ? [] : [url.pathname])
        );
        return route.abort('blockedbyclient');
      }
      if (
        request.method() === 'GET' &&
        expectedBlockedReads.has(request.url())
      ) {
        audit.expectedBlocked.push(request.url());
        return route.abort('blockedbyclient');
      }
      const sharedReply = visualFixtureRead(
        fixture,
        request.url(),
        request.method(),
        payload
      );
      const originalDetailRead =
        request.method() === 'GET' &&
        url.origin === 'https://explorer-zk.tanenbaum.io' &&
        url.pathname === '/api' &&
        url.searchParams.get('action') === 'gettxinfo' &&
        url.searchParams.get('txhash') === original.hash;
      const reply =
        sharedReply ||
        (originalDetailRead
          ? {
              body: { status: '1', message: 'OK', result: null },
              reads: ['explorer:gettxinfo'],
              unsupported: [],
            }
          : undefined);
      if (!reply || reply.unsupported?.length) {
        audit.denied.push(
          `${request.method()} ${url.origin}${url.pathname}`,
          ...(reply?.unsupported || [])
        );
        return route.abort('blockedbyclient');
      }
      audit.reads.push(...reply.reads);
      let body: any = reply.body;
      if (url.origin === VISUAL_FIXTURE_RPC && request.method() === 'POST') {
        const replies = Array.isArray(body) ? body : [body];
        for (let index = 0; index < calls.length; index++) {
          const call = calls[index];
          if (call?.method === 'eth_blockNumber')
            replies[index].result = phase === 'pending' ? '0x2a' : '0x2b';
          if (
            call?.method === 'eth_getTransactionCount' &&
            String(call.params?.[0]).toLowerCase() ===
              fixture.address.toLowerCase()
          )
            replies[index].result =
              call.params?.[1] === 'pending' || phase === 'mined'
                ? '0xa'
                : '0x9';
          if (call?.method === 'eth_getTransactionByHash') {
            const row =
              call.params?.[0] === original.hash && phase === 'pending'
                ? original
                : fixture.transactions.find(
                    (tx) => tx.hash === call.params?.[0]
                  );
            replies[index].result = row ? rpcTransaction(row) : null;
          }
          if (
            call?.method === 'eth_getBlockByNumber' &&
            replies[index]?.result
          ) {
            const height =
              call.params?.[0] === 'latest'
                ? phase === 'pending'
                  ? 42
                  : 43
                : Number(call.params?.[0]);
            const rows = fixture.transactions.filter(
              (row) => Number(row.blockNumber) === height
            );
            Object.assign(replies[index].result, {
              number: `0x${height.toString(16)}`,
              hash: height === 43 ? winner.blockHash : healthy.blockHash,
              timestamp: `0x${(height === 43
                ? timestamp + 1
                : timestamp - 60
              ).toString(16)}`,
              transactions: rows.map((row) =>
                call.params?.[1] ? rpcTransaction(row) : row.hash
              ),
            });
          }
          if (call?.method !== 'eth_getTransactionReceipt') continue;
          const row = fixture.transactions.find(
            (tx) => tx.hash === call.params?.[0]
          );
          if (!row) {
            replies[index].result = null;
            continue;
          }
          if (replies[index]?.result)
            Object.assign(replies[index].result, {
              from: row.from,
              to: row.to,
              type: '0x2',
              status: '0x1',
              blockHash: row.blockHash,
              blockNumber: `0x${BigInt(row.blockNumber).toString(16)}`,
            });
          audit.receipts.push({ hash: row.hash, status: '0x1' });
        }
        body = Array.isArray(payload) ? replies : replies[0];
      }
      const action = url.searchParams.get('action');
      if (action === 'eth_block_number')
        body = { ...body, result: phase === 'pending' ? '0x2a' : '0x2b' };
      if (action === 'pendingtxlist') {
        const rows = phase === 'pending' ? [original] : [];
        body = {
          ...body,
          status: rows.length ? '1' : '0',
          message: rows.length ? 'OK' : 'No transactions found',
          result: rows,
        };
      }
      if (action === 'txlist' || action === 'pendingtxlist')
        audit.pages.push({
          phase,
          action,
          page: url.searchParams.get('page'),
          hashes: body.result.map((row: any) => row.hash),
        });
      if (action === 'gettxinfo') body = { ...body, result: null };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    const page = wallet.page;
    const publicState = () =>
      page.evaluate(async () => {
        const { vault } = await chrome.runtime.sendMessage({
          type: 'getCurrentState',
        });
        const active = vault.activeAccount;
        const network = vault.activeNetwork;
        return {
          account: {
            ...active,
            address: vault.accounts[active.type][active.id].address,
          },
          network: {
            kind: network.kind,
            chainId: network.chainId,
            url: network.url,
          },
          rows: (
            vault.accountTransactions?.[active.type]?.[active.id]?.ethereum?.[
              network.chainId
            ] || []
          ).map((row: any) => ({
            hash: row.hash,
            from: row.from,
            to: row.to,
            value: String(row.value),
            nonce: row.nonce,
            blockNumber: row.blockNumber,
            status: row.txreceipt_status,
            type: row.type,
            historySource: row.historySource,
          })),
        };
      });
    await wallet.step(
      'admit an outgoing pending transaction and independent mined sibling normally',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await wallet!.ensureOnHome();
        evidence.workerStart = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (identity) => {
            evidence.workerStart = identity;
          }
        );
        await page.locator('#activity-btn').click();
        const list = page.locator('#activity-panel-list');
        await expect(
          list.getByText(en.send.pending, { exact: true })
        ).toBeVisible();
        const scope = await publicState();
        expect(scope.account.address.toLowerCase()).toBe(
          fixture.address.toLowerCase()
        );
        expect(scope.network).toEqual({
          kind: 'ethereum',
          chainId: VISUAL_FIXTURE_CHAIN_ID,
          url: VISUAL_FIXTURE_RPC,
        });
        expect(scope.rows.map((row: any) => row.hash).sort()).toEqual(
          [original.hash, healthy.hash].sort()
        );
        const pending = scope.rows.find(
          (row: any) => row.hash === original.hash
        );
        expect(pending).toMatchObject({
          blockNumber: null,
          historySource: 'explorer-pendingtxlist',
        });
        expect(Number(pending?.nonce)).toBe(9);
        expect(Number(pending?.type)).toBe(2);
        expect(pending?.value).toBe(original.value);
        evidence.admitted = scope;
        await captureForegroundContrast(
          list.getByText(en.send.pending, { exact: true }),
          info,
          'original-pending-control-400'
        );
      }
    );
    await wallet.step(
      'use enabled ordinary Load more after the canonical HTTP feed mines the winner',
      async () => {
        const loadMore = page.getByRole('button', {
          name: en.buttons.loadMore,
          exact: true,
        });
        // If ordinary pagination is unavailable, stop: do not invoke its handler,
        // alter stores, inject route state, or force a replacement status.
        await expect(loadMore).toBeVisible({ timeout: 5000 });
        await expect(loadMore).toBeEnabled({ timeout: 5000 });
        phase = 'mined';
        fixture.transactions = [winner, healthy];
        await loadMore.click();
        await expect
          .poll(() =>
            [1, 2].every((n) =>
              audit.pages.some(
                (read) =>
                  read.phase === 'mined' &&
                  read.action === 'txlist' &&
                  Number(read.page) === n
              )
            )
          )
          .toBe(true);
        await expect(
          page
            .locator('#activity-panel-list')
            .getByText(en.transactions.replaced, { exact: true })
        ).toBeVisible();
        const scope = await publicState();
        // Pagination extras coexist with the genuine older pending base; they
        // have not been fabricated in Redux. A full refresh winning this race
        // must fail this admission test rather than being hidden by a fixture.
        expect(scope.rows.map((row: any) => row.hash).sort()).toEqual(
          [original.hash, healthy.hash].sort()
        );
        expect(scope.rows.some((row: any) => row.hash === winner.hash)).toBe(
          false
        );
        evidence.paged = scope;
      }
    );
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await wallet.step(
        `${viewport.width}: inspect genuine replacement status and amount with both healthy mined rows`,
        async () => {
          await page.setViewportSize(viewport);
          const list = page.locator('#activity-panel-list');
          const replaced = list.getByText(en.transactions.replaced, {
            exact: true,
          });
          const replacedRow = replaced.locator(
            'xpath=ancestor::div[contains(@class,"border-b")][1]'
          );
          const confirmedRows = list
            .getByText(en.send.confirmed, { exact: true })
            .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
          const winnerRow = confirmedRows.filter({
            hasText: /1(?:\.0+)? TSYS/,
          });
          const healthyRow = confirmedRows.filter({
            hasText: /2(?:\.0+)? TSYS/,
          });
          await expect(replacedRow).toHaveCount(1);
          await expect(winnerRow).toHaveCount(1);
          await expect(healthyRow).toHaveCount(1);
          await captureForegroundContrast(
            replaced,
            info,
            `replaced-status-${viewport.width}`
          );
          await captureForegroundContrast(
            replacedRow.getByText(/^1(?:\.0+)? TSYS$/),
            info,
            `replaced-amount-${viewport.width}`
          );
          await captureForegroundContrast(
            winnerRow.getByText(en.send.confirmed, { exact: true }),
            info,
            `winner-status-${viewport.width}`
          );
          await captureForegroundContrast(
            healthyRow.getByText(/^2(?:\.0+)? TSYS$/),
            info,
            `independent-healthy-amount-${viewport.width}`
          );
        }
      );
    }
    await wallet.step(
      'retain normal pending base and pagination evidence without broadcasting or modifying account scope',
      async () => {
        const scope = await publicState();
        expect(scope).toEqual(evidence.paged);
        expect(scope.account).toEqual((evidence.admitted as any).account);
        expect(scope.network).toEqual((evidence.admitted as any).network);
        expect(audit.denied).toEqual([]);
        expect(audit.writes).toEqual([]);
        expect(
          audit.pages.some(
            (read) =>
              read.phase === 'pending' &&
              read.action === 'pendingtxlist' &&
              read.hashes.includes(original.hash)
          )
        ).toBe(true);
        expect(
          audit.pages
            .filter(
              (read) => read.phase === 'mined' && read.action === 'txlist'
            )
            .every((read) => !read.hashes.includes(original.hash))
        ).toBe(true);
        evidence.workerEnd = await verifyExecutingWorker(
          wallet!.context,
          wallet!.extensionId,
          E2E_CONFIG.extensionPath,
          (identity) => {
            evidence.workerEnd = identity;
          }
        );
        expect(evidence.workerEnd).toEqual(evidence.workerStart);
        expect(extensionEvidence()).toEqual(runtime);
      }
    );
    outcome = 'passed';
  } finally {
    await info.attach('replaced-activity-readability-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({ outcome, ...evidence, audit }, null, 2),
    });
    try {
      await wallet?.dispose(outcome);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
