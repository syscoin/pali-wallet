import { expect, test, chromium, type Request } from '@playwright/test';
import { Interface, keccak256, Transaction } from 'ethers';
import fs from 'fs';
import path from 'path';

import {
  getPaliInfrastructureContracts,
  PALI_CREATE2_DEPLOYER_ADDRESS,
} from '../../source/utils/smartAccount/deployment';
import officialDeploymentContracts from '../../tests/fixtures/officialDeploymentContracts.json';
import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import { PaliWallet } from '../harness/pali';
import {
  startLocalChains,
  localRpc,
  LOCAL_CHAINS,
  TEST_DAPP_MNEMONIC,
  extensionEvidence,
} from '../harness/testDappConformance';
import {
  approve,
  startRequest,
  providerRequest,
} from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';

// Local RPC regression against a built extension. All accounts and contracts
// are disposable loopback fixtures. The launch proxy blocks other RPC traffic.
// PALI_RPC_EXTENDED=1 adds ERC20/ERC721 and dapp approvals.
// PALI_RPC_NO_MULTICALL=1 and PALI_RPC_REJECT_BATCH=1 qualify fallback readers.
// The ordinary configuration caps warm-send work at 30 logical RPC methods.
// PALI_RPC_REFERENCE=1 disables this cap for historical-artifact comparisons.
test('RPC budget and receipts for local wallet transfers', async () => {
  test.setTimeout(240000);
  const old = { ...E2E_CONFIG };
  const chain = LOCAL_CHAINS[0];
  const stop = await startLocalChains();
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
  };
  let wallet: PaliWallet | undefined;
  const originalLaunch = chromium.launchPersistentContext;
  let phase = 'setup';
  const mark = (next: string) => {
    phase = next;
    output.markers.push({ phase, at: Date.now() });
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
  try {
    Object.assign(E2E_CONFIG, {
      seedPhrase: TEST_DAPP_MNEMONIC,
      password: 'DisposableRpcCount!2026',
      chainId: chain.chainId,
      rpcUrl: chain.url,
      networkLabel: 'Pali Local 31337',
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
    chromium.launchPersistentContext = originalLaunch;
    const observations = new Map<Request, any>();
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
            });
        output.requests.push(item);
        observations.set(request, item);
      } catch {
        /* non-RPC */
      }
    });
    wallet.context.on('response', async (response) => {
      const item = observations.get(response.request());
      if (item) {
        item.finished = Date.now();
        item.status = response.status();
        item.responseBytes = (
          await response.body().catch(() => Buffer.alloc(0))
        ).length;
      }
    });
    await wallet.context.route('**/*', async (route) => {
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
        if (Array.isArray(raw) && process.env.PALI_RPC_REJECT_BATCH === '1') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32600,
                message: 'Batch requests are not supported',
              },
            }),
          });
        }
        const rows = Array.isArray(raw) ? raw : [raw];
        const replies = await Promise.all(
          rows.map(async (row) => {
            try {
              return {
                jsonrpc: '2.0',
                id: row.id,
                result: await localRpc(chain.url, row.method, row.params || []),
              };
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
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(raw) ? replies : replies[0]),
        });
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
    });
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
        return [payer, recipient] as const;
      }
    );
    await wallet.step('import disposable wallet', () =>
      wallet!.importSeedAndCreatePassword()
    );
    const page = wallet.page;
    await wallet.step('configure local network', async () => {
      await wallet!.gotoRoute('#/settings/networks/custom-rpc');
      await page
        .getByRole('combobox', { name: 'Label', exact: true })
        .fill('Pali Local 31337');
      await page
        .getByPlaceholder('RPC URL (e.g. https://rpc.example.com)')
        .fill(chain.url);
      await page
        .getByPlaceholder('Chain ID (e.g., 1 for Ethereum, 56 for BSC)')
        .fill(String(chain.chainId));
      await page.getByPlaceholder('Symbol', { exact: true }).fill('ETH');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).not.toHaveURL(/custom-rpc/);
      await wallet.switchNetwork('Pali Local 31337', 'EVM');
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
    });
    const account: string = output.account;
    const send = async (
      label: string,
      asset?: { symbol: string; tokenId?: string }
    ) =>
      wallet!.step(label + ' transfer', async () => {
        await wallet.ensureOnHome();
        mark(label + ':form');
        await page.locator('#send-btn').click();
        if (asset) {
          await page.getByRole('button', { name: /^ETH$/ }).click();
          await page
            .getByRole('menuitem', { name: new RegExp(asset.symbol) })
            .click();
        }
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill(recipient);
        if (asset?.tokenId)
          await page
            .getByPlaceholder('Enter token ID', { exact: true })
            .fill(asset.tokenId);
        else
          await page
            .getByPlaceholder('Amount', { exact: true })
            .fill(asset ? '1' : '0.001');
        if (asset?.tokenId)
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
        await expect
          .poll(() => output.broadcasts.length, { timeout: 45000 })
          .toBe(before + 1);
        mark(label + ':broadcast');
        const result = await receipt(output.broadcasts.at(-1).hash);
        output[label + ':receipt'] = result;
        await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
        mark(label + ':home');
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
        await expect
          .poll(
            () => {
              const requests = output.requests;
              const settled = requests.every(
                (request: any) => request.finished !== undefined
              );
              const lastStarted = requests.length
                ? requests[requests.length - 1].started
                : 0;
              return settled && Date.now() - lastStarted >= 250;
            },
            { timeout: 10000 }
          )
          .toBe(true);
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
          output.assets = { token, nft };
          return { token, nft };
        }
      );
      const importAsset = async (contract: string, symbol: string) =>
        wallet!.step('import ' + symbol, async () => {
          await wallet.gotoRoute('#/tokens/add?tab=custom');
          await page.locator('#custom-token-contract').fill(contract);
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
          await app.close();
          await wallet.gotoRoute('#/home');
          await page
            .getByRole('button', { name: 'GENERAL OPTIONS', exact: true })
            .click();
          await page.locator('[id^="account-HDAccount"]').first().click();
          expect((await wallet.getActiveAccountAddress()).toLowerCase()).toBe(
            payer.toLowerCase()
          );
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
    if (
      !process.env.PALI_RPC_NO_MULTICALL &&
      !process.env.PALI_RPC_REJECT_BATCH &&
      !process.env.PALI_RPC_REFERENCE
    ) {
      await wallet.step('verify warm-send RPC request budget', async () => {
        const broadcast = output.broadcasts.find(
          (entry: any) => entry.phase === 'warm:confirm'
        );
        expect(broadcast).toBeDefined();
        const methods = output.requests
          .filter(
            (request: any) =>
              request.phase === 'warm:confirm' &&
              request.started <= broadcast.at
          )
          .reduce(
            (total: number, request: any) => total + request.methods.length,
            0
          );
        expect(
          methods,
          'warm smart-account send logical RPC methods through broadcast'
        ).toBeLessThanOrEqual(30);
      });
    }
    await wallet.step('capture final wallet state', async () => {
      await page.screenshot({
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
        ? rows.filter((row: any) => row.started <= broadcast.at)
        : rows;
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
        total: counts(rows),
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
