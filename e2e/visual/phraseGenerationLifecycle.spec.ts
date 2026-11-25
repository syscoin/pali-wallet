import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import { Mnemonic } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';

// DOM traces would retain freshly generated phrase text even with screenshot
// masking. Only counts leave this disposable document; no wallet is created.
test.use({ trace: 'off' });

(['pending', 'older', 'healthy'] as const).forEach((mode) => {
  test(`phrase generation ${mode} preserves the selected word count and its acknowledgement`, async ({}, info) => {
    test.setTimeout(90_000);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(
      path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')
    ).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    const before = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, { rpcUrl: server.url });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let delivery: any;
    const observations: Record<string, unknown> = {};
    try {
      wallet = await PaliWallet.launch(`phrase-generation-${mode}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      const page = wallet.page;
      const words = page.locator('div.select-none > p');
      const checkbox = page.getByRole('checkbox');
      const next = page.locator('#unlock-btn');
      const generate = page.getByRole('button', {
        name: en.buttons.generate,
        exact: true,
      });
      await wallet.step(
        'open ordinary password setup without creating a wallet',
        async (capture) => {
          try {
            await page.locator('#unlock-btn').click();
            await page
              .locator('#create-password')
              .fill('PhrasePreviewSynthetic!2026');
            await page
              .locator('#confirm-password')
              .fill('PhrasePreviewSynthetic!2026');
            await expect(page.locator('#create-password-action')).toBeEnabled();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        'hide generated phrase presentation and observe genuine initial generation by count only',
        async (capture) => {
          try {
            await page.addStyleTag({
              content:
                'div.select-none > p { -webkit-text-security: disc !important; }',
            });
            await page.evaluate(() => {
              const redact = () => {
                document.querySelectorAll('div.select-none').forEach((node) => {
                  // Presentation/accessibility redaction only. Neither the
                  // phrase content nor any application/controller data changes.
                  node.setAttribute('aria-hidden', 'true');
                });
              };
              const observer = new MutationObserver(redact);
              observer.observe(document.body, {
                childList: true,
                subtree: true,
              });
              redact();
              const original = chrome.runtime.sendMessage;
              let armCount: number | null = null;
              let held: (() => void) | undefined;
              let receivedAt = 0;
              const evidence = {
                requestedCounts: [] as number[],
                deliveredCounts: [] as number[],
                heldResponseCount: null as number | null,
                transportError: false,
                controllerError: false,
                released: false,
                heldForMs: 0,
                walletCreationRequested: false,
              };
              (chrome.runtime.sendMessage as any) = (...args: any[]) => {
                const [message, callback] = args;
                const methods = message?.data?.methods;
                if (
                  message?.type === 'CONTROLLER_ACTION' &&
                  methods?.[0] === 'wallet' &&
                  methods?.[1] === 'createWallet'
                )
                  evidence.walletCreationRequested = true;
                if (
                  message?.type !== 'CONTROLLER_ACTION' ||
                  JSON.stringify(methods) !==
                    JSON.stringify(['wallet', 'createNewSeed']) ||
                  typeof callback !== 'function'
                )
                  return (original as any).apply(chrome.runtime, args);
                const count = message.data.params[0];
                evidence.requestedCounts.push(count);
                const hold = armCount === count;
                if (hold) armCount = null;
                return original.call(chrome.runtime, message, (response) => {
                  evidence.transportError = !!chrome.runtime.lastError;
                  evidence.controllerError = !!response?.error;
                  const actualCount =
                    typeof response === 'string'
                      ? response.trim().split(/\s+/).length
                      : 0;
                  const deliver = () => {
                    evidence.deliveredCounts.push(actualCount);
                    callback(response); // identical genuine response, never replaced
                  };
                  if (
                    !hold ||
                    evidence.transportError ||
                    evidence.controllerError
                  )
                    return deliver();
                  evidence.heldResponseCount = actualCount;
                  receivedAt = performance.now();
                  held = deliver;
                });
              };
              (window as any).__phraseGeneration = {
                arm: (count: number) => {
                  armCount = count;
                },
                snapshot: () => ({ ...evidence, held: !!held }),
                release: () => {
                  if (!held)
                    throw new Error('No genuine generation reply held');
                  const callback = held;
                  held = undefined;
                  evidence.heldForMs = performance.now() - receivedAt;
                  evidence.released = true;
                  callback();
                },
                cleanup: () => {
                  held?.();
                  held = undefined;
                  chrome.runtime.sendMessage = original;
                  observer.disconnect();
                },
              };
            });
            await page.locator('#create-password-action').click();
            await expect(page).toHaveURL(/#\/phrase$/);
            await expect(checkbox).toBeEnabled();
            await page
              .getByRole('button', {
                name: en.import.showSeedPhrase,
                exact: true,
              })
              .click();
            await expect(words).toHaveCount(12);
            await expect(page.getByRole('combobox')).toHaveAccessibleName(
              'Words'
            );
            observations.wordCountAccessibleName = 'Words';
            await expect(checkbox).not.toBeChecked();
            await expect(next).toBeDisabled();
            observations.initialCount = await words.count();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        `exercise ${mode} generation using genuine worker replies and normal word-count controls`,
        async (capture) => {
          try {
            if (mode !== 'healthy') {
              await page.evaluate(
                (count) => (window as any).__phraseGeneration.arm(count),
                mode === 'pending' ? 24 : 12
              );
              if (mode === 'older') await generate.click();
            }
            await page.getByRole('combobox').selectOption('24');
            await expect(page.getByRole('combobox')).toHaveAccessibleName(
              'Words'
            );
            if (mode !== 'healthy')
              await expect
                .poll(() =>
                  page.evaluate(() =>
                    (window as any).__phraseGeneration.snapshot()
                  )
                )
                .toMatchObject({
                  held: true,
                  heldResponseCount: mode === 'pending' ? 24 : 12,
                  transportError: false,
                  controllerError: false,
                });
            if (mode === 'pending') {
              if (await checkbox.isEnabled()) await checkbox.check();
              const enabled = await next.isEnabled();
              observations.nextEnabledWhilePending = enabled;
              expect(enabled).toBe(false);
              await page.evaluate(() =>
                (window as any).__phraseGeneration.release()
              );
            }
            await expect(checkbox).toBeEnabled();
            // Completed generation resets the explicit reveal. Wait for that
            // reset before counting, without accepting the concealed mask as
            // a generated phrase or changing the held-response timing checks.
            await page
              .getByRole('button', {
                name: en.import.showSeedPhrase,
                exact: true,
              })
              .click();
            await expect(words).toHaveCount(24);
            if (mode === 'older') {
              await page.evaluate(() =>
                (window as any).__phraseGeneration.release()
              );
              await page.waitForTimeout(100);
              // Immediate count snapshot cannot poll through a transient stale
              // render or wait for unrelated work to heal the wrong response.
              observations.countAfterOlderReply = await words.count();
              expect(observations.countAfterOlderReply).toBe(24);
            }
            await expect(checkbox).not.toBeChecked();
            await expect(next).toBeDisabled();
            await checkbox.check();
            await expect(next).toBeEnabled();
            observations.settledCount = await words.count();
            observations.acknowledgedCurrentCount = true;
            // Do not advance to word confirmation or dispatch createWallet.
            delivery = await page.evaluate(() =>
              (window as any).__phraseGeneration.snapshot()
            );
            expect(delivery.walletCreationRequested).toBe(false);
            expect(routes!.deniedWrites).toEqual([]);
            if (mode !== 'healthy')
              expect(delivery.heldForMs).toBeLessThan(9_000);
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
            (window as any).__phraseGeneration?.snapshot()
          );
        await info.attach('runtime-and-generation-count-evidence', {
          body: JSON.stringify(
            {
              ...runtime,
              mode,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(__filename))
                .digest('hex'),
              controllerStateReplaced: false,
              controllerResultsReplaced: false,
              timingOnlyGenuineCallbackDeliveryHold: mode !== 'healthy',
              presentationOnlySeedRedaction: {
                textSecurity: true,
                ariaHiddenSeedContainer: true,
                traceDisabled: true,
              },
              seedPresentationLayoutOrAccessibilityQualification: false,
              phraseTextExported: false,
              observations,
              delivery,
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
          if (wallet && !wallet.page.isClosed())
            await wallet.page.evaluate(() =>
              (window as any).__phraseGeneration?.cleanup()
            );
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, before);
        }
      }
    }
  });
});

test('the packaged worker preserves BIP39 entropy and refuses an unavailable random source', async () => {
  const server = await startUtxoFixtureServer();
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('phrase-generation-entropy', {
      offlineHttpProxy: server.url,
      recordVideo: false,
    });
    const { page, context, extensionId } = wallet;
    await expect(page.locator('#unlock-btn')).toBeVisible();
    const worker = context
      .serviceWorkers()
      .find((entry) => new URL(entry.url()).host === extensionId);
    if (!worker) throw new Error('Packaged extension worker is unavailable');

    // Compare inside the extension page so even an unexpected random phrase
    // cannot enter screenshots, traces, assertion messages or test reports.
    const requestPhrase = (wordCount: number, expected?: string) =>
      page.evaluate(
        async ({ count, expectedPhrase }) => {
          const reply = await chrome.runtime.sendMessage({
            type: 'CONTROLLER_ACTION',
            data: { methods: ['wallet', 'createNewSeed'], params: [count] },
          });
          return {
            matches: typeof reply === 'string' && reply === expectedPhrase,
            refused:
              reply?.success === false && typeof reply.error === 'string',
          };
        },
        { count: wordCount, expectedPhrase: expected }
      );

    const setEntropySource = (fixture: number[] | 'throwing' | 'missing') =>
      worker.evaluateHandle((source) => {
        const lengths: number[] = [];
        const fill = (view: Uint8Array) => {
          lengths.push(view.byteLength);
          if (!Array.isArray(source))
            throw new Error('Test entropy unavailable');
          view.set(source);
          return view;
        };
        Object.defineProperty(crypto, 'getRandomValues', {
          configurable: true,
          value: source === 'missing' ? undefined : fill,
        });
        return lengths;
      }, fixture);

    for (const count of [12, 24]) {
      const byteLength = count === 12 ? 16 : 32;
      await wallet.step(
        `preserve each input byte for a ${count}-word phrase`,
        async () => {
          for (const offset of [0, 1]) {
            const bytes = Array.from(
              { length: byteLength },
              (_, i) => (17 * i + offset) & 255
            );
            const draws = await setEntropySource(bytes);
            // Ethers independently encodes every byte and the checksum; the
            // packaged controller uses bitcoinjs/bip39 to produce its result.
            const expected = Mnemonic.fromEntropy(
              Uint8Array.from(bytes)
            ).phrase;
            expect(await requestPhrase(count, expected)).toEqual({
              matches: true,
              refused: false,
            });
            expect(await draws.jsonValue()).toEqual([byteLength]);
            await draws.dispose();
          }
        }
      );
      await wallet.step(
        `refuse a ${count}-word phrase if worker entropy fails`,
        async () => {
          for (const mode of ['throwing', 'missing'] as const) {
            const draws = await setEntropySource(mode);
            expect((await requestPhrase(count)).refused).toBe(true);
            expect(await draws.jsonValue()).toEqual(
              mode === 'throwing' ? [byteLength] : []
            );
            await draws.dispose();
          }
        }
      );
    }
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
    }
  }
});
