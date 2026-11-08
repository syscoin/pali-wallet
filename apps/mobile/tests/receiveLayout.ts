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

export async function expectReceiveFooter(page: Page, address: Locator, qr: Locator) {
  await address.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(address).toBeInViewport({ ratio: 1 });
  const before = await address.boundingBox();
  const bodyScrolled = await qr.evaluate((element) => {
    let scroll = element.parentElement;
    while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
    if (!scroll) throw Error('Receive body has no scroll container');
    scroll.scrollTop = scroll.scrollHeight;
    return scroll.scrollTop;
  });
  expect(bodyScrolled).toBeGreaterThanOrEqual(0);
  expect((await address.boundingBox())!.y).toBeCloseTo(before!.y, 1);
  await expect(address).toBeInViewport({ ratio: 1 });
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
