// Real uninitialized-provider requests must resume their original, document-bound
// consent after ordinary onboarding. Every profile is synthetic and launch-fenced.
// Generated phrases stay inside the page and never enter reports or recordings.
import { expect, test, type Page } from '@playwright/test';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  extensionEvidence,
  rpcObservation,
  startRequest,
  settle,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const PASSWORD = 'ExternalOnboardingSynthetic!2026';
function assertPinnedRuntime() {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
}
async function disposePrivateContext(
  wallet: PaliWallet | undefined,
  status: 'passed' | 'failed',
  previousNoCopyPrompt: string | undefined
) {
  try {
    await wallet?.dispose(status);
  } finally {
    if (previousNoCopyPrompt === undefined)
      delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    else process.env.PLAYWRIGHT_NO_COPY_PROMPT = previousNoCopyPrompt;
  }
}

const metadata = (page: Page) =>
  page.evaluate(() => {
    const value = JSON.parse(
      new URL(location.href).searchParams.get('data') || '{}'
    );
    return {
      approvalId: value.approvalId,
      host: value.host,
      eventName: value.eventName,
    };
  });
const grants = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    return Object.keys(state.dapp?.dapps || {});
  });

for (const mode of ['import', 'create'] as const) {
  test(`new-wallet ${mode} resumes the original connection approval without granting it`, async ({}, info) => {
    test.setTimeout(180000);
    assertPinnedRuntime();
    const previousNoCopyPrompt = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: PASSWORD,
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`external-onboarding-${mode}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: {
          width: mode === 'import' ? 400 : 320,
          height: mode === 'import' ? 620 : 360,
        },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const dapp = await wallet.context.newPage();
      await dapp.goto(server.url);
      await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
      await wallet.page.goto('about:blank');
      const id = await startRequest(dapp, 'eth_requestAccounts');
      let popup: Page | undefined;
      await expect
        .poll(() => {
          popup = wallet!.context
            .pages()
            .find(
              (page) =>
                page
                  .url()
                  .startsWith(`chrome-extension://${wallet!.extensionId}/`) &&
                new URL(page.url()).searchParams.has('externalRoute')
            );
          return Boolean(popup);
        })
        .toBe(true);
      const original = await metadata(popup!);
      const originalRoute = new URL(popup!.url()).searchParams.get(
        'externalRoute'
      );
      expect(originalRoute).toMatch(/^(connect-wallet|switch-network)$/);
      expect(original.host).toBe(new URL(server.url).origin);
      expect(typeof original.approvalId).toBe('string');
      expect(Boolean((await rpcObservation(dapp, id)).settled)).toBe(false);
      await wallet.step(
        `complete ordinary ${mode} without exposing private material`,
        async (capture) => {
          // Capture before any secret is entered. Do not let automatic failure
          // screenshots expose the generated confirmation words.
          await capture(popup!);
          if (mode === 'import') {
            await popup!.locator('#import-wallet-link').click();
            await popup!
              .locator('#import-wallet-input')
              .fill(UTXO_FIXTURE_SEED);
            await expect(popup!.locator('#import-wallet-action')).toBeEnabled();
            await popup!.locator('#import-wallet-action').click();
            await popup!.locator('#create-password').fill(PASSWORD);
            await popup!.locator('#confirm-password').fill(PASSWORD);
            await popup!.locator('#create-password-action').click();
          } else {
            await popup!.locator('#unlock-btn').click();
            await popup!.locator('#create-password').fill(PASSWORD);
            await popup!.locator('#confirm-password').fill(PASSWORD);
            await popup!.locator('#create-password-action').click();
            await popup!
              .getByRole('button', {
                name: en.import.showSeedPhrase,
                exact: true,
              })
              .click();
            await expect
              .poll(() => popup!.locator('.select-none p').count())
              .toBe(12);
            await popup!.locator('.select-none p').evaluateAll((nodes) => {
              (window as any).__onboardingExpectedWords = nodes.map(
                (node) => node.textContent
              );
            });
            await popup!.getByRole('checkbox').check();
            await popup!.locator('#unlock-btn').click();
            for (let wordIndex = 0; wordIndex < 12; wordIndex++) {
              const index = await popup!.evaluate((position) => {
                const section = [...document.querySelectorAll('section')]
                  .filter((node) => node.querySelector('button.min-w-xs'))
                  .at(-1)!;
                const wanted = (window as any).__onboardingExpectedWords[
                  position
                ];
                return [...section.querySelectorAll('button')].findIndex(
                  (node) => node.textContent === wanted
                );
              }, wordIndex);
              expect(index).toBeGreaterThanOrEqual(0);
              await popup!
                .locator('section')
                .filter({ has: popup!.locator('button.min-w-xs') })
                .last()
                .getByRole('button')
                .nth(index)
                .click();
            }
            await popup!
              .getByRole('button', { name: en.buttons.validate, exact: true })
              .click();
            const ready = popup!.getByRole('dialog', {
              name: en.seedConfirm.yourWalletIsReady,
              exact: true,
            });
            await expect(ready).toBeVisible();
            await popup!.evaluate(() => {
              delete (window as any).__onboardingExpectedWords;
            });
            await ready
              .getByRole('button', { name: en.buttons.unlock, exact: true })
              .click();
          }
          await expect
            .poll(() => new URL(popup!.url()).pathname)
            .toBe(`/external/${originalRoute}`);
        }
      );
      await wallet.step(
        `${mode} review the resumed network prerequisite and explicitly choose the fixture network`,
        async (capture) => {
          expect(await metadata(popup!)).toEqual(original);
          expect(Boolean((await rpcObservation(dapp, id)).settled)).toBe(false);
          expect(await grants(popup!)).toEqual([]);
          await capture(popup!);
          if (originalRoute === 'switch-network') {
            await popup!
              .getByRole('button', {
                name: 'Syscoin NEVM Testnet',
                exact: true,
              })
              .click();
            await clickClosingPopup({
              click: () =>
                popup!
                  .getByRole('button', {
                    name: en.buttons.connect,
                    exact: true,
                  })
                  .click(),
              isClosed: () => popup!.isClosed(),
            });
            await expect
              .poll(() => {
                popup = wallet!.context
                  .pages()
                  .find(
                    (page) =>
                      page
                        .url()
                        .startsWith(
                          `chrome-extension://${wallet!.extensionId}/`
                        ) &&
                      new URL(page.url()).pathname ===
                        '/external/connect-wallet'
                  );
                return Boolean(popup);
              })
              .toBe(true);
          }
        }
      );
      await wallet.step(
        `${mode} review the same host and cancel without granting a connection`,
        async (capture) => {
          const connection = await metadata(popup!);
          expect(connection.host).toBe(original.host);
          expect(connection.approvalId).toEqual(expect.any(String));
          expect(Boolean((await rpcObservation(dapp, id)).settled)).toBe(false);
          expect(await grants(popup!)).toEqual([]);
          await expect(
            popup!.getByText(original.host, { exact: true })
          ).toBeVisible();
          await capture(popup!);
          await info.attach(`${mode}-resumed-original-approval`, {
            body: await popup!.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await clickClosingPopup({
            click: () =>
              popup!
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click(),
            isClosed: () => popup!.isClosed(),
          });
          const response = await settle(dapp, id);
          expect(response.result).toBeUndefined();
          // Connection middleware deliberately maps declined consent to the
          // provider unauthorized error, rather than granting or returning
          // an account. Preserve that existing public contract.
          expect(response.error?.code).toBe(4100);
          expect(response.error?.message).toBe('Connection required');
          await wallet!.gotoRoute('#/home');
          expect(await grants(wallet!.page)).toEqual([]);
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      await info.attach('public-runtime', {
        body: JSON.stringify({
          ...extensionEvidence(),
          mode,
          original,
          originalRoute,
          deniedWrites: routes.deniedWrites,
          nativeOnboarding: true,
          automaticGrant: false,
          privateMaterialReported: false,
        }),
        contentType: 'application/json',
      });
      status = 'passed';
    } finally {
      await disposePrivateContext(wallet, status, previousNoCopyPrompt);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}

test('closing the requesting document cancels uninitialized onboarding', async ({}, info) => {
  test.setTimeout(90000);
  assertPinnedRuntime();
  const previousNoCopyPrompt = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: PASSWORD,
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('external-onboarding-source-close', {
      offlineHttpProxy: server.url,
      recordVideo: false,
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.page.goto('about:blank');
    await startRequest(dapp, 'eth_requestAccounts');
    let popup: Page | undefined;
    await expect
      .poll(() => {
        popup = wallet!.context
          .pages()
          .find(
            (page) =>
              page
                .url()
                .startsWith(`chrome-extension://${wallet!.extensionId}/`) &&
              new URL(page.url()).searchParams.has('externalRoute')
          );
        return Boolean(popup);
      })
      .toBe(true);
    await wallet.step(
      'source closure discards the pending approval and preserves the empty wallet',
      async (capture) => {
        await capture(popup!);
        await dapp.close();
        await expect.poll(() => popup!.isClosed()).toBe(true);
        await wallet!.gotoRoute('#/');
        await expect(wallet!.page.locator('#import-wallet-link')).toBeVisible();
        expect(await grants(wallet!.page)).toEqual([]);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('public-runtime', {
      body: JSON.stringify({
        ...extensionEvidence(),
        deniedWrites: routes.deniedWrites,
        privateMaterialReported: false,
      }),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await disposePrivateContext(wallet, status, previousNoCopyPrompt);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});

test('a copied routed onboarding URL cannot inherit the original approval document', async ({}, info) => {
  test.setTimeout(90000);
  assertPinnedRuntime();
  const previousNoCopyPrompt = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: PASSWORD,
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('external-onboarding-document-boundary', {
      offlineHttpProxy: server.url,
      recordVideo: false,
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
    await wallet.page.goto('about:blank');
    const id = await startRequest(dapp, 'eth_requestAccounts');
    let popup: Page | undefined;
    await expect
      .poll(() => {
        popup = wallet!.context
          .pages()
          .find(
            (page) =>
              page
                .url()
                .startsWith(`chrome-extension://${wallet!.extensionId}/`) &&
              new URL(page.url()).searchParams.has('externalRoute')
          );
        return Boolean(popup);
      })
      .toBe(true);
    await wallet.step(
      'copied onboarding URL cannot inherit its original document capability',
      async (capture) => {
        await capture(popup!);
        const clone = await wallet!.context.newPage();
        const originalUrl = new URL(popup!.url());
        // React's routed URL has no physical extension file. Load the real
        // entry document with identical public approval parameters to test
        // document binding rather than an unrelated file-not-found error.
        const copiedEntry = new URL('/external.html', originalUrl);
        copiedEntry.searchParams.set(
          'route',
          originalUrl.searchParams.get('externalRoute')!
        );
        copiedEntry.searchParams.set(
          'data',
          originalUrl.searchParams.get('data')!
        );
        await clone.goto(copiedEntry.href);
        await expect(clone.getByRole('status')).toContainText(
          /expired|no longer available/i
        );
        expect(Boolean((await rpcObservation(dapp, id)).settled)).toBe(false);
        await info.attach('copied-document-refusal', {
          body: await clone.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        await clone.close();
        expect(Boolean((await rpcObservation(dapp, id)).settled)).toBe(false);
        await popup!.close();
        const response = await settle(dapp, id);
        // The original request is still at its locked network-type prerequisite.
        // The request pipeline wraps that cancellation as provider unauthorized.
        expect(response.result).toBeUndefined();
        expect(response.error?.code).toBe(4100);
        expect(response.error?.message).toContain(
          'Network switch was cancelled'
        );
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('public-runtime', {
      body: JSON.stringify({
        ...extensionEvidence(),
        deniedWrites: routes.deniedWrites,
        privateMaterialReported: false,
      }),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    await disposePrivateContext(wallet, status, previousNoCopyPrompt);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
