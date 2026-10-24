import { expect, test, type Page } from '@playwright/test';
import { parseEther } from 'ethers';
import path from 'path';

import de from '../../source/assets/locales/de.json';
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

const BEFORE_REVISION = 'f164c1fd9abdf2d4744dc32ffda3189bee62aa41';
const mode = process.env.PALI_CURRENCY_AVAILABILITY_MODE || 'after';
type Phase = 'failed' | 'positive' | 'zero';

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
      savedFiat: saved.state?.price?.fiat?.asset ?? null,
      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
      switchingAccount: state.vaultGlobal.isSwitchingAccount,
    };
  });

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  for (const initialPhase of ['failed', 'zero'] as const) {
    test(`Currency distinguishes ${initialPhase} native reads from a priced zero at ${viewport.width}px`, async ({}, info) => {
      test.setTimeout(120_000);
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(['before', 'after']).toContain(mode);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      if (mode === 'before') {
        expect(process.env.CI).toBeFalsy();
        expect(process.env.PALI_TEST_DAPP_REVISION).toBe(BEFORE_REVISION);
      }
      const previous = { ...E2E_CONFIG };
      const fixture = createIsolatedVaultFixture();
      const server = await startUtxoFixtureServer();
      let phase: Phase = initialPhase;
      let copy = en;
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
                  const failed = phase === 'failed';
                  const amount =
                    phase === 'positive' ? parseEther('10') : BigInt(0);
                  result = failed ? undefined : '0x' + amount.toString(16);
                  balanceReads.push({
                    phase,
                    address,
                    error: failed,
                    ...(result === undefined ? {} : { result: String(result) }),
                  });
                  if (failed)
                    return {
                      jsonrpc: '2.0',
                      id: call.id,
                      error: {
                        code: -32000,
                        message: 'Synthetic balance read unavailable',
                      },
                    };
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
            quoteReads.push({ phase, currency, available: phase !== 'failed' });
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({
                syscoin:
                  phase === 'failed' ? {} : { usd: 0.125, usd_24h_change: 0 },
              }),
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
        const selectNetwork = async (
          label: string,
          kind: 'ethereum' | 'syscoin'
        ) => {
          await wallet!.ensureOnHome();
          await page
            .getByRole('button')
            .filter({ hasText: /UTXO|EVM/ })
            .first()
            .click();
          const menu = page.getByRole('menu');
          const group = menu
            .getByRole('menuitem', {
              name:
                kind === 'ethereum'
                  ? copy.networkMenu.evmNetworks
                  : copy.networkMenu.utxoNetworks,
              exact: true,
            })
            .first();
          if ((await group.getAttribute('aria-expanded')) !== 'true')
            await group.click();
          await menu
            .getByRole('menuitem', { name: label, exact: true })
            .first()
            .click();
          await expect
            .poll(async () => {
              const state = await publicState(page);
              return (
                state.network.label === label &&
                state.network.kind === kind &&
                !state.postLoading &&
                !state.switchingAccount
              );
            })
            .toBe(true);
          // Unlike switchNetwork's funded-state convenience, this path accepts
          // the real Home pending state while the deliberately failing read runs.
          await wallet!.ensureOnHome();
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
          'import a disposable wallet and select the ordinary EVM network',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.ensureOnHome();
            await selectNetwork('Syscoin NEVM Testnet', 'ethereum');
            await expect
              .poll(async () => Number((await publicState(page)).balance))
              .toBe(initialPhase === 'failed' ? -1 : 0);
            await expect
              .poll(async () => (await publicState(page)).fiat)
              .toEqual({
                asset: 'usd',
                price: initialPhase === 'failed' ? 0 : 0.125,
              });
            expect(
              balanceReads.some((read) => read.phase === initialPhase)
            ).toBe(true);
          }
        );
        if (initialPhase === 'failed') {
          await wallet.step(
            'choose German through Languages without changing wallet state',
            async () => {
              await openSetting(
                en.generalMenu.languages,
                '/settings/languages'
              );
              await page
                .getByRole('button', {
                  name: en.settings.setYourPreferredLanguage,
                  exact: true,
                })
                .click();
              await page
                .getByRole('menuitem', { name: 'German Deutsch', exact: true })
                .click();
              await page
                .getByRole('button', { name: en.buttons.save, exact: true })
                .click();
              copy = de;
              await expect(page.getByRole('dialog')).toContainText(
                de.settings.languageWasSet
              );
              await page
                .getByRole('dialog')
                .getByRole('button', { name: de.buttons.ok, exact: true })
                .click();
              await wallet!.ensureOnHome();
            }
          );
        }
        const initial = await publicState(page);
        await wallet.step(
          'Home distinguishes unavailable balance from healthy zero',
          async (shot) => {
            if (initialPhase === 'failed') {
              await expect(page.locator('#home-balance-pending')).toBeVisible();
              await expect(page.locator('#home-balance')).toHaveCount(0);
            } else {
              await expect(page.locator('#home-balance')).toHaveText('0');
              await expect(page.locator('#home-balance-pending')).toHaveCount(
                0
              );
            }
            await shot(page);
          }
        );
        await wallet.step(
          'Currency reports availability honestly and keeps an unsaved currency selectable',
          async () => {
            await openCurrency();
            if (initialPhase === 'failed') {
              if (mode === 'before') {
                await expect(
                  card().getByText('-1', { exact: true })
                ).toBeVisible();
                await expect(
                  card().getByText('$0 USD', { exact: true })
                ).toBeVisible();
              } else {
                await expect(
                  card().getByText(copy.settings.unavailable, { exact: true })
                ).toHaveCount(2);
                await expect(card()).not.toContainText('-1');
                await expect(card()).not.toContainText('$0');
              }
            } else {
              await expect(
                card().getByText('0', { exact: true })
              ).toBeVisible();
              await expect(
                card().getByText('$0 USD', { exact: true })
              ).toBeVisible();
              await expect(
                card().getByText(copy.settings.unavailable, { exact: true })
              ).toHaveCount(0);
            }
            await capture('initial');
            await page
              .getByRole('button', {
                name: copy.settings.setYourPreferred,
                exact: true,
              })
              .click();
            await page
              .getByRole('textbox', {
                name: copy.settings.searchCurrencies,
                exact: true,
              })
              .fill('eur');
            await page.getByRole('button', { name: /\bEUR\b/ }).click();
            await expect(save()).toBeEnabled();
            const state = await publicState(page);
            expect(state.account).toEqual(initial.account);
            expect(state.network).toEqual(initial.network);
            expect(state.fiat.asset).toBe('usd');
            expect(state.savedFiat).toBe(initial.savedFiat);
            await page
              .getByRole('button', { name: copy.buttons.back, exact: true })
              .click();
            await wallet!.ensureOnHome();
            await openCurrency();
            await expect(
              page.getByRole('button', {
                name: copy.settings.setYourPreferred,
                exact: true,
              })
            ).toContainText('USD');
            await expect(save()).toBeDisabled();
            expect((await publicState(page)).savedFiat).toBe(initial.savedFiat);
          }
        );
        if (initialPhase === 'failed') {
          await wallet.step(
            'normal network navigation recovers native balance and its quote without Currency Save',
            async () => {
              await page
                .getByRole('button', { name: copy.buttons.back, exact: true })
                .click();
              phase = 'positive';
              await selectNetwork('Syscoin Testnet', 'syscoin');
              await selectNetwork('Syscoin NEVM Testnet', 'ethereum');
              await expect
                .poll(async () => Number((await publicState(page)).balance))
                .toBe(10);
              await expect
                .poll(async () => (await publicState(page)).fiat)
                .toEqual({ asset: 'usd', price: 0.125 });
              await expect(page.locator('#home-balance')).toHaveText('10');
              expect((await publicState(page)).account).toEqual(
                initial.account
              );
              await openCurrency();
              await expect(
                card().getByText('10', { exact: true })
              ).toBeVisible();
              await expect(
                card().getByText('$1.25 USD', { exact: true })
              ).toBeVisible();
              await expect(
                card().getByText(copy.settings.unavailable, { exact: true })
              ).toHaveCount(0);
              await expect(save()).toBeDisabled();
              expect((await publicState(page)).savedFiat).toBe(
                initial.savedFiat
              );
              await capture('recovered');
            }
          );
        }
        await wallet.step(
          'retain read-only and quote-unit safeguards',
          async () => {
            expect(unexpected).toEqual([]);
            expect(routes.deniedWrites).toEqual([]);
            expect(
              quoteReads.some(
                (read) => read.phase === initialPhase && read.currency === 'usd'
              )
            ).toBe(true);
            if (initialPhase === 'failed')
              expect(
                quoteReads.some(
                  (read) => read.phase === 'positive' && read.available
                )
              ).toBe(true);
            await info.attach('currency-availability-evidence', {
              contentType: 'application/json',
              body: JSON.stringify(
                {
                  runtime: extensionEvidence(),
                  mode,
                  initialPhase,
                  viewport,
                  observations,
                  balanceReads,
                  quoteReads,
                  deniedWrites: routes.deniedWrites,
                  unexpected,
                  controllerStateReplaced: false,
                  controllerResultsReplaced: false,
                  currencySaveClicked: false,
                },
                null,
                2
              ),
            });
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
