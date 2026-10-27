import { expect, test, type Locator, type TestInfo } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  armRuntimeReply,
  installRuntimeReplyHold,
  releaseRuntimeReply,
  restoreRuntimeReply,
  runtimeReplySnapshot,
} from '../harness/genuineRuntimeReply';
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

// Real generated words and passwords never enter reports. Only the public
// status/action rectangle and masked ordinary screen are captured.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function readablePublicText(
  target: Locator,
  info: TestInfo,
  label: string
) {
  const page = target.page();
  await expect(target).toBeVisible();
  await page.bringToFront();
  const read = () =>
    target.evaluate(async (node) => {
      await document.fonts.ready;
      const ancestors: Element[] = [];
      for (
        let current: Element | null = node;
        current;
        current = current.parentElement
      )
        ancestors.push(current);
      await Promise.all(
        ancestors
          .flatMap((current) => current.getAnimations())
          .filter((animation) =>
            Number.isFinite(
              Number(animation.effect?.getComputedTiming().endTime)
            )
          )
          .map((animation) => animation.finished.catch(() => undefined))
      );
      const r = node.getBoundingClientRect(),
        s = getComputedStyle(node);
      const plainParagraph =
        node.tagName === 'P' &&
        s.backgroundImage === 'none' &&
        /^rgba\([^,]+,[^,]+,[^,]+,\s*0\)$/.test(s.backgroundColor) &&
        (
          [
            'borderTopWidth',
            'borderBottomWidth',
            'paddingTop',
            'paddingBottom',
          ] as const
        ).every((property) => parseFloat(s[property]) === 0);
      const clip = plainParagraph
        ? {
            x: Math.floor(r.x) - 4,
            y: Math.floor(r.y) - 4,
            width: Math.ceil(r.right) - Math.floor(r.x) + 8,
            height: Math.ceil(r.bottom) - Math.floor(r.y) + 8,
          }
        : undefined;
      // Both sample strips are outside the paragraph/glyph box but on its
      // actual ancestor backdrop. Never sample through a sibling or overlay.
      const backdropExposed =
        !clip ||
        [clip.y + 1, clip.y + clip.height - 2].every((y) =>
          [0.2, 0.35, 0.5, 0.65, 0.8].every((fraction) => {
            const hit = document.elementFromPoint(
              clip.x + clip.width * fraction,
              y
            );
            return Boolean(hit && hit.contains(node));
          })
        );
      const footer = document
        .querySelector('#unlock-btn')
        ?.closest('div.fixed');
      const footerTop = footer?.getBoundingClientRect().top ?? innerHeight;
      let visibleLeft = 0,
        visibleTop = 0,
        visibleRight = innerWidth,
        visibleBottom = Math.min(innerHeight, footerTop);
      for (const parent of ancestors.slice(1)) {
        const style = getComputedStyle(parent),
          box = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          visibleLeft = Math.max(visibleLeft, box.left);
          visibleRight = Math.min(visibleRight, box.right);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          visibleTop = Math.max(visibleTop, box.top);
          visibleBottom = Math.min(visibleBottom, box.bottom);
        }
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const glyphRects = [...range.getClientRects()].filter(
        (box) => box.width && box.height
      );
      const glyphsExposed =
        glyphRects.length > 0 &&
        glyphRects.every(
          (box) =>
            box.left >= visibleLeft &&
            box.right <= visibleRight &&
            box.top >= visibleTop &&
            box.bottom <= visibleBottom &&
            [0.1, 0.5, 0.9].every((fraction) => {
              const hit = document.elementFromPoint(
                box.left + box.width * fraction,
                box.top + box.height / 2
              );
              return Boolean(hit && (hit === node || node.contains(hit)));
            })
        );
      const owner = ancestors
        .slice(1)
        .find(
          (parent) =>
            parent.scrollHeight > parent.clientHeight + 2 &&
            /auto|scroll/.test(getComputedStyle(parent).overflowY)
        ) as HTMLElement | undefined;
      const points: { x: number; y: number }[] = [];
      if (owner) {
        const area = owner.getBoundingClientRect();
        const left = Math.max(visibleLeft, area.left),
          right = Math.min(visibleRight, area.right);
        for (const x of [left + 8, (left + right) / 2, right - 8]) {
          for (const y of [
            visibleTop + 12,
            (visibleTop + visibleBottom) / 2,
            visibleBottom - 12,
          ]) {
            const hit = document.elementFromPoint(x, y);
            if (
              !hit ||
              !owner.contains(hit) ||
              hit.closest('input,textarea,select')
            )
              continue;
            let nearest: Element | null = hit;
            while (nearest && nearest !== owner) {
              if (
                nearest.scrollHeight > nearest.clientHeight + 2 &&
                /auto|scroll/.test(getComputedStyle(nearest).overflowY)
              )
                break;
              nearest = nearest.parentElement;
            }
            if (nearest === owner) points.push({ x, y });
          }
        }
      }
      const region = clip || {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
      return {
        clip,
        backdropExposed,
        glyphsExposed,
        glyphRects: glyphRects.map((box) => box.toJSON()),
        visibleArea: {
          left: visibleLeft,
          top: visibleTop,
          right: visibleRight,
          bottom: visibleBottom,
        },
        fullyExposed:
          glyphsExposed &&
          backdropExposed &&
          region.x >= visibleLeft &&
          region.y >= visibleTop &&
          region.x + region.width <= visibleRight &&
          region.y + region.height <= visibleBottom,
        scrollOwner: owner
          ? {
              tag: owner.tagName,
              className: owner.className,
              top: owner.scrollTop,
              max: owner.scrollHeight - owner.clientHeight,
            }
          : null,
        points,
        color: s.color,
        opacity: s.opacity,
        ancestorOpacities: ancestors.map(
          (current) => getComputedStyle(current).opacity
        ),
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        visible:
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= innerHeight &&
          r.right <= innerWidth,
      };
    });
  let native = await read();
  const movement = [];
  for (let attempt = 0; !native.fullyExposed && attempt < 60; attempt++) {
    if (!native.points.length) break;
    const first = native.clip?.y ?? native.bounds.y;
    const last = first + (native.clip?.height ?? native.bounds.height);
    const delta =
      last > native.visibleArea.bottom
        ? 60
        : first < native.visibleArea.top
        ? -60
        : (first + last - native.visibleArea.top - native.visibleArea.bottom) /
          2;
    const point = native.points[attempt % native.points.length];
    movement.push(native);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, delta || 20);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    native = await read();
  }
  await info.attach(label + '-native-visibility', {
    contentType: 'application/json',
    body: JSON.stringify({ movement, final: native }),
  });
  if (!native.fullyExposed)
    await info.attach(label + '-unexposed', {
      contentType: 'image/png',
      body: await page.screenshot({ animations: 'disabled' }),
    });
  expect(native.fullyExposed).toBe(true);
  expect(native.visible).toBe(true);
  expect(native.opacity).toBe('1');
  expect(native.ancestorOpacities.every((opacity) => opacity === '1')).toBe(
    true
  );
  expect(native.backdropExposed).toBe(true);
  if (native.clip) {
    const viewport = page.viewportSize()!;
    expect(native.clip.x).toBeGreaterThanOrEqual(0);
    expect(native.clip.y).toBeGreaterThanOrEqual(0);
    expect(native.clip.x + native.clip.width).toBeLessThanOrEqual(
      viewport.width
    );
    expect(native.clip.y + native.clip.height).toBeLessThanOrEqual(
      viewport.height
    );
  }
  const image = native.clip
    ? await page.screenshot({ clip: native.clip, animations: 'disabled' })
    : await target.screenshot({ animations: 'disabled' });
  // Analyze the actual PNG, including the real gradient/dots. Do not treat
  // transparent CSS backgrounds as a flat canvas. Transparent paragraphs use
  // unoccluded ancestor-background strips outside their entire line box so
  // descender antialiasing is not mistaken for background. Filled buttons keep
  // their own interior fill samples. This is bounded local-pixel regression;
  // full-screen personal visual inspection remains required.
  const measurement = await page.evaluate(
    async ({ bytes, color }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const fg = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const light = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const samples = [0.2, 0.35, 0.5, 0.65, 0.8].flatMap((x) =>
        [1, bitmap.height - 2].map((y) => {
          const pixel = [
            ...context.getImageData(Math.floor((bitmap.width - 1) * x), y, 1, 1)
              .data,
          ];
          const a = light(fg),
            b = light(pixel.slice(0, 3));
          return {
            pixel,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        })
      );
      bitmap.close();
      return {
        foreground: fg,
        samples,
        minimumAdjacentPixelContrast: Math.min(...samples.map((s) => s.ratio)),
      };
    },
    { bytes: [...image], color: native.color }
  );
  await info.attach(label + '-public-text', {
    body: image,
    contentType: 'image/png',
  });
  await info.attach(label + '-paint', {
    body: JSON.stringify({ native, measurement }),
    contentType: 'application/json',
  });
  expect(measurement.samples.every((s) => s.pixel[3] === 255)).toBe(true);
  expect(measurement.minimumAdjacentPixelContrast).toBeGreaterThanOrEqual(4.5);
}

for (const state of ['generation', 'recovery'] as const) {
  test(`ordinary ${state} failure keeps its public status and recovery action readable`, async ({}, info) => {
    test.setTimeout(90000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ReadableOnboardingSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`onboarding-${state}-readability`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const page = wallet.page,
        originalCapture = page.screenshot.bind(page);
      page.screenshot = (options = {}) =>
        originalCapture({
          ...options,
          mask: [
            ...(options.mask || []),
            page.locator(
              'input[type=password],textarea,.select-none p,button.min-w-xs'
            ),
          ],
        });
      await wallet.step(
        'enter the real onboarding path without replacing any controller state',
        async () => {
          if (state === 'generation') {
            await page.locator('#unlock-btn').click();
            await page.locator('#create-password').fill(E2E_CONFIG.password);
            await page.locator('#confirm-password').fill(E2E_CONFIG.password);
            await page.locator('#create-password-action').click();
            await expect(page.getByRole('checkbox')).toBeEnabled();
          } else {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.ensureOnHome();
            await page.locator('#general-settings-button').click();
            await page
              .getByRole('menuitem', { name: en.generalMenu.lock, exact: true })
              .click();
            await page.locator('#import-wallet-link').click();
            await page.locator('#confirm-import-btn').click();
            await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
            await page.locator('#import-wallet-action').click();
            await page
              .locator('#create-password')
              .fill('NewReadableSynthetic!2026');
            await page
              .locator('#confirm-password')
              .fill('NewReadableSynthetic!2026');
          }
          await installRuntimeReplyHold(page);
        }
      );
      await wallet.step(
        'hold only the unchanged real reply and inspect pending and timeout controls',
        async () => {
          await armRuntimeReply(
            page,
            state === 'generation' ? 'createNewSeed' : 'recoverWalletFromSeed'
          );
          if (state === 'generation')
            await page.getByRole('combobox').selectOption('24');
          else await page.locator('#create-password-action').click();
          await expect
            .poll(() => runtimeReplySnapshot(page))
            .toMatchObject({ held: true, realResponseWasError: false });
          if (state === 'generation') {
            await expect(page.getByRole('checkbox')).toBeDisabled();
            for (const width of [400, 320]) {
              await page.setViewportSize({
                width,
                height: width === 400 ? 620 : 360,
              });
              await readablePublicText(
                page.getByRole('status'),
                info,
                `generation-loading-${width}`
              );
            }
          }
          const target =
            state === 'generation'
              ? page.getByRole('alert')
              : page.locator('#recovery-check-wallet');
          await expect(target).toBeVisible({ timeout: 15000 });
          if (state === 'recovery') {
            // The real operation succeeded but its acknowledgement was held;
            // the UI must not claim it failed or tell the user to retry it.
            await expect(page.getByRole('alert')).toHaveText(
              en.settings.walletRecoveryUnconfirmed
            );
          }
          for (const width of [400, 320]) {
            await page.setViewportSize({
              width,
              height: width === 400 ? 620 : 360,
            });
            await readablePublicText(target, info, `${state}-failure-${width}`);
            await info.attach(`${state}-screen-${width}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
          expect(
            (await runtimeReplySnapshot(page)).calls[
              state === 'generation' ? 'createNewSeed' : 'recoverWalletFromSeed'
            ]
          ).toBe(1);
        }
      );
      await wallet.step(
        'explicit user action recovers without automatically replaying a wallet commit',
        async () => {
          if (state === 'generation') {
            await releaseRuntimeReply(page);
            await expect(page.getByRole('alert')).toHaveText(
              en.createPhrase.generationFailed
            );
            await page
              .getByRole('button', { name: en.buttons.generate, exact: true })
              .click();
            await expect(page.getByRole('checkbox')).toBeEnabled();
            await expect(page.getByRole('checkbox')).not.toBeChecked();
            expect((await runtimeReplySnapshot(page)).calls.createNewSeed).toBe(
              2
            );
            expect(
              (await runtimeReplySnapshot(page)).calls.createWallet || 0
            ).toBe(0);
            await restoreRuntimeReply(page);
          } else {
            await page.locator('#recovery-check-wallet').click();
            await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
          }
          expect(routes.deniedWrites).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
        }
      );
      status = 'passed';
    } finally {
      await wallet?.dispose(status);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}
