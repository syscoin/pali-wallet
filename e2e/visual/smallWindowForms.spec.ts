import { type Locator, type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Include an input's visible frame, not just its smaller text-editing area.
const fieldFrame = (input: Locator) =>
  input.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-input-affix-wrapper ")][1]'
  );

const fullyExposed = (control: Locator) =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const points = [
      [box.left + box.width / 2, box.top + 3],
      [box.left + box.width / 2, box.bottom - 3],
      [box.left + 3, box.top + box.height / 2],
      [box.right - 3, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + box.height / 2],
    ];
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.left >= 0 &&
      box.top >= 0 &&
      box.right <= innerWidth &&
      box.bottom <= innerHeight &&
      points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === element || element.contains(hit));
      })
    );
  });

const wheelToField = async (page: Page, frame: Locator) => {
  // Only native wheel input changes scroll position. The following assertion
  // does not ask Playwright to click or auto-scroll an obscured control.
  await page.mouse.move(200, 180);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await fullyExposed(frame)) return;
    const box = (await frame.boundingBox())!;
    await page.mouse.wheel(0, box.y - 140);
    await page.waitForTimeout(100);
  }
};

test('small wallet forms keep complete fields and actions exposed through resize and validation', async ({}, info) => {
  test.setTimeout(120_000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    ...(process.env.PALI_TEST_DAPP_EXTENSION_PATH
      ? { extensionPath: process.env.PALI_TEST_DAPP_EXTENSION_PATH }
      : {}),
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SmallWindowSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  const errors: string[] = [];
  const directory =
    process.env.PALI_SMALL_WINDOW_OUTPUT ||
    path.join(E2E_CONFIG.artifactsDir, 'small-window-forms');
  fs.mkdirSync(directory, { recursive: true });
  const capture = async (page: Page, name: string) => {
    const file = path.join(directory, `${name}.png`);
    await page.screenshot({
      path: file,
      animations: 'disabled',
      mask: [page.locator('input[type=password]')],
    });
    await info.attach(name, { path: file, contentType: 'image/png' });
  };
  try {
    wallet = await PaliWallet.launch('small-window-forms', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const page = wallet.page;
    page.on('pageerror', (error) => errors.push(error.message));
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    // Longer localized copy exposed the password/footer collision.
    await wallet.gotoRoute('#/settings/languages');
    const language = page.getByRole('button', {
      name: en.settings.setYourPreferredLanguage,
    });
    await language.click();
    await expect(page.getByRole('menu')).toBeFocused();
    await page.keyboard.type('ger');
    await page.keyboard.press('Enter');
    await page
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    for (const route of ['settings/account/import', 'settings/forget-wallet']) {
      await wallet.gotoRoute(`#/${route}`);
      const importing = route.endsWith('import');
      const input = page.locator(
        importing ? '#import-account-identifier' : '#forget_password'
      );
      const frame = fieldFrame(input);
      const action = page.getByRole('button', {
        name: importing ? de.buttons.import : de.buttons.forget,
        exact: true,
      });
      await expect(frame).toBeVisible();

      for (const height of [620, 480, 360, 480, 620]) {
        await page.setViewportSize({ width: 400, height });
        const inputs = importing
          ? [page.locator('#account-name-input'), input]
          : [input];
        for (const field of inputs) {
          const fullFrame = fieldFrame(field);
          await wheelToField(page, fullFrame);
          expect(
            await fullyExposed(fullFrame),
            `${route}: complete ${await field.getAttribute(
              'id'
            )} frame is unobscured at 400x${height}`
          ).toBe(true);
          await field.focus();
          await expect(field).toBeFocused();
          expect(
            await fullyExposed(fullFrame),
            'Focus does not hide field edges'
          ).toBe(true);
        }
        if (importing && height === 360) {
          await input.fill('synthetic-invalid-private-key');
          await input.blur();
          await expect(
            page.locator('.ant-form-item-explain-error')
          ).toBeVisible();
          await wheelToField(page, frame);
          expect(
            await fullyExposed(frame),
            'Validation growth does not cover the complete input frame'
          ).toBe(true);
        }
        await page.mouse.move(200, 180);
        await page.mouse.wheel(0, 3000);
        await expect
          .poll(() => fullyExposed(action), {
            message: `${route}: full primary action visible after native scroll at 400x${height}`,
          })
          .toBe(true);
        if (height === 620) {
          const box = (await action.boundingBox())!;
          // All shared page actions now use the same 24px bottom inset.
          expect(height - box.y - box.height).toBeCloseTo(24, 0);
          expect(box.height).toBeCloseTo(40, 0);
        }
        await capture(page, `${importing ? 'import' : 'forget'}-400x${height}`);
      }
    }
    expect(errors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
  } catch (error) {
    if (wallet) await capture(wallet.page, 'failure').catch(() => undefined);
    throw error;
  } finally {
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});
