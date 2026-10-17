import { type Locator, type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import webpack from 'webpack';

import { E2E_CONFIG } from '../harness/config';

// These are the production React modal families, bundled with their real
// primitive, buttons, icons, translations, styles and fonts. Only unrelated
// wallet hooks receive inert adapters; no wallet or approval queue is started.
const families = [
  'default',
  'warning',
  'confirmation',
  'error',
  'status-success',
  'status-error',
  'status-warn',
  'wallet-ready',
  'account-created',
  'import-warning',
  'hardware-choice',
] as const;
const locales = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh'];
let server: http.Server;
let origin: string;
let outputDirectory: string;

const compileFixture = async () => {
  const root = E2E_CONFIG.repoRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-dialog-ui-'));
  outputDirectory = path.join(directory, 'dist');
  const entry = path.join(directory, 'entry.tsx');
  const hooks = path.join(directory, 'hooks.ts');
  const components = path.join(directory, 'components.ts');
  fs.writeFileSync(
    hooks,
    `
    const forbidden = () => { throw new Error('Wallet actions are forbidden in this visual fixture'); };
    export const useUtils = () => ({ alert: { error: forbidden, success: forbidden }, navigate: forbidden });
    export const useController = () => ({ controllerEmitter: forbidden });
    export const useOnboardingSecrets = () => ({ beginRecovery: forbidden });
  `
  );
  fs.writeFileSync(
    components,
    `
    export * from ${JSON.stringify(
      path.join(root, 'source/components/Button')
    )};
    export * from ${JSON.stringify(
      path.join(root, 'source/components/Dialog')
    )};
  `
  );
  fs.writeFileSync(
    entry,
    `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { BrowserRouter } from 'react-router-dom';
    import i18next from 'i18next';
    import { I18nextProvider } from 'react-i18next';
    import en from ${JSON.stringify(
      path.join(root, 'source/assets/locales/en.json')
    )};
    ${locales
      .filter((locale) => locale !== 'en')
      .map(
        (locale) =>
          `import ${locale} from ${JSON.stringify(
            path.join(root, `source/assets/locales/${locale}.json`)
          )};`
      )
      .join('\n')}
    import { DefaultModal, WarningModal, ConfirmationModal, ErrorModal } from ${JSON.stringify(
      path.join(root, 'source/components/Modal/Modal')
    )};
    import { StatusModal } from ${JSON.stringify(
      path.join(root, 'source/components/Modal/StatusModal')
    )};
    import { WalletReadyModal, CreatedAccountSuccessfully, ImportWalletWarning, ConnectHardwareWallet } from ${JSON.stringify(
      path.join(root, 'source/components/Modal/WarningBaseModal')
    )};
    import ${JSON.stringify(path.join(root, 'source/assets/styles/index.css'))};
    import ${JSON.stringify(path.join(root, 'source/assets/fonts/index.css'))};
    const query = new URLSearchParams(location.search);
    const family = query.get('family');
    const locale = query.get('locale') || 'en';
    const long = query.get('long') === 'true';
    const copy = { en, de, es, fr, ja, ko, pt, ru, zh }[locale];
    const title = query.has('locale')
      ? family === 'import-warning' ? copy.settings.recoveryTitle
      : family === 'error' ? copy.transactions.signatureFailed
      : copy.accountMenu.connectTrezor.toUpperCase()
      : long ? 'Review this longer synthetic account message before continuing' : 'Synthetic dialog';
    const description = long
      ? 'This is synthetic visual fixture content. Review the details before continuing. '.repeat(30)
      : 'This is synthetic visual fixture content.';
    i18next.init({ lng: locale, initImmediate: false, resources: Object.fromEntries(Object.entries({ en, de, es, fr, ja, ko, pt, ru, zh }).map(([key, translation]) => [key, { translation }])), interpolation: { escapeValue: false } });
    function Fixture() {
      const [show, setShow] = useState(false);
      const close = () => setShow(false);
      const props = { show, onClose: close, title, description, buttonText: 'Continue' };
      return <main className="min-h-screen bg-surface-base p-5 text-content-primary">
        <button id="fixture-open" onClick={() => setShow(true)}>Open synthetic dialog</button>
        {family === 'default' && <DefaultModal {...props} />}
        {family === 'warning' && <WarningModal {...props} warningMessage="Check the synthetic details carefully." />}
        {family === 'confirmation' && <ConfirmationModal {...props} onClick={close} />}
        {family === 'error' && <ErrorModal {...props} log={long ? 'Synthetic diagnostic details. '.repeat(50) : 'Synthetic diagnostic details.'} />}
        {family?.startsWith('status-') && <StatusModal {...props} status={family.slice(7)} />}
        {family === 'wallet-ready' && <WalletReadyModal {...props} phraseOne={description} />}
        {family === 'account-created' && <CreatedAccountSuccessfully {...props} phraseOne={description} phraseTwo="0x0000000000000000000000000000000000000064" />}
        {family === 'import-warning' && <ImportWalletWarning {...props} phraseOne={query.has('locale') ? copy.settings.recoveryIntro : description} phraseTwo={query.has('locale') ? copy.settings.recoverySeedHelp : 'This is a disposable component fixture.'} phraseThree={query.has('locale') ? copy.settings.recoveryLimitations : 'No recovery action will be submitted.'} />}
        {family === 'hardware-choice' && <ConnectHardwareWallet {...props} phraseOne={description} />}
      </main>;
    }
    createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18next}><BrowserRouter><Fixture /></BrowserRouter></I18nextProvider>);
  `
  );
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({
      context: root,
      devtool: false,
      entry,
      mode: 'production',
      optimization: { minimize: false },
      output: { filename: 'fixture.js', path: outputDirectory },
      module: {
        rules: [
          {
            exclude: /node_modules/,
            test: /\.[jt]sx?$/,
            use: {
              loader: require.resolve('babel-loader'),
              options: {
                babelrc: false,
                configFile: false,
                presets: [
                  [
                    require.resolve('@babel/preset-env'),
                    { targets: { chrome: '120' } },
                  ],
                  require.resolve('@babel/preset-react'),
                  require.resolve('@babel/preset-typescript'),
                ],
              },
            },
          },
          {
            test: /\.css$/,
            use: [
              require.resolve('style-loader'),
              {
                loader: require.resolve('css-loader'),
                options: { importLoaders: 1 },
              },
              {
                loader: require.resolve('postcss-loader'),
                options: {
                  postcssOptions: {
                    config: path.join(root, 'postcss.config.js'),
                  },
                },
              },
            ],
          },
          {
            test: /\.(svg|png|jpe?g|webp|woff2?|ttf)$/,
            type: 'asset/resource',
          },
        ],
      },
      plugins: [
        new webpack.NormalModuleReplacementPlugin(/^\.\.$/, (resource) => {
          if (resource.context === path.join(root, 'source/components/Modal'))
            resource.request = components;
        }),
      ],
      resolve: {
        alias: {
          'components/index$': components,
          'hooks/index$': hooks,
          'hooks/useController$': hooks,
          'hooks/useOnboardingSecrets$': hooks,
          assets: path.join(root, 'source/assets'),
          components: path.join(root, 'source/components'),
          hooks: path.join(root, 'source/hooks'),
          utils: path.join(root, 'source/utils'),
        },
        extensions: ['.tsx', '.ts', '.js', '.json'],
        modules: [path.join(root, 'node_modules'), 'node_modules'],
      },
      resolveLoader: { modules: [path.join(root, 'node_modules')] },
    });
    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error || stats?.hasErrors())
          reject(
            error || new Error(stats?.toString({ all: false, errors: true }))
          );
        else resolve();
      });
    });
  });
};

const inViewport = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2
    );
    return (
      box.x >= 0 &&
      box.y >= 0 &&
      box.right <= innerWidth &&
      box.bottom <= innerHeight &&
      !!hit &&
      (hit === element || element.contains(hit))
    );
  });

const contrast = (locator: Locator) =>
  locator.evaluate((element) => {
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.map(Number);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const blend = (foreground: number[], background: number[]) => [
      ...foreground
        .slice(0, 3)
        .map(
          (channel, index) =>
            channel * foreground[3] + background[index] * (1 - foreground[3])
        ),
      1,
    ];
    const parents: Element[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    )
      parents.unshift(current);
    const background = parents.reduce(
      (color, parent) =>
        blend(rgba(getComputedStyle(parent).backgroundColor), color),
      [255, 255, 255, 1]
    );
    const foreground = blend(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) =>
      color.slice(0, 3).reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum +
          (value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]
        );
      }, 0);
    const a = luminance(foreground),
      b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });

const screenshot = async (
  page: Page,
  family: string,
  suffix: string,
  info: any
) => {
  const directory =
    process.env.PALI_DIALOG_VISUAL_OUTPUT ||
    path.join(E2E_CONFIG.artifactsDir, 'dialog-families');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${family}-${suffix}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(`${family}-${suffix}`, {
    contentType: 'image/png',
    path: file,
  });
};

test.describe('production dialog family consistency', () => {
  test.beforeAll(async () => {
    await compileFixture();
    server = http.createServer((request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(403).end();
        return;
      }
      const url = new URL(request.url!, 'http://127.0.0.1');
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
        );
        return;
      }
      const file = path.resolve(outputDirectory, '.' + url.pathname);
      if (
        !file.startsWith(outputDirectory + path.sep) ||
        !fs.existsSync(file)
      ) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.svg')
          ? 'image/svg+xml'
          : 'application/octet-stream',
      });
      response.end(fs.readFileSync(file));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture address');
    origin = `http://127.0.0.1:${address.port}`;
  });
  test.afterAll(async () => {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('localized long dialog actions fit 320x360 and 400x480', async ({
    page,
  }, info) => {
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    for (const locale of locales) {
      for (const family of ['error', 'import-warning', 'hardware-choice']) {
        for (const viewport of [
          { width: 320, height: 360 },
          { width: 400, height: 480 },
        ]) {
          await page.setViewportSize(viewport);
          await page.goto(
            `${origin}/?family=${family}&long=true&locale=${locale}`
          );
          await page.locator('#fixture-open').click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await page.evaluate(async () => {
            await Promise.all(
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.effect?.getComputedTiming().iterations !==
                    Infinity
                )
                .map((animation) => animation.finished.catch(() => undefined))
            );
          });
          const panel = page.locator('[id^="headlessui-dialog-panel"]');
          const bounds = (await panel.boundingBox())!;
          await screenshot(
            page,
            `${family}-${locale}`,
            `${viewport.width}x${viewport.height}-long`,
            info
          );
          expect(
            bounds.y,
            `${locale}/${family}: top margin`
          ).toBeGreaterThanOrEqual(15.5);
          expect(
            bounds.y + bounds.height,
            `${locale}/${family}: bottom margin`
          ).toBeLessThanOrEqual(viewport.height - 15.5);
          const horizontal = await panel.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowing: [...element.querySelectorAll('*')]
              .filter((child) => child.scrollWidth > child.clientWidth + 1)
              .map((child) => ({
                tag: child.tagName,
                text: child.textContent?.slice(0, 100),
                clientWidth: child.clientWidth,
                scrollWidth: child.scrollWidth,
              })),
          }));
          expect
            .soft(
              horizontal.scrollWidth <= horizontal.clientWidth,
              `${locale}/${family}/${viewport.width}: ${JSON.stringify(
                horizontal
              )}`
            )
            .toBe(true);
          for (const button of await dialog.getByRole('button').all()) {
            expect
              .soft(
                await inViewport(button),
                `${locale}/${family}: ${await button.innerText()} is fully visible`
              )
              .toBe(true);
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
        }
      }
    }
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });

  for (const family of families) {
    test(`${family}: accessible actions and long content at 320px`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      const externalRequests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
          return route.continue();
        externalRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      });
      for (const long of [false, true]) {
        await page.setViewportSize(
          long ? { width: 320, height: 480 } : { width: 600, height: 800 }
        );
        await page.goto(`${origin}/?family=${family}&long=${long}`);
        await page.locator('#fixture-open').click();
        const title = long
          ? 'Review this longer synthetic account message before continuing'
          : 'Synthetic dialog';
        const dialog = page.getByRole('dialog', { name: title });
        await expect(dialog).toBeVisible();
        // Sheet entrance animations intentionally translate the panel. Measure
        // the settled production layout without racing a transition frame.
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity
              )
              .map((animation) => animation.finished.catch(() => undefined))
          );
        });
        const buttons = dialog.getByRole('button');
        expect(await buttons.count()).toBeGreaterThan(0);
        const titleElement = dialog.getByRole('heading', { name: title });
        expect(await contrast(titleElement)).toBeGreaterThanOrEqual(4.5);
        for (const text of await dialog.locator('p, span').all()) {
          if (
            await text.evaluate(
              (element) =>
                !!element.textContent?.trim() && element.children.length === 0
            )
          ) {
            expect(
              await contrast(text),
              `Readable dialog body text: ${await text.innerText()}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
        await expect(
          dialog.getByRole('button', { name: 'Close', exact: true })
        ).toHaveCount(1);
        await expect(
          titleElement.locator('..').locator('span[aria-hidden="true"] > svg')
        ).toHaveCount(1);
        for (const button of await buttons.all()) {
          const box = (await button.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          if ((await button.innerText()).trim())
            expect(await contrast(button)).toBeGreaterThanOrEqual(4.5);
          expect(
            await inViewport(button),
            'Header and action controls remain visible without scrolling'
          ).toBe(true);
        }
        const panel = titleElement.locator(
          'xpath=ancestor::*[starts-with(@id,"headlessui-dialog-panel")][1]'
        );
        await expect(panel).toBeVisible();
        expect(
          await panel.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        ).toBe(true);
        const viewport = page.viewportSize()!;
        const bounds = (await panel.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(15.5);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          viewport.width - 15.5
        );
        expect(bounds.y).toBeGreaterThanOrEqual(15.5);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(
          viewport.height - 15.5
        );
        if (long) {
          const scrolling = await panel.evaluate((element) => {
            const body = [...element.querySelectorAll('*')].find(
              (candidate) =>
                /auto|scroll/.test(getComputedStyle(candidate).overflowY) &&
                candidate.scrollHeight > candidate.clientHeight + 1
            );
            if (!body) return null;
            const box = body.getBoundingClientRect();
            return {
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
              tabIndex: body.getAttribute('tabindex'),
            };
          });
          expect(
            scrolling,
            'Long dialog content has its own scroll area'
          ).not.toBeNull();
          expect(
            scrolling!.tabIndex,
            'Overflowing body explicitly supports keyboard focus'
          ).toBe('0');
          const scrollPosition = () =>
            panel.evaluate((element) =>
              [...element.querySelectorAll('*')].reduce(
                (maximum, candidate) => Math.max(maximum, candidate.scrollTop),
                0
              )
            );
          const initialFocus = await page.evaluate(() => ({
            tag: document.activeElement?.tagName,
            label: document.activeElement?.getAttribute('aria-label'),
          }));
          await page.keyboard.press('PageDown');
          await page.waitForTimeout(150);
          const initialPageDownScroll = await scrollPosition();
          let tabCount = 0;
          // Begin at the actual initial Panel/Close focus. Reach the body by
          // native Tab navigation; never programmatically focus its element.
          while (
            (await scrollPosition()) === 0 &&
            tabCount < (await buttons.count()) + 3
          ) {
            await page.keyboard.press('Tab');
            await page.keyboard.press('PageDown');
            await page.waitForTimeout(150);
            tabCount++;
          }
          const keyboardScroll = await scrollPosition();
          const keyboardEvidence = {
            initialFocus,
            initialPageDownScroll,
            tabCount,
            keyboardScroll,
          };
          const evidenceDirectory =
            process.env.PALI_DIALOG_VISUAL_OUTPUT ||
            path.join(E2E_CONFIG.artifactsDir, 'dialog-families');
          fs.mkdirSync(evidenceDirectory, { recursive: true });
          fs.writeFileSync(
            path.join(evidenceDirectory, `${family}-keyboard.json`),
            JSON.stringify(keyboardEvidence, null, 2)
          );
          await info.attach(`${family}-keyboard-scroll`, {
            body: JSON.stringify(keyboardEvidence),
            contentType: 'application/json',
          });
          expect(
            keyboardScroll,
            'Keyboard-only Tab and PageDown can read overflowing dialog content'
          ).toBeGreaterThan(0);
          await page.mouse.move(scrolling!.x, scrolling!.y);
          await page.mouse.wheel(0, 1800);
          await expect
            .poll(() =>
              panel.evaluate((element) =>
                [...element.querySelectorAll('*')].some(
                  (candidate) => candidate.scrollTop > 0
                )
              )
            )
            .toBe(true);
          await expect(titleElement).toBeInViewport({ ratio: 1 });
          for (const button of await buttons.all()) {
            expect(
              await inViewport(button),
              'Scrolling body content preserves header and footer controls'
            ).toBe(true);
          }
        } else {
          expect(
            await panel.evaluate(
              (element) =>
                [...element.querySelectorAll('div')].filter(
                  (candidate) =>
                    /auto|scroll/.test(getComputedStyle(candidate).overflowY) &&
                    candidate.scrollHeight <= candidate.clientHeight + 1 &&
                    candidate.getAttribute('tabindex') === '0'
                ).length
            ),
            'Short static body does not add an unnecessary tab stop'
          ).toBe(0);
        }
        for (let index = 0; index < (await buttons.count()) + 2; index++) {
          await page.keyboard.press('Tab');
          expect(
            await dialog.evaluate((element) =>
              element.contains(document.activeElement)
            )
          ).toBe(true);
        }
        await screenshot(page, family, long ? '320x480-long' : '600x800', info);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('#fixture-open')).toBeFocused();
      }
      expect(errors).toEqual([]);
      expect(externalRequests).toEqual([]);
    });
  }
});
