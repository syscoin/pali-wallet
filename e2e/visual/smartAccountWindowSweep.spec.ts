import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import webpack from 'webpack';

import de from '../../source/assets/locales/de.json';
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

const address = (value: number) => `0x${value.toString(16).padStart(40, '0')}`;
const metadata = {
  auth: { data: '0x', module: 'composite', validator: address(3) },
  chainId: 57057,
  contractVersion: 'synthetic-window-sweep',
  deploymentSalt: '0x' + '00'.repeat(32),
  isDeployed: true,
  installedModules: [
    {
      address: address(1),
      config: { owners: [address(80)], threshold: 1 },
      data: '0x',
      id: 'ecdsa',
      type: 'validator',
    },
    {
      address: address(2),
      config: {
        keyId: 'synthetic-only',
        parameterSet: 'SLH-DSA-SHA2-128-24',
        pkRoot: '0x' + '11'.repeat(16),
        pkSeed: '0x' + '22'.repeat(16),
        signatureLimit: 1,
      },
      data: '0x',
      id: 'slh-dsa',
      type: 'validator',
    },
    {
      address: address(3),
      config: { childValidators: [address(1), address(2)], threshold: 2 },
      data: '0x',
      id: 'composite',
      type: 'validator',
    },
    {
      address: address(4),
      config: { guardians: [address(80)], threshold: 1, delaySeconds: 60 },
      data: '0x',
      id: 'guardian-recovery',
      type: 'executor',
    },
  ],
};

async function exposed(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node),
        b = node.getBoundingClientRect();
      if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, b.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          b.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, b.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          b.top + node.clientTop + node.clientHeight
        );
      }
    }
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.left >= clip.left - 0.5 &&
      box.right <= clip.right + 0.5 &&
      box.top >= clip.top - 0.5 &&
      box.bottom <= clip.bottom + 0.5 &&
      [
        [box.left + 2, box.top + box.height / 2],
        [box.right - 2, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + 2],
        [box.left + box.width / 2, box.bottom - 2],
      ].every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (hit === element || element.contains(hit));
      })
    );
  });
}

async function assertNoHorizontalClip(page: Page, label: string) {
  const overflows = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const roots = dialogs.length
      ? dialogs
      : [
          ...document.querySelectorAll(
            '[data-navigation-scroll], #app-root, .page-content > div'
          ),
        ];
    return roots
      .filter((node) => {
        const style = getComputedStyle(node),
          b = node.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          b.width > 0 &&
          b.height > 0 &&
          (b.left < -0.5 ||
            b.right > innerWidth + 0.5 ||
            // The outer layout includes intentionally hidden dropdown layers;
            // only the visible page or dialog is a content-overflow boundary.
            (node.getAttribute('data-navigation-scroll') !== 'wallet-layout' &&
              node.id !== 'app-root' &&
              node.scrollWidth > node.clientWidth + 1))
        );
      })
      .map((node) => ({
        tag: node.tagName,
        id: node.id,
        scroll: node.getAttribute('data-navigation-scroll'),
        width: node.clientWidth,
        scrollWidth: node.scrollWidth,
        bounds: node.getBoundingClientRect().toJSON(),
      }));
  });
  expect.soft(overflows, `${label}: no horizontal clipping`).toEqual([]);
}

// This exercises the released extension in disposable storage. State responses
// supply only synthetic smart-account metadata; the deny proxy and request
// fixture block all external I/O and every controller mutation below is denied.
test('smart-account dialogs, policy and long dapp approvals fit narrow and short windows', async ({}, info) => {
  test.setTimeout(240_000);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  let wallet: PaliWallet | undefined;
  let page: Page | undefined;
  const errors: string[] = [];
  const directory = path.join(
    E2E_CONFIG.artifactsDir,
    'smart-account-window-sweep'
  );
  fs.mkdirSync(directory, { recursive: true });
  const capture = async (label: string) => {
    const file = path.join(directory, `${label}.png`);
    await page!.mouse.move(0, 0);
    await page!.screenshot({ path: file, animations: 'disabled' });
    await info.attach(label, { path: file, contentType: 'image/png' });
  };
  Object.assign(E2E_CONFIG, {
    ...(process.env.PALI_TEST_DAPP_EXTENSION_PATH
      ? { extensionPath: process.env.PALI_TEST_DAPP_EXTENSION_PATH }
      : {}),
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SyntheticWindowSweepOnly!2026',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('smart-account-window-sweep', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    page = await wallet.context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ fixtureMetadata, accountAddress }) => {
        if (!globalThis.chrome?.runtime?.sendMessage) return;
        const deniedActions: string[] = [];
        (window as any).__windowSweep = { deniedActions };
        const transform = (state: any) => {
          if (!state?.vault || !state?.vaultGlobal) return state;
          const result = structuredClone(state);
          result.vault.accounts.SmartAccount = {
            0: {
              address: accountAddress,
              balances: { ethereum: 0, syscoin: 0 },
              id: 0,
              isSmartAccount: true,
              label: 'Synthetic smart account',
              smartAccount: fixtureMetadata,
              type: 'SmartAccount',
            },
          };
          result.vault.activeAccount = { id: 0, type: 'SmartAccount' };
          result.vault.activeNetwork = {
            chainId: 57057,
            currency: 'TSYS',
            kind: 'ethereum',
            label: 'Synthetic offline network',
            slip44: 60,
            url: 'https://window-sweep.invalid/rpc',
          };
          result.vault.isBitcoinBased = false;
          result.vaultGlobal.activeSlip44 = 60;
          result.vaultGlobal.networkStatus = 'connected';
          result.vaultGlobal.isSwitchingAccount = false;
          return result;
        };
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = ((...args: any[]) => {
          const [message, callback] = args;
          const reply = (value: any) =>
            typeof callback === 'function'
              ? queueMicrotask(() => callback(value))
              : Promise.resolve(value);
          if (message?.type === 'getCurrentState') {
            return typeof callback === 'function'
              ? (send as any)(message, (state: any) =>
                  callback(transform(state))
                )
              : (send as any)(message).then(transform);
          }
          if (
            message?.type === 'CONTROLLER_ACTION' &&
            message.data?.methods?.[0] === 'wallet'
          ) {
            const method = message.data.methods[1];
            if (method === 'hydrateSmartAccount') return reply(fixtureMetadata);
            if (method === 'getSLHDSASmartAccountSetupStatus')
              return reply(null);
            if (method === 'getSmartAccountGuardianRecoveryStatus')
              return reply({
                exists: true,
                guardians: ['0x' + (80).toString(16).padStart(40, '0')],
                threshold: 1,
                delay: '60',
              });
            if (method === 'getWalletSessionGeneration') return reply(1);
            if (
              /^(?:sign|send|deploy|install|uninstall|rotate|add|remove|register|start|finalize|prepare)/i.test(
                method
              )
            ) {
              deniedActions.push(method);
              return reply({
                error: 'Synthetic layout fixture forbids wallet mutation',
              });
            }
          }
          return (send as any)(...args);
        }) as typeof chrome.runtime.sendMessage;
        const add = chrome.runtime.onMessage.addListener.bind(
          chrome.runtime.onMessage
        );
        const remove = chrome.runtime.onMessage.removeListener.bind(
          chrome.runtime.onMessage
        );
        const wrapped = new Map<any, any>();
        chrome.runtime.onMessage.addListener = (listener: any) => {
          const wrapper = (message: any, ...rest: any[]) => {
            if (message?.type === 'CONTROLLER_STATE_CHANGE')
              return listener(
                { ...message, data: transform(message.data) },
                ...rest
              );
            if (
              [
                'CONTROLLER_ACCOUNTS_CHANGE',
                'CONTROLLER_ACTIVE_ACCOUNT_CHANGE',
                'CONTROLLER_NETWORK_CHANGE',
                'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
              ].includes(message?.type)
            )
              return false;
            return listener(message, ...rest);
          };
          wrapped.set(listener, wrapper);
          add(wrapper);
        };
        chrome.runtime.onMessage.removeListener = (listener: any) => {
          remove(wrapped.get(listener) || listener);
          wrapped.delete(listener);
        };
      },
      { fixtureMetadata: metadata, accountAddress: address(100) }
    );

    for (const language of ['en', 'de']) {
      const copy = language === 'de' ? de : en;
      await page.goto('about:blank');
      await wallet.page.evaluate(
        (locale) =>
          new Promise<void>((resolve) =>
            chrome.storage.local.set({ language: locale }, resolve)
          ),
        language
      );
      for (const viewport of [
        { width: 400, height: 620 },
        { width: 400, height: 360 },
        { width: 320, height: 360 },
        { width: 400, height: 480 },
      ]) {
        const label = `${language}-${viewport.width}x${viewport.height}`;
        await page.setViewportSize(viewport);
        await page.goto(wallet.appUrl('#/home/smart-account'));
        const edit = page
          .locator('li')
          .filter({ hasText: copy.smartAccountHub.compositeHint })
          .getByRole('button', { name: copy.smartAccountHub.edit });
        await expect(edit).toBeEnabled();
        await capture(`hub-${label}`);
        await assertNoHorizontalClip(page, `hub ${label}`);
        await edit.scrollIntoViewIfNeeded();
        await edit.click();
        const dialog = page.getByRole('dialog', {
          name: copy.settings.compositeAuthenticator,
        });
        await expect(dialog).toBeVisible();
        const save = dialog.getByRole('button', {
          name: copy.smartAccountHub.compositeSavePolicy,
        });
        const cancel = dialog.getByRole('button', {
          name: copy.buttons.cancel,
        });
        expect.soft(await exposed(save), `composite Save ${label}`).toBe(true);
        await info.attach(`composite-geometry-${label}`, {
          body: JSON.stringify(
            await dialog.evaluate((node) =>
              [...node.querySelectorAll('form, header, footer, button')].map(
                (element) => ({
                  tag: element.tagName,
                  text: element.textContent?.slice(0, 80),
                  bounds: element.getBoundingClientRect().toJSON(),
                  scrollHeight: element.scrollHeight,
                  clientHeight: element.clientHeight,
                })
              )
            )
          ),
          contentType: 'application/json',
        });
        expect
          .soft(await exposed(cancel), `composite Cancel ${label}`)
          .toBe(true);
        await assertNoHorizontalClip(page, `composite ${label}`);
        for (let step = 0; step < 8; step++) {
          await page.keyboard.press('Tab');
          expect(
            await dialog.evaluate((node) =>
              node.contains(document.activeElement)
            )
          ).toBe(true);
        }
        await capture(`composite-${label}`);
        await page.keyboard.press('Escape');
        await expect(edit).toBeFocused();

        const install = page
          .locator('li')
          .filter({ hasText: copy.smartAccountHub.customModuleHint })
          .getByRole('button', { name: copy.smartAccountHub.install });
        await install.scrollIntoViewIfNeeded();
        await install.click();
        const custom = page.getByRole('dialog', {
          name: copy.smartAccountHub.customModule,
        });
        await expect(custom).toBeVisible();
        await custom
          .locator('#custom-validator-name')
          .fill('Synthetic validator — '.repeat(12));
        await custom.locator('#custom-validator-address').fill(address(200));
        await custom
          .locator('#custom-validator-init-data')
          .fill('0x' + '11'.repeat(128));
        expect
          .soft(
            await exposed(
              custom.getByRole('button', { name: copy.buttons.cancel })
            ),
            `custom Cancel ${label}`
          )
          .toBe(true);
        expect
          .soft(
            await exposed(
              custom.getByRole('button', {
                name: copy.smartAccountHub.checkModule,
              })
            ),
            `custom Check ${label}`
          )
          .toBe(true);
        await assertNoHorizontalClip(page, `custom ${label}`);
        await capture(`custom-${label}`);
        await page.keyboard.press('Escape');
        await expect(install).toBeFocused();

        await page.goto(
          wallet.appUrl('#/settings/account/smart-account-policy')
        );
        await expect(
          page
            .getByText(copy.settings.smartAccountAccountPolicy, { exact: true })
            .first()
        ).toBeVisible();
        await assertNoHorizontalClip(page, `policy ${label}`);
        await capture(`policy-${label}`);
        const recover = page.getByRole('button', {
          name: copy.settings.smartAccountGuardianRecoveryShowOptions,
          exact: true,
        });
        await recover.scrollIntoViewIfNeeded();
        await recover.click();
        const recovery = page.locator(
          '[data-navigation-scroll="smart-account-policy-recovery"]'
        );
        await expect(recovery).toBeVisible();
        const ecdsa = recovery
          .getByRole('button')
          .filter({ hasText: copy.settings.ecdsaAuthenticator });
        await ecdsa.click();
        await recovery
          .locator('input')
          .fill('synthetic-invalid-' + 'x'.repeat(160));
        await expect(
          recovery.getByText(copy.settings.invalidAddress, { exact: true })
        ).toBeVisible();
        const finalize = recovery.getByRole('button', {
          name: copy.settings.smartAccountGuardianRecoveryFinalize,
          exact: true,
        });
        await finalize.scrollIntoViewIfNeeded();
        expect
          .soft(await exposed(finalize), `recovery final action ${label}`)
          .toBe(true);
        await assertNoHorizontalClip(page, `recovery ${label}`);
        await capture(`recovery-${label}`);

        const approvalCases = [
          {
            label: 'ecdsa-create',
            route: 'smart-account',
            data: {
              request: {
                label: 'Synthetic account '.repeat(12),
                authenticator: { id: 'ecdsa' },
              },
            },
          },
          {
            label: 'slh-create',
            route: 'smart-account',
            data: {
              request: {
                label: 'Synthetic account '.repeat(12),
                authenticator: { id: 'slh-dsa' },
              },
            },
          },
          {
            label: 'module-error',
            route: 'smart-account-modules',
            data: {
              action: 'install',
              module: {
                address: 'invalid',
                name: 'Synthetic_validator_'.repeat(30),
              },
            },
          },
          {
            label: 'personal-sign',
            route: 'tx/ethSign',
            data: {
              eventName: 'personal_sign',
              0: 'Synthetic message for local layout only. '.repeat(32),
              1: address(100),
            },
          },
        ];
        for (const fixture of approvalCases) {
          await page.goto(
            `chrome-extension://${wallet.extensionId}/external.html?route=${
              fixture.route
            }&data=${encodeURIComponent(
              JSON.stringify({
                host: 'synthetic-long-approval-host.example.invalid',
                ...fixture.data,
              })
            )}`
          );
          const layout = page.locator(
            '[data-navigation-scroll="wallet-layout"]'
          );
          await expect(layout).toBeVisible();
          await expect(page.locator('#initial-loader')).toHaveCSS(
            'opacity',
            '0'
          );
          const cancelAction = page
            .getByRole('button')
            .filter({ hasText: copy.buttons.cancel })
            .last();
          await cancelAction.scrollIntoViewIfNeeded();
          expect
            .soft(
              await exposed(cancelAction),
              `${fixture.label} Cancel ${label}`
            )
            .toBe(true);
          const confirmAction = page
            .getByRole('button')
            .filter({ hasText: copy.buttons.confirm })
            .last();
          await expect(confirmAction).toBeVisible();
          expect
            .soft(
              await exposed(confirmAction),
              `${fixture.label} Confirm ${label}`
            )
            .toBe(true);
          await assertNoHorizontalClip(page, `${fixture.label} ${label}`);
          await capture(`${fixture.label}-${label}`);
        }
      }
    }
    expect(errors).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(
      await page.evaluate(() => (window as any).__windowSweep.deniedActions)
    ).toEqual([]);
  } finally {
    await page?.close().catch(() => undefined);
    await wallet?.context.close().catch(() => undefined);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});

test('busy signing, device prompts and long diagnostic overlays fit small windows', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const root = E2E_CONFIG.repoRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-busy-window-'));
  const output = path.join(directory, 'dist');
  const entry = path.join(directory, 'entry.tsx');
  const screenshots = path.join(E2E_CONFIG.artifactsDir, 'smart-account-busy');
  fs.mkdirSync(screenshots, { recursive: true });
  const inertHooks = path.join(directory, 'hooks.ts');
  fs.writeFileSync(
    inertHooks,
    `
    const forbidden = () => { throw new Error('No wallet actions in component fixture'); };
    export const useUtils = () => ({alert:{info:forbidden},useCopyClipboard:()=>[false,forbidden]});
  `
  );
  fs.writeFileSync(
    entry,
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import i18next from 'i18next';
    import {I18nextProvider} from 'react-i18next';
    import en from ${JSON.stringify(
      path.join(root, 'source/assets/locales/en.json')
    )};
    import de from ${JSON.stringify(
      path.join(root, 'source/assets/locales/de.json')
    )};
    import {PqSigningOverlay} from ${JSON.stringify(
      path.join(root, 'source/components/Loading/PqSigningOverlay')
    )};
    import {PqOperationStatus} from ${JSON.stringify(
      path.join(root, 'source/components/Loading/PqOperationStatus')
    )};
    import {PageLoadingOverlay} from ${JSON.stringify(
      path.join(root, 'source/components/Loading/PageLoadingOverlay')
    )};
    import {DeviceWaitingBanner} from ${JSON.stringify(
      path.join(root, 'source/components/DeviceWaitingBanner')
    )};
    import {ErrorModal} from ${JSON.stringify(
      path.join(root, 'source/components/Modal/Modal')
    )};
    import CompositeApprovalDialog from ${JSON.stringify(
      path.join(root, 'source/pages/SmartAccount/CompositeApprovalDialog')
    )};
    import ${JSON.stringify(path.join(root, 'source/assets/styles/index.css'))};
    import ${JSON.stringify(path.join(root, 'source/assets/fonts/index.css'))};
    const query=new URLSearchParams(location.search), locale=query.get('locale')||'en', mode=query.get('mode');
    const copy=locale==='de'?de:en;
    i18next.init({lng:locale,initImmediate:false,resources:{en:{translation:en},de:{translation:de}},interpolation:{escapeValue:false}});
    const candidates=${JSON.stringify(
      metadata.installedModules.filter(
        (m) => m.type === 'validator' && m.id !== 'composite'
      )
    )};
    function Fixture() {
      const [value,setValue]=React.useState({children:candidates.map((m)=>m.address),threshold:2});
      return <I18nextProvider i18n={i18next}>
      <main className="min-h-screen bg-surface-base p-4 text-content-primary">
        {mode==='composite' && <CompositeApprovalDialog candidates={candidates} value={value} onChange={setValue} onClose={()=>{}} onSave={()=>{}} saving={false} />}
        {mode==='pq' && <PqSigningOverlay show expectedSeconds={90} title={copy.settings.slhDsaSigningInProgress} subtitle={copy.settings.slhDsaSigningOverlayDescription} />}
        {mode==='setup' && <PqOperationStatus show expectedSeconds={180} startedAt={Date.now()-400000} title={copy.settings.slhDsaSetupInProgress} progressLabel="XMSS level 21/22." progressPercent={95} />}
        {mode==='device' && <DeviceWaitingBanner show account={{isLedgerWallet:true}} />}
        {mode==='passkey' && <DeviceWaitingBanner show account={{isSmartAccount:true,smartAccount:{auth:{module:'composite'}}}} />}
        {mode==='loading' && <PageLoadingOverlay isLoading nonBlocking message={copy.settings.slhDsaSigningOverlayDescription} />}
        {mode==='error' && <ErrorModal show title={copy.transactions.signatureFailed} description={copy.transactions.sorryWeCould} log={'Synthetic_Long_Diagnostic_'.repeat(60)} onClose={()=>{}} />}
        {mode==='long-title' && <ErrorModal show title={copy.transactions.signatureFailed + ' — ' + 'Synthetic regional development network '.repeat(12)} description={copy.transactions.sorryWeCould} log="Synthetic fixture only" onClose={()=>{}} />}
      </main>
    </I18nextProvider>;
    }
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `
  );
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({
      context: root,
      entry,
      mode: 'production',
      devtool: false,
      optimization: { minimize: false },
      output: { path: output, filename: 'fixture.js' },
      module: {
        rules: [
          {
            test: /\.[jt]sx?$/,
            exclude: /node_modules/,
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
      resolve: {
        alias: {
          'hooks/useUtils$': inertHooks,
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
    compiler.run((error, stats) =>
      compiler.close(() =>
        error || stats?.hasErrors()
          ? reject(
              error || new Error(stats?.toString({ all: false, errors: true }))
            )
          : resolve()
      )
    );
  });
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://127.0.0.1').pathname;
    if (request.method !== 'GET') return void response.writeHead(403).end();
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return void response.end(
        '<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
      );
    }
    const file = path.join(output, path.basename(pathname));
    if (!fs.existsSync(file)) return void response.writeHead(404).end();
    if (pathname.endsWith('.js'))
      response.setHeader('Content-Type', 'text/javascript');
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient')
  );
  try {
    for (const locale of ['en', 'de'])
      for (const viewport of [
        { width: 320, height: 360 },
        { width: 400, height: 360 },
        { width: 400, height: 480 },
      ])
        for (const mode of [
          'composite',
          'pq',
          'setup',
          'device',
          'passkey',
          'loading',
          'error',
          'long-title',
        ]) {
          await page.setViewportSize(viewport);
          await page.goto(`${origin}/?locale=${locale}&mode=${mode}`);
          const label = `${mode}-${locale}-${viewport.width}x${viewport.height}`;
          const target =
            mode === 'pq' ||
            mode === 'error' ||
            mode === 'long-title' ||
            mode === 'composite'
              ? page.getByRole('dialog')
              : mode === 'device' || mode === 'passkey'
              ? page.getByTestId('device-waiting-banner')
              : mode === 'loading'
              ? page.getByRole('status')
              : page.locator('main > div');
          await expect(target).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await assertNoHorizontalClip(page, label);
          const bounds = (await target.boundingBox())!;
          expect.soft(bounds.y, label).toBeGreaterThanOrEqual(0);
          expect
            .soft(bounds.x + bounds.width, label)
            .toBeLessThanOrEqual(viewport.width);
          expect
            .soft(bounds.y + bounds.height, label)
            .toBeLessThanOrEqual(viewport.height);
          if (mode === 'pq') {
            await page.keyboard.press('Escape');
            await expect(target).toBeVisible();
            await expect(target.getByRole('button')).toHaveCount(0);
          }
          if (mode === 'error' || mode === 'long-title') {
            expect
              .soft(await exposed(target.getByRole('button').last()), label)
              .toBe(true);
          }
          if (mode === 'long-title') {
            const title = target.getByRole('heading');
            await expect(title).toHaveAttribute('tabindex', '0');
            await title.focus();
            await page.keyboard.press('PageDown');
            await expect
              .poll(() => title.evaluate((node) => node.scrollTop))
              .toBeGreaterThan(0);
          }
          if (mode === 'composite') {
            const actions = target.locator('footer button');
            await expect(actions).toHaveCount(2);
            for (const action of await actions.all()) {
              expect
                .soft(await exposed(action), `${label}: footer action`)
                .toBe(true);
              expect(
                await action.evaluate(
                  (node) =>
                    node.scrollWidth <= node.clientWidth &&
                    node.scrollHeight <= node.clientHeight
                )
              ).toBe(true);
            }
          }
          const file = path.join(screenshots, `${label}.png`);
          await page.screenshot({ animations: 'disabled', path: file });
          await info.attach(label, { path: file, contentType: 'image/png' });
        }
    expect(errors).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
