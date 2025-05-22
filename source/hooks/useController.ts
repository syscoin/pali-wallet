import { useCallback, useEffect, useMemo, useState } from 'react';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-network';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

// Cache providers to avoid creating multiple instances for the same network
const providerCache = new Map<string, CustomJsonRpcProvider>();

export function useController() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeNetwork, setActiveNetwork] = useState<INetwork | null>(null);
  const [web3Provider, setWeb3Provider] = useState<CustomJsonRpcProvider>({
    serverHasAnError: false,
    errorMessage: '',
  } as CustomJsonRpcProvider);

  const abortController = useMemo(() => new AbortController(), []);

  const fetchControllerData = useCallback(
    async (shouldSetIsLoading = true) => {
      if (shouldSetIsLoading) setIsLoading(true);

      try {
        const network = (await controllerEmitter([
          'wallet',
          'getNetwork',
        ])) as INetwork;

        // Clear provider cache on network change to prevent stale providers
        if (
          activeNetwork &&
          (activeNetwork.url !== network.url ||
            activeNetwork.chainId !== network.chainId)
        ) {
          console.log('Network changed, clearing provider cache');
          providerCache.clear();
        }

        // Check if this is a Bitcoin-based UTXO network with enhanced detection
        const isBitcoinBased =
          network.url.includes('blockbook') ||
          network.url.includes('explorer-blockbook') ||
          network.url.includes('trezor.io') ||
          (network.chainId === 57 &&
            !network.url.includes('rpc.syscoin.org') &&
            !network.url.includes('rpc.tanenbaum.io'));

        // Use cached provider if available for this network URL
        const cacheKey = network.url;
        let walletWeb3Provider = providerCache.get(cacheKey);

        // Only create web3 provider for EVM-compatible networks
        if (!walletWeb3Provider && !isBitcoinBased) {
          console.log(
            `Creating new web3 provider for EVM network: ${network.url}`
          );
          walletWeb3Provider = new CustomJsonRpcProvider(
            abortController.signal,
            network.url
          );
          providerCache.set(cacheKey, walletWeb3Provider);
        } else if (isBitcoinBased) {
          console.log(
            `Skipping web3 provider creation for Bitcoin UTXO network: ${network.url}`
          );
        }

        const isWalletUnlocked = await controllerEmitter(
          ['wallet', 'isUnlocked'],
          []
        );

        setActiveNetwork(network);
        setWeb3Provider(
          walletWeb3Provider ||
            ({
              serverHasAnError: false,
              errorMessage: '',
            } as CustomJsonRpcProvider)
        );
        setIsUnlocked(!!isWalletUnlocked);
      } catch (error) {
        console.error('Error fetching controller data:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [abortController, setIsUnlocked, setIsLoading, activeNetwork]
  );

  useEffect(() => {
    fetchControllerData();

    // Cleanup function should abort requests, not make new ones
    return () => {
      abortController.abort();
    };
  }, [fetchControllerData, abortController]);

  return useMemo(
    () => ({
      isUnlocked,
      web3Provider,
      activeNetwork,
      isLoading,
      controllerEmitter,
    }),
    [isUnlocked, web3Provider, activeNetwork, isLoading, controllerEmitter]
  );
}
