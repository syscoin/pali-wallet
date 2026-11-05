import type { INetworkType, KeyringAccountType } from 'types/network';

import type { UtxoFeeReview } from './syscoinPsbtValues';

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

/** Exact fee and unsigned transaction attested by this worker for its current scope. */
export type UtxoWalletFeeReview = UtxoFeeReview &
  Readonly<{ approvalTag: string }>;

export const isUtxoWalletFeeReview = (
  value: unknown
): value is UtxoWalletFeeReview => {
  if (!value || typeof value !== 'object') return false;
  const { approvalTag, feeSatoshis, unsignedHash } =
    value as Partial<UtxoWalletFeeReview>;
  return (
    typeof approvalTag === 'string' &&
    approvalTag.length === 64 &&
    /^[\da-f]{64}$/.test(approvalTag) &&
    typeof feeSatoshis === 'string' &&
    /^(0|[1-9]\d{0,19})$/.test(feeSatoshis) &&
    typeof unsignedHash === 'string' &&
    unsignedHash.length === 64 &&
    /^[\da-f]{64}$/.test(unsignedHash)
  );
};
