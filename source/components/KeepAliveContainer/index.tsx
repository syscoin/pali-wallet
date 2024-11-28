import { useEffect, useRef } from 'react';

import { keepSWAlive } from 'scripts/Background/utils/keepSWAAlive';

export const KeepAliveContainer = () => {
  const timer = useRef<undefined | NodeJS.Timer>(undefined);

  useEffect(() => {
    if (!timer.current) {
      timer.current = setInterval(keepSWAlive, 1000);
    }
  }, []);

  return null;
};
