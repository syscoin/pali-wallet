import {
  expect,
  test,
  chromium,
  type Request,
  type Route,
} from '@playwright/test';
import { Interface, keccak256, Transaction } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { getSmartAccountUserOpRequiredPrefund } from '../../source/utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../../source/utils/smartAccount/contracts';
import {
  getPaliCanonicalEntryPointAddress,
  getPaliInfrastructureContracts,
  getZkSysGasTankAddress,
  PALI_CREATE2_DEPLOYER_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
import officialDeploymentContracts from '../../tests/fixtures/officialDeploymentContracts.json';
import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import { PaliWallet } from '../harness/pali';
import {
  assertRpcCapabilityProbes,
  assertRpcTrafficBudget,
  countRpcTraffic,
} from '../harness/rpcTrafficBudget';
import { runSmartAccountCancellationJourney } from '../harness/smartAccountCancellationJourney';
import { observeSmartAccountFeeDiagnostics } from '../harness/smartAccountFeeDiagnostics';
import {
  startLocalChains,
  localRpc,
  LOCAL_CHAINS,
  TEST_DAPP_MNEMONIC,
  extensionEvidence,
} from '../harness/testDappConformance';
import {
  approve,
  approveSmartAccountFeeReview,
  startRequest,
  providerRequest,
} from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';

// Local RPC regression against a built extension. All accounts and contracts
// are disposable loopback fixtures. The launch proxy blocks other RPC traffic.
// PALI_RPC_EXTENDED=1 adds ERC20/ERC721 and dapp approvals.
// PALI_RPC_ERC1155=1 adds ERC1155 wallet/dapp transfers to the extended run.
// PALI_RPC_CANCELLATION=1 adds nonce revocation, independent replay and restart controls after traffic checks.
// PALI_RPC_GAS_TANK=1 adds synthetic creditOf coverage on local chain 57057.
// PALI_RPC_PREFUND=1 registers an unfunded account through two real transactions.
// PALI_RPC_NO_MULTICALL=1 and PALI_RPC_REJECT_BATCH=1 qualify fallback readers.
// Deployed Smart-send limits allow one separately checked final estimate of signed execution.
// PALI_RPC_REFERENCE=1 disables this cap for historical-artifact comparisons.
test('RPC budget and receipts for local wallet transfers', async () => {
  test.setTimeout(process.env.PALI_RPC_CANCELLATION === '1' ? 360000 : 240000);
  const responseDelayMs = Number(process.env.PALI_RPC_RESPONSE_DELAY_MS || 0);
  if (
    !Number.isSafeInteger(responseDelayMs) ||
    responseDelayMs < 0 ||
    responseDelayMs > 500
  )
    throw new Error('Invalid RPC response delay');
  const old = { ...E2E_CONFIG };
  const gasTank = process.env.PALI_RPC_GAS_TANK === '1';
  const prefund = process.env.PALI_RPC_PREFUND === '1';
  const includeErc1155 =
    process.env.PALI_RPC_EXTENDED === '1' &&
    process.env.PALI_RPC_ERC1155 === '1';
  const erc1155 = officialDeploymentContracts.contracts.erc1155;
  const erc1155Abi = new Interface([
    ...erc1155.abi,
    'function mintBatch(address to,uint256[] ids,uint256[] amounts,bytes data)',
    'function safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)',
  ]);
  let multiToken: string | undefined;
  if (gasTank && prefund)
    throw new Error('Prefund and gas-tank cases require separate runs');
  const chain = gasTank
    ? { ...LOCAL_CHAINS[0], chainId: 57057, hexId: '0xdee1' }
    : LOCAL_CHAINS[0];
  const networkLabel = gasTank ? 'zkTanenbaum' : `Pali Local ${chain.chainId}`;
  const currency = gasTank ? 'TSYS' : 'ETH';
  const stop = await startLocalChains([chain]);
  const fence = await startUtxoFixtureServer();
  const dapp =
    process.env.PALI_RPC_EXTENDED === '1' ? await startDappServer() : undefined;
  const output: any = {
    artifact: extensionEvidence(),
    markers: [],
    requests: [],
    broadcasts: [],
    setup: [],
    diagnostics: [],
    responseDelayMs,
    prefund,
    gasTank: gasTank
      ? 'Synthetic constant creditOf on Anvil. Native fee charging remains Anvil, without zkSYS bootloader debit.'
      : false,
  };
  let wallet: PaliWallet | undefined;
  const originalLaunch = chromium.launchPersistentContext;
  let phase = 'setup';
  const mark = (next: string) => {
    phase = next;
    output.markers.push({ phase, at: Date.now() });
  };
  const waitForReadSettlement = (completeSubmittedFlow = false) => {
    // A receipt can be visible before the already-scheduled four-second rapid
    // poll starts. Keep that work in this flow's home/acknowledged phase.
    const notBefore = Date.now() + (completeSubmittedFlow ? 4250 : 0);
    return expect
      .poll(
        () => {
          const requests = output.requests;
          const settled = requests.every(
            (request: any) => request.finished !== undefined
          );
          const lastStarted = requests.length
            ? requests[requests.length - 1].started
            : 0;
          return (
            settled &&
            Date.now() >= notBefore &&
            Date.now() - lastStarted >= 250
          );
        },
        { timeout: 10000 }
      )
      .toBe(true);
  };
  const receipt = async (hash: string) => {
    let result: any;
    await expect
      .poll(
        async () => {
          result = await localRpc(chain.url, 'eth_getTransactionReceipt', [
            hash,
          ]);
          return result?.status;
        },
        { timeout: 15000 }
      )
      .toBe('0x1');
    return result;
  };
  const waitForWalletReceipt = async (hash: string) => {
    await expect
      .poll(
        () =>
          output.requests.some(
            (request: any) =>
              request.finished !== undefined &&
              request.confirmedReceiptHashes?.includes(hash.toLowerCase())
          ),
        { timeout: 15000 }
      )
      .toBe(true);
    await waitForReadSettlement(true);
  };
  try {
    Object.assign(E2E_CONFIG, {
      seedPhrase: TEST_DAPP_MNEMONIC,
      password: 'DisposableRpcCount!2026',
      chainId: chain.chainId,
      rpcUrl: chain.url,
      networkLabel,
    });
    chromium.launchPersistentContext = (profile, options) =>
      originalLaunch.call(chromium, profile, {
        ...options,
        ignoreHTTPSErrors: true,
        args: [...(options?.args || []), '--ignore-certificate-errors'],
      });
    wallet = await PaliWallet.launch('rpc-request-budget', {
      offlineHttpProxy: fence.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    await observeSmartAccountFeeDiagnostics(wallet.context);
    chromium.launchPersistentContext = originalLaunch;
    const observations = new Map<Request, any>();
    const bodies: Promise<void>[] = [];
    const fixtureResponseBytes = new WeakMap<Request, number>();
    const fulfillRpcResponse = (route: Route, body: string) => {
      fixtureResponseBytes.set(route.request(), Buffer.byteLength(body));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body,
      });
    };
    wallet.context.on('request', (request) => {
      if (request.url() !== chain.url && request.url() !== chain.url + '/')
        return;
      const text = request.postData();
      if (!text) return;
      try {
        const payload = JSON.parse(text);
        const rows = Array.isArray(payload) ? payload : [payload];
        const item = {
          phase,
          started: Date.now(),
          requestBytes: Buffer.byteLength(text),
          methods: rows.map((row) => row.method),
          params: rows.map((row) =>
            row.method === 'eth_sendRawTransaction'
              ? ['signed-local-fixture']
              : row.params
          ),
        };
        for (const row of rows)
          if (row.method === 'eth_sendRawTransaction')
            output.broadcasts.push({
              phase,
              hash: Transaction.from(row.params[0]).hash,
              at: Date.now(),
              requestIndex: output.requests.length,
            });
        output.requests.push(item);
        observations.set(request, item);
      } catch {
        /* non-RPC */
      }
    });
    wallet.context.on('response', (response) => {
      const item = observations.get(response.request());
      if (!item) return;
      item.status = response.status();
      bodies.push(
        (async () => {
          try {
            const body = await response.body();
            item.responseBytes = body.length;
            if (item.methods.includes('eth_getTransactionReceipt')) {
              const raw = JSON.parse(body.toString());
              const replies = Array.isArray(raw) ? raw : [raw];
              item.confirmedReceiptHashes = replies
                .map((reply) => reply.result)
                .filter(
                  (result) => result?.blockHash && result?.transactionHash
                )
                .map((result) => result.transactionHash.toLowerCase());
            }
          } catch (error) {
            const fixtureBytes = fixtureResponseBytes.get(response.request());
            // Chromium can discard a response body after reporting its headers
            // when the request is canceled. Charge the full fixture body.
            if (
              item.responseBytes === undefined &&
              response.request().failure()?.errorText === 'net::ERR_ABORTED' &&
              fixtureBytes !== undefined
            ) {
              item.responseBytes = fixtureBytes;
              item.responseBytesFromFixture = true;
            } else {
              item.responseFailure = String(error);
            }
          }
          item.finished = Date.now();
        })()
      );
    });
    wallet.context.on('requestfailed', (request) => {
      const item = observations.get(request);
      if (!item) return;
      item.requestFailure = request.failure()?.errorText ?? 'Request failed';
      item.finished = Date.now();
    });
    const routeLocalNetwork = async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return route.continue();
      if (dapp && url.origin === new URL(dapp.url).origin)
        return route.continue();
      if (url.origin === fence.url && request.method() === 'GET')
        return route.continue();
      if (
        url.origin === chain.url &&
        request.method() === 'POST' &&
        url.pathname === '/'
      ) {
        const raw = request.postDataJSON();
        if (responseDelayMs)
          await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
        if (Array.isArray(raw) && process.env.PALI_RPC_REJECT_BATCH === '1') {
          const observation = observations.get(request);
          if (observation) observation.batchCapabilityProbe = true;
          return fulfillRpcResponse(
            route,
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32600,
                message: 'Batch requests are not supported',
              },
            })
          );
        }
        if (phase.startsWith('public-reads:'))
          await new Promise((resolve) => setTimeout(resolve, 75));
        const rows = Array.isArray(raw) ? raw : [raw];
        const replies = await Promise.all(
          rows.map(async (row) => {
            try {
              const result = await localRpc(
                chain.url,
                row.method,
                row.params || []
              );
              if (
                phase === 'cancellation:payer-budget-refused' &&
                row.method === 'eth_estimateGas' &&
                row.params?.[0]?.to?.toLowerCase() ===
                  getPaliEntryPointAddress(chain.chainId).toLowerCase() &&
                row.params[0].data?.startsWith(
                  paliEntryPointInterface.getFunction('handleOps')!.selector
                )
              ) {
                const [operations] = paliEntryPointInterface.decodeFunctionData(
                  'handleOps',
                  row.params[0].data
                );
                if (
                  operations.length === 1 &&
                  operations[0].sender.toLowerCase() ===
                    output.account.toLowerCase() &&
                  operations[0].signature !== '0x'
                )
                  return { jsonrpc: '2.0', id: row.id, result: '0x2dc6c0' };
              }
              if (row.method === 'eth_simulateV1') {
                // Anvil executes the supplied state but omits its canonical parent
                // and returns the parent number. Normalize only these test metadata fields.
                const parent = await localRpc(
                  chain.url,
                  'eth_getBlockByNumber',
                  [row.params[1], false]
                );
                if (result.length === 1 && parent) {
                  result[0].parentHash = parent.hash;
                  result[0].number = `0x${(
                    BigInt(parent.number) + BigInt(1)
                  ).toString(16)}`;
                }
              }
              return { jsonrpc: '2.0', id: row.id, result };
            } catch (error) {
              let rpcError: any;
              try {
                rpcError = JSON.parse((error as Error).message);
              } catch {
                rpcError = { code: -32000, message: String(error) };
              }
              return { jsonrpc: '2.0', id: row.id, error: rpcError };
            }
          })
        );
        return fulfillRpcResponse(
          route,
          JSON.stringify(Array.isArray(raw) ? replies : replies[0])
        );
      }
      if (
        url.origin === 'https://blockbook-dev.syscoin.org' ||
        url.origin === 'https://explorer-blockbook-dev.syscoin.org'
      ) {
        if (
          url.pathname.includes('/api/v2/xpub/') ||
          url.pathname.includes('/api/v2/address/')
        )
          return route.fulfill({
            json: {
              balance: '0',
              unconfirmedBalance: '0',
              transactions: [],
              tokens: [],
              txs: 0,
              unconfirmedTxs: 0,
              totalReceived: '0',
              totalSent: '0',
            },
          });
        if (url.pathname.includes('/api/v2/utxo/'))
          return route.fulfill({ json: [] });
        if (url.pathname.includes('/api/v2/estimatefee/'))
          return route.fulfill({ json: { result: '0.00001' } });
        return route.fulfill({
          json: {
            blockbook: { coin: 'Syscoin Testnet', inSync: true, bestHeight: 1 },
            backend: { chain: 'test' },
          },
        });
      }
      return route.abort('blockedbyclient');
    };
    await wallet.context.route('**/*', routeLocalNetwork);
    const [payer, recipient] = await wallet.step(
      'deploy local infrastructure fixtures',
      async () => {
        const [payer, recipient] = await localRpc(chain.url, 'eth_accounts');
        for (const item of getPaliInfrastructureContracts()) {
          if (
            !item.deployCalldata ||
            (item.id === 'multicall3' &&
              process.env.PALI_RPC_NO_MULTICALL === '1')
          )
            continue;
          const hash = await localRpc(chain.url, 'eth_sendTransaction', [
            {
              from: payer,
              to: PALI_CREATE2_DEPLOYER_ADDRESS,
              data: item.deployCalldata,
              gas: '0x1c9c380',
            },
          ]);
          await receipt(hash);
          output.setup.push({
            id: item.id,
            address: item.address,
            runtimeHash: keccak256(
              await localRpc(chain.url, 'eth_getCode', [item.address, 'latest'])
            ),
          });
        }
        if (gasTank) {
          // Return the synthetic credit amount for creditOf. This qualifies
          // Pali's coverage/read path, while Anvil charges the outer EOA gas.
          const credit = BigInt('1000000000000000000000000000000');
          const runtime =
            '0x7f' + credit.toString(16).padStart(64, '0') + '60005260206000f3';
          const address = getZkSysGasTankAddress(chain.chainId)!;
          await localRpc(chain.url, 'anvil_setCode', [address, runtime]);
          output.setup.push({
            id: 'synthetic-gas-tank-credit',
            address,
            runtimeHash: keccak256(runtime),
            credit: credit.toString(),
          });
        }
        return [payer, recipient] as const;
      }
    );
    await wallet.step('import disposable wallet', () =>
      wallet!.importSeedAndCreatePassword()
    );
    const page = wallet.page;
    await wallet.step('configure local network', async () => {
      if (gasTank) {
        await wallet.gotoRoute('#/settings/networks/edit');
        await page
          .locator('li')
          .filter({ hasText: `Chain ${chain.chainId}` })
          .getByRole('button', { name: /^Edit:/ })
          .click();
      } else await wallet!.gotoRoute('#/settings/networks/custom-rpc');
      if (!gasTank) {
        await page
          .getByRole('combobox', { name: 'Label', exact: true })
          .fill(networkLabel);
        await page.locator('#rpc_chainId').fill(String(chain.chainId));
        await page.getByPlaceholder('Symbol', { exact: true }).fill(currency);
      }
      await page.locator('#rpc_url').fill(chain.url);
      await page.locator('#rpc_apiUrl').fill('');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).not.toHaveURL(/custom-rpc/);
      await wallet.switchNetwork(networkLabel, 'EVM');
    });
    await wallet.step('create and fund smart account', async () => {
      await wallet!.gotoRoute('#/settings/account/new');
      await page.getByRole('button', { name: /create smart account/i }).click();
      await expect(page.getByRole('button', { name: /^ok$/i })).toBeVisible();
      await page.getByRole('button', { name: /^ok$/i }).click();
      await wallet.ensureOnHome();
      await page.locator('#general-settings-button').click();
      await page.locator('[id^="account-SmartAccount"]').first().click();
      const account = await wallet!.getActiveAccountAddress();
      output.account = account;
      if (includeErc1155) {
        // Fund the counterfactual address before deployment. The pinned
        // account implementation does not install an ERC1155 receiver.
        const deployed = await receipt(
          await localRpc(chain.url, 'eth_sendTransaction', [
            { from: payer, data: erc1155.bytecode, gas: '0x989680' },
          ])
        );
        multiToken = deployed.contractAddress;
        await receipt(
          await localRpc(chain.url, 'eth_sendTransaction', [
            {
              from: payer,
              to: multiToken,
              data: erc1155Abi.encodeFunctionData('mintBatch', [
                account,
                [7],
                [10],
                '0x',
              ]),
              gas: '0xf4240',
            },
          ])
        );
      }
      if (prefund) {
        expect(
          BigInt(
            await localRpc(chain.url, 'eth_getBalance', [account, 'latest'])
          )
        ).toBe(BigInt(0));
        expect(
          await localRpc(chain.url, 'eth_getCode', [account, 'latest'])
        ).toBe('0x');
        mark('prefund:review');
        await wallet.gotoRoute('#/settings/account/smart-account-policy');
        const register = page.getByRole('button', {
          name: 'Register account',
          exact: true,
        });
        await expect(register).toBeEnabled();
        const before = output.broadcasts.length;
        mark('prefund:confirm');
        await register.click();
        await approveSmartAccountFeeReview(page, {
          kind: 'entry-point',
          account,
          payer: account,
          chainId: chain.chainId,
          symbol: currency,
        });
        for (let envelope = 0; envelope < 2; envelope++)
          await approveSmartAccountFeeReview(page, {
            kind: 'payer',
            account,
            payer,
            chainId: chain.chainId,
            symbol: currency,
          });
        await expect
          .poll(() => output.broadcasts.length, { timeout: 45000 })
          .toBe(before + 2);
        const transactions = output.broadcasts.slice(before);
        const fundingReceipt = await receipt(transactions[0].hash);
        const operationReceipt = await receipt(transactions[1].hash);
        const funding = await localRpc(chain.url, 'eth_getTransactionByHash', [
          transactions[0].hash,
        ]);
        const operation = await localRpc(
          chain.url,
          'eth_getTransactionByHash',
          [transactions[1].hash]
        );
        expect(funding.to.toLowerCase()).toBe(account.toLowerCase());
        expect(funding.from.toLowerCase()).toBe(payer.toLowerCase());
        expect(operation.from.toLowerCase()).toBe(payer.toLowerCase());
        expect(BigInt(funding.value)).toBeGreaterThan(BigInt(0));
        const [operations] = paliEntryPointInterface.decodeFunctionData(
          'handleOps',
          operation.input
        );
        expect(operations).toHaveLength(1);
        expect(operations[0].sender.toLowerCase()).toBe(account.toLowerCase());
        expect(BigInt(funding.value)).toBe(
          BigInt(getSmartAccountUserOpRequiredPrefund(operations[0]).toString())
        );
        expect(BigInt(operation.nonce)).toBe(BigInt(funding.nonce) + BigInt(1));
        expect(
          await localRpc(chain.url, 'eth_getCode', [account, 'latest'])
        ).not.toBe('0x');
        const userOperationEvents = operationReceipt.logs.flatMap(
          (log: any) => {
            try {
              const event = paliEntryPointInterface.parseLog(log);
              return event?.name === 'UserOperationEvent' ? [event] : [];
            } catch {
              return [];
            }
          }
        );
        expect(userOperationEvents).toHaveLength(1);
        expect(userOperationEvents[0].args.sender.toLowerCase()).toBe(
          account.toLowerCase()
        );
        expect(userOperationEvents[0].args.success).toBe(true);
        output.prefund = {
          funding,
          fundingReceipt,
          operation,
          operationReceipt,
        };
        mark('prefund:complete');
        await wallet.gotoRoute('#/home');
      }
      await localRpc(chain.url, 'anvil_setBalance', [
        account,
        '0xde0b6b3a7640000',
      ]);
      await page.reload();
      await wallet.waitAppReady();
      await page
        .getByRole('button', { name: 'GENERAL OPTIONS', exact: true })
        .click();
      await page.locator('[id^="account-HDAccount"]').first().click();
      await page.locator('#general-settings-button').click();
      await page.locator('[id^="account-SmartAccount"]').first().click();
      await expect(page.locator('#home-balance')).toHaveText('1');
      if (prefund) {
        // Registration and the account switch both refresh Home before Send opens.
        const registration = page.locator(
          `[data-transaction-hash="${output.prefund.operation.hash}"]`
        );
        await expect(
          registration.getByText('Confirmed', { exact: true })
        ).toBeVisible({ timeout: 15000 });
        await waitForReadSettlement(true);
      }
    });
    const account: string = output.account;
    const send = async (
      label: string,
      asset?: { erc1155?: boolean; symbol: string; tokenId?: string }
    ) =>
      wallet!.step(label + ' transfer', async () => {
        await wallet.ensureOnHome();
        const recipientBalance = asset
          ? undefined
          : BigInt(
              await localRpc(chain.url, 'eth_getBalance', [recipient, 'latest'])
            );
        mark(label + ':form');
        await page.locator('#send-btn').click();
        if (asset) {
          await page
            .getByRole('button', { name: currency, exact: true })
            .click();
          await page
            .getByRole('menuitem', { name: new RegExp(asset.symbol) })
            .click();
        }
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill(recipient);
        if (asset?.tokenId && !asset.erc1155)
          await page
            .getByPlaceholder('Enter token ID', { exact: true })
            .fill(asset.tokenId);
        if (!asset?.tokenId || asset.erc1155)
          await page
            .getByPlaceholder(asset?.erc1155 ? /^Amount/ : 'Amount', {
              exact: !asset?.erc1155,
            })
            .fill(asset ? '1' : '0.001');
        if (asset?.tokenId && !asset.erc1155)
          await expect(page.getByText(/You own this token/)).toBeVisible();
        mark(label + ':review');
        await page.locator('#send-eth-next-btn').click();
        await expect(
          page.getByRole('button', { name: 'Confirm', exact: true })
        ).toBeEnabled({ timeout: 30000 });
        mark(label + ':confirm');
        const before = output.broadcasts.length;
        await page
          .getByRole('button', { name: 'Confirm', exact: true })
          .click();
        if (process.env.PALI_RPC_REFERENCE && !label.startsWith('eoa-'))
          await approveSmartAccountFeeReview(page, {
            kind: 'payer',
            account,
            payer,
            chainId: chain.chainId,
            symbol: currency,
          });
        await expect
          .poll(() => output.broadcasts.length, { timeout: 45000 })
          .toBe(before + 1);
        mark(label + ':broadcast');
        const result = await receipt(output.broadcasts.at(-1).hash);
        output[label + ':receipt'] = result;
        if (recipientBalance !== undefined)
          expect(
            BigInt(
              await localRpc(chain.url, 'eth_getBalance', [recipient, 'latest'])
            ) - recipientBalance
          ).toBe(BigInt('1000000000000000'));
        if (gasTank && !label.startsWith('eoa-')) {
          const transaction = await localRpc(
            chain.url,
            'eth_getTransactionByHash',
            [output.broadcasts.at(-1).hash]
          );
          const [operations] = paliEntryPointInterface.decodeFunctionData(
            'handleOps',
            transaction.input
          );
          expect(operations).toHaveLength(1);
          expect(operations[0].gasFees).toBe('0x' + '00'.repeat(32));
          const userOperationEvent = result.logs
            .map((log: any) => {
              try {
                return paliEntryPointInterface.parseLog(log);
              } catch {
                return null;
              }
            })
            .find((event: any) => event?.name === 'UserOperationEvent');
          expect(userOperationEvent?.args.success).toBe(true);
        }
        await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
        await expect(
          page.getByRole('heading', {
            name: en.settings.smartAccountFeeReviewTitle,
            exact: true,
          })
        ).toHaveCount(0);
        mark(label + ':home');
        await expect(page.getByText('Pending', { exact: true })).toHaveCount(
          0,
          {
            timeout: 15000,
          }
        );
        await expect(
          page.getByText('Confirmed', { exact: true }).first()
        ).toBeVisible({ timeout: 15000 });
        await waitForReadSettlement(true);
      });
    await send('deployment');
    await wallet.step(
      'observe completed deployment before warm send',
      async () => {
        // Let the normal receipt tracker settle the first operation, so its
        // separate confirmation poll cannot inflate the warm-send budget.
        await expect(
          page.getByText('Confirmed', { exact: true }).first()
        ).toBeVisible({ timeout: 15000 });
        await waitForReadSettlement();
      }
    );
    await send('warm');
    if (process.env.PALI_RPC_EXTENDED === '1') {
      const erc20 = officialDeploymentContracts.contracts.erc20;
      const erc721 = officialDeploymentContracts.contracts.erc721;
      const erc20Abi = new Interface([
        ...erc20.abi,
        'function transfer(address to,uint256 amount) returns (bool)',
      ]);
      const erc721Abi = new Interface([
        ...erc721.abi,
        'function mintNFTs(uint256 count)',
        'function transferFrom(address from,address to,uint256 id)',
        'function ownerOf(uint256 id) view returns(address)',
      ]);
      const deployToken = async (data: string) => {
        const hash = await localRpc(chain.url, 'eth_sendTransaction', [
          { from: payer, data, gas: '0x989680' },
        ]);
        return (await receipt(hash)).contractAddress;
      };
      const { token, nft } = await wallet.step(
        'deploy and fund token fixtures',
        async () => {
          mark('asset-fixture');
          const token = await deployToken(
            erc20.bytecode +
              erc20Abi.encodeDeploy([1000, 'TST', 4, 'TST']).slice(2)
          );
          const nft = await deployToken(erc721.bytecode);
          await receipt(
            await localRpc(chain.url, 'eth_sendTransaction', [
              {
                from: payer,
                to: token,
                data: erc20Abi.encodeFunctionData('transfer', [
                  account,
                  100000,
                ]),
                gas: '0xf4240',
              },
            ])
          );
          await receipt(
            await localRpc(chain.url, 'eth_sendTransaction', [
              {
                from: payer,
                to: nft,
                data: erc721Abi.encodeFunctionData('mintNFTs', [2]),
                gas: '0xf4240',
              },
            ])
          );
          for (const id of [1, 2])
            await receipt(
              await localRpc(chain.url, 'eth_sendTransaction', [
                {
                  from: payer,
                  to: nft,
                  data: erc721Abi.encodeFunctionData('transferFrom', [
                    payer,
                    account,
                    id,
                  ]),
                  gas: '0xf4240',
                },
              ])
            );
          output.assets = { token, nft, multiToken };
          return { token, nft };
        }
      );
      const importAsset = async (
        contract: string,
        symbol: string,
        tokenId?: string
      ) =>
        wallet!.step('import ' + symbol, async () => {
          await wallet.gotoRoute('#/tokens/add?tab=custom');
          await page.locator('#custom-token-contract').fill(contract);
          if (tokenId) await page.locator('#custom-token-id').fill(tokenId);
          const button = page.getByRole('button', {
            name: `Import ${symbol} token`,
            exact: true,
          });
          await expect(button).toBeEnabled();
          await button.click();
          await expect(button).toBeDisabled();
        });
      await importAsset(token, 'TST');
      await importAsset(nft, 'TDN');
      await send('erc20', { symbol: 'TST' });
      await wallet.step(
        'verify smart-account ERC20 recipient balance',
        async () => {
          expect(
            BigInt(
              await localRpc(chain.url, 'eth_call', [
                {
                  to: token,
                  data: erc20Abi.encodeFunctionData('balanceOf', [recipient]),
                },
                'latest',
              ])
            )
          ).toBe(BigInt(10000));
        }
      );
      await send('erc721', { symbol: 'TDN', tokenId: '1' });
      await wallet.step(
        'verify smart-account NFT recipient ownership',
        async () => {
          expect(
            erc721Abi
              .decodeFunctionResult(
                'ownerOf',
                await localRpc(chain.url, 'eth_call', [
                  {
                    to: nft,
                    data: erc721Abi.encodeFunctionData('ownerOf', [1]),
                  },
                  'latest',
                ])
              )[0]
              .toLowerCase()
          ).toBe(recipient.toLowerCase());
        }
      );
      const assertErc1155Balance = async (expected: bigint) => {
        const raw = await localRpc(chain.url, 'eth_call', [
          {
            to: multiToken!,
            data: erc1155Abi.encodeFunctionData('balanceOf', [recipient, 7]),
          },
          'latest',
        ]);
        expect(erc1155Abi.decodeFunctionResult('balanceOf', raw)[0]).toBe(
          expected
        );
      };
      if (multiToken) {
        await importAsset(multiToken, 'NFT', '7');
        await send('erc1155', { symbol: 'NFT', tokenId: '7', erc1155: true });
        await wallet.step('verify ERC1155 recipient quantity', () =>
          assertErc1155Balance(BigInt(1))
        );
      }
      await wallet.step('prepare dapp provider instrumentation', async () => {
        await wallet.context.addInitScript(() => {
          const state = { requests: [] as any[] };
          (window as any).__paliConformance = state;
          window.addEventListener('eip6963:announceProvider', ((
            event: CustomEvent
          ) => {
            const provider = event.detail.provider;
            if ((window as any).__paliConformanceProvider) return;
            (window as any).__paliConformanceProvider = provider;
            const request = provider.request.bind(provider);
            provider.request = async (args: any) => {
              const item: any = { method: args.method, started: Date.now() };
              state.requests.push(item);
              try {
                item.result = await request(args);
                return item.result;
              } catch (error: any) {
                item.error = { message: error.message, code: error.code };
                throw error;
              } finally {
                item.settled = true;
              }
            };
          }) as EventListener);
        });
      });
      const app = await wallet.step(
        'connect smart account to dapp',
        async (capture) => {
          await page.goto('about:blank');
          const app = await wallet.context.newPage();
          await app.goto(dapp!.url);
          await app.waitForFunction(() =>
            Boolean((window as any).__paliConformanceProvider)
          );
          const connection = await approve(
            wallet.context,
            app,
            await startRequest(app, 'eth_requestAccounts'),
            capture
          );
          expect(connection.result[0].toLowerCase()).toBe(
            account.toLowerCase()
          );
          return app;
        }
      );
      await wallet.step(
        'measure public reads delivered through separate browser events',
        async () => {
          const blockTag = await localRpc(chain.url, 'eth_blockNumber', []);
          for (const identical of [false, true]) {
            const name = identical
              ? 'public-reads:identical'
              : 'public-reads:distinct';
            mark(name);
            const start = performance.now();
            const values = await app.evaluate(
              async ({ same, tag, base }) => {
                const channel = new MessageChannel();
                const pending: Promise<unknown>[] = [];
                return await new Promise<unknown[]>((resolve, reject) => {
                  channel.port1.onmessage = ({ data: index }) => {
                    const address = same
                      ? base
                      : `0x${(index + 1).toString(16).padStart(40, '0')}`;
                    pending.push(
                      (window as any).__paliConformanceProvider.request({
                        method: 'eth_getBalance',
                        params: [address, tag],
                      })
                    );
                    if (pending.length === 4) {
                      channel.port1.close();
                      channel.port2.close();
                      Promise.all(pending).then(resolve, reject);
                    }
                  };
                  for (let index = 0; index < 4; index++)
                    channel.port2.postMessage(index);
                });
              },
              { same: identical, tag: blockTag, base: payer }
            );
            await Promise.all(bodies);
            const rows = output.requests.filter(
              (row: any) =>
                row.phase === name && row.methods.includes('eth_getBalance')
            );
            const accepted = rows.filter(
              (row: any) => !row.batchCapabilityProbe
            );
            expect(values).toHaveLength(4);
            expect(accepted.flatMap((row: any) => row.methods)).toHaveLength(
              identical ? 1 : 4
            );
            if (identical) expect(accepted).toHaveLength(1);
            else
              expect(accepted.length).toBeLessThanOrEqual(
                process.env.PALI_RPC_REJECT_BATCH ? 4 : 3
              );
            output[name] = {
              ...countRpcTraffic(rows),
              elapsedMs: performance.now() - start,
              injectedResponseDelayMs: 75,
            };
          }
          mark('public-reads:complete');
        }
      );
      const dappSend = async (label: string, request: Record<string, string>) =>
        wallet!.step(label + ' approval', async (capture) => {
          mark(label + ':review');
          const id = await startRequest(app, 'eth_sendTransaction', [
            { from: account, ...request },
          ]);
          const sent = await approve(wallet.context, app, id, async (popup) => {
            await capture(popup);
            await popup.screenshot({
              path: path.join(E2E_CONFIG.artifactsDir, label + '-approval.png'),
            });
            mark(label + ':confirm');
          });
          mark(label + ':acknowledged');
          output[label + ':receipt'] = await receipt(sent.result);
          await waitForWalletReceipt(sent.result);
        });
      await dappSend('dapp-native', {
        to: recipient,
        value: '0x38d7ea4c68000',
      });
      await dappSend('dapp-erc20', {
        to: token,
        data: erc20Abi.encodeFunctionData('transfer', [recipient, 10000]),
      });
      await dappSend('dapp-erc721', {
        to: nft,
        data: erc721Abi.encodeFunctionData('transferFrom', [
          account,
          recipient,
          2,
        ]),
      });
      if (multiToken) {
        await dappSend('dapp-erc1155', {
          to: multiToken,
          data: erc1155Abi.encodeFunctionData('safeTransferFrom', [
            account,
            recipient,
            7,
            1,
            '0x',
          ]),
        });
        await wallet.step('verify dapp ERC1155 recipient quantity', () =>
          assertErc1155Balance(BigInt(2))
        );
      }
      await wallet.step(
        'verify dapp ERC20 balance and NFT ownership',
        async () => {
          expect(
            BigInt(
              await localRpc(chain.url, 'eth_call', [
                {
                  to: token,
                  data: erc20Abi.encodeFunctionData('balanceOf', [recipient]),
                },
                'latest',
              ])
            )
          ).toBe(BigInt(20000));
          expect(
            erc721Abi
              .decodeFunctionResult(
                'ownerOf',
                await localRpc(chain.url, 'eth_call', [
                  {
                    to: nft,
                    data: erc721Abi.encodeFunctionData('ownerOf', [2]),
                  },
                  'latest',
                ])
              )[0]
              .toLowerCase()
          ).toBe(recipient.toLowerCase());
        }
      );
      await wallet.step(
        'return from dapp and select software account',
        async () => {
          mark('account-switch');
          await app.close();
          await wallet.gotoRoute('#/home');
          const options = page.getByRole('button', {
            name: 'GENERAL OPTIONS',
            exact: true,
          });
          await options.click();
          await page.locator('[id^="account-HDAccount"]').first().click();
          if ((await options.getAttribute('aria-expanded')) === 'true')
            await page.keyboard.press('Escape');
          await expect(options).toHaveAttribute('aria-expanded', 'false');
          expect((await wallet.getActiveAccountAddress()).toLowerCase()).toBe(
            payer.toLowerCase()
          );
          await waitForReadSettlement();
        }
      );
      await send('eoa-native');
      await importAsset(token, 'TST');
      await send('eoa-erc20', { symbol: 'TST' });
      await wallet.step(
        'verify software-account ERC20 recipient balance',
        async () => {
          expect(
            BigInt(
              await localRpc(chain.url, 'eth_call', [
                {
                  to: token,
                  data: erc20Abi.encodeFunctionData('balanceOf', [recipient]),
                },
                'latest',
              ])
            )
          ).toBe(BigInt(30000));
        }
      );
      const eoaApp = await wallet.step(
        'replace dapp connection with software account',
        async (capture) => {
          await page.goto('about:blank');
          const eoaApp = await wallet.context.newPage();
          await eoaApp.goto(dapp!.url);
          await eoaApp.waitForFunction(() =>
            Boolean((window as any).__paliConformanceProvider)
          );
          await providerRequest(eoaApp, 'wallet_revokePermissions', [
            { ['eth_accounts']: {} },
          ]);
          const eoaConnection = await approve(
            wallet.context,
            eoaApp,
            await startRequest(eoaApp, 'eth_requestAccounts'),
            capture
          );
          expect(eoaConnection.result[0].toLowerCase()).toBe(
            payer.toLowerCase()
          );
          return eoaApp;
        }
      );
      for (const [label, request] of [
        ['eoa-dapp-native', { to: recipient, value: '0x38d7ea4c68000' }],
        [
          'eoa-dapp-erc20',
          {
            to: token,
            data: erc20Abi.encodeFunctionData('transfer', [recipient, 10000]),
          },
        ],
      ] as const) {
        await wallet.step(label + ' approval', async (capture) => {
          mark(label + ':review');
          const id = await startRequest(eoaApp, 'eth_sendTransaction', [
            { from: payer, ...request },
          ]);
          const sent = await approve(
            wallet.context,
            eoaApp,
            id,
            async (popup) => {
              await capture(popup);
              mark(label + ':confirm');
            }
          );
          mark(label + ':acknowledged');
          output[label + ':receipt'] = await receipt(sent.result);
          await waitForWalletReceipt(sent.result);
        });
      }
      await wallet.step(
        'return home and verify final recipient token balance',
        async () => {
          await eoaApp.close();
          await wallet.gotoRoute('#/home');
          expect(
            BigInt(
              await localRpc(chain.url, 'eth_call', [
                {
                  to: token,
                  data: erc20Abi.encodeFunctionData('balanceOf', [recipient]),
                },
                'latest',
              ])
            )
          ).toBe(BigInt(40000));
        }
      );
    }
    if (!process.env.PALI_RPC_REFERENCE) {
      await wallet.step(
        'verify RPC methods, HTTP requests and byte budgets',
        async () => {
          await Promise.all(bodies);
          const fallback = Boolean(
            process.env.PALI_RPC_NO_MULTICALL ||
              process.env.PALI_RPC_REJECT_BATCH
          );
          const limits: Record<string, readonly [number, number]> = fallback
            ? {
                deployment: [46, 44],
                warm: [35, 35],
                erc20: [41, 41],
                erc721: [46, 46],
                'dapp-native': [35, 35],
                'dapp-erc20': [41, 41],
                'dapp-erc721': [46, 46],
                'eoa-native': [22, 22],
                'eoa-erc20': [28, 28],
                'eoa-dapp-native': [24, 24],
                'eoa-dapp-erc20': [24, 24],
              }
            : {
                deployment: [43, 30],
                warm: [33, 22],
                erc20: [41, 32],
                erc721: [46, 40],
                'dapp-native': [33, 22],
                'dapp-erc20': [41, 32],
                'dapp-erc721': [46, 40],
                'eoa-native': [20, 16],
                'eoa-erc20': [26, 23],
                'eoa-dapp-native': [22, 17],
                'eoa-dapp-erc20': [22, 17],
              };
          const reviewLimits: Record<string, readonly [number, number]> =
            fallback
              ? {
                  deployment: [16, 16],
                  warm: [22, 22],
                  erc20: [24, 24],
                  erc721: [25, 25],
                  'dapp-native': [36, 36],
                  'dapp-erc20': [40, 40],
                  'dapp-erc721': [38, 38],
                  'eoa-native': [12, 12],
                  'eoa-erc20': [12, 12],
                  'eoa-dapp-native': [33, 33],
                  'eoa-dapp-erc20': [40, 39],
                }
              : {
                  deployment: [16, 14],
                  warm: [12, 11],
                  erc20: [14, 13],
                  erc721: [15, 15],
                  'dapp-native': [26, 25],
                  'dapp-erc20': [30, 29],
                  'dapp-erc721': [28, 28],
                  'eoa-native': [12, 11],
                  'eoa-erc20': [12, 11],
                  'eoa-dapp-native': [33, 28],
                  'eoa-dapp-erc20': [40, 36],
                };
          const formLimits: Record<string, readonly [number, number]> = {
            deployment: [7, 7],
            warm: [6, 6],
            erc20: [10, 10],
            erc721: [20, 20],
            'eoa-native': [12, 12],
            'eoa-erc20': [10, 10],
          };
          // New families retain their separately measured work envelopes.
          // Two reads accommodate a receipt/head poll overlapping a phase.
          if (gasTank) {
            limits.deployment = fallback ? [38, 38] : [36, 25];
            limits.warm = fallback ? [38, 38] : [36, 25];
            reviewLimits.warm = fallback ? [23, 23] : [13, 12];
          }
          if (includeErc1155 || prefund)
            reviewLimits.deployment = prefund
              ? fallback
                ? [29, 29]
                : [29, 18]
              : fallback
              ? [24, 24]
              : [24, 13];
          if (includeErc1155) {
            limits.erc1155 = fallback ? [46, 46] : [46, 40];
            limits['dapp-erc1155'] = limits.erc1155;
            reviewLimits.erc1155 = fallback ? [25, 25] : [15, 15];
            reviewLimits['dapp-erc1155'] = fallback ? [43, 43] : [33, 33];
            formLimits.erc1155 = [8, 8];
            if (fallback) formLimits['eoa-native'] = [28, 28];
          }
          if (prefund) {
            formLimits.deployment = [10, 10];
            const finalBroadcast = Math.max(
              ...output.broadcasts
                .filter((row: any) => row.phase === 'prefund:confirm')
                .map((row: any) => row.requestIndex)
            );
            const rows = output.requests.filter(
              (row: any, index: number) =>
                row.phase === 'prefund:confirm' && index <= finalBroadcast
            );
            expect(
              rows.reduce(
                (sum: number, row: any) => sum + row.methods.length,
                0
              ),
              'two-transaction prefund RPC methods'
            ).toBeLessThanOrEqual(80);
            expect(
              rows.length,
              'two-transaction prefund HTTP requests'
            ).toBeLessThanOrEqual(fallback ? 80 : 68);
            expect(
              rows.reduce((sum: number, row: any) => sum + row.requestBytes, 0),
              'two-transaction prefund request bytes'
            ).toBeLessThanOrEqual(40 * 1024);
            expect(
              rows.reduce(
                (sum: number, row: any) => sum + row.responseBytes,
                0
              ),
              'two-transaction prefund response bytes'
            ).toBeLessThanOrEqual(64 * 1024);
          }
          if (responseDelayMs > 0) {
            // At 80 ms per response the real receipt/history poll can overlap
            // the next action. Keep these measured slow-link envelopes local.
            formLimits.deployment = [16, 7];
            formLimits['eoa-native'] = [14, 6];
            formLimits.erc20 = [18, 18];
            reviewLimits.deployment = [20, 19];
            reviewLimits.erc20 = [20, 19];
            reviewLimits.erc721 = [20, 20];
            reviewLimits['dapp-native'] = [46, 36];
            reviewLimits['dapp-erc20'] = [39, 38];
            reviewLimits['dapp-erc721'] = [42, 42];
            reviewLimits['eoa-native'] = [41, 33];
            reviewLimits['eoa-dapp-native'] = [35, 30];
            reviewLimits['eoa-dapp-erc20'] = [45, 41];
            limits.erc721 = [56, 50];
            limits['dapp-erc20'] = [45, 36];
            limits['eoa-erc20'] = [34, 31];
            limits['eoa-dapp-erc20'] = [30, 25];
          }
          // Pre-authorization payer availability uses two nonce reads in the
          // existing phase. Scalar-only endpoints need two envelopes.
          for (const label of Object.keys(reviewLimits)) {
            if (label.startsWith('eoa-')) continue;
            const [methods, posts] = reviewLimits[label];
            reviewLimits[label] = [methods + 2, posts + (fallback ? 2 : 1)];
          }
          const labels =
            process.env.PALI_RPC_EXTENDED === '1'
              ? Object.keys(limits)
              : ['deployment', 'warm'];
          for (const label of labels) {
            const marker = label + ':confirm';
            const broadcast = output.broadcasts.find(
              (entry: any) => entry.phase === marker
            );
            expect(broadcast, marker + ' broadcast').toBeDefined();
            for (const stage of ['form', 'review', 'confirm']) {
              const phaseName = label + ':' + stage;
              const rows = output.requests.filter(
                (request: any, index: number) =>
                  request.phase === phaseName &&
                  (stage !== 'confirm' || index <= broadcast.requestIndex)
              );
              if (!rows.length && stage !== 'confirm') continue;
              const [baselineMethods, baselinePosts] =
                stage === 'confirm'
                  ? limits[label]!
                  : stage === 'form'
                  ? formLimits[label]!
                  : reviewLimits[label]!;
              const finalExecutionCheck =
                stage === 'confirm' &&
                label !== 'deployment' &&
                !label.startsWith('eoa-');
              if (finalExecutionCheck) {
                const entryPoint = getPaliCanonicalEntryPointAddress(
                  chain.chainId
                ).toLowerCase();
                const simulations = rows.flatMap((row: any) =>
                  row.methods.flatMap((method: string, index: number) => {
                    const calls =
                      row.params[index]?.[0]?.blockStateCalls?.[0]?.calls;
                    return method === 'eth_simulateV1' &&
                      calls?.some(
                        (tx: any) => tx.to?.toLowerCase() === entryPoint
                      )
                      ? [row]
                      : [];
                  })
                );
                expect(
                  simulations,
                  phaseName + ' exact signed outer simulation'
                ).toHaveLength(1);
                expect(simulations[0].methods).toEqual(['eth_simulateV1']);
              }
              // Dapp metadata reads can precede fee preparation by more
              // than ethers' 250ms cache window on CI. Its fresh fee header is
              // one extra read, without allowing unrelated RPC work to grow.
              const freshFeeHeaders =
                label.startsWith('dapp-') && stage === 'review'
                  ? rows.filter(
                      (row: any) =>
                        row.methods.length === 1 &&
                        row.methods[0] === 'eth_getBlockByNumber' &&
                        row.params[0]?.[0] === 'latest' &&
                        row.params[0]?.[1] === false
                    )
                  : [];
              const feeHeaderAllowance = freshFeeHeaders.length > 1 ? 1 : 0;
              expect(freshFeeHeaders.length).toBeLessThanOrEqual(2);
              const methods =
                baselineMethods +
                Number(finalExecutionCheck) +
                feeHeaderAllowance;
              const posts =
                baselinePosts +
                Number(finalExecutionCheck) +
                feeHeaderAllowance;
              // The endpoint's 30-second capability expires independently of
              // the UI stage. Concurrent probes can precede the first refusal.
              // Keep every refused probe in total traffic.
              assertRpcCapabilityProbes(rows, phaseName);
              assertRpcTrafficBudget(
                rows,
                {
                  methods: methods + 4 * 40,
                  posts: posts + 4,
                  requestBytes: 32 * 1024,
                  responseBytes: (stage === 'confirm' ? 128 : 256) * 1024,
                },
                phaseName
              );
              const work = rows.filter((row: any) => !row.batchCapabilityProbe);
              expect(
                work.reduce(
                  (total: number, row: any) => total + row.methods.length,
                  0
                ),
                phaseName + ' methods'
              ).toBeLessThanOrEqual(methods);
              expect(
                work.length,
                phaseName + ' HTTP requests'
              ).toBeLessThanOrEqual(posts);
              expect(
                rows.reduce(
                  (total: number, row: any) => total + row.requestBytes,
                  0
                ),
                phaseName + ' request bytes'
              ).toBeLessThanOrEqual(32 * 1024);
              expect(
                rows.reduce(
                  (total: number, row: any) => total + row.responseBytes,
                  0
                ),
                phaseName + ' response bytes'
              ).toBeLessThanOrEqual((stage === 'confirm' ? 128 : 256) * 1024);
            }
          }
        }
      );
    }
    if (!process.env.PALI_RPC_REFERENCE) {
      await wallet.step('verify whole-journey RPC traffic', async () => {
        await expect
          .poll(
            () =>
              output.requests.every((row: any) => row.finished !== undefined),
            { timeout: 10000 }
          )
          .toBe(true);
        await Promise.all(bodies);
        const extended = process.env.PALI_RPC_EXTENDED === '1';
        const large = extended && includeErc1155;
        const fallback = Boolean(
          process.env.PALI_RPC_NO_MULTICALL || process.env.PALI_RPC_REJECT_BATCH
        );
        const maximum = prefund
          ? {
              methods: 400,
              posts: 300,
              requestBytes: 128 * 1024,
              responseBytes: 1536 * 1024,
            }
          : gasTank
          ? {
              methods: 320,
              posts: 260,
              requestBytes: 96 * 1024,
              responseBytes: 1536 * 1024,
            }
          : large
          ? {
              methods: fallback ? 1320 : 1220,
              posts: fallback ? 1320 : 1000,
              requestBytes: 384 * 1024,
              responseBytes: 4 * 1024 * 1024,
            }
          : extended
          ? {
              methods: 1250,
              posts: 1250,
              requestBytes: 384 * 1024,
              responseBytes: 4 * 1024 * 1024,
            }
          : {
              methods: 350,
              posts: 310,
              requestBytes: 96 * 1024,
              responseBytes: 1536 * 1024,
            };
        assertRpcTrafficBudget(output.requests, maximum, 'whole journey');
        const probes = output.requests.filter(
          (row: any) => row.batchCapabilityProbe
        );
        expect(
          probes.length,
          'whole journey capability probes'
        ).toBeLessThanOrEqual(32);
        expect(
          probes.reduce((sum: number, row: any) => sum + row.methods.length, 0),
          'whole journey capability methods'
        ).toBeLessThanOrEqual(256);
        output.totalTraffic = countRpcTraffic(output.requests);
        output.capabilityProbeTraffic = countRpcTraffic(probes);
      });
    }
    if (process.env.PALI_RPC_CANCELLATION === '1') {
      const result = await runSmartAccountCancellationJourney({
        wallet,
        account,
        chain,
        currency,
        fenceUrl: fence.url,
        payer,
        recipient,
        mark,
        installRoutes: async (context) => {
          await context.route('**/*', routeLocalNetwork);
        },
      });
      wallet = result.wallet;
      output.cancellation = result.evidence;
    }
    await wallet.step('capture final wallet state', async () => {
      await wallet!.page.screenshot({
        path: path.join(E2E_CONFIG.artifactsDir, 'warm-send.png'),
      });
    });
    output.result = 'passed';
  } finally {
    chromium.launchPersistentContext = originalLaunch;
    output.result ??= 'failed';
    output.phaseCounts = Array.from(
      new Set(output.requests.map((request: any) => request.phase))
    ).map((name) => {
      const rows = output.requests.filter(
        (request: any) => request.phase === name
      );
      const broadcast = output.broadcasts.find(
        (entry: any) => entry.phase === name
      );
      const beforeBroadcast = broadcast
        ? output.requests
            .slice(0, broadcast.requestIndex + 1)
            .filter((row: any) => row.phase === name)
        : rows;
      const intervals = beforeBroadcast
        .map((row: any) => ({
          start: row.started,
          end: row.finished ?? row.started,
        }))
        .sort((left: any, right: any) => left.start - right.start);
      let requestGroups = 0;
      let stageEnd = -Infinity;
      for (const interval of intervals) {
        if (interval.start > stageEnd) requestGroups++;
        stageEnd = Math.max(stageEnd, interval.end);
      }
      const counts = (items: any[]) => ({
        httpRequests: items.length,
        rpcMethods: items.reduce((total, row) => total + row.methods.length, 0),
        requestBytes: items.reduce((total, row) => total + row.requestBytes, 0),
        responseBytes: items.reduce(
          (total, row) => total + (row.responseBytes || 0),
          0
        ),
      });
      return {
        name,
        requestGroups,
        durationMs: intervals.length
          ? Math.max(...intervals.map((item: any) => item.end)) -
            intervals[0].start
          : 0,
        total: counts(rows),
        capabilityProbes: counts(
          rows.filter((row: any) => row.batchCapabilityProbe)
        ),
        beforeBroadcast: counts(beforeBroadcast),
        methods: Object.fromEntries(
          Array.from(
            new Set(beforeBroadcast.flatMap((row: any) => row.methods))
          ).map((method) => [
            method,
            beforeBroadcast.reduce(
              (sum: number, row: any) =>
                sum +
                row.methods.filter((value: string) => value === method).length,
              0
            ),
          ])
        ),
      };
    });
    if (wallet) {
      output.controllerFees = await wallet.page
        .evaluate(() => (window as any).__paliSmartAccountFeeDiagnostics ?? [])
        .catch(() => []);
      output.finalUrl = wallet.page.url();
      output.finalText = await wallet.page
        .locator('body')
        .innerText()
        .catch(() => '<unavailable>');
      await wallet.page
        .screenshot({
          path: path.join(E2E_CONFIG.artifactsDir, 'final-screen.png'),
        })
        .catch(() => undefined);
    }
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'rpc-performance.json'),
      JSON.stringify(output, null, 2)
    );
    try {
      await wallet?.dispose(output.result);
    } finally {
      Object.assign(E2E_CONFIG, old);
      await fence.close();
      await dapp?.close();
      stop();
    }
  }
});
