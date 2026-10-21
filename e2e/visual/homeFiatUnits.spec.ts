import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { parseEther } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  visualFixtureRead,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_RPC,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

const BELOW_MILLION = '999999000000000000000000';
const MILLION = '1000000000000000000000000';
// ethers coalesces identical provider reads inside this existing cache window.
const PROVIDER_READ_CACHE_MS = 250;

const publicFiatState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { vault, vaultGlobal, price } = state;
    const ref = vault.activeAccount;
    const account = vault.accounts[ref.type][ref.id];
    return {
      account: { ...ref, address: account.address },
      balance: String(account.balances.ethereum),
      currency: price.fiat.asset,
      price: price.fiat.price,
      kind: vault.activeNetwork.kind,
      chainId: vault.activeNetwork.chainId,
      rpc: vault.activeNetwork.url,
      coin: vaultGlobal.networks.ethereum[vault.activeNetwork.chainId]
        .coingeckoId,
      loading: Boolean(vaultGlobal.loadingStates?.isLoadingBalances),
      refreshEnabled: vaultGlobal.advancedSettings.refresh,
    };
  });

async function openSetting(wallet: PaliWallet, label: string, route: string) {
  await wallet.page.locator('#general-settings-button').click();
  await wallet.page.getByText(label, { exact: true }).click();
  await expect.poll(() => new URL(wallet.page.url()).hash).toBe(route);
}

test('Home retains fiat symbols and currency units when a large balance is compacted', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const previous = { ...E2E_CONFIG };
  const fixture = createVisualFixture();
  fixture.balanceWei = BELOW_MILLION;
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'below-million-usd';
  const balanceReads: Array<{
    address: string;
    observedAtMs: number;
    phase: string;
    result: string;
  }> = [];
  const quoteReads: Array<{
    currency: string;
    phase: string;
    url: string;
    wireSha256: string;
  }> = [];
  const deniedRequests: string[] = [];
  const observations: Array<{
    phase: string;
    state: Awaited<ReturnType<typeof publicFiatState>>;
    visibleFiat: string;
    visibleNative: string;
  }> = [];
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
      password: 'HomeFiatUnitsSynthetic!2026',
      rpcUrl: server.url,
      seedPhrase: VISUAL_FIXTURE_SEED,
    });
    wallet = await PaliWallet.launch('home-fiat-units', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installVisualFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Reuse the fixture's real wire producer, recording the exact returned
    // balance. Only public HTTP replies vary; no controller or store is replaced.
    await wallet.context.route(VISUAL_FIXTURE_RPC + '/', async (route) => {
      const request = route.request();
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        deniedRequests.push('non-JSON RPC');
        return route.abort('blockedbyclient');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedRequests.push('forbidden RPC');
        return route.abort('blockedbyclient');
      }
      const result = visualFixtureRead(
        fixture,
        request.url(),
        request.method(),
        payload
      );
      if (!result || result.unsupported?.length) {
        deniedRequests.push('unsupported RPC');
        return route.abort('blockedbyclient');
      }
      const replies: any[] = Array.isArray(result.body)
        ? result.body
        : [result.body];
      calls.forEach((call, index) => {
        if (call.method === 'eth_getBalance')
          balanceReads.push({
            address: String(call.params[0]).toLowerCase(),
            observedAtMs: Date.now(),
            phase,
            result: replies[index].result,
          });
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(result.body),
      });
    });
    await wallet.context.route(
      'https://api.coingecko.com/api/v3/simple/price?*',
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const currency = url.searchParams.get('vs_currencies');
        if (
          request.method() !== 'GET' ||
          url.username ||
          url.password ||
          url.hash ||
          url.searchParams.get('ids') !== 'syscoin' ||
          url.searchParams.get('include_24hr_change') !== 'true' ||
          !['usd', 'eur'].includes(currency || '') ||
          [...url.searchParams.keys()].sort().join(',') !==
            'ids,include_24hr_change,vs_currencies'
        ) {
          deniedRequests.push('unsupported quote: ' + request.url());
          return route.abort('blockedbyclient');
        }
        const wire = JSON.stringify({
          syscoin: {
            [currency!]: currency === 'usd' ? 0.125 : 0.2,
            [currency! + '_24h_change']: 0,
          },
        });
        quoteReads.push({
          currency: currency!,
          phase,
          url: request.url(),
          wireSha256: createHash('sha256').update(wire).digest('hex'),
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: wire,
        });
      }
    );
    const page = wallet.page;
    const assertHome = async (
      wei: string,
      currency: 'usd' | 'eur',
      native: string,
      fiat: string
    ) => {
      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.locator('#home-balance')).toHaveText(native);
      const fiatLabel = page.locator('p.text-sm.text-brand-graylight');
      await expect(fiatLabel).toHaveCount(1);
      await expect(fiatLabel).toHaveText(fiat);
      await expect(fiatLabel).toBeInViewport();
      await expect
        .poll(async () => {
          const state = await publicFiatState(page);
          return { ...state, balance: parseEther(state.balance).toString() };
        })
        .toMatchObject({
          balance: wei,
          currency,
          price: currency === 'usd' ? 0.125 : 0.2,
          kind: 'ethereum',
          chainId: VISUAL_FIXTURE_CHAIN_ID,
          rpc: VISUAL_FIXTURE_RPC,
          coin: 'syscoin',
          loading: false,
        });
      const state = await publicFiatState(page);
      expect(state.account.address.toLowerCase()).toBe(
        fixture.address.toLowerCase()
      );
      if (observations.length)
        expect(state.account).toEqual(observations[0].state.account);
      observations.push({
        phase,
        state,
        visibleFiat: await fiatLabel.innerText(),
        visibleNative: await page.locator('#home-balance').innerText(),
      });
    };
    const refreshBalance = async (nextPhase: string, wei: string) => {
      phase = nextPhase;
      fixture.balanceWei = wei;
      await expect
        .poll(() => {
          const last = balanceReads
            .filter((read) => read.address === fixture.address.toLowerCase())
            .at(-1);
          return (
            !last || Date.now() - last.observedAtMs > PROVIDER_READ_CACHE_MS
          );
        })
        .toBe(true);
      const count = balanceReads.length;
      await page
        .getByRole('button', { name: en.header.refresh, exact: true })
        .click();
      await expect
        .poll(() =>
          balanceReads
            .slice(count)
            .some(
              (read) =>
                read.address === fixture.address.toLowerCase() &&
                read.phase === phase &&
                read.result === '0x' + BigInt(wei).toString(16)
            )
        )
        .toBe(true);
    };
    await wallet.step(
      'home-fiat: show exact USD units below the compact threshold',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum', 'EVM');
        await wallet!.ensureOnHome();
        await expect
          .poll(() => quoteReads.some((read) => read.currency === 'usd'))
          .toBe(true);
        await assertHome(BELOW_MILLION, 'usd', '999999', '$124999.875 USD');
      }
    );
    await wallet.step(
      'home-fiat: enable ordinary Home refresh through Advanced settings',
      async () => {
        await openSetting(
          wallet!,
          en.generalMenu.advanced,
          '#/settings/advanced'
        );
        await page.locator('#advanced-refresh').click();
        await page.getByRole('dialog').locator('#confirm-btn').click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await wallet!.ensureOnHome();
        await expect(
          page.getByRole('button', { name: en.header.refresh, exact: true })
        ).toBeVisible();
        expect((await publicFiatState(page)).refreshEnabled).toBe(true);
        await assertHome(BELOW_MILLION, 'usd', '999999', '$124999.875 USD');
      }
    );
    await wallet.step(
      'home-fiat: retain the dollar symbol and USD code for one million native units',
      async () => {
        await refreshBalance('million-usd', MILLION);
        await assertHome(MILLION, 'usd', '1M', '$125K USD');
      }
    );
    await wallet.step(
      'home-fiat: save EUR normally and retain the euro symbol and code',
      async () => {
        phase = 'million-eur';
        await openSetting(
          wallet!,
          en.generalMenu.currency,
          '#/settings/currency'
        );
        await page
          .getByRole('button', {
            name: en.settings.setYourPreferred,
            exact: true,
          })
          .click();
        await page
          .getByRole('textbox', {
            name: en.settings.searchCurrencies,
            exact: true,
          })
          .fill('eur');
        const option = page
          .getByRole('button')
          .filter({ has: page.getByText('EUR', { exact: true }) });
        await expect(option).toHaveCount(1);
        await option.click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        const confirmation = page.getByRole('dialog', {
          name: en.settings.fiatCurrencySetSuccessfully,
          exact: true,
        });
        await expect(confirmation).toBeVisible();
        await confirmation.locator('#got-it-btn').click();
        await wallet!.ensureOnHome();
        await expect
          .poll(() =>
            quoteReads.some(
              (read) => read.currency === 'eur' && read.phase === phase
            )
          )
          .toBe(true);
        await assertHome(MILLION, 'eur', '1M', '€200K EUR');
      }
    );
    await wallet.step(
      'home-fiat: preserve EUR units when an ordinary refresh returns zero',
      async () => {
        await refreshBalance('zero-eur', '0');
        await assertHome('0', 'eur', '0', '€0 EUR');
      }
    );
    expect(deniedRequests).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    try {
      await info.attach('home-fiat-units-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(info.file))
            .digest('hex'),
          observations,
          balanceReads,
          quoteReads,
          deniedRequests,
          otherReads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          otherDeniedReads: routes?.deniedUnknown || [],
          proxyDeniedRequests: server?.blocked || [],
          syntheticHttpOnly: true,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          chromeApiReplaced: false,
          signingOrBroadcastRequested: false,
        }),
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server?.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
