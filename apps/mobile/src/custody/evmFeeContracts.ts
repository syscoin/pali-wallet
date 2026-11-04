import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import { getAddress } from 'ethers/address';
import { assertBaseUnits } from '../core/amounts.ts';
import { getEvmTransferProfile } from './evmTransferProfiles.ts';
import type { EvmTransferProfile } from './evmTransferProfiles.ts';
import { NATIVE_NETWORKS, nativeTransferGasLimit } from './networkContext.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';

export class EvmTransferReadError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'CANCELLED' | 'UNAVAILABLE' | 'UNQUALIFIED_PROFILE' | 'PROFILE_CHANGED' | 'REVIEW_REQUIRED';
  constructor(code: EvmTransferReadError['code']) { super(code); this.name = 'EvmTransferReadError'; this.code = code; }
}
export const rejectRead = (code: EvmTransferReadError['code']): never => { throw new EvmTransferReadError(code); };
export type EvmUnsignedTransfer = Readonly<{
  type: 2; from: string; to: string; chainId: string; nonce: string; value: string;
  gasLimit: string; data: '0x'; maxFeePerGas: string; maxPriorityFeePerGas: string;
}>;
export type EvmSampledBlock = Readonly<{ number: string; hash: string }>;
export type EvmFeeExtra = Readonly<{ kind: 'l1-data' | 'operator'; estimateUnits: string; enforceableByEnvelope: false }>;
export type EvmFeeQuote = Readonly<{
  profileId: string; profileVersion: 1; registrationHash: string; from: string; unsignedEnvelopeHash: string;
  sampledBlock: EvmSampledBlock; envelopeFeeCapUnits: string; estimatedEnvelopeFeeUnits: string;
  extras: readonly EvmFeeExtra[]; estimatedFeeUnits: string; fundingEstimateUnits: string;
  maximumTotalUnits: string | null; expiresAtMonotonicMilliseconds: number;
}>;

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
export function snapshotUnsignedTransfer(value: EvmUnsignedTransfer, network: NativeNetworkRegistration): EvmUnsignedTransfer {
  const data = readOwnData(value, ['type', 'from', 'to', 'chainId', 'nonce', 'value', 'gasLimit', 'data', 'maxFeePerGas', 'maxPriorityFeePerGas']);
  if (data.type !== 2 || data.data !== '0x' || data.chainId !== network.chainId) return rejectRead('INVALID_INPUT');
  let from: string, to: string;
  try { from = getAddress(data.from as string); to = getAddress(data.to as string); } catch { return rejectRead('INVALID_INPUT'); }
  if (/^0x0{40}$/i.test(from) || /^0x0{40}$/i.test(to)) return rejectRead('INVALID_INPUT');
  const nonce = units(data.nonce), amount = units(data.value), gas = units(data.gasLimit), cap = units(data.maxFeePerGas), tip = units(data.maxPriorityFeePerGas);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || amount === 0n || gas < 21000n || gas > nativeTransferGasLimit(network.id) || cap === 0n || tip > cap) return rejectRead('INVALID_INPUT');
  return Object.freeze({ type: 2, from, to, chainId: network.chainId, nonce: nonce.toString(), value: amount.toString(),
    gasLimit: gas.toString(), data: '0x', maxFeePerGas: cap.toString(), maxPriorityFeePerGas: tip.toString() });
}
/** Constructed solely from the exact unsigned DTO: no signature field can enter. */
export function unsignedTransferBytes(transaction: EvmUnsignedTransfer): string {
  const tx = Transaction.from({ type: transaction.type, to: transaction.to, chainId: BigInt(transaction.chainId),
    nonce: Number(transaction.nonce), value: BigInt(transaction.value), gasLimit: BigInt(transaction.gasLimit),
    data: transaction.data, maxFeePerGas: BigInt(transaction.maxFeePerGas), maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas) });
  const raw = tx.unsignedSerialized;
  if (tx.isSigned() || raw.length > 4096) return rejectRead('INVALID_INPUT');
  return raw;
}
const issuedQuotes = new WeakSet<object>();
export function assembleFeeQuote(transaction: EvmUnsignedTransfer, network: NativeNetworkRegistration, profile: EvmTransferProfile,
  block: EvmSampledBlock, estimatedGasPrice: bigint, extras: readonly EvmFeeExtra[], expiresAtMonotonicMilliseconds: number): EvmFeeQuote {
  // Only registry-owned identities can label an issued quote. A structurally
  // similar caller object cannot replace endpoint, profile or fee semantics.
  if (!NATIVE_NETWORKS.includes(network) || profile !== getEvmTransferProfile(network.id)) return rejectRead('INVALID_INPUT');
  if (!profile.feeSourceQualified || profile.feeModel === 'unqualified') return rejectRead('UNQUALIFIED_PROFILE');
  transaction = snapshotUnsignedTransfer(transaction, network);
  const rawBlock = readOwnData(block, ['number', 'hash']);
  block = Object.freeze({ number: units(rawBlock.number, 'INVALID_RESPONSE').toString(), hash: checkedReadHash(rawBlock.hash) });
  const expectedKinds: readonly EvmFeeExtra['kind'][] = profile.feeModel === 'op-jovian'
    ? ['l1-data', 'operator'] : profile.feeModel === 'rollux-legacy' ? ['l1-data'] : [];
  if (!Array.isArray(extras) || Object.getPrototypeOf(extras) !== Array.prototype || extras.length !== expectedKinds.length ||
      Reflect.ownKeys(extras).length !== extras.length + 1) return rejectRead('INVALID_INPUT');
  extras = expectedKinds.map((kind, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(extras, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return rejectRead('INVALID_INPUT');
    const item = readOwnData(descriptor.value, ['kind', 'estimateUnits', 'enforceableByEnvelope']);
    if (item.kind !== kind || item.enforceableByEnvelope !== false) return rejectRead('INVALID_INPUT');
    return Object.freeze({ kind, estimateUnits: units(item.estimateUnits).toString(), enforceableByEnvelope: false as const });
  });
  const gas = BigInt(transaction.gasLimit), cap = BigInt(transaction.maxFeePerGas);
  if (typeof estimatedGasPrice !== 'bigint' || estimatedGasPrice < 0n || estimatedGasPrice > cap || !Number.isSafeInteger(expiresAtMonotonicMilliseconds) || expiresAtMonotonicMilliseconds < 0) return rejectRead('INVALID_RESPONSE');
  const envelope = units((gas * cap).toString(), 'INVALID_RESPONSE');
  const estimatedEnvelope = units((gas * estimatedGasPrice).toString(), 'INVALID_RESPONSE');
  const extra = extras.reduce((total, item) => units((total + units(item.estimateUnits, 'INVALID_RESPONSE')).toString(), 'INVALID_RESPONSE'), 0n);
  const funding = units((BigInt(transaction.value) + envelope + extra).toString(), 'INVALID_RESPONSE');
  const quote = Object.freeze({ profileId: profile.id, profileVersion: profile.version, registrationHash: network.registrationHash, from: transaction.from,
    unsignedEnvelopeHash: keccak256(unsignedTransferBytes(transaction)), sampledBlock: Object.freeze({ ...block }),
    envelopeFeeCapUnits: envelope.toString(), estimatedEnvelopeFeeUnits: estimatedEnvelope.toString(),
    extras: Object.freeze(extras.map((item) => Object.freeze({ ...item }))), estimatedFeeUnits: units((estimatedEnvelope + extra).toString(), 'INVALID_RESPONSE').toString(),
    fundingEstimateUnits: funding.toString(), maximumTotalUnits: extras.length ? null : funding.toString(), expiresAtMonotonicMilliseconds });
  issuedQuotes.add(quote);
  return quote;
}

/** Use the same monotonic clock origin as the quote issuer; never Date.now(). */
export function assertFeeRefreshApproved(approved: EvmFeeQuote, refreshed: EvmFeeQuote, monotonicMilliseconds: number): void {
  if (!issuedQuotes.has(approved) || !issuedQuotes.has(refreshed) || approved.from !== refreshed.from ||
      !Number.isSafeInteger(monotonicMilliseconds) || monotonicMilliseconds < 0 || monotonicMilliseconds >= approved.expiresAtMonotonicMilliseconds || monotonicMilliseconds >= refreshed.expiresAtMonotonicMilliseconds ||
      approved.profileId !== refreshed.profileId || approved.profileVersion !== refreshed.profileVersion ||
      approved.registrationHash !== refreshed.registrationHash || approved.unsignedEnvelopeHash !== refreshed.unsignedEnvelopeHash ||
      approved.envelopeFeeCapUnits !== refreshed.envelopeFeeCapUnits || approved.extras.length !== refreshed.extras.length ||
      refreshed.extras.some((item, index) => item.kind !== approved.extras[index]?.kind ||
        units(item.estimateUnits) > units(approved.extras[index]!.estimateUnits))) rejectRead('REVIEW_REQUIRED');
}
