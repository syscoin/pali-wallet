import axios from 'axios';

const getChainName = (chainId: number): string => {
  switch (chainId) {
    case 57:
      return 'nevm-mainnet';
    case 5700:
      return 'nevm-testnet';
    case 57000:
      return 'rollux-testnet';
    case 570:
      return 'rollux-mainnet';
    default:
      return '';
  }
};

export const claimFaucet = async (chainId: number, walletAddress: string) => {
  const chainName = getChainName(chainId);

  try {
    const { data } = await axios.get(
      `https://chains.tools/api/faucet/claim?networkKey=${chainName}&walletAddress=${walletAddress}`
    );
    return data;
  } catch (err) {
    return err;
  }
};

// External fallback faucet portal. The integrated provider is unavailable (#714),
// so we guide users to the official faucet hub which provides updated instructions/links.
export const getExternalFaucetUrl = (): string =>
  // Keep generic to avoid stale deep-links; the faucet hub can route appropriately.
  'https://faucet.syscoin.org';
