import { expect, test, type Locator } from '@playwright/test';
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

// Deterministic disposable entropy, never used to create a wallet. Keep the
// phrase out of screenshots, traces, video, ARIA failure context and evidence.
const phrase = Mnemonic.fromEntropy(
  '0x4748494a4b4c4d4e4f50515253545556'
).phrase;
const words = phrase.split(' ');
const invalidPhrase = ['abandon', 'ability', 'able', 'about']
  .map((word) => [...words.slice(0, -1), word].join(' '))
  .find((candidate) => !Mnemonic.isValidMnemonic(candidate))!;

// The worker refreshes these public advisory feeds after startup. Match only
// the canonical read URLs, with the same empty shapes as other visual fixtures.
const BLACKLIST_FEEDS = new Map<string, unknown>([
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    { blacklist: [], whitelist: [], fuzzylist: [] },
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
    [],
  ],
]);

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const enabled = async (locator: Locator, expected: boolean) => {
  await expect.poll(() => locator.count()).toBe(1);
  await expect.poll(() => locator.isEnabled()).toBe(expected);
};

(['pointer', 'textarea Enter'] as const).forEach((activation) => {
  test(`mnemonic import reaches password setup using ${activation}`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    expect(Mnemonic.isValidMnemonic(phrase)).toBe(true);
    expect(typeof invalidPhrase).toBe('string');
    expect(Mnemonic.isValidMnemonic(invalidPhrase)).toBe(false);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceHash = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const previousNoCopyPrompt = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, { rpcUrl: server.url });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let contextClosed = false;
    let status: 'passed' | 'failed' = 'failed';
    let calls: unknown;
    const deniedHttp: string[] = [];
    const blacklistReads: string[] = [];
    const observations: Record<string, unknown> = {};
    try {
      wallet = await PaliWallet.launch(
        `mnemonic-keyboard-${activation.replace(/ /g, '-')}`,
        {
          offlineHttpProxy: server.url,
          recordVideo: false,
          viewport: { width: 400, height: 620 },
        }
      );
      wallet.context.once('close', () => {
        contextClosed = true;
      });
      wallet.context.on('requestfailed', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          deniedHttp.push(`${request.method()} ${url.origin}${url.pathname}`);
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      await wallet.context.route(
        (url) => BLACKLIST_FEEDS.has(url.href),
        async (route) => {
          const request = route.request();
          if (request.method() !== 'GET') return route.abort('blockedbyclient');
          blacklistReads.push(request.url());
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(BLACKLIST_FEEDS.get(request.url())),
          });
        }
      );
      const page = wallet.page;
      await page.locator('#import-wallet-link').click();
      const input = page.locator('#import-wallet-input');
      const submit = page.locator('#import-wallet-action');
      await expect.poll(() => input.isVisible()).toBe(true);

      // Observation only: forward every original call and callback unchanged.
      // Do not inspect parameters, replace results, or alter controller state.
      await page.evaluate(() => {
        const original = chrome.runtime.sendMessage;
        const observed = {
          validations: 0,
          forbidden: [] as string[],
          events: [] as { type: string; defaultPrevented: boolean }[],
        };
        (chrome.runtime.sendMessage as any) = (...args: any[]) => {
          const message = args[0];
          const methods = message?.data?.methods;
          if (message?.type === 'CONTROLLER_ACTION') {
            if (methods?.[0] === 'wallet' && methods?.[1] === 'isSeedValid')
              observed.validations += 1;
            if (
              /^(?:createWallet|recoverWalletFromSeed|createNewSeed|forgetWallet|export.*|getPrivateKey|getSeed)$/.test(
                methods?.[1] || ''
              )
            )
              observed.forbidden.push(methods.join('.'));
          }
          return (original as any).apply(chrome.runtime, args);
        };
        const listener = (event: Event) => {
          if ((event.target as HTMLElement)?.id !== 'import-wallet-input')
            return;
          if (
            event.type === 'input' ||
            (event as KeyboardEvent).key === 'Enter'
          )
            observed.events.push({
              type: event.type,
              defaultPrevented: event.defaultPrevented,
            });
        };
        for (const type of ['keydown', 'keypress', 'input', 'keyup'])
          document.addEventListener(type, listener);
        (window as any).__mnemonicKeyboard = {
          resetEvents: () => {
            observed.events = [];
          },
          snapshot: () => ({ ...observed, events: [...observed.events] }),
          cleanup: () => {
            chrome.runtime.sendMessage = original;
            for (const type of ['keydown', 'keypress', 'input', 'keyup'])
              document.removeEventListener(type, listener);
          },
        };
      });

      await input.fill(invalidPhrase);
      await enabled(submit, false);
      await expect
        .poll(() =>
          page.getByText(en.seedConfirm.seedError, { exact: true }).isVisible()
        )
        .toBe(true);
      await input.press('Enter');
      await enabled(submit, false);
      expect(new URL(page.url()).hash).toBe('#/import');
      observations.invalidChecksumRefused = true;

      await input.fill(phrase);
      await enabled(submit, true);
      await input.click();
      await expect
        .poll(() => input.evaluate((node) => node === document.activeElement))
        .toBe(true);
      await page.evaluate(() =>
        (window as any).__mnemonicKeyboard.resetEvents()
      );
      if (activation === 'pointer') await submit.click();
      else await page.keyboard.press('Enter');

      // Soft only on the proposed behavior, so baseline failure still exercises
      // healthy pointer recovery and all no-create/no-write controls below.
      await expect.soft
        .poll(async () => ({
          route: new URL(page.url()).hash,
          passwordVisible: await page.locator('#create-password').isVisible(),
        }))
        .toEqual({ route: '#/create-password-import', passwordVisible: true });
      observations.activation = {
        route: new URL(page.url()).hash,
        passwordVisible: await page.locator('#create-password').isVisible(),
        ...(await page.evaluate(() =>
          (window as any).__mnemonicKeyboard.snapshot()
        )),
      };
      if (new URL(page.url()).hash === '#/import') {
        await input.fill(phrase);
        await enabled(submit, true);
        await submit.click();
      }
      await expect
        .poll(() => new URL(page.url()).hash)
        .toBe('#/create-password-import');
      await expect
        .poll(() => page.locator('#create-password').isVisible())
        .toBe(true);
      expect(await page.locator('#create-password').inputValue()).toBe('');
      expect(await page.locator('#confirm-password').inputValue()).toBe('');
      observations.passwordStepReachedWithoutCreation = true;
      calls = await page.evaluate(() =>
        (window as any).__mnemonicKeyboard.snapshot()
      );
      expect(calls).toMatchObject({ forbidden: [] });
      expect(routes.deniedWrites).toEqual([]);
      expect(deniedHttp).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(
        createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
      ).toBe(sourceHash);
      status = info.errors.length ? 'failed' : 'passed';
    } finally {
      try {
        if (wallet && !wallet.page.isClosed()) {
          calls = await wallet.page.evaluate(() =>
            (window as any).__mnemonicKeyboard?.snapshot()
          );
        }
        await info.attach('mnemonic-keyboard-submission-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            activation,
            runtime,
            sourceHash,
            observations,
            calls,
            fixtureReads: routes?.reads ?? [],
            blacklistReads,
            deniedWrites: routes?.deniedWrites ?? [],
            deniedHttp,
            proxyDeniedConnections: server.blocked.length,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            controllerMessagesForwardedUnchanged: true,
            phraseExported: false,
            passwordSubmitted: false,
            diagnostics: { trace: false, video: false, screenshot: false },
          }),
        });
      } finally {
        try {
          if (wallet && !wallet.page.isClosed())
            await wallet.page.evaluate(() =>
              (window as any).__mnemonicKeyboard?.cleanup()
            );
        } finally {
          try {
            await wallet?.dispose(status);
          } finally {
            await server.close();
            Object.assign(E2E_CONFIG, previous);
            if (!wallet || contextClosed) {
              if (previousNoCopyPrompt === undefined)
                delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
              else process.env.PLAYWRIGHT_NO_COPY_PROMPT = previousNoCopyPrompt;
            }
          }
        }
      }
    }
  });
});
