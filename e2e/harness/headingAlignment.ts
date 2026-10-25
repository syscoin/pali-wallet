import { expect, type Locator } from '@playwright/test';

// Measure painted non-whitespace glyphs. A parent with items-center cannot
// center each wrapped line unless the heading itself aligns its text.
export async function expectCenteredHeadingLines(heading: Locator) {
  await expect(heading).toBeVisible();
  await heading.page().evaluate(() => document.fonts.ready.then(() => undefined));
  const observed = await heading.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const lines = new Map<number, { left: number; right: number }>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent || '';
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          const top = Math.round(rect.top);
          const line = lines.get(top);
          lines.set(top, {
            left: Math.min(line?.left ?? rect.left, rect.left),
            right: Math.max(line?.right ?? rect.right, rect.right),
          });
        }
      }
    }
    const center = (box.left + box.right) / 2;
    return {
      text: element.textContent,
      box: box.toJSON(),
      lines: [...lines.values()].map((line) => ({
        ...line,
        centerOffset: (line.left + line.right) / 2 - center,
      })),
    };
  });
  expect(observed.lines.length).toBeGreaterThan(0);
  for (const line of observed.lines) {
    expect(
      Math.abs(line.centerOffset),
      `painted heading line: ${observed.text}`
    ).toBeLessThanOrEqual(1.5);
  }
  return observed;
}
