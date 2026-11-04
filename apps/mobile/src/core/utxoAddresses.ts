import { bech32 } from 'bech32';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

/** A fixed-network BIP84 receive address, not an xpub, descriptor or authority. */
export function normalizeUtxoAddress(value: unknown, networkId: UtxoNetworkId): string {
  const network = getUtxoNetwork(networkId);
  // Reject Unicode before the library lowercases it (for example U+212A → k).
  if (typeof value !== 'string' || value !== value.trim() || value.length > 90 || !/^[\x21-\x7e]+$/.test(value))
    throw new Error('Enter a complete P2WPKH address without whitespace');
  try {
    // Bech32 (not Bech32m) is required for witness version zero. The library
    // verifies checksum, printable alphabet, mixed case and conversion padding.
    const decoded = bech32.decode(value, 90);
    if (decoded.prefix !== network.addressHrp || decoded.words[0] !== 0 ||
        bech32.fromWords(decoded.words.slice(1)).length !== 20)
      throw new Error('Unsupported witness address');
    return bech32.encode(network.addressHrp, decoded.words, 90);
  } catch {
    throw new Error('Enter a valid P2WPKH address for the selected network');
  }
}
