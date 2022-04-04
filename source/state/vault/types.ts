import {
  IKeyringAccountState,
  INetwork,
  INetworkType,
} from '@pollum-io/sysweb3-utils';

export interface IVaultState {
  activeToken: string;
  encryptedMnemonic: string;
  isPendingBalances: boolean;
  lastLogin: number;
  timer: number;
  trustedApps: string[];
  accounts: {
    [id: number]: IKeyringAccount;
  };
  activeAccount: IKeyringAccount;
  networks: {
    [INetworkType.Ethereum]: {
      [chainId: number]: INetwork;
    };
    [INetworkType.Syscoin]: {
      [chainId: number]: INetwork;
    };
  };
  activeNetwork: INetwork;
}

export interface IKeyringAccount extends IKeyringAccountState {
  assets: any;
  transactions: any;
}

export interface Holding {
  NFTID: string;
  assetGuid: string;
  balance: number;
  baseAssetID: string;
  childAssetID: string;
  decimals: number;
  description: string;
  symbol: string;
  type: string;
}

export interface IMintedToken {
  assetGuid: string;
  maxSupply: number;
  symbol: string;
  totalSupply: number;
}
