import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CHAIN_ID = 5700;
const EVM_LABEL = 'Syscoin NEVM Testnet';
const scenarios = [
  { symbol: 'XPAY', viewport: { width: 400, height: 620 } },
  {
    symbol: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF',
    viewport: { width: 320, height: 360 },
  },
];

const publicState = (page: Page) =>
  page.evaluate(async (chainId) => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const stored = await chrome.storage.local.get('state');
    const project = (network: any) => ({
      chainId: network.chainId,
      kind: network.kind,
      label: network.label,
      url: network.url,
      currency: network.currency,
      default: network.default,
    });
    return {
      live: project(current.vaultGlobal.networks.ethereum[chainId]),
      saved: project(stored.state.vaultGlobal.networks.ethereum[chainId]),
      active: project(current.vault.activeNetwork),
      isBitcoinBased: current.vault.isBitcoinBased,
      quoteUnit: current.price.fiat.asset,
      quotePrice: current.price.fiat.price,
      quoteAvailable: current.price.fiat.available,
      nativeBalance: String(
        current.vault.accounts[current.vault.activeAccount.type][
          current.vault.activeAccount.id
        ].balances[current.vault.activeNetwork.kind]
      ),
      savedQuoteUnit: stored.state.price.fiat.asset,
    };
  }, CHAIN_ID);

// Same bounded local read surface used by networkManagerIdentity. This RPC
// models an empty EVM testnet; it cannot sign, send or forward any request.
const evmRead = (call: any): unknown | undefined => {
  if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params)) return undefined;
  switch (call.method) {
    case 'eth_chainId':
      return call.params.length === 0 ? '0x1644' : undefined;
    case 'net_version':
      return call.params.length === 0 ? '5700' : undefined;
    case 'eth_blockNumber':
      return call.params.length === 0 ? '0x1' : undefined;
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return call.params.length === 0 ? '0x3b9aca00' : undefined;
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
    case 'eth_getCode':
      return call.params.length === 2 &&
        /^0x[0-9a-f]{40}$/i.test(call.params[0]) &&
        ['latest', 'pending'].includes(call.params[1])
        ? call.method === 'eth_getCode'
          ? '0x'
          : '0x0'
        : undefined;
    case 'eth_call':
      return call.params.length === 2 &&
        /^0x[0-9a-f]{40}$/i.test(call.params[0]?.to) &&
        ['latest', 'pending'].includes(call.params[1])
        ? '0x'
        : undefined;
    case 'eth_getLogs':
      return call.params.length === 1 &&
        typeof call.params[0] === 'object' &&
        call.params[0] !== null
        ? []
        : undefined;
    case 'eth_getBlockByNumber':
      return call.params.length === 2 &&
        ['latest', '0x0', '0x1'].includes(call.params[0]) &&
        typeof call.params[1] === 'boolean'
        ? {
            number: call.params[0] === '0x0' ? '0x0' : '0x1',
            hash: '0x' + (call.params[0] === '0x0' ? '11' : '12').repeat(32),
            parentHash:
              '0x' + (call.params[0] === '0x0' ? '00' : '11').repeat(32),
            nonce: '0x0000000000000000',
            timestamp: '0x1',
            difficulty: '0x0',
            gasLimit: '0x1c9c380',
            gasUsed: '0x0',
            miner: '0x' + '00'.repeat(20),
            extraData: '0x',
            transactions: [],
            baseFeePerGas: '0x3b9aca00',
          }
        : undefined;
    default:
      return undefined;
  }
};

for (const { symbol, viewport } of scenarios) {
  test(`Currency keeps a ${symbol.length}-character native symbol and balance readable at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    let origin = '';
    const reads: Array<{ family: string; method: string; url: string }> = [];
    const deniedLocal: Array<{ method: string; url: string }> = [];
    const attemptedWrites: string[] = [];
    const server = await startUtxoFixtureServer({
      readJson: (url) => {
        if (url.origin !== origin) return undefined;
        const result =
          url.pathname === '/api/v2/tickers/currency' && !url.search
            ? { ts: 1, rates: { usd: 1 } }
            : sptFixtureRead(
                fixture.utxo,
                'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
                'GET'
              );
        if (result !== undefined)
          reads.push({ family: 'syscoin', method: 'GET', url: url.href });
        return result;
      },
    });
    origin = server.url;
    const localRpc = origin + '/';
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'CurrencyNativeSymbolSynthetic!2026',
      rpcUrl: origin,
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, unknown> = {};
    try {
      wallet = await PaliWallet.launch(
        `currency-native-symbol-${symbol.length}`,
        {
          offlineHttpProxy: origin,
          viewport,
        }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        origin
      );
      wallet.context.on('request', (request) => {
        if (!/^https?:/.test(request.url())) return;
        let payload: any;
        try {
          payload = request.postDataJSON();
        } catch {
          /* Read-only REST. */
        }
        if (
          /\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname) ||
          (Array.isArray(payload) ? payload : [payload]).some((call) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
              call?.method || ''
            )
          )
        )
          attemptedWrites.push(request.url());
      });
      await wallet.context.route(origin + '/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET') {
          if (
            url.pathname === '/' ||
            (url.pathname === '/api/v2/tickers/currency' && !url.search) ||
            sptFixtureRead(
              fixture.utxo,
              'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
              'GET'
            ) !== undefined
          )
            return route.continue();
        } else if (request.url() === localRpc) {
          if (request.method() === 'OPTIONS')
            return route.fulfill({
              status: 204,
              headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'POST, OPTIONS',
              },
            });
          if (request.method() === 'POST') {
            let input: any;
            try {
              input = request.postDataJSON();
            } catch {
              /* Malformed input is refused below. */
            }
            const calls = Array.isArray(input) ? input : [input];
            const results = calls.map(evmRead);
            if (
              calls.length > 0 &&
              results.every((result) => result !== undefined)
            ) {
              reads.push(
                ...calls.map((call) => ({
                  family: 'ethereum',
                  method: call.method,
                  url: request.url(),
                }))
              );
              const replies = calls.map((call, index) => ({
                jsonrpc: '2.0',
                id: call.id,
                result: results[index],
              }));
              return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify(
                  Array.isArray(input) ? replies : replies[0]
                ),
              });
            }
          }
        }
        deniedLocal.push({ method: request.method(), url: request.url() });
        return route.abort('blockedbyclient');
      });
      const page = wallet.page;
      const openCurrency = async () => {
        await page
          .getByRole('button', {
            name: en.generalMenu.generalOptions,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: en.generalMenu.currency, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/currency(?:\?.*)?$/);
      };
      const balanceCard = () =>
        page
          .getByText(en.components.currentBalance, { exact: true })
          .locator('..');
      const assertUnavailableQuote = async (
        currency: string,
        selected = currency
      ) => {
        const state = await publicState(page);
        expect(state.quoteUnit).toBe(currency);
        expect(state.savedQuoteUnit).toBe(currency);
        expect(state.quotePrice).toBe(0);
        expect(state.quoteAvailable).toBe(false);
        // These fenced routes provide no EVM market quote. The saved preference
        // remains selected, but unavailable must not pretend to be 0 USD/EUR.
        await expect(
          balanceCard().locator('p.text-brand-gray200.text-sm.mt-1')
        ).toHaveText(en.settings.unavailable);
        await expect(
          page.getByRole('button', {
            name: en.settings.setYourPreferred,
            exact: true,
          })
        ).toContainText(selected.toUpperCase());
      };
      const assertNativeLayout = async (phase: 'initial' | 'reopened') => {
        const card = balanceCard();
        expect(Number((await publicState(page)).nativeBalance)).toBe(0);
        await card.scrollIntoViewIfNeeded();
        const unit = card.getByText(symbol, { exact: true });
        await expect(unit).toBeVisible();
        await expect(unit).toHaveAttribute('title', symbol);
        const amount = card.getByText('0', { exact: true });
        await expect(amount).toBeVisible();
        const metrics = await card.evaluate((element, expected) => {
          const label = Array.from(element.querySelectorAll('p')).find(
            (candidate) => candidate.textContent?.trim() === expected
          );
          const number = Array.from(element.querySelectorAll('p')).find(
            (candidate) => candidate.textContent?.trim() === '0'
          );
          if (!label || !number || label.parentElement !== number.parentElement)
            throw new Error('Missing native balance row');
          const measure = (value: Element) => {
            const bounds = value.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
              clientWidth: value.clientWidth,
              scrollWidth: value.scrollWidth,
            };
          };
          const cardBox = measure(element);
          const style = getComputedStyle(element);
          return {
            card: cardBox,
            content: {
              left:
                cardBox.left +
                parseFloat(style.borderLeftWidth) +
                parseFloat(style.paddingLeft),
              right:
                cardBox.right -
                parseFloat(style.borderRightWidth) -
                parseFloat(style.paddingRight),
            },
            row: measure(label.parentElement),
            unit: measure(label),
            amount: measure(number),
            document: {
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
            },
          };
        }, symbol);
        observations[`${phase}Layout`] = metrics;
        expect(metrics.amount.width).toBeGreaterThan(0);
        expect(metrics.amount.height).toBeGreaterThan(0);
        for (const item of [metrics.row, metrics.amount, metrics.unit]) {
          expect(item.left).toBeGreaterThanOrEqual(metrics.content.left - 0.5);
          expect(item.right).toBeLessThanOrEqual(metrics.content.right + 0.5);
          expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth);
        }
        expect(metrics.card.scrollWidth).toBeLessThanOrEqual(
          metrics.card.clientWidth
        );
        expect(metrics.document.scrollWidth).toBeLessThanOrEqual(
          metrics.document.clientWidth
        );
        expect(
          metrics.amount.bottom <= metrics.unit.top ||
            metrics.unit.bottom <= metrics.amount.top ||
            metrics.amount.right <= metrics.unit.left ||
            metrics.unit.right <= metrics.amount.left
        ).toBe(true);
        return metrics;
      };

      await wallet.step(
        'default testnet keeps its native TSYS denomination',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await openCurrency();
          await expect(
            balanceCard().getByText('TSYS', { exact: true })
          ).toBeVisible();
          await assertUnavailableQuote('usd');
          const initial = await publicState(page);
          expect(initial.isBitcoinBased).toBe(true);
          expect(initial.active.currency).toBe('tsys');
          expect(initial.quoteUnit).toBe('usd');
          observations.defaultNetwork = initial;
        }
      );

      await wallet.step(
        `save an ordinary EVM5700 network edit with native symbol ${symbol}`,
        async () => {
          await wallet!.gotoRoute('#/settings/networks/edit');
          const manager = page.locator(
            '[data-navigation-scroll="settings-manage-networks"]'
          );
          await expect(manager).toBeVisible();
          const row = manager
            .locator('li')
            .filter({ has: page.getByText(EVM_LABEL, { exact: true }) });
          await expect(row).toHaveCount(1);
          await row.locator('button').first().click();
          await expect(page.locator('input#rpc_chainId')).toHaveValue(
            String(CHAIN_ID)
          );
          await page.locator('input#rpc_symbol').fill(symbol);
          await page.locator('input#rpc_url').fill(localRpc);
          await page.locator('input#rpc_explorer').fill(localRpc);
          await page.locator('input#rpc_apiUrl').fill('');
          await page.locator('input#rpc_url').focus();
          await page.locator('input#rpc_url').press('Tab');
          await expect
            .poll(() => reads.some((read) => read.method === 'eth_chainId'))
            .toBe(true);
          const save = page.getByRole('button', {
            name: en.buttons.save,
            exact: true,
          });
          await expect(save).toBeEnabled();
          await save.click();
          await expect(manager).toBeVisible();
          await expect
            .poll(async () => (await publicState(page)).saved)
            .toMatchObject({
              chainId: CHAIN_ID,
              label: EVM_LABEL,
              currency: symbol.toLowerCase(),
              url: localRpc,
              default: false,
            });
          const edited = await publicState(page);
          expect(edited.live).toEqual(edited.saved);
          observations.edited = edited;
        }
      );

      await wallet.step(
        'Currency displays the edited symbol instead of inferring TSYS from chain ID',
        async () => {
          await wallet!.switchNetwork(EVM_LABEL, 'EVM');
          const active = await publicState(page);
          expect(active.isBitcoinBased).toBe(false);
          expect(active.active).toEqual(active.saved);
          expect(active.active.currency).toBe(symbol.toLowerCase());
          await openCurrency();
          await expect(
            balanceCard().getByText(symbol, { exact: true })
          ).toBeVisible();
          await expect(
            balanceCard().getByText('TSYS', { exact: true })
          ).toHaveCount(0);
          await assertUnavailableQuote('usd');
          await assertNativeLayout('initial');
          observations.beforeFiatSave = await publicState(page);
        }
      );

      await wallet.step(
        'saving a fiat unit preserves the native denomination and persists only the selected quote unit',
        async () => {
          await page
            .getByRole('button', {
              name: en.settings.setYourPreferred,
              exact: true,
            })
            .click();
          const search = page.getByRole('textbox', {
            name: en.settings.searchCurrencies,
            exact: true,
          });
          await search.fill('eur');
          await search.press('Tab');
          await page.keyboard.press('Enter');
          await expect(
            page.getByRole('button', {
              name: en.settings.setYourPreferred,
              exact: true,
            })
          ).toContainText('EUR');
          await assertUnavailableQuote('usd', 'eur');
          await expect(
            balanceCard().getByText(symbol, { exact: true })
          ).toBeVisible();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          const modal = page.getByRole('dialog', {
            name: en.settings.fiatCurrencySetSuccessfully,
            exact: true,
          });
          await expect(modal).toBeVisible();
          await expect(modal).toContainText(
            en.settings.nowYouWill.replace('{{currency}}', symbol)
          );
          await expect
            .poll(async () => {
              const state = await publicState(page);
              return [state.quoteUnit, state.savedQuoteUnit];
            })
            .toEqual(['eur', 'eur']);
          await modal.locator('#got-it-btn').click();
          await openCurrency();
          await expect(
            balanceCard().getByText(symbol, { exact: true })
          ).toBeVisible();
          await expect(
            balanceCard().getByText('TSYS', { exact: true })
          ).toHaveCount(0);
          await assertUnavailableQuote('eur');
          await assertNativeLayout('reopened');
          await expect(
            page.getByRole('button', { name: en.buttons.save, exact: true })
          ).toBeDisabled();
          const saved = await publicState(page);
          expect(saved.active).toEqual(saved.saved);
          expect(saved.live).toEqual(saved.saved);
          expect(saved.saved.currency).toBe(symbol.toLowerCase());
          observations.afterFiatSave = saved;
        }
      );
      observations.worker = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (value) => {
          observations.worker = value;
        }
      );
      expect(reads.some((read) => read.method === 'eth_chainId')).toBe(true);
      expect(deniedLocal).toEqual([]);
      expect(attemptedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(sourceSha256);
      status = 'passed';
    } finally {
      try {
        await info.attach('currency-native-symbol-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            runtime,
            sourceSha256,
            symbol,
            viewport,
            localRpc,
            observations,
            reads,
            deniedLocal,
            attemptedWrites,
            fixtureReads: routes?.reads || [],
            fixtureDeniedWrites: routes?.deniedWrites || [],
            proxyBlocked: server.blocked,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            signingOrBroadcastRequested: false,
          }),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server.close();
          } finally {
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    }
  });
}
