import { expect, test, type Locator, type TestInfo } from '@playwright/test';
import { utils as sys } from 'syscoinjs-lib';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_PATH,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function observeDisclosure(
  target: Locator,
  info: TestInfo,
  name: string
) {
  const page = target.page();
  await target.scrollIntoViewIfNeeded();
  for (let i = 0; i < 20; i++) {
    const visible = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const bottom =
        document.querySelector('.fixed.bottom-0')?.getBoundingClientRect()
          .top ?? innerHeight;
      return {
        okay: r.top >= 0 && r.bottom <= bottom - 2,
        delta: r.bottom - bottom + 16,
      };
    });
    if (visible.okay) break;
    await page.mouse.move(12, 110);
    await page.mouse.wheel(0, Math.max(60, Math.min(160, visible.delta)));
  }
  const read = () =>
    target
      .locator('span')
      .last()
      .evaluate((el) => {
        const parse = (x: string) => {
          const m = x.match(/^rgba?\(([^)]+)\)$/);
          if (!m) throw new Error('Unexpected color ' + x);
          return m[1]
            .split(/[ ,/]+/)
            .filter(Boolean)
            .map(Number);
        };
        let bg: number[] | undefined;
        const layers = [];
        for (let n: Element | null = el; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (
            s.opacity !== '1' ||
            s.filter !== 'none' ||
            s.mixBlendMode !== 'normal'
          )
            throw new Error('Unsupported compositing');
          const color = parse(s.backgroundColor);
          if (!bg && color[3] !== 0) {
            if (color.length === 4 && color[3] !== 1)
              throw new Error('Non-opaque backing');
            bg = color;
          }
          if (!bg && s.backgroundImage !== 'none')
            throw new Error('Non-solid backing');
          layers.push({
            tag: n.tagName,
            color: s.color,
            background: s.backgroundColor,
          });
        }
        if (!bg) throw new Error('No backing');
        const fg = parse(getComputedStyle(el).color);
        const caret = el.closest('button')!.querySelector('svg path')!;
        const caretFill = getComputedStyle(caret).fill;
        const lum = (c: number[]) =>
          [0.2126, 0.7152, 0.0722].reduce((v, w, i) => {
            const n = c[i] / 255;
            return (
              v + w * (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
            );
          }, 0);
        const a = lum(fg),
          b = lum(bg),
          rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return {
          text: el.textContent,
          color: getComputedStyle(el).color,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          caretFill,
          caretRatio:
            (Math.max(lum(parse(caretFill)), b) + 0.05) /
            (Math.min(lum(parse(caretFill)), b) + 0.05),
          layers,
          rect: rect.toJSON(),
          hovered: el.closest('button')?.matches(':hover'),
          hit: hit === el || el.contains(hit),
        };
      });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const rest = await read();
  expect(rest.hit).toBe(true);
  expect(rest.ratio).toBeGreaterThanOrEqual(4.5);
  expect(rest.caretRatio).toBeGreaterThanOrEqual(3);
  await info.attach(name + '-rest', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
  await target.locator('span').last().hover();
  await page.waitForTimeout(250);
  const hover = await read();
  expect(hover.hit).toBe(true);
  expect(hover.hovered).toBe(true);
  expect(hover.ratio).toBeGreaterThanOrEqual(4.5);
  expect(hover.caretRatio).toBeGreaterThanOrEqual(3);
  await info.attach(name + '-hover', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
  await info.attach(name + '-paint', {
    body: JSON.stringify({ rest, hover }),
    contentType: 'application/json',
  });
  return { rest, hover };
}

for (const width of [400, 320])
  test(`ordinary unsigned Send exposes every PSBT input to keyboard and pointer review at ${width}px`, async ({}, info) => {
    const previous = { ...E2E_CONFIG };
    const fixture = createUtxoFixture('100000');
    const parents = Array.from({ length: 4 }, (_, index) => {
      const parent = sys.bitcoinjs.Transaction.fromHex(
        fixture.parentTxs[0].toHex()
      );
      parent.ins[0].hash = Buffer.alloc(32, 30 + index);
      parent.outs[0].value = BigInt(25000);
      return parent;
    });
    fixture.parentTxs.push(...parents);
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PsbtKeyboardSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch('psbt-disclosure-keyboard-' + width, {
        offlineHttpProxy: server.url,
        viewport: { width, height: width === 400 ? 620 : 360 },
        recordVideo: false,
      });
      const routes = await installUtxoFixtureRoutes(
        wallet.context,
        fixture,
        server.url,
        {
          readState: () => ({
            utxos: parents.map((parent) => ({
              txid: parent.getId(),
              vout: 0,
              value: '25000',
              height: 1,
              confirmations: 1,
              address: fixture.userAddress,
              path: UTXO_FIXTURE_PATH,
            })),
          }),
        }
      );
      const page = wallet.page;
      await wallet.step(
        'prepare a four-input unsigned Send using normal UI',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#send-btn').click();
          await page
            .getByPlaceholder('Receiver', { exact: true })
            .fill(fixture.recipientAddress);
          await page.getByPlaceholder('Amount', { exact: true }).fill('0.0009');
          await page.locator('#fee-input').fill('0.00000001');
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          const advanced = page.getByRole('button', {
            name: 'Advanced Details',
            exact: true,
          });
          await advanced.focus();
          await page.keyboard.press('Enter');
          await expect(
            page.getByRole('button', { name: 'Inputs (4)', exact: true })
          ).toHaveAttribute('aria-expanded', 'false');
          await expect(
            page.getByRole('button', { name: 'Inputs (4)', exact: true })
          ).toHaveText('Inputs (4)');
          await expect(page.getByText('Input #3', { exact: true })).toHaveCount(
            0
          );
        }
      );

      const inputs = page.getByRole('button', {
        name: 'Inputs (4)',
        exact: true,
      });
      const paint = await observeDisclosure(inputs, info, 'inputs-' + width);
      await page.mouse.move(0, 0);
      await wallet.step(
        'Tab reaches inputs and Enter exposes all four rows',
        async () => {
          // Start at the real Advanced Details control; do not programmatically
          // focus the disclosure whose native keyboard accessibility is under test.
          await page
            .getByRole('button', { name: 'Advanced Details', exact: true })
            .focus();
          for (let index = 0; index < 60; index++) {
            await page.keyboard.press('Tab');
            if (
              await inputs.evaluate(
                (button) => button === document.activeElement
              )
            )
              break;
          }
          await expect(inputs).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(inputs).toHaveAttribute('aria-expanded', 'true');
          for (let index = 0; index < 4; index++)
            await expect(
              page.getByText(`Input #${index}`, { exact: true })
            ).toBeVisible();
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          expect(routes.deniedWrites).toEqual([]);
        }
      );

      await wallet.step(
        'Space collapses and mouse toggles the same review without submitting',
        async () => {
          await page.keyboard.press('Space');
          await expect(inputs).toHaveAttribute('aria-expanded', 'false');
          await expect(page.getByText('Input #3', { exact: true })).toHaveCount(
            0
          );
          await inputs.click();
          await expect(inputs).toHaveAttribute('aria-expanded', 'true');
          await expect(
            page.getByText('Input #3', { exact: true })
          ).toBeVisible();
          await inputs.click();
          await expect(inputs).toHaveAttribute('aria-expanded', 'false');
          await expect(
            page.getByRole('button', { name: 'Outputs (2)', exact: true })
          ).toHaveAttribute('aria-expanded', 'true');
          await expect(
            page.getByRole('button', { name: 'Outputs (2)', exact: true })
          ).toHaveText('Outputs (2)');
          await expect(
            page.getByRole('button', { name: 'Confirm', exact: true })
          ).toBeEnabled();
          expect(routes.deniedWrites).toEqual([]);
        }
      );

      await wallet.step('Cancel preserves the unsigned draft', async () => {
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await expect(
          page.getByPlaceholder('Amount', { exact: true })
        ).toHaveValue('0.0009');
        await expect(
          page.getByPlaceholder('Receiver', { exact: true })
        ).toHaveValue(fixture.recipientAddress);
        expect(routes.deniedWrites).toEqual([]);
      });
      await info.attach('psbt-disclosure-keyboard', {
        contentType: 'application/json',
        body: JSON.stringify({
          inputCount: 4,
          paint,
          parentTxids: parents.map((parent) => parent.getId()),
          keyboard: ['Tab', 'Enter', 'Space'],
          unsigned: true,
          deniedWrites: routes.deniedWrites,
        }),
      });
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
