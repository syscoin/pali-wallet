import { expect, test } from '@playwright/test';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import { createGuardianRecoveryFixture } from '../harness/guardianRecoveryFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

// Reuse the recorded value for the after capture while it is still fresh.
// The real guardian reader's seven-minute freshness guard remains active.
const TIMESTAMP = Number(
  process.env.PALI_GUARDIAN_DATE_TIMESTAMP || Math.floor(Date.now() / 1000)
);

for (const target of [
  { code: 'de', text: de, option: 'German Deutsch', width: 400, height: 620 },
  { code: 'fr', text: fr, option: 'French Français', width: 320, height: 360 },
] as const) {
  test(`guardian dates follow the real saved ${target.code} language without a local recovery intent`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(Number.isSafeInteger(TIMESTAMP)).toBe(true);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const fixture = createGuardianRecoveryFixture();
    fixture.state.timestamp = TIMESTAMP;
    fixture.state.scheduledAt = TIMESTAMP - 100;
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: VISUAL_FIXTURE_SEED,
      password: 'GuardianDateLocaleSynthetic!2026',
      rpcUrl: server.url,
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
    });
    let wallet: PaliWallet | undefined;
    let outcome: 'passed' | 'failed' = 'failed';
    const observations: unknown[] = [];
    const evidence: Record<string, unknown> = {
      runtime,
      timestamp: TIMESTAMP,
      observations,
    };
    try {
      wallet = await PaliWallet.launch(`guardian-date-locale-${target.code}`, {
        offlineHttpProxy: server.url,
        viewport: { width: target.width, height: target.height },
      });
      await fixture.install(wallet.context, server.url);
      const page = wallet.page;
      const localIntentKeys = () =>
        page.evaluate(() =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith('pali-smart-account-recovery-replacement:')
          )
        );
      await wallet.step(
        'create the real local smart account through the ordinary account menu',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('zkTanenbaum', 'EVM');
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: en.accountMenu.createNewAccount,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/new$/);
          await page
            .locator('#account-name-input')
            .fill('Guardian date fixture');
          await page
            .getByRole('button', {
              name: new RegExp(`^${en.settings.createSmartAccount}`, 'i'),
            })
            .click();
          const dialog = page
            .getByRole('dialog')
            .filter({ hasText: en.settings.yourNewAccount });
          await expect(
            dialog.getByText(fixture.base.smartAccountAddress, { exact: true })
          ).toBeVisible();
          await dialog.locator('#account-created-ok-btn').click();
          await wallet!.ensureOnHome();
          expect(await localIntentKeys()).toEqual([]);
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
      // The external party's on-chain installation/schedule changes only the
      // attested ABI/storage responses, never the local wallet or its keys.
      fixture.hydrationState.deployed = true;
      fixture.hydrationState.guardianInstalled = true;
      for (const language of ['en', target.code] as const) {
        const text = language === 'en' ? en : target.text;
        if (language !== 'en')
          await wallet.step(
            `save ${language} through ordinary Language settings`,
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
                .poll(() =>
                  page.evaluate(
                    async () =>
                      (
                        await chrome.storage.local.get('language')
                      ).language
                  )
                )
                .toBe(language);
            }
          );
        await wallet.step(
          `${language}: open recovery policy from the real smart-account hub and inspect all observed dates`,
          async () => {
            await wallet!.ensureOnHome();
            await page.locator('#smart-account-hub-badge').click();
            await expect(page).toHaveURL(/#\/home\/smart-account$/);
            // The real shortcut button also names its ArrowRight image.
            // Select its exact visible label within the native button.
            const policyShortcut = page.getByRole('button').filter({
              has: page.getByText(
                text.settings.smartAccountGuardianRecoveryTitle,
                {
                  exact: true,
                }
              ),
            });
            await expect(policyShortcut).toHaveCount(1);
            await policyShortcut.scrollIntoViewIfNeeded();
            await policyShortcut.click();
            await expect(page).toHaveURL(
              /#\/settings\/account\/smart-account-policy$/
            );
            const panel = page.getByTestId('guardian-chain-status');
            await expect(
              panel.getByText(
                text.settings.smartAccountGuardianExternalPending,
                { exact: true }
              )
            ).toBeVisible();
            await expect(
              panel.getByText(fixture.base.smartAccountAddress, { exact: true })
            ).toBeVisible();
            for (const [field, key, seconds] of [
              [
                'ready',
                'smartAccountGuardianRecoveryReadyAt',
                fixture.state.scheduledAt + 600,
              ],
              [
                'expires',
                'smartAccountGuardianExpiresAt',
                fixture.state.scheduledAt + 1800,
              ],
              [
                'observed',
                'smartAccountGuardianObservedAt',
                fixture.state.timestamp,
              ],
            ] as const) {
              const dates = await page.evaluate(
                ({ epoch, locale }) => ({
                  browser: new Date(epoch * 1000).toLocaleString(),
                  desired: new Date(epoch * 1000).toLocaleString(locale),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
                { epoch: seconds, locale: language }
              );
              const selectedDate = dates.desired;
              const expected = text.settings[key].replace(
                '{{- time}}',
                selectedDate
              );
              const line = panel.getByText(expected, { exact: true });
              await expect(line).toBeVisible();
              await line.scrollIntoViewIfNeeded();
              await page.mouse.move(0, 0);
              observations.push({
                language,
                field,
                seconds,
                ...dates,
                rendered: await line.innerText(),
                expectedLocale: text.settings[key].replace(
                  '{{- time}}',
                  dates.desired
                ),
              });
              await info.attach(
                `guardian-${language}-${field}-${target.width}`,
                {
                  body: await page.screenshot({ animations: 'disabled' }),
                  contentType: 'image/png',
                }
              );
            }
            expect(await localIntentKeys()).toEqual([]);
            await page
              .getByRole('button', {
                name: text.settings.smartAccountGuardianRecoveryContinue,
                exact: true,
              })
              .click();
            await expect(
              page.getByRole('button', {
                name: text.settings.smartAccountGuardianRecoveryFinalize,
                exact: true,
              })
            ).toBeDisabled();
            // No recovery is started/finalized and no local credential is created.
            expect(await localIntentKeys()).toEqual([]);
          }
        );
      }
      await wallet.step(
        'retain read-only network and exact loaded worker identity',
        async () => {
          expect(fixture.audit.deniedWrites).toEqual([]);
          expect(
            fixture.audit.deniedUnknown.filter((entry) =>
              entry.startsWith('rpc:')
            )
          ).toEqual([]);
          expect(fixture.audit.reads).toContain('rpc:eth_getStorageAt');
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
      outcome = 'passed';
    } finally {
      await info.attach('guardian-date-locale-observation', {
        contentType: 'application/json',
        body: JSON.stringify(
          { outcome, ...evidence, network: fixture.audit },
          null,
          2
        ),
      });
      fixture.releaseStorage();
      fixture.releaseAll();
      try {
        await wallet?.dispose(outcome);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
