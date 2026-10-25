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
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// Read the actual screenshot pixels, including the spinner's shadow and the
// underlying wallet surface. This does not change DOM, animation or timers.
async function captureArc(
  page: Page,
  arc: Locator,
  info: TestInfo,
  label: string
) {
  await expect(arc).toBeVisible();
  await expect(arc).toBeInViewport();
  const shape = await arc.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      radius: (node as HTMLElement).offsetWidth / 2,
      color: getComputedStyle(node).borderBottomColor,
      viewport: innerWidth,
    };
  });
  const png = await page.screenshot();
  const pixels = await page.evaluate(
    async ({ bytes, shape: sampledShape }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const scale = bitmap.width / sampledShape.viewport;
      const center = { x: sampledShape.x * scale, y: sampledShape.y * scale };
      const radius = sampledShape.radius * scale;
      const foreground = sampledShape.color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const pixel = (x: number, y: number) =>
        Array.from(
          image.data.slice(
            (Math.round(y) * image.width + Math.round(x)) * 4,
            (Math.round(y) * image.width + Math.round(x)) * 4 + 3
          )
        );
      const luminance = (rgb: number[]) =>
        rgb.reduce((sum, value, index) => {
          const channel = value / 255;
          return (
            sum +
            [0.2126, 0.7152, 0.0722][index] *
              (channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      const samples = [];
      // The lower visible arc has a wallet/panel background, not an unrelated
      // action button underneath the top of the initial viewport-centered arc.
      for (
        let y = Math.ceil(center.y + radius * 0.3);
        y <= center.y + radius;
        y++
      ) {
        for (
          let x = Math.floor(center.x - radius);
          x <= center.x + radius;
          x++
        ) {
          const paint = pixel(x, y);
          if (paint.some((channel, i) => Math.abs(channel - foreground[i]) > 3))
            continue;
          const dx = x - center.x,
            dy = y - center.y,
            length = Math.hypot(dx, dy);
          if (!length) continue;
          const backdrop = pixel(
            center.x + (dx / length) * (radius + 4 * scale),
            center.y + (dy / length) * (radius + 4 * scale)
          );
          const [low, high] = [luminance(paint), luminance(backdrop)].sort(
            (a, b) => a - b
          );
          samples.push({
            x,
            y,
            paint,
            backdrop,
            ratio: (high + 0.05) / (low + 0.05),
          });
        }
      }
      bitmap.close();
      return {
        count: samples.length,
        minimum: samples.length
          ? Math.min(...samples.map((sample) => sample.ratio))
          : null,
        samples: samples.slice(0, 6),
      };
    },
    { bytes: Array.from(png), shape }
  );
  await info.attach(label, { body: png, contentType: 'image/png' });
  await info.attach(`${label}-pixels`, {
    body: JSON.stringify({ shape, pixels }),
    contentType: 'application/json',
  });
  expect(pixels.count).toBeGreaterThan(0);
  expect(pixels.minimum).toBeGreaterThanOrEqual(3);
}

// Status and its painted spinner must never sit over wallet data. Text Ranges
// measure the actual rendered lines, including each native-currency glyph.
async function captureNonIntersection(
  page: Page,
  status: Locator,
  info: TestInfo,
  label: string,
  requireVisibleStatus = true
) {
  const geometry = await status.evaluate((node) => {
    const rect = (element: Element) => element.getBoundingClientRect().toJSON();
    const glyphs = (element: Element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const boxes: DOMRect[] = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        boxes.push(...range.getClientRects());
      }
      return boxes
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => box.toJSON());
    };
    const native = document.getElementById('home-balance')!;
    const unit = native.nextElementSibling!;
    const fiat = native.parentElement!.nextElementSibling!.querySelector('p')!;
    const send = document.getElementById('send-btn')!;
    const receive = document.getElementById('receive-btn')!;
    const spinner = node.querySelector('.animate-spin')!;
    const areas = [rect(node), rect(spinner)];
    const targets = [
      { name: 'native', text: native.textContent, boxes: glyphs(native) },
      { name: 'currency', text: unit.textContent, boxes: glyphs(unit) },
      { name: 'fiat', text: fiat.textContent, boxes: glyphs(fiat) },
      { name: 'Send', text: send.textContent, boxes: [rect(send)] },
      { name: 'Receive', text: receive.textContent, boxes: [rect(receive)] },
    ];
    const overlaps: string[] = [];
    for (const target of targets) {
      for (const [areaIndex, area] of areas.entries()) {
        if (
          target.boxes.some(
            (box) =>
              area.left < box.right &&
              area.right > box.left &&
              area.top < box.bottom &&
              area.bottom > box.top
          )
        )
          overlaps.push(`${areaIndex ? 'spinner' : 'status'}:${target.name}`);
      }
    }
    return {
      status: areas[0],
      spinner: areas[1],
      targets,
      overlaps,
      position: getComputedStyle(node).position,
      precedesBalance: Boolean(
        node.compareDocumentPosition(native) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  await info.attach(label, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await info.attach(`${label}-geometry`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  expect(geometry.targets.every((target) => target.boxes.length > 0)).toBe(
    true
  );
  expect(geometry.overlaps).toEqual([]);
  if (requireVisibleStatus) {
    expect(geometry.status.top).toBeGreaterThanOrEqual(0);
    expect(geometry.status.bottom).toBeLessThanOrEqual(
      geometry.viewport.height
    );
  }
  expect(geometry.precedesBalance).toBe(true);
  expect(['fixed', 'absolute']).not.toContain(geometry.position);
}

for (const width of [400, 320]) {
  for (const balance of [
    { name: 'zero', hex: '0x0', display: '0' },
    { name: 'positive', hex: '0x38d7ea4c68000', display: '0.001' },
  ]) {
    test(`real refresh keeps ${balance.name} balance, progress and actions visible at ${width}px`, async ({}, info) => {
      test.setTimeout(60000);
      const old = { ...E2E_CONFIG },
        server = await startUtxoFixtureServer(),
        fixture = createIsolatedVaultFixture();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'PublicRefreshOnly!2026',
        rpcUrl: server.url,
      });
      let wallet: PaliWallet | undefined,
        result: 'passed' | 'failed' = 'failed',
        phase: 'healthy' | 'held' | 'failed' = 'healthy',
        release: () => void = () => undefined;
      let held: Promise<void> | undefined;
      const reads: string[][] = [],
        denied: string[] = [];
      let failedReads = 0;
      const beginHold = () => {
        phase = 'held';
        held = new Promise<void>((resolve) => {
          release = resolve;
        });
      };
      const releaseAs = (next: 'healthy' | 'failed') => {
        phase = next;
        release();
        held = undefined;
      };
      try {
        wallet = await PaliWallet.launch(
          `loading-refresh-${balance.name}-${width}`,
          {
            offlineHttpProxy: server.url,
            recordVideo: false,
            viewport: { width, height: width === 400 ? 620 : 360 },
          }
        );
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url,
          (url) => {
            if (
              url.origin !== 'https://api.coingecko.com' ||
              url.pathname !== '/api/v3/simple/price'
            )
              return undefined;
            if (
              url.searchParams.get('ids') !== 'syscoin' ||
              url.searchParams.get('vs_currencies') !== 'usd' ||
              url.searchParams.get('include_24hr_change') !== 'true' ||
              [...url.searchParams.keys()].sort().join(',') !==
                'ids,include_24hr_change,vs_currencies'
            )
              return undefined;
            return { syscoin: { usd: 0.125, usd_24h_change: 0 } };
          }
        );
        await wallet.context.route(
          'https://rpc.tanenbaum.io/',
          async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') return route.fallback();
            const raw = request.postDataJSON(),
              calls = Array.isArray(raw) ? raw : [raw];
            if (!calls.some((call: any) => call.method === 'eth_getBalance'))
              return route.fallback();
            if (
              calls.some(
                (call: any) =>
                  call.jsonrpc !== '2.0' ||
                  call.method !== 'eth_getBalance' ||
                  call.params?.length !== 2 ||
                  !fixture.evmAddresses.some(
                    (address) =>
                      address.toLowerCase() ===
                      String(call.params[0]).toLowerCase()
                  ) ||
                  call.params[1] !== 'latest'
              )
            ) {
              denied.push('unexpected held request');
              return route.abort('blockedbyclient');
            }
            reads.push(calls.map((call: any) => call.method));
            if (held) await held;
            const failed = phase === 'failed';
            if (failed) failedReads++;
            const replies = calls.map((call: any) => ({
              jsonrpc: '2.0',
              id: call.id,
              ...(failed
                ? {
                    error: {
                      code: -32000,
                      message: 'Synthetic native balance unavailable',
                    },
                  }
                : { result: balance.hex }),
            }));
            await route.fulfill({
              status: failed ? 503 : 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(raw) ? replies : replies[0]),
            });
          }
        );
        await wallet.importSeedAndCreatePassword();
        await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet.ensureOnHome();
        const page = wallet.page;
        await page.locator('#general-settings-button').click();
        await page
          .getByRole('menuitem', { name: en.generalMenu.advanced, exact: true })
          .click();
        await page.locator('#advanced-refresh').click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await wallet.ensureOnHome();
        const identity = () =>
          page.evaluate(async () => {
            const state = await chrome.runtime.sendMessage({
                type: 'getCurrentState',
              }),
              ref = state.vault.activeAccount;
            return {
              network: state.vault.activeNetwork,
              account: {
                ...ref,
                address: state.vault.accounts[ref.type][ref.id].address,
              },
            };
          });
        const before = await identity();
        const native = page.locator('#home-balance'),
          fiat = page.locator('.balance-account + div > p').first();
        await expect(native).toHaveText(balance.display);
        await expect(fiat).toContainText('USD');
        const expectedFiat = await fiat.innerText();
        const faucet = page.getByRole('button', {
          name: /Grab \$TSYS on our faucet/,
        });
        if (balance.name === 'zero') await expect(faucet).toBeVisible();
        else await expect(faucet).toHaveCount(0);
        const progress = page
          .locator('[role=status]')
          .filter({ has: page.locator('.animate-spin') })
          .first();
        const refresh = page.getByRole('button', {
          name: en.header.refresh,
          exact: true,
        });
        const assertValues = async () => {
          await expect(native).toHaveText(balance.display);
          await expect(fiat).toHaveText(expectedFiat);
          expect(await identity()).toEqual(before);
        };
        const observeHeld = async (label: string) => {
          await expect(progress).toBeVisible({ timeout: 1500 });
          await captureNonIntersection(
            page,
            progress,
            info,
            `${label}-initial-${balance.name}-${width}`
          );
          await expect(progress).toHaveText(
            en.networkConnection.updatingBalances
          );
          await captureArc(
            page,
            progress.locator('.animate-spin'),
            info,
            `${label}-initial-arc-${balance.name}-${width}`
          );
          await assertValues();
          await expect(progress).toContainText('slower than expected', {
            timeout: 5000,
          });
          await captureNonIntersection(
            page,
            progress,
            info,
            `${label}-slow-${balance.name}-${width}`
          );
          await captureArc(
            page,
            progress.locator('.animate-spin'),
            info,
            `${label}-slow-arc-${balance.name}-${width}`
          );
          if (balance.name === 'zero') {
            const bounds = await progress.evaluate(
              (statusElement, faucetText) => {
                const action = Array.from(
                  document.querySelectorAll('button')
                ).find((button) => button.textContent?.trim() === faucetText)!;
                const a = statusElement.getBoundingClientRect(),
                  b = action.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  b.x + b.width / 2,
                  b.y + b.height / 2
                );
                return {
                  separate:
                    a.bottom <= b.top ||
                    b.bottom <= a.top ||
                    a.right <= b.left ||
                    b.right <= a.left,
                  faucetVisible:
                    b.top >= 0 &&
                    b.left >= 0 &&
                    b.bottom <= innerHeight &&
                    b.right <= innerWidth,
                  faucetHit: !!hit && action.contains(hit),
                };
              },
              (await faucet.innerText()).trim()
            );
            expect(bounds.separate).toBe(true);
            expect(bounds.faucetVisible).toBe(true);
            expect(bounds.faucetHit).toBe(true);
            await faucet.click({ trial: true });
          }
          // The reserved row can move actions below a short viewport. Use
          // ordinary wheel gestures; do not assign scrollTop or force clicks.
          for (let attempt = 0; attempt < 8; attempt++) {
            const visible = await page
              .locator('#receive-btn')
              .evaluate((button) => {
                const r = button.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= innerHeight;
              });
            if (visible) break;
            await page.mouse.move(width - 12, (width === 400 ? 620 : 360) / 2);
            await page.mouse.wheel(0, 150);
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                  )
                )
            );
          }
          await expect(page.locator('#send-btn')).toBeInViewport({ ratio: 1 });
          await expect(page.locator('#receive-btn')).toBeInViewport({
            ratio: 1,
          });
          await page.locator('#receive-btn').click({ trial: true });
          await captureNonIntersection(
            page,
            progress,
            info,
            `${label}-actions-${balance.name}-${width}`,
            false
          );
        };
        beginHold();
        const firstRead = reads.length;
        await refresh.click();
        await expect.poll(() => reads.length).toBeGreaterThan(firstRead);
        await observeHeld('refresh');
        // Reload the real document while this already-admitted RPC remains
        // pending; no extra identical request is assumed inside ethers' cache.
        for (let index = 0; index < 4; index++) {
          await page.mouse.move(width - 12, (width === 400 ? 620 : 360) / 2);
          await page.mouse.wheel(0, -150);
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve())
                )
              )
          );
        }
        await expect(refresh).toBeInViewport({ ratio: 1 });
        await page.reload();
        await wallet.waitAppReady();
        await expect(page).toHaveURL(/#\/home$/);
        await observeHeld('reload');
        releaseAs('failed');
        // This new transport-failure control retains the60s case budget and
        // never extends the original healthy-release assertions.
        await expect.poll(() => failedReads).toBeGreaterThan(0);
        await expect(progress).toHaveCount(0, { timeout: 20000 });
        await assertValues();
        await info.attach(`refresh-failed-${balance.name}-${width}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        beginHold();
        const retryRead = reads.length;
        await refresh.click();
        await expect.poll(() => reads.length).toBeGreaterThan(retryRead);
        await observeHeld('recovery');
        releaseAs('healthy');
        await expect(progress).toHaveCount(0);
        await expect(page.locator('#home-balance')).toBeVisible();
        await expect(page).toHaveURL(/#\/home$/);
        await assertValues();
        await info.attach(`refresh-completed-${balance.name}-${width}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        expect(denied).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        result = 'passed';
      } finally {
        releaseAs('healthy');
        try {
          await wallet?.dispose(result);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, old);
        }
      }
    });
  }
}
