import type { Locator } from '@playwright/test';

export type FocusRing = { color: number[]; inset: boolean; spread: number };
export type FocusBox = {
  borderBottom: number;
  borderTop: number;
  rect: { bottom: number; left: number; right: number; top: number };
};

// Chrome's computed box-shadow may serialize inset before or after the color.
// Ignore transparent offset layers and blurred shadows; neither is the ring.
export function parseFocusRing(boxShadow: string): FocusRing | null {
  const candidates: FocusRing[] = [];
  const pattern =
    /(inset\s+)?rgba?\(([^)]+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px(?:\s+(inset))?/g;
  for (const match of boxShadow.matchAll(pattern)) {
    const color = match[2]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    const [x, y, blur, spread] = match.slice(3, 7).map(Number);
    if (
      color.length >= 3 &&
      color
        .slice(0, 3)
        .every((n) => Number.isFinite(n) && n >= 0 && n <= 255) &&
      (color[3] ?? 1) === 1 &&
      x === 0 &&
      y === 0 &&
      blur === 0 &&
      spread >= 1 &&
      spread <= 8
    )
      candidates.push({
        color: color.slice(0, 3),
        spread,
        inset: Boolean(match[1] || match[7]),
      });
  }
  candidates.sort((a, b) => b.spread - a.spread);
  return candidates[0] ?? null;
}

export function focusRingBands(box: FocusBox, ring: FocusRing | null) {
  if (!ring) return null;
  const { rect } = box;
  if (
    ![
      rect.left,
      rect.right,
      rect.top,
      rect.bottom,
      box.borderTop,
      box.borderBottom,
    ].every(Number.isFinite) ||
    rect.right - rect.left <= 16 ||
    rect.bottom <= rect.top
  )
    return null;
  const top = rect.top + (ring.inset ? box.borderTop : -ring.spread);
  const bottom =
    rect.bottom - (ring.inset ? box.borderBottom + ring.spread : 0);
  return {
    left: rect.left + 8,
    right: rect.right - 8,
    top: { start: top, end: top + ring.spread },
    bottom: { start: bottom, end: bottom + ring.spread },
  };
}

export function ringEdgeIsVisible(edge: { count: number; matching: number }) {
  return (
    Number.isInteger(edge.count) &&
    Number.isInteger(edge.matching) &&
    edge.count > 0 &&
    edge.count <= 10000 &&
    edge.matching >= 0 &&
    edge.matching <= edge.count &&
    edge.matching / edge.count >= 0.9
  );
}
// Compare the actual keyboard-focus ring with the opaque surface it borders.
export async function focusRingContrast(control: Locator) {
  const paint = await control.evaluate(async (element) => {
    const ancestry: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement)
      ancestry.push(node);
    const finiteAnimations = ancestry.flatMap((node) =>
      node.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return (
          animation.playState === 'running' &&
          timing !== undefined &&
          Number.isFinite(timing.iterations) &&
          Number.isFinite(timing.endTime)
        );
      })
    );
    await Promise.all(
      finiteAnimations.map((animation) =>
        animation.finished.catch(() => undefined)
      )
    );
    let parent = element.parentElement;
    let background = '';
    const nonOpaque = ancestry.flatMap((node) => {
      const opacity = getComputedStyle(node).opacity;
      return opacity === '1'
        ? []
        : [{ tag: node.tagName, id: node.id, opacity }];
    });
    while (parent) {
      const style = getComputedStyle(parent);
      const color = style.backgroundColor;
      if (
        !background &&
        color !== 'transparent' &&
        color !== 'rgba(0, 0, 0, 0)'
      ) {
        background = color;
      }
      parent = parent.parentElement;
    }
    return {
      focused:
        document.activeElement === element && element.matches(':focus-visible'),
      shadow: getComputedStyle(element).boxShadow,
      background,
      nonOpaque,
    };
  });
  const ring = parseFocusRing(paint.shadow);
  const match = paint.background.match(/^rgba?\(([^)]+)\)$/);
  const channels = match?.[1]
    .split(/[ ,/]+/)
    .filter(Boolean)
    .map(Number);
  if (
    !paint.focused ||
    paint.nonOpaque.length > 0 ||
    !ring ||
    ring.inset ||
    !channels ||
    channels.length < 3 ||
    (channels[3] ?? 1) !== 1 ||
    channels.slice(0, 3).some((v) => !Number.isFinite(v))
  ) {
    throw new Error(
      `Cannot measure focused ring against an opaque background: ${JSON.stringify(
        paint
      )}`
    );
  }
  const luminance = (rgb: number[]) =>
    rgb.slice(0, 3).reduce((sum, value, i) => {
      const channel = value / 255;
      return (
        sum +
        (channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4) *
          [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  const [low, high] = [luminance(ring.color), luminance(channels)].sort(
    (a, b) => a - b
  );
  return (high + 0.05) / (low + 0.05);
}
