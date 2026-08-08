import PaliLogo from 'assets/all_assets/favicon-32.png';
import ZkSysIcon from 'assets/all_assets/zksys-icon.svg';

// Canonical zkSYS ERC-20 token addresses per chain (governance token; gas
// payment in zkSYS is handled natively by the chain's gas tank).
const CONFIGURED_ZKSYS_TOKEN_ADDRESSES = new Set(
  ['0x6EBb170f69D886916D9ee9E585CE39E626CbC35d'].map((address) =>
    address.toLowerCase()
  )
);

const SYSCOIN_LOGO_URL =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/syscoin/info/logo.png';
const BITCOIN_LOGO_URL =
  'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/btc.png';

export const SYSX_ASSET_GUID = '123456';

interface IKnownSyscoinAsset {
  coinGeckoId: string;
  isVerified: true;
  logo: string;
}

const KNOWN_SYSCOIN_ASSETS: Readonly<Record<string, IKnownSyscoinAsset>> = {
  [SYSX_ASSET_GUID]: {
    coinGeckoId: 'syscoin',
    isVerified: true,
    logo: SYSCOIN_LOGO_URL,
  },
};

// Reserved logos previously assigned by symbol. They must not survive on a
// noncanonical SPT if they were persisted by an older wallet build.
const RESERVED_UTXO_LOGOS = new Set([SYSCOIN_LOGO_URL, BITCOIN_LOGO_URL]);

export const getKnownSyscoinAsset = (
  assetGuid?: number | string
): IKnownSyscoinAsset | null => {
  if (assetGuid === undefined || assetGuid === null) return null;

  return KNOWN_SYSCOIN_ASSETS[String(assetGuid)] || null;
};

export const sanitizeUtxoTokenLogo = (
  logo: string | undefined,
  assetGuid?: number | string
): string | undefined => {
  if (!logo) return logo;

  const knownAsset = getKnownSyscoinAsset(assetGuid);
  if (knownAsset?.logo === logo) return logo;

  return RESERVED_UTXO_LOGOS.has(logo) ? undefined : logo;
};

export const getKnownTokenLogo = (
  _symbol?: string,
  contractAddress?: string,
  assetGuid?: number | string
): string | null => {
  if (
    contractAddress &&
    CONFIGURED_ZKSYS_TOKEN_ADDRESSES.has(contractAddress.toLowerCase())
  ) {
    return ZkSysIcon;
  }

  if (contractAddress) {
    return null;
  }

  return getKnownSyscoinAsset(assetGuid)?.logo || null;
};

/**
 * Get a token logo without treating an issuer-controlled symbol as identity.
 * @param symbol - Token symbol used only to decide whether a generic fallback is useful
 * @param includePaliLogo - Whether to return Pali logo for unknown tokens (default: true)
 * @param assetGuid - Immutable Syscoin asset identity for UTXO tokens
 * @returns Logo URL or null/undefined
 */
export const getTokenLogo = (
  symbol: string | undefined,
  includePaliLogo = true,
  assetGuid?: number | string
): string | null => {
  const knownLogo = getKnownTokenLogo(symbol, undefined, assetGuid);
  if (knownLogo) return knownLogo;
  if (!symbol) return null;

  return includePaliLogo ? PaliLogo : null;
};

/**
 * Get badge color classes based on token type
 * Supports both EVM and Syscoin token types
 * @param type - The token type/standard (e.g., 'ERC-20', 'ERC-721', 'SPTAllocated', etc.)
 * @param includeBorder - Whether to include border classes (default: false)
 * @returns CSS classes for the token type badge
 */
export const getTokenTypeBadgeColor = (type: string | undefined): string => {
  switch (type?.toLowerCase()) {
    // EVM Token Standards
    case 'erc-20':
      return `bg-blue-500 bg-opacity-80 text-white`;
    case 'erc-721':
      return `bg-purple-500 bg-opacity-80 text-white`;
    case 'erc-1155':
      return `bg-yellow-500 bg-opacity-80 text-white`;
    case 'erc-777':
      return `bg-green-500 bg-opacity-80 text-white`;
    case 'erc-4626':
      return `bg-orange-500 bg-opacity-80 text-white`;

    // Syscoin Token Types
    case 'spt':
    case 'sptallocated':
      return `bg-brand-royalbluemedium bg-opacity-80 text-white`;

    // Default
    default:
      return `bg-gray-500 bg-opacity-80 text-white`;
  }
};
