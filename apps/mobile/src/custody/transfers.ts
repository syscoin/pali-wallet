import { Transaction } from 'ethers/transaction';
import { assertSignedEvmTransactionMatches } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { EvmReplayError, type EvmReplayReview, type EvmReplaySession, type EvmSignedReplay } from '../../../../source/wallet/evmSignedReplay.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { parseDecimalAmount } from '../core/amounts.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import type { CustodySnapshot } from './types.ts';
import {
  TransferJournalError,
} from './transferJournal.ts';
import type { TransferJournalEntry } from './transferJournal.ts';
import { NativeTransferRpc, NativeTransferRpcError } from './transferRpc.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { getNativeSendContext, erc20SigningEnabled, type NativeSendContext } from './networkContext.ts';
import {
  parseTokenAmount,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import {
  assertTransferIntentEnvelope,
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
  replay?: EvmReplayReview;
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
export interface NativeTransferJournalHandle {
  load(hash?: string): Promise<TransferJournalEntry | null>;
  saveSigned(rawTransaction:string,intent?:Erc20TransferIntent):Promise<TransferJournalEntry>;
  transition(hash:string,phase:Exclude<TransferJournalEntry['phase'],'signed'>):Promise<TransferJournalEntry>;
}
export interface NativeTransferRuntime {
  replay(assertCurrent: () => void, transport: Pick<EvmReplaySession, 'observe' | 'dispatch'>,
    options: { now: () => number; randomBytes: (length: number) => Uint8Array }): Pick<EvmSignedReplay, 'prepare' | 'confirm' | 'cancel' | 'list'>;
  token?(
    contractAddress: string,
    assertCurrent: () => void
  ): Promise<Erc20Metadata>;
  journal(assertCurrent: () => void): Promise<NativeTransferJournalHandle>;
  submit(rawTransaction: string, hash: string, assertCurrent: () => void, broadcast: () => Promise<unknown>, intent?: Erc20TransferIntent): Promise<void>;
  sign(
    transaction: PreparedEvmTransaction,
    assertCurrent: () => void,
    intent?: Erc20TransferIntent
  ): Promise<Readonly<{ rawTransaction: string; hash: string }>>;
  assertUnlocked(assertCurrent: () => void): void;
}
type Source = {
  getCatalogue?(): NativeWalletCatalogueSnapshot | null;
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
    | 'loadMorePredecessors'
  >
>;

type PrivateReview = {
  public: NativeTransferReview;
  transaction?: PreparedEvmTransaction;
  expires: number;
  replay?: Pick<EvmSignedReplay, 'prepare' | 'confirm' | 'cancel' | 'list'>;
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
    confirm: (id: string) => this.confirm(id),
    recover: (offerRetry?: boolean, hash?: string) => this.recover(offerRetry, hash),
    loadMorePredecessors: () => this.loadMorePredecessors(),
  });
  private snapshot: NativeTransferSnapshot = initial();
  private listeners = new Set<(snapshot: NativeTransferSnapshot) => void>();
  private review: PrivateReview | null = null;
  private replay: Pick<EvmSignedReplay, 'prepare' | 'confirm' | 'cancel' | 'list'> | null = null;
  private replayAbort: AbortController | null = null;
  private active = false;
  private activeWork: Promise<void> | null = null;
  private queuedRecovery: {
    generation: number;
    retry: boolean;
    hash?: string;
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
  private readonly fetcher?: WalletHttpFetch;
  private readonly rpcs = new Map<string, NativeTransferRpc>();
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly now: () => number;
  constructor(
    source: Source,
    runtime: () => NativeTransferRuntime | undefined,
    options: {
      rpc?: NativeTransferRpc;
      fetch?: WalletHttpFetch;
      randomBytes?: (length: number) => Uint8Array;
      now?: () => number;
    } = {}
  ) {
    this.source = source;
    this.runtime = runtime;
    this.rpc = options.rpc;
    this.fetcher = options.fetch;
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
    this.replay?.cancel(); this.replay = null; this.replayAbort?.abort(); this.replayAbort = null;
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
    this.replay?.cancel(); this.replay = null; this.replayAbort?.abort(); this.replayAbort = null;
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
    try { context = getNativeSendContext(captured.account.network, this.source.getCatalogue?.()?.networks); }
    catch { return Promise.reject(new NativeTransferError('NOT_READY')); }
    let rpc = this.rpc ?? this.rpcs.get(context.registrationHash);
    if (!rpc) { const registration = this.source.getCatalogue?.()?.networks.find((network) => network.id === context.networkId); rpc = new NativeTransferRpc({ networkId: context.networkId, registration, fetch: this.fetcher }); this.rpcs.set(context.registrationHash, rpc); }
    if (rpc.context.registrationHash !== context.registrationHash) return Promise.reject(new NativeTransferError('NOT_READY'));
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
      const currentRegistration = this.source.getCatalogue?.()?.networks.find((network) => network.id === context.networkId);
      if (
        (this.source.getCatalogue && currentRegistration?.registrationHash !== context.registrationHash) ||
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
        if ((error instanceof NativeTransferError && error.code === 'EXPIRED') ||
            (error instanceof NativeTransferRpcError && error.code === 'REVIEW_REQUIRED')) {
          this.publish({
              phase: this.snapshot.hash ? 'unknown' : 'idle',
              review: null,
              message: this.snapshot.hash
                ? 'A signed transaction was saved before the review expired. Check it before sending again.'
                : 'The review expired or network conditions changed. Review the transfer again.',
            });
          throw new NativeTransferError('EXPIRED');
        }
        if (error instanceof EvmReplayError && ['EXPIRED', 'CONTEXT_CHANGED', 'NOT_FOUND'].includes(error.code)) {
          this.publish({ phase: 'idle', review: null, message: 'This review expired or changed. Review the saved transaction again.' });
          throw new NativeTransferError('EXPIRED');
        }
        if (error instanceof NativeTransferError) throw error;
        if (!(error instanceof NativeTransferRpcError)) this.source.lock();
        this.publish({
          phase: 'unavailable',
          review: null,
          message: this.snapshot.hash
            ? 'The transfer could not be completed. Your pending transaction has been preserved.'
            : 'The request could not be completed. Try again or check Activity for an existing transaction.',
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
    inputIntent?: Erc20TransferIntent,
    context = getNativeSendContext(this.source.getSnapshot().account!.network, this.source.getCatalogue?.()?.networks)
  ) {
    const intent = inputIntent;
    assertTransferIntentEnvelope(transaction, intent);
    if (transaction.chainId !== context.chainId ||
        intent && !erc20SigningEnabled(context.networkId, this.source.getCatalogue?.()?.networks)) throw new NativeTransferError('FAILED');
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
      retry: false,
      ...(intent ? { intent } : {}),
    });
    this.review = {
      public: publicReview,
      transaction,
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
      hash: null,
      message: null,
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
      this.showReview(quote.transaction, undefined, context);
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
      if (!erc20SigningEnabled(context.networkId, this.source.getCatalogue?.()?.networks)) throw new NativeTransferError('NOT_READY');
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
        chainId: context.chainId,
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
      this.showReview(quote.transaction, intent, context);
    });
  }
  confirm(reviewId: string): Promise<void> {
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
    if (approved.replay) return this.perform(async ({ assertCurrent, context, runtime }) => {
      if (approved.public.context.registrationHash !== context.registrationHash) throw new NativeTransferError('EXPIRED');
      runtime.assertUnlocked(assertCurrent);
      this.publish({ phase: 'submitting', review: approved.public, hash: approved.public.replay!.hash, message: null });
      const result = await approved.replay!.confirm(reviewId); assertCurrent();
      this.publish({ phase: result.status === 'submitted' ? 'pending' : 'unknown', review: null, hash: result.hash,
        message: result.status === 'submitted' ? 'Submitted. Waiting for network confirmation.' : 'Submission could not be confirmed. Check this transaction before sending again.' });
    });
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      if (approved.public.context.registrationHash !== context.registrationHash) throw new NativeTransferError('EXPIRED');
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
      let rawTransaction: string;
      let transactionHash: string;
      {
        const latest = await rpc.requote(approved.transaction!, signal, approved.public.intent);
        guard();
        if (
          latest.transaction.to !== approved.transaction!.to ||
          latest.transaction.value !== approved.transaction!.value ||
          latest.transaction.data !== approved.transaction!.data ||
          latest.transaction.nonce !== approved.transaction!.nonce ||
          BigInt(latest.transaction.gasLimit) >
            BigInt(approved.transaction!.gasLimit) ||
          BigInt(latest.transaction.type === 0 ? latest.transaction.gasPrice : latest.transaction.maxFeePerGas) >
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
            approved.transaction!,
            guard,
            approved.public.intent
          )
        );
        guard();
        this.verifySigned(approved.transaction!, signed);
        rawTransaction = signed.rawTransaction; transactionHash = signed.hash;
      }
      guard();
      this.publish({
        phase: 'submitting',
        review: approved.public,
        message: null,
      });
      try {
        await runtime.submit(rawTransaction, transactionHash, guard,
          () => {
            guard();
            startedSubmission = true;
            return rpc.broadcast(rawTransaction, transactionHash, signal, approved.public.intent);
          },
          approved.public.intent);
      } catch (error) {
        // Durable uncertainty must reach the captured authority even if the
        // storage adapter simultaneously revoked the session.
        if (error instanceof TransferJournalError && error.code === 'REOPEN_REQUIRED') throw error;
        assertCurrent();
        if (!startedSubmission) {
          // A signature alone does not prove the signed record was committed.
          // Check under the wallet owner, since the review may have expired.
          const recovery = await runtime.journal(assertCurrent);
          const saved = await recovery.load(transactionHash);
          assertCurrent();
          if (saved?.hash === transactionHash && saved.rawTransaction === rawTransaction)
            this.publish({ hash: transactionHash });
          throw error;
        }
        if (error && typeof error === 'object' && 'transactionNotBroadcast' in error && error.transactionNotBroadcast === true) {
          this.publish({ hash: transactionHash });
          throw error;
        }
        this.publish({
          phase: 'unknown',
          review: null,
          hash: transactionHash,
          message:
            error instanceof NativeTransferRpcError
              ? 'Submission could not be confirmed. Check this transaction before sending again.'
              : 'Submission may have completed. Check this transaction before sending again.',
        });
        return;
      }
      assertCurrent();
      // An RPC acknowledgement cannot be undone by a local status write.
      this.publish({ hash: transactionHash });
      assertCurrent();
      let message = 'Submitted. Waiting for network confirmation.';
      try {
        await journal.transition(transactionHash, 'submitted');
      } catch (error) {
        if (error instanceof TransferJournalError && error.code === 'REOPEN_REQUIRED') throw error;
        message = 'Submitted. Activity may take longer to update.';
      }
      assertCurrent();
      this.publish({
        phase: 'pending',
        review: null,
        hash: transactionHash,
        message,
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
    let tx: Transaction;
    try {
      tx = assertSignedEvmTransactionMatches(
        signed.rawTransaction,
        unsigned.unsignedSerialized,
        expected.from
      );
    } catch {
      throw new Error('Signed transfer differs from review');
    }
    if (tx.hash !== signed.hash)
      throw new Error('Signed transfer differs from review');
  }
  private terminalMessage(phase: string, intent?: Erc20TransferIntent, _context?: NativeSendContext): string {
    if (phase === 'confirmed')
      return intent
        ? 'Transaction confirmed. Check the token balance for the received amount; token contracts may deduct fees or apply other rules.'
        : 'Transfer confirmed.';
    if (phase === 'reverted')
      return 'Transfer reverted. Network fees may still apply.';
    return 'The account nonce has advanced, but this transfer’s result is unavailable. Refresh its status before retrying.';
  }
  loadMorePredecessors(): Promise<void> {
    const current = this.review;
    const saved = current?.public.replay;
    if (!current?.replay || !saved?.missingNonce || saved.predecessors.length >= saved.predecessorCount)
      return Promise.resolve();
    return this.perform(async ({ assertCurrent }) => {
      this.publish({phase:'preparing'});
      const page = await current.replay!.list({ nonce: Number(saved.missingNonce), maximum: 20,
        beforeHash: saved.predecessors[saved.predecessors.length - 1]?.hash });
      assertCurrent();
      if (this.review !== current) throw new NativeTransferError('CANCELLED');
      const known = new Set(saved.predecessors.map(candidate => candidate.hash));
      const extra = page.transactions.filter(candidate => !known.has(candidate.hash)).map(({hash,nonce,operation,originalHash}) =>
        Object.freeze({hash,nonce,operation,...(originalHash ? {originalHash} : {})}));
      const replay = Object.freeze({...saved,predecessors:Object.freeze([...saved.predecessors,...extra])});
      const review = Object.freeze({...current.public,replay});
      this.review = {...current,public:review};
      this.publish({review,phase:'review'});
    });
  }
  recover(offerRetry = false, hash?: string): Promise<void> {
    if (this.disposed)
      return Promise.reject(new NativeTransferError('CANCELLED'));
    if (this.activeWork) {
      const generation = this.generation;
      if (
        this.queuedRecovery?.generation === generation &&
        this.queuedRecovery.retry === offerRetry &&
        this.queuedRecovery.hash === hash
      )
        return this.queuedRecovery.promise;
      let queued: Promise<void>;
      queued = this.activeWork
        .catch(() => undefined)
        .then(() => {
          if (this.disposed || generation !== this.generation)
            throw new NativeTransferError('CANCELLED');
          return this.recover(offerRetry, hash);
        })
        .finally(() => {
          if (this.queuedRecovery?.promise === queued)
            this.queuedRecovery = null;
        });
      this.queuedRecovery = { generation, retry: offerRetry, hash, promise: queued };
      return queued;
    }
    return this.perform(async ({ assertCurrent, runtime, context, rpc }) => {
      this.review = null;
      this.publish({ phase: 'preparing', context, review: null, message: null });
      let selected = hash;
      if (!selected) { const entry = await (await runtime.journal(assertCurrent)).load(); assertCurrent(); selected = entry?.hash; }
      if (!selected) { this.publish(initial()); return; }
      this.replay?.cancel(); this.replayAbort?.abort();
      const abort = new AbortController(); this.replayAbort = abort;
      const generation = this.generation, identity = this.sourceIdentity;
      const current = () => {
        if (this.disposed || generation !== this.generation || identity !== this.sourceIdentity || this.runtime() !== runtime || abort.signal.aborted)
          throw new NativeTransferError('CANCELLED');
      };
      const replay = runtime.replay(current, {
        observe: ({ hash, from, to, nonce }) => rpc.observation({ hash, from, to, nonce }, abort.signal),
        dispatch: (raw, admit, context) => rpc.broadcast(raw, context.hash, abort.signal, undefined, { replay: { admit, context } }),
      }, { now: this.now, randomBytes: this.randomBytes });
      this.replay = replay;
      const result = await replay.prepare(selected); assertCurrent();
      if (result.status !== 'review') {
        const transfer = result.transaction.tokenTransfer, token = transfer?.token;
        const intent: Erc20TransferIntent | undefined = token ? Object.freeze({kind:'erc20-transfer',chainId:result.transaction.chainId,token,recipient:transfer!.recipient,amountUnits:transfer!.amountUnits}) : undefined;
        this.publish({ phase: result.status, hash: result.hash, review: null, intent: intent ?? null, message: this.terminalMessage(result.status, intent, context) }); return;
      }
      const approved = result.review;
      this.publish({ hash: approved.hash });
      if (!offerRetry) { replay.cancel(approved.id); this.publish({phase:'unknown',review:null,message:'No current receipt was found. The saved transaction remains available; check its status before sending again.'}); return; }
      const token = approved.tokenTransfer?.token;
      const intent: Erc20TransferIntent | undefined = token ? Object.freeze({kind:'erc20-transfer',chainId:approved.chainId,token,recipient:approved.tokenTransfer!.recipient,amountUnits:approved.tokenTransfer!.amountUnits}) : undefined;
      const publicReview: NativeTransferReview = Object.freeze({ id:approved.id,context,from:approved.from,recipient:approved.tokenTransfer?.recipient ?? approved.to ?? 'Contract creation',
        amountUnits:intent?.amountUnits ?? approved.value, maximumFeeUnits:approved.maximumFee,totalUnits:(BigInt(approved.value)+BigInt(approved.maximumFee)).toString(),
        gasLimit:approved.gasLimit,maximumFeePerGas:approved.feePerGas,priorityFeePerGas:approved.priorityFeePerGas,nonce:approved.nonce,retry:true,replay:approved,...(intent?{intent}:{}) });
      this.review = { public:publicReview,expires:this.now()+approved.validForMs,replay };
      if (this.expiry !== null) clearTimeout(this.expiry);
      this.expiry=setTimeout(()=>{if(this.review?.public.id===approved.id&&!this.active)this.cancel();},approved.validForMs);
      this.publish({phase:'review',review:publicReview,intent:intent??null,message:'Resend the saved signed transaction.'});
    });
  }
}
