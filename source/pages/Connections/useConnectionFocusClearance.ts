import { useLayoutEffect, useRef } from 'react';

/** Keep native account focus above this approval's fixed actions only. */
export const useConnectionFocusClearance = () => {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const footer = root?.querySelector<HTMLElement>(
      '[data-connection-actions]'
    );
    const layout = root?.closest<HTMLElement>(
      '[data-navigation-scroll="wallet-layout"]'
    );
    if (!footer || !layout) return;

    const property = 'scroll-padding-bottom';
    const previous = layout.style.getPropertyValue(property);
    const previousPriority = layout.style.getPropertyPriority(property);
    let assigned = '';
    let active = true;
    const measure = () => {
      if (!active) return;
      layout.style.setProperty(
        property,
        `calc(${Math.ceil(footer.getBoundingClientRect().height)}px + 1rem)`
      );
      assigned = layout.style.getPropertyValue(property);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(footer);
    window.addEventListener('resize', measure);

    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (
        layout.style.getPropertyValue(property) === assigned &&
        layout.style.getPropertyPriority(property) === ''
      ) {
        if (previous)
          layout.style.setProperty(property, previous, previousPriority);
        else layout.style.removeProperty(property);
      }
    };
  }, []);

  return rootRef;
};
