// V1 verifier is already pinned by sysweb3-keyring in yarn.lock (8.2.0).
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  recoverTypedSignature,
  SignTypedDataVersion,
} from '@metamask/eth-sig-util';
import {
  type Page,
  type Response,
  type Route,
  expect,
  test,
} from '@playwright/test';
import {
  getAddress,
  getCreateAddress,
  hexlify,
  Interface,
  toUtf8Bytes,
  verifyMessage,
  verifyTypedData,
  Wallet,
} from 'ethers';
import fs from 'fs';
import path from 'path';

import enTranslations from '../../source/assets/locales/en.json';
import officialDeploymentContracts from '../../tests/fixtures/officialDeploymentContracts.json';
import typedOrderFixtures from '../../tests/fixtures/typedOrderRequests.json';
import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
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
      // Account RPCs may differ in checksum casing; compare the full address
      // list by identity while still rejecting malformed or unexpected accounts.
      expect(
        (await providerRequest(page, 'eth_accounts')).map(getAddress)
      ).toEqual([getAddress(address)]);
      expect(await providerRequest(page, 'eth_chainId')).toBe(
        LOCAL_CHAINS[0].hexId
      );
    });
    setupCompleted = true;

    const deploymentScope =
      process.env.PALI_TEST_DAPP_SCOPE?.startsWith('deployments');
    const runOfficialDeployment = async (
      kind: keyof typeof officialDeploymentContracts.contracts,
      cancel = false,
      walletQuoteFault?: 'overflow' | 'replay'
    ) => {
      const invalidWalletEstimate = walletQuoteFault === 'overflow';
      const replayWalletEstimate = walletQuoteFault === 'replay';
      const fixture = officialDeploymentContracts.contracts[kind];
      const abi = new Interface(fixture.abi);
      const expectedData =
        fixture.bytecode +
        abi
          .encodeDeploy(kind === 'erc20' ? [10, 'TST', 4, 'TST'] : [])
          .slice(2);
      const before = await localRpc(
        LOCAL_CHAINS[0].url,
        'eth_getTransactionCount',
        [address, 'latest']
      );
      const requestStart = await page.evaluate(
        () => (window as any).__paliConformance.requests.length
      );
      const errors: Array<{ message: string; type: string; url: string }> = [];
      const watched: Array<{
        console: (message: any) => void;
        error: (error: Error) => void;
        page: Page;
      }> = [];
      const rpcEstimates: any[] = [];
      const rpcCalls: any[] = [];
      const pendingEstimates: Array<Promise<void>> = [];
      const estimateAttempts: any[] = [];
      let matchingEstimates = 0;
      let injectedEstimate: any;
      let priorCallReply: any;
      let priorCallRequest: any;
      const faultRoute = async (route: Route) => {
        const request = route.request();
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* Preserve the primary broadcast guard for unrelated requests. */
        }
        const rpc = Array.isArray(payload)
          ? payload.length === 1
            ? payload[0]
            : undefined
          : payload;
        if (
          new URL(request.url()).origin === LOCAL_CHAINS[0].url &&
          rpc?.method === 'eth_estimateGas' &&
          rpc.params?.[0]?.data?.toLowerCase() === expectedData.toLowerCase()
        ) {
          matchingEstimates += 1;
          estimateAttempts.push({
            url: request.url(),
            request: JSON.parse(JSON.stringify(rpc)),
          });
          if (matchingEstimates === 2) {
            // The first estimate belongs to the official dapp and remains
            // finite. Only the wallet's later quote gets an injected fault.
            if (replayWalletEstimate) {
              await expect
                .poll(() => priorCallReply, { timeout: 2000 })
                .toBeDefined();
              expect(priorCallReply.id).toBe(priorCallRequest.id);
              expect(priorCallReply.id).not.toBe(rpc.id);
              expect(priorCallReply.jsonrpc).toBe('2.0');
              expect(priorCallReply.result).toMatch(/^0x[0-9a-f]+$/i);
              expect(priorCallReply.result.length).toBeGreaterThan(2000);
              // Replay the actual prior call reply, including its wrong ID
              // and runtime code, rather than inventing an oversized gas.
              injectedEstimate = JSON.parse(JSON.stringify(priorCallReply));
            } else {
              injectedEstimate = {
                jsonrpc: '2.0',
                id: rpc.id,
                result: `0x${'f'.repeat(300)}`,
              };
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(
                Array.isArray(payload) ? [injectedEstimate] : injectedEstimate
              ),
            });
            return;
          }
        }
        await route.fallback();
      };
      const observeEstimate = (response: Response) => {
        const request = response.request();
        if (new URL(request.url()).origin !== LOCAL_CHAINS[0].url) return;
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          return;
        }
        const quoteRequests = (
          Array.isArray(payload) ? payload : [payload]
        ).filter(
          (rpc: any) =>
            ['eth_call', 'eth_estimateGas'].includes(rpc?.method) &&
            rpc.params?.[0]?.data?.toLowerCase() === expectedData.toLowerCase()
        );
        if (!quoteRequests.length) return;
        pendingEstimates.push(
          response
            .json()
            .then((result) => {
              const evidence = {
                url: response.url(),
                requests: quoteRequests,
                response: result,
                serviceWorker: request.serviceWorker()?.url(),
              };
              if (quoteRequests.some((rpc) => rpc.method === 'eth_estimateGas'))
                rpcEstimates.push(evidence);
              const call = quoteRequests.find(
                (rpc) => rpc.method === 'eth_call'
              );
              if (call) {
                rpcCalls.push(evidence);
                priorCallReply = Array.isArray(result)
                  ? result.find((reply) => reply.id === call.id)
                  : result;
                priorCallRequest = call;
              }
            })
            .catch((error) => {
              rpcEstimates.push({ error: error.message });
            })
        );
      };
      const observePopup = (opened: Page) => {
        const onError = (error: Error) =>
          errors.push({
            url: opened.url(),
            type: 'pageerror',
            message: error.message,
          });
        const onConsole = (message: any) => {
          if (message.type() === 'error')
            errors.push({
              url: opened.url(),
              type: 'console',
              message: message.text(),
            });
        };
        opened.on('pageerror', onError);
        opened.on('console', onConsole);
        watched.push({ page: opened, error: onError, console: onConsole });
      };
      wallet.context.on('page', observePopup);
      wallet.context.on('response', observeEstimate);
      let requestId: number | undefined;
      try {
        if (walletQuoteFault) await wallet.context.route('**/*', faultRoute);
        if (kind === 'erc20') await page.locator('#tokenDecimals').fill('4');
        await expect(page.locator(`#${fixture.button}`)).toBeEnabled();
        await page.locator(`#${fixture.button}`).click();
        await expect
          .poll(
            async () => {
              requestId = await page.evaluate(
                (start) =>
                  (window as any).__paliConformance.requests
                    .slice(start)
                    .find(
                      (request: any) => request.method === 'eth_sendTransaction'
                    )?.id,
                requestStart
              );
              return requestId;
            },
            { timeout: 10_000 }
          )
          .toBeDefined();
        const request = await rpcObservation(page, requestId!);
        const submitted = (request.params as any[])[0];
        expect(submitted.data.toLowerCase()).toBe(expectedData.toLowerCase());
        expect(submitted.to ?? null).toBeNull();
        expect((expectedData.length - 2) / 2).toBeGreaterThan(10_000);
        const popup = await popupFor(wallet.context, page, requestId!);
        const confirm = popup
          .getByRole('button', { name: /(?:^|\s)confirm$/i })
          .last();
        const reject = popup
          .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
          .first();
        if (invalidWalletEstimate) {
          const closed = popup.waitForEvent('close', { timeout: 7000 });
          await expect(popup.locator('body')).toContainText(
            enTranslations.send.txWillFail,
            { timeout: 2500 }
          );
          await expect(confirm).toBeHidden();
          const approvalBody = await popup.locator('body').innerText();
          await popup.screenshot({
            path: path.join(
              E2E_CONFIG.artifactsDir,
              'official-erc20-invalid-wallet-estimate.png'
            ),
          });
          await closed;
          const rejected = await settle(page, requestId!, 5000);
          expect(typeof rejected.error?.code).toBe('number');
          expect(rejected.result).toBeUndefined();
          expect(injectedEstimate).toBeDefined();
          expect(matchingEstimates).toBe(2);
          // The original dapp gas remains the finite first RPC estimate.
          expect(Number.isSafeInteger(Number(BigInt(submitted.gas)))).toBe(
            true
          );
          expect(BigInt(submitted.gas)).toBeGreaterThan(BigInt(0));
          expect(
            errors.filter(
              (error) =>
                error.type === 'pageerror' ||
                /Infinity|NaN|RangeError|Cannot convert.*BigInt/i.test(
                  error.message
                )
            )
          ).toEqual([]);
          expect(
            await localRpc(LOCAL_CHAINS[0].url, 'eth_getTransactionCount', [
              address,
              'latest',
            ])
          ).toBe(before);
          expect(forbidden).toEqual([]);
          return {
            request: rejected,
            approvalBody,
            injectedEstimate,
            nonceBefore: before,
          };
        }
        await expect(reject).toBeVisible({ timeout: 2000 });
        await expect(confirm).toBeVisible({ timeout: 2000 });
        await expect(confirm).toBeEnabled({ timeout: 10_000 });
        await expect(popup.locator('body')).not.toContainText(/Infinity|NaN/);
        if (replayWalletEstimate) {
          expect(matchingEstimates).toBe(3);
          expect(estimateAttempts).toHaveLength(3);
          expect(injectedEstimate).toEqual(priorCallReply);
          const firstWalletAttempt = estimateAttempts[1];
          const recoveryAttempt = estimateAttempts[2];
          const firstUrl = new URL(firstWalletAttempt.url);
          const recoveryUrl = new URL(recoveryAttempt.url);
          expect(firstUrl.origin).toBe(LOCAL_CHAINS[0].url);
          expect(recoveryUrl.origin).toBe(firstUrl.origin);
          expect(recoveryUrl.pathname).toBe(firstUrl.pathname);
          expect(firstUrl.search).toBe('');
          expect([...recoveryUrl.searchParams.keys()]).toEqual([
            'sysweb3_rpc_request',
          ]);
          expect(
            recoveryUrl.searchParams.get('sysweb3_rpc_request')
          ).toBeTruthy();
          expect(recoveryAttempt.request.method).toBe('eth_estimateGas');
          expect(recoveryAttempt.request.params).toEqual(
            firstWalletAttempt.request.params
          );
          const ids = estimateAttempts.map((attempt) => attempt.request.id);
          expect(ids.every(Number.isSafeInteger)).toBe(true);
          expect(new Set(ids).size).toBe(3);
          expect(Number.isSafeInteger(Number(BigInt(submitted.gas)))).toBe(
            true
          );
          expect(BigInt(submitted.gas)).toBeGreaterThan(BigInt(0));
          await Promise.all(pendingEstimates);
          const recoveryReply = rpcEstimates.find(
            (estimate) => estimate.url === recoveryAttempt.url
          );
          const response = Array.isArray(recoveryReply?.response)
            ? recoveryReply.response[0]
            : recoveryReply?.response;
          expect(response?.id).toBe(recoveryAttempt.request.id);
          const firstEstimate = rpcEstimates.find((estimate) =>
            estimate.requests.some((rpc: any) => rpc.id === ids[0])
          );
          const firstReply = Array.isArray(firstEstimate?.response)
            ? firstEstimate.response[0]
            : firstEstimate?.response;
          expect(response?.result).toBe(firstReply?.result);
        }
        const screenshotPhase = replayWalletEstimate
          ? 'replay-recovery'
          : cancel
          ? 'cancel'
          : 'deploy';
        await popup.screenshot({
          path: path.join(
            E2E_CONFIG.artifactsDir,
            `official-${kind}-${screenshotPhase}-approval.png`
          ),
        });
        const approvalBody = await popup.locator('body').innerText();
        expect(approvalBody).toContain(
          enTranslations.transactions.contractDeploy
        );
        await popup
          .locator('#tabExample')
          .getByText('Hex', { exact: true })
          .click();
        await expect(popup.locator('#hexTab')).toBeVisible();
        expect(
          await popup
            .locator('#hexTab')
            .getByRole('button', {
              name: enTranslations.buttons.copy,
              exact: true,
            })
            .textContent()
        ).toBe(submitted.data);
        await popup.screenshot({
          path: path.join(
            E2E_CONFIG.artifactsDir,
            `official-${kind}-${screenshotPhase}-hex.png`
          ),
        });
        if (cancel) {
          const rejected = await dismissRejectedApproval({
            click: () => reject.click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(page, requestId!, 5000),
          });
          expect(rejected.error?.code).toBe(4001);
          expect(rejected.result).toBeUndefined();
          expect(
            await localRpc(LOCAL_CHAINS[0].url, 'eth_getTransactionCount', [
              address,
              'latest',
            ])
          ).toBe(before);
          expect(errors.filter((error) => error.type === 'pageerror')).toEqual(
            []
          );
          return { request: rejected, approvalBody, nonceBefore: before };
        }
        const result = await approve(wallet.context, page, requestId!);
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
        expect(transaction.input.toLowerCase()).toBe(
          expectedData.toLowerCase()
        );
        expect(getAddress(transaction.from)).toBe(getAddress(address));
        expect(getAddress(receipt.from)).toBe(getAddress(address));
        expect(transaction.to).toBeNull();
        expect(receipt.to).toBeNull();
        expect(transaction.chainId).toBe(LOCAL_CHAINS[0].hexId);
        expect(BigInt(transaction.nonce)).toBe(BigInt(before));
        expect(getAddress(receipt.contractAddress)).toBe(
          getCreateAddress({ from: address, nonce: BigInt(before) })
        );
        expect(BigInt(transaction.value)).toBe(BigInt(0));
        expect(
          BigInt(
            await localRpc(LOCAL_CHAINS[0].url, 'eth_getTransactionCount', [
              address,
              'latest',
            ])
          )
        ).toBe(BigInt(before) + BigInt(1));
        const code = await localRpc(LOCAL_CHAINS[0].url, 'eth_getCode', [
          receipt.contractAddress,
          'latest',
        ]);
        expect((code.length - 2) / 2).toBeGreaterThan(1000);
        const read = async (method: string, args: any[] = []) =>
          abi.decodeFunctionResult(
            method,
            await localRpc(LOCAL_CHAINS[0].url, 'eth_call', [
              {
                to: receipt.contractAddress,
                data: abi.encodeFunctionData(method, args),
              },
              'latest',
            ])
          )[0];
        const constructorState: Record<string, string | boolean> = {};
        if (kind === 'erc20') {
          constructorState.name = await read('name');
          constructorState.symbol = await read('symbol');
          constructorState.decimals = (await read('decimals')).toString();
          constructorState.totalSupply = (await read('totalSupply')).toString();
          constructorState.balance = (
            await read('balanceOf', [address])
          ).toString();
          constructorState.owner = getAddress(await read('owner'));
          expect(constructorState).toEqual({
            name: 'TST',
            symbol: 'TST',
            decimals: '4',
            totalSupply: '100000',
            balance: '100000',
            owner: getAddress(address),
          });
        } else if (kind === 'erc721') {
          constructorState.name = await read('name');
          constructorState.symbol = await read('symbol');
          constructorState.currentTokenId = (
            await read('currentTokenId')
          ).toString();
          constructorState.balance = (
            await read('balanceOf', [address])
          ).toString();
          constructorState.erc721 = await read('supportsInterface', [
            '0x80ac58cd',
          ]);
          expect(constructorState).toEqual({
            name: 'TestDappNFTs',
            symbol: 'TDN',
            currentTokenId: '0',
            balance: '0',
            erc721: true,
          });
        } else {
          constructorState.name = await read('name');
          constructorState.owner = getAddress(await read('owner'));
          constructorState.uri = await read('uri', [1]);
          constructorState.balance = (
            await read('balanceOf', [address, 1])
          ).toString();
          constructorState.erc1155 = await read('supportsInterface', [
            '0xd9b67a26',
          ]);
          expect(constructorState).toEqual({
            name: 'ERC1155',
            owner: getAddress(address),
            uri: 'ipfs://bafybeidxfmwycgzcp4v2togflpqh2gnibuexjy4m4qqwxp7nh3jx5zlh4y/1.json',
            balance: '0',
            erc1155: true,
          });
        }
        expect(forbidden).toEqual([]);
        if (replayWalletEstimate) expect(matchingEstimates).toBe(3);
        expect(errors.filter((error) => error.type === 'pageerror')).toEqual(
          []
        );
        wallet.summary.addTxHash(result.result);
        return {
          source: officialDeploymentContracts.source,
          request: result,
          approvalBody,
          initcodeBytes: (expectedData.length - 2) / 2,
          receipt,
          transaction,
          runtimeCodeBytes: (code.length - 2) / 2,
          constructorState,
          popupErrors: errors,
          replayRecovery: replayWalletEstimate
            ? {
                estimateAttempts,
                injectedEstimate,
                priorCallReply,
                priorCallRequest,
                rpcEstimates,
              }
            : undefined,
        };
      } finally {
        if (walletQuoteFault) await wallet.context.unroute('**/*', faultRoute);
        wallet.context.off('page', observePopup);
        wallet.context.off('response', observeEstimate);
        await Promise.all(pendingEstimates);
        watched.forEach((observed) => {
          observed.page.off('pageerror', observed.error);
          observed.page.off('console', observed.console);
        });
        checks.push({
          name: `official ${kind} ${
            invalidWalletEstimate
              ? 'invalid wallet-estimate'
              : replayWalletEstimate
              ? 'replay-recovery'
              : cancel
              ? 'cancel'
              : 'deployment'
          } diagnostics`,
          status: 'evidence',
          requestId,
          requests: await page.evaluate(
            (start) => (window as any).__paliConformance.requests.slice(start),
            requestStart
          ),
          popupErrors: errors,
          rpcEstimates,
          rpcCalls,
          injectedEstimate,
          matchingEstimates,
          estimateAttempts,
        });
      }
    };
    const runOfficialDeploymentCases = async () => {
      await record('official ERC20 Create Token long deployment', () =>
        runOfficialDeployment('erc20')
      );
      if (process.env.PALI_TEST_DAPP_SCOPE === 'deployments-erc20') return;
      await record('official ERC721 long deployment', () =>
        runOfficialDeployment('erc721')
      );
      await record('official ERC1155 long deployment', () =>
        runOfficialDeployment('erc1155')
      );
      await record(
        'replayed deployment call reply recovers with one read-only retry',
        () => runOfficialDeployment('erc20', false, 'replay')
      );
      await record(
        'official long deployment cancellation preserves nonce',
        () => runOfficialDeployment('erc20', true)
      );
      await record(
        'invalid wallet-side deployment quote fails without render crash',
        () => runOfficialDeployment('erc20', false, 'overflow')
      );
    };
    if (deploymentScope) {
      if (process.env.PALI_TEST_DAPP_SCOPE === 'deployments-fault') {
        await record(
          'invalid wallet-side deployment quote fails without render crash',
          () => runOfficialDeployment('erc20', false, 'overflow')
        );
      } else if (process.env.PALI_TEST_DAPP_SCOPE === 'deployments-replay') {
        await record(
          'replayed deployment call reply recovers with one read-only retry',
          () => runOfficialDeployment('erc20', false, 'replay')
        );
      } else {
        await runOfficialDeploymentCases();
      }
    }

    if (!deploymentScope) {
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
    }

    if (
      process.env.PALI_TEST_DAPP_SCOPE !== 'regressions' &&
      !deploymentScope
    ) {
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
              announcedIsOwned:
                (window as any).__paliConformanceProvider ===
                (window as any).paliProvider?.proxiedProvider,
              foreignFallback:
                window.ethereum !== (window as any).__paliConformanceProvider &&
                Boolean(window.ethereum?.isMetaMask),
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
          expect(info.announcedIsOwned).toBe(true);
          // The official test dapp also initializes MetaMaskSDK, which may
          // occupy window.ethereum. EIP-6963 must not replace another wallet.
          expect(info.fallback || info.foreignFallback).toBe(true);

          const fallbackServer = await startDappServer();
          const fallbackPage = await wallet.context.newPage();
          try {
            await fallbackPage.goto(fallbackServer.url);
            await fallbackPage.waitForFunction(() =>
              Boolean((window as any).__paliConformanceProvider)
            );
            const isolatedFallback = await fallbackPage.evaluate(async () => ({
              sameProvider:
                window.ethereum === (window as any).__paliConformanceProvider,
              chainId: await window.ethereum.request({ method: 'eth_chainId' }),
            }));
            expect(isolatedFallback.sameProvider).toBe(true);
            expect(isolatedFallback.chainId).toBe(LOCAL_CHAINS[0].hexId);
            return { ...info, isolatedFallback };
          } finally {
            await fallbackPage.close();
            await fallbackServer.close();
          }
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

      for (const variant of [
        'paid-trade',
        'zero-payment',
        'no-return',
      ] as const) {
        await record(`NFT order terms: ${variant}`, async () => {
          const data = JSON.parse(
            JSON.stringify(
              variant === 'no-return'
                ? typedOrderFixtures.OrderComponents
                : typedOrderFixtures.ERC721Order
            )
          );
          data.domain.chainId = LOCAL_CHAINS[0].chainId;
          if (variant !== 'no-return') data.message.maker = address;
          if (variant === 'zero-payment') {
            data.message.erc20TokenAmount = '0';
            // A fee paid to someone else must not hide absent creator payment.
            data.message.fees = [
              {
                recipient: '0x0000000000000000000000000000000000000001',
                amount: '1',
                feeData: '0x',
              },
            ];
          }
          // Exercise documented version coverage in the real approval UI.
          if (variant === 'no-return') data.domain.version = '1.4';
          const original = JSON.stringify(data);
          const id = await startRequest(page, 'eth_signTypedData_v4', [
            address,
            original,
          ]);
          const popup = await popupFor(wallet.context, page, id);
          const warning =
            variant === 'zero-payment'
              ? enTranslations.send.nftOrderZeroPayment
              : enTranslations.send.nftOrderNoReturn;
          if (variant === 'paid-trade') {
            await expect(
              popup.getByText(enTranslations.send.nftOrderAuthorization, {
                exact: true,
              })
            ).toBeVisible();
            await expect(
              popup.getByText(enTranslations.send.nftOrderZeroPayment, {
                exact: true,
              })
            ).toHaveCount(0);
            await expect(
              popup.getByText(enTranslations.send.nftOrderNoReturn, {
                exact: true,
              })
            ).toHaveCount(0);
          } else {
            await expect(
              popup.getByText(warning, { exact: true })
            ).toBeVisible();
            await popup.screenshot({
              path: path.join(
                E2E_CONFIG.artifactsDir,
                `order-${variant}-advisory.png`
              ),
            });
          }
          const signed = await approve(wallet.context, page, id);
          expect(signed.params).toEqual([address, original]);
          const types = { ...data.types };
          delete types.EIP712Domain;
          expect(
            getAddress(
              verifyTypedData(data.domain, types, data.message, signed.result)
            )
          ).toBe(getAddress(address));
          return signed;
        });
      }

      const malformedPopupRequests: Array<[string, any[]]> = [
        [
          'eth_signTypedData_v4',
          [
            address,
            {
              domain: { verifyingContract: 'invalid-address' },
              types: {
                EIP712Domain: [{ name: 'verifyingContract', type: 'address' }],
                Account: [{ name: 'account', type: 'address' }],
              },
              primaryType: 'Account',
              message: { account: address },
            },
          ],
        ],
        [
          'eth_signTypedData_v4',
          [
            address,
            {
              domain: { verifyingContract: address },
              types: {
                EIP712Domain: [{ name: 'verifyingContract', type: 'address' }],
                Account: [{ name: 'account', type: 'address' }],
              },
              primaryType: 'Account',
              message: { account: 'invalid-address' },
            },
          ],
        ],
        [
          'eth_sendTransaction',
          [{ from: address, to: address, value: 'invalid' }],
        ],
        [
          'eth_signTypedData_v4',
          [
            address,
            {
              domain: {},
              types: { Account: [{ name: 'account', type: 'address' }] },
              primaryType: 'MissingType',
              message: { account: address },
            },
          ],
        ],
      ];
      const rejectMalformedBurstWithoutPopups = async () => {
        const started = Date.now();
        const openedPages: Page[] = [];
        const observePage = (opened: Page) => openedPages.push(opened);
        const rejected = [];
        wallet.context.on('page', observePage);
        try {
          for (const [method, params] of malformedPopupRequests) {
            const result = await settle(
              page,
              await startRequest(page, method, params),
              2000
            );
            expect(result.error?.code).toBe(-32602);
            expect(result.durationMs).toBeLessThan(2000);
            expect(result.result).toBeUndefined();
            expect(openedPages).toHaveLength(0);
            expect(
              wallet.context
                .pages()
                .some((tab) => tab.url().includes('/external'))
            ).toBe(false);
            rejected.push(result);
          }
          const durationMs = Date.now() - started;
          expect(durationMs).toBeLessThan(10_000);
          return { rejected, durationMs, openedPages: [] };
        } finally {
          wallet.context.off('page', observePage);
        }
      };

      await record(
        'rapid malformed requests never open approval or spam warnings',
        rejectMalformedBurstWithoutPopups
      );
      await record(
        'spam warning counts real rejections and Continue resumes ordinary approval',
        async () => {
          const nonceBefore = await localRpc(
            LOCAL_CHAINS[0].url,
            'eth_getTransactionCount',
            [address, 'latest']
          );
          const started = Date.now();
          const genuineRejections = [];
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const id = await startRequest(page, 'personal_sign', [
              '0x70616c69',
              address,
            ]);
            const popup = await popupFor(wallet.context, page, id);
            await expect(
              popup.getByRole('heading', {
                name: enTranslations.spamWarning.title,
                exact: true,
              })
            ).toHaveCount(0);
            const rejected = await dismissRejectedApproval({
              click: () =>
                popup
                  .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
                  .first()
                  .click(),
              isClosed: () => popup.isClosed(),
              settle: () => settle(page, id, 2000),
            });
            expect(rejected.error?.code).toBe(4001);
            expect(rejected.result).toBeUndefined();
            genuineRejections.push(rejected);
          }
          const malformed = await rejectMalformedBurstWithoutPopups();
          const elapsedBeforeThird = Date.now() - started;
          expect(elapsedBeforeThird).toBeLessThan(10_000);
          const id = await startRequest(page, 'personal_sign', [
            '0x70616c69',
            address,
          ]);
          const warning = await popupFor(wallet.context, page, id);
          await expect(
            warning.getByRole('heading', {
              name: enTranslations.spamWarning.title,
              exact: true,
            })
          ).toBeVisible();
          const warningData = JSON.parse(
            new URL(warning.url()).searchParams.get('data') || '{}'
          );
          expect(warningData.requestCount).toBe(3);
          await expect(
            warning.getByRole('button', {
              name: enTranslations.spamWarning.blockTemporarily,
              exact: true,
            })
          ).toBeVisible();
          await warning.screenshot({
            path: path.join(
              E2E_CONFIG.artifactsDir,
              'spam-three-real-attempts-warning.png'
            ),
          });
          const warningBody = await warning.locator('body').innerText();
          const warningClosed = warning.waitForEvent('close', {
            timeout: 5000,
          });
          await clickClosingPopup({
            click: () =>
              warning
                .getByRole('button', {
                  name: enTranslations.buttons.continue,
                  exact: true,
                })
                .click(),
            isClosed: () => warning.isClosed(),
          });
          await warningClosed;
          const approval = await popupFor(wallet.context, page, id);
          await expect(
            approval.getByRole('heading', {
              name: enTranslations.spamWarning.title,
              exact: true,
            })
          ).toHaveCount(0);
          await expect(
            approval.getByRole('button', {
              name: /(?:^|\s)(sign|confirm)$/i,
            })
          ).toBeVisible();
          await approval.screenshot({
            path: path.join(
              E2E_CONFIG.artifactsDir,
              'spam-continue-ordinary-approval.png'
            ),
          });
          const approvalBody = await approval.locator('body').innerText();
          const rejected = await dismissRejectedApproval({
            click: () =>
              approval
                .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
                .first()
                .click(),
            isClosed: () => approval.isClosed(),
            settle: () => settle(page, id, 2000),
          });
          expect(rejected.error?.code).toBe(4001);
          expect(rejected.result).toBeUndefined();
          const nonceAfter = await localRpc(
            LOCAL_CHAINS[0].url,
            'eth_getTransactionCount',
            [address, 'latest']
          );
          expect(nonceAfter).toBe(nonceBefore);
          return {
            genuineRejections,
            malformed,
            elapsedBeforeThird,
            warningCount: warningData.requestCount,
            warningBody,
            approvalBody,
            finalRejection: rejected,
            nonceBefore,
            nonceAfter,
          };
        }
      );

      await record('user rejects signing with numeric 4001', async () => {
        const id = await startRequest(page, 'personal_sign', [
          '0x70616c69',
          address,
        ]);
        const popup = await popupFor(wallet.context, page, id);
        const rejected = await dismissRejectedApproval({
          click: () =>
            popup
              .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
              .first()
              .click(),
          isClosed: () => popup.isClosed(),
          settle: () => settle(page, id, 5000),
        });
        expect(rejected.error?.code).toBe(4001);
        expect(rejected.result).toBeUndefined();
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
          const rejected = await dismissRejectedApproval({
            click: () =>
              popup.getByRole('button', { name: /(?:^|\s)ok$/i }).click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(page, id, 5000),
          });
          expect(typeof rejected.error?.code).toBe('number');
          expect(rejected.result).toBeUndefined();
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
        'malformed personal_sign bytes reject before approval in both orders',
        async () => {
          const message = `victim.example wants you to sign in with your Ethereum account:\n${address}\n\nSign in to the isolated Pali conformance fixture.\n\nURI: https://victim.example/\nVersion: 1\nChain ID: ${
            LOCAL_CHAINS[0].chainId
          }\nNonce: 32891757\nIssued At: ${new Date().toISOString()}`;
          const encoded = hexlify(toUtf8Bytes(message));
          const rejected = [];
          const openedPages: string[] = [];
          const observePage = (opened: Page) => openedPages.push(opened.url());
          wallet.context.on('page', observePage);
          try {
            for (const suffix of ['zz', 'a']) {
              for (const accountFirst of [false, true]) {
                const malformed = encoded + suffix;
                const result = await settle(
                  page,
                  await startRequest(
                    page,
                    'personal_sign',
                    accountFirst ? [address, malformed] : [malformed, address]
                  ),
                  2000
                );
                expect(result.error?.code).toBe(-32602);
                expect(result.durationMs).toBeLessThan(2000);
                expect(openedPages).toEqual([]);
                expect(
                  wallet.context
                    .pages()
                    .some((tab) => tab.url().includes('/external'))
                ).toBe(false);
                expect(result.result).toBeUndefined();
                rejected.push(result);
              }
            }
            return { rejected, openedPages };
          } finally {
            wallet.context.off('page', observePage);
          }
        }
      );
      await record(
        'invalid EIP-1559 fee choices reject before approval',
        async () => {
          const rejected = [];
          for (const { fee, code } of [
            {
              fee: { maxFeePerGas: '0x0', maxPriorityFeePerGas: '0x0' },
              code: 4200,
            },
            {
              fee: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' },
              code: -32602,
            },
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
            expect(result.error?.code).toBe(code);
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
        {
          fee: {
            type: '0x2',
            maxFeePerGas: '0xba43b7400',
            maxPriorityFeePerGas: '0x0',
          },
          chooseDappFee: true,
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
              await expect(
                popup.getByText('Below estimate', { exact: true })
              ).toBeVisible();
              await popup
                .getByRole('button', {
                  name: 'Use dapp fee anyway',
                  exact: true,
                })
                .click();
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
      await runOfficialDeploymentCases();
      // Cancellation and the injected quote error are genuine approval
      // attempts. Keep the next unrelated rejection outside the unchanged
      // production spam window, rather than weakening its threshold.
      await new Promise((resolve) => setTimeout(resolve, 10_100));
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
          const result = await dismissRejectedApproval({
            click: () =>
              popup
                .getByRole('button', { name: /(?:^|\s)(reject|cancel)$/i })
                .first()
                .click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(page, id, 5000),
          });
          expect(result.error?.code).toBe(4001);
          expect(result.result).toBeUndefined();
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
