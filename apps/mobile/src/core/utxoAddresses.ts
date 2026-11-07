import { utils as syscoinUtils } from 'syscoinjs-lib';
import { supportsUtxoSoftwareSpend } from '../../../../source/shared/utxoSoftwareCustody.ts';
import { resolveUtxoNetwork, supportsUtxoSoftwareCustody, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

export const UTXO_IMPORT_TYPES = ['p2wpkh', 'p2pkh', 'p2tr'] as const;
export type UtxoImportAddressType = typeof UTXO_IMPORT_TYPES[number];
export const UTXO_IMPORT_LABELS = { p2wpkh: 'SegWit', p2pkh: 'Legacy', p2tr: 'Taproot' } as const;

/** Use the same bitcoinjs address validation/encoding as the existing SDK. */
export function normalizeUtxoAddress(value: unknown, scope: UtxoNetworkId | UtxoNetwork): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 128 || !/^[\x21-\x7e]+$/.test(value))
    throw new Error('Enter a complete public address for the selected network');
  try {
    const network = resolveUtxoNetwork(scope).addressNetwork;
    const output = syscoinUtils.bitcoinjs.address.toOutputScript(value, network);
    return syscoinUtils.bitcoinjs.address.fromOutputScript(output, network);
  } catch { throw new Error('Enter a valid public address for the selected network'); }
}

/** A new receive or send must only use a script the software wallet supports. */
export function canUseUtxoCustodyAddress(address: string, network: UtxoNetwork): boolean {
  if (!supportsUtxoSoftwareCustody(network)) return false;
  try {
    const script = syscoinUtils.bitcoinjs.address.toOutputScript(address, network.addressNetwork);
    return supportsUtxoSoftwareSpend(network, [script]);
  } catch { return false; }
}

/** Decode the existing public address; a WIF itself does not select a script. */
export function findWifAddressType(address: string, networkId: UtxoNetworkId | UtxoNetwork): UtxoImportAddressType | undefined {
  const network = resolveUtxoNetwork(networkId).addressNetwork;
  const { payments } = syscoinUtils.bitcoinjs;
  return UTXO_IMPORT_TYPES.find((type) => {
    try { return !!payments[type]({ address, network }).output; }
    catch { return false; }
  });
}
