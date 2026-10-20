import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  createUtxoFixture,
  fixtureRead,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const scenario of ['historical dates', 'duplicate page'] as const) {
  test(`UTXO history preserves ${scenario} through ordinary Activity`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const runtime = extensionEvidence();
    const before = { ...E2E_CONFIG };
    const fixture = createUtxoFixture('100000000');
    const server = await startUtxoFixtureServer();
    const date = (year: number) => Date.parse(`${year}-11-04T12:00:00Z`) / 1000;
    const transaction = (id: number, blockTime = date(2024) - id) => ({
      txid: id.toString(16).padStart(64, '0'),
      blockTime,
      blockHeight: 100,
      confirmations: 3,
      fees: '1000',
      addressValueIn: '0',
      addressValueOut: '100000000',
      vin: [
        {
          txid: 'e'.repeat(64),
          vout: 0,
          addresses: [fixture.recipientAddress],
          isOwn: false,
          value: '100001000',
        },
      ],
      vout: [
        {
          n: 0,
          addresses: [fixture.userAddress],
          isOwn: true,
          value: '100000000',
        },
      ],
    });
    const initial =
      scenario === 'historical dates'
        ? [transaction(1, date(2024)), transaction(2, date(2014))]
        : Array.from({ length: 30 }, (_, index) => transaction(index + 1));
    const older = transaction(99, date(2023));
    const pageReads: { page: number; txids: string[] }[] = [];
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'HistoryContinuitySynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    try {
      wallet = await PaliWallet.launch(
        `utxo-history-${scenario.replace(' ', '-')}`,
        {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        }
      );
      routes = await installUtxoFixtureRoutes(
        wallet.context,
        fixture,
        server.url,
        {
          readState: () => ({ transactions: initial }),
        }
      );
      // Only Blockbook HTTP rows are synthetic. The wallet's reader, controller,
      // pagination state and Activity renderer process these responses normally.
      await wallet.context.route(
        (url) =>
          [
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin) &&
          /^\/api\/v2\/(?:xpub|address)\//.test(url.pathname) &&
          ['txsummary', 'txslight'].includes(
            url.searchParams.get('details') || ''
          ),
        async (route) => {
          const url = new URL(route.request().url());
          const page = Number(url.searchParams.get('page') || 1);
          const rows =
            scenario === 'duplicate page' && page >= 3 ? [older] : initial;
          const body = fixtureRead(
            fixture,
            url.href,
            route.request().method(),
            { transactions: rows }
          );
          if (!body || typeof body !== 'object') return route.fallback();
          pageReads.push({ page, txids: rows.map(({ txid }) => txid) });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              ...body,
              txs: scenario === 'duplicate page' ? 61 : 2,
              page,
            }),
          });
        }
      );
      const page = wallet.page;
      const row = (txid: string) =>
        page
          .getByText(`${txid.slice(0, 4)}...${txid.slice(-14)}`, {
            exact: true,
          })
          .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
      const step = (name: string, action: () => Promise<void>) =>
        wallet!.step(name, async (capture) => {
          try {
            await action();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        });
      await step(
        `${scenario}: open ordinary Activity with the expected current HTTP rows`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet!.ensureOnHome();
          await page.locator('#activity-btn').click();
          await expect(row(initial[0].txid)).toBeVisible();
          expect(pageReads.some((read) => read.page === 1)).toBe(true);
        }
      );
      if (scenario === 'historical dates') {
        await step(
          'report public transaction copy only after clipboard completion and retain refusal feedback',
          async () => {
            await page.evaluate(() => {
              Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                  writeText: (text: string) =>
                    new Promise<void>((resolve) => {
                      (window as any).__historyClipboard = { text, resolve };
                    }),
                },
              });
            });
            const copy = row(initial[0].txid).getByRole('button').first();
            const copied = page.getByText(en.home.hashCopied, { exact: true });
            await copy.click();
            await expect
              .poll(() =>
                page.evaluate(() => (window as any).__historyClipboard?.text)
              )
              .toBe(initial[0].txid);
            await expect(copied).toHaveCount(0);
            await page.evaluate(() =>
              (window as any).__historyClipboard.resolve()
            );
            await expect(copied).toBeVisible();
            await page.evaluate(() => {
              Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                  writeText: async () => {
                    throw new Error('Synthetic history clipboard refusal');
                  },
                },
              });
            });
            await copy.click();
            await expect(
              page.getByText(en.transactions.copyFailed, { exact: true })
            ).toBeVisible();
            await expect(copied).toHaveCount(0);
          }
        );
        await step('recent history retains its genuine date', async () => {
          await expect(
            row(initial[0].txid).getByText('11-04-24', { exact: true })
          ).toBeVisible();
        });
        await step(
          'older history retains its genuine date rather than today',
          async () => {
            await expect(
              row(initial[1].txid).getByText('11-04-14', { exact: true })
            ).toBeVisible();
          }
        );
      } else {
        await step(
          'a duplicate-only full page remains manually pageable',
          async () => {
            const more = page.getByRole('button', {
              name: en.buttons.loadMore,
              exact: true,
            });
            await more.click();
            await expect
              .poll(() => pageReads.some((read) => read.page === 2))
              .toBe(true);
            expect(pageReads.some((read) => read.page === 3)).toBe(false);
            await expect(row(initial[0].txid)).toHaveCount(1);
            await expect(more).toBeVisible();
            await expect(more).toBeEnabled();
            await more.click();
            await expect
              .poll(() => pageReads.some((read) => read.page === 3))
              .toBe(true);
            await expect(row(older.txid)).toBeVisible();
            await expect(more).toHaveCount(0);
          }
        );
      }
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await info.attach('utxo-history-continuity-evidence', {
          body: JSON.stringify(
            {
              ...runtime,
              scenario,
              testSourceSha256: createHash('sha256')
                .update(fs.readFileSync(__filename))
                .digest('hex'),
              syntheticHttpOnly: true,
              controllerStateReplaced: false,
              controllerResultReplaced: false,
              initialTimestamps: initial.map(({ blockTime }) => blockTime),
              pageReads,
              deniedWrites: routes?.deniedWrites || [],
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
  });
}
