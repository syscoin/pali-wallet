import React, { useLayoutEffect } from 'react';

import { useToastFooter } from 'hooks/useToastFooter';

interface IPageActionFooterProps {
  children: React.ReactNode;
  className?: string;
  error?: React.ReactNode;
}

/** Bottom-aligned page action and feedback, with in-flow space when scrolling. */
export const PageActionFooter = ({
  children,
  className = '',
  error,
}: IPageActionFooterProps) => {
  const footerRef = useToastFooter();
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const layout = footer?.closest<HTMLElement>(
      '[data-navigation-scroll="wallet-layout"]'
    );
    if (!footer || !layout) return;

    // Native keyboard focus must scroll fields above the sticky action area,
    // including when translated feedback changes its height.
    const property = '--wallet-page-action-height';
    const previous = layout.style.getPropertyValue(property);
    let assigned = '';
    const measure = () => {
      assigned = `${Math.ceil(footer.getBoundingClientRect().height)}px`;
      layout.style.setProperty(property, assigned);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(footer);
    return () => {
      observer?.disconnect();
      if (layout.style.getPropertyValue(property) === assigned) {
        if (previous) layout.style.setProperty(property, previous);
        else layout.style.removeProperty(property);
      }
    };
  }, []);

  return (
    <div
      ref={footerRef}
      data-page-action-footer
      className={`page-action-footer w-full shrink-0 px-4 ${className}`}
    >
      {error && (
        <p role="alert" className="mb-4 text-sm text-content-error">
          {error}
        </p>
      )}
      {children}
    </div>
  );
};
