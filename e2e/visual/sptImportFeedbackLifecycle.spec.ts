import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { SPT_GUID, SPT_SYMBOL } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

(['current', 'departed'] as const).forEach((view) => {
  test(
    view === 'current'
      ? 'SPT import completion announces the real saved token in its current view'
      : 'SPT import completion does not announce success in a different account',
    async ({}, info) => {
      test.setTimeout(120_000);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(
        path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')
      ).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const runtime = extensionEvidence();
      const before = { ...E2E_CONFIG };
      const fixture = createIsolatedVaultFixture();
      const server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'SptFeedbackSynthetic!2026',
        chainId: 5700,
        networkLabel: 'Syscoin Testnet',
        rpcUrl: server.url,
      });
      let wallet: PaliWallet | undefined;
      let status: 'passed' | 'failed' = 'failed';
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      const projections: unknown[] = [];
      let delivery: unknown;
      try {
        wallet = await PaliWallet.launch(`spt-import-feedback-${view}`, {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        });
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        const page = wallet.page;
        const selectedLabel = page.locator(
          '[id="active-account-label items-center"]'
        );
        const secondLabel = 'Second SPT feedback account';
        const successMessage = en.tokens.hasBeenAddedToYourWallet.replace(
          '{{token}}',
          SPT_SYMBOL
        );
        const select = async (id: number) => {
          await page.locator('#general-settings-button').click();
          await page.locator(`#account-HDAccount-${id}`).click();
          await wallet!.ensureOnHome();
        };
        // Read only a bounded public projection, never whole vault/key material.
        const projection = () =>
          page.evaluate(
            () =>
              new Promise<any>((resolve, reject) => {
                chrome.runtime.sendMessage(
                  { type: 'getCurrentState' },
                  (state) => {
                    if (chrome.runtime.lastError || !state?.vault) {
                      reject(new Error('Public token state unavailable'));
                      return;
                    }
                    const vault = state.vault;
                    resolve({
                      selectedId: vault.activeAccount.id,
                      selectedType: vault.activeAccount.type,
                      chainId: vault.activeNetwork.chainId,
                      tokens: [0, 1].map((id) => ({
                        accountId: id,
                        guids: (
                          vault.accountAssets?.HDAccount?.[id]?.syscoin || []
                        ).map((token: any) => String(token.assetGuid)),
                      })),
                    });
                  }
                );
              })
          );
        await wallet.step(
          'import a disposable wallet and create a second account through ordinary UI',
          async (capture) => {
            try {
              await wallet!.importSeedAndCreatePassword();
              await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
              await wallet!.ensureOnHome();
              await page.locator('#general-settings-button').click();
              await page
                .getByText(en.accountMenu.createNewAccount, { exact: true })
                .click();
              await page.locator('#account-name-input').fill(secondLabel);
              await page.locator('#create-btn').click();
              await page.getByRole('button', { name: /^ok$/i }).first().click();
              await wallet!.ensureOnHome();
              await expect(selectedLabel).toContainText(secondLabel);
              await select(0);
              expect(await projection()).toEqual({
                selectedId: 0,
                selectedType: 'HDAccount',
                chainId: 5700,
                tokens: [
                  { accountId: 0, guids: [] },
                  { accountId: 1, guids: [] },
                ],
              });
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        await wallet.step(
          'open the genuine owned-token discovery result before importing',
          async (capture) => {
            try {
              await page.locator('#assets-btn').click();
              await page
                .getByRole('button', { name: en.home.importToken, exact: true })
                .click();
              await expect(
                page.getByRole('button', {
                  name: `Import ${SPT_SYMBOL} token`,
                  exact: true,
                })
              ).toBeEnabled();
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        await wallet.step(
          view === 'current'
            ? 'hold only genuine save reply delivery while keeping the import view current'
            : 'hold only genuine save reply delivery and leave the import view for another account',
          async (capture) => {
            try {
              await page.evaluate(() => {
                const original = chrome.runtime.sendMessage;
                let held: (() => void) | undefined;
                const evidence = {
                  forwardedSaves: 0,
                  genuineReplyReceived: false,
                  released: false,
                  transportError: null as string | null,
                  controllerError: false,
                  heldForMs: 0,
                  observedFeedbackMessages: [] as string[],
                };
                // Observe both page status and toasts without changing timing.
                const observeFeedback = () => {
                  document
                    .querySelectorAll('.Toastify__toast-body, [role="status"]')
                    .forEach((node) => {
                      const text = node.textContent || '';
                      if (!evidence.observedFeedbackMessages.includes(text))
                        evidence.observedFeedbackMessages.push(text);
                    });
                };
                const observer = new MutationObserver(observeFeedback);
                observer.observe(document.body, {
                  childList: true,
                  subtree: true,
                  characterData: true,
                });
                let receivedAt = 0;
                // Timing adapter only: every request executes immediately in the
                // real worker. Retain, then deliver the identical response object.
                (chrome.runtime.sendMessage as any) = (...args: any[]) => {
                  const [message, callback] = args;
                  if (
                    message?.type === 'CONTROLLER_ACTION' &&
                    JSON.stringify(message.data?.methods) ===
                      JSON.stringify(['wallet', 'saveTokenInfo']) &&
                    typeof callback === 'function' &&
                    evidence.forwardedSaves === 0
                  ) {
                    evidence.forwardedSaves += 1;
                    return original.call(
                      chrome.runtime,
                      message,
                      (response) => {
                        evidence.genuineReplyReceived = true;
                        evidence.transportError =
                          chrome.runtime.lastError?.message || null;
                        evidence.controllerError = !!(
                          response?.error ||
                          (response?.success === false &&
                            Object.prototype.hasOwnProperty.call(
                              response,
                              'error'
                            ))
                        );
                        if (evidence.transportError) {
                          callback(response);
                          return;
                        }
                        receivedAt = performance.now();
                        held = () => callback(response);
                      }
                    );
                  }
                  return (original as any).apply(chrome.runtime, args);
                };
                (window as any).__sptImportReply = {
                  snapshot: () => {
                    observeFeedback();
                    return { ...evidence, held: !!held };
                  },
                  release: () => {
                    if (!held) throw new Error('No genuine save callback held');
                    evidence.heldForMs = performance.now() - receivedAt;
                    const callback = held;
                    held = undefined;
                    chrome.runtime.sendMessage = original;
                    evidence.released = true;
                    callback();
                  },
                };
              });
              await page
                .getByRole('button', {
                  name: `Import ${SPT_SYMBOL} token`,
                  exact: true,
                })
                .click();
              await expect
                .poll(() =>
                  page.evaluate(() =>
                    (window as any).__sptImportReply.snapshot()
                  )
                )
                .toMatchObject({
                  forwardedSaves: 1,
                  genuineReplyReceived: true,
                  transportError: null,
                  controllerError: false,
                  held: true,
                  released: false,
                });
              const saved = await projection();
              projections.push(saved);
              expect(saved.tokens).toEqual([
                { accountId: 0, guids: [SPT_GUID] },
                { accountId: 1, guids: [] },
              ]);
              if (view === 'departed') {
                await page
                  .getByRole('button', { name: 'Back', exact: true })
                  .click();
                await wallet!.ensureOnHome();
                await select(1);
                await expect(selectedLabel).toContainText(secondLabel);
              }
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        await wallet.step(
          view === 'current'
            ? 'deliver the unchanged reply and observe genuine current-view success feedback'
            : 'deliver the unchanged reply without stale success feedback or sibling token state',
          async (capture) => {
            try {
              await page.evaluate(() =>
                (window as any).__sptImportReply.release()
              );
              // Allow the ordinary render turn, then inspect all observations
              // without retrying away transient stale feedback. A separate
              // positive control verifies the current view's exact status text.
              await page.waitForTimeout(300);
              if (view === 'current')
                await expect(
                  page
                    .getByRole('status')
                    .getByText(successMessage, { exact: true })
                ).toBeVisible();
              delivery = await page.evaluate(() =>
                (window as any).__sptImportReply.snapshot()
              );
              expect(delivery).toMatchObject({ released: true, held: false });
              expect((delivery as any).heldForMs).toBeLessThan(9_000);
              if (view === 'current') {
                expect((delivery as any).observedFeedbackMessages).toContain(
                  successMessage
                );
              } else {
                expect(
                  (delivery as any).observedFeedbackMessages
                ).not.toContain(successMessage);
                await expect(selectedLabel).toContainText(secondLabel);
              }
              const current = await projection();
              projections.push(current);
              expect(current).toEqual({
                selectedId: view === 'current' ? 0 : 1,
                selectedType: 'HDAccount',
                chainId: 5700,
                tokens: [
                  { accountId: 0, guids: [SPT_GUID] },
                  { accountId: 1, guids: [] },
                ],
              });
              expect(routes!.deniedWrites).toEqual([]);
            } finally {
              if (!page.isClosed()) await capture(page);
            }
          }
        );
        status = 'passed';
      } finally {
        try {
          if (wallet && !wallet.page.isClosed())
            delivery = await wallet.page.evaluate(() =>
              (window as any).__sptImportReply?.snapshot()
            );
          await info.attach('runtime-and-import-feedback-evidence', {
            body: JSON.stringify(
              {
                ...runtime,
                view,
                testSourceSha256: createHash('sha256')
                  .update(fs.readFileSync(__filename))
                  .digest('hex'),
                syntheticHttpOnly: true,
                controllerStateReplaced: false,
                controllerResultReplaced: false,
                genuineReplyDeliveryDelayed: !!(
                  (delivery as any)?.genuineReplyReceived &&
                  !(delivery as any)?.transportError
                ),
                delivery,
                publicProjections: projections,
                deniedWrites: routes?.deniedWrites ?? [],
                proxyDeniedConnections: server.blocked.length,
              },
              null,
              2
            ),
            contentType: 'application/json',
          });
        } finally {
          try {
            await wallet?.dispose(status);
          } finally {
            await server.close();
            Object.assign(E2E_CONFIG, before);
          }
        }
      }
    }
  );
});
