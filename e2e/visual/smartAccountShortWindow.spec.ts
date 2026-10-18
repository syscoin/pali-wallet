import { expect, test, type Locator } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import webpack from 'webpack';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';

// Real page/component/CSS rendering, with explicit synthetic account metadata
// and a read-only controller adapter. This is not wallet or on-chain QA.
let server: http.Server;
let origin: string;
let outputDirectory: string;
test.beforeAll(async () => {
  const root = E2E_CONFIG.repoRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-sa-layout-'));
  outputDirectory = path.join(directory, 'dist');
  const support = path.join(directory, 'support.ts');
  const components = path.join(directory, 'components.ts');
  const entry = path.join(directory, 'entry.tsx');
  fs.writeFileSync(
    support,
    `
    import { useNavigate } from 'react-router-dom';
    import { getPaliModuleAddress } from ${JSON.stringify(
      path.join(root, 'source/utils/smartAccount')
    )};
    export const ACCOUNT='0x1111111111111111111111111111111111111111';
    const OWNER='0x2222222222222222222222222222222222222222', GUARDIAN='0x3333333333333333333333333333333333333333';
    export const metadata={chainId:57057,isDeployed:true,auth:{data:'0x',module:'ecdsa',validator:getPaliModuleAddress(57057,'ecdsa')},installedModules:[
      {address:getPaliModuleAddress(57057,'ecdsa'),config:{owners:[OWNER],threshold:1},id:'ecdsa',type:'validator'},
      {address:getPaliModuleAddress(57057,'guardian-recovery'),config:{delaySeconds:60,guardians:[GUARDIAN],threshold:1},id:'guardian-recovery',type:'executor'}]};
    export const state={vault:{accounts:{HDAccount:{0:{id:0,address:OWNER}},SmartAccount:{1:{id:1,address:ACCOUNT,isSmartAccount:true,smartAccount:metadata}}},activeAccount:{id:1,type:'SmartAccount'},activeNetwork:{chainId:57057,url:'https://synthetic.invalid',kind:'evm'}},vaultGlobal:{activeSlip44:57,networkStatus:'connected'}};
    export default {getState:()=>state};
    export const useSelector=(fn:any)=>fn(state);
    const forbidden=(...args:any[])=>{(window as any).__forbidden.push(args);throw new Error('Synthetic layout fixture forbids wallet mutation');};
    const emitter=async([,method]:string[])=>{
      if(method==='hydrateSmartAccount')return metadata;
      if(method==='getSmartAccountGuardianRecoveryStatus')return{delay:'60',exists:true,guardians:[GUARDIAN],threshold:1};
      if(method==='getSLHDSASmartAccountSetupStatus')return null;
      return forbidden(method);
    };
    export const useController=()=>({controllerEmitter:emitter,handleWalletLockedError:()=>false});
    export const getControllerStatus=()=>({isUnlocked:true,isLoading:false,connectionUnavailable:false});
    export const useQueryData=()=>({host:'synthetic.example',request:{label:'Synthetic Smart Account',authenticator:{id:'slh-dsa',config:{}}}});
    export const useUtils=()=>({navigate:useNavigate(),alert:{info:()=>{},error:()=>{},success:()=>{}},useCopyClipboard:()=>[false,()=>{}]});
    export const getWalletNavigationScope=()=>({account:'synthetic-sa',network:'synthetic-network'});
    export const captureNavigationScroll=()=>({});
  `
  );
  fs.writeFileSync(
    components,
    `
    export * from ${JSON.stringify(
      path.join(root, 'source/components/Button')
    )};
    export * from ${JSON.stringify(path.join(root, 'source/components/Cards'))};
    export * from ${JSON.stringify(path.join(root, 'source/components/Icon'))};
    export * from ${JSON.stringify(
      path.join(root, 'source/components/Modal/Modal')
    )};
  `
  );
  fs.writeFileSync(
    entry,
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter} from 'react-router-dom';
    import i18next from 'i18next';
    import {I18nextProvider} from 'react-i18next';
    import en from ${JSON.stringify(
      path.join(root, 'source/assets/locales/en.json')
    )};
    import de from ${JSON.stringify(
      path.join(root, 'source/assets/locales/de.json')
    )};
    import {PrepareSmartAccount} from ${JSON.stringify(
      path.join(root, 'source/pages/Connections/PrepareSmartAccount')
    )};
    import Policy from ${JSON.stringify(
      path.join(root, 'source/pages/Settings/SmartAccountPolicy')
    )};
    import {ACCOUNT} from ${JSON.stringify(support)};
    import ${JSON.stringify(path.join(root, 'source/assets/styles/index.css'))};
    import ${JSON.stringify(path.join(root, 'source/assets/fonts/index.css'))};
    (window as any).__forbidden=[];
    const query=new URLSearchParams(location.search), mode=query.get('mode'), locale=query.get('locale')||'en';
    if(mode==='recovery-deadline')localStorage.setItem('pali-smart-account-recovery-replacement:57057:'+ACCOUNT,JSON.stringify({
      authenticator:{id:'ecdsa',config:{owners:['0x2222222222222222222222222222222222222222'],threshold:1}},kind:'ecdsa',
      recoveryOperation:{account:ACCOUNT,chainId:57057,executionCalldata:'0x1234',mode:'0x'+'00'.repeat(32),readyAt:Number(query.get('readyAt')),salt:'0x'+'66'.repeat(32)}
    }));
    i18next.init({lng:locale,initImmediate:false,resources:{en:{translation:en},de:{translation:de}},interpolation:{escapeValue:false}});
    createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18next}><MemoryRouter initialEntries={[{pathname:'/settings/account/smart-account-policy',state:{id:1,accountType:'SmartAccount',smartAccountPolicyView:'recovery'}}]}><main className="h-screen w-full overflow-y-auto bg-bkg-3 text-white">{mode==='prepare'?<PrepareSmartAccount/>:<Policy/>}</main></MemoryRouter></I18nextProvider>);
  `
  );
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({
      context: root,
      mode: 'production',
      devtool: false,
      entry,
      optimization: { minimize: false },
      output: { path: outputDirectory, filename: 'fixture.js' },
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
          'components/index$': components,
          'react-redux$': support,
          'state/store$': support,
          'hooks/index$': support,
          'hooks/useUtils$': support,
          'hooks/useController$': support,
          'hooks/controllerStatus$': support,
          'utils/navigationState$': support,
          assets: path.join(root, 'source/assets'),
          components: path.join(root, 'source/components'),
          hooks: path.join(root, 'source/hooks'),
          state: path.join(root, 'source/state'),
          utils: path.join(root, 'source/utils'),
          types: path.join(root, 'source/types'),
          scripts: path.join(root, 'source/scripts'),
        },
        extensions: ['.tsx', '.ts', '.js', '.json'],
        modules: [path.join(root, 'node_modules'), 'node_modules'],
      },
      resolveLoader: { modules: [path.join(root, 'node_modules')] },
      plugins: [
        new webpack.NormalModuleReplacementPlugin(/^\.\.$/, (resource) => {
          if (resource.context === path.join(root, 'source/components/Modal'))
            resource.request = components;
        }),
      ],
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
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url!, 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><html><head><meta charset="utf-8" /></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
      );
      return;
    }
    const file = path.join(outputDirectory, path.basename(pathname));
    if (fs.existsSync(file)) {
      if (pathname.endsWith('.js'))
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(fs.readFileSync(file));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const exposed = (locator: Locator) =>
  locator.evaluate((element) => {
    const b = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let parent: Element | null = element;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0)
        return false;
      if (parent === element) continue;
      const p = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, p.left + parent.clientLeft);
        clip.right = Math.min(
          clip.right,
          p.left + parent.clientLeft + parent.clientWidth
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, p.top + parent.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          p.top + parent.clientTop + parent.clientHeight
        );
      }
    }
    if (
      b.width <= 0 ||
      b.height <= 0 ||
      b.left < clip.left - 0.5 ||
      b.top < clip.top - 0.5 ||
      b.right > clip.right + 0.5 ||
      b.bottom > clip.bottom + 0.5
    )
      return false;
    return [
      [b.left + 2, b.top + b.height / 2],
      [b.right - 2, b.top + b.height / 2],
      [b.left + b.width / 2, b.top + 2],
      [b.left + b.width / 2, b.bottom - 2],
    ].every(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return !!e && (e === element || element.contains(e));
    });
  });

test('synthetic smart-account creation error and recovery controls fit short windows', async ({
  page,
}, info) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient')
  );
  for (const locale of ['en', 'de'])
    for (const height of [360, 480, 620]) {
      const copy = locale === 'en' ? en : de;
      await page.setViewportSize({ width: 400, height });
      await page.goto(`${origin}/?mode=prepare&locale=${locale}`);
      const confirm = page.getByRole('button', {
        name: copy.buttons.confirm,
        exact: true,
      });
      await expect(confirm).toBeVisible();
      expect
        .soft(await exposed(confirm), `prepare Confirm ${locale}/${height}`)
        .toBe(true);
      await confirm.click();
      const error = page.getByText(copy.connections.smartAccountPrepareFailed, {
        exact: true,
      });
      await expect(error).toBeVisible();
      const content = page.locator('main > div > div').first();
      await content.hover({ position: { x: 20, y: 20 } });
      await page.mouse.wheel(0, 1500);
      await info.attach(`prepare-${locale}-${height}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect
        .soft(
          await exposed(confirm),
          `prepare Confirm after error ${locale}/${height}`
        )
        .toBe(true);
      expect
        .soft(await exposed(error), `prepare error ${locale}/${height}`)
        .toBe(true);
      expect(await page.evaluate(() => (window as any).__forbidden)).toEqual(
        []
      );
      await page.goto(`${origin}/?mode=recovery&locale=${locale}`);
      const buttons = page.getByRole('button');
      await expect(
        page.getByText(copy.settings.smartAccountGuardianRecoveryLostTitle, {
          exact: true,
        })
      ).toBeVisible();
      const ecdsa = buttons
        .filter({
          hasText: copy.settings.ecdsaAuthenticator,
        })
        .first();
      await ecdsa.click();
      const input = page.locator('input').first();
      await input.fill('invalid-synthetic-address');
      const invalid = page.getByText(copy.settings.invalidAddress, {
        exact: true,
      });
      await expect(invalid).toBeVisible();
      await page.mouse.move(200, 200);
      await page.mouse.wheel(0, 1500);
      const last = buttons.last();
      await expect(last).toBeVisible();
      await info.attach(`recovery-${locale}-${height}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect
        .soft(await exposed(last), `recovery final action ${locale}/${height}`)
        .toBe(true);
      expect(await page.evaluate(() => (window as any).__forbidden)).toEqual(
        []
      );
    }
});

test('synthetic guardian recovery enables at its deadline without remounting', async ({
  page,
}, info) => {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient')
  );
  const now = new Date('2026-10-18T22:30:00Z');
  const readyAt = now.getTime() / 1000 + 60;
  await page.clock.install({ time: new Date(now.getTime() - 60000) });
  await page.setViewportSize({ width: 400, height: 620 });
  const url = `${origin}/?mode=recovery-deadline&readyAt=${readyAt}`;
  await page.goto(url);
  const finalize = page.getByRole('button', {
    name: en.settings.smartAccountGuardianRecoveryFinalize,
    exact: true,
  });
  await expect(finalize).toBeVisible();
  await expect(finalize).toBeDisabled();
  await finalize.scrollIntoViewIfNeeded();
  const originalButton = await finalize.elementHandle();
  await page.clock.pauseAt(now);
  await page.clock.fastForward(59999);
  await expect(finalize).toBeDisabled();
  await info.attach('recovery-before-deadline', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.clock.fastForward(1);
  await expect(finalize).toBeEnabled();
  expect(await originalButton!.evaluate((button) => button.isConnected)).toBe(
    true
  );
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => Date.now())).toBe(readyAt * 1000);
  await info.attach('recovery-at-deadline', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(await page.evaluate(() => (window as any).__forbidden)).toEqual([]);

  // A fresh entry with an already-ready operation is the healthy control.
  // Never click Finalize: every mutation adapter remains forbidden.
  await page.clock.resume();
  await page.goto(
    `${origin}/?mode=recovery-deadline&readyAt=${now.getTime() / 1000 - 60}`
  );
  await expect(finalize).toBeEnabled();
  await finalize.scrollIntoViewIfNeeded();
  await info.attach('recovery-already-ready-entry', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(await page.evaluate(() => (window as any).__forbidden)).toEqual([]);
});
