import { Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import { getAddress } from 'ethers/address';
import { boundedResponseText, parseRpcQuantity, ResponseSizeLimitError } from '../platformRpc.ts';
import { getNativeNetwork, type EvmNetworkId } from './networkContext.ts';
import { getEvmTransferProfile } from './evmTransferProfiles.ts';
import {
  assembleFeeQuote, checkedReadHash, EvmTransferReadError, guardedRead, readOwnData,
  rejectRead, snapshotUnsignedTransfer, units, unsignedTransferBytes,
} from './evmFeeContracts.ts';
import type { EvmFeeExtra, EvmFeeQuote, EvmSampledBlock, EvmUnsignedTransfer } from './evmFeeContracts.ts';

const CODE_BYTES = 32 * 1024;
const BLOCK_BYTES = 512 * 1024;
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ABI = new Interface([
  'function version() view returns (string)',
  'function isFjord() view returns (bool)',
  'function isIsthmus() view returns (bool)',
  'function isJovian() view returns (bool)',
  'function getL1FeeUpperBound(uint256) view returns (uint256)',
  'function getOperatorFee(uint256) view returns (uint256)',
  'function getL1Fee(bytes) view returns (uint256)',
]);
type Method = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_getStorageAt' | 'eth_call' |
  'eth_estimateGas' | 'eth_getTransactionReceipt' | 'eth_getTransactionCount';
const METHODS: readonly string[] = Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt',
  'eth_call', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionCount']);
type Reader = ((method: Method, params: readonly unknown[]) => Promise<unknown>) & { assertCurrent(): void };
type ReadBlock = EvmSampledBlock & Readonly<{ baseFee: bigint | null }>;
type ReceiptRequest = Readonly<{ hash: string; from: string; to: string; nonce: string }>;
type Settlement = Readonly<{ kind: 'ethereum-finalized' | 'nevm-depth-observation' | 'nevm-depth-12' | 'zkos-finalized-executed' | 'unqualified'; observedHeight: string | null; terminalEligible: boolean }>;
export type EvmReceiptObservation = Readonly<
  | { status: 'included'; outcome: 'succeeded' | 'reverted'; canonicalObserved: true; block: EvmSampledBlock; settlement: Settlement }
  | { status: 'nonce-consumed'; settlement: Settlement }
>;
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
    baseFee: raw.baseFeePerGas === undefined ? null : quantity(raw.baseFeePerGas) });
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
  private readonly profile;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly monotonicMilliseconds: () => number;
  private sequence = 0;
  /** Custom clocks must be monotonic milliseconds with one stable origin, never Date.now(). */
  constructor(id: EvmNetworkId, options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; monotonicMilliseconds?: () => number } = {}) {
    this.network = getNativeNetwork(id);
    this.profile = getEvmTransferProfile(id);
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
      if (result.jsonrpc !== '2.0' || result.id !== id || Object.hasOwn(result, 'error') || !Object.hasOwn(result, 'result')) return rejectRead('INVALID_RESPONSE');
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
  private async oracle(read: Reader, sampled: ReadBlock) {
    read.assertCurrent();
    const oracle = this.profile.oracle;
    if (!oracle) return rejectRead('UNQUALIFIED_PROFILE');
    const tag = hex(BigInt(sampled.number));
    const [proxyCode, slot, implementationCode] = await Promise.all([
      read('eth_getCode', [oracle.address, tag]), read('eth_getStorageAt', [oracle.address, IMPLEMENTATION_SLOT, tag]),
      read('eth_getCode', [oracle.implementation, tag]),
    ]);
    read.assertCurrent();
    const codeHash = (value: unknown) => {
      if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) return rejectRead('PROFILE_CHANGED');
      return keccak256(value);
    };
    if (codeHash(proxyCode) !== oracle.proxyCodeHash || codeHash(implementationCode) !== oracle.implementationCodeHash ||
        typeof slot !== 'string' || slot.toLowerCase() !== `0x${'0'.repeat(24)}${oracle.implementation.slice(2)}`) rejectRead('PROFILE_CHANGED');
    const call = async (method: string, args: readonly unknown[] = []) => {
      read.assertCurrent();
      const raw = await read('eth_call', [{ to: oracle.address, data: ABI.encodeFunctionData(method, args) }, tag]);
      read.assertCurrent();
      if (typeof raw !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) return rejectRead('INVALID_RESPONSE');
      let values;
      try { values = ABI.decodeFunctionResult(method, raw); }
      catch { return rejectRead('INVALID_RESPONSE'); }
      if (ABI.encodeFunctionResult(method, values).toLowerCase() !== raw.toLowerCase()) return rejectRead('INVALID_RESPONSE');
      return values[0] as unknown;
    };
    const version = await call('version');
    read.assertCurrent();
    if (version !== oracle.version) return rejectRead('PROFILE_CHANGED');
    if (this.profile.feeModel === 'op-jovian') {
      for (const flag of ['isFjord', 'isIsthmus', 'isJovian']) {
        const enabled = await call(flag);
        read.assertCurrent();
        if (enabled !== true) rejectRead('PROFILE_CHANGED');
      }
    }
    return call;
  }
  quoteFees(input: EvmUnsignedTransfer, signal: AbortSignal, guard: () => void): Promise<EvmFeeQuote> {
    let transaction: EvmUnsignedTransfer;
    try {
      guardedRead(guard);
      transaction = snapshotUnsignedTransfer(input, this.network);
      if (!this.profile.feeSourceQualified) return Promise.reject(new EvmTransferReadError('UNQUALIFIED_PROFILE'));
    } catch (error) { return Promise.reject(error instanceof EvmTransferReadError ? error : new EvmTransferReadError('INVALID_INPUT')); }
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      read.assertCurrent();
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      read.assertCurrent();
      if (sampled.baseFee === null) return rejectRead('INVALID_RESPONSE');
      const cap = BigInt(transaction.maxFeePerGas);
      if (cap < sampled.baseFee) return rejectRead('REVIEW_REQUIRED');
      const price = sampled.baseFee + BigInt(transaction.maxPriorityFeePerGas);
      const extras: EvmFeeExtra[] = [];
      if (this.profile.feeModel === 'nitro-inclusive-gas' || this.profile.feeModel === 'zkos-inclusive-gas') {
        const estimated = quantity(await read('eth_estimateGas', [{ from: transaction.from, to: transaction.to, data: '0x',
          value: hex(BigInt(transaction.value)), maxFeePerGas: hex(cap), maxPriorityFeePerGas: hex(BigInt(transaction.maxPriorityFeePerGas)),
          ...(this.profile.feeModel === 'zkos-inclusive-gas' ? { type: '0x2', chainId: hex(BigInt(transaction.chainId)), nonce: hex(BigInt(transaction.nonce)) } : {}) }, hex(BigInt(sampled.number))]));
        read.assertCurrent();
        if (estimated < 21000n || estimated > BigInt(transaction.gasLimit)) return rejectRead('REVIEW_REQUIRED');
      } else if (this.profile.feeModel === 'op-jovian' || this.profile.feeModel === 'rollux-legacy') {
        const call = await this.oracle(read, sampled);
        read.assertCurrent();
        const unsigned = unsignedTransferBytes(transaction);
        const l1 = this.profile.feeModel === 'op-jovian'
          ? await call('getL1FeeUpperBound', [(unsigned.length - 2) / 2]) : await call('getL1Fee', [unsigned]);
        read.assertCurrent();
        extras.push(Object.freeze({ kind: 'l1-data', estimateUnits: units(String(l1), 'INVALID_RESPONSE').toString(), enforceableByEnvelope: false }));
        if (this.profile.feeModel === 'op-jovian') {
          const operator = await call('getOperatorFee', [BigInt(transaction.gasLimit)]);
          read.assertCurrent();
          extras.push(Object.freeze({ kind: 'operator', estimateUnits: units(String(operator), 'INVALID_RESPONSE').toString(), enforceableByEnvelope: false }));
        }
      }
      await this.canonical(read, sampled);
      read.assertCurrent();
      await this.checkChain(read);
      read.assertCurrent();
      const monotonicMilliseconds = this.monotonicMilliseconds();
      if (!Number.isSafeInteger(monotonicMilliseconds) || monotonicMilliseconds < 0) return rejectRead('INVALID_RESPONSE');
      return assembleFeeQuote(transaction, this.network, this.profile, { number: sampled.number, hash: sampled.hash }, price > cap ? cap : price, extras, monotonicMilliseconds + 90000);
    });
  }
  private async consumedAfterOversizedReceipt(read: Reader, expected: ReceiptRequest): Promise<EvmReceiptObservation> {
    read.assertCurrent();
    const kind = this.profile.settlement;
    if (kind === 'unqualified') return rejectRead('UNAVAILABLE');
    const finalized = block(await read('eth_getBlockByNumber', ['finalized', false]));
    read.assertCurrent();
    const nonce = quantity(await read('eth_getTransactionCount', [expected.from, hex(BigInt(finalized.number))]));
    read.assertCurrent();
    await this.canonical(read, finalized);
    read.assertCurrent();
    await this.checkChain(read);
    read.assertCurrent();
    if (nonce <= BigInt(expected.nonce)) return rejectRead('UNAVAILABLE');
    // The oversized body is opaque. This retires only a consumed nonce and
    // never supplies an execution status or upgrades a settlement profile.
    return Object.freeze({ status: 'nonce-consumed', settlement: Object.freeze({
      kind, observedHeight: finalized.number, terminalEligible: kind === 'ethereum-finalized',
    }) });
  }
  /** Fixed testnet policy: canonical depth is an observation, never protocol finality. */
  private async depthReceipt(read: Reader, expected: ReceiptRequest): Promise<EvmReceiptObservation | null> {
    const head = block(await read('eth_getBlockByNumber', ['latest', false]));
    read.assertCurrent();
    const height = BigInt(head.number);
    const anchor = height >= 11n
      ? block(await read('eth_getBlockByNumber', [hex(height - 11n), false])) : null;
    read.assertCurrent();
    if (anchor && BigInt(anchor.number) !== height - 11n) rejectRead('PROFILE_CHANGED');
    let raw: unknown, opaque = false;
    try { raw = await read('eth_getTransactionReceipt', [expected.hash]); }
    catch (error) { if (!(error instanceof ResponseSizeLimitError)) throw error; opaque = true; }
    read.assertCurrent();
    const consumed = anchor !== null && quantity(await read('eth_getTransactionCount', [expected.from, hex(BigInt(anchor.number))])) > BigInt(expected.nonce);
    read.assertCurrent();
    let receipt = !opaque && raw !== null ? this.checkedReceipt(raw, expected) : null;
    if (receipt) {
      if (BigInt(receipt.block.number) > height) rejectRead('PROFILE_CHANGED');
      await this.canonical(read, receipt.block);
      read.assertCurrent();
    }
    const eligible = !!receipt && !!anchor && consumed && BigInt(receipt.block.number) <= BigInt(anchor.number);
    if (eligible) {
      try {
        const repeated = this.checkedReceipt(await read('eth_getTransactionReceipt', [expected.hash]), expected);
        if (repeated.block.number !== receipt!.block.number || repeated.block.hash !== receipt!.block.hash || repeated.outcome !== receipt!.outcome)
          rejectRead('PROFILE_CHANGED');
        await this.canonical(read, repeated.block);
      } catch (error) {
        if (!(error instanceof ResponseSizeLimitError)) throw error;
        opaque = true; receipt = null;
      }
      read.assertCurrent();
    }
    if (anchor) await this.canonical(read, anchor);
    await this.canonical(read, head);
    await this.checkChain(read);
    read.assertCurrent();
    const settlement = (terminalEligible: boolean): Settlement => Object.freeze({
      kind: 'nevm-depth-12', observedHeight: anchor?.number ?? null, terminalEligible,
    });
    if (!receipt) {
      if (consumed) return Object.freeze({ status: 'nonce-consumed', settlement: settlement(true) });
      if (opaque) return rejectRead('UNAVAILABLE');
      return null;
    }
    return Object.freeze({ status: 'included', outcome: receipt.outcome, canonicalObserved: true,
      block: receipt.block, settlement: settlement(eligible) });
  }
  /** zkOS exposes settlement-layer finalized execution, not an L2 depth rule. */
  private async zkOsReceipt(read: Reader, expected: ReceiptRequest): Promise<EvmReceiptObservation | null> {
    const head = block(await read('eth_getBlockByNumber', ['latest', false]));
    const anchor = block(await read('eth_getBlockByNumber', ['finalized', false]));
    read.assertCurrent();
    if (BigInt(anchor.number) > BigInt(head.number)) rejectRead('PROFILE_CHANGED');
    // Resolve the tag once, then pin nonce and all rechecks to this numeric anchor.
    await this.canonical(read, anchor);
    let raw: unknown, opaque = false;
    try { raw = await read('eth_getTransactionReceipt', [expected.hash]); }
    catch (error) { if (!(error instanceof ResponseSizeLimitError)) throw error; opaque = true; }
    read.assertCurrent();
    const consumed = quantity(await read('eth_getTransactionCount', [expected.from, hex(BigInt(anchor.number))])) > BigInt(expected.nonce);
    read.assertCurrent();
    let receipt = !opaque && raw !== null ? this.checkedReceipt(raw, expected) : null;
    if (receipt) {
      if (BigInt(receipt.block.number) > BigInt(head.number)) rejectRead('PROFILE_CHANGED');
      await this.canonical(read, receipt.block);
    }
    const eligible = !!receipt && consumed && BigInt(receipt.block.number) <= BigInt(anchor.number);
    if (eligible) {
      try {
        const repeated = this.checkedReceipt(await read('eth_getTransactionReceipt', [expected.hash]), expected);
        if (repeated.block.number !== receipt!.block.number || repeated.block.hash !== receipt!.block.hash || repeated.outcome !== receipt!.outcome)
          rejectRead('PROFILE_CHANGED');
        await this.canonical(read, repeated.block);
      } catch (error) {
        if (!(error instanceof ResponseSizeLimitError)) throw error;
        opaque = true; receipt = null;
      }
    }
    await this.canonical(read, anchor);
    await this.canonical(read, head);
    await this.checkChain(read);
    read.assertCurrent();
    const settlement = (terminalEligible: boolean): Settlement => Object.freeze({
      kind: 'zkos-finalized-executed', observedHeight: anchor.number, terminalEligible,
    });
    if (!receipt) {
      if (consumed) return Object.freeze({ status: 'nonce-consumed', settlement: settlement(true) });
      if (opaque) return rejectRead('UNAVAILABLE');
      return null;
    }
    return Object.freeze({ status: 'included', outcome: receipt.outcome, canonicalObserved: true,
      block: receipt.block, settlement: settlement(eligible) });
  }
  receipt(input: ReceiptRequest, signal: AbortSignal, guard: () => void): Promise<EvmReceiptObservation | null> {
    let expected: ReceiptRequest;
    try {
      guardedRead(guard);
      const data = readOwnData(input, ['hash', 'from', 'to', 'nonce']);
      const nonce = units(data.nonce);
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
      expected = Object.freeze({ hash: checkedReadHash(data.hash), from: getAddress(data.from as string), to: getAddress(data.to as string), nonce: nonce.toString() });
      if (this.profile.feeModel === 'unqualified') return Promise.reject(new EvmTransferReadError('UNQUALIFIED_PROFILE'));
    } catch (error) { return Promise.reject(error instanceof EvmTransferReadError ? error : new EvmTransferReadError('INVALID_INPUT')); }
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      read.assertCurrent();
      if (this.profile.settlement === 'nevm-depth-12') return this.depthReceipt(read, expected);
      if (this.profile.settlement === 'zkos-finalized-executed') return this.zkOsReceipt(read, expected);
      let raw: unknown;
      try {
        raw = await read('eth_getTransactionReceipt', [expected.hash]);
      } catch (error) {
        read.assertCurrent();
        if (!(error instanceof ResponseSizeLimitError)) throw error;
        return this.consumedAfterOversizedReceipt(read, expected);
      }
      read.assertCurrent();
      const kind = this.profile.settlement;
      let finalized: ReadBlock | null = null;
      let consumed = false;
      if (kind !== 'unqualified') {
        finalized = block(await read('eth_getBlockByNumber', ['finalized', false]));
        read.assertCurrent();
        consumed = quantity(await read('eth_getTransactionCount', [expected.from, hex(BigInt(finalized.number))])) > BigInt(expected.nonce);
        read.assertCurrent();
      }
      const settlement = (terminalEligible: boolean): Settlement => Object.freeze({ kind, observedHeight: finalized?.number ?? null,
        terminalEligible: kind === 'ethereum-finalized' && terminalEligible });
      if (raw === null) {
        if (finalized) await this.canonical(read, finalized);
        read.assertCurrent();
        await this.checkChain(read);
        read.assertCurrent();
        return consumed ? Object.freeze({ status: 'nonce-consumed', settlement: settlement(true) }) : null;
      }
      const receipt = this.checkedReceipt(raw, expected);
      await this.canonical(read, receipt.block);
      read.assertCurrent();
      const eligible = !!finalized && consumed && BigInt(receipt.block.number) <= BigInt(finalized.number);
      if (eligible) {
        let repeated: ReturnType<EvmTransferReadRpc['checkedReceipt']>;
        try {
          repeated = this.checkedReceipt(await read('eth_getTransactionReceipt', [expected.hash]), expected);
        } catch (error) {
          read.assertCurrent();
          if (!(error instanceof ResponseSizeLimitError)) throw error;
          return this.consumedAfterOversizedReceipt(read, expected);
        }
        read.assertCurrent();
        if (receipt.block.hash !== repeated.block.hash || receipt.block.number !== repeated.block.number || receipt.outcome !== repeated.outcome) rejectRead('PROFILE_CHANGED');
      }
      if (finalized) await this.canonical(read, finalized);
      read.assertCurrent();
      await this.checkChain(read);
      read.assertCurrent();
      return Object.freeze({ status: 'included', outcome: receipt.outcome, canonicalObserved: true, block: receipt.block, settlement: settlement(eligible) });
    });
  }
  private checkedReceipt(value: unknown, expected: ReceiptRequest) {
    const raw = object(value);
    if (checkedReadHash(raw.transactionHash) !== expected.hash || getAddress(raw.from as string) !== expected.from || getAddress(raw.to as string) !== expected.to) return rejectRead('INVALID_RESPONSE');
    const status = quantity(raw.status);
    if (status !== 0n && status !== 1n) return rejectRead('INVALID_RESPONSE');
    return Object.freeze({ outcome: status === 1n ? 'succeeded' as const : 'reverted' as const,
      block: Object.freeze({ number: quantity(raw.blockNumber).toString(), hash: checkedReadHash(raw.blockHash) }) });
  }
}
