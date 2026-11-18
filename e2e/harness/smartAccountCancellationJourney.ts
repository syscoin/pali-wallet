import {
  expect,
  chromium,
  type BrowserContext,
  type Request,
} from '@playwright/test';
import { HDNodeWallet, parseEther, Transaction } from 'ethers';

import en from '../../source/assets/locales/en.json';
import { getSmartAccountUserOpRequiredPrefund } from '../../source/utils/smartAccount/account';
import {
  paliEntryPointInterface,
  getPaliEntryPointAddress,
} from '../../source/utils/smartAccount/contracts';
import { getSmartAccountUserOpHash } from '../../source/utils/smartAccount/userOperationHash';

import { PaliWallet } from './pali';
import { localRpc, TEST_DAPP_MNEMONIC } from './testDappConformance';
import type { SmartAccountPackedUserOperation } from '../../source/utils/smartAccount/account';

type Delivery = {
  hash: string;
  maximumNetworkFee: bigint;
  operation: SmartAccountPackedUserOperation;
};
type Options = {
  account: string;
  chain: { chainId: number; url: string };
  currency: string;
  fenceUrl: string;
  installRoutes(context: BrowserContext): Promise<void>;
  mark(phase: string): void;
  payer: string;
  recipient: string;
  wallet: PaliWallet;
};

/** Opt-in, real built-wallet journey. Every signature and transaction stays on loopback. */
export async function runSmartAccountCancellationJourney(options: Options) {
  const { account, chain, currency, fenceUrl, installRoutes, mark, recipient } =
    options;
  let wallet = options.wallet;
  let page = wallet.page;
  const entryPoint = getPaliEntryPointAddress(chain.chainId);
  const deliveries: Delivery[] = [];
  let lastEstimated: SmartAccountPackedUserOperation | undefined;
  let signedEstimates = 0;
  const operation = (data: string): SmartAccountPackedUserOperation => {
    const [operations] = paliEntryPointInterface.decodeFunctionData(
      'handleOps',
      data
    );
    expect(operations).toHaveLength(1);
    const value = operations[0];
    return {
      sender: value.sender,
      nonce: value.nonce.toString(),
      initCode: value.initCode,
      callData: value.callData,
      accountGasLimits: value.accountGasLimits,
      preVerificationGas: value.preVerificationGas.toString(),
      gasFees: value.gasFees,
      paymasterAndData: value.paymasterAndData,
      signature: value.signature,
    };
  };
  const observe = (request: Request) => {
    if (
      request.url().replace(/\/$/, '') !== chain.url.replace(/\/$/, '') ||
      request.method() !== 'POST'
    )
      return;
    const payload = request.postDataJSON();
    for (const row of Array.isArray(payload) ? payload : [payload]) {
      if (
        row.method === 'eth_estimateGas' &&
        row.params?.[0]?.to?.toLowerCase() === entryPoint.toLowerCase()
      ) {
        try {
          const value = operation(row.params[0].data);
          if (
            value.sender.toLowerCase() === account.toLowerCase() &&
            value.signature !== '0x'
          ) {
            lastEstimated = value;
            signedEstimates++;
          }
        } catch {
          /* Other estimates are outside this feature. */
        }
      }
      if (row.method === 'eth_sendRawTransaction') {
        const tx = Transaction.from(row.params[0]);
        if (tx.to?.toLowerCase() !== entryPoint.toLowerCase()) continue;
        const value = operation(tx.data);
        if (value.sender.toLowerCase() === account.toLowerCase())
          deliveries.push({
            hash: tx.hash!,
            operation: value,
            maximumNetworkFee: tx.gasLimit * (tx.maxFeePerGas ?? tx.gasPrice!),
          });
      }
    }
  };
  wallet.context.on('request', observe);
  const rpc = (method: string, params: unknown[] = []) =>
    localRpc(chain.url, method, params);
  const canonicalNonce = async (value: SmartAccountPackedUserOperation) => {
    const encoded = await rpc('eth_call', [
      {
        to: entryPoint,
        data: paliEntryPointInterface.encodeFunctionData('getNonce', [
          account,
          BigInt(value.nonce) >> BigInt(64),
        ]),
      },
      'latest',
    ]);
    return BigInt(
      paliEntryPointInterface.decodeFunctionResult('getNonce', encoded)[0]
    );
  };
  const mined = async (hash: string, status = '0x1') => {
    let receipt: any;
    await expect
      .poll(
        async () => {
          receipt = await rpc('eth_getTransactionReceipt', [hash]);
          return receipt?.status;
        },
        { timeout: 15000 }
      )
      .toBe(status);
    return receipt;
  };
  const selectSmart = async () => {
    await wallet.gotoRoute('#/home');
    await wallet.ensureOnHome();
    await page.locator('#general-settings-button').click();
    await page.locator('[id^="account-SmartAccount"]').first().click();
    expect((await wallet.getActiveAccountAddress()).toLowerCase()).toBe(
      account.toLowerCase()
    );
  };
  async function beginSend(
    label: string
  ): Promise<Delivery & { before: number }>;
  async function beginSend(
    label: string,
    exceedPayerBudget: true
  ): Promise<{ before: number; operation: SmartAccountPackedUserOperation }>;
  async function beginSend(label: string, exceedPayerBudget = false) {
    mark(`cancellation:${label}`);
    await wallet.gotoRoute('#/home');
    await wallet.ensureOnHome();
    await page.locator('#send-btn').click();
    await page.getByPlaceholder('Receiver', { exact: true }).fill(recipient);
    await page.getByPlaceholder('Amount', { exact: true }).fill('0.001');
    await page.locator('#send-eth-next-btn').click();
    await expect(
      page.getByRole('button', { name: 'Confirm', exact: true })
    ).toBeEnabled();
    const payerCap = page
      .getByText(en.transactions.replay.maximumFee, { exact: true })
      .locator('..')
      .locator('dd');
    await expect(payerCap).toBeVisible();
    const maximumNetworkFee = parseEther(
      (await payerCap.innerText()).split(' ')[0]
    );
    const before = deliveries.length;
    const beforeEstimates = signedEstimates;
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    if (exceedPayerBudget) {
      await expect(
        page.getByText(en.send.smartAccountPayerFeeExceeded, { exact: true })
      ).toBeVisible();
      await expect(networkFeeReview()).toHaveCount(0);
      expect(deliveries).toHaveLength(before);
      expect(signedEstimates).toBeGreaterThan(beforeEstimates);
      expect(lastEstimated?.signature).not.toBe('0x');
      expect(await canonicalNonce(lastEstimated!)).toBe(
        BigInt(lastEstimated!.nonce)
      );
      mark('cancellation:retained-after-fee-refusal');
      return { before, operation: lastEstimated! };
    }
    await expect
      .poll(() => deliveries.length, { timeout: 30000 })
      .toBe(before + 1);
    await expect(page).toHaveURL(/#\/home$/, { timeout: 15000 });
    await expect(networkFeeReview()).toHaveCount(0);
    expect(deliveries.at(-1)!.maximumNetworkFee).toBeLessThanOrEqual(
      maximumNetworkFee
    );
    return { before, ...deliveries.at(-1)! };
  }
  const cancellationDialog = () =>
    page.getByRole('dialog', { name: en.header.cancelTx, exact: true });
  const networkFeeReview = () =>
    page.getByRole('heading', { name: 'Review network fee', exact: true });
  const signCancellation = (modal: ReturnType<typeof cancellationDialog>) =>
    modal.getByRole('button', {
      name: en.buttons.confirm,
      exact: true,
    });
  const reviewCancellation = async () => {
    const modal = cancellationDialog();
    await expect(modal).toBeVisible({ timeout: 30000 });
    await expect(signCancellation(modal)).toBeEnabled();
    const reviewedFee = async (label: string) => {
      const fee = modal
        .getByText(label, { exact: true })
        .locator('..')
        .locator('dd');
      await expect(fee).toBeVisible();
      await expect(fee).toHaveText(new RegExp(`^\\d+\\.\\d+ ${currency}$`));
      return parseEther((await fee.innerText()).trim().split(' ')[0]);
    };
    const entryPointFee = await reviewedFee(en.send.smartAccountMaxFee);
    const maximumNetworkFee = await reviewedFee(
      en.transactions.smartAccountCancelMaximumReplacementFee
    );
    await expect(networkFeeReview()).toHaveCount(0);
    return { modal, entryPointFee, maximumNetworkFee };
  };
  const approveCancellation = async () => {
    const before = deliveries.length;
    const { modal, entryPointFee, maximumNetworkFee } =
      await reviewCancellation();
    await signCancellation(modal).click();
    await expect
      .poll(() => deliveries.length, { timeout: 30000 })
      .toBe(before + 1);
    await expect(modal).toHaveCount(0);
    await expect(networkFeeReview()).toHaveCount(0);
    const submitted = deliveries.at(-1)!;
    expect(
      getSmartAccountUserOpRequiredPrefund(submitted.operation).toBigInt()
    ).toBe(entryPointFee);
    expect(submitted.maximumNetworkFee).toBeLessThanOrEqual(maximumNetworkFee);
    return submitted;
  };
  const openActivity = async () => {
    await wallet.gotoRoute('#/home');
    await wallet.ensureOnHome();
    await page.getByText('Activity', { exact: true }).click();
    const activity = page.locator('#activity-panel-list');
    await expect(activity).toBeVisible();
    return activity;
  };
  const cancelFromActivity = async (transactionHash: string) => {
    await page
      .locator(
        `#activity-panel-list [data-transaction-hash="${transactionHash}"] #transaction-options`
      )
      .getByRole('button')
      .click();
    await page
      .getByRole('menuitem')
      .filter({ hasText: /^Cancel$/ })
      .click();
  };
  const originalReplayFails = async (
    value: SmartAccountPackedUserOperation
  ) => {
    const relayer = HDNodeWallet.fromPhrase(
      TEST_DAPP_MNEMONIC,
      undefined,
      "m/44'/60'/0'/0/2"
    );
    const data = paliEntryPointInterface.encodeFunctionData('handleOps', [
      [value],
      relayer.address,
    ]);
    await expect(
      rpc('eth_call', [
        { from: relayer.address, to: entryPoint, data, gas: '0x7a1200' },
        'latest',
      ])
    ).rejects.toThrow(/AA25|invalid account nonce/i);
    const nonce = Number(
      BigInt(await rpc('eth_getTransactionCount', [relayer.address, 'latest']))
    );
    const raw = await relayer.signTransaction({
      chainId: chain.chainId,
      type: 2,
      nonce,
      to: entryPoint,
      data,
      gasLimit: BigInt(8000000),
      maxFeePerGas: BigInt(20000000000),
      maxPriorityFeePerGas: BigInt(1000000000),
      value: 0,
    });
    const hash = await rpc('eth_sendRawTransaction', [raw]);
    await rpc('evm_mine');
    await mined(hash, '0x0');
    return hash as string;
  };
  const evidence: Record<string, unknown> = {};
  try {
    await selectSmart();
    await rpc('evm_setAutomine', [false]);
    await wallet.step(
      'Smart cancellation replaces the inner nonce and blocks another gas payer',
      async () => {
        const beforeBalance = await rpc('eth_getBalance', [
          recipient,
          'latest',
        ]);
        const original = await beginSend('pending-original');
        const saved = await openActivity();
        const originalRow = saved.locator(
          `[data-transaction-hash="${original.hash}"]`
        );
        await expect(originalRow).toHaveCount(1);
        await expect(
          saved.getByText(en.transactions.smartAuthorizations.signedOperation)
        ).toHaveCount(0);
        const before = deliveries.length;
        const beforeEstimates = signedEstimates;
        await cancelFromActivity(original.hash);
        const { modal } = await reviewCancellation();
        await modal
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
        await expect(modal).toHaveCount(0);
        expect(deliveries).toHaveLength(before);
        expect(signedEstimates).toBe(beforeEstimates);
        expect(await canonicalNonce(original.operation)).toBe(
          BigInt(original.operation.nonce)
        );
        await cancelFromActivity(original.hash);
        const cancelled = await approveCancellation();
        expect(cancelled.operation.nonce).toBe(original.operation.nonce);
        const cancellationOperationHash = getSmartAccountUserOpHash(
          cancelled.operation,
          chain.chainId
        ).toLowerCase();
        await rpc('evm_mine');
        const receipt = await mined(cancelled.hash);
        expect(await canonicalNonce(original.operation)).toBe(
          BigInt(original.operation.nonce) + BigInt(1)
        );
        expect(
          await rpc('eth_getTransactionReceipt', [original.hash])
        ).toBeNull();
        const events = receipt.logs.map((log: any) => {
          try {
            return paliEntryPointInterface.parseLog(log);
          } catch {
            return null;
          }
        });
        expect(
          events.some(
            (event: any) =>
              event?.name === 'UserOperationEvent' &&
              event.args.success &&
              event.args.userOpHash.toLowerCase() === cancellationOperationHash
          )
        ).toBe(true);
        const activity = await openActivity();
        await expect(
          activity.locator(`[data-transaction-hash="${cancelled.hash}"]`)
        ).toHaveCount(1);
        await expect(
          activity.getByText(
            en.transactions.smartAuthorizations.signedOperation
          )
        ).toHaveCount(0);
        const replayHash = await originalReplayFails(original.operation);
        expect(await rpc('eth_getBalance', [recipient, 'latest'])).toBe(
          beforeBalance
        );
        evidence.cancelled = {
          originalHash: original.hash,
          cancellationHash: cancelled.hash,
          replayHash,
          operationNonce: original.operation.nonce,
        };
      }
    );
    await wallet.step(
      'An original that wins is observed as executed and never called cancelled',
      async () => {
        const beforeBalance = BigInt(
          await rpc('eth_getBalance', [recipient, 'latest'])
        );
        const original = await beginSend('original-wins');
        const hash = getSmartAccountUserOpHash(
          original.operation,
          chain.chainId
        ).toLowerCase();
        await openActivity();
        await cancelFromActivity(original.hash);
        const { modal } = await reviewCancellation();
        await rpc('evm_mine');
        await mined(original.hash);
        expect(await canonicalNonce(original.operation)).toBe(
          BigInt(original.operation.nonce) + BigInt(1)
        );
        expect(
          BigInt(await rpc('eth_getBalance', [recipient, 'latest'])) -
            beforeBalance
        ).toBe(BigInt(1000000000000000));
        const before = deliveries.length;
        // Receipt refresh may retire the stale row's review before its button
        // is clicked. Either retirement or fresh admission must refuse it.
        if (await modal.isVisible()) {
          try {
            await signCancellation(modal).click({ timeout: 3000 });
          } catch (error) {
            if (await modal.isVisible()) throw error;
          }
        }
        await expect(modal).toHaveCount(0);
        await expect(networkFeeReview()).toHaveCount(0);
        await expect(
          page.getByText(en.transactions.transactionCancelSubmitted, {
            exact: true,
          })
        ).toHaveCount(0);
        expect(deliveries).toHaveLength(before);
        const activity = await openActivity();
        await expect(
          activity.locator(`[data-transaction-hash="${original.hash}"]`)
        ).toHaveCount(1);
        evidence.originalWon = { hash: original.hash, operationHash: hash };
      }
    );
    let abandoned!: SmartAccountPackedUserOperation;
    await wallet.step(
      'An over-budget payer quote retains only the signed operation',
      async () => {
        const result = await beginSend('payer-budget-refused', true);
        abandoned = result.operation;
        const shown = await openActivity();
        await expect(
          shown.getByText(en.transactions.smartAuthorizations.signedOperation)
        ).toHaveCount(1);
        await expect(
          shown.getByText(
            en.transactions.smartAuthorizations.noTransactionRecorded
          )
        ).toHaveCount(1);
        expect(await page.locator('body').innerText()).not.toContain(
          abandoned.signature
        );
      }
    );
    const profile = wallet.profileDir;
    await wallet.dispose('passed');
    const launch = chromium.launchPersistentContext;
    chromium.launchPersistentContext = (directory, settings) =>
      launch.call(chromium, directory, {
        ...settings,
        ignoreHTTPSErrors: true,
        args: [...(settings?.args ?? []), '--ignore-certificate-errors'],
      });
    try {
      wallet = await PaliWallet.launch('smart-account-cancellation-restart', {
        offlineHttpProxy: fenceUrl,
        recordVideo: false,
        resumeProfileDir: profile,
        viewport: { width: 400, height: 620 },
      });
    } finally {
      chromium.launchPersistentContext = launch;
    }
    await installRoutes(wallet.context);
    wallet.context.on('request', observe);
    page = wallet.page;
    await wallet.ensureOnHome();
    expect((await wallet.getActiveAccountAddress()).toLowerCase()).toBe(
      account.toLowerCase()
    );
    await wallet.step(
      'The signed operation remains visible after cold restart',
      async () => {
        const shown = await openActivity();
        await expect(
          shown.getByText(en.transactions.smartAuthorizations.signedOperation)
        ).toHaveCount(1);
        await expect(
          shown.getByText(
            en.transactions.smartAuthorizations.noTransactionRecorded
          )
        ).toHaveCount(1);
        expect(await page.locator('body').innerText()).not.toContain(
          abandoned.signature
        );
        expect(deliveries.length).toBeGreaterThan(0);
        expect(await canonicalNonce(abandoned)).toBe(BigInt(abandoned.nonce));
      }
    );
    return { wallet, evidence };
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  } finally {
    await rpc('evm_setAutomine', [true]);
  }
}
