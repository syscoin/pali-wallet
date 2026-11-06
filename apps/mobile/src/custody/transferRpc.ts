import { keccak256 } from 'ethers/crypto';
import { assertEvmGasLimit, EVM_CANCELLATION_GAS_LIMIT } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { Transaction } from 'ethers/transaction';
import { assertEvmCancellationPayerReady, EvmCancellationNonceError, EvmCancellationPayerCodeError, isEvmEmptySelfCall, isEvmProtectedEmptySelfCall } from '../../../../source/shared/evmCancellationPayer.ts';
import { EVM_SIGNED_RECORD_LIMITS } from '../../../../source/wallet/evmSignedRecords.ts';
import { EvmReplayError, type EvmReplayDispatchAdmission, type EvmReplayDispatchContext } from '../../../../source/wallet/evmSignedReplay.ts';
import type { EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import { ActivityReceiptError, ActivityReceiptReader } from '../activity/receiptReader.ts';
import { assertBaseUnits } from '../core/amounts.ts';
import {
  encodeErc20Transfer,
  parseErc20Decimals,
  parseErc20Units,
} from '../../../../source/shared/erc20.ts';
import {
  assertTransferIntentEnvelope,
  snapshotErc20TransferIntent,
  type Erc20TransferIntent,
} from './transferIntent.ts';
import { EvmTransferReadRpc, type EvmCancellationQuote } from './evmTransferReadRpc.ts';
import { EvmTransferReadError } from './evmFeeContracts.ts';
import { getNativeNetwork, getNativeSendContext, snapshotNativeNetwork, type NativeNetworkRegistration, type EvmNetworkId } from './networkContext.ts';
import {
  boundedResponseText,
  parseRpcQuantity,
} from '../platformRpc.ts';

export type NativeTransferQuote = import('./evmTransferReadRpc.ts').EvmPreparedQuote & Readonly<{
  tokenBalanceUnits?: string; intent?: Erc20TransferIntent;
}>;
export type NativeCancellationOriginal = Readonly<{
  hash: string;
  from: string;
  to: string | null;
  valueUnits: string;
  nonce: number;
  type: 0 | 2;
  registrationHash: string;
}>;
type NativeCancellationQuote = EvmCancellationQuote & Readonly<{ original: NativeCancellationOriginal }>;
export type NativeTransferReceipt = Readonly<
  | { status: 'confirmed' | 'reverted'; blockHash: string; blockNumber: string }
  | { status: 'nonce-consumed' }
>;
type NativeBroadcastAdmission = Readonly<
  | {
      mode: 'new-send';
      intent?: Erc20TransferIntent;
      beforeBroadcast: () => undefined;
    }
  | {
      mode: 'cancel';
      original: NativeCancellationOriginal;
      beforeBroadcast: () => undefined;
    }
  | {
      mode: 'replay';
      admit: EvmReplayDispatchAdmission;
      context: EvmReplayDispatchContext;
    }
>;
export class NativeTransferRpcError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'INVALID_RESPONSE'
    | 'UNAVAILABLE'
    | 'REVIEW_REQUIRED'
    | 'INSUFFICIENT_BALANCE'
    | 'INSUFFICIENT_TOKEN_BALANCE'
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
  constructor(options: ({ networkId: EvmNetworkId; registration?: NativeNetworkRegistration } | { registration: NativeNetworkRegistration; networkId?: EvmNetworkId }) & { fetch?: FetchLike; timeoutMs?: number }) {
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
      if (error instanceof NativeTransferRpcError || error instanceof EvmReplayError) throw error;
      if (error instanceof EvmTransferReadError) return this.mapReadError(error);
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
  private async checkChain(signal: AbortSignal): Promise<void> {
    if (parseRpcQuantity(await this.call('eth_chainId', [], signal)) !== BigInt(this.context.chainId))
      return invalid();
  }
  private checkedQuote(quote: NativeTransferQuote): NativeTransferQuote {
    if (BigInt(quote.totalUnits) > BigInt(quote.balanceUnits)) throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
    return quote;
  }
  private async assertPendingOriginal(original: NativeCancellationOriginal, signal: AbortSignal, guard: () => void): Promise<void> {
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
  async prepareCancellation(hash: string, rawTransaction: string, payer: string, signal: AbortSignal, guard: () => void): Promise<NativeCancellationQuote> {
    const transaction = Transaction.from(rawTransaction);
    const { from, to, nonce, type, value } = transaction;
    if (!from || transaction.hash !== checkedHash(hash) || from.toLowerCase() !== payer.toLowerCase() ||
        transaction.chainId.toString() !== this.context.chainId || (type !== 0 && type !== 2))
      throw new NativeTransferRpcError('REVIEW_REQUIRED');
    const original = Object.freeze({
      hash: transaction.hash, from, to, valueUnits: value.toString(), nonce, type,
      registrationHash: this.context.registrationHash,
    });
    await this.assertPendingOriginal(original, signal, guard);
    const quote = await this.receiptRpc.prepareCancellation(transaction, signal, guard)
      .catch((error) => this.mapReadError(error));
    this.checkedQuote(quote);
    return Object.freeze({ ...quote, original });
  }
  private mapReadError(error: unknown): never {
    if (error instanceof EvmTransferReadError) {
      if (error.code === 'REVIEW_REQUIRED') throw new NativeTransferRpcError('REVIEW_REQUIRED');
      if (error.code === 'CANCELLED') throw new NativeTransferRpcError('CANCELLED');
      if (error.code === 'INVALID_INPUT' || error.code === 'INVALID_RESPONSE' || error.code === 'PROFILE_CHANGED') throw new NativeTransferRpcError('INVALID_RESPONSE');
    }
    if (error instanceof NativeTransferRpcError) throw error;
    throw new NativeTransferRpcError('UNAVAILABLE');
  }
  prepare(from: string, to: string, valueUnits: string, signal: AbortSignal): Promise<NativeTransferQuote> {
    const sender = normalizePublicAddress(from, this.context.networkId);
    const recipient = normalizePublicAddress(to, this.context.networkId);
    const value = assertBaseUnits(valueUnits);
    if (value <= 0n) return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    return this.receiptRpc.prepare({ from: sender, to: recipient, value: value.toString(), data: '0x' }, signal, () => undefined)
      .then((quote) => this.checkedQuote(quote)).catch((error) => this.mapReadError(error));
  }
  /** Every EVM rechecks the exact reviewed type, fees, nonce and calldata before signing. */
  requote(transaction: NativeTransferQuote['transaction'], signal: AbortSignal, intent?: Erc20TransferIntent): Promise<NativeTransferQuote> {
    if (intent) return this.prepareToken(transaction.from, intent, signal, transaction);
    try { assertTransferIntentEnvelope(transaction); } catch { return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE')); }
    return this.receiptRpc.prepare({ from: transaction.from, to: transaction.to, value: transaction.value, data: transaction.data }, signal, () => undefined, transaction)
      .then((quote) => this.checkedQuote(quote)).catch((error) => this.mapReadError(error));
  }
  prepareToken(from: string, input: Erc20TransferIntent, signal: AbortSignal,
    approved?: NativeTransferQuote['transaction']): Promise<NativeTransferQuote> {
    const sender = normalizePublicAddress(from, this.context.networkId);
    const intent = snapshotErc20TransferIntent(input);
    if (intent.chainId !== this.context.chainId) return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    const data = encodeErc20Transfer(intent.recipient, intent.amountUnits);
    const call = Object.freeze({ from: sender, to: intent.token.contractAddress, value: '0x0', data });
    const word = (value: unknown): bigint => {
      if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) return invalid();
      return BigInt(value);
    };
    const block = (value: unknown) => {
      const raw = object(value);
      return { number: `0x${parseRpcQuantity(raw.number).toString(16)}`, hash: checkedHash(raw.hash) };
    };
    return this.operation(signal, async (local) => {
      await this.checkChain(local);
      const observed = block(await this.call('eth_getBlockByNumber', ['latest', false], local));
      const code = await this.call('eth_getCode', [intent.token.contractAddress, observed.number], local);
      if (typeof code !== 'string' || code.length > 65538 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) return invalid();
      const [rawDecimals, rawTokens, simulation, quote] = await Promise.all([
        this.call('eth_call', [{ to: intent.token.contractAddress, data: '0x313ce567' }, observed.number], local),
        this.call('eth_call', [{ to: intent.token.contractAddress, data: `0x70a08231${sender.slice(2).toLowerCase().padStart(64, '0')}` }, observed.number], local),
        this.call('eth_call', [call, observed.number], local),
        this.receiptRpc.prepare({ from: sender, to: intent.token.contractAddress, value: '0', data }, local, () => undefined, approved),
      ]);
      if (simulation !== '0x' && word(simulation) !== 1n) throw new NativeTransferRpcError('TOKEN_TRANSFER_REJECTED');
      let decimals: number;
      try { decimals = parseErc20Decimals(word(rawDecimals)); } catch { return invalid(); }
      if (decimals !== intent.token.decimals) throw new NativeTransferRpcError('TOKEN_CHANGED');
      const tokenBalanceUnits = parseErc20Units(word(rawTokens));
      if (BigInt(tokenBalanceUnits) < BigInt(intent.amountUnits)) throw new NativeTransferRpcError('INSUFFICIENT_TOKEN_BALANCE');
      this.checkedQuote(quote);
      const finalBlock = block(await this.call('eth_getBlockByNumber', [observed.number, false], local));
      if (finalBlock.number !== observed.number || finalBlock.hash !== observed.hash) return invalid();
      await this.checkChain(local);
      return Object.freeze({ ...quote, tokenBalanceUnits, intent });
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
      (admission.mode !== 'new-send' && admission.mode !== 'cancel' && admission.mode !== 'replay') ||
      (admission.mode !== 'replay' && (
        typeof admission.beforeBroadcast !== 'function' ||
        'admit' in admission || 'context' in admission ||
        (admission.mode === 'cancel' ? !admission.original || 'intent' in admission : 'original' in admission)
      )) ||
      (admission.mode === 'replay' && (
        typeof admission.admit !== 'function' || !admission.context ||
        'beforeBroadcast' in admission || 'intent' in admission || 'original' in admission
      ))
    )
      return Promise.reject(new NativeTransferRpcError('REVIEW_REQUIRED'));
    const hash = checkedHash(expectedHash);
    const replay = admission.mode === 'replay'
      ? { admit: admission.admit, context: { ...admission.context } }
      : undefined;
    const beforeBroadcast = admission.mode !== 'replay' ? admission.beforeBroadcast : undefined;
    const intent = admission.mode === 'new-send' ? admission.intent : undefined;
    const original = admission.mode === 'cancel' ? Object.freeze({ ...admission.original }) : undefined;
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
      if (original) {
        if (!tx.from || tx.gasLimit !== EVM_CANCELLATION_GAS_LIMIT ||
            original.from.toLowerCase() !== tx.from.toLowerCase() || original.nonce !== tx.nonce ||
            original.type !== tx.type || original.registrationHash !== this.context.registrationHash ||
            checkedHash(original.hash) !== original.hash || original.hash === hash)
          return invalid();
        cancellation = { from: tx.from, nonce: tx.nonce, operation: 'cancel' };
      }
      if (admission.mode === 'new-send' && isEvmEmptySelfCall(tx)) return invalid();
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

    } catch {
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    }
    return this.operation(signal, async (local) => {
      const send = () => {
        if (local.aborted) throw new NativeTransferRpcError('CANCELLED');
        if (beforeBroadcast) {
          const result: unknown = beforeBroadcast();
          if (result !== undefined) {
            void Promise.resolve(result).catch(() => undefined);
            throw new NativeTransferRpcError('REVIEW_REQUIRED');
          }
        }
        // No automatic retry: the remote side may accept before a response is lost.
        return this.call('eth_sendRawTransaction', [rawTransaction], local).then((value) => {
          if (checkedHash(value) !== hash) return invalid();
          return hash;
        });
      };
      const preflight = async () => {
        await this.checkChain(local);
        if (!cancellation) return;
        const { from, nonce } = cancellation;
        const assertActive = () => {
          if (local.aborted) throw new NativeTransferRpcError('CANCELLED');
        };
        const assertPayerReady = () =>
          assertEvmCancellationPayerReady(
            from, nonce,
            (method, address, tag) => this.call(method, [address, tag], local),
            assertActive
          ).catch((error) => {
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
      await preflight();
      return send();
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
