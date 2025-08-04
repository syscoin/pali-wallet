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
