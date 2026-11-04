import { Transaction } from 'ethers/transaction';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { parseDecimalAmount } from '../core/amounts.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import type { CustodySnapshot } from './types.ts';
import {
  NativeTransferJournal,
  TransferJournalError,
} from './transferJournal.ts';
import type { TransferJournalEntry } from './transferJournal.ts';
import { NativeTransferRpc, NativeTransferRpcError } from './transferRpc.ts';
import { getNativeSendContext, erc20SigningEnabled, type NativeSendContext } from './networkContext.ts';
import {
  parseTokenAmount,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import {
  assertTransferIntentEnvelope,
  equalTransferIntent,
  snapshotErc20TransferIntent,
  type Erc20TransferIntent,
} from './transferIntent.ts';

export type NativeTransferReview = Readonly<{
  context: NativeSendContext;
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
  intent?: Erc20TransferIntent;
}>;
export type NativeTransferSnapshot = Readonly<{
  context?: NativeSendContext | null;
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
  intent: Erc20TransferIntent | null;
}>;
export interface NativeTransferRuntime {
  token?(
    contractAddress: string,
    assertCurrent: () => void
  ): Promise<Erc20Metadata>;
  journal(assertCurrent: () => void): Promise<NativeTransferJournal>;
  sign(
    transaction: PreparedEvmTransaction,
    password: string,
    assertCurrent: () => void,
    intent?: Erc20TransferIntent
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
    | 'INSUFFICIENT_BALANCE'
    | 'INSUFFICIENT_TOKEN_BALANCE'
    | 'TOKEN_CHANGED'
    | 'TOKEN_TRANSFER_REJECTED';
  constructor(code: NativeTransferError['code']) {
    super(code);
    this.name = 'NativeTransferError';
    this.code = code;
  }
}
export type NativeTransferView = Readonly<
  Pick<
    NativeTransfers,
    | 'getSnapshot'
    | 'subscribe'
    | 'cancel'
    | 'prepare'
    | 'prepareToken'
    | 'confirm'
    | 'recover'
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
  Object.freeze({
    phase: 'idle',
    review: null,
    hash: null,
    message: null,
    intent: null,
  });

/** Owns consent and submission; screens receive only public projections. */
export class NativeTransfers {
  readonly view: NativeTransferView = Object.freeze({
    getSnapshot: () => this.getSnapshot(),
    subscribe: (listener: (snapshot: NativeTransferSnapshot) => void) =>
      this.subscribe(listener),
    cancel: () => this.cancel(),
    prepare: (recipient: string, amount: string) =>
      this.prepare(recipient, amount),
    prepareToken: (contract: string, recipient: string, amount: string) =>
      this.prepareToken(contract, recipient, amount),
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
  private readonly rpc?: NativeTransferRpc;
  private readonly rpcs = new Map<string, NativeTransferRpc>();
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
    this.rpc = options.rpc;
    this.randomBytes =
      options.randomBytes ??
      ((length) => globalThis.crypto.getRandomValues(new Uint8Array(length)));
    this.now = options.now ?? (() => performance.now());
    const identity = (state: CustodySnapshot) =>
      `${state.phase}:${state.revision}:${state.account?.network ?? ''}:${state.account?.address ?? ''}`;
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
      context: NativeSendContext;
      rpc: NativeTransferRpc;
    }) => Promise<void>
  ): Promise<void> {
    if (this.disposed)
      return Promise.reject(new NativeTransferError('CANCELLED'));
    if (this.active) return Promise.reject(new NativeTransferError('BUSY'));
    const captured = this.source.getSnapshot();
    const runtime = this.runtime();
    if (
      captured.phase !== 'ready' ||
      !captured.account ||
      !runtime
    )
      return Promise.reject(new NativeTransferError('NOT_READY'));
    let context: NativeSendContext;
    try { context = getNativeSendContext(captured.account.network); }
    catch { return Promise.reject(new NativeTransferError('NOT_READY')); }
    let rpc = this.rpc ?? this.rpcs.get(context.networkId);
    if (!rpc) { rpc = new NativeTransferRpc({ networkId: context.networkId }); this.rpcs.set(context.networkId, rpc); }
    if (rpc.context !== context) return Promise.reject(new NativeTransferError('NOT_READY'));
    const address = normalizePublicAddress(
      captured.account.address,
      context.networkId
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
        current.account?.network !== context.networkId ||
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
          context,
          rpc,
        });
      })
      .catch((error: unknown) => {
        // Journal uncertainty outlives transfer cancellation. Retire only the
        // captured wallet; a late old-runtime error cannot lock its replacement.
        if (
          error instanceof TransferJournalError &&
          error.code === 'REOPEN_REQUIRED' &&
          this.runtime() === runtime
        )
          this.source.lock();
        try {
          assertCurrent();
        } catch {
          throw new NativeTransferError('CANCELLED');
        }
        if (error instanceof TransferJournalError && error.code === 'HISTORY_UNAVAILABLE') {
          this.publish({ phase: 'unavailable', review: null,
            message: 'Your previous transfer could not be safely saved to local activity. No new transfer was broadcast. Close and reopen Pali, then try again.' });
          throw new NativeTransferError('FAILED');
        }
        if (
          error instanceof NativeTransferRpcError &&
          ['INSUFFICIENT_BALANCE', 'INSUFFICIENT_TOKEN_BALANCE'].includes(
            error.code
          )
        ) {
          this.publish({
            phase: 'idle',
            review: null,
            hash: null,
            message:
              error.code === 'INSUFFICIENT_TOKEN_BALANCE'
                ? 'Not enough tokens for this transfer.'
                : this.snapshot.intent
                ? `Not enough ${context.symbol} for the maximum network fee.`
                : `Not enough ${context.symbol} for the amount and maximum network fee.`,
          });
          throw new NativeTransferError(
            error.code as 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_TOKEN_BALANCE'
          );
        }
        if (
          error instanceof NativeTransferRpcError &&
          ['TOKEN_CHANGED', 'TOKEN_TRANSFER_REJECTED'].includes(error.code)
        ) {
          this.publish({
            phase: 'idle',
            review: null,
            hash: null,
            message:
              error.code === 'TOKEN_CHANGED'
                ? 'This token precision changed. Remove and review the token again before sending.'
                : 'The token contract did not accept this transfer.',
          });
          throw new NativeTransferError(
            error.code as 'TOKEN_CHANGED' | 'TOKEN_TRANSFER_REJECTED'
          );
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
    existing: TransferJournalEntry | null,
    inputIntent?: Erc20TransferIntent,
    context = getNativeSendContext(this.source.getSnapshot().account!.network)
  ) {
    const intent = existing?.intent ?? inputIntent;
    assertTransferIntentEnvelope(transaction, intent);
    if (transaction.chainId !== context.chainId || intent && !erc20SigningEnabled(context.networkId)) throw new NativeTransferError('FAILED');
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
      context,
      from: transaction.from,
      recipient: intent?.recipient ?? transaction.to,
      amountUnits: intent?.amountUnits ?? transaction.value,
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
      ...(intent ? { intent } : {}),
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
      intent: intent ?? null,
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
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      this.review = null;
      this.publish({
        phase: 'preparing',
        context,
        review: null,
        hash: null,
        message: null,
        intent: null,
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
          intent: old.intent ?? null,
          message: 'Check your pending transfer before starting another.',
        });
        throw new NativeTransferError('PENDING_TRANSFER');
      }
      const quote = await rpc.prepare(address, to, units, signal);
      assertCurrent();
      this.showReview(quote.transaction, null, undefined, context);
    });
  }
  prepareToken(
    contractAddress: string,
    recipient: string,
    amount: string
  ): Promise<void> {
    let contract: string, to: string;
    try {
      contract = normalizeErc20Address(contractAddress);
      to = normalizeErc20Address(recipient);
    } catch {
      return Promise.reject(new NativeTransferError('INVALID_INPUT'));
    }
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      if (!erc20SigningEnabled(context.networkId)) throw new NativeTransferError('NOT_READY');
      this.review = null;
      this.publish({
        phase: 'preparing',
        context,
        review: null,
        hash: null,
        message: null,
        intent: null,
      });
      if (!runtime.token) throw new NativeTransferError('NOT_READY');
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const old = await journal.load();
      assertCurrent();
      if (old && !isTerminal(old.phase)) {
        this.publish({
          phase: 'unknown',
          review: null,
          hash: old.hash,
          intent: old.intent ?? null,
          message: 'Check your pending transfer before starting another.',
        });
        throw new NativeTransferError('PENDING_TRANSFER');
      }
      const token = await runtime.token(contract, assertCurrent);
      assertCurrent();
      let intent: Erc20TransferIntent;
      try {
        intent = snapshotErc20TransferIntent({
          kind: 'erc20-transfer',
          token,
          recipient: to,
          amountUnits: parseTokenAmount(amount, token.decimals),
        });
      } catch {
        assertCurrent();
        this.publish({ phase: 'idle' });
        throw new NativeTransferError('INVALID_INPUT');
      }
      if (intent.token.contractAddress !== contract)
        throw new NativeTransferError('FAILED');
      this.publish({ intent });
      const quote = await rpc.prepareToken(address, intent, signal);
      assertCurrent();
      this.showReview(quote.transaction, null, intent, context);
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
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      if (approved.public.context !== context) throw new NativeTransferError('EXPIRED');
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
          !equalTransferIntent(stored.intent, approved.public.intent) ||
          isTerminal(stored.phase)
        )
          throw new NativeTransferError('EXPIRED');
        await this.runSecretOperation(() => runtime.authorize(password, guard));
        guard();
        entry = stored;
      } else {
        let latest;
        if (approved.public.intent) latest = await rpc.prepareToken(address, approved.public.intent, signal);
        else if (context.settlement.kind === 'zkos-finalized-executed') {
          if (approved.transaction.type !== 2) throw new NativeTransferError('FAILED');
          latest = await rpc.requote(approved.transaction, signal);
        } else latest = await rpc.prepare(
              address,
              approved.transaction.to,
              approved.transaction.value,
              signal
            );
        guard();
        if (
          latest.transaction.to !== approved.transaction.to ||
          latest.transaction.value !== approved.transaction.value ||
          latest.transaction.data !== approved.transaction.data ||
          latest.transaction.nonce !== approved.transaction.nonce ||
          BigInt(latest.transaction.gasLimit) >
            BigInt(approved.transaction.gasLimit) ||
          BigInt(latest.transaction.maxFeePerGas) >
            BigInt(approved.public.maximumFeePerGas)
        )
          throw new NativeTransferError('EXPIRED');
        if (BigInt(approved.public.totalUnits) > BigInt(latest.balanceUnits))
          throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
        if (
          approved.public.intent &&
          (!latest.tokenBalanceUnits ||
            BigInt(latest.tokenBalanceUnits) <
              BigInt(approved.public.amountUnits))
        )
          throw new NativeTransferRpcError('INSUFFICIENT_TOKEN_BALANCE');
        const signed = await this.runSecretOperation(() =>
          runtime.sign(
            approved.transaction,
            password,
            guard,
            approved.public.intent
          )
        );
        guard();
        this.verifySigned(approved.transaction, signed);
        entry = await journal.saveSigned(
          signed.rawTransaction,
          approved.public.intent
        );
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
        await rpc.broadcast(
          entry.rawTransaction,
          entry.hash,
          signal,
          entry.intent
        );
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
      chainId: tx.chainId.toString(),
      nonce: tx.nonce.toString(),
      value: tx.value.toString(),
      gasLimit: tx.gasLimit.toString(),
      data: tx.data,
    };
    assertTransferIntentEnvelope(common, entry.intent);
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
  private terminalMessage(phase: string, intent?: Erc20TransferIntent, context?: NativeSendContext): string {
    if (context?.settlement.kind === 'zkos-finalized-executed' && phase === 'confirmed')
      return 'Settlement confirmed at the zkSYS finalized execution boundary.';
    if (context?.settlement.kind === 'zkos-finalized-executed' && phase === 'reverted')
      return 'Transfer reverted at the zkSYS finalized execution boundary. Network fees may still apply.';
    if (context?.settlement.kind === 'nevm-depth-12' && phase === 'confirmed')
      return 'Depth confirmed after 12 confirmations. This is a confirmation-depth observation, not protocol finality.';
    if (context?.settlement.kind === 'nevm-depth-12' && phase === 'reverted')
      return 'Transfer reverted and depth confirmed after 12 confirmations. Network fees may still apply.';
    if (phase === 'confirmed')
      return intent
        ? 'Transaction confirmed. Check the token balance for the received amount; token contracts may deduct fees or apply other rules.'
        : 'Transfer confirmed.';
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
    return this.perform(async ({ assertCurrent, runtime, signal, context, rpc }) => {
      this.review = null;
      this.publish({ phase: 'preparing', context, review: null, message: null });
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const entry = await journal.load();
      assertCurrent();
      if (!entry) {
        this.publish(initial());
        return;
      }
      this.publish({ intent: entry.intent ?? null });
      if (isTerminal(entry.phase)) {
        this.publish({
          phase: entry.phase,
          hash: entry.hash,
          message: this.terminalMessage(entry.phase, entry.intent, context),
        });
        return;
      }
      this.publish({ hash: entry.hash });
      const tx = this.transaction(entry);
      const receipt = await rpc.receipt(
        { hash: entry.hash, from: tx.from, to: tx.to, nonce: tx.nonce },
        signal
      );
      assertCurrent();
      if (receipt && (receipt.terminalEligible ?? receipt.finalized)) {
        await journal.transition(entry.hash, receipt.status);
        assertCurrent();
        this.publish({
          phase: receipt.status,
          hash: entry.hash,
          message: this.terminalMessage(receipt.status, entry.intent, context),
        });
      } else if (!receipt && offerRetry) this.showReview(tx, entry, undefined, context);
      else
        this.publish({
          phase: receipt ? 'pending' : 'unknown',
          hash: entry.hash,
          message: receipt
            ? context.settlement.kind === 'nevm-depth-12' ? 'Included in a block. Waiting for 12 confirmations.'
              : context.settlement.kind === 'zkos-finalized-executed' ? 'Included in a block. Waiting for zkSYS settlement confirmation.' : 'Included in a block. Waiting for finality.'
            : 'Submission is unconfirmed. Do not create another transfer for this nonce.',
        });
    });
  }
}
