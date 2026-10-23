import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const locales = [
  {
    code: 'de',
    option: 'German Deutsch',
    translations: de,
    viewport: { width: 400, height: 620 },
  },
  {
    code: 'fr',
    option: 'French Français',
    translations: fr,
    viewport: { width: 320, height: 360 },
  },
] as const;

// Only current public account/network identity and the selected language leave
// these genuine controller/storage reads. No results or preferences are replaced.
const publicScope = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const key = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get([key, 'language']);
    const project = (account: any) => ({
      id: account.id,
      label: account.label,
      address: account.address,
    });
    const network = state.vault.activeNetwork;
    return {
      active: { id: ref.id, type: ref.type },
      account: project(state.vault.accounts[ref.type][ref.id]),
      savedAccount: project(saved[key].accounts[ref.type][ref.id]),
      language: saved.language,
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: network.kind,
        chainId: network.chainId,
        url: network.url,
        explorer: network.explorer,
      },
    };
  });

const tabTo = async (page: Page, target: Locator) => {
  for (let count = 0; count < 40; count += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error('The transaction explorer button was not reached by Tab');
};

const buttonGeometry = (button: Locator) =>
  button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const points = [
      [box.left + box.width / 2, box.top + 2],
      [box.left + box.width / 2, box.bottom - 2],
      [box.left + 2, box.top + box.height / 2],
      [box.right - 2, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + box.height / 2],
    ];
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      viewport: { width: innerWidth, height: innerHeight },
      fullyVisible:
        box.width > 0 &&
        box.height > 0 &&
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= innerWidth &&
        box.bottom <= innerHeight,
      hit: points.every(([x, y]) => {
        const target = document.elementFromPoint(x, y);
        return target === element || (!!target && element.contains(target));
      }),
    };
  });

for (const locale of locales) {
  test(`transaction explorer uses the saved language and preserves its native action: ${locale.code}`, async ({}, info) => {
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
    const sourceHash = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createUtxoFixture('100000000');
    const hash = 'ab'.repeat(32);
    const explorer = 'https://explorer.synthetic.invalid/public/?view=compact';
    const expected = `https://explorer.synthetic.invalid/public/tx/${hash}?view=compact`;
    const transaction = {
      txid: hash,
      blockHash: 'cd'.repeat(32),
      blockTime: 1700000000,
      blockHeight: 100,
      confirmations: 3,
      fees: '1000',
      valueIn: '100001000',
      value: '100000000',
      addressValueIn: '0',
      addressValueOut: '100000000',
      version: 2,
      vin: [
        {
          txid: 'ef'.repeat(32),
          vout: 0,
          addresses: [fixture.recipientAddress],
          isOwn: false,
          value: '100001000',
        },
      ],
      vout: [
        {
          n: 0,
          addresses: [fixture.userAddress],
          isOwn: true,
          value: '100000000',
        },
      ],
    };
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const openedRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, unknown> = {};
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'ExplorerLocaleSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        'transaction-explorer-localization-' + locale.code,
        { offlineHttpProxy: server.url, viewport: locale.viewport }
      );
      routes = await installUtxoFixtureRoutes(
        wallet.context,
        fixture,
        server.url,
        {
          readState: () => ({
            transactions: [transaction],
            rawTransactions: { [hash]: transaction },
          }),
        }
      );
      // Observe the actual popup request, then abort before external HTTP I/O.
      // The native window.open, controller and Chrome APIs remain untouched.
      await wallet.context.route(
        'https://explorer.synthetic.invalid/**',
        async (route) => {
          openedRequests.push(route.request().url());
          await route.abort('blockedbyclient');
        }
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const step = (name: string, run: () => Promise<void>) =>
        wallet!.step(`${locale.code}: ${name}`, async (capture) => {
          try {
            await run();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        });
      const openEditor = async () => {
        const row = page
          .locator('li')
          .filter({ has: page.getByText('Syscoin Testnet', { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.locator('button').first().click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        await expect(page.locator('#rpc_explorer')).toBeVisible();
      };
      await step(
        'onboard and open the ordinary inactive network editor',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.ensureOnHome();
          await wallet!.gotoRoute('#/settings/networks/edit');
          await openEditor();
        }
      );
      await step(
        'save and reopen the exact explorer URL including its query',
        async () => {
          // The real registry broadcast can follow the durable edit ACK. Retain
          // the existing fixture's read-only observation before reopening.
          await page.evaluate((expectedExplorer) => {
            const observation = window as typeof window & {
              transactionExplorerLocalizationRegistry?: string;
            };
            const listener = (message: any) => {
              const savedExplorer =
                message.type === 'CONTROLLER_STATE_CHANGE'
                  ? message.data?.vaultGlobal?.networks?.syscoin?.[5700]
                      ?.explorer
                  : undefined;
              if (savedExplorer !== expectedExplorer) return;
              chrome.runtime.onMessage.removeListener(listener);
              requestAnimationFrame(() => {
                observation.transactionExplorerLocalizationRegistry =
                  savedExplorer;
              });
            };
            chrome.runtime.onMessage.addListener(listener);
          }, explorer);
          await page.locator('#rpc_explorer').fill(explorer);
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (
                    window as typeof window & {
                      transactionExplorerLocalizationRegistry?: string;
                    }
                  ).transactionExplorerLocalizationRegistry
              )
            )
            .toBe(explorer);
          await openEditor();
          await expect(page.locator('#rpc_explorer')).toHaveValue(explorer);
          observations.savedExplorer = explorer;
        }
      );
      await step(
        'save the UI language through the real Languages form',
        async () => {
          await wallet!.gotoRoute('#/home');
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: 'Languages', exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/languages$/);
          await page
            .getByRole('button', {
              name: en.settings.setYourPreferredLanguage,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', { name: locale.option, exact: true })
            .click();
          await page
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(
                async () =>
                  (
                    await chrome.storage.local.get('language')
                  ).language
              )
            )
            .toBe(locale.code);
          await expect(
            page.getByText(locale.translations.settings.languageWasSet, {
              exact: true,
            })
          ).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          observations.savedLanguage = (await publicScope(page)).language;
        }
      );
      await step(
        'open the translated historical Activity row into real Details',
        async () => {
          await page.locator('#activity-btn').click();
          const row = page
            .getByText(`${hash.slice(0, 4)}...${hash.slice(-14)}`, {
              exact: true,
            })
            .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
          await row
            .getByRole('button', {
              name: locale.translations.notifications.clickToView,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/home\/details/);
          await expect(page.getByText('Txid', { exact: true })).toBeVisible();
          const scope = await publicScope(page);
          expect(scope.active).toEqual({ id: 0, type: 'HDAccount' });
          expect(scope.language).toBe(locale.code);
          expect(scope.network).toMatchObject({
            kind: 'syscoin',
            chainId: 5700,
            explorer,
          });
          expect(scope.account).toEqual(scope.savedAccount);
          expect(routes!.reads).toContain('/api/v2/xpub/' + fixture.userXpub);
          observations.beforeExplorer = scope;
        }
      );
      // A structural selector must exercise the healthy native action before
      // the localization assertion, including on the original English UI.
      const footer = page.locator('#details-view-content > li > button');
      await step(
        'activate the visible native explorer button by Tab and Enter without mutation',
        async () => {
          const before = await publicScope(page);
          await expect(footer).toHaveCount(1);
          await expect(footer).toBeVisible();
          await expect(footer).toBeEnabled();
          await expect(footer).toHaveAttribute('type', 'button');
          const label = (await footer.textContent())?.trim() || '';
          expect(label).not.toBe('');
          await tabTo(page, footer);
          await expect(footer).toBeFocused();
          const geometry = await buttonGeometry(footer);
          expect(geometry.fullyVisible).toBe(true);
          expect(geometry.hit).toBe(true);
          const popupPromise = page.waitForEvent('popup');
          await page.keyboard.press('Enter');
          const popup = await popupPromise;
          try {
            await expect.poll(() => openedRequests).toEqual([expected]);
          } finally {
            await popup.close();
          }
          await expect(page).toHaveURL(/#\/home\/details/);
          expect(await publicScope(page)).toEqual(before);
          expect(routes!.deniedWrites).toEqual([]);
          expect(routes!.syntheticBroadcasts).toEqual([]);
          expect(pageErrors).toEqual([]);
          observations.nativeAction = {
            label,
            geometry,
            openedRequest: expected,
          };
          observations.afterExplorer = await publicScope(page);
        }
      );
      await step(
        'show the saved localized explorer name with no English duplicate',
        async () => {
          await expect(footer).toBeVisible();
          await expect(footer).toHaveAccessibleName(
            locale.translations.home.viewOnExplorer
          );
          expect((await footer.textContent())?.trim()).toBe(
            locale.translations.home.viewOnExplorer
          );
          await expect(
            page.getByRole('button', {
              name: en.home.viewOnExplorer,
              exact: true,
            })
          ).toHaveCount(0);
          observations.localizedLabel = (await footer.textContent())?.trim();
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
          expect(routes!.deniedWrites).toEqual([]);
          expect(routes!.syntheticBroadcasts).toEqual([]);
          expect(pageErrors).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('transaction-explorer-localization-' + locale.code, {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            locale: locale.code,
            viewport: locale.viewport,
            expectedLabel: locale.translations.home.viewOnExplorer,
            hash,
            explorer,
            expected,
            runtime,
            sourceHash,
            openedRequests,
            observations,
            fixtureReads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            deniedUnknown: routes?.deniedUnknown ?? [],
            syntheticBroadcasts: routes?.syntheticBroadcasts ?? [],
            proxyDeniedRequests: server?.blocked ?? [],
            pageErrors,
            syntheticHttpOnly: true,
            externalHttpRequestsFulfilled: 0,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            storageReplaced: false,
            windowOpenReplaced: false,
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
}
