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
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// useUtils coalesces identical info notices within this existing interval.
const COPY_NOTICE_DEDUP_MS = 2000;

test('UTXO transaction details retain every distinct source address through ordinary Activity', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const runtime = extensionEvidence();
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(__filename))
    .digest('hex');
  const previousConfig = { ...E2E_CONFIG };
  const fixture = createUtxoFixture('100000000');
  // These are public source-script addresses, not a claim of common ownership.
  // The second address belongs to the fixture's other synthetic account.
  const cases = [
    { name: 'single', txid: '11'.repeat(32), sources: [fixture.userAddress] },
    {
      name: 'duplicate',
      txid: '22'.repeat(32),
      sources: [fixture.userAddress, fixture.userAddress],
    },
    {
      name: 'multiple',
      txid: '33'.repeat(32),
      sources: [
        fixture.userAddress,
        fixture.sponsorAddress,
        fixture.userAddress,
      ],
    },
  ];
  const transactions = cases.map(({ txid, sources }, caseIndex) => {
    const inputValue = BigInt(sources.length) * BigInt(100000000);
    return {
      txid,
      version: 2,
      blockHash: 'bb'.repeat(32),
      blockHeight: 42,
      blockTime: 1700000000 + caseIndex,
      confirmations: 5,
      fees: '1000',
      valueIn: inputValue.toString(),
      value: (inputValue - BigInt(1000)).toString(),
      vin: sources.map((address, inputIndex) => ({
        txid: (100 + caseIndex * 10 + inputIndex)
          .toString(16)
          .padStart(64, '0'),
        vout: 0,
        n: inputIndex,
        addresses: [address],
        isAddress: true,
        isOwn: address === fixture.userAddress,
        value: '100000000',
        sequence: 0xffffffff,
      })),
      vout: [
        {
          n: 0,
          addresses: [fixture.recipientAddress],
          isAddress: true,
          isOwn: false,
          value: (inputValue - BigInt(50001000)).toString(),
        },
        {
          n: 1,
          addresses: [fixture.userAddress],
          isAddress: true,
          isOwn: true,
          value: '50000000',
        },
      ],
    };
  });
  const rawTransactions = Object.fromEntries(
    transactions.map((transaction) => [
      transaction.txid,
      {
        ...transaction,
        // JSON serialization omits these account-only flags in raw /tx replies.
        vin: transaction.vin.map((input) => ({ ...input, isOwn: undefined })),
        vout: transaction.vout.map((output) => ({
          ...output,
          isOwn: undefined,
        })),
      },
    ])
  );
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const expectedCopies: string[] = [];
  let observedCopies: string[] = [];
  const observations: {
    caseName: string;
    copied: string;
    fee: string;
    status: string;
  }[] = [];
  let readCountBeforeReopen: number | undefined;
  let readCountAfterReopen: number | undefined;
  let lastFeedbackObservedAt: number | undefined;

  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'UtxoSourceAddressesSynthetic!2026',
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('utxo-transaction-source-addresses', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url,
      { readState: () => ({ transactions, rawTransactions }) }
    );
    const page = wallet.page;
    const step = (name: string, action: () => Promise<void>) =>
      wallet!.step(name, async (capture) => {
        try {
          await action();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      });
    const row = (txid: string) =>
      page
        .getByText(txid.slice(0, 4) + '...' + txid.slice(-14), { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    const field = (name: string) =>
      page.getByText(name, { exact: true }).locator('..');
    const detailReadCount = (txid: string) =>
      routes!.reads.filter((read) => read === '/api/v2/tx/' + txid).length;
    const openDetails = async (txid: string) => {
      await row(txid)
        .getByRole('button', {
          name: en.notifications.clickToView,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/#\/home\/details/);
      await expect(field('From')).toBeVisible();
      await expect.poll(() => detailReadCount(txid)).toBeGreaterThan(0);
      await expect(
        field('Fees').getByText('0.00001 TSYS', { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(en.send.confirmed, { exact: true })
      ).toBeVisible();
    };
    const backToActivity = async () => {
      await page
        .getByRole('button', { name: en.buttons.back, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/home(?:[?#]|$)/);
      await page.locator('#activity-btn').click();
      await expect(row(cases[0].txid)).toBeVisible();
    };
    const checkAndCopyFrom = async (caseName: string, value: string) => {
      const copyNotice = page.getByText(en.home.addressCopied, { exact: true });
      if (lastFeedbackObservedAt !== undefined) {
        await expect
          .poll(() => page.evaluate(() => Date.now()))
          .toBeGreaterThanOrEqual(
            lastFeedbackObservedAt + COPY_NOTICE_DEDUP_MS
          );
      }
      // Do not let an exiting prior toast satisfy this copy's feedback check.
      await expect(copyNotice).toHaveCount(0);
      const from = field('From');
      await from.locator('span > div').first().hover();
      await expect(
        page.getByRole('tooltip').getByText(value, { exact: true })
      ).toBeVisible();
      await from.getByRole('button').click();
      expectedCopies.push(value);
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__utxoSourceAddressCopies)
        )
        .toEqual(expectedCopies);
      observedCopies = await page.evaluate(
        () => (window as any).__utxoSourceAddressCopies as string[]
      );
      await expect(copyNotice).toBeVisible();
      lastFeedbackObservedAt = await page.evaluate(() => Date.now());
      observations.push({
        caseName,
        copied: observedCopies[observedCopies.length - 1],
        fee: await field('Fees').innerText(),
        status: await page
          .getByText(en.send.confirmed, { exact: true })
          .innerText(),
      });
    };

    await step(
      'open ordinary Activity with three confirmed synthetic HTTP rows',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        // Control only this public browser API boundary. This is not an OS
        // clipboard-interoperability test and never decorates wallet/controller state.
        await page.evaluate(
          (allowedValues) => {
            (window as any).__utxoSourceAddressCopies = [];
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              value: {
                writeText: async (value: string) => {
                  if (!allowedValues.includes(value))
                    throw new Error('Unexpected non-fixture clipboard value');
                  (window as any).__utxoSourceAddressCopies.push(value);
                },
              },
            });
          },
          [
            fixture.userAddress,
            fixture.userAddress + ', ' + fixture.sponsorAddress,
          ]
        );
        await page.locator('#activity-btn').click();
        for (const entry of cases) await expect(row(entry.txid)).toBeVisible();
        expect(
          routes!.reads.some((read) => read.startsWith('/api/v2/xpub/'))
        ).toBe(true);
      }
    );

    await step(
      'single input preserves the full source copy and exact confirmed fee',
      async () => {
        await openDetails(cases[0].txid);
        await checkAndCopyFrom('single', fixture.userAddress);
      }
    );

    await step(
      'duplicate source inputs produce only one copied address',
      async () => {
        await backToActivity();
        await openDetails(cases[1].txid);
        await checkAndCopyFrom('duplicate', fixture.userAddress);
      }
    );

    await step(
      'later distinct input remains in the tooltip and full source copy',
      async () => {
        await backToActivity();
        await openDetails(cases[2].txid);
        await checkAndCopyFrom(
          'multiple',
          fixture.userAddress + ', ' + fixture.sponsorAddress
        );
      }
    );

    await step(
      'normal Back and reopen retain every source without a duplicate body fetch',
      async () => {
        readCountBeforeReopen = detailReadCount(cases[2].txid);
        await backToActivity();
        await openDetails(cases[2].txid);
        await checkAndCopyFrom(
          'reopened-multiple',
          fixture.userAddress + ', ' + fixture.sponsorAddress
        );
        readCountAfterReopen = detailReadCount(cases[2].txid);
        expect(readCountAfterReopen).toBe(readCountBeforeReopen);
      }
    );

    await step(
      'retain source-address evidence and the unchanged fenced runtime',
      async () => {
        expect(expectedCopies).toEqual([
          fixture.userAddress,
          fixture.userAddress,
          fixture.userAddress + ', ' + fixture.sponsorAddress,
          fixture.userAddress + ', ' + fixture.sponsorAddress,
        ]);
        for (const entry of cases)
          expect(detailReadCount(entry.txid)).toBeGreaterThan(0);
        expect(routes!.deniedWrites).toEqual([]);
        expect(routes!.syntheticBroadcasts).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
        ).toBe(testSourceSha256);
      }
    );
    status = info.errors.length === 0 ? 'passed' : 'failed';
  } finally {
    try {
      await info.attach('utxo-transaction-source-addresses-evidence', {
        body: JSON.stringify(
          {
            ...runtime,
            testSourceSha256,
            syntheticHttpOnly: true,
            syntheticConfirmations: true,
            controllerStateReplaced: false,
            controllerResultReplaced: false,
            clipboardBoundary:
              'controlled public writeText API; not OS clipboard interoperability',
            ownershipClaim:
              'source-script addresses only; the second address is a different synthetic account',
            cases: cases.map(({ name, txid, sources }) => ({
              name,
              txid,
              sources,
            })),
            observations,
            expectedCopies,
            observedCopies,
            readCountBeforeReopen,
            readCountAfterReopen,
            reads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            deniedUnknown: routes?.deniedUnknown ?? [],
            syntheticBroadcasts: routes?.syntheticBroadcasts ?? [],
            // Chromium may probe denied services. Non-forwarding proxy denials
            // are recorded honestly, not incorrectly asserted to be absent.
            proxyBlocked: server?.blocked ?? [],
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
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
          Object.assign(E2E_CONFIG, previousConfig);
        }
      }
    }
  }
});
