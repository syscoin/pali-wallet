import type { KeyringAccountType } from 'types/network';

/** The wallet context selected for an approved EVM transaction. */
export interface IEvmTransactionContext {
  account: { address: string; id: number; type: KeyringAccountType };
  chainId: number;
  rpcUrl: string;
  slip44: number;
}

export const EVM_TRANSACTION_CONTEXT_CHANGED =
  'PALI_TRANSACTION_CONTEXT_CHANGED';
