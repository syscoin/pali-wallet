import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { waitForFixtureInterception } from '../harness/fixtureReadiness';
import { createIsolatedVaultFixture } from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { createPendingNativeChain } from '../harness/pendingNativeChain';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  fixtureRead,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
  UTXO_SPONSOR_PATH,
} from '../harness/utxoFixture';

import type { BrowserContext, Page } from '@playwright/test';

type Fault = 'timeout' | 'rate-limit' | 'offline';
const modes = { quick: 4, standard: 24, soak: 64 } as const;
const atomic = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100000000) + BigInt(fraction.padEnd(8, '0'));
};
const coin = (value: string) => {
  const satoshis = BigInt(value);
  return `${satoshis / BigInt(100000000)}.${(satoshis % BigInt(100000000))
    .toString()
    .padStart(8, '0')}`;
};

// These are exact, read-only synthetic RPC methods, not a generic RPC forwarder.
function evmResult(method: string): unknown | undefined {
  switch (method) {
    case 'eth_chainId':
      return '0x1644';
    case 'net_version':
      return '5700';
    case 'eth_blockNumber':
      return '0x1';
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
      return '0x0';
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00';
    case 'eth_getCode':
    case 'eth_call':
      return '0x';
    case 'eth_getLogs':
      return [];
    case 'eth_getBlockByNumber':
      return {
        number: '0x1',
        hash: '0x' + '12'.repeat(32),
        parentHash: '0x' + '11'.repeat(32),
        nonce: '0x0000000000000000',
        timestamp: '0x1',
        difficulty: '0x0',
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        miner: '0x' + '00'.repeat(20),
        extraData: '0x',
        transactions: [],
        baseFeePerGas: '0x3b9aca00',
      };
    default:
      return undefined;
  }
}

test('offline sustained wallet stress: pending MAX, edits, vault switches, read failures and restarts', async () => {
  test.setTimeout(900000);
  const mode = process.env.PALI_QA_STRESS_MODE || 'standard';
  if (!(mode in modes))
    throw new Error('Stress mode must be quick, standard or soak');
  const iterations = modes[mode as keyof typeof modes];
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const chain = createPendingNativeChain();
  const other = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OfflineStressSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  const measurements: Array<{ durationMs: number; name: string }> = [];
  const rendererSamples: Array<Record<string, number | string>> = [];
  const storageSamples: Array<{
    changedKeys: number;
    changes: number;
    serializedChangedBytes: number;
    totalStoredBytes: number;
  }> = [];
  const pageErrors: string[] = [];
  const readFaults: Array<{ details: string; fault: Fault }> = [];
  const secondaryReads: string[] = [];
  const historyFullTransactionReadDeltas: number[] = [];
  const fixtureObservations: Array<
    Awaited<ReturnType<typeof installUtxoFixtureRoutes>>
  > = [];
  let fault: Fault | undefined;
  let wallet: PaliWallet | undefined;
  let confirmationClicks = 0;
  let cancelReviews = 0;
  let backReviews = 0;
  let workerRestarted = false;

  const timed = async (name: string, fn: () => Promise<void>) => {
    const start = Date.now();
    await fn();
    measurements.push({ name, durationMs: Date.now() - start });
  };
  const installRoutes = async (context: BrowserContext) => {
    const observation = await installUtxoFixtureRoutes(
      context,
      chain.fixture,
      server.url,
      {
        readState: () => {
          const state = chain.readState();
          return {
            ...state,
            // The receipt model retains global signed transaction fields.
            // Blockbook txsummary also supplies explicit account totals;
            // omitting those would intentionally leave a global row ambiguous.
            transactions: (state.transactions || []).map((row: any) => ({
              ...row,
              vin: [],
              vout: [],
              direction: 'sent',
              addressValueIn: row.valueIn,
              addressValueOut: row.value,
            })),
          };
        },
        onSyntheticBroadcast: chain.acceptBroadcast,
      }
    );
    fixtureObservations.push(observation);
    // Layer narrowly-scoped faults and second-vault reads ahead of the base
    // exact fixture fence. Everything else still reaches its deny-by-default.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const accountMatch = url.pathname.match(
        /^\/api\/v2\/(xpub|address|utxo)\/(.+)$/
      );
      const identifier = accountMatch
        ? decodeURIComponent(accountMatch[2])
        : '';
      const backend = [
        'https://blockbook-dev.syscoin.org',
        'https://explorer-blockbook-dev.syscoin.org',
      ].includes(url.origin);
      if (
        backend &&
        request.method() === 'GET' &&
        !url.username &&
        !url.password
      ) {
        if (
          fault &&
          identifier === chain.fixture.userXpub &&
          url.searchParams.get('details') === 'txsummary'
        ) {
          const injected = fault;
          fault = undefined;
          readFaults.push({ fault: injected, details: 'txsummary' });
          if (injected === 'rate-limit')
            return route.fulfill({
              status: 429,
              contentType: 'application/json',
              headers: {
                'retry-after': '0',
                'access-control-allow-origin': '*',
              },
              body: '{"error":"Synthetic rate limit"}',
            });
          return route.abort(
            injected === 'timeout' ? 'timedout' : 'internetdisconnected'
          );
        }
        if (
          [other.secondUtxo.xpub, other.secondUtxo.address].includes(identifier)
        ) {
          secondaryReads.push(
            'account-b:' + (url.searchParams.get('details') || accountMatch![1])
          );
          const mapped = new URL(url);
          mapped.pathname = `/api/v2/${accountMatch![1]}/${
            chain.fixture.userXpub
          }`;
          let body: any = fixtureRead(
            chain.fixture,
            mapped.toString(),
            request.method(),
            { balance: '0', utxos: [], transactions: [] }
          );
          if (body !== undefined && !Array.isArray(body))
            body = {
              ...body,
              address: identifier,
              tokens: [
                {
                  type: 'XPUBAddress',
                  name: other.secondUtxo.address,
                  path: UTXO_SPONSOR_PATH,
                  balance: '0',
                  totalReceived: '0',
                  totalSent: '0',
                  transfers: 0,
                },
              ],
            };
          if (body !== undefined)
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(body),
            });
        }
      }
      if (
        url.origin === 'https://rpc.tanenbaum.io' &&
        url.pathname === '/' &&
        request.method() === 'POST' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      ) {
        let rpc: any;
        try {
          rpc = request.postDataJSON();
        } catch {
          return route.fallback();
        }
        const calls = Array.isArray(rpc) ? rpc : [rpc];
        const replies = calls.map((call) => {
          if (!call || call.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return undefined;
          const result = evmResult(call.method);
          return result === undefined
            ? undefined
            : { jsonrpc: '2.0', id: call.id, result };
        });
        if (replies.length && replies.every((reply) => reply !== undefined)) {
          secondaryReads.push(...calls.map((call) => 'evm:' + call.method));
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
          });
        }
      }
      return route.fallback();
    });
  };
  const observeDocument = async (page: Page) => {
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.evaluate(() => {
      // Observe only change counts and byte lengths, never serialize vault
      // contents into artifacts. No controller or persisted state is replaced.
      const win = window as any;
      win.__paliStressStorage = {
        changes: 0,
        changedKeys: 0,
        serializedChangedBytes: 0,
      };
      chrome.storage.onChanged.addListener((changes) => {
        win.__paliStressStorage.changes += 1;
        win.__paliStressStorage.changedKeys += Object.keys(changes).length;
        win.__paliStressStorage.serializedChangedBytes +=
          new TextEncoder().encode(JSON.stringify(changes)).length;
      });
    });
  };
  const sample = async (name: string, collectGarbage = false) => {
    const page = wallet!.page;
    const session = await wallet!.context.newCDPSession(page);
    await session.send('Performance.enable');
    const metrics = (await session.send('Performance.getMetrics')).metrics;
    const select = (key: string) =>
      metrics.find((row) => row.name === key)?.value || 0;
    const frame = await page.evaluate(async () => {
      const delays: number[] = [];
      let previous = performance.now();
      for (let index = 0; index < 12; index++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        const current = performance.now();
        delays.push(current - previous);
        previous = current;
      }
      return {
        maxFrameMs: Math.max(...delays),
        meanFrameMs:
          delays.reduce((sum, value) => sum + value, 0) / delays.length,
      };
    });
    rendererSamples.push({
      name,
      jsHeapUsedBytes: select('JSHeapUsedSize'),
      domNodes: select('Nodes'),
      documents: select('Documents'),
      ...frame,
    });
    // Endpoint-only diagnostic: ordinary samples retain natural GC behavior.
    // A separate post-GC sample helps distinguish live retained heap from
    // transient allocation, and is never substituted for raw responsiveness.
    if (collectGarbage) {
      await session.send('HeapProfiler.collectGarbage');
      const collected = (await session.send('Performance.getMetrics')).metrics;
      const retained = (key: string) =>
        collected.find((row) => row.name === key)?.value || 0;
      rendererSamples.push({
        name: name + '-forced-gc-diagnostic',
        jsHeapUsedBytes: retained('JSHeapUsedSize'),
        domNodes: retained('Nodes'),
        documents: retained('Documents'),
      });
    }
    storageSamples.push(
      await page.evaluate(
        () =>
          new Promise<any>((resolve) =>
            chrome.storage.local.getBytesInUse(null, (totalStoredBytes) =>
              resolve({
                ...(window as any).__paliStressStorage,
                totalStoredBytes,
              })
            )
          )
      )
    );
    await session.detach();
  };
  const ensureHome = async () => {
    await wallet!.ensureOnHome();
    await expect(wallet!.page.locator('#send-btn')).toBeVisible();
  };
  const selection = async () =>
    wallet!.page.evaluate(
      () =>
        new Promise<any>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
            if (chrome.runtime.lastError || !state?.vault) {
              reject(new Error('Public account selection unavailable'));
              return;
            }
            const vault = state.vault;
            const ref = vault.activeAccount;
            resolve({
              kind: vault.activeNetwork.kind,
              id: ref.id,
              address: vault.accounts?.[ref.type]?.[ref.id]?.address,
            });
          });
        })
    );
  const assertHistory = async () => {
    const page = wallet!.page;
    const fullReads = () =>
      fixtureObservations.reduce(
        (sum, row) =>
          sum + row.reads.filter((url) => /^\/api\/v2\/tx\//.test(url)).length,
        0
      );
    const beforeReads = fullReads();
    await ensureHome();
    await expect
      .poll(selection)
      .toEqual({ kind: 'syscoin', id: 0, address: chain.fixture.userAddress });
    await page.locator('#activity-btn').click();
    const latest = chain.accepted[chain.accepted.length - 1];
    await expect(
      page.getByText(`${latest.txid.slice(0, 4)}...${latest.txid.slice(-14)}`, {
        exact: true,
      })
    ).toBeVisible();
    const latestRow = page
      .getByText(`${latest.txid.slice(0, 4)}...${latest.txid.slice(-14)}`, {
        exact: true,
      })
      .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    // Native Activity represents actual wallet movement, including fees. A
    // self-funded send therefore loses only its exact fee, not its output total.
    await expect(
      latestRow.getByText(`−${coin(latest.feeSatoshis)} TSYS`, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(en.settings.unavailable, { exact: true })
    ).toHaveCount(0);
    historyFullTransactionReadDeltas.push(fullReads() - beforeReads);
  };

  try {
    wallet = await PaliWallet.launch('offline-sustained-wallet-stress', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    await installRoutes(wallet.context);
    await wallet.step(
      'onboard the public synthetic wallet behind the launch-time deny proxy',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await ensureHome();
        await observeDocument(wallet!.page);
        await sample('baseline', true);
      }
    );
    for (let index = 0; index < iterations; index++) {
      await wallet.step(
        `pending MAX cycle ${
          index + 1
        }: edit, cancel or back, then sign exactly once`,
        async () => {
          const page = wallet!.page;
          const parent = chain.current();
          const rate = index % 2 ? '0.00000003' : '0.00000002';
          const prepare = async () => {
            await page
              .getByRole('button', { name: 'Next', exact: true })
              .click();
            await expect(page).toHaveURL(/#\/send\/confirm$/);
            await expect(
              page.getByRole('button', { name: 'Confirm', exact: true })
            ).toBeEnabled();
            const recipientText = (
              await page.locator('p.text-2xl').innerText()
            ).replace(/ TSYS$/, '');
            expect(atomic(recipientText)).toBeLessThan(BigInt(parent.value));
            return recipientText;
          };
          await timed('open-send-and-edit', async () => {
            await page.locator('#send-btn').click();
            await page
              .getByPlaceholder('Receiver', { exact: true })
              .fill(chain.fixture.userAddress);
            await page.locator('#fee-input').fill(rate);
            await page.getByText('MAX', { exact: true }).click();
          });
          let recipient = '';
          await timed('unsigned-review', async () => {
            recipient = await prepare();
          });
          await timed('cancel-or-back-and-reopen-review', async () => {
            const button = index % 2 ? 'Back' : 'Cancel';
            await page
              .getByRole('button', { name: button, exact: true })
              .click();
            if (button === 'Back') backReviews += 1;
            else cancelReviews += 1;
            await expect(page).toHaveURL(/#\/send\/sys$/);
            await expect(
              page.getByPlaceholder('Receiver', { exact: true })
            ).toHaveValue(chain.fixture.userAddress);
            expect(Number(await page.locator('#fee-input').inputValue())).toBe(
              Number(rate)
            );
            const repeated = await prepare();
            expect(repeated).toBe(recipient);
            expect(chain.accepted).toHaveLength(index);
          });
          await timed('confirm-through-synthetic-receipt', async () => {
            await page
              .getByRole('button', { name: 'Confirm', exact: true })
              .click();
            confirmationClicks += 1;
            await expect.poll(() => chain.accepted.length).toBe(index + 1);
            await expect(page).toHaveURL(/#\/home(?:\?|$)/);
            await ensureHome();
          });
          const accepted = chain.accepted[index];
          expect(accepted.parentTxid).toBe(parent.txid);
          expect(accepted.recipientSatoshis).toBe(atomic(recipient).toString());
          expect(
            BigInt(accepted.recipientSatoshis) + BigInt(accepted.feeSatoshis)
          ).toBe(BigInt(parent.value));
          if ((index + 1) % 4 === 0) {
            await assertHistory();
            await sample(
              `after-${index + 1}-pending-sends`,
              index + 1 === iterations
            );
          }
        }
      );
    }
    await wallet.step(
      'create a second normal UTXO account without injecting controller state',
      async () => {
        const page = wallet!.page;
        await page.locator('#general-settings-button').click();
        await page
          .getByText(en.accountMenu.createNewAccount, { exact: true })
          .click();
        await page.locator('#account-name-input').fill('Sustained stress B');
        await page.locator('#create-btn').click();
        await page.getByRole('button', { name: /^ok$/i }).first().click();
        await ensureHome();
        await expect(page.locator('#home-balance')).toHaveText('0');
        await expect.poll(selection).toEqual({
          kind: 'syscoin',
          id: 1,
          address: other.secondUtxo.address,
        });
      }
    );
    for (let index = 0; index < (mode === 'quick' ? 2 : 6); index++) {
      await wallet.step(
        `vault isolation round trip ${index + 1}: B to A to EVM to UTXO`,
        async () => {
          const page = wallet!.page;
          await timed('account-switch-a', async () => {
            await page.locator('#general-settings-button').click();
            await page
              .locator('#account-HDAccount-0')
              .locator('span.truncate')
              .click();
            await assertHistory();
          });
          await timed('utxo-to-evm', async () => {
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await ensureHome();
            await expect(page.locator('#home-balance')).toHaveText('0');
            await expect.poll(selection).toEqual({
              kind: 'ethereum',
              id: 0,
              address: other.evmAddresses[0],
            });
          });
          await timed('evm-to-utxo', async () => {
            await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
            await assertHistory();
          });
          if (index + 1 < (mode === 'quick' ? 2 : 6)) {
            await page.locator('#general-settings-button').click();
            await page
              .locator('#account-HDAccount-1')
              .locator('span.truncate')
              .click();
            await ensureHome();
            await expect(page.locator('#home-balance')).toHaveText('0');
          }
        }
      );
    }
    for (const injected of ['timeout', 'rate-limit', 'offline'] as const) {
      await wallet.step(
        `one ${injected} summary read fails; normal reload recovers without signing`,
        async () => {
          // Normal account round trips trigger a fresh history read, while a
          // mere popup reload may correctly serve its compact in-memory cache.
          const page = wallet!.page;
          await page.locator('#general-settings-button').click();
          await page
            .locator('#account-HDAccount-1')
            .locator('span.truncate')
            .click();
          await ensureHome();
          fault = injected;
          await page.locator('#general-settings-button').click();
          await page
            .locator('#account-HDAccount-0')
            .locator('span.truncate')
            .click();
          await assertHistory();
          await expect
            .poll(() => readFaults.some((row) => row.fault === injected))
            .toBe(true);
          // A second ordinary reload must recover without a permanent unsupported
          // backend flag or a missing amount. We do not retry a signing operation.
          await wallet!.page.reload();
          await wallet!.waitAppReady();
          await observeDocument(wallet!.page);
          await assertHistory();
          expect(chain.accepted).toHaveLength(iterations);
        }
      );
    }
    await wallet.step(
      'stop the MV3 worker and recover the exact wallet through normal unlock',
      async () => {
        const page = wallet!.page;
        const session = await wallet!.context.newCDPSession(page);
        const { targetInfos } = await session.send('Target.getTargets');
        const target = targetInfos.find(
          (candidate) =>
            candidate.type === 'service_worker' &&
            candidate.url.startsWith(
              `chrome-extension://${wallet!.extensionId}/`
            )
        );
        expect(target).toBeTruthy();
        const closed = await session.send('Target.closeTarget', {
          targetId: target!.targetId,
        });
        expect(closed.success).toBe(true);
        workerRestarted = true;
        await session.detach();
        await page.reload();
        await wallet!.waitAppReady();
        if (await page.locator('#unlock-btn').isVisible())
          await wallet!.unlock();
        await observeDocument(page);
        await assertHistory();
        await sample('after-worker-restart');
      }
    );
    const profileDir = wallet.profileDir;
    const extensionId = wallet.extensionId;
    await wallet.step(
      'close the unlocked disposable browser before reopening the same profile',
      async (capture) => {
        await capture(wallet!.page);
        await wallet!.context.close();
      }
    );
    wallet.summary.finish('passed');
    wallet = undefined;
    wallet = await PaliWallet.launch(
      'offline-sustained-wallet-stress-restarted',
      {
        offlineHttpProxy: server.url,
        resumeProfileDir: profileDir,
        viewport: { width: 400, height: 620 },
      }
    );
    await installRoutes(wallet.context);
    expect(wallet.extensionId).toBe(extensionId);
    const restartReadiness = await waitForFixtureInterception(
      wallet.context,
      wallet.extensionId,
      async (attempt) => {
        fs.writeFileSync(
          path.join(
            E2E_CONFIG.artifactsDir,
            `stress-restart-readiness-${attempt.attempt}.json`
          ),
          JSON.stringify(attempt, null, 2),
          { flag: 'wx', mode: 0o600 }
        );
      }
    );
    await wallet.step(
      'cold browser restart is locked; unlock restores the same account and pending history',
      async () => {
        await expect(wallet!.page.locator('#unlock-btn')).toBeVisible();
        await expect(wallet!.page.locator('#home-balance')).toHaveCount(0);
        await wallet!.unlock();
        await observeDocument(wallet!.page);
        await assertHistory();
        await sample('after-cold-browser-restart');
      }
    );
    expect(confirmationClicks).toBe(iterations);
    expect(chain.accepted).toHaveLength(iterations);
    expect(new Set(chain.accepted.map((row) => row.txid)).size).toBe(
      iterations
    );
    expect(
      fixtureObservations.flatMap((row) => row.syntheticBroadcasts)
    ).toEqual(chain.accepted.map((row) => row.txid));
    expect(fixtureObservations.flatMap((row) => row.deniedWrites)).toEqual([]);
    expect(readFaults.map((row) => row.fault)).toEqual([
      'timeout',
      'rate-limit',
      'offline',
    ]);
    expect(pageErrors).toEqual([]);
    expect(historyFullTransactionReadDeltas.every((count) => count === 0)).toBe(
      true
    );
    const metricGroups = [...new Set(measurements.map((row) => row.name))].map(
      (name) => {
        const sorted = measurements
          .filter((row) => row.name === name)
          .map((row) => row.durationMs)
          .sort((a, b) => a - b);
        return {
          name,
          count: sorted.length,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          p95Ms:
            sorted[
              Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
            ],
          maxMs: sorted[sorted.length - 1],
        };
      }
    );
    fs.writeFileSync(
      path.join(
        E2E_CONFIG.artifactsDir,
        'offline-sustained-wallet-stress.json'
      ),
      JSON.stringify(
        {
          ...evidence,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          mode,
          iterations,
          simulated: true,
          publicSyntheticSeedOnly: true,
          realWalletSyntheticEcdsaSigning: true,
          coreOrPublicMempoolAcceptanceTested: false,
          externalForwardedWrites: 0,
          publicNetworkTested: false,
          physicalHardwareTested: false,
          confirmationClicks,
          cancelReviews,
          backReviews,
          uniqueTransactions: chain.accepted.length,
          transactions: chain.accepted,
          exactFinalFundingSatoshis: chain.current().value,
          finalFundingCoin: coin(chain.current().value),
          faultRecovery: readFaults,
          workerRestarted,
          coldPersistentBrowserRestart: true,
          restartReadiness,
          metricsAreDescriptiveNotSlaOrReliabilityProbability: true,
          measurements,
          metricGroups,
          rendererSamples,
          storageSamples,
          storageObservation:
            'Chrome storage change event count and serialized byte length only; no vault contents reported. Samples reset on document restart.',
          pageErrors,
          fixtureReadCount: fixtureObservations.reduce(
            (sum, row) => sum + row.reads.length,
            0
          ),
          fullTransactionReadCount: fixtureObservations.reduce(
            (sum, row) =>
              sum +
              row.reads.filter((url) => /^\/api\/v2\/tx\//.test(url)).length,
            0
          ),
          historyFullTransactionReadDeltas,
          secondaryReadCount: secondaryReads.length,
          deniedWrites: fixtureObservations.flatMap((row) => row.deniedWrites),
          deniedUnknown: fixtureObservations.flatMap(
            (row) => row.deniedUnknown
          ),
          proxyDeniedConnections: server.blocked.length,
          browserQaSessionsClosed: true,
        },
        null,
        2
      ),
      { flag: 'wx', mode: 0o600 }
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
