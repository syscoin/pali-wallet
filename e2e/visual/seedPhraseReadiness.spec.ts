import { expect, test, type Locator, type Page } from '@playwright/test';
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
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';

// Generated-phrase readiness uses the fenced recordVideo:false launch option;
// default recording stays unchanged for every other journey.
// No diagnostic capture is permitted for this generated-phrase-only journey.
// Phrase/word controls, text, styles and their accessibility tree stay intact.
// Only public counts, booleans and pointer geometry leave the disposable page.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

// Locator assertions can attach a whole-page ARIA snapshot when their target
// disappears. Poll only scalar state here so failures never serialize words.
const readinessAssertionOptions = { timeout: 5_000 };
async function expectEnabled(locator: Locator, enabled = true) {
  await expect
    .poll(async () => {
      if ((await locator.count()) !== 1) return false;
      return (await locator.isEnabled(readinessAssertionOptions)) === enabled;
    }, readinessAssertionOptions)
    .toBe(true);
}
async function expectVisible(locator: Locator, visible = true) {
  await expect
    .poll(async () => {
      const count = await locator.count();
      if (count === 0) return !visible;
      if (count !== 1) return false;
      return (await locator.isVisible()) === visible;
    }, readinessAssertionOptions)
    .toBe(true);
}
async function expectFocused(locator: Locator) {
  await expect
    .poll(
      () =>
        locator.evaluateAll(
          (nodes) => nodes.length === 1 && nodes[0] === document.activeElement
        ),
      readinessAssertionOptions
    )
    .toBe(true);
}
async function expectPhraseRoute(page: Page) {
  await expect
    .poll(() => page.url(), readinessAssertionOptions)
    .toMatch(/#\/phrase$/);
}

async function countOnlyStep(
  wallet: PaliWallet,
  name: string,
  run: () => Promise<void>
) {
  const startedAt = Date.now();
  try {
    await test.step(name, run);
    wallet.summary.addStep({
      name,
      durationMs: Date.now() - startedAt,
      status: 'passed',
    });
  } catch (error) {
    wallet.summary.addStep({
      name,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      note: 'Readiness control assertion failed; phrase values are not exported.',
    });
    throw error;
  }
}

type Readiness = {
  available: number;
  correctOrder: boolean;
  selected: number;
  walletCreationRequests: number;
};

const snapshot = (page: Page): Promise<Readiness> =>
  page.evaluate(() => (window as any).__phraseReadiness.snapshot());

async function selectWord(
  page: Page,
  order: 'correct' | 'wrong',
  index: number
) {
  const point = await page.evaluate(
    ({ order: wantedOrder, index: wantedIndex }) =>
      (window as any).__phraseReadiness.wordPoint(wantedOrder, wantedIndex),
    { order, index }
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await snapshot(page)).selected)
    .toBe(index + 1);
}

async function returnLastWord(page: Page, selected: number) {
  const point = await page.evaluate(() =>
    (window as any).__phraseReadiness.returnPoint()
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await snapshot(page)).selected)
    .toBe(selected - 1);
}

async function expectIncomplete(page: Page) {
  const validate = page.getByRole('button', {
    name: en.buttons.validate,
    exact: true,
  });
  await expectEnabled(validate, false);
  const steps = await page.evaluate(() =>
    (window as any).__phraseReadiness.beginTabProbe()
  );
  // One complete bounded native tab traversal plus wraparound. The observer
  // returns no names/text from the generated-word buttons.
  expect(steps).toBeGreaterThan(0);
  expect(steps).toBeLessThanOrEqual(32);
  const focused: boolean[] = [];
  for (let index = 0; index < steps + 2; index += 1) {
    await page.keyboard.press('Tab');
    focused.push(
      await validate.evaluate((node) => node === document.activeElement)
    );
  }
  expect(focused.every((value) => value === false)).toBe(true);
  return { disabled: true, tabChecks: focused.length, validateFocused: false };
}

test('seed confirmation Validate is unavailable until every word is selected', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
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
  const observations: Record<string, unknown> = {};
  const previousNoCopyPrompt = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
  let contextClosed = false;
  // The installed runner also captures ARIA failure context independently of
  // trace/video/screenshot. Keep this flag until the private context is closed.
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
  try {
    wallet = await PaliWallet.launch('seed-phrase-readiness', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    wallet.context.once('close', () => {
      contextClosed = true;
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const page = wallet.page;
    const validate = page.getByRole('button', {
      name: en.buttons.validate,
      exact: true,
    });

    await countOnlyStep(
      wallet,
      'readiness open ordinary fresh password setup',
      async () => {
        await page.locator('#unlock-btn').click();
        await page.locator('#create-password').fill('ReadinessDisposable!2026');
        await page
          .locator('#confirm-password')
          .fill('ReadinessDisposable!2026');
        await expectEnabled(page.locator('#create-password-action'));
      }
    );

    await countOnlyStep(
      wallet,
      'readiness acknowledge genuine generated phrase without exporting it',
      async () => {
        await page.evaluate(() => {
          let phrase: string[] = [];
          let wrong: string[] = [];
          let selected: HTMLElement | undefined;
          let available: HTMLElement | undefined;
          let walletCreationRequests = 0;
          const original = chrome.runtime.sendMessage;
          (chrome.runtime.sendMessage as any) = (...args: any[]) => {
            const methods = args[0]?.data?.methods;
            if (
              args[0]?.type === 'CONTROLLER_ACTION' &&
              methods?.[0] === 'wallet' &&
              methods?.[1] === 'createWallet'
            )
              walletCreationRequests += 1;
            return (original as any).apply(chrome.runtime, args);
          };
          const buttons = (section: HTMLElement | undefined) =>
            Array.from(
              section?.querySelectorAll<HTMLButtonElement>('button.min-w-xs') ||
                []
            );
          const point = (button: HTMLButtonElement | undefined) => {
            if (!button)
              throw new Error('Expected generated-word control is absent');
            button.scrollIntoView({ block: 'center', inline: 'nearest' });
            const bounds = button.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            const y = bounds.top + bounds.height / 2;
            const hit = document.elementFromPoint(x, y);
            if (
              !bounds.width ||
              !bounds.height ||
              !(hit && button.contains(hit))
            )
              throw new Error('Generated-word pointer target is not available');
            return { x, y };
          };
          (window as any).__phraseReadiness = {
            remember: () => {
              phrase = Array.from(
                document.querySelectorAll('div.select-none > p')
              ).map((node) => node.textContent || '');
              if (
                phrase.length !== 12 ||
                phrase.some((word) => !word || word.includes('*'))
              )
                throw new Error('Expected genuine revealed twelve-word phrase');
              wrong = [...phrase];
              const other = wrong.findIndex((word) => word !== wrong[0]);
              if (other < 0)
                throw new Error('Expected distinct generated-word controls');
              [wrong[0], wrong[other]] = [wrong[other], wrong[0]];
              return {
                count: phrase.length,
                wrongOrderDiffers: wrong.some(
                  (word, index) => word !== phrase[index]
                ),
              };
            },
            enter: () => {
              available =
                document
                  .querySelector<HTMLButtonElement>('button.min-w-xs')
                  ?.closest('section') || undefined;
              selected = available?.previousElementSibling as
                | HTMLElement
                | undefined;
              if (
                !selected ||
                !available ||
                buttons(available).length !== 12 ||
                buttons(selected).length
              )
                throw new Error('Expected ordinary confirmation word sections');
            },
            wordPoint: (order: 'correct' | 'wrong', index: number) =>
              point(
                buttons(available).find(
                  (button) =>
                    button.textContent ===
                    (order === 'correct' ? phrase : wrong)[index]
                )
              ),
            returnPoint: () => point(buttons(selected).at(-1)),
            beginTabProbe: () => {
              const first = buttons(available)[0];
              if (!first) throw new Error('Expected incomplete word selection');
              first.focus();
              if (document.activeElement !== first)
                throw new Error('Generated-word focus precondition failed');
              return Array.from(
                document.querySelectorAll<HTMLElement>(
                  'button,a[href],input,select,textarea,[tabindex]'
                )
              ).filter(
                (node) =>
                  node.tabIndex >= 0 &&
                  !(node as HTMLButtonElement).disabled &&
                  node.getClientRects().length > 0
              ).length;
            },
            snapshot: () => {
              const chosen = buttons(selected).map(
                (button) => button.textContent || ''
              );
              return {
                available: buttons(available).length,
                correctOrder:
                  chosen.length === phrase.length &&
                  chosen.every((word, index) => word === phrase[index]),
                selected: chosen.length,
                walletCreationRequests,
              };
            },
            cleanup: () => {
              phrase.fill('');
              wrong.fill('');
              phrase = [];
              wrong = [];
              chrome.runtime.sendMessage = original;
              delete (window as any).__phraseReadiness;
            },
          };
        });
        await page.locator('#create-password-action').click();
        await expectPhraseRoute(page);
        const acknowledgement = page.getByRole('checkbox', {
          name: en.seedConfirm.backupAcknowledgement,
          exact: true,
        });
        await expectEnabled(acknowledgement);
        await page
          .getByRole('button', { name: en.import.showSeedPhrase, exact: true })
          .click();
        await expect
          .poll(
            () => page.locator('div.select-none > p').count(),
            readinessAssertionOptions
          )
          .toBe(12);
        observations.generation = await page.evaluate(() =>
          (window as any).__phraseReadiness.remember()
        );
        await acknowledgement.check();
        await expectEnabled(page.locator('#unlock-btn'));
        await page.locator('#unlock-btn').click();
        await expectVisible(
          page.getByRole('heading', {
            name: en.seedConfirm.confirmRecovery,
            exact: true,
          })
        );
        await page.evaluate(() => (window as any).__phraseReadiness.enter());
        expect(await snapshot(page)).toEqual({
          available: 12,
          correctOrder: false,
          selected: 0,
          walletCreationRequests: 0,
        });
      }
    );

    await countOnlyStep(
      wallet,
      'readiness initial selection disables Validate and excludes it from native Tab',
      async () => {
        observations.initial = {
          ...(await snapshot(page)),
          ...(await expectIncomplete(page)),
        };
      }
    );

    await countOnlyStep(
      wallet,
      'readiness partial selection stays disabled and native Tab skips Validate',
      async () => {
        await selectWord(page, 'correct', 0);
        await selectWord(page, 'correct', 1);
        expect((await snapshot(page)).available).toBe(10);
        observations.partial = {
          ...(await snapshot(page)),
          ...(await expectIncomplete(page)),
        };
        await returnLastWord(page, 2);
        await returnLastWord(page, 1);
      }
    );

    await countOnlyStep(
      wallet,
      'readiness full wrong order enables Validate and preserves genuine error feedback',
      async () => {
        for (let index = 0; index < 12; index += 1)
          await selectWord(page, 'wrong', index);
        expect(await snapshot(page)).toEqual({
          available: 0,
          correctOrder: false,
          selected: 12,
          walletCreationRequests: 0,
        });
        await expectEnabled(validate);
        await validate.focus();
        await expectFocused(validate);
        await page.keyboard.press('Enter');
        const error = page.getByRole('dialog', {
          name: en.buttons.error,
          exact: true,
        });
        await expectVisible(error);
        await expectVisible(
          error.getByText(en.seedConfirm.seedError, { exact: true })
        );
        observations.wrong = {
          ...(await snapshot(page)),
          validateEnabled: true,
          errorVisible: true,
        };
        await error
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expectVisible(error, false);
      }
    );

    await countOnlyStep(
      wallet,
      'readiness correct order enables Validate without invoking the wallet-ready terminal',
      async () => {
        for (let count = 12; count > 0; count -= 1)
          await returnLastWord(page, count);
        for (let index = 0; index < 12; index += 1)
          await selectWord(page, 'correct', index);
        await expectEnabled(validate);
        expect(await snapshot(page)).toEqual({
          available: 0,
          correctOrder: true,
          selected: 12,
          walletCreationRequests: 0,
        });
        observations.correct = {
          ...(await snapshot(page)),
          validateEnabled: true,
          validateActivated: false,
        };
      }
    );

    await countOnlyStep(
      wallet,
      'readiness returned word disables Validate and recompletion restores readiness only',
      async () => {
        await returnLastWord(page, 12);
        expect((await snapshot(page)).available).toBe(1);
        observations.returned = {
          ...(await snapshot(page)),
          ...(await expectIncomplete(page)),
        };
        await selectWord(page, 'correct', 11);
        await expectEnabled(validate);
        expect(await snapshot(page)).toEqual({
          available: 0,
          correctOrder: true,
          selected: 12,
          walletCreationRequests: 0,
        });
        await expectPhraseRoute(page);
        await expect
          .poll(
            () => page.getByRole('dialog').count(),
            readinessAssertionOptions
          )
          .toBe(0);
        expect(routes!.deniedWrites).toEqual([]);
        observations.recompleted = {
          ...(await snapshot(page)),
          validateEnabled: true,
          validateActivated: false,
          walletReadyShown: false,
        };
      }
    );

    await info.attach('seed-readiness-count-evidence', {
      body: JSON.stringify(
        {
          ...runtime,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          controllerMessagesForwardedUnchanged: true,
          phraseTextExported: false,
          correctValidationActivated: false,
          walletReadyTerminalActivated: false,
          seedControlsTextStylesAndAccessibilityUnchanged: true,
          diagnostics: { trace: false, video: false, screenshot: false },
          observations,
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    status = 'passed';
  } finally {
    try {
      try {
        if (wallet && !wallet.page.isClosed())
          await wallet.page.evaluate(() =>
            (window as any).__phraseReadiness?.cleanup()
          );
      } finally {
        // An observer-cleanup error must never skip context disposal.
        await wallet?.dispose(status);
      }
    } finally {
      try {
        await server.close();
      } finally {
        Object.assign(E2E_CONFIG, before);
        // No generated phrase exists unless launch returned a wallet. Otherwise
        // only the context's close event proves it is safe to restore snapshots.
        if (!wallet || contextClosed) {
          if (previousNoCopyPrompt === undefined)
            delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
          else process.env.PLAYWRIGHT_NO_COPY_PROMPT = previousNoCopyPrompt;
        } else {
          // Retain suppression if close failed; do not expose the live context
          // during the runner's subsequent failure-artifact teardown.
          throw new Error(
            'Private readiness context did not close; snapshot suppression retained'
          );
        }
      }
    }
  }
});
