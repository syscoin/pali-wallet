import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Two ordinary extension documents share the real persisted settings. Only
// public preferences are read; no controller, Redux, or Chrome API is replaced.
const savedPreferences = (page: Page) =>
  page.evaluate(async () => {
    const saved = await chrome.storage.local.get('state');
    const advanced = saved.state?.vaultGlobal?.advancedSettings;
    return { autolock: advanced?.autolock, refresh: advanced?.refresh };
  });

const autolock = (page: Page) => page.locator('#advanced-autolock');
const save = (page: Page) =>
  page.getByRole('button', { name: en.buttons.save, exact: true });
const success = (page: Page) =>
  page.getByText(en.settings.advancedSettingsWasSet, { exact: true });

test('advanced settings follow another window after undo while preserving a genuine draft', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'AdvancedDraftSyncSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let other: Page | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const pageErrors: string[] = [];
  const observations: Record<string, unknown> = {};
  try {
    wallet = await PaliWallet.launch('advanced-settings-draft-sync', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(`A: ${error.message}`));
    const snapshot = async () => ({
      saved: await savedPreferences(page),
      a: {
        value: await autolock(page).inputValue(),
        saveEnabled: await save(page).isEnabled(),
      },
      b: other
        ? {
            value: await autolock(other).inputValue(),
            saveEnabled: await save(other).isEnabled(),
          }
        : null,
    });
    await wallet.step(
      'advanced-draft-sync: save five minutes and open two ordinary documents',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.gotoRoute('#/settings/advanced');
        await expect(autolock(page)).toHaveValue('0');
        await expect(save(page)).toBeDisabled();
        const initial = await savedPreferences(page);
        expect(initial.autolock).toBe(0);
        expect(typeof initial.refresh).toBe('boolean');
        observations.initial = initial;
        await autolock(page).fill('5');
        await expect(save(page)).toBeEnabled();
        await save(page).click();
        await expect(success(page)).toBeVisible();
        await expect
          .poll(() => savedPreferences(page))
          .toEqual({ autolock: 5, refresh: initial.refresh });
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(success(page)).toBeHidden();
        await wallet!.gotoRoute('#/settings/advanced');
        await expect(autolock(page)).toHaveValue('5');
        await expect(save(page)).toBeDisabled();
        other = await wallet!.context.newPage();
        other.on('pageerror', (error) =>
          pageErrors.push(`B: ${error.message}`)
        );
        await other.goto(wallet!.appUrl('#/settings/advanced'));
        await expect(autolock(other)).toHaveValue('5');
        await expect(save(other)).toBeDisabled();
        observations.baseline = await snapshot();
      }
    );

    // This exact DOM node must remain connected throughout all races. A hash
    // route change or document reload on A cannot manufacture a passing result.
    const mountedInput = await autolock(page).elementHandle();
    expect(mountedInput).not.toBeNull();
    const documentA = {
      url: page.url(),
      timeOrigin: await page.evaluate(() => performance.timeOrigin),
    };
    const assertAMounted = async () => {
      expect(page.url()).toBe(documentA.url);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(
        documentA.timeOrigin
      );
      expect(
        await mountedInput!.evaluate(
          (input) =>
            input.isConnected &&
            document.getElementById('advanced-autolock') === input
        )
      ).toBe(true);
    };
    const refresh = (await savedPreferences(page)).refresh;
    const saveInB = async (minutes: number) => {
      await expect(autolock(other!)).toBeVisible();
      await autolock(other!).fill(String(minutes));
      await expect(save(other!)).toBeEnabled();
      await save(other!).click();
      await expect(success(other!)).toBeVisible();
      await expect
        .poll(() => savedPreferences(other!))
        .toEqual({ autolock: minutes, refresh });
    };
    const reopenB = async (minutes: number) => {
      // Dismiss the real success modal, letting its normal Home navigation
      // finish before reopening only B. A is never navigated or reloaded.
      await other!.keyboard.press('Escape');
      await expect(other!).toHaveURL(/#\/home(?:\?.*)?$/);
      await expect(success(other!)).toBeHidden();
      await other!.goto(wallet!.appUrl('#/settings/advanced'));
      await expect(autolock(other!)).toHaveValue(String(minutes));
      await expect(save(other!)).toBeDisabled();
    };

    await wallet.step(
      'advanced-draft-sync: an undone five-minute draft follows the saved ten',
      async () => {
        await autolock(page).fill('15');
        await expect(save(page)).toBeEnabled();
        await autolock(page).fill('5');
        await expect(save(page)).toBeDisabled();
        await saveInB(10);
        await expect(autolock(page)).toHaveValue('10');
        await expect(save(page)).toBeDisabled();
        await assertAMounted();
        await reopenB(10);
        observations.undoneInitialDraft = await snapshot();
      }
    );
    await wallet.step(
      'advanced-draft-sync: a genuine fifteen-minute draft survives saved twenty',
      async () => {
        await autolock(page).fill('15');
        await expect(save(page)).toBeEnabled();
        await saveInB(20);
        await expect(autolock(page)).toHaveValue('15');
        await expect(save(page)).toBeEnabled();
        await assertAMounted();
        await reopenB(20);
        observations.genuineDraft = await snapshot();
      }
    );
    await wallet.step(
      'advanced-draft-sync: undo to the latest twenty follows saved twenty-five',
      async () => {
        await autolock(page).fill('20');
        // Disabled proves the latest baseline reached A, not just storage.
        await expect(save(page)).toBeDisabled();
        await saveInB(25);
        await expect(autolock(page)).toHaveValue('25');
        await expect(save(page)).toBeDisabled();
        await assertAMounted();
        await reopenB(25);
        observations.undoneLatestDraft = await snapshot();
      }
    );
    await wallet.step(
      'advanced-draft-sync: both views retain the durable final public preferences',
      async () => {
        await assertAMounted();
        await expect(autolock(page)).toHaveValue('25');
        await expect(save(page)).toBeDisabled();
        await expect(autolock(other!)).toHaveValue('25');
        await expect(save(other!)).toBeDisabled();
        expect(await savedPreferences(page)).toEqual({
          autolock: 25,
          refresh,
        });
        expect(await savedPreferences(other!)).toEqual({
          autolock: 25,
          refresh,
        });
        expect(routes!.deniedWrites).toEqual([]);
        expect(routes!.syntheticBroadcasts).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        observations.final = await snapshot();
        observations.documentA = documentA;
      }
    );
    status = 'passed';
  } catch (error) {
    status = 'failed';
    throw error;
  } finally {
    try {
      await info.attach('advanced-settings-draft-sync-evidence', {
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            status,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            chromeApiReplaced: false,
            signingOrBroadcastRequested: false,
            publicStorageProjectionOnly: ['autolock', 'refresh'],
            documentANavigatedDuringRaces: false,
            observations,
            pageErrors,
            deniedWrites: routes?.deniedWrites || [],
            syntheticBroadcasts: routes?.syntheticBroadcasts || [],
            reads: routes?.reads || [],
            deniedUnknown: routes?.deniedUnknown || [],
            proxyDeniedConnections: server.blocked.length,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        try {
          await other?.close();
        } catch (error) {
          status = 'failed';
          throw error;
        }
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
  }
});
