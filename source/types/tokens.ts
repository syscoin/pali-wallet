export interface ITokenEthProps {
  balance: number;
  chainId?: number;
  collection?: IERC1155Collection[];
  collectionName?: string;
  contractAddress: string;
  decimals: string | number;
  editedSymbolToUse?: string;
  id?: string;
  is1155?: boolean;
  isNft: boolean;
  logo?: string;
  name?: string;
  tokenId?: number | string;
  tokenSymbol: string;
}

export interface IERC1155Collection {
  balance: number;
  tokenId: number;
  tokenSymbol: string;
}

export interface IWatchAssetTokenProps {
  address: string;
  aggregators?: string[];
  balanceError?: unknown;
  decimals: number;
  image?: string;
  isERC721?: boolean;
  name?: string;
  symbol: string;
}

export interface ITokenSysProps {
  assetGuid?: string;
  balance?: number;
  chainId?: number;
  contract?: string;
  decimals?: number;
  description?: string;
  image?: string;
  maxSupply?: string;
  name?: string;
  path?: string;
  pubData?: any;
  symbol?: string;
  totalReceived?: string;
  totalSent?: string;
  totalSupply?: string;
  transfers?: number;
  type?: string;
  updateCapabilityFlags?: number;
}

export interface IAddCustomTokenMetadataInfos {
  assetDecimals: number | string;
  // String to accept empty values
  assetSymbol: string;
  contractAddress: string;
}
