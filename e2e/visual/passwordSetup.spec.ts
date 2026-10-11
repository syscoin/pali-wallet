import { type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { launchExtension } from '../harness/launch';

const passwordRoute = (extensionId: string) =>
  `chrome-extension://${extensionId}/app.html#/create-password`;

const waitForPasswordForm = async (page: Page) => {
  await expect(page.locator('#create-password')).toBeVisible();
  // Let the initial splash and button hover transitions finish before checking
  // hit targets or capturing empty fields.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
};

const nextIsVisibleHitTarget = (page: Page) =>
  page.locator('#create-password-action').evaluate((button) => {
    const box = button.getBoundingClientRect();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const target = document.elementFromPoint(centerX, centerY);
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.right <= window.innerWidth &&
      box.bottom <= window.innerHeight &&
      Boolean(target && (target === button || button.contains(target)))
    );
  });

const wheelToNext = async (page: Page) => {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height - 60);
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => nextIsVisibleHitTarget(page)).toBe(true);
};

// Exercise the actual production extension in fresh empty profiles. Never
// submit Next, import/create a wallet, sign or send a transaction.
test.describe('password setup scrolling', () => {
  test.setTimeout(60_000);

  test('compact popup reveals Next with the mouse wheel', async ({}, info) => {
    const { context, extensionId } = await launchExtension(
      'password-setup-compact',
      { viewport: { width: 400, height: 480 } }
    );
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(passwordRoute(extensionId));
      await waitForPasswordForm(page);
      expect(await nextIsVisibleHitTarget(page)).toBe(false);

      // Calling click(), scrollIntoView() or Tab here would conceal a hidden
      // body overflow regression by scrolling programmatically.
      await wheelToNext(page);
      await expect(page.locator('#create-password-action')).toBeDisabled();
      await info.attach('compact-password-empty-fields', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });

  test('generation error keeps Next reachable with the mouse wheel', async ({}, info) => {
    const { context, extensionId } = await launchExtension(
      'password-setup-generation-error',
      { viewport: { width: 400, height: 480 } }
    );
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(passwordRoute(extensionId));
      await waitForPasswordForm(page);
      await page.evaluate(() => {
        // Isolated renderer fault injection only; exercise the real error UI
        // without generating or recording any password.
        crypto.getRandomValues = () => {
          throw new Error('Synthetic password-generation failure');
        };
      });
      const suggestion = page.locator('form.password button[type="button"]');
      const box = (await suggestion.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(page.locator('#create-password')).toHaveValue('');
      await expect(page.locator('#confirm-password')).toHaveValue('');

      await wheelToNext(page);
      await expect(page.locator('#create-password-action')).toBeDisabled();
      await info.attach('password-generation-error-empty-fields', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });

  test('normal popup contains translated labels and reachable Next', async () => {
    const { context, extensionId } = await launchExtension(
      'password-setup-locales',
      { viewport: { width: 400, height: 620 } }
    );
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(passwordRoute(extensionId));
      await waitForPasswordForm(page);
      for (const language of [
        'en',
        'es',
        'pt',
        'fr',
        'de',
        'zh',
        'ja',
        'ko',
        'ru',
      ]) {
        await test.step(language, async () => {
          const translations = JSON.parse(
            fs.readFileSync(
              path.join(
                E2E_CONFIG.repoRoot,
                `source/assets/locales/${language}.json`
              ),
              'utf8'
            )
          );
          await page.evaluate(
            (locale) =>
              new Promise<void>((resolve) =>
                chrome.storage.local.set({ language: locale }, resolve)
              ),
            language
          );
          await page.reload();
          await expect(page.locator('#create-password')).toHaveAttribute(
            'placeholder',
            translations.components.newPassword
          );
          await waitForPasswordForm(page);
          const suggestion = page.locator(
            'form.password button[type="button"]'
          );
          await expect(suggestion).toHaveText(
            translations.components.suggestPassword
          );
          expect(
            await suggestion.evaluate((button) => {
              const box = button.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(button);
              const text = range.getBoundingClientRect();
              return (
                text.x >= box.x &&
                text.right <= box.right &&
                text.y >= box.y &&
                text.bottom <= box.bottom
              );
            })
          ).toBe(true);
          await wheelToNext(page);
          await expect(page.locator('#create-password-action')).toBeDisabled();
        });
      }
    } finally {
      await context.close();
    }
  });
});
