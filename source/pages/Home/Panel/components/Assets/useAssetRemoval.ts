import { useEffect, useRef, useState } from 'react';

import { useController } from 'hooks/useController';
import { useRequestScope } from 'hooks/useRequestScope';
import {
  getWalletNavigationScope,
  IWalletNavigationScope,
} from 'utils/navigationState';

export type AssetRemovalStart = () => (error: unknown) => void;

/** Keep local confirmation state separate from the parent's durable-save feedback. */
export const useAssetRemoval = <T>(
  scope: string,
  onStart?: AssetRemovalStart
) => {
  const { controllerEmitter } = useController();
  const assetMutationScope = getWalletNavigationScope();
  const [item, setItem] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const selectedScope = useRef<IWalletNavigationScope | null>(null);
  const begin = useRequestScope(scope);

  const reset = () => {
    busy.current = false;
    setPending(false);
    setItem(null);
    selectedScope.current = null;
  };
  useEffect(reset, [scope]);

  const open = (value: T | null) => {
    if (!busy.current) {
      selectedScope.current = value ? assetMutationScope : null;
      setItem(value);
    }
  };
  const close = () => open(null);
  const remove = (params: unknown[]) => {
    if (!item || busy.current || !selectedScope.current) return;
    const expectedScope = selectedScope.current;
    busy.current = true;
    const current = begin();
    const reportError = onStart?.();
    setPending(true);
    return controllerEmitter(
      ['wallet', 'deleteTokenInfo'],
      [params[0], params[1], params[2], expectedScope]
    )
      .then(
        () => undefined,
        (error) => {
          console.error('Error deleting asset:', error);
          // The stable parent still owns feedback after local last-row removal.
          reportError?.(error);
        }
      )
      .finally(() => {
        if (current()) reset();
      });
  };

  return { item, pending, open, close, remove };
};
