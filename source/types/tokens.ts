export interface ITokenEthProps {
  balance: number;
  chainId?: number;
  contractAddress: string;
  decimals: string | number;
  id?: string;
  isNft: boolean;
  logo?: string;
  name?: string;
  tokenStandard?: 'ERC-20' | 'ERC-721' | 'ERC-1155' | 'ERC-777' | 'ERC-4626';
  tokenSymbol: string;
}

// CoinGecko-aligned interface as source of truth
export interface ITokenDetails {
  balance: number;
  categories?: string[];
  chainId?: number;
  contractAddress: string;
  // Wallet-specific additions
  decimals: number;
  // CoinGecko metadata (exact field names)
  description?: {
    en?: string;
  };
  // Core CoinGecko fields (exact match with API)
  id: string;
  // CoinGecko image field (exact match)
  image?: {
    large?: string;
    small?: string;
    thumb?: string;
  };
  // NFT-specific fields
  isNft?: boolean;
  // Verification status
  isVerified?: boolean;
  links?: {
    homepage?: string[];
  };
  // CoinGecko market data (exact field names)
  market_cap_rank?: number;
  market_data?: {
    ath?: { [currency: string]: number };
    ath_date?: { [currency: string]: string };
    atl?: { [currency: string]: number };
    atl_date?: { [currency: string]: string };
    circulating_supply?: number;
    current_price?: { [currency: string]: number };
    fully_diluted_valuation?: { [currency: string]: number };
    market_cap?: { [currency: string]: number };
    max_supply?: number;
    price_change_percentage_24h?: number;
    price_change_percentage_30d?: number;
    price_change_percentage_7d?: number;
    total_supply?: number;
    total_volume?: { [currency: string]: number };
  };
  name: string;
  platforms?: { [platform: string]: string };
  symbol: string;
  // Token standard information
  tokenStandard?: 'ERC-20' | 'ERC-721' | 'ERC-1155' | 'ERC-777' | 'ERC-4626';
}

export interface ITokenSearchResult {
  balance?: number;
  // Additional fields for Blockscout API support
  contractAddress?: string;
  currentPrice?: number;
  decimals?: number;
  id: string;
  image?: string;
  marketCap?: number;
  marketCapRank?: number;
  name: string;
  priceChange24h?: number;
  symbol: string;
  tokenStandard?:
    | 'ERC-20'
    | 'ERC-721'
    | 'ERC-1155'
    | 'ERC-777'
    | 'ERC-4626'
    | string;
}

export interface IWatchAssetTokenProps {
  address: string;
  decimals: number;
  image?: string;
  name?: string;
  symbol: string;
}

// Interface for asset preview (used by getAssetInfo for display purposes)
export interface IAssetPreview {
  balance: number;
  chainId: number;
  contractAddress: string;
  currentPrice?: number;
  decimals: number;
  id: string;
  isNft: boolean;
  // Enhanced preview data (not saved to vault)
  isVerified?: boolean;
  logo?: string;
  marketCap?: number;
  name: string;
  priceChange24h?: number;
  tokenStandard?: 'ERC-20' | 'ERC-721' | 'ERC-1155' | 'ERC-777' | 'ERC-4626';
  tokenSymbol: string;
}

export interface ITokenSysProps {
  assetGuid?: string;
  balance?: number;
  chainId?: number;
  contract?: string; // NEVM contract address for cross-chain assets
  decimals?: number;
  description?: string;
  image?: string;
  maxSupply?: string;
  metaData?: string; // Syscoin 5 - general metadata field
  name?: string;
  path?: string;
  symbol?: string;
  totalReceived?: string;
  totalSent?: string;
  totalSupply?: string;
  transfers?: number;
  type?: string;
}

// Interface for getSysAssetMetadata response (matches getAsset return type)
export interface ISysAssetMetadata {
  assetGuid: string;
  contract: string;
  decimals: number;
  maxSupply: string;
  metaData?: string; // Syscoin 5 - general metadata field
  symbol: string;
  totalSupply: string;
}

export interface IAddCustomTokenMetadataInfos {
  assetDecimals: number | string;
  // String to accept empty values
  assetSymbol: string;
  contractAddress: string;
}
