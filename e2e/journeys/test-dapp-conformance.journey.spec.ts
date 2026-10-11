// V1 verifier is already pinned by sysweb3-keyring in yarn.lock (8.2.0).
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  recoverTypedSignature,
  SignTypedDataVersion,
} from '@metamask/eth-sig-util';
import { expect, test } from '@playwright/test';
import {
  getAddress,
  getCreateAddress,
  hexlify,
  toUtf8Bytes,
  verifyMessage,
  verifyTypedData,
  Wallet,
} from 'ethers';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import {
  LOCAL_CHAINS,
  TEST_DAPP_MNEMONIC,
  approve,
  closeApprovalPopups,
  extensionEvidence,
  installConformanceInstrumentation,
  launchConformanceWallet,
  localRpc,
  rpcObservation,
  openOfficialDapp,
  popupFor,
  providerRequest,
  settle,
  startLocalChains,
  startRequest,
} from '../harness/testDappConformance';

test('official test dapp: isolated standard provider conformance', async () => {
  test.setTimeout(12 * 60 * 1000);
  const stopChains = await startLocalChains();
  const wallet = await launchConformanceWallet().catch((error) => {
    stopChains();
    throw error;
  });
  const { forbiddenBroadcasts: forbidden, broadcastGuardCanary } =
    await installConformanceInstrumentation(wallet.context).catch(
      async (error) => {
        await wallet.dispose('failed');
        stopChains();
        throw error;
      }
    );
  const checks: any[] = [];
  const buildEvidence = extensionEvidence();
  const report = path.join(
    E2E_CONFIG.artifactsDir,
    'test-dapp-conformance.json'
  );
  const record = async (name: string, body: () => Promise<any>) => {
    console.log(`CONFORMANCE ${name}`);
    const start = Date.now();
    try {
      const evidence = await wallet.step(name, body);
      checks.push({
        name,
        status: 'passed',
        durationMs: Date.now() - start,
        evidence,
      });
    } catch (error: any) {
      const popups = await Promise.all(
        wallet.context
          .pages()
          .filter((tab) => tab.url().includes('/external'))
          .map(async (tab) => {
            await tab
              .screenshot({
                path: path.join(
                  E2E_CONFIG.artifactsDir,
                  `failed-${checks.length}-popup.png`
                ),
              })
              .catch(() => undefined);
            return {
              url: tab.url(),
              body: await tab
                .locator('body')
                .innerText()
                .catch(() => ''),
            };
          })
      );
      checks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - start,
        error: error.message,
        popups,
      });
      console.log(`CONFORMANCE FAILED ${name}: ${error.message}`);
      wallet.finding({ severity: 'bug', step: name, detail: error.message });
    } finally {
      await closeApprovalPopups(wallet.context);
      fs.writeFileSync(
        report,
        JSON.stringify(
          {
            ...buildEvidence,
            scope: process.env.PALI_TEST_DAPP_SCOPE || 'all',
            localChains: LOCAL_CHAINS,
            checks,
            forbiddenBroadcasts: forbidden,
            broadcastGuardCanary,
          },
          null,
          2
        )
      );
    }
  };
  let dapp: Awaited<ReturnType<typeof openOfficialDapp>> | undefined;
  let setupCompleted = false;
  try {
    await wallet.step('import disposable Anvil mnemonic', () =>
      wallet.importSeedAndCreatePassword()
    );
    await wallet.ensureOnHome();
    // An app.html tab blocks external approval windows.
    for (const tab of wallet.context.pages()) {
      if (tab.url().includes('/app.html')) await tab.goto('about:blank');
    }
    dapp = await openOfficialDapp(wallet.context);
    const page = dapp;
    const add = (chain: (typeof LOCAL_CHAINS)[number]) => [
      {
        chainId: chain.hexId,
        chainName: `Pali Local ${chain.chainId}`,
        nativeCurrency: { name: 'Local Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [chain.url],
      },
    ];
    const added = await approve(
      wallet.context,
      page,
      await startRequest(page, 'wallet_addEthereumChain', add(LOCAL_CHAINS[0]))
    );
    expect(added.result).toBeNull();
    expect(await providerRequest(page, 'eth_chainId')).toBe(
      LOCAL_CHAINS[0].hexId
    );
    expect(await providerRequest(page, 'eth_accounts')).toEqual([]);
    expect(await providerRequest(page, 'wallet_getPermissions')).toEqual([]);
    expect(await providerRequest(page, 'eth_blockNumber')).toMatch(
      /^0x[0-9a-f]+$/i
    );
    // Exercise the official connection button and its real provider call.
    const connectId = await page.evaluate(
      () => (window as any).__paliConformance.requests.length
    );
    await page
      .locator('#connectButton')
      .count()
      .then(async (count) => {
        await page.locator(count ? '#connectButton' : '#onboardButton').click();
      });
    const connected = await approve(wallet.context, page, connectId);
    const [address] = connected.result;
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(getAddress(address)).toBe(
      Wallet.fromPhrase(TEST_DAPP_MNEMONIC).address
    );
    wallet.summary.addAddress('disposable EOA', address);
    await localRpc(LOCAL_CHAINS[0].url, 'anvil_setBalance', [
      address,
      '0x56bc75e2d63100000',
    ]);
    await wallet.step('official dapp connected to local chain', async () => {
      expect(await providerRequest(page, 'eth_accounts')).toEqual([address]);
      expect(await providerRequest(page, 'eth_chainId')).toBe(
        LOCAL_CHAINS[0].hexId
      );
    });
    setupCompleted = true;

    await record('valid SIWE through official button', async () => {
      const id = await page.evaluate(
        () => (window as any).__paliConformance.requests.length
      );
      await page.locator('#siwe').click();
      const popup = await popupFor(wallet.context, page, id);
      await popup.screenshot({
        path: path.join(E2E_CONFIG.artifactsDir, 'siwe-valid-popup.png'),
      });
      const signed = await approve(wallet.context, page, id);
      const params = signed.params as string[];
      expect(
        getAddress(
          verifyMessage(Buffer.from(params[0].slice(2), 'hex'), signed.result)
        )
      ).toBe(getAddress(address));
      return signed;
    });

    await record(
      'invalid transaction value settles without popup',
      async () => {
        const id = await startRequest(page, 'eth_sendTransaction', [
          { from: address, to: address, value: 'invalid' },
        ]);
        let result;
        try {
          result = await settle(page, id, 2000);
        } catch (error) {
          const popup = wallet.context
            .pages()
            .find((candidate) => candidate.url().includes('/external'));
          if (popup) {
            await popup.screenshot({
              path: path.join(
                E2E_CONFIG.artifactsDir,
                'invalid-value-popup.png'
              ),
            });
            checks.push({
              name: 'invalid-value observed popup',
              status: 'evidence',
              body: await popup.locator('body').innerText(),
              rpc: await rpcObservation(page, id),
            });
          }
          throw error;
        }
        expect(result.error?.code).toBe(-32602);
        expect(result.durationMs).toBeLessThan(2000);
        expect(
          wallet.context
            .pages()
            .some((candidate) => candidate.url().includes('/external'))
        ).toBe(false);
        return result;
      }
    );

    if (process.env.PALI_TEST_DAPP_SCOPE !== 'regressions') {
      await record(
        'EIP-6963 discovery and window.ethereum fallback',
        async () => {
          const info = await page.evaluate(() => {
            window.dispatchEvent(new Event('eip6963:requestProvider'));
            const state = (window as any).__paliConformance;
            return {
              providers: state.providers,
              fallback:
                window.ethereum === (window as any).__paliConformanceProvider,
            };
          });
          expect(info.providers.length).toBeGreaterThan(0);
          expect(
            new Set(info.providers.map((provider: any) => provider.uuid)).size
          ).toBe(1);
          expect(info.providers[0]).toMatchObject({
            name: 'Pali Wallet',
            rdns: 'com.paliwallet',
          });
          expect(info.fallback).toBe(true);
          return info;
        }
      );
      await record('permissions contain the connected address', async () => {
        const initialGrant = await page.evaluate(() => {
          const state = (window as any).__paliConformance;
          return {
            snapshots: state.providerSnapshots.filter(
              (snapshot: any) => snapshot.method === 'eth_requestAccounts'
            ),
            events: state.events,
            notifications: state.notifications,
          };
        });
        checks.push({
          name: 'initial grant provider diagnostics',
          status: 'evidence',
          ...initialGrant,
        });
        expect(
          initialGrant.events.some(
            (event: any) =>
              event.name === 'accountsChanged' &&
              event.value.some(
                (account: string) => getAddress(account) === getAddress(address)
              )
          )
        ).toBe(true);
        const permissions = await providerRequest(
          page,
          'wallet_getPermissions'
        );
        expect(
          permissions
            .find(
              (permission: any) =>
                permission.parentCapability === 'eth_accounts'
            )
            .caveats[0].value.map(getAddress)
        ).toEqual([getAddress(address)]);
        const requested = await providerRequest(
          page,
          'wallet_requestPermissions',
          [{ ['eth_accounts']: {} }]
        );
        expect(
          requested.some(
            (permission: any) => permission.parentCapability === 'eth_accounts'
          )
        ).toBe(true);
        return { permissions, requested, initialGrant };
      });
      await record(
        'a second origin cannot see the permitted account',
        async () => {
          const server = await startDappServer();
          const other = await wallet.context.newPage();
          try {
            await other.goto(server.url);
            await other.waitForFunction(() =>
              Boolean((window as any).__paliConformanceProvider)
            );
            expect(await providerRequest(other, 'eth_accounts')).toEqual([]);
            expect(
              await providerRequest(other, 'wallet_getPermissions')
            ).toEqual([]);
            return { origin: new URL(server.url).origin };
          } finally {
            await other.close();
            await server.close();
          }
        }
      );
      await record('personal_sign reversed compatibility order', async () => {
        const message = 'Pali account-first compatibility';
        const signed = await approve(
          wallet.context,
          page,
          await startRequest(page, 'personal_sign', [
            address,
            hexlify(toUtf8Bytes(message)),
          ])
        );
        expect(getAddress(verifyMessage(message, signed.result))).toBe(
          getAddress(address)
        );
        return signed;
      });
      await record(
        'SIWE current local chain with scheme and resources',
        async () => {
          const message = `https://metamask.github.io wants you to sign in with your Ethereum account:\n${address}\n\nSign in to the isolated Pali conformance fixture.\n\nURI: https://metamask.github.io/test-dapp/\nVersion: 1\nChain ID: ${
            LOCAL_CHAINS[0].chainId
          }\nNonce: 32891757\nIssued At: ${new Date().toISOString()}\nResources:\n- https://metamask.github.io/test-dapp/`;
          const signed = await approve(
            wallet.context,
            page,
            await startRequest(page, 'personal_sign', [
              hexlify(toUtf8Bytes(message)),
              address,
            ])
          );
          expect(getAddress(verifyMessage(message, signed.result))).toBe(
            getAddress(address)
          );
          return signed;
        }
      );
      await record(
        'personal_sign official fixture and independent recovery',
        async () => {
          const id = await page.evaluate(
            () => (window as any).__paliConformance.requests.length
          );
          await page.locator('#personalSign').click();
          const signed = await approve(wallet.context, page, id);
          expect(
            getAddress(
              verifyMessage('Example `personal_sign` message', signed.result)
            )
          ).toBe(getAddress(address));
          return signed;
        }
      );
      await record(
        'typed V1 official fixture and independent recovery',
        async () => {
          const id = await page.evaluate(
            () => (window as any).__paliConformance.requests.length
          );
          await page.locator('#signTypedData').click();
          const signed = await approve(wallet.context, page, id);
          expect(
            getAddress(
              recoverTypedSignature({
                data: (signed.params as any[])[0],
                signature: signed.result,
                version: SignTypedDataVersion.V1,
              })
            )
          ).toBe(getAddress(address));
          return signed;
        }
      );
      for (const version of ['V3', 'V4']) {
        await record(
          `typed ${version} official fixture and independent recovery`,
          async () => {
            const id = await page.evaluate(
              () => (window as any).__paliConformance.requests.length
            );
            await page.locator(`#signTypedData${version}`).click();
            const signed = await approve(wallet.context, page, id);
            const data = JSON.parse((signed.params as any[])[1]);
            // Ethers rejects unused roots that the official V4 fixture includes.
            // Keep exactly the primary type and its referenced dependencies;
            // unused definitions do not contribute to the EIP-712 digest.
            const types: Record<string, any> = {};
            const visit = (name: string) => {
              if (types[name]) return;
              types[name] = data.types[name];
              for (const field of data.types[name]) {
                const dependency = field.type.replace(/\[[0-9]*\]/g, '');
                if (data.types[dependency]) visit(dependency);
              }
            };
            visit(data.primaryType);
            expect(
              getAddress(
                verifyTypedData(data.domain, types, data.message, signed.result)
              )
            ).toBe(getAddress(address));
            return signed;
          }
        );
      }
      await record('user rejects signing with numeric 4001', async () => {
        const id = await startRequest(page, 'personal_sign', [
          '0x70616c69',
          address,
        ]);
        const popup = await popupFor(wallet.context, page, id);
        await popup
          .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
          .first()
          .click();
        const rejected = await settle(page, id, 5000);
        expect(rejected.error?.code).toBe(4001);
        return rejected;
      });
      for (const button of [
        'siweBadDomain',
        'siweBadAccount',
        'siweMalformed',
      ]) {
        await record(`${button} cannot sign silently`, async () => {
          // Rejected approvals intentionally count toward Pali's three-request
          // spam threshold. Space distinct negative fixtures beyond its
          // ten-second window so each validates SIWE rather than spam UI.
          await new Promise((resolve) => setTimeout(resolve, 10_100));
          const id = await page.evaluate(
            () => (window as any).__paliConformance.requests.length
          );
          await page.locator(`#${button}`).click();
          const popup = await popupFor(wallet.context, page, id);
          await expect(
            popup.getByRole('button', { name: /(?:^|\s)ok$/i })
          ).toBeVisible({ timeout: 2000 });
          await popup.screenshot({
            path: path.join(E2E_CONFIG.artifactsDir, `${button}.png`),
          });
          const body = await popup.locator('body').innerText();
          expect(body).toMatch(
            /signature request failed|suspicious|signing.*wrong|invalid|malformed|sign.in.*request/i
          );
          expect(
            await popup
              .getByRole('button', { name: /(?:^|\s)(sign|confirm)$/i })
              .count()
          ).toBe(0);
          await popup.getByRole('button', { name: /(?:^|\s)ok$/i }).click();
          const rejected = await settle(page, id, 5000);
          expect(typeof rejected.error?.code).toBe('number');
          return { request: rejected, body };
        });
      }
      for (const [method, params] of [
        ['personal_sign', ['0x12']],
        ['eth_signTypedData_v4', [address, '{invalid']],
        ['wallet_switchEthereumChain', [{ chainId: 'invalid' }]],
      ] as Array<[string, any]>) {
        await record(`malformed ${method} settles numerically`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_100));
          const result = await settle(
            page,
            await startRequest(page, method, params),
            2000
          );
          expect(result.error?.code).toBe(-32602);
          expect(result.durationMs).toBeLessThan(2000);
          expect(
            wallet.context
              .pages()
              .some((tab) => tab.url().includes('/external'))
          ).toBe(false);
          return result;
        });
      }
      await record(
        'zero EIP-1559 fee choices reject before unsupported SDK conversion',
        async () => {
          const rejected = [];
          for (const fee of [
            { maxFeePerGas: '0x0', maxPriorityFeePerGas: '0x0' },
            { maxFeePerGas: '0xba43b7400', maxPriorityFeePerGas: '0x0' },
          ]) {
            const result = await settle(
              page,
              await startRequest(page, 'eth_sendTransaction', [
                {
                  from: address,
                  to: address,
                  value: '0x0',
                  gas: '0x5208',
                  type: '0x2',
                  ...fee,
                },
              ]),
              2000
            );
            expect(result.error?.code).toBe(4200);
            expect(result.durationMs).toBeLessThan(2000);
            expect(
              wallet.context
                .pages()
                .some((tab) => tab.url().includes('/external'))
            ).toBe(false);
            rejected.push(result);
          }
          return rejected;
        }
      );
      await record(
        'intentional eth_sign and subscription rejection',
        async () => {
          const errors = [];
          for (const [method, params] of [
            ['eth_sign', [address, `0x${'12'.repeat(32)}`]],
            ['eth_subscribe', ['newHeads']],
            ['eth_unsubscribe', ['0x1']],
          ] as Array<[string, any]>) {
            const result = await settle(
              page,
              await startRequest(page, method, params),
              2000
            );
            if (method === 'eth_sign') {
              // Raw signing is deliberately unavailable; the background's
              // registry boundary can return methodNotFound before its 4200
              // policy rejection. Neither response may open a signing popup.
              expect([-32601, 4200]).toContain(result.error?.code);
            } else {
              expect(result.error?.code).toBe(4200);
            }
            errors.push(result);
          }
          return errors;
        }
      );
      await record(
        'valid unknown chain rejects with numeric 4902',
        async () => {
          const result = await settle(
            page,
            await startRequest(page, 'wallet_switchEthereumChain', [
              { chainId: '0xbeefcafe' },
            ]),
            2000
          );
          expect(result.error?.code).toBe(4902);
          expect(
            wallet.context
              .pages()
              .some((tab) => tab.url().includes('/external'))
          ).toBe(false);
          return result;
        }
      );
      await record(
        'add local chain and switch emits consistent chainChanged',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_100));
          await approve(
            wallet.context,
            page,
            await startRequest(
              page,
              'wallet_addEthereumChain',
              add(LOCAL_CHAINS[1])
            )
          );
          expect(await providerRequest(page, 'eth_chainId')).toBe(
            LOCAL_CHAINS[1].hexId
          );
          await approve(
            wallet.context,
            page,
            await startRequest(page, 'wallet_switchEthereumChain', [
              { chainId: LOCAL_CHAINS[0].hexId },
            ])
          );
          expect(await providerRequest(page, 'eth_chainId')).toBe(
            LOCAL_CHAINS[0].hexId
          );
          const events = await page.evaluate(() =>
            (window as any).__paliConformance.events.filter(
              (event: any) => event.name === 'chainChanged'
            )
          );
          expect(events.map((event: any) => event.value)).toContain(
            LOCAL_CHAINS[1].hexId
          );
          expect(events.at(-1).value).toBe(LOCAL_CHAINS[0].hexId);
          expect(
            await providerRequest(page, 'wallet_switchEthereumChain', [
              { chainId: LOCAL_CHAINS[0].hexId },
            ])
          ).toBeNull();
          return events;
        }
      );
      for (const { fee, chooseDappFee } of [
        {
          fee: {
            type: '0x2',
            // Above the local recommendation, so ordinary confirmation should
            // preserve these fees without invoking Pali's low-fee safety UI.
            maxFeePerGas: '0xba43b7400',
            maxPriorityFeePerGas: '0x2540be400',
          },
          chooseDappFee: false,
        },
        { fee: { type: '0x0', gasPrice: '0xba43b7400' }, chooseDappFee: false },
        { fee: { type: '0x0', gasPrice: '0x3b9aca00' }, chooseDappFee: true },
      ])
        await record(
          `local type ${fee.type}${
            chooseDappFee
              ? ' with explicit low-fee choice'
              : fee.type === '0x0'
              ? ' inferred from gasPrice with uppercase quantity prefixes'
              : ''
          } transaction returns mined hash without external broadcast`,
          async () => {
            const transactionRequest: Record<string, any> = {
              from: address,
              to: address,
              value: '0x0',
              gas: '0x5208',
              ...fee,
              ...(fee.type === '0x0' && !chooseDappFee
                ? {
                    value: '0X0',
                    gas: '0X5208',
                    gasPrice: '0XBA43B7400',
                  }
                : {}),
            };
            if (fee.type === '0x0' && !chooseDappFee)
              delete transactionRequest.type;
            const id = await startRequest(page, 'eth_sendTransaction', [
              transactionRequest,
            ]);
            const popup = await popupFor(wallet.context, page, id);
            if (chooseDappFee) {
              await popup
                .getByRole('button', {
                  name: 'Use dapp fee anyway',
                  exact: true,
                })
                .click();
              await expect(
                popup.getByText('Below estimate', { exact: true })
              ).toBeVisible();
            }
            await expect(
              popup.getByRole('button', { name: /(?:^|\s)confirm$/i }).last()
            ).toBeEnabled({ timeout: 10_000 });
            await popup.screenshot({
              path: path.join(
                E2E_CONFIG.artifactsDir,
                `transaction-${fee.type}${chooseDappFee ? '-dapp-fee' : ''}.png`
              ),
            });
            const approvalBody = await popup.locator('body').innerText();
            const result = await approve(wallet.context, page, id);
            expect(result.result).toMatch(/^0x[0-9a-fA-F]{64}$/);
            let receipt: any;
            await expect
              .poll(
                async () => {
                  receipt = await localRpc(
                    LOCAL_CHAINS[0].url,
                    'eth_getTransactionReceipt',
                    [result.result]
                  );
                  return receipt?.status;
                },
                { timeout: 5000 }
              )
              .toBe('0x1');
            expect(getAddress(receipt.from)).toBe(getAddress(address));
            expect(getAddress(receipt.to)).toBe(getAddress(address));
            expect(receipt.status).toBe('0x1');
            expect(receipt.type).toBe(fee.type);
            const transaction = await localRpc(
              LOCAL_CHAINS[0].url,
              'eth_getTransactionByHash',
              [result.result]
            );
            expect(transaction.chainId).toBe(LOCAL_CHAINS[0].hexId);
            expect(transaction.type).toBe(fee.type);
            if ('gasPrice' in fee)
              expect(BigInt(transaction.gasPrice)).toBe(BigInt(fee.gasPrice));
            else {
              expect(BigInt(transaction.maxFeePerGas)).toBe(
                BigInt(fee.maxFeePerGas)
              );
              expect(BigInt(transaction.maxPriorityFeePerGas)).toBe(
                BigInt(fee.maxPriorityFeePerGas)
              );
            }
            expect(forbidden).toEqual([]);
            wallet.summary.addTxHash(result.result);
            return { request: result, approvalBody, receipt, transaction };
          }
        );
      await record(
        'local contract creation binds omitted from to permitted account',
        async () => {
          const id = await startRequest(page, 'eth_sendTransaction', [
            {
              data: '0x6001600c60003960016000f300',
              value: '0x0',
              gas: '0x186a0',
              type: '0x0',
              gasPrice: '0xba43b7400',
            },
          ]);
          const result = await approve(wallet.context, page, id);
          expect(result.result).toMatch(/^0x[0-9a-fA-F]{64}$/);
          let receipt: any;
          await expect
            .poll(
              async () => {
                receipt = await localRpc(
                  LOCAL_CHAINS[0].url,
                  'eth_getTransactionReceipt',
                  [result.result]
                );
                return receipt?.status;
              },
              { timeout: 5000 }
            )
            .toBe('0x1');
          const transaction = await localRpc(
            LOCAL_CHAINS[0].url,
            'eth_getTransactionByHash',
            [result.result]
          );
          expect(getAddress(receipt.from)).toBe(getAddress(address));
          expect(receipt.to).toBeNull();
          expect(getAddress(receipt.contractAddress)).toBe(
            getCreateAddress({
              from: address,
              nonce: BigInt(transaction.nonce),
            })
          );
          expect(
            await localRpc(LOCAL_CHAINS[0].url, 'eth_getCode', [
              receipt.contractAddress,
              'latest',
            ])
          ).toBe('0x00');
          wallet.summary.addTxHash(result.result);
          return { request: result, receipt, transaction };
        }
      );
      await record(
        'user rejects local transaction without broadcast',
        async () => {
          const before = await localRpc(
            LOCAL_CHAINS[0].url,
            'eth_getTransactionCount',
            [address, 'latest']
          );
          const id = await startRequest(page, 'eth_sendTransaction', [
            { from: address, to: address, value: '0x0', gas: '0x5208' },
          ]);
          const popup = await popupFor(wallet.context, page, id);
          await popup
            .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
            .first()
            .click();
          const result = await settle(page, id, 5000);
          expect(result.error?.code).toBe(4001);
          expect(
            await localRpc(LOCAL_CHAINS[0].url, 'eth_getTransactionCount', [
              address,
              'latest',
            ])
          ).toBe(before);
          return result;
        }
      );
      await record(
        'revocation account events versus RPC transport',
        async () => {
          const before = await page.evaluate(
            () => (window as any).__paliConformance.events.length
          );
          expect(
            await providerRequest(page, 'wallet_revokePermissions', [
              { ['eth_accounts']: {} },
            ])
          ).toBeNull();
          expect(await providerRequest(page, 'eth_accounts')).toEqual([]);
          expect(await providerRequest(page, 'wallet_getPermissions')).toEqual(
            []
          );
          const block = await providerRequest(page, 'eth_blockNumber');
          const evidence = await page.evaluate(
            (eventStartIndex) => ({
              events: (window as any).__paliConformance.events.slice(
                eventStartIndex
              ),
              isConnected: (
                window as any
              ).__paliConformanceProvider.isConnected(),
            }),
            before
          );
          checks.push({
            name: 'revocation transport observed',
            status: 'evidence',
            block,
            ...evidence,
          });
          expect(
            evidence.events.find(
              (event: any) => event.name === 'accountsChanged'
            ).value
          ).toEqual([]);
          expect(
            evidence.events.some((event: any) => event.name === 'disconnect')
          ).toBe(false);
          expect(evidence.isConnected).toBe(true);
          return { block, ...evidence };
        }
      );
    }
    expect(forbidden).toEqual([]);
    expect(
      checks.filter((check) => check.status === 'failed'),
      JSON.stringify(
        checks.filter((check) => check.status === 'failed'),
        null,
        2
      )
    ).toEqual([]);
    await wallet.dispose('passed');
  } catch (error) {
    fs.writeFileSync(
      report,
      JSON.stringify(
        {
          ...buildEvidence,
          checks,
          ...(setupCompleted
            ? { runError: String(error) }
            : { setupError: String(error) }),
          pages: await Promise.all(
            wallet.context.pages().map(async (page) => ({
              url: page.url(),
              body: await page
                .locator('body')
                .innerText()
                .catch(() => ''),
              state: await page
                .evaluate(() => (window as any).__paliConformance)
                .catch(() => null),
            }))
          ),
          forbiddenBroadcasts: forbidden,
          broadcastGuardCanary,
        },
        null,
        2
      )
    );
    await wallet.dispose('failed');
    throw error;
  } finally {
    stopChains();
  }
});
