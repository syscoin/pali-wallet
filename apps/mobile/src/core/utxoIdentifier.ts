import { utils as syscoinUtils } from 'syscoinjs-lib';
import { deriveDescriptorAddress } from '@sidhujag/sysweb3-keyring/cjs/utils/watch-descriptor.js';
import { convertExtendedKeyVersion } from '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths.js';
import { assertPublicWatchOnlyIdentifier } from '../../../../source/utils/watchOnlyIdentifier.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';

export type UtxoPublicIdentifier = Readonly<{ kind: 'address' | 'account'; identifier: string; address: string }>;
/** Existing extension public-input validation and SDK derivation, without a keyring session. */
export function parseUtxoPublicIdentifier(value: unknown, networkId: UtxoNetworkId): UtxoPublicIdentifier {
  assertPublicWatchOnlyIdentifier(value);
  const input = value as string, network = getUtxoNetwork(networkId);
  try {
    const address = normalizeUtxoAddress(input, networkId);
    return Object.freeze({ kind: 'address', identifier: address, address });
  } catch { /* A public account key or descriptor is handled by the existing SDK below. */ }
  const sdkNetwork = { kind: 'syscoin', slip44: network.slip44, currency: networkId === 'bitcoin' ? 'Bitcoin' : 'Syscoin' } as Parameters<typeof deriveDescriptorAddress>[1];
  let identifier = input;
  if (!input.includes('(')) {
    if (!/^(xpub|tpub|zpub|vpub)/i.test(input)) throw new Error('Unsupported public account key');
    const types = networkId === 'bitcoin' ? syscoinUtils.bitcoinZPubTypes : syscoinUtils.syscoinZPubTypes;
    identifier = convertExtendedKeyVersion(input, types.mainnet.zpub);
  }
  const address = normalizeUtxoAddress(deriveDescriptorAddress(input.includes('(') ? identifier : `wpkh(${identifier}/0/*)`, sdkNetwork), networkId);
  return Object.freeze({ kind: 'account', identifier, address });
}
