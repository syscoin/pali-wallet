import { ethers } from 'ethers';
import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { verifyNetworkEIP1559Compatibility } from 'utils/network';

// Cache EIP1559 compatibility per chainId
const eip1559Cache = new Map<number, boolean>();

// Export a function to clear cache for a specific chainId
export const clearEIP1559CacheForChain = (chainId: number) => {
  eip1559Cache.delete(chainId);
};

export const useEIP1559 = () => {
  const { controllerEmitter } = useController();
  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const [isEIP1559Compatible, setIsEIP1559Compatible] = useState<
    boolean | undefined
  >(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const lastCheckedChainId = useRef<number | null>(null);
  const [forceRecheckTrigger, setForceRecheckTrigger] = useState(0);

  const forceRecheck = () => {
    if (activeNetwork?.chainId) {
      clearEIP1559CacheForChain(activeNetwork.chainId);
      setIsEIP1559Compatible(undefined); // Reset to trigger loading state
      setForceRecheckTrigger((prev) => prev + 1);
    }
  };

  useEffect(() => {
    const checkEIP1559Compatibility = async () => {
      // Skip for Bitcoin-based networks
      if (isBitcoinBased || !activeNetwork?.chainId) {
        setIsEIP1559Compatible(false);
        return;
      }

      // Check cache first
      if (eip1559Cache.has(activeNetwork.chainId)) {
        setIsEIP1559Compatible(eip1559Cache.get(activeNetwork.chainId));
        return;
      }

      setIsLoading(true);

      try {
        // Always fetch a fresh block for this network's EIP1559 check
        const blockData = await controllerEmitter(
          ['wallet', 'getCurrentBlock'],
          []
        );
        const blockToCheck = blockData as ethers.providers.Block;

        const isCompatible = await verifyNetworkEIP1559Compatibility(
          blockToCheck
        );

        // Cache the result for this chainId
        eip1559Cache.set(activeNetwork.chainId, isCompatible);
        lastCheckedChainId.current = activeNetwork.chainId;

        setIsEIP1559Compatible(isCompatible);
      } catch (error) {
        console.error('Failed to check EIP1559 compatibility:', error);
        setIsEIP1559Compatible(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkEIP1559Compatibility();
  }, [
    activeNetwork?.chainId,
    isBitcoinBased,
    controllerEmitter,
    forceRecheckTrigger,
  ]);

  return { isEIP1559Compatible, isLoading, forceRecheck };
};
