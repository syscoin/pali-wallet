import { withEvmReadPhase } from '../../../../source/shared/evmReadPhase.ts';
import { assertRetainedSmartAccountExecution } from '../../../../source/utils/smartAccount/executionSimulation.ts';
import { createBoundedRpcFetch } from './boundedRpcFetch.ts';
import { JsonRpcReadClient, RpcReadCapabilities, RpcReadError } from '@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js';
import { isReadOnlyRpcMethod, RpcResponseIntegrityError } from '@sidhujag/sysweb3-keyring/cjs/rpc-transport.js';
import { AUTOMATIC_FEE, chooseEvmFees, snapshotEvmFeeChoice, type EvmFeeChoice, type EvmFeeRates } from '../../../../source/shared/transactionFeeChoice.ts';
import { classifyDappRpcMethod, DAPP_PUBLIC_RPC_METHODS, normalizeDappRpcRequest, type DappPublicRpcMethod, type DappPublicRpcRequest } from '../../../../source/shared/dappRpcReads.ts';
import { EthereumRpcErrorHandler, serializePublicRpcError } from '../../../../source/helpers/errors/errorClassesHandlers.ts';
import { assertPublicResponseBudget, DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import { privacyWithdrawalFees } from '../../../../source/utils/privacy/withdrawalFees.ts';
import { captureEvmGasPolicy, prepareEvmDappQuote, EvmDappReviewRequiredError, type EvmDappPreparedQuote, type EvmDappQuote, type EvmDappTransactionRequest, type EvmGasPolicy } from '../../../../source/shared/evmDappPreparation.ts';
import { getAddress } from 'ethers/address';
import { getEvmFeeData, assertEvmGasLimit, planEvmCancellationFees, planEvmSpeedUpFees } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { Transaction } from 'ethers/transaction';
import { encodeNftTransferData, type NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import { normalizeNftExecutionRevert } from '../../../../source/shared/nftReads.ts';
import { snapshotNftTransferSelection, type NftTransferRequest, type NftTransferSelection } from './nftTransferAdmission.ts';
import { boundedResponseText, parseRpcQuantity } from '../platformRpc.ts';
import { getNativeNetwork, snapshotNativeNetwork, type EvmNetworkId, type NativeNetworkRegistration } from './networkContext.ts';
import { assembleFeeQuote, checkedReadHash, EvmTransferReadError, guardedRead, readOwnData,
  EvmAutomaticNonceUnresolved, matchesSendNonce, rejectRead, snapshotCancellationTransfer, snapshotNftQuoteEnvelope, snapshotReplacementTransfer, snapshotUnsignedTransfer, units } from './evmFeeContracts.ts';
import { availableEvmNativeBalance, availableEvmReplacementBalance, assertEvmAssetReservations, type EvmAutoNonceSnapshot, type EvmAutoNonceAcceptance, type EvmAutoNoncePlan, type EvmNativeReservations } from '../../../../source/shared/evmAutoNonce.ts';
import { EvmAssetStateError, readEvmAssetState, assertEvmAssetStateCanonical, simulateEvmAssetTransfer,
  type EvmAssetState, type EvmTransferAsset } from '../../../../source/shared/evmAssetState.ts';
import { parseErc20Decimals } from '../../../../source/shared/erc20.ts';
import type { EvmFeeQuote, EvmSampledBlock, EvmUnsignedTransfer } from './evmFeeContracts.ts';
import { observeEvmTransaction, EvmObservationError, type EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import { getEvmTransferCost } from '../../../../source/shared/evmTransferCost.ts';
import { refineNativeEvmMaximum } from '../../../../source/shared/evmNativeMaximum.ts';
import { evmEstimateRequest } from '../../../../source/shared/evmEstimateRequest.ts';
import { type EvmFeeFunding, captureNativeEvmFeeCoverage, assertEvmFeeEstimateApproved, bufferEvmFeeEstimate, captureEvmFeeApproval,
  EVM_FEE_APPROVAL_LIFETIME_MS, EvmFeeBalanceError } from '../../../../source/shared/evmFeeApproval.ts';
import { assertEvmCancellationPayerReady, assertRetainedEvmCancellationReady, EvmCancellationNonceError, EvmCancellationPayerCodeError, isEvmProtectedEmptySelfCall } from '../../../../source/shared/evmCancellationPayer.ts';
import type { CallsStatusPhase } from '../../../../source/wallet/dappCallsBundles.ts';
import type { EvmReplacementRates, EvmSignedRetirementReadMethod } from '../../../../source/wallet/evmSignedRecords.ts';
import type { GuardianRecoveryObservation } from '../../../../source/utils/smartAccount/guardianStatus.ts';
import { createSmartAccountInfrastructureReader, SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES } from '../../../../source/utils/smartAccount/infrastructureObservation.ts';
import { ExecutionSimulationUnsupportedError, normalizeExecutionSimulationError } from '../../../../source/utils/smartAccount/executionSimulationError.ts';
export type { EvmDappPreparedQuote, EvmDappTransactionRequest } from '../../../../source/shared/evmDappPreparation.ts';

const RETIREMENT_METHODS: Readonly<Record<EvmSignedRetirementReadMethod, true>> = Object.freeze({
  eth_chainId: true,
  eth_getBlockByNumber: true,
  eth_getTransactionCount: true,
  eth_getTransactionReceipt: true,
});
const BLOCK_BYTES = 512 * 1024;
const RECEIPT_BYTES = 1024 * 1024;
const CODE_BYTES = 32 * 1024;
export type NativeSmartAccountReadMethod = 'eth_getLogs' | 'eth_getTransactionByHash' | 'eth_simulateV1' | 'eth_call' | 'eth_getCode' | 'eth_getBalance' | 'eth_estimateGas' | 'eth_getBlockByNumber' | 'eth_chainId' | 'eth_gasPrice' | 'eth_maxPriorityFeePerGas' | 'eth_feeHistory' | 'eth_getTransactionCount' | 'eth_getTransactionReceipt';
export type NativeSmartAccountReadPhase = Readonly<{
  read(method: NativeSmartAccountReadMethod, params: readonly unknown[]): Promise<unknown>;
  readFresh?(method: NativeSmartAccountReadMethod, params: readonly unknown[]): Promise<unknown>;
  readMany(requests: readonly { method: NativeSmartAccountReadMethod; params: readonly unknown[] }[]): Promise<PromiseSettledResult<unknown>[]>;
  feeData(getBlock?: () => Promise<unknown>): ReturnType<EvmTransferReadRpc['smartAccountFeeData']>;
  assertCurrent(): void;
}>;
type Method = 'eth_simulateV1' | DappPublicRpcMethod | 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call' | 'eth_getStorageAt' | 'eth_gasPrice' |
  'eth_maxPriorityFeePerGas' | 'eth_feeHistory' | 'eth_getBalance' | 'eth_estimateGas' | 'eth_getTransactionReceipt' | 'eth_getTransactionCount' | 'eth_getTransactionByHash';
const METHODS: readonly string[] = Object.freeze(['eth_simulateV1', ...DAPP_PUBLIC_RPC_METHODS, 'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getStorageAt', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_getTransactionByHash']);
type Reader = ((method: Method, params: readonly unknown[]) => Promise<unknown>) & {
  signal: AbortSignal;
  assertCurrent(): void;
  many(requests: readonly { method: Method; params: readonly unknown[] }[]): Promise<PromiseSettledResult<unknown>[]>;
  verifyChain?(): Promise<void>;
  fresh?(method: Method, params: readonly unknown[]): Promise<unknown>;
};
type TransferRequest = Readonly<{ from: string; to: string; value: string; data: string }>;
type ReadBlock = EvmSampledBlock & Readonly<{ baseFee: bigint | null; gasLimit: bigint }>;
type ReceiptRequest = Readonly<{ hash: string; from: string; to: string | null; nonce: string }>;
export type NativeAutomaticNoncePlanner = (
  input: Pick<Parameters<EvmAutoNonceAcceptance['plan']>[0], 'latest' | 'pending' | 'readPending' | 'assertCurrent' | 'assetState' | 'nonceOverride'> & { readPhase?: NativeSmartAccountReadPhase }
) => Promise<EvmAutoNoncePlan>;
type SendNonceSample = Readonly<{
  nonce: bigint;
  count: bigint;
  pending: bigint;
  nativeReservations: EvmNativeReservations;
  state: 'latest' | 'pending';
  balanceState: 'latest' | 'pending';
}>;
export type EvmReceiptObservation = Readonly<
  | { status: 'included'; outcome: 'succeeded' | 'reverted'; canonicalObserved: true; block: EvmSampledBlock }
  | { status: 'nonce-consumed' }
>;
export type EvmPreparedQuote = Readonly<{ transaction: EvmUnsignedTransfer; balanceUnits: string; maximumFeeUnits: string; totalUnits: string; assetBalanceUnits?: string }>;
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
function nftAsset(intent: NftTransferIntent): EvmTransferAsset {
  return { standard: intent.tokenStandard === 'ERC-721' ? 'ERC721' : 'ERC1155',
    contractAddress: intent.contractAddress, amountUnits: intent.amountUnits, tokenId: intent.tokenId };
}
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
/** Wallet reads and classified public-node RPC; never wallet signing or signed-envelope broadcast. */
export class EvmTransferReadRpc {
  private readonly network;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly monotonicMilliseconds: () => number;
  private sequence = 0;
  private readonly capabilities: RpcReadCapabilities;
  private readonly nftQuotes = new WeakMap<EvmNftPreparedQuote, 'prepared' | 'requoted'>();
  private readonly readInfrastructure: ReturnType<typeof createSmartAccountInfrastructureReader>;
  /** Custom clocks must be monotonic milliseconds with one stable origin, never Date.now(). */
  constructor(id: EvmNetworkId | NativeNetworkRegistration, options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; monotonicMilliseconds?: () => number; capabilities?: RpcReadCapabilities; infrastructureReader?: ReturnType<typeof createSmartAccountInfrastructureReader> } = {}) {
    this.network = typeof id === 'string' ? getNativeNetwork(id) : snapshotNativeNetwork(id);
    this.readInfrastructure = options.infrastructureReader ?? createSmartAccountInfrastructureReader();
    this.capabilities = options.capabilities ?? new RpcReadCapabilities(this.network.rpcUrl);
    this.fetcher = createBoundedRpcFetch(options.fetch ?? ((url, init) => fetch(url, init)));
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.monotonicMilliseconds = options.monotonicMilliseconds ?? (() => Math.floor(performance.now()));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000) throw new Error('Invalid read timeout');
  }
  private async operation<T>(external: AbortSignal, guard: () => void, work: (read: Reader) => Promise<T>, scope?: 'endpoint' | 'nft-quote' | 'smart-account' | 'dapp-rpc'): Promise<T> {
    guardedRead(guard);
    if (external.aborted) return rejectRead('CANCELLED');
    const controller = new AbortController();
    let responseFailure: unknown;
    const nft = scope === 'nft-quote';
    const smartCallReverts = new WeakSet<Error>();
    const unsupportedPriorityErrors = new WeakSet<Error>();
    const expectedUrl = scope ? new URL(this.network.rpcUrl).href : undefined;
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const limitFor = (method: Method) => method === 'eth_simulateV1' ? 2 * 1024 * 1024 : scope === 'dapp-rpc' ? DAPP_REQUEST_LIMITS.bytes
      : method === 'eth_getTransactionReceipt' ? RECEIPT_BYTES : method === 'eth_getBlockByNumber' ? BLOCK_BYTES
      : method === 'eth_getCode' ? CODE_BYTES * 2 + 512 : 16 * 1024;
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
      try {
        guardedRead(guard);
        if (expectedUrl && (response.redirected ||
            (response.url && new URL(response.url).href !== expectedUrl)))
          return rejectRead('PROFILE_CHANGED');
        if (!response.ok) return rejectRead('UNAVAILABLE');
        const contentType = response.headers.get('content-type');
        if (contentType && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType)) return rejectRead('INVALID_RESPONSE');
      } catch (error) {
        responseFailure = error;
        controller.abort();
        try { await response.body?.cancel(); } catch { /* Keep the primary refusal. */ }
        throw error;
      }
      const limit = limitFor(method);
      const text = await cancellable(boundedResponseText(response, controller.signal, limit), controller.signal);
      guardedRead(guard);
      const result = object(JSON.parse(text));
      if (result.jsonrpc !== '2.0' || result.id !== id) return rejectRead('INVALID_RESPONSE');
      return result;
    };
    const resultValue = (result: Record<string, unknown>, method: Method, params: readonly unknown[]) => {
      if (Object.hasOwn(result, 'error')) {
        if (Object.hasOwn(result, 'result')) return rejectRead('INVALID_RESPONSE');
        const error = object(result.error);
        if (scope === 'dapp-rpc') {
          if (!Number.isInteger(error.code) || Number(error.code) < -2147483648 || Number(error.code) > 2147483647 || typeof error.message !== 'string' || !error.message) return rejectRead('INVALID_RESPONSE');
          assertPublicResponseBudget(error);
          const response = serializePublicRpcError(error);
          throw new EthereumRpcErrorHandler(response.code, response.message, response.data);
        }
        if (method === 'eth_simulateV1') {
          const simulationError = normalizeExecutionSimulationError(error);
          if (simulationError instanceof ExecutionSimulationUnsupportedError)
            throw simulationError;
        }
        // Only an explicit unsupported priority-fee method reaches the SDK's bounded history fallback.
        if (method === 'eth_maxPriorityFeePerGas' && (error.code === -32601 || error.code === 4200)) {
          const unsupported = Object.assign(new Error('Unsupported priority fee RPC'), { code: error.code });
          unsupportedPriorityErrors.add(unsupported);
          throw unsupported;
        }
        if (method === 'eth_call') {
          if ((scope === 'smart-account' || scope === 'nft-quote' || scope === 'endpoint') && params[0] && typeof params[0] === 'object') {
            const to = Object.getOwnPropertyDescriptor(params[0], 'to')?.value;
            const data = Object.getOwnPropertyDescriptor(params[0], 'data')?.value;
            if (typeof to === 'string' && typeof data === 'string') {
              const normalized = normalizeNftExecutionRevert(error, { to, data });
              if (normalized) {
                if (scope === 'nft-quote' && Object.getOwnPropertyDescriptor(params[0], 'from'))
                  throw new EvmAssetStateError('TRANSFER_REJECTED');
                smartCallReverts.add(normalized); throw normalized;
              }
            }
          }
          throw error;
        }
        return rejectRead('INVALID_RESPONSE');
      }
      if (!Object.hasOwn(result, 'result')) return rejectRead('INVALID_RESPONSE');
      return result.result;
    };
    const batch = new JsonRpcReadClient(this.network.rpcUrl, {
      capabilities: this.capabilities,
      signal: controller.signal, timeoutMs: this.timeoutMs, recoverResponse: false, maxConcurrency: 4,
      maxBatchItems: 40, maxRequestBytes: scope === 'dapp-rpc' ? DAPP_REQUEST_LIMITS.bytes : 256 * 1024,
      maxResponseBytes: 2 * 1024 * 1024,
      requestInit: { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' },
      fetch: async (url, init) => {
        guardedRead(guard);
        if (url !== this.network.rpcUrl) return rejectRead('PROFILE_CHANGED');
        const response = await this.fetcher(url, init);
        try {
          guardedRead(guard);
          if (response.redirected || (response.url && new URL(response.url).href !== new URL(this.network.rpcUrl).href))
            return rejectRead('PROFILE_CHANGED');
          const type = response.headers.get('content-type');
          if (type && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(type))
            return rejectRead('INVALID_RESPONSE');
          return response;
        } catch (error) {
          responseFailure = error;
          controller.abort();
          try { await response.body?.cancel(); } catch { /* Keep the primary refusal. */ }
          throw error;
        }
      },
    });
    const readFailure = (error: unknown): never => {
      guardedRead(guard);
      if (error instanceof EvmTransferReadError || error instanceof EvmAssetStateError) throw error;
      if (controller.signal.aborted) return rejectRead('CANCELLED');
      if (error instanceof ExecutionSimulationUnsupportedError) throw error;
      if (error instanceof Error && (smartCallReverts.has(error) || unsupportedPriorityErrors.has(error))) throw error;
      if (error instanceof RpcResponseIntegrityError) return rejectRead('INVALID_RESPONSE');
      if (scope === 'dapp-rpc' && error instanceof EthereumRpcErrorHandler) throw error;
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number')
        return rejectRead('INVALID_RESPONSE');
      return rejectRead('UNAVAILABLE');
    };
    const read: Reader = Object.assign(async (method: Method, params: readonly unknown[]) => {
      if (controller.signal.aborted) return rejectRead('CANCELLED');
      guardedRead(guard);
      if (!METHODS.includes(method)) return rejectRead('INVALID_INPUT');
      try {
        if (scope === 'dapp-rpc' || method === 'eth_simulateV1') return resultValue(await request(method, params), method, params);
        const result = await batch.read(method, params, { signal: controller.signal, maxResponseBytes: limitFor(method) });
        guardedRead(guard);
        if (controller.signal.aborted) return rejectRead('CANCELLED');
        return result;
      } catch (error) {
        if (error instanceof RpcReadError) {
          try { return resultValue({ error }, method, params); }
          catch (error) { return readFailure(error); }
        }
        return readFailure(error);
      }
    }, {
      signal: controller.signal,
      many: async (requests: readonly { method: Method; params: readonly unknown[] }[]) => {
        guardedRead(guard);
        const results = requests.some(request => request.method === 'eth_simulateV1')
          ? await Promise.allSettled(requests.map(({method, params}) => read(method, params)))
          : await batch.readMany(requests, { signal: controller.signal }).catch(readFailure);
        guardedRead(guard);
        if (controller.signal.aborted) return rejectRead('CANCELLED');
        return results.map((result, index): PromiseSettledResult<unknown> => {
          const method = requests[index]!.method;
          const limit = limitFor(method);
          if (result.status === 'fulfilled') {
            if (new TextEncoder().encode(JSON.stringify(result.value)).byteLength > limit)
              return { status: 'rejected', reason: new EvmTransferReadError('INVALID_RESPONSE') };
            return result;
          }
          try {
            if (result.reason instanceof RpcReadError) {
              try { return { status: 'fulfilled', value: resultValue({ error: { code: result.reason.code, message: result.reason.message, data: result.reason.data } }, requests[index]!.method, requests[index]!.params) }; }
              catch (error) { readFailure(error); }
            }
            readFailure(result.reason);
          } catch (error) { return { status: 'rejected', reason: error }; }
          return result;
        });
      },
      assertCurrent: () => { guardedRead(guard); if (controller.signal.aborted) rejectRead('CANCELLED'); },

    });
    try {
      const result = await cancellable(work(read), controller.signal);
      guardedRead(guard);
      return result;
    } catch (error) {
      guardedRead(guard);
      if (responseFailure) throw responseFailure;
      if (error instanceof EvmTransferReadError) throw error;
      if (controller.signal.aborted) return rejectRead('CANCELLED');
      if (error instanceof EvmAssetStateError) {
        if (nft) return rejectRead(error.code === 'INSUFFICIENT_ASSET' ? 'INSUFFICIENT_NFT_BALANCE'
          : error.code === 'TRANSFER_REJECTED' ? 'NFT_TRANSFER_REJECTED' : error.code);
        throw error;
      }
      // RPC errors are normalized by read/readMany before entering application
      // callbacks. Preserve their own domain exceptions without matching text.
      throw error;
    } finally {
      controller.abort(); batch.destroy(); clearTimeout(timer); external.removeEventListener('abort', abort);
    }
  }
  private async checkChain(read: Reader) {
    if (read.verifyChain) return read.verifyChain();
    read.assertCurrent();
    const chain = await read('eth_chainId', []);
    read.assertCurrent();
    if (quantity(chain) !== BigInt(this.network.chainId)) rejectRead('PROFILE_CHANGED');
  }
  private readPhaseOperation<T>(external: AbortSignal, guard: () => void, work: (read: Reader) => Promise<T>,
    scope: 'endpoint' | 'nft-quote' = 'endpoint'): Promise<T> {
    return this.operation(external, guard, read => withEvmReadPhase({
      signal: read.signal,
      send: (method, params) => read(method as Method, params),
      readMany: requests => read.many(requests.map(request => ({ ...request, method: request.method as Method }))),
      verifyConfiguredChainId: () => this.checkChain(read),
    }, read.assertCurrent, provider => work(Object.assign(
      (method: Method, params: readonly unknown[]) => provider.send(method, [...params]),
      { signal: read.signal, assertCurrent: read.assertCurrent, many: provider.readMany,
        fresh: (method: Method, params: readonly unknown[]) => provider.sendFresh(method, [...params]),
        verifyChain: () => provider.verifyConfiguredChainId() },
    ) as Reader)), scope);
  }
  private async canonical(read: Reader, expected: EvmSampledBlock) {
    read.assertCurrent();
    const current = block(await (read.fresh ?? read)('eth_getBlockByNumber', [hex(BigInt(expected.number)), false]));
    read.assertCurrent();
    if (current.number !== expected.number || current.hash !== expected.hash) rejectRead('PROFILE_CHANGED');
  }
  private assertAssetCanonical(read: Reader, state: EvmAssetState): Promise<void> {
    return assertEvmAssetStateCanonical(read.fresh ?? read, state);
  }
  retirementRead(method: EvmSignedRetirementReadMethod, params: readonly unknown[],
    signal: AbortSignal, guard: () => void): Promise<unknown> {
    if (typeof method !== 'string' || !Object.hasOwn(RETIREMENT_METHODS, method))
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, (read) => read(method, params), 'endpoint');
  }
  callsStatusPhase<T>(signal: AbortSignal, guard: () => void, work: (reads: CallsStatusPhase) => Promise<T>): Promise<T> {
    return this.operation(signal, guard, async read => {
      await this.checkChain(read);
      const values = async (method: 'eth_getTransactionReceipt' | 'eth_getBlockByNumber', args: readonly unknown[][]) => {
        const results = await read.many(args.map(params => ({ method, params })));
        read.assertCurrent();
        return results.map(result => result.status === 'fulfilled' ? result.value : null);
      };
      const result = await work({
        receipts: hashes => values('eth_getTransactionReceipt', hashes.map(hash => [hash])),
        blockHashes: async heights => (await values('eth_getBlockByNumber', heights.map(height => [height, false])))
          .map((raw, index) => {
            try {
              const entry = object(raw);
              return quantity(entry.number) === BigInt(heights[index]!) ? checkedReadHash(entry.hash) : null;
            } catch { return null; }
          }),
      });
      await this.checkChain(read);
      return result;
    }, 'endpoint');
  }
  /** The shared finalized-note verifier owns the surrounding chain and anchor checks. */
  noteMaintenanceRead(method: string, params: readonly unknown[], signal: AbortSignal, guard: () => void): Promise<unknown> {
    if (method === 'eth_chainId') {
      if (!Array.isArray(params) || params.length !== 0)
        return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
      return this.operation(signal, guard, read => read('eth_chainId', []), 'endpoint');
    }
    if (method === 'eth_getTransactionCount' && (!Array.isArray(params) || params.length !== 2 ||
        typeof params[0] !== 'string' || !/^0x[\da-f]{40}$/i.test(params[0]) ||
        typeof params[1] !== 'string' || params[1].length > 66 || !/^0x(?:0|[1-9a-f][\da-f]*)$/.test(params[1])))
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    if (!['eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_call'].includes(method))
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    const normalized = normalizeDappRpcRequest(method, params);
    return this.operation(signal, guard, read => read(normalized.method, normalized.params), 'endpoint');
  }
  verifyNetwork(signal: AbortSignal, guard: () => void): Promise<void> {
    return this.operation(signal, guard, async (read) => { await this.checkChain(read); }, 'endpoint');
  }
  dappRequest(input: DappPublicRpcRequest, signal: AbortSignal, guard: () => void,
    verifyPublicIdentity?: (signal: AbortSignal, assertCurrent: () => void) => Promise<void>): Promise<unknown> {
    const request = normalizeDappRpcRequest(input.method, input.params);
    if (classifyDappRpcMethod(request.method) === 'local-verification') return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    if ((request.method === 'eth_call' || request.method === 'eth_estimateGas') && (request.params[0] as { chainId?: string }).chainId !== undefined && BigInt((request.params[0] as { chainId: string }).chainId) !== BigInt(this.network.chainId)) return Promise.reject(new EthereumRpcErrorHandler(-32602, 'Transaction chainId does not match selected chain'));
    return this.operation(signal, guard, async read => {
      await (verifyPublicIdentity ? verifyPublicIdentity(read.signal, read.assertCurrent) : this.checkChain(read));
      const result = await read(request.method, request.params);
      await (verifyPublicIdentity ? verifyPublicIdentity(read.signal, read.assertCurrent) : this.checkChain(read));
      assertPublicResponseBudget(result);
      return result;
    }, 'dapp-rpc');
  }
  /** The caller owns the verified public-read lease and each subscriber's cancellation. */
  dappReadBatch(requests: readonly DappPublicRpcRequest[], signal: AbortSignal,
    guard: () => void): Promise<PromiseSettledResult<unknown>[]> {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 32)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    const normalized = requests.map(request => normalizeDappRpcRequest(request.method, request.params));
    if (normalized.some(request => classifyDappRpcMethod(request.method) !== 'node-query' ||
        !isReadOnlyRpcMethod(request.method) ||
        (request.method === 'eth_call' || request.method === 'eth_estimateGas') &&
        (request.params[0] as { chainId?: string }).chainId !== undefined &&
        BigInt((request.params[0] as { chainId: string }).chainId) !== BigInt(this.network.chainId)))
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, async read => {
      const results = await read.many(normalized);
      return results.map(result => {
        if (result.status === 'rejected') return result;
        try { assertPublicResponseBudget(result.value); return result; }
        catch (reason) { return { status: 'rejected', reason } as PromiseRejectedResult; }
      });
    }, 'dapp-rpc');
  }
  smartAccountRead(method: 'eth_getLogs' | 'eth_getTransactionByHash' | 'eth_simulateV1' | 'eth_call' | 'eth_getCode' | 'eth_getBalance' | 'eth_estimateGas' | 'eth_getBlockByNumber' | 'eth_chainId' | 'eth_gasPrice' | 'eth_maxPriorityFeePerGas' | 'eth_feeHistory',
    params: readonly unknown[], signal: AbortSignal, guard: () => void): Promise<unknown> {
    const allowed = ['eth_getLogs', 'eth_getTransactionByHash', 'eth_simulateV1', 'eth_call', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas', 'eth_getBlockByNumber', 'eth_chainId', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory'];
    if (!allowed.includes(method) || !Array.isArray(params) || params.length > 5)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const result = await read(method, params);
      await this.checkChain(read);
      return result;
    }, 'smart-account');
  }
  smartAccountReadPhase<T>(signal: AbortSignal, guard: () => void,
    work: (phase: NativeSmartAccountReadPhase) => Promise<T>): Promise<T> {
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const phase = Object.freeze({
        readFresh: (method: NativeSmartAccountReadMethod, params: readonly unknown[]) => read(method, params),
        read: (method: NativeSmartAccountReadMethod, params: readonly unknown[]) => {
          if (!['eth_getLogs', 'eth_getTransactionByHash', 'eth_simulateV1', 'eth_call', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas', 'eth_getBlockByNumber',
            'eth_chainId', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
            'eth_getTransactionCount', 'eth_getTransactionReceipt'].includes(method) || !Array.isArray(params) || params.length > 5)
            return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
          return read(method, params);
        },
        readMany: (requests: readonly { method: NativeSmartAccountReadMethod; params: readonly unknown[] }[]) => {
          if (requests.some(request => !['eth_getLogs', 'eth_simulateV1', 'eth_getTransactionByHash', 'eth_call', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas', 'eth_getBlockByNumber',
            'eth_chainId', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
            'eth_getTransactionCount', 'eth_getTransactionReceipt'].includes(request.method) || !Array.isArray(request.params) || request.params.length > 5))
            return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
          return read.many(requests);
        },
        feeData: async (getBlock?: () => Promise<unknown>) => {
          read.assertCurrent();
          const sampled = block(await (getBlock ? getBlock() : read('eth_getBlockByNumber', ['latest', false])));
          read.assertCurrent();
          return this.feeData(read, sampled, signal);
        },
        assertCurrent: read.assertCurrent,
      });
      const result = await work(phase);
      await this.checkChain(read);
      return result;
    }, 'smart-account');
  }
  smartAccountFeeData(signal: AbortSignal, guard: () => void) {
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const fees = await this.feeData(read, sampled, signal);
      await this.checkChain(read);
      return fees;
    }, 'smart-account');
  }
  async assertSmartAccountSupported(signal: AbortSignal, guard: () => void): Promise<void> {
    return this.operation(signal, guard, async (read) => {
      await this.checkChain(read);
      await this.checkSmartAccountInfrastructure(read);
    }, 'smart-account');
  }
  private observeSmartAccountInfrastructure(read: Reader) {
    return this.readInfrastructure({
      chainId: Number(this.network.chainId), url: this.network.rpcUrl,
      provider: { send: (method, params) => read(method as Method, params),
        verifyConfiguredChainId: () => this.checkChain(read) },
      assertCurrent: read.assertCurrent,
      readCodes: async block => {
        const outcomes = await read.many(SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.map(address => ({ method: 'eth_getCode' as const, params: [address, block] })));
        return outcomes.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
      },
    });
  }
  private async checkSmartAccountInfrastructure(read: Reader): Promise<void> {
    const { assertSmartAccountInfrastructureReady } = await import('../../../../source/utils/smartAccount/infrastructureObservation.ts');
    assertSmartAccountInfrastructureReady(await this.observeSmartAccountInfrastructure(read));
  }
  readSmartAccountInfrastructureStatus(signal: AbortSignal, guard: () => void) {
    return this.operation(signal, guard, async read => {
      const result = await this.observeSmartAccountInfrastructure(read);
      return result;
    }, 'smart-account');
  }
  infrastructureAttemptRead(method: 'eth_getTransactionReceipt' | 'eth_getTransactionCount', params: readonly unknown[], signal: AbortSignal, guard: () => void) {
    if (!['eth_getTransactionReceipt', 'eth_getTransactionCount'].includes(method)) return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.operation(signal, guard, async read => {
      await this.checkChain(read);
      const result = await read(method, params);
      await this.checkChain(read);
      return result;
    }, 'smart-account');
  }
  prepareSmartAccount(accountIndex: number, managementAddress: string, signal: AbortSignal, guard: () => void) {
    return this.operation(signal, guard, async (read) => {
      const { deriveDefaultSmartAccount } = await import('../../../../source/utils/smartAccount/bootstrap.ts');
      const chainId = Number(this.network.chainId);
      return deriveDefaultSmartAccount({
        accountIndex, chainId, managementAddress, assertCurrent: read.assertCurrent,
        provider: {
          async getNetwork() { return { chainId: quantity(await read('eth_chainId', [])) }; },
          verifyConfiguredChainId: () => this.checkChain(read),
          async call(transaction) {
            const result = await read('eth_call', [transaction, 'latest']);
            if (typeof result !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(result)) return rejectRead('INVALID_RESPONSE');
            return result;
          },
        },
        assertInfrastructureSupported: () => this.checkSmartAccountInfrastructure(read),
      });
    }, 'smart-account');
  }
  readGuardianRecoveryStatus(account: string, signal: AbortSignal, guard: () => void): Promise<NativeGuardianRecoveryStatus> {
    return this.readGuardianRecovery(account, undefined, signal, guard);
  }
  readGuardianRecoveryOperation(account: string, operationId: string, signal: AbortSignal, guard: () => void): Promise<NativeGuardianRecoveryStatus> {
    return this.readGuardianRecovery(account, operationId, signal, guard);
  }
  private readGuardianRecovery(account: string, knownOperationId: string | undefined, signal: AbortSignal, guard: () => void): Promise<NativeGuardianRecoveryStatus> {
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
          knownOperationId,
          provider: { send: read, readMany: requests => read.many(requests) },
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

  feeRecommendations(signal: AbortSignal, guard: () => void): Promise<EvmFeeRates> {
    return this.readPhaseOperation(signal, guard, async read => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const fees = await this.feeData(read, sampled, signal);
      await this.canonical(read, sampled); read.assertCurrent();
      return Object.freeze(fees.baseFeePerGas === undefined
        ? { type: 0 as const, gasPrice: fees.gasPrice.toString() }
        : { type: 2 as const, maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() });
    }, 'endpoint');
  }

  prepareCancellation(original: Transaction, rates: EvmReplacementRates, source: 'pending' | 'saved',
    signal: AbortSignal, guard: () => void, approved?: EvmUnsignedTransfer): Promise<EvmCancellationQuote> {
    const { from, to, hash, nonce, chainId } = original;
    if (!from || !hash || rates.type !== original.type || chainId.toString() !== this.network.chainId)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    if (approved) approved = snapshotReplacementTransfer(approved, this.network);
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const verifyPayer = source === 'saved'
        ? assertRetainedEvmCancellationReady({ from, to, hash, nonce: String(nonce), chainId: this.network.chainId }, read, read.assertCurrent)
        : assertEvmCancellationPayerReady(from, nonce, (method, address, tag) =>
          read(method, [address, tag]), read.assertCurrent);
      const [rawBalance, fees] = await Promise.all([
        read('eth_getBalance', [from, 'latest']),
        approved ? undefined : this.feeData(read, sampled, signal),
        verifyPayer.catch((error) => {
            if (error instanceof EvmCancellationNonceError && error.reason === 'queued')
              return rejectRead('CANCELLATION_QUEUED');
            if (error instanceof EvmCancellationNonceError || error instanceof EvmCancellationPayerCodeError)
              return rejectRead('REVIEW_REQUIRED');
            throw error;
        }),
      ]);
      read.assertCurrent();
      if (rates.type === 2 && sampled.baseFee === null) return rejectRead('REVIEW_REQUIRED');
      const minimum = rates.type === 0
        ? planEvmCancellationFees({ type: 0, currentGasPrice: fees?.gasPrice ?? 0n, originalGasPrice: rates.gasPrice })
        : planEvmCancellationFees({ type: 2, currentMaxFeePerGas: fees?.maxFeePerGas ?? 0n,
          currentMaxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? 0n, originalMaxFeePerGas: rates.maxFeePerGas,
          originalMaxPriorityFeePerGas: rates.maxPriorityFeePerGas });
      let feePlan = minimum;
      if (approved) {
        if (approved.type !== minimum.type || BigInt(approved.gasLimit) !== minimum.gasLimit ||
            approved.nonce !== String(nonce)) return rejectRead('REVIEW_REQUIRED');
        if (approved.type === 0 && minimum.type === 0) {
          if (BigInt(approved.gasPrice) < minimum.gasPrice) return rejectRead('REVIEW_REQUIRED');
          feePlan = { ...minimum, gasPrice: BigInt(approved.gasPrice), maximumFee: minimum.gasLimit * BigInt(approved.gasPrice) };
        } else if (approved.type === 2 && minimum.type === 2) {
          if (BigInt(approved.maxFeePerGas) < minimum.maxFeePerGas ||
              BigInt(approved.maxPriorityFeePerGas) < minimum.maxPriorityFeePerGas ||
              BigInt(approved.maxFeePerGas) < sampled.baseFee!) return rejectRead('REVIEW_REQUIRED');
          feePlan = { ...minimum, maxFeePerGas: BigInt(approved.maxFeePerGas), maxPriorityFeePerGas: BigInt(approved.maxPriorityFeePerGas),
            maximumFee: minimum.gasLimit * BigInt(approved.maxFeePerGas) };
        }
        snapshotCancellationTransfer(approved, this.network, from, feePlan);
      }
      assertEvmGasLimit(feePlan.gasLimit, chainId, sampled.gasLimit);
      const transaction = snapshotCancellationTransfer({
        from, to: from, chainId: this.network.chainId, nonce: String(nonce),
        value: '0', data: '0x', gasLimit: feePlan.gasLimit.toString(),
        ...(feePlan.type === 0 ? { type: 0, gasPrice: feePlan.gasPrice.toString() } : {
          type: 2, accessList: [], maxFeePerGas: feePlan.maxFeePerGas.toString(), maxPriorityFeePerGas: feePlan.maxPriorityFeePerGas.toString(),
        }),
      }, this.network, from, feePlan);
      await this.canonical(read, sampled);
      await this.checkChain(read);
      const maximumFeeUnits = feePlan.maximumFee.toString();
      return Object.freeze({ transaction, feePlan, balanceUnits: quantity(rawBalance).toString(), maximumFeeUnits, totalUnits: maximumFeeUnits });
    });
  }

  prepareSpeedUp(original: Transaction, rates: EvmReplacementRates, signal: AbortSignal, guard: () => void, asset?: EvmTransferAsset, expectedDecimals?: number): Promise<EvmPreparedQuote> {
    const { from, to, nonce, value, data, gasLimit, chainId } = original;
    if (!from || rates.type !== original.type || chainId.toString() !== this.network.chainId)
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const assetState = asset && await readEvmAssetState(read, from, asset, { number: hex(BigInt(sampled.number)), hash: sampled.hash });
      if (assetState) {
        if (assetState.balanceUnits < BigInt(assetState.asset.amountUnits)) throw new EvmAssetStateError('INSUFFICIENT_ASSET');
        if (expectedDecimals !== undefined) await this.assertTokenDecimals(read, assetState, expectedDecimals);
      }
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
      const transaction = snapshotReplacementTransfer({
        from, to, chainId: this.network.chainId, nonce: String(nonce),
        value: value.toString(), data, gasLimit: plan.gasLimit.toString(),
        ...(plan.type === 0 ? { type: 0, gasPrice: plan.gasPrice.toString() } : {
          type: 2, accessList: original.accessList ?? [], maxFeePerGas: plan.maxFeePerGas.toString(), maxPriorityFeePerGas: plan.maxPriorityFeePerGas.toString(),
        }),
      }, this.network);
      const balance = quantity(rawBalance);
      const now = this.monotonicMilliseconds();
      const approval = captureEvmFeeApproval(transaction, this.network.registrationHash, now + EVM_FEE_APPROVAL_LIFETIME_MS);
      try {
        assertEvmFeeEstimateApproved(approval, { estimatedGas: gasLimit, balance, sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }) }, now, captureNativeEvmFeeCoverage(approval));
      } catch (error) {
        return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
      }
      if (assetState) {
        await simulateEvmAssetTransfer(read, assetState, transaction, 'manual');
        await this.assertAssetCanonical(read, assetState);
      } else await this.canonical(read, sampled);
      await this.checkChain(read);
      return Object.freeze({ transaction, balanceUnits: balance.toString(),
        maximumFeeUnits: approval.maximumFeeUnits, totalUnits: approval.maximumTotalUnits,
        ...(assetState ? { assetBalanceUnits: assetState.balanceUnits.toString() } : {}) });
    }, asset && asset.standard !== 'ERC20' ? 'nft-quote' : 'endpoint');
  }

  /** One SDK fee policy serves live native/token preparation and exact-envelope requotes. */
  prepare(input: TransferRequest, signal: AbortSignal,
    guard: () => void, approved: EvmUnsignedTransfer | undefined, nonceOverride: number | undefined, automaticNonce: NativeAutomaticNoncePlanner, asset?: EvmTransferAsset, expectedDecimals?: number, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<EvmPreparedQuote> {
    let request: TransferRequest;
    try {
      const raw = readOwnData(input, ['from', 'to', 'value', 'data']);
      request = { from: getAddress(raw.from as string), to: getAddress(raw.to as string), value: units(raw.value).toString(), data: raw.data as string };
      if (/^0x0{40}$/i.test(request.from) || /^0x0{40}$/i.test(request.to) || typeof request.data !== 'string' ||
          !/^0x(?:[0-9a-f]{2})*$/.test(request.data) || request.data.length > 138 || (request.data === '0x' && request.value === '0')) return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
      if (request.data !== '0x' && !asset) throw new EvmTransferReadError('INVALID_INPUT');
      if (approved) approved = snapshotUnsignedTransfer(approved, this.network);
      feeChoice = snapshotEvmFeeChoice(feeChoice);
    } catch { return Promise.reject(new EvmTransferReadError('INVALID_INPUT')); }
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const assetState = asset && await readEvmAssetState(read, request.from, asset, { number: hex(BigInt(sampled.number)), hash: sampled.hash });
      if (assetState && expectedDecimals !== undefined) await this.assertTokenDecimals(read, assetState, expectedDecimals);
      const quote = await this.prepareAtBlock(read, sampled, request, signal, approved, nonceOverride, automaticNonce, undefined, assetState, undefined, feeChoice);
      if (assetState) await simulateEvmAssetTransfer(read, assetState, quote.transaction, nonceOverride === undefined ? 'automatic' : 'manual');
      if (assetState) await this.assertAssetCanonical(read, assetState);
      else await this.canonical(read, sampled);
      await this.checkChain(read); read.assertCurrent();
      return assetState ? Object.freeze({ ...quote, assetBalanceUnits: assetState.balanceUnits.toString() }) : quote;
    }, 'endpoint');
  }

  /** Private read-only quote; neither this result nor the selection authorizes signing. */
  prepareMaximum(from: string, to: string, reserveUnits: bigint, signal: AbortSignal,
    guard: () => void, nonceOverride: number | undefined, automaticNonce: NativeAutomaticNoncePlanner, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<EvmPreparedQuote> {
    let request: TransferRequest;
    try {
      feeChoice = snapshotEvmFeeChoice(feeChoice);
      request = { from: getAddress(from), to: getAddress(to), value: '1', data: '0x' };
      if (/^0x0{40}$/i.test(request.from) || /^0x0{40}$/i.test(request.to) || reserveUnits < 0n)
        throw new Error('Invalid maximum transfer');
    } catch { return Promise.reject(new EvmTransferReadError('INVALID_INPUT')); }
    return this.readPhaseOperation(signal, guard, async read => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const quote = await this.prepareAtBlock(read, sampled, request, signal, undefined, nonceOverride, automaticNonce,
        undefined, undefined, reserveUnits, feeChoice);
      await this.canonical(read, sampled);
      await this.checkChain(read);
      read.assertCurrent();
      return quote;
    }, 'endpoint');
  }

  /** Private read-only quote; neither this result nor the selection authorizes signing. */
  prepareNft(selection: NftTransferSelection, input: NftTransferRequest, signal: AbortSignal,
    guard: () => void, nonceOverride: number | undefined, automaticNonce: NativeAutomaticNoncePlanner, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<EvmNftPreparedQuote> {
    return this.quoteNft(selection, input, signal, guard, nonceOverride, automaticNonce, undefined, snapshotEvmFeeChoice(feeChoice));
  }

  async requoteNft(selection: NftTransferSelection, approval: EvmNftPreparedQuote, signal: AbortSignal,
    guard: () => void, automaticNonce: NativeAutomaticNoncePlanner): Promise<EvmNftPreparedQuote> {
    this.assertNftApproval(approval);
    const { recipient, tokenId, amountUnits } = approval.intent;
    return this.quoteNft(selection, { recipient, tokenId, amountUnits }, signal, guard, approval.nonceOverride, automaticNonce, approval);
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

  private async quoteNft(selection: NftTransferSelection, input: NftTransferRequest, signal: AbortSignal,
    guard: () => void, nonceOverride?: number, automaticNonce?: NativeAutomaticNoncePlanner, approval?: EvmNftPreparedQuote, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<EvmNftPreparedQuote> {
    guardedRead(guard);
    if (signal.aborted) return rejectRead('CANCELLED');
    const intent = snapshotNftTransferSelection(selection, input, this.network);
    const approved = approval && snapshotNftQuoteEnvelope(approval.envelope, this.network, intent);
    const request = Object.freeze({ from: intent.from, to: intent.contractAddress, value: '0', data: encodeNftTransferData(intent) });
    const result = await this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const assetState = await readEvmAssetState(read, intent.from, nftAsset(intent), { number: hex(BigInt(sampled.number)), hash: sampled.hash });
      const ownershipUnits = assetState.balanceUnits.toString();
      if (approval) this.assertNftApproval(approval);
      const { transaction, ...amounts } = await this.prepareAtBlock(read, sampled, request, signal, approved, nonceOverride, automaticNonce, intent, assetState, undefined, feeChoice);
      await simulateEvmAssetTransfer(read, assetState, transaction, nonceOverride === undefined ? 'automatic' : 'manual');
      if (BigInt(amounts.totalUnits) > BigInt(amounts.balanceUnits))
        return rejectRead('INSUFFICIENT_BALANCE');
      await this.assertAssetCanonical(read, assetState);
      await this.checkChain(read);
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


  private async sampleSendNonce(read: Reader, from: string, sampled: ReadBlock, nonceOverride: number | undefined,
    planner: NativeAutomaticNoncePlanner | undefined, assetState?: EvmAssetState): Promise<SendNonceSample> {
    if (typeof planner !== 'function') return rejectRead('INVALID_INPUT');
    const [count, current, pending] = await Promise.all([
      assetState ? Promise.resolve(BigInt(assetState.nonce)) : read('eth_getTransactionCount', [from, hex(BigInt(sampled.number))]).then(quantity),
      read('eth_getTransactionCount', [from, 'latest']).then(quantity),
      read('eth_getTransactionCount', [from, 'pending']).then(quantity),
    ]);
    if (current !== count) {
      if (assetState) throw new EvmAutomaticNonceUnresolved(Number(current), 'asset-state');
      return rejectRead('REVIEW_REQUIRED');
    }
    if (count > BigInt(Number.MAX_SAFE_INTEGER) || pending > BigInt(Number.MAX_SAFE_INTEGER))
      return rejectRead('INVALID_RESPONSE');
    if (nonceOverride !== undefined && BigInt(nonceOverride) < count)
      return rejectRead('NONCE_UNAVAILABLE');
    const plan = await planner({
      latest: Number(count), pending: Number(pending),
      ...(assetState ? { assetState } : {}),
      ...(nonceOverride === undefined ? {} : { nonceOverride }),
      readPending: (hash) => read('eth_getTransactionByHash', [hash]),
      assertCurrent: read.assertCurrent,
      readPhase: {
        read,
        readFresh: read.fresh ?? read,
        readMany: read.many,
        feeData: () => this.feeData(read, sampled, read.signal),
        assertCurrent: read.assertCurrent,
      },
    });
    read.assertCurrent();
    if (plan.kind === 'unresolved') throw new EvmAutomaticNonceUnresolved(plan.nonce, plan.reason);
    return {
      count, pending, nonce: BigInt(plan.nonce),
      state: pending < count || (nonceOverride !== undefined && BigInt(nonceOverride) < pending) ? 'latest' : 'pending',
      nativeReservations: plan.nativeReservations,
      balanceState: plan.balanceState,
    };
  }

  /** Revalidate the selected nonce, spend budget and exact execution under held admission. */
  verifyForDispatch(input: EvmUnsignedTransfer, signal: AbortSignal,
    guard: () => void, planner: NativeAutomaticNoncePlanner, asset?: EvmTransferAsset, nonceOverride?: number, nft?: NftTransferIntent, expectedDecimals?: number): Promise<void> {
    const envelope = nft ? snapshotNftQuoteEnvelope(input, this.network, nft) : snapshotUnsignedTransfer(input, this.network);
    if (envelope.data !== '0x' && !asset) return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const assetState = asset && await readEvmAssetState(read, envelope.from, asset,
        { number: hex(BigInt(sampled.number)), hash: sampled.hash });
      if (assetState && expectedDecimals !== undefined) await this.assertTokenDecimals(read, assetState, expectedDecimals);
      const nonceState = this.sampleSendNonce(read, envelope.from, sampled, nonceOverride, planner, assetState);
      const [sample, rawBalance] = await Promise.all([nonceState, this.readSendBalance(read, envelope.from, sampled, nonceState)]);
      if (sample.nonce !== BigInt(envelope.nonce)) return rejectRead('REVIEW_REQUIRED');
      const fee = envelope.type === 0 ? envelope.gasPrice : envelope.maxFeePerGas;
      const cost = getEvmTransferCost(BigInt(envelope.value), BigInt(envelope.gasLimit), BigInt(fee));
      if (cost.total > rawBalance)
        return rejectRead('INSUFFICIENT_BALANCE');
      if (assetState)
        await simulateEvmAssetTransfer(read, assetState, envelope, nonceOverride === undefined ? 'automatic' : 'manual');
      const estimatedGas = quantity(await read('eth_estimateGas', [evmEstimateRequest(envelope), sample.state]));
      const approval = captureEvmFeeApproval(envelope, this.network.registrationHash, this.feeQuoteExpiry());
      try {
        assertEvmFeeEstimateApproved(approval, { balance: rawBalance,
          estimatedGas, sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }) }, this.monotonicMilliseconds(), captureNativeEvmFeeCoverage(approval));
      } catch (error) { return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED'); }
      if (assetState) await this.assertAssetCanonical(read, assetState);
      else await this.canonical(read, sampled);
      await this.checkChain(read);
      read.assertCurrent();
    }, nft ? 'nft-quote' : 'endpoint');
  }

  private async assertTokenDecimals(read: Reader, state: EvmAssetState, expected: number): Promise<void> {
    const precision = await read('eth_call', [{ to: state.asset.contractAddress, data: '0x313ce567' }, state.number]);
    if (typeof precision !== 'string' || !/^0x[0-9a-f]{64}$/i.test(precision) || parseErc20Decimals(BigInt(precision)) !== expected)
      throw new EvmTransferReadError('TOKEN_CHANGED');
  }

  /** Holdings and affordability for an exact retained replacement, without selecting a new nonce. */
  verifyReplacementForDispatch(input: EvmUnsignedTransfer, signal: AbortSignal, guard: () => void,
    snapshot: EvmAutoNonceSnapshot, asset?: EvmTransferAsset, expectedDecimals?: number, mode: 'speed-up' | 'cancel' = 'speed-up', signedRaw?: string): Promise<void> {
    const envelope = snapshotReplacementTransfer(input, this.network);
    if (mode === 'cancel' && !isEvmProtectedEmptySelfCall({ ...envelope, value: BigInt(envelope.value) }, 'cancel'))
      return Promise.reject(new EvmTransferReadError('INVALID_INPUT'));
    return this.readPhaseOperation(signal, guard, async read => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const tag = hex(BigInt(sampled.number));
      const [latest, pending, canonicalBalance, pendingBalance, assetState] = await Promise.all([
        read('eth_getTransactionCount', [envelope.from, tag]).then(quantity),
        read('eth_getTransactionCount', [envelope.from, 'pending']).then(quantity),
        read('eth_getBalance', [envelope.from, tag]).then(quantity),
        read('eth_getBalance', [envelope.from, 'pending']).then(quantity),
        asset ? readEvmAssetState(read, envelope.from, asset, { number: tag, hash: sampled.hash }) : undefined,
      ]);
      if (latest > BigInt(Number.MAX_SAFE_INTEGER) || pending > BigInt(Number.MAX_SAFE_INTEGER)) return rejectRead('INVALID_RESPONSE');
      if (assetState) {
        if (expectedDecimals !== undefined) await this.assertTokenDecimals(read, assetState, expectedDecimals);
        await assertEvmAssetReservations(assetState, Number(envelope.nonce), snapshot, read.assertCurrent);
        await simulateEvmAssetTransfer(read, assetState, envelope, 'manual');
      }
      const approval = captureEvmFeeApproval(envelope, this.network.registrationHash, this.feeQuoteExpiry());
      const balance = await availableEvmReplacementBalance(snapshot, this.network.chainId, envelope.from,
        Number(latest), Number(pending), Number(envelope.nonce), BigInt(approval.maximumTotalUnits),
        { canonical: canonicalBalance, pending: pendingBalance }, read.assertCurrent, mode === 'cancel' ? 'cancellation' : 'replacement');
      try {
        assertEvmFeeEstimateApproved(approval, { balance, estimatedGas: BigInt(envelope.gasLimit), sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }) }, this.monotonicMilliseconds(), captureNativeEvmFeeCoverage(approval));
      } catch (error) { return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED'); }
      if (mode === 'speed-up' && signedRaw) {
        const hash = Transaction.from(signedRaw).hash;
        if (!hash) return rejectRead('INVALID_INPUT');
        await assertRetainedSmartAccountExecution({
          send: (method, params) => read(method as Method, params),
          sendFresh: (method: string, params: unknown[]) => (read.fresh ?? read)(method as Method, params),
        }, signedRaw, hash, Number(this.network.chainId), snapshot, read.assertCurrent);
      }
      if (assetState) await this.assertAssetCanonical(read, assetState);
      else await this.canonical(read, sampled);
      await this.checkChain(read);
      read.assertCurrent();
    }, asset && asset.standard !== 'ERC20' ? 'nft-quote' : 'endpoint');
  }

  private async readSendBalance(read: Reader, from: string, sampled: ReadBlock,
    nonceState: Promise<Pick<SendNonceSample, 'nativeReservations' | 'balanceState'>>): Promise<bigint> {
    const [sample, canonical, pending] = await Promise.all([
      nonceState,
      read('eth_getBalance', [from, hex(BigInt(sampled.number))]).then(quantity),
      read('eth_getBalance', [from, 'pending']).then(quantity),
    ]);
    read.assertCurrent();
    return availableEvmNativeBalance({ canonical, pending }, sample.nativeReservations, sample.balanceState);
  }

  /** Check the exact collectible envelope while the journal owns wire admission. */
  verifyNftForDispatch(intent: NftTransferIntent, input: EvmUnsignedTransfer, signal: AbortSignal,
    guard: () => void, replay: boolean, nonceOverride?: number, automaticNonce?: NativeAutomaticNoncePlanner): Promise<void> {
    const envelope = snapshotNftQuoteEnvelope(input, this.network, intent);
    const manual = nonceOverride !== undefined;
    if (manual && (replay || String(nonceOverride) !== envelope.nonce))
      return Promise.reject(new EvmTransferReadError('REVIEW_REQUIRED'));
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const assetState = await readEvmAssetState(read, intent.from, nftAsset(intent), { number: hex(BigInt(sampled.number)), hash: sampled.hash });
      if (assetState.balanceUnits < BigInt(intent.amountUnits)) throw new EvmAssetStateError('INSUFFICIENT_ASSET');
      const nonceState = replay
        ? read('eth_getTransactionCount', [intent.from, 'latest']).then((value) => ({
          count: quantity(value), nonce: BigInt(envelope.nonce), state: 'pending' as const, balanceState: 'pending' as const, nativeReservations: { canonical: 0n, pending: 0n },
        }))
        : this.sampleSendNonce(read, intent.from, sampled, nonceOverride, automaticNonce, assetState);
      const state = manual || automaticNonce ? nonceState.then((sample) => sample.state) : Promise.resolve('pending');
      // Ownership reads can outlive a failed nonce check; observe its derived
      // promise immediately while preserving the rejection for the estimate.
      void state.catch(() => undefined);
      const [sample, rawBalance, rawEstimate] = await Promise.all([
        nonceState,
        replay ? read('eth_getBalance', [intent.from, 'pending']).then(quantity) : this.readSendBalance(read, intent.from, sampled, nonceState),
        simulateEvmAssetTransfer(read, assetState, envelope, manual ? 'manual' : 'automatic').then(async () =>
          read('eth_estimateGas', [evmEstimateRequest(envelope), await state])),
      ]);
      const nonce = BigInt(envelope.nonce);
      if (replay ? sample.count > nonce : manual ? !matchesSendNonce(sample.count, nonce, true) : sample.nonce !== nonce)
        return rejectRead(manual ? 'NONCE_UNAVAILABLE' : 'REVIEW_REQUIRED');
      const now = this.monotonicMilliseconds();
      const approval = captureEvmFeeApproval(envelope, this.network.registrationHash, this.feeQuoteExpiry());
      try {
        assertEvmFeeEstimateApproved(approval, {
          balance: rawBalance,
          estimatedGas: quantity(rawEstimate), sampledBlockGasLimit: sampled.gasLimit,
          ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }),
        }, now, captureNativeEvmFeeCoverage(approval));
      } catch (error) {
        return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
      }
      await this.assertAssetCanonical(read, assetState); read.assertCurrent();
      await this.checkChain(read); read.assertCurrent();
    }, 'nft-quote');
  }

  private async prepareAtBlock(read: Reader, sampled: ReadBlock, request: TransferRequest, signal: AbortSignal,
    approved?: EvmUnsignedTransfer, nonceOverride?: number, automaticNonce?: NativeAutomaticNoncePlanner, nft?: NftTransferIntent,
    assetState?: EvmAssetState, maximumReserve?: bigint, feeChoice: EvmFeeChoice = AUTOMATIC_FEE): Promise<EvmPreparedQuote> {
    const manual = nonceOverride !== undefined;
    if (assetState && assetState.balanceUnits < BigInt(assetState.asset.amountUnits)) throw new EvmAssetStateError('INSUFFICIENT_ASSET');
    if (manual && (!Number.isSafeInteger(nonceOverride) || nonceOverride < 0))
      return rejectRead('INVALID_INPUT');
    if (feeChoice.kind === 'custom' && feeChoice.type !== (sampled.baseFee === null ? 0 : 2))
      return rejectRead('INVALID_INPUT');
    const nonceState = this.sampleSendNonce(read, request.from, sampled, nonceOverride, automaticNonce, assetState);
    const [sample, balance, fees] = await Promise.all([
      nonceState,
      this.readSendBalance(read, request.from, sampled, nonceState),
      approved || feeChoice.kind === 'custom' ? undefined : this.feeData(read, sampled, signal),
    ]);
    const { count: observed, nonce, state } = sample;
    read.assertCurrent();
    if (maximumReserve !== undefined && (sample.pending !== observed || (!manual && nonce !== observed) ||
      sample.nativeReservations.canonical !== 0n || sample.nativeReservations.pending !== 0n)) return rejectRead('MAX_PENDING');
    if (observed > BigInt(Number.MAX_SAFE_INTEGER) || sampled.gasLimit < 21000n) return rejectRead('INVALID_RESPONSE');
    if (manual && !matchesSendNonce(observed, nonce, true))
      return rejectRead('NONCE_UNAVAILABLE');
    const selectedRates = approved
      ? approved.type === 0 ? { type: 0 as const, gasPrice: approved.gasPrice }
        : { type: 2 as const, accessList: [], maxFeePerGas: approved.maxFeePerGas, maxPriorityFeePerGas: approved.maxPriorityFeePerGas }
      : chooseEvmFees(feeChoice.kind === 'custom' ? feeChoice : fees!.baseFeePerGas === undefined ? { type: 0 as const, gasPrice: fees!.gasPrice.toString() }
        : { type: 2 as const, maxFeePerGas: fees!.maxFeePerGas.toString(), maxPriorityFeePerGas: fees!.maxPriorityFeePerGas.toString() }, feeChoice);
    const selectedFees = selectedRates.type === 2 ? { ...selectedRates, accessList: [] } : selectedRates;
    if (approved && (approved.nonce !== nonce.toString() || approved.from !== request.from || approved.to !== request.to || approved.value !== request.value || approved.data !== request.data)) return rejectRead('REVIEW_REQUIRED');
    if (selectedFees.type === 2 && (sampled.baseFee === null || BigInt(selectedFees.maxFeePerGas) < sampled.baseFee)) return rejectRead('REVIEW_REQUIRED');
    const estimateValue = async (value: bigint) => {
      const estimated = quantity(await read('eth_estimateGas', [evmEstimateRequest({
        ...request, value: value.toString(), ...selectedFees, chainId: this.network.chainId, nonce: nonce.toString(),
      }), state]));
      read.assertCurrent();
      if (estimated < 21000n || estimated > sampled.gasLimit) return rejectRead('INVALID_RESPONSE');
      return estimated;
    };
    let estimate: bigint;
    let gas: bigint;
    if (maximumReserve !== undefined) {
      const maximum = await refineNativeEvmMaximum({ balanceUnits: balance,
        feePerGas: BigInt(selectedFees.type === 0 ? selectedFees.gasPrice : selectedFees.maxFeePerGas),
        reserveUnits: maximumReserve, assertCurrent: read.assertCurrent,
        estimateGas: async value => {
          const estimated = await estimateValue(value);
          const buffered = bufferEvmFeeEstimate(estimated, BigInt(this.network.chainId), sampled.gasLimit);
          return 'gasLimit' in selectedFees && selectedFees.gasLimit ? BigInt(selectedFees.gasLimit) : buffered;
        },
      });
      if (maximum.value <= 0n) return rejectRead('INSUFFICIENT_BALANCE');
      request = { ...request, value: maximum.value.toString() };
      gas = maximum.gasLimit;
      estimate = await estimateValue(maximum.value);
    } else {
      estimate = await estimateValue(BigInt(request.value));
      try {
        gas = approved
          ? BigInt(approved.gasLimit)
          : 'gasLimit' in selectedFees && selectedFees.gasLimit ? BigInt(selectedFees.gasLimit)
            : bufferEvmFeeEstimate(estimate, BigInt(this.network.chainId), sampled.gasLimit);
      } catch { return rejectRead('INVALID_RESPONSE'); }
    }
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
        ...(sampled.baseFee === null ? {} : { baseFeePerGas: sampled.baseFee }), balance }, this.monotonicMilliseconds(), captureNativeEvmFeeCoverage(approval)); }
      catch (error) {
        return rejectRead(error instanceof EvmFeeBalanceError ? 'INSUFFICIENT_BALANCE' : 'REVIEW_REQUIRED');
      }
    }
    return Object.freeze({ transaction: tx, balanceUnits: balance.toString(), maximumFeeUnits: cost.maximumFee.toString(), totalUnits: cost.total.toString() });
  }
  /** Public fee observations only; no note or proof is passed to this reader. */
  withdrawalGasPrice(signal: AbortSignal, guard: () => void): Promise<string> {
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const fees = await this.feeData(read, sampled, signal);
      const price = fees.maxFeePerGas ?? fees.gasPrice;
      if (!price || price <= BigInt(0)) return rejectRead('INVALID_RESPONSE');
      await this.canonical(read, sampled);
      return price.toString();
    }, 'endpoint');
  }

  /** The shared fixed-gas formatter uses the ordinary nonce and spend-budget policy. */
  withdrawalFees(from: string, planner: NativeAutomaticNoncePlanner, signal: AbortSignal, guard: () => void) {
    return this.readPhaseOperation(signal, guard, async (read) => {
      await this.checkChain(read);
      const sampled = block(await read('eth_getBlockByNumber', ['latest', false]));
      const nonce = this.sampleSendNonce(read, from, sampled, undefined, planner);
      const [plan, balance, fees] = await Promise.all([
        nonce, this.readSendBalance(read, from, sampled, nonce), this.feeData(read, sampled, signal),
      ]);
      await this.canonical(read, sampled);
      read.assertCurrent();
      return privacyWithdrawalFees(fees, plan.nonce, balance);
    }, 'endpoint');
  }

  /** Generic dapp envelope through the same owned reads, nonce planner and fee policy. */
  prepareDapp(request: EvmDappTransactionRequest, signal: AbortSignal, guard: () => void,
    automaticNonce: NativeAutomaticNoncePlanner, approved: EvmDappQuote | undefined, funding: EvmFeeFunding, gasPolicy: EvmGasPolicy,
    feePolicy?: 'fixed', assertRefreshedState?: (provider: unknown) => Promise<void>): Promise<EvmDappPreparedQuote> {
    gasPolicy = captureEvmGasPolicy(gasPolicy);
    return this.operation(signal, guard, async (read) => {
      try {
        return await withEvmReadPhase({ signal: read.signal, send: (method, params) => read(method as Method, params),
          readMany: requests => read.many(requests.map(request => ({ ...request, method: request.method as Method }))),
          verifyConfiguredChainId: () => this.checkChain(read) }, read.assertCurrent, async provider => {
          const phase = Object.assign((method: Method, params: readonly unknown[]) => provider.send(method, [...params]), {
            signal: read.signal, assertCurrent: read.assertCurrent, many: provider.readMany,
            fresh: (method: Method, params: readonly unknown[]) => provider.sendFresh(method, [...params]),
          }) as Reader;
          return prepareEvmDappQuote(request, {
            chainId: this.network.chainId,
            scope: this.network.registrationHash,
            funding,
            fundingProvider: provider,
            gasPolicy,
            feePolicy,
            assertCurrent: read.assertCurrent,
            read: phase,
            now: this.monotonicMilliseconds,
            verifyChain: () => provider.verifyConfiguredChainId(),
            verifyBlock: (sampled) => this.canonical(phase, sampled),
            nonce: async (sampled, requested) => {
              const nonce = await this.sampleSendNonce(phase, request.from, sampled, requested, automaticNonce);
              if (approved && assertRefreshedState) await assertRefreshedState(provider);
              return nonce;
            },
            balance: (sampled, nonce) => this.readSendBalance(phase, request.from, sampled, nonce),
            fees: (sampled) => this.feeData(phase, sampled, signal),
          }, approved);
        });
      } catch (error) {
        if (error instanceof EvmFeeBalanceError) return rejectRead('INSUFFICIENT_BALANCE');
        if (error instanceof EvmDappReviewRequiredError) return rejectRead('REVIEW_REQUIRED');
        if (error instanceof EvmObservationError) return rejectRead('INVALID_RESPONSE');
        throw error;
      }
    }, 'endpoint');
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
      try { assertEvmFeeEstimateApproved(approval, { ...observation, estimatedGas: BigInt(transaction.gasLimit) }, now, captureNativeEvmFeeCoverage(approval)); }
      catch { return rejectRead('REVIEW_REQUIRED'); }
      const cap = BigInt(transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas);
      const price = transaction.type === 0 ? cap : (sampled.baseFee ?? rejectRead('INVALID_RESPONSE')) + BigInt(transaction.maxPriorityFeePerGas);
      const gas = quantity(await read('eth_estimateGas', [evmEstimateRequest(transaction), 'pending']));
      try { assertEvmFeeEstimateApproved(approval, { ...observation, estimatedGas: gas }, this.monotonicMilliseconds(), captureNativeEvmFeeCoverage(approval)); }
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
