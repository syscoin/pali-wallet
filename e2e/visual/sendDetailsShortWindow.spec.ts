import { type Locator, type Page, expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  createSptFixture,
  installSptFixtureRoutes,
  sptFixtureRead,
  SPT_SYMBOL,
} from '../harness/sptFixture';
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

const viewports = [
  { width: 320, height: 360 },
  { width: 320, height: 480 },
  { width: 400, height: 360 },
  { width: 400, height: 480 },
  { width: 400, height: 620 },
];

test('error reveal waits for finite validation motion before checking fixed-action occlusion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.route('**/*', (route) => route.abort('blockedbyclient'));
  await page.setContent(`
    <style>
      html, body { margin: 0; }
      #pane { height: 480px; overflow: auto; }
      .ant-form-item { padding-top: 400px; padding-bottom: 200px; }
      #error { width: 164px; height: 16px; overflow: hidden; transition: height 2s linear; }
      #action { position: fixed; left: 16px; right: 16px; bottom: 16px; height: 40px; }
    </style>
    <div id="pane"><div class="ant-form-item"><div id="error">Insufficient funds</div></div></div>
    <button id="action">Next</button>
  `);
  const error = page.locator('#error');
  expect((await geometry(error)).visible).toBe(true);
  await page.evaluate(() => {
    requestAnimationFrame(() => {
      document.getElementById('error')!.style.height = '40px';
    });
  });
  expect(await wheelReveal(page, error)).toBe(true);
  // Without waiting for actual motion, the helper exits with a transient
  // ~16px box. Its final 40px box would then overlap the fixed Next action.
  expect((await error.boundingBox())!.height).toBe(40);
  expect((await geometry(error)).visible).toBe(true);
  expect(
    await page.locator('#pane').evaluate((element) => element.scrollTop)
  ).toBeGreaterThan(0);
});

for (const { width, height } of viewports) {
  test(`native and SPT Send, Confirm and Details at ${width}x${height}`, async () => {
    test.setTimeout(120_000);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    const fixture = createSptFixture();
    const nativeId = '34'.repeat(32);
    const tokenId = '56'.repeat(32);
    const common = {
      fees: '226',
      confirmations: 2,
      blockHeight: 1,
      blockHash: 'ab'.repeat(32),
      blockTime: 1700000000,
      direction: 'sent',
      addressValueIn: '100000',
      addressValueOut: '49774',
      valueIn: '100000',
      value: '99774',
    };
    const native = { ...common, txid: nativeId, vin: [], vout: [] };
    const token = {
      ...common,
      txid: tokenId,
      tokenType: 'SPTAssetAllocationSend',
      vin: [],
      vout: [],
      accountAssetTransfers: [
        {
          type: 'SPT',
          assetGuid: '123457',
          contract: '123457',
          symbol: SPT_SYMBOL,
          decimals: 8,
          value: '10000000',
        },
      ],
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
    try {
      wallet = await PaliWallet.launch(`short-send-utxo-${width}-${height}`, {
        offlineHttpProxy: server.url,
        viewport: { width, height },
      });
      const routes = await installSptFixtureRoutes(
        wallet.context,
        fixture,
        server.url
      );
      await wallet.context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          request.method() !== 'GET' ||
          ![
            'https://blockbook-dev.syscoin.org',
            'https://explorer-blockbook-dev.syscoin.org',
          ].includes(url.origin)
        )
          return route.fallback();
        const base = sptFixtureRead(fixture, request.url(), request.method());
        let result: unknown;
        if (base && /^\/api\/v2\/(xpub|address)\//.test(url.pathname)) {
          result = {
            ...(base as object),
            txs: 2,
            transactions: [native, token],
          };
        } else if (url.pathname === `/api/v2/tx/${nativeId}`) {
          result = {
            ...native,
            vin: [{ addresses: [fixture.userAddress], value: '100000' }],
            vout: [
              { addresses: [fixture.recipientAddress], value: '50000' },
              { addresses: [fixture.userAddress], value: '49774' },
            ],
          };
        } else if (url.pathname === `/api/v2/tx/${tokenId}`) {
          result = {
            ...token,
            vin: [{ addresses: [fixture.userAddress], value: '100000' }],
            vout: [
              {
                addresses: [fixture.recipientAddress],
                value: '294',
                assetInfo: { assetGuid: '123457', value: '10000000' },
              },
            ],
            tokenTransfers: [
              { token: '123457', symbol: SPT_SYMBOL, decimals: 8 },
            ],
          };
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
      await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
      await wallet.ensureOnHome();
      await page.locator('#assets-btn').click();
      await page.getByText('Import Token', { exact: true }).click();
      const importButton = page.getByRole('button', {
        name: `Import ${SPT_SYMBOL} token`,
        exact: true,
      });
      await wheelReveal(page, importButton);
      await importButton.click();
      await expect(importButton).toBeDisabled();
      // The normal success toast intentionally overlays the bottom edge until
      // it expires. It is not a stable Send-page obstruction.
      await expect(
        page.getByText(`${SPT_SYMBOL} has been added to your wallet`, {
          exact: true,
        })
      ).toBeHidden({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await wallet.ensureOnHome();

      for (const asset of ['native', 'spt'] as const) {
        await page.locator('#send-btn').click();
        await expect(page).toHaveURL(/#\/send\/sys$/);
        if (asset === 'spt') {
          const selection = page
            .getByRole('button', { name: /^(TSYS|SYS)$/i })
            .first();
          await wheelReveal(page, selection);
          await selection.click();
          await page
            .getByRole('menuitem')
            .filter({ hasText: SPT_SYMBOL })
            .click();
        }
        const recipient = page.getByPlaceholder('Receiver', { exact: true });
        const amount = page.getByPlaceholder('Amount', { exact: true });
        const fee = page.locator('#fee-input');
        await recipient.fill(fixture.recipientAddress);
        await amount.fill(asset === 'native' ? '0.0005' : '0.1');
        const max = page.getByRole('button', { name: 'MAX', exact: true });
        await keyboardReach(page, max);
        await observe(page, max, `${asset}-${height}-max-keyboard`);
        await page.keyboard.press('Space');
        await expect(amount).not.toHaveValue('');
        await amount.fill(asset === 'native' ? '0.0005' : '0.1');
        await fee.fill('0.0001');
        const error = page.getByText(/exceeds the wallet safety limit/);
        await expect(error).toBeVisible();
        await wheelReveal(page, error);
        await capture(page, `${asset}-${height}-fee-error`);
        await observe(page, error, `${asset}-${height}-fee-error`);
        const next = page.getByRole('button', { name: 'Next', exact: true });
        await observe(page, next, `${asset}-${height}-next-after-error`);
        await fee.fill('0.00000002');
        await wheelReveal(page, page.getByRole('switch'));
        await observe(
          page,
          page.getByRole('switch'),
          `${asset}-${height}-last-option`
        );
        await capture(page, `${asset}-${height}-send`);
        await keyboardReach(page, next);
        await observe(page, next, `${asset}-${height}-next-keyboard`);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        const confirm = page.getByRole('button', {
          name: 'Confirm',
          exact: true,
        });
        await expect(confirm).toBeEnabled();
        const advanced = page.getByRole('button', {
          name: 'Advanced Details',
          exact: true,
        });
        await wheelReveal(page, advanced);
        await observe(page, advanced, `${asset}-${height}-advanced`);
        await advanced.click();
        // Native previews decode lazily when Advanced opens. The collapsed
        // Confirm button can still be visible for one render before the async
        // detail body pushes it down. Wait for the completed decoded body;
        // checking visibility here would incorrectly skip the required scroll.
        await expect(
          page.getByText('Lock Time:', { exact: true })
        ).toBeAttached();
        // Shortened identifiers should remain one readable line, even when
        // the value needs to move below its label in a narrow wallet window.
        const originRow = page
          .getByText('Origin contract:', { exact: true })
          .first()
          .locator('..');
        const shortenedOrigin = originRow.locator('span.ant-typography').last();
        await expect(shortenedOrigin).toContainText('...');
        const originLayout = await shortenedOrigin.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            lines: range.getClientRects().length,
            clipped: element.scrollWidth > element.clientWidth,
          };
        });
        expect(originLayout).toEqual({ lines: 1, clipped: false });
        // These passive asset quantities are part of the unsigned review, not
        // disabled controls. Read the real composed colors on their opaque
        // cards, while preserving every existing amount and Cancel assertion.
        const assetAmounts = page
          .locator('span.ant-typography')
          .filter({ hasText: new RegExp(`^[0-9][0-9.,]*\\s+${SPT_SYMBOL}$`) });
        expect(await assetAmounts.count()).toBeGreaterThanOrEqual(2);
        const reviewedAssetAmounts = await assetAmounts.allTextContents();
        for (let index = 0; index < reviewedAssetAmounts.length; index += 1) {
          const result = await captureForegroundContrast(
            assetAmounts.nth(index),
            test.info(),
            `${asset}-${width}x${height}-asset-amount-${index}`
          );
          expect(result.disabled).toBe(false);
          expect(result.minimum).toBe(4.5);
        }
        await expect(assetAmounts).toHaveText(reviewedAssetAmounts);
        const nativeAmount = page
          .locator('span.ant-typography')
          .filter({ hasText: /^[0-9][0-9.,]*\s+TSYS$/ })
          .first();
        const nativeResult = await captureForegroundContrast(
          nativeAmount,
          test.info(),
          `${asset}-${width}x${height}-native-amount-control`
        );
        expect(nativeResult.disabled).toBe(false);
        await wheelReveal(page, confirm);
        await capture(page, `${asset}-${height}-confirm-expanded`);
        await observe(page, confirm, `${asset}-${height}-confirm`);
        const cancel = page.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });
        await observe(page, cancel, `${asset}-${height}-cancel`);
        const cancelBox = (await cancel.boundingBox())!;
        const confirmBox = (await confirm.boundingBox())!;
        expect(
          confirmBox.x - cancelBox.x - cancelBox.width
        ).toBeGreaterThanOrEqual(8);
        await keyboardReach(page, cancel);
        await observe(page, cancel, `${asset}-${height}-cancel-keyboard`);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/send\/sys$/);
        await expect(amount).toHaveValue(asset === 'native' ? '0.0005' : '0.1');
        if (asset === 'spt') {
          await wheelReveal(page, max);
          await max.click();
          await keyboardReach(page, next);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/send\/confirm$/);
          const headline = page.locator('p.text-2xl');
          await wheelReveal(page, headline);
          await observe(page, headline, `spt-${height}-large-max-headline`);
          await capture(page, `spt-${height}-large-max-headline`);
          await wheelReveal(page, cancel);
          await cancel.click();
          await expect(page).toHaveURL(/#\/send\/sys$/);
        }
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await wallet.ensureOnHome();
      }

      await page.locator('#activity-btn').click();
      for (const id of [nativeId, tokenId]) {
        const row = page
          .getByText(`${id.slice(0, 4)}...${id.slice(-14)}`, { exact: true })
          .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
        const details = row.getByRole('button', {
          name: en.notifications.clickToView,
        });
        await wheelReveal(page, details);
        await observe(
          page,
          details,
          `${id.slice(0, 2)}-${height}-details-action`
        );
        await details.click();
        await expect(page).toHaveURL(/#\/home\/details/);
        const explorer = page.getByText('View on Explorer', { exact: true });
        await wheelReveal(page, explorer);
        await observe(page, explorer, `${id.slice(0, 2)}-${height}-explorer`);
        await capture(page, `${id.slice(0, 2)}-${height}-details-bottom`);
        // A visible action must also be a keyboard-operable native control.
        expect
          .soft(
            await explorer
              .locator('..')
              .evaluate(
                (element) =>
                  element.tagName === 'BUTTON' || element.tagName === 'A'
              ),
            'View on Explorer must be keyboard operable'
          )
          .toBe(true);
        const back = page.getByRole('button', { name: 'Back', exact: true });
        await wheelReveal(page, back);
        await observe(page, back, `${id.slice(0, 2)}-${height}-details-back`);
        await back.click();
        await page.locator('#activity-btn').click();
      }
      expect(routes.deniedWrites).toEqual([]);
      fs.writeFileSync(
        path.join(
          E2E_CONFIG.artifactsDir,
          `send-short-${width}-${height}.json`
        ),
        JSON.stringify(
          {
            viewport: { width, height },
            simulated: true,
            confirmed: false,
            deniedWrites: routes.deniedWrites,
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

for (const { width, height } of viewports) {
  test(`EVM Send, Confirm and Details at ${width}x${height}`, async () => {
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
    const deniedWrites: string[] = [];
    try {
      wallet = await PaliWallet.launch(`short-send-evm-${width}-${height}`, {
        offlineHttpProxy: server.url,
        viewport: { width, height },
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
            if (call.method === 'eth_estimateGas') value = '0x5208';
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
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#\/send\/confirm$/);
      const confirm = page.getByRole('button', {
        name: 'Confirm',
        exact: true,
      });
      await expect(confirm).toBeEnabled();
      await wheelReveal(page, confirm);
      await observe(page, confirm, `evm-${height}-confirm`);
      await capture(page, `evm-${height}-confirm`);
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
      await keyboardReach(page, cancel);
      await observe(page, cancel, `evm-${height}-cancel`);
      await page.keyboard.press('Space');
      await expect(page).toHaveURL(/#\/send\/eth$/);
      await expect(amount).toHaveValue('0.0005');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await wallet.ensureOnHome();
      await page.locator('#activity-btn').click();
      // EVM activity labels the operation, not its transaction hash.
      const details = page.locator('#activity-panel-list').getByRole('button', {
        name: en.notifications.clickToView,
      });
      await expect(details).toHaveCount(1);
      await wheelReveal(page, details);
      await details.click();
      await expect(page).toHaveURL(/#\/home\/details/);
      const explorer = page.getByText('View on Explorer', { exact: true });
      await wheelReveal(page, explorer);
      await observe(page, explorer, `evm-${height}-explorer`);
      const timestampRow = page
        .getByText('Timestamp', { exact: true })
        .locator('..');
      const expectedTimestamp = await page.evaluate(() =>
        new Date(1700000000 * 1000).toLocaleString('en')
      );
      const timestamp = timestampRow.getByText(expectedTimestamp, {
        exact: true,
      });
      await expect(timestamp).toBeVisible();
      await expect(timestamp).toBeInViewport({ ratio: 1 });
      await capture(page, `evm-${height}-details`);
      expect
        .soft(
          await explorer
            .locator('..')
            .evaluate(
              (element) =>
                element.tagName === 'BUTTON' || element.tagName === 'A'
            ),
          'EVM View on Explorer must be keyboard operable'
        )
        .toBe(true);
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
            simulated: true,
            confirmed: false,
            deniedWrites,
            extraReads,
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
