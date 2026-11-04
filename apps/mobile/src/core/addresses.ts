import { getAddress } from 'ethers/address';
import type { NetworkId } from './types.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';

/** Uses the extension's ethers parser, including mixed-case checksum validation. */
export function normalizePublicAddress(
  address: string,
  networkId: NetworkId
): string {
  if (networkId === 'syscoin' || networkId === 'bitcoin') return normalizeUtxoAddress(address, networkId);
  if (typeof address !== 'string' || address !== address.trim()) {
    throw new Error('Enter an address without whitespace');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    throw new Error('Enter a complete public address');
  const normalized = getAddress(address);
  if (/^0x0{40}$/.test(normalized))
    throw new Error('The zero address cannot be added');
  return normalized;
}

export function isPublicAddress(
  address: string,
  networkId: NetworkId
): boolean {
  try {
    normalizePublicAddress(address, networkId);
    return true;
  } catch {
    return false;
  }
}

export function shortAddress(address: string): string {
  return address.length > 16
    ? `${address.slice(0, 6)}…${address.slice(-6)}`
    : address;
}
