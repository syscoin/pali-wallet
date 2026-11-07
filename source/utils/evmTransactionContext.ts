import type { KeyringAccountType } from '../types/network';

/** The wallet context selected for an approved EVM transaction. */
export interface IEvmTransactionContext {
  account: { address: string; id: number; type: KeyringAccountType };
  chainId: number;
  rpcUrl: string;
  /** Captured in the background when the approval is created. */
  sessionGeneration?: number;
  slip44: number;
}

export const EVM_TRANSACTION_CONTEXT_CHANGED =
  'PALI_TRANSACTION_CONTEXT_CHANGED';

export const isSavedEvmNonceConflict = (
  error:
    | { code?: unknown; transactionNotBroadcast?: unknown }
    | null
    | undefined
): boolean =>
  error?.code === 'EVM_SIGNED_RECORD_NONCE_CONFLICT' &&
  error.transactionNotBroadcast === true;

export const WALLET_NETWORK_CATCHING_UP_MESSAGE =
  'The network is still updating your previous transaction. Please try again shortly.';

// Locally classified asset-review failures do not include RPC error bodies.
export const EVM_ASSET_REVIEW_REQUIRED = 'EVM_ASSET_REVIEW_REQUIRED';
export const EVM_ASSET_REVIEW_MESSAGE =
  'Balance changed or could not be verified. Review the amount and try again.';

export const EVM_LEGACY_PENDING = 'EVM_LEGACY_PENDING';
export const EVM_LEGACY_VERIFICATION_UNAVAILABLE =
  'EVM_LEGACY_VERIFICATION_UNAVAILABLE';

/** Only locally classified pre-broadcast failures receive these messages. */
export const legacyEvmNonceErrorKey = (error: any): string | undefined => {
  if (error?.transactionNotBroadcast !== true) return;
  if (error.code === EVM_LEGACY_PENDING) return 'send.legacyPendingNonce';
  if (error.code === EVM_LEGACY_VERIFICATION_UNAVAILABLE)
    return 'send.legacyNonceVerificationUnavailable';
};
