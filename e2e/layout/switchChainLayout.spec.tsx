/** @jest-environment node */
import { chromium, type Browser } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import tailwindcss from 'tailwindcss';

import { AppLayout } from '../../source/components/Layout/AppLayout';
import External from '../../source/pages/External/External';
import SwitchChain from '../../source/pages/Settings/SwitchEthereumChain';
import tailwindConfig from '../../tailwind.config.js';

let mockHost = 'https://bridge.example';
// Keep the genuine icon registry/wrappers and their dimensions; only glyph
// paths are inert in this offline fixture (Ant's package is ESM in Node).
jest.mock(
  '@ant-design/icons',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? target.__esModule
            : (props: any) =>
                React.createElement('svg', {
                  ...props,
                  width: '1em',
                  height: '1em',
                  'aria-hidden': true,
                }),
      }
    ),
  { virtual: true }
);
jest.mock('hooks/index', () => ({
  useQueryData: () => ({ host: mockHost, chainId: 1, eventName: 'switch' }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: { activeNetwork: { chainId: 57057, kind: 'ethereum' } },
      vaultGlobal: {
        networkStatus: 'idle',
        networks: {
          ethereum: { 1: { chainId: 1, kind: 'ethereum', label: 'Ethereum' } },
        },
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { chainId?: number }) =>
      key === 'components.chainWithId'
        ? jest
            .requireActual('../../source/assets/locales/en.json')
            .components.chainWithId.replace(
              '{{chainId}}',
              String(values?.chainId)
            )
        : {
            'settings.switchChain': 'Switch Chain',
            'send.allow': 'Allow',
            'settings.toSwitchNetwork': 'to switch the network',
            'settings.thisWillSwitch':
              'This will switch the selected network within Pali to a previously added network',
            'buttons.reject': 'Reject',
            'buttons.confirm': 'Confirm',
          }[key] || key,
  }),
}));
jest.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  useLocation: () => ({
    pathname: '/external/switch-EthChain',
    search: '',
    hash: '',
    state: {},
  }),
  useNavigate: () => jest.fn(),
}));
jest.mock('routers/index', () => ({
  Router: () => (
    <AppLayout>
      <SwitchChain />
    </AppLayout>
  ),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: jest.fn(),
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useBrowsingNavigationScroll', () => ({
  useBrowsingNavigationScroll: jest.fn(),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isLoading: false, isContextChanging: false }),
  isContextSensitiveWalletRoute: () => false,
  normalizeWalletPathname: (pathname: string) => pathname,
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({}),
  navigateBack: jest.fn(),
}));
jest.mock('components/Loading/PageLoadingOverlay', () => ({
  PageLoadingOverlay: () => null,
}));
jest.mock('components/Header/Header', () => ({ Header: () => null }));
jest.mock('components/index', () => ({
  Icon: jest.requireActual('components/Icon').Icon,
  IconButton: () => null,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/stateWaitUtils', () => ({ waitForNetworkSwitch: jest.fn() }));

// Layout-only fixture: genuine component, shared buttons/icons and AppLayout,
// with production External wrapper/template/styles. No wallet, seed, extension
// profile, RPC, approval queue, or background controller is initialized.
const repo = path.resolve(__dirname, '../..');
let browser: Browser;
let css: string;
let documentTemplate: string;
let artwork: Record<string, string>;

beforeAll(async () => {
  (global as any).window = { close: jest.fn() };
  const processed = await postcss([tailwindcss(tailwindConfig)]).process(
    fs.readFileSync(path.join(repo, 'source/assets/styles/index.css'), 'utf8'),
    { from: path.join(repo, 'source/assets/styles/index.css') }
  );
  const fontsDir = path.join(repo, 'source/assets/fonts');
  const fonts = fs
    .readFileSync(path.join(fontsDir, 'index.css'), 'utf8')
    .replace(
      /url\(['"]?([^)'"\s]+)['"]?\)/g,
      (_match, relative: string) =>
        `url(data:font/woff2;base64,${fs
          .readFileSync(path.join(fontsDir, relative))
          .toString('base64')})`
    );
  css = processed.css + fonts;
  documentTemplate = fs.readFileSync(
    path.join(repo, 'views/external.html'),
    'utf8'
  );
  artwork = Object.fromEntries(
    Object.entries({
      '': 'dotsHeader.png',
      'Chain 57057': 'zksys-icon.svg',
      arrowright: 'ArrowRight.svg',
    }).map(([alt, filename]) => [
      alt,
      `data:image/${filename.endsWith('.svg') ? 'svg+xml' : 'png'};base64,${fs
        .readFileSync(path.join(repo, 'source/assets/all_assets', filename))
        .toString('base64')}`,
    ])
  );
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
  delete (global as any).window;
});

it.each([
  { width: 400, height: 620, longHost: false },
  { width: 1280, height: 900, longHost: false },
  { width: 400, height: 620, longHost: true },
])(
  'Reject receives an ordinary click at $width x $height (long host=$longHost)',
  async ({ width, height, longHost }) => {
    mockHost = longHost
      ? `https://${'long-host-label.'.repeat(12)}example`
      : 'https://bridge.example';
    const context = await browser.newContext({ viewport: { width, height } });
    try {
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      // Jest's generic asset mock supplies URLs, not bytes. Reattach only the
      // genuine local artwork; geometry/classes and hit targets are untouched.
      const markup = renderToStaticMarkup(<External />).replace(
        /src="test-file-stub"([^>]*alt="([^"]*)"[^>]*)/g,
        (_match, attributes: string, alt: string) => {
          if (!artwork[alt]) throw new Error(`Unexpected local image: ${alt}`);
          return `src="${artwork[alt]}"${attributes}`;
        }
      );
      const externalStyle = documentTemplate.match(
        /<style>([\s\S]*?)<\/style>/
      )![1];
      const bodyClass = documentTemplate.match(/<body\s+class="([^"]+)"/)![1];
      await page.setContent(
        `<html><head><style>${externalStyle}\n${css}</style></head><body class="app-loaded ${bodyClass}"><div id="external-root">${markup}</div></body></html>`
      );
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      const reject = page.getByRole('button', { name: 'Reject', exact: true });
      // The long-copy case uses normal wheel scrolling, never force click,
      // scrollIntoView, or a pointer-events/z-index override.
      if (longHost) {
        await page.mouse.move(width / 2, Math.min(height - 40, 580));
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(100);
      }
      const geometry = await reject.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const points = [
          [0.5, 0.5],
          [0.1, 0.1],
          [0.9, 0.9],
        ];
        const hit = points.every(([x, y]) => {
          const target = document.elementFromPoint(
            box.x + box.width * x,
            box.y + box.height * y
          );
          return target === button || button.contains(target);
        });
        const overlapsBadge = Array.from(document.querySelectorAll('span'))
          .filter((span) => span.textContent === 'EVM')
          .some((span) => {
            const badge = span.getBoundingClientRect();
            return (
              badge.left < box.right &&
              badge.right > box.left &&
              badge.top < box.bottom &&
              badge.bottom > box.top
            );
          });
        return {
          hit,
          overlapsBadge,
          contained:
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= innerWidth &&
            box.bottom <= innerHeight,
        };
      });
      const artifactDir = path.join(repo, 'e2e/artifacts/switch-chain-layout');
      fs.mkdirSync(artifactDir, { recursive: true });
      await page.screenshot({
        path: path.join(
          artifactDir,
          `reject-${width}x${height}${longHost ? '-long-host' : ''}.png`
        ),
      });
      expect(geometry).toEqual({
        hit: true,
        overlapsBadge: false,
        contained: true,
      });
      // This checks actual browser pointer dispatch. Handler semantics and the
      // unchanged approval completion path have separate component unit tests.
      await reject.evaluate((button) =>
        button.addEventListener('click', () =>
          button.setAttribute('data-received-click', 'true')
        )
      );
      await reject.click({ timeout: 2000 });
      expect(await reject.getAttribute('data-received-click')).toBe('true');
    } finally {
      await context.close();
    }
  },
  15_000
);
