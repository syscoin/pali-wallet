import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_RPC,
  VISUAL_FIXTURE_SEED,
  visualFixtureRead,
} from '../harness/visualFixture';

import { DEMO_DAPP_URL, installDemoDapp } from './demoDapp';

// Store media only. The normal compiled extension renders every inner image.
// All chain data is synthetic behind the existing launch-time deny proxy.
// No real account, live RPC, hardware device or transaction submission is used.
const OUT = process.env.PALI_STORE_MEDIA_OUT
  ? path.resolve(process.env.PALI_STORE_MEDIA_OUT)
  : path.join(__dirname, 'out', 'store-listing');
const RAW = path.join(OUT, 'raw');
const viewport = { width: 400, height: 620 };
const DEMO_TOKEN = '0x000000000000000000000000000000000000de01';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        character
      ]!)
  );

async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  return file;
}

async function card(
  page: Page,
  name: string,
  title: string,
  description: string,
  images: string[]
) {
  const src = (file: string) =>
    `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  const logo = fs
    .readFileSync(
      path.join(
        E2E_CONFIG.repoRoot,
        'source/assets/all_assets/pali-canary-icon.png'
      )
    )
    .toString('base64');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden}
    body{color:#f8fafc;font-family:Arial,sans-serif;background:
      radial-gradient(ellipse at 85% 30%,#28385b 0,transparent 54%),
      radial-gradient(ellipse at 0% 100%,#302040 0,transparent 55%),#071527}
    main{height:100%;display:flex;align-items:center;padding:62px 64px;gap:48px}
    .copy{width:${images.length > 1 ? 340 : 520}px;flex-shrink:0}
    .brand{display:flex;align-items:center;gap:14px;font-size:25px;font-weight:700}
    .brand img{width:48px;height:48px}.tag{color:#82d5f1;font-size:14px;letter-spacing:2px;margin-top:28px}
    h1{font-size:58px;line-height:1.08;letter-spacing:-2px;margin:22px 0;white-space:pre-line}
    p{font-size:22px;line-height:1.5;color:#b9c8da;margin:0}
    .frames{display:flex;align-items:center;justify-content:center;gap:24px;flex:1}
    .frame{border:1px solid #425875;border-radius:26px;overflow:hidden;background:#071527;box-shadow:0 28px 60px #02081380}
    .frame img{display:block;width:${
      images.length > 1 ? 300 : 400
    }px;height:auto}
    footer{position:absolute;left:64px;bottom:28px;right:64px;color:#a1b3c8;font-size:14px;display:flex;justify-content:space-between}
  </style></head><body><main><section class="copy"><div class="brand"><img src="data:image/png;base64,${logo}" alt="">Pali Wallet</div>
  <div class="tag">CANARY · PREVIEW</div><h1>${escape(title)}</h1><p>${escape(
    description
  )}</p></section>
  <section class="frames">${images
    .map(
      (file) =>
        `<div class="frame"><img src="${src(
          file
        )}" alt="Pali Wallet application screen"></div>`
    )
    .join('')}</section>
  </main><footer><span>Demo wallet · Simulated balances and activity</span><span>paliwallet.com</span></footer></body></html>`);
  await page.locator('img').evaluateAll(async (elements) => {
    await Promise.all(
      elements.map((image) => (image as HTMLImageElement).decode())
    );
  });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  return {
    file,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  };
}

test('capture four current Canary listing views with synthetic network data', async () => {
  expect(process.env.PALI_TEST_DAPP_CHANNEL).toBe('canary');
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  const identity = extensionEvidence();
  expect(identity.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  expect(
    JSON.parse(
      fs.readFileSync(
        path.join(E2E_CONFIG.extensionPath, 'manifest.json'),
        'utf8'
      )
    ).name
  ).toContain('Canary');
  fs.mkdirSync(RAW, { recursive: true });
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    chainId: VISUAL_FIXTURE_CHAIN_ID,
    networkLabel: 'zkTanenbaum',
    password: 'StoreMediaDisposable!2026',
    rpcUrl: server.url,
    seedPhrase: VISUAL_FIXTURE_SEED,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let routes:
    | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
    | undefined;
  const raw: Record<string, string> = {};
  const cards: Awaited<ReturnType<typeof card>>[] = [];
  const tokenReads: string[] = [];
  const tokenWrites: string[] = [];
  try {
    wallet = await PaliWallet.launch('store-listing-media', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport,
    });
    const fixture = createVisualFixture();
    routes = await installVisualFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const abi = AbiCoder.defaultAbiCoder();
    await wallet.context.route(VISUAL_FIXTURE_RPC, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      const body = request.postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      const tokenTarget = (call: any) =>
        String(call?.params?.[0]?.to || call?.params?.[0]).toLowerCase() ===
        DEMO_TOKEN;
      if (!calls.some(tokenTarget)) return route.fallback();
      if (
        calls.some((call: any) =>
          /^(eth_send|eth_sign|personal_|wallet_)/.test(call?.method || '')
        )
      ) {
        tokenWrites.push(...calls.map((call: any) => call.method));
        return route.abort('blockedbyclient');
      }
      const responses = calls.map((call: any) => {
        if (!tokenTarget(call))
          return (
            visualFixtureRead(fixture, request.url(), 'POST', call)?.body ?? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32601, message: 'Unsupported demo read' },
            }
          );
        tokenReads.push(
          call.method + ':' + String(call.params?.[0]?.data || '')
        );
        let result: string | undefined;
        if (call.method === 'eth_getCode') result = '0x60006000fd';
        if (call.method === 'eth_call') {
          const data = String(call.params[0].data);
          const selector = data.slice(0, 10);
          if (selector === id('name()').slice(0, 10))
            result = abi.encode(['string'], ['Pali Demo Token']);
          if (selector === id('symbol()').slice(0, 10))
            result = abi.encode(['string'], ['DEMO']);
          if (selector === id('decimals()').slice(0, 10))
            result = abi.encode(['uint8'], [6]);
          if (selector === id('totalSupply()').slice(0, 10))
            result = abi.encode(['uint256'], ['1250400000']);
          if (selector === id('supportsInterface(bytes4)').slice(0, 10))
            result = abi.encode(['bool'], [false]);
          if (selector === id('balanceOf(address)').slice(0, 10)) {
            const [owner] = abi.decode(['address'], '0x' + data.slice(10));
            if (owner.toLowerCase() === fixture.address.toLowerCase())
              result = abi.encode(['uint256'], ['1250400000']);
            if (owner.toLowerCase() === DEMO_TOKEN)
              result = abi.encode(['uint256'], ['0']);
          }
        }
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32601, message: 'Unsupported demo token read' },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? responses : responses[0]),
      });
    });
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('zkTanenbaum');
    await wallet.ensureOnHome();
    const page = wallet.page;
    await expect(page.locator('#home-balance')).toHaveText('248.88');
    await wallet.gotoRoute('#/tokens/add?tab=custom');
    await page.locator('#custom-token-contract').fill(DEMO_TOKEN);
    const importToken = page.getByRole('button', {
      name: 'Import DEMO token',
      exact: true,
    });
    await expect(importToken).toBeEnabled();
    await importToken.click();
    await expect(importToken).toBeDisabled();
    await wallet.gotoRoute('#/home');
    await wallet.ensureOnHome();
    await page.getByText('Assets', { exact: true }).click();
    await expect(page.getByText('DEMO', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/1,?250\.4/).first()).toBeVisible();
    await page
      .getByText('DEMO has been added to your wallet', { exact: true })
      .waitFor({ state: 'hidden', timeout: 10_000 });
    raw.portfolio = await shot(page, 'portfolio');

    await page
      .getByRole('button')
      .filter({ hasText: /UTXO|EVM/ })
      .first()
      .click();
    const menu = page.getByRole('menu');
    const evm = menu.getByRole('menuitem', { name: /EVM Networks/i }).first();
    if ((await evm.getAttribute('aria-expanded')) !== 'true') await evm.click();
    await expect(
      menu.getByRole('menuitem', { name: 'zkTanenbaum', exact: true }).first()
    ).toBeVisible();
    raw.networks = await shot(page, 'networks');
    await page.keyboard.press('Escape');

    await wallet.gotoRoute('#/settings/manage-accounts');
    await expect(
      page.locator('[data-navigation-scroll="settings-manage-accounts"]')
    ).toBeVisible();
    raw.accounts = await shot(page, 'accounts');
    await wallet.gotoRoute('#/home');
    await wallet.ensureOnHome();
    await page.locator('#general-settings-button').click();
    await expect(
      page.getByText(/Connect hardware wallet/i).first()
    ).toBeVisible();
    raw.accountOptions = await shot(page, 'account-options');
    await page.keyboard.press('Escape');

    await installDemoDapp(wallet.context);
    await page.goto('about:blank');
    const dapp = await wallet.context.newPage();
    await dapp.goto(DEMO_DAPP_URL);
    await dapp.waitForFunction(() => Boolean((window as any).ethereum));
    const popupPromise = wallet.context.waitForEvent('page');
    // The existing docs dapp keeps its exercise controls visually hidden.
    // Trigger its ordinary request handler, as the existing docs capture does.
    await dapp
      .locator('#connect')
      .evaluate((button: HTMLButtonElement) => button.click());
    const popup = await popupPromise;
    await popup.setViewportSize(viewport);
    await expect(
      popup.getByRole('button', { name: /^(connect|confirm)$/i }).first()
    ).toBeVisible();
    raw.connection = await shot(popup, 'connection');
    await popup
      .getByRole('button', { name: /^(cancel|reject)$/i })
      .first()
      .click();
    await expect.poll(() => popup.isClosed()).toBe(true);

    const canvas = await wallet.context.newPage();
    cards.push(
      await card(
        canvas,
        '01-wallet',
        'Your wallet.\nYour control.',
        'Balances, assets and everyday actions in one place.',
        [raw.portfolio]
      )
    );
    cards.push(
      await card(
        canvas,
        '02-networks',
        'Choose your\nnetwork.',
        'Switch between supported EVM and UTXO networks.',
        [raw.networks]
      )
    );
    cards.push(
      await card(
        canvas,
        '03-connect',
        'Connect with\nclear consent.',
        'Choose the account a site can access before connecting.',
        [raw.connection]
      )
    );
    cards.push(
      await card(
        canvas,
        '04-accounts',
        'Keep accounts\norganized.',
        'Manage wallet accounts and connect supported hardware wallets.',
        [raw.accounts, raw.accountOptions]
      )
    );
    expect(routes.deniedWrites).toEqual([]);
    expect(tokenWrites).toEqual([]);
    status = 'passed';
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'provenance.json'),
      JSON.stringify(
        {
          status,
          identity,
          innerImages: raw,
          cards,
          synthetic: true,
          submittedTransactions: 0,
          deniedWrites: routes?.deniedWrites,
          deniedUnknown: routes?.deniedUnknown,
          tokenReads,
          tokenWrites,
          capturedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
