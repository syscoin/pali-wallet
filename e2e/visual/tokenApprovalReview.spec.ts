import { expect, test, type Page, type TestInfo } from '@playwright/test';
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
  run: (wallet: PaliWallet, origin: string) => Promise<void>
) {
  const previous = { ...E2E_CONFIG };
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
      [id('decimals()').slice(0, 10), abi.encode(['uint8'], [8])],
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
    await wallet.step('import disposable synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
    });
    await wallet.step('select fixture EVM network and open home', async () => {
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await wallet!.ensureOnHome();
    });
    await run(wallet, server.url);
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
}

async function connect(wallet: PaliWallet, origin: string) {
  return wallet.step(
    'connect the local fixture dapp',
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
        let rejectedMetadata = false;
        popup.on('console', (message) => {
          if (
            message.text().includes('Failed to get token info:') &&
            message.text().includes('PALI_TRANSACTION_CONTEXT_CHANGED')
          )
            rejectedMetadata = true;
        });
        await popupStep(
          wallet,
          popup,
          'hold the first real token metadata read',
          async () => {
            await expect.poll(() => seenSelectors('old')).toBe(4);
            await expect(edit).toHaveCount(0);
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
            rejectedMetadata = false;
            held
              .filter((item) => item.round === 'old')
              .forEach((item) => item.release());
            await expect
              .poll(async () => rejectedMetadata || (await edit.count()) > 0)
              .toBe(true);
            expect(rejectedMetadata).toBe(true);
            await expect(edit).toHaveCount(0);
            await expect(
              popup.getByText('100.0 OLD', { exact: true })
            ).toHaveCount(0);
            await capture(popup, info, 'retired-token-metadata', {
              runtime: extensionEvidence(),
              currentContext: await readContext(),
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
