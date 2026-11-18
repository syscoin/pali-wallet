import axios from 'axios';

export const FAUCET_REQUEST_TIMEOUT_MS = 15_000;

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

export const claimFaucet = async (
  chainId: number,
  walletAddress: string,
  signal?: AbortSignal
) => {
  const chainName = getChainName(chainId);
  const cancelled = () =>
    Object.assign(new Error('Faucet request cancelled'), {
      code: 'PALI_FAUCET_CANCELLED',
    });
  if (signal?.aborted) return cancelled();
  const request = new AbortController();
  let rejectWait: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectWait = reject;
  });
  const cancel = () => {
    rejectWait(cancelled());
    request.abort();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    rejectWait(
      Object.assign(new Error('Faucet request timed out'), {
        code: 'PALI_FAUCET_TIMEOUT',
      })
    );
    request.abort();
  }, FAUCET_REQUEST_TIMEOUT_MS);
  try {
    const { data } = await Promise.race([
      axios.get(
        `https://chains.tools/api/faucet/claim?networkKey=${chainName}&walletAddress=${walletAddress}`,
        { timeout: FAUCET_REQUEST_TIMEOUT_MS, signal: request.signal }
      ),
      interrupted,
    ]);
    return data;
  } catch (err) {
    return err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    request.abort();
  }
};

// External fallback faucet portal. The integrated provider is unavailable (#714),
// so we guide users to the official faucet hub which provides updated instructions/links.
export const getExternalFaucetUrl = (): string =>
  // Keep generic to avoid stale deep-links; the faucet hub can route appropriately.
  'https://faucet.syscoin.org';
