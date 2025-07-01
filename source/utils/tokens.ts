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
