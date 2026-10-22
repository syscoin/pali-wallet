import { type Locator, type Page, expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Observe nested clipping and actual hit targets without scrolling or focusing.
async function feedbackGeometry(locator: Locator) {
  return locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const left = box.left + node.clientLeft;
      const top = box.top + node.clientTop;
      if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, left);
        clip.right = Math.min(clip.right, left + node.clientWidth);
      }
      if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, top);
        clip.bottom = Math.min(clip.bottom, top + node.clientHeight);
      }
    }
    const contained =
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left >= clip.left - 0.5 &&
      bounds.right <= clip.right + 0.5 &&
      bounds.top >= clip.top - 0.5 &&
      bounds.bottom <= clip.bottom + 0.5;
    const points = [
      [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      [bounds.left + 2, bounds.top + bounds.height / 2],
      [bounds.right - 2, bounds.top + bounds.height / 2],
      [bounds.left + bounds.width / 2, bounds.top + 2],
      [bounds.left + bounds.width / 2, bounds.bottom - 2],
    ];
    const visible =
      contained &&
      points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (element === hit || element.contains(hit));
      });
    return { visible: Boolean(visible), bounds: bounds.toJSON(), clip };
  });
}

async function revealFeedback(page: Page, locator: Locator) {
  // Match sendDetailsShortWindow's finite AntD motion and cleanup wait.
  await locator.evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    const boundary = element.closest('.ant-form-item') || element;
    await Promise.all(
      boundary
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime)
        )
        .map((animation) => animation.finished.catch(() => undefined))
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  for (let attempt = 0; attempt < 24; attempt++) {
    if ((await feedbackGeometry(locator)).visible) return;
    const box = await locator.boundingBox();
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 8, viewport.height / 2);
    await page.mouse.wheel(0, box && box.y < 0 ? -180 : 180);
    await page.waitForTimeout(100);
  }
}

test('ordinary EVM send explains invalid inputs while keeping Next blocked', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SendFeedbackSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('send-validation-feedback', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    const page = wallet.page;
    for (const [width, height] of [
      [320, 360],
      [400, 620],
    ]) {
      await page.setViewportSize({ width, height });
      await wallet.ensureOnHome();
      await page.locator('#send-btn').click();
      await expect(page).toHaveURL(/#\/send\/eth$/);
      const receiver = page.getByPlaceholder(en.send.receiver, { exact: true });
      const amount = page.getByPlaceholder(en.send.amount, { exact: true });
      const next = page.getByRole('button', {
        name: en.buttons.next,
        exact: true,
      });
      for (const [address, value, message] of [
        ['', '1', en.send.addressRequired],
        [fixture.evmAddresses[1], '', en.send.amountRequired],
        [fixture.evmAddresses[1], '0', en.send.invalidAmount],
        [fixture.evmAddresses[1], '-1', en.send.invalidAmount],
        ['invalid-address', '1', en.send.invalidEthAddress],
        [fixture.evmAddresses[1], '1', en.send.insufficientFunds],
      ]) {
        await wallet.step(
          `visible ${message} for ${value || 'blank'} input ${width}x${height}`,
          async () => {
            await receiver.fill(address);
            await amount.fill(value);
            await next.click();
            await expect(page).toHaveURL(/#\/send\/eth$/);
            const feedback = page.getByText(message, { exact: true });
            await expect(feedback).toBeVisible();
            await revealFeedback(page, feedback);
            const readability = await feedbackGeometry(feedback);
            await info.attach(
              `send-error-${width}-${message}-${value || 'blank'}-geometry`,
              {
                body: JSON.stringify(readability, null, 2),
                contentType: 'application/json',
              }
            );
            expect(readability.visible, JSON.stringify(readability)).toBe(true);
            const bounds = (await feedback.boundingBox())!;
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
            await info.attach(
              `send-error-${width}-${message}-${value || 'blank'}`,
              {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              }
            );
            expect(routes.deniedWrites).toEqual([]);
          }
        );
      }
      await wallet.gotoRoute('#/home');
    }
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
