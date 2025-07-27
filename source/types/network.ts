// Shared network types - mirror sysweb3 types without importing the package
// This prevents frontend bundles from pulling in sysweb3 dependencies

/* eslint-disable no-shadow */
export enum INetworkType {
  Ethereum = 'ethereum',
  Syscoin = 'syscoin',
}
/* eslint-enable no-shadow */

export interface INetwork {
  apiUrl?: string;
  chainId: number;
  coingeckoId?: string;
  coingeckoPlatformId?: string;
  currency: string;
  default?: boolean;
  explorer?: string;
  key?: string;
  kind: INetworkType;
  label: string;
  slip44: number;
  url: string;
}

/**
 * Error structure for Syscoin transaction operations.
 * This interface documents the error format that consumers (like Pali) should expect
 * when catching errors from ISyscoinTransactions methods.
 *
 * @example
 * try {
 *   const result = await syscoinTransaction.getEstimateSysTransactionFee({...});
 * } catch (error: unknown) {
 *   const sysError = error as ISyscoinTransactionError;
 *   if (sysError.code === 'INSUFFICIENT_FUNDS') {
 *     console.log(`Short by ${sysError.shortfall} SYS`);
 *   }
 * }
 */
export interface ISyscoinTransactionError {
  code:
    | 'INSUFFICIENT_FUNDS'
    | 'INVALID_FEE_RATE'
    | 'INVALID_AMOUNT'
    | 'INVALID_MEMO'
    | 'INVALID_BLOB'
    | 'INVALID_OUTPUT_COUNT'
    | 'INVALID_ASSET_ALLOCATION'
    | 'INVALID_PARENT_NODES'
    | 'INVALID_TX_VALUE'
    | 'INVALID_RECEIPT_VALUE'
    | 'SUBTRACT_FEE_FAILED'
    | 'TRANSACTION_CREATION_FAILED'
    | 'TRANSACTION_SEND_FAILED';
  // in SYS (not satoshis)
  details?: {
    // For SUBTRACT_FEE_FAILED
    guid?: string;
    inputTotal?: any;
    // Additional context about the error
    markedOutputs?: number; // BN object in satoshis
    message?: string;
    // BN object in satoshis
    outputTotal?: any; // For SUBTRACT_FEE_FAILED
    removedOutputs?: number;
    // BN object in satoshis
    requiredFee?: any; // For INVALID_ASSET_ALLOCATION
  };
  error: boolean;
  fee?: number;
  message: string;
  // in SYS (not satoshis)
  remainingFee?: number;
  // in SYS (not satoshis)
  shortfall?: number;
}

/* eslint-disable no-shadow */
export enum KeyringAccountType {
  HDAccount = 'HDAccount',
  Imported = 'Imported',
  Ledger = 'Ledger',
  Trezor = 'Trezor',
}
/* eslint-enable no-shadow */

export type IKeyringBalances = {
  [INetworkType.Syscoin]: number;
  [INetworkType.Ethereum]: number;
};

export interface IKeyringAccountState {
  address: string;
  balances: IKeyringBalances;
  id: number;
  isImported: boolean;
  isLedgerWallet: boolean;
  isTrezorWallet: boolean;
  label: string;
  xprv: string;
  xpub: string;
}

export const initialActiveHdAccountState: IKeyringAccountState = {
  address: '',
  balances: {
    ethereum: 0,
    syscoin: 0,
  },
  id: 0,
  isTrezorWallet: false,
  isLedgerWallet: false,
  label: 'Account 1',
  xprv: '',
  xpub: '',
  isImported: false,
};
