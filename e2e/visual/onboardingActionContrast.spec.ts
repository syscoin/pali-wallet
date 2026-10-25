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
const password = 'BrightActionsSynthetic!2026';
const enabled = (button: Locator) =>
  expect
    .poll(async () => (await button.count()) === 1 && button.isEnabled())
    .toBe(true);

async function measure(
  page: Page,
  target: Locator,
  label: string,
  info: TestInfo
) {
  await enabled(target);
  for (const width of [400, 320]) {
    await page.setViewportSize({ width, height: width === 400 ? 620 : 360 });
    await target.scrollIntoViewIfNeeded();
    await page.mouse.move(width - 1, 1);
    const data = await target.evaluate(async (element) => {
      await document.fonts.ready;
      const animations = new Set<Animation>();
      for (let n: Element | null = element; n; n = n.parentElement)
        for (const animation of n.getAnimations())
          if (
            Number.isFinite(
              Number(animation.effect?.getComputedTiming().endTime)
            )
          )
            animations.add(animation);
      await Promise.all(
        [...animations].map((animation) =>
          animation.finished.catch(() => undefined)
        )
      );
      const css = getComputedStyle(element),
        layers = [];
      const background = css.backgroundColor;
      for (let n: Element | null = element; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        layers.push({
          tag: n.tagName,
          opacity: s.opacity,
          background: s.backgroundColor,
          filter: s.filter,
          blend: s.mixBlendMode,
        });
      }
      const light = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) =>
            n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
          );
        return rgb.reduce(
          (sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i],
          0
        );
      };
      const a = light(css.color),
        b = light(background);
      return {
        foreground: css.color,
        image: css.backgroundImage,
        background,
        fontSize: css.fontSize,
        fontWeight: css.fontWeight,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        layers,
        disabled: (element as HTMLButtonElement).disabled,
        bounds: element.getBoundingClientRect().toJSON(),
      };
    });
    expect(data.disabled).toBe(false);
    expect(data.image).toBe('none');
    expect(data.background).toMatch(/^rgb\(/);
    expect(
      data.layers.every(
        (layer) =>
          layer.opacity === '1' &&
          layer.filter === 'none' &&
          layer.blend === 'normal'
      )
    ).toBe(true);
    await info.attach(`${label}-${width}-colors`, {
      body: JSON.stringify(data),
      contentType: 'application/json',
    });
    // Target-only images cannot include surrounding password or phrase fields.
    // The selected-word control itself is masked because its text is a secret.
    await info.attach(`${label}-${width}-view`, {
      body: await target.screenshot({
        animations: 'disabled',
        mask: label === 'selected-word-control' ? [target] : [],
      }),
      contentType: 'image/png',
    });
    expect
      .soft(data.ratio, `${label} ${width}px enabled text`)
      .toBeGreaterThanOrEqual(4.5);
  }
}

for (const flow of ['create', 'import'] as const) {
  test(`normal ${flow} onboarding actions retain readable enabled text`, async ({}, info) => {
    test.setTimeout(120000);
    const previous = { ...E2E_CONFIG },
      noCopy = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password,
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`onboarding-action-contrast-${flow}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const page = wallet.page;
      if (flow === 'import') {
        await page.locator('#import-wallet-link').click();
        await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
        await measure(
          page,
          page.locator('#import-wallet-action'),
          'import-valid',
          info
        );
        await page.locator('#import-wallet-action').click();
      } else {
        await measure(page, page.locator('#unlock-btn'), 'get-started', info);
        await page.locator('#unlock-btn').click();
      }
      await page.locator('#create-password').fill(password);
      await page.locator('#confirm-password').fill(password);
      await measure(
        page,
        page.locator('#create-password-action'),
        `${flow}-password-valid`,
        info
      );
      if (flow === 'create') {
        await page.locator('#create-password-action').click();
        const generate = page.getByRole('button', {
          name: en.buttons.generate,
          exact: true,
        });
        await measure(page, generate, 'generate-control', info);
        await enabled(
          page.getByRole('button', {
            name: en.import.showSeedPhrase,
            exact: true,
          })
        );
        await page.locator('input[type=checkbox]').check();
        await measure(
          page,
          page.locator('#unlock-btn'),
          'phrase-acknowledged-next',
          info
        );
        await page.locator('#unlock-btn').click();
        const available = await page
          .locator('section:has(> button.min-w-xs)')
          .elementHandle();
        if (!available) throw new Error('Confirmation word pane not present');
        const count = (await available.$$('button.min-w-xs')).length;
        expect(count).toBe(12);
        for (let i = 0; i < count; i++) {
          const words = await available.$$('button.min-w-xs');
          await words[0].click();
        }
        await measure(
          page,
          page.locator('button.min-w-xs').last(),
          'selected-word-control',
          info
        );
        await measure(
          page,
          page.getByRole('button', { name: en.buttons.validate, exact: true }),
          'phrase-selected-validate',
          info
        );
        // Do not validate, create the wallet, export or sign anything.
      } else {
        await page.locator('#create-password-action').click();
        await expect(page).toHaveURL(/#\/home/, { timeout: 60000 });
        await wallet.ensureOnHome();
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: en.generalMenu.lock, exact: true })
          .click();
        await expect(page.locator('#login #password')).toHaveValue('');
        await measure(page, page.locator('#unlock-btn'), 'unlock', info);
        await page.locator('#import-wallet-link').click();
        await page.locator('#confirm-import-btn').click();
        await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
        await expect(page.locator('#import-wallet-action')).toHaveText(
          en.buttons.recoverWallet
        );
        await measure(
          page,
          page.locator('#import-wallet-action'),
          'recover-wallet',
          info
        );
        await page.goBack();
        await expect(page.locator('#login #password')).toBeVisible();
        // Leave the existing wallet locked; no recovery or secret export occurs.
      }
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
