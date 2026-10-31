import { expect, test, type Page, type TestInfo } from '@playwright/test';
import path from 'path';

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

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.beforeEach(() => {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
});

async function snapshot(
  page: Page,
  info: TestInfo,
  name: string,
  observation: unknown
) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
  await info.attach(`${name}-observation`, {
    contentType: 'application/json',
    body: JSON.stringify(observation, null, 2),
  });
  console.log(name, JSON.stringify(observation));
}

for (const width of [400, 320]) {
  test(`${width}px RPC testing progress remains visible through the healthy fallback`, async ({}, info) => {
    test.setTimeout(120000);
    const before = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'Qa122RecoverySynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let releaseFirst!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstSeen = false;
    let firstResponded = false;
    const reads: string[] = [];
    try {
      wallet = await PaliWallet.launch(`rpc-progress-readability-${width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 400 ? 620 : 360 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      await wallet.context.route('https://chainlist.org/rpcs.json', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              name: 'QA122 Delayed Network',
              chainId: 5700,
              networkId: 5700,
              nativeCurrency: {
                name: 'Synthetic',
                symbol: 'OLD',
                decimals: 18,
              },
              rpc: [
                { url: 'https://qa122-first.invalid/rpc' },
                { url: 'https://qa122-second.invalid/rpc' },
              ],
              explorers: [],
            },
          ]),
        })
      );
      await wallet.context.route(
        'https://qa122-first.invalid/rpc',
        async (route) => {
          firstSeen = true;
          reads.push('old-first-auth-failure');
          await released;
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Synthetic API key required' }),
          });
          firstResponded = true;
        }
      );
      await wallet.context.route(
        'https://qa122-second.invalid/rpc',
        async (route) => {
          const calls = route.request().postDataJSON();
          expect(Array.isArray(calls)).toBe(true);
          const reply = calls.map((call: any) => {
            expect(['eth_chainId', 'eth_blockNumber']).toContain(call.method);
            reads.push(call.method);
            return {
              jsonrpc: '2.0',
              id: call.id,
              result: call.method === 'eth_chainId' ? '0x1644' : '0x1',
            };
          });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(reply),
          });
        }
      );
      await wallet.step('import the disposable synthetic wallet', async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
      });
      await wallet.step(
        'open Custom RPC through the ordinary network menu',
        async () => {
          await wallet!.page
            .getByRole('button')
            .filter({ hasText: /UTXO|EVM/ })
            .first()
            .click();
          await wallet!.page
            .getByRole('menuitem', {
              name: en.networkMenu.customRpc,
              exact: true,
            })
            .click();
          await expect(wallet!.page).toHaveURL(
            /#\/settings\/networks\/custom-rpc$/
          );
        }
      );
      const page = wallet.page;
      const label = page.getByRole('combobox', {
        name: en.settings.label,
        exact: true,
      });
      await wallet.step(
        'hold the first real RPC read and inspect progress',
        async () => {
          await label.fill('QA122');
          await page
            .getByRole('option', { name: /QA122 Delayed Network/ })
            .click();
          await expect.poll(() => firstSeen).toBe(true);
          await expect(
            page.getByRole('button', { name: en.buttons.save, exact: true })
          ).toBeDisabled();
          const progressLabel = page.getByText('Testing RPC 1 of 2', {
            exact: true,
          });
          await expect(progressLabel).toBeVisible();
          const card = progressLabel.locator('..').locator('..').locator('..');
          const initialBounds = await card.boundingBox();
          if (!initialBounds) throw new Error('Progress card is missing');
          await page.mouse.move(
            width / 2,
            Math.min(160, (width === 400 ? 620 : 360) / 2)
          );
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const current = await card.boundingBox();
            if (
              current &&
              current.y >= 56 &&
              current.y + current.height <= (width === 400 ? 620 : 360) - 76
            )
              break;
            await page.mouse.wheel(0, -80);
          }
          const observed = await card.evaluate((node) => {
            const parse = (value: string) => {
              const match = value.match(/[\d.]+/g);
              if (!match || match.length < 3)
                throw new Error('Unsupported color ' + value);
              return [
                Number(match[0]),
                Number(match[1]),
                Number(match[2]),
                match[3] === undefined ? 1 : Number(match[3]),
              ];
            };
            const compose = (front: number[], back: number[]) => [
              front[0] * front[3] + back[0] * (1 - front[3]),
              front[1] * front[3] + back[1] * (1 - front[3]),
              front[2] * front[3] + back[2] * (1 - front[3]),
              1,
            ];
            const background = (element: Element) => {
              const layers: number[][] = [];
              for (
                let current: Element | null = element;
                current;
                current = current.parentElement
              ) {
                const style = getComputedStyle(current);
                if (
                  style.backgroundImage !== 'none' ||
                  Number(style.opacity) !== 1 ||
                  style.filter !== 'none'
                )
                  throw new Error(
                    'Unsupported non-solid/transparent-opacity ancestor'
                  );
                const rgba = parse(style.backgroundColor);
                layers.push(rgba);
                if (rgba[3] === 1) break;
              }
              return layers
                .reverse()
                .reduce(
                  (back, front) => compose(front, back),
                  [255, 255, 255, 1]
                );
            };
            const luminance = (rgb: number[]) =>
              rgb
                .slice(0, 3)
                .map((value) => value / 255)
                .map((value) =>
                  value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4
                )
                .reduce(
                  (sum, value, index) =>
                    sum + value * [0.2126, 0.7152, 0.0722][index],
                  0
                );
            const ratio = (a: number[], b: number[]) =>
              (Math.max(luminance(a), luminance(b)) + 0.05) /
              (Math.min(luminance(a), luminance(b)) + 0.05);
            const arc = node.querySelector('.animate-spin') as HTMLElement;
            const track = node.lastElementChild as HTMLElement;
            const fill = track.firstElementChild as HTMLElement;
            if (!arc || !fill) throw new Error('Missing real progress nodes');
            const arcPaint = parse(getComputedStyle(arc).borderBottomColor),
              fillPaint = parse(getComputedStyle(fill).backgroundColor);
            const arcBg = background(node),
              trackBg = background(track);
            const bounds = (element: Element) => {
              const rect = element.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              };
            };
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2
            );
            return {
              arcPaint,
              fillPaint,
              arcBg,
              trackBg,
              arcRatio: ratio(compose(arcPaint, arcBg), arcBg),
              fillRatio: ratio(compose(fillPaint, trackBg), trackBg),
              arc: bounds(arc),
              fill: bounds(fill),
              track: bounds(track),
              card: bounds(node),
              nativeHit: !!hit && node.contains(hit),
              arcLayoutWidth: arc.offsetWidth,
              arcLayoutHeight: arc.offsetHeight,
            };
          });
          await snapshot(page, info, `rpc-progress-${width}-held`, {
            ...observed,
            runtime: extensionEvidence(),
            reads,
          });
          expect(observed.arcLayoutWidth).toBe(20);
          expect(observed.arcLayoutHeight).toBe(20);
          expect(observed.fill.height).toBe(8);
          expect(observed.nativeHit).toBe(true);
          expect(observed.card.y).toBeGreaterThanOrEqual(56);
          expect(observed.card.y + observed.card.height).toBeLessThanOrEqual(
            (width === 400 ? 620 : 360) - 76
          );
          expect(observed.arcRatio).toBeGreaterThanOrEqual(3);
          expect(observed.fillRatio).toBeGreaterThanOrEqual(3);
        }
      );
      const fields = async () => ({
        label: await label.inputValue(),
        chainId: await page.locator('#rpc_chainId').inputValue(),
        symbol: await page.locator('#rpc_symbol').inputValue(),
        url: await page.locator('#rpc_url').inputValue(),
      });
      const newerDraft = await fields();
      await snapshot(page, info, 'pending-original-rpc-fields', newerDraft);
      await wallet.step(
        'release the first read and retain the healthy second RPC',
        async () => {
          releaseFirst();
          await expect.poll(() => firstResponded).toBe(true);
          await expect(
            page.getByRole('button', { name: en.buttons.save, exact: true })
          ).toBeEnabled({ timeout: 15000 });
          const afterOldCheck = await fields();
          await snapshot(page, info, 'healthy-fallback-fields', {
            newerDraft,
            afterOldCheck,
            reads,
            text: await page.locator('body').innerText(),
            runtime: extensionEvidence(),
          });
          expect(routes.deniedWrites).toEqual([]);
          expect(afterOldCheck).toEqual({
            label: 'QA122 Delayed Network',
            chainId: '5700',
            symbol: 'OLD',
            url: 'https://qa122-second.invalid/rpc',
          });
          expect(
            reads.filter((method) => method === 'eth_chainId')
          ).toHaveLength(3);
          await expect(
            page.getByText(/Connected to QA122 Delayed Network/)
          ).toBeVisible();
          await expect(
            page.getByText('Testing RPC 1 of 2', { exact: true })
          ).toHaveCount(0);
        }
      );
      await wallet.step(
        'preserve read-only boundaries and exact runtime identity',
        async () => {
          expect(routes.deniedWrites).toEqual([]);
          expect(extensionEvidence().sourceRevision).toBe(
            process.env.PALI_TEST_DAPP_REVISION
          );
        }
      );
      status = 'passed';
    } finally {
      releaseFirst();
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, before);
        }
      }
    }
  });
}
