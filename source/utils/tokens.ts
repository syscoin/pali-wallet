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
