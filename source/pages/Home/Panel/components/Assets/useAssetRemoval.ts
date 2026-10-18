import { useEffect, useRef, useState } from 'react';

import { useController } from 'hooks/useController';
import { useRequestScope } from 'hooks/useRequestScope';

export type AssetRemovalStart = () => (error: unknown) => void;

/** Keep local confirmation state separate from the parent's durable-save feedback. */
export const useAssetRemoval = <T>(
  scope: string,
  onStart?: AssetRemovalStart
) => {
  const { controllerEmitter } = useController();
  const [item, setItem] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const begin = useRequestScope(scope);

  const reset = () => {
    busy.current = false;
    setPending(false);
    setItem(null);
  };
  useEffect(reset, [scope]);

  const open = (value: T | null) => {
    if (!busy.current) setItem(value);
  };
  const close = () => open(null);
  const remove = (params: unknown[]) => {
    if (!item || busy.current) return;
    busy.current = true;
    const current = begin();
    const reportError = onStart?.();
    setPending(true);
    return controllerEmitter(['wallet', 'deleteTokenInfo'], params)
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
