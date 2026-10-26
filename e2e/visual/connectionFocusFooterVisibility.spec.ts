import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import {
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

// All interaction is ordinary UI; evaluate only observes public state, focus,
// painted text, geometry, computed styles and hit testing. No quote is held or
// delivered, and no controller/store/runtime result or DOM/style is replaced.
const BLACKLIST_FEEDS = new Map<string, unknown>([
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    { blacklist: [], whitelist: [], fuzzylist: [] },
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    [],
  ],
  [
    'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
    [],
  ],
]);

const requestKey = (url: URL) => {
  const query = new URLSearchParams(url.search);
  const address = query.get('address');
  if (address) query.set('address', address.toLowerCase());
  query.sort();
  return url.origin + url.pathname + (query.size ? '?' + query : '');
};

const tabTo = async (page: Page, target: Locator) => {
  for (let index = 0; index < 30; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const publicIdentity = (page: Page, host: string) =>
  page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const saved = await chrome.storage.local.get(['state', key]);
    const reference = state.vault.activeAccount;
    const accounts = (value: any) =>
      Object.values(value?.HDAccount || {})
        .map((account: any) => ({
          id: account.id,
          label: account.label,
          address: account.address,
        }))
        .sort((a, b) => a.id - b.id);
    const grant = (value: any) =>
      value
        ? {
            host: value.host,
            accountId: value.accountId,
            accountType: value.accountType,
          }
        : null;
    const network = state.vault.activeNetwork;
    return {
      active: {
        id: reference.id,
        type: reference.type,
        address: state.vault.accounts[reference.type][reference.id].address,
      },
      network: {
        chainId: network.chainId,
        kind: network.kind,
        url: network.url,
        slip44: network.slip44,
      },
      accounts: accounts(state.vault.accounts),
      savedAccounts: accounts(saved[key]?.accounts),
      grant: grant(state.dapp.dapps[origin]),
      savedGrant: grant(saved.state?.dapp?.dapps?.[origin]),
    };
  }, host);

const exposure = async (row: Locator, footer: Locator) => {
  const footerRect = await footer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: rect.height,
      position: style.position,
      zIndex: style.zIndex,
    };
  });
  return row.evaluate((element, action) => {
    const rect = (node: Element) => {
      const value = node.getBoundingClientRect();
      return {
        top: value.top,
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        width: value.width,
        height: value.height,
      };
    };
    const describe = (node: Element | null) =>
      node
        ? {
            tag: node.tagName,
            role: node.getAttribute('role'),
            classes: typeof node.className === 'string' ? node.className : '',
          }
        : null;
    const label = element.querySelector('p.font-medium');
    const address = Array.from(element.querySelectorAll('p')).find((node) =>
      node.classList.contains('text-xs')
    );
    const check = Array.from(element.querySelectorAll('div')).find(
      (node) =>
        node.classList.contains('w-6') &&
        node.classList.contains('rounded-full') &&
        node.classList.contains('border-2')
    );
    // An element's box can fit while its un-clipped text paints into the
    // adjacent balance. Intersect text ranges with actual clipping ancestors;
    // CSS-truncated, unpainted glyphs must not become false collisions.
    const paintedText = (node: Element | undefined) => {
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const value = range.getBoundingClientRect();
      const painted = {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
      };
      for (
        let ancestor: Element | null = node;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
          painted.left = Math.max(painted.left, bounds.left);
          painted.right = Math.min(painted.right, bounds.right);
        }
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
          painted.top = Math.max(painted.top, bounds.top);
          painted.bottom = Math.min(painted.bottom, bounds.bottom);
        }
      }
      return {
        text: node.textContent,
        box: rect(node),
        range: {
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom,
        },
        painted,
      };
    };
    const addressText = paintedText(address);
    const balanceText = Array.from(
      element.querySelectorAll('p.whitespace-nowrap')
    ).map(paintedText);
    const textOverlaps = balanceText.filter(
      (balance) =>
        addressText &&
        balance &&
        Math.min(addressText.painted.right, balance.painted.right) -
          Math.max(addressText.painted.left, balance.painted.left) >
          1 &&
        Math.min(addressText.painted.bottom, balance.painted.bottom) -
          Math.max(addressText.painted.top, balance.painted.top) >
          1
    );
    const ancestors: any[] = [];
    for (
      let node: HTMLElement | null = element as HTMLElement;
      node;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      ancestors.push({
        ...describe(node),
        rect: rect(node),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollPaddingBottom: style.scrollPaddingBottom,
        navigationScroll: node.dataset.navigationScroll || null,
      });
    }
    const target = (node: Element | null | undefined) => {
      if (!node) return { exists: false, fullyExposed: false };
      const box = rect(node);
      const points = [
        { x: box.left + 2, y: box.top + 2 },
        { x: box.right - 2, y: box.top + 2 },
        { x: box.left + 2, y: box.bottom - 2 },
        { x: box.right - 2, y: box.bottom - 2 },
        { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
      ].map((point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          ...point,
          hit: describe(hit),
          hitWithinRow: Boolean(hit && element.contains(hit)),
        };
      });
      const clippedBy = ancestors.filter(
        (ancestor) =>
          (['auto', 'scroll', 'hidden', 'clip'].includes(ancestor.overflowY) &&
            (box.top < ancestor.rect.top - 1 ||
              box.bottom > ancestor.rect.bottom + 1)) ||
          (['auto', 'scroll', 'hidden', 'clip'].includes(ancestor.overflowX) &&
            (box.left < ancestor.rect.left - 1 ||
              box.right > ancestor.rect.right + 1))
      );
      const insideViewport =
        box.top >= 0 &&
        box.left >= 0 &&
        box.right <= innerWidth &&
        box.bottom <= innerHeight;
      const aboveFooter = box.bottom <= action.top;
      return {
        exists: true,
        rect: box,
        points,
        clippedBy,
        insideViewport,
        aboveFooter,
        fullyExposed:
          insideViewport &&
          aboveFooter &&
          clippedBy.length === 0 &&
          points.every((point) => point.hitWithinRow),
      };
    };
    const targets = {
      label: target(label),
      address: target(address),
      check: target(check),
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      focused: element === document.activeElement,
      row: rect(element),
      selected: element.classList.contains('shadow-md'),
      action,
      ancestors,
      documentScroll: {
        x: scrollX,
        y: scrollY,
        scrollingElement: describe(document.scrollingElement),
      },
      targets,
      textLayout: { addressText, balanceText, textOverlaps },
      fullyExposed: Object.values(targets).every(
        (target) => target.fullyExposed
      ),
    };
  }, footerRect);
};

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`native connection-account focus stays exposed above actions at ${viewport.width}x${viewport.height}`, async ({}, info) => {
    expect(process.version).toBe('v26.12.1');
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const config = getNetworkConfig(57, 'sys');
    const initialXpub = new sys.HDSigner(
      UTXO_FIXTURE_SEED,
      '',
      false,
      config.networks,
      57,
      config.types.zPubType,
      84
    ).getAccountXpub();
    const emptyInventory = {
      address: initialXpub,
      balance: '0',
      unconfirmedBalance: '0',
      totalReceived: '0',
      totalSent: '0',
      txs: 0,
      unconfirmedTxs: 0,
      usedTokens: 0,
      tokens: [],
      tokensAsset: [],
      transactions: [],
    };
    const auxiliary = new Map<string, unknown>(BLACKLIST_FEEDS);
    const addRead = (url: string, body: unknown) =>
      auxiliary.set(requestKey(new URL(url)), body);
    for (const origin of [
      'https://blockbook.syscoin.org',
      'https://blockbook-dev.syscoin.org',
    ])
      addRead(origin + '/api/v2/tickers/currency', {
        ts: 1,
        rates: { usd: 1, eur: 0.2 },
      });
    for (const query of [
      'details=tokenBalances&tokens=used',
      'details=txsummary&pageSize=30',
      'details=tokenBalances&tokens=nonzero',
      'details=txslight&pageSize=30',
    ])
      addRead(
        'https://blockbook.syscoin.org/api/v2/xpub/' +
          initialXpub +
          '?' +
          query,
        emptyInventory
      );
    addRead(
      'https://api.coingecko.com/api/v3/simple/price?ids=syscoin&vs_currencies=usd&include_24hr_change=true',
      // eslint-disable-next-line camelcase -- canonical CoinGecko wire field.
      { syscoin: { usd: 0.125, usd_24h_change: 0 } }
    );
    for (const owner of fixture.evmAddresses)
      for (const action of [
        'tokenlist',
        'txlist',
        'pendingtxlist',
        'tokentx',
      ]) {
        const url = new URL('https://explorer.tanenbaum.io/api');
        url.searchParams.set('module', 'account');
        url.searchParams.set('action', action);
        url.searchParams.set('address', owner);
        if (action === 'txlist' || action === 'tokentx')
          url.searchParams.set('sort', 'desc');
        addRead(url.href, {
          status: action === 'tokenlist' ? '1' : '0',
          message: action === 'tokenlist' ? 'OK' : 'No transactions found',
          result: [],
        });
      }
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'ConnectionFocusSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let popup: Page | undefined;
    let dapp: Page | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const reads: Array<{ method: string; url: string }> = [];
    const unexpectedWalletHttpFailures: Array<{
      method: string;
      url: string;
      failure: string | null;
    }> = [];
    const forbiddenRequests: string[] = [];
    const pageErrors: string[] = [];
    const observations: Record<string, any> = { runtime, sourceSha256 };
    let expectedIdentity: Awaited<ReturnType<typeof publicIdentity>>;
    let nativeExposure: Awaited<ReturnType<typeof exposure>> | undefined;
    try {
      wallet = await PaliWallet.launch(
        `connection-focus-footer-${viewport.width}x${viewport.height}`,
        {
          offlineHttpProxy: server.url,
          viewport,
        }
      );
      const page = wallet.page;
      const step = (
        name: string,
        action: (capture: (target: Page) => Promise<void>) => Promise<void>
      ) =>
        wallet!.step(`${viewport.width}x${viewport.height}: ${name}`, action);
      page.on('pageerror', (error) => pageErrors.push(error.message));
      wallet.context.on('page', (newPage) =>
        newPage.on('pageerror', (error) => pageErrors.push(error.message))
      );
      wallet.context.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol))
          reads.push({ method: request.method(), url: request.url() });
        if (/\/sendtx(?:\/|$)/i.test(url.pathname))
          forbiddenRequests.push('sendtx');
        try {
          const payload = request.postDataJSON();
          for (const call of Array.isArray(payload) ? payload : [payload])
            if (
              /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
                call?.method || ''
              )
            )
              forbiddenRequests.push(call.method);
        } catch {
          /* Read-only GETs and local HTML have no JSON body. */
        }
      });
      wallet.context.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url()))
          unexpectedWalletHttpFailures.push({
            method: request.method(),
            url: request.url(),
            failure: request.failure()?.errorText || null,
          });
      });
      // The auxiliary GET resolver is registered atomically with the deny route.
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url,
        (url) =>
          !url.username && !url.password && !url.hash
            ? auxiliary.get(requestKey(url))
            : undefined
      );
      const assertIdentity = async () => {
        const state = await publicIdentity(page, server.url);
        expect(state).toEqual(expectedIdentity);
        expect(state.grant).toBeNull();
        expect(state.savedGrant).toBeNull();
        return state;
      };
      const rowFor = (approval: Page, label: string) =>
        approval
          .locator('[role="button"][tabindex="0"]')
          .filter({ has: approval.getByText(label, { exact: true }) });
      let first: { id: number; label: string; address: string };
      let second: { id: number; label: string; address: string };
      let requestId: number;
      await step(
        'verify runtime and create two ordinary HD accounts',
        async () => {
          observations.workerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.workerIdentity = value;
            }
          );
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet!.gotoRoute('#/settings/account/new');
          await page
            .locator('#account-name-input')
            .fill('Focus selection Beta');
          await page.locator('#create-btn').click();
          await page
            .getByRole('button', { name: en.buttons.ok, exact: true })
            .click();
          await wallet!.ensureOnHome();
          expectedIdentity = await publicIdentity(page, server.url);
          expect(expectedIdentity.network).toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
            url: 'https://rpc.tanenbaum.io',
          });
          expect(expectedIdentity.accounts).toHaveLength(2);
          expect(expectedIdentity.savedAccounts).toEqual(
            expectedIdentity.accounts
          );
          expect(expectedIdentity.active).toMatchObject({
            id: 1,
            type: 'HDAccount',
          });
          expect(
            expectedIdentity.accounts.map((account) => account.address)
          ).toEqual(fixture.evmAddresses);
          expect(expectedIdentity.grant).toBeNull();
          expect(expectedIdentity.savedGrant).toBeNull();
          first = expectedIdentity.accounts.find(
            (account) => account.id === 0
          )!;
          second = expectedIdentity.accounts.find(
            (account) => account.id === 1
          )!;
          expect(first.address).not.toBe(second.address);
          observations.initialIdentity = expectedIdentity;
        }
      );
      await step(
        'open a genuine pending connection request',
        async (capture) => {
          dapp = await wallet!.context.newPage();
          await dapp.goto(server.url);
          await dapp.waitForFunction(() =>
            Boolean(
              (window as any).__paliConformanceProvider && (window as any).pali
            )
          );
          requestId = await startRequest(dapp, 'eth_requestAccounts');
          observations.requestId = requestId;
          popup = await popupFor(wallet!.context, dapp, requestId);
          await popup.setViewportSize(viewport);
          const firstRow = rowFor(popup, first.label);
          const secondRow = rowFor(popup, second.label);
          await expect(firstRow).toHaveCount(1);
          await expect(secondRow).toHaveCount(1);
          await expect(secondRow).toHaveClass(/shadow-md/);
          await expect(firstRow).not.toHaveClass(/shadow-md/);
          expect((await rpcObservation(dapp, requestId)).settled).not.toBe(
            true
          );
          await assertIdentity();
          await capture(popup);
        }
      );
      await step(
        'native Tab and Enter select the first account before any wheel gesture',
        async (capture) => {
          const firstRow = rowFor(popup!, first.label);
          const secondRow = rowFor(popup!, second.label);
          const cancel = popup!.getByRole('button', {
            name: en.buttons.cancel,
            exact: true,
          });
          const footer = cancel.locator('..').locator('..');
          await tabTo(popup!, firstRow);
          await expect(firstRow).toBeFocused();
          await popup!.keyboard.press('Enter');
          await expect(firstRow).toBeFocused();
          await expect(firstRow).toHaveClass(/shadow-md/);
          await expect(secondRow).not.toHaveClass(/shadow-md/);
          await expect(firstRow).toBeVisible();
          await expect(cancel).toBeVisible();
          await expect(
            popup!.getByRole('button', {
              name: en.buttons.confirm,
              exact: true,
            })
          ).toBeEnabled();
          nativeExposure = await exposure(firstRow, footer);
          observations.nativeExposure = nativeExposure;
          expect(nativeExposure.focused).toBe(true);
          expect(nativeExposure.selected).toBe(true);
          expect(nativeExposure.action.position).toBe('fixed');
          expect((await rpcObservation(dapp!, requestId)).settled).not.toBe(
            true
          );
          await assertIdentity();
          await capture(popup!);
        }
      );
      await step(
        'ordinary compact content scrolling exposes the same selection without changing consent',
        async (capture) => {
          const firstRow = rowFor(popup!, first.label);
          const footer = popup!
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .locator('..')
            .locator('..');
          const wheelSteps: number[] = [];
          if (viewport.height === 360) {
            const scrollport = popup!.locator(
              '[data-navigation-scroll="wallet-layout"]'
            );
            const wheel = async (delta: number) => {
              const expectedTop = await scrollport.evaluate(
                (element, amount) =>
                  Math.max(
                    0,
                    Math.min(
                      element.scrollHeight - element.clientHeight,
                      element.scrollTop + amount
                    )
                  ),
                delta
              );
              await popup!.mouse.wheel(0, delta);
              wheelSteps.push(delta);
              // Wheel delivery is asynchronous. A transient exposed frame on
              // the way past this row is not a settled recovery observation.
              await expect
                .poll(() => scrollport.evaluate((element) => element.scrollTop))
                .toBe(expectedTop);
            };
            await popup!.mouse.move(viewport.width / 2, 200);
            await wheel(100);
            const afterWheel = await exposure(firstRow, footer);
            observations.firstSettledWheel = afterWheel;
            if (!afterWheel.fullyExposed && afterWheel.row.top < 0) {
              // Correct native focus may already expose the row near the top.
              // Recover from scrolling past it with an ordinary reverse wheel;
              // never change DOM, focus, scrollTop or the stored native proof.
              await wheel(-100);
            }
          }
          const control = await exposure(firstRow, footer);
          observations.wheelHealthyControl = {
            wheelApplied: viewport.height === 360,
            wheelSteps,
            exposure: control,
          };
          await capture(popup!);
          expect(control.fullyExposed).toBe(true);
          expect(control.focused).toBe(true);
          expect(control.selected).toBe(true);
          await expect(firstRow).toHaveClass(/shadow-md/);
          await expect(rowFor(popup!, second.label)).not.toHaveClass(
            /shadow-md/
          );
          expect((await rpcObservation(dapp!, requestId)).settled).not.toBe(
            true
          );
          await assertIdentity();
        }
      );
      await step(
        'native focus also exposes the final account and its separate copy control',
        async (capture) => {
          // The preceding manual wheel leaves a real pointer in the content.
          // Move it away before keyboard-only review so scrolling an address
          // under that pointer does not deliberately open its hover tooltip.
          await popup!.mouse.move(2, 2);
          await expect(popup!.getByRole('tooltip')).toBeHidden();
          const lastRow = rowFor(popup!, second.label);
          const footer = popup!
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .locator('..')
            .locator('..');
          await tabTo(popup!, lastRow);
          await expect(lastRow).toBeFocused();
          observations.lastNativeExposure = await exposure(lastRow, footer);
          await popup!.keyboard.press('Tab');
          const copy = lastRow.getByRole('button', {
            name: en.transactions.copyAddress,
            exact: true,
          });
          await expect(copy).toBeFocused();
          observations.lastCopyExposure = await exposure(lastRow, footer);
          await expect(rowFor(popup!, first.label)).toHaveClass(/shadow-md/);
          await expect(lastRow).not.toHaveClass(/shadow-md/);
          expect((await rpcObservation(dapp!, requestId)).settled).not.toBe(
            true
          );
          await assertIdentity();
          await capture(popup!);
        }
      );
      await step(
        'real Cancel rejects the pending request and leaves live and saved grants absent',
        async () => {
          observations.cancel = await dismissRejectedApproval({
            click: () =>
              popup!
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click(),
            isClosed: () => popup!.isClosed(),
            settle: () => settle(dapp!, requestId),
          });
          expect(observations.cancel.error?.code).toBe(4100);
          expect(observations.cancel.error?.message).toBe(
            'Connection required'
          );
          expect(observations.cancel.result).toBeUndefined();
          popup = undefined;
          observations.finalIdentity = await assertIdentity();
        }
      );
      await step(
        'retain exact runtime source and strict no-write HTTP controls',
        async () => {
          observations.finalWorkerIdentity = await verifyExecutingWorker(
            wallet!.context,
            wallet!.extensionId,
            E2E_CONFIG.extensionPath,
            (value) => {
              observations.finalWorkerIdentity = value;
            }
          );
          expect(routes!.deniedWrites).toEqual([]);
          expect(forbiddenRequests).toEqual([]);
          expect(unexpectedWalletHttpFailures).toEqual([]);
          expect(pageErrors).toEqual([]);
          expect(extensionEvidence()).toEqual(runtime);
          expect(
            createHash('sha256')
              .update(fs.readFileSync(info.file))
              .digest('hex')
          ).toBe(sourceSha256);
        }
      );
      await step(
        'account address and native and fiat balance glyphs do not collide',
        async () => {
          const layout = observations.wheelHealthyControl.exposure.textLayout;
          expect(layout.addressText.text).toContain('0x');
          expect(layout.balanceText).toHaveLength(2);
          expect(layout.textOverlaps).toEqual([]);
        }
      );
      await step(
        'focused selected identity and check remain exposed above the action footer',
        async () => {
          // Sole candidate assertion deliberately follows actual Cancel and all
          // controls. The compact baseline should fail here if the hypothesized
          // focus occlusion is real; ordinary below-fold content alone is not it.
          expect(nativeExposure?.fullyExposed).toBe(true);
          expect(observations.lastNativeExposure.fullyExposed).toBe(true);
          expect(observations.lastCopyExposure.fullyExposed).toBe(true);
        }
      );
      status = 'passed';
    } finally {
      try {
        await info.attach('connection-focus-footer-evidence', {
          contentType: 'application/json',
          body: JSON.stringify({
            status,
            observations,
            reads,
            unexpectedWalletHttpFailures,
            forbiddenRequests,
            pageErrors,
            fixtureReads: routes?.reads || [],
            deniedWrites: routes?.deniedWrites || [],
            proxyDeniedConnections: server.blocked.length,
            proxyCountIsPlatformEvidenceOnly: true,
            controllerStateReplaced: false,
            controllerResultsReplaced: false,
            runtimeMessagesManufactured: false,
            reduxOrDOMReplaced: false,
            cacheOrAlarmModified: false,
            quoteHeld: false,
            connectionGranted: false,
            signingOrBroadcastRequested: false,
          }),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          await server.close();
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  });
}
