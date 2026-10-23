import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { getAddress } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const NETWORK = 'Syscoin NEVM Testnet';
const RPC = 'https://rpc.tanenbaum.io/';
const BANNER = en.faucet.grabTextTwo.replace('{{token}}', 'TSYS');
const FIRST_ACCESS = en.faucet.firstAccessTitle
  .replace('{{token}}', 'TSYS')
  .replace('{{network}}', NETWORK);

const publicState = (page: Page) =>
  page.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({
      type: 'getCurrentState',
    });
    const { activeAccount, activeNetwork, accounts } = current.vault;
    const account = accounts[activeAccount.type][activeAccount.id];
    return {
      account: {
        ...activeAccount,
        address: account.address,
        label: account.label,
      },
      balance: account.balances?.ethereum,
      chainId: activeNetwork.chainId,
      kind: activeNetwork.kind,
      url: activeNetwork.url,
      status: current.vaultGlobal.networkStatus,
      loading: current.vaultGlobal.isPostNetworkSwitchLoading,
      switching: current.vaultGlobal.isSwitchingAccount,
      firstAccess: Boolean(
        current.vault.shouldShowFaucetModal?.[activeNetwork.chainId]
      ),
    };
  });

async function tabTo(page: Page, target: Locator) {
  for (
    let index = 0;
    index < 32 &&
    !(await target.evaluate((element) => element === document.activeElement));
    index++
  )
    await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

// Observation only: preserve the actual viewport, nested clips and text extents.
async function geometry(target: Locator) {
  return target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(element);
    const textBounds = text.getBoundingClientRect();
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
    const footers = Array.from(
      document.querySelectorAll('[data-page-action-footer]')
    ).flatMap((footer) => {
      if (footer.contains(element)) return [];
      const style = getComputedStyle(footer);
      const box = footer.getBoundingClientRect();
      if (
        !['sticky', 'fixed'].includes(style.position) ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        box.width <= 0 ||
        box.height <= 0 ||
        box.bottom <= clip.top ||
        box.top >= clip.bottom ||
        box.right <= Math.max(bounds.left, clip.left) ||
        box.left >= Math.min(bounds.right, clip.right)
      )
        return [];
      // Its own action is not hidden by its ancestor footer. Other content
      // must be exposed above this visible sticky/fixed overlay.
      clip.bottom = Math.min(clip.bottom, box.top);
      return [{ bounds: box.toJSON(), position: style.position }];
    });
    const horizontal =
      bounds.width > 0 &&
      bounds.left >= clip.left - 0.5 &&
      bounds.right <= clip.right + 0.5;
    const vertical =
      bounds.height > 0 &&
      bounds.top >= clip.top - 0.5 &&
      bounds.bottom <= clip.bottom + 0.5;
    const textContained =
      textBounds.left >= clip.left - 0.5 &&
      textBounds.right <= clip.right + 0.5 &&
      textBounds.top >= clip.top - 0.5 &&
      textBounds.bottom <= clip.bottom + 0.5;
    const points = [
      [bounds.left + 2, bounds.top + bounds.height / 2],
      [bounds.right - 2, bounds.top + bounds.height / 2],
      [bounds.left + bounds.width / 2, bounds.top + 2],
      [bounds.left + bounds.width / 2, bounds.bottom - 2],
    ];
    const hit = points.every(([x, y]) => {
      const node = document.elementFromPoint(x, y);
      return node && (node === element || element.contains(node));
    });
    return {
      bounds: bounds.toJSON(),
      textBounds: textBounds.toJSON(),
      clip,
      footers,
      horizontal,
      vertical,
      textContained,
      hit,
    };
  });
}

async function revealCard(page: Page, card: Locator) {
  await card.evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    await Promise.all(
      (element.closest('.page-content') || element)
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime)
        )
        .map((animation) => animation.finished.catch(() => undefined))
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  // A horizontal failure is only observed, never repaired by DOM/style writes.
  for (let attempt = 0; attempt < 24; attempt++) {
    const observed = await geometry(card);
    if (observed.vertical) return;
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 8, viewport.height / 2);
    await page.mouse.wheel(
      0,
      observed.bounds.top < observed.clip.top ? -180 : 180
    );
    await page.waitForTimeout(100);
  }
}

test('faucet account identity fits a narrow viewport and remains keyboard-reopenable', async ({}, info) => {
  test.setTimeout(120_000);
  expect(info.config.workers).toBe(1);
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
  let server: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: Record<string, unknown> = {};
  const zeroBalanceReads: Array<{ address: string; block: string }> = [];
  const deniedBalanceReads: unknown[] = [];
  const forbiddenRequests: string[] = [];
  try {
    server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'FaucetLayoutSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('faucet-account-layout', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    wallet.context.on('request', (request) => {
      let body: any;
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
      const calls = Array.isArray(body) ? body : [body];
      if (
        new URL(request.url()).pathname.startsWith('/api/faucet/claim') ||
        calls.some((call) =>
          /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction)/i.test(
            call?.method || ''
          )
        )
      )
        forbiddenRequests.push(request.url());
    });
    // Same exact zero-balance HTTP fixture as faucetReopenKeyboard; no controller replacement.
    await wallet.context.route(RPC, async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        return route.fallback();
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (!calls.some((call) => call?.method === 'eth_getBalance'))
        return route.fallback();
      const replies = calls.map((call) => {
        if (
          route.request().method() !== 'POST' ||
          call?.jsonrpc !== '2.0' ||
          call.method !== 'eth_getBalance' ||
          !Array.isArray(call.params) ||
          call.params.length !== 2 ||
          !fixture.evmAddresses.some(
            (address) =>
              address.toLowerCase() === String(call.params[0]).toLowerCase()
          ) ||
          call.params[1] !== 'latest'
        )
          return undefined;
        zeroBalanceReads.push({
          address: call.params[0],
          block: call.params[1],
        });
        return { jsonrpc: '2.0', id: call.id, result: '0x0' };
      });
      if (!calls.length || replies.some((reply) => !reply)) {
        deniedBalanceReads.push(payload);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const banner = page.getByRole('button', { name: BANNER, exact: true });
    const prompt = page.getByRole('dialog', {
      name: FIRST_ACCESS,
      exact: true,
    });
    const back = page.getByRole('button', {
      name: en.buttons.back,
      exact: true,
    });
    const requestNow = page.getByRole('button', {
      name: en.faucet.requestNow,
      exact: true,
    });
    await wallet.step(
      'prepare the real zero-balance faucet without requesting tokens',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await page
          .getByRole('button')
          .filter({ hasText: /UTXO|EVM/ })
          .first()
          .click();
        const menu = page.getByRole('menu');
        const evm = menu
          .getByRole('menuitem', { name: /EVM Networks/i })
          .first();
        if ((await evm.getAttribute('aria-expanded')) !== 'true')
          await evm.click();
        await menu
          .getByRole('menuitem', { name: NETWORK, exact: true })
          .click();
        await expect(prompt).toBeVisible();
        await prompt
          .getByRole('button', { name: en.buttons.close, exact: true })
          .click();
        await expect(prompt).toHaveCount(0);
        await expect(banner).toBeEnabled();
        await expect
          .poll(() => publicState(page))
          .toMatchObject({
            chainId: 5700,
            kind: 'ethereum',
            url: RPC.slice(0, -1),
            balance: '0.0',
            status: 'idle',
            loading: false,
            switching: false,
            firstAccess: false,
          });
        const eligible = await publicState(page);
        expect(fixture.evmAddresses).toContain(eligible.account.address);
        expect(eligible.account.label).toBeTruthy();
        expect(
          zeroBalanceReads.map((read) => getAddress(read.address))
        ).toContain(getAddress(eligible.account.address));
        observations.eligible = eligible;
        await banner.click();
        await expect(page).toHaveURL(/#\/faucet$/);
        await expect(requestNow).toBeEnabled();
      }
    );

    const selected = await publicState(page);
    const expectedAddress = `${selected.account.address.slice(
      0,
      8
    )}...${selected.account.address.slice(-8)}`;
    const name = page.getByRole('heading', {
      name: selected.account.label,
      exact: true,
      level: 1,
    });
    const card = name.locator('xpath=../..');
    const address = card.getByText(expectedAddress, { exact: true });
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 360 },
    ]) {
      await wallet.step(
        `observe the complete faucet account card at ${viewport.width}x${viewport.height}`,
        async () => {
          await page.setViewportSize(viewport);
          await expect(name).toHaveCount(1);
          await expect(address).toHaveCount(1);
          const before = await geometry(card);
          await revealCard(page, card);
          const after = {
            card: await geometry(card),
            name: await geometry(name),
            address: await geometry(address),
          };
          observations[`${viewport.width}x${viewport.height}`] = {
            viewport,
            before,
            after,
            publicState: await publicState(page),
            renderedName: await name.innerText(),
            renderedAddress: await address.innerText(),
          };
          expect(await publicState(page)).toEqual(selected);
          await info.attach(
            `faucet-account-${viewport.width}x${viewport.height}`,
            {
              contentType: 'image/png',
              body: await page.screenshot({
                animations: 'disabled',
                fullPage: false,
              }),
            }
          );
          for (const [part, measured] of Object.entries(after)) {
            if (viewport.width === 400) {
              expect(
                measured.horizontal,
                `${part}: ${JSON.stringify(measured)}`
              ).toBe(true);
              expect(
                measured.vertical,
                `${part}: ${JSON.stringify(measured)}`
              ).toBe(true);
              expect(
                measured.textContained,
                `${part}: ${JSON.stringify(measured)}`
              ).toBe(true);
              if (part !== 'card')
                expect(
                  measured.hit,
                  `${part}: ${JSON.stringify(measured)}`
                ).toBe(true);
            } else {
              // Candidate-only soft assertions keep Back/reopen and safety controls running.
              expect
                .soft(
                  measured.horizontal,
                  `${part}: ${JSON.stringify(measured)}`
                )
                .toBe(true);
              expect
                .soft(measured.vertical, `${part}: ${JSON.stringify(measured)}`)
                .toBe(true);
              expect
                .soft(
                  measured.textContained,
                  `${part}: ${JSON.stringify(measured)}`
                )
                .toBe(true);
              if (part !== 'card')
                expect
                  .soft(measured.hit, `${part}: ${JSON.stringify(measured)}`)
                  .toBe(true);
            }
          }
          expect(forbiddenRequests).toEqual([]);
        }
      );
    }
    await wallet.step(
      'keyboard Back and Space reopen preserve the same public account',
      async () => {
        await tabTo(page, back);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(prompt).toHaveCount(0);
        await tabTo(page, banner);
        await page.keyboard.press('Space');
        await expect(page).toHaveURL(/#\/faucet$/);
        await expect(requestNow).toBeEnabled();
        await expect(name).toHaveCount(1);
        await expect(address).toHaveCount(1);
        expect(await publicState(page)).toEqual(selected);
        observations.reopened = await publicState(page);
        expect(forbiddenRequests).toEqual([]);
        expect(deniedBalanceReads).toEqual([]);
        expect(routes!.deniedWrites).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(info.file)).digest('hex')
        ).toBe(testSourceSha256);
      }
    );
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    try {
      await info.attach('faucet-account-layout-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            runtime,
            testSourceSha256,
            status,
            observations,
            zeroBalanceReads,
            deniedBalanceReads,
            forbiddenRequests,
            deniedWrites: routes?.deniedWrites,
            fixtureReads: routes?.reads,
            proxyBlocked: server?.blocked,
            syntheticResponsesOnly: true,
            faucetClaimsRequested: false,
            controllerMutationsInjected: false,
            controllerResultsReplaced: false,
          },
          null,
          2
        ),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        try {
          await server?.close();
        } finally {
          Object.assign(E2E_CONFIG, previous);
        }
      }
    }
  }
});
