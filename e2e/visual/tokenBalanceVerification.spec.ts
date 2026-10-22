import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, Interface, id } from 'ethers';
import fs from 'fs';

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

const CONTRACT = '0x000000000000000000000000000000000000be61';
const SYMBOL = 'VERIFY';
const RAW_BALANCE = '1234567';
const AMOUNT = '1.234567';
const DECIMALS = 6;

test('ERC20 balance verification exposes a scoped explicit retry without losing the send draft', async ({}, info) => {
  test.setTimeout(180_000);
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const sourceSha = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenVerificationSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let phase = 'import';
  const reads: { method: string; phase: string; selector?: string }[] = [];
  const balanceReads: {
    account: string;
    outcome: 'failed' | 'held' | 'success';
    phase: string;
  }[] = [];
  const held: (() => void)[] = [];
  const writes: string[] = [];
  const unexpected: string[] = [];
  const observations: unknown[] = [];
  let routes: Awaited<ReturnType<typeof installIsolatedVaultRoutes>>;
  const release = () => {
    phase = 'healthy';
    held.splice(0).forEach((done) => done());
  };
  try {
    wallet = await PaliWallet.launch('token-balance-verification', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const abi = AbiCoder.defaultAbiCoder();
    const selector = (signature: string) => id(signature).slice(0, 10);
    const transfer = new Interface([
      'function transfer(address,uint256) returns (bool)',
    ]);
    // Only public HTTP replies vary. Controller results, vault state, form
    // values and navigation state are never injected or replaced.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      const body = request.postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
            call?.method || ''
          )
        )
      ) {
        writes.push(...calls.map((call: any) => call.method));
        return route.abort('blockedbyclient');
      }
      const own = (value: unknown) => String(value).toLowerCase() === CONTRACT;
      if (
        !calls.some(
          (call: any) =>
            own(call.params?.[0]?.to || call.params?.[0]) ||
            (call.method === 'eth_getBalance' &&
              fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() ===
                  String(call.params?.[0]).toLowerCase()
              ))
        )
      )
        return route.fallback();
      const replies = await Promise.all(
        calls.map(async (call: any) => {
          const codeTarget =
            call.method === 'eth_getCode' && own(call.params?.[0]);
          const tokenCall =
            call.method === 'eth_call' && own(call.params?.[0]?.to);
          let result: unknown;
          const prefix = tokenCall
            ? String(call.params[0].data).slice(0, 10)
            : undefined;
          reads.push({ method: call.method, selector: prefix, phase });
          if (call.method === 'eth_chainId') result = '0x1644';
          if (call.method === 'net_version') result = '5700';
          if (call.method === 'eth_blockNumber') result = '0x1';
          if (
            call.method === 'eth_gasPrice' ||
            call.method === 'eth_maxPriorityFeePerGas'
          )
            result = '0x3b9aca00';
          if (codeTarget) result = '0x60006000fd';
          if (tokenCall) {
            if (prefix === selector('name()'))
              result = abi.encode(['string'], ['Verification Token']);
            if (prefix === selector('symbol()'))
              result = abi.encode(['string'], [SYMBOL]);
            if (prefix === selector('decimals()'))
              result = abi.encode(['uint8'], [DECIMALS]);
            if (prefix === selector('totalSupply()'))
              result = abi.encode(['uint256'], [RAW_BALANCE]);
            if (prefix === selector('supportsInterface(bytes4)'))
              result = abi.encode(['bool'], [false]);
            if (prefix === selector('balanceOf(address)')) {
              const [account] = abi.decode(
                ['address'],
                '0x' + String(call.params[0].data).slice(10)
              );
              if (
                account.toLowerCase() !== fixture.evmAddresses[0].toLowerCase()
              ) {
                unexpected.push('balanceOf:' + account);
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  error: {
                    code: -32000,
                    message: 'Unallowlisted synthetic account',
                  },
                };
              }
              const entry = {
                account,
                phase,
                outcome: phase.startsWith('failed-')
                  ? ('failed' as const)
                  : phase.startsWith('held-')
                  ? ('held' as const)
                  : ('success' as const),
              };
              balanceReads.push(entry);
              if (entry.outcome === 'failed')
                return {
                  jsonrpc: '2.0',
                  id: call.id,
                  error: {
                    code: -32000,
                    message: 'Synthetic balance read unavailable',
                  },
                };
              if (entry.outcome === 'held') {
                await new Promise<void>((done) => held.push(done));
                entry.outcome = 'success';
              }
              result = abi.encode(['uint256'], [RAW_BALANCE]);
            }
            if (prefix === selector('transfer(address,uint256)')) {
              const decoded = transfer.decodeFunctionData(
                'transfer',
                call.params[0].data
              );
              expect(decoded[0].toLowerCase()).toBe(
                fixture.evmAddresses[1].toLowerCase()
              );
              expect(decoded[1].toString()).toBe(RAW_BALANCE);
              result = abi.encode(['bool'], [true]);
            }
            if (result === undefined)
              unexpected.push('token selector:' + prefix);
          }
          if (
            call.method === 'eth_getBalance' &&
            fixture.evmAddresses.some(
              (address) =>
                address.toLowerCase() === String(call.params?.[0]).toLowerCase()
            )
          )
            result = '0xde0b6b3a7640000';
          if (call.method === 'eth_estimateGas' && own(call.params?.[0]?.to)) {
            const decoded = transfer.decodeFunctionData(
              'transfer',
              call.params[0].data
            );
            expect(decoded[0].toLowerCase()).toBe(
              fixture.evmAddresses[1].toLowerCase()
            );
            expect(decoded[1].toString()).toBe(RAW_BALANCE);
            result = '0xfde8';
          }
          if (result === undefined) {
            unexpected.push('unallowlisted mixed token batch:' + call.method);
            return {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message: 'Unallowlisted synthetic read' },
            };
          }
          return { jsonrpc: '2.0', id: call.id, result };
        })
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const amount = page.getByPlaceholder(en.send.amount, { exact: true });
    const receiver = page.getByPlaceholder(en.send.receiver, { exact: true });
    const max = page.getByRole('button', { name: 'MAX', exact: true });
    const retry = page.getByRole('button', {
      name: en.receive.retry,
      exact: true,
    });
    const selectAsset = async (symbol: string) => {
      await page.getByRole('button', { name: /^(TSYS|VERIFY)$/ }).click();
      await page
        .locator('button[role="menuitem"]')
        .filter({ hasText: symbol })
        .click();
    };
    const bounds = async (control: Locator) => {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      const viewport = page.viewportSize()!;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await control.evaluate((element) => {
          const b = element.getBoundingClientRect();
          return [
            [b.left + 1, b.top + b.height / 2],
            [b.right - 1, b.top + b.height / 2],
            [b.left + b.width / 2, b.top + 1],
            [b.left + b.width / 2, b.bottom - 1],
          ].every(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return hit === element || (!!hit && element.contains(hit));
          });
        })
      ).toBe(true);
      return box!;
    };
    await wallet.step(
      'import the synthetic six-decimal ERC20 through the normal form',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.gotoRoute('#/tokens/add?tab=custom');
        const tab = page.getByRole('button', {
          name: en.tokens.addCustomTab,
          exact: true,
        });
        if (await tab.count()) await tab.first().click();
        await page.locator('#custom-token-contract').fill(CONTRACT);
        const button = page.getByRole('button', {
          name: 'Import VERIFY token',
          exact: true,
        });
        await expect(button).toBeEnabled();
        await button.click();
        await expect(button).toBeDisabled();
      }
    );
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      const suffix = `${viewport.width}x${viewport.height}`;
      let failedCount = 0;
      let retryBox: Awaited<ReturnType<typeof bounds>>;
      await page.setViewportSize(viewport);
      await wallet.step(
        `prepare a healthy ordinary token draft at ${suffix}`,
        async () => {
          phase = 'healthy';
          await wallet!.ensureOnHome();
          await page.locator('#send-btn').click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
          if (
            await page
              .getByRole('button', { name: SYMBOL, exact: true })
              .count()
          )
            await selectAsset(en.send.native);
          await selectAsset(SYMBOL);
          await expect(amount).toBeEnabled();
          await receiver.fill(fixture.evmAddresses[1]);
          await amount.fill(AMOUNT);
        }
      );
      await wallet.step(
        `surface a settled balance failure with an accessible retry at ${suffix}`,
        async () => {
          await selectAsset(en.send.native);
          phase = 'failed-' + suffix;
          await selectAsset(SYMBOL);
          await expect(
            page.getByText(en.send.tokenVerificationFailed, { exact: true })
          ).toBeVisible();
          await expect(amount).toBeDisabled();
          await expect(max).toBeDisabled();
          await expect(amount).toHaveValue(AMOUNT);
          await expect(receiver).toHaveValue(fixture.evmAddresses[1]);
          failedCount = balanceReads.filter(
            (read) => read.phase === phase
          ).length;
          expect(failedCount).toBeGreaterThan(0);
          // One more existing debounce interval proves that the failed UI does
          // not initiate a new balance request without an explicit action.
          await page.evaluate(
            () => new Promise((done) => setTimeout(done, 1100))
          );
          expect(
            balanceReads.filter((read) => read.phase === phase)
          ).toHaveLength(failedCount);
          await receiver.click();
          for (let step = 0; step < 12; step++) {
            await page.keyboard.press('Tab');
            if (
              await retry.evaluate(
                (element) => document.activeElement === element
              )
            )
              break;
          }
          await expect(retry).toBeFocused();
          retryBox = await bounds(retry);
          await bounds(
            page.getByText(en.send.tokenVerificationFailed, { exact: true })
          );
        }
      );
      await wallet.step(
        `hold the single explicit retry and keep the draft blocked at ${suffix}`,
        async () => {
          phase = 'held-' + suffix;
          if (viewport.width === 400) await page.keyboard.press('Enter');
          else
            await page.mouse.dblclick(
              retryBox.x + retryBox.width / 2,
              retryBox.y + retryBox.height / 2
            );
          await expect.poll(() => held.length).toBe(1);
          expect(
            balanceReads.filter((read) => read.phase === phase)
          ).toHaveLength(1);
          await expect(amount).toBeDisabled();
          await expect(max).toBeDisabled();
          await expect(amount).toHaveValue(AMOUNT);
          await page.locator('#send-eth-next-btn').click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
          expect(
            balanceReads.filter((read) => read.phase === phase)
          ).toHaveLength(1);
          await expect(receiver).toHaveValue(fixture.evmAddresses[1]);
        }
      );
      await wallet.step(
        `recover and review the exact token amount without signing at ${suffix}`,
        async () => {
          release();
          await expect(amount).toBeEnabled();
          await expect(max).toBeEnabled();
          await expect(amount).toHaveValue(AMOUNT);
          await expect(receiver).toHaveValue(fixture.evmAddresses[1]);
          await page.locator('#send-eth-next-btn').click();
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          await expect(
            page.getByText(`${AMOUNT} ${SYMBOL}`, { exact: true }).first()
          ).toBeVisible();
          const tx = await page.evaluate(() => window.history.state?.usr?.tx);
          expect(tx).toMatchObject({
            amount: AMOUNT,
            receivingAddress: fixture.evmAddresses[1],
            token: { contractAddress: CONTRACT, decimals: DECIMALS },
          });
          await expect(
            page.getByRole('button', { name: en.buttons.confirm, exact: true })
          ).toBeEnabled();
          observations.push({
            viewport,
            failedCount,
            retryBounds: retryBox,
            tx,
          });
        }
      );
      await wallet.step(
        `cancel the unsigned review and retain the recovered draft at ${suffix}`,
        async () => {
          await page
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/send\/eth$/);
          await expect(amount).toHaveValue(AMOUNT);
          await expect(receiver).toHaveValue(fixture.evmAddresses[1]);
          await expect(max).toBeEnabled();
        }
      );
    }
    await wallet.step(
      'audit read-only verification and immutable runtime evidence',
      async () => {
        expect(writes).toEqual([]);
        expect(unexpected).toEqual([]);
        expect(routes.deniedWrites).toEqual([]);
        expect(held).toHaveLength(0);
        expect(observations).toHaveLength(2);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(sourceSha);
      }
    );
    status = 'passed';
  } finally {
    release();
    try {
      const evidence = info.outputPath(
        'token-balance-verification-evidence.json'
      );
      fs.writeFileSync(
        evidence,
        JSON.stringify(
          {
            runtime,
            sourceSha,
            observations,
            reads,
            balanceReads,
            writes,
            unexpected,
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            syntheticPublicRpcOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            transactionConfirmClicked: false,
          },
          null,
          2
        )
      );
      await info.attach('token-balance-verification-evidence', {
        path: evidence,
        contentType: 'application/json',
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
