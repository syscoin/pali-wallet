import { expect, test, type Page } from '@playwright/test';
import { parseEther } from 'ethers';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Missing rates and a successfully fetched zero must remain distinct.
const mode = process.env.PALI_FIAT_AVAILABILITY_MODE || 'after';
const before = mode === 'before';
const BEFORE_REVISION = 'f164c1fd9abdf2d4744dc32ffda3189bee62aa41';
type Phase = 'quote-missing' | 'quote-zero';

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const ref = state.vault.activeAccount;
    const account = state.vault.accounts[ref.type][ref.id];
    return {
      account: { ...ref, address: account.address },
      network: {
        label: state.vault.activeNetwork.label,
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
      },
      balance: String(
        state.vault.isBitcoinBased
          ? account.balances.syscoin
          : account.balances.ethereum
      ),
      fiat: { asset: state.price.fiat.asset, price: state.price.fiat.price },
      quoteAvailable: state.price.fiat.available ?? null,
      savedFiat: saved.state?.price?.fiat?.asset ?? null,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
      switchingAccount: state.vaultGlobal.isSwitchingAccount,
    };
  });

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  for (const initialPhase of ['quote-missing', 'quote-zero'] as const) {
    test(`Currency observes ${initialPhase} with a positive native balance at ${viewport.width}px`, async ({}, info) => {
      test.setTimeout(120_000);
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(['before', 'after']).toContain(mode);
      if (before) {
        expect(process.env.CI).toBeFalsy();
        expect(process.env.PALI_TEST_DAPP_REVISION).toBe(BEFORE_REVISION);
      }
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);

      const previous = { ...E2E_CONFIG };
      const fixture = createIsolatedVaultFixture();
      const server = await startUtxoFixtureServer();
      let phase: Phase = initialPhase;
      const copy = en;
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      const balanceReads: Array<{
        phase: Phase;
        address: string;
        error: boolean;
        result?: string;
      }> = [];
      const quoteReads: Array<{
        phase: Phase;
        currency: string;
        available: boolean;
        returnedPrice: number | null;
        wire: string;
      }> = [];
      const unexpected: string[] = [];
      const observations: unknown[] = [];
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'CurrencyAvailabilitySynthetic!2026',
        rpcUrl: server.url,
      });
      try {
        wallet = await PaliWallet.launch(
          `currency-availability-${initialPhase}-${viewport.width}`,
          {
            offlineHttpProxy: server.url,
            recordVideo: false,
            viewport,
          }
        );
        const routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        // Ordinary provider reads only. Changing wire availability never
        // replaces a controller result, account, stored balance or quote.
        await wallet.context.route(
          'https://rpc.tanenbaum.io/',
          async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') return route.fallback();
            const raw = request.postDataJSON();
            const calls = Array.isArray(raw) ? raw : [raw];
            const replies = calls.map((call: any) => {
              let result: unknown;
              switch (call.method) {
                case 'eth_chainId':
                  result = '0x1644';
                  break;
                case 'net_version':
                  result = '5700';
                  break;
                case 'eth_blockNumber':
                  result = '0x1';
                  break;
                case 'eth_getBalance': {
                  const address = String(call.params?.[0]).toLowerCase();
                  if (
                    !fixture.evmAddresses.some(
                      (owner) => owner.toLowerCase() === address
                    )
                  )
                    break;
                  result = '0x' + parseEther('10').toString(16);
                  balanceReads.push({
                    phase,
                    address,
                    error: false,
                    result: String(result),
                  });
                  break;
                }
                case 'eth_getTransactionCount':
                  result = '0x0';
                  break;
                case 'eth_gasPrice':
                case 'eth_maxPriorityFeePerGas':
                  result = '0x3b9aca00';
                  break;
                case 'eth_getCode':
                case 'eth_call':
                  result = '0x';
                  break;
                case 'eth_getLogs':
                  result = [];
                  break;
                case 'eth_getBlockByNumber':
                  result = {
                    number: '0x1',
                    hash: '0x' + '12'.repeat(32),
                    parentHash: '0x' + '11'.repeat(32),
                    nonce: '0x0000000000000000',
                    timestamp: '0x1',
                    difficulty: '0x0',
                    gasLimit: '0x1c9c380',
                    gasUsed: '0x0',
                    miner: '0x' + '00'.repeat(20),
                    extraData: '0x',
                    transactions: [],
                    baseFeePerGas: '0x3b9aca00',
                  };
                  break;
              }
              if (result === undefined) unexpected.push(call.method);
              return result === undefined
                ? {
                    jsonrpc: '2.0',
                    id: call.id,
                    error: {
                      code: -32601,
                      message: 'Unsupported synthetic read',
                    },
                  }
                : { jsonrpc: '2.0', id: call.id, result };
            });
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(raw) ? replies : replies[0]),
            });
          }
        );
        await wallet.context.route(
          'https://api.coingecko.com/api/v3/simple/price?*',
          async (route) => {
            const url = new URL(route.request().url());
            const currency = url.searchParams.get('vs_currencies') || '';
            if (
              route.request().method() !== 'GET' ||
              url.searchParams.get('ids') !== 'syscoin' ||
              currency !== 'usd' ||
              url.searchParams.get('include_24hr_change') !== 'true' ||
              [...url.searchParams.keys()].sort().join(',') !==
                'ids,include_24hr_change,vs_currencies'
            ) {
              unexpected.push(route.request().url());
              return route.abort('blockedbyclient');
            }
            const quoteBody: {
              syscoin: { usd?: number; usd_24h_change?: number };
            } = {
              syscoin:
                phase === 'quote-missing' ? {} : { usd: 0, usd_24h_change: 0 },
            };
            const wire = JSON.stringify(quoteBody);
            quoteReads.push({
              phase,
              currency,
              available: Object.prototype.hasOwnProperty.call(
                quoteBody.syscoin,
                'usd'
              ),
              returnedPrice: quoteBody.syscoin.usd ?? null,
              wire,
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
        const openSetting = async (label: string, route: string) => {
          await page
            .getByRole('button', {
              name: copy.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: label, exact: true })
            .click();
          await expect(page).toHaveURL(new RegExp('#' + route + '$'));
        };
        const openCurrency = async () => {
          await openSetting(copy.generalMenu.currency, '/settings/currency');
          await expect(
            page.getByRole('button', {
              name: copy.settings.setYourPreferred,
              exact: true,
            })
          ).toBeVisible();
        };
        const card = () =>
          page
            .getByText(copy.components.currentBalance, { exact: true })
            .locator('..');
        const save = () =>
          page.getByRole('button', { name: copy.buttons.save, exact: true });
        const capture = async (name: string) => {
          const balanceCard = card();
          await balanceCard.scrollIntoViewIfNeeded();
          observations.push({
            name,
            state: await publicState(page),
            card: await balanceCard.innerText(),
            saveEnabled: await save().isEnabled(),
          });
          await info.attach(
            `${mode}-${initialPhase}-${viewport.width}-${name}`,
            {
              body: await page.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            }
          );
          await info.attach(
            `${mode}-${initialPhase}-${viewport.width}-${name}-card`,
            {
              body: await balanceCard.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            }
          );
        };
        await wallet.step(
          'load a positive native balance through the real provider',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.ensureOnHome();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await expect
              .poll(async () => Number((await publicState(page)).balance))
              .toBe(10);
            await expect.poll(() => quoteReads.length).toBeGreaterThan(0);
            await expect
              .poll(async () => (await publicState(page)).fiat)
              .toEqual({ asset: 'usd', price: 0 });
            await expect(page.locator('#home-balance')).toHaveText('10');
            await expect(
              page.getByText(
                !before && phase === 'quote-missing'
                  ? en.settings.unavailable
                  : '$0 USD',
                { exact: true }
              )
            ).toBeVisible();
            if (!before)
              expect((await publicState(page)).quoteAvailable).toBe(
                phase === 'quote-zero'
              );
            await info.attach(
              `${mode}-${initialPhase}-${viewport.width}-home`,
              {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              }
            );
            observations.push({
              name: 'home',
              state: await publicState(page),
              visibleFiat: await page
                .locator('p.text-sm.text-brand-graylight')
                .allTextContents(),
            });
          }
        );
        await wallet.step(
          'distinguish unavailable fiat from a fetched zero without changing native funds or units',
          async () => {
            await openCurrency();
            await expect(card().getByText('10', { exact: true })).toBeVisible();
            await expect(
              card().getByText(
                !before && phase === 'quote-missing'
                  ? en.settings.unavailable
                  : '$0 USD',
                { exact: true }
              )
            ).toBeVisible();
            if (!before && phase === 'quote-missing')
              await expect(card()).not.toContainText('$0');
            await expect(save()).toBeDisabled();
            await capture('price-observation');
            await info.attach('fiat-availability-observation', {
              contentType: 'application/json',
              body: JSON.stringify(
                {
                  runtime: extensionEvidence(),
                  viewport,
                  phase,
                  balanceReads,
                  quoteReads,
                  observations,
                  nativeBalanceKnown: true,
                  falseZeroObserved: before && phase === 'quote-missing',
                  quoteAvailable: (await publicState(page)).quoteAvailable,
                  fixtureDeniedWrites: routes.deniedWrites,
                  unexpected,
                  controllerStateReplaced: false,
                  controllerResultsReplaced: false,
                  currencySaveClicked: false,
                },
                null,
                2
              ),
            });
            expect(unexpected).toEqual([]);
            expect(routes.deniedWrites).toEqual([]);
            expect(
              quoteReads.every(
                (row) => row.available === (phase === 'quote-zero')
              )
            ).toBe(true);
            expect(
              quoteReads.every(
                (row) =>
                  row.returnedPrice === (phase === 'quote-zero' ? 0 : null)
              )
            ).toBe(true);
          }
        );
        if (initialPhase === 'quote-missing')
          await wallet.step(
            'a real zero quote recovers the same currency without preference Save',
            async () => {
              await page
                .getByRole('button', { name: en.buttons.back, exact: true })
                .click();
              phase = 'quote-zero';
              await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
              await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
              await expect
                .poll(async () => (await publicState(page)).fiat)
                .toEqual({ asset: 'usd', price: 0 });
              await expect(page.locator('#home-balance')).toHaveText('10');
              await expect(
                page.getByText('$0 USD', { exact: true })
              ).toBeVisible();
              await openCurrency();
              await expect(
                card().getByText('$0 USD', { exact: true })
              ).toBeVisible();
              await expect(
                card().getByText('10', { exact: true })
              ).toBeVisible();
              await expect(save()).toBeDisabled();
              expect((await publicState(page)).savedFiat).toBe('usd');
              if (!before)
                expect((await publicState(page)).quoteAvailable).toBe(true);
              expect(
                quoteReads.some(
                  (row) => row.phase === 'quote-zero' && row.returnedPrice === 0
                )
              ).toBe(true);
              expect(routes.deniedWrites).toEqual([]);
            }
          );
        status = 'passed';
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    });
  }
}
