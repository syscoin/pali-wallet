import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import { assertEvmCancellationEnvelope, type EvmCancellationEnvelopeIntent } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-cancellation.js';
import { assertBaseUnits } from '../core/amounts.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';
import { captureEvmFeeApproval, snapshotEvmFeeEnvelope, assertEvmFeeRefreshApproved, type EvmFeeApproval } from '../../../../source/shared/evmFeeApproval.ts';
import { encodeNftTransferData, snapshotNftTransferIntent, type NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
export class EvmTransferReadError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'CANCELLED' | 'UNAVAILABLE' | 'PROFILE_CHANGED' | 'REVIEW_REQUIRED' |
    'TOKEN_CHANGED' | 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_NFT_BALANCE' | 'NFT_TRANSFER_REJECTED' | 'NONCE_UNAVAILABLE' | 'CANCELLATION_QUEUED';
  constructor(code: EvmTransferReadError['code']) { super(code); this.name = 'EvmTransferReadError'; this.code = code; }
}
export class EvmAutomaticNonceUnresolved extends EvmTransferReadError {
  readonly nonce: number;
  readonly reason?: 'asset-state';
  constructor(nonce: number, reason?: 'asset-state') {
    super('REVIEW_REQUIRED');
    this.nonce = nonce;
    this.reason = reason;
  }
}
export const rejectRead = (code: EvmTransferReadError['code']): never => { throw new EvmTransferReadError(code); };
// Automatic selection is tied to the pending count. A deliberate override may
// replace an external pending transaction, but must clear the canonical count.
export function matchesSendNonce(observed: bigint, nonce: bigint, manual: boolean): boolean {
  return manual ? nonce >= observed : nonce === observed;
}

type EvmTransferFields = Readonly<{ from: string; to: string; chainId: string; nonce: string; value: string; gasLimit: string; data: string }>;
export type EvmUnsignedTransfer = EvmTransferFields & Readonly<{ type: 0; gasPrice: string } | { type: 2; maxFeePerGas: string; maxPriorityFeePerGas: string }>;
export type EvmSampledBlock = Readonly<{ number: string; hash: string }>;
export type EvmFeeQuote = Readonly<{ registrationHash: string; from: string; unsignedEnvelopeHash: string; sampledBlock: EvmSampledBlock;
  envelopeFeeCapUnits: string; estimatedEnvelopeFeeUnits: string; estimatedFeeUnits: string; fundingEstimateUnits: string;
  maximumTotalUnits: string; expiresAtMonotonicMilliseconds: number }>;
/** Own data only. Getters and custom prototypes never run on this boundary. */
export function readOwnData(value: unknown, keys: readonly string[], code: EvmTransferReadError['code'] = 'INVALID_INPUT'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return rejectRead(code);
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((key) => typeof key !== 'string' || !keys.includes(key))) return rejectRead(code);
  const result: Record<string, unknown> = Object.create(null);
  for (const name of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return rejectRead(code);
    result[name] = descriptor.value;
  }
  return result;
}
export function guardedRead(guard: () => void): void {
  try {
    const result: unknown = guard();
    if (result !== undefined) {
      if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
      rejectRead('CANCELLED');
    }
  } catch { rejectRead('CANCELLED'); }
}
export function units(value: unknown, code: EvmTransferReadError['code'] = 'INVALID_INPUT'): bigint {
  try { return assertBaseUnits(value as string); } catch { return rejectRead(code); }
}
export function checkedReadHash(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) return rejectRead('INVALID_RESPONSE');
  return value.toLowerCase();
}
function snapshotEvmEnvelope(value: EvmUnsignedTransfer, network: NativeNetworkRegistration, maxDataLength = 138): EvmUnsignedTransfer {
  try {
    const transaction = snapshotEvmFeeEnvelope(value);
    if (transaction.chainId !== network.chainId || transaction.nonce === undefined ||
        transaction.data.length > maxDataLength || BigInt(transaction.gasLimit) > BigInt(Number.MAX_SAFE_INTEGER))
      return rejectRead('INVALID_INPUT');
    return transaction as EvmUnsignedTransfer;
  } catch { return rejectRead('INVALID_INPUT'); }
}
export function snapshotUnsignedTransfer(value: EvmUnsignedTransfer, network: NativeNetworkRegistration): EvmUnsignedTransfer {
  const transaction = snapshotEvmEnvelope(value, network);
  if (transaction.data === '0x' && transaction.value === '0') return rejectRead('INVALID_INPUT');
  return transaction;
}
export function snapshotNftQuoteEnvelope(value: EvmUnsignedTransfer, network: NativeNetworkRegistration, input: NftTransferIntent): EvmUnsignedTransfer {
  try {
    const intent = snapshotNftTransferIntent(input);
    const transaction = snapshotEvmEnvelope(value, network, 394);
    if (transaction.chainId !== intent.chainId || transaction.from !== intent.from ||
        transaction.to !== intent.contractAddress || transaction.value !== '0' ||
        transaction.data !== encodeNftTransferData(intent)) return rejectRead('INVALID_INPUT');
    return transaction;
  } catch { return rejectRead('INVALID_INPUT'); }
}
export function snapshotCancellationTransfer(value: EvmUnsignedTransfer, network: NativeNetworkRegistration,
  payer: string, feePlan: EvmCancellationEnvelopeIntent['feePlan']): EvmUnsignedTransfer {
  const transaction = snapshotEvmEnvelope(value, network);
  if (transaction.from.toLowerCase() !== payer.toLowerCase()) return rejectRead('INVALID_INPUT');
  assertEvmCancellationEnvelope(unsignedTransferBytes(transaction), { payer, chainId: network.chainId, nonce: transaction.nonce, feePlan });
  return transaction;
}
export function unsignedTransferBytes(transaction: EvmUnsignedTransfer): string {
  const tx = Transaction.from({ type: transaction.type, to: transaction.to, chainId: BigInt(transaction.chainId),
    nonce: Number(transaction.nonce), value: BigInt(transaction.value), gasLimit: BigInt(transaction.gasLimit), data: transaction.data,
    ...(transaction.type === 0 ? { gasPrice: BigInt(transaction.gasPrice) } : { maxFeePerGas: BigInt(transaction.maxFeePerGas), maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas) }) });
  const raw = tx.unsignedSerialized;
  if (tx.isSigned() || raw.length > 4096) return rejectRead('INVALID_INPUT');
  return raw;
}
const issuedQuotes = new WeakMap<object, EvmFeeApproval>();
export function assembleFeeQuote(input: EvmUnsignedTransfer, network: NativeNetworkRegistration, block: EvmSampledBlock,
  estimatedGasPrice: bigint, expiresAtMonotonicMilliseconds: number): EvmFeeQuote {
  snapshotNativeNetwork(network);
  const transaction = snapshotUnsignedTransfer(input, network);
  const rawBlock = readOwnData(block, ['number', 'hash']);
  const sampledBlock = Object.freeze({ number: units(rawBlock.number, 'INVALID_RESPONSE').toString(), hash: checkedReadHash(rawBlock.hash) });
  let approval: EvmFeeApproval;
  try { approval = captureEvmFeeApproval(transaction, network.registrationHash, expiresAtMonotonicMilliseconds); }
  catch { return rejectRead('INVALID_RESPONSE'); }
  const cap = BigInt(transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas);
  if (typeof estimatedGasPrice !== 'bigint' || estimatedGasPrice < 0n || estimatedGasPrice > cap ||
      !Number.isSafeInteger(expiresAtMonotonicMilliseconds) || expiresAtMonotonicMilliseconds < 0) return rejectRead('INVALID_RESPONSE');
  const envelope = approval.maximumFeeUnits;
  const estimate = units((BigInt(transaction.gasLimit) * estimatedGasPrice).toString(), 'INVALID_RESPONSE').toString();
  const total = approval.maximumTotalUnits;
  const quote = Object.freeze({ registrationHash: network.registrationHash, from: transaction.from, unsignedEnvelopeHash: keccak256(unsignedTransferBytes(transaction)),
    sampledBlock, envelopeFeeCapUnits: envelope, estimatedEnvelopeFeeUnits: estimate, estimatedFeeUnits: estimate,
    fundingEstimateUnits: total, maximumTotalUnits: total, expiresAtMonotonicMilliseconds });
  issuedQuotes.set(quote, approval); return quote;
}
export function assertFeeRefreshApproved(approved: EvmFeeQuote, refreshed: EvmFeeQuote, monotonicMilliseconds: number): void {
  const first = issuedQuotes.get(approved), second = issuedQuotes.get(refreshed);
  if (!first || !second) return rejectRead('REVIEW_REQUIRED');
  try { assertEvmFeeRefreshApproved(first, second, monotonicMilliseconds); }
  catch { rejectRead('REVIEW_REQUIRED'); }
}
