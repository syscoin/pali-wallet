import { ethers } from 'ethers';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { ITokenEthProps, ITokenSysProps } from 'types/tokens';

// SYS TYPES
export interface ISysAssetsController {
  addSysDefaultToken: (
    assetGuid: string,
    networkUrl: string
  ) => Promise<boolean | ITokenSysProps>;
  getSysAssetsByXpub: (
    xpub: string,
    networkUrl: string
  ) => Promise<ITokensAssetReponse[]>;
}

export interface ITokensAssetReponse {
  assetGuid: string;
  balance: string;
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
    provider: ethers.providers.JsonRpcProvider
  ) => Promise<IAddCustomTokenResponse>;
  addEvmDefaultToken: (
    token: ITokenEthProps,
    accountAddress: string,
    networkUrl: string
  ) => Promise<ITokenEthProps | boolean>;
  updateAllEvmTokens: (
    account: IKeyringAccountState,
    networks: any
  ) => Promise<any>;
}
