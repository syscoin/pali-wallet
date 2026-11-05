import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  createVisualFixture,
  installVisualFixtureRoutes,
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_EXPLORER,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

// HTTP-only public test data. No Chrome API, controller, keyring, store or
// formatter is replaced, and the launch-time proxy never forwards traffic.
test('compiled Activity keeps native and indexed-token quantities exact through details and Back', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  const before = { ...E2E_CONFIG };
  const fixture = createVisualFixture();
  const contract = `0x${'33'.repeat(20)}`;
  const nativeCases = [
    { id: 'b1', value: '1', expected: '0.000000000000000001 TSYS' },
    {
      id: 'b2',
      value: '9007199254740993000000000000000001',
      expected: '9007199254740993.000000000000000001 TSYS',
    },
    { id: 'b3', value: '0', expected: '0 TSYS' },
    { id: 'b4', value: 'invalid', expected: '? TSYS' },
    {
      id: 'b6',
      value: '9007199254740993000000000000000002',
      expected: '9007199254740993.000000000000000002 TSYS',
      failed: true,
    },
  ];
  const nativeRows = nativeCases.map((entry, index) => ({
    ...fixture.transaction,
    hash: `0x${entry.id.repeat(32)}`,
    value: entry.value,
    nonce: String(index + 1),
    timeStamp: String(1700001000 - index),
    isError: 'failed' in entry ? '1' : '0',
    // eslint-disable-next-line camelcase -- Explorer wire field.
    txreceipt_status: 'failed' in entry ? '0' : '1',
  }));
  fixture.transactions = nativeRows;
  const tokenHash = `0x${'b5'.repeat(32)}`;
  const token = {
    ...fixture.transaction,
    hash: tokenHash,
    from: `0x${'22'.repeat(20)}`,
    to: fixture.address,
    contractAddress: contract,
    value: '9007199254740993',
    tokenDecimal: '0',
    tokenSymbol: 'EXACT',
    tokenName: 'Synthetic Exact Token',
    input: '0x',
    nonce: '5',
    timeStamp: '1700000995',
  };
  const reads: string[] = [];
  const observations: unknown[] = [];
  const errors: string[] = [];
  let wallet: PaliWallet | undefined;
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let routes:
    | Awaited<ReturnType<typeof installVisualFixtureRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: VISUAL_FIXTURE_SEED,
      password: 'ExactDisplaySynthetic!2026',
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('evm-activity-exact-amounts', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 740 },
    });
    routes = await installVisualFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route(
      `${VISUAL_FIXTURE_EXPLORER}/api**`,
      async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET')
          return route.abort('blockedbyclient');
        const action = url.searchParams.get('action');
        if (action !== 'tokentx') return route.fallback();
        if (
          url.searchParams.get('address')?.toLowerCase() !==
          fixture.address.toLowerCase()
        )
          return route.fallback();
        const result =
          Number(url.searchParams.get('page') || 1) === 1 ? [token] : [];
        reads.push(`tokentx:${url.searchParams.get('page') || 1}`);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: result.length ? '1' : '0',
            message: result.length ? 'OK' : 'No transactions found',
            result,
          }),
        });
      }
    );
    const page = wallet.page;
    page.on('pageerror', (error) => errors.push(error.message));
    await wallet.step(
      'load ordinary wallet Activity from bounded HTTP fixture',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('zkTanenbaum');
        await wallet!.ensureOnHome();
        await page.locator('#activity-btn').click();
        for (const entry of nativeCases)
          await expect(
            page.getByText(entry.expected, { exact: true })
          ).toBeVisible();
        await expect(
          page.getByText('9007199254740993 EXACT', { exact: true })
        ).toBeVisible();
        const publicRows = await page.evaluate(async () => {
          const { vault } = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const rows =
            vault.accountTransactions[vault.activeAccount.type][
              vault.activeAccount.id
            ].ethereum[vault.activeNetwork.chainId];
          return rows.map((row: any) => ({
            hash: row.hash,
            value: row.value,
            historySource: row.historySource,
            tokenTransfer: row.tokenTransfer,
          }));
        });
        expect(publicRows).toEqual(
          expect.arrayContaining(
            nativeRows.map((row) =>
              expect.objectContaining({
                hash: row.hash,
                value: row.value,
                historySource: 'explorer-txlist',
              })
            )
          )
        );
        expect(publicRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hash: tokenHash,
              value: token.value,
              historySource: 'explorer-tokentx',
            }),
          ])
        );
        observations.push({ publicRows });
      }
    );
    for (const { width, fontPx } of [
      { width: 400, fontPx: 16 },
      { width: 320, fontPx: 16 },
      { width: 320, fontPx: 20 },
    ]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, fontPx);
      await page.setViewportSize({ width, height: 740 });
      for (const expected of [
        ...nativeCases.map((row) => row.expected),
        '9007199254740993 EXACT',
      ]) {
        const amount = page.getByText(expected, { exact: true });
        await captureForegroundContrast(
          amount,
          info,
          `list-${width}-${fontPx}-${expected.slice(0, 8)}`
        );
        const glyphs = await amount.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const box = element.getBoundingClientRect();
          const rowElement = element.closest('.border-b')!;
          const row = rowElement.getBoundingClientRect();
          const statusElement = Array.from(
            rowElement.querySelectorAll('p,div')
          ).find(
            (e) => e.textContent === 'Confirmed' || e.textContent === 'Failed'
          );
          const statusBox = statusElement?.getBoundingClientRect();
          const rects = Array.from(range.getClientRects()).map((r) => ({
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          }));
          return {
            box: { left: box.left, right: box.right },
            row: { left: row.left, right: row.right },
            rects,
            statusBox: statusBox
              ? {
                  left: statusBox.left,
                  right: statusBox.right,
                  top: statusBox.top,
                  bottom: statusBox.bottom,
                }
              : null,
            width: window.innerWidth,
          };
        });
        for (const rect of glyphs.rects) {
          expect(rect.left).toBeGreaterThanOrEqual(glyphs.box.left - 1);
          expect(rect.right).toBeLessThanOrEqual(glyphs.box.right + 1);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
          if (
            glyphs.statusBox &&
            rect.top < glyphs.statusBox.bottom &&
            rect.bottom > glyphs.statusBox.top
          )
            expect(rect.left).toBeGreaterThanOrEqual(glyphs.statusBox.right);
        }
        observations.push({ width, fontPx, expected, glyphs });
        if (expected === nativeCases[0].expected) {
          await page.screenshot({
            path: info.outputPath(
              `exact-activity-first-${width}-${fontPx}.png`
            ),
          });
        }
      }
      const listShot = info.outputPath(
        `exact-activity-last-${width}-${fontPx}.png`
      );
      await page.screenshot({ path: listShot });
      for (const entry of [
        ...nativeCases.map((row) => ({
          ...row,
          hash: `0x${row.id.repeat(32)}`,
        })),
        { hash: tokenHash, expected: '9007199254740993 EXACT' },
      ]) {
        await wallet.step(
          `${width}/${fontPx}: preserve ${entry.hash.slice(
            0,
            6
          )} through details and Back`,
          async () => {
            await page
              .getByText(entry.expected, { exact: true })
              .locator('xpath=ancestor::div[contains(@class,"border-b")][1]')
              .getByRole('button', {
                name: en.notifications.clickToView,
                exact: true,
              })
              .click();
            await expect(page).toHaveURL(/#\/home\/details(?:\?|$)/);
            const amount = page
              .locator('#details-view-content')
              .getByText(entry.expected, { exact: true });
            await expect(amount).toBeVisible();
            await captureForegroundContrast(
              amount,
              info,
              `detail-${entry.hash.slice(2, 4)}-${width}-${fontPx}`
            );
            const bounds = await amount.evaluate((element) => {
              const r = element.getBoundingClientRect();
              return {
                left: r.left,
                right: r.right,
                width: window.innerWidth,
                bodyOverflow:
                  document.documentElement.scrollWidth > window.innerWidth,
              };
            });
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(width);
            expect(bounds.bodyOverflow).toBe(false);
            await page.screenshot({
              path: info.outputPath(
                `exact-detail-${entry.hash.slice(2, 4)}-${width}-${fontPx}.png`
              ),
            });
            observations.push({
              width,
              hash: entry.hash,
              amount: await amount.innerText(),
              bounds,
            });
            await page
              .getByRole('button', { name: en.buttons.back, exact: true })
              .click();
            await expect(page).toHaveURL(/#\/home(?:\?|$)/);
            await expect(
              page.getByText(entry.expected, { exact: true })
            ).toBeVisible();
          }
        );
      }
    }
    expect(reads.length).toBeGreaterThan(0);
    expect(routes.deniedWrites).toEqual([]);
    expect(errors).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    status = 'passed';
  } finally {
    await info.attach('exact-activity-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        status,
        runtime,
        testSourceSha256: createHash('sha256')
          .update(fs.readFileSync(info.file))
          .digest('hex'),
        observations,
        reads,
        fixtureReads: routes?.reads,
        deniedWrites: routes?.deniedWrites,
        deniedUnknown: routes?.deniedUnknown,
        proxyDenied: server?.blocked,
        errors,
        syntheticHttpOnly: true,
        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        chromeApiReplaced: false,
        signingOrBroadcastRequested: false,
      }),
    });
    try {
      await wallet?.dispose(status);
    } finally {
      await server?.close();
      Object.assign(E2E_CONFIG, before);
    }
  }
});
