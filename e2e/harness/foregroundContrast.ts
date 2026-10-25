import { expect, type Locator, type TestInfo } from '@playwright/test';

// Read-only DOM evidence for a specific, already-admitted UI state. This is a
// solid-color WCAG calculation, not a replacement for inspecting screenshots.
export async function captureForegroundContrast(
  target: Locator,
  info: TestInfo,
  label: string,
  kind: 'text' | 'currentColor-icon' | 'border' = 'text'
) {
  await expect(target).toBeVisible();
  // A rotating loading border never has stationary bounds. Its visible paint
  // is measured in place; other targets still use ordinary scroll admission.
  if (kind === 'border') await expect(target).toBeInViewport();
  else await target.scrollIntoViewIfNeeded();
  // Measure the settled UI, not a transient page fade. Observe and await only
  // finite native animations on this target's ancestors; never pause, cancel,
  // finish, change styles or wait on unrelated infinite loading indicators.
  await target.evaluate(async (element) => {
    const animations = new Set<Animation>();
    for (let node: Element | null = element; node; node = node.parentElement) {
      for (const animation of node.getAnimations()) {
        if (
          animation.playState === 'running' &&
          Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))
        )
          animations.add(animation);
      }
    }
    await Promise.all(
      [...animations].map((animation) =>
        animation.finished.catch(() => undefined)
      )
    );
  });
  const evidence = await target.evaluate((element, targetKind) => {
    type Color = [number, number, number, number];
    const parseColor = (value: string): Color => {
      if (value === 'transparent') return [0, 0, 0, 0];
      const match = value.match(/^rgba?\((.*)\)$/);
      if (!match) throw new Error(`Unsupported computed color: ${value}`);
      const parts = match[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length < 3 || parts.some((part) => part.includes('%')))
        throw new Error(`Unsupported computed color: ${value}`);
      const numbers = parts.map(Number);
      if (numbers.some((part) => !Number.isFinite(part)))
        throw new Error(`Invalid computed color: ${value}`);
      return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    };
    const over = (front: Color, back: Color): Color => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [
        ...[0, 1, 2].map(
          (index) =>
            (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) /
            alpha
        ),
        alpha,
      ] as Color;
    };
    const luminance = (color: Color) =>
      [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
        const value = color[index] / 255;
        return (
          sum +
          weight *
            (value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4)
        );
      }, 0);

    const initial = getComputedStyle(element);
    const foregroundColor =
      targetKind === 'border' ? initial.borderTopColor : initial.color;
    let foreground = parseColor(foregroundColor);
    let background: Color = [0, 0, 0, 0];
    const unsupported: string[] = [];
    const layers = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const nodeBackground = parseColor(style.backgroundColor);
      const opacity = Number(style.opacity);
      // A gradient behind an opaque inner surface cannot affect these pixels.
      if (style.backgroundImage !== 'none' && background[3] < 1)
        unsupported.push(`${node.tagName}: background image/gradient`);
      for (const property of ['filter', 'backdrop-filter', 'mix-blend-mode']) {
        const value = style.getPropertyValue(property);
        if (value && value !== 'none' && value !== 'normal')
          unsupported.push(`${node.tagName}: ${property}=${value}`);
      }
      layers.push({
        tag: node.tagName,
        className: node.getAttribute('class'),
        background: style.backgroundColor,
        image: style.backgroundImage,
        opacity,
      });
      foreground = over(foreground, nodeBackground);
      background = over(background, nodeBackground);
      foreground[3] *= opacity;
      background[3] *= opacity;
    }
    // The fixture's body is opaque. Mark any unresolved canvas instead of
    // silently assuming a white or black background.
    if (background[3] < 1) unsupported.push('non-opaque document canvas');
    if (initial.textShadow !== 'none' && targetKind === 'text')
      unsupported.push('text-shadow');
    const textFill = initial.getPropertyValue('-webkit-text-fill-color');
    if (targetKind === 'text' && textFill && textFill !== initial.color)
      unsupported.push(`text-fill differs from color: ${textFill}`);
    const fgLuminance = luminance(foreground);
    const bgLuminance = luminance(background);
    const ratio =
      (Math.max(fgLuminance, bgLuminance) + 0.05) /
      (Math.min(fgLuminance, bgLuminance) + 0.05);
    const size = Number.parseFloat(initial.fontSize);
    const weight = Number.parseInt(initial.fontWeight, 10);
    const largeText = size >= 24 || (size >= 18.6667 && weight >= 700);
    const bounds = element.getBoundingClientRect();
    return {
      kind: targetKind,
      disabled: Boolean(element.closest('[disabled], [aria-disabled="true"]')),
      foreground: foregroundColor,
      effectiveForeground: foreground,
      effectiveBackground: background,
      font: {
        size: initial.fontSize,
        weight: initial.fontWeight,
        family: initial.fontFamily,
        lineHeight: initial.lineHeight,
      },
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      minimum: targetKind !== 'text' || largeText ? 3 : 4.5,
      ratio,
      unsupported,
      layers,
    };
  }, kind);
  expect([undefined, 'before', 'after']).toContain(
    process.env.PALI_FOREGROUND_CONTRAST_MODE
  );
  const observeOnly = process.env.PALI_FOREGROUND_CONTRAST_MODE === 'before';
  if (observeOnly)
    expect(process.env.PALI_TEST_DAPP_REVISION).toBe(
      '9bdf263ed621f6755f97ad55cdb34d9337c68a86'
    );
  if (observeOnly && process.env.CI)
    throw new Error('Before-only contrast observation is prohibited in CI');
  const mode = observeOnly ? 'before' : 'after';
  await info.attach(`${label}-${mode}`, {
    body: await target.page().screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
  await info.attach(`${label}-contrast`, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  // Disabled controls are not subject to the WCAG text/non-text minimum.
  // Still record their color, opacity and screenshot; do not count them as a
  // passing enabled-text sample.
  if (!observeOnly && !evidence.disabled) {
    expect(evidence.unsupported, `${label}: measured solid colors`).toEqual([]);
    expect(evidence.ratio, `${label}: contrast`).toBeGreaterThanOrEqual(
      evidence.minimum
    );
  }
  return evidence;
}
