import { expect, type Locator, type Page } from '@playwright/test';

export const receiveViewports = [
  { width: 320, height: 568 },
  { width: 320, height: 600 },
  { width: 390, height: 844 },
  { width: 320, height: 360 },
];

/** Change rendered text metrics; Dimensions.fontScale remains untouched. */
export async function scaleReceiveText(page: Page, scale: number) {
  await page.evaluate((factor) => {
    const metrics = Array.from(document.querySelectorAll<HTMLElement>('[dir="auto"]'))
      .filter((element) => !element.hasAttribute('data-receive-scaled'))
      .map((element) => {
        const style = getComputedStyle(element);
        return { element, size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      });
    for (const { element, size, line } of metrics) {
      element.setAttribute('data-receive-scaled', 'true');
      element.style.fontSize = `${size * factor}px`;
      if (Number.isFinite(line)) element.style.lineHeight = `${line * factor}px`;
    }
  }, scale);
}

/** Browser scroll offsets round to whole pixels even when scaled text has fractional bounds. */
export async function expectReceiveAddressVisible(address: Locator) {
  await expect(address).toBeInViewport({ ratio: 0.99 });
  const clipped = await address.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    let top = 0, left = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
      if (/(auto|scroll|hidden)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
    }
    return Math.max(0, top - bounds.top, bounds.bottom - bottom, left - bounds.left, bounds.right - right);
  });
  expect(clipped).toBeLessThanOrEqual(1);
}

export async function expectReceiveFooter(page: Page, address: Locator, qr: Locator) {
  await address.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expectReceiveAddressVisible(address);
  // The address belongs beside the QR in the scrollable body. Only the
  // action footer stays fixed while that body scrolls.
  const controls = ['Copy address', 'Share address'].map((name) => page.getByRole('button', { name, exact: true }));
  const before = await Promise.all(controls.map((button) => button.boundingBox()));
  const bodyScrolled = await qr.evaluate((element) => {
    let scroll = element.parentElement;
    while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
    if (!scroll) throw Error('Receive body has no scroll container');
    scroll.scrollTop = scroll.scrollHeight;
    return scroll.scrollTop;
  });
  expect(bodyScrolled).toBeGreaterThanOrEqual(0);
  for (let index = 0; index < controls.length; index++) {
    const after = await controls[index]!.boundingBox();
    expect(after).not.toBeNull();
    expect(before[index]).not.toBeNull();
    expect(after!.y).toBeCloseTo(before[index]!.y, 1);
  }
  await address.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expectReceiveAddressVisible(address);
  for (const name of ['Copy address', 'Share address']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
