import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

const BASELINE = '38721aec5266a3330749751c9694f8b139af60f1';

// Read-only DOM measurements and genuine pointer events. No DOM focus/blur,
// scroll setters, input events, controller overrides or image mutation.
export async function inspectValidationSuffix(
  page: Page,
  input: Locator,
  info: TestInfo,
  label: string
) {
  const mode = process.env.PALI_VALIDATION_SUFFIX_MODE || 'after';
  expect(['before', 'after']).toContain(mode);
  if (process.env.CI) expect(mode).toBe('after');
  if (mode === 'before')
    expect(process.env.PALI_TEST_DAPP_REVISION).toBe(BASELINE);
  await expect(input).toBeEnabled();
  const value = await input.inputValue();
  const name = label.replace(/[^a-z0-9-]/gi, '-');
  const read = () =>
    input.evaluate((node) => {
      const field = node as HTMLInputElement;
      const suffix = field.nextElementSibling as HTMLElement | null;
      if (!suffix || suffix.tagName !== 'DIV')
        throw new Error(
          'Expected the real decorative suffix next to this input'
        );
      if (suffix.querySelector('button,a,input,select,textarea,[tabindex]'))
        throw new Error('This probe must not target an interactive suffix');
      const box = field.getBoundingClientRect();
      const icon = suffix.getBoundingClientRect();
      const point = { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      let owner = field.parentElement;
      while (
        owner &&
        !(
          /auto|scroll/.test(getComputedStyle(owner).overflowY) &&
          owner.scrollHeight > owner.clientHeight + 1
        )
      )
        owner = owner.parentElement;
      const clip = owner?.getBoundingClientRect();
      return {
        field: { x: box.x, y: box.y, width: box.width, height: box.height },
        suffix: {
          x: icon.x,
          y: icon.y,
          width: icon.width,
          height: icon.height,
        },
        point,
        fieldId: field.id,
        fieldTitle: field.getAttribute('title'),
        suffixTitles: Array.from(suffix.querySelectorAll('[title]'))
          .map((element) => element.getAttribute('title'))
          .filter((title): title is string => title !== null),
        value: field.value,
        focused: document.activeElement === field,
        hit: { tag: hit?.tagName, role: hit?.getAttribute('role') },
        hitIsInput: hit === field,
        pointerEvents: getComputedStyle(suffix).pointerEvents,
        iconText: suffix.textContent,
        viewport: { width: innerWidth, height: innerHeight },
        scroll: owner
          ? {
              x: (clip?.x || 0) + owner.clientWidth - 4,
              y: Math.max(
                8,
                Math.min(
                  innerHeight - 8,
                  (clip?.y || 0) + owner.clientHeight / 2
                )
              ),
              top: Math.max(0, clip!.top),
              bottom: Math.min(innerHeight, clip!.bottom),
              scrollTop: owner.scrollTop,
            }
          : null,
      };
    });
  const settle = async () => {
    let previous = '',
      repeats = 0;
    await expect
      .poll(
        async () => {
          const current = await read();
          const key = JSON.stringify([
            current.field,
            current.suffix,
            current.scroll?.scrollTop,
          ]);
          repeats = key === previous ? repeats + 1 : 0;
          previous = key;
          return repeats >= 2;
        },
        { intervals: [50], timeout: 4000 }
      )
      .toBe(true);
  };
  // Center using the existing scroll owner and ordinary wheel input. The same
  // gesture sequence runs before and after the product fix.
  const reveal = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await read();
      if (!current.scroll) break;
      const center = current.field.y + current.field.height / 2;
      const target = (current.scroll.top + current.scroll.bottom) / 2;
      const delta = Math.round(center - target);
      if (Math.abs(delta) <= 2) break;
      const oldTop = current.scroll.scrollTop;
      await page.mouse.move(current.scroll.x, current.scroll.y);
      await page.mouse.wheel(0, delta);
      await settle();
      if ((await read()).scroll?.scrollTop === oldTop) break;
    }
    await settle();
    const current = await read();
    expect(current.field.y).toBeGreaterThanOrEqual(0);
    expect(current.field.y + current.field.height).toBeLessThanOrEqual(
      current.viewport.height
    );
    expect(current.suffix.width).toBeGreaterThan(0);
    expect(current.suffix.height).toBeGreaterThan(0);
    return current;
  };
  const capture = async (kind: string) => {
    await settle();
    await page.mouse.move(0, 0);
    await info.attach(`${mode}-${name}-${kind}-screen`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    await info.attach(`${mode}-${name}-${kind}-field`, {
      body: await input.locator('..').screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
  };

  let geometry = await reveal();
  // The 2px gutter is outside every tested control. Click, never DOM-blur.
  await page.mouse.click(2, 2);
  await expect(input).not.toBeFocused();
  await page.mouse.click(
    geometry.field.x + 20,
    geometry.field.y + geometry.field.height / 2
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(value);
  const textControl = await read();
  await capture('text-click-control');

  geometry = await reveal();
  await page.mouse.click(2, 2);
  await expect(input).not.toBeFocused();
  const beforeClick = await read();
  await page.mouse.click(geometry.point.x, geometry.point.y);
  if (mode === 'before') await expect(input).not.toBeFocused();
  else await expect(input).toBeFocused();
  await expect(input).toHaveValue(value);
  const afterClick = await read();
  expect(beforeClick.hitIsInput).toBe(mode === 'after');
  if (mode === 'after') {
    if (afterClick.suffixTitles.length) {
      expect(new Set(afterClick.suffixTitles).size).toBe(1);
      expect(afterClick.fieldTitle).toBe(afterClick.suffixTitles[0]);
    } else {
      expect(afterClick.fieldTitle).toBeNull();
    }
  }
  await capture('suffix-click');
  await info.attach(`${mode}-${name}-pointer-evidence`, {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        sourceRevision: process.env.PALI_TEST_DAPP_REVISION,
        mode,
        textControl,
        beforeClick,
        afterClick,
        nativePointerOnly: true,
        focusSetterUsed: false,
        scrollSetterUsed: false,
        inputValueChanged: false,
      },
      null,
      2
    ),
  });
}
