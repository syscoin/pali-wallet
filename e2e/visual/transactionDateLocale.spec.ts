import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  fixtureRead,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const TIMESTAMP = 1700000000;
const EVM_HASH = `0x${'71'.repeat(32)}`;
const UTXO_HASH = '72'.repeat(32);
const API = 'https://explorer.tanenbaum.io/api';
const RPC = 'https://rpc.tanenbaum.io/';

// Test-local version of the ordinary network flow. The shared driver assumes
// English group/faucet labels; this regression intentionally switches language.
async function switchLocalizedNetwork(
  wallet: PaliWallet,
  label: string,
  group: 'EVM' | 'UTXO',
  text: {
    buttons: { close: string };
    faucet: { firstAccessTitle: string; grabTokens: string };
    networkMenu: { evmNetworks: string; utxoNetworks: string };
  }
) {
  await wallet.ensureOnHome();
  const page = wallet.page;
  const header = () =>
    page
      .getByRole('button')
      .filter({ hasText: /UTXO|EVM/ })
      .first();
  if (
    (await wallet.getActiveNetworkLabel()).toLowerCase() !== label.toLowerCase()
  ) {
    await header().click();
    const menu = page.getByRole('menu');
    const toggle = menu.getByRole('menuitem', {
      name:
        group === 'EVM'
          ? text.networkMenu.evmNetworks
          : text.networkMenu.utxoNetworks,
      exact: true,
    });
    await expect(toggle).toHaveAttribute('aria-expanded', /^(true|false)$/);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true')
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await menu
      .getByRole('menuitem', { name: label, exact: true })
      .first()
      .click();
  }
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const title = new RegExp(
    '^' +
      escape(text.faucet.firstAccessTitle)
        .replace(escape('{{token}}'), '\\S+')
        .replace(escape('{{network}}'), escape(label)) +
      '$'
  );
  const faucet = page.getByRole('dialog', { name: title });
  const balance = page.locator('#home-balance');
  let previouslyReady = false;
  await expect
    .poll(
      async () => {
        const reset = () => {
          previouslyReady = false;
          return false;
        };
        const status = await page.evaluate(
          () =>
            new Promise<{
              chainId: number;
              kind: string;
              label: string;
              networkStatus: string;
              postLoading: boolean;
              switching: boolean;
              url: string;
            } | null>((resolve) => {
              let done = false;
              const finish = (value: any) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(value);
              };
              const timer = setTimeout(() => finish(null), 1000);
              try {
                chrome.runtime.sendMessage(
                  { type: 'getCurrentState' },
                  (state) => {
                    if (
                      chrome.runtime.lastError ||
                      !state?.vault?.activeNetwork ||
                      !state?.vaultGlobal
                    )
                      return finish(null);
                    const network = state.vault.activeNetwork;
                    finish({
                      label: network.label,
                      kind: network.kind,
                      chainId: network.chainId,
                      url: network.url,
                      networkStatus: state.vaultGlobal.networkStatus,
                      postLoading: state.vaultGlobal.isPostNetworkSwitchLoading,
                      switching: state.vaultGlobal.isSwitchingAccount,
                    });
                  }
                );
              } catch {
                finish(null);
              }
            })
        );
        if (
          !status ||
          status.label !== label ||
          status.kind !== (group === 'EVM' ? 'ethereum' : 'syscoin') ||
          !Number.isSafeInteger(status.chainId) ||
          !status.url ||
          status.networkStatus !== 'idle' ||
          status.postLoading !== false ||
          status.switching !== false
        )
          return reset();
        if (
          (await faucet.isVisible()) &&
          (await faucet
            .getByRole('button', { name: text.faucet.grabTokens, exact: true })
            .isVisible())
        ) {
          await faucet
            .getByRole('button', { name: text.buttons.close, exact: true })
            .click();
          return reset();
        }
        if (!(await header().isVisible()) || !(await balance.isVisible()))
          return reset();
        const currentLabel = await header()
          .locator(':scope > span')
          .first()
          .innerText({ timeout: 1000 })
          .catch(() => '');
        if (
          currentLabel.trim() !== label ||
          (await faucet.isVisible()) ||
          !(await header().isVisible()) ||
          !(await balance.isVisible())
        )
          return reset();
        const settled = previouslyReady;
        previouslyReady = true;
        return settled;
      },
      { timeout: 120_000 }
    )
    .toBe(true);
}

async function fullDetailValue(page: Page, label: string) {
  const row = page
    .locator('#details-view-content')
    .getByText(label, { exact: true })
    .locator('..');
  await expect(row).toBeVisible();
  const value = row.locator(':scope > span');
  await expect(value).toHaveCount(1);
  const disclosure = value.locator('[tabindex="0"]');
  if (await disclosure.count()) {
    await page.mouse.move(0, 0);
    await disclosure.hover();
    await expect(disclosure).toHaveAttribute('aria-describedby', /\S+/);
    const describedBy = (await disclosure.getAttribute('aria-describedby'))!;
    expect(describedBy).toMatch(/^tippy-\d+$/);
    const tooltip = page.locator(`[id="${describedBy}"]`);
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    return { full: await tooltip.innerText(), row, disclosure: true };
  }
  await row.scrollIntoViewIfNeeded();
  return { full: await value.innerText(), row, disclosure: false };
}

for (const target of [
  { code: 'de', text: de, option: 'German Deutsch', width: 400, height: 620 },
  { code: 'fr', text: fr, option: 'French Français', width: 320, height: 360 },
] as const) {
  test(`Activity dates follow English and saved ${target.code} across EVM and UTXO`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const evm = {
      hash: EVM_HASH,
      from: fixture.evmAddresses[0],
      to: fixture.evmAddresses[1],
      value: '1000000000000000000',
      input: '0x',
      nonce: '0',
      blockNumber: '42',
      blockHash: `0x${'bb'.repeat(32)}`,
      timeStamp: String(TIMESTAMP),
      timestamp: TIMESTAMP,
      confirmations: '5',
      chainId: 5700,
      type: '2',
      gas: '21000',
      gasLimit: '21000',
      gasUsed: '21000',
      gasPrice: '1000000000',
      isError: '0',
      // eslint-disable-next-line camelcase -- Explorer wire spelling.
      txreceipt_status: '1',
    };
    const utxo = {
      txid: UTXO_HASH,
      version: 2,
      blockHash: 'bb'.repeat(32),
      blockHeight: 42,
      blockTime: TIMESTAMP,
      confirmations: 5,
      fees: '1000',
      valueIn: '100000000',
      value: '99999000',
      direction: 'sent',
      addressValueIn: '100000000',
      addressValueOut: '0',
      vin: [
        {
          txid: 'cc'.repeat(32),
          vout: 0,
          n: 0,
          addresses: [fixture.utxo.userAddress],
          isAddress: true,
          isOwn: true,
          value: '100000000',
          sequence: 0xffffffff,
        },
      ],
      vout: [
        {
          n: 0,
          addresses: [fixture.utxo.recipientAddress],
          isAddress: true,
          isOwn: false,
          value: '99999000',
        },
      ],
    };
    const rawUtxo = {
      ...utxo,
      vin: utxo.vin.map((row) => ({ ...row, isOwn: undefined })),
      vout: utxo.vout.map((row) => ({ ...row, isOwn: undefined })),
    };
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'DateLocaleSynthetic!2026',
      rpcUrl: server.url,
    });
    const reads: string[] = [];
    const writes: string[] = [];
    const observations: unknown[] = [];
    const evidence: Record<string, unknown> = { runtime, observations };
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let result: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(
        `transaction-date-locale-${target.code}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: target.width, height: target.height },
        }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url,
        (url) => {
          const value = fixtureRead(fixture.utxo, url.href, 'GET', {
            transactions: [utxo],
            rawTransactions: { [UTXO_HASH]: rawUtxo },
          });
          if (value !== undefined) {
            reads.push(`blockbook:${url.pathname}`);
            return value;
          }
          if (url.origin + url.pathname !== API) return undefined;
          const action = url.searchParams.get('action');
          let rows: unknown;
          if (
            ['txlist', 'tokentx', 'pendingtxlist', 'tokenlist'].includes(
              action || ''
            ) &&
            url.searchParams.get('address')?.toLowerCase() ===
              fixture.evmAddresses[0].toLowerCase()
          )
            rows = action === 'txlist' ? [evm] : [];
          else if (
            action === 'gettxinfo' &&
            url.searchParams.get('txhash') === EVM_HASH
          )
            rows = evm;
          else if (
            action === 'eth_blockNumber' ||
            action === 'eth_block_number'
          )
            rows = '0x2f';
          else return undefined;
          reads.push(`explorer:${action}`);
          return {
            status: Array.isArray(rows) && !rows.length ? '0' : '1',
            message:
              Array.isArray(rows) && !rows.length
                ? 'No transactions found'
                : 'OK',
            result: rows,
          };
        }
      );
      wallet.context.on('request', (request) => {
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              writes.push(call.method);
        } catch {
          /* ordinary GET */
        }
        if (/\/sendtx(?:\/|$)/i.test(new URL(request.url()).pathname))
          writes.push('sendtx');
      });
      // Override only the head/count reads used by this coherent old history.
      // Every other RPC still goes through the existing deny-by-default fixture.
      await wallet.context.route(RPC, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const data = route.request().postDataJSON();
        const calls = Array.isArray(data) ? data : [data];
        if (
          !calls.every(
            (call) =>
              call?.jsonrpc === '2.0' &&
              Array.isArray(call.params) &&
              (call.method === 'eth_blockNumber' ||
                (call.method === 'eth_getTransactionCount' &&
                  fixture.evmAddresses.some(
                    (address) =>
                      address.toLowerCase() ===
                      String(call.params[0]).toLowerCase()
                  )))
          )
        )
          return route.fallback();
        const replies = calls.map((call) => ({
          jsonrpc: '2.0',
          id: call.id,
          result: call.method === 'eth_blockNumber' ? '0x2f' : '0x1',
        }));
        reads.push(...calls.map((call) => `rpc:${call.method}`));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(data) ? replies : replies[0]),
        });
      });
      const page = wallet.page;
      const publicContext = () =>
        page.evaluate(async () => {
          const { vault } = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const { language } = await chrome.storage.local.get('language');
          const active = vault.activeAccount;
          return {
            language: language || 'en',
            account: {
              ...active,
              address: vault.accounts[active.type][active.id].address,
            },
            network: {
              kind: vault.activeNetwork.kind,
              chainId: vault.activeNetwork.chainId,
              url: vault.activeNetwork.url,
            },
            history: (
              vault.accountTransactions?.[active.type]?.[active.id]?.[
                vault.isBitcoinBased ? 'syscoin' : 'ethereum'
              ]?.[vault.activeNetwork.chainId] || []
            ).map((tx: any) => ({
              hash: tx.hash || tx.txid,
              timestamp: tx.timestamp,
              blockTime: tx.blockTime,
            })),
          };
        });
      const formats = (selectedLanguage: string) =>
        page.evaluate(
          ({ language, timestamp }) => {
            const date = new Date(timestamp * 1000);
            const groupOptions: Intl.DateTimeFormatOptions = {
              month: 'short',
              day: '2-digit',
              year: 'numeric',
            };
            const dateOptions: Intl.DateTimeFormatOptions = {
              month: '2-digit',
              day: '2-digit',
              year: '2-digit',
            };
            const timeOptions: Intl.DateTimeFormatOptions = {
              hour: 'numeric',
              minute: 'numeric',
              hour12: true,
            };
            const localeTimeOptions: Intl.DateTimeFormatOptions = {
              hour: 'numeric',
              minute: 'numeric',
            };
            return {
              browserLocale: new Intl.DateTimeFormat().resolvedOptions().locale,
              timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
              legacyGroup: new Intl.DateTimeFormat(
                'en-US',
                groupOptions
              ).format(date),
              desiredGroup: new Intl.DateTimeFormat(
                language,
                groupOptions
              ).format(date),
              legacyRowDate: new Intl.DateTimeFormat('en-US', dateOptions)
                .format(date)
                .split('/')
                .join('-'),
              desiredRowDate: new Intl.DateTimeFormat(language, dateOptions)
                .format(date)
                .replace(language === 'en' ? /\//g : /$^/, '-'),
              legacyRowTime: new Intl.DateTimeFormat(
                'en-US',
                timeOptions
              ).format(date),
              desiredRowTime: new Intl.DateTimeFormat(
                language,
                localeTimeOptions
              ).format(date),
              browserTimestamp: date.toLocaleString(),
              desiredTimestamp: date.toLocaleString(language),
            };
          },
          { language: selectedLanguage, timestamp: TIMESTAMP }
        );
      await wallet.step(
        'onboard the real disposable wallet with English as the initial healthy control',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          expect((await publicContext()).language).toBe('en');
          evidence.workerStart = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              evidence.workerStart = value;
            }
          );
        }
      );
      for (const language of ['en', target.code] as const) {
        const text = language === 'en' ? en : target.text;
        if (language !== 'en')
          await wallet.step(
            `save ${language} using normal Language settings`,
            async () => {
              await wallet!.ensureOnHome();
              await page
                .getByRole('button', {
                  name: en.generalMenu.generalOptions,
                  exact: true,
                })
                .click();
              await page
                .getByRole('menuitem', {
                  name: en.generalMenu.languages,
                  exact: true,
                })
                .click();
              await page
                .getByRole('button', {
                  name: en.settings.setYourPreferredLanguage,
                  exact: true,
                })
                .click();
              await page
                .getByRole('menuitem', { name: target.option, exact: true })
                .click();
              await page
                .getByRole('button', { name: en.buttons.save, exact: true })
                .click();
              await expect(
                page.getByText(text.settings.languageWasSet, { exact: true })
              ).toBeVisible();
              await page.keyboard.press('Escape');
              await expect
                .poll(async () => (await publicContext()).language)
                .toBe(language);
            }
          );
        for (const family of ['EVM', 'UTXO'] as const)
          await wallet.step(
            `${language} ${family}: observe the actual historical row and full detail date`,
            async () => {
              await wallet!.ensureOnHome();
              await switchLocalizedNetwork(
                wallet!,
                family === 'EVM' ? 'Syscoin NEVM Testnet' : 'Syscoin Testnet',
                family,
                text
              );
              await wallet!.ensureOnHome();
              await page.locator('#activity-btn').click();
              const expected = await formats(language);
              const list = page.locator('#activity-panel-list');
              const rowDate = list.getByText(
                family === 'EVM'
                  ? expected.desiredGroup
                  : expected.desiredRowDate,
                { exact: true }
              );
              await expect(rowDate).toHaveCount(1);
              await expect(rowDate).toBeVisible();
              await rowDate.scrollIntoViewIfNeeded();
              const actualDate = await rowDate.innerText();
              let actualTime: string | null = null;
              if (family === 'UTXO') {
                const rowTime = list.getByText(expected.desiredRowTime, {
                  exact: true,
                });
                await expect(rowTime).toBeVisible();
                actualTime = await rowTime.innerText();
              }
              const scope = await publicContext();
              expect(scope.language).toBe(language);
              expect(
                scope.history.some(
                  (tx: any) =>
                    tx.hash === (family === 'EVM' ? EVM_HASH : UTXO_HASH)
                )
              ).toBe(true);
              await info.attach(`${language}-${family}-historical-row`, {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              const detail = list.getByRole('button', {
                name: text.notifications.clickToView,
                exact: true,
              });
              await expect(detail).toHaveCount(1);
              await detail.click();
              await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
              const label =
                family === 'EVM'
                  ? text.transactionDisplay.timestamp
                  : text.transactionDisplay.blockTime;
              const full = await fullDetailValue(page, label);
              // Dates follow the saved locale without changing the underlying instant.
              expect(full.full).toBe(expected.desiredTimestamp);
              await info.attach(`${language}-${family}-detail-date`, {
                body: await page.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
              observations.push({
                language,
                family,
                viewport: page.viewportSize(),
                expected,
                actualDate,
                actualTime,
                actualDetail: full.full,
                renderedLabel: label,
                detailDisclosure: full.disclosure,
                matchesWalletGroup:
                  family === 'EVM'
                    ? actualDate === expected.desiredGroup
                    : actualDate === expected.desiredRowDate,
                matchesWalletTimestamp: full.full === expected.desiredTimestamp,
                scope,
              });
              await page.keyboard.press('Escape');
              await page
                .getByRole('button', { name: text.buttons.back, exact: true })
                .click();
              await expect(page).toHaveURL(/#\/home(?:\?|$)/);
            }
          );
      }
      await wallet.step(
        'verify exact runtime and no transaction/signing side effects',
        async () => {
          expect(routes!.deniedWrites).toEqual([]);
          expect(writes).toEqual([]);
          expect(reads).toContain('explorer:txlist');
          expect(reads).toContain('explorer:gettxinfo');
          expect(
            reads.some((read) => read === `blockbook:/api/v2/tx/${UTXO_HASH}`)
          ).toBe(true);
          evidence.workerEnd = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              evidence.workerEnd = value;
            }
          );
          expect(evidence.workerEnd).toEqual(evidence.workerStart);
          expect(extensionEvidence()).toEqual(runtime);
        }
      );
      result = 'passed';
    } finally {
      await info.attach('transaction-date-locale-observation', {
        contentType: 'application/json',
        body: JSON.stringify({ result, ...evidence, reads, writes }, null, 2),
      });
      try {
        await wallet?.dispose(result);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
