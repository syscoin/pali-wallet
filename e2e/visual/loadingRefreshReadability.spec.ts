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

for (const width of [400, 320]) {
  test(`real refresh keeps progress and the faucet visible at ${width}px`, async ({}, info) => {
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
      status: 'passed' | 'failed' = 'failed',
      hold = false,
      release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve)),
      reads: string[][] = [],
      denied: string[] = [];
    try {
      wallet = await PaliWallet.launch(`loading-refresh-${width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 400 ? 620 : 360 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') return route.fallback();
        const raw = request.postDataJSON(),
          calls = Array.isArray(raw) ? raw : [raw];
        if (
          !hold ||
          !calls.some((call: any) => call.method === 'eth_getBalance')
        )
          return route.fallback();
        if (
          calls.some(
            (call: any) =>
              call.jsonrpc !== '2.0' ||
              call.method !== 'eth_getBalance' ||
              call.params?.length !== 2 ||
              !fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() === String(call.params[0]).toLowerCase()
              ) ||
              call.params[1] !== 'latest'
          )
        ) {
          denied.push('unexpected held request');
          return route.abort('blockedbyclient');
        }
        reads.push(calls.map((call: any) => call.method));
        await held;
        const replies = calls.map((call: any) => ({
          jsonrpc: '2.0',
          id: call.id,
          result: '0x0',
        }));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(raw) ? replies : replies[0]),
        });
      });
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
          });
          const ref = state.vault.activeAccount;
          return {
            network: state.vault.activeNetwork,
            account: {
              ...ref,
              address: state.vault.accounts[ref.type][ref.id].address,
            },
          };
        });
      const before = await identity();
      const faucet = page.getByRole('button', {
        name: /Grab \$TSYS on our faucet/,
      });
      await expect(faucet).toBeVisible();
      hold = true;
      await page
        .getByRole('button', { name: en.header.refresh, exact: true })
        .click();
      await expect.poll(() => reads.length).toBeGreaterThan(0);
      const large = page.locator('[role=status] .h-12.w-12');
      // This observes the actual 150–2000 ms lifecycle; no clock is replaced.
      await large.waitFor({ state: 'visible', timeout: 1500 });
      await captureArc(page, large, info, `refresh-initial-${width}`);
      const small = page.locator('[role=status] .h-4.w-4');
      await expect(small).toBeVisible({ timeout: 5000 });
      const slow = small.locator('..');
      await expect(slow).toContainText('slower than expected');
      const bounds = await slow.evaluate((statusElement, faucetText) => {
        const action = Array.from(document.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === faucetText
        )!;
        const a = statusElement.getBoundingClientRect(),
          b = action.getBoundingClientRect();
        const hit = document.elementFromPoint(
          b.x + b.width / 2,
          b.y + b.height / 2
        );
        return {
          status: a.toJSON(),
          faucet: b.toJSON(),
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
      }, (await faucet.innerText()).trim());
      await info.attach(`refresh-layout-${width}`, {
        body: JSON.stringify(bounds),
        contentType: 'application/json',
      });
      expect(bounds.separate).toBe(true);
      expect(bounds.status.top).toBeGreaterThanOrEqual(0);
      expect(bounds.status.bottom).toBeLessThanOrEqual(
        width === 400 ? 620 : 360
      );
      expect(bounds.faucetVisible).toBe(true);
      expect(bounds.faucetHit).toBe(true);
      await faucet.click({ trial: true });
      await captureArc(page, small, info, `refresh-slow-${width}`);
      hold = false;
      release();
      await expect(small).toHaveCount(0);
      await expect(page.locator('#home-balance')).toBeVisible();
      await expect(page).toHaveURL(/#\/home$/);
      expect(await identity()).toEqual(before);
      await info.attach(`refresh-completed-${width}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(denied).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      hold = false;
      release();
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, old);
      }
    }
  });
}
