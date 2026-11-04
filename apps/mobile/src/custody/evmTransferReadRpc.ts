import { getAddress } from 'ethers/address';
import { getEvmFeeData, bufferedEvmGasLimit } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { boundedResponseText, parseRpcQuantity } from '../platformRpc.ts';
import { getNativeNetwork, snapshotNativeNetwork, type EvmNetworkId, type NativeNetworkRegistration } from './networkContext.ts';
import { assembleFeeQuote, checkedReadHash, EvmTransferReadError, guardedRead, readOwnData,
  rejectRead, snapshotUnsignedTransfer, units } from './evmFeeContracts.ts';
import type { EvmFeeQuote, EvmSampledBlock, EvmUnsignedTransfer } from './evmFeeContracts.ts';
const BLOCK_BYTES = 512 * 1024;
const CODE_BYTES = 32 * 1024;
type Method = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call' | 'eth_gasPrice' |
  'eth_maxPriorityFeePerGas' | 'eth_feeHistory' | 'eth_getBalance' | 'eth_estimateGas' | 'eth_getTransactionReceipt' | 'eth_getTransactionCount';
const METHODS: readonly string[] = Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionCount']);
type Reader = ((method: Method, params: readonly unknown[]) => Promise<unknown>) & { assertCurrent(): void };
type ReadBlock = EvmSampledBlock & Readonly<{ baseFee: bigint | null; gasLimit: bigint }>;
type ReceiptRequest = Readonly<{ hash: string; from: string; to: string; nonce: string }>;
export type EvmReceiptObservation = Readonly<
  | { status: 'included'; outcome: 'succeeded' | 'reverted'; canonicalObserved: true; block: EvmSampledBlock }
  | { status: 'nonce-consumed' }
>;
export type EvmPreparedQuote = Readonly<{ transaction: EvmUnsignedTransfer; balanceUnits: string; maximumFeeUnits: string; totalUnits: string }>;
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
  private async operation<T>(external: AbortSignal, guard: () => void, work: (read: Reader) => Promise<T>): Promise<T> {
    guardedRead(guard);
    if (external.aborted) return rejectRead('CANCELLED');
    const controller = new AbortController();
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
    return this.operation(signal, guard, async (read) => { await this.checkChain(read); });
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
        getEvmFeeData({ getGasPrice: async () => quantity(await read('eth_gasPrice', [])),
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
          } }, { signal, assertCurrent: () => read.assertCurrent() }),
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
      const rpcFees = selectedFees.type === 0 ? { gasPrice: hex(BigInt(selectedFees.gasPrice)) }
        : { maxFeePerGas: hex(BigInt(selectedFees.maxFeePerGas)), maxPriorityFeePerGas: hex(BigInt(selectedFees.maxPriorityFeePerGas)) };
      const estimate = quantity(await read('eth_estimateGas', [{ ...request, value: hex(BigInt(request.value)),
        type: hex(BigInt(selectedFees.type)), chainId: hex(BigInt(this.network.chainId)), nonce: hex(nonce), ...rpcFees }, 'pending']));
      read.assertCurrent();
      if (estimate < 21000n || estimate > sampled.gasLimit) return rejectRead('INVALID_RESPONSE');
      const gas = bufferedEvmGasLimit(estimate);
      if (gas > sampled.gasLimit) return rejectRead('INVALID_RESPONSE');
      if (approved && gas > BigInt(approved.gasLimit)) return rejectRead('REVIEW_REQUIRED');
      const tx = snapshotUnsignedTransfer({ ...request, ...selectedFees, chainId: this.network.chainId,
        nonce: nonce.toString(), gasLimit: (approved ? BigInt(approved.gasLimit) : gas).toString() }, this.network);
      const rate = tx.type === 0 ? tx.gasPrice : tx.maxFeePerGas;
      const maximumFee = units((BigInt(tx.gasLimit) * BigInt(rate)).toString(), 'INVALID_RESPONSE');
      const total = units((BigInt(request.value) + maximumFee).toString(), 'INVALID_RESPONSE');
      await this.canonical(read, sampled); await this.checkChain(read); read.assertCurrent();
      return Object.freeze({ transaction: tx, balanceUnits: balance.toString(), maximumFeeUnits: maximumFee.toString(), totalUnits: total.toString() });
    });
  }
  quoteFees(input: EvmUnsignedTransfer, signal: AbortSignal, guard: () => void): Promise<EvmFeeQuote> {
    const transaction = snapshotUnsignedTransfer(input, this.network);
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const cap = BigInt(transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas);
      const price = transaction.type === 0 ? cap : (sampled.baseFee ?? rejectRead('INVALID_RESPONSE')) + BigInt(transaction.maxPriorityFeePerGas);
      if (transaction.type === 2 && cap < (sampled.baseFee ?? 0n)) return rejectRead('REVIEW_REQUIRED');
      const fees = transaction.type === 0 ? { gasPrice: hex(cap) } : { maxFeePerGas: hex(cap), maxPriorityFeePerGas: hex(BigInt(transaction.maxPriorityFeePerGas)) };
      const gas = quantity(await read('eth_estimateGas', [{ from: transaction.from, to: transaction.to, value: hex(BigInt(transaction.value)), data: transaction.data,
        type: hex(BigInt(transaction.type)), chainId: hex(BigInt(transaction.chainId)), nonce: hex(BigInt(transaction.nonce)), ...fees }, 'pending']));
      if (gas < 21000n || gas > BigInt(transaction.gasLimit) || gas > sampled.gasLimit) return rejectRead('REVIEW_REQUIRED');
      await this.canonical(read, sampled); await this.checkChain(read);
      const now = this.monotonicMilliseconds();
      if (!Number.isSafeInteger(now) || now < 0) return rejectRead('INVALID_RESPONSE');
      return assembleFeeQuote(transaction, this.network, { number: sampled.number, hash: sampled.hash }, price > cap ? cap : price, now + 90000);
    });
  }
  /** A canonical receipt confirms now; later reads may revise that observation after a reorg. */
  receipt(input: ReceiptRequest, signal: AbortSignal, guard: () => void): Promise<EvmReceiptObservation | null> {
    let expected: ReceiptRequest;
    try {
      guardedRead(guard);
      const raw = readOwnData(input, ['hash', 'from', 'to', 'nonce']);
      const nonce = units(raw.nonce);
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
      expected = Object.freeze({ hash: checkedReadHash(raw.hash), from: getAddress(raw.from as string), to: getAddress(raw.to as string), nonce: nonce.toString() });
    } catch (error) { return Promise.reject(error instanceof EvmTransferReadError ? error : new EvmTransferReadError('INVALID_INPUT')); }
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const raw = await read('eth_getTransactionReceipt', [expected.hash]);
      read.assertCurrent();
      if (raw === null) {
        const nonce = quantity(await read('eth_getTransactionCount', [expected.from, 'latest']));
        await this.checkChain(read); read.assertCurrent();
        // Nonce use never proves this hash succeeded or which other transaction replaced it.
        return nonce > BigInt(expected.nonce) ? Object.freeze({ status: 'nonce-consumed' }) : null;
      }
      const receipt = object(raw);
      if (checkedReadHash(receipt.transactionHash) !== expected.hash || getAddress(receipt.from as string) !== expected.from || getAddress(receipt.to as string) !== expected.to) return rejectRead('INVALID_RESPONSE');
      const status = quantity(receipt.status);
      if (status !== 0n && status !== 1n) return rejectRead('INVALID_RESPONSE');
      const included = Object.freeze({ number: quantity(receipt.blockNumber).toString(), hash: checkedReadHash(receipt.blockHash) });
      await this.canonical(read, included); await this.checkChain(read); read.assertCurrent();
      return Object.freeze({ status: 'included', outcome: status === 1n ? 'succeeded' : 'reverted', canonicalObserved: true, block: included });
    });
  }
}
