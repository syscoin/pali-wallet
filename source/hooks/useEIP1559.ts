import { Block } from '@ethersproject/providers';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { verifyNetworkEIP1559Compatibility } from 'utils/network';

// Module-level cache that persists across component mounts
const eip1559Cache = new Map<number, boolean>();

export const useEIP1559 = () => {
  const { controllerEmitter } = useController();
  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );

  // Initialize from cache if available
  const cachedValue = activeNetwork?.chainId
    ? eip1559Cache.get(activeNetwork.chainId)
    : undefined;

  const [isEIP1559Compatible, setIsEIP1559Compatible] = useState<
    boolean | undefined
  >(cachedValue);
  const [isLoading, setIsLoading] = useState(false);
  const [forceRecheckTrigger, setForceRecheckTrigger] = useState(0);

  const forceRecheck = () => {
    if (activeNetwork?.chainId) {
      eip1559Cache.delete(activeNetwork.chainId); // Clear cache
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

      // Skip if we have cached value (unless force rechecking)
      if (
        eip1559Cache.has(activeNetwork.chainId) &&
        forceRecheckTrigger === 0
      ) {
        const cached = eip1559Cache.get(activeNetwork.chainId);
        // Only update if different from current state
        if (cached !== isEIP1559Compatible) {
          setIsEIP1559Compatible(cached);
        }
        return;
      }

      setIsLoading(true);

      try {
        // Always fetch a fresh block for this network's EIP1559 check
        const blockData = await controllerEmitter(
          ['wallet', 'getCurrentBlock'],
          []
        );
        const blockToCheck = blockData as Block;

        const isCompatible = await verifyNetworkEIP1559Compatibility(
          blockToCheck
        );

        // Cache the result
        eip1559Cache.set(activeNetwork.chainId, isCompatible);
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
    forceRecheckTrigger,
    isEIP1559Compatible,
  ]);

  return { isEIP1559Compatible, isLoading, forceRecheck };
};
