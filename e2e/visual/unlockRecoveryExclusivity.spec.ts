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

const PASSWORD = 'UnlockRecoverySyntheticOnly!2026';
const WRONG_PASSWORD = 'WrongUnlockRecoverySyntheticOnly!2026';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const unlocked = await chrome.runtime.sendMessage({
      type: 'CONTROLLER_ACTION',
      data: { methods: ['wallet', 'isUnlocked'], params: [] },
    });
    if (typeof unlocked !== 'boolean')
      throw new Error('Expected the actual boolean wallet lock state');
    const selected = state.vault.activeAccount;
    return {
      unlocked,
      account: {
        id: selected.id,
        type: selected.type,
        address: state.vault.accounts[selected.type]?.[selected.id]?.address,
      },
      network: {
        chainId: state.vault.activeNetwork.chainId,
        kind: state.vault.activeNetwork.kind,
      },
    };
  });

test('pending Unlock excludes recovery until the genuine failure is delivered', async ({}, info) => {
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
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const fixture = createUtxoFixture();
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const pageErrors: string[] = [];
  const observations: Record<string, unknown> = {};
  let delivery: unknown;
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: PASSWORD,
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('unlock-recovery-exclusivity', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const page = wallet.page;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const oneAppPage = () => {
      const appPages = wallet!.context
        .pages()
        .filter((candidate) => candidate.url().includes('/app.html'));
      expect(appPages).toEqual([page]);
    };
    const snapshotDelivery = () =>
      page.evaluate(() => (window as any).__unlockRecoveryReply.snapshot());
    const locked = async () => {
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.locator('#login #password')).toBeVisible();
      await expect(page.locator('#unlock-btn')).toBeEnabled();
      await expect(page.locator('#import-wallet-link')).toBeEnabled();
      expect((await publicState(page)).unlocked).toBe(false);
    };
    await wallet.step(
      'unlock-recovery: prepare one ordinary locked wallet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('0.001');
        observations.original = await publicState(page);
        expect((observations.original as any).account.address).toBe(
          fixture.userAddress
        );
        await page.locator('#general-settings-button').click();
        await page.getByText(en.generalMenu.lock, { exact: true }).click();
        await locked();
        oneAppPage();
      }
    );
    await wallet.step(
      'unlock-recovery: hold only the real wrong-password reply',
      async () => {
        await page.evaluate((wrongPassword) => {
          const original = chrome.runtime.sendMessage;
          let held: (() => void) | undefined;
          let receivedAt = 0;
          const evidence = {
            forwardedUnlocks: 0,
            recoveryBegins: 0,
            setupOrRecoveryCommits: 0,
            genuineFailureReceived: false,
            transportError: false,
            released: false,
            heldForMs: 0,
          };
          // The real worker executes immediately. Hold only its unchanged domain
          // failure callback; never replace the controller, KDF, request or result.
          (chrome.runtime.sendMessage as any) = (...args: any[]) => {
            const [message, callback] = args;
            const methods = message?.data?.methods;
            if (message?.type === 'CONTROLLER_ACTION') {
              if (
                JSON.stringify(methods) ===
                JSON.stringify(['wallet', 'beginWalletRecovery'])
              )
                evidence.recoveryBegins += 1;
              if (
                methods?.[0] === 'wallet' &&
                ['createWallet', 'recoverWalletFromSeed'].includes(methods[1])
              )
                evidence.setupOrRecoveryCommits += 1;
              if (
                JSON.stringify(methods) ===
                JSON.stringify(['wallet', 'unlockFromController'])
              )
                evidence.forwardedUnlocks += 1;
            }
            if (
              message?.type === 'CONTROLLER_ACTION' &&
              JSON.stringify(methods) ===
                JSON.stringify(['wallet', 'unlockFromController']) &&
              JSON.stringify(message.data.params) ===
                JSON.stringify([wrongPassword]) &&
              typeof callback === 'function' &&
              evidence.forwardedUnlocks === 1
            ) {
              return original.call(chrome.runtime, message, (response) => {
                evidence.transportError = !!chrome.runtime.lastError;
                const error = response?.error;
                const text = typeof error === 'string' ? error : error?.message;
                evidence.genuineFailureReceived =
                  response?.success === false && text === 'Invalid password';
                if (
                  evidence.transportError ||
                  !evidence.genuineFailureReceived
                ) {
                  callback(response);
                  return;
                }
                receivedAt = performance.now();
                held = () => callback(response);
              });
            }
            return (original as any).apply(chrome.runtime, args);
          };
          (window as any).__unlockRecoveryReply = {
            snapshot: () => ({ ...evidence, held: !!held }),
            release: () => {
              if (!held) throw new Error('No genuine unlock rejection is held');
              const deliver = held;
              held = undefined;
              evidence.heldForMs = performance.now() - receivedAt;
              evidence.released = true;
              deliver();
            },
            cleanup: () => {
              chrome.runtime.sendMessage = original;
              held?.();
              held = undefined;
            },
          };
        }, WRONG_PASSWORD);
        await page.locator('#login #password').fill(WRONG_PASSWORD);
        await page.locator('#unlock-btn').click();
        await expect
          .poll(async () => (await snapshotDelivery()).held)
          .toBe(true);
        expect(await snapshotDelivery()).toMatchObject({
          forwardedUnlocks: 1,
          recoveryBegins: 0,
          setupOrRecoveryCommits: 0,
          genuineFailureReceived: true,
          transportError: false,
          released: false,
        });
        expect((await publicState(page)).unlocked).toBe(false);
        observations.pending = await publicState(page);
        await expect(page.locator('#unlock-btn')).toBeDisabled();
      }
    );
    await wallet.step(
      'unlock-recovery: active progress stays visible and duplicate actions stay blocked',
      async () => {
        for (const size of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await page.setViewportSize(size);
          const unlock = page.locator('#unlock-btn');
          await expect(unlock).toHaveAttribute('aria-busy', 'true');
          const spinner = unlock.locator(':scope > svg');
          await expect(spinner).toHaveCount(1);
          await spinner.evaluate(async (element) => {
            await document.fonts.ready;
            const animations = new Set<Animation>();
            for (
              let node: Element | null = element;
              node;
              node = node.parentElement
            ) {
              for (const animation of node.getAnimations()) {
                if (
                  animation.playState === 'running' &&
                  Number.isFinite(
                    Number(animation.effect?.getComputedTiming().endTime)
                  )
                ) {
                  animations.add(animation);
                }
              }
            }
            await Promise.all(
              [...animations].map((animation) =>
                animation.finished.catch(() => undefined)
              )
            );
          });
          const progress = await spinner.evaluate((element) => {
            const style = getComputedStyle(element);
            const button = element.closest('button')!;
            const background = getComputedStyle(button);
            const opacity = [];
            const effects = [];
            for (
              let node: Element | null = element;
              node;
              node = node.parentElement
            ) {
              const current = getComputedStyle(node);
              opacity.push(Number(current.opacity));
              effects.push(
                current.filter,
                current.backdropFilter,
                current.mixBlendMode
              );
            }
            const luminance = (color: string) => {
              const values = color.match(/[\d.]+/g)!.map(Number);
              if (values.length !== 3)
                throw new Error('Expected opaque RGB color');
              return values.reduce((sum, value, index) => {
                const scaled = value / 255;
                return (
                  sum +
                  [0.2126, 0.7152, 0.0722][index] *
                    (scaled <= 0.04045
                      ? scaled / 12.92
                      : ((scaled + 0.055) / 1.055) ** 2.4)
                );
              }, 0);
            };
            const fg = luminance(style.color);
            const bg = luminance(background.backgroundColor);
            return {
              ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
              opacity,
              effects,
              backgroundImage: background.backgroundImage,
              layoutWidth: parseFloat(style.width),
              layoutHeight: parseFloat(style.height),
              bounds: (() => {
                const rect = element.getBoundingClientRect();
                return {
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  bottom: rect.bottom,
                  viewportWidth: innerWidth,
                  viewportHeight: innerHeight,
                };
              })(),
              animation: style.animationName,
            };
          });
          // This is an active progress signal on a disabled control. Opaque
          // paint and ancestors make the solid-color calculation valid.
          expect(progress.opacity.every((opacity) => opacity === 1)).toBe(true);
          expect(
            progress.effects.every((effect) =>
              ['none', 'normal', ''].includes(effect)
            )
          ).toBe(true);
          expect(progress.backgroundImage).toBe('none');
          expect(progress.ratio).toBeGreaterThanOrEqual(3);
          expect(progress.layoutWidth).toBe(24);
          expect(progress.layoutHeight).toBe(
            Number(await spinner.getAttribute('height'))
          );
          expect(progress.bounds.left).toBeGreaterThanOrEqual(0);
          expect(progress.bounds.top).toBeGreaterThanOrEqual(0);
          expect(progress.bounds.right).toBeLessThanOrEqual(
            progress.bounds.viewportWidth
          );
          expect(progress.bounds.bottom).toBeLessThanOrEqual(
            progress.bounds.viewportHeight
          );
          expect(progress.animation).not.toBe('none');
          await info.attach(`unlock-busy-progress-${size.width}`, {
            contentType: 'application/json',
            body: JSON.stringify(progress),
          });
          const box = await unlock.boundingBox();
          expect(box).not.toBeNull();
          await page.mouse.click(
            box!.x + box!.width / 2,
            box!.y + box!.height / 2
          );
          await page.locator('#login #password').press('Enter');
          await expect(unlock).toBeDisabled();
          await expect(page.locator('#erase-wallet-link')).toBeDisabled();
          expect(await snapshotDelivery()).toMatchObject({
            held: true,
            forwardedUnlocks: 1,
            recoveryBegins: 0,
            setupOrRecoveryCommits: 0,
          });
          const current = await publicState(page);
          expect(current.unlocked).toBe(false);
          expect(current.account).toEqual(
            (observations.original as any).account
          );
          expect(current.network).toEqual(
            (observations.original as any).network
          );
          await info.attach(`unlock-progress-${size.width}`, {
            contentType: 'image/png',
            body: await page.screenshot({
              mask: [page.locator('input')],
            }),
          });
        }
      }
    );
    await wallet.step(
      'unlock-recovery: pending native recovery action stays inert',
      async () => {
        const recovery = page.locator('#import-wallet-link');
        await expect(recovery).toBeVisible();
        expect(await recovery.evaluate((element) => element.tagName)).toBe(
          'BUTTON'
        );
        await expect(recovery).toBeDisabled();
        const box = await recovery.boundingBox();
        expect(box).not.toBeNull();
        // A physical pointer activation tests native disabled behavior without
        // bypassing actionability or dispatching a synthetic DOM click.
        await page.mouse.click(
          box!.x + box!.width / 2,
          box!.y + box!.height / 2
        );
        await expect(page.locator('#confirm-import-btn')).toHaveCount(0);
        await expect(page).toHaveURL(/#\/$/);
        expect(await snapshotDelivery()).toMatchObject({
          held: true,
          forwardedUnlocks: 1,
          recoveryBegins: 0,
        });
        oneAppPage();
      }
    );
    await wallet.step(
      'unlock-recovery: deliver the genuine failure and re-enable recovery',
      async () => {
        await page.evaluate(() =>
          (window as any).__unlockRecoveryReply.release()
        );
        await expect(
          page.locator('#login').getByText('Invalid password', { exact: true })
        ).toBeVisible();
        await locked();
        expect(await snapshotDelivery()).toMatchObject({
          held: false,
          genuineFailureReceived: true,
          released: true,
          forwardedUnlocks: 1,
          recoveryBegins: 0,
        });
        observations.failed = await publicState(page);
      }
    );
    await wallet.step(
      'unlock-recovery: ordinary recovery reaches its real import form',
      async () => {
        await page.locator('#import-wallet-link').click();
        await expect(
          page.getByText(en.settings.recoveryLimitations, { exact: true })
        ).toBeVisible();
        await page.locator('#confirm-import-btn').click();
        await expect(page).toHaveURL(/#\/import$/);
        await expect(page.locator('#import-wallet-input')).toBeVisible();
        await expect(page.locator('#import-wallet-input')).toHaveValue('');
        await expect(page.locator('#import-wallet-action')).toBeDisabled();
        expect((await publicState(page)).unlocked).toBe(false);
        expect(await snapshotDelivery()).toMatchObject({
          forwardedUnlocks: 1,
          recoveryBegins: 1,
          setupOrRecoveryCommits: 0,
        });
        observations.recovery = await publicState(page);
        oneAppPage();
      }
    );
    await wallet.step(
      'unlock-recovery: browser Back permits a normal successful unlock',
      async () => {
        await page.goBack();
        await locked();
        await page.locator('#login #password').fill(PASSWORD);
        await page.locator('#unlock-btn').click();
        await expect(page).toHaveURL(/#\/home$/);
        await expect(page.locator('#home-balance')).toHaveText('0.001');
        const current = await publicState(page);
        expect(current.unlocked).toBe(true);
        expect(current.account).toEqual((observations.original as any).account);
        expect(current.network).toEqual((observations.original as any).network);
        expect(await snapshotDelivery()).toMatchObject({
          forwardedUnlocks: 2,
          recoveryBegins: 1,
          setupOrRecoveryCommits: 0,
          held: false,
        });
        expect(routes!.deniedWrites).toEqual([]);
        expect(routes!.syntheticBroadcasts).toEqual([]);
        expect(pageErrors).toEqual([]);
        observations.success = current;
        oneAppPage();
        expect(extensionEvidence()).toEqual(runtime);
      }
    );
    delivery = await snapshotDelivery();
    status = 'passed';
  } finally {
    try {
      await info.attach('unlock-recovery-exclusivity-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          runtime,
          status,
          testSourceSha256,
          observations,
          delivery,
          fixtureReads: routes?.reads || [],
          deniedWrites: routes?.deniedWrites || [],
          deniedUnknown: routes?.deniedUnknown || [],
          syntheticBroadcasts: routes?.syntheticBroadcasts || [],
          proxyDeniedConnections: server?.blocked.length || 0,
          pageErrors,
          singleAppDocument: true,
          genuineReplyDeliveryOnly: true,
          controllerOrKdfReplaced: false,
          syntheticReplyManufactured: false,
          inFlightKdfRaceClaimed: false,
          recoveryCommitted: false,
          signaturesOrBroadcastsRequested: false,
        }),
      });
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      try {
        if (wallet && !wallet.page.isClosed())
          await wallet.page.evaluate(() =>
            (window as any).__unlockRecoveryReply?.cleanup()
          );
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
  }
});
