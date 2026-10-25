// Real batch approval and completion against narrowly fenced synthetic RPC.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { Transaction, keccak256 } from 'ethers';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const RPC = 'https://rpc.tanenbaum.io';
const CHAIN = 5700;
const HEX_CHAIN = '0x1644';
const TARGETS = [`0x${'44'.repeat(20)}`, `0x${'55'.repeat(20)}`];
const CALLS = TARGETS.map((to, index) => ({
  to,
  value: `0x${index + 1}`,
  data: '0x',
}));
type Scenario = 'partial' | 'all-success' | 'pre-send-rejection';
type Ack = {
  data: string;
  from: string;
  hash: string;
  nonce: number;
  to: string;
  type: number;
  value: string;
};

// This layer replaces network I/O only. All controller dispatch, account
// selection, signing, bundle writes and result delivery remain production code.
// The lower isolated fixture supplies its existing UTXO onboarding reads.
async function installCallsRpc(
  context: BrowserContext,
  from: string,
  scenario: Scenario
) {
  const acks: Ack[] = [],
    reads: string[] = [],
    forbiddenWrites: string[] = [],
    denied: string[] = [];
  const estimateRejections: number[] = [];
  let mined = false;
  const knownAddresses = new Set(
    [from, ...TARGETS].map((value) => value.toLowerCase())
  );
  const hash = (byte: string) => `0x${byte.repeat(32)}`;
  const blockHash = hash('ab');
  const block = () => ({
    number: mined ? '0x2' : '0x1',
    hash: blockHash,
    parentHash: hash('aa'),
    nonce: '0x0000000000000000',
    timestamp: '0x6553f100',
    difficulty: '0x0',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    miner: `0x${'00'.repeat(20)}`,
    extraData: '0x',
    transactions: [],
    baseFeePerGas: '0x3b9aca00',
  });
  const reject = (message: string) => ({ error: { code: -32602, message } });
  const reply = (
    method: string,
    params: any[]
  ): {
    error?: { code: number; data?: string; message: string };
    result?: unknown;
  } => {
    reads.push(method);
    switch (method) {
      case 'eth_chainId':
        return { result: HEX_CHAIN };
      case 'net_version':
        return { result: String(CHAIN) };
      case 'eth_blockNumber':
        return { result: mined ? '0x2' : '0x1' };
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return { result: '0x3b9aca00' };
      case 'eth_getBalance':
        if (!knownAddresses.has(String(params[0]).toLowerCase()))
          return reject('Unexpected balance address');
        return {
          result:
            String(params[0]).toLowerCase() === from.toLowerCase()
              ? '0xde0b6b3a7640000'
              : '0x0',
        };
      case 'eth_getTransactionCount':
        if (String(params[0]).toLowerCase() !== from.toLowerCase())
          return reject('Unexpected nonce address');
        return { result: `0x${acks.length.toString(16)}` };
      case 'eth_getBlockByNumber':
        return { result: block() };
      case 'eth_getBlockByHash':
        return { result: params[0] === blockHash ? block() : null };
      case 'eth_feeHistory':
        return {
          result: {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0],
            reward: [['0x3b9aca00']],
          },
        };
      case 'eth_getCode':
        if (
          !knownAddresses.has(String(params[0]).toLowerCase()) &&
          String(params[0]).toLowerCase() !==
            '0xca11bde05977b3631167028862be2a173976ca11'
        )
          return reject('Unexpected code address');
        return { result: '0x' };
      case 'eth_getLogs':
        return { result: [] };
      case 'eth_estimateGas': {
        const tx = params[0];
        const index = TARGETS.findIndex(
          (target) => target.toLowerCase() === String(tx?.to).toLowerCase()
        );
        if (
          index < 0 ||
          (tx.from && String(tx.from).toLowerCase() !== from.toLowerCase()) ||
          BigInt(tx.value || '0x0') !== BigInt(CALLS[index].value) ||
          (tx.data || '0x') !== CALLS[index].data
        )
          return reject('Unexpected estimate transaction');
        if (
          scenario === 'pre-send-rejection' ||
          (scenario === 'partial' && index === 1 && acks.length === 1)
        ) {
          estimateRejections.push(index);
          return {
            error: {
              code: 3,
              message: 'execution reverted: synthetic pre-broadcast refusal',
              data: '0x',
            },
          };
        }
        return { result: '0x5208' };
      }
      case 'eth_sendRawTransaction': {
        // No arbitrary write acknowledgement. Validate the exact signed RLP
        // intent and recovered sender before recording a synthetic acceptance.
        if (
          params.length !== 1 ||
          typeof params[0] !== 'string' ||
          params[0].length > 32768 ||
          !/^0x(?:[0-9a-f]{2})+$/i.test(params[0])
        )
          throw new Error('Malformed signed transaction');
        const tx = Transaction.from(params[0]);
        const index = acks.length;
        const expected = CALLS[index];
        if (
          !expected ||
          scenario === 'pre-send-rejection' ||
          (scenario === 'partial' && index !== 0) ||
          !tx.isSigned() ||
          tx.from?.toLowerCase() !== from.toLowerCase() ||
          tx.chainId !== BigInt(CHAIN) ||
          tx.nonce !== index ||
          tx.to?.toLowerCase() !== expected.to.toLowerCase() ||
          tx.value !== BigInt(expected.value) ||
          tx.data !== expected.data ||
          ![0, 2].includes(tx.type || 0) ||
          tx.gasLimit <= BigInt(0) ||
          tx.gasLimit > BigInt(1_000_000)
        )
          throw new Error(
            'Signed transaction did not match the exact admitted synthetic call'
          );
        const computedHash = keccak256(params[0]);
        if (tx.hash !== computedHash)
          throw new Error('Signed RLP hash mismatch');
        acks.push({
          hash: computedHash,
          nonce: tx.nonce,
          from: tx.from!,
          to: tx.to!,
          value: tx.value.toString(),
          data: tx.data,
          type: tx.type || 0,
        });
        return { result: computedHash };
      }
      case 'eth_getTransactionReceipt': {
        const tx = acks.find((entry) => entry.hash === params[0]);
        if (!tx || !mined) return { result: null };
        return {
          result: {
            transactionHash: tx.hash,
            transactionIndex: `0x${tx.nonce.toString(16)}`,
            blockHash,
            blockNumber: '0x2',
            from: tx.from,
            to: tx.to,
            cumulativeGasUsed: '0xa410',
            gasUsed: '0x5208',
            effectiveGasPrice: '0x3b9aca00',
            logs: [],
            logsBloom: `0x${'00'.repeat(256)}`,
            status: '0x1',
            type: `0x${tx.type.toString(16)}`,
            contractAddress: null,
          },
        };
      }
      case 'eth_getTransactionByHash': {
        const tx = acks.find((entry) => entry.hash === params[0]);
        return {
          result: tx
            ? {
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: `0x${BigInt(tx.value).toString(16)}`,
                input: tx.data,
                nonce: `0x${tx.nonce.toString(16)}`,
                chainId: HEX_CHAIN,
                type: `0x${tx.type.toString(16)}`,
                gas: '0x5208',
                gasPrice: '0x77359400',
                maxFeePerGas: '0xb2d05e00',
                maxPriorityFeePerGas: '0x3b9aca00',
                blockHash: mined ? blockHash : null,
                blockNumber: mined ? '0x2' : null,
                transactionIndex: mined ? `0x${tx.nonce.toString(16)}` : null,
              }
            : null,
        };
      }
      default:
        return reject(`Unallowlisted synthetic RPC ${method}`);
    }
  };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.fallback();
    let payload: any;
    try {
      payload = request.postDataJSON();
    } catch {
      /* Read-only REST is handled by isolatedVaultFixture. */
    }
    const entries = Array.isArray(payload) ? payload : [payload];
    if (
      url.origin !== RPC ||
      url.pathname !== '/' ||
      url.search ||
      url.username ||
      url.password
    ) {
      if (
        entries.some((row) =>
          /^(eth_send|wallet_send|personal_|anvil_|evm_)/.test(
            row?.method || ''
          )
        )
      ) {
        forbiddenWrites.push(`${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      return route.fallback();
    }
    if (
      request.method() !== 'POST' ||
      !entries.length ||
      entries.length > 32 ||
      entries.some(
        (row) =>
          row?.jsonrpc !== '2.0' ||
          !Array.isArray(row.params) ||
          typeof row.method !== 'string'
      )
    ) {
      denied.push('Malformed RPC envelope');
      return route.abort('blockedbyclient');
    }
    const replies = entries.map((row) => {
      try {
        const value = reply(row.method, row.params);
        if (value.error?.code === -32602) denied.push(value.error.message);
        return { jsonrpc: '2.0', id: row.id, ...value };
      } catch (error) {
        forbiddenWrites.push(
          error instanceof Error ? error.message : String(error)
        );
        return {
          jsonrpc: '2.0',
          id: row.id,
          ...reject('Synthetic signed-write admission refused'),
        };
      }
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
    });
  });
  return {
    acks,
    reads,
    denied,
    forbiddenWrites,
    estimateRejections,
    mine: () => {
      mined = true;
    },
  };
}

for (const scenario of [
  'partial',
  'all-success',
  'pre-send-rejection',
] as const) {
  test(`send calls completion: ${scenario}, original calls stay mandatory`, async ({}, testInfo) => {
    test.setTimeout(150_000);
    const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
    if (
      !extensionPath ||
      !path.isAbsolute(extensionPath) ||
      !/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || '')
    )
      throw new Error('Pin an exact immutable extension build and revision');
    const evidence = extensionEvidence();
    expect(evidence.version).toBe(packageJson.version);
    const before = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      extensionPath,
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'OfflineSyntheticOnly!2026',
      chainId: CHAIN,
      networkLabel: 'Syscoin NEVM Testnet',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let rpc: Awaited<ReturnType<typeof installCallsRpc>> | undefined;
    let result: unknown, pendingStatus: unknown, minedStatus: unknown;
    let status: 'passed' | 'failed' = 'failed';
    const bundleId = `0x${(scenario === 'partial'
      ? '61'
      : scenario === 'all-success'
      ? '62'
      : '63'
    ).repeat(32)}`;
    try {
      wallet = await PaliWallet.launch(`send-calls-${scenario}`, {
        offlineHttpProxy: server.url,
      });
      const step = (name: string, run: Parameters<PaliWallet['step']>[1]) =>
        wallet!.step(`${scenario}: ${name}`, run);
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      rpc = await installCallsRpc(
        wallet.context,
        fixture.evmAddresses[0],
        scenario
      );
      await step(
        'import disposable wallet and select the existing EVM network through normal UI',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.ensureOnHome();
        }
      );
      const dapp = await wallet.context.newPage();
      await step(
        'connect the real local dapp to the synthetic EOA',
        async (capture) => {
          await dapp.goto(server.url);
          await dapp.waitForFunction(() => Boolean((window as any).pali));
          const connected = await approve(
            wallet!.context,
            dapp,
            await startRequest(dapp, 'eth_requestAccounts'),
            capture
          );
          expect(
            connected.result.map((address: string) => address.toLowerCase())
          ).toEqual([fixture.evmAddresses[0].toLowerCase()]);
        }
      );
      const inspectStatus = async (expectedCode: number, state: string) => {
        for (const width of [400, 320]) {
          const opening = wallet!.context.waitForEvent('page');
          const request = await startRequest(dapp, 'wallet_showCallsStatus', [
            bundleId,
          ]);
          const statusPopup = await opening;
          await statusPopup.waitForURL(/\/external\/tx\/calls-status/);
          await statusPopup.setViewportSize({
            width,
            height: width === 320 ? 360 : 620,
          });
          const value = statusPopup.getByText(
            new RegExp(`\\(${expectedCode}\\)$`)
          );
          await expect(value).toBeVisible();
          await expect(
            statusPopup.locator(`[title="${bundleId}"]`)
          ).toBeVisible();
          const statusRow = value.locator('..');
          const geometry = await statusRow.evaluate((row) => {
            const [caption, text] = [...row.querySelectorAll('span')];
            const a = caption.getBoundingClientRect();
            const b = text.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(text);
            const fragments = [...range.getClientRects()].map((rect) => ({
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            }));
            return {
              caption: a.toJSON(),
              value: b.toJSON(),
              fragments,
              gap: b.left - a.right,
              width: innerWidth,
            };
          });
          expect(
            geometry.gap >= 8 || geometry.value.top >= geometry.caption.bottom
          ).toBe(true);
          expect(geometry.fragments.length).toBeGreaterThan(0);
          expect(
            geometry.fragments.every(
              (rect) =>
                rect.left >= geometry.value.left - 1 &&
                rect.right <= geometry.value.right + 1
            )
          ).toBe(true);
          await testInfo.attach(`calls-status-${state}-${width}-layout`, {
            body: JSON.stringify(geometry),
            contentType: 'application/json',
          });
          await testInfo.attach(`calls-status-${state}-${width}-top`, {
            body: await statusPopup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          const close = statusPopup.getByRole('button', {
            name: en.buttons.close,
            exact: true,
          });
          for (let attempt = 0; attempt < 30; attempt++) {
            if (
              await close.evaluate(
                (element) => element === document.activeElement
              )
            )
              break;
            await statusPopup.keyboard.press('Tab');
          }
          await expect(close).toBeFocused();
          await expect(close).toBeInViewport({ ratio: 1 });
          const pane = statusRow.locator('..').locator('..');
          const bounds = await pane.boundingBox();
          expect(bounds).not.toBeNull();
          for (let attempt = 0; attempt < 20; attempt++) {
            const done = await pane.evaluate(
              (element) =>
                element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop <=
                2
            );
            if (done) break;
            await statusPopup.mouse.move(
              bounds!.x + Math.min(bounds!.width / 2, 32),
              Math.max(
                8,
                Math.min(
                  (width === 320 ? 360 : 620) - 8,
                  bounds!.y + bounds!.height / 2
                )
              )
            );
            await statusPopup.mouse.wheel(0, 260);
            await statusPopup.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
            );
          }
          await expect
            .poll(() =>
              pane.evaluate(
                (element) =>
                  element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop
              )
            )
            .toBeLessThanOrEqual(2);
          if (state === 'mined')
            await expect(
              statusPopup.getByText('21000', { exact: true }).last()
            ).toBeInViewport({ ratio: 1 });
          await testInfo.attach(`calls-status-${state}-${width}-receipts`, {
            body: await statusPopup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          const statusResult = await settle(dapp, request);
          expect(statusResult.error).toBeUndefined();
          // The native Close action can retire its page before Playwright
          // receives the click acknowledgement. Require that exact close event;
          // errors on a still-open page or any other click failure remain fatal.
          await Promise.all([
            statusPopup.waitForEvent('close'),
            statusPopup
              .getByRole('button', { name: en.buttons.close, exact: true })
              .click()
              .catch((error: unknown) => {
                if (
                  !statusPopup.isClosed() ||
                  !(error instanceof Error) ||
                  !error.message.includes(
                    'Target page, context or browser has been closed'
                  )
                )
                  throw error;
              }),
          ]);
          expect(wallet!.page.isClosed()).toBe(false);
          await expect.poll(() => statusPopup.isClosed()).toBe(true);
        }
      };
      let requestId = -1;
      let popup: Page;
      await step(
        'all original non-atomic calls are checked and cannot be omitted',
        async (capture) => {
          requestId = await startRequest(dapp, 'wallet_sendCalls', [
            {
              version: '2.0.0',
              id: bundleId,
              chainId: HEX_CHAIN,
              from: fixture.evmAddresses[0],
              atomicRequired: false,
              calls: CALLS,
            },
          ]);
          popup = await popupFor(wallet!.context, dapp, requestId);
          for (let index = 0; index < CALLS.length; index++) {
            await expect(popup.locator(`#call-${index}`)).toBeChecked();
            await expect(popup.locator(`#call-${index}`)).toBeDisabled();
            const label = popup.locator(`label[for="call-${index}"]`);
            await label.scrollIntoViewIfNeeded();
            const box = await label.boundingBox();
            expect(box).not.toBeNull();
            await popup.mouse.click(
              box!.x + box!.width / 2,
              box!.y + box!.height / 2
            );
            await expect(popup.locator(`#call-${index}`)).toBeChecked();
          }
          await capture(popup);
          expect((await rpcObservation(dapp, requestId)).settled).not.toBe(
            true
          );
          expect(rpc!.acks).toHaveLength(0);
        }
      );
      await step(
        'approve through the real sender and await the deterministic outcome',
        async (capture) => {
          await popup
            .getByRole('button', { name: en.send.sign, exact: true })
            .click();
          if (scenario === 'all-success') {
            const settled = await settle(dapp, requestId, 30000);
            expect(settled.error).toBeUndefined();
            expect(settled.result).toMatchObject({ id: bundleId });
            result = settled;
            expect(rpc!.acks.map((ack) => ack.nonce)).toEqual([0, 1]);
          } else {
            await expect
              .poll(() => rpc!.estimateRejections.length)
              .toBeGreaterThan(0);
            await expect(
              popup.getByText(en.send.failed, { exact: false }).first()
            ).toBeVisible();
            const close = popup.getByRole('button', {
              name:
                scenario === 'partial' ? en.buttons.close : en.buttons.reject,
              exact: true,
            });
            await expect(close).toBeEnabled();
            if (scenario === 'partial') {
              expect(rpc!.acks.map((ack) => ack.nonce)).toEqual([0]);
              await expect(
                popup
                  .locator('#call-0')
                  .locator('xpath=..')
                  .getByText(en.send.sent, { exact: false })
              ).toBeVisible();
              await expect(
                popup
                  .locator('#call-1')
                  .locator('xpath=..')
                  .getByText(en.send.failed, { exact: false })
              ).toBeVisible();
            } else expect(rpc!.acks).toHaveLength(0);
            await capture(popup);
            expect((await rpcObservation(dapp, requestId)).settled).not.toBe(
              true
            );
          }
        }
      );
      if (scenario !== 'all-success') {
        await step(
          'close settles the original real dapp request without another send',
          async () => {
            await popup
              .getByRole('button', {
                name:
                  scenario === 'partial' ? en.buttons.close : en.buttons.reject,
                exact: true,
              })
              .click();
            const settled = await settle(dapp, requestId, 30000);
            result = settled;
            if (scenario === 'partial') {
              expect(settled.error).toBeUndefined();
              expect(settled.result).toMatchObject({ id: bundleId });
              expect(rpc!.acks).toHaveLength(1);
            } else {
              expect(settled.error?.code).toBe(4001);
              expect(settled.result).toBeUndefined();
              expect(rpc!.acks).toHaveLength(0);
            }
          }
        );
      }
      if (scenario !== 'pre-send-rejection') {
        await step(
          'real registry status is pending until the accepted synthetic receipt exists',
          async () => {
            pendingStatus = await providerRequest(
              dapp,
              'wallet_getCallsStatus',
              [bundleId]
            );
            expect(pendingStatus).toMatchObject({
              id: bundleId,
              chainId: HEX_CHAIN,
              atomic: false,
              status: 100,
            });
            await inspectStatus(100, 'pending');
          }
        );
        await step(
          'mined status preserves the same bundle and exactly the admitted hashes',
          async () => {
            rpc!.mine();
            await expect
              .poll(async () => {
                minedStatus = await providerRequest(
                  dapp,
                  'wallet_getCallsStatus',
                  [bundleId]
                );
                return (minedStatus as any).status;
              })
              .toBe(scenario === 'partial' ? 600 : 200);
            expect(minedStatus).toMatchObject({
              id: bundleId,
              chainId: HEX_CHAIN,
              atomic: false,
            });
            expect(
              (minedStatus as any).receipts.map(
                (receipt: any) => receipt.transactionHash
              )
            ).toEqual(rpc!.acks.map((ack) => ack.hash));
            await inspectStatus(scenario === 'partial' ? 600 : 200, 'mined');
          }
        );
      }
      await step(
        'audit denies every non-admitted write and leaves the exact call order intact',
        async () => {
          expect(rpc!.forbiddenWrites).toEqual([]);
          expect(rpc!.denied).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
          expect(
            rpc!.acks.map((ack) => ({
              to: ack.to.toLowerCase(),
              value: ack.value,
              data: ack.data,
            }))
          ).toEqual(
            CALLS.slice(
              0,
              scenario === 'partial' ? 1 : scenario === 'all-success' ? 2 : 0
            ).map((call) => ({
              to: call.to.toLowerCase(),
              value: BigInt(call.value).toString(),
              data: call.data,
            }))
          );
        }
      );
      status = 'passed';
    } finally {
      const report = path.join(
        E2E_CONFIG.artifactsDir,
        `send-calls-${scenario}.json`
      );
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(
        report,
        JSON.stringify(
          {
            ...evidence,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(testInfo.file))
              .digest('hex'),
            scenario,
            status,
            simulated: true,
            liveNetworkTested: false,
            bundleId,
            acks: rpc?.acks,
            estimateRejections: rpc?.estimateRejections,
            rpcMethods: rpc?.reads,
            deniedRpc: rpc?.denied,
            forbiddenWrites: rpc?.forbiddenWrites,
            fixtureReads: routes?.reads,
            fixtureDeniedWrites: routes?.deniedWrites,
            launchProxyDeniedConnections: server.blocked.length,
            result,
            pendingStatus,
            minedStatus,
            limitations:
              'Synthetic network responses only; real EOA account/signing/sender/registry and dapp result path. Smart-account infrastructure/control is not covered. No public requests are forwarded.',
          },
          null,
          2
        )
      );
      await testInfo.attach('send-calls-completion-runtime-evidence', {
        path: report,
        contentType: 'application/json',
      });
      try {
        await wallet?.dispose(status);
      } finally {
        Object.assign(E2E_CONFIG, before);
        await server.close();
      }
    }
  });
}
