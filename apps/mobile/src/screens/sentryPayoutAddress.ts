import { decodeOutputScriptAddress } from '../../../../source/shared/outputScriptAddress.ts';
import type { SentryNetwork } from '../../../../source/shared/sentryNetworks.ts';
import { getUtxoNetwork } from '../core/utxoNetworks.ts';

/** Public display only, using the same script codec and network as wallet addresses. */
export function decodeSentryPayoutAddress(scriptHex: string, network: SentryNetwork): string | null {
  if (!['mainnet', 'testnet'].includes(network)) return null;
  try {
    return decodeOutputScriptAddress(scriptHex,
      getUtxoNetwork(network === 'mainnet' ? 'syscoin' : 'utxo:5700').addressNetwork);
  } catch { return null; }
}
