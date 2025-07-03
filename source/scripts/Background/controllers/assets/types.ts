import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { IAccountAssets } from 'state/vault/types';
import {
  ITokenEthProps,
  ITokenSysProps,
  ITokenDetails,
  ITokenSearchResult,
  ISysAssetMetadata,
} from 'types/tokens';

// SYS TYPES

export interface IAssetsManager {
  sys: ISysAssetsController;
  utils: IAssetsManagerUtils;
}

export interface IAssetsManagerUtilsResponse {
  ethereum: ITokenEthProps[];
  syscoin: ITokenSysProps[];
}

export interface IAssetsManagerUtils {
  updateAssetsFromCurrentAccount: (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    networkChainId: number,
    web3Provider: CustomJsonRpcProvider,
    currentAssets: IAccountAssets
  ) => Promise<IAssetsManagerUtilsResponse>;
}

export interface ISysAssetsController {
  addSysDefaultToken: (
    assetGuid: string,
    networkUrl: string
  ) => Promise<boolean | ITokenSysProps>;
  getAssetCached: (
    networkUrl: string,
    assetGuid: string
  ) => Promise<ISysAssetMetadata | null>;
  getSysAssetsByXpub: (
    xpub: string,
    networkUrl: string,
    networkChainId: number
  ) => Promise<ISysTokensAssetReponse[]>;
  getUserOwnedTokens: (xpub: string) => Promise<ISysTokensAssetReponse[]>;
  validateSPTOnly: (
    assetGuid: string,
    xpub: string,
    networkUrl: string
  ) => Promise<ITokenSysProps | null>;
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
  checkContractType: (
    contractAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<any>;
  // Auto-detect CoinGecko IDs for a chainId
  detectCoinGeckoIds: (chainId: number) => Promise<{
    coingeckoId?: string;
    coingeckoPlatformId?: string;
  } | null>;

  // Fetch specific NFT token IDs for a collection
  fetchNftTokenIds: (
    contractAddress: string,
    ownerAddress: string,
    tokenStandard: 'ERC-721' | 'ERC-1155'
  ) => Promise<
    { balance: number; tokenId: string }[] & {
      hasMore?: boolean;
      requiresManualEntry?: boolean;
    }
  >;

  getCurrentNetworkPlatform: () => string | null;
  getERC20TokenInfo: (
    contractAddress: string,
    accountAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<{
    balance: string;
    decimals: number;
    name: string;
    symbol: string;
  }>;

  // Get only market data from CoinGecko without any blockchain calls
  getOnlyMarketData: (contractAddress: string) => Promise<any | null>;

  // Get basic token details (cached, no balance, no market data) - for notification manager
  getTokenDetails: (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenDetails | null>;

  // Get token details with balance (for import forms)
  getTokenDetailsWithBalance: (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenDetails | null>;

  // Get token details with full market data (for details screens, enhanced with CoinGecko data)
  getTokenDetailsWithMarketData: (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenDetails | null>;

  // CoinGecko-based token functionality
  getTokenPriceData: (
    chainId: number,
    currency?: string
  ) => Promise<{
    price: number;
    priceChange24h?: number;
  }>;

  // PATH 1: Show what user owns (Blockscout API)
  getUserOwnedTokens: (walletAddress: string) => Promise<ITokenSearchResult[]>;

  updateAllEvmTokens: (
    account: IKeyringAccountState,
    currentNetworkChainId: number,
    w3Provider: CustomJsonRpcProvider,
    accountAssets: ITokenEthProps[]
  ) => Promise<ITokenEthProps[]>;

  // Simplified ERC-20 validation with minimal ETH calls
  validateERC20Only: (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenDetails | null>;

  // NFT contract validation - for custom NFT import
  validateNftContract: (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => Promise<ITokenDetails | null>;

  verifyERC1155Ownership: (
    contractAddress: string,
    ownerAddress: string,
    tokenIds: string[],
    w3Provider: CustomJsonRpcProvider
  ) => Promise<{ balance: number; tokenId: string; verified: boolean }[]>;

  // Verify ownership of NFT token IDs
  verifyERC721Ownership: (
    contractAddress: string,
    ownerAddress: string,
    tokenIds: string[],
    w3Provider: CustomJsonRpcProvider
  ) => Promise<{ balance: number; tokenId: string; verified: boolean }[]>;
}
