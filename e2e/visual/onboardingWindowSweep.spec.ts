import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { launchExtension } from '../harness/launch';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const sizes = [
  { width: 320, height: 360 },
  { width: 400, height: 360 },
  { width: 400, height: 480 },
  { width: 400, height: 600 },
];

const exposed = (control: Locator) =>
  control.evaluate((element) => {
    const r = element.getBoundingClientRect();
    if (
      r.width <= 0 ||
      r.height <= 0 ||
      r.left < 0 ||
      r.top < 0 ||
      r.right > innerWidth ||
      r.bottom > innerHeight
    )
      return false;
    return [
      [r.left + 2, r.top + r.height / 2],
      [r.right - 2, r.top + r.height / 2],
      [r.left + r.width / 2, r.top + 2],
      [r.left + r.width / 2, r.bottom - 2],
    ].every(([x, y]) => {
      const target = document.elementFromPoint(x, y);
      return target && (target === element || element.contains(target));
    });
  });

const wheelTo = async (page: Page, control: Locator) => {
  for (let attempt = 0; attempt < 8 && !(await exposed(control)); attempt++) {
    const viewport = page.viewportSize()!;
    const rect = await control.boundingBox();
    // Vertical scrolling cannot repair a horizontal layout overflow.
    if (rect && (rect.x < 0 || rect.x + rect.width > viewport.width)) break;
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, rect && rect.y < 0 ? -180 : 180);
    await page.waitForTimeout(100);
  }
};

const capture = async (
  page: Page,
  name: string,
  info: any,
  maskSecrets = true
) => {
  const directory = path.join(
    E2E_CONFIG.artifactsDir,
    'onboarding-window-sweep'
  );
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `${name}.png`);
  await page.screenshot({
    path: output,
    animations: 'disabled',
    mask: maskSecrets
      ? [
          page.locator(
            'input[type=password],textarea,div.select-none,button[class*="min-w-xs"]'
          ),
        ]
      : [],
  });
  await info.attach(name, { path: output, contentType: 'image/png' });
};

const inspectImportReveal = async (page: Page, info: any, state: string) => {
  const field = page.locator('#import-wallet-input');
  const reveal = field.locator('..').getByRole('button');
  await wheelTo(page, field);
  await wheelTo(page, reveal);
  expect(await exposed(field), `${state}: complete field exposed`).toBe(true);
  expect(await exposed(reveal), `${state}: reveal control exposed`).toBe(true);
  const fieldBox = (await field.boundingBox())!;
  const revealBox = (await reveal.boundingBox())!;
  await info.attach(`${state}-field-and-reveal-bounds`, {
    body: JSON.stringify({ field: fieldBox, reveal: revealBox }),
    contentType: 'application/json',
  });
  await capture(page, state, info, false);
  // The existing44px hit target must stay inside the actual textarea border,
  // including when AntD adds long inline validation feedback.
  expect(revealBox.width).toBe(44);
  expect(revealBox.height).toBe(44);
  expect.soft(revealBox.x).toBeGreaterThanOrEqual(fieldBox.x);
  expect.soft(revealBox.y).toBeGreaterThanOrEqual(fieldBox.y);
  expect
    .soft(revealBox.x + revealBox.width)
    .toBeLessThanOrEqual(fieldBox.x + fieldBox.width);
  expect
    .soft(revealBox.y + revealBox.height)
    .toBeLessThanOrEqual(fieldBox.y + fieldBox.height);
  if (state.includes('empty')) {
    const label = await reveal.getAttribute('aria-label');
    await reveal.focus();
    await expect(reveal).toBeFocused();
    await page.keyboard.press('Space');
    await expect(reveal).not.toHaveAttribute('aria-label', label!);
    await page.keyboard.press('Space');
    await expect(reveal).toHaveAttribute('aria-label', label!);
    await expect(page.locator('#import-wallet-action')).toBeDisabled();
  }
  // This helper is used only for empty or literal invalid public input.
  await capture(page, `${state}-keyboard`, info, false);
};

test('welcome, import and password setup stay reachable in small windows', async ({}, info) => {
  test.setTimeout(150000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
  });
  let launched: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    launched = await launchExtension('onboarding-window-sweep', {
      offlineHttpProxy: server.url,
      viewport: sizes[0],
    });
    const page =
      launched.context.pages()[0] || (await launched.context.newPage());
    const base = `chrome-extension://${launched.extensionId}/app.html`;
    for (const language of ['en', 'de']) {
      await page.goto(`${base}#/`);
      await page.evaluate(
        (locale) =>
          new Promise<void>((resolve) =>
            chrome.storage.local.set({ language: locale }, resolve)
          ),
        language
      );
      // A persisted language selection is read when the document starts.
      await page.reload();
      for (const size of sizes) {
        await page.setViewportSize(size);
        const suffix = `${language}-${size.width}x${size.height}`;
        for (const screen of [
          { route: '/', controls: ['#unlock-btn', '#import-wallet-link'] },
          {
            route: '/import',
            controls: ['#import-wallet-input', '#import-wallet-action'],
          },
          {
            route: '/create-password',
            controls: [
              '#create-password',
              '#confirm-password',
              '#create-password-action',
            ],
          },
        ]) {
          await page.goto(`${base}#${screen.route}`);
          await page.locator(screen.controls[0]).waitFor();
          await page.waitForTimeout(350);
          for (const selector of screen.controls) {
            const control = page.locator(selector);
            await wheelTo(page, control);
            expect
              .soft(
                await exposed(control),
                `${screen.route} ${selector} reachable ${suffix}`
              )
              .toBe(true);
          }
          if (screen.route === '/') {
            await page.locator('#unlock-btn').focus();
            await page.keyboard.press('Tab');
            await expect(page.locator('#import-wallet-link')).toBeFocused();
          } else {
            const home = page
              .locator('button')
              .filter({ has: page.locator('.anticon-home') });
            await wheelTo(page, home);
            expect
              .soft(
                await exposed(home),
                `onboarding Home ${screen.route} ${suffix}`
              )
              .toBe(true);
          }
          await capture(
            page,
            `${screen.route.replace(/\//g, '') || 'welcome'}-${suffix}`,
            info
          );
          if (screen.route === '/import') {
            await expect(page.locator('#import-wallet-input')).toHaveAttribute(
              'aria-label',
              (language === 'de' ? de : en).import.pasteYourWalletSeed
            );
            await inspectImportReveal(
              page,
              info,
              `import-empty-field-${suffix}`
            );
            // Public synthetic mnemonics only: exercise native textarea scrolling
            // after focus/Home has settled, with the same control at both sizes.
            const seedField = page.locator('#import-wallet-input');
            const seed24 = [...Array(23).fill('abandon'), 'art'].join(' \n');
            const seed12 = UTXO_FIXTURE_SEED.split(' ').join(' \n');
            for (const [name, seed] of [
              ['24', seed24],
              ['12', seed12],
            ] as const) {
              await seedField.fill(seed);
              await expect(page.locator('#import-wallet-action')).toBeEnabled();
              await wheelTo(page, seedField);
              await seedField.focus();
              await page.keyboard.press(
                process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'
              );
              await page.keyboard.press('Home');
              await page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve())
                    )
                  )
              );
              const start = await seedField.evaluate(
                (element: HTMLTextAreaElement) => ({
                  caret: element.selectionStart,
                  scrollTop: element.scrollTop,
                  scrollHeight: element.scrollHeight,
                  clientHeight: element.clientHeight,
                })
              );
              expect(start.caret, `${name}-word start caret ${suffix}`).toBe(0);
              expect(
                start.scrollTop,
                `${name}-word initial scroll ${suffix}`
              ).toBeLessThanOrEqual(1);
              expect(
                start.scrollHeight,
                `${name}-word overflow ${suffix}`
              ).toBeGreaterThan(start.clientHeight);
              const rect = (await seedField.boundingBox())!;
              const point = {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
              };
              await page.mouse.move(point.x, point.y);
              const hit = await page.evaluate(({ x, y }) => {
                const field = document.querySelector('#import-wallet-input');
                return document.elementFromPoint(x, y) === field;
              }, point);
              expect(hit, `${name}-word wheel targets textarea ${suffix}`).toBe(
                true
              );
              await seedField.evaluate((element: HTMLTextAreaElement) => {
                (window as any).__seedWheelTarget = false;
                element.addEventListener(
                  'wheel',
                  (event) => {
                    (window as any).__seedWheelTarget =
                      event.target === element;
                  },
                  { once: true }
                );
              });
              await page.mouse.wheel(0, 120);
              await expect
                .poll(() =>
                  seedField.evaluate(
                    (element: HTMLTextAreaElement) => element.scrollTop
                  )
                )
                .toBeGreaterThan(start.scrollTop);
              expect(
                await page.evaluate(() => (window as any).__seedWheelTarget)
              ).toBe(true);
              const wheel = await seedField.evaluate(
                (element: HTMLTextAreaElement) => ({
                  scrollTop: element.scrollTop,
                  overflowY: getComputedStyle(element).overflowY,
                })
              );
              expect(wheel.overflowY).toBe('auto');
              await seedField.focus();
              await page.keyboard.press(
                process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
              );
              await expect
                .poll(
                  () =>
                    seedField.evaluate(
                      (element: HTMLTextAreaElement) =>
                        element.selectionStart === element.value.length &&
                        element.scrollTop >=
                          element.scrollHeight - element.clientHeight - 2
                    ),
                  { message: `${name}-word native End settles ${suffix}` }
                )
                .toBe(true);
              const end = await seedField.evaluate(
                (element: HTMLTextAreaElement) => ({
                  caret: element.selectionStart,
                  length: element.value.length,
                  scrollTop: element.scrollTop,
                  maxScroll: element.scrollHeight - element.clientHeight,
                })
              );
              expect(end.caret, `${name}-word end caret ${suffix}`).toBe(
                end.length
              );
              expect(
                end.scrollTop,
                `${name}-word end scroll ${suffix}`
              ).toBeGreaterThanOrEqual(end.maxScroll - 2);
              await page.keyboard.press(
                process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
              );
              const selection = await seedField.evaluate(
                (element: HTMLTextAreaElement) => ({
                  start: element.selectionStart,
                  end: element.selectionEnd,
                  length: element.value.length,
                })
              );
              expect(selection.start).toBe(0);
              expect(selection.end).toBe(selection.length);
              await info.attach(`import-seed-wheel-${name}-${suffix}`, {
                contentType: 'application/json',
                body: JSON.stringify({
                  point,
                  hit,
                  start,
                  wheel,
                  end,
                  selection,
                }),
              });
              await capture(page, `import-seed-wheel-${name}-${suffix}`, info);
            }
            await page.locator('#import-wallet-input').fill('one two three');
            await page.waitForTimeout(150);
            await page.locator('#import-wallet-input').press('Tab');
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            const panel = dialog.locator('[id^="headlessui-dialog-panel-"]');
            const panelBox = (await panel.boundingBox())!;
            expect
              .soft(panelBox.x, `import warning left edge ${suffix}`)
              .toBeGreaterThanOrEqual(0);
            expect
              .soft(
                panelBox.x + panelBox.width,
                `import warning right edge ${suffix}`
              )
              .toBeLessThanOrEqual(size.width);
            const close = dialog.getByRole('button');
            await wheelTo(page, close);
            expect
              .soft(await exposed(close), `import warning close ${suffix}`)
              .toBe(true);
            // The field contains only the literal invalid test text above.
            // Masking an occluded textarea would paint over the actual dialog.
            await capture(page, `import-warning-${suffix}`, info, false);
            await page.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible();
            await inspectImportReveal(
              page,
              info,
              `import-error-field-${suffix}`
            );
          }
        }
      }
    }
  } finally {
    await launched?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('locked wallet and recovery warning remain readable and operable', async ({}, info) => {
  test.setTimeout(150000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'WindowSweepSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('locked-window-sweep', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 600 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'CONTROLLER_ACTION',
              data: { methods: ['wallet', 'lock'], params: [] },
            },
            (result) =>
              result?.error ? reject(new Error(result.error)) : resolve()
          );
        })
    );
    for (const size of sizes) {
      await page.setViewportSize(size);
      await wallet.gotoRoute('#/');
      await page.locator('#password').waitFor();
      const suffix = `${size.width}x${size.height}`;
      for (const selector of [
        '#password',
        '#unlock-btn',
        '#import-wallet-link',
      ]) {
        const control = page.locator(selector);
        await wheelTo(page, control);
        expect
          .soft(await exposed(control), `locked ${selector} ${suffix}`)
          .toBe(true);
      }
      await capture(page, `locked-${suffix}`, info);
      await page.locator('#import-wallet-link').click();
      await page.locator('#cancel-import-btn').waitFor();
      for (const selector of ['#cancel-import-btn', '#confirm-import-btn']) {
        const control = page.locator(selector);
        await wheelTo(page, control);
        expect
          .soft(await exposed(control), `recovery ${selector} ${suffix}`)
          .toBe(true);
      }
      await capture(page, `recovery-warning-${suffix}`, info);
      await page.locator('#cancel-import-btn').click();

      const errorText =
        'The synthetic wallet could not be unlocked. Please check your password and try again. This local test did not unlock an account or send a transaction.';
      await page.evaluate((message) => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = ((...args: any[]) => {
          if (
            args[0]?.type === 'CONTROLLER_ACTION' &&
            args[0]?.data?.methods?.[1] === 'unlockFromController'
          ) {
            if (typeof args[1] === 'function') {
              queueMicrotask(() => args[1]({ error: message }));
              return;
            }
            return Promise.resolve({ error: message });
          }
          return (original as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        (window as any).__restoreOnboardingMessage = () => {
          chrome.runtime.sendMessage = original;
        };
      }, errorText);
      await page.locator('#password').fill('WrongSyntheticOnly!2026');
      await wheelTo(page, page.locator('#unlock-btn'));
      await page.locator('#unlock-btn').click();
      const error = page.getByText(errorText, { exact: true });
      await expect(error).toBeVisible();
      // The first Form.Item error expands with a finite height animation. A
      // visible message can still move the recovery link after an exposure
      // probe, so scroll only once the real validation layout has settled.
      await expect
        .poll(
          () =>
            page.locator('#login').evaluate((form) => {
              const pendingValidationMotion = Array.from(
                form.querySelectorAll('[class]')
              ).some((element) =>
                Array.from(element.classList).some((name) =>
                  /^ant-form-show-help(?:-item)?-(?:appear|enter|leave)(?:-|$)/.test(
                    name
                  )
                )
              );
              return (
                !pendingValidationMotion &&
                form
                  .getAnimations({ subtree: true })
                  .filter(
                    (animation) =>
                      animation.effect?.getTiming().iterations !== Infinity
                  )
                  .every(
                    (animation) =>
                      !animation.pending && animation.playState !== 'running'
                  )
              );
            }),
          { timeout: 3000 }
        )
        .toBe(true);
      await wheelTo(page, error);
      expect
        .soft(await exposed(error), `unlock error readable ${suffix}`)
        .toBe(true);
      await wheelTo(page, page.locator('#import-wallet-link'));
      expect
        .soft(
          await exposed(page.locator('#import-wallet-link')),
          `recovery still reachable after unlock error ${suffix}`
        )
        .toBe(true);
      await capture(page, `locked-error-${suffix}`, info);
      await page.locator('#import-wallet-link').click();
      await expect(page.locator('#cancel-import-btn')).toBeVisible();
      await page.locator('#cancel-import-btn').click();
      await page.evaluate(() => (window as any).__restoreOnboardingMessage());
    }

    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          chrome.storage.local.set({ language: 'de' }, resolve)
        )
    );
    await page.reload();
    await page.setViewportSize({ width: 320, height: 360 });
    await page.locator('#password').waitFor();
    for (const selector of [
      '#password',
      '#unlock-btn',
      '#import-wallet-link',
    ]) {
      const control = page.locator(selector);
      await wheelTo(page, control);
      expect
        .soft(await exposed(control), `translated locked ${selector} 320x360`)
        .toBe(true);
    }
    await capture(page, 'locked-de-320x360', info);
    await page.locator('#import-wallet-link').click();
    await page.locator('#cancel-import-btn').waitFor();
    for (const selector of ['#cancel-import-btn', '#confirm-import-btn']) {
      const control = page.locator(selector);
      await wheelTo(page, control);
      expect
        .soft(await exposed(control), `translated recovery ${selector} 320x360`)
        .toBe(true);
    }
    await capture(page, 'recovery-warning-de-320x360', info);
    await page.locator('#cancel-import-btn').click();

    // Exercise the real recovery-failure view without replacing even the
    // disposable vault: only the final recovery call is locally rejected.
    await page.setViewportSize({ width: 400, height: 600 });
    await page.locator('#import-wallet-link').click();
    await page.locator('#confirm-import-btn').click();
    await page.locator('#import-wallet-input').fill(UTXO_FIXTURE_SEED);
    await page.locator('#import-wallet-action').click();
    await page.locator('#create-password').waitFor();
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((...args: any[]) => {
        if (
          args[0]?.type === 'CONTROLLER_ACTION' &&
          args[0]?.data?.methods?.[1] === 'recoverWalletFromSeed'
        ) {
          if (typeof args[1] === 'function') {
            queueMicrotask(() =>
              args[1]({ error: 'Synthetic recovery rejection' })
            );
            return;
          }
          return Promise.resolve({ error: 'Synthetic recovery rejection' });
        }
        return (original as any)(...args);
      }) as typeof chrome.runtime.sendMessage;
    });
    await page.locator('#create-password').fill('UnappliedSynthetic!2026');
    await page.locator('#confirm-password').fill('UnappliedSynthetic!2026');
    await page.locator('#create-password-action').click();
    const checkWallet = page.locator('#recovery-check-wallet');
    await checkWallet.waitFor();
    for (const size of sizes) {
      await page.setViewportSize(size);
      const focusGeometry = () =>
        checkWallet.evaluate((button) => {
          let owner: Element | null = button.parentElement;
          while (owner) {
            const style = getComputedStyle(owner);
            if (
              /(auto|scroll|overlay)/.test(style.overflowY) &&
              owner.scrollHeight > owner.clientHeight + 1
            )
              break;
            owner = owner.parentElement;
          }
          owner ??= document.scrollingElement;
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const ownerRect = owner?.getBoundingClientRect();
          return {
            focused: button === document.activeElement,
            focusVisible: button.matches(':focus-visible'),
            button: {
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
            },
            outline: {
              style: style.outlineStyle,
              width: style.outlineWidth,
              offset: style.outlineOffset,
            },
            viewport: { width: innerWidth, height: innerHeight },
            owner: owner && {
              tag: owner.tagName,
              id: owner.id,
              top: ownerRect?.top,
              bottom: ownerRect?.bottom,
              scrollTop: owner.scrollTop,
              scrollHeight: owner.scrollHeight,
              clientHeight: owner.clientHeight,
            },
          };
        });
      const attachFocusGeometry = async (phase: string) => {
        await info.attach(
          `recovery-focus-${phase}-${size.width}x${size.height}-geometry`,
          {
            body: JSON.stringify(await focusGeometry()),
            contentType: 'application/json',
          }
        );
      };
      // Reset the actual scroll owner with native input, then reach the real
      // control by Tab before scrolling down. Its visible box can hide a ring.
      await page.mouse.move(size.width / 2, size.height / 2);
      await page.mouse.wheel(0, -10000);
      await expect
        .poll(async () => (await focusGeometry()).owner?.scrollTop)
        .toBe(0);
      await page.mouse.click(5, 5);
      for (let attempt = 0; attempt < 12; attempt++) {
        await page.keyboard.press('Tab');
        if (
          await checkWallet.evaluate(
            (button) => button === document.activeElement
          )
        )
          break;
      }
      await attachFocusGeometry('native-tab');
      await expect(checkWallet).toBeFocused();
      const focusOutlineVisible = () =>
        checkWallet.evaluate((button) => {
          const style = getComputedStyle(button);
          const width = parseFloat(style.outlineWidth);
          const offset = parseFloat(style.outlineOffset);
          if (
            !button.matches(':focus-visible') ||
            style.outlineStyle === 'none' ||
            !Number.isFinite(width) ||
            !Number.isFinite(offset) ||
            width <= 0
          )
            return false;
          const rect = button.getBoundingClientRect();
          const outset = Math.max(0, width + offset);
          const outline = {
            left: rect.left - outset,
            top: rect.top - outset,
            right: rect.right + outset,
            bottom: rect.bottom + outset,
          };
          if (
            outline.left < 0 ||
            outline.top < 0 ||
            outline.right > innerWidth ||
            outline.bottom > innerHeight
          )
            return false;
          for (
            let parent = button.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const parentStyle = getComputedStyle(parent);
            const clip = parent.getBoundingClientRect();
            if (
              /(auto|scroll|hidden|clip)/.test(parentStyle.overflowX) &&
              (outline.left < clip.left || outline.right > clip.right)
            )
              return false;
            if (
              /(auto|scroll|hidden|clip)/.test(parentStyle.overflowY) &&
              (outline.top < clip.top || outline.bottom > clip.bottom)
            )
              return false;
          }
          return true;
        });
      await expect
        .poll(focusOutlineVisible, {
          message: `native Tab focus ${size.width}x${size.height}`,
        })
        .toBe(true);
      await page.mouse.move(size.width / 2, size.height / 2);
      await page.mouse.wheel(0, 10000);
      await expect
        .poll(async () => {
          const { owner } = await focusGeometry();
          return (
            !!owner &&
            Math.abs(
              owner.scrollHeight - owner.clientHeight - owner.scrollTop
            ) < 1
          );
        })
        .toBe(true);
      await attachFocusGeometry('max-scroll');
      await expect(checkWallet).toBeFocused();
      await expect
        .poll(focusOutlineVisible, {
          message: `max-scroll focus ${size.width}x${size.height}`,
        })
        .toBe(true);
      await wheelTo(page, checkWallet);
      expect
        .soft(
          await exposed(checkWallet),
          `recovery failure retry ${size.width}x${size.height}`
        )
        .toBe(true);
      await capture(
        page,
        `recovery-failure-${size.width}x${size.height}`,
        info
      );
    }
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
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

test('new-wallet 24-word backup and confirmation have no inaccessible controls', async ({}, info) => {
  test.setTimeout(90000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
  });
  let launched: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    launched = await launchExtension('new-seed-window-sweep', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 600 },
    });
    const page =
      launched.context.pages()[0] || (await launched.context.newPage());
    await page.goto(
      `chrome-extension://${launched.extensionId}/app.html#/create-password`
    );
    await page.locator('#create-password').fill('UnusedSyntheticOnly!2026');
    await page.locator('#confirm-password').fill('UnusedSyntheticOnly!2026');
    await page.locator('#create-password-action').click();
    await expect(page).toHaveURL(/#\/phrase$/);
    await page.getByRole('combobox').selectOption('24');
    await expect(page.locator('input[type="checkbox"]')).toBeEnabled();
    await page
      .getByRole('button', { name: en.import.showSeedPhrase, exact: true })
      .click();
    await expect(page.locator('div.select-none p')).toHaveCount(24);
    for (const size of sizes) {
      await page.setViewportSize(size);
      const checkbox = page.locator('input[type="checkbox"]');
      await wheelTo(page, checkbox);
      expect
        .soft(
          await exposed(checkbox),
          `backup acknowledgement ${size.width}x${size.height}`
        )
        .toBe(true);
      expect
        .soft(
          await exposed(page.locator('#unlock-btn')),
          `backup Next ${size.width}x${size.height}`
        )
        .toBe(true);
      await capture(page, `backup-24-${size.width}x${size.height}`, info);
    }
    await page.setViewportSize({ width: 400, height: 600 });
    await page.locator('input[type="checkbox"]').check();
    await page.locator('#unlock-btn').click();
    await page.getByRole('button', { name: 'Validate', exact: true }).waitFor();
    for (const size of sizes) {
      await page.setViewportSize(size);
      const words = page
        .locator('section')
        .filter({ has: page.getByRole('button') })
        .last()
        .getByRole('button');
      const last = words.last();
      await wheelTo(page, last);
      expect
        .soft(
          await exposed(last),
          `24th confirmation word ${size.width}x${size.height}`
        )
        .toBe(true);
      await capture(page, `confirm-24-${size.width}x${size.height}`, info);
    }
  } finally {
    await launched?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, before);
  }
});

test('hardware entry and device instructions fit narrow and short windows', async ({}, info) => {
  test.setTimeout(120000);
  const before = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath:
      process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'HardwareLayoutSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('hardware-window-sweep', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 600 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const device of ['trezor', 'ledger']) {
        await wallet.gotoRoute('#/home');
        await wallet.gotoRoute('#/external/settings/account/hardware');
        const selector = page.locator(`#${device}-btn`);
        await wheelTo(page, selector);
        expect
          .soft(
            await exposed(selector),
            `${device} selection ${size.width}x${size.height}`
          )
          .toBe(true);
        await capture(
          page,
          `hardware-${device}-entry-${size.width}x${size.height}`,
          info
        );
        await selector.click();
        const connect = page.locator('#connect-btn');
        await wheelTo(page, connect);
        expect
          .soft(
            await exposed(connect),
            `${device} Connect ${size.width}x${size.height}`
          )
          .toBe(true);
        const cancel = page.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });
        await wheelTo(page, cancel);
        expect
          .soft(
            await exposed(cancel),
            `${device} Cancel ${size.width}x${size.height}`
          )
          .toBe(true);
        await capture(
          page,
          `hardware-${device}-instructions-${size.width}x${size.height}`,
          info
        );
        // This is an entry-layout check only: do not request an actual device
        // or imitate a successful hardware import or signature.
      }
    }
    expect(routes.deniedWrites).toEqual([]);
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
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
