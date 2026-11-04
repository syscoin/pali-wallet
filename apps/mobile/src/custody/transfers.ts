import { Transaction } from 'ethers/transaction';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { parseDecimalAmount } from '../core/amounts.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import type { CustodySnapshot } from './types.ts';
import { NativeTransferJournal } from './transferJournal.ts';
import type { TransferJournalEntry } from './transferJournal.ts';
import { NativeTransferRpc, NativeTransferRpcError } from './transferRpc.ts';

export type NativeTransferReview = Readonly<{
  id: string;
  from: string;
  recipient: string;
  amountUnits: string;
  maximumFeeUnits: string;
  totalUnits: string;
  gasLimit: string;
  maximumFeePerGas: string;
  priorityFeePerGas: string | null;
  nonce: string;
  retry: boolean;
}>;
export type NativeTransferSnapshot = Readonly<{
  phase:
    | 'idle'
    | 'preparing'
    | 'review'
    | 'signing'
    | 'submitting'
    | 'pending'
    | 'unknown'
    | 'confirmed'
    | 'reverted'
    | 'nonce-consumed'
    | 'unavailable';
  review: NativeTransferReview | null;
  hash: string | null;
  message: string | null;
}>;
export interface NativeTransferRuntime {
  journal(assertCurrent: () => void): Promise<NativeTransferJournal>;
  sign(
    transaction: PreparedEvmTransaction,
    password: string,
    assertCurrent: () => void
  ): Promise<Readonly<{ rawTransaction: string; hash: string }>>;
  authorize(password: string, assertCurrent: () => void): Promise<void>;
}
type Source = {
  getSnapshot(): CustodySnapshot;
  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void;
  lock(): void;
};
export class NativeTransferError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'BUSY'
    | 'NOT_READY'
    | 'INVALID_INPUT'
    | 'EXPIRED'
    | 'PENDING_TRANSFER'
    | 'FAILED'
    | 'INSUFFICIENT_BALANCE';
  constructor(code: NativeTransferError['code']) {
    super(code);
    this.name = 'NativeTransferError';
    this.code = code;
  }
}
export type NativeTransferView = Readonly<
  Pick<
    NativeTransfers,
    'getSnapshot' | 'subscribe' | 'cancel' | 'prepare' | 'confirm' | 'recover'
  >
>;

type PrivateReview = {
  public: NativeTransferReview;
  transaction: PreparedEvmTransaction;
  expires: number;
  existing: TransferJournalEntry | null;
};
const isTerminal = (
  phase: string
): phase is 'confirmed' | 'reverted' | 'nonce-consumed' =>
  ['confirmed', 'reverted', 'nonce-consumed'].includes(phase);
const initial = (): NativeTransferSnapshot =>
  Object.freeze({ phase: 'idle', review: null, hash: null, message: null });

/** Owns consent and submission; screens receive only public projections. */
export class NativeTransfers {
  readonly view: NativeTransferView = Object.freeze({
    getSnapshot: () => this.getSnapshot(),
    subscribe: (listener: (snapshot: NativeTransferSnapshot) => void) =>
      this.subscribe(listener),
    cancel: () => this.cancel(),
    prepare: (recipient: string, amount: string) =>
      this.prepare(recipient, amount),
    confirm: (id: string, password: string) => this.confirm(id, password),
    recover: (offerRetry?: boolean) => this.recover(offerRetry),
  });
  private snapshot: NativeTransferSnapshot = initial();
  private listeners = new Set<(snapshot: NativeTransferSnapshot) => void>();
  private review: PrivateReview | null = null;
  private active = false;
  private activeWork: Promise<void> | null = null;
  private queuedRecovery: {
    generation: number;
    retry: boolean;
    promise: Promise<void>;
  } | null = null;
  private generation = 0;
  private disposed = false;
  private secretOperation: object | null = null;
  private controller: AbortController | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private sourceIdentity: string;
  private readonly unsubscribe: () => void;
  private readonly source: Source;
  private readonly runtime: () => NativeTransferRuntime | undefined;
  private readonly rpc: NativeTransferRpc;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly now: () => number;
  constructor(
    source: Source,
    runtime: () => NativeTransferRuntime | undefined,
    options: {
      rpc?: NativeTransferRpc;
      randomBytes?: (length: number) => Uint8Array;
      now?: () => number;
    } = {}
  ) {
    this.source = source;
    this.runtime = runtime;
    this.rpc = options.rpc ?? new NativeTransferRpc();
    this.randomBytes =
      options.randomBytes ??
      ((length) => globalThis.crypto.getRandomValues(new Uint8Array(length)));
    this.now = options.now ?? (() => performance.now());
    const identity = (state: CustodySnapshot) =>
      `${state.phase}:${state.revision}:${state.account?.address ?? ''}`;
    this.sourceIdentity = identity(source.getSnapshot());
    this.unsubscribe = source.subscribe((state) => {
      const next = identity(state);
      if (next !== this.sourceIdentity) {
        this.sourceIdentity = next;
        this.cancel();
      }
    });
  }
  getSnapshot(): NativeTransferSnapshot {
    return this.snapshot;
  }
  subscribe(listener: (snapshot: NativeTransferSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<NativeTransferSnapshot>) {
    if (this.disposed) return;
    const next = Object.freeze({ ...this.snapshot, ...update });
    this.snapshot = next;
    for (const listener of [...this.listeners]) {
      if (this.snapshot !== next) break;
      try {
        listener(next);
      } catch {
        /* Observers cannot alter transfer outcomes. */
      }
    }
  }
  cancel(): void {
    if (this.disposed) return;
    this.generation++;
    this.revokeSecretOperation();
    this.controller?.abort();
    this.review = null;
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.publish(initial());
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.revokeSecretOperation();
    this.controller?.abort();
    this.review = null;
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.snapshot = initial();
    const listeners = [...this.listeners];
    this.listeners.clear();
    this.unsubscribe();
    for (const listener of listeners) {
      try {
        listener(this.snapshot);
      } catch {
        /* Terminal observers cannot reenter disposal. */
      }
    }
  }
  private revokeSecretOperation(): void {
    const operation = this.secretOperation;
    // Lock publishes custody changes synchronously and can reenter cancel.
    this.secretOperation = null;
    if (operation) this.source.lock();
  }
  private async runSecretOperation<T>(work: () => Promise<T>): Promise<T> {
    const operation = {};
    this.secretOperation = operation;
    try {
      return await work();
    } catch (error) {
      // Runtime failures retire the SDK session. Revoke custody before releasing
      // the marker, even if cancel runs before the outer transfer catch.
      if (this.secretOperation === operation) this.revokeSecretOperation();
      throw error;
    } finally {
      // A cancelled operation cannot clear a later operation's marker.
      if (this.secretOperation === operation) this.secretOperation = null;
    }
  }
  private perform(
    work: (context: {
      assertCurrent: () => void;
      runtime: NativeTransferRuntime;
      signal: AbortSignal;
      address: string;
    }) => Promise<void>
  ): Promise<void> {
    if (this.disposed)
      return Promise.reject(new NativeTransferError('CANCELLED'));
    if (this.active) return Promise.reject(new NativeTransferError('BUSY'));
    const captured = this.source.getSnapshot();
    const runtime = this.runtime();
    if (captured.phase !== 'ready' || !captured.account || captured.account.network !== 'ethereum' || !runtime)
      return Promise.reject(new NativeTransferError('NOT_READY'));
    const address = normalizePublicAddress(
      captured.account.address,
      'ethereum'
    );
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.active = true;
    const assertCurrent = () => {
      const current = this.source.getSnapshot();
      if (
        this.disposed ||
        generation !== this.generation ||
        controller.signal.aborted ||
        current.phase !== 'ready' ||
        current.revision !== captured.revision ||
        current.account?.address !== captured.account?.address ||
        this.runtime() !== runtime
      )
        throw new NativeTransferError('CANCELLED');
    };
    const pending = Promise.resolve()
      .then(async () => {
        assertCurrent();
        await work({
          assertCurrent,
          runtime,
          signal: controller.signal,
          address,
        });
      })
      .catch((error: unknown) => {
        try {
          assertCurrent();
        } catch {
          throw new NativeTransferError('CANCELLED');
        }
        if (
          error instanceof NativeTransferRpcError &&
          error.code === 'INSUFFICIENT_BALANCE'
        ) {
          this.publish({
            phase: 'idle',
            review: null,
            hash: null,
            message: 'Not enough ETH for the amount and maximum network fee.',
          });
          throw new NativeTransferError('INSUFFICIENT_BALANCE');
        }
        if (error instanceof NativeTransferError) {
          if (error.code === 'EXPIRED')
            this.publish({
              phase: this.snapshot.hash ? 'unknown' : 'idle',
              review: null,
              message: this.snapshot.hash
                ? 'A signed transaction was saved before the review expired. Check it before sending again.'
                : 'The review expired or network conditions changed. Review the transfer again.',
            });
          throw error;
        }
        if (!(error instanceof NativeTransferRpcError)) this.source.lock();
        this.publish({
          phase: 'unavailable',
          review: null,
          message:
            'The transfer could not be completed. Your pending transaction has been preserved.',
        });
        throw new NativeTransferError('FAILED');
      })
      .finally(() => {
        if (this.activeWork === pending) {
          this.active = false;
          this.activeWork = null;
        }
        if (this.controller === controller) this.controller = null;
        controller.abort();
      });
    this.activeWork = pending;
    return pending;
  }
  private showReview(
    transaction: PreparedEvmTransaction,
    existing: TransferJournalEntry | null
  ) {
    const entropy = this.randomBytes(16);
    if (!(entropy instanceof Uint8Array) || entropy.length !== 16)
      throw new NativeTransferError('FAILED');
    const id = Array.from(entropy, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    entropy.fill(0);
    const fee =
      transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas;
    const maximumFeeUnits = (
      BigInt(transaction.gasLimit) * BigInt(fee)
    ).toString();
    const publicReview: NativeTransferReview = Object.freeze({
      id,
      from: transaction.from,
      recipient: transaction.to,
      amountUnits: transaction.value,
      maximumFeeUnits,
      totalUnits: (
        BigInt(transaction.value) + BigInt(maximumFeeUnits)
      ).toString(),
      gasLimit: transaction.gasLimit,
      maximumFeePerGas: fee,
      priorityFeePerGas:
        transaction.type === 2 ? transaction.maxPriorityFeePerGas : null,
      nonce: transaction.nonce,
      retry: existing !== null,
    });
    this.review = {
      public: publicReview,
      transaction,
      existing,
      expires: this.now() + 90000,
    };
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => {
      if (this.review?.public.id === id && !this.active) this.cancel();
    }, 90000);
    this.publish({
      phase: 'review',
      review: publicReview,
      hash: existing?.hash ?? null,
      message: existing
        ? 'This resends the exact same signed transaction. It does not create a second transfer.'
        : null,
    });
  }
  prepare(recipient: string, amount: string): Promise<void> {
    let units: string;
    let to: string;
    try {
      units = parseDecimalAmount(amount, 18).toString();
      to = normalizePublicAddress(recipient, 'ethereum');
    } catch {
      return Promise.reject(new NativeTransferError('INVALID_INPUT'));
    }
    return this.perform(async ({ assertCurrent, runtime, signal, address }) => {
      this.review = null;
      this.publish({
        phase: 'preparing',
        review: null,
        hash: null,
        message: null,
      });
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const old = await journal.load();
      assertCurrent();
      if (old && !isTerminal(old.phase)) {
        this.publish({
          phase: 'unknown',
          review: null,
          hash: old.hash,
          message: 'Check your pending transfer before starting another.',
        });
        throw new NativeTransferError('PENDING_TRANSFER');
      }
      const quote = await this.rpc.prepare(address, to, units, signal);
      assertCurrent();
      this.showReview(quote.transaction, null);
    });
  }
  confirm(reviewId: string, password: string): Promise<void> {
    if (this.active) return Promise.reject(new NativeTransferError('BUSY'));
    const approved = this.review;
    if (
      !approved ||
      approved.public.id !== reviewId ||
      this.now() >= approved.expires
    ) {
      this.cancel();
      return Promise.reject(new NativeTransferError('EXPIRED'));
    }
    this.review = null;
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    return this.perform(async ({ assertCurrent, runtime, signal, address }) => {
      let startedSubmission = false;
      const guard = () => {
        assertCurrent();
        if (!startedSubmission && this.now() >= approved.expires)
          throw new NativeTransferError('EXPIRED');
      };
      const journal = await runtime.journal(guard);
      guard();
      this.publish({
        phase: 'signing',
        review: approved.public,
        message: null,
      });
      let entry: TransferJournalEntry;
      if (approved.existing) {
        const stored = await journal.load();
        guard();
        if (
          !stored ||
          stored.hash !== approved.existing.hash ||
          isTerminal(stored.phase)
        )
          throw new NativeTransferError('EXPIRED');
        await this.runSecretOperation(() => runtime.authorize(password, guard));
        guard();
        entry = stored;
      } else {
        const latest = await this.rpc.prepare(
          address,
          approved.transaction.to,
          approved.transaction.value,
          signal
        );
        guard();
        if (
          latest.transaction.nonce !== approved.transaction.nonce ||
          BigInt(latest.transaction.gasLimit) >
            BigInt(approved.transaction.gasLimit) ||
          BigInt(latest.transaction.maxFeePerGas) >
            BigInt(approved.public.maximumFeePerGas)
        )
          throw new NativeTransferError('EXPIRED');
        if (BigInt(approved.public.totalUnits) > BigInt(latest.balanceUnits))
          throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
        const signed = await this.runSecretOperation(() =>
          runtime.sign(approved.transaction, password, guard)
        );
        guard();
        this.verifySigned(approved.transaction, signed);
        entry = await journal.saveSigned(signed.rawTransaction);
        assertCurrent();
        this.publish({ hash: entry.hash });
        guard();
        if (entry.hash !== signed.hash) throw new NativeTransferError('FAILED');
      }
      if (entry.phase === 'signed')
        entry = await journal.transition(entry.hash, 'attempted');
      guard();
      startedSubmission = true;
      this.publish({
        phase: 'submitting',
        hash: entry.hash,
        review: approved.public,
        message: null,
      });
      try {
        await this.rpc.broadcast(entry.rawTransaction, entry.hash, signal);
      } catch (error) {
        assertCurrent();
        this.publish({
          phase: 'unknown',
          review: null,
          hash: entry.hash,
          message:
            error instanceof NativeTransferRpcError
              ? 'Submission could not be confirmed. Check this transaction before sending again.'
              : 'Submission may have completed. Check this transaction before sending again.',
        });
        return;
      }
      assertCurrent();
      if (entry.phase !== 'submitted')
        await journal.transition(entry.hash, 'submitted');
      assertCurrent();
      this.publish({
        phase: 'pending',
        review: null,
        hash: entry.hash,
        message: 'Submitted. Waiting for network confirmation.',
      });
    });
  }
  private verifySigned(
    expected: PreparedEvmTransaction,
    signed: Readonly<{ rawTransaction: string; hash: string }>
  ) {
    if (
      typeof signed.rawTransaction !== 'string' ||
      signed.rawTransaction.length > 4096
    )
      throw new Error('Invalid signed transfer');
    const tx = Transaction.from(signed.rawTransaction);
    const unsigned = Transaction.from({
      type: expected.type,
      to: expected.to,
      chainId: BigInt(expected.chainId),
      nonce: Number(expected.nonce),
      value: BigInt(expected.value),
      gasLimit: BigInt(expected.gasLimit),
      data: expected.data,
      ...(expected.type === 0
        ? { gasPrice: BigInt(expected.gasPrice) }
        : {
            maxFeePerGas: BigInt(expected.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(expected.maxPriorityFeePerGas),
          }),
    });
    if (
      !tx.isSigned() ||
      tx.from !== expected.from ||
      tx.unsignedSerialized !== unsigned.unsignedSerialized ||
      tx.hash !== signed.hash
    )
      throw new Error('Signed transfer differs from review');
  }
  private transaction(entry: TransferJournalEntry): PreparedEvmTransaction {
    const tx = Transaction.from(entry.rawTransaction);
    const common = {
      from: tx.from!,
      to: tx.to!,
      chainId: '1',
      nonce: tx.nonce.toString(),
      value: tx.value.toString(),
      gasLimit: tx.gasLimit.toString(),
      data: '0x',
    };
    return Object.freeze(
      tx.type === 0
        ? { ...common, type: 0, gasPrice: tx.gasPrice!.toString() }
        : {
            ...common,
            type: 2,
            maxFeePerGas: tx.maxFeePerGas!.toString(),
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas!.toString(),
          }
    );
  }
  private terminalMessage(phase: string): string {
    if (phase === 'confirmed') return 'Transfer confirmed.';
    if (phase === 'reverted')
      return 'Transfer reverted. Network fees may still apply.';
    return 'This saved transfer can no longer be retried. Its result is unavailable. Check your account history before sending again.';
  }
  recover(offerRetry = false): Promise<void> {
    if (this.disposed)
      return Promise.reject(new NativeTransferError('CANCELLED'));
    if (this.activeWork) {
      const generation = this.generation;
      if (
        this.queuedRecovery?.generation === generation &&
        this.queuedRecovery.retry === offerRetry
      )
        return this.queuedRecovery.promise;
      let queued: Promise<void>;
      queued = this.activeWork
        .catch(() => undefined)
        .then(() => {
          if (this.disposed || generation !== this.generation)
            throw new NativeTransferError('CANCELLED');
          return this.recover(offerRetry);
        })
        .finally(() => {
          if (this.queuedRecovery?.promise === queued)
            this.queuedRecovery = null;
        });
      this.queuedRecovery = { generation, retry: offerRetry, promise: queued };
      return queued;
    }
    return this.perform(async ({ assertCurrent, runtime, signal }) => {
      this.review = null;
      this.publish({ phase: 'preparing', review: null, message: null });
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const entry = await journal.load();
      assertCurrent();
      if (!entry) {
        this.publish(initial());
        return;
      }
      if (isTerminal(entry.phase)) {
        this.publish({
          phase: entry.phase,
          hash: entry.hash,
          message: this.terminalMessage(entry.phase),
        });
        return;
      }
      this.publish({ hash: entry.hash });
      const tx = this.transaction(entry);
      const receipt = await this.rpc.receipt(
        { hash: entry.hash, from: tx.from, to: tx.to, nonce: tx.nonce },
        signal
      );
      assertCurrent();
      if (receipt?.finalized) {
        await journal.transition(entry.hash, receipt.status);
        assertCurrent();
        this.publish({
          phase: receipt.status,
          hash: entry.hash,
          message: this.terminalMessage(receipt.status),
        });
      } else if (!receipt && offerRetry) this.showReview(tx, entry);
      else
        this.publish({
          phase: receipt ? 'pending' : 'unknown',
          hash: entry.hash,
          message: receipt
            ? 'Included in a block. Waiting for finality.'
            : 'Submission is unconfirmed. Do not create another transfer for this nonce.',
        });
    });
  }
}
