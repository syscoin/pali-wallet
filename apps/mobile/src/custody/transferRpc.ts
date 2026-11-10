import { serializePreparedEvmTransaction, type PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { keccak256 } from 'ethers/crypto';
import { assertEvmGasLimit, EVM_CANCELLATION_GAS_LIMIT } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import type { AdmitEvmSignedDispatch } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { Transaction } from 'ethers/transaction';
import { assertEvmCancellationPayerReady, assertRetainedEvmCancellationReady, EvmCancellationNonceError, EvmCancellationPayerCodeError, isEvmEmptySelfCall, isEvmProtectedEmptySelfCall } from '../../../../source/shared/evmCancellationPayer.ts';
import { assertEvmSpeedUpExecutable } from '../../../../source/shared/evmFeeApproval.ts';
import { decodeRetainedNftTransfer, isRetainedNftReplayEnvelope, type NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import { EVM_SIGNED_RECORD_LIMITS, type EvmReplacementRates } from '../../../../source/wallet/evmSignedRecords.ts';
import { EvmReplayError, type EvmReplayDispatchAdmission, type EvmReplayDispatchContext } from '../../../../source/wallet/evmSignedReplay.ts';
import { EvmObservationError, type EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import { ActivityReceiptError, ActivityReceiptReader } from '../activity/receiptReader.ts';
import { assertBaseUnits } from '../core/amounts.ts';
import {
  encodeErc20Transfer,
  parseErc20Decimals,
} from '../../../../source/shared/erc20.ts';
import {
  assertTransferIntentEnvelope,
  snapshotErc20TransferIntent,
  type Erc20TransferIntent,
} from './transferIntent.ts';
import { EvmAssetStateError, readEvmAssetState, assertEvmAssetStateCanonical, simulateEvmAssetTransfer, type EvmAssetReadMethod, type EvmTransferAsset } from '../../../../source/shared/evmAssetState.ts';
import { EvmTransferReadRpc, type EvmCancellationQuote, type EvmNftPreparedQuote, type NativeAutomaticNoncePlanner } from './evmTransferReadRpc.ts';
import { EvmAutomaticNonceUnresolved, EvmTransferReadError, guardedRead, matchesSendNonce, unsignedTransferBytes, type EvmUnsignedTransfer } from './evmFeeContracts.ts';
import type { NftTransferRequest, NftTransferSelection } from './nftTransferAdmission.ts';
import { withNftInventorySignal } from './nftTransferAdmission.ts';
import { getNativeNetwork, getNativeSendContext, snapshotNativeNetwork, type NativeNetworkRegistration, type EvmNetworkId } from './networkContext.ts';
import {
  boundedResponseText,
  cancelResponseBody,
  parseRpcQuantity,
} from '../platformRpc.ts';

export type NativeTransferQuote = import('./evmTransferReadRpc.ts').EvmPreparedQuote & Readonly<{
  tokenBalanceUnits?: string; intent?: Erc20TransferIntent;
}>;
export type NativeReplacementMode = 'cancel' | 'speed-up';
export type NativeReplacementOriginal = Readonly<{
  hash: string;
  from: string;
  to: string | null;
  valueUnits: string;
  maximumFeeUnits: string;
  data: string;
  nonce: number;
  type: 0 | 2;
  registrationHash: string;
}>;
type NativeReplacementQuote = NativeTransferQuote & Readonly<{ original: NativeReplacementOriginal }>;
type NativeCancellationQuote = EvmCancellationQuote & Readonly<{ original: NativeReplacementOriginal }>;

/** A fee replacement must retain the authenticated original execution. */
export function assertSpeedUpEnvelope(
  original: NativeReplacementOriginal,
  transaction: Readonly<{ from: string; to: string; value: string; data: string; nonce: string; type: number }>
): void {
  if (transaction.from !== original.from || transaction.to !== original.to ||
      transaction.value !== original.valueUnits || transaction.data !== original.data ||
      transaction.nonce !== String(original.nonce) || transaction.type !== original.type)
    throw new NativeTransferRpcError('REVIEW_REQUIRED');
}
export type NativeTransferReceipt = Readonly<
  | { status: 'confirmed' | 'reverted'; blockHash: string; blockNumber: string }
  | { status: 'nonce-consumed' }
>;
type NativeBroadcastAdmission = Readonly<
  | {
      mode: 'new-send';
      nonceOverride?: number;
      intent?: Erc20TransferIntent;
      assertDispatchAdmission: () => void;
      admit: AdmitEvmSignedDispatch<string>;
    }
  | {
      mode: 'cancel' | 'cancel-saved';
      original: NativeReplacementOriginal;
      admit: AdmitEvmSignedDispatch<string>;
    }
  | {
      mode: 'speed-up';
      original: NativeReplacementOriginal;
      intent?: Erc20TransferIntent;
      admit: AdmitEvmSignedDispatch<string>;
    }
  | {
      mode: 'collectible';
      approval: EvmNftPreparedQuote;
      assertCurrent: () => void;
      inventorySignal: AbortSignal;
      onDispatch: () => void;
      assertDispatchAdmission: () => void;
      admit: AdmitEvmSignedDispatch<string>;
    }
  | {
      mode: 'replay';
      admit: EvmReplayDispatchAdmission;
      context: EvmReplayDispatchContext;
    }
>;
class PreDispatchRejection {
  readonly reason: unknown;
  constructor(reason: unknown) {
    this.reason = reason;
  }
}

export class NativeTransferRpcError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'INVALID_RESPONSE'
    | 'UNAVAILABLE'
    | 'REVIEW_REQUIRED'
    | 'NONCE_UNAVAILABLE'
    | 'CANCELLATION_QUEUED'
    | 'MAX_PENDING'
    | 'INSUFFICIENT_BALANCE'
    | 'INSUFFICIENT_TOKEN_BALANCE'
    | 'INSUFFICIENT_NFT_BALANCE'
    | 'NFT_TRANSFER_REJECTED'
    | 'TOKEN_CHANGED'
    | 'TOKEN_TRANSFER_REJECTED';
  constructor(code: NativeTransferRpcError['code']) {
    super(code);
    this.name = 'NativeTransferRpcError';
    this.code = code;
  }
}
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Method =
  | 'eth_chainId'
  | 'eth_getTransactionCount'
  | 'eth_getBalance'
  | 'eth_getBlockByNumber'
  | 'eth_getCode'
  | 'eth_call'
  | 'eth_feeHistory'
  | 'eth_maxPriorityFeePerGas'
  | 'eth_estimateGas'
  | 'eth_sendRawTransaction'
  | 'eth_getTransactionReceipt';
const invalid = (): never => {
  throw new NativeTransferRpcError('INVALID_RESPONSE');
};
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
function checkedHash(value: unknown): string {
  if (typeof value !== 'string' || !hashPattern.test(value)) return invalid();
  return value.toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new NativeTransferRpcError('CANCELLED'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new NativeTransferRpcError('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Only the native transfer authority receives this network capability. */
export class NativeTransferRpc {
  readonly context;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private readonly receiptRpc: EvmTransferReadRpc;
  private readonly registration: NativeNetworkRegistration;
  private readonly activityReceipts: ActivityReceiptReader;
  private sequence = 0;
  constructor(options: ({ networkId: EvmNetworkId; registration?: NativeNetworkRegistration } | { registration: NativeNetworkRegistration; networkId?: EvmNetworkId }) & { fetch?: FetchLike; timeoutMs?: number; monotonicMilliseconds?: () => number }) {
    if (!options || (!options.registration && !options.networkId)) throw new Error('A selected EVM registration is required');
    const registration = snapshotNativeNetwork(options.registration ?? getNativeNetwork(options.networkId!));
    if (options.networkId && options.networkId !== registration.id) throw new Error('Mismatched EVM registration');
    this.context = getNativeSendContext(registration);
    Object.defineProperty(this, 'context', { value: this.context, writable: false, configurable: false });
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 12000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30000
    )
      throw new Error('Invalid transfer RPC timeout');
    this.receiptRpc = new EvmTransferReadRpc(registration, {
      fetch: this.fetcher,
      timeoutMs: this.timeoutMs,
      monotonicMilliseconds: options.monotonicMilliseconds,
    });
    this.registration = registration;
    this.activityReceipts = new ActivityReceiptReader({ fetch: this.fetcher, timeoutMs: this.timeoutMs });
  }
  private async operation<T>(
    external: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (external.aborted) throw new NativeTransferRpcError('CANCELLED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      const result = await abortable(
        work(controller.signal),
        controller.signal
      );
      if (controller.signal.aborted)
        throw new NativeTransferRpcError('CANCELLED');
      return result;
    } catch (error) {
      if (controller.signal.aborted)
        throw new NativeTransferRpcError('CANCELLED');
      if (error instanceof PreDispatchRejection) throw error.reason;
      if (error instanceof NativeTransferRpcError || error instanceof EvmReplayError) throw error;
      if (error instanceof EvmTransferReadError || error instanceof EvmAssetStateError) return this.mapReadError(error);
      throw new NativeTransferRpcError('UNAVAILABLE');
    } finally {
      controller.abort();
      clearTimeout(timer);
      external.removeEventListener('abort', abort);
    }
  }
  private async call(
    method: Method,
    params: readonly unknown[],
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
    const id = ++this.sequence;
    if (!Number.isSafeInteger(id)) return invalid();
    const response = await abortable(
      this.fetcher(this.context.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }),
      signal
    );
    if (method === 'eth_sendRawTransaction' && (response.redirected ||
        (response.url && new URL(response.url).href !== new URL(this.context.rpcUrl).href))) {
      cancelResponseBody(response);
      return invalid();
    }
    if (!response.ok) throw new NativeTransferRpcError('UNAVAILABLE');
    const contentType = response.headers.get('content-type');
    if (
      contentType &&
      !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
        contentType
      )
    )
      return invalid();
    const body = object(
      JSON.parse(
        await boundedResponseText(
          response,
          signal,
          method === 'eth_getBlockByNumber'
            ? 512 * 1024
            : method === 'eth_getCode'
            ? 64 * 1024 + 512
            : 16 * 1024
        )
      )
    );
    if (
      body.jsonrpc !== '2.0' ||
      body.id !== id ||
      Object.prototype.hasOwnProperty.call(body, 'error') ||
      !Object.prototype.hasOwnProperty.call(body, 'result')
    )
      return invalid();
    return body.result;
  }
  async verifyChain(signal: AbortSignal, assertCurrent: () => void): Promise<void> {
    assertCurrent();
    await this.checkChain(signal);
    assertCurrent();
  }
  private async checkChain(signal: AbortSignal): Promise<void> {
    if (parseRpcQuantity(await this.call('eth_chainId', [], signal)) !== BigInt(this.context.chainId))
      return invalid();
  }
  private checkedQuote(quote: NativeTransferQuote): NativeTransferQuote {
    if (BigInt(quote.totalUnits) > BigInt(quote.balanceUnits)) throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
    return quote;
  }
  private async assertPendingOriginal(original: NativeReplacementOriginal, signal: AbortSignal, guard: () => void): Promise<void> {
    const pending = await this.activityReceipts.read(original.hash, original.from, signal, guard, this.registration).catch((error) => {
      if (error instanceof ActivityReceiptError)
        throw new NativeTransferRpcError(error.code === 'CANCELLED' ? 'CANCELLED' : 'REVIEW_REQUIRED');
      throw error;
    });
    if (pending?.status !== 'pending' || pending.hash !== original.hash ||
        pending.from.toLowerCase() !== original.from.toLowerCase() ||
        pending.to?.toLowerCase() !== original.to?.toLowerCase() ||
        pending.nonce !== String(original.nonce) || pending.valueUnits !== original.valueUnits)
      throw new NativeTransferRpcError('REVIEW_REQUIRED');
  }
  private authenticatedOriginal(hash: string, rawTransaction: string, payer: string) {
    const transaction = Transaction.from(rawTransaction);
    const { from, to, nonce, type, value, data } = transaction;
    if (!from || transaction.serialized !== rawTransaction || transaction.hash !== checkedHash(hash) || from.toLowerCase() !== payer.toLowerCase() ||
        transaction.chainId.toString() !== this.context.chainId || (type !== 0 && type !== 2))
      throw new NativeTransferRpcError('REVIEW_REQUIRED');
    const original = Object.freeze({
      hash: transaction.hash, from, to, valueUnits: value.toString(), data, nonce, type,
      maximumFeeUnits: (transaction.gasLimit * (transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n)).toString(),
      registrationHash: this.context.registrationHash,
    });
    return { transaction, original };
  }
  async prepareCancellation(hash: string, rawTransaction: string, payer: string, signal: AbortSignal, guard: () => void,
    rates: EvmReplacementRates): Promise<NativeCancellationQuote> {
    return this.quoteCancellation('pending', hash, rawTransaction, payer, signal, guard, rates);
  }
  async prepareSavedCancellation(hash: string, rawTransaction: string, payer: string, signal: AbortSignal, guard: () => void,
    rates: EvmReplacementRates): Promise<NativeCancellationQuote> {
    return this.quoteCancellation('saved', hash, rawTransaction, payer, signal, guard, rates);
  }
  private async quoteCancellation(source: 'pending' | 'saved', hash: string, rawTransaction: string,
    payer: string, signal: AbortSignal, guard: () => void, rates: EvmReplacementRates): Promise<NativeCancellationQuote> {
    const { transaction, original } = this.authenticatedOriginal(hash, rawTransaction, payer);
    if (source === 'pending') await this.assertPendingOriginal(original, signal, guard);
    const quote = await this.receiptRpc.prepareCancellation(transaction, rates, source, signal, guard)
      .catch((error) => this.mapReadError(error));
    this.checkedQuote(quote);
    return Object.freeze({ ...quote, original });
  }
  async prepareSpeedUp(hash: string, rawTransaction: string, payer: string, signal: AbortSignal, guard: () => void,
    rates: EvmReplacementRates, intent?: Erc20TransferIntent): Promise<NativeReplacementQuote> {
    if (typeof rawTransaction !== 'string' || rawTransaction.length > 4096)
      throw new NativeTransferRpcError('REVIEW_REQUIRED');
    const { transaction, original } = this.authenticatedOriginal(hash, rawTransaction, payer);
    if (!original.to || transaction.accessList?.length || (!intent && original.valueUnits === '0'))
      throw new NativeTransferRpcError('REVIEW_REQUIRED');
    try {
      assertTransferIntentEnvelope({ chainId: this.context.chainId, to: original.to, value: original.valueUnits, data: original.data }, intent);
    } catch { throw new NativeTransferRpcError('REVIEW_REQUIRED'); }
    await this.assertPendingOriginal(original, signal, guard);
    const read = (local: AbortSignal) => this.receiptRpc.prepareSpeedUp(transaction, rates, local, guard);
    const quote = await (intent ? this.quoteToken(payer, intent, signal, (_intent, local) => read(local)) : read(signal))
      .catch((error) => this.mapReadError(error));
    assertSpeedUpEnvelope(original, quote.transaction);
    return Object.freeze({ ...this.checkedQuote(quote), original });
  }
  private mapReadError(error: unknown, asset: 'token' | 'nft' = 'token'): never {
    if (error instanceof EvmAssetStateError) {
      if (error.code === 'INSUFFICIENT_ASSET') throw new NativeTransferRpcError(asset === 'token' ? 'INSUFFICIENT_TOKEN_BALANCE' : 'INSUFFICIENT_NFT_BALANCE');
      if (error.code === 'TRANSFER_REJECTED') throw new NativeTransferRpcError(asset === 'token' ? 'TOKEN_TRANSFER_REJECTED' : 'NFT_TRANSFER_REJECTED');
      throw new NativeTransferRpcError(error.code === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'INVALID_RESPONSE');
    }
    if (error instanceof EvmAutomaticNonceUnresolved) throw error;
    if (error instanceof EvmTransferReadError) {
      if (error.code === 'INSUFFICIENT_BALANCE') throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
      if (error.code === 'INSUFFICIENT_NFT_BALANCE' || error.code === 'NFT_TRANSFER_REJECTED' || error.code === 'TOKEN_CHANGED')
        throw new NativeTransferRpcError(error.code);
      if (error.code === 'REVIEW_REQUIRED' || error.code === 'NONCE_UNAVAILABLE' || error.code === 'CANCELLATION_QUEUED' || error.code === 'MAX_PENDING') throw new NativeTransferRpcError(error.code);
      if (error.code === 'CANCELLED') throw new NativeTransferRpcError('CANCELLED');
      if (error.code === 'INVALID_INPUT' || error.code === 'INVALID_RESPONSE' || error.code === 'PROFILE_CHANGED') throw new NativeTransferRpcError('INVALID_RESPONSE');
    }
    if (error instanceof NativeTransferRpcError) throw error;
    throw new NativeTransferRpcError('UNAVAILABLE');
  }
  prepare(from: string, to: string, valueUnits: string, signal: AbortSignal, nonceOverride: number | undefined,
    automaticNonce: NativeAutomaticNoncePlanner): Promise<NativeTransferQuote> {
    const sender = normalizePublicAddress(from, this.context.networkId);
    const recipient = normalizePublicAddress(to, this.context.networkId);
    const value = assertBaseUnits(valueUnits);
    if (value <= 0n) return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    return this.receiptRpc.prepare({ from: sender, to: recipient, value: value.toString(), data: '0x' }, signal, () => undefined, undefined, nonceOverride, automaticNonce)
      .then((quote) => this.checkedQuote(quote)).catch((error) => this.mapReadError(error));
  }
  prepareMaximum(from: string, to: string, reserveUnits: bigint, signal: AbortSignal, nonceOverride: number | undefined,
    automaticNonce: NativeAutomaticNoncePlanner): Promise<NativeTransferQuote> {
    return this.receiptRpc.prepareMaximum(from, to, reserveUnits, signal, () => undefined, nonceOverride, automaticNonce)
      .then((quote) => this.checkedQuote(quote)).catch((error) => this.mapReadError(error));
  }
  /** Every EVM rechecks the exact reviewed type, fees, nonce and calldata before signing. */
  requote(transaction: NativeTransferQuote['transaction'], signal: AbortSignal, intent: Erc20TransferIntent | undefined,
    nonceOverride: number | undefined, automaticNonce: NativeAutomaticNoncePlanner): Promise<NativeTransferQuote> {
    if (intent) return this.prepareToken(transaction.from, intent, signal, transaction, nonceOverride, automaticNonce);
    try { assertTransferIntentEnvelope(transaction); } catch { return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE')); }
    return this.receiptRpc.prepare({ from: transaction.from, to: transaction.to, value: transaction.value, data: transaction.data }, signal, () => undefined, transaction, nonceOverride, automaticNonce)
      .then((quote) => this.checkedQuote(quote)).catch((error) => this.mapReadError(error));
  }
  prepareToken(from: string, input: Erc20TransferIntent, signal: AbortSignal,
    approved: NativeTransferQuote['transaction'] | undefined, nonceOverride: number | undefined, planner: NativeAutomaticNoncePlanner): Promise<NativeTransferQuote> {
    const intent = snapshotErc20TransferIntent(input);
    const sender = normalizePublicAddress(from, this.context.networkId);
    if (intent.chainId !== this.context.chainId) return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    const asset: EvmTransferAsset = { standard: 'ERC20', contractAddress: intent.token.contractAddress, amountUnits: intent.amountUnits };
    return this.receiptRpc.prepare({ from: sender, to: asset.contractAddress, value: '0', data: encodeErc20Transfer(intent.recipient, intent.amountUnits) },
      signal, () => undefined, approved, nonceOverride, planner, asset, intent.token.decimals)
      .then((quote) => Object.freeze({ ...this.checkedQuote(quote), intent, tokenBalanceUnits: quote.assetBalanceUnits! }))
      .catch((error) => this.mapReadError(error));
  }
  prepareNft(selection: NftTransferSelection, request: NftTransferRequest, signal: AbortSignal,
    assertCurrent: () => void, nonceOverride: number | undefined, automaticNonce: NativeAutomaticNoncePlanner): Promise<EvmNftPreparedQuote> {
    return this.receiptRpc.prepareNft(selection, request, signal, assertCurrent, nonceOverride, automaticNonce).catch((error) => this.mapReadError(error, 'nft'));
  }
  requoteNft(selection: NftTransferSelection, approval: EvmNftPreparedQuote, signal: AbortSignal,
    assertCurrent: () => void, automaticNonce: NativeAutomaticNoncePlanner): Promise<EvmNftPreparedQuote> {
    return this.receiptRpc.requoteNft(selection, approval, signal, assertCurrent, automaticNonce).catch((error) => this.mapReadError(error, 'nft'));
  }
  async verifyForDispatch(envelope: EvmUnsignedTransfer, signal: AbortSignal, assertCurrent: () => void,
    planner: NativeAutomaticNoncePlanner, collectible?: EvmNftPreparedQuote, intent?: Erc20TransferIntent, nonceOverride?: number): Promise<void> {
    const check = assertCurrent;
    try {
      let asset: EvmTransferAsset | undefined;
      if (collectible) {
        this.receiptRpc.assertNftApproval(collectible, true);
        if (unsignedTransferBytes(collectible.envelope) !== unsignedTransferBytes(envelope))
          throw new NativeTransferRpcError('REVIEW_REQUIRED');
        asset = { standard: collectible.intent.tokenStandard === 'ERC-721' ? 'ERC721' : 'ERC1155',
          contractAddress: collectible.intent.contractAddress, amountUnits: collectible.intent.amountUnits, tokenId: collectible.intent.tokenId };
      } else if (intent) {
        assertTransferIntentEnvelope(envelope, intent);
        asset = { standard: 'ERC20', contractAddress: intent.token.contractAddress, amountUnits: intent.amountUnits };
      } else if (envelope.data !== '0x') {
        throw new NativeTransferRpcError('REVIEW_REQUIRED');
      }
      await this.receiptRpc.verifyForDispatch(envelope, signal, check, planner, asset, nonceOverride, collectible?.intent);
      if (collectible) this.receiptRpc.assertNftApproval(collectible, true);
      check();
    } catch (error) {
      check();
      if (error instanceof EvmAutomaticNonceUnresolved && error.reason === 'asset-state') throw error;
      if (error instanceof EvmAutomaticNonceUnresolved ||
          (error instanceof EvmTransferReadError && error.code === 'INSUFFICIENT_BALANCE'))
        throw new NativeTransferRpcError('REVIEW_REQUIRED');
      this.mapReadError(error, collectible ? 'nft' : 'token');
    }
  }
  private async quoteToken(from: string, input: Erc20TransferIntent, signal: AbortSignal,
    readQuote: (intent: Erc20TransferIntent, signal: AbortSignal) => Promise<NativeTransferQuote>): Promise<NativeTransferQuote> {
    const intent = snapshotErc20TransferIntent(input);
    return this.operation(signal, async (owned) => {
      const read = (method: EvmAssetReadMethod, params: readonly unknown[]) => this.call(method, params, owned);
      await this.checkChain(owned);
      const state = await readEvmAssetState(read, from, { standard: 'ERC20', contractAddress: intent.token.contractAddress, amountUnits: intent.amountUnits });
      if (state.balanceUnits < BigInt(intent.amountUnits)) throw new NativeTransferRpcError('INSUFFICIENT_TOKEN_BALANCE');
      const precision = await read('eth_call', [{ to: state.asset.contractAddress, data: '0x313ce567' }, state.number]);
      if (typeof precision !== 'string' || !/^0x[0-9a-f]{64}$/i.test(precision)) return invalid();
      if (parseErc20Decimals(BigInt(precision)) !== intent.token.decimals) throw new NativeTransferRpcError('TOKEN_CHANGED');
      const quote = await readQuote(intent, owned);
      await simulateEvmAssetTransfer(read, state, quote.transaction, 'manual');
      await assertEvmAssetStateCanonical(read, state);
      await this.checkChain(owned);
      return Object.freeze({ ...this.checkedQuote(quote), intent, tokenBalanceUnits: state.balanceUnits.toString() });
    }).catch((error) => this.mapReadError(error));
  }
  broadcast(
    rawTransaction: string,
    expectedHash: string,
    signal: AbortSignal,
    admission: NativeBroadcastAdmission
  ): Promise<string> {
    if (
      !admission ||
      (admission.mode !== 'new-send' && admission.mode !== 'cancel' && admission.mode !== 'cancel-saved' && admission.mode !== 'speed-up' &&
        admission.mode !== 'collectible' && admission.mode !== 'replay') ||
      ('assertDispatchAdmission' in admission && admission.assertDispatchAdmission !== undefined &&
        (typeof admission.assertDispatchAdmission !== 'function' ||
          (admission.mode !== 'new-send' && admission.mode !== 'collectible'))) ||
      (admission.mode === 'collectible'
        ? !admission.approval || !admission.inventorySignal || typeof admission.onDispatch !== 'function' || typeof admission.assertDispatchAdmission !== 'function' ||
          typeof admission.assertCurrent !== 'function' || 'intent' in admission
        : 'approval' in admission || 'assertCurrent' in admission || 'inventorySignal' in admission || 'onDispatch' in admission) ||
      (admission.mode !== 'replay' && (
        typeof admission.admit !== 'function' || 'context' in admission ||
        (admission.mode === 'cancel' || admission.mode === 'cancel-saved' ? !admission.original || 'intent' in admission
          : admission.mode === 'speed-up' ? !admission.original : 'original' in admission)
      )) ||
      (admission.mode === 'replay' && (
        typeof admission.admit !== 'function' || !admission.context ||
        'intent' in admission || 'original' in admission
      ))
    )
      return Promise.reject(new NativeTransferRpcError('REVIEW_REQUIRED'));
    const mode = admission.mode;
    const assertDispatchAdmission = admission.mode === 'new-send' || admission.mode === 'collectible'
      ? admission.assertDispatchAdmission : undefined;
    const nonceOverride = admission.mode === 'new-send' ? admission.nonceOverride : undefined;
    const hash = checkedHash(expectedHash);
    const replay = admission.mode === 'replay'
      ? { admit: admission.admit, context: { ...admission.context } }
      : undefined;
    const admit = admission.mode !== 'replay' ? admission.admit : undefined;
    const intent = admission.mode === 'new-send' || admission.mode === 'speed-up' ? admission.intent : undefined;
    const original = admission.mode === 'cancel' || admission.mode === 'cancel-saved' || admission.mode === 'speed-up'
      ? Object.freeze({ ...admission.original }) : undefined;
    const collectible = admission.mode === 'collectible'
      ? { approval: admission.approval, assertCurrent: admission.assertCurrent,
        inventorySignal: admission.inventorySignal, onDispatch: admission.onDispatch } : undefined;
    let nft: Readonly<{ intent: NftTransferIntent; envelope: EvmUnsignedTransfer }> | undefined;
    let speedUp: Readonly<{ transaction: Transaction; from: string }> | undefined;
    let newSend: Readonly<{ from: string; nonce: number }> | undefined;
    let cancellation: Readonly<{ from: string; nonce: number; operation: string }> | undefined = replay && (replay.context.operation === 'cancel' || replay.context.requiresPayerCheck)
      ? replay.context : undefined;
    if (
      typeof rawTransaction !== 'string' ||
      rawTransaction.length > EVM_SIGNED_RECORD_LIMITS.bytes * 2 + 2 ||
      !/^0x(?:[0-9a-f]{2})+$/.test(rawTransaction) ||
      keccak256(rawTransaction) !== hash
    )
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    try {
      const tx = Transaction.from(rawTransaction);
      if (
        !tx.isSigned() ||
        tx.chainId !== BigInt(this.context.chainId) ||
        tx.serialized !== rawTransaction
      )
        return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
      if (tx.gasLimit < 21000n || tx.gasLimit > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
      if (replay && (replay.context.hash !== hash || replay.context.chainId !== this.context.chainId ||
          replay.context.nonce !== tx.nonce || tx.from?.toLowerCase() !== replay.context.from.toLowerCase())) return invalid();
      if (collectible) {
        const { approval, assertCurrent } = collectible;
        guardedRead(assertCurrent);
        this.receiptRpc.assertNftApproval(approval, true);
        if (tx.from !== approval.intent.from || tx.unsignedSerialized !== unsignedTransferBytes(approval.envelope)) return invalid();
        nft = { intent: approval.intent, envelope: approval.envelope };
      }
      if (replay?.context.operation === 'erc721' || replay?.context.operation === 'erc1155') {
        const owned = decodeRetainedNftTransfer({ ...replay.context, from: replay.context.from.toLowerCase(), rawTransaction }, tx);
        if (!owned || !isRetainedNftReplayEnvelope(tx)) return invalid();
        const fields = { from: owned.from, to: owned.contractAddress, chainId: owned.chainId,
          nonce: String(tx.nonce), value: '0', gasLimit: tx.gasLimit.toString(), data: tx.data };
        const envelope = tx.type === 0 && tx.gasPrice !== null
          ? { ...fields, type: 0 as const, gasPrice: tx.gasPrice.toString() }
          : tx.type === 2 && tx.maxFeePerGas !== null && tx.maxPriorityFeePerGas !== null
            ? { ...fields, type: 2 as const, accessList: [], maxFeePerGas: tx.maxFeePerGas.toString(), maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString() }
            : invalid();
        nft = { intent: owned, envelope };
      }
      if (original) {
        if (!tx.from ||
            original.from.toLowerCase() !== tx.from.toLowerCase() || original.nonce !== tx.nonce ||
            original.type !== tx.type || original.registrationHash !== this.context.registrationHash ||
            checkedHash(original.hash) !== original.hash || original.hash === hash)
          return invalid();
        if (mode === 'cancel' || mode === 'cancel-saved') {
          if (tx.gasLimit !== EVM_CANCELLATION_GAS_LIMIT) return invalid();
          cancellation = { from: tx.from, nonce: tx.nonce, operation: 'cancel' };
        } else {
          if (!tx.to || tx.accessList?.length || (!intent && tx.value === 0n)) return invalid();
          assertSpeedUpEnvelope(original, { from: tx.from, to: tx.to, value: tx.value.toString(), data: tx.data,
            nonce: String(tx.nonce), type: tx.type! });
          if (!intent) assertTransferIntentEnvelope({ chainId: tx.chainId.toString(), to: tx.to, value: tx.value.toString(), data: tx.data });
          const feeRate = tx.maxFeePerGas ?? tx.gasPrice;
          if (!feeRate || (tx.type !== 0 && tx.type !== 2)) return invalid();
        }
      }
      if (mode === 'speed-up' || (replay?.context.operation === 'speed-up' && !replay.context.requiresPayerCheck)) {
        if (!tx.from) return invalid();
        speedUp = { transaction: tx, from: tx.from };
      }
      if (mode === 'new-send') {
        if (typeof assertDispatchAdmission !== 'function') return invalid();
        if (tx.data !== '0x' && (!intent || !assertDispatchAdmission)) return invalid();
        if (!tx.from || isEvmEmptySelfCall(tx) || (nonceOverride !== undefined && tx.nonce !== nonceOverride)) return invalid();
        newSend = { from: tx.from, nonce: tx.nonce };
      }
      if (cancellation && !isEvmProtectedEmptySelfCall(tx, cancellation.operation)) return invalid();
      assertEvmGasLimit(tx.gasLimit, tx.chainId);
      if (intent) assertTransferIntentEnvelope(
        {
          chainId: tx.chainId.toString(),
          to: tx.to!,
          value: tx.value.toString(),
          data: tx.data,
        },
        intent
      );

    } catch (error) {
      if (collectible && error instanceof EvmTransferReadError && (error.code === 'REVIEW_REQUIRED' || error.code === 'CANCELLED'))
        return Promise.reject(new NativeTransferRpcError(error.code));
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    }
    return this.operation(signal, async (local) => {
      let dispatched = false;
      let protectedPreflightComplete = false;
      const assertActive = () => {
        if (local.aborted) throw new NativeTransferRpcError('CANCELLED');
        if (collectible) {
          try {
            guardedRead(collectible.assertCurrent);
            this.receiptRpc.assertNftApproval(collectible.approval, true);
          } catch (error) { this.mapReadError(error); }
        }
      };
      const send = () => {
        assertActive();
        if (assertDispatchAdmission) {
          try { guardedRead(assertDispatchAdmission); } catch { throw new NativeTransferRpcError('REVIEW_REQUIRED'); }
        }
        if (dispatched || ((nft || newSend || mode === 'cancel-saved') && !protectedPreflightComplete))
          throw new NativeTransferRpcError('REVIEW_REQUIRED');
        if (collectible) guardedRead(collectible.onDispatch);
        dispatched = true;
        // No automatic retry: the remote side may accept before a response is lost.
        return this.call('eth_sendRawTransaction', [rawTransaction], local).then((value) => {
          if (checkedHash(value) !== hash) return invalid();
          return hash;
        });
      };
      const preflight = async () => {
        if (assertDispatchAdmission) {
          assertActive();
          protectedPreflightComplete = true;
          return;
        }
        if (nft) {
          const { intent, envelope } = nft;
          const read = (owned: AbortSignal) =>
            this.receiptRpc.verifyNftForDispatch(intent, envelope, owned, assertActive, !!replay, collectible?.approval.nonceOverride)
              .catch((error: unknown) => {
                assertActive();
                return this.mapReadError(error);
              });
          await (collectible ? withNftInventorySignal(local, collectible.inventorySignal, read) : read(local));
          protectedPreflightComplete = true;
          return;
        }
        if (mode === 'cancel-saved' && original) {
          try {
            await assertRetainedEvmCancellationReady({
              chainId: this.context.chainId, from: original.from, to: original.to,
              hash: original.hash, nonce: String(original.nonce),
            }, (method, params) => this.call(method, params, local), assertActive);
          } catch (error) {
            if (error instanceof EvmCancellationNonceError && error.reason === 'queued')
              throw new NativeTransferRpcError('CANCELLATION_QUEUED');
            if (error instanceof EvmObservationError || error instanceof EvmCancellationNonceError ||
                error instanceof EvmCancellationPayerCodeError)
              throw new NativeTransferRpcError('REVIEW_REQUIRED');
            throw error;
          }
          protectedPreflightComplete = true;
          return;
        }
        await this.checkChain(local);
        if (newSend) {
          const manual = nonceOverride !== undefined;
          const nonce = await this.call('eth_getTransactionCount', [newSend.from, manual ? 'latest' : 'pending'], local);
          assertActive();
          if (!matchesSendNonce(parseRpcQuantity(nonce), BigInt(newSend.nonce), manual))
            throw new NativeTransferRpcError(manual ? 'NONCE_UNAVAILABLE' : 'REVIEW_REQUIRED');
          // Prove the chain again after the address-bearing read, at the wire.
          await this.checkChain(local);
          protectedPreflightComplete = true;
          return;
        }
        if (speedUp) {
          if (original) await this.assertPendingOriginal(original, local, assertActive);
          const [rawNonce, rawBlock] = await Promise.all([
            this.call('eth_getTransactionCount', [speedUp.from, 'latest'], local),
            this.call('eth_getBlockByNumber', ['latest', false], local),
          ]);
          try {
            assertEvmSpeedUpExecutable(speedUp.transaction, rawNonce, rawBlock);
          } catch { throw new NativeTransferRpcError('REVIEW_REQUIRED'); }
          await this.checkChain(local);
          return;
        }
        if (!cancellation) return;
        const { from, nonce, operation } = cancellation;
        const assertPayerReady = () =>
          assertEvmCancellationPayerReady(
            from, nonce,
            (method, address, tag) => this.call(method, [address, tag], local),
            assertActive
          ).catch((error) => {
            if (error instanceof EvmCancellationNonceError && error.reason === 'queued' && operation === 'cancel')
              throw new NativeTransferRpcError('CANCELLATION_QUEUED');
            if (error instanceof EvmCancellationNonceError || error instanceof EvmCancellationPayerCodeError)
              throw new NativeTransferRpcError('REVIEW_REQUIRED');
            throw error;
          });
        await assertPayerReady();
        if (original) {
          // Pending identity and payer code can change during separate reads.
          await this.assertPendingOriginal(original, local, assertActive);
          await assertPayerReady();
        }
      };
      if (replay) return replay.admit(send, preflight);
      try {
        return await admit!(send, preflight);
      } catch (error) {
        if (!dispatched) throw new PreDispatchRejection(error);
        throw error;
      }
    });
  }
  /** Dapp calldata uses the same bounded transport and durable SDK admission. */
  broadcastDapp(rawTransaction: string, expectedHash: string, transaction: PreparedEvmTransaction,
    signal: AbortSignal, admit: AdmitEvmSignedDispatch<string>, assertCurrent: () => void,
    onBroadcast: (hash: string) => void): Promise<string> {
    const hash = checkedHash(expectedHash);
    if (typeof admit !== 'function' || typeof onBroadcast !== 'function')
      return Promise.reject(new NativeTransferRpcError('REVIEW_REQUIRED'));
    if (typeof rawTransaction !== 'string' || rawTransaction.length > EVM_SIGNED_RECORD_LIMITS.bytes * 2 + 2 ||
        !/^0x(?:[0-9a-f]{2})+$/.test(rawTransaction))
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    try {
      const signed = Transaction.from(rawTransaction);
      if (!signed.isSigned() || signed.serialized !== rawTransaction || signed.hash !== hash ||
          signed.chainId !== BigInt(this.context.chainId) || signed.from?.toLowerCase() !== transaction.from.toLowerCase() ||
          signed.unsignedSerialized !== serializePreparedEvmTransaction(transaction)) return invalid();
    } catch { return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE')); }
    return this.operation(signal, async (local) => {
      let dispatched = false;
      const check = () => { if (local.aborted) throw new NativeTransferRpcError('CANCELLED'); guardedRead(assertCurrent); };
      try {
        return await admit(() => {
          check();
          if (dispatched) throw new NativeTransferRpcError('REVIEW_REQUIRED');
          dispatched = true;
          guardedRead(() => onBroadcast(hash));
          return this.call('eth_sendRawTransaction', [rawTransaction], local).then((value) => {
            if (checkedHash(value) !== hash) return invalid();
            return hash;
          });
        }, async () => { check(); await this.checkChain(local); check(); });
      } catch (error) {
        if (!dispatched) throw new PreDispatchRejection(error);
        throw error;
      }
    });
  }

  receipt(
    expected: Readonly<{
      hash: string;
      from: string;
      to: string | null;
      nonce: string;
    }>,
    signal: AbortSignal
  ): Promise<NativeTransferReceipt | null> {
    return this.receiptRpc
      .receipt(expected, signal, () => undefined)
      .then((observation) => {
        if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
        if (!observation) return null;
        if (observation.status === 'nonce-consumed') return Object.freeze({ status: 'nonce-consumed' as const });
        return Object.freeze({ status: observation.outcome === 'succeeded' ? 'confirmed' as const : 'reverted' as const,
          blockHash: observation.block.hash, blockNumber: observation.block.number });
      })
      .catch((error: unknown) => {
        // A read deadline is an unavailable observation, not user cancellation.
        // Only the caller's actual abort signal admits CANCELLED here.
        if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
        if (
          error instanceof EvmTransferReadError &&
          ['INVALID_INPUT', 'INVALID_RESPONSE', 'PROFILE_CHANGED'].includes(
            error.code
          )
        )
          throw new NativeTransferRpcError('INVALID_RESPONSE');
        if (error instanceof NativeTransferRpcError) throw error;
        throw new NativeTransferRpcError('UNAVAILABLE');
      });
  }
  observation(expected: Readonly<{ hash: string; from: string; to: string | null; nonce: string }>, signal: AbortSignal): Promise<EvmTransactionObservation> {
    return this.receiptRpc.observation(expected, signal, () => {
      if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
    }).catch(error => this.mapReadError(error));
  }
}
