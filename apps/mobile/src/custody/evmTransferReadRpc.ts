import { getAddress } from 'ethers/address';
import { getEvmFeeData, assertEvmGasLimit, planEvmCancellationFees, planEvmSpeedUpFees } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import type { Transaction } from 'ethers/transaction';
import { normalizeNftExecutionRevert } from '../../../../source/scripts/Background/controllers/assets/nft-utils.ts';
import { encodeNftTransferData, type NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import { readSelectedNftUnits } from '../portfolio/nftOwnershipReadRpc.ts';
import type { ScopedCallOutcome } from '../portfolio/erc20ReadRpc.ts';
import { snapshotNftTransferSelection, type NftTransferRequest, type NftTransferSelection } from './nftTransferAdmission.ts';
import { boundedResponseText, cancelResponseBody, parseRpcQuantity } from '../platformRpc.ts';
import { getNativeNetwork, snapshotNativeNetwork, type EvmNetworkId, type NativeNetworkRegistration } from './networkContext.ts';
import { assembleFeeQuote, checkedReadHash, EvmTransferReadError, guardedRead, readOwnData,
  matchesSendNonce, rejectRead, snapshotCancellationTransfer, snapshotNftQuoteEnvelope, snapshotUnsignedTransfer, units } from './evmFeeContracts.ts';
import type { EvmFeeQuote, EvmSampledBlock, EvmUnsignedTransfer } from './evmFeeContracts.ts';
import { observeEvmTransaction, EvmObservationError, type EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import { getEvmTransferCost } from '../../../../source/shared/evmTransferCost.ts';
import { evmEstimateRequest } from '../../../../source/shared/evmEstimateRequest.ts';
import { assertEvmFeeEstimateApproved, bufferEvmFeeEstimate, captureEvmFeeApproval,
  EVM_FEE_APPROVAL_LIFETIME_MS, EvmFeeBalanceError } from '../../../../source/shared/evmFeeApproval.ts';
import { assertEvmCancellationPayerReady, assertRetainedEvmCancellationReady, EvmCancellationNonceError, EvmCancellationPayerCodeError } from '../../../../source/shared/evmCancellationPayer.ts';
import type { EvmReplacementRates } from '../../../../source/wallet/evmSignedRecords.ts';
import type { GuardianRecoveryObservation } from '../../../../source/utils/smartAccount/guardianStatus.ts';
const BLOCK_BYTES = 512 * 1024;
const CODE_BYTES = 32 * 1024;
type Method = 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call' | 'eth_getStorageAt' | 'eth_gasPrice' |
  'eth_maxPriorityFeePerGas' | 'eth_feeHistory' | 'eth_getBalance' | 'eth_estimateGas' | 'eth_getTransactionReceipt' | 'eth_getTransactionCount';
const METHODS: readonly string[] = Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getStorageAt', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionCount']);
type NftCall = Readonly<{ to: string; data: string; from?: string; value?: string }>;
type Reader = ((method: Method, params: readonly unknown[]) => Promise<unknown>) & {
  assertCurrent(): void;
  nftCall(tx: NftCall, block: string): Promise<ScopedCallOutcome>;
};
type TransferRequest = Readonly<{ from: string; to: string; value: string; data: string }>;
type ReadBlock = EvmSampledBlock & Readonly<{ baseFee: bigint | null; gasLimit: bigint }>;
type ReceiptRequest = Readonly<{ hash: string; from: string; to: string | null; nonce: string }>;
export type EvmReceiptObservation = Readonly<
  | { status: 'included'; outcome: 'succeeded' | 'reverted'; canonicalObserved: true; block: EvmSampledBlock }
  | { status: 'nonce-consumed' }
>;
export type EvmPreparedQuote = Readonly<{ transaction: EvmUnsignedTransfer; balanceUnits: string; maximumFeeUnits: string; totalUnits: string }>;
export type EvmNftPreparedQuote = Readonly<{
  intent: NftTransferIntent;
  envelope: EvmUnsignedTransfer;
  registrationHash: string;
  sampledBlock: EvmSampledBlock;
  balanceUnits: string;
  ownershipUnits: string;
  nonceOverride?: number;
  maximumFeeUnits: string;
  totalUnits: string;
  expiresAtMonotonicMilliseconds: number;
}>;
export type EvmCancellationQuote = EvmPreparedQuote & Readonly<{
  feePlan: ReturnType<typeof planEvmCancellationFees>;
}>;
export type NativeGuardianRecoveryStatus =
  | Readonly<{ status: 'unsupported' | 'no-compatible-policy' }>
  | Readonly<{ status: 'observed'; observation: GuardianRecoveryObservation }>;
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
  private readonly nftQuotes = new WeakMap<EvmNftPreparedQuote, 'prepared' | 'requoted'>();
  /** Custom clocks must be monotonic milliseconds with one stable origin, never Date.now(). */
  constructor(id: EvmNetworkId | NativeNetworkRegistration, options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; monotonicMilliseconds?: () => number } = {}) {
    this.network = typeof id === 'string' ? getNativeNetwork(id) : snapshotNativeNetwork(id);
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.monotonicMilliseconds = options.monotonicMilliseconds ?? (() => Math.floor(performance.now()));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000) throw new Error('Invalid read timeout');
  }
  private async operation<T>(external: AbortSignal, guard: () => void, work: (read: Reader) => Promise<T>, scope?: 'endpoint' | 'nft-quote'): Promise<T> {
    guardedRead(guard);
    if (external.aborted) return rejectRead('CANCELLED');
    const controller = new AbortController();
    const nft = scope === 'nft-quote';
    const expectedUrl = scope ? new URL(this.network.rpcUrl).href : undefined;
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const request = async (method: Method, params: readonly unknown[]) => {
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
      const limit = method === 'eth_getBlockByNumber' ? BLOCK_BYTES : method === 'eth_getCode' ? (nft ? CODE_BYTES * 2 + 512 : CODE_BYTES) : 16 * 1024;
      const text = await cancellable(boundedResponseText(response, controller.signal, limit), controller.signal);
      guardedRead(guard);
      const result = object(JSON.parse(text));
      if (result.jsonrpc !== '2.0' || result.id !== id) return rejectRead('INVALID_RESPONSE');
      return result;
    };
    const read: Reader = Object.assign(async (method: Method, params: readonly unknown[]) => {
      const result = await request(method, params);
      if (Object.hasOwn(result, 'error')) {
        const error = object(result.error);
        // Only an explicit unsupported priority-fee method reaches the SDK's bounded history fallback.
        if (method === 'eth_maxPriorityFeePerGas' && (error.code === -32601 || error.code === 4200))
          throw Object.assign(new Error('Unsupported priority fee RPC'), { code: error.code });
        return rejectRead('INVALID_RESPONSE');
      }
      if (!Object.hasOwn(result, 'result')) return rejectRead('INVALID_RESPONSE');
      return result.result;
    }, {
      assertCurrent: () => { guardedRead(guard); if (controller.signal.aborted) rejectRead('CANCELLED'); },
      async nftCall(tx: NftCall, block: string): Promise<ScopedCallOutcome> {
        if (!nft) return rejectRead('INVALID_INPUT');
        const result = await request('eth_call', [tx, block]);
        if (Object.hasOwn(result, 'error')) {
          if (Object.hasOwn(result, 'result')) return rejectRead('INVALID_RESPONSE');
          return { kind: 'rpc-error', error: result.error };
        }
        if (!Object.hasOwn(result, 'result') || typeof result.result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result.result))
          return rejectRead('INVALID_RESPONSE');
        return { kind: 'result', data: result.result };
      },
    });
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
    return this.operation(signal, guard, async (read) => { await this.checkChain(read); }, 'endpoint');
  }
  readGuardianRecoveryStatus(account: string, signal: AbortSignal, guard: () => void): Promise<NativeGuardianRecoveryStatus> {
    return this.operation(signal, guard, async (read) => {
      const [{ readGuardianRecoveryObservation, GuardianRecoveryUnsupportedError, GuardianRecoveryNoAccountCodeError }, { getPaliModuleAddress }] = await Promise.all([
        import('../../../../source/utils/smartAccount/guardianStatus.ts'),
        import('../../../../source/utils/smartAccount/contracts.ts'),
      ]);
      const chainId = Number(this.network.chainId);
      try {
        const observation = await readGuardianRecoveryObservation({
          account,
          chainId,
          moduleAddress: getPaliModuleAddress(chainId, 'guardian-recovery'),
          provider: { send: read },
          assertCurrent: read.assertCurrent,
        });
        return { status: 'observed', observation };
      } catch (error) {
        if (error instanceof GuardianRecoveryUnsupportedError) return { status: 'unsupported' };
        if (error instanceof GuardianRecoveryNoAccountCodeError) return { status: 'no-compatible-policy' };
        throw error;
      }
    }, 'endpoint');
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

  prepareCancellation(original: Transaction, rates: EvmReplacementRates, source: 'pending' | 'saved',
    signal: AbortSignal, guard: () => void): Promise<EvmCancellationQuote> {
    const { from, to, hash, nonce, chainId } = original;
    if (!from || !hash || rates.type !== original.type || chainId.toString() !== this.network.chainId)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const verifyPayer = source === 'saved'
        ? assertRetainedEvmCancellationReady({ from, to, hash, nonce: String(nonce), chainId: this.network.chainId }, read, read.assertCurrent)
        : assertEvmCancellationPayerReady(from, nonce, (method, address, tag) =>
          read(method, [address, tag]), read.assertCurrent);
      const [rawBalance, fees] = await Promise.all([
        read('eth_getBalance', [from, 'latest']),
        this.feeData(read, sampled, signal),
        verifyPayer.catch((error) => {
            if (error instanceof EvmCancellationNonceError || error instanceof EvmCancellationPayerCodeError)
              return rejectRead('REVIEW_REQUIRED');
            throw error;
        }),
      ]);
      read.assertCurrent();
      if (rates.type === 2 && fees.baseFeePerGas === undefined) return rejectRead('REVIEW_REQUIRED');
      const feePlan = rates.type === 0
        ? planEvmCancellationFees({ type: 0, currentGasPrice: fees.gasPrice, originalGasPrice: rates.gasPrice })
        : planEvmCancellationFees({ type: 2, currentMaxFeePerGas: fees.maxFeePerGas,
          currentMaxPriorityFeePerGas: fees.maxPriorityFeePerGas, originalMaxFeePerGas: rates.maxFeePerGas,
          originalMaxPriorityFeePerGas: rates.maxPriorityFeePerGas });
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

  prepareSpeedUp(original: Transaction, rates: EvmReplacementRates, signal: AbortSignal, guard: () => void): Promise<EvmPreparedQuote> {
    const { from, to, nonce, value, data, gasLimit, chainId } = original;
    if (!from || !to || original.accessList?.length || rates.type !== original.type || chainId.toString() !== this.network.chainId)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const [rawBalance, rawNonce] = await Promise.all([
        read('eth_getBalance', [from, 'latest']),
        read('eth_getTransactionCount', [from, 'latest']),
      ]);
      read.assertCurrent();
      if (quantity(rawNonce) > BigInt(nonce) || (rates.type === 2 && sampled.baseFee === null))
        return rejectRead('REVIEW_REQUIRED');
      const bounds = { chainId, gasLimit, sampledBlockGasLimit: sampled.gasLimit, sampledBaseFeePerGas: sampled.baseFee };
      const fees = rates.type === 2 && rates.maxFeePerGas === 0n ? await this.feeData(read, sampled, signal) : undefined;
      const gasPrice = rates.type === 0 && rates.gasPrice === 0n ? quantity(await read('eth_gasPrice', [])) : undefined;
      read.assertCurrent();
      let plan: ReturnType<typeof planEvmSpeedUpFees>;
      try {
        plan = rates.type === 0
          ? planEvmSpeedUpFees({ ...bounds, type: 0, gasPrice: gasPrice ?? rates.gasPrice })
          : planEvmSpeedUpFees({ ...bounds, type: 2, maxFeePerGas: fees?.maxFeePerGas ?? rates.maxFeePerGas,
            maxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? rates.maxPriorityFeePerGas });
      } catch { return rejectRead('REVIEW_REQUIRED'); }
      const rate = plan.type === 0 ? plan.gasPrice : plan.maxFeePerGas;
      if (rate === 0n || (sampled.baseFee !== null && rate < sampled.baseFee)) return rejectRead('REVIEW_REQUIRED');
      const transaction = snapshotUnsignedTransfer({
        from, to, chainId: this.network.chainId, nonce: String(nonce),
        value: value.toString(), data, gasLimit: plan.gasLimit.toString(),
        ...(plan.type === 0 ? { type: 0, gasPrice: plan.gasPrice.toString() } : {
          type: 2, maxFeePerGas: plan.maxFeePerGas.toString(), maxPriorityFeePerGas: plan.maxPriorityFeePerGas.toString(),
        }),
      }, this.network);
      const balance = quantity(rawBalance);
      const now = this.monotonicMilliseconds();
      const approval = captureEvmFeeApproval(transaction, this.network.registrationHash, now + EVM_FEE_APPROVAL_LIFETIME_MS);
      try {
        assertEvmFeeEstimateApproved(approval, { estimatedGas: gasLimit, balance, sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }) }, now);
      } catch (error) {
        return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
      }
      await this.canonical(read, sampled);
      await this.checkChain(read);
      return Object.freeze({ transaction, balanceUnits: balance.toString(),
        maximumFeeUnits: approval.maximumFeeUnits, totalUnits: approval.maximumTotalUnits });
    }, 'endpoint');
  }

  /** One SDK fee policy serves live native/token preparation and exact-envelope requotes. */
  prepare(input: TransferRequest, signal: AbortSignal,
    guard: () => void, approved?: EvmUnsignedTransfer, nonceOverride?: number): Promise<EvmPreparedQuote> {
    let request: TransferRequest;
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
      const quote = await this.prepareAtBlock(read, sampled, request, signal, approved, nonceOverride);
      await this.canonical(read, sampled); await this.checkChain(read); read.assertCurrent();
      return quote;
    });
  }

  /** Private read-only quote; neither this result nor the selection authorizes signing. */
  prepareNft(selection: NftTransferSelection, input: NftTransferRequest, signal: AbortSignal,
    guard: () => void, nonceOverride?: number): Promise<EvmNftPreparedQuote> {
    return this.quoteNft(selection, input, signal, guard, nonceOverride);
  }

  async requoteNft(selection: NftTransferSelection, approval: EvmNftPreparedQuote, signal: AbortSignal,
    guard: () => void): Promise<EvmNftPreparedQuote> {
    this.assertNftApproval(approval);
    const { recipient, tokenId, amountUnits } = approval.intent;
    return this.quoteNft(selection, { recipient, tokenId, amountUnits }, signal, guard, approval.nonceOverride, approval);
  }

  /** Same read owner, original expiry and (for dispatch) a successful requote. */
  assertNftApproval(approval: EvmNftPreparedQuote, requireRequote = false): void {
    const stage = this.nftQuotes.get(approval);
    if (!stage || (requireRequote && stage !== 'requoted'))
      return rejectRead('REVIEW_REQUIRED');
    const now = this.monotonicMilliseconds();
    if (!Number.isSafeInteger(now) || now < 0 || now >= approval.expiresAtMonotonicMilliseconds)
      return rejectRead('REVIEW_REQUIRED');
  }

  private async verifyNftAtBlock(read: Reader, sampled: ReadBlock, intent: NftTransferIntent, data: string): Promise<string> {
    const blockNumber = hex(BigInt(sampled.number));
    const code = await read('eth_getCode', [intent.contractAddress, blockNumber]);
    if (typeof code !== 'string' || code.length > 2 + CODE_BYTES * 2 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code))
      return rejectRead('INVALID_RESPONSE');
    const ownershipUnits = await readSelectedNftUnits(intent.from, intent.contractAddress, intent.tokenId, intent.tokenStandard,
      (probe) => read.nftCall({ to: intent.contractAddress, data: probe }, blockNumber));
    if (units(ownershipUnits, 'INVALID_RESPONSE') < BigInt(intent.amountUnits)) return rejectRead('INSUFFICIENT_NFT_BALANCE');
    const call = { from: intent.from, to: intent.contractAddress, value: '0x0', data };
    const simulation = await read.nftCall(call, blockNumber);
    if (simulation.kind === 'rpc-error')
      return rejectRead(normalizeNftExecutionRevert(simulation.error, call) ? 'NFT_TRANSFER_REJECTED' : 'INVALID_RESPONSE');
    if (simulation.data !== '0x') return rejectRead('NFT_TRANSFER_REJECTED');
    return ownershipUnits;
  }

  private async quoteNft(selection: NftTransferSelection, input: NftTransferRequest, signal: AbortSignal,
    guard: () => void, nonceOverride?: number, approval?: EvmNftPreparedQuote): Promise<EvmNftPreparedQuote> {
    guardedRead(guard);
    if (signal.aborted) return rejectRead('CANCELLED');
    const intent = snapshotNftTransferSelection(selection, input, this.network);
    const approved = approval && snapshotNftQuoteEnvelope(approval.envelope, this.network, intent);
    const request = Object.freeze({ from: intent.from, to: intent.contractAddress, value: '0', data: encodeNftTransferData(intent) });
    const result = await this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const ownershipUnits = await this.verifyNftAtBlock(read, sampled, intent, request.data);
      if (approval) this.assertNftApproval(approval);
      const { transaction, ...amounts } = await this.prepareAtBlock(read, sampled, request, signal, approved, nonceOverride, intent);
      if (BigInt(amounts.totalUnits) > BigInt(amounts.balanceUnits))
        return rejectRead('INSUFFICIENT_BALANCE');
      await this.canonical(read, sampled); await this.checkChain(read);
      const expiresAtMonotonicMilliseconds = approval?.expiresAtMonotonicMilliseconds ?? this.feeQuoteExpiry();
      read.assertCurrent();
      return Object.freeze({
        ...amounts, intent: approval?.intent ?? intent, envelope: approval?.envelope ?? transaction, ownershipUnits,
        ...(nonceOverride === undefined ? {} : { nonceOverride }),
        registrationHash: this.network.registrationHash,
        sampledBlock: Object.freeze({ number: sampled.number, hash: sampled.hash }),
        expiresAtMonotonicMilliseconds,
      });
    }, 'nft-quote');
    if (approval) this.assertNftApproval(approval);
    guardedRead(guard);
    if (signal.aborted) return rejectRead('CANCELLED');
    this.nftQuotes.set(result, approval ? 'requoted' : 'prepared');
    return result;
  }

  private feeQuoteExpiry(): number {
    const now = this.monotonicMilliseconds();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - EVM_FEE_APPROVAL_LIFETIME_MS)
      return rejectRead('INVALID_RESPONSE');
    return now + EVM_FEE_APPROVAL_LIFETIME_MS;
  }


  private async sampleSendNonce(read: Reader, from: string, nonceOverride?: number): Promise<{
    count: bigint;
    state: 'latest' | 'pending';
  }> {
    const readCount = async (tag: 'latest' | 'pending') =>
      quantity(await read('eth_getTransactionCount', [from, tag]));
    if (nonceOverride === undefined)
      return { count: await readCount('pending'), state: 'pending' };
    const [count, pending] = await Promise.all([readCount('latest'), readCount('pending')]);
    if (pending < count) return rejectRead('REVIEW_REQUIRED');
    // An external transaction at the overridden nonce can already affect
    // pending balance and execution state, though only one of the two can mine.
    return { count, state: BigInt(nonceOverride) < pending ? 'latest' : 'pending' };
  }

  /** Check the exact collectible envelope while the journal owns wire admission. */
  verifyNftForDispatch(intent: NftTransferIntent, input: EvmUnsignedTransfer, signal: AbortSignal,
    guard: () => void, replay: boolean, nonceOverride?: number): Promise<void> {
    const envelope = snapshotNftQuoteEnvelope(input, this.network, intent);
    const manual = nonceOverride !== undefined;
    if (manual && (replay || String(nonceOverride) !== envelope.nonce))
      return Promise.reject(new EvmTransferReadError('REVIEW_REQUIRED'));
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const nonceState = replay
        ? read('eth_getTransactionCount', [intent.from, 'latest']).then((value) => ({ count: quantity(value), state: 'pending' as const }))
        : this.sampleSendNonce(read, intent.from, nonceOverride);
      const state = manual ? nonceState.then((sample) => sample.state) : Promise.resolve('pending');
      const [{ count: observed }, rawBalance, rawEstimate] = await Promise.all([
        nonceState,
        state.then((tag) => read('eth_getBalance', [intent.from, tag])),
        this.verifyNftAtBlock(read, sampled, intent, envelope.data).then(async () =>
          read('eth_estimateGas', [evmEstimateRequest(envelope), await state])),
      ]);
      const nonce = BigInt(envelope.nonce);
      if (replay ? observed > nonce : !matchesSendNonce(observed, nonce, manual))
        return rejectRead(manual ? 'NONCE_UNAVAILABLE' : 'REVIEW_REQUIRED');
      const now = this.monotonicMilliseconds();
      const approval = captureEvmFeeApproval(envelope, this.network.registrationHash, this.feeQuoteExpiry());
      try {
        assertEvmFeeEstimateApproved(approval, {
          balance: quantity(rawBalance), estimatedGas: quantity(rawEstimate), sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }),
        }, now);
      } catch (error) {
        return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
      }
      await this.canonical(read, sampled); await this.checkChain(read); read.assertCurrent();
    }, 'nft-quote');
  }

  private async prepareAtBlock(read: Reader, sampled: ReadBlock, request: TransferRequest, signal: AbortSignal,
    approved?: EvmUnsignedTransfer, nonceOverride?: number, nft?: NftTransferIntent): Promise<EvmPreparedQuote> {
    const manual = nonceOverride !== undefined;
    if (manual && (!Number.isSafeInteger(nonceOverride) || nonceOverride < 0))
      return rejectRead('INVALID_INPUT');
    const nonceState = this.sampleSendNonce(read, request.from, nonceOverride);
    const [{ count: observed, state }, rawBalance, fees] = await Promise.all([
      nonceState,
      manual
        ? nonceState.then((sample) => read('eth_getBalance', [request.from, sample.state]))
        : read('eth_getBalance', [request.from, 'pending']),
      this.feeData(read, sampled, signal),
    ]);
    read.assertCurrent();
    const balance = quantity(rawBalance);
    if (observed > BigInt(Number.MAX_SAFE_INTEGER) || sampled.gasLimit < 21000n) return rejectRead('INVALID_RESPONSE');
    const nonce = manual ? BigInt(nonceOverride) : observed;
    if (!matchesSendNonce(observed, nonce, manual))
      return rejectRead('NONCE_UNAVAILABLE');
    const selectedFees = approved
      ? approved.type === 0 ? { type: 0 as const, gasPrice: approved.gasPrice }
        : { type: 2 as const, maxFeePerGas: approved.maxFeePerGas, maxPriorityFeePerGas: approved.maxPriorityFeePerGas }
      : fees.baseFeePerGas === undefined ? { type: 0 as const, gasPrice: fees.gasPrice.toString() }
        : { type: 2 as const, maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() };
    if (approved && (approved.nonce !== nonce.toString() || approved.from !== request.from || approved.to !== request.to || approved.value !== request.value || approved.data !== request.data)) return rejectRead('REVIEW_REQUIRED');
    if (selectedFees.type === 2 && (sampled.baseFee === null || BigInt(selectedFees.maxFeePerGas) < sampled.baseFee)) return rejectRead('REVIEW_REQUIRED');
    const estimate = quantity(await read('eth_estimateGas', [evmEstimateRequest({
      ...request, ...selectedFees, chainId: this.network.chainId, nonce: nonce.toString(),
    }), state]));
    read.assertCurrent();
    if (estimate < 21000n || estimate > sampled.gasLimit) return rejectRead('INVALID_RESPONSE');
    let gas: bigint;
    try {
      gas = approved
        ? BigInt(approved.gasLimit)
        : bufferEvmFeeEstimate(estimate, BigInt(this.network.chainId), sampled.gasLimit);
    } catch { return rejectRead('INVALID_RESPONSE'); }
    const envelope = { ...request, ...selectedFees, chainId: this.network.chainId,
      nonce: nonce.toString(), gasLimit: gas.toString() };
    const tx = nft ? snapshotNftQuoteEnvelope(envelope, this.network, nft) : snapshotUnsignedTransfer(envelope, this.network);
    let cost: ReturnType<typeof getEvmTransferCost>;
    try {
      cost = getEvmTransferCost(BigInt(tx.value), BigInt(tx.gasLimit),
        BigInt(tx.type === 0 ? tx.gasPrice : tx.maxFeePerGas));
    } catch { return rejectRead('INVALID_RESPONSE'); }
    {
      const approval = captureEvmFeeApproval(tx, this.network.registrationHash,
        this.feeQuoteExpiry());
      try { assertEvmFeeEstimateApproved(approval, { estimatedGas: estimate, sampledBlockGasLimit: sampled.gasLimit,
        ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }), balance }, this.monotonicMilliseconds()); }
      catch (error) {
        return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
      }
    }
    return Object.freeze({ transaction: tx, balanceUnits: balance.toString(), maximumFeeUnits: cost.maximumFee.toString(), totalUnits: cost.total.toString() });
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
