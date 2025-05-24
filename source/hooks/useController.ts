import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { INetworkWithKind } from 'state/vault/types';

// Cache providers to avoid creating multiple instances for the same network
const providerCache = new Map<string, CustomJsonRpcProvider>();

// Connection health check utility
const isConnectionError = (error: any): boolean => {
  const errorMessage = error?.message || String(error);
  return (
    errorMessage.includes('Could not establish connection') ||
    errorMessage.includes('Receiving end does not exist') ||
    errorMessage.includes('Extension context invalidated')
  );
};

// Health check to ensure background script is ready
const checkBackgroundConnection = async (): Promise<boolean> => {
  try {
    // Try a simple ping to the background script
    await new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('Chrome runtime not available'));
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'ping', target: 'background' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
    return true;
  } catch {
    return false;
  }
};

// Retry helper with exponential backoff
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100
): Promise<T> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries || !isConnectionError(error)) {
        throw error;
      }

      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(
        `Retry attempt ${attempt + 1}/${maxRetries + 1} in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
};

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
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchControllerData = useCallback(
    async (shouldSetIsLoading = true) => {
      if (shouldSetIsLoading) setIsLoading(true);

      try {
        // First, ensure the background script is responsive
        const isConnected = await checkBackgroundConnection();
        if (!isConnected) {
          throw new Error('Background script not responsive');
        }

        const network = (await retryWithBackoff(() =>
          controllerEmitter(['wallet', 'getNetwork'])
        )) as INetworkWithKind;

        // Check network status - don't create providers during switching
        const vaultState = (await retryWithBackoff(() =>
          controllerEmitter(['wallet', 'getState'])
        )) as any;

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
              !!(await retryWithBackoff(() =>
                controllerEmitter(['wallet', 'isUnlocked'], [])
              ))
            );
            setIsLoading(false);
            return; // Exit early, don't create providers during switch
          } else if (networkStatus === 'error') {
            console.log(
              'useController: Resetting network status from error state'
            );
            await retryWithBackoff(() =>
              controllerEmitter(['wallet', 'resetNetworkStatus'], [])
            );
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

        const isWalletUnlocked = await retryWithBackoff(() =>
          controllerEmitter(['wallet', 'isUnlocked'], [])
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

        // If it's a connection error, schedule a retry
        if (
          isConnectionError(error) ||
          error.message === 'Background script not responsive'
        ) {
          console.log(
            'Connection error detected, scheduling retry in 1 second...'
          );
          retryTimeoutRef.current = setTimeout(() => {
            console.log(
              'Retrying fetchControllerData due to connection error...'
            );
            fetchControllerData(false); // Don't show loading on retry
          }, 1000);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [abortController]
  );

  useEffect(() => {
    fetchControllerData();

    // Cleanup function should abort requests and clear timeouts
    return () => {
      abortController.abort();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
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
