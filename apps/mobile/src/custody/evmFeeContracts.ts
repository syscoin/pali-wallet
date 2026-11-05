import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import { getAddress } from 'ethers/address';
import { assertEvmGasLimit } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { assertBaseUnits } from '../core/amounts.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';
export class EvmTransferReadError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'CANCELLED' | 'UNAVAILABLE' | 'PROFILE_CHANGED' | 'REVIEW_REQUIRED';
  constructor(code: EvmTransferReadError['code']) { super(code); this.name = 'EvmTransferReadError'; this.code = code; }
}
export const rejectRead = (code: EvmTransferReadError['code']): never => { throw new EvmTransferReadError(code); };
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
export function snapshotUnsignedTransfer(value: EvmUnsignedTransfer, network: NativeNetworkRegistration): EvmUnsignedTransfer {
  const type = Object.getOwnPropertyDescriptor(value, 'type')?.value;
  const feeFields = type === 0 ? ['gasPrice'] : ['maxFeePerGas', 'maxPriorityFeePerGas'];
  const data = readOwnData(value, ['type', 'from', 'to', 'chainId', 'nonce', 'value', 'gasLimit', 'data', ...feeFields]);
  if ((data.type !== 0 && data.type !== 2) || data.chainId !== network.chainId || typeof data.data !== 'string' ||
      !/^0x(?:[0-9a-f]{2})*$/.test(data.data) || data.data.length > 138) return rejectRead('INVALID_INPUT');
  let from: string, to: string;
  try { from = getAddress(data.from as string); to = getAddress(data.to as string); } catch { return rejectRead('INVALID_INPUT'); }
  const nonce = units(data.nonce), valueUnits = units(data.value), gas = units(data.gasLimit);
  if (/^0x0{40}$/i.test(from) || /^0x0{40}$/i.test(to) || nonce > BigInt(Number.MAX_SAFE_INTEGER) ||
      gas < 21000n || gas > BigInt(Number.MAX_SAFE_INTEGER) || (data.data === '0x' && valueUnits === 0n)) return rejectRead('INVALID_INPUT');
  try { assertEvmGasLimit(gas, BigInt(network.chainId)); } catch { return rejectRead('INVALID_INPUT'); }
  const common = { from, to, chainId: network.chainId, nonce: nonce.toString(), value: valueUnits.toString(), gasLimit: gas.toString(), data: data.data };
  if (data.type === 0) return Object.freeze({ ...common, type: 0, gasPrice: units(data.gasPrice).toString() });
  const cap = units(data.maxFeePerGas), tip = units(data.maxPriorityFeePerGas);
  if (cap === 0n || tip > cap) return rejectRead('INVALID_INPUT');
  return Object.freeze({ ...common, type: 2, maxFeePerGas: cap.toString(), maxPriorityFeePerGas: tip.toString() });
}
export function unsignedTransferBytes(transaction: EvmUnsignedTransfer): string {
  const tx = Transaction.from({ type: transaction.type, to: transaction.to, chainId: BigInt(transaction.chainId),
    nonce: Number(transaction.nonce), value: BigInt(transaction.value), gasLimit: BigInt(transaction.gasLimit), data: transaction.data,
    ...(transaction.type === 0 ? { gasPrice: BigInt(transaction.gasPrice) } : { maxFeePerGas: BigInt(transaction.maxFeePerGas), maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas) }) });
  const raw = tx.unsignedSerialized;
  if (tx.isSigned() || raw.length > 4096) return rejectRead('INVALID_INPUT');
  return raw;
}
const issuedQuotes = new WeakSet<object>();
export function assembleFeeQuote(input: EvmUnsignedTransfer, network: NativeNetworkRegistration, block: EvmSampledBlock,
  estimatedGasPrice: bigint, expiresAtMonotonicMilliseconds: number): EvmFeeQuote {
  snapshotNativeNetwork(network);
  const transaction = snapshotUnsignedTransfer(input, network);
  const rawBlock = readOwnData(block, ['number', 'hash']);
  const sampledBlock = Object.freeze({ number: units(rawBlock.number, 'INVALID_RESPONSE').toString(), hash: checkedReadHash(rawBlock.hash) });
  const cap = BigInt(transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas);
  if (typeof estimatedGasPrice !== 'bigint' || estimatedGasPrice < 0n || estimatedGasPrice > cap ||
      !Number.isSafeInteger(expiresAtMonotonicMilliseconds) || expiresAtMonotonicMilliseconds < 0) return rejectRead('INVALID_RESPONSE');
  const envelope = units((BigInt(transaction.gasLimit) * cap).toString(), 'INVALID_RESPONSE').toString();
  const estimate = units((BigInt(transaction.gasLimit) * estimatedGasPrice).toString(), 'INVALID_RESPONSE').toString();
  const total = units((BigInt(transaction.value) + BigInt(envelope)).toString(), 'INVALID_RESPONSE').toString();
  const quote = Object.freeze({ registrationHash: network.registrationHash, from: transaction.from, unsignedEnvelopeHash: keccak256(unsignedTransferBytes(transaction)),
    sampledBlock, envelopeFeeCapUnits: envelope, estimatedEnvelopeFeeUnits: estimate, estimatedFeeUnits: estimate,
    fundingEstimateUnits: total, maximumTotalUnits: total, expiresAtMonotonicMilliseconds });
  issuedQuotes.add(quote); return quote;
}
export function assertFeeRefreshApproved(approved: EvmFeeQuote, refreshed: EvmFeeQuote, monotonicMilliseconds: number): void {
  if (!issuedQuotes.has(approved) || !issuedQuotes.has(refreshed) || approved.from !== refreshed.from ||
      !Number.isSafeInteger(monotonicMilliseconds) || monotonicMilliseconds < 0 || monotonicMilliseconds >= approved.expiresAtMonotonicMilliseconds || monotonicMilliseconds >= refreshed.expiresAtMonotonicMilliseconds ||
      approved.registrationHash !== refreshed.registrationHash || approved.unsignedEnvelopeHash !== refreshed.unsignedEnvelopeHash || approved.envelopeFeeCapUnits !== refreshed.envelopeFeeCapUnits)
    rejectRead('REVIEW_REQUIRED');
}
