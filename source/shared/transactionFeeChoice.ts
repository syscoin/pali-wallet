import { utxoFeeRateUnits } from '@sidhujag/sysweb3-keyring/cjs/utils/utxo-fee-rate.js';
import { formatUnits, parseUnits } from 'ethers/utils';

import { getCustomFeeGwei, getFeePresetGwei } from '../utils/customFee.ts';

export type FeePriority = 'automatic' | 'low' | 'medium' | 'high';
export type EvmFeeRates = Readonly<
  | { gasPrice: string; type: 0 }
  | { maxFeePerGas: string; maxPriorityFeePerGas: string; type: 2 }
>;
export type EvmFeeChoice = Readonly<
  { kind: FeePriority } | ({ gasLimit?: string; kind: 'custom' } & EvmFeeRates)
>;
export type UtxoFeeChoice = Readonly<
  { kind: FeePriority } | { kind: 'custom'; satPerVbyte: string }
>;
export const AUTOMATIC_FEE = Object.freeze({ kind: 'automatic' as const });
const priorities: readonly string[] = ['automatic', 'low', 'medium', 'high'];
const quantity = (value: unknown, zero = false): string => {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,77})$/.test(value) ||
    BigInt(value) >= BigInt(1) << BigInt(256) ||
    (!zero && value === '0')
  )
    throw new Error('INVALID_FEE');
  return value;
};
function data(input: unknown): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error('INVALID_FEE');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !field?.enumerable || !('value' in field))
      throw new Error('INVALID_FEE');
    result[key] = field.value;
  }
  return result;
}
export function snapshotEvmFeeChoice(
  input: EvmFeeChoice = AUTOMATIC_FEE
): EvmFeeChoice {
  const value = data(input);
  if (
    priorities.includes(value.kind as string) &&
    Object.keys(value).length === 1
  )
    return Object.freeze({ kind: value.kind as FeePriority });
  const keys = [
    'kind',
    'type',
    ...(value.type === 0
      ? ['gasPrice']
      : ['maxFeePerGas', 'maxPriorityFeePerGas']),
    ...(value.gasLimit === undefined ? [] : ['gasLimit']),
  ];
  if (
    value.kind !== 'custom' ||
    ![0, 2].includes(value.type as number) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('INVALID_FEE');
  const gas =
    value.gasLimit === undefined ? {} : { gasLimit: quantity(value.gasLimit) };
  if (value.type === 0)
    return Object.freeze({
      kind: 'custom',
      type: 0,
      gasPrice: quantity(value.gasPrice),
      ...gas,
    });
  const maximum = quantity(value.maxFeePerGas),
    priority = quantity(value.maxPriorityFeePerGas, true);
  if (BigInt(priority) > BigInt(maximum)) throw new Error('INVALID_FEE');
  return Object.freeze({
    kind: 'custom',
    type: 2,
    maxFeePerGas: maximum,
    maxPriorityFeePerGas: priority,
    ...gas,
  });
}
/** Uses the extension editor's exact integer-wei admission and preset rounding. */
export function feeGweiUnits(input: string, allowZero = false): string {
  const value = getCustomFeeGwei(input, allowZero);
  if (value === null) throw new Error('INVALID_FEE');
  return parseUnits(value.toFixed(9), 9).toString();
}
export function chooseEvmFees(
  recommended: EvmFeeRates,
  input: EvmFeeChoice
): EvmFeeRates & { gasLimit?: string } {
  const choice = snapshotEvmFeeChoice(input);
  if (choice.kind === 'custom') {
    if (choice.type !== recommended.type) throw new Error('INVALID_FEE');
    const gas =
      choice.gasLimit === undefined ? {} : { gasLimit: choice.gasLimit };
    return choice.type === 0
      ? { type: 0, gasPrice: choice.gasPrice, ...gas }
      : {
          type: 2,
          maxFeePerGas: choice.maxFeePerGas,
          maxPriorityFeePerGas: choice.maxPriorityFeePerGas,
          ...gas,
        };
  }
  if (choice.kind === 'automatic' || choice.kind === 'medium')
    return recommended;
  const priority = choice.kind === 'low' ? 0 : 2;
  const adjust = (units: string, allowZero = false) => {
    const gwei = formatUnits(quantity(units, allowZero), 9);
    const value = getCustomFeeGwei(gwei, allowZero);
    if (value === null) throw new Error('INVALID_FEE');
    return feeGweiUnits(getFeePresetGwei(value, priority), allowZero);
  };
  return recommended.type === 0
    ? { type: 0, gasPrice: adjust(recommended.gasPrice) }
    : {
        type: 2,
        maxFeePerGas: adjust(recommended.maxFeePerGas),
        maxPriorityFeePerGas: adjust(recommended.maxPriorityFeePerGas, true),
      };
}
export function snapshotUtxoFeeChoice(
  input: UtxoFeeChoice = AUTOMATIC_FEE
): UtxoFeeChoice {
  const value = data(input);
  if (
    priorities.includes(value.kind as string) &&
    Object.keys(value).length === 1
  )
    return Object.freeze({ kind: value.kind as FeePriority });
  if (
    value.kind !== 'custom' ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'satPerVbyte')
  )
    throw new Error('INVALID_FEE');
  const rate = quantity(value.satPerVbyte);
  if (BigInt(rate) >= BigInt(5000)) throw new Error('INVALID_FEE');
  return Object.freeze({ kind: 'custom', satPerVbyte: rate });
}

/** The SDK remains the single coins/vbyte-to-atomic-rate conversion. */
export function chooseUtxoFeeRate(
  recommended: number,
  input: UtxoFeeChoice
): number | undefined {
  const choice = snapshotUtxoFeeChoice(input);
  if (choice.kind === 'automatic' || choice.kind === 'medium') return undefined;
  const rate =
    choice.kind === 'custom'
      ? Number(choice.satPerVbyte) / 1e8
      : Number(getFeePresetGwei(recommended, choice.kind === 'low' ? 0 : 2));
  const units = utxoFeeRateUnits(rate);
  if (units >= 5000) throw new Error('INVALID_FEE');
  return rate;
}
export { utxoFeeRateUnits };
