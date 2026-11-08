import { Transaction } from 'ethers/transaction';
import { assertSignedEvmTransactionMatches, type EvmSignedBroadcast } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { EvmReplayError, type EvmReplayReview, type EvmReplaySession, type EvmSignedReplay } from '../../../../source/wallet/evmSignedReplay.ts';
import { EvmSignedRecordCancellationFence, EvmSignedRecordNonceConflict, consumeSignedEvmCapacityRefusal, type EvmReplacementRates, type EvmVerifiedReplacementBinding } from '../../../../source/wallet/evmSignedRecords.ts';
import { assertEvmFeeApprovalCurrent, assertEvmFeeRefreshApproved, assertEvmSpeedUpFeeRefreshApproved, captureEvmFeeApproval,
  EVM_FEE_APPROVAL_LIFETIME_MS, type EvmFeeApproval } from '../../../../source/shared/evmFeeApproval.ts';
import type { EvmCancellationQuote, EvmNftPreparedQuote, NativeAutomaticNoncePlanner } from './evmTransferReadRpc.ts';
import { EvmAutomaticNonceUnresolved, unsignedTransferBytes, type EvmUnsignedTransfer } from './evmFeeContracts.ts';
import { parseDecimalAmount } from '../core/amounts.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import type { CustodySnapshot } from './types.ts';
import {
  TransferJournalError,
} from './transferJournal.ts';
import type { TransferJournalEntry } from './transferJournal.ts';
import { NativeTransferRpc, NativeTransferRpcError, type NativeReplacementMode, type NativeReplacementOriginal, type NativeTransferQuote } from './transferRpc.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { getNativeNetwork, getNativeSendContext, erc20SigningEnabled, type NativeSendContext } from './networkContext.ts';
import {
  parseTokenAmount,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import {
  assertTransferIntentEnvelope,
  snapshotErc20TransferIntent,
  type Erc20TransferIntent,
  type NativeAssetTransferIntent,
} from './transferIntent.ts';
import type { NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import { snapshotSavedCollectible, type SavedCollectible } from '../portfolio/tokenRegistry.ts';
import { snapshotNftTransferSelection, withNftInventorySignal, type NftTransferSelection } from './nftTransferAdmission.ts';

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
  nonceOverride?: number;
  retry: boolean;
  intent?: Erc20TransferIntent;
  collectible?: NftTransferIntent;
  replay?: EvmReplayReview;
  replacement?: Readonly<{ mode: NativeReplacementMode; originalHash: string; originalMaximumFeeUnits: string }>;
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
  collectible?: NftTransferIntent;
  inspectionOnly?: boolean;
}>;
export interface NativeTransferJournalHandle {
  planAutomaticNonce: NativeAutomaticNoncePlanner;
  assertSpendingNonce(nonce: number): Promise<void>;
  load(hash?: string): Promise<TransferJournalEntry | null>;
  saveSigned(rawTransaction:string,intent?:Erc20TransferIntent):Promise<TransferJournalEntry>;
  transition(hash:string,phase:Exclude<TransferJournalEntry['phase'],'signed'>):Promise<TransferJournalEntry>;
}
export type NativeTransferDispatchValidation = (planner: NativeAutomaticNoncePlanner, assertCurrent: () => void) => Promise<void>;
export interface NativeTransferRuntime {
  evmSubmissionFailure?(error: unknown): Readonly<{ transactionNotBroadcast: boolean; signedTransactionHash?: string }> | undefined;
  replay(assertCurrent: () => void, transport: Pick<EvmReplaySession, 'observe' | 'dispatch'>,
    options: { now: () => number; randomBytes: (length: number) => Uint8Array }): Pick<EvmSignedReplay, 'prepare' | 'confirm' | 'cancel' | 'list'>;
  token?(
    contractAddress: string,
    assertCurrent: () => void
  ): Promise<Erc20Metadata>;
  collectible?(candidate: SavedCollectible, assertCurrent: () => void): Promise<Readonly<{
    collectible: SavedCollectible;
    assertCurrent: () => void;
    signal: AbortSignal;
  }>>;
  replacementOriginal?(hash: string, mode: NativeReplacementMode, assertCurrent: () => void, signal: AbortSignal):
    Promise<Readonly<{ rawTransaction: string; binding: EvmVerifiedReplacementBinding; rates: EvmReplacementRates; intent?: Erc20TransferIntent }> | null>;
  journal(assertCurrent: () => void): Promise<NativeTransferJournalHandle>;
  submit(
    rawTransaction: string,
    hash: string,
    assertCurrent: () => void,
    transport: Readonly<{ broadcast: EvmSignedBroadcast<string>; verifyChain(): Promise<void> }>,
    intent: NativeAssetTransferIntent | undefined,
    approved: EvmUnsignedTransfer,
    replacement?: NativeReplacementApproval,
    verifyDispatch?: NativeTransferDispatchValidation
  ): Promise<void>;
  sign(
    transaction: EvmUnsignedTransfer,
    authority: Readonly<{ assertCurrent(): void; signal: AbortSignal }>,
    intent?: NativeAssetTransferIntent,
    replacement?: NativeReplacementApproval
  ): Promise<Readonly<{ rawTransaction: string; hash: string }>>;
  assertUnlocked(assertCurrent: () => void): void;
}
export type NativeReplacementApproval = Readonly<{ original: NativeReplacementOriginal; binding: EvmVerifiedReplacementBinding } & (
  | { mode: 'cancel'; source: 'pending' | 'saved'; feePlan: EvmCancellationQuote['feePlan'] }
  | { mode: 'speed-up' }
)>;
type Source = {
  getCatalogue?(): NativeWalletCatalogueSnapshot | null;
  getSnapshot(): CustodySnapshot;
  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void;
  lock(): void;
};
const nativeCapacityRefusals = new WeakSet<object>();
const nativeSavedAssetFailures = new WeakMap<object, NativeTransferError>();
export const SIGNED_STORAGE_FULL_MESSAGE = 'This transaction was not submitted because Pali could not save it within its local transaction storage limit. Check Activity.';
export const SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE = 'This new transaction was not submitted because Pali could not save it within its local transaction storage limit. Check the earlier transaction in Activity.';
export const ASSET_STATE_WAIT_MESSAGE = 'The account state changed while checking this transfer. Review the transfer and try again.';
export const ASSET_STATE_SAVED_MESSAGE = 'Your signed transaction is saved and was not submitted. Review it in Activity before retrying.';

export class NativeTransferError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'BUSY'
    | 'NOT_READY'
    | 'INVALID_INPUT'
    | 'INVALID_NONCE'
    | 'NONCE_UNAVAILABLE'
    | 'CANCELLATION_QUEUED'
    | 'NONCE_RETAINED'
    | 'EXPIRED'
    | 'ASSET_STATE_WAIT'
    | 'SIGNED_STORAGE_FULL'
    | 'PENDING_TRANSFER'
    | 'FAILED'
    | 'INSUFFICIENT_BALANCE'
    | 'INSUFFICIENT_TOKEN_BALANCE'
    | 'COLLECTIBLE_CHANGED'
    | 'INSUFFICIENT_NFT_BALANCE'
    | 'NFT_TRANSFER_REJECTED'
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
    | 'prepareCancellation'
    | 'prepareSavedCancellation'
    | 'prepareSpeedUp'
    | 'prepareToken'
    | 'prepareCollectible'
    | 'confirm'
    | 'recover'
    | 'loadMorePredecessors'
  >
>;

type CollectibleReview = Readonly<{
  selection: NftTransferSelection;
  quote: EvmNftPreparedQuote;
  assertInventoryCurrent: () => void;
  inventorySignal: AbortSignal;
}>;
type PrivateReview = {
  public: NativeTransferReview;
  transaction?: EvmUnsignedTransfer;
  expires: number;
  feeApproval?: EvmFeeApproval;
  replay?: Pick<EvmSignedReplay, 'prepare' | 'confirm' | 'cancel' | 'list'>;
  replacement?: NativeReplacementApproval;
  collectible?: CollectibleReview;
};
const isCollectibleRecord = (operation: string) =>
  operation === 'erc721' || operation === 'erc1155';
function parseNonceOverride(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(input))
    throw new NativeTransferError('INVALID_NONCE');
  const nonce = Number(input);
  if (!Number.isSafeInteger(nonce)) throw new NativeTransferError('INVALID_NONCE');
  return nonce;
}

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
    prepare: (recipient: string, amount: string, nonce?: string) =>
      this.prepare(recipient, amount, nonce),
    prepareCancellation: (hash: string) => this.prepareCancellation(hash),
    prepareSavedCancellation: (hash: string) => this.prepareSavedCancellation(hash),
    prepareSpeedUp: (hash: string) => this.prepareSpeedUp(hash),
    prepareToken: (contract: string, recipient: string, amount: string, nonce?: string) =>
      this.prepareToken(contract, recipient, amount, nonce),
    prepareCollectible: (saved: SavedCollectible, recipient: string, tokenId: string, amountUnits: string, nonce?: string) =>
      this.prepareCollectible(saved, recipient, tokenId, amountUnits, nonce),
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
  /** The reset owner must revoke the runtime generation before cancelling UI work. */
  cancelForActivityReset(): void {
    this.secretOperation = null;
    this.cancel();
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
    if (!rpc) { const registration = this.source.getCatalogue?.()?.networks.find((network) => network.id === context.networkId); rpc = new NativeTransferRpc({ networkId: context.networkId, registration, fetch: this.fetcher, monotonicMilliseconds: () => Math.floor(this.now()) }); this.rpcs.set(context.registrationHash, rpc); }
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
      .catch(async (error: unknown) => {
        if (!(error instanceof EvmAutomaticNonceUnresolved) || error.reason === 'asset-state') throw error;
        assertCurrent();
        // Quotes have released their journal snapshot. Find the current
        // Activity route using the normal owned nonce check.
        const journal = await runtime.journal(assertCurrent);
        await journal.assertSpendingNonce(error.nonce);
        throw new NativeTransferRpcError('REVIEW_REQUIRED');
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
        if (error instanceof EvmAutomaticNonceUnresolved && error.reason === 'asset-state') {
          this.publish({
            phase: this.snapshot.hash ? 'unknown' : 'idle', review: null,
            message: this.snapshot.hash
              ? ASSET_STATE_SAVED_MESSAGE
              : ASSET_STATE_WAIT_MESSAGE,
          });
          throw new NativeTransferError('ASSET_STATE_WAIT');
        }
        if (error instanceof NativeTransferError && error.code === 'NONCE_RETAINED') {
          this.publish({ phase: 'idle', review: null });
          throw error;
        }
        if (error instanceof EvmSignedRecordNonceConflict) {
          this.publish({
            phase: 'unknown', hash: error.recoveryHash, review: null,
            intent: null, collectible: undefined,
            inspectionOnly: isCollectibleRecord(error.operation),
            message: 'Check the saved transaction before sending this payment.',
          });
          throw new NativeTransferError('PENDING_TRANSFER');
        }
        if (error instanceof EvmSignedRecordCancellationFence) {
          const hash = error.recoveryHash;
          this.publish({
            phase: hash ? 'unknown' : 'unavailable',
            hash, review: null, intent: null, collectible: undefined, inspectionOnly: false,
            message: hash
              ? 'A saved cancellation uses this nonce. Check its status or review a retry before sending again.'
              : 'A saved cancellation uses this nonce. Check Activity before sending again.',
          });
          return;
        }
        if (error instanceof TransferJournalError && error.code === 'HISTORY_UNAVAILABLE') {
          this.publish({ phase: 'unavailable', review: null,
            message: 'Your previous transfer could not be safely saved to local activity. No new transfer was broadcast. Close and reopen Pali, then try again.' });
          throw new NativeTransferError('FAILED');
        }
        const savedAssetFailure = error && typeof error === 'object' ? nativeSavedAssetFailures.get(error) : undefined;
        if (savedAssetFailure) {
          nativeSavedAssetFailures.delete(error as object);
          this.publish({ phase: 'unknown', review: null, message: ASSET_STATE_SAVED_MESSAGE });
          throw savedAssetFailure;
        }
        if (
          error instanceof NativeTransferRpcError &&
          ['INSUFFICIENT_BALANCE', 'INSUFFICIENT_TOKEN_BALANCE'].includes(
            error.code
          )
        ) {
          this.publish({
            phase: this.snapshot.collectible && this.snapshot.hash ? 'unknown' : 'idle',
            review: null,
            hash: this.snapshot.collectible ? this.snapshot.hash : null,
            message:
              error.code === 'INSUFFICIENT_TOKEN_BALANCE'
                ? 'Not enough tokens for this transfer.'
                : this.snapshot.intent || this.snapshot.collectible
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
        if ((error instanceof NativeTransferError && error.code === 'COLLECTIBLE_CHANGED') ||
            (error instanceof NativeTransferRpcError && (error.code === 'INSUFFICIENT_NFT_BALANCE' || error.code === 'NFT_TRANSFER_REJECTED'))) {
          this.publish({ phase: this.snapshot.hash ? 'unknown' : 'idle', review: null,
            message: error.code === 'COLLECTIBLE_CHANGED'
              ? this.snapshot.hash ? 'This transfer is saved and did not broadcast. Check it before trying again.'
                : 'Your saved collectibles changed. Open the collectible and try again.'
              : error.code === 'INSUFFICIENT_NFT_BALANCE' ? 'This account does not own enough of this collectible.'
                : 'The collectible contract did not accept this transfer.' });
          throw new NativeTransferError(error.code);
        }
        if (error instanceof NativeTransferRpcError && error.code === 'CANCELLATION_QUEUED') {
          this.publish({
            phase: this.snapshot.hash ? 'unknown' : 'idle', review: null,
            message: this.snapshot.hash
              ? 'Your signed transaction is saved. It must wait for earlier transactions. Check Activity before retrying.'
              : 'This cancellation must wait for earlier transactions. Check Activity before trying again.',
          });
          throw new NativeTransferError('CANCELLATION_QUEUED');
        }
        if (error instanceof NativeTransferRpcError && error.code === 'NONCE_UNAVAILABLE') {
          this.publish({
            phase: this.snapshot.hash ? 'unknown' : 'idle',
            review: null,
            message: this.snapshot.hash
              ? 'Your signed transaction is saved. This nonce is no longer available.'
              : null,
          });
          throw new NativeTransferError(error.code);
        }
        if ((error instanceof NativeTransferError && error.code === 'EXPIRED') ||
            (error instanceof NativeTransferRpcError && error.code === 'REVIEW_REQUIRED')) {
          this.publish({
              phase: this.snapshot.hash ? 'unknown' : 'idle',
              review: null,
              message: this.snapshot.hash
                ? 'Your signed transaction is saved. Check it before sending again.'
                : 'The review expired or network conditions changed. Review the transfer again.',
            });
          throw new NativeTransferError('EXPIRED');
        }
        if (error instanceof EvmReplayError && ['EXPIRED', 'CONTEXT_CHANGED', 'NOT_FOUND'].includes(error.code)) {
          this.publish({ phase: 'idle', review: null, message: 'This review expired or changed. Review the saved transaction again.' });
          throw new NativeTransferError('EXPIRED');
        }
        if (error && typeof error === 'object' && nativeCapacityRefusals.has(error)) {
          nativeCapacityRefusals.delete(error);
          this.publish({ phase: this.snapshot.hash ? 'unknown' : 'idle', review: null, message: this.snapshot.hash ? SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE : SIGNED_STORAGE_FULL_MESSAGE });
          throw new NativeTransferError('SIGNED_STORAGE_FULL');
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
    transaction: EvmUnsignedTransfer,
    inputIntent?: Erc20TransferIntent,
    context = getNativeSendContext(this.source.getSnapshot().account!.network, this.source.getCatalogue?.()?.networks),
    { replacement, collectible, nonceOverride }: {
      replacement?: NativeReplacementApproval;
      collectible?: CollectibleReview;
      nonceOverride?: number;
    } = {}
  ) {
    if (nonceOverride !== undefined && transaction.nonce !== String(nonceOverride))
      throw new NativeTransferError('EXPIRED');
    const intent = inputIntent;
    const asset = collectible?.quote.intent;
    assertTransferIntentEnvelope(transaction, asset ?? intent);
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
    const feeApproval = captureEvmFeeApproval(transaction, context.registrationHash,
      Math.min(Math.floor(this.now()) + EVM_FEE_APPROVAL_LIFETIME_MS,
        collectible?.quote.expiresAtMonotonicMilliseconds ?? Infinity));
    const publicReview: NativeTransferReview = Object.freeze({
      id,
      context,
      from: transaction.from,
      recipient: asset?.recipient ?? intent?.recipient ?? transaction.to,
      amountUnits: asset?.amountUnits ?? intent?.amountUnits ?? transaction.value,
      maximumFeeUnits: feeApproval.maximumFeeUnits,
      totalUnits: feeApproval.maximumTotalUnits,
      gasLimit: transaction.gasLimit,
      maximumFeePerGas: fee,
      priorityFeePerGas:
        transaction.type === 2 ? transaction.maxPriorityFeePerGas : null,
      nonce: transaction.nonce,
      ...(nonceOverride === undefined ? {} : { nonceOverride }),
      retry: false,
      ...(intent ? { intent } : {}),
      ...(asset ? { collectible: asset } : {}),
      ...(replacement ? { replacement: Object.freeze({ mode: replacement.mode, originalHash: replacement.original.hash,
        originalMaximumFeeUnits: replacement.original.maximumFeeUnits }) } : {}),
    });
    this.review = {
      public: publicReview,
      transaction,
      replacement,
      collectible,
      feeApproval,
      expires: feeApproval.expiresAtMonotonicMilliseconds,
    };
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => {
      if (this.review?.public.id === id && !this.active) this.cancel();
    }, Math.max(0, feeApproval.expiresAtMonotonicMilliseconds - this.now()));
    this.publish({
      phase: 'review',
      review: publicReview,
      intent: intent ?? null,
      collectible: asset,
      inspectionOnly: false,
      hash: null,
      message: null,
    });
  }
  prepareCancellation(hash: string): Promise<void> {
    return this.prepareReplacement(hash, 'cancel');
  }
  prepareSavedCancellation(hash: string): Promise<void> {
    return this.prepareReplacement(hash, 'cancel-saved');
  }
  prepareSpeedUp(hash: string): Promise<void> {
    return this.prepareReplacement(hash, 'speed-up');
  }
  private prepareReplacement(hash: string, action: NativeReplacementMode | 'cancel-saved'): Promise<void> {
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash))
      return Promise.reject(new NativeTransferError('INVALID_INPUT'));
    const mode = action === 'cancel-saved' ? 'cancel' : action;
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      if (!runtime.replacementOriginal) throw new NativeTransferError('NOT_READY');
      this.review = null;
      this.publish({ phase: 'preparing', context, review: null, hash: null, message: null, intent: null,
        collectible: undefined, inspectionOnly: false });
      const original = await runtime.replacementOriginal(hash, mode, assertCurrent, signal);
      if (!original) throw new NativeTransferError('EXPIRED');
      if (mode === 'cancel') {
        const source = action === 'cancel-saved' ? 'saved' : 'pending';
        const prepare = source === 'saved' ? 'prepareSavedCancellation' : 'prepareCancellation';
        const quote = await rpc[prepare](hash, original.rawTransaction, address, signal, assertCurrent, original.rates);
        assertCurrent();
        this.showReview(quote.transaction, undefined, context,
          { replacement: Object.freeze({ mode, source, original: quote.original, feePlan: quote.feePlan, binding: original.binding }) });
      } else {
        const quote = await rpc.prepareSpeedUp(hash, original.rawTransaction, address, signal, assertCurrent, original.rates, original.intent);
        assertCurrent();
        this.showReview(quote.transaction, original.intent, context, { replacement: Object.freeze({ mode, original: quote.original, binding: original.binding }) });
      }
    });
  }
  private async checkDraftNonce(journal: NativeTransferJournalHandle, nonce: string, manual: boolean) {
    try {
      await journal.assertSpendingNonce(Number(nonce));
    } catch (error) {
      if (manual && error instanceof EvmSignedRecordNonceConflict)
        throw new NativeTransferError('NONCE_RETAINED');
      throw error;
    }
  }
  private async rejectDraftNonce(error: unknown, journal: NativeTransferJournalHandle, manual: boolean): Promise<never> {
    if (manual && error instanceof EvmAutomaticNonceUnresolved && error.reason !== 'asset-state') {
      await this.checkDraftNonce(journal, String(error.nonce), true);
      throw new NativeTransferRpcError('REVIEW_REQUIRED');
    }
    throw error;
  }
  prepare(recipient: string, amount: string, nonce?: string): Promise<void> {
    let units: string;
    let to: string;
    let nonceOverride: number | undefined;
    try {
      nonceOverride = parseNonceOverride(nonce);
      units = parseDecimalAmount(amount, 18).toString();
      to = normalizePublicAddress(recipient, 'ethereum');
    } catch (error) {
      return Promise.reject(error instanceof NativeTransferError ? error : new NativeTransferError('INVALID_INPUT'));
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
        collectible: undefined,
        inspectionOnly: false,
      });
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const quote = await rpc.prepare(address, to, units, signal, nonceOverride,
        journal.planAutomaticNonce).catch((error: unknown) =>
          this.rejectDraftNonce(error, journal, nonceOverride !== undefined));
      assertCurrent();
      await this.checkDraftNonce(journal, quote.transaction.nonce, nonceOverride !== undefined);
      assertCurrent();
      this.showReview(quote.transaction, undefined, context, { nonceOverride });
    });
  }
  prepareToken(
    contractAddress: string,
    recipient: string,
    amount: string,
    nonce?: string
  ): Promise<void> {
    let contract: string, to: string;
    let nonceOverride: number | undefined;
    try {
      nonceOverride = parseNonceOverride(nonce);
      contract = normalizeErc20Address(contractAddress);
      to = normalizeErc20Address(recipient);
    } catch (error) {
      return Promise.reject(error instanceof NativeTransferError ? error : new NativeTransferError('INVALID_INPUT'));
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
        collectible: undefined,
        inspectionOnly: false,
      });
      if (!runtime.token) throw new NativeTransferError('NOT_READY');
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
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
      const quote = await rpc.prepareToken(address, intent, signal, undefined, nonceOverride,
        journal.planAutomaticNonce).catch((error: unknown) =>
          this.rejectDraftNonce(error, journal, nonceOverride !== undefined));
      assertCurrent();
      await this.checkDraftNonce(journal, quote.transaction.nonce, nonceOverride !== undefined);
      assertCurrent();
      this.showReview(quote.transaction, intent, context, { nonceOverride });
    });
  }
  prepareCollectible(candidate: SavedCollectible, recipient: string, tokenId: string, amountUnits: string, nonce?: string): Promise<void> {
    let saved: SavedCollectible;
    let nonceOverride: number | undefined;
    try {
      nonceOverride = parseNonceOverride(nonce);
      saved = snapshotSavedCollectible(candidate);
    } catch (error) {
      return Promise.reject(error instanceof NativeTransferError ? error : new NativeTransferError('INVALID_INPUT'));
    }
    const request = Object.freeze({ recipient, tokenId, amountUnits });
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      const network = getNativeNetwork(context.networkId, this.source.getCatalogue?.()?.networks);
      if (!runtime.collectible || network.registrationHash !== context.registrationHash) throw new NativeTransferError('NOT_READY');
      try { snapshotNftTransferSelection({ network, owner: address, saved }, request, network); }
      catch { throw new NativeTransferError('INVALID_INPUT'); }
      this.review = null;
      this.publish({ phase: 'preparing', context, review: null, hash: null, message: null, intent: null, inspectionOnly: false, collectible: undefined });
      assertCurrent();
      const inventory = await runtime.collectible(saved, assertCurrent).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error) {
          if (error.code === 'NOT_READY') throw new NativeTransferError('COLLECTIBLE_CHANGED');
          if (error.code === 'BUSY') {
            assertCurrent();
            this.publish({ phase: 'idle', message: 'Your saved collectibles are updating. Try again.' });
            throw new NativeTransferError('BUSY');
          }
        }
        throw error;
      });
      const assertInventoryCurrent = () => {
        try { inventory.assertCurrent(); }
        catch { throw new NativeTransferError('COLLECTIBLE_CHANGED'); }
      };
      const guard = () => { assertCurrent(); assertInventoryCurrent(); };
      guard();
      const journal = await runtime.journal(guard);
      guard();
      const selection = Object.freeze({ network, owner: address, saved: inventory.collectible });
      const quote = await withNftInventorySignal(signal, inventory.signal, (owned) =>
        rpc.prepareNft(selection, request, owned, guard, nonceOverride, journal.planAutomaticNonce))
        .catch((error: unknown) => {
          guard();
          return this.rejectDraftNonce(error, journal, nonceOverride !== undefined);
        });
      guard();
      await this.checkDraftNonce(journal, quote.envelope.nonce, nonceOverride !== undefined);
      guard();
      this.showReview(quote.envelope, undefined, context, {
        nonceOverride, collectible: Object.freeze({ selection, quote, assertInventoryCurrent, inventorySignal: inventory.signal }),
      });
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
      let result: Awaited<ReturnType<EvmSignedReplay['confirm']>>;
      try { result = await approved.replay!.confirm(reviewId); }
      catch (error) {
        assertCurrent();
        if (!approved.public.collectible || !(error instanceof NativeTransferRpcError || error instanceof EvmReplayError)) throw error;
        this.publish({ phase: 'unknown', review: null, message:
          error instanceof NativeTransferRpcError && error.code === 'INSUFFICIENT_NFT_BALANCE'
            ? 'This account no longer has enough of this collectible to retry.'
            : 'The retry checks failed. Check this saved transfer again before sending.' });
        return;
      }
      assertCurrent();
      this.publish({ phase: result.status === 'submitted' ? 'pending' : 'unknown', review: null, hash: result.hash,
        message: result.status === 'submitted' ? 'Submitted. Waiting for network confirmation.' : 'Submission could not be confirmed. Check this transaction before sending again.' });
    });
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      if (approved.public.context.registrationHash !== context.registrationHash) throw new NativeTransferError('EXPIRED');
      let startedSubmission = false;
      const collectible = approved.collectible;
      const intent = collectible?.quote.intent ?? approved.public.intent;
      let freshCollectible: EvmNftPreparedQuote | undefined;
      const guard = () => {
        assertCurrent();
        if (!startedSubmission) {
          collectible?.assertInventoryCurrent();
          if (!approved.feeApproval) throw new NativeTransferRpcError('REVIEW_REQUIRED');
          try { assertEvmFeeApprovalCurrent(approved.feeApproval, Math.floor(this.now())); }
          catch { throw new NativeTransferRpcError('REVIEW_REQUIRED'); }
        }
      };
      const journal = await runtime.journal(guard);
      guard();
      const ordinary = !approved.replacement;
      const validatesAsset = ordinary && (!!approved.public.intent || !!collectible);
      const planner = journal.planAutomaticNonce;
      this.publish({
        phase: 'signing',
        review: approved.public,
        message: null,
      });
      let rawTransaction: string;
      let transactionHash: string;
      {
        const replacement = approved.replacement;
        let latest: NativeTransferQuote;
        if (replacement) {
          const { original, mode } = replacement;
          const retained = await runtime.replacementOriginal?.(original.hash, mode, guard, signal);
          if (!retained || retained.binding.expectedTipHash !== replacement.binding.expectedTipHash)
            throw new NativeTransferError('EXPIRED');
          latest = mode === 'cancel'
            ? await rpc[replacement.source === 'saved' ? 'prepareSavedCancellation' : 'prepareCancellation'](
              original.hash, retained.rawTransaction, address, signal, guard, retained.rates)
            : await rpc.prepareSpeedUp(original.hash, retained.rawTransaction, address, signal, guard, retained.rates, retained.intent);
        } else if (collectible) {
          freshCollectible = await withNftInventorySignal(signal, collectible.inventorySignal, (owned) =>
            rpc.requoteNft(collectible.selection, collectible.quote, owned, guard, planner))
            .catch((error: unknown) => { guard(); throw error; });
          latest = { transaction: freshCollectible.envelope, balanceUnits: freshCollectible.balanceUnits,
            totalUnits: freshCollectible.totalUnits, maximumFeeUnits: freshCollectible.maximumFeeUnits };
        } else {
          latest = await rpc.requote(approved.transaction!, signal, approved.public.intent, approved.public.nonceOverride, planner);
        }
        guard();
        if (replacement?.mode !== 'cancel') {
          const refreshed = captureEvmFeeApproval(latest.transaction, context.registrationHash,
            approved.feeApproval!.expiresAtMonotonicMilliseconds);
          const validateRefresh = replacement?.mode === 'speed-up'
            ? assertEvmSpeedUpFeeRefreshApproved : assertEvmFeeRefreshApproved;
          try { validateRefresh(approved.feeApproval!, refreshed, Math.floor(this.now())); }
          catch { throw new NativeTransferError('EXPIRED'); }
        } else if (
          (latest.transaction.type !== approved.transaction!.type ||
            (latest.transaction.type === 2 && approved.transaction!.type === 2 &&
              BigInt(latest.transaction.maxPriorityFeePerGas) > BigInt(approved.transaction!.maxPriorityFeePerGas))) ||
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
            { assertCurrent: guard, signal },
            intent,
            replacement
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
      let dispatchVerified = false;
      const validateDispatch = ordinary;
      const assertDispatchAdmission = validateDispatch ? () => {
        guard();
        if (!dispatchVerified) throw new NativeTransferRpcError('REVIEW_REQUIRED');
      } : undefined;
      const verifyDispatch: NativeTransferDispatchValidation | undefined = validateDispatch
        ? async (heldPlanner, assertAdmission) => {
          const check = () => { guard(); assertAdmission(); };
          const verify = (owned: AbortSignal) =>
            rpc.verifyForDispatch(approved.transaction!, owned, check, heldPlanner, freshCollectible, approved.public.intent, approved.public.nonceOverride);
          if (collectible) {
            if (!freshCollectible) throw new NativeTransferError('EXPIRED');
            await withNftInventorySignal(signal, collectible.inventorySignal, verify);
          } else {
            await verify(signal);
          }
          check();
          dispatchVerified = true;
        }
        : undefined;
      try {
        await runtime.submit(
          rawTransaction,
          transactionHash,
          guard,
          { verifyChain: () => rpc.verifyChain(signal, guard),
          broadcast: ({ rawTransaction: approvedBytes, admit }) => {
            if (collectible) {
              if (!freshCollectible) throw new NativeTransferError('EXPIRED');
              return rpc.broadcast(approvedBytes, transactionHash, signal, {
                mode: 'collectible', approval: freshCollectible, assertCurrent: guard,
                inventorySignal: collectible.inventorySignal, onDispatch: () => { guard(); startedSubmission = true; },
                assertDispatchAdmission: assertDispatchAdmission!, admit,
              }).catch((error: unknown) => { if (!startedSubmission) guard(); throw error; });
            }
            const atDispatch: typeof admit = (send, preflight) => admit(() => {
              guard();
              assertDispatchAdmission?.();
              startedSubmission = true;
              return send();
            }, preflight);
            return rpc.broadcast(approvedBytes, transactionHash, signal, approved.replacement ? {
              mode: approved.replacement.mode === 'cancel' && approved.replacement.source === 'saved'
                ? 'cancel-saved' : approved.replacement.mode,
              original: approved.replacement.original,
              ...(approved.replacement.mode === 'speed-up' && approved.public.intent ? { intent: approved.public.intent } : {}),
              admit: atDispatch,
            } : {
              mode: 'new-send',
              nonceOverride: approved.public.nonceOverride,
              intent: approved.public.intent,
              assertDispatchAdmission: assertDispatchAdmission!,
              admit: atDispatch,
            });
          } },
          intent,
          approved.transaction!,
          approved.replacement,
          verifyDispatch
        );
      } catch (error) {
        // Durable uncertainty must reach the captured authority even if the
        // storage adapter simultaneously revoked the session.
        if (error instanceof TransferJournalError && error.code === 'REOPEN_REQUIRED') throw error;
        assertCurrent();
        if (error instanceof EvmSignedRecordCancellationFence ||
            error instanceof EvmSignedRecordNonceConflict) throw error;
        if (consumeSignedEvmCapacityRefusal(error, runtime.evmSubmissionFailure)) {
          if (!startedSubmission) {
            // The new signed bytes were not committed. Keep the separately
            // authenticated original visible for replacement recovery.
            if (approved.replacement) this.publish({ hash: approved.replacement.original.hash });
            const classified = new NativeTransferError('SIGNED_STORAGE_FULL');
            nativeCapacityRefusals.add(classified);
            throw classified;
          }
          // Once a POST started, do not rely on any no-broadcast marker.
          this.publish({ phase: 'unknown', review: null, hash: transactionHash,
            message: 'Submission may have completed. Check this transaction before sending again.' });
          return;
        }
        if (!startedSubmission) {
          // A signature alone does not prove the signed record was committed.
          // Check under the wallet owner, since the review may have expired.
          const recovery = await runtime.journal(assertCurrent);
          const saved = await recovery.load(transactionHash);
          assertCurrent();
          if (saved?.hash === transactionHash && saved.rawTransaction === rawTransaction &&
              (!collectible || saved.collectible)) {
            this.publish({ hash: transactionHash });
            if (validatesAsset && error instanceof NativeTransferRpcError) {
              switch (error.code) {
                case 'INSUFFICIENT_BALANCE':
                case 'INSUFFICIENT_TOKEN_BALANCE':
                case 'INSUFFICIENT_NFT_BALANCE':
                case 'TOKEN_CHANGED':
                case 'TOKEN_TRANSFER_REJECTED':
                case 'NFT_TRANSFER_REJECTED':
                  nativeSavedAssetFailures.set(error, new NativeTransferError(error.code));
                  break;
                case 'REVIEW_REQUIRED':
                  nativeSavedAssetFailures.set(error, new NativeTransferError('EXPIRED'));
              }
            }
          }
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
    expected: EvmUnsignedTransfer,
    signed: Readonly<{ rawTransaction: string; hash: string }>
  ) {
    if (
      typeof signed.rawTransaction !== 'string' ||
      signed.rawTransaction.length > 4096
    )
      throw new Error('Invalid signed transfer');
    let tx: Transaction;
    try {
      tx = assertSignedEvmTransactionMatches(
        signed.rawTransaction,
        unsignedTransferBytes(expected),
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
      this.publish({ phase: 'preparing', context, review: null, hash: null, message: null,
        intent: null, collectible: undefined, inspectionOnly: false });
      assertCurrent();
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
        observe: ({ hash, from, to, nonce }) => {
          // Replay calls this only after the selected record is authenticated for
          // the current wallet and network. Keep its identity if the RPC read fails.
          current();
          if (this.snapshot.hash !== hash) this.publish({ hash });
          current();
          return rpc.observation({ hash, from, to, nonce }, abort.signal);
        },
        dispatch: (raw, admit, context) => rpc.broadcast(raw, context.hash, abort.signal, { mode: 'replay', admit, context }),
      }, { now: this.now, randomBytes: this.randomBytes });
      this.replay = replay;
      const result = await replay.prepare(selected); assertCurrent();
      if (result.status !== 'review') {
        const transfer = result.transaction.tokenTransfer, token = transfer?.token;
        const intent: Erc20TransferIntent | undefined = token ? Object.freeze({kind:'erc20-transfer',chainId:result.transaction.chainId,token,recipient:transfer!.recipient,amountUnits:transfer!.amountUnits}) : undefined;
        this.publish({ phase: result.status, hash: result.hash, review: null, intent: intent ?? null,
          collectible: result.transaction.collectibleTransfer,
          message: result.status === 'confirmed' && result.transaction.collectibleTransfer
            ? 'Transaction confirmed.' : this.terminalMessage(result.status, intent, context) }); return;
      }
      const approved = result.review;
      const collectible = approved.collectibleTransfer;
      if (isCollectibleRecord(approved.operation) && !collectible) {
        replay.cancel(approved.id);
        this.publish({ phase: 'unknown', hash: approved.hash, review: null, intent: null, inspectionOnly: true,
          message: 'View the saved collectible transfer in Activity.' });
        return;
      }
      if (!offerRetry) {
        replay.cancel(approved.id);
        this.publish({ phase: 'unknown', hash: approved.hash, review: null, collectible,
          message: 'No current receipt was found. The saved transaction remains available; check its status before sending again.' });
        assertCurrent();
        return;
      }
      const token = approved.tokenTransfer?.token;
      const intent: Erc20TransferIntent | undefined = token ? Object.freeze({kind:'erc20-transfer',chainId:approved.chainId,token,recipient:approved.tokenTransfer!.recipient,amountUnits:approved.tokenTransfer!.amountUnits}) : undefined;
      const publicReview: NativeTransferReview = Object.freeze({ id:approved.id,context,from:approved.from,recipient:collectible?.recipient ?? approved.tokenTransfer?.recipient ?? approved.to ?? 'Contract creation',
        amountUnits:collectible?.amountUnits ?? intent?.amountUnits ?? approved.value, maximumFeeUnits:approved.maximumFee,totalUnits:(BigInt(approved.value)+BigInt(approved.maximumFee)).toString(),
        gasLimit:approved.gasLimit,maximumFeePerGas:approved.feePerGas,priorityFeePerGas:approved.priorityFeePerGas,nonce:approved.nonce,retry:true,replay:approved,...(intent?{intent}:{}),...(collectible?{collectible}:{}) });
      this.review = { public:publicReview,expires:this.now()+approved.validForMs,replay };
      if (this.expiry !== null) clearTimeout(this.expiry);
      this.expiry=setTimeout(()=>{if(this.review?.public.id===approved.id&&!this.active)this.cancel();},approved.validForMs);
      this.publish({phase:'review',hash:approved.hash,review:publicReview,intent:intent??null,collectible,message:'Resend the saved signed transaction.'});
      assertCurrent();
    });
  }
}
