import { utils as syscoinUtils } from 'syscoinjs-lib';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

/** Use the same bitcoinjs address validation/encoding as the existing SDK. */
export function normalizeUtxoAddress(value: unknown, networkId: UtxoNetworkId): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 128 || !/^[\x21-\x7e]+$/.test(value))
    throw new Error('Enter a complete public address for the selected network');
  try {
    const network = getUtxoNetwork(networkId).addressNetwork;
    const output = syscoinUtils.bitcoinjs.address.toOutputScript(value, network);
    return syscoinUtils.bitcoinjs.address.fromOutputScript(output, network);
  } catch { throw new Error('Enter a valid public address for the selected network'); }
}
