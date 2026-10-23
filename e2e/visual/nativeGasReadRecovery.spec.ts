import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const RPC = 'https://rpc.tanenbaum.io/';
const PROVIDER_READ_CACHE_MS = 250;
const scenarios = [
  { id: 'prefetched-native', modern: true, max: false, width: 400 },
  { id: 'fresh-native-max', modern: true, max: true, width: 320 },
  { id: 'legacy-native', modern: false, max: false, width: 400 },
] as const;

// Public projections only: no encrypted records, passwords or keyring exports.
async function publicState(page: Page) {
  return page.evaluate(async () => {
    const { vault } = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const ref = vault.activeAccount;
    const account = vault.accounts[ref.type][ref.id];
    return {
      account: { id: ref.id, type: ref.type, address: account.address },
      nativeBalance: String(account.balances.ethereum),
      network: {
        kind: vault.activeNetwork.kind,
        chainId: vault.activeNetwork.chainId,
        url: vault.activeNetwork.url,
      },
    };
  });
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 32; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(target).toBeFocused();
}

async function actionGeometry(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const geometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = (x: number, y: number) => {
      const node = document.elementFromPoint(x, y);
      return !!node && (node === element || element.contains(node));
    };
    return {
      bounds: rect.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      hits: [
        hit(rect.left + rect.width / 2, rect.top + rect.height / 2),
        hit(rect.left + 1, rect.top + rect.height / 2),
        hit(rect.right - 1, rect.top + rect.height / 2),
        hit(rect.left + rect.width / 2, rect.top + 1),
        hit(rect.left + rect.width / 2, rect.bottom - 1),
      ],
    };
  });
  expect(geometry.bounds.width).toBeGreaterThan(0);
  expect(geometry.bounds.height).toBeGreaterThan(0);
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.hits).toEqual([true, true, true, true, true]);
  return geometry;
}

for (const scenario of scenarios) {
  test(`ordinary ${scenario.id} refuses malformed gas reads and explicitly recovers the same unsigned draft`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'NativeGasReadSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    let phase = 'setup';
    const reads: {
      completed: boolean;
      method: string;
      outcome: 'healthy' | 'malformed' | 'prefetch-refused';
      phase: string;
    }[] = [];
    const deniedWrites: string[] = [];
    const pageErrors: string[] = [];
    const observations: unknown[] = [];
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    try {
      wallet = await PaliWallet.launch('native-gas-read-' + scenario.id, {
        offlineHttpProxy: server.url,
        viewport: { width: scenario.width, height: scenario.max ? 360 : 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      // Only public HTTP read replies vary; the real controller, SDK, router,
      // Redux, Chrome APIs and form inputs are not replaced.
      await wallet.context.route(RPC, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        const calls = Array.isArray(body) ? body : [body];
        if (
          calls.some((call: any) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        ) {
          deniedWrites.push(...calls.map((call: any) => call.method));
          return route.abort('blockedbyclient');
        }
        const entries: typeof reads = [];
        const replies = calls.map((call: any) => {
          const params = call.params || [];
          const own = (value: unknown) =>
            fixture.evmAddresses.some(
              (address) => address.toLowerCase() === String(value).toLowerCase()
            );
          let result: unknown;
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'net_version') result = '5700';
          if (call.method === 'eth_blockNumber') result = '0x1';
          if (call.method === 'eth_getBalance' && own(params[0]))
            result = '0x8ac7230489e80000'; // Synthetic10 native coins.
          if (call.method === 'eth_getTransactionCount' && own(params[0]))
            result = '0x0';
          if (
            ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(call.method)
          )
            result = '0x3b9aca00';
          if (call.method === 'eth_getBlockByNumber')
            result = {
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
              ...(scenario.modern ? { baseFeePerGas: '0x3b9aca00' } : {}),
            };
          if (
            call.method === 'eth_estimateGas' &&
            String(params[0]?.to).toLowerCase() ===
              fixture.evmAddresses[1].toLowerCase() &&
            (!params[0]?.from || own(params[0].from)) &&
            (!params[0]?.data || params[0].data === '0x') &&
            /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(
              String(params[0]?.value ?? '0x0')
            ) &&
            BigInt(params[0]?.value ?? '0x0') <= BigInt('10000000000000000000')
          )
            result = '0x5208';
          if (result === undefined) return undefined;
          const outcome =
            phase === 'gas-failure' && call.method === 'eth_estimateGas'
              ? 'malformed'
              : phase === 'prefetch-failure' && call.method === 'eth_gasPrice'
              ? 'prefetch-refused'
              : 'healthy';
          const entry = {
            method: call.method,
            phase,
            outcome,
            completed: false,
          } as (typeof reads)[number];
          entries.push(entry);
          // Correct JSON-RPC id but neither result nor error: actual installed
          // provider rejects this envelope with SYSWEB3_RPC_RESPONSE_INVALID.
          if (outcome === 'malformed') return { jsonrpc: '2.0', id: call.id };
          if (outcome === 'prefetch-refused')
            return {
              jsonrpc: '2.0',
              id: call.id,
              error: {
                code: -32000,
                message: 'Synthetic prefetch unavailable',
              },
            };
          return { jsonrpc: '2.0', id: call.id, result };
        });
        if (replies.some((reply) => reply === undefined))
          return route.fallback();
        reads.push(...entries);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
        });
        entries.forEach((entry) => {
          entry.completed = true;
        });
      });
      await wallet.step(
        `${scenario.id}: import and select funded synthetic EVM`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await expect
            .poll(async () => Number((await publicState(page)).nativeBalance))
            .toBe(10);
          const initial = await publicState(page);
          expect(initial.account).toEqual({
            id: 0,
            type: 'HDAccount',
            address: fixture.evmAddresses[0],
          });
          expect(initial.network).toEqual({
            kind: 'ethereum',
            chainId: 5700,
            url: RPC.slice(0, -1),
          });
          observations.push({ initial });
        }
      );
      const initial = await publicState(page);
      const expectedAmount = scenario.max ? initial.nativeBalance : '0.001';
      const amount = page.getByPlaceholder(en.send.amount, { exact: true });
      const next = page.locator('#send-eth-next-btn');
      const confirm = page.getByRole('button', {
        name: en.buttons.confirm,
        exact: true,
      });
      const retry = page.getByRole('button', {
        name: en.receive.retry,
        exact: true,
      });
      let draft: unknown;
      await wallet.step(
        `${scenario.id}: ordinary Send prepares actual prefetch state and unsigned amount`,
        async () => {
          phase = scenario.max ? 'prefetch-failure' : 'prefetch-healthy';
          // Expire only the provider's existing250ms identical-read cache so
          // SendEth's actual prefetch must observe this phase's HTTP response.
          await page.waitForTimeout(PROVIDER_READ_CACHE_MS + 50);
          await page.locator('#send-btn').click();
          await page
            .getByPlaceholder(en.send.receiver, { exact: true })
            .fill(fixture.evmAddresses[1]);
          if (scenario.max)
            await page
              .getByRole('button', { name: en.send.max, exact: true })
              .click();
          else await amount.fill('0.001');
          await expect(amount).toHaveValue(expectedAmount);
          await expect(next).toBeEnabled();
          await expect
            .poll(
              () =>
                reads.filter(
                  (read) =>
                    read.phase === phase &&
                    read.method === 'eth_gasPrice' &&
                    read.completed
                ).length
            )
            .toBeGreaterThan(0);
          if (scenario.max)
            expect(
              reads.some(
                (read) =>
                  read.phase === phase &&
                  read.outcome === 'prefetch-refused' &&
                  read.completed
              )
            ).toBe(true);
          phase = 'gas-failure';
          await next.click();
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          draft = await page.evaluate(() => {
            const tx = history.state?.usr?.tx;
            return {
              amount: tx?.amount,
              isMax: tx?.isMax,
              sender: tx?.sender,
              recipient: tx?.receivingAddress,
              transactionType: tx?.transactionType,
              cachedGasData: tx?.cachedGasData || null,
            };
          });
          expect(draft).toMatchObject({
            amount: expectedAmount,
            isMax: scenario.max,
            sender: fixture.evmAddresses[0],
            recipient: fixture.evmAddresses[1],
            transactionType: 'NATIVE_ETH',
          });
          if (scenario.max) expect((draft as any).cachedGasData).toBeNull();
          else {
            const cache = (draft as any).cachedGasData;
            expect(cache).not.toBeNull();
            expect(BigInt(cache.maxFeePerGas) > BigInt(0)).toBe(
              scenario.modern
            );
          }
          observations.push({ draft });
        }
      );
      await wallet.step(
        `${scenario.id}: real malformed estimate completes but never enables Confirm`,
        async () => {
          await expect
            .poll(
              () =>
                reads.filter(
                  (read) => read.outcome === 'malformed' && read.completed
                ).length
            )
            .toBe(1);
          await expect(confirm).toBeDisabled();
          await expect(
            page.getByText(en.send.unableToLoad, { exact: true })
          ).toBeVisible();
          await expect(retry).toBeEnabled();
          const geometry = await actionGeometry(retry);
          // One settled debounce interval is a negative automatic-loop control,
          // not an altered browser clock, retry count or assertion timeout.
          await page.waitForTimeout(600);
          expect(
            reads.filter(
              (read) => read.outcome === 'malformed' && read.completed
            )
          ).toHaveLength(1);
          await expect(confirm).toBeDisabled();
          expect(await publicState(page)).toEqual(initial);
          observations.push({ failed: true, geometry });
        }
      );
      await wallet.step(
        `${scenario.id}: native Tab Enter Retry reads actual25200 SDK quote without submitting`,
        async () => {
          phase = 'recovery';
          await tabTo(page, retry);
          await page.keyboard.press('Enter');
          await expect
            .poll(
              () =>
                reads.filter(
                  (read) =>
                    read.phase === phase &&
                    read.method === 'eth_estimateGas' &&
                    read.outcome === 'healthy' &&
                    read.completed
                ).length
            )
            .toBeGreaterThan(0);
          await expect(confirm).toBeEnabled();
          await expect(retry).toHaveCount(0);
          await expect(
            page.getByText(en.send.unableToLoad, { exact: true })
          ).toHaveCount(0);
          const edit = page.getByRole('button', {
            name: en.send.editFee,
            exact: true,
          });
          if (scenario.modern) {
            await edit.click();
            const dialog = page.getByRole('dialog', {
              name: en.send.editFee,
              exact: true,
            });
            await expect(
              dialog.getByLabel(en.send.gasLimit, { exact: true })
            ).toHaveValue('25200');
            await dialog
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click();
          } else {
            // Legacy has no fee editor. Exact visible fee at the fixture's
            // actual1gwei proves25200, not the discarded42000 UI fallback.
            await expect(edit).toHaveCount(0);
            await expect(
              page.getByText('0.0000252 TSYS', { exact: true }).first()
            ).toBeVisible();
            await expect(
              page.getByText('0.000042 TSYS', { exact: true })
            ).toHaveCount(0);
          }
          await expect(confirm).toBeEnabled();
          expect(await publicState(page)).toEqual(initial);
          expect(deniedWrites).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
          observations.push({
            recoveredGasLimit: '25200',
            gasLimitEvidence: scenario.modern
              ? 'actual-fee-editor'
              : 'visible-fee-at-exact1gwei',
            unsignedReviewOnly: true,
          });
        }
      );
      await wallet.step(
        `${scenario.id}: Cancel restores exact native draft and unchanged identity`,
        async () => {
          await page
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
          await expect(
            page.getByPlaceholder(en.send.receiver, { exact: true })
          ).toHaveValue(fixture.evmAddresses[1]);
          await expect(amount).toHaveValue(expectedAmount);
          expect(await publicState(page)).toEqual(initial);
          expect(pageErrors).toEqual([]);
          expect(deniedWrites).toEqual([]);
          expect(routes!.deniedWrites).toEqual([]);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('native-gas-read-recovery-' + scenario.id, {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              runtime: extensionEvidence(),
              sourceSha256: createHash('sha256')
                .update(fs.readFileSync(info.file))
                .digest('hex'),
              simulated: true,
              controllerStateReplaced: false,
              scenario,
              reads,
              deniedWrites,
              fixtureDeniedWrites: routes?.deniedWrites || [],
              proxyDeniedConnections: server.blocked.length,
              pageErrors,
              observations,
            },
            null,
            2
          ),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
