import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { AbiCoder, Interface, formatUnits, id } from 'ethers';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
import { captureForegroundContrast } from '../harness/foregroundContrast';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { checkReviewInputFocusRing } from '../harness/reviewGeometry';
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

import type { INetwork } from '../../source/types/network';

const token = '0x000000000000000000000000000000000000ed6e';
const spender = '0x1111111111111111111111111111111111111111';

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  observation: unknown
) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await info.attach(name, { path: file, contentType: 'image/png' });
  await info.attach(`${name}-observations`, {
    body: JSON.stringify(observation, null, 2),
    contentType: 'application/json',
  });
  console.log(name, JSON.stringify(observation));
}

async function popupStep<T>(
  wallet: PaliWallet,
  popup: Page,
  name: string,
  run: (captureApproval: (page: Page) => Promise<void>) => Promise<T>
) {
  return wallet.step(name, async (captureApproval) => {
    await captureApproval(popup);
    try {
      return await run(captureApproval);
    } finally {
      // Retain the last live approval state on both success and assertion
      // failure. Closing steps capture before dismissal instead.
      if (!popup.isClosed())
        await captureApproval(popup).catch(() => undefined);
    }
  });
}

async function captureOpenApproval(
  wallet: PaliWallet,
  captureApproval: (page: Page) => Promise<void>
) {
  const popup = wallet.context
    .pages()
    .find((page) => page.url().includes('/external'));
  if (popup && !popup.isClosed())
    await captureApproval(popup).catch(() => undefined);
}

async function withWallet(
  name: string,
  run: (wallet: PaliWallet, origin: string) => Promise<void>,
  decimals = 8,
  networkGasPrice?: string
) {
  const previous = { ...E2E_CONFIG };
  const stepPrefix = decimals === 8 ? '' : `${name}: `;
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'TokenApprovalSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
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
    const abi = AbiCoder.defaultAbiCoder();
    const metadata = new Map([
      [id('name()').slice(0, 10), abi.encode(['string'], ['Review Token'])],
      [id('symbol()').slice(0, 10), abi.encode(['string'], ['REVIEW'])],
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [decimals])],
      [id('balanceOf(address)').slice(0, 10), abi.encode(['uint256'], [0])],
      [id('totalSupply()').slice(0, 10), abi.encode(['uint256'], [0])],
      [
        id('supportsInterface(bytes4)').slice(0, 10),
        abi.encode(['bool'], [false]),
      ],
    ]);
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call.method === 'eth_estimateGas') result = '0x5208';
        if (call.method === 'eth_gasPrice' && networkGasPrice)
          result = networkGasPrice;
        if (call.method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0.5],
            reward: [['0x3b9aca00']],
          };
        if (
          call.method === 'eth_getCode' &&
          call.params[0].toLowerCase() === token
        )
          result = '0x60006000fd';
        if (
          call.method === 'eth_call' &&
          call.params[0].to?.toLowerCase() === token
        )
          result = metadata.get(call.params[0].data.slice(0, 10));
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.every((value) => value !== undefined))
        return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
      });
    });
    await wallet.step(
      `${stepPrefix}import disposable synthetic wallet`,
      async () => {
        await wallet!.importSeedAndCreatePassword();
      }
    );
    await wallet.step(
      `${stepPrefix}select fixture EVM network and open home`,
      async () => {
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
      }
    );
    await run(wallet, server.url);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
}

async function connect(wallet: PaliWallet, origin: string, name = '') {
  return wallet.step(
    `${name ? name + ': ' : ''}connect the local fixture dapp`,
    async (captureApproval) => {
      await wallet.page.goto('about:blank');
      const dapp = await wallet.context.newPage();
      await dapp.goto(origin);
      await dapp.waitForFunction(() => Boolean((window as any).pali));
      try {
        const connected = await approve(
          wallet.context,
          dapp,
          await startRequest(dapp, 'eth_requestAccounts'),
          captureApproval
        );
        return { dapp, address: connected.result[0] };
      } finally {
        await captureOpenApproval(wallet, captureApproval);
      }
    }
  );
}

test('token approval review restores discarded drafts and shows the edited calldata', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('token-approval-review', async (wallet, origin) => {
    const { dapp, address } = await connect(wallet, origin);
    const data = new Interface([
      'function approve(address,uint256)',
    ]).encodeFunctionData('approve', [spender, BigInt('10000000000')]);
    const { request, popup } = await wallet.step(
      'request the original token approval',
      async (captureApproval) => {
        try {
          const requestId = await startRequest(dapp, 'eth_sendTransaction', [
            { from: address, to: token, value: '0x0', data },
          ]);
          const approvalPopup = await popupFor(wallet.context, dapp, requestId);
          await captureApproval(approvalPopup);
          return { request: requestId, popup: approvalPopup };
        } finally {
          await captureOpenApproval(wallet, captureApproval);
        }
      }
    );
    const edit = popup.getByRole('button', {
      name: en.send.editPermission,
      exact: true,
    });
    const dialog = popup.getByRole('dialog');
    const input = dialog.getByRole('textbox', {
      name: en.send.enterAMaximumSpendingLimit,
      exact: true,
    });
    await popupStep(
      wallet,
      popup,
      'save a custom token approval limit',
      async (captureApproval) => {
        await expect(edit).toBeVisible();
        await edit.click();
        await dialog
          .getByRole('radio', {
            name: en.send.customSpendingLimit,
            exact: true,
          })
          .check();
        // Human prose keeps whole ordinary words; very long host tokens may wrap.
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 360 },
        ]) {
          await popup.setViewportSize(viewport);
          const description = dialog.getByText(
            `${en.send.allow} ${origin} ${en.send.toWithdraw}:`,
            { exact: true }
          );
          const observations = await description.evaluate((element) => {
            const text = element.textContent || '';
            const node = element.firstChild!;
            const words = ['withdraw', 'spend', 'following', 'amount'];
            return words.map((word) => {
              const start = text.indexOf(word);
              if (start < 0) throw new Error(`Missing ${word}`);
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, start + word.length);
              const rects = Array.from(range.getClientRects());
              return {
                word,
                lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
              };
            });
          });
          await info.attach(`allowance-prose-${viewport.width}`, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
          await info.attach(`allowance-prose-geometry-${viewport.width}`, {
            body: JSON.stringify({ origin, observations }),
            contentType: 'application/json',
          });
          expect(observations.every((word) => word.lines === 1)).toBe(true);
          for (let attempt = 0; attempt < 30; attempt++) {
            if (
              await input.evaluate(
                (element) => element === document.activeElement
              )
            )
              break;
            await popup.keyboard.press('Tab');
          }
          await expect(input).toBeFocused();
          for (let attempt = 0; attempt < 12; attempt++) {
            const point = await input.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              let visibleTop = 0;
              let visibleBottom = innerHeight;
              let owner: HTMLElement | null = null;
              for (
                let ancestor = element.parentElement;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                const style = getComputedStyle(ancestor);
                if (!/auto|scroll|hidden|clip/.test(style.overflowY)) continue;
                const area = ancestor.getBoundingClientRect();
                visibleTop = Math.max(visibleTop, area.top);
                visibleBottom = Math.min(visibleBottom, area.bottom);
                if (
                  !owner &&
                  /auto|scroll/.test(style.overflowY) &&
                  ancestor.scrollHeight > ancestor.clientHeight + 2
                )
                  owner = ancestor;
              }
              if (rect.top >= visibleTop && rect.bottom <= visibleBottom)
                return null;
              const area = (
                owner || document.documentElement
              ).getBoundingClientRect();
              return {
                x: Math.max(8, area.left + area.width / 2),
                y: Math.max(visibleTop + 8, (visibleTop + visibleBottom) / 2),
                delta: rect.top < visibleTop ? -80 : 80,
              };
            });
            if (!point) break;
            await popup.mouse.move(point.x, point.y);
            await popup.mouse.wheel(0, point.delta);
            await popup.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
            );
          }
          await expect(input).toBeInViewport({ ratio: 1 });
          await checkReviewInputFocusRing(
            popup,
            input,
            info,
            `allowance-focused-input-${viewport.width}`
          );
          await info.attach(`allowance-custom-input-${viewport.width}`, {
            body: await popup.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
          });
        }
        await popup.setViewportSize({ width: 400, height: 620 });
        await input.fill('5');
        await dialog
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(dialog).toBeHidden();
        await expect(
          popup.getByText('5 REVIEW', { exact: true })
        ).toBeVisible();
        await captureApproval(popup);
      }
    );
    await popupStep(
      wallet,
      popup,
      'verify Data and Hex match the saved token allowance',
      async (captureApproval) => {
        await popup
          .locator('#tabExample')
          .getByText(en.send.data, { exact: true })
          .click();
        const displayedData = await popup
          .locator('#tabContentExample pre:visible')
          .innerText();
        await popup
          .locator('#tabExample')
          .getByText(en.send.hex, { exact: true })
          .click();
        const displayedHex = await popup
          .locator('#tabContentExample [role=tabpanel]:visible')
          .innerText();
        const editedData = new Interface([
          'function approve(address,uint256)',
        ]).encodeFunctionData('approve', [spender, BigInt('500000000')]);
        await capture(popup, info, 'allowance-edited-hex-review', {
          requestedData: data,
          expectedEditedData: editedData,
          displayedData,
          displayedHex,
        });
        await captureApproval(popup);
        expect(JSON.parse(displayedData).inputs).toEqual([
          spender,
          '500000000',
        ]);
        expect(displayedHex.trim()).toBe(editedData);
      }
    );
    for (const dismissal of ['cancel', 'escape', 'close']) {
      await popupStep(
        wallet,
        popup,
        `discard an unsaved token allowance with ${dismissal}`,
        async (captureApproval) => {
          await popup
            .locator('#tabExample')
            .getByText(en.send.details, { exact: true })
            .click();
          await edit.click();
          await expect(input).toHaveValue('5');
          await input.fill('20');
          await captureApproval(popup);
          if (dismissal === 'escape') await popup.keyboard.press('Escape');
          else
            await dialog
              .getByRole('button', {
                name: dismissal === 'cancel' ? en.buttons.cancel : 'Close',
                exact: true,
              })
              .click();
          await expect(dialog).toBeHidden();
          await expect(
            popup.getByText('5 REVIEW', { exact: true })
          ).toBeVisible();
          await edit.click();
          await captureApproval(popup);
          await expect(input).toHaveValue('5');
          await capture(popup, info, `allowance-after-${dismissal}-reopen`, {
            savedAmount: '5',
            reopened: await input.inputValue(),
            runtime: extensionEvidence(),
          });
          await dialog
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(dialog).toBeHidden();
        }
      );
    }
    await popupStep(
      wallet,
      popup,
      'reject an invalid negative token allowance',
      async (captureApproval) => {
        await edit.click();
        await input.fill('-1');
        await dialog
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(
          dialog.getByText(en.send.invalidAmount, { exact: true })
        ).toBeVisible();
        await captureApproval(popup);
        await dialog
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();
        await expect(dialog).toBeHidden();
      }
    );
    await popupStep(
      wallet,
      popup,
      'cancel the token approval and verify provider rejection',
      async () => {
        const rejected = await dismissRejectedApproval({
          click: () =>
            popup
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click(),
          isClosed: () => popup.isClosed(),
          settle: () => settle(dapp, request),
        });
        expect(rejected.error?.code).toBe(4001);
        expect(rejected.result).toBeUndefined();
      }
    );
  });
});

for (const decimals of [0, 18]) {
  test(`custom uint256 maximum retains its approval warning with ${decimals} decimals`, async ({}, info) => {
    await withWallet(
      `token-approval-unlimited-${decimals}`,
      async (wallet, origin) => {
        const { dapp, address } = await connect(
          wallet,
          origin,
          `token-approval-unlimited-${decimals}`
        );
        const maximum = (BigInt(1) << BigInt(256)) - BigInt(1);
        const maximumHuman = formatUnits(maximum, decimals);
        const approveInterface = new Interface([
          'function approve(address,uint256)',
        ]);
        const requestedData = approveInterface.encodeFunctionData('approve', [
          spender,
          maximum,
        ]);
        const { request, popup } = await wallet.step(
          `request maximum approval with ${decimals} decimals`,
          async (captureApproval) => {
            const requestId = await startRequest(dapp, 'eth_sendTransaction', [
              { from: address, to: token, value: '0x0', data: requestedData },
            ]);
            const approvalPopup = await popupFor(
              wallet.context,
              dapp,
              requestId
            );
            await captureApproval(approvalPopup);
            return { request: requestId, popup: approvalPopup };
          }
        );
        const edit = popup.getByRole('button', {
          name: en.send.editPermission,
          exact: true,
        });
        const dialog = popup.getByRole('dialog');
        const input = dialog.getByRole('textbox', {
          name: en.send.enterAMaximumSpendingLimit,
          exact: true,
        });
        const warning = popup.getByText(`⚠️ ${en.transactions.unlimited}`, {
          exact: true,
        });
        const verifyEncoding = async (rawAmount: bigint, label: string) => {
          const expectedData = approveInterface.encodeFunctionData('approve', [
            spender,
            rawAmount,
          ]);
          await popup
            .locator('#tabExample')
            .getByText(en.send.data, { exact: true })
            .click();
          const displayedData = await popup
            .locator('#tabContentExample pre:visible')
            .innerText();
          expect(JSON.parse(displayedData).inputs).toEqual([
            spender,
            rawAmount.toString(),
          ]);
          await popup
            .locator('#tabExample')
            .getByText(en.send.hex, { exact: true })
            .click();
          const displayedHex = await popup
            .locator('#tabContentExample [role=tabpanel]:visible')
            .innerText();
          expect(displayedHex.trim()).toBe(expectedData);
          await capture(popup, info, `approval-${decimals}-${label}`, {
            decimals,
            rawAmount: rawAmount.toString(),
            expectedData,
            displayedData,
            displayedHex,
            runtime: extensionEvidence(),
            controllerResultsReplaced: false,
            signingApproved: false,
          });
          await popup
            .locator('#tabExample')
            .getByText(en.send.details, { exact: true })
            .click();
        };

        await expect(edit).toBeVisible();
        await expect(warning).toBeVisible();
        for (const amount of [maximumHuman, '0', '1']) {
          const isMaximum = amount === maximumHuman;
          await popupStep(
            wallet,
            popup,
            `save ${
              isMaximum ? 'maximum' : amount
            } allowance with ${decimals} decimals`,
            async () => {
              await edit.click();
              await dialog
                .getByRole('radio', {
                  name: en.send.customSpendingLimit,
                  exact: true,
                })
                .check();
              await input.fill(amount);
              await dialog
                .getByRole('button', { name: en.buttons.save, exact: true })
                .click();
              await expect(dialog).toBeHidden();
              if (isMaximum) {
                await expect(warning).toBeVisible();
                await expect(warning).toHaveClass(/text-warning-error/);
              } else {
                await expect(warning).toHaveCount(0);
                await expect(
                  popup.getByText(`${amount} REVIEW`, { exact: true })
                ).toBeVisible();
              }
              await verifyEncoding(
                isMaximum
                  ? maximum
                  : BigInt(amount) * BigInt('1' + '0'.repeat(decimals)),
                isMaximum ? 'custom-maximum' : `finite-${amount}`
              );
            }
          );
        }
        await popupStep(
          wallet,
          popup,
          `discard a maximum draft and restore proposed allowance with ${decimals} decimals`,
          async () => {
            await edit.click();
            await expect(input).toHaveValue('1');
            await input.fill(maximumHuman);
            if (decimals === 18) await popup.keyboard.press('Escape');
            else
              await dialog
                .getByRole('button', {
                  name: en.buttons.cancel,
                  exact: true,
                })
                .click();
            await expect(dialog).toBeHidden();
            await expect(warning).toHaveCount(0);
            await expect(
              popup.getByText('1 REVIEW', { exact: true })
            ).toBeVisible();
            await verifyEncoding(
              BigInt('1' + '0'.repeat(decimals)),
              'discarded-maximum'
            );
            await edit.click();
            await expect(input).toHaveValue('1');
            await dialog
              .getByRole('radio', {
                name: en.send.proposedApprovalLimit,
                exact: true,
              })
              .check();
            await dialog
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(dialog).toBeHidden();
            await expect(warning).toBeVisible();
            await verifyEncoding(maximum, 'restored-proposed');
          }
        );
        await popupStep(
          wallet,
          popup,
          `cancel maximum approval without signing with ${decimals} decimals`,
          async () => {
            const rejected = await dismissRejectedApproval({
              click: () =>
                popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp, request),
            });
            expect(rejected.error?.code).toBe(4001);
            expect(rejected.result).toBeUndefined();
          }
        );
      },
      decimals
    );
  });
}

test('approval metadata from a retired wallet context cannot supply allowance units', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet(
    'token-approval-metadata-context',
    async (wallet, origin) => {
      const pageErrors: string[] = [];
      wallet.context.on('page', (page) => {
        page.on('pageerror', (error) => pageErrors.push(error.message));
      });
      const readContext = () =>
        wallet.page.evaluate(async () => {
          const { vault } = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          const ref = vault.activeAccount;
          return {
            account: {
              ...ref,
              address: vault.accounts[ref.type][ref.id].address,
            },
            network: vault.activeNetwork as INetwork,
          };
        });
      const evm = await readContext();
      await wallet.step(
        'record healthy fixture network selections',
        async () => {
          await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
        }
      );
      const utxo = await readContext();
      await wallet.step('restore the original EVM network', async () => {
        await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        expect(await readContext()).toEqual(evm);
      });
      const { dapp, address } = await connect(wallet, origin);
      // Observe only metadata replies. Forward the original message, callback,
      // receiver and response unchanged; no controller state/result is replaced.
      await wallet.context.addInitScript(() => {
        if (
          location.protocol !== 'chrome-extension:' ||
          !chrome.runtime?.sendMessage
        )
          return;
        const send = chrome.runtime.sendMessage;
        const replies: any[] = [];
        (window as any).__approvalMetadataReplies = replies;
        chrome.runtime.sendMessage = function (...args: any[]) {
          const message = args[0];
          const callback = args[args.length - 1];
          if (
            message?.type !== 'CONTROLLER_ACTION' ||
            message.data?.methods?.join('.') !== 'wallet.getERC20TokenInfo' ||
            typeof callback !== 'function'
          )
            return Reflect.apply(send, this, args);
          const row: any = {
            ordinal: replies.length,
            startedAt: Date.now(),
            completed: false,
          };
          replies.push(row);
          args[args.length - 1] = function (...responseArgs: any[]) {
            try {
              return Reflect.apply(callback, this, responseArgs);
            } finally {
              const response = responseArgs[0];
              Object.assign(row, {
                completed: true,
                completedAt: Date.now(),
                error: response?.error ?? null,
                decimals: response?.decimals ?? null,
                symbol: response?.symbol ?? null,
              });
            }
          };
          return Reflect.apply(send, this, args);
        } as typeof chrome.runtime.sendMessage;
      });
      const abi = AbiCoder.defaultAbiCoder();
      const selectors = new Set(
        ['name()', 'symbol()', 'decimals()', 'balanceOf(address)'].map(
          (method) => id(method).slice(0, 10)
        )
      );
      const held: {
        ids: unknown[];
        release: () => void;
        round: 'old' | 'fresh';
        selectors: string[];
      }[] = [];
      let round: 'old' | 'fresh' = 'old';
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const rpc = route.request().postDataJSON();
        const calls = Array.isArray(rpc) ? rpc : [rpc];
        const tokenCalls = calls.filter(
          (call: any) =>
            call.method === 'eth_call' &&
            call.params[0].to?.toLowerCase() === token &&
            selectors.has(call.params[0].data.slice(0, 10))
        );
        // Earlier transaction classification reads are not the held approval
        // read. Arm only once the actual external document has navigated.
        if (
          tokenCalls.length !== calls.length ||
          !wallet.context
            .pages()
            .some((page) => page.url().includes('/external'))
        )
          return route.fallback();
        const requestRound = round;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        held.push({
          round: requestRound,
          ids: calls.map((call: any) => call.id),
          selectors: calls.map((call: any) => call.params[0].data.slice(0, 10)),
          release,
        });
        // A new approval can perform another metadata read after its quote.
        // All fresh reads are healthy controls; only retired reads are held.
        if (requestRound === 'fresh') release();
        await gate;
        const metadata = new Map([
          [id('name()').slice(0, 10), abi.encode(['string'], [requestRound])],
          [
            id('symbol()').slice(0, 10),
            abi.encode(['string'], [requestRound === 'old' ? 'OLD' : 'NEW']),
          ],
          [
            id('decimals()').slice(0, 10),
            abi.encode(['uint8'], [requestRound === 'old' ? 8 : 6]),
          ],
          [id('balanceOf(address)').slice(0, 10), abi.encode(['uint256'], [0])],
        ]);
        const replies = calls.map((call: any) => ({
          jsonrpc: '2.0',
          id: call.id,
          result: metadata.get(call.params[0].data.slice(0, 10)),
        }));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
        });
      });
      const seenSelectors = (which: 'old' | 'fresh') =>
        new Set(
          held
            .filter((item) => item.round === which)
            .flatMap((item) => item.selectors)
        ).size;
      try {
        const data = new Interface([
          'function approve(address,uint256)',
        ]).encodeFunctionData('approve', [spender, BigInt('10000000000')]);
        const request = await startRequest(dapp, 'eth_sendTransaction', [
          { from: address, to: token, value: '0x0', data },
        ]);
        let popup = await popupFor(wallet.context, dapp, request);
        let edit = popup.getByRole('button', {
          name: en.send.editPermission,
          exact: true,
        });
        let originalRead: { ordinal: number; startedAt: number };
        await popupStep(
          wallet,
          popup,
          'hold the first real token metadata read',
          async () => {
            await expect.poll(() => seenSelectors('old')).toBe(4);
            await expect(edit).toHaveCount(0);
            originalRead = await popup.evaluate(
              () => (window as any).__approvalMetadataReplies[0]
            );
            expect(originalRead.ordinal).toBe(0);
          }
        );
        await popupStep(
          wallet,
          popup,
          'retire and restore the approval wallet context',
          async () => {
            await wallet.page.goto(wallet.appUrl('#/home'));
            await wallet.waitAppReady();
            await expect(
              wallet.page.getByRole('heading', {
                name: 'Pali is Currently Active',
                exact: true,
              })
            ).toBeVisible();
            const switchContext = async (network: INetwork) => {
              const result = await wallet.page.evaluate(async (target) => {
                const response = await chrome.runtime.sendMessage({
                  type: 'CONTROLLER_ACTION',
                  data: {
                    methods: ['wallet', 'setActiveNetwork'],
                    params: [target],
                  },
                });
                if (!response || response.error || response.success === false)
                  throw new Error(
                    `Network switch failed: ${JSON.stringify(response)}`
                  );
                return response;
              }, network);
              expect(result.network).toEqual(network);
              await expect
                .poll(async () => (await readContext()).network)
                .toEqual(network);
            };
            // Main UI is intentionally blocked during approvals. Use exactly its
            // trusted real controller operation, not injected state/results, to
            // exercise delayed read retirement; this is not simultaneous-menu UX.
            await switchContext(utxo.network);
            await expect
              .poll(async () => (await readContext()).account)
              .toEqual(utxo.account);
            await expect(edit).toHaveCount(0);
            await switchContext(evm.network);
            await expect
              .poll(async () => (await readContext()).account)
              .toEqual(evm.account);
            expect(popup.isClosed()).toBe(false);
          }
        );
        await popupStep(
          wallet,
          popup,
          'reject the retired approval metadata result',
          async () => {
            held
              .filter((item) => item.round === 'old')
              .forEach((item) => item.release());
            await expect
              .poll(() =>
                popup.evaluate(
                  (ordinal) =>
                    (window as any).__approvalMetadataReplies[ordinal]
                      ?.completed,
                  originalRead.ordinal
                )
              )
              .toBe(true);
            const reply = await popup.evaluate(
              (ordinal) => (window as any).__approvalMetadataReplies[ordinal],
              originalRead.ordinal
            );
            expect(reply.completedAt - reply.startedAt).toBeLessThan(10000);
            expect(reply.error).toEqual({
              message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
              transactionNotBroadcast: true,
            });
            await expect(edit).toHaveCount(0);
            await expect(
              popup.getByText('100.0 OLD', { exact: true })
            ).toHaveCount(0);
            await capture(popup, info, 'retired-token-metadata', {
              runtime: extensionEvidence(),
              currentContext: await readContext(),
              originalMetadataReply: reply,
              metadataRequests: held.map((item) => ({
                round: item.round,
                ids: item.ids,
                selectors: item.selectors,
              })),
              controllerStateReplaced: false,
              controllerResultsReplaced: false,
              signingApproved: false,
            });
          }
        );
        await popupStep(
          wallet,
          popup,
          'cancel the retired approval before retrying',
          async () => {
            const rejected = await dismissRejectedApproval({
              click: () =>
                popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp, request),
            });
            expect(rejected.error?.code).toBe(4001);
            expect(rejected.result).toBeUndefined();
          }
        );
        // The old approval carries its original background session generation.
        // Returning to A does not revive it. A new request is the healthy retry.
        round = 'fresh';
        const freshRequest = await startRequest(dapp, 'eth_sendTransaction', [
          { from: address, to: token, value: '0x0', data },
        ]);
        popup = await popupFor(wallet.context, dapp, freshRequest);
        edit = popup.getByRole('button', {
          name: en.send.editPermission,
          exact: true,
        });
        await popupStep(
          wallet,
          popup,
          'use only fresh metadata for exact edited calldata',
          async () => {
            await expect.poll(() => seenSelectors('fresh')).toBe(4);
            held
              .filter((item) => item.round === 'fresh')
              .forEach((item) => item.release());
            await expect(
              popup.getByText('10000.0 NEW', { exact: true })
            ).toBeVisible();
            await edit.click();
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
              .fill('5');
            await dialog
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(dialog).toBeHidden();
            await expect(
              popup.getByText('5 NEW', { exact: true })
            ).toBeVisible();
            await popup
              .locator('#tabExample')
              .getByText(en.send.hex, { exact: true })
              .click();
            const expected = new Interface([
              'function approve(address,uint256)',
            ]).encodeFunctionData('approve', [spender, BigInt('5000000')]);
            await expect(
              popup.locator('#tabContentExample [role=tabpanel]:visible')
            ).toHaveText(expected);
            await capture(popup, info, 'fresh-token-metadata-calldata', {
              expected,
              runtime: extensionEvidence(),
            });
          }
        );
        await popupStep(
          wallet,
          popup,
          'cancel without signing or broadcasting',
          async () => {
            const rejected = await dismissRejectedApproval({
              click: () =>
                popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp, freshRequest),
            });
            expect(rejected.error?.code).toBe(4001);
            expect(rejected.result).toBeUndefined();
          }
        );
        expect(pageErrors).toEqual([]);
      } finally {
        held.forEach((item) => item.release());
      }
    }
  );
});

test('unresolved ENS approval retains visible keyboard cancellation in a small window', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('transaction-ens-cancel', async (wallet, origin) => {
    const { dapp, address } = await connect(wallet, origin);
    const { request, popup } = await wallet.step(
      'request a transaction with an unresolved ENS recipient',
      async (captureApproval) => {
        try {
          const requestId = await startRequest(dapp, 'eth_sendTransaction', [
            {
              from: address,
              to: 'unregistered-approval-review.eth',
              value: '0x0',
              data: '0x',
            },
          ]);
          const approvalPopup = await popupFor(wallet.context, dapp, requestId);
          await captureApproval(approvalPopup);
          return { request: requestId, popup: approvalPopup };
        } finally {
          await captureOpenApproval(wallet, captureApproval);
        }
      }
    );
    const cancellation = popup.getByRole('button', {
      name: en.buttons.cancel,
      exact: true,
    });
    await popupStep(
      wallet,
      popup,
      'verify the ENS error retains visible keyboard cancellation',
      async () => {
        await popup.setViewportSize({ width: 320, height: 360 });
        await expect(
          popup.getByText(en.send.unableToResolveEns, { exact: true })
        ).toBeVisible({ timeout: 20000 });
        await expect(cancellation).toBeVisible();
        const bounds = await cancellation.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
        for (
          let i = 0;
          i < 12 &&
          !(await cancellation.evaluate(
            (element) => element === document.activeElement
          ));
          i += 1
        ) {
          await popup.keyboard.press('Tab');
        }
        await expect(cancellation).toBeFocused();
        await capture(popup, info, 'unresolved-ens-error', {
          bounds,
          text: await popup.locator('body').innerText(),
          runtime: extensionEvidence(),
        });
      }
    );
    await popupStep(
      wallet,
      popup,
      'cancel the ENS failure with Enter and verify provider rejection',
      async () => {
        const rejected = await dismissRejectedApproval({
          click: () => popup.keyboard.press('Enter'),
          isClosed: () => popup.isClosed(),
          settle: () => settle(dapp, request),
        });
        expect(rejected.error?.code).toBe(4001);
        expect(rejected.result).toBeUndefined();
      }
    );
  });
});

test('transaction review freezes fee and nonce edits during a delayed balance refresh', async ({}, info) => {
  test.setTimeout(120000);
  await withWallet('transaction-review-edit-lock', async (wallet, origin) => {
    const { dapp, address } = await connect(wallet, origin);
    const { request, popup } = await wallet.step(
      'open a synthetic transaction review',
      async (captureApproval) => {
        const pendingRequest = await startRequest(dapp, 'eth_sendTransaction', [
          { from: address, to: spender, value: '0x0', data: '0x' },
        ]);
        const approvalPopup = await popupFor(
          wallet.context,
          dapp,
          pendingRequest
        );
        await captureApproval(approvalPopup);
        return { request: pendingRequest, popup: approvalPopup };
      }
    );
    const edit = popup.getByRole('button', {
      name: en.send.editFee,
      exact: true,
    });
    const nonce = popup.locator('input[type="number"]');
    const confirm = popup.getByRole('button', {
      name: en.buttons.confirm,
      exact: true,
    });
    await popupStep(
      wallet,
      popup,
      'set the reviewed nonce before confirming',
      async () => {
        await expect(confirm).toBeEnabled();
        await expect(nonce).toBeEnabled();
        await nonce.fill('3');
        await expect(nonce).toHaveValue('3');
      }
    );

    let releaseBalance!: () => void;
    const balanceGate = new Promise<void>((resolve) => {
      releaseBalance = resolve;
    });
    let markBalanceStarted!: () => void;
    const balanceStarted = new Promise<void>((resolve) => {
      markBalanceStarted = resolve;
    });
    // Delay only a read. The fixture remains unfunded and the launch-time
    // deny proxy continues to reject every unhandled external request.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (calls.some((call: any) => call.method === 'eth_getBalance')) {
        markBalanceStarted();
        await balanceGate;
      }
      await route.fallback();
    });
    try {
      await popupStep(
        wallet,
        popup,
        'confirm and inspect the locked review controls',
        async () => {
          await confirm.click();
          await balanceStarted;
          await expect(nonce).toBeDisabled();
          await expect(edit).toBeDisabled();
          await expect(nonce).toHaveValue('3');
          await popup
            .locator('#tabExample')
            .getByText(en.send.hex, { exact: true })
            .click();
          await expect(
            popup.locator('#tabContentExample [role=tabpanel]:visible')
          ).toContainText('0x');
          await popup
            .locator('#tabExample')
            .getByText(en.send.details, { exact: true })
            .click();
          await capture(popup, info, 'pending-review-edit-lock', {
            feeDisabled: await edit.isDisabled(),
            nonceDisabled: await nonce.isDisabled(),
            reviewedNonce: await nonce.inputValue(),
            runtime: extensionEvidence(),
          });
        }
      );
      await popupStep(
        wallet,
        popup,
        'close the unfunded fixture approval without broadcasting',
        async () => {
          await popup.close();
          releaseBalance();
          const rejected = await settle(dapp, request);
          expect(rejected.error?.code).toBe(4001);
          expect(rejected.result).toBeUndefined();
        }
      );
    } finally {
      releaseBalance();
    }
  });
});

// Append to tokenApprovalReview.spec.ts. This reuses its real wallet/dapp setup.
for (const width of [400, 320]) {
  test(`token approval review keeps finite amounts readable at ${width}px`, async ({}, info) => {
    test.setTimeout(120_000);
    const height = width === 320 ? 360 : 620;
    const mode = process.env.PALI_APPROVAL_AMOUNT_MODE || 'after';
    expect(['before', 'after']).toContain(mode);
    if (process.env.CI) expect(mode).toBe('after');
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    if (mode === 'before')
      expect(process.env.PALI_TEST_DAPP_REVISION).toBe(
        '38721aec5266a3330749751c9694f8b139af60f1'
      );
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    await withWallet(
      `token-approval-amount-${width}-${mode}`,
      async (wallet, origin) => {
        const { dapp, address } = await connect(wallet, origin);
        const approvalInterface = new Interface([
          'function approve(address,uint256)',
        ]);
        const maximum = (BigInt(1) << BigInt(256)) - BigInt(1);
        const cases = [
          { name: 'ordinary', amount: BigInt('150000000') },
          { name: 'zero', amount: BigInt(0) },
          { name: 'large-finite', amount: maximum - BigInt(1) },
          { name: 'unlimited', amount: maximum },
        ];
        for (const fixture of cases) {
          const data = approvalInterface.encodeFunctionData('approve', [
            spender,
            fixture.amount,
          ]);
          const transaction = { from: address, to: token, value: '0x0', data };
          const { request, popup } = await wallet.step(
            `request ${fixture.name} approval at ${width}px`,
            async (captureApproval) => {
              const requestId = await startRequest(
                dapp,
                'eth_sendTransaction',
                [transaction]
              );
              let approvalPopup = await popupFor(
                wallet.context,
                dapp,
                requestId
              );
              // Rejected approvals can legitimately reach the spam threshold.
              // Continue through that real warning; it closes and is replaced
              // by a separate transaction review for this same pending request.
              if (
                new URL(approvalPopup.url()).pathname ===
                '/external/spam-warning'
              ) {
                const warning = JSON.parse(
                  new URL(approvalPopup.url()).searchParams.get('data') || '{}'
                );
                expect(warning).toMatchObject({
                  host: new URL(origin).origin,
                  eventName: 'spamWarningResponse',
                });
                await expect(
                  approvalPopup.getByRole('heading', {
                    name: en.spamWarning.title,
                    exact: true,
                  })
                ).toBeVisible();
                await captureApproval(approvalPopup);
                const warningPopup = approvalPopup;
                await clickClosingPopup({
                  click: () =>
                    warningPopup
                      .getByRole('button', {
                        name: en.buttons.continue,
                        exact: true,
                      })
                      .click(),
                  isClosed: () => warningPopup.isClosed(),
                });
                await expect.poll(() => warningPopup.isClosed()).toBe(true);
                approvalPopup = await popupFor(wallet.context, dapp, requestId);
              }
              const approvalUrl = new URL(approvalPopup.url());
              expect(approvalUrl.pathname).toBe('/external/tx/send/ethTx');
              const approvalData = JSON.parse(
                approvalUrl.searchParams.get('data') || '{}'
              );
              expect(approvalData).toMatchObject({
                host: new URL(origin).origin,
                eventName: 'txSend',
                external: true,
                tx: transaction,
              });
              await approvalPopup.setViewportSize({ width, height });
              await captureApproval(approvalPopup);
              return { request: requestId, popup: approvalPopup };
            }
          );
          await popupStep(
            wallet,
            popup,
            `inspect ${fixture.name} amount at ${width}px`,
            async () => {
              // The edit control appears only after real token metadata has loaded.
              await expect(
                popup.getByRole('button', {
                  name: en.send.editPermission,
                  exact: true,
                })
              ).toBeVisible();
              const label = popup.getByText(en.transactions.approvalAmount, {
                exact: true,
              });
              const row = label.locator('..');
              const value = row.locator(':scope > span').nth(1);
              const expected =
                fixture.amount === maximum
                  ? `⚠️ ${en.transactions.unlimited}`
                  : `${formatUnits(fixture.amount, 8)} REVIEW`;
              await expect(value).toHaveText(expected);
              const readPosition = () =>
                row.evaluate((element, cancelLabel) => {
                  const cancel = Array.from(
                    document.querySelectorAll('button')
                  ).find(
                    (button) => button.textContent?.trim() === cancelLabel
                  );
                  let footer = cancel?.parentElement || null;
                  while (
                    footer &&
                    getComputedStyle(footer).position !== 'fixed'
                  )
                    footer = footer.parentElement;
                  if (!footer) throw new Error('Missing fixed approval footer');
                  let owner = element.parentElement;
                  while (
                    owner &&
                    !(
                      /auto|scroll/.test(getComputedStyle(owner).overflowY) &&
                      owner.scrollHeight > owner.clientHeight + 1
                    )
                  )
                    owner = owner.parentElement;
                  const box = element.getBoundingClientRect();
                  const clip = owner?.getBoundingClientRect();
                  const top = Math.max(0, clip?.top || 0);
                  const bottom = Math.min(
                    innerHeight,
                    clip?.bottom ?? innerHeight,
                    footer.getBoundingClientRect().top
                  );
                  return {
                    rowTop: box.top,
                    rowBottom: box.bottom,
                    top,
                    bottom,
                    footerTop: footer.getBoundingClientRect().top,
                    text: element.children[1].textContent,
                    scroll: owner
                      ? {
                          x: Math.min(innerWidth - 4, clip!.right - 4),
                          y: (top + bottom) / 2,
                          top: owner.scrollTop,
                        }
                      : null,
                  };
                }, en.buttons.cancel);
              const settlePosition = async () => {
                let previous = '';
                let repeats = 0;
                await expect
                  .poll(
                    async () => {
                      const current = JSON.stringify(await readPosition());
                      repeats = current === previous ? repeats + 1 : 0;
                      previous = current;
                      return repeats >= 2;
                    },
                    { intervals: [50], timeout: 4000 }
                  )
                  .toBe(true);
              };
              // Use ordinary wheel input, accounting for the fixed footer that
              // scrollIntoView cannot see. Never assign scrollTop or mutate UI.
              await settlePosition();
              for (let attempt = 0; attempt < 8; attempt++) {
                const position = await readPosition();
                if (!position.scroll) break;
                const delta = Math.round(
                  (position.rowTop + position.rowBottom) / 2 -
                    (position.top + position.bottom) / 2
                );
                if (Math.abs(delta) <= 2) break;
                await popup.mouse.move(position.scroll.x, position.scroll.y);
                await popup.mouse.wheel(0, delta);
                await settlePosition();
                if ((await readPosition()).scroll?.top === position.scroll.top)
                  break;
              }
              await settlePosition();
              const visibleRegion = await readPosition();
              expect(visibleRegion.rowTop).toBeGreaterThanOrEqual(
                visibleRegion.top
              );
              expect(visibleRegion.rowBottom).toBeLessThanOrEqual(
                visibleRegion.bottom
              );
              expect(visibleRegion.rowBottom).toBeLessThanOrEqual(
                visibleRegion.footerTop
              );
              expect(visibleRegion.text).toBe(expected);
              await expect(value).toHaveText(expected);
              await popup.mouse.move(0, 0);
              const geometry = await row.evaluate((element) => {
                const box = (rect: DOMRect) => ({
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                });
                const fragments = (target: Element) => {
                  const range = document.createRange();
                  range.selectNodeContents(target);
                  return Array.from(range.getClientRects())
                    .map(box)
                    .filter((rect) => rect.width > 0 && rect.height > 0);
                };
                const [labelElement, valueElement] = Array.from(
                  element.children
                );
                const rowBox = box(element.getBoundingClientRect());
                const labelFragments = fragments(labelElement);
                const valueFragments = fragments(valueElement);
                const outsideRow = valueFragments.some(
                  (rect) =>
                    rect.left < rowBox.left - 1 || rect.right > rowBox.right + 1
                );
                const overlapsLabel = valueFragments.some((valueRect) =>
                  labelFragments.some(
                    (labelRect) =>
                      valueRect.left < labelRect.right &&
                      valueRect.right > labelRect.left &&
                      valueRect.top < labelRect.bottom &&
                      valueRect.bottom > labelRect.top
                  )
                );
                return {
                  row: rowBox,
                  card: box(element.parentElement!.getBoundingClientRect()),
                  value: box(valueElement.getBoundingClientRect()),
                  labelFragments,
                  valueFragments,
                  outsideRow,
                  overlapsLabel,
                  viewportWidth: window.innerWidth,
                  documentWidth: document.documentElement.scrollWidth,
                  visibleText: valueElement.textContent,
                };
              });
              await capture(
                popup,
                info,
                `approval-amount-${fixture.name}-${width}-${mode}`,
                {
                  runtime,
                  fixture: fixture.name,
                  amount: fixture.amount.toString(),
                  expected,
                  requestedData: data,
                  geometry,
                  visibleRegion,
                  viewport: popup.viewportSize(),
                  controllerResultsReplaced: false,
                  signingApproved: false,
                }
              );
              expect(geometry.valueFragments.length).toBeGreaterThan(0);
              expect(geometry.visibleText).toBe(expected);
              // Before mode records the original geometry without requiring a bug.
              // Ordinary, zero, and unlimited remain healthy controls in both modes.
              if (mode === 'after' || fixture.name !== 'large-finite') {
                expect(geometry.outsideRow).toBe(false);
                expect(geometry.overlapsLabel).toBe(false);
                expect(geometry.card.left).toBeGreaterThanOrEqual(-1);
                expect(geometry.card.right).toBeLessThanOrEqual(width + 1);
                expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1);
              }
              if (fixture.amount === maximum)
                await expect(value).toHaveClass(/text-warning-error/);
              else await expect(value).not.toHaveClass(/text-warning-error/);
              await captureForegroundContrast(
                value,
                info,
                `approval-${fixture.name}-${width}`
              );
            }
          );
          await popupStep(
            wallet,
            popup,
            `check unchanged ${fixture.name} Data and Hex at ${width}px`,
            async () => {
              await popup
                .locator('#tabExample')
                .getByText(en.send.data, { exact: true })
                .click();
              const displayedData = await popup
                .locator('#tabContentExample pre:visible')
                .innerText();
              expect(JSON.parse(displayedData).inputs).toEqual([
                spender,
                fixture.amount.toString(),
              ]);
              await popup
                .locator('#tabExample')
                .getByText(en.send.hex, { exact: true })
                .click();
              const displayedHex = await popup
                .locator('#tabContentExample [role=tabpanel]:visible')
                .innerText();
              expect(displayedHex.trim()).toBe(data);
              const pending = await dapp.evaluate(
                (requestId) =>
                  (window as any).__paliConformance.requests[requestId],
                request
              );
              expect(pending).toMatchObject({
                method: 'eth_sendTransaction',
                params: [transaction],
              });
              expect(pending.settled).not.toBe(true);
              await info.attach(`approval-encoding-${fixture.name}-${width}`, {
                body: JSON.stringify(
                  {
                    runtime,
                    requested: transaction,
                    pending,
                    displayedData,
                    displayedHex,
                  },
                  null,
                  2
                ),
                contentType: 'application/json',
              });
              await popup
                .locator('#tabExample')
                .getByText(en.send.details, { exact: true })
                .click();
            }
          );
          await popupStep(
            wallet,
            popup,
            `cancel ${fixture.name} without signing at ${width}px`,
            async () => {
              const rejected = await dismissRejectedApproval({
                click: () =>
                  popup
                    .getByRole('button', {
                      name: en.buttons.cancel,
                      exact: true,
                    })
                    .click(),
                isClosed: () => popup.isClosed(),
                settle: () => settle(dapp, request),
              });
              expect(rejected.error?.code).toBe(4001);
              expect(rejected.result).toBeUndefined();
              expect(rejected).toMatchObject({
                method: 'eth_sendTransaction',
                params: [transaction],
              });
            }
          );
        }
        await wallet.step(
          `verify ${width}px cancellations and immutable runtime`,
          async () => {
            const requests = await dapp.evaluate(
              () => (window as any).__paliConformance.requests
            );
            expect(requests.map((request: any) => request.method)).toEqual([
              'eth_requestAccounts',
              ...cases.map(() => 'eth_sendTransaction'),
            ]);
            expect(
              requests.slice(1).map((request: any) => request.error?.code)
            ).toEqual(cases.map(() => 4001));
            expect(
              requests
                .slice(1)
                .every((request: any) => request.result === undefined)
            ).toBe(true);
            expect(extensionEvidence()).toEqual(runtime);
          }
        );
      }
    );
  });
}

test('token approval symbol and real fee choices retain readable text without changing the request', async ({}, info) => {
  test.setTimeout(120_000);
  expect([undefined, 'after']).toContain(
    process.env.PALI_FOREGROUND_CONTRAST_MODE
  );
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const readable = async (target: Locator, label: string) => {
    await expect(target).toBeEnabled();
    await target.page().mouse.move(0, 0);
    await captureForegroundContrast(target, info, `${label}-rest`);
    await target.hover();
    await captureForegroundContrast(target, info, `${label}-hover`);
    await target.page().mouse.move(0, 0);
  };
  await withWallet(
    'token-approval-fee-choice-contrast',
    async (wallet, origin) => {
      const { dapp, address } = await connect(wallet, origin);
      const calldata = new Interface([
        'function approve(address,uint256)',
      ]).encodeFunctionData('approve', [spender, BigInt(100000000)]);
      for (const recommendationOnly of [true, false]) {
        await wallet.step(
          `review ${
            recommendationOnly ? 'suggested' : 'raised'
          } fees without signing`,
          async () => {
            const transaction = {
              from: address,
              to: token,
              value: '0x0',
              data: calldata,
              gas: recommendationOnly ? '0x11170' : '0x1000',
              gasPrice: recommendationOnly ? '0x59682f00' : '0x1',
            };
            const request = await startRequest(dapp, 'eth_sendTransaction', [
              transaction,
            ]);
            let popup = await popupFor(wallet.context, dapp, request);
            if (new URL(popup.url()).pathname === '/external/spam-warning') {
              const warning = JSON.parse(
                new URL(popup.url()).searchParams.get('data') || '{}'
              );
              expect(warning).toMatchObject({
                host: new URL(origin).origin,
                eventName: 'spamWarningResponse',
              });
              const warningPopup = popup;
              await clickClosingPopup({
                click: () =>
                  warningPopup
                    .getByRole('button', {
                      name: en.buttons.continue,
                      exact: true,
                    })
                    .click(),
                isClosed: () => warningPopup.isClosed(),
              });
              popup = await popupFor(wallet.context, dapp, request);
            }
            const url = new URL(popup.url());
            expect(url.pathname).toBe('/external/tx/send/ethTx');
            expect(
              JSON.parse(url.searchParams.get('data') || '{}')
            ).toMatchObject({
              host: new URL(origin).origin,
              eventName: 'txSend',
              external: true,
              tx: transaction,
            });
            await expect(
              popup.getByRole('button', {
                name: en.send.editPermission,
                exact: true,
              })
            ).toBeVisible();
            const useDapp = popup.getByRole('button', {
              name: en.send.useDappFeeRequest,
              exact: true,
            });
            const useNetwork = popup.getByRole('button', {
              name: en.send.useNetworkFeeSuggestion,
              exact: true,
            });
            await expect(useDapp).toBeEnabled();
            if (recommendationOnly) await expect(useNetwork).toBeEnabled();
            else await expect(useNetwork).toHaveCount(0);
            for (const width of [400, 320]) {
              await popup.setViewportSize({
                width,
                height: width === 320 ? 360 : 620,
              });
              const prefix = `approval-${
                recommendationOnly ? 'suggested' : 'raised'
              }-${width}`;
              const symbol = popup.getByText('REVIEW', { exact: true });
              await expect(symbol).toHaveCount(1);
              await readable(symbol, `${prefix}-symbol`);
              await readable(useDapp, `${prefix}-use-dapp`);
              if (recommendationOnly)
                await readable(useNetwork, `${prefix}-use-network`);
            }
            const rejected = await dismissRejectedApproval({
              click: () =>
                popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => popup.isClosed(),
              settle: () => settle(dapp, request),
            });
            expect(rejected.error?.code).toBe(4001);
            expect(rejected.result).toBeUndefined();
          }
        );
      }
      expect(extensionEvidence()).toEqual(runtime);
    },
    8,
    '0x77359400'
  );
});

test('rejected popup bursts keep SpamWarning readable and preserve explicit blocking', async ({}, info) => {
  test.setTimeout(120000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  expect(process.env.PALI_FOREGROUND_CONTRAST_MODE).not.toBe('before');
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  let observed = false;
  await withWallet('spam-warning-readable-actions', async (wallet, origin) => {
    const { dapp, address } = await connect(wallet, origin);
    const data = new Interface([
      'function approve(address,uint256)',
    ]).encodeFunctionData('approve', [spender, BigInt(1)]);
    for (let attempt = 0; attempt < 4; attempt++) {
      await wallet.step(
        `ordinary approval attempt ${attempt + 1} is rejected or blocked`,
        async () => {
          const request = await startRequest(dapp, 'eth_sendTransaction', [
            { from: address, to: token, value: '0x0', data },
          ]);
          const popup = await popupFor(wallet.context, dapp, request);
          const url = new URL(popup.url());
          if (url.pathname === '/external/spam-warning') {
            observed = true;
            expect(
              JSON.parse(url.searchParams.get('data') || '{}')
            ).toMatchObject({
              host: new URL(origin).origin,
              eventName: 'spamWarningResponse',
            });
            await expect(
              popup.getByRole('heading', {
                name: en.spamWarning.title,
                exact: true,
              })
            ).toBeVisible();
            for (const width of [400, 320]) {
              await popup.setViewportSize({
                width,
                height: width === 320 ? 360 : 620,
              });
              const block = popup.getByRole('button', {
                name: en.spamWarning.blockTemporarily,
                exact: true,
              });
              const continuation = popup.getByRole('button', {
                name: en.buttons.continue,
                exact: true,
              });
              const count = popup.locator('span').filter({ hasText: /^3$/ });
              const duration = popup
                .locator('p')
                .filter({ hasText: /minute|second/i })
                .last();
              for (const [label, target] of [
                ['block', block],
                ['continue', continuation],
                ['count', count],
                ['duration', duration],
              ] as const) {
                await popup.mouse.move(0, 0);
                await captureForegroundContrast(
                  target,
                  info,
                  `spam-${label}-${width}-rest`
                );
                if (label === 'block' || label === 'continue') {
                  await target.hover();
                  await captureForegroundContrast(
                    target,
                    info,
                    `spam-${label}-${width}-hover`
                  );
                }
              }
            }
            await clickClosingPopup({
              click: () =>
                popup
                  .getByRole('button', {
                    name: en.spamWarning.blockTemporarily,
                    exact: true,
                  })
                  .click(),
              isClosed: () => popup.isClosed(),
            });
            const result = await settle(dapp, request);
            expect(result.error?.code).toBe(4100);
            expect(result.result).toBeUndefined();
            const blocked = await settle(
              dapp,
              await startRequest(dapp, 'eth_sendTransaction', [
                { from: address, to: token, value: '0x0', data },
              ])
            );
            expect(blocked.error?.code).toBe(4100);
            expect(blocked.result).toBeUndefined();
            await info.attach('spam-warning-normal-admission', {
              body: JSON.stringify({
                ...extensionEvidence(),
                observed,
                attempt: attempt + 1,
                controllerStateReplaced: false,
                realPopup: url.pathname,
                broadcast: false,
              }),
              contentType: 'application/json',
            });
          } else {
            expect(url.pathname).toBe('/external/tx/send/ethTx');
            await clickClosingPopup({
              click: () =>
                popup
                  .getByRole('button', { name: en.buttons.cancel, exact: true })
                  .click(),
              isClosed: () => popup.isClosed(),
            });
            expect((await settle(dapp, request)).error?.code).toBe(4001);
          }
        }
      );
      if (observed) break;
    }
    expect(observed).toBe(true);
  });
});
