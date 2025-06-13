import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';

export function useController() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  useEffect(() => {
    // Check unlock status once
    controllerEmitter(['wallet', 'isUnlocked'], [])
      .then((unlocked) => {
        console.log('useController isUnlocked', unlocked);
        setIsUnlocked(!!unlocked);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  return useMemo(
    () => ({
      isUnlocked,
      activeNetwork,
      isLoading,
      controllerEmitter,
    }),
    [isUnlocked, activeNetwork, isLoading]
  );
}
