import type { KeyringAccountType } from 'types/network';

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
