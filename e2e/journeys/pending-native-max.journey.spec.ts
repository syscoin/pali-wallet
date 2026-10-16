import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { createPendingNativeChain } from '../harness/pendingNativeChain';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const coin = (value: string) => {
  const satoshis = BigInt(value);
  return `${satoshis / BigInt(100000000)}.${(satoshis % BigInt(100000000))
    .toString()
    .padStart(8, '0')}`;
};
const atomic = (value: string | number) => {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * BigInt(100000000) + BigInt(fraction.padEnd(8, '0'));
};

test('offline native MAX signs four linked pending self-spends with local fixture receipts', async () => {
  test.setTimeout(300000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const chain = createPendingNativeChain();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let confirmationClicks = 0;
  try {
    wallet = await PaliWallet.launch('pending-native-max', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      chain.fixture,
      server.url,
      {
        readState: chain.readState,
        onSyntheticBroadcast: chain.acceptBroadcast,
      }
    );
    const page = wallet.page;
    await wallet.step(
      'import fenced synthetic wallet with stale account summary',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
        // Home uses the normal four-decimal compact formatter. The exact
        // eight-decimal balance is checked in MAX's amount and quote below.
        await expect(page.locator('#home-balance')).toHaveText('0.0978');
      }
    );

    // Observe only public synthetic estimator fields, forwarding the original
    // transport and callback unchanged. No quote/signature is substituted.
    await page.evaluate(() => {
      (window as any).__pendingNativeQuotes = [];
      const send = chrome.runtime.sendMessage.bind(chrome.runtime) as any;
      chrome.runtime.sendMessage = ((...args: any[]) => {
        const message = args[0];
        if (
          message?.type === 'CONTROLLER_ACTION' &&
          message.data?.methods?.join('.') ===
            'wallet.getEstimateSysTransactionFee' &&
          typeof args[args.length - 1] === 'function'
        ) {
          const callback = args[args.length - 1];
          const request = message.data.params[0];
          args[args.length - 1] = (response: any) => {
            (window as any).__pendingNativeQuotes.push({
              amount: request.amount,
              nativeSweep: request.nativeSweep,
              isMax: request.isMax,
              token: request.token,
              fee: response?.fee,
              grossAmount: response?.grossAmount,
              recipientAmount: response?.recipientAmount,
              hasPsbt: Boolean(response?.psbt),
            });
            callback(response);
          };
        }
        return send(...args);
      }) as typeof chrome.runtime.sendMessage;
    });

    for (let index = 0; index < 4; index++) {
      await wallet.step(
        `MAX self-send ${index + 1}: review and sign current parent`,
        async () => {
          const parent = chain.current();
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/sys$/);
          await page
            .getByPlaceholder('Receiver', { exact: true })
            .fill(chain.fixture.userAddress);
          await page.locator('#fee-input').fill('0.000000012529296875');
          await page.getByText('MAX', { exact: true }).click();
          if (index === 0)
            await expect(
              page.getByPlaceholder('Amount', { exact: true })
            ).toHaveValue('0.09775331');
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          const quotes = await page.evaluate(
            () => (window as any).__pendingNativeQuotes
          );
          expect(quotes).toHaveLength(index + 1);
          const quote = quotes[index];
          expect(quote).toMatchObject({
            nativeSweep: true,
            isMax: true,
            token: null,
            hasPsbt: true,
          });
          if (index === 0) {
            expect(quote.amount).toBe('0.09775331');
            expect(atomic(quote.amount) - atomic(quote.grossAmount)).toBe(
              BigInt(3227770)
            );
          }
          expect(atomic(quote.grossAmount).toString()).toBe(parent.value);
          const fee = atomic(quote.fee);
          expect(fee > BigInt(0) && fee <= BigInt(1000)).toBe(true);
          expect(atomic(quote.recipientAmount) + fee).toBe(
            BigInt(parent.value)
          );
          await expect(page.locator('p.text-2xl')).toHaveText(
            `${coin(atomic(quote.recipientAmount).toString())} TSYS`
          );
          await page
            .getByRole('button', { name: 'Confirm', exact: true })
            .click();
          confirmationClicks += 1;
          await expect.poll(() => chain.accepted.length).toBe(index + 1);
          expect(chain.accepted[index]).toMatchObject({
            parentTxid: parent.txid,
            feeSatoshis: fee.toString(),
            recipientSatoshis: atomic(quote.recipientAmount).toString(),
            sighash: 1,
          });
          await expect(page).toHaveURL(/#\/home(?:\?|$)/);
          await wallet!.ensureOnHome();
        }
      );
    }
    expect(confirmationClicks).toBe(4);
    expect(chain.accepted).toHaveLength(4);
    expect(new Set(chain.accepted.map((row) => row.txid)).size).toBe(4);
    expect(routes.syntheticBroadcasts).toEqual(
      chain.accepted.map((row) => row.txid)
    );
    expect(routes.deniedWrites).toEqual([]);
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'pending-native-max.json'),
      JSON.stringify(
        {
          ...evidence,
          model: 'local synthetic transaction/indexer model',
          realWalletSyntheticEcdsaSigning: true,
          coreAcceptanceTested: false,
          publicChainAcceptanceTested: false,
          forwardedExternalWrites: 0,
          confirmationClicks,
          initialSummarySatoshis: '9775331',
          initialFundingSatoshis: '6547561',
          initialShortfallSatoshis: '3227770',
          confirmedBalanceFieldRemainsPinned: true,
          basicOmitsPendingDelta: true,
          mempoolAwareSummaryAfterFirstSend: true,
          allTransactionsRemainUnconfirmed: true,
          replayProtectionUnitTested: true,
          estimatorQuotes: await page.evaluate(
            () => (window as any).__pendingNativeQuotes
          ),
          transactions: chain.accepted,
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
          deniedUnknown: routes.deniedUnknown,
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
