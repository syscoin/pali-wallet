import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'crypto';
import { Interface, formatEther } from 'ethers';
import fs from 'fs';
import http from 'http';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  extensionEvidence,
  popupFor,
  rpcObservation,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const ORIGIN = `https://${'batch-review-'.repeat(4)}synthetic.invalid`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const UNKNOWN_DATA = new Interface([
  'function ordinaryBatchMessage(bytes32 value)',
]).encodeFunctionData('ordinaryBatchMessage', [`0x${'a5'.repeat(32)}`]);
const KNOWN_DATA = new Interface([
  'function transfer(address to,uint256 amount)',
]).encodeFunctionData('transfer', [RECIPIENT, '17']);
const CALLS = [
  { to: CONTRACT, value: '0x1', data: UNKNOWN_DATA },
  { to: CONTRACT, value: '0x2', data: KNOWN_DATA },
];

const sourceHashes = () =>
  Object.fromEntries(
    [
      __filename,
      path.resolve(__dirname, '../../source/pages/Send/SendCalls.tsx'),
      path.resolve(__dirname, '../harness/isolatedVaultFixture.ts'),
    ].map((file) => [
      path.basename(file),
      createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ])
  );

test('send calls review exposes its real origin and exact known and unknown calldata through native disclosures', async ({}, info) => {
  expect(info.config.workers).toBe(1);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  expect(extensionPath).toBeTruthy();
  expect(path.isAbsolute(extensionPath!)).toBe(true);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  const runtime = extensionEvidence();
  const sources = sourceHashes();
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    extensionPath,
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SendCallsReviewSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const errors: string[] = [];
  const forbiddenWrites: string[] = [];
  const observations: unknown[] = [];
  try {
    wallet = await PaliWallet.launch('send-calls-review', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    for (const page of wallet.context.pages())
      page.on('pageerror', (error) => errors.push(error.message));
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => errors.push(error.message))
    );
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Reuse the existing inert local fixture document. Only its served origin
    // changes, so the real runtime sender supplies a long origin to the UI.
    // This request is to the explicitly started loopback server, never public.
    // APIRequestContext shares the browser's deny proxy and tunnels even this
    // fixture read. Fetch the exact started loopback document directly instead;
    // the browser's launch-time proxy and route fences remain unchanged.
    const documentBody = await new Promise<string>((resolve, reject) => {
      const request = http.get(`${server.url}/`, (response) => {
        if (
          response.statusCode !== 200 ||
          !response.headers['content-type']?.includes('text/html')
        ) {
          response.resume();
          reject(new Error('Local fixture document unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8'))
        );
        response.on('error', reject);
      });
      request.on('error', reject);
    });
    await wallet.context.route(`${ORIGIN}/`, async (route) => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: documentBody,
      });
    });
    // Review must never enter a sender. Retain the lower fixture's unknown-IO
    // fence while recording any attempted signing/broadcast RPC independently.
    await wallet.context.route('**/*', async (route) => {
      const request = route.request();
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        /* The document and read-only REST are handled by existing fixtures. */
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      const writes = calls.filter((call) =>
        /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
          call?.method || ''
        )
      );
      if (writes.length || /\/sendtx(?:\/|$)/i.test(request.url())) {
        forbiddenWrites.push(
          `${request.url()}:${writes.map((call) => call.method).join(',')}`
        );
        return route.abort('blockedbyclient');
      }
      return route.fallback();
    });
    await wallet.step(
      'onboard a disposable wallet and select EVM through ordinary UI',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    const selection = await wallet.page.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const ref = state.vault.activeAccount;
      return {
        address: state.vault.accounts[ref.type][ref.id].address,
        type: ref.type,
        chainId: state.vault.activeNetwork.chainId,
        currency: state.vault.activeNetwork.currency,
        isBitcoinBased: state.vault.isBitcoinBased,
      };
    });
    expect(selection.type).toBe('HDAccount');
    expect(selection.isBitcoinBased).toBe(false);
    expect(selection.chainId).toBe(5700);
    expect(selection.address.toLowerCase()).toBe(
      fixture.evmAddresses[0].toLowerCase()
    );
    await wallet.page.goto('about:blank');
    const dapp = await wallet.context.newPage();
    await dapp.goto(`${ORIGIN}/`);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    const connected = await wallet.step(
      'connect the actual injected provider at the synthetic origin',
      async (capture) =>
        approve(
          wallet!.context,
          dapp,
          await startRequest(dapp, 'eth_requestAccounts'),
          capture
        )
    );
    expect(connected.error).toBeUndefined();
    expect(
      connected.result.map((address: string) => address.toLowerCase())
    ).toEqual([selection.address.toLowerCase()]);
    const request = await startRequest(dapp, 'wallet_sendCalls', [
      {
        version: '2.0.0',
        chainId: '0x1644',
        from: connected.result[0],
        atomicRequired: false,
        calls: CALLS,
      },
    ]);
    const popup = await popupFor(wallet.context, dapp, request);
    const query = JSON.parse(new URL(popup.url()).searchParams.get('data')!);
    const actualOrigin = new URL(dapp.url()).origin;
    expect(actualOrigin).toBe(ORIGIN);
    expect(query.host).toBe(actualOrigin);
    expect(query.calls).toEqual(CALLS);
    expect(query.atomicRequired).toBe(false);
    expect(query.approvedContext.account.address.toLowerCase()).toBe(
      selection.address.toLowerCase()
    );
    const origin = popup.getByText(actualOrigin, { exact: true });
    const details = popup.locator('details');
    const summaries = details.locator('summary');
    const sign = popup.getByRole('button', { name: en.send.sign, exact: true });
    const rejected = popup.getByRole('button', {
      name: en.buttons.reject,
      exact: true,
    });
    const focusOrder: string[] = [];
    const focusSummary = async (target: Locator) => {
      for (let index = 0; index < 20; index += 1) {
        if (
          await target.evaluate((element) => element === document.activeElement)
        )
          break;
        await popup.keyboard.press('Tab');
        focusOrder.push(
          await popup.evaluate(() => {
            const active = document.activeElement;
            return `${active?.tagName || ''}:${
              active?.textContent?.trim() || ''
            }`;
          })
        );
      }
      await expect(target).toBeFocused();
    };
    const assertExposed = async (target: Locator) => {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      const viewport = popup.viewportSize()!;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await target.evaluate((element) => {
          const b = element.getBoundingClientRect();
          return [
            [b.left + 2, b.top + b.height / 2],
            [b.right - 2, b.top + b.height / 2],
            [b.left + b.width / 2, b.top + 2],
            [b.left + b.width / 2, b.bottom - 2],
          ].every(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return !!hit && (hit === element || element.contains(hit));
          });
        })
      ).toBe(true);
      return box;
    };
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await popup.setViewportSize(viewport);
      await wallet.step(
        `review real origin and both original calls at ${viewport.width}x${viewport.height}`,
        async (capture) => {
          await expect(sign).toBeEnabled();
          await expect(origin).toBeVisible();
          await origin.scrollIntoViewIfNeeded();
          const originBox = await assertExposed(origin);
          expect(
            await origin.evaluate(
              (element) => element.scrollWidth <= element.clientWidth
            )
          ).toBe(true);
          await expect(
            popup.getByText(
              `${en.send.from}: ${query.approvedContext.account.address}`,
              { exact: true }
            )
          ).toBeVisible();
          await expect(details).toHaveCount(2);
          for (let index = 0; index < CALLS.length; index += 1) {
            await expect(popup.locator(`#call-${index}`)).toBeChecked();
            await expect(popup.locator(`#call-${index}`)).toBeDisabled();
            await expect(details.nth(index)).not.toHaveAttribute('open');
            await expect(details.nth(index).locator('pre')).toHaveText(
              CALLS[index].data
            );
            await expect(details.nth(index).locator('pre')).toBeHidden();
          }
          await expect(
            popup.getByText('transfer', { exact: true })
          ).toBeVisible();
          await expect(
            popup.getByText(`to: ${RECIPIENT}`, { exact: true })
          ).toBeVisible();
          await expect(
            popup.getByText('amount: 17', { exact: true })
          ).toBeVisible();
          await expect(
            popup.getByText(`${formatEther('3')} ${selection.currency}`, {
              exact: true,
            })
          ).toBeVisible();
          observations.push({
            viewport,
            actualOrigin,
            originBox,
            knownDecodedAmount: '17',
            totalWei: '3',
          });
          await capture(popup);
        }
      );
      for (let index = 0; index < CALLS.length; index += 1) {
        await wallet.step(
          `native keyboard opens and closes call ${index + 1} at ${
            viewport.width
          }x${viewport.height}`,
          async (capture) => {
            const disclosure = details.nth(index);
            const summary = summaries.nth(index);
            const raw = disclosure.locator('pre');
            await focusSummary(summary);
            const targetBox = await assertExposed(summary);
            // Native details behavior is under test; no evaluate-click or
            // synthetic state/attribute change supplies the open state.
            await popup.keyboard.press(index === 0 ? 'Enter' : 'Space');
            await expect(disclosure).toHaveAttribute('open', '');
            await expect(raw).toBeVisible();
            await expect(raw).toHaveText(CALLS[index].data);
            expect(
              await raw.evaluate(
                (element) => element.scrollWidth <= element.clientWidth
              )
            ).toBe(true);
            await expect(summary).toBeFocused();
            await capture(popup);
            await popup.keyboard.press(index === 0 ? 'Space' : 'Enter');
            await expect(disclosure).not.toHaveAttribute('open');
            await expect(raw).toBeHidden();
            observations.push({
              viewport,
              index,
              targetBox,
              exactCalldata: await raw.textContent(),
              activation:
                index === 0
                  ? ['Tab', 'Enter', 'Space']
                  : ['Tab', 'Space', 'Enter'],
            });
          }
        );
      }
      await wallet.step(
        `ordinary pointer can also disclose unknown calldata at ${viewport.width}x${viewport.height}`,
        async (capture) => {
          await summaries.nth(0).click();
          await expect(details.nth(0)).toHaveAttribute('open', '');
          await expect(details.nth(0).locator('pre')).toHaveText(UNKNOWN_DATA);
          await expect(details.nth(0).locator('pre')).toBeVisible();
          await capture(popup);
          await summaries.nth(0).click();
          await expect(details.nth(0)).not.toHaveAttribute('open');
          await expect(details.nth(0).locator('pre')).toBeHidden();
          expect((await rpcObservation(dapp, request)).settled).not.toBe(true);
          expect(forbiddenWrites).toEqual([]);
          expect(routes.deniedWrites).toEqual([]);
        }
      );
    }
    await wallet.step(
      'reject the unsubmitted batch through its ordinary footer',
      async () => {
        const result = await dismissRejectedApproval({
          click: () => rejected.click(),
          isClosed: () => popup.isClosed(),
          settle: () => settle(dapp, request),
        });
        expect(result.error?.code).toBe(4001);
        expect(result.result).toBeUndefined();
      }
    );
    expect(errors).toEqual([]);
    expect(forbiddenWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(sourceHashes()).toEqual(sources);
    await info.attach('send-calls-review-observations', {
      body: JSON.stringify(
        {
          runtime,
          sources,
          documentSha256: createHash('sha256')
            .update(documentBody)
            .digest('hex'),
          actualOrigin,
          calls: CALLS,
          focusOrder,
          observations,
          rpc: await rpcObservation(dapp, request),
          fixtureReads: routes.reads,
          forbiddenWrites,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          signingApproved: false,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    status = 'passed';
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
