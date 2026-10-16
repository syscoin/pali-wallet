import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { createPendingNativeChain } from '../harness/pendingNativeChain';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  importFixturePsbt,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
  UtxoFixtureReadState,
} from '../harness/utxoFixture';

// This is a deliberately lagging indexer, unlike pending-native-max's
// immediately coherent model. Its POST ACK advances the independent signer
// model, but GET UTXOs and balances stay at the already-spent parent until this
// test explicitly lets the indexer catch up. No clocks or wallet state change.
test('native MAX must not prepare an acknowledged spent parent while the indexer lags', async () => {
  test.setTimeout(240000);
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
  let indexed: UtxoFixtureReadState = chain.readState();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineDelayedIndexerOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes: Awaited<ReturnType<typeof installUtxoFixtureRoutes>> | undefined;
  let confirmationClicks = 0;
  let caughtUpCount = 0;
  let passed = false;
  let popupDocumentReopened = false;
  let workerRestarted = false;
  const restartWorkerIdentities: unknown[] = [];
  const acknowledgedSpent = new Set<string>();
  const observations: Array<{
    errorCode?: string;
    hasPsbt: boolean;
    outpoints: string[];
    phase: string;
    spentAtQuote: string[];
    unsignedSha256?: string;
  }> = [];
  const outpoints = (exported: any) => {
    const psbt = importFixturePsbt(exported);
    return {
      outpoints: psbt.txInputs.map(
        (input: any) =>
          `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`
      ) as string[],
      unsignedSha256: createHash('sha256')
        .update(psbt.data.globalMap.unsignedTx.toBuffer())
        .digest('hex'),
    };
  };
  try {
    wallet = await PaliWallet.launch('delayed-indexer-native-max', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installUtxoFixtureRoutes(
      wallet.context,
      chain.fixture,
      server.url,
      {
        readState: () => ({
          ...indexed,
          // The tx endpoint may already know an ACKed transaction while the
          // account UTXO projection remains stale. This does not hide its inputs
          // from Pali's normal post-send history refresh.
          rawTransactions: chain.readState().rawTransactions,
        }),
        onSyntheticBroadcast: (raw) => {
          const receipt = chain.acceptBroadcast(raw);
          const accepted = chain.accepted[chain.accepted.length - 1];
          acknowledgedSpent.add(`${accepted.parentTxid}:0`);
          return receipt;
        },
      }
    );
    const page = wallet.page;
    await wallet.step(
      'import the synthetic wallet with a controlled native funding parent',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
      }
    );
    const observeQuotes = async () =>
      page.evaluate(() => {
        const win = window as any;
        win.__delayedIndexerQuotes = [];
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
            args[args.length - 1] = (response: any) => {
              // Observe public synthetic quote fields; forward the original
              // transport response and callback unchanged, never substitute it.
              win.__delayedIndexerQuotes.push({
                psbt: response?.psbt,
                errorCode: response?.error?.code || response?.code,
              });
              callback(response);
            };
          }
          return send(...args);
        }) as typeof chrome.runtime.sendMessage;
      });
    await observeQuotes();
    const prepare = async (phase: string) => {
      const priorCount = await page.evaluate(
        () => (window as any).__delayedIndexerQuotes.length
      );
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__delayedIndexerQuotes.length)
        )
        .toBe(priorCount + 1);
      const quote = await page.evaluate(
        (index) => (window as any).__delayedIndexerQuotes[index],
        priorCount
      );
      const observation = {
        phase,
        hasPsbt: Boolean(quote.psbt),
        ...(quote.psbt
          ? outpoints(quote.psbt)
          : { outpoints: [], errorCode: String(quote.errorCode || '') }),
        spentAtQuote: [] as string[],
      };
      observation.spentAtQuote = observation.outpoints.filter((input) =>
        acknowledgedSpent.has(input)
      );
      observations.push(observation);
      return observation;
    };
    const form = async () => {
      await page.locator('#send-btn').click();
      await page
        .getByPlaceholder('Receiver', { exact: true })
        .fill(chain.fixture.userAddress);
      await page.locator('#fee-input').fill('0.00000002');
      await page.getByText('MAX', { exact: true }).click();
    };
    for (let index = 0; index < 3; index++) {
      await wallet.step(
        `coherent send ${index + 1}: review and acknowledge one current parent`,
        async () => {
          if (index === 0) await form();
          const parent = chain.current();
          const quote = await prepare(`coherent-before-ack-${index + 1}`);
          expect(quote.hasPsbt).toBe(true);
          expect(quote.outpoints).toEqual([`${parent.txid}:0`]);
          expect(
            quote.outpoints.some((input) => acknowledgedSpent.has(input))
          ).toBe(false);
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          await page
            .getByRole('button', { name: 'Confirm', exact: true })
            .click();
          confirmationClicks += 1;
          await expect.poll(() => chain.accepted.length).toBe(index + 1);
          await expect(page).toHaveURL(/#\/home(?:\?|$)/);
          await wallet!.ensureOnHome();
        }
      );
      await wallet.step(
        `ACK ${index + 1}: stale GET must not prepare its already-spent parent`,
        async () => {
          if (index === 1 || index === 2) {
            if (index === 2) {
              const cdp = await wallet!.context.newCDPSession(page);
              const { targetInfos } = await cdp.send('Target.getTargets');
              const worker = targetInfos.find(
                (target) =>
                  target.type === 'service_worker' &&
                  target.url.startsWith(
                    `chrome-extension://${wallet!.extensionId}/`
                  )
              );
              expect(worker).toBeTruthy();
              expect(
                (
                  await cdp.send('Target.closeTarget', {
                    targetId: worker!.targetId,
                  })
                ).success
              ).toBe(true);
              await cdp.detach();
              workerRestarted = true;
            }
            await page.reload();
            await wallet!.waitAppReady();
            if (await page.locator('#unlock-btn').isVisible())
              await wallet!.unlock();
            await wallet!.ensureOnHome();
            await observeQuotes();
            popupDocumentReopened = true;
            if (index === 2)
              await verifyExecutingWorker(
                wallet!.context,
                wallet!.extensionId,
                extensionPath,
                (value) => restartWorkerIdentities.push(value)
              );
          }
          await form();
          const quote = await prepare(`lagging-after-ack-${index + 1}`);
          // The test stops before another Confirm on any unsafe candidate. An
          // optimistic pending-child quote or a clear refusal is acceptable;
          // preparing the ACKed old outpoint is not.
          expect(quote.spentAtQuote).toEqual([]);
          if (quote.hasPsbt) {
            expect(quote.outpoints).toEqual([`${chain.current().txid}:0`]);
            await expect(page).toHaveURL(/#\/send\/confirm$/);
            await page
              .getByRole('button', { name: 'Back', exact: true })
              .click();
          } else {
            await expect(page).toHaveURL(/#\/send\/sys$/);
            await expect(
              page
                .getByText(
                  /pending|wait|refresh|spent|indexer|updating|try again shortly/i
                )
                .first()
            ).toBeVisible();
          }
          expect(confirmationClicks).toBe(index + 1);
          expect(chain.accepted).toHaveLength(index + 1);
          // Only the indexer's public projection changes, not wallet/controller
          // state. The following normal Next must become usable again.
          indexed = chain.readState();
          caughtUpCount += 1;
        }
      );
    }
    // Verify the last coherent parent is reviewable after the third catch-up,
    // but do not request a fourth signature or synthetic broadcast.
    await wallet.step(
      'after indexer catch-up the next unsigned review uses the new unspent parent',
      async () => {
        const quote = await prepare('final-caught-up-review-only');
        expect(quote.hasPsbt).toBe(true);
        expect(quote.outpoints).toEqual([`${chain.current().txid}:0`]);
        expect(
          quote.outpoints.some((input) => acknowledgedSpent.has(input))
        ).toBe(false);
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(chain.accepted).toHaveLength(3);
        expect(confirmationClicks).toBe(3);
        expect(routes!.deniedWrites).toEqual([]);
      }
    );
    passed = true;
  } finally {
    await wallet?.dispose(passed ? 'passed' : 'failed');
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'delayed-indexer-native-max.json'),
      JSON.stringify(
        {
          ...evidence,
          status: passed ? 'passed' : 'failed',
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          simulated: true,
          realWalletSyntheticEcdsaSigning: true,
          publicChainAcceptanceTested: false,
          forwardedExternalWrites: 0,
          confirmationClicks,
          acknowledgedSyntheticTransactions: chain.accepted,
          acknowledgedSpentOutpoints: [...acknowledgedSpent],
          observations,
          unsafePreparedQuotes: observations.filter(
            (row) =>
              row.phase.startsWith('lagging-') && row.spentAtQuote.length > 0
          ),
          indexerCatchups: caughtUpCount,
          popupDocumentReopened,
          workerRestarted,
          restartWorkerIdentities,
          fixtureReads: routes?.reads,
          syntheticBroadcasts: routes?.syntheticBroadcasts,
          deniedWrites: routes?.deniedWrites,
          deniedUnknown: routes?.deniedUnknown,
          proxyDeniedConnections: server.blocked.length,
          browserQaSessionsClosed: true,
        },
        null,
        2
      ),
      { flag: 'wx', mode: 0o600 }
    );
    Object.assign(E2E_CONFIG, before);
    await server.close();
  }
});
