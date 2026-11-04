import { getAddress } from 'ethers/address';

/** Contract metadata is display data, never evidence of a token's identity. */
export type Erc20Metadata = Readonly<{
  contractAddress: string;
  decimals: number;
  name: string;
  symbol: string;
}>;

export const ERC20_TEXT_LIMITS = Object.freeze({
  name: Object.freeze({ bytes: 512, characters: 128 }),
  symbol: Object.freeze({ bytes: 256, characters: 64 }),
});
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const invalid = (): never => {
  throw new Error('Invalid ERC20 data');
};

export function normalizeErc20Address(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
    return invalid();
  try {
    const address = getAddress(value);
    return /^0x0{40}$/.test(address) ? invalid() : address;
  } catch {
    return invalid();
  }
}

/** Reject unsafe numbers; uint256 values always cross a boundary as text/bigint. */
export function parseErc20Units(value: unknown): string {
  if (typeof value === 'bigint') {
    if (value < BigInt(0) || value > UINT256_MAX) return invalid();
    return value.toString();
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    return invalid();
  return BigInt(value) <= UINT256_MAX ? value : invalid();
}

export function parseErc20Decimals(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < BigInt(0) || value > BigInt(255)) return invalid();
    return Number(value);
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 255
  )
    return invalid();
  return value;
}

export function parseErc20Text(
  value: unknown,
  field: 'name' | 'symbol'
): string {
  const limit = ERC20_TEXT_LIMITS[field];
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > limit.bytes ||
    !value.trim() ||
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(
      value
    )
  )
    return invalid();
  let bytes = 0;
  let characters = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return invalid();
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (++characters > limit.characters || bytes > limit.bytes)
      return invalid();
  }
  return value;
}

/** Snapshot only own data fields, without executing a supplied accessor. */
export function parseErc20Metadata(value: unknown): Erc20Metadata {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  const fields = ['contractAddress', 'decimals', 'name', 'symbol'];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return invalid();
  const own = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && 'value' in descriptor
      ? descriptor.value
      : invalid();
  };
  return Object.freeze({
    contractAddress: normalizeErc20Address(own('contractAddress')),
    decimals: parseErc20Decimals(own('decimals')),
    name: parseErc20Text(own('name'), 'name'),
    symbol: parseErc20Text(own('symbol'), 'symbol'),
  });
}

/** Exact display formatting for the full ERC20 uint8 precision range. */
export function formatTokenUnits(units: string, decimals: number): string {
  const value = parseErc20Units(units);
  const precision = parseErc20Decimals(decimals);
  if (precision === 0) return value;
  const padded = value.padStart(precision + 1, '0');
  const integer = padded.slice(0, -precision);
  const fraction = padded.slice(-precision).replace(/0+$/, '') || '0';
  return `${integer}.${fraction}`;
}
