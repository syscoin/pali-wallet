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

test('mined failed Activity keeps its status and amount readable beside a confirmed sibling', async ({}, info) => {
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
  const failed = {
    ...fixture.transactions[0],
    from: fixture.address,
    to: fixture.transactions[0].from,
    isError: '1',
    // eslint-disable-next-line camelcase -- Explorer wire spelling.
    txreceipt_status: '0',
  };
  const healthy = {
    ...fixture.transactions[1],
    from: fixture.address,
    to: fixture.transactions[1].from,
    value: '2000000000000000000',
  };
  fixture.transactions = [failed, healthy];
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'FailedActivitySynthetic!2026',
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
    receipts: [] as Array<{ hash: string; status: string }>,
    denied: [] as string[],
    writes: [] as string[],
  };
  const evidence: Record<string, unknown> = { runtime };
  let wallet: PaliWallet | undefined;
  let outcome: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('failed-activity-readability', {
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
      const reply = visualFixtureRead(
        fixture,
        request.url(),
        request.method(),
        payload
      );
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
          if (
            call?.method === 'eth_getTransactionCount' &&
            String(call.params?.[0]).toLowerCase() ===
              fixture.address.toLowerCase()
          )
            replies[index].result = '0x3';
          if (call?.method !== 'eth_getTransactionReceipt') continue;
          const row = fixture.transactions.find(
            (transaction) => transaction.hash === call.params?.[0]
          );
          if (!row || !replies[index]?.result) continue;
          const status = row.hash === failed.hash ? '0x0' : '0x1';
          Object.assign(replies[index].result, {
            from: row.from,
            to: row.to,
            status,
          });
          audit.receipts.push({ hash: row.hash, status });
        }
        body = Array.isArray(payload) ? replies : replies[0];
      }
      // The optional explorer detail endpoint has no enriched result. Its
      // ordinary RPC fallback must corroborate the same mined status instead.
      if (url.searchParams.get('action') === 'gettxinfo')
        body = { ...body, result: null };
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
          })),
        };
      });
    await wallet.step(
      'admit mined failure and healthy sibling through ordinary network history',
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
          list.getByText(en.send.failed, { exact: true })
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
          [failed.hash, healthy.hash].sort()
        );
        for (const row of [failed, healthy]) {
          const admitted = scope.rows.find(
            (item: any) => item.hash === row.hash
          );
          expect(admitted?.value).toBe(row.value);
          expect(Number(admitted?.status)).toBe(Number(row.txreceipt_status));
        }
        evidence.admitted = scope;
      }
    );
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await wallet.step(
        `${viewport.width}: inspect failed and healthy list rows and normal details`,
        async () => {
          await page.setViewportSize(viewport);
          const list = page.locator('#activity-panel-list');
          const failedLabel = list.getByText(en.send.failed, { exact: true });
          const failedRow = failedLabel.locator(
            'xpath=ancestor::div[contains(@class,"border-b")][1]'
          );
          const failedAmount = failedRow.getByText(/^1(?:\.0+)? TSYS$/);
          const healthyAmount = list.getByText(/^2(?:\.0+)? TSYS$/);
          await expect(failedAmount).toBeVisible();
          await expect(healthyAmount).toBeVisible();
          await captureForegroundContrast(
            failedLabel,
            info,
            `failed-list-status-${viewport.width}`
          );
          await captureForegroundContrast(
            failedAmount,
            info,
            `failed-list-amount-${viewport.width}`
          );
          await captureForegroundContrast(
            healthyAmount,
            info,
            `healthy-list-amount-${viewport.width}`
          );

          for (const row of [failed, healthy]) {
            const amount = list.getByText(
              row === failed ? /^1(?:\.0+)? TSYS$/ : /^2(?:\.0+)? TSYS$/
            );
            const card = amount.locator(
              'xpath=ancestor::div[contains(@class,"border-b")][1]'
            );
            await card
              .getByRole('button', {
                name: en.notifications.clickToView,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
            const details = page.locator('#details-view-content');
            const status = row === failed ? en.send.failed : en.send.confirmed;
            const label = row === failed ? 'failed' : 'healthy';
            // The header precedes the separate Success detail field.
            const statusCopy = details
              .getByText(status, { exact: true })
              .first();
            await expect(statusCopy).toBeVisible();
            await expect
              .poll(() =>
                audit.receipts.some(
                  (receipt) =>
                    receipt.hash === row.hash &&
                    receipt.status === (row === failed ? '0x0' : '0x1')
                )
              )
              .toBe(true);
            await captureForegroundContrast(
              statusCopy,
              info,
              `${label}-detail-status-${viewport.width}`
            );
            await page
              .getByRole('button', { name: en.buttons.back, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/home(?:\?|$)/);
            await expect(
              list.getByText(en.send.failed, { exact: true })
            ).toBeVisible();
          }
        }
      );
    }
    await wallet.step(
      'retain both statuses, original scope and a read-only network boundary',
      async () => {
        evidence.final = await publicState();
        expect(evidence.final).toEqual(evidence.admitted);
        expect(audit.denied).toEqual([]);
        expect(audit.writes).toEqual([]);
        expect(audit.reads).toContain('explorer:txlist');
        expect(audit.reads).toContain('rpc:eth_getTransactionReceipt');
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
    await info.attach('failed-activity-readability-evidence', {
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
