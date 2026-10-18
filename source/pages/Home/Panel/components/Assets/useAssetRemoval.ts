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

  useEffect(() => {
    busy.current = false;
    setPending(false);
    setItem(null);
  }, [scope]);

  const open = (value: T) => {
    if (!busy.current) setItem(value);
  };
  const close = () => {
    if (!busy.current) setItem(null);
  };
  const remove = async (params: unknown[]) => {
    if (!item || busy.current) return;
    busy.current = true;
    const current = begin();
    const reportError = onStart?.();
    setPending(true);
    try {
      await controllerEmitter(['wallet', 'deleteTokenInfo'], params);
    } catch (error) {
      console.error('Error deleting asset:', error);
      // The stable parent remains mounted when local last-row removal has
      // unmounted this list before the persistence promise settles.
      reportError?.(error);
    } finally {
      if (current()) {
        busy.current = false;
        setPending(false);
        setItem(null);
      }
    }
  };

  return { item, pending, open, close, remove };
};
