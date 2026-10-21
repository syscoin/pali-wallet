import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

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

// Published BIP39 examples only, in disposable profiles. No wallet is created.
const PHRASE_A = UTXO_FIXTURE_SEED;
const PHRASE_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

(['unchanged', 'edited', 'cleared', 'newer submission'] as const).forEach(
  (mode) => {
    test(`seed import final validation follows the current input: ${mode}`, async ({}, info) => {
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
      const server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, { rpcUrl: server.url });
      let wallet: PaliWallet | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      let delivery: any;
      const observations: Record<string, unknown> = {};
      try {
        wallet = await PaliWallet.launch(
          `import-input-revision-${mode.replace(/ /g, '-')}`,
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
        const input = page.locator('#import-wallet-input');
        const submit = page.locator('#import-wallet-action');
        const snapshot = () =>
          page.evaluate(() => (window as any).__importValidation.snapshot());
        const release = () =>
          page.evaluate(async () => {
            (window as any).__importValidation.release();
            // The production continuation has no further await before navigation.
            // Let that continuation and its React render commit before checking it.
            await new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done()))
            );
          });

        await wallet.step(
          'open ordinary import and observe real seed-validation replies',
          async () => {
            await page.locator('#import-wallet-link').click();
            await expect(input).toBeVisible();
            await page.addStyleTag({
              content:
                '#import-wallet-input { -webkit-text-security: disc !important; }',
            });
            await page.evaluate(
              ({ phraseA, phraseB }) => {
                const original = chrome.runtime.sendMessage;
                let armed = false;
                let afterArmARequests = 0;
                let held: (() => void) | undefined;
                let receivedAt = 0;
                const evidence = {
                  requests: [] as Array<{
                    label: string;
                    sequence: number;
                    received: boolean;
                    delivered: boolean;
                    valid: boolean | null;
                    held: boolean;
                  }>,
                  forbiddenCalls: [] as string[],
                  transportError: false,
                  controllerError: false,
                  heldForMs: 0,
                  released: false,
                };
                (chrome.runtime.sendMessage as any) = (...args: any[]) => {
                  const [message, callback] = args;
                  const methods = message?.data?.methods;
                  if (
                    message?.type === 'CONTROLLER_ACTION' &&
                    /^(?:createWallet|recoverWalletFromSeed|createNewSeed|forgetWallet|export.*|getPrivateKey|getSeed)$/.test(
                      methods?.[1] || ''
                    )
                  )
                    evidence.forbiddenCalls.push(methods.join('.'));
                  if (
                    message?.type !== 'CONTROLLER_ACTION' ||
                    JSON.stringify(methods) !==
                      JSON.stringify(['wallet', 'isSeedValid']) ||
                    typeof callback !== 'function'
                  )
                    return (original as any).apply(chrome.runtime, args);
                  const label =
                    message.data.params[0] === phraseA
                      ? 'A'
                      : message.data.params[0] === phraseB
                      ? 'B'
                      : 'other';
                  // At this exact product call site, clicking Submit first runs
                  // AntD's validator, then onFinish runs the final controller check.
                  // Only the second genuine matching response is held.
                  if (armed && label === 'A') afterArmARequests += 1;
                  const hold =
                    armed && label === 'A' && afterArmARequests === 2;
                  if (hold) armed = false;
                  const row = {
                    label,
                    sequence: afterArmARequests,
                    received: false,
                    delivered: false,
                    valid: null as boolean | null,
                    held: hold,
                  };
                  evidence.requests.push(row);
                  return original.call(chrome.runtime, message, (response) => {
                    row.received = true;
                    row.valid = typeof response === 'boolean' ? response : null;
                    const transportError = Boolean(chrome.runtime.lastError);
                    const controllerError = Boolean(response?.error);
                    evidence.transportError ||= transportError;
                    evidence.controllerError ||= controllerError;
                    const deliver = () => {
                      row.delivered = true;
                      callback(response); // unchanged actual worker response
                    };
                    if (!hold || transportError || controllerError)
                      return deliver();
                    receivedAt = performance.now();
                    held = deliver;
                  });
                };
                (window as any).__importValidation = {
                  arm: () => {
                    if (held)
                      throw new Error('Prior validation is already held');
                    armed = true;
                    afterArmARequests = 0;
                  },
                  snapshot: () => ({
                    ...evidence,
                    requests: evidence.requests.map((row) => ({ ...row })),
                    held: Boolean(held),
                    afterArmARequests,
                  }),
                  release: () => {
                    if (!held)
                      throw new Error(
                        'No genuine final validation response held'
                      );
                    const deliver = held;
                    held = undefined;
                    evidence.heldForMs = performance.now() - receivedAt;
                    evidence.released = true;
                    deliver();
                  },
                  cleanup: () => {
                    const deliver = held;
                    held = undefined;
                    deliver?.();
                    chrome.runtime.sendMessage = original;
                  },
                };
              },
              { phraseA: PHRASE_A, phraseB: PHRASE_B }
            );
            await input.fill(PHRASE_A);
            await expect(submit).toBeEnabled();
            await expect.poll(snapshot).toMatchObject({
              requests: [
                {
                  label: 'A',
                  received: true,
                  delivered: true,
                  valid: true,
                  held: false,
                },
              ],
              held: false,
              forbiddenCalls: [],
            });
          }
        );

        await wallet.step(
          'hold only the real final validation after normal Submit',
          async () => {
            await page.evaluate(() => (window as any).__importValidation.arm());
            await submit.click();
            await expect.poll(snapshot).toMatchObject({
              held: true,
              afterArmARequests: 2,
              transportError: false,
              controllerError: false,
            });
            const held = (await snapshot()).requests.filter(
              (row: any) => row.held
            );
            expect(held).toEqual([
              {
                label: 'A',
                sequence: 2,
                received: true,
                delivered: false,
                valid: true,
                held: true,
              },
            ]);
            await expect(page).toHaveURL(/#\/import$/);
            await expect(input).toHaveValue(PHRASE_A);
          }
        );

        await wallet.step(
          `exercise ${mode} input while validation is pending`,
          async () => {
            if (mode === 'unchanged') {
              await release();
              await expect(page).toHaveURL(/#\/create-password-import$/);
              await expect(page.locator('#create-password')).toBeVisible();
              observations.unchangedAdvances = true;
            } else {
              await input.fill(mode === 'cleared' ? '' : PHRASE_B);
              if (mode === 'cleared') await expect(submit).toBeDisabled();
              else {
                await expect(submit).toBeEnabled();
                await expect
                  .poll(async () =>
                    (
                      await snapshot()
                    ).requests.some(
                      (row: any) =>
                        row.label === 'B' &&
                        row.received &&
                        row.delivered &&
                        row.valid === true
                    )
                  )
                  .toBe(true);
              }
              if (mode === 'newer submission') {
                // This must admit B while the old A request still awaits delivery.
                await submit.click();
                await expect(page).toHaveURL(/#\/create-password-import$/);
                await expect(page.locator('#create-password')).toBeVisible();
                observations.newerSubmissionAdvancesBeforeOldReply = true;
                await release();
                await expect(page).toHaveURL(/#\/create-password-import$/);
                await expect(page.locator('#create-password')).toBeVisible();
              } else {
                await release();
                await expect(page).toHaveURL(/#\/import$/);
                await expect(input).toHaveValue(
                  mode === 'cleared' ? '' : PHRASE_B
                );
                observations.staleReplyDidNotAdvance = true;
                if (mode === 'edited') {
                  await submit.click();
                  await expect(page).toHaveURL(/#\/create-password-import$/);
                  await expect(page.locator('#create-password')).toBeVisible();
                  observations.editedRetryAdvances = true;
                }
              }
            }
            delivery = await snapshot();
            expect(delivery.held).toBe(false);
            expect(delivery.released).toBe(true);
            expect(delivery.heldForMs).toBeLessThan(9_000);
            expect(delivery.transportError).toBe(false);
            expect(delivery.controllerError).toBe(false);
            expect(delivery.forbiddenCalls).toEqual([]);
            expect(routes!.deniedWrites).toEqual([]);
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
          if (wallet && !wallet.page.isClosed())
            delivery = await wallet.page.evaluate(() =>
              (window as any).__importValidation?.snapshot()
            );
          await info.attach('import-input-revision-evidence', {
            contentType: 'application/json',
            body: JSON.stringify({
              status,
              mode,
              runtime,
              sourceHash,
              delivery,
              observations,
              deniedWrites: routes?.deniedWrites ?? [],
              proxyDeniedConnections: server.blocked.length,
              controllerStateReplaced: false,
              controllerResultReplaced: false,
              genuineCallbackDeliveryDelayedOnly: true,
              seedsArePublishedSyntheticExamples: true,
              privateContextInspected: false,
              exactPrivateDraftIdentityRequiresNativeTest: true,
              walletCreated: false,
              passwordSubmitted: false,
            }),
          });
        } finally {
          try {
            if (wallet && !wallet.page.isClosed())
              await wallet.page.evaluate(() =>
                (window as any).__importValidation?.cleanup()
              );
            await wallet?.dispose(status);
          } finally {
            await server.close();
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    });
  }
);
