/** Contract metadata is display data, never evidence of a token's identity. */
export type Erc20Metadata = Readonly<{
  contractAddress: string;
  decimals: number;
  name: string;
  symbol: string;
}>;

/** Decoded contract fields, before a host applies its display/import policy. */
export type Erc20ReadFields = Readonly<{
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

function snapshotFields(
  value: unknown,
  fields: readonly string[]
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return invalid();
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function checkedReadFields(fields: Record<string, unknown>): Erc20ReadFields {
  if (typeof fields.name !== 'string' || typeof fields.symbol !== 'string')
    return invalid();
  return Object.freeze({
    decimals: parseErc20Decimals(fields.decimals),
    name: fields.name,
    symbol: fields.symbol,
  });
}

/** Existing token reads must remain usable regardless of their display text. */
export function parseErc20ReadFields(value: unknown): Erc20ReadFields {
  return checkedReadFields(
    snapshotFields(value, ['decimals', 'name', 'symbol'])
  );
}

/**
 * Bind the host's trusted checksum implementation once. It must not resolve
 * names or perform I/O. No dependency is resolved from the shared source tree.
 */
export function createErc20Policy(normalize: (address: string) => string) {
  if (typeof normalize !== 'function') return invalid();

  // Preserve the checksum library's syntactic forms (including ICAP and zero).
  const normalizeAddress = (value: unknown): string => {
    if (typeof value !== 'string') return invalid();
    try {
      const result = normalize(value);
      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(result))
        return invalid();
      return result;
    } catch {
      return invalid();
    }
  };
  const normalizeNonzeroHexAddress = (value: unknown): string => {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
      return invalid();
    const address = normalizeAddress(value);
    return /^0x0{40}$/.test(address) ? invalid() : address;
  };
  const parseMetadata = (value: unknown): Erc20Metadata => {
    // Read every own field before the trusted callback can reenter the host.
    const snapshot = snapshotFields(value, [
      'contractAddress',
      'decimals',
      'name',
      'symbol',
    ]);
    const fields = checkedReadFields(snapshot);
    const name = parseErc20Text(fields.name, 'name');
    const symbol = parseErc20Text(fields.symbol, 'symbol');
    const contractAddress = normalizeNonzeroHexAddress(
      snapshot.contractAddress
    );
    return Object.freeze({
      contractAddress,
      decimals: fields.decimals,
      name,
      symbol,
    });
  };
  return Object.freeze({
    normalizeAddress,
    normalizeNonzeroHexAddress,
    parseMetadata,
  });
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

/** Keep authoritative units alongside the existing extension balance field. */
export function formatErc20Balance(
  raw: unknown,
  decimals: string | number
): { balance: number; rawBalance: string } {
  const precision = parseErc20Decimals(
    typeof decimals === 'string' && /^\d+$/.test(decimals.trim())
      ? Number(decimals)
      : decimals
  );
  const rawBalance = parseErc20Units(raw);
  return {
    balance: Number(formatTokenUnits(rawBalance, precision)),
    rawBalance,
  };
}

/** Exact decimal input for the full uint8 precision range, without rounding. */
export function parseTokenAmount(value: unknown, decimals: number): string {
  const precision = parseErc20Decimals(decimals);
  if (
    typeof value !== 'string' ||
    value.length > 334 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  )
    return invalid();
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > precision) return invalid();
  const units = parseErc20Units(
    `${integer}${fraction.padEnd(precision, '0')}`.replace(/^0+(?=\d)/, '')
  );
  return units === '0' ? invalid() : units;
}

/** Fixed ERC20 transfer only. Address checksum validation belongs to each host. */
export function encodeErc20Transfer(
  recipient: string,
  amountUnits: string
): string {
  if (
    typeof recipient !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(recipient) ||
    /^0x0{40}$/i.test(recipient)
  )
    return invalid();
  const units = parseErc20Units(amountUnits);
  if (units === '0') return invalid();
  return `0xa9059cbb${recipient
    .slice(2)
    .toLowerCase()
    .padStart(64, '0')}${BigInt(units).toString(16).padStart(64, '0')}`;
}

export function decodeErc20Transfer(
  data: unknown
): Readonly<{ amountUnits: string; recipient: string }> {
  if (
    typeof data !== 'string' ||
    !/^0xa9059cbb[0-9a-f]{128}$/.test(data) ||
    data.slice(10, 34) !== '0'.repeat(24)
  )
    return invalid();
  const recipient = `0x${data.slice(34, 74)}`;
  const amountUnits = parseErc20Units(BigInt(`0x${data.slice(74)}`));
  if (encodeErc20Transfer(recipient, amountUnits) !== data) return invalid();
  return Object.freeze({ recipient, amountUnits });
}
