import { expect, test } from '@playwright/test';
import { AbiCoder, Interface, id } from 'ethers';

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
  popupFor,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('external transaction review exposes exact Data and Hex through keyboard tabs and mouse', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const contract = '0x000000000000000000000000000000000000ed6e';
  const spender = `0x${'11'.repeat(20)}`;
  const approveInterface = new Interface(['function approve(address,uint256)']);
  const data = approveInterface.encodeFunctionData('approve', [spender, 42]);
  const abi = AbiCoder.defaultAbiCoder();
  const metadata = new Map([
    [id('name()').slice(0, 10), abi.encode(['string'], ['Review Token'])],
    [id('symbol()').slice(0, 10), abi.encode(['string'], ['REVIEW'])],
    [id('decimals()').slice(0, 10), abi.encode(['uint8'], [8])],
    [id('balanceOf(address)').slice(0, 10), abi.encode(['uint256'], [0])],
    [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [0])],
    [
      id('supportsInterface(bytes4)').slice(0, 10),
      abi.encode(['bool'], [false]),
    ],
  ]);
  const writes: string[] = [];
  const errors: string[] = [];
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TransactionTabsSynthetic!2026',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('transaction-review-tabs', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    wallet.context.on('page', (page) =>
      page.on('pageerror', (error) => errors.push(error.message))
    );
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      ) {
        writes.push(...calls.map((call: any) => call.method));
        return route.abort('blockedbyclient');
      }
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call.method === 'eth_estimateGas') result = '0x5208';
        if (call.method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0.5],
            reward: [['0x3b9aca00']],
          };
        if (
          call.method === 'eth_getCode' &&
          call.params[0].toLowerCase() === contract
        )
          result = '0x60006000fd';
        if (
          call.method === 'eth_call' &&
          call.params[0].to?.toLowerCase() === contract
        )
          result = metadata.get(call.params[0].data.slice(0, 10));
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.every((reply) => reply !== undefined))
        return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    await wallet.step('onboard the fenced synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet!.ensureOnHome();
    });
    await wallet.page.goto('about:blank');
    const dapp = await wallet.context.newPage();
    await dapp.goto(server.url);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    const connected = await approve(
      wallet.context,
      dapp,
      await startRequest(dapp, 'eth_requestAccounts')
    );
    const request = await startRequest(dapp, 'eth_sendTransaction', [
      { from: connected.result[0], to: contract, value: '0x0', data },
    ]);
    const popup = await popupFor(wallet.context, dapp, request);
    const tabs = popup.getByRole('tablist');
    const details = tabs.getByRole('tab', {
      name: en.send.details,
      exact: true,
    });
    const dataTab = tabs.getByRole('tab', { name: en.send.data, exact: true });
    const hex = tabs.getByRole('tab', { name: en.send.hex, exact: true });
    const detailsPanel = popup.getByRole('tabpanel', {
      name: en.send.details,
      exact: true,
    });
    const dataPanel = popup.getByRole('tabpanel', {
      name: en.send.data,
      exact: true,
    });
    const hexPanel = popup.getByRole('tabpanel', {
      name: en.send.hex,
      exact: true,
    });
    const assertData = async (rawAmount = '42') => {
      await expect(dataTab).toHaveAttribute('aria-selected', 'true');
      await expect(dataPanel).toBeVisible();
      const decoded = JSON.parse(await dataPanel.locator('pre').innerText());
      expect(decoded.method).toBe('approve');
      expect(decoded.inputs).toEqual([spender, rawAmount]);
      return decoded;
    };
    const assertHex = async (expectedData = data) => {
      await expect(hex).toHaveAttribute('aria-selected', 'true');
      await expect(hexPanel).toBeVisible();
      expect((await hexPanel.innerText()).trim()).toBe(expectedData);
    };
    const focusOrder: string[] = [];
    await wallet.step(
      'reach and navigate the review tabs with only the keyboard',
      async (capture) => {
        await expect(detailsPanel).toBeVisible();
        for (let index = 0; index < 20; index += 1) {
          await popup.keyboard.press('Tab');
          focusOrder.push(
            await popup.evaluate(
              () =>
                document.activeElement?.id ||
                document.activeElement?.tagName ||
                ''
            )
          );
          if (
            await details.evaluate(
              (element) => element === document.activeElement
            )
          )
            break;
        }
        await expect(details).toBeFocused();
        await popup.keyboard.press('ArrowRight');
        await expect(dataTab).toBeFocused();
        await assertData();
        await popup.keyboard.press('End');
        await expect(hex).toBeFocused();
        await assertHex();
        await popup.keyboard.press('ArrowRight');
        await expect(details).toBeFocused();
        await expect(detailsPanel).toBeVisible();
        await popup.keyboard.press('ArrowLeft');
        await expect(hex).toBeFocused();
        await assertHex();
        await popup.keyboard.press('Home');
        await expect(details).toBeFocused();
        await expect(detailsPanel).toBeVisible();
        await capture(popup);
      }
    );
    await wallet.step(
      'report address copy only after native acceptance and retain refusal feedback',
      async (capture) => {
        await popup.evaluate(() => {
          (window as any).__reviewCopies = [];
          (window as any).__finishReviewCopies = [];
          (window as any).__lastClipboardRefusalAt = 0;
          (window as any).__lastClipboardAcceptanceAt = 0;
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: (text: string) =>
                new Promise<void>((resolve, reject) => {
                  (window as any).__reviewCopies.push(text);
                  (window as any).__finishReviewCopies.push(
                    (accepted: boolean) => {
                      if (accepted) {
                        (window as any).__lastClipboardAcceptanceAt =
                          Date.now();
                        return resolve();
                      }
                      (window as any).__lastClipboardRefusalAt = Date.now();
                      reject(
                        new DOMException(
                          'Synthetic clipboard refusal',
                          'NotAllowedError'
                        )
                      );
                    }
                  );
                }),
            },
          });
        });
        const copyFrom = detailsPanel.getByRole('button').first();
        await copyFrom.click();
        expect(
          await popup.evaluate(() => (window as any).__reviewCopies)
        ).toEqual([connected.result[0]]);
        await expect(
          popup.getByText(en.home.addressCopied, { exact: true })
        ).toHaveCount(0);
        await popup.evaluate(() =>
          (window as any).__finishReviewCopies[0](false)
        );
        await expect(
          popup.getByText(en.transactions.copyFailed, { exact: true })
        ).toBeVisible();
        await expect(
          popup.getByText(en.home.addressCopied, { exact: true })
        ).toHaveCount(0);
        await copyFrom.click();
        await popup.evaluate(() =>
          (window as any).__finishReviewCopies[1](true)
        );
        await expect(
          popup.getByText(en.home.addressCopied, { exact: true })
        ).toBeVisible();
        await capture(popup);
      }
    );
    await wallet.step(
      'retain ordinary mouse selection and the exact original calldata',
      async (capture) => {
        await dataTab.click();
        const decoded = await assertData();
        await hex.click();
        await assertHex();
        await capture(popup);
        await info.attach('transaction-tab-observations', {
          body: JSON.stringify(
            { focusOrder, decoded, calldata: data },
            null,
            2
          ),
          contentType: 'application/json',
        });
      }
    );
    await expect(
      popup.getByText(en.home.addressCopied, { exact: true })
    ).toBeHidden();
    const hexCopy = hexPanel.getByRole('button', {
      name: en.buttons.copy,
      exact: true,
    });
    const copiedNotice = popup.getByText(en.send.hexDataCopied, {
      exact: true,
    });
    const refusedNotice = popup.getByText(en.transactions.copyFailed, {
      exact: true,
    });
    const readCopies = () =>
      popup.evaluate(() => (window as any).__reviewCopies as string[]);
    const finishCopy = async (index: number, accepted: boolean) => {
      if (accepted) {
        // Every accepted write, including a deliberately retired one, gets a
        // fresh message window: dedup must neither hide a stale regression nor
        // suppress the subsequent healthy current-copy acknowledgement.
        await expect
          .poll(() =>
            popup.evaluate(
              () => Date.now() - (window as any).__lastClipboardAcceptanceAt
            )
          )
          .toBeGreaterThanOrEqual(2000);
      }
      return popup.evaluate(
        async ({ index, accepted }) => {
          (window as any).__finishReviewCopies[index](accepted);
          // Drain the native promise and the separately queued toast delivery.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        },
        { index, accepted }
      );
    };
    const focusHexCopy = async (expectedData: string) => {
      await hex.click();
      await expect(hex).toBeFocused();
      await assertHex(expectedData);
      // This is native focus traversal from the selected tab, not a direct
      // focus/click injected into the control under test.
      await popup.keyboard.press('Tab');
      await expect(hexCopy).toBeFocused();
      await expect(hexCopy).toHaveAttribute('type', 'button');
      await expect(hexCopy).toHaveText(expectedData);
      const bounds = await hexCopy.boundingBox();
      expect(bounds).not.toBeNull();
      const viewport = popup.viewportSize()!;
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await hexCopy.evaluate((element) => {
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
        }),
        'Native Tab exposes the entire copy control above the fixed footer'
      ).toBe(true);
      return bounds;
    };
    const copyObservations: unknown[] = [];
    let reviewedData = data;
    for (const { viewport, amount, rawAmount } of [
      {
        viewport: { width: 400, height: 620 },
        amount: '1.23456789',
        rawAmount: '123456789',
      },
      {
        viewport: { width: 320, height: 360 },
        amount: '2.00000001',
        rawAmount: '200000001',
      },
    ]) {
      await popup.setViewportSize(viewport);
      await wallet.step(
        `keyboard Hex copy waits for native acceptance at ${viewport.width}x${viewport.height}`,
        async (capture) => {
          await focusHexCopy(reviewedData);
          const index = (await readCopies()).length;
          await popup.keyboard.press('Enter');
          await expect.poll(readCopies).toHaveLength(index + 1);
          expect((await readCopies())[index]).toBe(reviewedData);
          await expect(copiedNotice).toHaveCount(0);
          // Address and Hex refusals share the real 2-second message dedup.
          // A replaced/hidden notice does not prove that cooldown has elapsed.
          await expect
            .poll(() =>
              popup.evaluate(
                () => Date.now() - (window as any).__lastClipboardRefusalAt
              )
            )
            .toBeGreaterThanOrEqual(2000);
          await finishCopy(index, false);
          await expect(refusedNotice).toBeVisible();
          await expect(copiedNotice).toHaveCount(0);
          await capture(popup);
          // Observe the ordinary notice lifecycle rather than advancing clocks
          // or hiding feedback that could obscure a stale completion.
          await expect(refusedNotice).toBeHidden();
        }
      );
      await wallet.step(
        `retire pending Hex copy after an ordinary allowance edit at ${viewport.width}x${viewport.height}`,
        async (capture) => {
          const originalData = reviewedData;
          const bounds = await focusHexCopy(originalData);
          const pendingIndex = (await readCopies()).length;
          await popup.keyboard.press('Space');
          await expect.poll(readCopies).toHaveLength(pendingIndex + 1);
          expect((await readCopies())[pendingIndex]).toBe(originalData);
          await expect(copiedNotice).toHaveCount(0);
          await details.click();
          await popup
            .getByRole('button', { name: en.send.editPermission, exact: true })
            .click();
          const dialog = popup.getByRole('dialog');
          await dialog
            .getByRole('radio', {
              name: en.send.customSpendingLimit,
              exact: true,
            })
            .check();
          await dialog
            .getByRole('textbox', {
              name: en.send.enterAMaximumSpendingLimit,
              exact: true,
            })
            .fill(amount);
          await dialog
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(dialog).toBeHidden();
          await expect(
            popup.getByText(`${amount} REVIEW`, { exact: true })
          ).toBeVisible();
          await dataTab.click();
          const decoded = await assertData(rawAmount);
          reviewedData = approveInterface.encodeFunctionData('approve', [
            spender,
            BigInt(rawAmount),
          ]);
          expect(reviewedData).not.toBe(originalData);
          await hex.click();
          await assertHex(reviewedData);
          await finishCopy(pendingIndex, true);
          await expect(copiedNotice).toHaveCount(0);
          await expect(refusedNotice).toHaveCount(0);
          await capture(popup);
          await focusHexCopy(reviewedData);
          const currentIndex = (await readCopies()).length;
          await popup.keyboard.press('Enter');
          await expect.poll(readCopies).toHaveLength(currentIndex + 1);
          expect((await readCopies())[currentIndex]).toBe(reviewedData);
          await expect(copiedNotice).toHaveCount(0);
          await finishCopy(currentIndex, true);
          await expect(copiedNotice).toBeVisible();
          // Start the next dedup window after the notice is actually visible,
          // not before React's queued toast delivery has run.
          await popup.evaluate(() => {
            (window as any).__lastClipboardAcceptanceAt = Date.now();
          });
          await expect(refusedNotice).toHaveCount(0);
          await capture(popup);
          copyObservations.push({
            viewport,
            bounds,
            originalData,
            editedData: reviewedData,
            decoded,
            copies: (await readCopies()).slice(pendingIndex, currentIndex + 1),
            inputMethod: [
              'Tab',
              'Space',
              'ordinary Edit permission form',
              'Tab',
              'Enter',
            ],
            staleSuccessShown: false,
            currentSuccessShown: true,
          });
          await expect(copiedNotice).toBeHidden();
        }
      );
    }
    await info.attach('transaction-hex-copy-observations', {
      body: JSON.stringify(copyObservations, null, 2),
      contentType: 'application/json',
    });
    const canceled = await dismissRejectedApproval({
      click: () =>
        popup
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click(),
      isClosed: () => popup.isClosed(),
      settle: () => settle(dapp, request),
    });
    expect(canceled.error?.code).toBe(4001);
    expect(canceled.result).toBeUndefined();
    expect(writes).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    expect(errors).toEqual([]);
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
