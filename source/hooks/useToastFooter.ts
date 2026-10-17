import { useLayoutEffect, useRef } from 'react';

import { registerToastFooter } from 'utils/toastFooterClearance';

export const useToastFooter = <T extends HTMLElement = HTMLDivElement>({
  includeInFlow = false,
}: { includeInFlow?: boolean } = {}) => {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (ref.current) return registerToastFooter(ref.current, { includeInFlow });
    return undefined;
  }, [includeInFlow]);
  return ref;
};
