import React, { useLayoutEffect, useRef } from 'react';

interface ICustomTokenResultRegionProps {
  children: React.ReactNode;
  isPending: boolean;
  scope: string;
}

/** Keep verification's temporary spinner from shrinking the scroll range. */
export const CustomTokenResultRegion: React.FC<
  ICustomTokenResultRegionProps
> = ({ children, isPending, scope }) => {
  const regionRef = useRef<HTMLDivElement>(null);
  const measuredRef = useRef<{ height?: number; scope: string }>({ scope });
  const completedHeight =
    measuredRef.current.scope === scope
      ? measuredRef.current.height
      : undefined;

  useLayoutEffect(() => {
    if (measuredRef.current.scope !== scope) measuredRef.current = { scope };
    if (isPending || !regionRef.current) return;

    const region = regionRef.current;
    let active = true;
    const measure = () => {
      if (!active) return;
      const height = region.getBoundingClientRect().height;
      if (Number.isFinite(height) && height > 0)
        measuredRef.current = { scope, height };
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(region);
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [isPending, scope]);

  return (
    <div
      ref={regionRef}
      style={isPending ? { minHeight: completedHeight } : undefined}
    >
      {children}
    </div>
  );
};
