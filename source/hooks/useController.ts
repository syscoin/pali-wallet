import { useCallback, useEffect, useMemo, useState } from 'react';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-network';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
// import { rehydrateStore } from 'state/rehydrate';
// import store from 'state/store';

export function useController() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeNetwork, setActiveNetwork] = useState<INetwork | null>(null);
  const [web3Provider, setWeb3Provider] = useState<CustomJsonRpcProvider>({
    serverHasAnError: false,
    errorMessage: '',
  } as CustomJsonRpcProvider);

  const abortController = new AbortController();

  const fetchControllerData = useCallback(
    async (shouldSetIsLoading = true) => {
      if (shouldSetIsLoading) setIsLoading(true);

      const network = (await controllerEmitter([
        'wallet',
        'getNetwork',
      ])) as INetwork;

      const _web3Provider = new CustomJsonRpcProvider(
        abortController.signal,
        network.url
      );

      const _isUnlocked = await controllerEmitter(['wallet', 'isUnlocked'], []);

      setActiveNetwork(network);

      setWeb3Provider(_web3Provider);

      setIsUnlocked(!!_isUnlocked);

      setIsLoading(false);
    },
    [setIsUnlocked, web3Provider, setIsLoading, controllerEmitter]
  );

  useEffect(() => {
    fetchControllerData();

    return () => {
      fetchControllerData();
    };
  }, []);

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
