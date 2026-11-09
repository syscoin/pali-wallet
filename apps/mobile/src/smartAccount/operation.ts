import { isSmartAccountPendingStateError } from '../../../../source/utils/smartAccount/pendingState.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';
import type { SmartAccountValidatorSwitch } from '../../../../source/utils/smartAccount/validatorSwitch.ts';
import {
  createSmartAccountCallsExecutions,
  type DappCall,
} from '../../../../source/shared/dappCalls.ts';
import { buildSmartAccountNftTransfer } from '../../../../source/utils/smartAccount/nftTransfer.ts';
import type { NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import type { SavedCollectible } from '../portfolio/tokenRegistry.ts';
import { buildSmartAccountErc20Transfer } from '../../../../source/utils/smartAccount/erc20Transfer.ts';
import type { Erc20Metadata } from '../../../../source/shared/erc20.ts';
import { getPaliEntryPointAddress } from '../../../../source/utils/smartAccount/contracts.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  buildGuardianPolicyExecutions,
  type GuardianPolicyCommand,
} from '../../../../source/utils/smartAccount/guardianPolicy.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import {
  SMART_ACCOUNT_EXECUTION_LIFETIME_MS,
  type prepareSmartAccountOperation,
} from '../../../../source/utils/smartAccount/prepareOperation.ts';
import { getSmartAccountUserOpRequiredPrefund } from '../../../../source/utils/smartAccount/account.ts';

export type NativeSmartAccountResolvedIntent =
  | Readonly<{ kind: 'deploy' }>
  | Readonly<{
      kind: 'authenticator';
      command: SmartAccountValidatorSwitch;
    }>
  | Readonly<{ kind: 'guardian-policy'; command: GuardianPolicyCommand }>
  | Readonly<{ kind: 'dapp-batch'; calls: readonly DappCall[] }>
  | Readonly<{
      kind: 'native-transfer';
      recipient: string;
      amountUnits: string;
    }>
  | Readonly<{
      kind: 'erc20-transfer';
      token: Erc20Metadata;
      recipient: string;
      amountUnits: string;
    }>
  | Readonly<{
      kind: 'dapp-call';
      recipient: string;
      amountUnits: string;
      data: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    }>
  | NftTransferIntent;

export type NativeSmartAccountAmount =
  | Readonly<{ kind: 'exact'; amount: string }>
  | Readonly<{ kind: 'maximum' }>
  | Readonly<{ kind: 'erc20'; contractAddress: string; amount: string }>
  | Readonly<{
      kind: 'nft';
      collectible: SavedCollectible;
      tokenId: string;
      amountUnits: string;
    }>;
export type NativeSmartAccountIntent =
  | NativeSmartAccountResolvedIntent
  | Readonly<{ kind: 'native-max'; recipient: string }>;

export type NativeGuardianPolicyDraft =
  | Readonly<{
      action: 'set';
      guardian: string;
      delaySeconds: number;
      acknowledgedPendingOperationId: string | null;
    }>
  | Readonly<{
      action: 'remove';
      recoveryLossAcknowledged: true;
      acknowledgedPendingOperationId: string | null;
    }>;

export type PreparedSmartAccountOperation = Awaited<
  ReturnType<typeof prepareSmartAccountOperation>
>;
export type SmartAccountOperationPreparation =
  | Readonly<{ kind: 'already-deployed' }>
  | Readonly<{ kind: 'already-configured' }>
  | Readonly<{
      kind: 'authorization';
      intent: NativeSmartAccountResolvedIntent;
      operation: PreparedSmartAccountOperation;
    }>;

export type SmartAccountPayerReview = Readonly<{
  id: number;
  transaction: PreparedEvmTransaction;
  maximumFeeUnits: string;
  coveredFeeUnits: string;
  maximumTotalUnits: string;
  purpose: 'fund-account' | 'submit-operation';
}>;
export type NativeSmartAccountOperationSnapshot = Readonly<{
  intent: NativeSmartAccountIntent;
  phase:
    | 'preparing'
    | 'authorize'
    | 'preparing-fee'
    | 'review-fee'
    | 'waiting'
    | 'complete'
    | 'failed';
  revision: number;
  account: string;
  network: NativeNetworkRegistration;
  maximumPrefundUnits: string | null;
  userOperationHash: string | null;
  authorization: Readonly<{
    entryPoint: string;
    nonce: string;
    initCode: string;
    callData: string;
  }> | null;
  payerReview: SmartAccountPayerReview | null;
  transactionHash: string | null;
  userOperationSubmissionStarted: boolean;
  metadataRefresh?: 'refreshing' | 'failed' | 'complete';
  error: string | null;
}>;
export type NativeSmartAccountOperationHost = Readonly<{
  account: string;
  intent: NativeSmartAccountIntent;
  network: NativeNetworkRegistration;
  assertCurrent(): void;
  refreshMetadata?(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<void>;
  prepare(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<SmartAccountOperationPreparation>;
  sign(
    prepared: PreparedSmartAccountOperation,
    assertCurrent: () => void
  ): Promise<string>;
  submit(
    prepared: PreparedSmartAccountOperation,
    signature: string,
    signal: AbortSignal,
    assertCurrent: () => void,
    reviewPayer: (
      review: Omit<SmartAccountPayerReview, 'id'>,
      authorize: () => void
    ) => Promise<void>,
    onBroadcast: (hash: string, purpose: SmartAccountPayerReview['purpose']) => void
  ): Promise<string>;
}>;

/** Presentation owns two explicit authorizations. The shared engine owns every transaction. */
export class NativeSmartAccountOperation {
  private snapshot: NativeSmartAccountOperationSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private revision = 0;
  private disposed = false;
  private readonly drain = new NativeOperationDrain();
  private prepared: PreparedSmartAccountOperation | null = null;
  private signingStarted = false;
  private preparing = false;
  private pendingPayer: {
    id: number;
    confirm(): void;
    reject(error: Error): void;
  } | null = null;
  private readonly deadline: number;
  private readonly expiry: ReturnType<typeof setTimeout>;

  private readonly host: NativeSmartAccountOperationHost;
  private readonly now: () => number;
  constructor(
    host: NativeSmartAccountOperationHost,
    now = () => performance.now()
  ) {
    this.host = host;
    if (
      (host.intent.kind === 'guardian-policy' ||
        host.intent.kind === 'authenticator') &&
      typeof host.refreshMetadata !== 'function'
    )
      throw new Error('Smart account metadata reconciliation is required');
    this.now = now;
    this.deadline = now() + SMART_ACCOUNT_EXECUTION_LIFETIME_MS;
    this.snapshot = Object.freeze({
      phase: 'preparing',
      revision: 0,
      account: host.account,
      intent: Object.freeze({ ...host.intent }),
      network: host.network,
      maximumPrefundUnits: null,
      userOperationHash: null,
      authorization: null,
      payerReview: null,
      transactionHash: null,
      userOperationSubmissionStarted: false,
      error: null,
    });
    this.expiry = setTimeout(
      () => this.cancel(),
      SMART_ACCOUNT_EXECUTION_LIFETIME_MS
    );
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private check = () => {
    if (
      this.disposed ||
      this.lifetime.signal.aborted ||
      this.now() >= this.deadline
    )
      throw new Error('SMART_OPERATION_EXPIRED');
    const result: unknown = this.host.assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error('SMART_OPERATION_EXPIRED');
    }
    if (this.disposed || this.lifetime.signal.aborted)
      throw new Error('SMART_OPERATION_EXPIRED');
  };
  private publish(change: Partial<NativeSmartAccountOperationSnapshot>) {
    if (this.disposed) return;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...change,
      revision: ++this.revision,
    });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Rendering cannot change an admitted operation. */
      }
    }
  }
  async prepare(): Promise<void> {
    if (
      this.disposed ||
      this.preparing ||
      this.prepared ||
      this.signingStarted ||
      this.snapshot.phase !== 'preparing'
    )
      return;
    this.preparing = true;
    const finish = this.drain.begin();
    try {
      this.check();
      let result;
      for (;;) {
        try {
          result = await this.host.prepare(this.lifetime.signal, this.check);
          break;
        } catch (error) {
          if (!isSmartAccountPendingStateError(error)) throw error;
          this.check();
          this.publish({
            error:
              'Waiting for the network to include the earlier pending operation.',
          });
          await new Promise<void>((resolve, reject) => {
            const stop = () => {
              clearTimeout(timer);
              reject(new Error('SMART_OPERATION_EXPIRED'));
            };
            const timer = setTimeout(() => {
              this.lifetime.signal.removeEventListener('abort', stop);
              resolve();
            }, 2000);
            this.lifetime.signal.addEventListener('abort', stop, {
              once: true,
            });
            if (this.lifetime.signal.aborted) stop();
          });
        }
      }
      this.check();
      if (result.kind === 'already-configured') {
        if (
          this.host.intent.kind !== 'authenticator' ||
          this.host.intent.command.executions.length !== 0
        )
          throw new Error('Invalid authenticator outcome');
        clearTimeout(this.expiry);
        this.publish({ phase: 'complete', metadataRefresh: 'complete' });
        return;
      }
      if (result.kind === 'already-deployed') {
        if (this.host.intent.kind !== 'deploy')
          throw new Error('Invalid operation outcome');
        clearTimeout(this.expiry);
        this.publish({ phase: 'complete' });
        return;
      }
      const prepared = result.operation;
      const intent = result.intent;
      if (
        intent.kind === 'guardian-policy' ||
        intent.kind === 'authenticator'
      ) {
        if (
          (this.host.intent.kind !== 'guardian-policy' &&
            this.host.intent.kind !== 'authenticator') ||
          this.host.intent.kind !== intent.kind ||
          this.host.intent.command !== intent.command
        )
          throw new Error('SMART_OPERATION_EXPIRED');
        const expected =
          intent.kind === 'guardian-policy'
            ? buildGuardianPolicyExecutions(intent.command)
            : intent.command.executions;
        if (
          expected.length !== prepared.executions.length ||
          expected.some((execution, index) => {
            const actual = prepared.executions[index];
            return (
              !actual ||
              actual.target.toLowerCase() !== execution.target.toLowerCase() ||
              actual.data !== execution.data ||
              BigInt(actual.value) !== BigInt(execution.value)
            );
          })
        )
          throw new Error('Guardian policy review changed');
      } else if (intent.kind === 'dapp-batch') {
        const requested = this.host.intent;
        if (requested.kind !== 'dapp-batch' || requested.calls !== intent.calls)
          throw new Error('SMART_OPERATION_EXPIRED');
        const expected = createSmartAccountCallsExecutions(intent.calls);
        if (
          prepared.executions.length !== expected.length ||
          expected.some((entry, index) => {
            const actual = prepared.executions[index];
            return (
              !actual ||
              actual.target.toLowerCase() !== entry.target.toLowerCase() ||
              actual.data !== entry.data ||
              BigInt(actual.value) !== BigInt(entry.value)
            );
          })
        )
          throw new Error('SMART_OPERATION_EXPIRED');
      } else if (intent.kind !== 'deploy') {
        const requested = this.host.intent;
        if (
          requested.kind === 'dapp-batch' ||
          requested.kind === 'guardian-policy' ||
          requested.kind === 'authenticator'
        )
          throw new Error('SMART_OPERATION_EXPIRED');
        const expected =
          intent.kind === 'nft-transfer'
            ? buildSmartAccountNftTransfer(intent)
            : intent.kind === 'erc20-transfer'
            ? buildSmartAccountErc20Transfer(
                intent.token.contractAddress,
                intent.recipient,
                intent.amountUnits
              )
            : {
                target: intent.recipient,
                value: intent.amountUnits,
                data: intent.kind === 'dapp-call' ? intent.data : '0x',
              };
        const execution = prepared.executions?.[0];
        if (
          requested.kind === 'deploy' ||
          requested.recipient !== intent.recipient ||
          (requested.kind === 'native-max' &&
            intent.kind !== 'native-transfer') ||
          (requested.kind !== 'native-max' &&
            (requested.kind !== intent.kind ||
              requested.amountUnits !== intent.amountUnits)) ||
          (requested.kind === 'dapp-call' &&
            intent.kind === 'dapp-call' &&
            (requested.data !== intent.data ||
              requested.maxFeePerGas !== intent.maxFeePerGas ||
              requested.maxPriorityFeePerGas !==
                intent.maxPriorityFeePerGas)) ||
          (requested.kind === 'erc20-transfer' &&
            intent.kind === 'erc20-transfer' &&
            requested.token !== intent.token) ||
          (requested.kind === 'nft-transfer' &&
            intent.kind === 'nft-transfer' &&
            (intent.from.toLowerCase() !== this.host.account.toLowerCase() ||
              intent.chainId !== this.host.network.chainId ||
              requested.from !== intent.from ||
              requested.chainId !== intent.chainId ||
              requested.contractAddress !== intent.contractAddress ||
              requested.tokenStandard !== intent.tokenStandard ||
              requested.tokenId !== intent.tokenId)) ||
          prepared.executions.length !== 1 ||
          execution?.target.toLowerCase() !== expected.target.toLowerCase() ||
          execution.data !== expected.data ||
          BigInt(execution.value) !== BigInt(expected.value)
        )
          throw new Error('Smart transfer review changed');
      } else if (this.host.intent.kind !== 'deploy')
        throw new Error('Smart transfer review changed');
      this.prepared = prepared;
      this.publish({
        phase: 'authorize',
        error: null,
        intent: Object.freeze({ ...result.intent }),
        maximumPrefundUnits: getSmartAccountUserOpRequiredPrefund(
          prepared.userOperation
        ).toString(),
        userOperationHash: prepared.actionHash,
        authorization: Object.freeze({
          entryPoint: getPaliEntryPointAddress(
            Number(this.host.network.chainId)
          ),
          nonce: prepared.userOperation.nonce,
          initCode: prepared.userOperation.initCode,
          callData: prepared.userOperation.callData,
        }),
      });
    } catch {
      this.fail();
    } finally {
      this.preparing = false;
      finish();
    }
  }
  async authorize(revision: number): Promise<void> {
    if (
      this.disposed ||
      this.snapshot.phase !== 'authorize' ||
      revision !== this.snapshot.revision ||
      this.signingStarted ||
      !this.prepared
    )
      return;
    this.signingStarted = true;
    const finish = this.drain.begin();
    const prepared = this.prepared;
    try {
      this.check();
      this.publish({ phase: 'preparing-fee' });
      const signature = await this.host.sign(prepared, this.check);
      this.check();
      const hash = await this.host.submit(
        prepared,
        signature,
        this.lifetime.signal,
        this.check,
        (review, authorize) => this.reviewPayer(review, authorize),
        (hash, purpose) => {
          const userOperationSubmissionStarted =
            this.snapshot.userOperationSubmissionStarted ||
            purpose === 'submit-operation';
          if (this.lifetime.signal.aborted) {
            this.publish({ transactionHash: hash, userOperationSubmissionStarted });
          } else {
            this.publish({
              transactionHash: hash,
              userOperationSubmissionStarted,
              phase: 'waiting',
              payerReview: null,
            });
          }
        }
      );
      this.check();
      clearTimeout(this.expiry);
      this.publish({
        transactionHash: hash,
        phase: 'complete',
        payerReview: null,
      });
      if (
        this.host.intent.kind === 'guardian-policy' ||
        this.host.intent.kind === 'authenticator'
      )
        await this.retryMetadata();
    } catch (error) {
      if (
        isSmartAccountPendingStateError(error) &&
        (error as { transactionNotBroadcast?: boolean })
          .transactionNotBroadcast !== false &&
        !this.snapshot.transactionHash &&
        !this.lifetime.signal.aborted
      ) {
        this.prepared = null;
        this.signingStarted = false;
        this.publish({
          phase: 'preparing',
          authorization: null,
          payerReview: null,
        });
        await this.prepare();
      } else this.fail();
    } finally {
      finish();
    }
  }
  async retryMetadata(): Promise<void> {
    if (
      this.disposed ||
      this.lifetime.signal.aborted ||
      this.snapshot.phase !== 'complete' ||
      (this.host.intent.kind !== 'guardian-policy' &&
        this.host.intent.kind !== 'authenticator') ||
      this.snapshot.metadataRefresh === 'refreshing' ||
      this.snapshot.metadataRefresh === 'complete'
    )
      return;
    const check = () => {
      if (this.disposed || this.lifetime.signal.aborted)
        throw new Error('SMART_OPERATION_EXPIRED');
      assertSynchronousEvmFeeGuard(this.host.assertCurrent);
    };
    const finish = this.drain.begin();
    this.publish({ metadataRefresh: 'refreshing' });
    try {
      check();
      await this.host.refreshMetadata!(this.lifetime.signal, check);
      check();
      this.publish({ metadataRefresh: 'complete' });
    } catch {
      if (!this.disposed) {
        try {
          assertSynchronousEvmFeeGuard(this.host.assertCurrent);
        } catch {
          /* The owner handles storage quarantine. */
        }
        this.publish({ metadataRefresh: 'failed' });
      }
    } finally {
      finish();
    }
  }
  private reviewPayer(
    review: Omit<SmartAccountPayerReview, 'id'>,
    authorize: () => void
  ): Promise<void> {
    this.check();
    if (this.pendingPayer)
      return Promise.reject(new Error('SMART_OPERATION_BUSY'));
    const id = this.revision + 1;
    return new Promise((resolve, reject) => {
      this.pendingPayer = {
        id,
        reject,
        confirm: () => {
          this.check();
          this.pendingPayer = null;
          try {
            authorize();
          } catch (error) {
            reject(error);
            throw error;
          }
          this.publish({ phase: 'waiting', payerReview: null });
          resolve();
        },
      };
      this.publish({
        phase: 'review-fee',
        payerReview: Object.freeze({ ...review, id }),
      });
    });
  }
  confirmPayer(id: number): void {
    if (this.snapshot.phase !== 'review-fee' || this.pendingPayer?.id !== id)
      return;
    try {
      this.pendingPayer.confirm();
    } catch {
      this.cancel();
    }
  }
  private fail() {
    if (this.disposed || this.snapshot.phase === 'complete') return;
    this.prepared = null;
    this.pendingPayer?.reject(new Error('SMART_OPERATION_EXPIRED'));
    this.pendingPayer = null;
    clearTimeout(this.expiry);
    this.lifetime.abort();
    this.publish({
      phase: 'failed',
      payerReview: null,
      error: this.signingStarted
        ? 'Authorization ended. Check the account and Activity before starting again.'
        : 'This operation could not be prepared. Return to your account and try again.',
    });
  }
  cancel(): void {
    this.fail();
  }
  dispose(): Promise<void> {
    return this.drain.close(() => {
      this.disposed = true;
      clearTimeout(this.expiry);
      this.lifetime.abort();
      this.prepared = null;
      this.pendingPayer?.reject(new Error('SMART_OPERATION_EXPIRED'));
      this.pendingPayer = null;
      this.listeners.clear();
    }, []);
  }
}
