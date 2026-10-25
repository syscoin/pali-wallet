import { expect, test, type Page } from '@playwright/test';
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

// Normal provider requests preserve origin identity and readable layout.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const LONG_ORIGIN = `https://${'account-review-'.repeat(
  4
)}qa.synthetic.invalid`;
const UNBROKEN_ORIGIN = `https://${'a'.repeat(63)}.synthetic.invalid`;

async function settleNativeScroll(page: Page) {
  let previous = '',
    stable = 0;
  await expect
    .poll(
      async () => {
        const geometry = await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter(
              (node) =>
                node.scrollHeight > node.clientHeight + 1 &&
                /auto|scroll/.test(getComputedStyle(node).overflowY)
            )
            .map((node) => {
              const r = node.getBoundingClientRect();
              return [node.scrollTop, r.y, r.height];
            })
        );
        const value = JSON.stringify(geometry);
        stable = value === previous ? stable + 1 : 0;
        previous = value;
        return stable;
      },
      { intervals: [50], timeout: 2000 }
    )
    .toBeGreaterThanOrEqual(3);
}

test('connection and account-switch approvals keep complete origins and uncompressed icons', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const runtime = extensionEvidence();
  expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
  expect(
    new URL(LONG_ORIGIN).hostname
      .split('.')
      .every((label) => label.length <= 63)
  ).toBe(true);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'OriginObservationSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  const records: unknown[] = [];
  const pageErrors: string[] = [];
  const forbiddenWrites: string[] = [];
  const publicSelection = async () =>
    wallet!.page.evaluate(async () => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const ref = state.vault.activeAccount;
      const account = state.vault.accounts[ref.type][ref.id];
      return {
        active: { id: account.id, type: ref.type, address: account.address },
        network: {
          kind: state.vault.activeNetwork.kind,
          chainId: state.vault.activeNetwork.chainId,
        },
        switching: state.vaultGlobal.isSwitchingAccount,
        accounts: Object.values(state.vault.accounts.HDAccount).map(
          (row: any) => ({
            id: row.id,
            address: row.address,
            label: row.label,
          })
        ),
      };
    });
  const select = async (id: number) => {
    await wallet!.ensureOnHome();
    const state = await publicSelection();
    const account = state.accounts.find((row) => row.id === id)!;
    if (state.active.id !== id) {
      await wallet!.page
        .locator('#general-settings-button')
        .locator('..')
        .click();
      await wallet!.page
        .getByRole('menuitem', {
          name: `${account.label} (${account.address})`,
          exact: true,
        })
        .click();
    }
    await expect.poll(publicSelection).toMatchObject({
      active: { id, address: account.address },
      switching: false,
    });
    return account;
  };
  try {
    wallet = await PaliWallet.launch('account-origin-observation', {
      offlineHttpProxy: server.url,
      recordVideo: false,
      viewport: { width: 400, height: 620 },
    });
    const listen = (page: Page) =>
      page.on('pageerror', (error) => pageErrors.push(error.message));
    wallet.context.pages().forEach(listen);
    wallet.context.on('page', listen);
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    // The same public inert fixture document is served under a long origin.
    // This exact loopback GET neither enters the browser nor weakens its proxy.
    const documentBody = await new Promise<string>((resolve, reject) => {
      const request = http.get(`${server.url}/`, (response) => {
        if (
          response.statusCode !== 200 ||
          !response.headers['content-type']?.includes('text/html')
        ) {
          response.resume();
          reject(new Error('Local inert fixture document unavailable'));
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
    for (const origin of [LONG_ORIGIN, UNBROKEN_ORIGIN]) {
      await wallet.context.route(`${origin}/`, async (route) => {
        expect(route.request().method()).toBe('GET');
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: documentBody,
        });
      });
    }
    await wallet.context.route('**/*', async (route) => {
      const request = route.request();
      let payload: any;
      try {
        payload = request.postDataJSON();
      } catch {
        /* Exact document and read-only GETs use lower fences. */
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (
        /\/sendtx(?:\/|$)/i.test(request.url()) ||
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      ) {
        forbiddenWrites.push(request.url());
        return route.abort('blockedbyclient');
      }
      return route.fallback();
    });
    await wallet.step(
      'onboard and create two real disposable EVM accounts',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/account/new');
        await wallet!.page
          .locator('#account-name-input')
          .fill('Other origin-review account');
        await wallet!.page.locator('#create-btn').click();
        await wallet!.page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await expect
          .poll(publicSelection)
          .toMatchObject({ active: { id: 1 }, switching: false });
      }
    );
    for (const [kind, origin] of [
      ['short', server.url],
      ['long', LONG_ORIGIN],
      ['unbroken', UNBROKEN_ORIGIN],
    ] as const) {
      const required = await wallet.step(
        `${kind} origin selects the account to connect`,
        () => select(0)
      );
      const dapp = await wallet.step(
        `${kind} origin connects the real provider to account zero`,
        async (capture) => {
          const page = await wallet!.context.newPage();
          await page.goto(`${origin}/`);
          await page.waitForFunction(() =>
            Boolean((window as any).pali?.request)
          );
          const id = await startRequest(page, 'eth_requestAccounts');
          const result = await approve(
            wallet!.context,
            page,
            id,
            async (popup) => {
              // The initial account picker has a different header from the later
              // required-account approval. Qualify both through the real request.
              if ((await popup.getByRole('dialog').count()) === 0) {
                for (const viewport of [
                  { width: 400, height: 620 },
                  { width: 320, height: 360 },
                ]) {
                  await popup.setViewportSize(viewport);
                  const host = popup.getByText(origin, { exact: true });
                  await expect(host).toBeVisible();
                  const read = () =>
                    host.evaluate((element) => {
                      const range = document.createRange();
                      range.selectNodeContents(element);
                      const lines = [...range.getClientRects()];
                      const icon =
                        element.previousElementSibling!.getBoundingClientRect();
                      const last = lines[lines.length - 1];
                      const footer = document
                        .querySelector('[data-connection-actions]')!
                        .getBoundingClientRect();
                      const hit =
                        last &&
                        document.elementFromPoint(
                          last.left + last.width / 2,
                          last.top + last.height / 2
                        );
                      return {
                        text: element.textContent,
                        icon: { width: icon.width, height: icon.height },
                        lines: lines.map((line) => ({
                          left: line.left,
                          right: line.right,
                          top: line.top,
                          bottom: line.bottom,
                        })),
                        horizontallyContained: lines.every(
                          (line) => line.left >= 0 && line.right <= innerWidth
                        ),
                        tailExposed: Boolean(
                          last &&
                            last.top >= 68 &&
                            last.bottom <= footer.top &&
                            hit &&
                            (hit === element || element.contains(hit))
                        ),
                      };
                    });
                  await popup.mouse.move(0, 0);
                  const initial = await read();
                  expect(initial.text).toBe(origin);
                  expect(initial.icon).toEqual({ width: 32, height: 32 });
                  expect(initial.horizontallyContained).toBe(true);
                  await info.attach(
                    `connect-origin-${kind}-${viewport.width}`,
                    {
                      body: await popup.screenshot({ animations: 'disabled' }),
                      contentType: 'image/png',
                    }
                  );
                  let tail = initial;
                  for (let step = 0; step < 12 && !tail.tailExposed; step++) {
                    await popup.mouse.move(viewport.width - 30, 190);
                    await popup.mouse.wheel(0, 100);
                    await popup.evaluate(
                      () =>
                        new Promise((resolve) =>
                          requestAnimationFrame(() =>
                            requestAnimationFrame(resolve)
                          )
                        )
                    );
                    tail = await read();
                  }
                  expect(tail.tailExposed).toBe(true);
                  expect(tail.text).toBe(origin);
                  expect((await rpcObservation(page, id)).settled).not.toBe(
                    true
                  );
                  records.push({
                    phase: 'initial-connect',
                    kind,
                    origin,
                    viewport,
                    initial,
                    tail,
                  });
                  await popup.mouse.move(0, 0);
                  await info.attach(
                    `connect-origin-${kind}-${viewport.width}-tail`,
                    {
                      body: await popup.screenshot({ animations: 'disabled' }),
                      contentType: 'image/png',
                    }
                  );
                }
              }
              await capture(popup);
            }
          );
          expect(result.error).toBeUndefined();
          expect(
            result.result.map((value: string) => value.toLowerCase())
          ).toEqual([required.address.toLowerCase()]);
          return page;
        }
      );
      const original = await wallet.step(
        `${kind} origin selects the other account before its request`,
        async () => {
          await select(1);
          return publicSelection();
        }
      );
      await wallet.step(
        `${kind} origin reviews its normal required-account request and cancels`,
        async () => {
          const id = await startRequest(dapp, 'personal_sign', [
            '0x6f726967696e2d726576696577',
            required.address,
          ]);
          const popup = await popupFor(wallet!.context, dapp, id);
          expect(new URL(popup.url()).pathname).toBe(
            '/external/change-active-connected-account'
          );
          const data = JSON.parse(
            new URL(popup.url()).searchParams.get('data')!
          );
          expect(data.host).toBe(new URL(dapp.url()).origin);
          expect(data.connectedAccount.address.toLowerCase()).toBe(
            required.address.toLowerCase()
          );
          expect((await rpcObservation(dapp, id)).settled).not.toBe(true);
          const host = popup.getByText(origin, { exact: true });
          await expect(host).toBeVisible();
          for (const viewport of [
            { width: 400, height: 620 },
            { width: 320, height: 360 },
          ]) {
            await popup.setViewportSize(viewport);
            await popup.mouse.move(viewport.width / 2, 100);
            await popup.mouse.wheel(0, -1200);
            // Let native wheel/layout delivery complete; do not alter layout or focus.
            await settleNativeScroll(popup);
            const observation = await host.evaluate((element) => {
              const rect = (box: DOMRect) => ({
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                right: box.right,
                bottom: box.bottom,
              });
              const range = document.createRange();
              range.selectNodeContents(element);
              const lines = [...range.getClientRects()].map(rect);
              const icon = element.parentElement!.firstElementChild!;
              return {
                text: element.textContent,
                viewport: { width: innerWidth, height: innerHeight },
                host: rect(element.getBoundingClientRect()),
                icon: rect(icon.getBoundingClientRect()),
                lines,
                allTextInsideViewport: lines.every(
                  (line) => line.x >= 0 && line.right <= innerWidth
                ),
                documentWidth: document.documentElement.scrollWidth,
              };
            });
            records.push({ kind, origin, ...observation });
            await info.attach(`account-origin-${kind}-${viewport.width}`, {
              body: await popup.screenshot({ animations: 'disabled' }),
              contentType: 'image/png',
            });
            expect(observation.allTextInsideViewport).toBe(true);
            expect(observation.icon.width).toBe(32);
            expect(observation.icon.height).toBe(32);
            expect((await rpcObservation(dapp, id)).settled).not.toBe(true);
            expect(await publicSelection()).toEqual(original);
            if (viewport.width === 320) {
              // The complete host need not fit at once. Its final line must be
              // reachable with ordinary wheel input above the action footer.
              await expect(
                popup.locator('[data-page-action-footer]')
              ).toHaveCount(1);
              const readTail = () =>
                host.evaluate((element) => {
                  const range = document.createRange();
                  range.selectNodeContents(element);
                  const fragments = [...range.getClientRects()];
                  const last = fragments[fragments.length - 1];
                  const footer = document.querySelector(
                    '[data-page-action-footer]'
                  )!;
                  const footerTop = footer.getBoundingClientRect().top;
                  let visibleTop = 0;
                  let visibleBottom = Math.min(innerHeight, footerTop);
                  for (
                    let parent = element.parentElement;
                    parent;
                    parent = parent.parentElement
                  ) {
                    if (
                      /^(auto|scroll|hidden|clip|overlay)$/.test(
                        getComputedStyle(parent).overflowY
                      )
                    ) {
                      const bounds = parent.getBoundingClientRect();
                      visibleTop = Math.max(visibleTop, bounds.top);
                      visibleBottom = Math.min(visibleBottom, bounds.bottom);
                    }
                  }
                  const centerX = last ? last.left + last.width / 2 : -1;
                  const centerY = last ? last.top + last.height / 2 : -1;
                  const hit = document.elementFromPoint(centerX, centerY);
                  return {
                    text: element.textContent,
                    footerTop,
                    visibleTop,
                    visibleBottom,
                    last: last
                      ? {
                          left: last.left,
                          top: last.top,
                          right: last.right,
                          bottom: last.bottom,
                          width: last.width,
                          height: last.height,
                        }
                      : null,
                    visible: Boolean(
                      last &&
                        last.left >= 0 &&
                        last.right <= innerWidth &&
                        last.top >= visibleTop &&
                        last.bottom <= visibleBottom &&
                        hit &&
                        (hit === element || element.contains(hit))
                    ),
                  };
                });
              let tail = await readTail();
              const wheelDeltas: number[] = [];
              for (let attempt = 0; attempt < 6 && !tail.visible; attempt++) {
                expect(tail.last).not.toBeNull();
                await popup.mouse.move(
                  viewport.width / 2,
                  Math.max(
                    5,
                    Math.min(tail.visibleBottom - 20, tail.visibleTop + 80)
                  )
                );
                const delta =
                  tail.last!.bottom > tail.visibleBottom
                    ? Math.min(200, tail.last!.bottom - tail.visibleBottom + 12)
                    : -Math.min(200, tail.visibleTop - tail.last!.top + 12);
                wheelDeltas.push(delta);
                await popup.mouse.wheel(0, delta);
                await settleNativeScroll(popup);
                tail = await readTail();
              }
              expect(tail.text).toBe(origin);
              expect(tail.last).not.toBeNull();
              expect(tail.visible).toBe(true);
              expect(tail.last!.bottom).toBeLessThanOrEqual(tail.footerTop);
              expect((await rpcObservation(dapp, id)).settled).not.toBe(true);
              expect(await publicSelection()).toEqual(original);
              records.push({
                kind,
                origin,
                viewport,
                phase: 'last-line-revealed',
                wheelDeltas,
                ...tail,
              });
              await info.attach(`account-origin-${kind}-320-last-line`, {
                body: await popup.screenshot({ animations: 'disabled' }),
                contentType: 'image/png',
              });
            }
          }
          const result = await dismissRejectedApproval({
            click: () =>
              popup
                .getByRole('button', { name: en.buttons.cancel, exact: true })
                .click(),
            isClosed: () => popup.isClosed(),
            settle: () => settle(dapp, id),
          });
          expect(result.error?.code).toBe(4100);
          expect(result.result).toBeUndefined();
          expect(await publicSelection()).toEqual(original);
        }
      );
      await dapp.close();
    }
    expect(routes.deniedWrites).toEqual([]);
    expect(forbiddenWrites).toEqual([]);
    expect(pageErrors).toEqual([]);
    status = 'passed';
  } finally {
    await info.attach('account-origin-observation-evidence', {
      body: JSON.stringify({
        runtime,
        status,

        controllerStateReplaced: false,
        controllerResultsReplaced: false,
        directPopupRoute: false,
        records,
        deniedWrites: routes?.deniedWrites,
        forbiddenWrites,
        pageErrors,
      }),
      contentType: 'application/json',
    });
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
