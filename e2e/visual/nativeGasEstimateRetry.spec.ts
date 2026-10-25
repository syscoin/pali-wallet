import { type Locator, type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Never scroll or focus as part of an observation. Capture all four edges and
// the actual hit targets, including clipping by nested scroll containers.
async function geometry(locator: Locator) {
  return locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, box.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          box.left + node.clientLeft + node.clientWidth
        );
      }
      if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, box.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          box.top + node.clientTop + node.clientHeight
        );
      }
    }
    const contained =
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left >= clip.left - 0.5 &&
      bounds.right <= clip.right + 0.5 &&
      bounds.top >= clip.top - 0.5 &&
      bounds.bottom <= clip.bottom + 0.5;
    const points = [
      [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      [bounds.left + 2, bounds.top + bounds.height / 2],
      [bounds.right - 2, bounds.top + bounds.height / 2],
      [bounds.left + bounds.width / 2, bounds.top + 2],
      [bounds.left + bounds.width / 2, bounds.bottom - 2],
    ];
    const visible =
      contained &&
      points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (element === hit || element.contains(hit));
      });
    return { visible: Boolean(visible), bounds: bounds.toJSON(), clip };
  });
}

async function wheelReveal(page: Page, locator: Locator) {
  // AntD makes a newly validated error "visible" while its height/transform
  // are still animating. A transient short box can pass the hit test, then
  // grow behind a fixed action before observe() runs. Let the target's form
  // item finish its actual finite motion before deciding whether to scroll;
  // do not disable animations or relax the full-edge/hit-target assertions.
  await locator.evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    const boundary = element.closest('.ant-form-item') || element;
    await Promise.all(
      boundary
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime)
        )
        .map((animation) => animation.finished.catch(() => undefined))
    );
    // Transition-end handlers can remove temporary collapse styles on the
    // following React render. Measure that settled layout, not an exit frame.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  for (let attempt = 0; attempt < 24; attempt++) {
    if ((await geometry(locator)).visible) return true;
    const box = await locator.boundingBox();
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 8, viewport.height / 2);
    await page.mouse.wheel(0, box && box.y < 0 ? -180 : 180);
    // Wheel dispatch returns before composited scrolling settles. Avoid
    // sending a burst of events that is still moving when geometry is read.
    await page.waitForTimeout(100);
  }
  return (await geometry(locator)).visible;
}

async function keyboardReach(page: Page, locator: Locator) {
  const backwards = await locator.evaluate((element) =>
    Boolean(
      element.compareDocumentPosition(document.activeElement!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    )
  );
  for (let attempt = 0; attempt < 35; attempt++) {
    if (await locator.evaluate((element) => document.activeElement === element))
      return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  await expect(locator).toBeFocused();
}

async function observe(page: Page, locator: Locator, label: string) {
  const result = await geometry(locator);
  await test.info().attach(`${label}-geometry`, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect.soft(result.visible, `${label}: ${JSON.stringify(result)}`).toBe(true);
  return result.visible;
}

async function capture(page: Page, label: string) {
  const caseName = test.info().title.replace(/[^a-zA-Z0-9-]+/g, '-');
  const file = path.join(E2E_CONFIG.artifactsDir, `${caseName}-${label}.png`);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file, animations: 'disabled' });
  await test.info().attach(label, { path: file, contentType: 'image/png' });
}

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const viewports = [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
];
for (const { width, height } of viewports) {
  test(`Native gas Retry preserves the exact draft at ${width}x${height}`, async () => {
    test.setTimeout(90_000);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createIsolatedVaultFixture();
    const hash = `0x${'78'.repeat(32)}`;
    const transaction = {
      hash,
      from: fixture.evmAddresses[0],
      to: fixture.evmAddresses[1],
      value: '500000000000000',
      input: '0x',
      nonce: '0',
      blockNumber: '1',
      blockHash: `0x${'12'.repeat(32)}`,
      timeStamp: '1700000000',
      gas: '21000',
      gasUsed: '21000',
      gasPrice: '1000000000',
      confirmations: '2',
      isError: '0',
      // Explorer wire field.
      // eslint-disable-next-line camelcase
      txreceipt_status: '1',
    };
    Object.assign(E2E_CONFIG, {
      extensionPath:
        process.env.PALI_TEST_DAPP_EXTENSION_PATH || E2E_CONFIG.extensionPath,
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ShortWindowSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const extraReads: string[] = [];
    let estimateMode: 'healthy' | 'failed' = 'healthy';
    const estimateReads: { mode: string; params: unknown }[] = [];
    const deniedWrites: string[] = [];
    try {
      wallet = await PaliWallet.launch(`short-send-evm-${width}-${height}`, {
        offlineHttpProxy: server.url,
        viewport: { width, height },
        recordVideo: false,
      });
      const routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let result: unknown;
        if (
          request.method() === 'GET' &&
          url.origin === 'https://explorer.tanenbaum.io' &&
          url.pathname === '/api'
        ) {
          const action = url.searchParams.get('action');
          result = {
            status: '1',
            message: 'OK',
            result:
              action === 'txlist'
                ? [transaction]
                : action === 'gettxinfo'
                ? transaction
                : action === 'eth_block_number'
                ? '0x2'
                : [],
          };
          extraReads.push(`explorer:${action}`);
        } else if (
          request.method() === 'POST' &&
          url.origin === 'https://rpc.tanenbaum.io' &&
          url.pathname === '/'
        ) {
          const payload = request.postDataJSON();
          const calls = Array.isArray(payload) ? payload : [payload];
          if (
            calls.some((call) =>
              /^(?:eth_send|wallet_send|personal_|anvil_|evm_)/.test(
                call?.method || ''
              )
            )
          ) {
            deniedWrites.push(...calls.map((call) => call?.method));
            return route.abort('blockedbyclient');
          }
          const replies = calls.map((call) => {
            let value: unknown;
            if (call.method === 'eth_chainId') value = '0x1644';
            if (call.method === 'net_version') value = '5700';
            if (call.method === 'eth_blockNumber') value = '0x2';
            if (call.method === 'eth_getBalance') value = '0xde0b6b3a7640000';
            if (call.method === 'eth_estimateGas') {
              expect(call.params).toHaveLength(1);
              expect(call.params[0]).toEqual({
                data: '0x',
                from: fixture.evmAddresses[0].toLowerCase(),
                to: fixture.evmAddresses[1].toLowerCase(),
                value: '0x1c6bf52634000',
              });
              estimateReads.push({ mode: estimateMode, params: call.params });
              if (estimateMode === 'failed')
                return {
                  jsonrpc: '2.0',
                  id: String(call.id) + '-wrong-correlation',
                  result: '0x5208',
                };
              value = '0x5208';
            }
            if (call.method === 'eth_getTransactionCount') value = '0x1';
            if (
              ['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(call.method)
            )
              value = '0x3b9aca00';
            if (['eth_getCode', 'eth_call'].includes(call.method)) value = '0x';
            if (call.method === 'eth_getLogs') value = [];
            if (call.method === 'eth_getBlockByNumber')
              value = {
                number: '0x2',
                hash: `0x${'12'.repeat(32)}`,
                parentHash: `0x${'11'.repeat(32)}`,
                nonce: '0x0000000000000000',
                timestamp: '0x6553f100',
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x0',
                miner: `0x${'00'.repeat(20)}`,
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
            if (call.method === 'eth_feeHistory')
              value = {
                oldestBlock: '0x1',
                baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
                gasUsedRatio: [0.5],
                reward: [['0x3b9aca00']],
              };
            if (value === undefined) return undefined;
            extraReads.push(`rpc:${call.method}`);
            return { jsonrpc: '2.0', id: call.id, result: value };
          });
          if (replies.every((reply) => reply !== undefined))
            result = Array.isArray(payload) ? replies : replies[0];
          else return route.fallback();
        } else return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(result),
        });
      });
      const page = wallet.page;
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet.ensureOnHome();
      await expect(page.locator('#home-balance')).toHaveText('1');
      await page.locator('#send-btn').click();
      await expect(page).toHaveURL(/#\/send\/eth$/);
      const recipient = page.getByPlaceholder('Receiver', { exact: true });
      const amount = page.getByPlaceholder('Amount', { exact: true });
      await recipient.fill(fixture.evmAddresses[1]);
      await wallet.step(
        'Healthy funded wallet and retained native Send draft',
        async () => {
          await amount.fill('2');
          await page.keyboard.press('Tab');
          const error = page.getByText('Insufficient funds', { exact: true });
          await expect(error).toBeVisible();
          await wheelReveal(page, error);
          await observe(page, error, `evm-${height}-amount-error`);
          await capture(page, `evm-${height}-amount-error`);
          await amount.fill('0.0005');
          const max = page.getByRole('button', { name: 'MAX', exact: true });
          await keyboardReach(page, max);
          await observe(page, max, `evm-${height}-max-keyboard`);
          await page.keyboard.press('Space');
          await expect(amount).not.toHaveValue('');
          await amount.fill('0.0005');
          const next = page.locator('#send-eth-next-btn');
          await keyboardReach(page, next);
          await observe(page, next, `evm-${height}-next`);
          await capture(page, `evm-${height}-send`);
          estimateMode = 'failed';
          await page.keyboard.press('Enter');
        }
      );
      await expect(page).toHaveURL(/#\/send\/confirm$/);
      const confirm = page.getByRole('button', {
        name: 'Confirm',
        exact: true,
      });
      await wallet.step(
        'Actual gas read error prevents confirmation and exposes Retry',
        async () => {
          await expect(
            page.getByText(en.send.unableToLoad, { exact: true }).first()
          ).toBeVisible();
          await expect(confirm).toBeDisabled();
          const retry = page
            .getByRole('button', { name: en.receive.retry, exact: true })
            .first();
          await wheelReveal(page, retry);
          await observe(page, retry, `evm-${height}-gas-error-retry`);
          await capture(page, `evm-${height}-gas-error`);
          expect(estimateReads.some((read) => read.mode === 'failed')).toBe(
            true
          );
          const failedEstimateCount = estimateReads.length;
          estimateMode = 'healthy';
          const retryAt = Date.now();
          await retry.click();
          await expect(confirm).toBeEnabled();
          await expect(
            page.getByText(en.send.unableToLoad, { exact: true })
          ).toHaveCount(0);
          await wheelReveal(page, confirm);
          await capture(page, `first-retry-result-${width}`);
          const info = test.info();
          await info.attach(`first-retry-event-${width}`, {
            contentType: 'application/json',
            body: JSON.stringify({
              retryAt,
              observedAt: Date.now(),
              failedEstimateCount,
              estimateReads,
              state: 'recovered',
              clickCount: 1,
              viewport: { width, height },
            }),
          });
          expect(
            estimateReads
              .slice(failedEstimateCount)
              .some((read) => read.mode === 'healthy')
          ).toBe(true);
        }
      );
      await wheelReveal(page, confirm);
      await observe(page, confirm, `evm-${height}-confirm`);
      await capture(page, `evm-${height}-confirm`);
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
      await keyboardReach(page, cancel);
      await observe(page, cancel, `evm-${height}-cancel`);
      await page.keyboard.press('Space');
      await expect(page).toHaveURL(/#\/send\/eth$/);
      await expect(amount).toHaveValue('0.0005');
      await wallet.step(
        'Cancel restores the same recipient and amount without signing',
        async () => {
          await expect(recipient).toHaveValue(fixture.evmAddresses[1]);
          await expect(amount).toHaveValue('0.0005');
          await page.getByRole('button', { name: 'Back', exact: true }).click();
          await wallet!.ensureOnHome();
        }
      );
      expect(deniedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      fs.writeFileSync(
        path.join(
          E2E_CONFIG.artifactsDir,
          `send-evm-short-${width}-${height}.json`
        ),
        JSON.stringify(
          {
            viewport: { width, height },
            recordVideo: false,
            simulated: true,
            confirmed: false,
            deniedWrites,
            extraReads,
            estimateReads,
          },
          null,
          2
        )
      );
      if (test.info().errors.length === 0) status = 'passed';
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
