import { expect, test } from '@playwright/test';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

for (const closeReadTab of [false, true]) {
  test(`a stalled public read does not queue account requests (closed tab=${closeReadTab})`, async ({}, info) => {
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const origin = new URL(server.url).origin;
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PublicReadQueueSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let releaseRead: (() => void) | undefined;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`public-read-queue-${closeReadTab}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        createIsolatedVaultFixture(),
        server.url
      );
      await wallet.step('open the disposable EVM wallet', async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      });
      const reader = await wallet.context.newPage();
      const requester = await wallet.context.newPage();
      for (const page of [reader, requester]) {
        await page.goto(origin);
        await page.waitForFunction(() => Boolean((window as any).pali));
      }
      let address: string;
      await wallet.step(
        'approve a normal connection and healthy public read',
        async () => {
          const id = await startRequest(requester, 'eth_requestAccounts');
          await popupFor(wallet!.context, requester, id);
          const response = await approve(wallet!.context, requester, id);
          expect(response.result).toHaveLength(1);
          address = response.result[0];
          expect(await providerRequest(reader, 'eth_blockNumber', [])).toBe(
            '0x1'
          );
        }
      );

      let readHeld = false;
      let readReleased = false;
      const held = new Promise<void>((resolve) => {
        releaseRead = () => {
          readReleased = true;
          resolve();
        };
      });
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          !readHeld &&
          calls.some((call) => call.method === 'eth_blockNumber')
        ) {
          readHeld = true;
          await held;
        }
        await route.fallback();
      });
      let readerId: number;
      await wallet.step(
        'hold an actual provider transport without replacing the controller',
        async () => {
          readerId = await startRequest(reader, 'eth_blockNumber', []);
          await expect.poll(() => readHeld).toBe(true);
          expect((await rpcObservation(reader, readerId)).settled).not.toBe(
            true
          );
          expect(readReleased).toBe(false);
          if (closeReadTab) await reader.close();
        }
      );
      await wallet.step(
        'complete an account request before the public transport is released',
        async () => {
          const id = await startRequest(requester, 'eth_requestAccounts');
          const response = await settle(requester, id, 5_000);
          expect(response.error).toBeUndefined();
          expect(response.result).toEqual([address!]);
          expect(readReleased).toBe(false);
          expect(
            wallet!.context
              .pages()
              .some((page) => page.url().includes('/external'))
          ).toBe(false);
        }
      );
      releaseRead!();
      await wallet.step(
        'retain normal provider reads after transport recovery',
        async () => {
          if (!closeReadTab) {
            const recovered = await settle(reader, readerId!);
            expect(recovered.result).toBe('0x1');
            expect(recovered.error).toBeUndefined();
          }
          expect(await providerRequest(requester, 'eth_blockNumber', [])).toBe(
            '0x1'
          );
          const id = await startRequest(requester, 'eth_requestAccounts');
          await settle(requester, id);
          expect((await rpcObservation(requester, id)).result).toEqual([
            address!,
          ]);
        }
      );
      expect(routes.deniedWrites).toEqual([]);
      await info.attach('public-read-queue-evidence', {
        body: JSON.stringify(
          {
            ...extensionEvidence(),
            closeReadTab,
            stalledReadHeldUntilAccountReply: true,
            controllerStateReplaced: false,
            deniedWrites: routes.deniedWrites,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
      status = 'passed';
    } finally {
      releaseRead?.();
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  });
}
