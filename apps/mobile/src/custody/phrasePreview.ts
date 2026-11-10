import type { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { getUtxoSdkNetwork, resolveUtxoNetwork, supportsUtxoSoftwareCustody, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';

type PhrasePreviewKeyring = Pick<SoftwareKeyring, 'isSeedValid' | 'importWeb3Account'>;
export type NativePhraseAddressPreview = Readonly<{ label: string; address: string }>;

/** Derive public first-account addresses without opening or persisting a wallet. */
export async function previewNativePhraseAddresses(
  keyring: PhrasePreviewKeyring,
  canonicalPhrase: string,
  utxo: UtxoNetwork | undefined,
  assertCurrent: () => void
): Promise<readonly NativePhraseAddressPreview[]> {
  const check = () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) {
      if (result && (typeof result === 'object' || typeof result === 'function'))
        void Promise.resolve(result).catch(() => undefined);
      throw new Error('CANCELLED');
    }
  };
  check();
  if (typeof canonicalPhrase !== 'string' || !canonicalPhrase.isWellFormed() || canonicalPhrase.length > 4096 ||
      canonicalPhrase !== canonicalPhrase.normalize('NFKD').trim().replace(/\s+/gu, ' ') ||
      ![12, 24].includes(canonicalPhrase.split(' ').length)) throw new Error('INVALID_INPUT');
  let valid: boolean;
  try { valid = keyring.isSeedValid(canonicalPhrase) === true; }
  catch { check(); throw new Error('INVALID_INPUT'); }
  check();
  if (!valid) throw new Error('INVALID_INPUT');
  let address: string;
  try {
    // The SDK's private-key-bearing result stays local and is never returned.
    const derived = keyring.importWeb3Account(canonicalPhrase);
    address = normalizePublicAddress(derived.address, 'ethereum');
  } catch { check(); throw new Error('UNAVAILABLE'); }
  check();
  const rows: NativePhraseAddressPreview[] = [Object.freeze({ label: 'EVM account', address })];
  if (utxo) {
    try {
      const network = resolveUtxoNetwork(utxo);
      if (!supportsUtxoSoftwareCustody(network)) throw new Error('UNSUPPORTED');
      // Load the portable signer only after the native crypto-qualified owner
      // has admitted this preview. This is the same API used by account recovery.
      const [{ getSyscoinSigners }, { getNetworkConfig }] = await Promise.all([
        import('@sidhujag/sysweb3-keyring/cjs/signers.js'),
        import('@sidhujag/sysweb3-network'),
      ]);
      check();
      const sdkNetwork = getUtxoSdkNetwork(network);
      const config = getNetworkConfig(sdkNetwork.slip44, sdkNetwork.currency);
      const { xPubType, zPubType } = config.types;
      if (!xPubType || !zPubType) throw new Error('UNSUPPORTED');
      const { hd } = getSyscoinSigners({
        mnemonic: canonicalPhrase,
        rpc: { formattedNetwork: sdkNetwork, networkConfig: { networks: config.networks, types: { xPubType, zPubType } } },
      });
      hd.createAccountAtIndex(0, 84);
      address = normalizeUtxoAddress(hd.createAddress(0, false, 84), network);
      check();
      rows.push(Object.freeze({ label: `${network.name} UTXO`, address }));
    } catch { check(); throw new Error('UNAVAILABLE'); }
  }
  check();
  return Object.freeze(rows);
}
