import { useEffect, useRef } from 'react';

/** A reply may update UI only while its account/network and request are current. */
export const useRequestScope = (context: string) => {
  const scope = useRef({ context, request: 0 });
  if (scope.current.context !== context) {
    scope.current = { context, request: scope.current.request + 1 };
  }
  useEffect(
    () => () => {
      scope.current.request += 1;
    },
    []
  );

  return () => {
    const request = ++scope.current.request;
    const requestContext = scope.current.context;
    return () =>
      scope.current.request === request &&
      scope.current.context === requestContext;
  };
};
