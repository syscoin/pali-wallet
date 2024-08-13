import { useCallback, useEffect, useMemo, useState } from 'react';

import controllerEmitter from 'scripts/Background/controllers/controllerEmitter';

export function useController() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchIsUnlocked = useCallback(async () => {
    // setIsLoading(true);

    const response = await controllerEmitter(['wallet', 'isUnlocked'], []);

    setIsUnlocked(!!response);

    setIsLoading(false);
  }, [setIsUnlocked, setIsLoading, controllerEmitter]);

  useEffect(() => {
    fetchIsUnlocked();

    return () => {
      fetchIsUnlocked();
    };
  }, []);

  return useMemo(
    () => ({ isUnlocked, isLoading, controllerEmitter }),
    [isUnlocked, isLoading, controllerEmitter]
  );
}
