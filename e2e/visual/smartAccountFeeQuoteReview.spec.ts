import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, formatEther } from 'ethers';
import fs from 'fs';

import en from '../../source/assets/locales/en.json';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../../source/utils/smartAccount/contracts';
import { E2E_CONFIG } from '../harness/config';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import { PaliWallet } from '../harness/pali';
import { createSmartAccountHydrationFixture } from '../harness/smartAccountHydrationFixture';
import {
  approve,
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import { startUtxoFixtureServer } from '../harness/utxoFixture';
import {
  VISUAL_FIXTURE_CHAIN_ID,
  VISUAL_FIXTURE_RPC,
  VISUAL_FIXTURE_SEED,
} from '../harness/visualFixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function captureReview(
  page: Page,
  target: ReturnType<Page['locator']>,
  info: any,
  label: string
) {
  await page.bringToFront();
  for (let n = 0; n < 30; n++) {
    const box = await target.boundingBox();
    const reject = await page
      .getByRole('button', { name: en.buttons.reject, exact: true })
      .boundingBox();
    if (box && reject && box.y >= 0 && box.y + box.height <= reject.y - 8)
      break;
    await page.mouse.move(
      page.viewportSize()!.width - 14,
      page.viewportSize()!.height / 2
    );
    await page.mouse.wheel(0, box && box.y < 0 ? -180 : 180);
    await page.waitForTimeout(80);
  }
  const box = await target.boundingBox();
  const reject = await page
    .getByRole('button', { name: en.buttons.reject, exact: true })
    .boundingBox();
  expect(box).not.toBeNull();
  expect(reject).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(reject!.y);
  await page.mouse.move(0, 0);
  await info.attach(label, {
    contentType: 'image/png',
    body: await page.screenshot({ animations: 'disabled' }),
  });
}

const LABEL = 'Public quote account';
const abi = AbiCoder.defaultAbiCoder();
const publicState = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const ref = state.vault.activeAccount;
    const account = state.vault.accounts[ref.type][ref.id];
    return {
      ref,
      address: account.address,
      isSmartAccount: account.isSmartAccount,
      chainId: state.vault.activeNetwork.chainId,
      installed: (account.smartAccount?.installedModules || []).map(
        (m: any) => ({ address: m.address, id: m.id, type: m.type })
      ),
      activeValidator: account.smartAccount?.auth?.validator,
      grant: state.dapp.dapps[origin]
        ? {
            accountId: state.dapp.dapps[origin].accountId,
            accountType: state.dapp.dapps[origin].accountType,
          }
        : null,
    };
  }, host);

for (const width of [400, 320]) {
  test(`SmartAccount fee quote preserves exact value and recovers at ${width}`, async ({}, info) => {
    test.setTimeout(180000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const before = { ...E2E_CONFIG };
    const fixture = createSmartAccountHydrationFixture();
    let phase: 'setup' | 'held' | 'failed' | 'healthy' = 'setup';
    let releaseNonce!: () => void;
    const nonceGate = new Promise<void>((resolve) => {
      releaseNonce = resolve;
    });
    const nonceReads: { params: unknown; phase: string }[] = [];
    const entryPoint = getPaliEntryPointAddress(VISUAL_FIXTURE_CHAIN_ID);
    const isNonce = (call: any) => {
      if (
        call.method !== 'eth_call' ||
        String(call.params?.[0]?.to).toLowerCase() !== entryPoint.toLowerCase()
      )
        return false;
      try {
        const parsed = paliEntryPointInterface.parseTransaction({
          data: call.params[0].data,
        });
        return (
          parsed?.name === 'getNonce' &&
          parsed.args[0].toLowerCase() ===
            fixture.base.smartAccountAddress.toLowerCase()
        );
      } catch {
        return false;
      }
    };
    const server = await startUtxoFixtureServer();
    const observedReads: string[] = [];
    const refusedWrites: string[] = [];
    const observations: unknown[] = [];
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    Object.assign(E2E_CONFIG, {
      seedPhrase: VISUAL_FIXTURE_SEED,
      password: 'QuoteReviewSynthetic!2026',
      rpcUrl: server.url,
      chainId: VISUAL_FIXTURE_CHAIN_ID,
      networkLabel: 'zkTanenbaum',
    });
    try {
      wallet = await PaliWallet.launch('smart-account-fee-review-' + width, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport: { width, height: width === 400 ? 620 : 360 },
      });
      await fixture.install(wallet.context, server.url);
      await wallet.context.route(VISUAL_FIXTURE_RPC + '/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON();
        const calls = Array.isArray(payload) ? payload : [payload];
        const override = (call: any): string | undefined => {
          if (isNonce(call)) return abi.encode(['uint256'], [0]);
          if (
            call.method === 'eth_estimateGas' &&
            call.params?.[0]?.to?.toLowerCase() ===
              fixture.base.smartAccountAddress.toLowerCase() &&
            call.params[0].from?.toLowerCase() === entryPoint.toLowerCase()
          ) {
            const parsed = paliSmartAccountInterface.parseTransaction({
              data: call.params[0].data,
            });
            if (parsed?.name === 'execute') return '0x11170';
          }
          if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return undefined;
          return undefined;
        };
        if (!calls.some((call) => override(call) !== undefined))
          return route.fallback();
        const replies = [];
        for (const call of calls) {
          if (
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          ) {
            refusedWrites.push(call.method);
            return route.abort('blockedbyclient');
          }
          if (isNonce(call)) {
            nonceReads.push({ phase, params: call.params });
            if (phase === 'held') await nonceGate;
            if (phase === 'failed') {
              replies.push({
                jsonrpc: '2.0',
                id: call.id,
                error: {
                  code: -32000,
                  message: 'Synthetic nonce read unavailable',
                },
              });
              continue;
            }
          }
          const value = override(call);
          if (value !== undefined) {
            observedReads.push(
              `${call.method}:${String(
                call.params[0]?.to || call.params[0]
              ).toLowerCase()}`
            );
            replies.push({ jsonrpc: '2.0', id: call.id, result: value });
          } else {
            const read = await fixture.read(
              route.request().url(),
              'POST',
              call
            );
            if (!read || read.unsupported?.length)
              throw new Error('Unadmitted companion module RPC');
            fixture.audit.reads.push(...read.reads);
            replies.push(read.body);
          }
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
        });
      });
      const page = wallet.page;
      await wallet.step(
        'create and select the real smart account through the normal account menu',
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('zkTanenbaum', 'EVM');
          await wallet!.ensureOnHome();
          await page
            .getByRole('button', {
              name: en.generalMenu.generalOptions,
              exact: true,
            })
            .click();
          await page
            .getByRole('menuitem', {
              name: en.accountMenu.createNewAccount,
              exact: true,
            })
            .click();
          await page.locator('#account-name-input').fill(LABEL);
          await page
            .getByRole('button', {
              name: new RegExp('^' + en.settings.createSmartAccount, 'i'),
            })
            .click();
          const created = page
            .getByRole('dialog')
            .filter({ hasText: en.settings.yourNewAccount });
          await expect(
            created.getByText(fixture.base.smartAccountAddress, { exact: true })
          ).toBeVisible();
          await created.locator('#account-created-ok-btn').click();
          await wallet!.ensureOnHome();
          fixture.state.deployed = true;
          await page.locator('#general-settings-button').click();
          const row = page.locator('#account-SmartAccount-0');
          await expect(row).toContainText(LABEL);
          await row.click();
          await wallet!.ensureOnHome();
          await expect
            .poll(async () => (await publicState(page, server.url)).ref.type)
            .toBe('SmartAccount');
          await page.locator('#smart-account-hub-badge').click();
          await expect(page).toHaveURL(/#\/home\/smart-account$/);
          await expect(
            page.getByText(en.smartAccountHub.notDeployed, { exact: true })
          ).toHaveCount(0);
          await page
            .getByRole('button', { name: en.buttons.back, exact: true })
            .click();
          await wallet!.ensureOnHome();
        }
      );
      const dapp = await wallet.context.newPage();
      await dapp.goto(server.url);
      await dapp.waitForFunction(() => Boolean((window as any).pali?.request));
      const host = new URL(server.url).origin;
      await wallet.step(
        'connect the requesting origin explicitly to the created SmartAccount',
        async () => {
          const id = await startRequest(dapp, 'eth_requestAccounts');
          const connect = await popupFor(wallet!.context, dapp, id);
          const row = connect
            .getByRole('button')
            .filter({ has: connect.getByText(LABEL, { exact: true }) });
          await expect(row).toHaveCount(1);
          await row.click();
          const result = await approve(wallet!.context, dapp, id);
          expect(result.result.map((a: string) => a.toLowerCase())).toEqual([
            fixture.base.smartAccountAddress.toLowerCase(),
          ]);
          const state = await publicState(page, host);
          expect(state.ref.type).toBe('SmartAccount');
          expect(state.isSmartAccount).toBe(true);
          expect(state.grant).toEqual({
            accountId: state.ref.id,
            accountType: 'SmartAccount',
          });
          observations.push({ phase: 'connected', state });
        }
      );
      const baseline = await publicState(page, host);
      await wallet.step(
        'Held SmartAccount nonce quote stays pending and cannot sign',
        async () => {
          phase = 'held';
          const id = await startRequest(dapp, 'wallet_sendCalls', [
            {
              version: '2.0.0',
              chainId: '0xdee1',
              from: fixture.base.smartAccountAddress,
              atomicRequired: true,
              calls: [{ to: fixture.base.address, value: '0x1', data: '0x' }],
            },
          ]);
          const popup = await popupFor(wallet!.context, dapp, id);
          await popup.setViewportSize({
            width,
            height: width === 400 ? 620 : 360,
          });
          await expect.poll(() => nonceReads.length).toBeGreaterThan(0);
          const sign = popup.getByRole('button', {
            name: en.send.sign,
            exact: true,
          });
          await expect(sign).toBeDisabled();
          const maximumFee = popup
            .getByText(en.send.smartAccountMaxFee, { exact: true })
            .locator('..')
            .locator('p')
            .nth(1);
          await expect(maximumFee).toHaveText(en.send.calculating);
          const pending = await rpcObservation(dapp, id);
          expect(pending.settled).not.toBe(true);
          await captureReview(
            popup,
            maximumFee,
            info,
            'smart-quote-held-' + width
          );
          phase = 'failed';
          releaseNonce();
          const refresh = popup.getByRole('button', {
            name: en.send.refreshFeeQuote,
            exact: true,
          });
          await expect(refresh).toBeEnabled();
          await expect(
            popup.getByText(en.send.unableToCalculateFees, { exact: true })
          ).toBeVisible();
          await expect(sign).toBeDisabled();
          await expect(maximumFee).toHaveText(en.send.feeUnavailable);
          await expect(
            popup.getByText(en.send.calculating, { exact: true })
          ).toHaveCount(0);
          await captureReview(
            popup,
            maximumFee.locator('..'),
            info,
            'smart-quote-error-' + width
          );
          await captureForegroundContrast(
            refresh,
            info,
            'smart-quote-refresh-' + width
          );
          phase = 'healthy';
          for (
            let i = 0;
            i < 50 &&
            !(await refresh.evaluate((e) => document.activeElement === e));
            i++
          )
            await popup.keyboard.press('Tab');
          await expect(refresh).toBeFocused();
          await popup.keyboard.press('Enter');
          await expect(sign).toBeEnabled();
          await expect(refresh).toHaveCount(0);
          // Exact known ECDSA fixture:311000 gas units at3gwei maximum.
          await expect(maximumFee).toHaveText('0.000933 tsys');
          await expect(
            popup.getByText(en.send.calculating, { exact: true })
          ).toHaveCount(0);
          await expect(
            popup.getByText(en.send.feeUnavailable, { exact: true })
          ).toHaveCount(0);
          await captureReview(
            popup,
            maximumFee.locator('..'),
            info,
            'smart-quote-ready-' + width
          );
          const totalLabel = popup.getByText(en.send.totalValue + ':', {
            exact: true,
          });
          const row = totalLabel.locator('..');
          await captureReview(popup, row, info, 'smart-quote-total-' + width);
          const layout = await row.evaluate((node) => {
            const [label, amount] = Array.from(node.children);
            const range = (e: Element) => {
              const r = document.createRange();
              r.selectNodeContents(e);
              return Array.from(r.getClientRects())
                .filter((x) => x.width && x.height)
                .map((x) => x.toJSON());
            };
            return {
              label: label.textContent,
              amount: amount.textContent,
              labelBox: label.getBoundingClientRect().toJSON(),
              amountBox: amount.getBoundingClientRect().toJSON(),
              labelRects: range(label),
              amountRects: range(amount),
              viewport: { width: innerWidth, height: innerHeight },
            };
          });
          expect(layout.label).toBe(en.send.totalValue + ':');
          expect(layout.amount).toBe(formatEther(BigInt(1)) + ' tsys');
          expect(
            layout.amountBox.left - layout.labelBox.right
          ).toBeGreaterThanOrEqual(11.5);
          for (const rect of [...layout.labelRects, ...layout.amountRects]) {
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.right).toBeLessThanOrEqual(width);
          }
          await info.attach('smart-quote-total-layout-' + width, {
            contentType: 'application/json',
            body: JSON.stringify(layout),
          });
          const ready = await rpcObservation(dapp, id);
          expect(ready.settled).not.toBe(true);
          expect(ready.params).toEqual(pending.params);
          expect(ready.params).toEqual([
            {
              version: '2.0.0',
              chainId: '0xdee1',
              from: fixture.base.smartAccountAddress,
              atomicRequired: true,
              calls: [{ to: fixture.base.address, value: '0x1', data: '0x' }],
            },
          ]);
          await clickClosingPopup({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.reject, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
          });
          const result = await settle(dapp, id);
          expect(result.error?.code).toBe(4001);
          expect(result.result).toBeUndefined();
          const after = await publicState(page, host);
          expect(after).toEqual(baseline);
          expect(refusedWrites).toEqual([]);
          expect(fixture.audit.deniedWrites).toEqual([]);
          observations.push({ nonceReads, pending, ready, cancel: result });
        }
      );
      expect(extensionEvidence()).toEqual(runtime);
      status = 'passed';
    } finally {
      releaseNonce();
      await info.attach('smart-quote-read-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          status,
          runtime,
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(info.file))
            .digest('hex'),
          observations,
          observedReads,
          refusedWrites,
          fixtureAudit: fixture.audit,
          syntheticRpcOnly: true,
          controllerStateReplaced: false,
          signingApproved: false,
        }),
      });
      try {
        await wallet?.dispose(status);
      } finally {
        await server.close();
        Object.assign(E2E_CONFIG, before);
      }
    }
  });
}
