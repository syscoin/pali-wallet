import { getAddress } from 'ethers/address';
import { getEvmFeeData, assertEvmGasLimit, planEvmCancellationFees } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import type { Transaction } from 'ethers/transaction';
import { boundedResponseText, cancelResponseBody, parseRpcQuantity } from '../platformRpc.ts';
import { getNativeNetwork, snapshotNativeNetwork, type EvmNetworkId, type NativeNetworkRegistration } from './networkContext.ts';
import { assembleFeeQuote, checkedReadHash, EvmTransferReadError, guardedRead, readOwnData,
  rejectRead, snapshotCancellationTransfer, snapshotUnsignedTransfer, units } from './evmFeeContracts.ts';
import type { EvmFeeQuote, EvmSampledBlock, EvmUnsignedTransfer } from './evmFeeContracts.ts';
import { observeEvmTransaction, EvmObservationError, type EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import { getEvmTransferCost } from '../../../../source/shared/evmTransferCost.ts';
import { evmEstimateRequest } from '../../../../source/shared/evmEstimateRequest.ts';
import { assertEvmFeeEstimateApproved, bufferEvmFeeEstimate, captureEvmFeeApproval,
  EVM_FEE_APPROVAL_LIFETIME_MS, EvmFeeBalanceError } from '../../../../source/shared/evmFeeApproval.ts';
import { assertEvmCancellationPayerReady, EvmCancellationNonceError, EvmCancellationPayerCodeError } from '../../../../source/shared/evmCancellationPayer.ts';
const BLOCK_BYTES = 512 * 1024;
const CODE_BYTES = 32 * 1024;
type Method = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call' | 'eth_gasPrice' |
  'eth_maxPriorityFeePerGas' | 'eth_feeHistory' | 'eth_getBalance' | 'eth_estimateGas' | 'eth_getTransactionReceipt' | 'eth_getTransactionCount';
const METHODS: readonly string[] = Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionCount']);
type Reader = ((method: Method, params: readonly unknown[]) => Promise<unknown>) & { assertCurrent(): void };
type ReadBlock = EvmSampledBlock & Readonly<{ baseFee: bigint | null; gasLimit: bigint }>;
type ReceiptRequest = Readonly<{ hash: string; from: string; to: string | null; nonce: string }>;
export type EvmReceiptObservation = Readonly<
  | { status: 'included'; outcome: 'succeeded' | 'reverted'; canonicalObserved: true; block: EvmSampledBlock }
  | { status: 'nonce-consumed' }
>;
export type EvmPreparedQuote = Readonly<{ transaction: EvmUnsignedTransfer; balanceUnits: string; maximumFeeUnits: string; totalUnits: string }>;
export type EvmCancellationQuote = EvmPreparedQuote & Readonly<{
  feePlan: ReturnType<typeof planEvmCancellationFees>;
}>;
function quantity(value: unknown): bigint {
  try { return parseRpcQuantity(value); } catch { return rejectRead('INVALID_RESPONSE'); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rejectRead('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
const hex = (value: bigint) => `0x${value.toString(16)}`;
function block(value: unknown): ReadBlock {
  const raw = object(value);
  return Object.freeze({ number: quantity(raw.number).toString(), hash: checkedReadHash(raw.hash),
    baseFee: raw.baseFeePerGas == null ? null : quantity(raw.baseFeePerGas), gasLimit: quantity(raw.gasLimit) });
}
async function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); return rejectRead('CANCELLED'); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new EvmTransferReadError('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
/** Read-only capability: no method can transmit a signed envelope or broadcast. */
export class EvmTransferReadRpc {
  private readonly network;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly monotonicMilliseconds: () => number;
  private sequence = 0;
  /** Custom clocks must be monotonic milliseconds with one stable origin, never Date.now(). */
  constructor(id: EvmNetworkId | NativeNetworkRegistration, options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; monotonicMilliseconds?: () => number } = {}) {
    this.network = typeof id === 'string' ? getNativeNetwork(id) : snapshotNativeNetwork(id);
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.monotonicMilliseconds = options.monotonicMilliseconds ?? (() => Math.floor(performance.now()));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000) throw new Error('Invalid read timeout');
  }
  private async operation<T>(external: AbortSignal, guard: () => void, work: (read: Reader) => Promise<T>, verifyEndpoint = false): Promise<T> {
    guardedRead(guard);
    if (external.aborted) return rejectRead('CANCELLED');
    const controller = new AbortController();
    const expectedUrl = verifyEndpoint ? new URL(this.network.rpcUrl).href : undefined;
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const read: Reader = Object.assign(async (method: Method, params: readonly unknown[]) => {
      guardedRead(guard);
      if (controller.signal.aborted) return rejectRead('CANCELLED');
      if (!METHODS.includes(method)) return rejectRead('INVALID_INPUT');
      const id = ++this.sequence;
      if (!Number.isSafeInteger(id)) return rejectRead('UNAVAILABLE');
      const response = await cancellable(this.fetcher(this.network.rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: controller.signal,
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      }), controller.signal);
      guardedRead(guard);
      if (expectedUrl && (response.redirected ||
          (response.url && new URL(response.url).href !== expectedUrl))) {
        cancelResponseBody(response);
        return rejectRead('PROFILE_CHANGED');
      }
      if (!response.ok) return rejectRead('UNAVAILABLE');
      const contentType = response.headers.get('content-type');
      if (contentType && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType)) return rejectRead('INVALID_RESPONSE');
      const limit = method === 'eth_getBlockByNumber' ? BLOCK_BYTES : method === 'eth_getCode' ? CODE_BYTES : 16 * 1024;
      const text = await cancellable(boundedResponseText(response, controller.signal, limit), controller.signal);
      guardedRead(guard);
      const result = object(JSON.parse(text));
      if (result.jsonrpc !== '2.0' || result.id !== id) return rejectRead('INVALID_RESPONSE');
      if (Object.hasOwn(result, 'error')) {
        const error = object(result.error);
        // Only an explicit unsupported priority-fee method reaches the SDK's bounded history fallback.
        if (method === 'eth_maxPriorityFeePerGas' && (error.code === -32601 || error.code === 4200))
          throw Object.assign(new Error('Unsupported priority fee RPC'), { code: error.code });
        return rejectRead('INVALID_RESPONSE');
      }
      if (!Object.hasOwn(result, 'result')) return rejectRead('INVALID_RESPONSE');
      return result.result;
    }, { assertCurrent: () => { guardedRead(guard); if (controller.signal.aborted) rejectRead('CANCELLED'); } });
    try {
      const result = await cancellable(work(read), controller.signal);
      guardedRead(guard);
      return result;
    } catch (error) {
      guardedRead(guard);
      if (controller.signal.aborted) return rejectRead('CANCELLED');
      if (error instanceof EvmTransferReadError) throw error;
      return rejectRead('UNAVAILABLE');
    } finally {
      controller.abort(); clearTimeout(timer); external.removeEventListener('abort', abort);
    }
  }
  private async checkChain(read: Reader) {
    read.assertCurrent();
    const chain = await read('eth_chainId', []);
    read.assertCurrent();
    if (quantity(chain) !== BigInt(this.network.chainId)) rejectRead('PROFILE_CHANGED');
  }
  private async canonical(read: Reader, expected: EvmSampledBlock) {
    read.assertCurrent();
    const current = block(await read('eth_getBlockByNumber', [hex(BigInt(expected.number)), false]));
    read.assertCurrent();
    if (current.number !== expected.number || current.hash !== expected.hash) rejectRead('PROFILE_CHANGED');
  }
  verifyNetwork(signal: AbortSignal, guard: () => void): Promise<void> {
    return this.operation(signal, guard, async (read) => { await this.checkChain(read); }, true);
  }
  private feeData(read: Reader, sampled: ReadBlock, signal: AbortSignal) {
    return getEvmFeeData({
      getGasPrice: async () => quantity(await read('eth_gasPrice', [])),
      getBlock: async () => ({ baseFeePerGas: sampled.baseFee }),
      send: async (method, params) => {
        const value = await read(method, params);
        if (method === 'eth_maxPriorityFeePerGas') return quantity(value);
        const history = object(value);
        if (!Array.isArray(history.reward) || history.reward.length < 1 || history.reward.length > 5) return rejectRead('INVALID_RESPONSE');
        return { reward: history.reward.map((row) => {
          if (!Array.isArray(row) || row.length !== 3) return rejectRead('INVALID_RESPONSE');
          return row.map(quantity);
        }) };
      },
    }, { signal, assertCurrent: () => read.assertCurrent() });
  }

  prepareCancellation(original: Transaction, signal: AbortSignal, guard: () => void): Promise<EvmCancellationQuote> {
    const { from, type, nonce, gasPrice, maxFeePerGas, maxPriorityFeePerGas, chainId } = original;
    if (!from || (type !== 0 && type !== 2) || chainId.toString() !== this.network.chainId)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const [rawBalance, fees] = await Promise.all([
        read('eth_getBalance', [from, 'latest']),
        this.feeData(read, sampled, signal),
        assertEvmCancellationPayerReady(from, nonce, (method, address, tag) =>
          read(method, [address, tag]), read.assertCurrent).catch((error) => {
            if (error instanceof EvmCancellationNonceError || error instanceof EvmCancellationPayerCodeError)
              return rejectRead('REVIEW_REQUIRED');
            throw error;
          }),
      ]);
      read.assertCurrent();
      if (type === 2 && fees.baseFeePerGas === undefined) return rejectRead('REVIEW_REQUIRED');
      const feePlan = type === 0
        ? planEvmCancellationFees({ type: 0, currentGasPrice: fees.gasPrice, originalGasPrice: gasPrice ?? undefined })
        : planEvmCancellationFees({ type: 2, currentMaxFeePerGas: fees.maxFeePerGas,
          currentMaxPriorityFeePerGas: fees.maxPriorityFeePerGas, originalMaxFeePerGas: maxFeePerGas ?? undefined,
          originalMaxPriorityFeePerGas: maxPriorityFeePerGas ?? undefined });
      assertEvmGasLimit(feePlan.gasLimit, chainId, sampled.gasLimit);
      const transaction = snapshotCancellationTransfer({
        from, to: from, chainId: this.network.chainId, nonce: String(nonce),
        value: '0', data: '0x', gasLimit: feePlan.gasLimit.toString(),
        ...(feePlan.type === 0 ? { type: 0, gasPrice: feePlan.gasPrice.toString() } : {
          type: 2, maxFeePerGas: feePlan.maxFeePerGas.toString(), maxPriorityFeePerGas: feePlan.maxPriorityFeePerGas.toString(),
        }),
      }, this.network, from, feePlan);
      await this.canonical(read, sampled);
      await this.checkChain(read);
      const maximumFeeUnits = feePlan.maximumFee.toString();
      return Object.freeze({ transaction, feePlan, balanceUnits: quantity(rawBalance).toString(), maximumFeeUnits, totalUnits: maximumFeeUnits });
    });
  }

  /** One SDK fee policy serves live native/token preparation and exact-envelope requotes. */
  prepare(input: Readonly<{ from: string; to: string; value: string; data: string }>, signal: AbortSignal,
    guard: () => void, approved?: EvmUnsignedTransfer): Promise<EvmPreparedQuote> {
    let request: { from: string; to: string; value: string; data: string };
    try {
      const raw = readOwnData(input, ['from', 'to', 'value', 'data']);
      request = { from: getAddress(raw.from as string), to: getAddress(raw.to as string), value: units(raw.value).toString(), data: raw.data as string };
      if (/^0x0{40}$/i.test(request.from) || /^0x0{40}$/i.test(request.to) || typeof request.data !== 'string' ||
          !/^0x(?:[0-9a-f]{2})*$/.test(request.data) || request.data.length > 138 || (request.data === '0x' && request.value === '0')) return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
      if (approved) approved = snapshotUnsignedTransfer(approved, this.network);
    } catch { return Promise.reject(new EvmTransferReadError('INVALID_INPUT')); }
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const [rawNonce, rawBalance, fees] = await Promise.all([
        read('eth_getTransactionCount', [request.from, 'pending']), read('eth_getBalance', [request.from, 'pending']),
        this.feeData(read, sampled, signal),
      ]);
      read.assertCurrent();
      const nonce = quantity(rawNonce), balance = quantity(rawBalance);
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || sampled.gasLimit < 21000n) return rejectRead('INVALID_RESPONSE');
      const selectedFees = approved
        ? approved.type === 0 ? { type: 0 as const, gasPrice: approved.gasPrice }
          : { type: 2 as const, maxFeePerGas: approved.maxFeePerGas, maxPriorityFeePerGas: approved.maxPriorityFeePerGas }
        : fees.baseFeePerGas === undefined ? { type: 0 as const, gasPrice: fees.gasPrice.toString() }
          : { type: 2 as const, maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() };
      if (approved && (approved.nonce !== nonce.toString() || approved.from !== request.from || approved.to !== request.to || approved.value !== request.value || approved.data !== request.data)) return rejectRead('REVIEW_REQUIRED');
      if (selectedFees.type === 2 && (sampled.baseFee === null || BigInt(selectedFees.maxFeePerGas) < sampled.baseFee)) return rejectRead('REVIEW_REQUIRED');
      const estimate = quantity(await read('eth_estimateGas', [evmEstimateRequest({
        ...request, ...selectedFees, chainId: this.network.chainId, nonce: nonce.toString(),
      }), 'pending']));
      read.assertCurrent();
      if (estimate < 21000n || estimate > sampled.gasLimit) return rejectRead('INVALID_RESPONSE');
      let gas: bigint;
      try {
        gas = approved
          ? BigInt(approved.gasLimit)
          : bufferEvmFeeEstimate(estimate, BigInt(this.network.chainId), sampled.gasLimit);
      } catch { return rejectRead('INVALID_RESPONSE'); }
      const tx = snapshotUnsignedTransfer({ ...request, ...selectedFees, chainId: this.network.chainId,
        nonce: nonce.toString(), gasLimit: gas.toString() }, this.network);
      let cost: ReturnType<typeof getEvmTransferCost>;
      try {
        cost = getEvmTransferCost(BigInt(tx.value), BigInt(tx.gasLimit),
          BigInt(tx.type === 0 ? tx.gasPrice : tx.maxFeePerGas));
      } catch { return rejectRead('INVALID_RESPONSE'); }
      {
        const approval = captureEvmFeeApproval(tx, this.network.registrationHash,
          this.monotonicMilliseconds() + EVM_FEE_APPROVAL_LIFETIME_MS);
        try { assertEvmFeeEstimateApproved(approval, { estimatedGas: estimate, sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }), balance }, this.monotonicMilliseconds()); }
        catch (error) {
          return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
        }
      }
      await this.canonical(read, sampled); await this.checkChain(read); read.assertCurrent();
      return Object.freeze({ transaction: tx, balanceUnits: balance.toString(), maximumFeeUnits: cost.maximumFee.toString(), totalUnits: cost.total.toString() });
    });
  }
  quoteFees(input: EvmUnsignedTransfer, signal: AbortSignal, guard: () => void): Promise<EvmFeeQuote> {
    const transaction = snapshotUnsignedTransfer(input, this.network);
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const now = this.monotonicMilliseconds();
      if (!Number.isSafeInteger(now) || now < 0) return rejectRead('INVALID_RESPONSE');
      const approval = captureEvmFeeApproval(transaction, this.network.registrationHash, now + EVM_FEE_APPROVAL_LIFETIME_MS);
      const balance = quantity(await read('eth_getBalance', [transaction.from, 'pending']));
      const observation = { balance, sampledBlockGasLimit: sampled.gasLimit,
        ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }) };
      try { assertEvmFeeEstimateApproved(approval, { ...observation, estimatedGas: BigInt(transaction.gasLimit) }, now); }
      catch { return rejectRead('REVIEW_REQUIRED'); }
      const cap = BigInt(transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas);
      const price = transaction.type === 0 ? cap : (sampled.baseFee ?? rejectRead('INVALID_RESPONSE')) + BigInt(transaction.maxPriorityFeePerGas);
      const gas = quantity(await read('eth_estimateGas', [evmEstimateRequest(transaction), 'pending']));
      try { assertEvmFeeEstimateApproved(approval, { ...observation, estimatedGas: gas }, this.monotonicMilliseconds()); }
      catch { return rejectRead('REVIEW_REQUIRED'); }
      await this.canonical(read, sampled); await this.checkChain(read);
      return assembleFeeQuote(transaction, this.network, { number: sampled.number, hash: sampled.hash }, price > cap ? cap : price, approval.expiresAtMonotonicMilliseconds);
    });
  }
  observation(input: ReceiptRequest, signal: AbortSignal, guard: () => void): Promise<EvmTransactionObservation> {
    guardedRead(guard);
    const raw = readOwnData(input, ['hash', 'from', 'to', 'nonce']);
    const expected = { hash: raw.hash as string, from: raw.from as string, to: raw.to as string | null, nonce: raw.nonce as string, chainId: this.network.chainId };
    return this.operation(signal, guard, async read => {
      try { return await observeEvmTransaction(expected, read, () => read.assertCurrent()); }
      catch (error) { if (error instanceof EvmObservationError) throw new EvmTransferReadError(error.code === 'CONTEXT_CHANGED' ? 'PROFILE_CHANGED' : error.code); throw error; }
    });
  }
  /** A canonical receipt confirms now; later reads may revise that observation after a reorg. */
  async receipt(input: ReceiptRequest, signal: AbortSignal, guard: () => void): Promise<EvmReceiptObservation | null> {
    guardedRead(guard);
    const raw = readOwnData(input, ['hash', 'from', 'to', 'nonce']);
    const expected = { hash: raw.hash as string, from: raw.from as string, to: raw.to as string | null, nonce: raw.nonce as string };
    const result = await this.observation(expected, signal, guard);
    if (result.status === 'missing') return BigInt(result.latestNonce) > BigInt(expected.nonce) ? Object.freeze({status:'nonce-consumed'}) : null;
    return Object.freeze({status:'included',outcome:result.outcome === 'confirmed' ? 'succeeded' : 'reverted',canonicalObserved:true,block:result.block});
  }
}
