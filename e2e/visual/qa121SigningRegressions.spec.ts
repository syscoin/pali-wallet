import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
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
import {
  approve,
  extensionEvidence,
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

async function withWallet(
  name: string,
  info: TestInfo,
  run: (wallet: PaliWallet, origin: string) => Promise<void>
) {
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'Qa121SigningSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch(name, {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    const attemptedWrites: string[] = [];
    // Only chain reads are fulfilled. The launch-time deny proxy also prevents
    // any unhandled request from reaching a public network.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      const data = request.postDataJSON();
      const calls = Array.isArray(data) ? data : [data];
      if (
        calls.some((call) =>
          /^(?:eth_send|wallet_send|personal_|anvil_|evm_)/.test(
            call?.method || ''
          )
        )
      ) {
        attemptedWrites.push(...calls.map((call) => call.method));
        return route.abort('blockedbyclient');
      }
      const replies = calls.map((call) => {
        let result: unknown;
        if (call.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
        if (call.method === 'eth_estimateGas') result = '0x5208';
        if (call.method === 'eth_getTransactionCount') result = '0x0';
        if (call.method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0.5],
            reward: [['0x3b9aca00']],
          };
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.every((reply) => reply !== undefined))
        return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(data) ? replies : replies[0]),
      });
    });
    await wallet.importSeedAndCreatePassword();
    await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
    await wallet.ensureOnHome();
    await run(wallet, server.url);
    expect(routes.deniedWrites).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    await info.attach('runtime-evidence', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          testSourceSha256: createHash('sha256')
            .update(fs.readFileSync(__filename))
            .digest('hex'),
          simulated: true,
          controllerStateReplaced: false,
          deniedWrites: routes.deniedWrites,
          attemptedWrites,
          proxyDeniedConnections: server.blocked.length,
        },
        null,
        2
      ),
    });
  } finally {
    await wallet?.context.close();
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
}

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  value: unknown
) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
  await info.attach(`${name}-observations`, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
}

test('fee edit is keyboard accessible and Save is the only operation that changes the saved fee', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('qa121-fee-regression', info, async (wallet) => {
    const page = wallet.page;
    await expect(page.locator('#home-balance')).toHaveText('1');
    await page.locator('#send-btn').click();
    await page
      .getByPlaceholder('Receiver', { exact: true })
      .fill('0x1111111111111111111111111111111111111111');
    await page.getByPlaceholder('Amount', { exact: true }).fill('0.0005');
    await page.locator('#send-eth-next-btn').click();
    await expect(page).toHaveURL(/#\/send\/confirm$/);
    await expect(
      page.getByRole('button', { name: en.buttons.confirm, exact: true })
    ).toBeEnabled();
    const edit = page.getByRole('button', {
      name: en.send.editFee,
      exact: true,
    });
    await expect(edit).toHaveAttribute('type', 'button');
    let reached = false;
    for (let step = 0; step < 24 && !reached; step++) {
      await page.keyboard.press('Tab');
      reached = await edit.evaluate(
        (element) => element === document.activeElement
      );
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const maximum = dialog.getByLabel(`${en.send.maxFee} (GWEI)`, {
      exact: true,
    });
    const gas = dialog.getByLabel(en.send.gasLimit, { exact: true });
    const read = async () => ({
      maximum: await maximum.inputValue(),
      gas: await gas.inputValue(),
    });
    const open = async () => {
      await edit.click();
      await expect(dialog).toBeVisible();
    };
    await maximum.fill('10');
    await dialog
      .getByRole('button', { name: en.buttons.save, exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await open();
    const saved = await read();
    expect(saved.maximum).toBe('10');
    await capture(page, info, 'fee-saved-ten', saved);
    for (const dismiss of ['cancel', 'escape'] as const) {
      if (dismiss === 'cancel')
        await dialog
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
      else await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await open();
      expect(await read()).toEqual(saved);
      await maximum.fill('20');
      if (dismiss === 'cancel')
        await dialog
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
      else await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await open();
      expect(await read()).toEqual(saved);
      await capture(page, info, `fee-preserved-after-${dismiss}`, {
        saved,
        reopened: await read(),
      });
    }
    await dialog
      .getByRole('button', { name: en.buttons.cancel, exact: true })
      .click();
    // Deliberately never click transaction Confirm: this only previews a send.
  });
});

async function textGeometry(value: Locator) {
  return value.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const overflow: unknown[] = [];
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (/auto|hidden|scroll|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, rect.left + parent.clientLeft);
        clip.right = Math.min(
          clip.right,
          rect.left + parent.clientLeft + parent.clientWidth
        );
      }
      if (/auto|hidden|scroll|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, rect.top + parent.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          rect.top + parent.clientTop + parent.clientHeight
        );
      }
      if (parent.scrollWidth > parent.clientWidth + 1)
        overflow.push({
          tag: parent.tagName,
          width: parent.clientWidth,
          scrollWidth: parent.scrollWidth,
        });
    }
    const rectangles = [...range.getClientRects()]
      .filter((rect) => rect.width > 0)
      .map((rect) => ({
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
      }));
    const exposed =
      rectangles.length > 0 &&
      rectangles.every((rect) => {
        if (
          rect.x < clip.left - 1 ||
          rect.right > clip.right + 1 ||
          rect.y < clip.top - 1 ||
          rect.bottom > clip.bottom + 1
        )
          return false;
        const hit = document.elementFromPoint(
          (rect.x + rect.right) / 2,
          (rect.y + rect.bottom) / 2
        );
        return !!hit && (element === hit || element.contains(hit));
      });
    return {
      text: element.textContent,
      rectangles,
      clip,
      exposed,
      overflow,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
}

for (const viewport of [
  { width: 320, height: 360 },
  { width: 400, height: 620 },
]) {
  test(`long legacy signing field wraps and exposes the full value at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    test.setTimeout(120000);
    await withWallet(
      `qa121-legacy-wrap-${viewport.width}`,
      info,
      async (wallet, origin) => {
        await wallet.page.goto('about:blank');
        const dapp = await wallet.context.newPage();
        await dapp.goto(origin);
        await dapp.waitForFunction(() => Boolean((window as any).pali));
        const connected = await approve(
          wallet.context,
          dapp,
          await startRequest(dapp, 'eth_requestAccounts')
        );
        const fields = [
          {
            name: 'Field'.repeat(40),
            type: 'string',
            value: 'IMPORTANT_SIGNED_VALUE',
          },
        ];
        const request = await startRequest(dapp, 'eth_signTypedData', [
          connected.result[0],
          fields,
        ]);
        const popup = await popupFor(wallet.context, dapp, request);
        await popup.setViewportSize(viewport);
        const label = popup.getByText(fields[0].name, { exact: true });
        const value = popup.getByText(fields[0].value, { exact: true });
        await expect(label).toHaveCount(1);
        await expect(value).toHaveCount(1);
        const labelGeometry = await textGeometry(label);
        expect(labelGeometry.overflow).toEqual([]);
        for (const rect of labelGeometry.rectangles) {
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(viewport.width);
        }
        let valueGeometry = await textGeometry(value);
        const scrollSteps: unknown[] = [];
        for (let step = 0; step < 24 && !valueGeometry.exposed; step++) {
          // Ordinary wheel input reaches both the nested Details scroller and
          // outer approval scroller; no DOM scroll/style/state substitution.
          await popup.mouse.move(
            step % 2 ? viewport.width - 4 : viewport.width / 2,
            viewport.height / 2
          );
          await popup.mouse.wheel(0, 90);
          await popup.waitForTimeout(100);
          valueGeometry = await textGeometry(value);
          scrollSteps.push(valueGeometry);
        }
        await capture(popup, info, `legacy-wrap-${viewport.width}`, {
          labelGeometry,
          valueGeometry,
          scrollSteps,
        });
        expect(valueGeometry.text).toBe(fields[0].value);
        expect(valueGeometry.exposed).toBe(true);
        expect(valueGeometry.overflow).toEqual([]);
        expect(valueGeometry.documentWidth).toBe(viewport.width);
        await popup
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
        expect((await settle(dapp, request)).error?.code).toBe(4001);
      }
    );
  });
}
