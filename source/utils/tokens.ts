import PaliLogo from 'assets/all_assets/favicon-32.png';

/**
 * Get token logo URL based on symbol
 * @param symbol - Token symbol
 * @param includePaliLogo - Whether to return Pali logo for unknown tokens (default: true)
 * @returns Logo URL or null/undefined
 */
export const getTokenLogo = (
  symbol: string | undefined,
  includePaliLogo = true
): string | null => {
  if (!symbol) return null;

  const upperSymbol = symbol.toUpperCase();

  // Special logos for known tokens
  switch (upperSymbol) {
    case 'SYSX':
    case 'SYS':
      return 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/syscoin/info/logo.png';
    case 'BTC':
      return 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/btc.png';
    default:
      return includePaliLogo ? PaliLogo : null;
  }
};

/**
 * Get badge color classes based on token type
 * Supports both EVM and Syscoin token types
 * @param type - The token type/standard (e.g., 'ERC-20', 'ERC-721', 'SPTAllocated', etc.)
 * @param includeBorder - Whether to include border classes (default: false)
 * @returns CSS classes for the token type badge
 */
export const getTokenTypeBadgeColor = (
  type: string | undefined,
  includeBorder = false
): string => {
  const borderSuffix = includeBorder ? ' border-blue-400' : '';
  const borderSuffixPurple = includeBorder ? ' border-purple-400' : '';
  const borderSuffixPink = includeBorder ? ' border-pink-400' : '';
  const borderSuffixGreen = includeBorder ? ' border-green-400' : '';
  const borderSuffixOrange = includeBorder ? ' border-orange-400' : '';
  const borderSuffixGray = includeBorder ? ' border-gray-400' : '';

  switch (type?.toLowerCase()) {
    // EVM Token Standards
    case 'erc-20':
      return `bg-blue-600 text-blue-100${borderSuffix}`;
    case 'erc-721':
      return `bg-purple-600 text-purple-100${borderSuffixPurple}`;
    case 'erc-1155':
      return `bg-pink-600 text-pink-100${borderSuffixPink}`;
    case 'erc-777':
      return `bg-green-600 text-green-100${borderSuffixGreen}`;
    case 'erc-4626':
      return `bg-orange-600 text-orange-100${borderSuffixOrange}`;

    // Syscoin Token Types
    case 'sptallocated':
    case 'spt':
    case 'sptoken':
    case 'syscoin platform token':
      return `bg-blue-600 text-blue-100${borderSuffix}`;
    case 'nft':
      return `bg-purple-600 text-purple-100${borderSuffixPurple}`;

    // Default
    default:
      return `bg-gray-600 text-gray-100${borderSuffixGray}`;
  }
};
