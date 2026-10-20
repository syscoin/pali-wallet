import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';

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

type ProxyDenial = {
  blockedDelta: string[];
  body: string;
  connectionClosed: boolean;
  method: 'GET' | 'CONNECT';
  statusCode: number;
};

// The socket always connects to loopback. The .invalid target is HTTP text,
// never a DNS lookup or a connection destination.
const probeProxyDenial = async (
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
): Promise<ProxyDenial> => {
  const proxy = new URL(server.url);
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
  const before = server.blocked.length;
  const target =
    method === 'GET'
      ? 'http://gas-display-denied.invalid/'
      : 'gas-display-denied.invalid:443';
  const response = await new Promise<
    Omit<ProxyDenial, 'method' | 'blockedDelta'>
  >((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0);
    let ended = false;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    // Bound only this new local I/O operation; the test's timeout is unchanged.
    socket.setTimeout(2000, () =>
      fail(new Error('Loopback denial probe timed out'))
    );
    socket.once('error', fail);
    socket.once('connect', () => {
      // HTTP/1.0 avoids chunk framing in the GET body; Connection: close
      // requires a terminal response, never a keepalive or tunnel.
      socket.write(
        `${method} ${target} HTTP/1.0\r\nHost: gas-display-denied.invalid\r\nConnection: close\r\n\r\n`
      );
    });
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Unexpectedly large denial response'));
    });
    socket.once('end', () => {
      ended = true;
    });
    socket.once('close', (hadError) => {
      if (settled) return;
      settled = true;
      try {
        expect(hadError).toBe(false);
        expect(ended).toBe(true);
        const text = bytes.toString('utf8');
        const separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        const header = text.slice(0, separator);
        expect(header.split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(header).toMatch(/\r\nConnection: close(?:\r\n|$)/i);
        const body = text.slice(separator + 4);
        expect(body).toBe(method === 'GET' ? 'Offline fixture only' : '');
        resolve({ statusCode: 403, body, connectionClosed: true });
      } catch (error) {
        reject(error);
      }
    });
  });
  const blockedDelta = server.blocked.slice(before);
  expect(blockedDelta).toEqual([method]);
  return { method, ...response, blockedDelta };
};

// Synthetic public read responses only. No transaction is created or signed.
test('transaction details preserve low positive gas prices and ordinary controls', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  expect(runtime.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const recipient = fixture.evmAddresses[0];
  const sender = `0x${'44'.repeat(20)}`;
  const timestamp = Math.floor(Date.now() / 1000) - 600;
  const quantity = (value: bigint | number) =>
    `0x${BigInt(value).toString(16)}`;
  const scenarios = [
    { name: 'one-wei', wei: '1', expected: '0.000000001 Gwei' },
    { name: 'ten-thousand-wei', wei: '10000', expected: '0.00001 Gwei' },
    { name: 'zero', wei: '0', expected: '0.00 Gwei' },
    { name: 'ordinary', wei: '20000000000', expected: '20.00 Gwei' },
  ].map((scenario, index) => ({
    ...scenario,
    hash: `0x${(index + 1).toString(16).padStart(64, '0')}`,
    blockHash: `0x${(index + 101).toString(16).padStart(64, '0')}`,
    blockNumber: 45 - index,
    timestamp: timestamp - index * 60,
    nonce: index,
    value: BigInt(index + 1) * BigInt('1000000000000000000'),
  }));
  // Distinct descending timestamps match the real history sort; the opened
  // row is additionally checked against its Hash field and actual RPC read.
  const history = scenarios.map((scenario) => ({
    hash: scenario.hash,
    from: sender,
    to: recipient,
    value: scenario.value.toString(),
    input: '0x',
    nonce: String(scenario.nonce),
    blockNumber: String(scenario.blockNumber),
    blockHash: scenario.blockHash,
    timeStamp: String(scenario.timestamp),
    confirmations: String(46 - scenario.blockNumber),
    gas: '21000',
    gasUsed: '21000',
    gasPrice: scenario.wei,
    isError: '0',
    txreceipt_status: '1',
    type: '2',
  }));
  const transactions = new Map(
    scenarios.map((scenario) => [
      scenario.hash,
      {
        hash: scenario.hash,
        from: sender,
        to: recipient,
        input: '0x',
        value: quantity(scenario.value),
        nonce: quantity(scenario.nonce),
        gas: '0x5208',
        gasPrice: quantity(BigInt(scenario.wei)),
        maxFeePerGas: quantity(BigInt(scenario.wei)),
        maxPriorityFeePerGas: quantity(BigInt(scenario.wei)),
        blockNumber: quantity(scenario.blockNumber),
        blockHash: scenario.blockHash,
        transactionIndex: '0x0',
        chainId: '0x1644',
        type: '0x2',
        accessList: [],
        r: `0x${'01'.repeat(32)}`,
        s: `0x${'02'.repeat(32)}`,
        v: '0x0',
      },
    ])
  );
  const receipts = new Map(
    scenarios.map((scenario) => [
      scenario.hash,
      {
        transactionHash: scenario.hash,
        transactionIndex: '0x0',
        blockHash: scenario.blockHash,
        blockNumber: quantity(scenario.blockNumber),
        from: sender,
        to: recipient,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        effectiveGasPrice: quantity(BigInt(scenario.wei)),
        logs: [],
        logsBloom: `0x${'00'.repeat(256)}`,
        status: '0x1',
        type: '0x2',
        contractAddress: null,
      },
    ])
  );
  const explorerReads: Array<{ action: string | null; txhash: string | null }> =
    [];
  const rpcReads: Array<{ method: string; params: unknown[] }> = [];
  const attemptedWrites: string[] = [];
  const denialCanaries: ProxyDenial[] = [];
  const unexpectedReads: string[] = [];
  const observed: Array<{
    name: string;
    hash: string;
    rawWei: string;
    gasPrice: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    screenshot: string;
  }> = [];
  let wallet: PaliWallet | undefined;
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const evidencePath = info.outputPath('transaction-gas-display-evidence.json');
  try {
    const activeServer = (server = await startUtxoFixtureServer());
    // Run before Chrome exists so each exact counter delta has one producer.
    expect(activeServer.blocked).toEqual([]);
    denialCanaries.push(await probeProxyDenial(activeServer, 'GET'));
    denialCanaries.push(await probeProxyDenial(activeServer, 'CONNECT'));
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'GasDisplaySynthetic!2026',
      rpcUrl: activeServer.url,
      chainId: 5700,
      networkLabel: 'Syscoin NEVM Testnet',
    });
    const activeWallet = (wallet = await PaliWallet.launch(
      'transaction-gas-display',
      {
        offlineHttpProxy: activeServer.url,
        viewport: { width: 400, height: 620 },
      }
    ));
    routes = await installIsolatedVaultRoutes(
      activeWallet.context,
      fixture,
      activeServer.url
    );
    await activeWallet.context.route(
      'https://explorer.tanenbaum.io/api**',
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const url = new URL(route.request().url());
        const action = url.searchParams.get('action');
        explorerReads.push({ action, txhash: url.searchParams.get('txhash') });
        const result =
          action === 'txlist' &&
          url.searchParams.get('address')?.toLowerCase() ===
            recipient.toLowerCase()
            ? history
            : action === 'gettxinfo'
            ? null
            : [
                'tokentx',
                'tokennfttx',
                'token1155tx',
                'txlistinternal',
                'pendingtxlist',
              ].includes(action || '')
            ? []
            : undefined;
        if (result === undefined) {
          unexpectedReads.push(`explorer:${action}`);
          return route.fallback();
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: Array.isArray(result) && result.length ? '1' : '0',
            message:
              Array.isArray(result) && result.length
                ? 'OK'
                : 'No transactions found',
            result,
          }),
        });
      }
    );
    await activeWallet.context.route(
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
          attemptedWrites.push(
            ...calls.map((call: any) => call?.method || 'invalid')
          );
          return route.abort('blockedbyclient');
        }
        const replies = calls.map((call: any) => {
          if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return undefined;
          let result: unknown;
          switch (call.method) {
            case 'eth_chainId':
              result = '0x1644';
              break;
            case 'net_version':
              result = '5700';
              break;
            case 'eth_blockNumber':
              result = '0x2d';
              break;
            case 'eth_getBalance':
            case 'eth_getTransactionCount':
              result = '0x0';
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x4a817c800';
              break;
            case 'eth_getCode':
            case 'eth_call':
              result = '0x';
              break;
            case 'eth_getLogs':
              result = [];
              break;
            case 'eth_getTransactionByHash':
              result =
                transactions.get(String(call.params[0]).toLowerCase()) ?? null;
              break;
            case 'eth_getTransactionReceipt':
              result =
                receipts.get(String(call.params[0]).toLowerCase()) ?? null;
              break;
            case 'eth_getBlockByNumber': {
              const block =
                call.params[0] === 'latest' ? 45 : Number(call.params[0]);
              const scenario = scenarios.find(
                (item) => item.blockNumber === block
              );
              result = scenario
                ? {
                    number: quantity(block),
                    hash: scenario.blockHash,
                    parentHash:
                      scenarios.find((item) => item.blockNumber === block - 1)
                        ?.blockHash ?? `0x${'00'.repeat(32)}`,
                    nonce: '0x0000000000000000',
                    timestamp: quantity(scenario.timestamp),
                    difficulty: '0x0',
                    gasLimit: '0x1c9c380',
                    gasUsed: '0x5208',
                    miner: `0x${'00'.repeat(20)}`,
                    extraData: '0x',
                    transactions: [],
                    // Allows the synthetic low/zero price controls without claiming
                    // they would be admitted by a live chain with a nonzero base fee.
                    baseFeePerGas: '0x0',
                  }
                : null;
              break;
            }
            default:
              unexpectedReads.push(`rpc:${call.method}`);
          }
          if (result === undefined) return undefined;
          rpcReads.push({ method: call.method, params: call.params });
          return { jsonrpc: '2.0', id: call.id, result };
        });
        if (!replies.every((reply) => reply !== undefined))
          return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
      }
    );
    const page = activeWallet.page;
    await activeWallet.step(
      'open real synthetic native Activity history',
      async (capture) => {
        try {
          await activeWallet.importSeedAndCreatePassword();
          await activeWallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await activeWallet.ensureOnHome();
          await page.locator('#activity-btn').click();
          await expect(
            page.locator('#activity-panel-list').getByRole('button', {
              name: en.notifications.clickToView,
              exact: true,
            })
          ).toHaveCount(scenarios.length);
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    for (const [index, scenario] of scenarios.entries()) {
      await activeWallet.step(
        `${scenario.name}: review exact gas-price fields`,
        async (capture) => {
          let captured = false;
          try {
            const beforeReads = rpcReads.length;
            await page
              .locator('#activity-panel-list')
              .getByRole('button', {
                name: en.notifications.clickToView,
                exact: true,
              })
              .nth(index)
              .click();
            await expect(page).toHaveURL(/#\/home\/details/);
            await expect
              .poll(() =>
                rpcReads
                  .slice(beforeReads)
                  .some(
                    (read) =>
                      read.method === 'eth_getTransactionByHash' &&
                      read.params[0] === scenario.hash
                  )
              )
              .toBe(true);
            await expect
              .poll(() =>
                rpcReads
                  .slice(beforeReads)
                  .some(
                    (read) =>
                      read.method === 'eth_getTransactionReceipt' &&
                      read.params[0] === scenario.hash
                  )
              )
              .toBe(true);
            const hashRow = page
              .getByText('Hash', { exact: true })
              .locator('..');
            await expect(hashRow.locator('span p').first()).toHaveText(
              `0x...${scenario.hash.slice(-4)}`
            );
            const value = (label: string) =>
              page
                .getByText(label, { exact: true })
                .locator('..')
                .locator('span p')
                .first();
            await value('Gas Price').scrollIntoViewIfNeeded();
            for (const label of [
              'Gas Price',
              'Max Fee Per Gas',
              'Max Priority Fee Per Gas',
            ]) {
              await expect(value(label)).toHaveText(scenario.expected);
            }
            await expect(value('Gas Limit')).toHaveText('21,000');
            await expect(value('Gas Used')).toHaveText('21,000');
            const screenshot = info.outputPath(
              `gas-display-${scenario.name}.png`
            );
            await page.screenshot({ path: screenshot, animations: 'disabled' });
            await info.attach(`gas-display-${scenario.name}`, {
              path: screenshot,
              contentType: 'image/png',
            });
            observed.push({
              name: scenario.name,
              hash: scenario.hash,
              rawWei: scenario.wei,
              gasPrice: await value('Gas Price').innerText(),
              maxFeePerGas: await value('Max Fee Per Gas').innerText(),
              maxPriorityFeePerGas: await value(
                'Max Priority Fee Per Gas'
              ).innerText(),
              screenshot,
            });
            await capture(page);
            captured = true;
            await page
              .getByRole('button', { name: en.buttons.back, exact: true })
              .click();
            await expect(
              page.locator('#activity-panel-list').getByRole('button', {
                name: en.notifications.clickToView,
                exact: true,
              })
            ).toHaveCount(scenarios.length);
          } finally {
            if (!captured && !page.isClosed()) await capture(page);
          }
        }
      );
    }
    expect(observed).toHaveLength(4);
    expect(routes.deniedWrites).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    expect(unexpectedReads).toEqual([]);
    expect(denialCanaries).toHaveLength(2);
    expect(activeServer.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
    expect(
      activeServer.blocked.every(
        (method) => method === 'GET' || method === 'CONNECT'
      )
    ).toBe(true);
    status = 'passed';
  } finally {
    try {
      fs.writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            status,
            runtime,
            scenarios: scenarios.map(({ value, ...scenario }) => ({
              ...scenario,
              value: value.toString(),
            })),
            observed,
            explorerReads,
            rpcReads,
            attemptedWrites,
            unexpectedReads,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            denialCanaries,
            proxyDeniedMethods: server?.blocked.slice() ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedConnections: server?.blocked.length ?? 0,
            syntheticHttpOnly: true,
            controllerOrStateInjection: false,
            signingOrBroadcast: false,
          },
          null,
          2
        )
      );
      await info.attach('transaction-gas-display-evidence', {
        path: evidencePath,
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
          await server?.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
