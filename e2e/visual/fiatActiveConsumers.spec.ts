// Only public synthetic HTTP replies vary; wallet/controller authority stays real.
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import {
  extensionEvidence,
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_ADDRESS,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

const before = process.env.PALI_FIAT_CONSUMERS_MODE === 'before';
function runtimeEvidence() {
  expect([undefined, 'before', 'after']).toContain(
    process.env.PALI_FIAT_CONSUMERS_MODE
  );
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  if (before) {
    expect(process.env.CI).toBeFalsy();
    expect(process.env.PALI_TEST_DAPP_REVISION).toBe(
      'f164c1fd9abdf2d4744dc32ffda3189bee62aa41'
    );
  }
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  return runtime;
}
const sizes = [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
];
const scenarios = [
  { currency: 'usd', phase: 'missing', price: 0 },
  { currency: 'eur', phase: 'valid-zero', price: 0 },
  { currency: 'cad', phase: 'valid-positive', price: 2 },
] as const;

function installQuotes(context: BrowserContext) {
  const reads: string[] = [];
  const denied: string[] = [];
  const rates = { eur: 0, cad: 2 };
  const answer = async (route: any, evm: boolean) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      denied.push(request.method());
      return route.abort('blockedbyclient');
    }
    if (evm && url.searchParams.get('ids') !== 'syscoin')
      return route.fallback();
    if (
      !evm &&
      ![
        'https://blockbook-dev.syscoin.org',
        'https://explorer-blockbook-dev.syscoin.org',
      ].includes(url.origin)
    )
      return route.fallback();
    reads.push(request.url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(evm ? { syscoin: rates } : { rates }),
    });
  };
  return {
    reads,
    denied,
    install: async () => {
      await context.route('**/api/v2/tickers/currency', (route) =>
        answer(route, false)
      );
      await context.route(
        'https://api.coingecko.com/api/v3/simple/price**',
        (route) => answer(route, true)
      );
    },
  };
}

async function quoteState(page: Page) {
  return page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const account =
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ];
    return {
      quote: state.price.fiat,
      account: { id: account.id, address: account.address },
      native: String(account.balances[state.vault.activeNetwork.kind]),
      network: {
        chainId: state.vault.activeNetwork.chainId,
        kind: state.vault.activeNetwork.kind,
      },
    };
  });
}

async function chooseCurrency(wallet: PaliWallet, currency: string) {
  const page = wallet.page;
  await wallet.ensureOnHome();
  await page
    .getByRole('button', { name: en.generalMenu.generalOptions, exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: en.generalMenu.currency, exact: true })
    .click();
  await page
    .getByRole('button', { name: en.settings.setYourPreferred, exact: true })
    .click();
  await page
    .getByRole('textbox', { name: en.settings.searchCurrencies, exact: true })
    .fill(currency);
  await page
    .getByRole('button')
    .filter({ has: page.getByText(currency.toUpperCase(), { exact: true }) })
    .click();
  await page
    .getByRole('button', { name: en.buttons.save, exact: true })
    .click();
  await page
    .getByRole('dialog', {
      name: en.settings.fiatCurrencySetSuccessfully,
      exact: true,
    })
    .locator('#got-it-btn')
    .click();
  await wallet.ensureOnHome();
}

async function expose(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const measure = () =>
    target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const footer = [...document.querySelectorAll('div')].find((node) => {
        const style = getComputedStyle(node);
        return (
          style.position === 'fixed' &&
          style.bottom === '0px' &&
          node.getBoundingClientRect().top > 0
        );
      });
      const limit = footer?.getBoundingClientRect().top ?? innerHeight;
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        limit,
        width: innerWidth,
        exposed: !!hit && (element === hit || element.contains(hit)),
      };
    });
  let view = await measure();
  if (view.bottom > view.limit || !view.exposed) {
    await page.mouse.move(
      Math.max(1, (view.left + view.right) / 2),
      Math.max(1, Math.min(view.limit - 10, view.top + 5))
    );
    await page.mouse.wheel(0, Math.max(60, view.bottom - view.limit + 24));
  }
  await expect
    .poll(async () => {
      view = await measure();
      return view.top >= 0 && view.bottom <= view.limit && view.exposed;
    })
    .toBe(true);
  expect(view.right).toBeLessThanOrEqual(view.width);
}

async function captures(
  page: Page,
  target: Locator,
  info: TestInfo,
  name: string
) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expose(page, target);
    const file = info.outputPath(name + '-' + size.width + '.png');
    await page.screenshot({ path: file, animations: 'disabled' });
    await info.attach(name + '-' + size.width, {
      path: file,
      contentType: 'image/png',
    });
  }
}

test('normal UTXO Send keeps fee and total exact while unavailable fiat estimates disappear', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  const runtimeStart = runtimeEvidence();
  const original = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'FiatActiveConsumersSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const evidence: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('fiat-fee-and-confirm', {
      offlineHttpProxy: server.url,
      viewport: sizes[0],
    });
    const fixture = createUtxoFixture('200000000');
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const quotes = installQuotes(wallet.context);
    await quotes.install();
    await wallet.step(
      'import and open the normally funded testnet wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await expect(wallet!.page.locator('#home-balance')).toHaveText('2');
      }
    );
    let expectedNative: string[] | undefined;
    for (const scenario of scenarios)
      await wallet.step('fee and Confirm: ' + scenario.phase, async () => {
        const page = wallet!.page;
        if (scenario.currency !== 'usd')
          await chooseCurrency(wallet!, scenario.currency);
        await expect
          .poll(async () => (await quoteState(page)).quote)
          .toMatchObject({ asset: scenario.currency, price: scenario.price });
        const state = await quoteState(page);
        expect(Number(state.native)).toBe(2);
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        const fee = page.locator('#fee-input');
        await expect
          .poll(async () => Number(await fee.inputValue()))
          .toBeGreaterThan(0);
        await page
          .getByPlaceholder(en.send.receiver, { exact: true })
          .fill(fixture.recipientAddress);
        await page
          .getByPlaceholder(en.send.amount, { exact: true })
          .fill('0.0005');
        await fee.fill('0.00000002');
        const feeContainer = fee.locator('..');
        if (scenario.phase === 'missing' && !before)
          await expect(feeContainer).not.toContainText(
            en.components.estimatedAbbreviation
          );
        else
          await expect(feeContainer).toContainText(
            scenario.currency.toUpperCase()
          );
        await captures(page, feeContainer, info, 'fee-' + scenario.phase);
        expect(await fee.inputValue()).toBe('0.00000002');
        await page
          .getByRole('button', { name: en.buttons.next, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        await expect(
          page.getByRole('button', { name: en.buttons.confirm, exact: true })
        ).toBeEnabled();
        const native = await page
          .locator('span:not(:has(span))')
          .allTextContents()
          .then((values) =>
            values
              .filter((value) => /^\d+(?:\.\d+)? TSYS$/.test(value.trim()))
              .map((value) => value.trim())
          );
        expect(native.length).toBeGreaterThan(0);
        if (!expectedNative) expectedNative = native;
        else expect(native).toEqual(expectedNative);
        const approximations = page.locator('span').filter({ hasText: /^≈/ });
        if (scenario.phase === 'missing' && !before)
          await expect(approximations).toHaveCount(0);
        else {
          await expect(approximations.first()).toContainText(
            scenario.currency.toUpperCase()
          );
        }
        const nativeValue = page
          .locator('span')
          .filter({ hasText: /^\d+(?:\.\d+)? TSYS$/ })
          .last();
        await captures(page, nativeValue, info, 'confirm-' + scenario.phase);
        evidence.push({
          phase: scenario.phase,
          state,
          native,
          approximate: await approximations.allTextContents(),
        });
        await page
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
        await expect(
          page.getByPlaceholder(en.send.amount, { exact: true })
        ).toHaveValue('0.0005');
        await expect(page.locator('#fee-input')).toHaveValue('0.00000002');
        await page
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await wallet!.ensureOnHome();
        expect(routes.deniedWrites).toEqual([]);
        expect(routes.syntheticBroadcasts).toEqual([]);
      });
    expect(quotes.denied).toEqual([]);
    await info.attach('fee-confirm-quote-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        runtime: extensionEvidence(),
        before,
        evidence,
        reads: quotes.reads,
        realControllerUnmodified: true,
      }),
    });
    expect(extensionEvidence()).toEqual(runtimeStart);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, original);
    }
  }
});

test('actual EVM history and connection account cards distinguish missing quote from valid zero', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  const runtimeStart = runtimeEvidence();
  const original = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: VISUAL_FIXTURE_SEED,
    password: 'FiatHistorySynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const evidence: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('fiat-history-and-account-card', {
      offlineHttpProxy: server.url,
      viewport: sizes[0],
    });
    const fixture = createVisualFixture();
    const routes = await installVisualFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const quotes = installQuotes(wallet.context);
    await quotes.install();
    await wallet.step(
      'open ordinary synthetic funded EVM account and explorer history',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await expect(wallet!.page.locator('#home-balance')).toHaveText(
          '248.88'
        );
      }
    );
    const dapp = await wallet.step(
      'open the local read-only dapp',
      async () => {
        const dapp = await wallet!.context.newPage();
        await dapp.goto(server.url);
        await dapp.waitForFunction(() => Boolean((window as any).pali));
        return dapp;
      }
    );
    for (const scenario of scenarios)
      await wallet.step(
        'history and actual connection card: ' + scenario.phase,
        async () => {
          const page = wallet!.page;
          if (scenario.currency !== 'usd')
            await chooseCurrency(wallet!, scenario.currency);
          await expect
            .poll(async () => (await quoteState(page)).quote)
            .toMatchObject({ asset: scenario.currency, price: scenario.price });
          await page.locator('#activity-btn').click();
          const list = page.locator('#activity-panel-list');
          await expect(list).toBeVisible();
          const fiatLine = list
            .locator(
              'div.text-brand-gray200.text-xs.font-normal.whitespace-nowrap'
            )
            .first();
          await expect(fiatLine).toHaveText(
            scenario.phase === 'missing' && !before
              ? '---'
              : scenario.price === 0
              ? '0 ' + scenario.currency.toUpperCase()
              : '2 CAD'
          );
          await captures(
            page,
            fiatLine.locator('..'),
            info,
            'history-' + scenario.phase
          );
          const state = await quoteState(page);
          expect(state.account.address.toLowerCase()).toBe(
            VISUAL_FIXTURE_ADDRESS.toLowerCase()
          );
          const historyFiat = await fiatLine.textContent();
          // Close the main extension document before requesting the real singleton popup.
          // This mirrors the established connection harness; no controller response is substituted.
          await page.goto('about:blank');
          const id = await startRequest(dapp, 'eth_requestAccounts');
          let popup = await popupFor(wallet!.context, dapp, id);
          if (new URL(popup.url()).pathname === '/external/spam-warning') {
            const warning = popup;
            await expect(
              warning.getByRole('heading', {
                name: en.spamWarning.title,
                exact: true,
              })
            ).toBeVisible();
            await expect(
              warning.getByText(server.url, { exact: true })
            ).toBeVisible();
            await clickClosingPopup({
              click: () =>
                warning
                  .getByRole('button', {
                    name: en.buttons.continue,
                    exact: true,
                  })
                  .click(),
              isClosed: () => warning.isClosed(),
            });
            popup = await popupFor(wallet!.context, dapp, id);
          }
          const native = popup.getByText(/^248\.9 TSYS$/).first();
          await expect(native).toBeVisible();
          const accountBalance = native.locator('..');
          const wanted =
            scenario.phase === 'missing' && !before
              ? '--'
              : scenario.price === 0
              ? '0 ' + scenario.currency.toUpperCase()
              : '497.76 CAD';
          await expect(accountBalance).toContainText(wanted);
          await captures(
            popup,
            accountBalance,
            info,
            'connection-card-' + scenario.phase
          );
          const rejected = await dismissRejectedApproval({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(dapp, id),
          });
          // Connection middleware reports a refused connection as unauthorized.
          expect(rejected.error?.code).toBe(4100);
          expect(rejected.result).toBeUndefined();
          evidence.push({
            phase: scenario.phase,
            state,
            historyFiat,
            accountFiat: wanted,
            canceled: true,
          });
          await wallet!.gotoRoute('#/home');
          await wallet!.ensureOnHome();
          expect(routes.deniedWrites).toEqual([]);
        }
      );
    expect(quotes.denied).toEqual([]);
    await dapp.close();
    await info.attach('history-connection-quote-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        runtime: extensionEvidence(),
        before,
        evidence,
        reads: quotes.reads,
        realControllerUnmodified: true,
      }),
    });
    expect(extensionEvidence()).toEqual(runtimeStart);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, original);
    }
  }
});
