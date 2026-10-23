import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Official Blockbook public-key vector with testnet extended-key version.
// Its first external child is independently fixed by the SDK crypto tests.
const DESCRIPTOR =
  'wpkh(tpubDC3pD7UZXnsgh3EBjbtBQiB1FnLask7UHBSunZ1DPK4dCFFZoFRkgxHB8gt42FvLzx1DpxfHWxAsYaY6b643RVcGjDxXxns7wKKYnnfEcbB)';
const DESCRIPTOR_ADDRESS = 'tsys1qalwlmdxd2ggue4290ekzxl9tetg56neeepgwhk';
const BACKENDS = new Set([
  'https://blockbook-dev.syscoin.org',
  'https://explorer-blockbook-dev.syscoin.org',
]);

const publicState = (page: Page, label: string) =>
  page.evaluate(async (expectedLabel) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
    const stored = await chrome.storage.local.get(storageKey);
    const project = (accounts: any) => {
      const account: any = Object.values(accounts?.Imported || {}).find(
        (value: any) => value.label === expectedLabel
      );
      return account
        ? {
            id: account.id,
            label: account.label,
            address: account.address,
            xpub: account.xpub,
            isImported: account.isImported,
          }
        : null;
    };
    return {
      active: state.vault.activeAccount,
      slip44: state.vaultGlobal.activeSlip44,
      switching: !!state.vaultGlobal.isSwitchingAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        label: state.vault.activeNetwork.label,
        url: state.vault.activeNetwork.url,
      },
      storageKey,
      live: project(state.vault.accounts),
      saved: project(stored[storageKey]?.accounts),
    };
  }, label);

const qrPaths = (address: string) =>
  Array.from(
    renderToStaticMarkup(
      React.createElement(QRCodeSVG, { value: address })
    ).matchAll(/\bd="([^"]+)"/g),
    (match) => match[1]
  );

for (const scenario of ['descriptor', 'plain address'] as const) {
  test(`watch-only ${scenario} import remains retryable after delayed validation and receives at its payment address`, async ({}, info) => {
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
    const sourceHash = () =>
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex');
    const sourceSha256 = sourceHash();
    const previous = { ...E2E_CONFIG };
    const fixture = createUtxoFixture('100000000');
    const identifier =
      scenario === 'descriptor' ? DESCRIPTOR : fixture.recipientAddress;
    const address =
      scenario === 'descriptor' ? DESCRIPTOR_ADDRESS : fixture.recipientAddress;
    const label = `Public ${scenario} watch account`;
    const journey = `watch-deadline-${scenario.replace(' ', '-')}`;
    const observations: Record<string, unknown> = {};
    let heldImportAt = 0;
    let completedImportReads = 0;
    let releaseImport!: () => void;
    const heldImport = new Promise<void>(
      (resolve) => (releaseImport = resolve)
    );
    const accountReads: Array<{
      details: string | null;
      identifier: string;
      kind: string;
      method: string;
      responseSha256: string;
      url: string;
    }> = [];
    const failedRequests: Array<{ method: string; url: string }> = [];
    const forbiddenRequests: string[] = [];
    let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      server = await startUtxoFixtureServer();
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'WatchReceiveSynthetic!2026',
        chainId: 5700,
        networkLabel: 'Syscoin Testnet',
        rpcUrl: server.url,
      });
      wallet = await PaliWallet.launch(journey, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          failedRequests.push({ method: request.method(), url: request.url() });
      });
      wallet.context.on('request', (request) => {
        if (/\/sendtx(?:\/|$)/i.test(request.url()))
          forbiddenRequests.push('sendtx');
        try {
          const body = request.postDataJSON();
          for (const call of Array.isArray(body) ? body : [body])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          // Read-only REST has no JSON request body.
        }
      });
      routes = await installUtxoFixtureRoutes(
        wallet.context,
        fixture,
        server.url
      );
      // Only HTTP read data is synthetic. No controller, SDK, Redux, Chrome
      // storage or clock is replaced. Unknown requests reach the deny fence.
      await wallet.context.route(
        (url) =>
          BACKENDS.has(url.origin) &&
          /^\/api\/v2\/(?:xpub|address|utxo)\//.test(url.pathname),
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const match = url.pathname.match(
            /^\/api\/v2\/(xpub|address|utxo)\/(.+)$/
          );
          if (!match || request.method() !== 'GET') return route.fallback();
          const requested = decodeURIComponent(match[2]);
          if (![identifier, address].includes(requested))
            return route.fallback();
          const details = url.searchParams.get('details');
          // A different, valid payment address deliberately appears as public
          // backend metadata. Descriptor receiving must be locally derived,
          // never redirected to this token's name or the top-level reference.
          const body =
            match[1] === 'utxo'
              ? []
              : {
                  address: requested,
                  balance: '0',
                  unconfirmedBalance: '0',
                  totalReceived: '0',
                  totalSent: '0',
                  txs: 0,
                  unconfirmedTxs: 0,
                  usedTokens: 1,
                  tokens: [
                    {
                      type: 'XPUBAddress',
                      name: fixture.userAddress,
                      path: '0/0',
                      balance: '0',
                      totalReceived: '0',
                      totalSent: '0',
                      transfers: 0,
                    },
                  ],
                  tokensAsset: [],
                  ...(details?.startsWith('txs') ? { transactions: [] } : {}),
                };
          const json = JSON.stringify(body);
          accountReads.push({
            method: request.method(),
            url: url.href,
            identifier: requested,
            kind: match[1],
            details,
            responseSha256: createHash('sha256').update(json).digest('hex'),
          });
          if (
            scenario === 'plain address' &&
            details === 'basic' &&
            heldImportAt === 0
          ) {
            heldImportAt = Date.now();
            await heldImport;
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: json,
          });
          if (details === 'basic') completedImportReads++;
        }
      );
      const observeClipboard = () => {
        const original = navigator.clipboard.writeText.bind(
          navigator.clipboard
        );
        navigator.clipboard.writeText = async (text) => {
          await original(text);
          (window as any).__watchReceiveCopied = text;
        };
      };
      await wallet.context.addInitScript(observeClipboard);
      const page = wallet.page;
      // The launch already loaded this document; hash-only onboarding does not rerun init scripts.
      await page.evaluate(observeClipboard);
      const step = (name: string, action: () => Promise<void>) =>
        wallet!.step(`${scenario}: ${name}`, async (capture) => {
          try {
            await action();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        });
      const expectAccount = async () => {
        await expect
          .poll(() => publicState(page, label))
          .toMatchObject({
            active: { type: 'Imported' },
            slip44: 1,
            switching: false,
            storageKey: 'state-vault-1',
            network: {
              kind: 'syscoin',
              chainId: 5700,
              label: 'Syscoin Testnet',
            },
            live: { label, address, xpub: identifier, isImported: true },
            saved: { label, address, xpub: identifier, isImported: true },
          });
        const state = await publicState(page, label);
        expect(state.saved).toEqual(state.live);
        expect(state.active.id).toBe(state.live!.id);
        expect(state.live!.address).not.toBe(fixture.userAddress);
        return state;
      };
      let lastCopySuccessAt = 0;
      const expectReceive = async () => {
        await expect(page).toHaveURL(/#\/receive$/);
        await expect(page.locator('#qr-code + div p')).toHaveText(address);
        await expect(
          page.getByText(en.receive.addressUnavailable, { exact: true })
        ).toHaveCount(0);
        const actualPaths = await page
          .locator('#qr-code svg path')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('d'))
          );
        const expectedPaths = qrPaths(address);
        expect(expectedPaths.length).toBeGreaterThan(0);
        expect(actualPaths).toEqual(expectedPaths);
        const copy = page.locator('#copy-address-receive-btn button');
        await expect(copy).toBeEnabled();
        // Identical success notices are deduplicated for two real seconds.
        if (lastCopySuccessAt)
          await expect
            .poll(() => Date.now() - lastCopySuccessAt)
            .toBeGreaterThan(2000);
        await page.evaluate(() => {
          delete (window as any).__watchReceiveCopied;
        });
        await copy.click();
        await expect
          .poll(() => page.evaluate(() => (window as any).__watchReceiveCopied))
          .toBe(address);
        await expect(
          page.getByText(en.home.addressCopied, { exact: true })
        ).toBeVisible();
        lastCopySuccessAt = Date.now();
        return {
          state: await expectAccount(),
          visibleAddress: await page.locator('#qr-code + div p').innerText(),
          copiedAddress: await page.evaluate(
            () => (window as any).__watchReceiveCopied
          ),
          qrMatchesExpectedAddress: true,
          qrPathsSha256: createHash('sha256')
            .update(JSON.stringify(actualPaths))
            .digest('hex'),
        };
      };

      await step(
        'import through the ordinary account menu and persist the public identity',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menu')
            .getByRole('menuitem', {
              name: en.accountMenu.importAccount,
              exact: true,
            })
            .click();
          await expect(page).toHaveURL(/#\/settings\/account\/import$/);
          await page.locator('#account-name-input').fill(label);
          await page.locator('#import-account-watch-only').check();
          await page.locator('#import-account-identifier').fill(identifier);
          const submit = page.getByRole('button', {
            name: en.buttons.import,
            exact: true,
          });
          await expect(submit).toBeEnabled();
          await submit.click();
          if (scenario === 'plain address') {
            await expect.poll(() => heldImportAt).toBeGreaterThan(0);
            // Observe the bounded validation result, still holding the actual
            // HTTP response and staying inside the unchanged journey budget.
            await new Promise((resolve) => setTimeout(resolve, 8500));
            const beforeReply = await publicState(page, label);
            await expect(
              page.getByText(en.settings.watchOnlyValidationTimedOut, {
                exact: true,
              })
            ).toBeVisible();
            const reportedAfterMs = Date.now() - heldImportAt;
            expect(reportedAfterMs).toBeLessThan(10000);
            expect(beforeReply.live).toBeNull();
            expect(beforeReply.saved).toBeNull();
            expect(beforeReply.active.type).toBe('HDAccount');
            await expect(submit).toBeEnabled();
            await expect(
              page.locator('#import-account-identifier')
            ).toHaveValue(identifier);
            await expect(page.locator('#account-name-input')).toHaveValue(
              label
            );
            await info.attach('watch-validation-timeout', {
              contentType: 'image/png',
              body: await page.screenshot({ animations: 'disabled' }),
            });
            // The old ten-second transport deadline must not cause a second
            // outcome, and a late successful validation must not import.
            await new Promise((resolve) => setTimeout(resolve, 3000));
            releaseImport();
            await expect.poll(() => completedImportReads).toBe(1);
            const afterReply = await publicState(page, label);
            expect(afterReply).toEqual(beforeReply);
            await expect(
              page.getByText('Network request timed out', { exact: true })
            ).toHaveCount(0);
            observations.deadline = {
              beforeReply,
              afterReply,
              reportedAfterMs,
              elapsed: Date.now() - heldImportAt,
            };
            await submit.click();
          }
          await expect(
            page.getByText(en.settings.accountImported, { exact: true })
          ).toBeVisible();
          observations.imported = await expectAccount();
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
        }
      );
      await step(
        'Receive displays, encodes and copies only the canonical payment address',
        async () => {
          await page.locator('#receive-btn').click();
          observations.received = await expectReceive();
        }
      );
      await step(
        'Back opens ordinary Activity while history retains the original identifier',
        async () => {
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/home$/);
          await page.locator('#activity-btn').click();
          await expect
            .poll(
              () =>
                accountReads.filter(
                  (read) =>
                    read.kind ===
                      (scenario === 'descriptor' ? 'xpub' : 'address') &&
                    read.identifier === identifier &&
                    ['txsummary', 'txslight'].includes(read.details || '')
                ).length
            )
            .toBeGreaterThan(0);
          observations.history = {
            state: await expectAccount(),
            reads: accountReads.slice(),
          };
        }
      );
      await step(
        'reopening Receive preserves the same saved watch identity',
        async () => {
          await page.locator('#receive-btn').click();
          observations.reopened = await expectReceive();
        }
      );
      observations.worker = await verifyExecutingWorker(
        wallet.context,
        wallet.extensionId,
        E2E_CONFIG.extensionPath,
        (value) => {
          observations.worker = value;
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      expect(routes.syntheticBroadcasts).toEqual([]);
      expect(forbiddenRequests).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      expect(sourceHash()).toBe(sourceSha256);
      if (info.errors.length === 0) status = 'passed';
    } finally {
      releaseImport();
      try {
        await info.attach('watch-import-deadline-evidence', {
          contentType: 'application/json',
          body: Buffer.from(
            JSON.stringify(
              {
                status,
                scenario,
                identifier,
                expectedAddress: address,
                backendTokenAddress: fixture.userAddress,
                runtime,
                finalRuntime: extensionEvidence(),
                sourceSha256,
                finalSourceSha256: sourceHash(),
                observations,
                accountReads,
                fixtureReads: routes?.reads,
                deniedUnknown: routes?.deniedUnknown,
                deniedWrites: routes?.deniedWrites,
                syntheticBroadcasts: routes?.syntheticBroadcasts,
                forbiddenRequests,
                failedRequests,
                proxyBlocked: server?.blocked,
                signaturesOrBroadcastsRequested: false,
                controllerOrStoreReplaced: false,
              },
              null,
              2
            )
          ),
        });
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
  });
}
