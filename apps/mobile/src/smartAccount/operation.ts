import { getPaliEntryPointAddress } from '../../../../source/utils/smartAccount/contracts.ts';
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
      kind: 'native-transfer';
      recipient: string;
      amountUnits: string;
    }>;

export type NativeSmartAccountAmount =
  | Readonly<{ kind: 'exact'; amount: string }>
  | Readonly<{ kind: 'maximum' }>;
export type NativeSmartAccountIntent =
  | NativeSmartAccountResolvedIntent
  | Readonly<{ kind: 'native-max'; recipient: string }>;

export type PreparedSmartAccountOperation = Awaited<
  ReturnType<typeof prepareSmartAccountOperation>
>;
export type SmartAccountOperationPreparation =
  | Readonly<{ kind: 'already-deployed' }>
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
  error: string | null;
}>;
export type NativeSmartAccountOperationHost = Readonly<{
  account: string;
  intent: NativeSmartAccountIntent;
  network: NativeNetworkRegistration;
  assertCurrent(): void;
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
    onBroadcast: (hash: string) => void
  ): Promise<string>;
}>;

/** Presentation owns two explicit authorizations. The shared engine owns every transaction. */
export class NativeSmartAccountOperation {
  private snapshot: NativeSmartAccountOperationSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private revision = 0;
  private disposed = false;
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
      this.preparing ||
      this.prepared ||
      this.signingStarted ||
      this.snapshot.phase !== 'preparing'
    )
      return;
    this.preparing = true;
    try {
      this.check();
      const result = await this.host.prepare(this.lifetime.signal, this.check);
      this.check();
      if (result.kind === 'already-deployed') {
        if (this.host.intent.kind !== 'deploy')
          throw new Error('Invalid operation outcome');
        clearTimeout(this.expiry);
        this.publish({ phase: 'complete' });
        return;
      }
      const prepared = result.operation;
      const intent = result.intent;
      if (intent.kind === 'native-transfer') {
        const requested = this.host.intent;
        const execution = prepared.executions?.[0];
        if (
          requested.kind === 'deploy' ||
          requested.recipient !== intent.recipient ||
          (requested.kind === 'native-transfer' &&
            requested.amountUnits !== intent.amountUnits) ||
          prepared.executions.length !== 1 ||
          execution?.target.toLowerCase() !== intent.recipient.toLowerCase() ||
          execution.data !== '0x' ||
          BigInt(execution.value) !== BigInt(intent.amountUnits)
        )
          throw new Error('Smart transfer review changed');
      } else if (this.host.intent.kind !== 'deploy')
        throw new Error('Smart transfer review changed');
      this.prepared = prepared;
      this.publish({
        phase: 'authorize',
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
    }
  }
  async authorize(revision: number): Promise<void> {
    if (
      this.snapshot.phase !== 'authorize' ||
      revision !== this.snapshot.revision ||
      this.signingStarted ||
      !this.prepared
    )
      return;
    this.signingStarted = true;
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
        (hash) => {
          if (this.lifetime.signal.aborted) {
            this.publish({ transactionHash: hash });
          } else {
            this.publish({
              transactionHash: hash,
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
    } catch {
      this.fail();
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
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.expiry);
    this.lifetime.abort();
    this.prepared = null;
    this.pendingPayer?.reject(new Error('SMART_OPERATION_EXPIRED'));
    this.pendingPayer = null;
    this.listeners.clear();
  }
}
