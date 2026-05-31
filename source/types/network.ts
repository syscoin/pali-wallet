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
  PasskeySmartAccount = 'PasskeySmartAccount',
  Trezor = 'Trezor',
}
/* eslint-enable no-shadow */

/* eslint-disable no-shadow */
export enum PasskeySponsorMode {
  Disabled = 'disabled',
  GasOnly = 'gasOnly',
  Required = 'required',
}
/* eslint-enable no-shadow */

export interface IPasskeySmartAccountMetadata {
  chainId: number;
  contractVersion: string;
  credentialId: string;
  credentialIdHash: string;
  deploymentGasPayer?: {
    address: string;
    id: number;
    type: KeyringAccountType;
  };
  deploymentSalt: string;
  factoryAddress?: string;
  isDeployed: boolean;
  passkeyName: string;
  publicKey: {
    originHash: string;
    originLength: number;
    rpIdHash: string;
    x: string;
    y: string;
  };
  sponsor?: {
    mode: PasskeySponsorMode;
    policyText?: string;
    signer?: string;
    url?: string;
    urlHash?: string;
  };
}

export type IKeyringBalances = {
  [INetworkType.Syscoin]: number;
  [INetworkType.Ethereum]: number;
};

export interface IKeyringAccountState {
  address: string;
  balances: IKeyringBalances;
  // Per-chain EVM tx count hint (chainId -> txCount)
  // Used to decide if explorer paging can be enabled safely
  evmTxCountByChainId?: Record<number, number>;
  id: number;
  isImported: boolean;
  isLedgerWallet: boolean;
  isPasskeySmartAccount?: boolean;
  isTrezorWallet: boolean;
  label: string;
  passkey?: IPasskeySmartAccountMetadata;
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
  isPasskeySmartAccount: false,
  evmTxCountByChainId: {},
  xprv: '',
  xpub: '',
  isImported: false,
};
