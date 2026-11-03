import { expect, type Page, type TestInfo } from '@playwright/test';

// Called only on the synthetic Sentry authority popup. Move the actual outer
// scroller with wheel events; never change styles, scrollTop, focus or values
// through page.evaluate. The existing journey still performs all signatures.
export async function expectContainedSentryPasswordFocus(
  page: Page,
  info: TestInfo
) {
  const password = page.getByLabel('Wallet password', { exact: true });
  const originalViewport = page.viewportSize();
  const observations = [];
  const read = () =>
    password.evaluate((input: HTMLInputElement) => {
      const footer = document.querySelector<HTMLElement>(
        '[data-page-action-footer]'
      );
      const scroller = input.closest<HTMLElement>(
        '[data-navigation-scroll="wallet-layout"]'
      );
      if (!footer || !scroller)
        throw new Error('Sentry footer/scroller missing');
      const box = (element: Element) => {
        const r = element.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const field = box(input),
        action = box(footer),
        pane = box(scroller);
      const style = getComputedStyle(input);
      const outlineWidth = parseFloat(style.outlineWidth);
      const outlineOffset = parseFloat(style.outlineOffset);
      const overlap =
        Math.min(field.bottom, action.bottom) - Math.max(field.top, action.top);
      const centerHit = document.elementFromPoint(
        (field.left + field.right) / 2,
        (field.top + field.bottom) / 2
      );
      const points = [
        pane.left + 6,
        pane.right - 6,
        (pane.left + pane.right) / 2,
      ].flatMap((x) =>
        [
          Math.max(pane.top, 0) + 24,
          (Math.max(pane.top, 0) + Math.min(action.top, innerHeight)) / 2,
        ].map((y) => ({ x, y }))
      );
      const wheelTarget = points.find(({ x, y }) => {
        if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        if (
          !hit ||
          !scroller.contains(hit) ||
          hit.closest('input,select,textarea,button')
        )
          return false;
        for (
          let node = hit;
          node && node !== scroller;
          node = node.parentElement!
        ) {
          if (
            node.scrollHeight > node.clientHeight + 2 &&
            /auto|scroll/.test(getComputedStyle(node).overflowY)
          )
            return false;
        }
        return true;
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        field,
        footer: action,
        focused: document.activeElement === input,
        focusVisible: input.matches(':focus-visible'),
        passwordType: input.type === 'password',
        centerHitsInput: centerHit === input,
        centerHitsFooter: !!centerHit && footer.contains(centerHit),
        overlap,
        wheelTarget,
        style: {
          outlineWidth,
          outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineColor: style.outlineColor,
          backgroundColor: style.backgroundColor,
          paddingLeft: parseFloat(style.paddingLeft),
          paddingRight: parseFloat(style.paddingRight),
          textIndent: parseFloat(style.textIndent),
          textAlign: style.textAlign,
          direction: style.direction,
        },
        // The outer edge of an outline lies offset + width beyond the border.
        // This checks the painted extent, independently of the Tailwind classes.
        outlineOutset: Math.max(0, outlineOffset + outlineWidth),
      };
    });
  const move = async (phase: 'above' | 'overlap') => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = await read();
      const targetTop =
        phase === 'above'
          ? state.footer.top - state.field.height - 16
          : state.footer.top + Math.min(20, state.footer.height / 3);
      const delta = state.field.top - targetTop;
      if (Math.abs(delta) <= 2) return state;
      if (!state.wheelTarget)
        throw new Error('No independent Sentry wheel target');
      await page.mouse.move(state.wheelTarget.x, state.wheelTarget.y);
      await page.mouse.wheel(0, Math.max(-60, Math.min(60, delta)));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
    }
    throw new Error(`Sentry password did not reach ${phase} footer position`);
  };
  try {
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await password.click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(password).toBeFocused();
      for (const phase of ['above', 'overlap'] as const) {
        const state = await move(phase);
        observations.push({ phase, ...state });
        const label = `sentry-password-focus-${viewport.width}-${phase}`;
        await info.attach(`${label}-geometry`, {
          body: JSON.stringify(state),
          contentType: 'application/json',
        });
        // Capture both states before assertions, retaining a genuine failing
        // Before on the old build. Full-field masks are not focus evidence.
        await info.attach(`${label}-context-masked`, {
          body: await page.screenshot({
            animations: 'disabled',
            mask: [
              page.locator(
                'input[type="password"],textarea,#import-wallet-input'
              ),
            ],
          }),
          contentType: 'image/png',
        });
        expect(state.passwordType).toBe(true);
        expect(state.style.paddingLeft).toBeGreaterThanOrEqual(8);
        expect(state.style.paddingRight).toBeGreaterThanOrEqual(8);
        expect(state.style.textIndent).toBeGreaterThanOrEqual(0);
        expect(state.style.textAlign).toMatch(/^(start|left)$/);
        expect(state.style.direction).toBe('ltr');
        expect(state.field.left).toBeGreaterThanOrEqual(0);
        expect(state.field.right).toBeLessThanOrEqual(viewport.width);
        // Four pixels inside the border remain within the proven password
        // padding. They expose the actual inward ring, never password glyphs.
        const top = Math.max(0, Math.floor(state.field.top) - 4);
        const bottom = Math.min(
          viewport.height,
          Math.ceil(state.field.bottom) + 4
        );
        for (const [side, left, right] of [
          [
            'left',
            Math.max(0, Math.floor(state.field.left) - 12),
            Math.floor(state.field.left) + 4,
          ],
          [
            'right',
            Math.ceil(state.field.right) - 4,
            Math.min(viewport.width, Math.ceil(state.field.right) + 12),
          ],
        ] as const) {
          expect(right).toBeGreaterThan(left);
          expect(bottom).toBeGreaterThan(top);
          await info.attach(`${label}-${side}-native-border`, {
            body: await page.screenshot({
              animations: 'disabled',
              clip: {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
              },
            }),
            contentType: 'image/png',
          });
        }
      }
    }
    for (const state of observations) {
      expect(state.focused).toBe(true);
      expect(state.focusVisible).toBe(true);
      expect(state.style.outlineStyle).not.toMatch(/^(none|hidden)$/);
      expect(state.style.outlineWidth).toBeGreaterThan(0);
      expect(state.style.outlineColor).not.toMatch(
        /^(transparent|rgba\([^)]*,\s*0\))$/
      );
      expect(state.style.outlineColor).not.toBe(state.style.backgroundColor);
      expect(state.outlineOutset).toBe(0);
      expect(-state.style.outlineOffset).toBeLessThan(
        Math.min(state.field.width, state.field.height) / 2
      );
      if (state.phase === 'above') {
        expect(state.field.bottom).toBeLessThan(state.footer.top);
        expect(state.centerHitsInput).toBe(true);
      } else {
        expect(state.overlap).toBeGreaterThan(state.field.height / 2);
        expect(state.centerHitsFooter).toBe(true);
      }
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
