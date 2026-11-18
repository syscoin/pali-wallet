import {
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';
import { HDNodeWallet, Transaction } from 'ethers';

import en from '../../source/assets/locales/en.json';
import {
  paliEntryPointInterface,
  getPaliEntryPointAddress,
} from '../../source/utils/smartAccount/contracts';
import { getSmartAccountUserOpHash } from '../../source/utils/smartAccount/userOperationHash';

import { PaliWallet } from './pali';
import {
  approveSmartAccountFeeReview,
  localRpc,
  TEST_DAPP_MNEMONIC,
} from './testDappConformance';
import type { SmartAccountPackedUserOperation } from '../../source/utils/smartAccount/account';

type Delivery = { hash: string; operation: SmartAccountPackedUserOperation };
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
  const {
    account,
    chain,
    currency,
    fenceUrl,
    installRoutes,
    mark,
    payer,
    recipient,
  } = options;
  let wallet = options.wallet;
  let page = wallet.page;
  const entryPoint = getPaliEntryPointAddress(chain.chainId);
  const deliveries: Delivery[] = [];
  let lastEstimated: SmartAccountPackedUserOperation | undefined;
  let logRequests = 0;
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
      if (row.method === 'eth_getLogs') logRequests++;
      if (
        row.method === 'eth_estimateGas' &&
        row.params?.[0]?.to?.toLowerCase() === entryPoint.toLowerCase()
      ) {
        try {
          const value = operation(row.params[0].data);
          if (
            value.sender.toLowerCase() === account.toLowerCase() &&
            value.signature !== '0x'
          )
            lastEstimated = value;
        } catch {
          /* Other estimates are outside this feature. */
        }
      }
      if (row.method === 'eth_sendRawTransaction') {
        const tx = Transaction.from(row.params[0]);
        if (tx.to?.toLowerCase() !== entryPoint.toLowerCase()) continue;
        const value = operation(tx.data);
        if (value.sender.toLowerCase() === account.toLowerCase())
          deliveries.push({ hash: tx.hash!, operation: value });
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
    declinePayer: true
  ): Promise<{ before: number; operation: SmartAccountPackedUserOperation }>;
  async function beginSend(label: string, declinePayer = false) {
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
    const before = deliveries.length;
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    // Wallet Send's Confirm screen already approves the displayed EntryPoint
    // ceiling. Its next owned dialog is the actual outer-payer fee review.
    if (declinePayer) {
      await expect(
        page.getByRole('heading', { name: 'Review network fee', exact: true })
      ).toBeVisible();
      const dialog = page.getByRole('dialog').filter({
        has: page.getByRole('heading', {
          name: 'Review network fee',
          exact: true,
        }),
      });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Review network fee', exact: true })
      ).toHaveCount(0);
      expect(deliveries).toHaveLength(before);
      expect(lastEstimated?.signature).not.toBe('0x');
      expect(await canonicalNonce(lastEstimated!)).toBe(
        BigInt(lastEstimated!.nonce)
      );
      return { before, operation: lastEstimated! };
    }
    await approveSmartAccountFeeReview(page, {
      kind: 'payer',
      account,
      payer,
      chainId: chain.chainId,
      symbol: currency,
    });
    await expect
      .poll(() => deliveries.length, { timeout: 30000 })
      .toBe(before + 1);
    await expect(page).toHaveURL(/#\/home$/, { timeout: 15000 });
    return { before, ...deliveries.at(-1)! };
  }
  const prepareCancel = async () => {
    await wallet.gotoRoute('#/home');
    await wallet.ensureOnHome();
    await page.getByText('Activity', { exact: true }).click();
    await page
      .locator('#transaction-options')
      .first()
      .getByRole('button')
      .click();
    await page
      .getByRole('menuitem')
      .filter({ hasText: /^Cancel$/ })
      .click();
    const modal = page
      .getByRole('dialog')
      .filter({ hasText: en.transactions.smartAccountCancelDescription });
    await expect(modal).toBeVisible({ timeout: 30000 });
    return modal;
  };
  const approveCancellation = async (modal: ReturnType<Page['getByRole']>) => {
    const before = deliveries.length;
    await modal.getByRole('button', { name: 'Confirm', exact: true }).click();
    await approveSmartAccountFeeReview(page, {
      kind: 'entry-point',
      account,
      payer: account,
      chainId: chain.chainId,
      symbol: currency,
    });
    await approveSmartAccountFeeReview(page, {
      kind: 'payer',
      account,
      payer,
      chainId: chain.chainId,
      symbol: currency,
    });
    await expect
      .poll(() => deliveries.length, { timeout: 30000 })
      .toBe(before + 1);
    return deliveries.at(-1)!;
  };
  const instructions = async (surface: 'activity' | 'hub') => {
    if (surface === 'hub') await wallet.gotoRoute('#/home/smart-account');
    else {
      await wallet.gotoRoute('#/home');
      await wallet.ensureOnHome();
      await page.getByText('Activity', { exact: true }).click();
    }
    const disclosure = page.locator('details').filter({
      has: page
        .locator('summary')
        .filter({ hasText: en.transactions.smartAuthorizations.title }),
    });
    await expect(disclosure).toHaveCount(1);
    const before = logRequests;
    await disclosure.locator('summary').click();
    await expect(
      disclosure
        .getByRole('button', {
          name: en.transactions.smartAuthorizations.checkStatus,
        })
        .first()
    ).toBeVisible();
    expect(logRequests).toBe(before);
    return disclosure;
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
        const saved = await instructions('activity');
        const originalRow = saved.locator('li').filter({
          hasText: getSmartAccountUserOpHash(
            original.operation,
            chain.chainId
          ).toLowerCase(),
        });
        await originalRow
          .getByRole('button', {
            name: en.transactions.smartAuthorizations.cancelInstruction,
          })
          .click();
        const cancelled = await approveCancellation(
          page.getByRole('dialog').filter({
            hasText: en.transactions.smartAccountCancelDescription,
          })
        );
        expect(cancelled.operation.nonce).toBe(original.operation.nonce);
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
              event.args.userOpHash.toLowerCase() ===
                getSmartAccountUserOpHash(
                  cancelled.operation,
                  chain.chainId
                ).toLowerCase()
          )
        ).toBe(true);
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
        const modal = await prepareCancel();
        await modal
          .getByRole('button', { name: 'Confirm', exact: true })
          .click();
        const feeHeading = page.getByRole('heading', {
          name: 'Review network fee',
          exact: true,
        });
        await expect(feeHeading).toBeVisible();
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
        if (await feeHeading.isVisible()) {
          try {
            await approveSmartAccountFeeReview(page, {
              kind: 'entry-point',
              account,
              payer: account,
              chainId: chain.chainId,
              symbol: currency,
            });
          } catch (error) {
            if (await feeHeading.isVisible()) throw error;
          }
        }
        await expect(feeHeading).toHaveCount(0);
        await expect(
          page.getByText(en.transactions.transactionCancelSubmitted, {
            exact: true,
          })
        ).toHaveCount(0);
        expect(deliveries).toHaveLength(before);
        const shown = await instructions('hub');
        const hash = getSmartAccountUserOpHash(
          original.operation,
          chain.chainId
        ).toLowerCase();
        const row = shown.locator('li').filter({ hasText: hash });
        await row
          .getByRole('button', {
            name: en.transactions.smartAuthorizations.checkStatus,
          })
          .click();
        await expect(
          row.getByText(en.transactions.smartAuthorizations.observedSuccess, {
            exact: true,
          })
        ).toBeVisible();
        evidence.originalWon = { hash: original.hash, operationHash: hash };
      }
    );
    let abandoned!: SmartAccountPackedUserOperation;
    await wallet.step(
      'Declining payer consent retains an instruction without an outer transaction',
      async () => {
        const result = await beginSend('declined-payer', true);
        abandoned = result.operation;
        const shown = await instructions('activity');
        await expect(
          shown.getByText(getSmartAccountUserOpHash(abandoned, chain.chainId), {
            exact: true,
          })
        ).toBeVisible();
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
      'A retained instruction survives cold restart and can be cancelled',
      async () => {
        const shown = await instructions('activity');
        const hash = getSmartAccountUserOpHash(
          abandoned,
          chain.chainId
        ).toLowerCase();
        const row = shown.locator('li').filter({ hasText: hash });
        await expect(row).toBeVisible();
        expect(await page.locator('body').innerText()).not.toContain(
          abandoned.signature
        );
        await row
          .getByRole('button', {
            name: en.transactions.smartAuthorizations.checkStatus,
          })
          .click();
        await expect(
          row.getByText(en.transactions.smartAuthorizations.mayExecute, {
            exact: true,
          })
        ).toBeVisible();
        await row
          .getByRole('button', {
            name: en.transactions.smartAuthorizations.cancelInstruction,
          })
          .click();
        const modal = page
          .getByRole('dialog')
          .filter({ hasText: en.transactions.smartAccountCancelDescription });
        const cancelled = await approveCancellation(modal);
        expect(cancelled.operation.nonce).toBe(abandoned.nonce);
        await rpc('evm_mine');
        await mined(cancelled.hash);
        expect(await canonicalNonce(abandoned)).toBe(
          BigInt(abandoned.nonce) + BigInt(1)
        );
        evidence.restarted = {
          operationHash: hash,
          cancellationHash: cancelled.hash,
          replayHash: await originalReplayFails(abandoned),
          operationNonce: abandoned.nonce,
        };
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
