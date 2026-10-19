import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { Block } from 'utils/ethersV6Compat';
import { verifyNetworkEIP1559Compatibility } from 'utils/network';

// Module-level cache that persists across component mounts
const eip1559Cache = new Map<string, boolean>();

export const useEIP1559 = () => {
  const { controllerEmitter } = useController();
  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );

  const scope = JSON.stringify([
    activeNetwork?.kind,
    activeNetwork?.chainId,
    activeNetwork?.url,
  ]);
  const applicable = !isBitcoinBased && Boolean(activeNetwork?.chainId);
  const cachedValue = applicable ? eip1559Cache.get(scope) : false;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestRevision = useRef(0);
  const [result, setResult] = useState({
    scope,
    value: cachedValue,
    isLoading: false,
  });
  const [forceRecheckTrigger, setForceRecheckTrigger] = useState(0);

  const forceRecheck = () => {
    if (applicable) {
      eip1559Cache.delete(scope);
      // Invalidate a response even before the next effect commits.
      requestRevision.current += 1;
      setResult({ scope, value: undefined, isLoading: true });
      setForceRecheckTrigger((prev) => prev + 1);
    }
  };

  useEffect(() => {
    let current = true;
    const revision = ++requestRevision.current;
    const isCurrent = () =>
      current &&
      scopeRef.current === scope &&
      requestRevision.current === revision;
    const checkEIP1559Compatibility = async () => {
      // Skip for Bitcoin-based networks
      if (!applicable) {
        setResult({ scope, value: false, isLoading: false });
        return;
      }

      if (eip1559Cache.has(scope)) {
        setResult({ scope, value: eip1559Cache.get(scope), isLoading: false });
        return;
      }

      setResult({ scope, value: undefined, isLoading: true });

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

        if (!isCurrent()) return;
        eip1559Cache.set(scope, isCompatible);
        setResult({ scope, value: isCompatible, isLoading: false });
      } catch (error) {
        if (!isCurrent()) return;
        console.error('Failed to check EIP1559 compatibility:', error);
        setResult({ scope, value: false, isLoading: false });
      }
    };

    checkEIP1559Compatibility();
    return () => {
      current = false;
    };
  }, [scope, applicable, forceRecheckTrigger]);

  // A new endpoint must never render the previous endpoint's fee mode while
  // waiting for its effect. A matching endpoint cache remains immediately usable.
  return {
    isEIP1559Compatible: result.scope === scope ? result.value : cachedValue,
    isLoading:
      result.scope === scope ? result.isLoading : cachedValue === undefined,
    forceRecheck,
  };
};
