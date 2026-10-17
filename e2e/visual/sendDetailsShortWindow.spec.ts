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
  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await geometry(locator)).visible) return true;
    const box = await locator.boundingBox();
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 8, viewport.height / 2);
    await page.mouse.wheel(0, box && box.y < 0 ? -180 : 180);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
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
  const file = path.join(E2E_CONFIG.artifactsDir, `${label}.png`);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file, animations: 'disabled' });
  await test.info().attach(label, { path: file, contentType: 'image/png' });
}

for (const height of [360, 480, 620]) {
  test(`native and SPT Send, Confirm and Details at 400x${height}`, async () => {
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
    try {
      wallet = await PaliWallet.launch(`short-send-utxo-${height}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height },
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
        await wheelReveal(page, confirm);
        await capture(page, `${asset}-${height}-confirm-expanded`);
        await observe(page, confirm, `${asset}-${height}-confirm`);
        const cancel = page.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });
        await observe(page, cancel, `${asset}-${height}-cancel`);
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
        path.join(E2E_CONFIG.artifactsDir, `send-short-${height}.json`),
        JSON.stringify(
          {
            viewport: { width: 400, height },
            simulated: true,
            confirmed: false,
            deniedWrites: routes.deniedWrites,
          },
          null,
          2
        )
      );
    } finally {
      await wallet?.context.close().catch(() => undefined);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}

for (const height of [360, 480, 620]) {
  test(`EVM Send, Confirm and Details at 400x${height}`, async () => {
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
    const extraReads: string[] = [];
    const deniedWrites: string[] = [];
    try {
      wallet = await PaliWallet.launch(`short-send-evm-${height}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height },
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
        path.join(E2E_CONFIG.artifactsDir, `send-evm-short-${height}.json`),
        JSON.stringify(
          {
            viewport: { width: 400, height },
            simulated: true,
            confirmed: false,
            deniedWrites,
            extraReads,
          },
          null,
          2
        )
      );
    } finally {
      await wallet?.context.close().catch(() => undefined);
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  });
}
