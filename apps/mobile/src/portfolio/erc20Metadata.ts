import { getAddress } from 'ethers/address';
import {
  parseErc20Decimals,
  parseErc20Text,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';

const invalid = (): never => {
  throw new Error('Invalid ERC20 data');
};

// Dependency-backed address checks stay inside the mobile package. The shared
// numeric/text codec must also load when only mobile dependencies are installed.
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
