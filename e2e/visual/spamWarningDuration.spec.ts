import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import es from '../../source/assets/locales/es.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const MESSAGE = '0x7370616d2d6475726174696f6e'; // Public text only.
type WarningCopy = {
  buttons: { cancel: string; continue: string };
  spamWarning: { blockDuration: string; title: string };
};

// Read only the public spam-policy metadata; never replace a controller result,
// mutate counters, adjust the clock, or invoke a private controller method.
const spamMetadata = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const row = state.spamFilter.dapps[origin];
    return {
      config: {
        enabled: state.spamFilter.config.enabled,
        requestThreshold: state.spamFilter.config.requestThreshold,
        timeWindowMs: state.spamFilter.config.timeWindowMs,
        blockDurationMs: state.spamFilter.config.blockDurationMs,
      },
      row: row
        ? {
            host: row.host,
            requests: row.requests.map((request: any) => ({
              method: request.method,
              timestamp: request.timestamp,
            })),
            warningShown: row.warningShown,
            blockedUntil: row.blockedUntil ?? null,
          }
        : null,
    };
  }, host);

const readLanguage = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | undefined>((resolve) => {
        chrome.storage.local.get(['language'], (result) =>
          resolve(result.language)
        );
      })
  );

test('spam warning duration follows the saved UI language without approving signing', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const originalConfig = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SpamDurationSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  const host = new URL(server.url).origin;
  const owner = fixture.evmAddresses[0];
  let runtime: ReturnType<typeof extensionEvidence>;
  const observations: Record<string, unknown> = {};
  const cancellations: Array<{ code: unknown; id: number }> = [];
  const pageErrors: string[] = [];
  let wallet: PaliWallet | undefined;
  let dapp: Page | undefined;
  let warning: Page | undefined;
  let thirdRequest = -1;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';

  const cancelRequest = async (requestId: number, cancelLabel: string) => {
    const popup = await popupFor(wallet!.context, dapp!, requestId);
    expect(popup.url()).toContain('/external/tx/ethSign');
    const rejected = await dismissRejectedApproval({
      click: () =>
        popup.getByRole('button', { name: cancelLabel, exact: true }).click(),
      isClosed: () => popup.isClosed(),
      settle: () => settle(dapp!, requestId),
    });
    expect(rejected.error?.code).toBe(4001);
    expect(rejected.result).toBeUndefined();
    cancellations.push({ id: requestId, code: rejected.error?.code });
  };

  const triggerWarning = async (
    language: 'en' | 'es',
    copy: WarningCopy,
    capture: (page: Page) => Promise<void>
  ) => {
    const initial = await spamMetadata(wallet!.page, host);
    expect(initial.config).toEqual({
      enabled: true,
      requestThreshold: 3,
      timeWindowMs: 10_000,
      blockDurationMs: 60_000,
    });
    expect(initial.row?.requests || []).toEqual([]);
    // Only cancellation is exercised. No Sign/Confirm button is clicked.
    for (let index = 0; index < 2; index += 1) {
      const requestId = await startRequest(dapp!, 'personal_sign', [
        MESSAGE,
        owner,
      ]);
      await cancelRequest(requestId, copy.buttons.cancel);
    }
    thirdRequest = await startRequest(dapp!, 'personal_sign', [MESSAGE, owner]);
    warning = await popupFor(wallet!.context, dapp!, thirdRequest);
    expect(warning.url()).toContain('/external/spam-warning');
    await expect(
      warning.getByRole('heading', {
        name: copy.spamWarning.title,
        exact: true,
      })
    ).toBeVisible();
    await expect(warning.getByText(host, { exact: true })).toBeVisible();
    const duration = language === 'es' ? '1 minuto' : '1 minute';
    const expected = copy.spamWarning.blockDuration.replace(
      '{{duration}}',
      duration
    );
    await expect(warning.getByText(expected, { exact: true })).toBeVisible();
    const data = await warning.evaluate(() => {
      const value = JSON.parse(
        new URL(location.href).searchParams.get('data')!
      );
      return {
        host: value.host,
        eventName: value.eventName,
        requestCount: value.requestCount,
      };
    });
    expect(data).toEqual({
      host,
      eventName: 'spamWarningResponse',
      requestCount: 3,
    });
    const current = await spamMetadata(wallet!.page, host);
    expect(current.row?.host).toBe(host);
    expect(current.row?.warningShown).toBe(true);
    expect(current.row?.blockedUntil).toBeNull();
    expect(current.row?.requests).toHaveLength(3);
    expect(
      current.row!.requests.every((row: any) => row.method === 'personal_sign')
    ).toBe(true);
    const times = current.row!.requests.map((row: any) => row.timestamp);
    expect(times.every((value: number) => Number.isSafeInteger(value))).toBe(
      true
    );
    expect(times[2] - times[0]).toBeLessThan(current.config.timeWindowMs);
    expect((await rpcObservation(dapp!, thirdRequest)).settled).not.toBe(true);
    observations[language + 'Warning'] = { data, expected, metadata: current };
    await capture(warning);
  };

  const continueThenCancel = async (
    copy: WarningCopy,
    capture: (page: Page) => Promise<void>
  ) => {
    const currentWarning = warning!;
    await clickClosingPopup({
      click: () =>
        currentWarning
          .getByRole('button', { name: copy.buttons.continue, exact: true })
          .click(),
      isClosed: () => currentWarning.isClosed(),
    });
    await expect.poll(() => currentWarning.isClosed()).toBe(true);
    const actualRequest = await popupFor(wallet!.context, dapp!, thirdRequest);
    expect(actualRequest.url()).toContain('/external/tx/ethSign');
    await expect(
      actualRequest.getByRole('button', {
        name: copy.buttons.cancel,
        exact: true,
      })
    ).toBeVisible();
    await capture(actualRequest);
    await cancelRequest(thirdRequest, copy.buttons.cancel);
    const reset = await spamMetadata(wallet!.page, host);
    expect(reset.row?.requests).toEqual([]);
    expect(reset.row?.warningShown).toBe(false);
    expect(reset.row?.blockedUntil).toBeNull();
  };

  try {
    runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    wallet = await PaliWallet.launch('spam-warning-duration', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => pageErrors.push(error.message))
    );
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.step(
      'spam-duration: onboard and connect the ordinary local provider',
      async (capture) => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        dapp = await wallet!.context.newPage();
        await dapp.goto(server.url);
        await dapp.waitForFunction(() =>
          Boolean((window as any).pali?.request)
        );
        const connected = await approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'eth_requestAccounts'),
          capture
        );
        expect(
          connected.result.map((address: string) => address.toLowerCase())
        ).toEqual([owner.toLowerCase()]);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          owner.toLowerCase(),
        ]);
        expect((await readLanguage(wallet!.page)) || 'en').toBe('en');
      }
    );
    await wallet.step(
      'spam-duration: reach the real English warning with three rejected requests',
      async (capture) => {
        await triggerWarning('en', en, capture);
      }
    );
    await wallet.step(
      'spam-duration: Continue the English warning and cancel the actual signing request',
      async (capture) => {
        await continueThenCancel(en, capture);
      }
    );
    await wallet.step(
      'spam-duration: save Spanish through the normal Languages form',
      async () => {
        await wallet!.gotoRoute('#/settings/languages');
        const page = wallet!.page;
        await page
          .getByRole('button', {
            name: en.settings.setYourPreferredLanguage,
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: 'Spanish Español', exact: true })
          .click();
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect.poll(() => readLanguage(page)).toBe('es');
        await expect(
          page.getByText(es.settings.languageWasSet, { exact: true })
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await wallet!.gotoRoute('#/home');
      }
    );
    await wallet.step(
      'spam-duration: reach the real Spanish warning and verify localized duration and host',
      async (capture) => {
        await triggerWarning('es', es, capture);
      }
    );
    await wallet.step(
      'spam-duration: Continue in Spanish then cancel without producing a signature',
      async (capture) => {
        await continueThenCancel(es, capture);
        expect(cancellations).toHaveLength(6);
        expect(new Set(cancellations.map((row) => row.id)).size).toBe(6);
        expect(cancellations.every((row) => row.code === 4001)).toBe(true);
        expect(routes!.deniedWrites).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('spam-duration-runtime-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            host,
            owner,
            observations,
            cancellations,
            pageErrors,
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            syntheticHttpOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            signingApprovalClicked: false,
            clockReplaced: false,
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
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, originalConfig);
        }
      }
    }
  }
});
