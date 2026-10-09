import type { INetworkType, KeyringAccountType } from 'types/network';

/** Extension-owned account/network authorization for a PSBT approval. */
export interface IUtxoSigningContext {
  account: {
    address: string;
    id: number;
    type: KeyringAccountType;
    xpub: string;
  };
  chainId: number;
  kind: INetworkType;
  rpcUrl: string;
  slip44: number;
}

export const UTXO_SIGNING_CONTEXT_CHANGED = 'PALI_PSBT_SIGNING_CONTEXT_CHANGED';
