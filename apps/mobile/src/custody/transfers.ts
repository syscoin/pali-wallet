import type { EvmAutoNonceSnapshot } from '../../../../source/shared/evmAutoNonce.ts';
import { AUTOMATIC_FEE, snapshotEvmFeeChoice, type EvmFeeChoice, type EvmFeeRates } from '../../../../source/shared/transactionFeeChoice.ts';
import { Transaction } from 'ethers/transaction';
import { EVM_SIGNED_RECORD_LIMITS } from '../../../../source/shared/evmSignedRecordLimits.ts';
import { assertSignedEvmTransactionMatches, type EvmSignedBroadcast } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { EvmSignedRecordCancellationFence, EvmSignedRecordNonceConflict, consumeSignedEvmCapacityRefusal, type EvmReplacementRates, type EvmVerifiedReplacementBinding } from '../../../../source/wallet/evmSignedRecords.ts';
import { assertEvmFeeApprovalCurrent, assertEvmFeeRefreshApproved, assertEvmSpeedUpFeeRefreshApproved, captureEvmFeeApproval,
  EVM_FEE_APPROVAL_LIFETIME_MS, type EvmFeeApproval } from '../../../../source/shared/evmFeeApproval.ts';
import type { EvmCancellationQuote, EvmNftPreparedQuote, NativeAutomaticNoncePlanner } from './evmTransferReadRpc.ts';
import { EvmAutomaticNonceUnresolved, unsignedTransferBytes, type EvmUnsignedTransfer } from './evmFeeContracts.ts';
import { parseDecimalAmount } from '../core/amounts.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import type { CustodySnapshot, NativeOperationCredential, NativeOperationAuthorization } from './types.ts';
import {
  TransferJournalError,
} from './transferJournal.ts';
import type { TransferJournalEntry } from './transferJournal.ts';
import { assertSpeedUpEnvelope, NativeTransferRpc, NativeTransferRpcError, type NativeReplacementMode, type NativeReplacementOriginal, type NativeTransferQuote } from './transferRpc.ts';
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
import { nativeEvmMaximumReserve } from '../../../../source/shared/evmNativeMaximum.ts';


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
  intent?: Erc20TransferIntent;
  collectible?: NftTransferIntent;
  replacement?: Readonly<{ mode: NativeReplacementMode; originalHash: string; originalMaximumFeeUnits: string }>;
  execution?: Readonly<{ kind: 'transfer' | 'contract-call' | 'contract-creation'; dataBytes: number; accessListEntries: number; smartAccount?: string }>;
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
  /** Present only when the outcome hash belongs to these verified signed bytes. */
  receiptReview?: NativeTransferReview;
  hash: string | null;
  message: string | null;
  intent: Erc20TransferIntent | null;
  collectible?: NftTransferIntent;
}>;
export interface NativeTransferJournalHandle {
  planAutomaticNonce: NativeAutomaticNoncePlanner;
  assertSpendingNonce(nonce: number): Promise<void>;
  load(hash?: string): Promise<TransferJournalEntry | null>;
  saveSigned(rawTransaction:string,intent?:Erc20TransferIntent):Promise<TransferJournalEntry>;
  transition(hash:string,phase:Exclude<TransferJournalEntry['phase'],'signed'>):Promise<TransferJournalEntry>;
}
export type NativeTransferDispatchValidation = (planner: NativeAutomaticNoncePlanner, assertCurrent: () => void, snapshot?: EvmAutoNonceSnapshot) => Promise<void>;
export interface NativeTransferRuntime {
  isAuthenticationRefusal(error: unknown): boolean;
  authorizeOperation(credential: NativeOperationCredential, transaction: EvmUnsignedTransfer, assertCurrent: () => void): Promise<NativeOperationAuthorization>;
  releaseOperationAuthorization(authorization: NativeOperationAuthorization): void;
  evmSubmissionFailure?(error: unknown): Readonly<{ transactionNotBroadcast: boolean; signedTransactionHash?: string }> | undefined;
  token?(contractAddress: string, assertCurrent: () => void): Promise<Erc20Metadata>;
  collectible?(candidate: SavedCollectible, assertCurrent: () => void): Promise<Readonly<{
    collectible: SavedCollectible;
    assertCurrent: () => void;
    signal: AbortSignal;
  }>>;
  replacementOriginal?(hash: string, mode: NativeReplacementMode, assertCurrent: () => void, signal: AbortSignal, includeReviewBalance?: boolean):
    Promise<NativeReplacementSource | null>;
  releaseReplacement(): void;
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
    authority: Readonly<{ assertCurrent(): void; signal: AbortSignal; authorization: NativeOperationAuthorization }>,
    intent?: NativeAssetTransferIntent,
    replacement?: NativeReplacementApproval
  ): Promise<Readonly<{ rawTransaction: string; hash: string }>>;
}
type NativeReplacementSource = Readonly<{
  binding: EvmVerifiedReplacementBinding;
  rates: EvmReplacementRates;
  intent?: Erc20TransferIntent;
  collectible?: NftTransferIntent;
  smartAccount?: string;
  retainedSmartSpeedUp?: true;
  balanceSnapshot?: EvmAutoNonceSnapshot;
} & ({ rawTransaction: string; unsignedTransaction?: never } | { unsignedTransaction: string; from: string; rawTransaction?: never })>;
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
export const ASSET_STATE_SAVED_MESSAGE = 'Your transaction was signed but not submitted. Check Activity before trying again.';

export class NativeTransferError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'BUSY'
    | 'NOT_READY'
    | 'INVALID_CREDENTIAL'
    | 'AUTH_THROTTLED'
    | 'DEVICE_UNLOCK_UNAVAILABLE'
    | 'INVALID_INPUT'
    | 'INVALID_NONCE'
    | 'NONCE_UNAVAILABLE'
    | 'CANCELLATION_QUEUED'
    | 'NONCE_RETAINED'
    | 'EXPIRED'
    | 'ASSET_STATE_WAIT'
    | 'SIGNED_STORAGE_FULL'
    | 'PENDING_TRANSFER'
    | 'MAX_PENDING'
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
    | 'feeRecommendations'
    | 'prepareMaximum'
    | 'prepareCancellation'
    | 'prepareSavedCancellation'
    | 'prepareSpeedUp'
    | 'prepareToken'
    | 'prepareCollectible'
    | 'confirm'
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
  replacement?: NativeReplacementApproval;
  collectible?: CollectibleReview;
};
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
    prepare: (recipient: string, amount: string, nonce?: string, feeChoice?: EvmFeeChoice) =>
      this.prepare(recipient, amount, nonce, feeChoice),
    feeRecommendations: (signal?: AbortSignal) => this.feeRecommendations(signal),
    prepareMaximum: (recipient: string, nonce?: string, feeChoice?: EvmFeeChoice) => this.prepareMaximum(recipient, nonce, feeChoice),
    prepareCancellation: (hash: string) => this.prepareCancellation(hash),
    prepareSavedCancellation: (hash: string) => this.prepareSavedCancellation(hash),
    prepareSpeedUp: (hash: string) => this.prepareSpeedUp(hash),
    prepareToken: (contract: string, recipient: string, amount: string, nonce?: string, feeChoice?: EvmFeeChoice) =>
      this.prepareToken(contract, recipient, amount, nonce, feeChoice),
    prepareCollectible: (saved: SavedCollectible, recipient: string, tokenId: string, amountUnits: string, nonce?: string, feeChoice?: EvmFeeChoice) =>
      this.prepareCollectible(saved, recipient, tokenId, amountUnits, nonce, feeChoice),
    confirm: (id: string, credential: NativeOperationCredential) => this.confirm(id, credential),
  });
  private snapshot: NativeTransferSnapshot = initial();
  private listeners = new Set<(snapshot: NativeTransferSnapshot) => void>();
  private review: PrivateReview | null = null;
  private active = false;
  private activeWork: Promise<void> | null = null;
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
    // Recovery hashes can belong to an earlier payment. Only the signing path
    // supplies receipt details alongside the hash for its own verified bytes.
    const next = Object.freeze({
      ...this.snapshot,
      ...(update.hash !== undefined ? { receiptReview: undefined } : {}),
      ...update,
    });
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
    this.runtime()?.releaseReplacement();
    this.generation++;
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
    this.runtime()?.releaseReplacement();
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
    const operation = {}, runtime = this.runtime();
    this.secretOperation = operation;
    try {
      return await work();
    } catch (error) {
      // Runtime failures retire the SDK session. Revoke custody before releasing
      // the marker, even if cancel runs before the outer transfer catch.
      if (this.secretOperation === operation && !(runtime && runtime === this.runtime() && runtime.isAuthenticationRefusal(error))) this.revokeSecretOperation();
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
        if (runtime.isAuthenticationRefusal(error) && this.review) {
          this.publish({ phase: 'review', review: this.review.public, message: null });
          throw new NativeTransferError(error instanceof Error && error.message === 'DEVICE_UNLOCK_UNAVAILABLE' ? 'DEVICE_UNLOCK_UNAVAILABLE' : 'CANCELLED');
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
        if ((error instanceof NativeTransferError || error instanceof NativeTransferRpcError) && error.code === 'MAX_PENDING') {
          this.publish({ phase: 'idle', review: null, message: 'MAX is unavailable while an outgoing transaction is pending. Check Activity before trying again.' });
          throw new NativeTransferError('MAX_PENDING');
        }
        if (error instanceof NativeTransferError && error.code === 'NONCE_RETAINED') {
          this.publish({ phase: 'idle', review: null });
          throw error;
        }
        if (error instanceof EvmSignedRecordNonceConflict) {
          this.publish({
            phase: 'unknown', hash: error.recoveryHash, review: null,
            intent: null, collectible: undefined,
            message: 'Check the earlier transaction in Activity before sending this payment.',
          });
          throw new NativeTransferError('PENDING_TRANSFER');
        }
        if (error instanceof EvmSignedRecordCancellationFence) {
          const hash = error.recoveryHash;
          this.publish({
            phase: hash ? 'unknown' : 'unavailable',
            hash, review: null, intent: null, collectible: undefined,
            message: hash
              ? 'A saved cancellation uses this nonce. Check Activity before sending again.'
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
              ? this.snapshot.hash ? 'This transaction was not submitted. Check Activity before trying again.'
                : 'Your saved collectibles changed. Open the collectible and try again.'
              : error.code === 'INSUFFICIENT_NFT_BALANCE' ? 'This account does not own enough of this collectible.'
                : 'The collectible contract did not accept this transfer.' });
          throw new NativeTransferError(error.code);
        }
        if (error instanceof NativeTransferRpcError && error.code === 'CANCELLATION_QUEUED') {
          this.publish({
            phase: this.snapshot.hash ? 'unknown' : 'idle', review: null,
            message: this.snapshot.hash
              ? 'This transaction must wait for earlier transactions. Check Activity before trying again.'
              : 'This cancellation must wait for earlier transactions. Check Activity before trying again.',
          });
          throw new NativeTransferError('CANCELLATION_QUEUED');
        }
        if (error instanceof NativeTransferRpcError && error.code === 'NONCE_UNAVAILABLE') {
          this.publish({
            phase: this.snapshot.hash ? 'unknown' : 'idle',
            review: null,
            message: this.snapshot.hash
              ? 'This nonce is no longer available. Check the transaction in Activity.'
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
                ? 'Check this transaction in Activity before sending again.'
                : 'The review expired or network conditions changed. Review the transfer again.',
            });
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
          if (!this.review) runtime.releaseReplacement();
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
    { replacement, collectible, replacementCollectible, smartAccount, nonceOverride }: {
      replacement?: NativeReplacementApproval;
      collectible?: CollectibleReview;
      replacementCollectible?: NftTransferIntent;
      smartAccount?: string;
      nonceOverride?: number;
    } = {}
  ) {
    if (nonceOverride !== undefined && transaction.nonce !== String(nonceOverride))
      throw new NativeTransferError('EXPIRED');
    const intent = inputIntent;
    const asset = collectible?.quote.intent ?? replacementCollectible;
    if (replacement?.mode !== 'speed-up') assertTransferIntentEnvelope(transaction, asset ?? intent);
    else assertSpeedUpEnvelope(replacement.original, transaction);
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
      recipient: asset?.recipient ?? intent?.recipient ?? transaction.to ?? 'Contract creation',
      amountUnits: asset?.amountUnits ?? intent?.amountUnits ?? transaction.value,
      maximumFeeUnits: feeApproval.maximumFeeUnits,
      totalUnits: feeApproval.maximumTotalUnits,
      gasLimit: transaction.gasLimit,
      maximumFeePerGas: fee,
      priorityFeePerGas:
        transaction.type === 2 ? transaction.maxPriorityFeePerGas : null,
      nonce: transaction.nonce,
      ...(nonceOverride === undefined ? {} : { nonceOverride }),
      ...(intent ? { intent } : {}),
      ...(asset ? { collectible: asset } : {}),
      ...(replacement ? { replacement: Object.freeze({ mode: replacement.mode, originalHash: replacement.original.hash,
        originalMaximumFeeUnits: replacement.original.maximumFeeUnits }) } : {}),
      ...(replacement?.mode === 'speed-up' ? { execution: Object.freeze({ kind: transaction.to === null ? 'contract-creation' as const : transaction.data === '0x' ? 'transfer' as const : 'contract-call' as const,
        dataBytes: (transaction.data.length - 2) / 2, accessListEntries: transaction.type === 2 ? transaction.accessList.length : 0, ...(smartAccount ? { smartAccount } : {}) }) } : {}),
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
        collectible: undefined });
      const original = await runtime.replacementOriginal(hash, mode, assertCurrent, signal, mode === 'speed-up');
      if (!original) throw new NativeTransferError('EXPIRED');
      if (mode === 'cancel') {
        const source = action === 'cancel-saved' ? 'saved' : 'pending';
        const quote = await this.quoteCancellation(rpc, hash, original, source, signal, assertCurrent);
        assertCurrent();
        this.showReview(quote.transaction, undefined, context,
          { replacement: Object.freeze({ mode, source, original: quote.original, feePlan: quote.feePlan, binding: original.binding }) });
      } else {
        const quote = await this.quoteSpeedUp(rpc, hash, original, signal, assertCurrent);
        assertCurrent();
        this.showReview(quote.transaction, original.intent, context, { replacement: Object.freeze({ mode, original: quote.original, binding: original.binding }),
          replacementCollectible: original.collectible, smartAccount: original.smartAccount });
      }
    });
  }
  private quoteCancellation(rpc: NativeTransferRpc, hash: string, original: NativeReplacementSource,
    source: 'pending' | 'saved', signal: AbortSignal, check: () => void, approved?: EvmUnsignedTransfer) {
    if (original.unsignedTransaction !== undefined) {
      if (source !== 'pending') throw new NativeTransferError('EXPIRED');
      return rpc.prepareUnsignedCancellation(hash, original.unsignedTransaction, original.from, signal, check, original.rates, approved);
    }
    const prepare = source === 'saved' ? 'prepareSavedCancellation' : 'prepareCancellation';
    return rpc[prepare](hash, original.rawTransaction, Transaction.from(original.rawTransaction).from!, signal, check, original.rates, approved);
  }
  private quoteSpeedUp(rpc: NativeTransferRpc, hash: string, original: NativeReplacementSource, signal: AbortSignal, check: () => void) {
    return original.unsignedTransaction !== undefined
      ? rpc.prepareUnsignedSpeedUp(hash, original.unsignedTransaction, original.from, signal, check, original.rates, original.intent, original.collectible, original.balanceSnapshot)
      : rpc.prepareSpeedUp(hash, original.rawTransaction, Transaction.from(original.rawTransaction).from!, signal, check,
        original.rates, original.intent, original.collectible, original.retainedSmartSpeedUp, original.balanceSnapshot);
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
  async feeRecommendations(external?: AbortSignal): Promise<EvmFeeRates> {
    if (external?.aborted) throw new NativeTransferError('CANCELLED');
    let rates: EvmFeeRates | undefined;
    await this.perform(async ({ rpc, signal, assertCurrent }) => {
      const request = new AbortController();
      const abort = () => request.abort();
      signal.addEventListener('abort', abort, { once: true });
      external?.addEventListener('abort', abort, { once: true });
      try {
        if (external?.aborted) request.abort();
        rates = await rpc.feeRecommendations(request.signal); assertCurrent();
        if (external?.aborted) throw new NativeTransferError('CANCELLED');
      } catch (error) {
        if (external?.aborted) throw new NativeTransferError('CANCELLED');
        throw error;
      } finally {
        signal.removeEventListener('abort', abort); external?.removeEventListener('abort', abort); request.abort();
      }
    });
    if (!rates) throw new NativeTransferError('FAILED');
    return rates;
  }
  prepare(recipient: string, amount: string, nonce?: string, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<void> {
    let units: string;
    let to: string;
    let nonceOverride: number | undefined;
    try {
      feeChoice = snapshotEvmFeeChoice(feeChoice);
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
      });
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const quote = await rpc.prepare(address, to, units, signal, nonceOverride,
        journal.planAutomaticNonce, feeChoice).catch((error: unknown) =>
          this.rejectDraftNonce(error, journal, nonceOverride !== undefined));
      assertCurrent();
      await this.checkDraftNonce(journal, quote.transaction.nonce, nonceOverride !== undefined);
      assertCurrent();
      this.showReview(quote.transaction, undefined, context, { nonceOverride });
    });
  }
  prepareMaximum(recipient: string, nonce?: string, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<void> {
    let to: string;
    let nonceOverride: number | undefined;
    try {
      to = normalizePublicAddress(recipient, 'ethereum');
      feeChoice = snapshotEvmFeeChoice(feeChoice);
      nonceOverride = parseNonceOverride(nonce);
    } catch (error) {
      return Promise.reject(error instanceof NativeTransferError ? error : new NativeTransferError('INVALID_INPUT'));
    }
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      const catalogue = this.source.getCatalogue?.();
      const selected = catalogue?.accounts.find(account => account.id === catalogue.active.accountId);
      if (!selected || selected.address.toLowerCase() !== address.toLowerCase() || catalogue?.active.networkId !== context.networkId ||
        !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(selected.type)) throw new NativeTransferError('NOT_READY');
      const reserve = nativeEvmMaximumReserve(selected.type === 'Ledger' || selected.type === 'Trezor' ? 'hardware' : 'software');
      this.review = null;
      this.publish({ phase: 'preparing', context, review: null, hash: null, message: null, intent: null, collectible: undefined });
      const journal = await runtime.journal(assertCurrent);
      assertCurrent();
      const quote = await rpc.prepareMaximum(address, to, reserve, signal, nonceOverride, journal.planAutomaticNonce, feeChoice)
        .catch((error: unknown) => {
          if (error instanceof EvmAutomaticNonceUnresolved) throw new NativeTransferError('MAX_PENDING');
          return this.rejectDraftNonce(error, journal, nonceOverride !== undefined);
        });
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
    nonce?: string,
    feeChoice: EvmFeeChoice = AUTOMATIC_FEE
  ): Promise<void> {
    let contract: string, to: string;
    let nonceOverride: number | undefined;
    try {
      feeChoice = snapshotEvmFeeChoice(feeChoice);
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
        journal.planAutomaticNonce, feeChoice).catch((error: unknown) =>
          this.rejectDraftNonce(error, journal, nonceOverride !== undefined));
      assertCurrent();
      await this.checkDraftNonce(journal, quote.transaction.nonce, nonceOverride !== undefined);
      assertCurrent();
      this.showReview(quote.transaction, intent, context, { nonceOverride });
    });
  }
  prepareCollectible(candidate: SavedCollectible, recipient: string, tokenId: string, amountUnits: string, nonce?: string, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<void> {
    let saved: SavedCollectible;
    let nonceOverride: number | undefined;
    try {
      feeChoice = snapshotEvmFeeChoice(feeChoice);
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
      this.publish({ phase: 'preparing', context, review: null, hash: null, message: null, intent: null, collectible: undefined });
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
        rpc.prepareNft(selection, request, owned, guard, nonceOverride, journal.planAutomaticNonce, feeChoice))
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
  confirm(reviewId: string, credential: NativeOperationCredential): Promise<void> {
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
    let pendingCredential: NativeOperationCredential | null = credential;
    let authorization: NativeOperationAuthorization | null = null;
    let authorizationRuntime: NativeTransferRuntime | null = null;
    const releaseAuthorization = () => {
      if (authorization && authorizationRuntime) authorizationRuntime.releaseOperationAuthorization(authorization);
      authorization = null; authorizationRuntime = null; pendingCredential = null;
    };
    const consume = () => {
      if (this.review !== approved) return;
      this.review = null;
      if (this.expiry !== null) clearTimeout(this.expiry);
      this.expiry = null;
    };
    const authenticate = async (runtime: NativeTransferRuntime, assertCurrent: () => void, context: NativeSendContext) => {
      let accepted = false;
      const check = () => {
        assertCurrent();
        if ((!accepted && this.review !== approved) || approved.public.context.registrationHash !== context.registrationHash || this.now() >= approved.expires) {
          consume();
          throw new NativeTransferError('EXPIRED');
        }
      };
      check();
      const entered = pendingCredential;
      pendingCredential = null;
      if (!entered) throw new NativeTransferError('INVALID_CREDENTIAL');
      const refusal = await this.runSecretOperation(async () => {
        try {
          authorization = await runtime.authorizeOperation(entered, approved.transaction!, check);
          authorizationRuntime = runtime;
          return null;
        } catch (cause) {
          const code = cause instanceof Error ? cause.message : '';
          if (runtime.isAuthenticationRefusal(cause) === true &&
              (code === 'CANCELLED' || code === 'INVALID_CREDENTIAL' || code === 'AUTH_THROTTLED' || code === 'DEVICE_UNLOCK_UNAVAILABLE'))
            return new NativeTransferError(code);
          throw cause;
        }
      });
      check();
      if (refusal) throw refusal;
      accepted = true;
    };
    return this.perform(async ({ assertCurrent, runtime, signal, address, context, rpc }) => {
      await authenticate(runtime, assertCurrent, context);
      assertCurrent();
      let startedSubmission = false;
      const collectible = approved.collectible;
      const intent = collectible?.quote.intent ?? approved.public.intent ??
        (approved.replacement?.mode === 'speed-up' && approved.replacement.original.retainedUnsigned ? approved.public.collectible : undefined);
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
      const validatesAsset = !!approved.public.intent || !!collectible;
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
          if (!retained || retained.binding.expectedTipHash !== replacement.binding.expectedTipHash ||
              (retained.unsignedTransaction !== undefined) !== (original.retainedUnsigned === true) ||
              retained.retainedSmartSpeedUp !== original.retainedSmartSpeedUp)
            throw new NativeTransferError('EXPIRED');
          latest = mode === 'cancel'
            ? await this.quoteCancellation(rpc, original.hash, retained, replacement.source, signal, guard, approved.transaction)
            : await this.quoteSpeedUp(rpc, original.hash, retained, signal, guard);
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
            { assertCurrent: guard, signal, authorization: authorization! },
            intent,
            replacement
          )
        );
        guard();
        consume();
        this.verifySigned(approved.transaction!, signed);
        rawTransaction = signed.rawTransaction; transactionHash = signed.hash;
      }
      const signedOutcome = { hash: transactionHash, receiptReview: approved.public };
      guard();
      this.publish({
        phase: 'submitting',
        review: approved.public,
        message: null,
      });
      let dispatchVerified = false;
      const assertDispatchAdmission = () => {
        guard();
        if (!dispatchVerified) throw new NativeTransferRpcError('REVIEW_REQUIRED');
      };
      const verifyDispatch: NativeTransferDispatchValidation = async (heldPlanner, assertAdmission, snapshot) => {
        const check = () => { guard(); assertAdmission(); };
        if (approved.replacement) {
          if (!snapshot) throw new NativeTransferError('EXPIRED');
          const { mode, original } = approved.replacement;
          const verifyGas = mode === 'speed-up' && (original.retainedUnsigned === true || original.retainedSmartSpeedUp === true);
          await rpc.verifyReplacementForDispatch(approved.transaction!, signal, check, snapshot, approved.public.intent, approved.public.collectible, mode, rawTransaction, verifyGas);
          check();
          dispatchVerified = true;
          return;
        }
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
        };
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
              assertDispatchAdmission: assertDispatchAdmission!, admit: atDispatch,
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
          this.publish({ phase: 'unknown', review: null, ...signedOutcome,
            message: 'Submission may have completed. Check this transaction before sending again.' });
          return;
        }
        if (!startedSubmission) {
          // A signature alone does not prove the transaction record was committed.
          // Check under the wallet owner, since the review may have expired.
          const recovery = await runtime.journal(assertCurrent);
          const saved = await recovery.load(transactionHash);
          assertCurrent();
          if (saved?.hash === transactionHash &&
              (saved.rawTransaction === rawTransaction || (saved.inspectionOnly && saved.rawTransaction === undefined)) &&
              (!collectible || saved.collectible)) {
            this.publish(signedOutcome);
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
          ...signedOutcome,
          message:
            error instanceof NativeTransferRpcError
              ? 'Submission could not be confirmed. Check this transaction before sending again.'
              : 'Submission may have completed. Check this transaction before sending again.',
        });
        return;
      }
      assertCurrent();
      // An RPC acknowledgement cannot be undone by a local status write.
      this.publish(signedOutcome);
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
        ...signedOutcome,
        message,
      });
    }).finally(releaseAuthorization);
  }
  private verifySigned(
    expected: EvmUnsignedTransfer,
    signed: Readonly<{ rawTransaction: string; hash: string }>
  ) {
    if (
      typeof signed.rawTransaction !== 'string' ||
      signed.rawTransaction.length > EVM_SIGNED_RECORD_LIMITS.bytes * 2 + 2
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
}
