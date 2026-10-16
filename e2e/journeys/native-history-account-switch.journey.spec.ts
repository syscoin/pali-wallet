import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { createIsolatedVaultFixture } from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  fixtureRead,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
  UTXO_SPONSOR_PATH,
} from '../harness/utxoFixture';

test('offline native history survives A → B transient failure → A through normal account UI', async () => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  // The existing fixture derives account 1 normally from the public test seed.
  // No human account, persisted browser profile or controller state is used.
  const { utxo: fixture, secondUtxo: second } = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  const selfId = '51'.repeat(32),
    externalId = '52'.repeat(32),
    secondId = '53'.repeat(32),
    receivedId = '55'.repeat(32);
  const fullSelf = {
    txid: selfId,
    confirmations: 0,
    blockHeight: 0,
    blockTime: 1791600000,
    fees: '226',
    valueIn: '6547561',
    value: '6547335',
    vin: [{ addresses: [fixture.userAddress], value: '6547561' }],
    vout: [{ addresses: [fixture.userAddress], value: '6547335' }],
  };
  const fullExternal = {
    ...fullSelf,
    txid: externalId,
    confirmations: 1,
    blockHeight: 1,
    blockHash: '54'.repeat(32),
    valueIn: '100000226',
    value: '100000000',
    vin: [{ addresses: [fixture.userAddress], value: '100000226' }],
    vout: [
      { addresses: [fixture.recipientAddress], value: '70000000' },
      { addresses: [fixture.userAddress], value: '30000000' },
    ],
  };
  const fullReceived = {
    ...fullExternal,
    txid: receivedId,
    vin: [{ addresses: [fixture.recipientAddress], value: '100000226' }],
    vout: [
      { addresses: [fixture.userAddress], value: '70000000' },
      { addresses: [fixture.recipientAddress], value: '30000000' },
    ],
  };
  const summaries = [
    {
      ...fullSelf,
      vin: [],
      vout: [],
      direction: 'sent',
      addressValueIn: '6547561',
      addressValueOut: '6547335',
    },
    {
      ...fullExternal,
      vin: [],
      vout: [],
      direction: 'sent',
      // txsummary aliases are account totals, unlike txslight global totals.
      value: '30000000',
      addressValueIn: '100000226',
      addressValueOut: '30000000',
    },
    {
      ...fullReceived,
      vin: [],
      vout: [],
      direction: 'received',
      valueIn: '0',
      value: '70000000',
      addressValueIn: '0',
      addressValueOut: '70000000',
    },
  ];
  const legacySecond = {
    ...fullExternal,
    txid: secondId,
    valueIn: '200000226',
    value: '200000000',
    // A genuine account-scoped txslight response omits addressValueIn/out;
    // only these explicit server ownership flags identify its account totals.
    vin: [{ addresses: [second.address], value: '200000226', isOwn: true }],
    vout: [
      { addresses: [fixture.recipientAddress], value: '150000000' },
      { addresses: [second.address], value: '50000000', isOwn: true },
    ],
  };
  const secondSummary = {
    ...legacySecond,
    vin: [],
    vout: [],
    addressValueIn: '200000226',
    addressValueOut: '50000000',
  };
  const rawTransactions = {
    [selfId]: fullSelf,
    [externalId]: fullExternal,
    [receivedId]: fullReceived,
    [secondId]: {
      ...legacySecond,
      vin: legacySecond.vin.map(({ addresses, value }) => ({
        addresses,
        value,
      })),
      vout: legacySecond.vout.map(({ addresses, value }) => ({
        addresses,
        value,
      })),
    },
  };
  type Phase = 'initial-a' | 'account-b' | 'return-a';
  let phase: Phase = 'initial-a';
  let transientFailures = 0;
  const historyReads: Array<{
    account: 'A' | 'B';
    details: string;
    phase: Phase;
    result: 'ok' | 'timedout';
  }> = [];
  const deniedWrites: string[] = [],
    deniedUnknown: string[] = [];
  const fullTransactionReads: Array<{ phase: Phase; txid: string }> = [];
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('native-history-account-switch', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    await wallet.context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (
        url.origin === server.url &&
        url.pathname === '/' &&
        request.method() === 'GET'
      )
        return route.continue();
      if (
        request.method() !== 'GET' ||
        /\/sendtx(?:\/|$)/i.test(url.pathname)
      ) {
        deniedWrites.push(request.method() + ' ' + url.pathname);
        return route.abort('blockedbyclient');
      }
      if (
        url.username ||
        url.password ||
        url.hash ||
        ![
          'https://blockbook-dev.syscoin.org',
          'https://explorer-blockbook-dev.syscoin.org',
        ].includes(url.origin)
      ) {
        deniedUnknown.push(request.method() + ' ' + url.origin + url.pathname);
        return route.abort('blockedbyclient');
      }
      const accountPath = url.pathname.match(
        /^\/api\/v2\/(xpub|address)\/(.+)$/
      );
      const identifier = accountPath
        ? decodeURIComponent(accountPath[2])
        : null;
      const account =
        identifier === fixture.userXpub || identifier === fixture.userAddress
          ? 'A'
          : identifier === second.xpub || identifier === second.address
          ? 'B'
          : null;
      const details = url.searchParams.get('details') || '';
      if (
        account === 'B' &&
        details === 'txsummary' &&
        transientFailures === 0
      ) {
        transientFailures += 1;
        historyReads.push({ account, details, phase, result: 'timedout' });
        // One exact local GET fails. No browser clocks, SDK methods, responses
        // or controller state are replaced; its ordinary catch must fall back.
        return route.abort('timedout');
      }
      if (account && details.startsWith('txs'))
        historyReads.push({ account, details, phase, result: 'ok' });
      const transactionId = url.pathname.match(
        /^\/api\/v2\/tx\/([a-f0-9]{64})$/i
      )?.[1];
      if (transactionId)
        fullTransactionReads.push({ phase, txid: transactionId });
      const mapped = new URL(url);
      if (account === 'B')
        mapped.pathname = `/api/v2/${accountPath![1]}/${encodeURIComponent(
          fixture.userXpub
        )}`;
      let body: any = fixtureRead(
        fixture,
        mapped.toString(),
        request.method(),
        {
          balance: account === 'B' ? '50000000' : '10000000',
          unconfirmedTxs: account === 'B' ? 0 : 1,
          transactions:
            account === 'B'
              ? details === 'txsummary'
                ? [secondSummary]
                : [legacySecond]
              : details === 'txsummary'
              ? summaries
              : [fullSelf, fullExternal, fullReceived],
          rawTransactions,
        }
      );
      if (account === 'B' && body !== undefined)
        body = {
          ...body,
          address: identifier,
          tokens: [
            {
              type: 'XPUBAddress',
              name: second.address,
              path: UTXO_SPONSOR_PATH,
              balance: '50000000',
              totalReceived: '50000000',
              totalSent: '0',
              transfers: 1,
            },
          ],
        };
      if (body === undefined) {
        deniedUnknown.push(request.method() + ' ' + url.origin + url.pathname);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    const page = wallet.page;
    const row = (id: string) =>
      page
        .getByText(`${id.slice(0, 4)}...${id.slice(-14)}`, { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    const assertBlankAmount = async (id: string) => {
      await expect(row(id)).toBeVisible();
      await expect(row(id).getByText(/\bTSYS\b/)).toHaveCount(0);
      for (const placeholder of [en.buttons.loading, en.settings.unavailable])
        await expect(
          row(id).getByText(placeholder, { exact: true })
        ).toHaveCount(0);
    };
    const assertAccount = async (id: number, address: string) => {
      await wallet!.ensureOnHome();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              new Promise<any>((resolve, reject) => {
                chrome.runtime.sendMessage(
                  { type: 'getCurrentState' },
                  (state) => {
                    if (chrome.runtime.lastError || !state?.vault) {
                      reject(
                        new Error('Public account projection unavailable')
                      );
                      return;
                    }
                    const vault = state.vault,
                      ref = vault.activeAccount;
                    resolve({
                      id: ref.id,
                      type: ref.type,
                      address: vault.accounts?.[ref.type]?.[ref.id]?.address,
                    });
                  }
                );
              })
          )
        )
        .toEqual({ id, type: 'HDAccount', address });
      await page.locator('#activity-btn').click();
    };
    const assertAValues = async (hasDetails: boolean) => {
      if (hasDetails) {
        await expect(
          row(selfId).getByText('0.065473 TSYS', { exact: true })
        ).toBeVisible();
        await expect(
          row(externalId).getByText('−0.700000 TSYS', { exact: true })
        ).toBeVisible();
      } else {
        await assertBlankAmount(selfId);
        await assertBlankAmount(externalId);
      }
      // An incoming account total is already exact in txsummary and does not
      // require the global input/output arrays to determine its transfer value.
      await expect(
        row(receivedId).getByText('+0.700000 TSYS', { exact: true })
      ).toBeVisible();
      for (const id of [selfId, externalId, receivedId])
        for (const placeholder of [en.buttons.loading, en.settings.unavailable])
          await expect(
            row(id).getByText(placeholder, { exact: true })
          ).toHaveCount(0);
    };
    const openDetailsAndBack = async (id: string, amount: string) => {
      await row(id).locator('svg.cursor-pointer').last().click();
      await expect(page).toHaveURL(/#\/home\/details/);
      await expect(page.getByText(amount, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/#\/home/);
      await page.locator('#activity-btn').click();
    };
    await wallet.step(
      'account A shows exact incoming summary and blank ambiguous spends without per-row reads',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await assertAccount(0, fixture.userAddress);
        await assertAValues(false);
        expect(fullTransactionReads).toEqual([]);
        expect(
          historyReads.some(
            (read) => read.account === 'A' && read.details === 'txsummary'
          )
        ).toBe(true);
      }
    );
    await wallet.step(
      'Details fetches each requested transaction once and Back shows its verified native amount',
      async () => {
        await openDetailsAndBack(selfId, '0.06547335 TSYS');
        await expect(
          row(selfId).getByText('0.065473 TSYS', { exact: true })
        ).toBeVisible();
        await assertBlankAmount(externalId);
        expect(fullTransactionReads.map((read) => read.txid)).toEqual([selfId]);
        await openDetailsAndBack(externalId, '0.7 TSYS');
        await assertAValues(true);
        expect(fullTransactionReads.map((read) => read.txid)).toEqual([
          selfId,
          externalId,
        ]);
      }
    );
    await wallet.step(
      'normal account creation selects B; one transient summary failure uses owned legacy fallback',
      async () => {
        phase = 'account-b';
        await page.locator('#general-settings-button').click();
        await page
          .getByText(en.accountMenu.createNewAccount, { exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/account\/new$/);
        await page
          .locator('#account-name-input')
          .fill('Native history account B');
        await page.locator('#create-btn').click();
        const ok = page.getByRole('button', { name: /^ok$/i }).first();
        await expect(ok).toBeVisible();
        await ok.click();
        await assertAccount(1, second.address);
        await expect
          .poll(() =>
            historyReads.some(
              (read) =>
                read.account === 'B' &&
                read.details === 'txslight' &&
                read.result === 'ok'
            )
          )
          .toBe(true);
        expect(transientFailures).toBe(1);
        await expect(
          row(secondId).getByText('−1.5000 TSYS', { exact: true })
        ).toBeVisible();
        await expect(
          row(secondId).getByText(en.settings.unavailable, { exact: true })
        ).toHaveCount(0);
        await expect(row(selfId)).toHaveCount(0);
        await expect(row(externalId)).toHaveCount(0);
        await expect(row(receivedId)).toHaveCount(0);
        expect(fullTransactionReads).toHaveLength(2);
      }
    );
    await wallet.step(
      'normal account selection returns to A without inheriting the failed backend capability flag',
      async () => {
        phase = 'return-a';
        await page.locator('#general-settings-button').click();
        await page
          .locator('#account-HDAccount-0')
          .locator('span.truncate')
          .click();
        await assertAccount(0, fixture.userAddress);
        await expect
          .poll(() =>
            historyReads.some(
              (read) =>
                read.phase === 'return-a' &&
                read.account === 'A' &&
                read.details === 'txsummary' &&
                read.result === 'ok'
            )
          )
          .toBe(true);
        expect(
          historyReads.filter(
            (read) =>
              read.phase === 'return-a' &&
              read.account === 'A' &&
              read.details === 'txslight'
          )
        ).toEqual([]);
        await assertAValues(true);
        await expect(row(secondId)).toHaveCount(0);
        expect(fullTransactionReads).toHaveLength(2);
        expect(deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'document reload clears the Details memory cache without starting list transaction reads',
      async () => {
        await page.reload();
        await wallet!.waitAppReady();
        await assertAccount(0, fixture.userAddress);
        await assertAValues(false);
        await expect(row(secondId)).toHaveCount(0);
        expect(fullTransactionReads).toHaveLength(2);
        expect(deniedWrites).toEqual([]);
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'native-history-account-switch.json'),
      JSON.stringify(
        {
          ...evidence,
          simulated: true,
          publicNetworkTested: false,
          signingRequested: false,
          forwardedWrites: 0,
          transientFailure:
            'one exact account-B GET /api/v2/xpub/<synthetic-account>?details=txsummary aborted timedout',
          transientFailures,
          accountBUsesExplicitOwnedLegacyRows: true,
          listFullTransactionReadsBeforeDetails: 0,
          missingAmountsRemainBlank: true,
          detailsCacheSurvivesAccountRoundTrip: true,
          documentReloadClearsDetailsCache: true,
          accountASelfSatoshis: '6547335',
          accountAExternalSatoshis: '70000000',
          accountAReceivedSatoshis: '70000000',
          accountBExternalSatoshis: '150000000',
          historyReads,
          fullTransactionReads,
          deniedWrites,
          deniedUnknown,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
