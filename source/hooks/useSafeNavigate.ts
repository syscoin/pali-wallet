import { startTransition, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Custom navigation hook that wraps navigation in startTransition
 * to prevent synchronous loading errors with lazy-loaded components
 */
export function useSafeNavigate() {
  const navigate = useNavigate();

  const safeNavigate = useCallback(
    (to: string | number, options?: any) => {
      startTransition(() => {
        if (typeof to === 'number') {
          navigate(to);
        } else {
          navigate(to, options);
        }
      });
    },
    [navigate]
  );

  return safeNavigate;
}
