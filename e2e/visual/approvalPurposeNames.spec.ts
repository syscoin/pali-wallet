import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import de from '../../source/assets/locales/de.json';
import en from '../../source/assets/locales/en.json';
import fr from '../../source/assets/locales/fr.json';
import { E2E_CONFIG } from '../harness/config';
import {
  clickClosingPopup,
  dismissRejectedApproval,
} from '../harness/dismissRejectedApproval';
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

// Actual Chromium AX, native public clipboard forwarding and the real dapp
// pipeline. No fabricated popup URL or replaced controller/provider/Chrome/i18n
// result. Sealed baseline executions are explicitly diagnostic; final-head
// executions retain the same assertions and genuine cancellation boundaries.
const locales = [
  {
    code: 'en',
    text: en,
    option: 'English English',
    viewport: { width: 400, height: 620 },
  },
  {
    code: 'de',
    text: de,
    option: 'German Deutsch',
    viewport: { width: 320, height: 360 },
  },
  {
    code: 'fr',
    text: fr,
    option: 'French Français',
    viewport: { width: 400, height: 620 },
  },
] as const;
type Locale = (typeof locales)[number];
type AxObservation = {
  ignored: boolean;
  name: string | null;
  role: string;
  value: string | null;
};

async function publicState(page: Page, host: string) {
  return page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const persisted = await chrome.storage.local.get(['state', 'language']);
    const reference = state.vault.activeAccount;
    const account = state.vault.accounts[reference.type][reference.id];
    const grant = (entry: any) =>
      entry
        ? {
            accountId: entry.accountId,
            accountType: entry.accountType,
            host: entry.host,
            chain: entry.chain,
            chainId: entry.chainId,
            date: entry.date,
          }
        : null;
    return {
      account: { ...reference, address: account.address },
      accounts: Object.values(state.vault.accounts.HDAccount).map(
        (entry: any) => ({
          id: entry.id,
          label: entry.label,
          address: entry.address,
        })
      ),
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      grant: grant(state.dapp.dapps[origin]),
      savedGrant: grant(persisted.state?.dapp?.dapps?.[origin]),
      storedLanguage: persisted.language ?? null,
    };
  }, host);
}

async function saveLanguage(page: Page, current: Locale, next: Locale) {
  await page.bringToFront();
  await page
    .getByRole('button', {
      name: current.text.generalMenu.generalOptions,
      exact: true,
    })
    .click();
  await page
    .getByRole('menuitem', {
      name: current.text.generalMenu.languages,
      exact: true,
    })
    .click();
  await page
    .getByRole('button', {
      name: current.text.settings.setYourPreferredLanguage,
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: next.option, exact: true }).click();
  const save = page.getByRole('button', {
    name: current.text.buttons.save,
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText(next.text.settings.languageWasSet, { exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 32; count++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
}

// Read the exact native element through CDP, not an inferred role/name from
// its placeholder or test-library accessible-name implementation.
async function nativeAx(
  context: BrowserContext,
  page: Page,
  selector: string,
  index: number,
  role: string
): Promise<AxObservation> {
  const session = await context.newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await session.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector,
    });
    expect(nodeIds.length).toBeGreaterThan(index);
    const { nodes } = await session.send('Accessibility.getPartialAXTree', {
      nodeId: nodeIds[index],
      fetchRelatives: false,
    });
    const node = nodes.find(
      (entry) => entry.role?.value === role && !entry.ignored
    );
    expect(node).toBeDefined();
    return {
      role: node!.role!.value as string,
      name: node!.name?.value ?? null,
      value:
        node!.value?.value === undefined ? null : String(node!.value!.value),
      ignored: node!.ignored,
    };
  } finally {
    await session.detach();
  }
}

async function installPublicClipboardAudit(page: Page, addresses: string[]) {
  await page.evaluate((allowed) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      navigator.clipboard,
      'writeText'
    );
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    const audit = { writes: [] as string[], failures: 0, unexpectedValues: 0 };
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => {
        try {
          await write(text);
          if (allowed.includes(text)) audit.writes.push(text);
          else audit.unexpectedValues++;
        } catch (error) {
          audit.failures++;
          throw error;
        }
      },
    });
    (window as any).__approvalPurposePublicClipboard = {
      snapshot: () => ({ ...audit, writes: [...audit.writes] }),
      restore: () => {
        if (descriptor)
          Object.defineProperty(navigator.clipboard, 'writeText', descriptor);
        else delete (navigator.clipboard as any).writeText;
      },
    };
  }, addresses);
}
const clipboardAudit = (page: Page) =>
  page.evaluate(() =>
    (window as any).__approvalPurposePublicClipboard.snapshot()
  );

async function copyBoth(page: Page, buttons: Locator, addresses: string[]) {
  await expect(buttons).toHaveCount(2);
  await installPublicClipboardAudit(page, addresses);
  for (const index of [0, 1]) {
    const button = buttons.nth(index);
    await expect(button).toBeEnabled();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect
      .poll(async () => (await clipboardAudit(page)).writes)
      .toHaveLength(index * 2 + 1);
    // Observe the real scheduled feedback before awaiting its removal below.
    // Otherwise a zero-count check can precede the toast's insertion.
    await expect(page.locator('.Toastify__toast')).toHaveCount(1);
    await tabTo(page, button);
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await clipboardAudit(page)).writes)
      .toHaveLength(index * 2 + 2);
    // Keep the next Copy target and same-request resize free of a preceding
    // success notice without hiding feedback or relaxing the hitpoint checks.
    await expect(page.locator('.Toastify__toast')).toHaveCount(0);
  }
  const audit = await clipboardAudit(page);
  expect(audit).toEqual({
    writes: [addresses[0], addresses[0], addresses[1], addresses[1]],
    failures: 0,
    unexpectedValues: 0,
  });
  await page.evaluate(() =>
    (window as any).__approvalPurposePublicClipboard.restore()
  );
  return audit;
}

// Only native scrolling and read-only layout/hit testing. A visible button can
// still be covered by the separate, non-shrinking account-balance column.
async function mismatchCopyGeometry(buttons: Locator) {
  const fields = [];
  for (const index of [0, 1]) {
    const button = buttons.nth(index);
    await button.scrollIntoViewIfNeeded();
    const geometry = await button.evaluate((element) => {
      const card = element
        .closest('.space-y-3')
        ?.querySelector('.rounded-lg.border');
      const identity = element.parentElement?.parentElement?.parentElement;
      const accountRow = card?.firstElementChild;
      const balance = accountRow?.lastElementChild;
      const describe = (node: Element | null | undefined) =>
        node
          ? {
              tag: node.tagName,
              className: node.getAttribute('class'),
              bounds: node.getBoundingClientRect().toJSON(),
              text: node.textContent,
            }
          : null;
      const bounds = element.getBoundingClientRect();
      const points = [
        [0.5, 0.5],
        [0.1, 0.1],
        [0.9, 0.1],
        [0.1, 0.9],
        [0.9, 0.9],
      ].map(([horizontal, vertical]) => {
        const x = bounds.left + bounds.width * horizontal;
        const y = bounds.top + bounds.height * vertical;
        const found = document.elementFromPoint(x, y);
        return {
          x,
          y,
          exposed: Boolean(
            found && (found === element || element.contains(found))
          ),
          hit: describe(found),
        };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        button: describe(element),
        card: describe(card),
        identity: describe(identity),
        balance: describe(balance),
        balanceText: Array.from(balance?.querySelectorAll('p') || []).map(
          describe
        ),
        points,
      };
    });
    fields.push({ index, ...geometry });
  }
  return fields;
}

function expectClearMismatchCopy(
  fields: Awaited<ReturnType<typeof mismatchCopyGeometry>>
) {
  expect(fields).toHaveLength(2);
  for (const field of fields) {
    expect(field.button, 'Copy field' + field.index).not.toBeNull();
    expect(field.button!.bounds.width).toBeGreaterThan(0);
    expect(field.button!.bounds.height).toBeGreaterThan(0);
    expect(
      field.points.map((point) => point.exposed),
      'Copy field' + field.index + ' has five native exposed hitpoints'
    ).toEqual([true, true, true, true, true]);
  }
}

async function currentPending(
  dapp: Page,
  requestId: number,
  params: unknown[]
) {
  const current = await rpcObservation(dapp, requestId);
  expect(current.id).toBe(requestId);
  expect(current.method).toBe('eth_sendTransaction');
  expect(current.params).toEqual(params);
  expect(current.settled).not.toBe(true);
  expect(current.result).toBeUndefined();
  expect(current.error).toBeUndefined();
  return current;
}

// Third same-method request may genuinely open the ordinary spam warning.
// Continue only that original pending request; do not reset/bypass its guard.
async function originalApproval(
  wallet: PaliWallet,
  dapp: Page,
  requestId: number,
  params: unknown[],
  locale: Locale,
  host: string,
  warnings: unknown[]
) {
  let popup = await popupFor(wallet.context, dapp, requestId);
  if (popup.url().includes('/external/spam-warning')) {
    await expect(
      popup.getByRole('heading', {
        name: locale.text.spamWarning.title,
        exact: true,
      })
    ).toBeVisible();
    const data = await popup.evaluate(() => {
      const value = JSON.parse(
        new URL(location.href).searchParams.get('data')!
      );
      return {
        host: value.host,
        eventName: value.eventName,
        requestCount: value.requestCount,
      };
    });
    expect(data).toEqual({
      host,
      eventName: 'spamWarningResponse',
      requestCount: 3,
    });
    const pending = await currentPending(dapp, requestId, params);
    await clickClosingPopup({
      click: () =>
        popup
          .getByRole('button', {
            name: locale.text.buttons.continue,
            exact: true,
          })
          .click(),
      isClosed: () => popup.isClosed(),
    });
    await expect.poll(() => popup.isClosed()).toBe(true);
    warnings.push({ requestId, data, pending, closed: true });
    popup = await popupFor(wallet.context, dapp, requestId);
  }
  return popup;
}

for (const view of ['details', 'account-mismatch'] as const) {
  test(
    'ordinary ' +
      view +
      ' Copy and nonce purposes follow saved Languages preferences',
    async ({}, info) => {
      test.setTimeout(120_000);
      expect(info.config.workers).toBe(1);
      expect(info.retry).toBe(0);
      expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
      expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
      expect(E2E_CONFIG.extensionPath).toBe(
        process.env.PALI_TEST_DAPP_EXTENSION_PATH
      );
      const before = { ...E2E_CONFIG };
      const fixture = createIsolatedVaultFixture();
      const [from, to] = fixture.evmAddresses;
      const server = await startUtxoFixtureServer();
      const runtime = extensionEvidence();
      const observations: Array<{
        [key: string]: unknown;
        locale: Locale['code'];
        names: AxObservation[];
        nonceNames?: AxObservation[];
        viewport: Locale['viewport'];
      }> = [];
      const warnings: unknown[] = [];
      const earlyNameObservations: unknown[] = [];
      const mismatchGeometryObservations: unknown[] = [];
      const wideClipboardControls: unknown[] = [];
      const pageErrors: string[] = [];
      const unexpectedReads: unknown[] = [];
      const writes: string[] = [];
      const rpcReads: unknown[] = [];
      let wallet: PaliWallet | undefined;
      let dapp: Page | undefined;
      let activePopup: Page | undefined;
      let routes:
        | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
        | undefined;
      let status: 'passed' | 'failed' = 'failed';
      Object.assign(E2E_CONFIG, {
        seedPhrase: UTXO_FIXTURE_SEED,
        password: 'ApprovalPurposeSynthetic!2026',
        rpcUrl: server.url,
      });
      try {
        wallet = await PaliWallet.launch('approval-purpose-' + view, {
          offlineHttpProxy: server.url,
          viewport: { width: 400, height: 620 },
        });
        const observe = (page: Page) =>
          page.on('pageerror', (error) => pageErrors.push(error.message));
        wallet.context.pages().forEach(observe);
        wallet.context.on('page', observe);
        routes = await installIsolatedVaultRoutes(
          wallet.context,
          fixture,
          server.url
        );
        await wallet.context.route(
          'https://rpc.tanenbaum.io/',
          async (route) => {
            if (route.request().method() !== 'POST') {
              unexpectedReads.push({
                method: route.request().method(),
                url: route.request().url(),
              });
              return route.abort('blockedbyclient');
            }
            const body = route.request().postDataJSON();
            const calls = Array.isArray(body) ? body : [body];
            if (
              calls.some((call) =>
                /^(?:eth_send|eth_sign|wallet_|personal_|sys_sign|sendrawtransaction|anvil_|evm_)/.test(
                  call?.method || ''
                )
              )
            ) {
              writes.push(...calls.map((call) => String(call?.method)));
              return route.abort('blockedbyclient');
            }
            const replies = calls.map((call) => {
              if (
                !call ||
                call.jsonrpc !== '2.0' ||
                !Array.isArray(call.params)
              )
                return undefined;
              const { method, params } = call;
              let result: unknown;
              if (method === 'eth_chainId') result = '0x1644';
              if (method === 'net_version') result = '5700';
              if (method === 'eth_blockNumber') result = '0x1';
              if (
                ['eth_getBalance', 'eth_getTransactionCount'].includes(method)
              ) {
                if (
                  ![from, to].some(
                    (address) =>
                      address.toLowerCase() === String(params[0]).toLowerCase()
                  )
                )
                  return undefined;
                result =
                  method === 'eth_getBalance' ? '0x56bc75e2d63100000' : '0x0';
              }
              if (['eth_gasPrice', 'eth_maxPriorityFeePerGas'].includes(method))
                result = '0x3b9aca00';
              if (method === 'eth_getCode') result = '0x';
              if (method === 'eth_getLogs') result = [];
              if (method === 'eth_feeHistory')
                result = {
                  oldestBlock: '0x1',
                  baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
                  gasUsedRatio: [0.5],
                  reward: [['0x3b9aca00', '0x3b9aca00', '0x3b9aca00']],
                };
              if (
                method === 'eth_getBlockByNumber' &&
                ['latest', 'pending', '0x0', '0x1'].includes(params[0]) &&
                typeof params[1] === 'boolean'
              ) {
                const genesis = params[0] === '0x0';
                result = {
                  number: genesis ? '0x0' : '0x1',
                  hash: '0x' + (genesis ? '11' : '12').repeat(32),
                  parentHash: '0x' + (genesis ? '00' : '11').repeat(32),
                  nonce: '0x0000000000000000',
                  timestamp: '0x1',
                  difficulty: '0x0',
                  gasLimit: '0x1c9c380',
                  gasUsed: '0x0',
                  miner: '0x' + '00'.repeat(20),
                  extraData: '0x',
                  transactions: [],
                  baseFeePerGas: '0x3b9aca00',
                };
              }
              if (method === 'eth_estimateGas') {
                const tx = params[0];
                if (
                  params.length !== 1 ||
                  String(tx?.from).toLowerCase() !== from.toLowerCase() ||
                  String(tx?.to).toLowerCase() !== to.toLowerCase() ||
                  tx?.data !== '0x' ||
                  !['0x0', '0x7'].includes(tx?.nonce) ||
                  tx?.value !== '0x1'
                )
                  return undefined;
                result = '0x5208';
              }
              if (result === undefined) return undefined;
              rpcReads.push({ method, params });
              return { jsonrpc: '2.0', id: call.id, result };
            });
            if (replies.some((reply) => reply === undefined)) {
              unexpectedReads.push(...calls);
              return route.abort('blockedbyclient');
            }
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
            });
          }
        );
        const host = new URL(server.url).origin;
        await wallet.step(
          'prepare the ordinary connected synthetic wallet',
          async () => {
            await wallet!.importSeedAndCreatePassword();
            await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
            await wallet!.ensureOnHome();
            dapp = await wallet!.context.newPage();
            await dapp.goto(server.url);
            await dapp.waitForFunction(() =>
              Boolean((window as any).pali?.request)
            );
            const connected = await approve(
              wallet!.context,
              dapp,
              await startRequest(dapp, 'eth_requestAccounts')
            );
            expect(connected.error).toBeUndefined();
            expect(
              connected.result.map((address: string) => address.toLowerCase())
            ).toEqual([from.toLowerCase()]);
            expect((await publicState(wallet!.page, host)).grant).toMatchObject(
              {
                accountId: 0,
                accountType: 'HDAccount',
                host,
              }
            );
            await expect
              .poll(async () => {
                const current = await publicState(wallet!.page, host);
                return current.savedGrant;
              })
              .toEqual((await publicState(wallet!.page, host)).grant);
          }
        );
        if (view === 'account-mismatch') {
          await wallet.step(
            'create a second account through the normal form, keeping the dapp grant on account0',
            async () => {
              await wallet!.gotoRoute('#/settings/account/new');
              await wallet!.page
                .locator('#account-name-input')
                .fill('Other public account');
              await wallet!.page.locator('#create-btn').click();
              await wallet!.page
                .getByRole('button', { name: en.buttons.ok, exact: true })
                .click();
              await wallet!.ensureOnHome();
              const current = await publicState(wallet!.page, host);
              expect(current.account).toMatchObject({ id: 1, address: to });
              expect(current.grant?.accountId).toBe(0);
              expect(current.savedGrant).toEqual(current.grant);
            }
          );
        }
        for (let index = 0; index < locales.length; index++) {
          const locale = locales[index];
          await wallet.step(
            'save ' + locale.code + ' through the ordinary Languages UI',
            async () => {
              const original = await publicState(wallet!.page, host);
              if (index === 0) {
                // Persist English genuinely too, rather than relying on default.
                await saveLanguage(wallet!.page, locales[0], locales[1]);
                await saveLanguage(wallet!.page, locales[1], locales[0]);
              } else
                await saveLanguage(wallet!.page, locales[index - 1], locale);
              const saved = await publicState(wallet!.page, host);
              expect(saved.storedLanguage).toBe(locale.code);
              expect(saved.account).toEqual(original.account);
              expect(saved.network).toEqual(original.network);
              expect(saved.grant).toEqual(original.grant);
              expect(saved.savedGrant).toEqual(original.savedGrant);
            }
          );
          await wallet.step(
            locale.code +
              ': observe native purposes and preserve real public actions before cancellation',
            async (capture) => {
              const baseline = await publicState(wallet!.page, host);
              const tx = {
                from,
                to,
                value: '0x1',
                data: '0x',
                nonce: '0x0',
                gas: '0x5208',
                gasPrice: '0x3b9aca00',
                type: '0x0',
                chainId: '0x1644',
              };
              const params = [tx];
              const requestId = await startRequest(
                dapp!,
                'eth_sendTransaction',
                params
              );
              const popup = await originalApproval(
                wallet!,
                dapp!,
                requestId,
                params,
                locale,
                host,
                warnings
              );
              activePopup = popup;
              await popup.setViewportSize(locale.viewport);
              await popup.bringToFront();
              const beforeRequest = await currentPending(
                dapp!,
                requestId,
                params
              );
              let names: AxObservation[];
              let nonceNames: AxObservation[] | undefined;
              let clipboard: unknown;
              let routeBefore: unknown;
              if (view === 'details') {
                expect(popup.url()).toContain('/external/tx/send/ethTx');
                const panel = popup.getByRole('tabpanel', {
                  name: locale.text.send.details,
                  exact: true,
                });
                await expect(panel).toBeVisible();
                const selector = '#detailsTab button:has(img[alt="Copy"])';
                const buttons = popup.locator(selector);
                await expect(buttons).toHaveCount(2);
                names = await Promise.all(
                  [0, 1].map((field) =>
                    nativeAx(wallet!.context, popup, selector, field, 'button')
                  )
                );
                const nonce = panel.getByRole('spinbutton');
                nonceNames = [
                  await nativeAx(
                    wallet!.context,
                    popup,
                    '#detailsTab input[type="number"]',
                    0,
                    'spinbutton'
                  ),
                ];
                const earlyNames = {
                  view,
                  locale: locale.code,
                  viewport: popup.viewportSize(),
                  requestId,
                  names,
                  nonceNames: [...nonceNames],
                  nonceValue: await nonce.inputValue(),
                };
                earlyNameObservations.push(earlyNames);
                await info.attach(
                  'details-' + locale.code + '-initial-native-ax',
                  {
                    contentType: 'application/json',
                    body: JSON.stringify(earlyNames, null, 2),
                  }
                );
                await expect(nonce).toBeEnabled();
                await expect(nonce).toHaveValue('0');
                clipboard = await copyBoth(popup, buttons, [from, to]);
                routeBefore = await popup.evaluate(() => {
                  const request = JSON.parse(
                    new URL(location.href).searchParams.get('data')!
                  );
                  return {
                    host: request.host,
                    eventName: request.eventName,
                    tx: request.tx,
                  };
                });
                expect((routeBefore as any).host).toBe(host);
                expect((routeBefore as any).eventName).toBe('txSend');
                await nonce.fill('7');
                await expect(nonce).toHaveValue('7');
                nonceNames.push(
                  await nativeAx(
                    wallet!.context,
                    popup,
                    '#detailsTab input[type="number"]',
                    0,
                    'spinbutton'
                  )
                );
                await nonce.fill('0');
                await expect(nonce).toHaveValue('0');
                nonceNames.push(
                  await nativeAx(
                    wallet!.context,
                    popup,
                    '#detailsTab input[type="number"]',
                    0,
                    'spinbutton'
                  )
                );
                expect(
                  await popup.evaluate(() => {
                    const request = JSON.parse(
                      new URL(location.href).searchParams.get('data')!
                    );
                    return {
                      host: request.host,
                      eventName: request.eventName,
                      tx: request.tx,
                    };
                  })
                ).toEqual(routeBefore);
              } else {
                expect(popup.url()).toContain(
                  '/external/change-active-connected-account'
                );
                await expect(
                  popup.getByText(locale.text.connections.requiredAccount, {
                    exact: true,
                  })
                ).toBeVisible();
                await expect(
                  popup.getByText(
                    locale.text.connections.currentActiveAccount,
                    { exact: true }
                  )
                ).toBeVisible();
                const selector =
                  '.space-y-4 > .space-y-3 button:has(.anticon-copy)';
                const buttons = popup.locator(selector);
                await expect(buttons).toHaveCount(2);
                names = await Promise.all(
                  [0, 1].map((field) =>
                    nativeAx(wallet!.context, popup, selector, field, 'button')
                  )
                );
                const earlyNames = {
                  view,
                  locale: locale.code,
                  viewport: popup.viewportSize(),
                  requestId,
                  names,
                };
                earlyNameObservations.push(earlyNames);
                await info.attach(
                  'mismatch-' + locale.code + '-initial-native-ax',
                  {
                    contentType: 'application/json',
                    body: JSON.stringify(earlyNames, null, 2),
                  }
                );
                routeBefore = await popup.evaluate(() => {
                  const request = JSON.parse(
                    new URL(location.href).searchParams.get('data')!
                  );
                  return {
                    host: request.host,
                    eventName: request.eventName,
                    connectedAccount: request.connectedAccount,
                    accountType: request.accountType,
                  };
                });
                expect(routeBefore).toMatchObject({
                  host,
                  eventName: 'changeActiveConnected',
                  connectedAccount: { id: 0, address: from },
                  accountType: 'HDAccount',
                });
                if (locale.viewport.width === 320) {
                  // Observe the original small layout before the healthy
                  // same-request width control. Preserve its genuine image.
                  await buttons.nth(0).scrollIntoViewIfNeeded();
                  await info.attach(
                    'mismatch-' + locale.code + '-initial-320',
                    {
                      contentType: 'image/png',
                      body: await popup.screenshot({ animations: 'disabled' }),
                    }
                  );
                  mismatchGeometryObservations.push({
                    locale: locale.code,
                    requestId,
                    stage: 'initial-320',
                    fields: await mismatchCopyGeometry(buttons),
                  });
                  await popup.setViewportSize({
                    ...locale.viewport,
                    width: 400,
                  });
                  const wideGeometry = await mismatchCopyGeometry(buttons);
                  mismatchGeometryObservations.push({
                    locale: locale.code,
                    requestId,
                    stage: 'same-pending-request-400',
                    fields: wideGeometry,
                  });
                  expectClearMismatchCopy(wideGeometry);
                  const wideClipboard = await copyBoth(popup, buttons, [
                    from,
                    to,
                  ]);
                  expect(await publicState(popup, host)).toEqual(baseline);
                  const widePending = await currentPending(
                    dapp!,
                    requestId,
                    params
                  );
                  expect(widePending).toEqual(beforeRequest);
                  wideClipboardControls.push({
                    locale: locale.code,
                    requestId,
                    viewport: popup.viewportSize(),
                    clipboard: wideClipboard,
                    pending: widePending,
                    publicState: await publicState(popup, host),
                  });
                  await popup.setViewportSize(locale.viewport);
                }
                const copyGeometry = await mismatchCopyGeometry(buttons);
                mismatchGeometryObservations.push({
                  locale: locale.code,
                  requestId,
                  stage:
                    locale.viewport.width === 320
                      ? 'same-pending-request-returned-320'
                      : 'ordinary-layout',
                  fields: copyGeometry,
                });
                // Fail on the actual overlap immediately, not a 30s click
                // timeout. Native pointer and keyboard copy still run below
                // once all hitpoints are genuinely exposed.
                expectClearMismatchCopy(copyGeometry);
                clipboard = await copyBoth(popup, buttons, [from, to]);
                expect(
                  await popup.evaluate(() => {
                    const request = JSON.parse(
                      new URL(location.href).searchParams.get('data')!
                    );
                    return {
                      host: request.host,
                      eventName: request.eventName,
                      connectedAccount: request.connectedAccount,
                      accountType: request.accountType,
                    };
                  })
                ).toEqual(routeBefore);
              }
              expect(await publicState(popup, host)).toEqual(baseline);
              const pending = await currentPending(dapp!, requestId, params);
              await capture(popup);
              await info.attach(view + '-' + locale.code + '-public-actions', {
                contentType: 'image/png',
                body: await popup.screenshot({ animations: 'disabled' }),
              });
              const canceled = await dismissRejectedApproval({
                click: () =>
                  popup
                    .getByRole('button', {
                      name: locale.text.buttons.cancel,
                      exact: true,
                    })
                    .click(),
                isClosed: () => popup.isClosed(),
                settle: () => settle(dapp!, requestId),
              });
              // Genuine account-switch consent rejection is wrapped as4100 by
              // accountSwitchingMiddleware; the transaction review itself is4001.
              expect(canceled.error?.code).toBe(
                view === 'details' ? 4001 : 4100
              );
              expect(canceled.result).toBeUndefined();
              expect(canceled.params).toEqual(params);
              expect(await publicState(wallet!.page, host)).toEqual(baseline);
              expect(writes).toEqual([]);
              expect(unexpectedReads).toEqual([]);
              expect(routes!.deniedWrites).toEqual([]);
              expect(pageErrors).toEqual([]);
              observations.push({
                locale: locale.code,
                viewport: locale.viewport,
                names,
                nonceNames,
                clipboard,
                requestId,
                routeBefore,
                beforeRequest,
                pending,
                rejectedCode: canceled.error?.code,
                noResult: canceled.result === undefined,
                publicState: await publicState(wallet!.page, host),
                approvalClicked: false,
              });
              activePopup = undefined;
            }
          );
        }
        // All independent healthy clipboard, edit, pending-request, scope and
        // cancellation checks finish first. Only then assert expected localized
        // semantics against the retained real Chromium AX observations.
        for (const observation of observations) {
          const locale = locales.find(
            (entry) => entry.code === observation.locale
          )!;
          for (const [field, ax] of observation.names.entries()) {
            expect
              .soft(ax.role, locale.code + ': Copy field' + field)
              .toBe('button');
            expect
              .soft(ax.name, locale.code + ': Copy field' + field)
              .toMatch(
                locale.code === 'en'
                  ? /^copy$/i
                  : new RegExp('^' + locale.text.buttons.copy + '$')
              );
          }
          for (const [edit, ax] of (observation.nonceNames || []).entries()) {
            expect
              .soft(ax.role, locale.code + ': nonce edit' + edit)
              .toBe('spinbutton');
            expect
              .soft(ax.name, locale.code + ': nonce edit' + edit)
              .toBe(locale.text.send.customNonce);
          }
        }
        expect(observations).toHaveLength(3);
        status = info.errors.length === 0 ? 'passed' : 'failed';
      } finally {
        try {
          await info.attach(
            'approval-purpose-native-browser-evidence-' + view,
            {
              contentType: 'application/json',
              body: JSON.stringify(
                {
                  diagnosticOnly:
                    process.env.PALI_DIAGNOSTIC_OLD_RUNTIME === '1',
                  notAggregateWalletQualification: true,
                  view,
                  runtime,
                  sourceSha256: createHash('sha256')
                    .update(fs.readFileSync(info.file))
                    .digest('hex'),
                  actualBrowserAx: true,
                  localesSetThroughOrdinaryLanguagesSave: true,
                  noControllerOrSdkOrI18nResultReplacement: true,
                  noSigningOrBroadcast: true,
                  approvalClicked: false,
                  observations,
                  earlyNameObservations,
                  mismatchGeometryObservations,
                  wideClipboardControls,
                  warnings,
                  rpcReads,
                  unexpectedReads,
                  writes,
                  pageErrors,
                  fixtureDeniedWrites: routes?.deniedWrites || [],
                  fixtureReads: routes?.reads || [],
                  proxyDeniedConnections: server.blocked.length,
                  activeApprovalAtCleanup: Boolean(
                    activePopup && !activePopup.isClosed()
                  ),
                },
                null,
                2
              ),
            }
          );
        } finally {
          try {
            await wallet?.dispose(status);
          } finally {
            await server.close();
            Object.assign(E2E_CONFIG, before);
          }
        }
      }
    }
  );
}
