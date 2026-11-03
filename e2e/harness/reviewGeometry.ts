import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  focusRingBands,
  parseFocusRing,
  ringEdgeIsVisible,
} from './focusRingGeometry';

// These observations run after the scenario's native scroll/focus actions.
// They never edit styles, scroll positions, field values or wallet state.
export async function checkReviewHeadingContainment(
  page: Page,
  heading: Locator,
  card: Locator,
  info: TestInfo,
  label: string
) {
  const geometry = await heading.evaluate((element) => {
    const container = element.parentElement?.parentElement;
    if (!container) throw new Error('Review heading card is missing');
    const rect = (node: Element) => {
      const value = node.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
      };
    };
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      heading: rect(element),
      card: rect(container),
      lines: Array.from(range.getClientRects(), (value) => ({
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
      })),
    };
  });
  await expect(card).toBeVisible();
  await info.attach(label, {
    body: await page.screenshot({
      animations: 'disabled',
      mask: [
        page.locator('#import-wallet-input,input[type="password"],textarea'),
      ],
    }),
    contentType: 'image/png',
  });
  const after = await heading.boundingBox();
  const stable = Boolean(
    after &&
      Math.abs(geometry.heading.left - after.x) <= 0.5 &&
      Math.abs(geometry.heading.top - after.y) <= 0.5 &&
      Math.abs(geometry.heading.right - (after.x + after.width)) <= 0.5 &&
      Math.abs(geometry.heading.bottom - (after.y + after.height)) <= 0.5
  );
  const contained =
    geometry.lines.length > 0 &&
    geometry.lines.every(
      (line) =>
        line.left >= geometry.card.left - 0.5 &&
        line.right <= geometry.card.right + 0.5
    );
  await info.attach(`${label}-geometry`, {
    body: JSON.stringify({ geometry, stable, contained }),
    contentType: 'application/json',
  });
  expect.soft(stable, `${label}: stable native screenshot`).toBe(true);
  expect
    .soft(contained, `${label}: all heading lines fit their card`)
    .toBe(true);
}

export async function checkReviewInputFocusRing(
  page: Page,
  input: Locator,
  info: TestInfo,
  label: string
) {
  // Let the input's own native transition settle before measuring its ring.
  // Poll again when a transition is replaced; never finish/cancel or restyle it.
  await expect
    .poll(
      () =>
        input.evaluate((element) =>
          element
            .getAnimations({ subtree: false })
            .some(
              (animation) =>
                animation.pending || animation.playState === 'running'
            )
        ),
      {
        timeout: 30_000,
        message: 'Input focus animation settles within the action budget',
      }
    )
    .toBe(false);
  const geometry = await input.evaluate((element) => {
    const value = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      rect: {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
      },
      boxShadow: style.boxShadow,
      borderTop: parseFloat(style.borderTopWidth) || 0,
      borderBottom: parseFloat(style.borderBottomWidth) || 0,
      focused: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const ring = parseFocusRing(geometry.boxShadow);
  const bands = focusRingBands(geometry, ring);
  const screenshot = await page.screenshot({
    animations: 'disabled',
    mask: [
      page.locator('#import-wallet-input,input[type="password"],textarea'),
    ],
  });
  await info.attach(label, { body: screenshot, contentType: 'image/png' });
  const after = await input.boundingBox();
  const stable = Boolean(
    after &&
      Math.abs(geometry.rect.left - after.x) <= 0.5 &&
      Math.abs(geometry.rect.top - after.y) <= 0.5 &&
      Math.abs(geometry.rect.right - (after.x + after.width)) <= 0.5 &&
      Math.abs(geometry.rect.bottom - (after.y + after.height)) <= 0.5
  );
  const pixels = await page.evaluate(
    async ({
      bytes,
      geometry: captureGeometry,
      ring: captureRing,
      bands: captureBands,
    }) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let bitmap: ImageBitmap | undefined;
      try {
        bitmap = await Promise.race([
          createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: 'image/png' })
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Focus-ring pixel decode deadline')),
              5000
            );
          }),
        ]);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Focus-ring pixel context unavailable');
        context.drawImage(bitmap, 0, 0);
        const scaleX = bitmap.width / captureGeometry.viewport.width;
        const scaleY = bitmap.height / captureGeometry.viewport.height;
        const sample = (top: boolean) => {
          if (!captureRing || !captureBands) return { count: 0, matching: 0 };
          const { start, end } = top ? captureBands.top : captureBands.bottom;
          const left = Math.ceil(captureBands.left * scaleX);
          const right = Math.floor(captureBands.right * scaleX);
          let count = 0,
            matching = 0;
          for (
            let y = Math.ceil(start * scaleY);
            y < Math.floor(end * scaleY);
            y++
          ) {
            for (let x = left; x < right; x++) {
              if (++count > 10000)
                throw new Error('Focus-ring pixel sample limit');
              if (x < 0 || y < 0 || x >= bitmap!.width || y >= bitmap!.height)
                continue;
              const pixel = context.getImageData(x, y, 1, 1).data;
              if (
                pixel[3] === 255 &&
                captureRing.color.every(
                  (value, index) => Math.abs(pixel[index] - value) <= 24
                )
              )
                matching++;
            }
          }
          return { count, matching };
        };
        return { top: sample(true), bottom: sample(false) };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        bitmap?.close();
      }
    },
    { bytes: [...screenshot], geometry, ring, bands }
  );
  const complete =
    geometry.focused &&
    geometry.focusVisible &&
    stable &&
    ringEdgeIsVisible(pixels.top) &&
    ringEdgeIsVisible(pixels.bottom);
  await info.attach(`${label}-geometry`, {
    body: JSON.stringify({ geometry, ring, bands, stable, pixels, complete }),
    contentType: 'application/json',
  });
  // Soft assertions preserve subsequent original Save/Cancel and payload checks.
  expect
    .soft(complete, `${label}: focused ring top and bottom remain painted`)
    .toBe(true);
}
