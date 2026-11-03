import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  armRuntimeReply,
  installRuntimeReplyHold,
  releaseRuntimeReply,
  restoreRuntimeReply,
  runtimeReplySnapshot,
} from '../harness/genuineRuntimeReply';
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

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

for (const viewport of [
  { width: 400, height: 620 },
  { width: 320, height: 360 },
]) {
  test(`network picker timeout leaves the Connect button unobstructed at ${viewport.width}px`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const previous = { ...E2E_CONFIG };
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PickerTimeoutSynthetic!2026',
      rpcUrl: server.url,
    });
    let wallet: PaliWallet | undefined;
    let holding = false;
    let status: 'passed' | 'failed' = 'failed';
    try {
      wallet = await PaliWallet.launch(`picker-timeout-${viewport.width}`, {
        offlineHttpProxy: server.url,
        recordVideo: false,
        viewport,
      });
      const fixture = createIsolatedVaultFixture();
      const audit = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      const page = wallet.page;
      let fail = false;
      let failures = 0;
      const denied: string[] = [];
      await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
        const raw = route.request().postDataJSON();
        const calls = Array.isArray(raw) ? raw : [raw];
        if (!fail || !calls.some((call) => call?.method === 'eth_getBalance'))
          return route.fallback();
        if (
          route.request().method() !== 'POST' ||
          !calls.length ||
          calls.some(
            (call) =>
              call.jsonrpc !== '2.0' ||
              call.method !== 'eth_getBalance' ||
              call.params?.length !== 2 ||
              !fixture.evmAddresses.some(
                (address) =>
                  address.toLowerCase() === String(call.params[0]).toLowerCase()
              ) ||
              call.params[1] !== 'latest'
          )
        ) {
          denied.push('unexpected failing balance request');
          return route.abort('blockedbyclient');
        }
        failures += calls.length;
        const replies = calls.map((call) => ({
          jsonrpc: '2.0',
          id: call.id,
          error: {
            code: -32000,
            message: 'Synthetic selected RPC read failure',
          },
        }));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(raw) ? replies : replies[0]),
        });
      });
      await wallet.importSeedAndCreatePassword();
      await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
      await page.locator('#general-settings-button').click();
      await page
        .getByRole('menuitem', { name: en.generalMenu.advanced, exact: true })
        .click();
      await page.locator('#advanced-refresh').click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: en.buttons.ok, exact: true })
        .click();
      await page
        .getByRole('button', { name: en.buttons.save, exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await wallet.ensureOnHome();
      fail = true;
      await page
        .getByRole('button', { name: en.header.refresh, exact: true })
        .click();
      await expect.poll(() => failures).toBeGreaterThan(0);
      const indicator = page.getByRole('button', {
        name: en.networkConnection.networkError,
        exact: true,
      });
      await expect(indicator).toBeEnabled({ timeout: 20_000 });
      await indicator.click();
      await expect(page).toHaveURL(/#\/chain-fail-to-connect$/);
      await page
        .getByRole('button', {
          name: en.chainError.goToAnotherNetwork,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/#\/switch-network$/);
      fail = false;
      await wallet.step(
        'timeout toast leaves Connect unobstructed and a healthy retry navigates home',
        async () => {
          await installRuntimeReplyHold(page);
          holding = true;
          await armRuntimeReply(page, 'setActiveNetwork');
          const connect = page.getByRole('button', {
            name: en.buttons.connect,
            exact: true,
          });
          await expect(connect).toBeEnabled();
          await connect.click();
          await expect
            .poll(() => runtimeReplySnapshot(page))
            .toMatchObject({
              held: true,
              heldMethod: 'setActiveNetwork',
              realResponseWasError: false,
            });
          await expect(connect).toBeDisabled();
          const toast = page
            .getByRole('alert')
            .filter({ hasText: en.switchNetworkPage.connectionTimedOut });
          await expect(toast).toBeVisible({ timeout: 20_000 });
          const toastOuter = toast
            .locator(
              'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " Toastify__toast ")]'
            )
            .first();
          await expect(toastOuter).toBeVisible();
          await expect(connect).toBeEnabled();
          await connect.scrollIntoViewIfNeeded();
          await toast.evaluate(async (node) => {
            await document.fonts.ready;
            const ancestors: Element[] = [];
            for (
              let current: Element | null = node;
              current;
              current = current.parentElement
            )
              ancestors.push(current);
            await Promise.all(
              ancestors
                .flatMap((element) => element.getAnimations())
                .filter(
                  (animation) =>
                    animation.playState === 'running' &&
                    Number.isFinite(
                      Number(animation.effect?.getComputedTiming().endTime)
                    )
                )
                .map((animation) => animation.finished.catch(() => undefined))
            );
          });
          await expect(toast).toBeVisible();
          await expect
            .poll(
              async () => {
                const t = await toastOuter.boundingBox();
                const c = await connect.boundingBox();
                if (!t || !c) return false;
                const separate =
                  t.y + t.height <= c.y ||
                  c.y + c.height <= t.y ||
                  t.x + t.width <= c.x ||
                  c.x + c.width <= t.x;
                const hit = await connect.evaluate((node) => {
                  const r = node.getBoundingClientRect();
                  return [r.top + r.height / 2, r.bottom - 2].every((y) => {
                    const target = document.elementFromPoint(
                      r.left + r.width / 2,
                      y
                    );
                    return (
                      !!target && (target === node || node.contains(target))
                    );
                  });
                });
                return separate && hit;
              },
              { timeout: 1500 }
            )
            .toBe(true);
          await info.attach(`picker-timeout-clear-${viewport.width}`, {
            body: await page.screenshot({ animations: 'allow' }),
            contentType: 'image/png',
          });
          await releaseRuntimeReply(page);
          await restoreRuntimeReply(page);
          holding = false;
          await expect(page).toHaveURL(/#\/switch-network$/);
          await connect.click();
          await expect(page).toHaveURL(/#\/home$/, { timeout: 20_000 });
        }
      );
      await wallet.ensureOnHome();
      expect(denied).toEqual([]);
      expect(audit.deniedWrites).toEqual([]);
      expect(extensionEvidence()).toEqual(runtime);
      status = 'passed';
    } finally {
      try {
        if (wallet && holding) await restoreRuntimeReply(wallet.page);
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
}
