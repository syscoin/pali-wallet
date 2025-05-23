import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { INetworkWithKind } from 'state/vault/types';

// Cache providers to avoid creating multiple instances for the same network
const providerCache = new Map<string, CustomJsonRpcProvider>();

export function useController() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeNetwork, setActiveNetwork] = useState<INetworkWithKind | null>(
    null
  );
  const [web3Provider, setWeb3Provider] = useState<CustomJsonRpcProvider>({
    serverHasAnError: false,
    errorMessage: '',
  } as CustomJsonRpcProvider);

  // Use ref to track previous network without causing re-renders
  const previousNetworkRef = useRef<INetworkWithKind | null>(null);
  const abortController = useMemo(() => new AbortController(), []);

  const fetchControllerData = useCallback(
    async (shouldSetIsLoading = true) => {
      if (shouldSetIsLoading) setIsLoading(true);

      try {
        const network = (await controllerEmitter([
          'wallet',
          'getNetwork',
        ])) as INetworkWithKind;

        // Check network status - don't create providers during switching
        const vaultState = (await controllerEmitter([
          'wallet',
          'getState',
        ])) as any;

        // Add timeout - if stuck in switching for too long, reset and continue
        const networkStatus = vaultState.vault.networkStatus;
        if (networkStatus !== 'idle') {
          console.log(
            `useController: Network status is '${networkStatus}', checking if we can proceed...`
          );

          // For switching state, don't create new providers - let MainController handle it
          if (networkStatus === 'switching') {
            console.log(
              'useController: Network is switching, using existing provider and waiting...'
            );
            setActiveNetwork(network);
            setIsUnlocked(
              !!(await controllerEmitter(['wallet', 'isUnlocked'], []))
            );
            setIsLoading(false);
            return; // Exit early, don't create providers during switch
          } else if (networkStatus === 'error') {
            console.log(
              'useController: Resetting network status from error state'
            );
            await controllerEmitter(['wallet', 'resetNetworkStatus'], []);
          }
        }

        // Clear provider cache on network change to prevent stale providers
        const previousNetwork = previousNetworkRef.current;
        if (
          previousNetwork &&
          (previousNetwork.url !== network.url ||
            previousNetwork.chainId !== network.chainId)
        ) {
          console.log('Network changed, clearing provider cache');
          providerCache.clear();
        }

        // Update the ref for next comparison
        previousNetworkRef.current = network;

        // Check network kind for provider creation
        const networkKind = network.kind;
        const isUtxoNetwork = networkKind === 'utxo';

        // Use cached provider if available for this network URL
        const cacheKey = network.url;
        let walletWeb3Provider = providerCache.get(cacheKey);

        // Only create web3 provider for EVM-compatible networks
        if (!walletWeb3Provider && !isUtxoNetwork) {
          console.log(
            `Creating new web3 provider for EVM network: ${network.url}`
          );
          walletWeb3Provider = new CustomJsonRpcProvider(
            abortController.signal,
            network.url
          );
          providerCache.set(cacheKey, walletWeb3Provider);
        } else if (isUtxoNetwork) {
          console.log(
            `Skipping web3 provider creation for UTXO network: ${network.url}`
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
    [abortController]
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
