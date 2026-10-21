import { KeyringAccountType, INetworkType } from 'types/network';

export interface IDApp {
  accountId: number;
  accountType: KeyringAccountType;
  chain: INetworkType;
  chainId: number;
  date: number;
  host: string;
  logo?: string;
  // EVM grants remain network-compatible. UTXO grants require an approved
  // vault and stable reference, not a reusable numeric account slot.
  utxoAccount?: { slip44: number; xpub: string };
}

export interface IDAppState {
  /**
   * A list of sites that have been granted permissions to access a user's
   * account information.
   */
  dapps: {
    [host: string]: IDApp;
  };
}
