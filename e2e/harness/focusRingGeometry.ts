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
