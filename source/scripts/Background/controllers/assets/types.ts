import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import { IPaliAccount } from 'state/vault/types';
import { ITokenEthProps, ITokenSysProps } from 'types/tokens';

// SYS TYPES

export interface IAssetsManager {
  evm: IEvmAssetsController;
  sys: ISysAssetsController;
  utils: IAssetsManagerUtils;
}

export interface IAssetsManagerUtilsResponse {
  ethereum: ITokenEthProps[];
  syscoin: ITokenSysProps[];
}

export interface INftController {
  getUserNfts: (
    userAddress: string,
    chainId: number,
    rpcUrl: string
  ) => Promise<INftsStructure[]>;
  validateAndManagerUserNfts: (
    fetchedNfts: INftsStructure[]
  ) => INftsStructure[];
}
export interface IAssetsManagerUtils {
  updateAssetsFromCurrentAccount: (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    networkChainId: number,
    web3Provider: CustomJsonRpcProvider
  ) => Promise<IAssetsManagerUtilsResponse>;
}
export interface ISysAssetsController {
  addSysDefaultToken: (
    assetGuid: string,
    networkUrl: string
  ) => Promise<boolean | ITokenSysProps>;
  getSysAssetsByXpub: (
    xpub: string,
    networkUrl: string,
    networkChainId: number
  ) => Promise<ISysTokensAssetReponse[]>;
}

export interface ISysTokensAssetReponse {
  assetGuid: string;
  balance: number;
  chainId?: number;
  decimals: number;
  name: string;
  path: string;
  symbol: string;
  totalReceived: string;
  totalSent: string;
  transfers: number;
  type: string;
}

// EVM TYPES
export interface IAddCustomTokenResponse {
  error: boolean;
  errorType?: string;
  message?: string;
  tokenToAdd?: ITokenEthProps;
}

export interface IEvmAssetsController {
  addCustomTokenByType: (
    walletAddres: string,
    contractAddress: string,
    symbol: string,
    decimals: number,
    web3Provider: CustomJsonRpcProvider
  ) => Promise<IAddCustomTokenResponse>;
  addEvmDefaultToken: (
    token: ITokenEthProps,
    accountAddress: string,
    web3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenEthProps | boolean>;
  updateAllEvmTokens: (
    account: IPaliAccount,

    currentNetworkChainId: number,
    web3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenEthProps[]>;
}
