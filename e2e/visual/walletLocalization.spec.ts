import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
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
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const locales = [
  { code: 'de', translations: de, option: 'German Deutsch' },
  { code: 'fr', translations: fr, option: 'French Français' },
] as const;
const viewports = [
  { width: 400, height: 480 },
  { width: 320, height: 360 },
] as const;
const BAD_CHECKSUM = 'abandon '.repeat(12).trim();
const BAD_LENGTH = 'abandon about';
const PRIVATE_DRAFT = 'invalid-private-draft-localization';
const RPC = 'https://rpc.tanenbaum.io';

// Public metadata only. Never read keyring/seed/private-key storage or return
// opaque persisted records; the projections contain only account identity,
// selected network, public registry entries and the saved locale.
const publicState = (page: Page) =>
  page.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const ref = current.vault.activeAccount;
    const key = `state-vault-${current.vaultGlobal.activeSlip44}`;
    const saved = await chrome.storage.local.get([key, 'state', 'language']);
    const network = (value: any) =>
      value
        ? {
            kind: value.kind,
            chainId: value.chainId,
            url: value.url,
            label: value.label,
            currency: value.currency,
            slip44: value.slip44,
          }
        : null;
    const accounts = (groups: any) =>
      Object.entries(groups || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, entries]) => ({
          type,
          entries: Object.entries(entries || {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, value]: [string, any]) => ({
              id,
              address: value.address,
              label: value.label,
            })),
        }));
    const networks = (groups: any) =>
      Object.entries(groups || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, entries]) => ({
          family,
          entries: Object.entries(entries || {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, value]) => ({ id, network: network(value) })),
        }));
    return {
      active: { id: ref.id, type: ref.type },
      slip44: current.vaultGlobal.activeSlip44,
      network: network(current.vault.activeNetwork),
      language: saved.language,
      liveAccounts: accounts(current.vault.accounts),
      savedAccounts: accounts(saved[key]?.accounts),
      liveNetworks: networks(current.vaultGlobal.networks),
      savedNetworks: networks(saved.state?.vaultGlobal?.networks),
    };
  });

// Always traverse at least one native Tab, even if a prior pointer action left
// this control focused. No programmatic focus or evaluated click is used.
const tabTo = async (page: Page, target: Locator, reverse = false) => {
  for (let step = 0; step < 32; step++) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    if (await target.evaluate((element) => document.activeElement === element))
      break;
  }
  await expect(target).toBeFocused();
};

const readableGeometry = async (target: Locator, interactive = false) => {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const geometry = await target.evaluate((element, hitTest) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const glyphs = [...range.getClientRects()].map((rect) => rect.toJSON());
    const hits = hitTest
      ? [
          [box.left + 1, box.top + box.height / 2],
          [box.right - 1, box.top + box.height / 2],
          [box.left + box.width / 2, box.top + 1],
          [box.left + box.width / 2, box.bottom - 1],
        ].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !!hit && (hit === element || element.contains(hit));
        })
      : [];
    return {
      bounds: box.toJSON(),
      glyphs,
      hits,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
    };
  }, interactive);
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.bounds.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  for (const glyph of geometry.glyphs) {
    expect(glyph.left).toBeGreaterThanOrEqual(0);
    expect(glyph.right).toBeLessThanOrEqual(geometry.viewport.width);
  }
  if (interactive) expect(geometry.hits).toEqual([true, true, true, true]);
  return geometry;
};

for (const locale of locales) {
  test(`saved ${locale.code} localizes watch-only, Chain ID and recovery validation through normal UI`, async ({}, info) => {
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
    const fixture = createIsolatedVaultFixture();
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, unknown> = {};
    const pageErrors: string[] = [];
    const translations = locale.translations;
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'WalletLocalizationSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch('wallet-localization-' + locale.code, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      let before: Awaited<ReturnType<typeof publicState>>;
      const unchanged = async () => {
        expect(await publicState(page)).toEqual(before);
        expect(routes!.deniedWrites).toEqual([]);
        expect(pageErrors).toEqual([]);
      };
      const back = () =>
        page.getByRole('button', {
          name: translations.buttons.back,
          exact: true,
        });
      await wallet.step(
        `${locale.code}: save the actual Languages preference in a disposable wallet`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
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
          await expect(
            page.getByText(translations.settings.languageWasSet, {
              exact: true,
            })
          ).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          before = await publicState(page);
          expect(before.language).toBe(locale.code);
          expect(before.active).toEqual({ id: 0, type: 'HDAccount' });
          expect(before.network).toMatchObject({
            kind: 'syscoin',
            chainId: 5700,
          });
          expect(before.liveAccounts).toEqual(before.savedAccounts);
          expect(before.liveNetworks).toEqual(before.savedNetworks);
          observations.before = before;
        }
      );
      await wallet.step(
        `${locale.code}: open the named import form from the ordinary account menu`,
        async () => {
          await page
            .getByRole('button', {
              name: translations.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: translations.accountMenu.importAccount,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/import$/);
          await expect(
            page.getByText(translations.settings.importAccountsWont, {
              exact: true,
            })
          ).toBeVisible();
          await unchanged();
        }
      );
      for (const viewport of viewports) {
        await wallet.step(
          `${locale.code}: named watch-only mouse and Tab Space controls preserve drafts at ${viewport.width}`,
          async () => {
            await page.setViewportSize(viewport);
            const watch = page.getByRole('checkbox', {
              name: translations.settings.watchOnly,
              exact: true,
            });
            const label = page.locator(
              'label[for="import-account-watch-only"]'
            );
            const identifier = page.locator('#import-account-identifier');
            const submit = page.getByRole('button', {
              name: translations.buttons.import,
              exact: true,
            });
            await expect(watch).toHaveAttribute(
              'id',
              'import-account-watch-only'
            );
            await expect(label).toHaveText(translations.settings.watchOnly);
            await watch.uncheck();
            await identifier.fill(PRIVATE_DRAFT);
            await expect(identifier).toHaveAttribute('type', 'password');
            await expect(identifier).toHaveAccessibleName(
              translations.settings.yourPrivateKey
            );
            await expect(submit).toBeDisabled();
            await label.click();
            await expect(watch).toBeChecked();
            await expect(identifier).toHaveAccessibleName(
              translations.settings.publicIdentifierInput
            );
            await expect(identifier).toHaveAttribute(
              'placeholder',
              translations.settings.publicIdentifierInput
            );
            await expect(identifier).toHaveValue(PRIVATE_DRAFT);
            await expect(identifier).toHaveAttribute('type', 'password');
            await identifier.click();
            await tabTo(page, watch, true);
            await page.keyboard.press('Space');
            await expect(watch).not.toBeChecked();
            await expect(identifier).toHaveAttribute('type', 'password');
            await expect(identifier).toHaveValue(PRIVATE_DRAFT);
            await page.keyboard.press('Space');
            await expect(watch).toBeChecked();
            await identifier.clear();
            await identifier.fill(fixture.watchAddress);
            await expect(identifier).toHaveAttribute('type', 'text');
            await expect(submit).toBeEnabled();
            // The public identifier healthy control is never submitted.
            await identifier.fill('not-a-public-identifier');
            const error = page
              .locator('.ant-form-item')
              .filter({ has: identifier })
              .locator('.ant-form-item-explain-error');
            // Ant Design retains the leaving private-key error during the
            // native validation transition. Assert one settled error before
            // checking its exact localized guidance; do not select an arbitrary
            // first/last item or relax the text/admission checks.
            await expect(error).toHaveCount(1);
            await expect(error).toHaveText(
              translations.settings.invalidWatchOnlyIdentifier
            );
            await expect(submit).toBeDisabled();
            observations[`watch-${viewport.width}`] = {
              label: await readableGeometry(label),
              checkbox: await readableGeometry(watch, true),
              error: await readableGeometry(error),
              publicHint: await identifier.getAttribute('aria-label'),
              invalidRefused: true,
              maskedDraftPreserved: true,
            };
            await unchanged();
          }
        );
      }
      await wallet.step(
        `${locale.code}: open Custom RPC normally and detect the allowlisted synthetic endpoint`,
        async () => {
          await back().click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await page
            .getByRole('button')
            .filter({ has: page.locator('#network-settings-btn') })
            .click();
          await page
            .getByRole('menuitem', {
              name: translations.networkMenu.customRpc,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
          await page
            .getByRole('combobox', {
              name: translations.settings.label,
              exact: true,
            })
            .fill('Wallet Localization Fixture');
          await page.locator('#rpc_symbol').fill('TSYS');
          await page.locator('#rpc_url').fill(RPC);
          await page.locator('#rpc_url').press('Tab');
          await expect(page.locator('#rpc_chainId')).toHaveValue('5700');
          expect(routes!.reads).toContain('synthetic-evm:eth_chainId');
          await unchanged();
        }
      );
      for (const viewport of viewports) {
        await wallet.step(
          `${locale.code}: decimal Chain ID guidance is translated without saving at ${viewport.width}`,
          async () => {
            await page.setViewportSize(viewport);
            const chain = page.locator('#rpc_chainId');
            const error = page
              .locator('.ant-form-item')
              .filter({ has: chain })
              .locator('.ant-form-item-explain-error');
            await expect(chain).toHaveAttribute(
              'placeholder',
              translations.settings.chainIdCustomEvm
            );
            await chain.fill('5700.5');
            await page
              .getByRole('button', {
                name: translations.buttons.save,
                exact: true,
              })
              .click();
            await expect(error).toHaveCount(1);
            await expect(error).toHaveText(
              translations.settings.positiveChainId
            );
            await expect(chain).toHaveValue('5700.5');
            observations[`decimal-${viewport.width}`] = await readableGeometry(
              error
            );
            await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
            await unchanged();
          }
        );
        await wallet.step(
          `${locale.code}: required Chain ID guidance and valid integer control stay local at ${viewport.width}`,
          async (capture) => {
            const chain = page.locator('#rpc_chainId');
            const error = page
              .locator('.ant-form-item')
              .filter({ has: chain })
              .locator('.ant-form-item-explain-error');
            await chain.clear();
            await page
              .getByRole('button', {
                name: translations.buttons.save,
                exact: true,
              })
              .click();
            await expect(error).toHaveCount(1);
            await expect(error).toHaveText(
              translations.settings.chainIdRequired
            );
            observations[`required-${viewport.width}`] = await readableGeometry(
              error
            );
            await capture(page);
            await chain.fill('5700');
            await chain.press('Tab');
            await expect(error).toHaveCount(0);
            await expect(chain).toHaveValue('5700');
            // A valid-format field is healthy; never save a synthetic network.
            await unchanged();
          }
        );
      }
      await wallet.step(
        `${locale.code}: use Lock and the real recovery-warning ticket without resetting the wallet`,
        async () => {
          await back().click();
          await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
          await page
            .getByRole('button', {
              name: translations.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: translations.generalMenu.lock,
              exact: true,
            })
            .click();
          await expect(page.locator('#password')).toBeVisible();
          await page.locator('#import-wallet-link').click();
          const warning = page.getByRole('dialog', {
            name: translations.settings.recoveryTitle,
            exact: true,
          });
          await expect(warning).toBeVisible();
          await warning.locator('#confirm-import-btn').click();
          await expect(page).toHaveURL(/#\/import$/);
          await expect(
            page.getByRole('heading', {
              name: translations.settings.recoveryTitle,
              exact: true,
            })
          ).toBeVisible();
          await expect(
            page.locator('#import-wallet-input')
          ).toHaveAccessibleName(translations.import.pasteYourWalletSeed);
          await unchanged();
        }
      );
      await wallet.step(
        `${locale.code}: real checksum failure stays localized and cannot advance at 400`,
        async () => {
          await page.setViewportSize(viewports[0]);
          const input = page.locator('#import-wallet-input');
          const error = page.locator('.ant-form-item-explain-error');
          await input.fill(BAD_CHECKSUM);
          await expect(error).toHaveCount(1);
          await expect(error).toHaveText(translations.seedConfirm.seedError);
          await expect(page.locator('#import-wallet-action')).toBeDisabled();
          await expect(page.locator('#create-password')).toHaveCount(0);
          observations.checksum400 = await readableGeometry(error);
          await expect(page).toHaveURL(/#\/import$/);
          await unchanged();
        }
      );
      await wallet.step(
        `${locale.code}: word-count interpolation stays localized and cannot advance at 320`,
        async () => {
          await page.setViewportSize(viewports[1]);
          const input = page.locator('#import-wallet-input');
          const error = page.locator('.ant-form-item-explain-error');
          await input.fill(BAD_LENGTH);
          const guidance = translations.import.importModalSeed.replace(
            '{{seedLength}}',
            '2'
          );
          await expect(error).toHaveCount(1);
          await expect(error).toHaveText(guidance);
          await expect(page.locator('#import-wallet-action')).toBeDisabled();
          observations.length320 = await readableGeometry(error);
          await expect(page).toHaveURL(/#\/import$/);
          await unchanged();
        }
      );
      await wallet.step(
        `${locale.code}: ordinary blur opens translated count guidance and Escape retains the draft`,
        async (capture) => {
          const input = page.locator('#import-wallet-input');
          await input.press('Tab');
          const modal = page.getByRole('dialog', {
            name: translations.import.importModalWordMissing,
            exact: true,
          });
          const guidance = translations.import.importModalSeed.replace(
            '{{seedLength}}',
            '2'
          );
          await expect(modal).toBeVisible();
          observations.countModal320 = await readableGeometry(
            modal.getByText(guidance, { exact: true })
          );
          await capture(page);
          await page.keyboard.press('Escape');
          await expect(modal).toBeHidden();
          await expect(input).toHaveValue(BAD_LENGTH);
          await expect(page.locator('#import-wallet-action')).toBeDisabled();
          await unchanged();
        }
      );
      await wallet.step(
        `${locale.code}: valid and cleared synthetic phrases remain healthy without submitting recovery`,
        async () => {
          const input = page.locator('#import-wallet-input');
          await input.fill(UTXO_FIXTURE_SEED);
          await expect(page.locator('#import-wallet-action')).toBeEnabled();
          await expect(
            page.locator('.ant-form-item-explain-error')
          ).toHaveCount(0);
          await input.clear();
          await expect(input).toHaveValue('');
          await expect(page.locator('#import-wallet-action')).toBeDisabled();
          await expect(page).toHaveURL(/#\/import$/);
          await expect(page.locator('#create-password')).toHaveCount(0);
          await unchanged();
          await page.goBack();
          await expect(page.locator('#password')).toBeVisible();
          await expect(page.locator('#import-wallet-input')).toHaveCount(0);
          await unchanged();
          observations.finished = await publicState(page);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceHash);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('wallet-localization-' + locale.code, {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            locale: locale.code,
            runtime,
            sourceHash,
            observations,
            fixtureReads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedRequests: server?.blocked ?? [],
            pageErrors,
            syntheticHttpOnly: true,
            publicMetadataProjectionOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            storageReplaced: false,
            accountImportSubmitted: false,
            networkSaved: false,
            recoverySubmitted: false,
            seedVectorsArePublishedSyntheticOnly: true,
            secretExportRequested: false,
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
