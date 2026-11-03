import { expect, test, type Locator } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const geometry = (target: Locator) =>
  target.evaluate(async (node) => {
    await document.fonts.ready;
    const r = node.getBoundingClientRect(),
      s = getComputedStyle(node);
    const glyphs: {
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let part: Node | null;
    while ((part = walker.nextNode())) {
      for (let i = 0; i < (part.textContent?.length || 0); i++) {
        const char = part.textContent![i];
        if (!char.trim()) continue;
        const range = document.createRange();
        range.setStart(part, i);
        range.setEnd(part, i + 1);
        for (const box of range.getClientRects())
          glyphs.push({
            text: char,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          });
      }
    }
    const points = [
      [r.x + r.width / 2, r.y + r.height / 2],
      [r.x + 3, r.y + r.height / 2],
      [r.right - 3, r.y + r.height / 2],
    ];
    return {
      tag: node.tagName,
      id: node.id,
      text: node.textContent,
      color: s.color,
      font: s.font,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      background: s.backgroundColor,
      box: r.toJSON(),
      glyphs,
      inViewport:
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight,
      glyphsInViewport: glyphs.every(
        (g) =>
          g.x >= 0 &&
          g.y >= 0 &&
          g.x + g.width <= innerWidth &&
          g.y + g.height <= innerHeight
      ),
      exposed: points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === node || node.contains(hit)));
      }),
    };
  });

test('Welcome and Unlock keep readable text over the short-window backdrop', async ({}, info) => {
  test.setTimeout(120_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AuthReadabilitySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let result: 'passed' | 'failed' = 'failed';
  const runtime = extensionEvidence();
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('auth-backdrop-readability', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    const page = wallet.page;
    const inspect = async (state: 'welcome' | 'unlock') => {
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 400, height: 619 },
        { width: 400, height: 600 },
        { width: 400, height: 580 },
        { width: 400, height: 500 },
        { width: 400, height: 499 },
        { width: 400, height: 360 },
        { width: 320, height: 620 },
        { width: 320, height: 500 },
        { width: 320, height: 360 },
      ]) {
        await wallet!.step(
          `${state}: inspect backdrop, text and keyboard link at ${viewport.width}x${viewport.height}`,
          async () => {
            await page.setViewportSize(viewport);
            await expect(page.locator('#initial-loader')).toHaveAttribute(
              'aria-hidden',
              'true'
            );
            await expect(page.locator('#initial-loader')).toHaveAttribute(
              'inert',
              ''
            );
            await expect(
              page.getByRole('heading', { name: 'Pali', exact: true })
            ).toHaveCount(1);
            const backdrop = page.locator('.login-animated-bg');
            const link = page.locator('#import-wallet-link');
            await expect(link).toHaveText(
              state === 'welcome'
                ? en.start.importWalletSeedPhrase
                : en.start.importUsing
            );
            const art = await backdrop.evaluate(
              (element) => getComputedStyle(element).backgroundImage
            );
            const renderedViewport = await backdrop.evaluate((element) => ({
              width: innerWidth,
              height: innerHeight,
              backgroundImage: getComputedStyle(element).backgroundImage,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            }));
            expect(renderedViewport.width).toBe(viewport.width);
            expect(renderedViewport.height).toBe(viewport.height);
            const hasRoomForArtwork =
              state === 'welcome'
                ? viewport.height >= 600
                : viewport.height >= 620 && viewport.width >= 400;
            if (!hasRoomForArtwork) {
              expect(art).toBe('none');
              const heading = await captureForegroundContrast(
                backdrop.getByRole('heading', { name: 'Pali', exact: true }),
                info,
                `${state}-heading-${viewport.width}x${viewport.height}`
              );
              const action = await captureForegroundContrast(
                link,
                info,
                `${state}-import-${viewport.width}x${viewport.height}`
              );
              observations.push({
                state,
                viewport,
                renderedViewport,
                heading,
                action,
              });
            } else {
              expect(art).toContain('GET_STARTED2.webp');
              observations.push({ state, viewport, renderedViewport });
            }
            // Assert the actual rendered labels and all live actions, including
            // the recovery/reset tail; an art-none CSS rule alone is not proof.
            const controlSelectors =
              state === 'welcome'
                ? ['#unlock-btn', 'a#import-wallet-link']
                : [
                    '#login #password',
                    '#unlock-btn',
                    'button#import-wallet-link',
                    '#erase-wallet-link',
                  ];
            if (state === 'unlock')
              await expect(page.locator('#login #password')).toHaveValue('');
            const controls = [];
            for (const selector of controlSelectors) {
              const control = page.locator(selector);
              await expect(control).toBeVisible();
              await expect(control).toBeEnabled();
              const rendered = await geometry(control);
              expect(rendered.inViewport, selector).toBe(true);
              expect(rendered.exposed, selector).toBe(true);
              controls.push(rendered);
            }
            const headings = [];
            for (const name of ['Pali', 'Wallet']) {
              const rendered = await geometry(
                page.getByRole('heading', { name, exact: true })
              );
              expect(rendered.inViewport).toBe(true);
              expect(rendered.glyphsInViewport).toBe(true);
              headings.push(rendered);
            }
            // Traverse native focus without assigning document.activeElement.
            const expectedFocusIds =
              state === 'welcome'
                ? ['unlock-btn', 'import-wallet-link']
                : [
                    'password',
                    'unlock-btn',
                    'import-wallet-link',
                    'erase-wallet-link',
                  ];
            const reached = new Set<string>();
            const keyboard = [];
            for (let index = 0; index < 24; index++) {
              await page.keyboard.press('Tab');
              const focused = await page.evaluate(() => {
                const active = document.activeElement as HTMLElement;
                return { id: active?.id || '', tag: active?.tagName || '' };
              });
              keyboard.push(focused);
              if (expectedFocusIds.includes(focused.id))
                reached.add(focused.id);
              if (reached.size === expectedFocusIds.length) break;
            }
            expect([...reached].sort()).toEqual([...expectedFocusIds].sort());
            observations.push({
              state,
              viewport,
              controls,
              headings,
              keyboard,
            });
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth)
            ).toBeLessThanOrEqual(viewport.width);
            await page.mouse.move(0, 0);
            await info.attach(`${state}-${viewport.width}x${viewport.height}`, {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
          }
        );
      }
    };
    await inspect('welcome');
    await wallet.step(
      'import only the disposable fixture and lock through the ordinary menu',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await page.locator('#general-settings-button').click();
        await page.getByText(en.generalMenu.lock, { exact: true }).click();
        await expect(page.locator('#login #password')).toBeVisible();
        await expect(page.locator('#unlock-btn')).toBeEnabled();
      }
    );
    await inspect('unlock');
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    result = 'passed';
  } finally {
    await info.attach('auth-backdrop-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({ runtime, result, observations }),
    });
    try {
      await wallet?.dispose(result);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
