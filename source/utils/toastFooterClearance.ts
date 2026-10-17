const property = '--pali-toast-footer-clearance';
const footers = new Map<HTMLElement, boolean>();
let observer: ResizeObserver | undefined;
let frame: number | undefined;
let previous = '';
let assigned = '';

const measure = () => {
  if (!footers.size) return;
  let clearance = 0;
  for (const [footer, includeInFlow] of footers) {
    if (!footer.isConnected) continue;
    const style = getComputedStyle(footer);
    if (
      (!includeInFlow && !['fixed', 'sticky'].includes(style.position)) ||
      style.display === 'none' ||
      style.visibility !== 'visible' ||
      Number(style.opacity) === 0
    )
      continue;
    const rect = footer.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.top >= innerHeight ||
      rect.right <= 0 ||
      rect.left >= innerWidth
    )
      continue;
    clearance = Math.max(clearance, innerHeight - Math.max(0, rect.top));
  }
  assigned = `${Math.ceil(clearance)}px`;
  const rootStyle = document.documentElement.style;
  if (rootStyle.getPropertyValue(property) !== assigned)
    rootStyle.setProperty(property, assigned);
};

const schedule = () => {
  if (!footers.size || frame !== undefined) return;
  frame = requestAnimationFrame(() => {
    frame = undefined;
    measure();
  });
};

/** Track only explicitly registered action rows, never scan the page. */
export const registerToastFooter = (
  footer: HTMLElement,
  { includeInFlow = false }: { includeInFlow?: boolean } = {}
) => {
  if (!footers.size) {
    previous = document.documentElement.style.getPropertyValue(property);
    observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
  }
  footers.set(footer, includeInFlow);
  observer?.observe(footer);
  measure();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    footers.delete(footer);
    observer?.unobserve(footer);
    if (footers.size) {
      measure();
      return;
    }
    observer?.disconnect();
    observer = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('animationend', schedule, true);
    const rootStyle = document.documentElement.style;
    if (rootStyle.getPropertyValue(property) === assigned) {
      if (previous) rootStyle.setProperty(property, previous);
      else rootStyle.removeProperty(property);
    }
  };
};
