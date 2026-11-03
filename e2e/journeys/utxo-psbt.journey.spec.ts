import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import { inspectPsbtReviewHeader } from '../harness/psbtReviewHeader';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
  verifyCompletedSponsor,
  verifyFixtureSignature,
} from '../harness/utxoFixture';

test('offline UTXO: normal sign, cancel, and mixed-owner sponsor boundary', async ({}, info) => {
  test.setTimeout(180000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  const before = { ...E2E_CONFIG },
    fixture = createUtxoFixture(),
    server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let result: unknown;
  try {
    wallet = await PaliWallet.launch('offline-utxo-psbt', {
      offlineHttpProxy: server.url,
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.step(
      'import disposable synthetic seed and select UTXO testnet',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet!.ensureOnHome();
      }
    );
    // An app.html tab blocks approval popups. Reuse the driver as the fixture
    // dapp so ordinary step screenshots never target an empty about:blank tab.
    const dapp = wallet.page;
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    await wallet.step(
      'ordinary sys_requestAccounts connects only the synthetic account',
      async (capture) => {
        const account = await approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'sys_requestAccounts'),
          capture
        );
        expect(account.result).toEqual([fixture.userAddress]);
        const detail = await providerRequest(dapp, 'wallet_getAccount');
        expect(detail.address).toBe(fixture.userAddress);
        expect(detail.xpub).toBe(fixture.userXpub);
      }
    );
    await wallet.step(
      'worker REST and JSON-RPC broadcast denial canaries',
      async () => {
        const worker = wallet!.context.serviceWorkers()[0];
        const denied = await worker.evaluate(async () => {
          const send = async (url: string, init: RequestInit) => {
            try {
              await fetch(url, init);
              return false;
            } catch {
              return true;
            }
          };
          return Promise.all([
            send('https://blockbook-dev.syscoin.org/api/v2/sendtx/', {
              method: 'POST',
              body: 'fixture-not-a-transaction',
            }),
            send(
              'https://blockbook-dev.syscoin.org/api/v2/sendtx/fixture-not-a-transaction',
              { method: 'GET' }
            ),
            send('https://offline-pali.invalid/rpc', {
              method: 'POST',
              body: JSON.stringify({
                method: 'eth_sendRawTransaction',
                params: ['0x'],
              }),
            }),
          ]);
        });
        expect(denied).toEqual([true, true, true]);
        expect(routes.deniedWrites).toHaveLength(3);
        routes.deniedWrites.length = 0;
      }
    );
    await wallet.step(
      'cancel normal sys_sign without a signature or send',
      async (capture) => {
        const id = await startRequest(dapp, 'sys_sign', [fixture.single]);
        const popup = await popupFor(wallet!.context, dapp, id);
        await inspectPsbtReviewHeader(popup, info);
        await capture(popup);
        await popup
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        const cancelled = await settle(dapp, id);
        expect(cancelled.error?.code).toBe(4001);
        expect(cancelled.result).toBeUndefined();
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'normal sys_sign preserves amount/change and returns a valid user witness',
      async (capture) => {
        const signed = await approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'sys_sign', [fixture.single]),
          capture
        );
        verifyFixtureSignature(fixture, signed.result, false);
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    await wallet.step(
      'sponsorship signs only the user input and retains unsigned sponsor input',
      async (capture) => {
        const signed = await approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'sys_sign', [fixture.mixed]),
          capture
        );
        const partial = verifyFixtureSignature(fixture, signed.result, true);
        const userWitness = Buffer.from(
          partial.data.inputs[0].finalScriptWitness!
        );
        fixture.finishSponsor(partial);
        expect(
          Buffer.from(partial.data.inputs[0].finalScriptWitness!).equals(
            userWitness
          )
        ).toBe(true);
        result = {
          completedSyntheticTxid: verifyCompletedSponsor(fixture, partial),
          chainBroadcast: false,
        };
        expect(routes.deniedWrites).toEqual([]);
      }
    );
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'utxo-psbt.json'),
      JSON.stringify(
        {
          ...extensionEvidence(),
          simulated: true,
          liveBridgeTested: false,
          result,
          fixtureReads: routes.reads,
          deniedWrites: routes.deniedWrites,
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
