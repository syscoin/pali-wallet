import { expect, test, type Page } from '@playwright/test';
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

const ENGLISH_GUIDANCE =
  'Label must be non-empty and different from current label';
const locales = [
  {
    code: 'de',
    translations: de,
    option: 'German Deutsch',
    guidance: 'Neuen Namen eingeben.',
    nextLabel: 'Familienkonto',
  },
  {
    code: 'fr',
    translations: fr,
    option: 'French Français',
    guidance: 'Entrez un nouveau nom.',
    nextLabel: 'Compte familial',
  },
] as const;

// Only public identity, label, selected network and selected locale leave
// these reads. Every controller result and durable write is genuine.
const publicAccount = (page: Page) =>
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
      slip44: state.vaultGlobal.activeSlip44,
      network: {
        kind: network.kind,
        chainId: network.chainId,
        url: network.url,
        currency: network.currency,
      },
      language: saved.language,
      live: project(state.vault.accounts[ref.type][ref.id]),
      saved: project(saved[key].accounts[ref.type][ref.id]),
    };
  });

for (const locale of locales) {
  test(`account label refusals use the saved UI language and preserve the account: ${locale.code}`, async ({}, info) => {
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
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const observations: Record<string, unknown> = {};
    const pageErrors: string[] = [];
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'AccountLabelLocaleSynthetic!2026',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(
        'account-label-localization-' + locale.code,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const input = page.getByPlaceholder(
        locale.translations.settings.accountLabel,
        {
          exact: true,
        }
      );
      const save = page.getByRole('button', {
        name: locale.translations.buttons.save,
        exact: true,
      });
      const form = page.locator('#edit-account');
      const guidance = form.getByText(locale.guidance, { exact: true });
      let before: Awaited<ReturnType<typeof publicAccount>>;
      const expectUnchanged = async () => {
        expect(await publicAccount(page)).toEqual(before);
        await expect(page).toHaveURL(/#\/settings\/edit-account$/);
        await expect(input).toBeEnabled();
        await expect(save).toBeEnabled();
      };
      await wallet.step(
        `${locale.code}: save the language through the ordinary Languages menu`,
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
          before = await publicAccount(page);
          expect(before.active).toEqual({ id: 0, type: 'HDAccount' });
          expect(before.language).toBe(locale.code);
          expect(before.network).toMatchObject({
            kind: 'syscoin',
            chainId: 5700,
          });
          expect(before.live).toEqual(before.saved);
          observations.before = before;
        }
      );
      await wallet.step(
        `${locale.code}: unchanged-label Save gives localized guidance without mutating the account`,
        async () => {
          await page
            .getByRole('button', {
              name: locale.translations.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: locale.translations.accountMenu.manageAccounts,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          await page
            .getByRole('button', {
              name: `${locale.translations.buttons.edit}: ${before.live.label}`,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/edit-account$/);
          await expect(input).toHaveValue(before.live.label);
          await expect(input).toHaveAccessibleName(
            locale.translations.settings.accountLabel
          );
          await save.click();
          await expect(guidance).toBeVisible();
          await expect(
            form.getByText(ENGLISH_GUIDANCE, { exact: true })
          ).toHaveCount(0);
          await expectUnchanged();
          observations.unchangedRefusal = {
            guidance: await guidance.textContent(),
            state: await publicAccount(page),
          };
        }
      );
      await wallet.step(
        `${locale.code}: spaces and non-breaking spaces stay editable with the same localized guidance`,
        async () => {
          const refused: Array<{ guidance: string | null; kind: string }> = [];
          for (const [kind, value] of [
            ['spaces', '   '],
            ['non-breaking spaces', '\u00a0\u00a0'],
          ]) {
            await input.fill(value);
            await save.click();
            await expect(guidance).toBeVisible();
            await expect(
              form.getByText(ENGLISH_GUIDANCE, { exact: true })
            ).toHaveCount(0);
            await expect(input).toHaveValue(value);
            await expectUnchanged();
            refused.push({ kind, guidance: await guidance.textContent() });
          }
          observations.blankRefusals = refused;
        }
      );
      await wallet.step(
        `${locale.code}: a valid new label is durably saved by Enter and reopens on the same account and network`,
        async () => {
          await input.fill(locale.nextLabel);
          await input.press('Enter');
          await expect(page).toHaveURL(/#\/settings\/manage-accounts$/);
          const edit = page.getByRole('button', {
            name: `${locale.translations.buttons.edit}: ${locale.nextLabel}`,
            exact: true,
          });
          await expect(edit).toBeVisible();
          const after = await publicAccount(page);
          expect(after).toEqual({
            ...before,
            live: { ...before.live, label: locale.nextLabel },
            saved: { ...before.saved, label: locale.nextLabel },
          });
          observations.saved = after;
          await edit.click();
          await expect(input).toHaveValue(locale.nextLabel);
          expect(await publicAccount(page)).toEqual(after);
          await expect(
            form.getByText(ENGLISH_GUIDANCE, { exact: true })
          ).toHaveCount(0);
          expect(routes!.deniedWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
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
        await info.attach('account-label-localization-' + locale.code, {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            locale: locale.code,
            expectedGuidance: locale.guidance,
            runtime,
            sourceHash,
            observations,
            fixtureReads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedRequests: server?.blocked ?? [],
            pageErrors,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            storageReplaced: false,
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
