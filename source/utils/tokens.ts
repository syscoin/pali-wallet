import { knownAssetIcon } from '../shared/assetIconIdentity';
import { SYSX_ASSET_GUID } from '../shared/syscoinAssetIds';
import PaliLogo from 'assets/all_assets/favicon-32.png';
import SyscoinIcon from 'assets/all_assets/syscoin.png';
import UsdcIcon from 'assets/all_assets/usdc-icon.svg';
import ZkSysIcon from 'assets/all_assets/zksys-icon.svg';

const SYSCOIN_LOGO_URL =
  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/syscoin/info/logo.png';
const BITCOIN_LOGO_URL =
  'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/btc.png';

export { SYSX_ASSET_GUID } from '../shared/syscoinAssetIds';

interface IKnownSyscoinAsset {
  coinGeckoId: string;
  isVerified: true;
  logo: string;
}

const KNOWN_SYSCOIN_ASSETS: Readonly<Record<string, IKnownSyscoinAsset>> = {
  [SYSX_ASSET_GUID]: {
    coinGeckoId: 'syscoin',
    isVerified: true,
    logo: SyscoinIcon,
  },
};

// Reserved logos previously assigned by symbol. They must not survive on a
// noncanonical SPT if they were persisted by an older wallet build.
const RESERVED_TOKEN_LOGOS = new Set([
  SYSCOIN_LOGO_URL,
  BITCOIN_LOGO_URL,
  SyscoinIcon,
  ZkSysIcon,
  UsdcIcon,
]);

export const getKnownSyscoinAsset = (
  assetGuid?: number | string,
  chainId?: number | string,
  decimals?: number
): IKnownSyscoinAsset | null => {
  if (
    assetGuid === undefined ||
    assetGuid === null ||
    chainId === undefined ||
    knownAssetIcon({
      kind: 'spt',
      chainId,
      assetGuid,
      ...(decimals === undefined ? {} : { decimals }),
    }) !== 'syscoin'
  )
    return null;

  return KNOWN_SYSCOIN_ASSETS[String(assetGuid)] || null;
};

export const sanitizeUtxoTokenLogo = (
  logo: string | undefined,
  assetGuid?: number | string,
  chainId?: number | string,
  decimals?: number
): string | undefined =>
  sanitizeTokenLogo(logo, undefined, assetGuid, chainId, decimals);

export const sanitizeTokenLogo = (
  logo: string | undefined,
  contractAddress?: string,
  assetGuid?: number | string,
  chainId?: number | string,
  decimals?: number
): string | undefined => {
  if (!logo) return logo;
  if (
    getKnownTokenLogo(
      undefined,
      contractAddress,
      assetGuid,
      chainId,
      decimals
    ) === logo
  )
    return logo;
  return RESERVED_TOKEN_LOGOS.has(logo) ? undefined : logo;
};

export const getKnownTokenLogo = (
  _symbol?: string,
  contractAddress?: string,
  assetGuid?: number | string,
  chainId?: number | string,
  decimals?: number
): string | null => {
  if (chainId === undefined) return null;
  const known = contractAddress
    ? knownAssetIcon({
        kind: 'evm',
        chainId,
        contractAddress,
        ...(decimals === undefined ? {} : { decimals }),
      })
    : assetGuid !== undefined
    ? knownAssetIcon({
        kind: 'spt',
        chainId,
        assetGuid,
        ...(decimals === undefined ? {} : { decimals }),
      })
    : null;
  return known === 'zksys'
    ? ZkSysIcon
    : known === 'syscoin'
    ? SyscoinIcon
    : known === 'usdc'
    ? UsdcIcon
    : null;
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
  assetGuid?: number | string,
  chainId?: number | string,
  decimals?: number
): string | null => {
  const knownLogo = getKnownTokenLogo(
    symbol,
    undefined,
    assetGuid,
    chainId,
    decimals
  );
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
      return `bg-yellow-500 bg-opacity-80 text-black`;
    case 'erc-777':
      return `bg-green-500 bg-opacity-80 text-black`;
    case 'erc-4626':
      return `bg-orange-500 bg-opacity-80 text-black`;

    // Syscoin Token Types
    case 'spt':
    case 'sptallocated':
      return `bg-brand-royalbluemedium bg-opacity-80 text-black`;

    // Default
    default:
      return `bg-gray-500 bg-opacity-80 text-white`;
  }
};
