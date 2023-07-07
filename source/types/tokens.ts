export interface ITokenEthProps {
  balance: number;
  chainId?: number;
  contractAddress: string;
  decimals: string | number;
  editedSymbolToUse?: string;
  id?: string;
  isNft: boolean;
  logo?: string;
  name?: string;
  tokenSymbol: string;
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
  decimals: number | string; // String to accept empty values
  symbol: string;
}
