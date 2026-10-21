import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
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
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CASES = [
  {
    name: 'one-native-unit-plus-one-wei',
    wei: '1000000000000000001',
    amount: '1.000000000000000001',
    total: '1.000021000000000001',
  },
  {
    name: 'ordinary-eighteen-decimal-amount',
    wei: '1234567890123456789',
    amount: '1.234567890123456789',
    total: '1.234588890123456789',
  },
  {
    name: 'whole-native-unit-control',
    wei: '1000000000000000000',
    amount: '1',
    total: '1.000021',
  },
  {
    name: 'one-wei-control',
    wei: '1',
    amount: '0.000000000000000001',
    total: '0.000021000000000001',
  },
] as const;

test('ordinary dapp transaction review preserves every native-value decimal before cancellation', async ({}, info) => {
  test.setTimeout(120000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(info.retry).toBe(0);
  expect(info.config.workers).toBe(1);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ValuePrecisionSynthetic!2026',
    rpcUrl: server.url,
  });
  const fixture = createIsolatedVaultFixture();
  const [from, to] = fixture.evmAddresses;
  const pageErrors: string[] = [];
  const deniedWrites: string[] = [];
  const unexpectedReads: unknown[] = [];
  const rpcReads: Array<{ method: string; params: any[] }> = [];
  const observations: unknown[] = [];
  let wallet: PaliWallet | undefined;
  let dapp: Page | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('transaction-value-precision', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const observePage = (page: Page) => {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    };
    wallet.context.pages().forEach(observePage);
    wallet.context.on('page', observePage);
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // This overlays only the installed test network's synthetic HTTP reads.
    // The launch-time proxy denies every request not fulfilled by a route.
    // No provider/controller object or Chrome API is replaced.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        unexpectedReads.push({ method: request.method(), url: request.url() });
        return route.abort('blockedbyclient');
      }
      const body = request.postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call) =>
          /^(?:eth_send|eth_sign|wallet_|personal_|anvil_|evm_)/.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push(...calls.map((call) => String(call?.method)));
        return route.abort('blockedbyclient');
      }
      const replies = calls.map((call) => {
        if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
          return undefined;
        const { method, params } = call;
        let result: unknown;
        if (method === 'eth_chainId') result = '0x1644';
        if (method === 'net_version') result = '5700';
        if (method === 'eth_blockNumber') result = '0x1';
        if (method === 'eth_getTransactionCount') result = '0x0';
        if (method === 'eth_getBalance') {
          if (
            !fixture.evmAddresses.some(
              (a) => a.toLowerCase() === String(params[0]).toLowerCase()
            )
          )
            return undefined;
          result = '0x56bc75e2d63100000'; // 100 synthetic TSYS, never spendable.
        }
        if (['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(method))
          result = '0x3b9aca00';
        if (method === 'eth_getCode') result = '0x';
        if (method === 'eth_getLogs') result = [];
        if (method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0.5],
            reward: [['0x3b9aca00', '0x3b9aca00', '0x3b9aca00']],
          };
        if (
          method === 'eth_getBlockByNumber' &&
          ['latest', 'pending', '0x0', '0x1'].includes(params[0]) &&
          typeof params[1] === 'boolean'
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
        if (method === 'eth_estimateGas') {
          const tx = params[0];
          if (
            params.length !== 1 ||
            String(tx?.from).toLowerCase() !== from.toLowerCase() ||
            String(tx?.to).toLowerCase() !== to.toLowerCase() ||
            tx?.data !== '0x' ||
            tx?.nonce !== '0x0' ||
            !CASES.some(
              (entry) => tx?.value === `0x${BigInt(entry.wei).toString(16)}`
            )
          )
            return undefined;
          result = '0x5208';
        }
        if (result === undefined) return undefined;
        rpcReads.push({ method, params });
        return { jsonrpc: '2.0', id: call.id, result };
      });
      if (replies.some((reply) => reply === undefined)) {
        unexpectedReads.push(...calls);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    await wallet.step(
      'value precision: prepare the synthetic EVM wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    await wallet.step(
      'value precision: connect the ordinary local dapp',
      async (capture) => {
        dapp = await wallet!.context.newPage();
        await dapp.goto(server.url);
        await dapp.waitForFunction(() =>
          Boolean((window as any).pali?.request)
        );
        const connected = await approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'eth_requestAccounts'),
          capture
        );
        expect(connected.error).toBeUndefined();
        expect(connected.result).toEqual([from.toLowerCase()]);
      }
    );
    for (const entry of CASES) {
      await wallet.step(
        `value precision: review and cancel ${entry.name}`,
        async (capture) => {
          const value = `0x${BigInt(entry.wei).toString(16)}`;
          const tx = {
            from,
            to,
            value,
            data: '0x',
            nonce: '0x0',
            gas: '0x5208',
            gasPrice: '0x3b9aca00',
            type: '0x0',
            chainId: '0x1644',
          };
          const beforeEstimates = rpcReads.length;
          const id = await startRequest(dapp!, 'eth_sendTransaction', [tx]);
          const popup = await popupFor(wallet!.context, dapp!, id);
          try {
            await popup.setViewportSize({ width: 400, height: 620 });
            await expect(
              popup.getByRole('button', {
                name: en.buttons.confirm,
                exact: true,
              })
            ).toBeEnabled();
            const header = popup.locator('p.text-base');
            await expect(header).toHaveCount(1);
            await expect(header).toHaveText(`${entry.amount} TSYS`);
            const details = popup.locator('#detailsTab');
            await expect(details).toBeVisible();
            const total = details
              .locator('p')
              .filter({ hasText: `Total (${en.send.amountAndFee})` })
              .locator('span');
            await expect(total).toHaveText(`${entry.total} TSYS`);
            const fee = details
              .getByRole('button', { name: en.send.editFee, exact: true })
              .locator('..')
              .locator('..');
            await expect(fee).toContainText(en.send.estimatedGasFee);
            await expect(fee).toContainText('0.000021 TSYS');
            const pending = await rpcObservation(dapp!, id);
            expect(pending.method).toBe('eth_sendTransaction');
            expect(pending.params).toEqual([tx]);
            expect(pending.settled).not.toBe(true);
            expect(pending.result).toBeUndefined();
            expect(pending.error).toBeUndefined();
            const observedHeader = await header.innerText();
            const observedTotal = await total.innerText();
            const observedFee = await fee.innerText();
            const headerBounds = await header.boundingBox();
            expect(headerBounds).not.toBeNull();
            expect(headerBounds!.x).toBeGreaterThanOrEqual(0);
            expect(headerBounds!.x + headerBounds!.width).toBeLessThanOrEqual(
              400
            );
            const estimates = rpcReads
              .slice(beforeEstimates)
              .filter((read) => read.method === 'eth_estimateGas');
            expect(estimates.length).toBeGreaterThan(0);
            for (const estimate of estimates) {
              expect(estimate.params[0].value).toBe(value);
              expect(estimate.params[0].from.toLowerCase()).toBe(
                from.toLowerCase()
              );
              expect(estimate.params[0].to.toLowerCase()).toBe(
                to.toLowerCase()
              );
              expect(estimate.params[0].data).toBe('0x');
            }
            const screenshot = info.outputPath(`${entry.name}.png`);
            await popup.screenshot({
              path: screenshot,
              fullPage: true,
              animations: 'disabled',
            });
            await info.attach(entry.name, {
              path: screenshot,
              contentType: 'image/png',
            });
            await capture(popup);
            const rejected = await dismissRejectedApproval({
              click: () =>
                popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp!, id),
            });
            expect(rejected.error?.code).toBe(4001);
            expect(rejected.result).toBeUndefined();
            observations.push({
              name: entry.name,
              rawValueWei: entry.wei,
              rawDappValue: value,
              header: observedHeader,
              total: observedTotal,
              fee: observedFee,
              headerBounds,
              viewport: popup.viewportSize(),
              pending,
              estimates,
              rejected,
              screenshot,
            });
          } catch (error) {
            if (!popup.isClosed()) await capture(popup);
            throw error;
          }
        }
      );
    }
    expect(pageErrors).toEqual([]);
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(unexpectedReads).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await info.attach('transaction-value-precision-evidence', {
        body: JSON.stringify(
          {
            runtime: extensionEvidence(),
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex'),
            status,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            transactionConfirmationClicked: false,
            viewport: { width: 400, height: 620 },
            observations,
            rpcReads,
            pageErrors,
            deniedWrites: [...deniedWrites, ...(routes?.deniedWrites || [])],
            unexpectedReads,
            proxyDeniedRequests: server.blocked,
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
        if (dapp && !dapp.isClosed()) await dapp.close();
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
});
