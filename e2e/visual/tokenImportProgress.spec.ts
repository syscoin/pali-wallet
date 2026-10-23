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
import { sptFixtureRead } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CONTRACTS = [
  '0x000000000000000000000000000000000000ab81',
  '0x000000000000000000000000000000000000ab82',
];
const GUIDS = ['775531', '775532'];
const tabTo = async (page: Page, control: Locator) => {
  for (let presses = 0; presses < 32; presses += 1) {
    if (await control.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};
const publicProjection = (page: Page, family: 'evm' | 'utxo') =>
  page.evaluate(async (kind) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const { id, type } = state.vault.activeAccount;
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const stored = await chrome.storage.local.get(storageKey);
    const assets = (value: any) =>
      (value?.[type]?.[id]?.[kind === 'evm' ? 'ethereum' : 'syscoin'] || [])
        .filter((token: any) => token.chainId === 5700)
        .map((token: any) =>
          String(
            kind === 'evm' ? token.contractAddress : token.assetGuid
          ).toLowerCase()
        )
        .sort();
    return {
      account: { id, type },
      address: state.vault.accounts[type][id].address,
      chainId: state.vault.activeNetwork.chainId,
      live: assets(state.vault.accountAssets),
      saved: assets(stored[storageKey]?.accountAssets),
    };
  }, family);

// Delay only the first actual public-token save dispatch, never manufacture its
// result. Release forwards the identical message to the real worker, then passes
// its genuine callback response unchanged to controllerEmitter.
const installSaveHold = (page: Page, firstIdentifier: string) =>
  page.evaluate((expected) => {
    const original = chrome.runtime.sendMessage;
    let held: (() => void) | undefined;
    let heldAt = 0;
    const baselineToasts = new Set(
      Array.from(document.querySelectorAll('.Toastify__toast-body')).map(
        (node) => node.textContent || ''
      )
    );
    const evidence = {
      requested: [] as string[],
      forwarded: [] as string[],
      replies: [] as string[],
      unexpected: [] as string[],
      transportErrors: [] as string[],
      controllerErrors: [] as string[],
      observedToasts: [] as string[],
      released: false,
      heldForMs: 0,
    };
    const observeToasts = () => {
      document.querySelectorAll('.Toastify__toast-body').forEach((node) => {
        const text = node.textContent || '';
        if (
          !baselineToasts.has(text) &&
          !evidence.observedToasts.includes(text)
        )
          evidence.observedToasts.push(text);
      });
    };
    const observer = new MutationObserver(observeToasts);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    (chrome.runtime.sendMessage as any) = (...args: any[]) => {
      const [message, callback] = args;
      if (
        message?.type !== 'CONTROLLER_ACTION' ||
        JSON.stringify(message.data?.methods) !==
          JSON.stringify(['wallet', 'saveTokenInfo'])
      )
        return (original as any).apply(chrome.runtime, args);
      const token = message.data?.params?.[0];
      const identifier = String(
        token?.contractAddress || token?.assetGuid || ''
      ).toLowerCase();
      evidence.requested.push(identifier);
      if (typeof callback !== 'function') {
        evidence.unexpected.push('save without the real callback');
        return (original as any).apply(chrome.runtime, args);
      }
      const forward = () => {
        evidence.forwarded.push(identifier);
        return original.call(chrome.runtime, message, (response) => {
          const error = chrome.runtime.lastError?.message;
          if (error) evidence.transportErrors.push(error);
          if (
            response?.error ||
            (response?.success === false &&
              Object.prototype.hasOwnProperty.call(response, 'error'))
          )
            evidence.controllerErrors.push(identifier);
          evidence.replies.push(identifier);
          callback(response);
        });
      };
      if (evidence.requested.length === 1 && identifier === expected) {
        heldAt = performance.now();
        held = forward;
        return;
      }
      if (!evidence.released)
        evidence.unexpected.push('second save requested while first is held');
      return forward();
    };
    (window as any).__tokenImportProgress = {
      snapshot: () => {
        observeToasts();
        return {
          ...evidence,
          held: !!held,
          heldForMs: held ? performance.now() - heldAt : evidence.heldForMs,
        };
      },
      release: () => {
        if (!held) throw new Error('No genuine token save dispatch held');
        const forward = held;
        held = undefined;
        evidence.heldForMs = performance.now() - heldAt;
        evidence.released = true;
        forward();
      },
      restore: () => {
        chrome.runtime.sendMessage = original;
        observer.disconnect();
      },
    };
  }, firstIdentifier);

for (const family of ['evm', 'utxo'] as const) {
  test(`${family.toUpperCase()} pending owned-token import disables sibling imports without blocking Details`, async ({}, info) => {
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
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    const identifiers = family === 'evm' ? CONTRACTS : GUIDS;
    const symbols =
      family === 'evm' ? ['IPEVMA', 'IPEVMB'] : ['IPSPTA', 'IPSPTB'];
    const discoveryReads: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, unknown> = {};
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ImportProgressSynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel:
        family === 'evm' ? 'Syscoin NEVM Testnet' : 'Syscoin Testnet',
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let delivery: any;
    try {
      wallet = await PaliWallet.launch(`token-import-progress-${family}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() !== 'GET') return route.fallback();
        if (
          family === 'evm' &&
          url.origin === 'https://explorer.tanenbaum.io' &&
          url.pathname === '/api' &&
          url.searchParams.get('module') === 'account' &&
          url.searchParams.get('action') === 'tokenlist' &&
          url.searchParams.get('address')?.toLowerCase() ===
            fixture.evmAddresses[0].toLowerCase()
        ) {
          discoveryReads.push('evm:primary-owner-tokenlist');
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: '1',
              result: CONTRACTS.map((contractAddress, index) => ({
                contractAddress,
                type: 'ERC-20',
                name: `Disposable import ${index === 0 ? 'A' : 'B'}`,
                symbol: symbols[index],
                decimals: '6',
                balance: index === 0 ? '3000000' : '5000000',
              })),
            }),
          });
        }
        if (
          family === 'utxo' &&
          [
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin)
        ) {
          const base = sptFixtureRead(fixture.utxo, request.url(), 'GET');
          const owner = url.pathname.match(
            /^\/api\/v2\/(?:xpub|address)\/(.+)$/
          )?.[1];
          if (
            base !== undefined &&
            owner &&
            [fixture.utxo.userXpub, fixture.utxo.userAddress].includes(
              decodeURIComponent(owner)
            )
          ) {
            discoveryReads.push(
              'utxo:primary-owner-' +
                (url.searchParams.get('details') || 'default')
            );
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                ...(base as object),
                tokensAsset: GUIDS.map((assetGuid, index) => ({
                  assetGuid,
                  symbol: symbols[index],
                  name: `Disposable import ${index === 0 ? 'A' : 'B'}`,
                  type: 'SPTAllocated',
                  decimals: 8,
                  balance: index === 0 ? '300000000' : '500000000',
                  unconfirmedBalance: '0',
                  totalReceived: index === 0 ? '300000000' : '500000000',
                  totalSent: '0',
                  transfers: 1,
                })),
              }),
            });
          }
        }
        return route.fallback();
      });
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const importAction = (index: number) =>
        page.getByRole('button', {
          name: en.tokens.importNamedToken.replace(
            '{{symbol}}',
            symbols[index]
          ),
          exact: true,
        });
      const details = page.getByRole('button', {
        name: en.tokens.viewTokenDetails.replace('{{symbol}}', symbols[1]),
        exact: true,
      });
      const snapshot = () =>
        page.evaluate(() => (window as any).__tokenImportProgress.snapshot());
      await wallet.step(
        `${family} prepare a fresh fenced wallet and ordinary Your Tokens list`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork(
            E2E_CONFIG.networkLabel,
            family === 'evm' ? 'EVM' : 'UTXO'
          );
          await wallet!.ensureOnHome();
          observations.before = await publicProjection(page, family);
          expect(observations.before).toMatchObject({
            account: { id: 0, type: 'HDAccount' },
            chainId: 5700,
            live: [],
            saved: [],
            address:
              family === 'evm'
                ? fixture.evmAddresses[0]
                : fixture.utxo.userAddress,
          });
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await expect(importAction(0)).toBeEnabled();
          await expect(importAction(1)).toBeEnabled();
          expect(
            discoveryReads.some((read) =>
              family === 'evm'
                ? read === 'evm:primary-owner-tokenlist'
                : read.includes('tokenBalances')
            )
          ).toBe(true);
        }
      );
      await wallet.step(
        `${family} hold only the first genuine token-save dispatch`,
        async () => {
          await installSaveHold(page, identifiers[0]);
          await importAction(0).click();
          await expect.poll(snapshot).toMatchObject({
            requested: [identifiers[0]],
            forwarded: [],
            held: true,
            released: false,
          });
          await expect(importAction(0)).toBeDisabled();
          await expect(importAction(1)).toBeDisabled();
          await expect(
            importAction(0)
              .locator('..')
              .locator('div.absolute.inset-0 .animate-spin')
          ).toHaveCount(1);
          await expect(
            importAction(1)
              .locator('..')
              .locator('div.absolute.inset-0 .animate-spin')
          ).toHaveCount(0);
          await expect(importAction(1)).toHaveClass(/cursor-not-allowed/);
          await expect(importAction(1)).not.toHaveClass(
            /hover:bg-brand-royalblue\/20/
          );
          observations.pending = await publicProjection(page, family);
          expect(observations.pending).toEqual(observations.before);
        }
      );
      await wallet.step(
        `${family} retain native Details access at 400 and 320 while sibling imports are disabled`,
        async (capture) => {
          const sizes = [];
          for (const width of [400, 320]) {
            await page.setViewportSize({
              width,
              height: width === 320 ? 360 : 620,
            });
            await details.scrollIntoViewIfNeeded();
            await expect(details).toBeEnabled();
            await tabTo(page, details);
            await expect(details).toBeFocused();
            const bounds = await details.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2
              );
              return {
                left: rect.left >= 0,
                right: rect.right <= innerWidth,
                top: rect.top >= 0,
                bottom: rect.bottom <= innerHeight,
                hit: hit === element || (!!hit && element.contains(hit)),
              };
            });
            expect(bounds).toEqual({
              left: true,
              right: true,
              top: true,
              bottom: true,
              hit: true,
            });
            sizes.push({ width, bounds });
            await info.attach(`${family}-pending-import-${width}`, {
              contentType: 'image/png',
              body: await page.screenshot({ animations: 'disabled' }),
            });
          }
          observations.sizes = sizes;
          const pending = await snapshot();
          expect(pending).toMatchObject({
            requested: [identifiers[0]],
            forwarded: [],
            replies: [],
            unexpected: [],
            observedToasts: [],
            held: true,
          });
          expect(pending.heldForMs).toBeLessThan(9_000);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home\/details$/);
          await page.evaluate(() =>
            (window as any).__tokenImportProgress.release()
          );
          await capture(page);
        }
      );
      await wallet.step(
        `${family} verify the released unchanged save and its genuine durable result`,
        async () => {
          await expect.poll(snapshot).toMatchObject({
            requested: [identifiers[0]],
            forwarded: [identifiers[0]],
            replies: [identifiers[0]],
            held: false,
            released: true,
            transportErrors: [],
            controllerErrors: [],
            unexpected: [],
          });
          delivery = await snapshot();
          expect(delivery.heldForMs).toBeLessThan(9_000);
          await expect
            .poll(() => publicProjection(page, family))
            .toMatchObject({ live: [identifiers[0]], saved: [identifiers[0]] });
          await expect(
            page.getByText(symbols[1], { exact: true }).first()
          ).toBeVisible();
          expect(
            await page.evaluate(() => ({
              preview: history.state?.usr?.isImportPreview,
              symbol: history.state?.usr?.symbol,
            }))
          ).toEqual({ preview: true, symbol: symbols[1] });
          observations.afterFirst = await publicProjection(page, family);
        }
      );
      await wallet.step(
        `${family} return normally and persist the second distinct token`,
        async () => {
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/tokens\/add\?tab=owned$/);
          await expect(importAction(1)).toBeEnabled();
          await importAction(1).click();
          await expect.poll(snapshot).toMatchObject({
            requested: identifiers,
            forwarded: identifiers,
            replies: identifiers,
            transportErrors: [],
            controllerErrors: [],
            unexpected: [],
          });
          await expect
            .poll(() => publicProjection(page, family))
            .toMatchObject({
              live: [...identifiers].sort(),
              saved: [...identifiers].sort(),
            });
          await expect(importAction(1)).toBeDisabled();
          observations.afterSecond = await publicProjection(page, family);
          delivery = await snapshot();
          expect(delivery.observedToasts).toContain(
            en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', symbols[1])
          );
          await page.evaluate(() =>
            (window as any).__tokenImportProgress.restore()
          );
        }
      );
      await wallet.step(
        `${family} reload and retain the exact owner and durable imported identities`,
        async () => {
          await page.reload();
          await wallet!.waitAppReady();
          await expect
            .poll(() => publicProjection(page, family))
            .toEqual(observations.afterSecond);
          observations.afterReload = await publicProjection(page, family);
          expect(routes!.deniedWrites).toEqual([]);
          expect(pageErrors).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      try {
        if (wallet && !wallet.page.isClosed()) {
          delivery = await wallet.page
            .evaluate(() => {
              const probe = (window as any).__tokenImportProgress;
              if (!probe) return null;
              if (probe.snapshot().held) probe.release();
              const value = probe.snapshot();
              probe.restore();
              return value;
            })
            .then((value) => value || delivery)
            .catch(() => delivery);
        }
        await info.attach('token-import-progress-observations', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              ...runtime,
              family,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex'),
              syntheticHttpOnly: true,
              controllerStateReplaced: false,
              controllerResultReplaced: false,
              genuineSaveDispatchDelayed: !!delivery?.requested?.length,
              identifiers,
              symbols,
              discoveryReads,
              delivery,
              observations,
              pageErrors,
              deniedWrites: routes?.deniedWrites ?? [],
              proxyDeniedConnections: server.blocked.length,
            },
            null,
            2
          ),
        });
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
  });
}
