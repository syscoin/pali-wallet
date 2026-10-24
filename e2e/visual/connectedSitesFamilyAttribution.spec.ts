import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { ellipsis } from '../../source/utils/format';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { verifyExecutingWorker } from '../harness/runtimeIdentity';
import {
  approve,
  extensionEvidence,
  popupFor,
  providerRequest,
  startRequest,
} from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// Read only public identity and permission metadata, never another vault or
// the full persisted state. All mutations below use the ordinary wallet UI.
// Retain explicit sanitized step PNGs only, not automatic profile recordings.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
async function publicConnectionState(page: Page, host: string) {
  return page.evaluate(async (origin) => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const saved = await chrome.storage.local.get('state');
    const { activeAccount, activeNetwork, accounts } = state.vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id];
    const grant = (value: any) =>
      value
        ? {
            host: value.host,
            accountId: value.accountId,
            accountType: value.accountType,
            chain: value.chain,
            chainId: value.chainId,
          }
        : null;
    return {
      account: {
        id: activeAccount.id,
        type: activeAccount.type,
        address: account?.address,
        label: account?.label,
      },
      network: {
        kind: activeNetwork.kind,
        chainId: activeNetwork.chainId,
        url: activeNetwork.url,
      },
      liveGrant: grant(state.dapp.dapps[origin]),
      savedGrant: grant(saved.state?.dapp?.dapps[origin]),
    };
  }, host);
}

const connectionLabelScope = (page: Page) =>
  page.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'getCurrentState' });
    const key = 'state-vault-' + state.vaultGlobal.activeSlip44;
    const disk = await chrome.storage.local.get([key, 'state']);
    const accounts = (vault: any) =>
      Object.entries(vault?.accounts || {})
        .flatMap(([kind, group]) =>
          Object.values(group || {}).map((a: any) => ({
            kind,
            id: a.id,
            label: a.label,
            address: a.address,
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const assets = (vault: any) =>
      Object.entries(vault?.accountAssets || {})
        .flatMap(([kind, group]) =>
          Object.entries(group || {}).map(([id, families]: [string, any]) => ({
            kind,
            id: Number(id),
            families: Object.entries(families || {}).map(
              ([family, values]) => ({
                family,
                values: (values as any[]).map((a: any) => ({
                  id: a.id,
                  address: a.contractAddress,
                  chainId: a.chainId,
                  symbol: a.tokenSymbol || a.symbol,
                  balance: a.balance,
                  decimals: a.decimals,
                  standard: a.tokenStandard,
                  isNft: a.isNft,
                })),
              })
            ),
          }))
        )
        .sort((a, b) =>
          (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id)
        );
    const grants = (value: any) =>
      Object.values(value || {})
        .map((g: any) => ({
          host: g.host,
          accountId: g.accountId,
          accountType: g.accountType,
          chain: g.chain,
          chainId: g.chainId,
          date: g.date,
        }))
        .sort((a, b) => a.host.localeCompare(b.host));
    return {
      active: state.vault.activeAccount,
      savedActive: disk[key]?.activeAccount,
      network: {
        kind: state.vault.activeNetwork.kind,
        chainId: state.vault.activeNetwork.chainId,
        url: state.vault.activeNetwork.url,
      },
      slip44: state.vaultGlobal.activeSlip44,
      liveAccounts: accounts(state.vault),
      savedAccounts: accounts(disk[key]),
      liveAssets: assets(state.vault),
      savedAssets: assets(disk[key]),
      liveGrants: grants(state.dapp?.dapps),
      savedGrants: grants(disk.state?.dapp?.dapps),
    };
  });

async function strictConnectionRpc(
  context: PaliWallet['context'],
  owner: string
) {
  const reads: any[] = [],
    denied: unknown[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== 'https://rpc.tanenbaum.io') return route.fallback();
    let payload: unknown;
    try {
      payload = request.postDataJSON();
    } catch {
      /* Rejected below. */
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    const valid =
      request.method() === 'POST' &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password &&
      calls.length > 0 &&
      calls.every(
        (call: any) =>
          call &&
          typeof call === 'object' &&
          !Array.isArray(call) &&
          call.jsonrpc === '2.0' &&
          Number.isSafeInteger(call.id) &&
          call.id >= 0 &&
          Object.keys(call).every((key) =>
            ['id', 'jsonrpc', 'method', 'params'].includes(key)
          ) &&
          Array.isArray(call.params) &&
          ((['eth_chainId', 'net_version', 'eth_blockNumber'].includes(
            call.method
          ) &&
            call.params.length === 0) ||
            (['eth_getBalance', 'eth_getTransactionCount'].includes(
              call.method
            ) &&
              call.params.length === 2 &&
              typeof call.params[0] === 'string' &&
              call.params[0].toLowerCase() === owner.toLowerCase() &&
              call.params[1] === 'latest'))
      );
    if (!valid) {
      denied.push({
        requestMethod: request.method(),
        path: url.pathname,
        hasQuery: Boolean(url.search),
        calls: calls.map((call: any) => ({
          method:
            typeof call?.method === 'string' ? call.method.slice(0, 80) : null,
          keys:
            call && typeof call === 'object' ? Object.keys(call).sort() : [],
          idType: typeof call?.id,
          params: Array.isArray(call?.params)
            ? call.params.map((value: unknown) =>
                typeof value === 'string' &&
                /^(?:0x[a-f0-9]{40}|latest|pending|earliest|0x[a-f0-9]{1,16})$/i.test(
                  value
                )
                  ? value
                  : typeof value === 'number' || typeof value === 'boolean'
                  ? value
                  : '[redacted]'
              )
            : null,
        })),
      });
      return route.abort('blockedbyclient');
    }
    reads.push(
      ...calls.map((call: any) => ({
        method: call.method,
        params: call.params,
      }))
    );
    // The ordinary explorer-history pagination hint probes this exact HD0's
    // latest nonce before fetch (transactions/evm.ts); the fixture owns a
    // synthetic zero-nonce account. No pending/foreign nonce or general call
    // is admitted. Only these five shapes reach the old method-only fixture.
    return route.fallback();
  });
  return { reads, denied };
}

const connectionTabTo = async (page: Page, target: Locator) => {
  await expect(target).toHaveCount(1);
  for (let count = 0; count < 32; count += 1) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
};

const inspectPermissionLabel = (label: Locator, expected: string) =>
  label.evaluate((node, value) => {
    if (node.textContent !== value)
      throw new Error('Unexpected permission label');
    const card = node.parentElement!.parentElement!;
    const panel = node.closest('[data-headlessui-state]')!;
    const box = (element: Element) => element.getBoundingClientRect().toJSON();
    const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const scrollOwners: any[] = [];
    for (let owner: Element | null = node; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner),
        r = owner.getBoundingClientRect();
      if (/^(auto|scroll|hidden|clip)$/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, r.left + owner.clientLeft);
        clip.right = Math.min(
          clip.right,
          r.left + owner.clientLeft + owner.clientWidth
        );
      }
      if (/^(auto|scroll|hidden|clip)$/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, r.top + owner.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          r.top + owner.clientTop + owner.clientHeight
        );
      }
      if (/auto|scroll/.test(css.overflowX + css.overflowY))
        scrollOwners.push({
          box: box(owner),
          clientWidth: owner.clientWidth,
          scrollWidth: owner.scrollWidth,
          clientHeight: owner.clientHeight,
          scrollHeight: owner.scrollHeight,
          scrollLeft: owner.scrollLeft,
          scrollTop: owner.scrollTop,
        });
    }
    const text = node.firstChild!;
    if (text.nodeType !== Node.TEXT_NODE)
      throw new Error('Permission label is not plain text');
    const glyphs = Array.from(value, (character, index) => {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const rect = range.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return {
        character,
        box: rect.toJSON(),
        centerHit: !!hit && node.contains(hit),
      };
    });
    return {
      text: node.textContent,
      viewport: { width: innerWidth, height: innerHeight },
      label: box(node),
      card: box(card),
      panel: box(panel),
      clip,
      glyphs,
      scrollOwners,
      font: getComputedStyle(node).font,
      title: node.getAttribute('title'),
      cardClientWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth,
      address: box(node.nextElementSibling!),
      controls: Array.from(panel.querySelectorAll('button')).map((button) => {
        const r = button.getBoundingClientRect(),
          hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2
          );
        return {
          name: button.getAttribute('aria-label') || button.textContent,
          disabled: button.disabled,
          box: r.toJSON(),
          centerHit: !!hit && button.contains(hit),
        };
      }),
    };
  }, expected);

async function revealPermissionLabel(
  page: Page,
  label: Locator,
  value: string
) {
  const wheels: unknown[] = [];
  const verticallyVisible = async () => {
    const geometry = await inspectPermissionLabel(label, value);
    return (
      geometry.label.top >= geometry.clip.top - 1 &&
      geometry.label.bottom <= geometry.clip.bottom + 1
    );
  };
  if (await verticallyVisible()) return wheels;
  const target = await label.evaluate((node) => {
    for (let owner = node.parentElement; owner; owner = owner.parentElement) {
      if (
        !/auto|scroll/.test(getComputedStyle(owner).overflowY) ||
        owner.scrollHeight <= owner.clientHeight
      )
        continue;
      const r = owner.getBoundingClientRect();
      const clip = {
        left: Math.max(0, r.left + owner.clientLeft),
        right: Math.min(
          innerWidth,
          r.left + owner.clientLeft + owner.clientWidth
        ),
        top: Math.max(0, r.top + owner.clientTop),
        bottom: Math.min(
          innerHeight,
          r.top + owner.clientTop + owner.clientHeight
        ),
      };
      const x = (clip.left + clip.right) / 2,
        y = (clip.top + clip.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, clip, actualOwnerHit: !!hit && owner.contains(hit) };
    }
    return null;
  });
  expect(target).not.toBeNull();
  expect(target!.actualOwnerHit).toBe(true);
  const geometry = await inspectPermissionLabel(label, value);
  const delta =
    geometry.label.top < geometry.clip.top
      ? Math.floor(geometry.label.top - geometry.clip.top - 2)
      : Math.ceil(geometry.label.bottom - geometry.clip.bottom + 2);
  await page.mouse.move(target!.x, target!.y);
  await page.mouse.wheel(0, delta);
  wheels.push({ ...target, delta });
  await expect.poll(verticallyVisible).toBe(true);
  return wheels;
}

async function connectionProxyDenial(
  server: Awaited<ReturnType<typeof startUtxoFixtureServer>>,
  method: 'GET' | 'CONNECT'
) {
  const proxy = new URL(server.url),
    before = server.blocked.length;
  expect(proxy.protocol).toBe('http:');
  expect(proxy.hostname).toBe('127.0.0.1');
  expect(proxy.port).toMatch(/^[0-9]+$/);
  const result = await new Promise<{
    connectionClosed: boolean;
    statusCode: number;
  }>((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: Number(proxy.port),
    });
    let bytes = Buffer.alloc(0),
      ended = false,
      settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(error);
      }
    };
    socket.setTimeout(2000, () =>
      fail(new Error('Physical connection proxy canary timed out'))
    );
    socket.once('error', fail);
    socket.once('connect', () =>
      socket.write(
        `${method} ${
          method === 'GET'
            ? 'http://connection-label-denied.invalid/'
            : 'connection-label-denied.invalid:443'
        } HTTP/1.0\r\nHost: connection-label-denied.invalid\r\nConnection: close\r\n\r\n`
      )
    );
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4096)
        fail(new Error('Physical canary response too large'));
    });
    socket.once('end', () => {
      ended = true;
    });
    socket.once('close', (hadError) => {
      if (settled) return;
      settled = true;
      try {
        expect(hadError).toBe(false);
        expect(ended).toBe(true);
        const text = bytes.toString('utf8'),
          separator = text.indexOf('\r\n\r\n');
        expect(separator).toBeGreaterThanOrEqual(0);
        expect(text.slice(0, separator).split('\r\n')[0]).toMatch(
          /^HTTP\/1\.[01] 403 Forbidden$/
        );
        expect(text.slice(0, separator)).toMatch(
          /\r\nConnection: close(?:\r\n|$)/i
        );
        expect(text.slice(separator + 4)).toBe(
          method === 'GET' ? 'Offline fixture only' : ''
        );
        resolve({ connectionClosed: true, statusCode: 403 });
      } catch (error) {
        reject(error);
      }
    });
  });
  expect(server.blocked.slice(before)).toEqual([method]);
  return { method, ...result };
}

test('Connected Sites keeps a foreign-family grant separate from the current account and permits its removal', async ({}, info) => {
  test.setTimeout(150_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  const testSourceSha256 = createHash('sha256')
    .update(fs.readFileSync(info.file))
    .digest('hex');
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const origin = new URL(server.url).origin;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'ConnectionFamilySyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let strict: Awaited<ReturnType<typeof strictConnectionRpc>> | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const pageErrors: string[] = [];
  const observations: Record<string, unknown> = {};
  try {
    observations.physicalCanaries = [
      await connectionProxyDenial(server, 'GET'),
      await connectionProxyDenial(server, 'CONNECT'),
    ];
    wallet = await PaliWallet.launch('connected-sites-family-attribution', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    strict = await strictConnectionRpc(wallet.context, fixture.evmAddresses[0]);
    wallet.page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.on('page', (newPage) =>
      newPage.on('pageerror', (error) => pageErrors.push(error.message))
    );
    observations.workerIdentity = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerIdentity = identity;
      }
    );
    const page = wallet.page;
    const openConnectedSites = async () => {
      await expect(page).toHaveURL(/#\/home$/);
      await page
        .getByRole('button', { name: en.settings.connectedSites, exact: true })
        .click();
      await expect(page).toHaveURL(/#\/settings\/networks\/connected-sites$/);
      await expect(page.getByTitle(origin, { exact: true })).toBeVisible();
    };
    const openReview = async () => {
      const row = page.getByRole('listitem').filter({
        has: page.getByTitle(origin, { exact: true }),
      });
      await expect(row.getByRole('button')).toHaveAccessibleName(
        `${en.settings.editConnection}: ${origin}`
      );
      await page
        .getByRole('button', {
          name: `${en.settings.editConnection}: ${origin}`,
          exact: true,
        })
        .click();
      const review = page.getByRole('dialog', {
        name: en.settings.editConnection,
        exact: true,
      });
      await expect(review).toBeVisible();
      return review;
    };
    await wallet.step('open the disposable EVM wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
      await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await expect(page).toHaveURL(/#\/home$/);
    });
    const dapp = await wallet.context.newPage();
    await dapp.goto(origin);
    await dapp.waitForFunction(() => Boolean((window as any).pali));
    let originalAddress = '';
    let original!: Awaited<ReturnType<typeof publicConnectionState>>;
    await wallet.step(
      'approve the synthetic EVM dapp connection',
      async (capture) => {
        const id = await startRequest(dapp, 'eth_requestAccounts');
        const popup = await popupFor(wallet!.context, dapp, id);
        try {
          const response = await approve(wallet!.context, dapp, id, capture);
          expect(response.result).toHaveLength(1);
          originalAddress = response.result[0];
        } finally {
          if (!popup.isClosed()) await capture(popup);
        }
        await expect
          .poll(
            async () => (await publicConnectionState(page, origin)).savedGrant
          )
          .not.toBeNull();
        original = await publicConnectionState(page, origin);
        expect(original.network.kind).toBe('ethereum');
        expect(original.account.address.toLowerCase()).toBe(
          originalAddress.toLowerCase()
        );
        expect(original.liveGrant).toEqual(original.savedGrant);
        expect(original.liveGrant).toMatchObject({
          host: origin,
          accountId: original.account.id,
          accountType: original.account.type,
          chain: 'ethereum',
        });
        observations.original = original;
      }
    );
    await wallet.step(
      'inspect the healthy same-family permission and close to Home',
      async () => {
        await openConnectedSites();
        const review = await openReview();
        await expect(
          review.getByText(ellipsis(original.account.address), { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText(original.account.label, { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText(en.settings.unavailable, { exact: true })
        ).toHaveCount(0);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          originalAddress,
        ]);
        await review
          .locator('footer')
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(review).toHaveCount(0);
        await page
          .locator('[data-page-action-footer]')
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
      }
    );
    await wallet.step(
      'save and review ordinary same-account labels without changing the grant',
      async () => {
        const baseline = await connectionLabelScope(page);
        expect(baseline.liveAccounts).toEqual(baseline.savedAccounts);
        expect(baseline.liveAssets).toEqual(baseline.savedAssets);
        expect(baseline.liveGrants).toEqual(baseline.savedGrants);
        expect(baseline.liveGrants).toHaveLength(1);
        expect(baseline.liveGrants[0]).toMatchObject({
          host: origin,
          accountId: original.account.id,
          accountType: original.account.type,
          chain: 'ethereum',
        });
        expect(baseline).toMatchObject({
          active: { id: original.account.id, type: original.account.type },
          savedActive: { id: original.account.id, type: original.account.type },
          network: {
            kind: 'ethereum',
            chainId: 5700,
            url: 'https://rpc.tanenbaum.io',
          },
          slip44: 60,
        });
        observations.labelBaseline = baseline;
        const withLabel = (label: string) => ({
          ...baseline,
          liveAccounts: baseline.liveAccounts.map((a) =>
            a.kind === original.account.type && a.id === original.account.id
              ? { ...a, label }
              : a
          ),
          savedAccounts: baseline.savedAccounts.map((a) =>
            a.kind === original.account.type && a.id === original.account.id
              ? { ...a, label }
              : a
          ),
        });
        const rename = async (label: string) => {
          await expect(page).toHaveURL(/#\/home$/);
          await page
            .getByRole('button', { name: en.buttons.edit, exact: true })
            .click();
          await expect(page).toHaveURL(/#\/settings\/edit-account$/);
          await page
            .getByPlaceholder(en.settings.accountLabel, { exact: true })
            .fill(label);
          const save = page.getByRole('button', {
            name: en.buttons.save,
            exact: true,
          });
          await expect(save).toBeEnabled();
          await connectionTabTo(page, save);
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/#\/home$/);
          await expect
            .poll(() => connectionLabelScope(page))
            .toEqual(withLabel(label));
          expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
            originalAddress,
          ]);
          // Observe the ordinary 2s success-toast lifecycle on the real wallet
          // document; do not measure/capture text underneath an active notice.
          await page.bringToFront();
          await expect(
            page.getByText(en.settings.accountLabelEditedSuccessfully, {
              exact: true,
            })
          ).toHaveCount(0);
        };
        const measurements: any[] = [];
        observations.permissionLabelMeasurements = measurements;
        for (const label of ['Daily', 'A'.repeat(64)]) {
          await rename(label);
          for (const viewport of [
            { width: 400, height: 620 },
            { width: 320, height: 360 },
          ]) {
            const caseName =
              (label === 'Daily' ? 'short' : 'long64') +
              '-' +
              viewport.width +
              'x' +
              viewport.height;
            await wallet!.step(
              caseName + ': inspect the actual same-family permission card',
              async (capture) => {
                await page.setViewportSize(viewport);
                await openConnectedSites();
                const review = await openReview();
                const accountLabel = review.getByText(label, { exact: true });
                await expect(accountLabel).toHaveCount(1);
                await expect(accountLabel).toBeVisible();
                await expect(
                  review.getByText(ellipsis(original.account.address), {
                    exact: true,
                  })
                ).toBeVisible();
                await expect(
                  review.getByText(en.settings.unavailable, { exact: true })
                ).toHaveCount(0);
                await expect(
                  review.getByRole('button', {
                    name: en.settings.deleteConnected,
                    exact: true,
                  })
                ).toBeEnabled();
                await page.evaluate(async () => {
                  await document.fonts.ready;
                  await new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve())
                    )
                  );
                });
                await expect
                  .poll(() =>
                    accountLabel.evaluate((node) => {
                      for (
                        let owner: Element | null = node;
                        owner;
                        owner = owner.parentElement
                      ) {
                        if (
                          owner
                            .getAnimations()
                            .some(
                              (animation) =>
                                !['finished', 'idle'].includes(
                                  animation.playState
                                )
                            )
                        )
                          return false;
                      }
                      return true;
                    })
                  )
                  .toBe(true);
                const wheels = await revealPermissionLabel(
                  page,
                  accountLabel,
                  label
                );
                const geometry = await inspectPermissionLabel(
                  accountLabel,
                  label
                );
                if (label === 'Daily') {
                  expect(
                    geometry.glyphs.every(
                      ({ box, centerHit }) =>
                        centerHit &&
                        box.left >= geometry.clip.left - 1 &&
                        box.right <= geometry.clip.right + 1 &&
                        box.top >= geometry.clip.top - 1 &&
                        box.bottom <= geometry.clip.bottom + 1
                    )
                  ).toBe(true);
                  expect(geometry.cardScrollWidth).toBeLessThanOrEqual(
                    geometry.cardClientWidth + 1
                  );
                }
                measurements.push({
                  caseName,
                  label,
                  viewport,
                  wheels,
                  geometry,
                });
                expect(await connectionLabelScope(page)).toEqual(
                  withLabel(label)
                );
                expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
                  originalAddress,
                ]);
                await capture(page);
                if (caseName === 'short-400x620')
                  await page.keyboard.press('Escape');
                else {
                  const close = review
                    .locator(label === 'Daily' ? 'footer' : 'header')
                    .getByRole('button', {
                      name: en.buttons.close,
                      exact: true,
                    });
                  await connectionTabTo(page, close);
                  await page.keyboard.press('Enter');
                }
                await expect(review).toHaveCount(0);
                const edit = page.getByRole('button', {
                  name: en.settings.editConnection + ': ' + origin,
                  exact: true,
                });
                await expect(edit).toBeFocused();
                expect(await connectionLabelScope(page)).toEqual(
                  withLabel(label)
                );
                const closePage = page
                  .locator('[data-page-action-footer]')
                  .getByRole('button', { name: en.buttons.close, exact: true });
                await connectionTabTo(page, closePage);
                await page.keyboard.press('Enter');
                await expect(page).toHaveURL(/#\/home$/);
              }
            );
          }
        }
        expect(measurements).toHaveLength(4);
        // Restore the original carrier's viewport before its unchanged
        // cross-family attribution and durable-removal controls.
        await page.setViewportSize({ width: 400, height: 620 });
        await rename(original.account.label);
        expect(await connectionLabelScope(page)).toEqual(baseline);
        expect(await publicConnectionState(page, origin)).toEqual(original);
        await page.reload();
        await wallet!.waitAppReady();
        await wallet!.ensureOnHome();
        expect(await connectionLabelScope(page)).toEqual(baseline);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([
          originalAddress,
        ]);
        observations.afterLabelRestoreAndReload = await connectionLabelScope(
          page
        );
      }
    );
    const currentLabel = 'Current UTXO account';
    let switched!: Awaited<ReturnType<typeof publicConnectionState>>;
    await wallet.step(
      'switch through Home to UTXO and label its distinct current account',
      async () => {
        await wallet!.switchNetwork('Syscoin Testnet', 'UTXO');
        await page
          .getByRole('button', { name: en.buttons.edit, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/settings\/edit-account$/);
        await page
          .getByPlaceholder(en.settings.accountLabel, { exact: true })
          .fill(currentLabel);
        await page
          .getByRole('button', { name: en.buttons.save, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        switched = await publicConnectionState(page, origin);
        expect(switched.network.kind).toBe('syscoin');
        expect(switched.account.address).not.toBe(originalAddress);
        expect(switched.account.label).toBe(currentLabel);
        expect(switched.account.id).toBe(original.account.id);
        expect(switched.account.type).toBe(original.account.type);
        expect(switched.liveGrant).toEqual(original.liveGrant);
        expect(switched.savedGrant).toEqual(original.savedGrant);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        observations.switched = switched;
      }
    );
    await wallet.step(
      'review the retained EVM grant without attributing the UTXO account',
      async (capture) => {
        await openConnectedSites();
        await expect(
          page.getByText(`Connected to: Account ${original.account.id + 1}`, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          page.getByText(`Connected to: ${currentLabel}`, { exact: true })
        ).toHaveCount(0);
        const review = await openReview();
        await expect(review.getByText(origin, { exact: true })).toBeVisible();
        await expect(review.getByText('EVM', { exact: true })).toBeVisible();
        await expect(review.getByText('UTXO', { exact: true })).toHaveCount(0);
        await expect(
          review.getByText(en.settings.unavailable, { exact: true })
        ).toBeVisible();
        await expect(
          review.getByText(`Account ${original.account.id + 1}`, {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          review.getByText(currentLabel, { exact: true })
        ).toHaveCount(0);
        await expect(
          review.getByText(ellipsis(switched.account.address), { exact: true })
        ).toHaveCount(0);
        await expect(
          review.getByText(ellipsis(originalAddress), { exact: true })
        ).toHaveCount(0);
        await expect(
          review.getByRole('button', {
            name: en.settings.deleteConnected,
            exact: true,
          })
        ).toBeEnabled();
        expect(await publicConnectionState(page, origin)).toEqual(switched);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        await capture(page);
        await info.attach('foreign-evm-grant-modal', {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        observations.foreignReview = {
          badge: 'EVM',
          account: `Account ${original.account.id + 1}`,
          address: en.settings.unavailable,
          wrongFamilyLabelAbsent: true,
          wrongFamilyAddressAbsent: true,
          providerAccounts: [],
        };
      }
    );
    await wallet.step(
      'remove the foreign grant through its native control and verify durable removal',
      async () => {
        await page
          .getByRole('dialog', {
            name: en.settings.editConnection,
            exact: true,
          })
          .getByRole('button', {
            name: en.settings.deleteConnected,
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByTitle(origin, { exact: true })).toHaveCount(0);
        await expect(
          page.getByText(en.settings.connectedSiteCount_zero, {
            exact: true,
          })
        ).toBeVisible();
        await expect
          .poll(async () => {
            const state = await publicConnectionState(page, origin);
            return { liveGrant: state.liveGrant, savedGrant: state.savedGrant };
          })
          .toEqual({ liveGrant: null, savedGrant: null });
        const removed = await publicConnectionState(page, origin);
        expect(removed.account).toEqual(switched.account);
        expect(removed.network).toEqual(switched.network);
        expect(await providerRequest(dapp, 'eth_accounts')).toEqual([]);
        observations.removed = removed;
      }
    );
    observations.workerAfter = await verifyExecutingWorker(
      wallet.context,
      wallet.extensionId,
      E2E_CONFIG.extensionPath,
      (identity) => {
        observations.workerAfter = identity;
      }
    );
    expect(strict!.denied).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(server.blocked.slice(0, 2)).toEqual(['GET', 'CONNECT']);
    expect(
      server.blocked.every((method) => method === 'GET' || method === 'CONNECT')
    ).toBe(true);
    expect(routes.deniedWrites).toEqual([]);
    expect(extensionEvidence()).toEqual(runtime);
    expect(
      createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
    ).toBe(testSourceSha256);
    await wallet.step(
      'ordinary long account labels stay inside the Permissions card after all original scope controls',
      async () => {
        const measurements = observations.permissionLabelMeasurements as any[];
        expect(measurements).toHaveLength(4);
        for (const measurement of measurements) {
          const geometry = measurement.geometry;
          expect(
            geometry.glyphs.every(
              ({ box, centerHit }: any) =>
                centerHit &&
                box.left >= geometry.clip.left - 1 &&
                box.right <= geometry.clip.right + 1 &&
                box.top >= geometry.clip.top - 1 &&
                box.bottom <= geometry.clip.bottom + 1
            ),
            measurement.caseName
          ).toBe(true);
          expect(
            geometry.cardScrollWidth,
            measurement.caseName
          ).toBeLessThanOrEqual(geometry.cardClientWidth + 1);
        }
      }
    );
    status = 'passed';
  } finally {
    try {
      await info.attach('connected-sites-family-attribution-evidence', {
        body: JSON.stringify(
          {
            status,
            runtime,
            testSourceSha256,
            origin,
            observations,
            strictRpc: strict,
            pageErrors,
            reads: routes?.reads ?? [],
            deniedWrites: routes?.deniedWrites ?? [],
            proxyDeniedMethods: server.blocked.slice(),
            syntheticHttpOnly: true,
            externalHttpRequestsFulfilled: 0,
            controllerOrApiReplaced: false,
            signaturesOrBroadcastsRequested: false,
          },
          null,
          2
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      status = 'failed';
      throw error;
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
  }
});
