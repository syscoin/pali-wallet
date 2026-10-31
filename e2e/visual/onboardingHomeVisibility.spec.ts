import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Only public Home-button crops are captured, including when the rest of the
// page contains generated words. No step wrapper or raw recording is used.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 30; i++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function inspectHome(page: Page, info: TestInfo, label: string) {
  const button = page
    .locator('button')
    .filter({ has: page.locator('svg[data-icon="home"]') });
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleName(/home/i);
  await button.scrollIntoViewIfNeeded();
  for (const state of ['rest', 'hover', 'keyboard'] as const) {
    await page.mouse.move(1, (page.viewportSize()?.height || 360) - 1);
    if (state === 'hover') await button.hover();
    if (state === 'keyboard') await tabTo(page, button);
    const native = await button.evaluate(async (node) => {
      await document.fonts.ready;
      const ancestors: Element[] = [];
      for (let item: Element | null = node; item; item = item.parentElement)
        ancestors.push(item);
      await Promise.all(
        ancestors
          .flatMap((item) => item.getAnimations())
          .filter((animation) =>
            Number.isFinite(
              Number(animation.effect?.getComputedTiming().endTime)
            )
          )
          .map((animation) => animation.finished.catch(() => undefined))
      );
      const svg = node.querySelector('svg')!;
      const paintedPath = svg.querySelector('path')!;
      const paintAncestors: Element[] = [];
      for (
        let item: Element | null = paintedPath;
        item;
        item = item.parentElement
      )
        paintAncestors.push(item);
      const layers = paintAncestors.map((item) => {
        const style = getComputedStyle(item);
        return {
          opacity: Number(style.opacity),
          filter: style.filter,
          blend: style.mixBlendMode,
        };
      });
      const bounds = node.getBoundingClientRect();
      return {
        color: getComputedStyle(paintedPath).fill,
        layers,
        opacity: layers.reduce((alpha, item) => alpha * item.opacity, 1),
        bounds: bounds.toJSON(),
        focused: node === document.activeElement,
        exposed: node.contains(
          document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          )
        ),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    expect(
      native.layers.every(
        (layer) => layer.filter === 'none' && layer.blend === 'normal'
      )
    ).toBe(true);
    expect(native.exposed).toBe(true);
    if (state === 'keyboard') expect(native.focused).toBe(true);
    const clip = {
      x: Math.max(0, Math.floor(native.bounds.x) - 4),
      y: Math.max(0, Math.floor(native.bounds.y)),
      width: Math.ceil(native.bounds.width) + 8,
      height: Math.ceil(native.bounds.height) + 4,
    };
    expect(clip.x + clip.width).toBeLessThanOrEqual(native.viewport.width);
    expect(clip.y + clip.height).toBeLessThanOrEqual(native.viewport.height);
    const screenshot = await page.screenshot({ clip, animations: 'disabled' });
    // Sample the real local gradient/dots immediately beside the public icon.
    // This is a bounded local-pixel check, not a claim about unseen backgrounds.
    const paint = await page.evaluate(
      async ({ bytes, color, opacity }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' })
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const foreground = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
        const light = (rgb: number[]) =>
          rgb
            .map((value) => value / 255)
            .map((value) =>
              value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4
            )
            .reduce(
              (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
              0
            );
        const samples = [];
        for (let y = 1; y < bitmap.height - 1; y++) {
          for (const x of [1, bitmap.width - 2]) {
            const pixel = [...context.getImageData(x, y, 1, 1).data];
            const composite = foreground.map(
              (value, i) => value * opacity + pixel[i] * (1 - opacity)
            );
            const a = light(composite),
              b = light(pixel.slice(0, 3));
            samples.push({
              pixel,
              ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            });
          }
        }
        bitmap.close();
        return {
          samples,
          minimum: Math.min(...samples.map((sample) => sample.ratio)),
        };
      },
      { bytes: [...screenshot], color: native.color, opacity: native.opacity }
    );
    await info.attach(`${label}-${state}-home`, {
      body: screenshot,
      contentType: 'image/png',
    });
    await info.attach(`${label}-${state}-home-paint`, {
      body: JSON.stringify({ native, paint }),
      contentType: 'application/json',
    });
    expect
      .soft(paint.samples.every((sample) => sample.pixel[3] === 255))
      .toBe(true);
    expect
      .soft(
        paint.minimum,
        `${label}/${state}: active icon against actual adjacent pixels`
      )
      .toBeGreaterThanOrEqual(3);
  }
  const heading = page.locator('.bg-gradient h1');
  await expect(heading).toHaveCount(1);
  const headingStyle = await heading.evaluate((node) => {
    const style = getComputedStyle(node),
      bounds = node.getBoundingClientRect();
    const opacity = [];
    for (let item: Element | null = node; item; item = item.parentElement)
      opacity.push(Number(getComputedStyle(item).opacity));
    return {
      text: node.textContent,
      color: style.color,
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: Number.parseInt(style.fontWeight, 10),
      opacity: opacity.reduce((a, b) => a * b, 1),
      bounds: bounds.toJSON(),
    };
  });
  const hclip = {
    x: Math.max(0, Math.floor(headingStyle.bounds.x) - 3),
    y: Math.max(0, Math.floor(headingStyle.bounds.y) - 2),
    width: Math.ceil(headingStyle.bounds.width) + 6,
    height: Math.ceil(headingStyle.bounds.height) + 4,
  };
  expect(hclip.x + hclip.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(hclip.y + hclip.height).toBeLessThanOrEqual(
    page.viewportSize()!.height
  );
  const headingImage = await page.screenshot({
    clip: hclip,
    animations: 'disabled',
  });
  const headingPaint = await page.evaluate(
    async ({ bytes, color, opacity }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const foreground = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const light = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const samples = [0.2, 0.35, 0.5, 0.65, 0.8].flatMap((x) =>
        [0, bitmap.height - 1].map((y) => {
          const pixel = [
            ...ctx.getImageData(Math.floor((bitmap.width - 1) * x), y, 1, 1)
              .data,
          ];
          const composite = foreground.map(
              (v, i) => v * opacity + pixel[i] * (1 - opacity)
            ),
            a = light(composite),
            b = light(pixel.slice(0, 3));
          return {
            pixel,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        })
      );
      bitmap.close();
      return { samples, minimum: Math.min(...samples.map((x) => x.ratio)) };
    },
    {
      bytes: [...headingImage],
      color: headingStyle.color,
      opacity: headingStyle.opacity,
    }
  );
  const headingMinimum =
    headingStyle.fontSize >= 24 ||
    (headingStyle.fontSize >= 18.6667 && headingStyle.fontWeight >= 700)
      ? 3
      : 4.5;
  await info.attach(`${label}-heading`, {
    body: headingImage,
    contentType: 'image/png',
  });
  await info.attach(`${label}-heading-paint`, {
    body: JSON.stringify({ headingStyle, headingPaint, headingMinimum }),
    contentType: 'application/json',
  });
  expect
    .soft(headingPaint.samples.every((sample) => sample.pixel[3] === 255))
    .toBe(true);
  expect
    .soft(
      headingPaint.minimum,
      `${label}: actual heading size/weight threshold`
    )
    .toBeGreaterThanOrEqual(headingMinimum);
  return button;
}

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`onboarding Home remains visible and keyboard reachable at ${viewport.width}`, async ({}, info) => {
    test.setTimeout(90_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG },
      noCopy = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'OnboardingHomeSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`onboarding-home-${viewport.width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport,
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const page = wallet.page;
      await page.locator('#import-wallet-link').click();
      await inspectHome(page, info, 'import-empty');
      await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
      await page.locator('#import-wallet-action').click();
      const importedPasswordHome = await inspectHome(
        page,
        info,
        'import-password'
      );
      await importedPasswordHome.press('Enter');
      await expect(page.locator('#import-wallet-link')).toBeVisible();
      await page.locator('#unlock-btn').click();
      await inspectHome(page, info, 'create-password');
      await page.locator('#create-password').fill(E2E_CONFIG.password);
      await page.locator('#confirm-password').fill(E2E_CONFIG.password);
      await page.locator('#create-password-action').click();
      await expect(
        page.getByRole('button', {
          name: en.import.showSeedPhrase,
          exact: true,
        })
      ).toBeVisible();
      await inspectHome(page, info, 'create-phrase-concealed');
      await page.locator('input[type=checkbox]').check();
      await page.locator('#unlock-btn').click();
      const confirmationHome = await inspectHome(page, info, 'confirm-phrase');
      await confirmationHome.press('Enter');
      await expect(page.locator('#import-wallet-link')).toBeVisible();
      await expect(page.locator('button.min-w-xs')).toHaveCount(0);
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
        if (noCopy === undefined) delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
        else process.env.PLAYWRIGHT_NO_COPY_PROMPT = noCopy;
      }
    }
  });
}
